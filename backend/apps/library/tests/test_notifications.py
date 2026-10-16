"""Notification events, recipients, the push helper and the Celery task (called directly, no worker)."""
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.communication import realtime
from apps.communication.models import CommunicationNotification
from apps.library import tasks
from apps.library.models import BookIssue, Hold, LibraryActivityLog, LostDamagedReport
from apps.library.services import notifications
from apps.library.services.settings import get_settings
from apps.library.tests.conftest import (
    _student,
    client_for,
    make_book,
    make_member,
    make_staff,
)

User = get_user_model()
ISSUES = "/api/v1/library/issues/"
REPORTS = "/api/v1/library/lost-damaged/"
PHONE, EMAIL = "9990001111", "parent@example.test"


def ago(days):
    return timezone.localdate() - timedelta(days=days)


def make_guardian(school, with_user=True, phone=PHONE, email=EMAIL):
    from apps.students.models import Guardian

    user = User.objects.create_user(username=f"guardian_{uuid4().hex[:8]}", password="x", school=school) if with_user else None
    return Guardian.objects.create(school=school, full_name="Parent One", relation="Mother", phone=phone, email=email, user=user)


def pupil_member(school, guardian=None, card="PU-1"):
    student = _student(school, f"A-{card}")
    student.guardian = guardian
    student.save()
    return make_member(school, card, member_type="student", student=student)


def teacher_member(school, card="TE-1", with_user=True):
    user = User.objects.create_user(username=f"teacher_{uuid4().hex[:8]}", password="x", school=school) if with_user else None
    return make_member(school, card, member_type="teacher", staff=make_staff(school, user=user, phone="8880002222", email="teacher@example.test"))


def overdue_loan(school, book, member, days=3):
    copy = book.copies.exclude(loans__status="issued").first()
    book.copies.filter(pk=copy.pk).update(status="issued")
    return BookIssue.objects.create(school=school, book=book, copy=copy, member=member, issue_date=ago(days + 14), due_date=ago(days))


@pytest.fixture
def pushes(monkeypatch):
    """Record every push instead of touching a channel layer."""
    sent = []
    monkeypatch.setattr(notifications, "push_portal_event", lambda user_id, payload: sent.append((user_id, payload)) or True)
    return sent


@pytest.fixture
def no_external(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("SMS or email must not be sent while notify_sms_email_enabled is off")

    monkeypatch.setattr(notifications, "send_sms_twilio", refuse)
    monkeypatch.setattr(notifications, "send_email_sendgrid", refuse)


# ---- recipients --------------------------------------------------------------------------------------------------------


def test_a_student_is_reached_through_the_primary_guardian(school):
    guardian = make_guardian(school)
    recipient = notifications.resolve_recipient(
        type(pupil_member(school, guardian)).objects.select_related("student__guardian__user", "staff__user").get(card_no="PU-1")
    )
    assert recipient.user == guardian.user and recipient.link_url == "/parent/library"
    assert (recipient.phone, recipient.email, recipient.reason) == (PHONE, EMAIL, "")


def test_a_teacher_is_reached_at_their_own_user(school):
    member = teacher_member(school)
    loaded = type(member).objects.select_related("student__guardian__user", "staff__user").get(pk=member.pk)
    recipient = notifications.resolve_recipient(loaded)
    assert recipient.user == loaded.staff.user and recipient.link_url == "/teacher/library/my-books"
    assert recipient.phone == "8880002222" and recipient.email == "teacher@example.test"


@pytest.mark.parametrize("case", ["no_guardian", "guardian_without_user", "staff_without_user"])
def test_no_user_means_no_recipient_and_says_why(school, case):
    member = {
        "no_guardian": lambda: pupil_member(school, None, "NG"),
        "guardian_without_user": lambda: pupil_member(school, make_guardian(school, with_user=False), "GU"),
        "staff_without_user": lambda: teacher_member(school, "SU", with_user=False),
    }[case]()
    loaded = type(member).objects.select_related("student__guardian__user", "staff__user").get(pk=member.pk)
    recipient = notifications.resolve_recipient(loaded)
    assert recipient.user is None and recipient.reason


def test_deliver_with_no_recipient_creates_nothing_but_logs_a_reminder_row(school, book, pushes, no_external):
    member = pupil_member(school, None, "NR")
    loan = overdue_loan(school, book, member)
    result = notifications.deliver_event(school.id, "overdue_reminder", {"issue_id": loan.pk, "date": ago(0).isoformat()})
    assert result == {"status": "no_recipient"}
    assert not CommunicationNotification.objects.exists() and pushes == []
    row = LibraryActivityLog.objects.get(school=school, event_type="reminder")
    assert row.metadata["skipped"] == "no_recipient" and row.member_id == member.pk and "guardian" in row.summary
    assert PHONE not in row.summary and EMAIL not in row.summary


# ---- the three events ----------------------------------------------------------------------------------------------------


def test_hold_ready_notifies_the_first_waiting_member_once(school, book, pushes, no_external):
    guardian = make_guardian(school)
    child = pupil_member(school, guardian)
    hold = Hold.objects.create(school=school, book=book, member=child)
    result = notifications.deliver_event(school.id, "hold_ready", {"hold_id": hold.pk})
    assert result["status"] == "created"
    note = CommunicationNotification.objects.get()
    assert (note.recipient, note.notification_type, note.link_url, note.school) == (guardian.user, "system", "/parent/library", school)
    assert book.title in note.body and note.data == {"event": "hold_ready", "library": True, "hold_id": hold.pk}
    assert len(pushes) == 1
    user_id, payload = pushes[0]
    assert user_id == guardian.user.pk
    assert set(payload) == {"kind", "event", "id", "title", "body", "link_url", "created_at"}
    assert payload["kind"] == "library" and payload["event"] == "hold_ready" and payload["id"] == note.pk
    # delivering the same event again does nothing new
    again = notifications.deliver_event(school.id, "hold_ready", {"hold_id": hold.pk})
    assert again["status"] == "duplicate" and CommunicationNotification.objects.count() == 1 and len(pushes) == 1


def test_hold_ready_is_stale_once_the_hold_is_no_longer_waiting(school, book, pushes):
    hold = Hold.objects.create(school=school, book=book, member=teacher_member(school), status="cancelled")
    assert notifications.deliver_event(school.id, "hold_ready", {"hold_id": hold.pk}) == {"status": "stale"}
    assert not CommunicationNotification.objects.exists()


def test_overdue_reminder_says_what_is_late_and_is_a_reminder_type(school, book, pushes, no_external):
    teacher = teacher_member(school)
    loan = overdue_loan(school, book, teacher, days=3)
    day = ago(0).isoformat()
    result = notifications.deliver_event(school.id, "overdue_reminder", {"issue_id": loan.pk, "date": day})
    note = CommunicationNotification.objects.get()
    assert result["status"] == "created" and note.notification_type == "reminder" and note.link_url == "/teacher/library/my-books"
    assert "3 day(s) overdue" in note.body and "Fine so far: 30.00" in note.body and book.title in note.body
    assert notifications.deliver_event(school.id, "overdue_reminder", {"issue_id": loan.pk, "date": day})["status"] == "duplicate"
    assert CommunicationNotification.objects.count() == 1
    # a new day is a new reminder
    other_day = (ago(0) + timedelta(days=1)).isoformat()
    notifications.deliver_event(school.id, "overdue_reminder", {"issue_id": loan.pk, "date": other_day})
    assert CommunicationNotification.objects.count() == 2


def test_overdue_reminder_is_stale_when_the_loan_was_returned_or_is_not_late(school, book, category, pushes):
    teacher = teacher_member(school)
    returned = overdue_loan(school, book, teacher)
    BookIssue.objects.filter(pk=returned.pk).update(status="returned")
    assert notifications.deliver_event(school.id, "overdue_reminder", {"issue_id": returned.pk})["status"] == "stale"
    fresh_book = make_book(school, category, title="Fresh")
    on_time = BookIssue.objects.create(school=school, book=fresh_book, member=teacher, issue_date=ago(1), due_date=ago(-5))
    assert notifications.deliver_event(school.id, "overdue_reminder", {"issue_id": on_time.pk})["status"] == "stale"
    assert not CommunicationNotification.objects.exists()


def test_replacement_fee_goes_to_the_guardian_once(school, book, pushes, no_external):
    guardian = make_guardian(school)
    child = pupil_member(school, guardian)
    report = LostDamagedReport.objects.create(
        school=school, book=book, copy=book.copies.first(), member=child, report_type="lost", reported_on=ago(0), replacement_cost=Decimal("150")
    )
    assert notifications.deliver_event(school.id, "replacement_fee", {"report_id": report.pk})["status"] == "created"
    note = CommunicationNotification.objects.get()
    assert note.recipient == guardian.user and note.notification_type == "reminder" and "150" in note.body and "lost" in note.body
    assert notifications.deliver_event(school.id, "replacement_fee", {"report_id": report.pk})["status"] == "duplicate"
    assert CommunicationNotification.objects.count() == 1


def test_replacement_fee_for_a_report_with_no_borrower_is_stale(school, book, pushes):
    report = LostDamagedReport.objects.create(school=school, book=book, copy=book.copies.first(), report_type="lost", reported_on=ago(0))
    assert notifications.deliver_event(school.id, "replacement_fee", {"report_id": report.pk}) == {"status": "stale"}


def test_events_are_school_scoped(school, other_school, other_book, pushes):
    foreign_hold = Hold.objects.create(school=other_school, book=other_book, member=teacher_member(other_school))
    assert notifications.deliver_event(school.id, "hold_ready", {"hold_id": foreign_hold.pk}) == {"status": "stale"}
    assert not CommunicationNotification.objects.exists()


def test_an_unknown_event_is_rejected(school):
    with pytest.raises(ValueError):
        notifications.deliver_event(school.id, "party", {})
    with pytest.raises(ValueError):
        notifications.enqueue_event(school.id, "party", {})


# ---- the push helper ----------------------------------------------------------------------------------------------------


class FakeLayer:
    def __init__(self, fail=False):
        self.fail, self.sent = fail, []

    async def group_send(self, group, message):
        if self.fail:
            raise ConnectionError("redis is down")
        self.sent.append((group, message))


def test_push_sends_the_payload_to_the_users_group(monkeypatch):
    layer = FakeLayer()
    monkeypatch.setattr("channels.layers.get_channel_layer", lambda *a, **k: layer)
    payload = {"kind": "library", "event": "hold_ready", "id": 5}
    assert realtime.push_portal_event(42, payload) is True
    assert layer.sent == [("user_42", {"type": "portal_notification", "notification": payload})]


def test_push_swallows_a_channel_layer_failure(monkeypatch):
    monkeypatch.setattr("channels.layers.get_channel_layer", lambda *a, **k: FakeLayer(fail=True))
    assert realtime.push_portal_event(42, {"kind": "library"}) is False


def test_push_swallows_a_missing_layer_and_a_broken_lookup(monkeypatch):
    monkeypatch.setattr("channels.layers.get_channel_layer", lambda *a, **k: None)
    assert realtime.push_portal_event(1, {}) is False

    def boom(*args, **kwargs):
        raise RuntimeError("misconfigured")

    monkeypatch.setattr("channels.layers.get_channel_layer", boom)
    assert realtime.push_portal_event(1, {}) is False


def test_a_failing_push_does_not_stop_the_notification_row(school, book, monkeypatch, no_external):
    monkeypatch.setattr("channels.layers.get_channel_layer", lambda *a, **k: FakeLayer(fail=True))
    hold = Hold.objects.create(school=school, book=book, member=teacher_member(school))
    assert notifications.deliver_event(school.id, "hold_ready", {"hold_id": hold.pk})["status"] == "created"
    assert CommunicationNotification.objects.count() == 1


# ---- SMS and email (off by default) ----------------------------------------------------------------------------------------


@pytest.fixture
def externals(monkeypatch):
    calls = {"sms": [], "email": [], "sms_status": "sent", "email_status": "sent"}
    monkeypatch.setattr(notifications, "send_sms_twilio", lambda to, text: calls["sms"].append(to) or (calls["sms_status"], "twilio", ""))
    monkeypatch.setattr(notifications, "send_email_sendgrid", lambda to, subject, text: calls["email"].append(to) or (calls["email_status"], "sendgrid", ""))
    return calls


def enable_external(school):
    settings = get_settings(school)
    settings.notify_sms_email_enabled = True
    settings.save()


def test_nothing_external_is_sent_while_the_switch_is_off(school, book, pushes, no_external):
    hold = Hold.objects.create(school=school, book=book, member=pupil_member(school, make_guardian(school)))
    notifications.deliver_event(school.id, "hold_ready", {"hold_id": hold.pk})
    assert CommunicationNotification.objects.get().data.get("sms") is None


def test_sms_and_email_go_to_the_guardian_when_switched_on(school, book, pushes, externals):
    enable_external(school)
    hold = Hold.objects.create(school=school, book=book, member=pupil_member(school, make_guardian(school)))
    notifications.deliver_event(school.id, "hold_ready", {"hold_id": hold.pk})
    assert externals["sms"] == [PHONE] and externals["email"] == [EMAIL]
    assert CommunicationNotification.objects.get().data["sms"] == "sent"


def test_a_missing_phone_or_email_is_skipped_not_failed(school, book, pushes, externals):
    enable_external(school)
    hold = Hold.objects.create(school=school, book=book, member=pupil_member(school, make_guardian(school, phone="", email="")))
    assert notifications.deliver_event(school.id, "hold_ready", {"hold_id": hold.pk})["status"] == "created"
    assert externals["sms"] == [] and externals["email"] == []
    data = CommunicationNotification.objects.get().data
    assert (data["sms"], data["email"]) == ("skipped", "skipped")


def test_an_sms_failure_raises_for_retry_and_the_retry_sends_only_what_is_left(school, book, pushes, externals):
    enable_external(school)
    hold = Hold.objects.create(school=school, book=book, member=pupil_member(school, make_guardian(school)))
    externals["sms_status"] = "failed"
    with pytest.raises(notifications.DeliveryFailed):
        notifications.deliver_event(school.id, "hold_ready", {"hold_id": hold.pk})
    assert CommunicationNotification.objects.count() == 1 and len(pushes) == 1  # the in-app part was not rolled back
    assert externals["email"] == [EMAIL]
    externals["sms_status"] = "sent"
    result = notifications.deliver_event(school.id, "hold_ready", {"hold_id": hold.pk})
    assert result["status"] == "duplicate" and len(pushes) == 1
    assert externals["sms"] == [PHONE, PHONE] and externals["email"] == [EMAIL]  # email was already sent: not repeated
    assert CommunicationNotification.objects.get().data["sms"] == "sent"


# ---- the Celery task, called directly ----------------------------------------------------------------------------------------


def test_the_task_delivers_the_event(school, book, pushes, no_external):
    hold = Hold.objects.create(school=school, book=book, member=teacher_member(school))
    assert tasks.deliver_library_event(school.id, "hold_ready", {"hold_id": hold.pk})["status"] == "created"
    assert tasks.deliver_library_event.name == "library.deliver_event" and tasks.deliver_library_event.max_retries == 4


def test_the_task_retries_an_external_failure_and_raises_when_called_directly(school, book, pushes, externals):
    enable_external(school)
    externals["email_status"] = "failed"
    hold = Hold.objects.create(school=school, book=book, member=teacher_member(school))
    with pytest.raises(notifications.DeliveryFailed):
        tasks.deliver_library_event(school.id, "hold_ready", {"hold_id": hold.pk})


def test_backoff_doubles_and_is_capped():
    assert [min(30 * 2**n, tasks.MAX_RETRY_DELAY_SECONDS) for n in range(5)] == [30, 60, 120, 240, 480]
    assert min(30 * 2**10, tasks.MAX_RETRY_DELAY_SECONDS) == 900


# ---- queueing and wiring ------------------------------------------------------------------------------------------------------


@pytest.fixture
def eager(monkeypatch):
    """Run queued tasks inline, as the test settings intend: no broker, no worker."""
    conf = tasks.deliver_library_event.app.conf
    monkeypatch.setattr(conf, "task_always_eager", True)
    monkeypatch.setattr(conf, "task_eager_propagates", True)


@pytest.fixture
def queued(monkeypatch):
    """Capture what would be sent to the broker."""
    calls = []
    monkeypatch.setattr(tasks.deliver_library_event, "apply_async", lambda *args, **kwargs: calls.append(kwargs["args"]))
    return calls


def test_events_are_queued_only_when_the_transaction_commits(school, queued, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=False) as callbacks:
        notifications.enqueue_event(school.id, "hold_ready", {"hold_id": 7})
    assert queued == [] and len(callbacks) == 1
    callbacks[0]()
    assert queued == [(school.id, "hold_ready", {"hold_id": 7})]


def test_a_broker_failure_while_queueing_is_swallowed(school, monkeypatch, django_capture_on_commit_callbacks):
    def boom(*args, **kwargs):
        raise ConnectionError("no broker")

    monkeypatch.setattr(tasks.deliver_library_event, "apply_async", boom)
    with django_capture_on_commit_callbacks(execute=True):
        notifications.enqueue_event(school.id, "hold_ready", {"hold_id": 7})  # must not raise


def test_task_arguments_hold_ids_and_dates_only(school, book, librarian_client, queued, django_capture_on_commit_callbacks):
    guardian = make_guardian(school)
    child = pupil_member(school, guardian)
    teacher = teacher_member(school)
    loan = overdue_loan(school, book, teacher)
    Hold.objects.create(school=school, book=book, member=child)
    with django_capture_on_commit_callbacks(execute=True):
        librarian_client.post(f"{ISSUES}remind/", {"issue_ids": [loan.pk]}, format="json")
        librarian_client.post(f"{ISSUES}{loan.pk}/return/", {"fine_action": "collect"}, format="json")
    assert len(queued) == 2
    flat = repr(queued)
    for secret in (PHONE, EMAIL, "8880002222", "teacher@example.test", "Parent One"):
        assert secret not in flat
    for _school_id, event, ids in queued:
        assert event in notifications.EVENTS and all(isinstance(v, (int, str)) for v in ids.values())


def test_return_with_waiting_holds_notifies_the_first_in_line(school, book, librarian_client, pushes, no_external, eager, django_capture_on_commit_callbacks):
    holder = teacher_member(school, "HOLD-1")
    second = teacher_member(school, "HOLD-2")
    borrower = teacher_member(school, "BOR-1")
    loan = librarian_client.post(f"{ISSUES}issue/", {"member": borrower.pk, "book": book.pk}, format="json").json()["data"]["loan"]
    first_hold = Hold.objects.create(school=school, book=book, member=holder)
    Hold.objects.create(school=school, book=book, member=second)
    with django_capture_on_commit_callbacks(execute=True):
        resp = librarian_client.post(f"{ISSUES}{loan['id']}/return/")
    assert resp.json()["data"]["hold_queue_count"] == 2
    note = CommunicationNotification.objects.get()
    assert note.recipient == holder.staff.user and note.data["hold_id"] == first_hold.pk and note.data["event"] == "hold_ready"
    assert [p[0] for p in pushes] == [holder.staff.user.pk]


def test_return_without_holds_notifies_no_one(school, book, librarian_client, pushes, django_capture_on_commit_callbacks):
    loan = librarian_client.post(f"{ISSUES}issue/", {"member": teacher_member(school).pk, "book": book.pk}, format="json").json()["data"]["loan"]
    with django_capture_on_commit_callbacks(execute=True) as callbacks:
        librarian_client.post(f"{ISSUES}{loan['id']}/return/")
    assert callbacks == [] and not CommunicationNotification.objects.exists()


def test_nothing_is_sent_if_the_action_never_commits(school, book, librarian_client, pushes, django_capture_on_commit_callbacks):
    loan = librarian_client.post(f"{ISSUES}issue/", {"member": teacher_member(school).pk, "book": book.pk}, format="json").json()["data"]["loan"]
    Hold.objects.create(school=school, book=book, member=teacher_member(school, "W-1"))
    with django_capture_on_commit_callbacks(execute=False):
        librarian_client.post(f"{ISSUES}{loan['id']}/return/")
    assert not CommunicationNotification.objects.exists()


def test_a_lost_report_at_return_notifies_the_borrower_of_the_fee(school, book, librarian_client, pushes, no_external, eager, django_capture_on_commit_callbacks):
    guardian = make_guardian(school)
    child = pupil_member(school, guardian)
    loan = librarian_client.post(f"{ISSUES}issue/", {"member": child.pk, "book": book.pk}, format="json").json()["data"]["loan"]
    with django_capture_on_commit_callbacks(execute=True):
        librarian_client.post(f"{ISSUES}{loan['id']}/return/", {"report": {"type": "lost"}}, format="json")
    note = CommunicationNotification.objects.get()
    assert note.recipient == guardian.user and note.data["event"] == "replacement_fee" and note.notification_type == "reminder"


def test_a_damaged_return_with_a_report_does_not_say_the_book_is_ready(school, book, librarian_client, pushes, no_external, eager, django_capture_on_commit_callbacks):
    borrower = teacher_member(school, "BR")
    Hold.objects.create(school=school, book=book, member=teacher_member(school, "WT"))
    loan = librarian_client.post(f"{ISSUES}issue/", {"member": borrower.pk, "book": book.pk}, format="json").json()["data"]["loan"]
    with django_capture_on_commit_callbacks(execute=True):
        librarian_client.post(f"{ISSUES}{loan['id']}/return/", {"report": {"type": "damaged"}}, format="json")
    assert [n.data["event"] for n in CommunicationNotification.objects.all()] == ["replacement_fee"]


def test_manual_report_notifies_only_when_someone_is_billed(school, book, librarian_client, pushes, no_external, eager, django_capture_on_commit_callbacks):
    teacher = teacher_member(school)
    one, two = book.copies.order_by("id")
    with django_capture_on_commit_callbacks(execute=True):
        librarian_client.post(REPORTS, {"copy": one.pk, "report_type": "lost", "member": teacher.pk}, format="json")
        librarian_client.post(REPORTS, {"copy": two.pk, "report_type": "lost"}, format="json")  # a shelf loss: nobody to bill
    notes = CommunicationNotification.objects.all()
    assert [n.data["event"] for n in notes] == ["replacement_fee"] and notes[0].recipient == teacher.staff.user


def test_repeating_a_report_does_not_notify_twice(school, book, librarian_client, pushes, no_external, eager, django_capture_on_commit_callbacks):
    teacher = teacher_member(school)
    copy = book.copies.first()
    body = {"copy": copy.pk, "report_type": "lost", "member": teacher.pk}
    with django_capture_on_commit_callbacks(execute=True):
        librarian_client.post(REPORTS, body, format="json")
        librarian_client.post(REPORTS, body, format="json")
    assert CommunicationNotification.objects.count() == 1


def test_librarians_notifications_are_scoped_to_the_school(school, other_school, book, librarian_client, pushes, no_external, eager, django_capture_on_commit_callbacks):
    teacher = teacher_member(school)
    loan = overdue_loan(school, book, teacher)
    with django_capture_on_commit_callbacks(execute=True):
        librarian_client.post(f"{ISSUES}remind/", {"issue_ids": [loan.pk]}, format="json")
    assert CommunicationNotification.objects.get().school_id == school.id
    assert not CommunicationNotification.objects.filter(school=other_school).exists()
    assert client_for(User.objects.create_user(username="x_lib", password="x", school=other_school, is_school_admin=True)).post(
        f"{ISSUES}remind/", {"issue_ids": [loan.pk]}, format="json"
    ).status_code == 404
