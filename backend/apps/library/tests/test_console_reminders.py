"""issues/remind/ and console/summary/."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.library.models import BookIssue, Hold, LibraryActivityLog, LostDamagedReport
from apps.library.services import reminders
from apps.library.tests.conftest import client_for, make_book, make_member, make_user

BASE = "/api/v1/library"
REMIND = f"{BASE}/issues/remind/"
SUMMARY = f"{BASE}/console/summary/"


def ago(days):
    return timezone.localdate() - timedelta(days=days)


def lend(school, book, member, due_days_ago):
    copy = book.copies.exclude(loans__status="issued").first()
    book.copies.filter(pk=copy.pk).update(status="issued")
    return BookIssue.objects.create(
        school=school, book=book, copy=copy, member=member, issue_date=ago(due_days_ago + 14), due_date=ago(due_days_ago)
    )


@pytest.fixture
def staff_member(school):
    return make_member(school, "ST-1", member_type="staff")


@pytest.fixture
def queued(monkeypatch):
    from apps.library import tasks

    calls = []
    monkeypatch.setattr(tasks.deliver_library_event, "apply_async", lambda *a, **kw: calls.append(kw["args"]))
    return calls


def remind(client, **body):
    return client.post(REMIND, body, format="json")


def reminder_rows(school):
    return LibraryActivityLog.objects.filter(school=school, event_type="reminder", metadata__action="remind")


# ---- remind ---------------------------------------------------------------------------------------------------------------------


def test_remind_one_loan_queues_it_and_writes_one_log_row(librarian_client, school, book, staff_member, queued, django_capture_on_commit_callbacks):
    loan = lend(school, book, staff_member, 3)
    with django_capture_on_commit_callbacks(execute=True):
        resp = remind(librarian_client, issue_ids=[loan.pk])
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["queued"] == 1 and data["queued_ids"] == [loan.pk] and data["skipped"] == [] and data["remaining"] == 0
    assert queued == [(school.id, "overdue_reminder", {"issue_id": loan.pk, "date": timezone.localdate().isoformat()})]
    row = reminder_rows(school).get()
    assert row.metadata["loan_ids"] == [loan.pk] and row.metadata["date"] == timezone.localdate().isoformat()
    assert row.actor is not None and "1 loan" in row.summary


def test_nothing_is_queued_before_the_commit(librarian_client, school, book, staff_member, queued, django_capture_on_commit_callbacks):
    loan = lend(school, book, staff_member, 3)
    with django_capture_on_commit_callbacks(execute=False):
        remind(librarian_client, issue_ids=[loan.pk])
    assert queued == []


def test_a_single_repeat_the_same_day_is_a_409(librarian_client, school, book, staff_member, queued):
    loan = lend(school, book, staff_member, 3)
    assert remind(librarian_client, issue_ids=[loan.pk]).status_code == 200
    again = remind(librarian_client, issue_ids=[loan.pk])
    assert again.status_code == 409 and again.json()["error"]["code"] == "library_reminder_already_sent"
    assert reminder_rows(school).count() == 1


def test_a_batch_skips_loans_already_reminded_today(librarian_client, school, category, staff_member, queued):
    first, second = (lend(school, make_book(school, category, title=f"B{n}"), staff_member, 2) for n in range(2))
    remind(librarian_client, issue_ids=[first.pk])
    data = remind(librarian_client, issue_ids=[first.pk, second.pk]).json()["data"]
    assert data["queued_ids"] == [second.pk] and data["skipped"] == [{"issue": first.pk, "reason": "already_sent"}]
    assert reminder_rows(school).count() == 2  # one row per batch


def test_all_overdue_reminds_every_overdue_open_loan_only(librarian_client, school, category, staff_member, queued):
    overdue = [lend(school, make_book(school, category, title=f"O{n}"), staff_member, n + 1) for n in range(3)]
    on_time = BookIssue.objects.create(school=school, book=make_book(school, category, title="Fine"), member=staff_member, issue_date=ago(1), due_date=ago(-5))
    closed = lend(school, make_book(school, category, title="Back"), staff_member, 4)
    BookIssue.objects.filter(pk=closed.pk).update(status="returned")
    data = remind(librarian_client, all_overdue=True).json()["data"]
    assert sorted(data["queued_ids"]) == sorted(loan.pk for loan in overdue) and on_time.pk not in data["queued_ids"]
    assert data["queued"] == 3 and reminder_rows(school).count() == 1
    assert remind(librarian_client, all_overdue=True).json()["data"]["queued"] == 0  # all reminded today
    assert reminder_rows(school).count() == 1  # nothing queued, so no new row


def test_the_batch_is_capped_and_says_how_many_were_left_out(
    librarian_client, school, category, staff_member, queued, monkeypatch, django_capture_on_commit_callbacks
):
    monkeypatch.setattr(reminders, "MAX_REMIND_BATCH", 3)
    for n in range(5):
        lend(school, make_book(school, category, title=f"C{n}"), staff_member, n + 1)
    with django_capture_on_commit_callbacks(execute=True):
        data = remind(librarian_client, all_overdue=True).json()["data"]
        assert data["queued"] == 3 and data["remaining"] == 2
        second = remind(librarian_client, all_overdue=True).json()["data"]
        assert second["queued"] == 2 and second["remaining"] == 0  # the next run reaches the loans the cap left out
        assert remind(librarian_client, all_overdue=True).json()["data"]["queued"] == 0
    assert len(queued) == 5 and len({args[2]["issue_id"] for args in queued}) == 5


def test_more_than_200_ids_is_a_400(librarian_client):
    assert remind(librarian_client, issue_ids=list(range(1, 202))).status_code == 400


def test_exactly_one_mode_is_required(librarian_client, school, book, staff_member):
    loan = lend(school, book, staff_member, 2)
    assert remind(librarian_client).status_code == 400
    assert remind(librarian_client, issue_ids=[loan.pk], all_overdue=True).status_code == 400
    assert remind(librarian_client, issue_ids=[]).status_code == 400


def test_a_loan_that_is_not_overdue_is_refused_singly_and_skipped_in_a_batch(librarian_client, school, category, staff_member, queued):
    fresh = BookIssue.objects.create(school=school, book=make_book(school, category, title="Fresh"), member=staff_member, issue_date=ago(1), due_date=ago(-5))
    late = lend(school, make_book(school, category, title="Late"), staff_member, 2)
    single = remind(librarian_client, issue_ids=[fresh.pk])
    assert single.status_code == 409 and single.json()["error"]["code"] == "library_invalid_state_transition"
    data = remind(librarian_client, issue_ids=[fresh.pk, late.pk]).json()["data"]
    assert data["queued_ids"] == [late.pk] and data["skipped"] == [{"issue": fresh.pk, "reason": "not_overdue"}]
    assert all(fresh.pk not in row.metadata["loan_ids"] for row in reminder_rows(school))


def test_a_closed_loan_is_not_remindable(librarian_client, school, book, staff_member):
    loan = lend(school, book, staff_member, 3)
    BookIssue.objects.filter(pk=loan.pk).update(status="returned")
    assert remind(librarian_client, issue_ids=[loan.pk]).status_code == 409


def test_other_schools_loans_are_not_found(librarian_client, other_issue, school, book, staff_member, queued):
    assert remind(librarian_client, issue_ids=[other_issue.pk]).status_code == 404
    mine = lend(school, book, staff_member, 2)
    data = remind(librarian_client, issue_ids=[other_issue.pk, mine.pk]).json()["data"]
    assert data["queued_ids"] == [mine.pk] and data["skipped"] == [{"issue": other_issue.pk, "reason": "not_found"}]
    assert remind(librarian_client, all_overdue=True).json()["data"]["queued"] == 0  # mine was reminded just now
    assert all(args[0] == school.id for args in queued)


def test_a_new_day_allows_a_new_reminder(school, librarian, book, staff_member, queued):
    loan = lend(school, book, staff_member, 3)
    today = timezone.localdate()
    assert reminders.send_reminders(school, librarian, issue_ids=[loan.pk], today=today)["queued"] == 1
    row = reminder_rows(school).get()
    LibraryActivityLog.objects.filter(pk=row.pk).update(created_at=timezone.now() - timedelta(days=1))
    assert reminders.send_reminders(school, librarian, issue_ids=[loan.pk], today=today)["queued"] == 1


def test_remind_needs_its_own_code(school, book, staff_member, queued):
    loan = lend(school, book, staff_member, 3)
    assert remind(client_for(make_user(school, ["library.book_issues.view"])), issue_ids=[loan.pk]).status_code == 403
    assert remind(client_for(make_user(school, ["library.book_issues.return"])), issue_ids=[loan.pk]).status_code == 403
    assert remind(client_for(make_user(school, ["library.book_issues.remind"])), issue_ids=[loan.pk]).status_code == 200


def test_remind_requires_authentication(api_client):
    assert api_client.post(REMIND, {"all_overdue": True}, format="json").status_code == 401


# ---- console summary ----------------------------------------------------------------------------------------------------------


def test_summary_numbers_and_lists(librarian_client, school, category, staff_member):
    from apps.library.models import BookCategory

    science = BookCategory.objects.create(school=school, name="Science", code="SCI", color_key="sky")
    a = make_book(school, category, title="Alpha", copies=4, cost_per_copy=Decimal("100"))
    b = make_book(school, science, title="Beta", copies=2, cost_per_copy=Decimal("50"))
    late = lend(school, a, staff_member, 3)
    due_today = lend(school, b, make_member(school, "ST-2", member_type="staff"), 0)
    a.copies.filter(status="available").first().__class__.objects.filter(pk=a.copies.filter(status="available").first().pk).update(status="lost")
    LostDamagedReport.objects.create(school=school, book=a, copy=a.copies.filter(status="lost").first(), report_type="lost", reported_on=ago(0))
    Hold.objects.create(school=school, book=b, member=staff_member)
    body = librarian_client.get(SUMMARY).json()
    assert body["success"] is True
    data = body["data"]
    tiles = data["tiles"]
    assert (tiles["titles"], tiles["copies_total"], tiles["copies_available"]) == (2, 6, 3)  # 6 copies; 2 out on loan, 1 lost, 3 on the shelf
    assert tiles["active_loans"] == 2 and tiles["overdue"] == 1 and tiles["pending_reports"] == 1
    assert data["due_today"] == 1 and data["overdue"] == 1 and data["holds_waiting"] == 1 and data["period"] == {}
    assert [row["id"] for row in data["attention"]] == [late.pk, due_today.pk]
    assert data["attention"][0]["state"] == "overdue" and data["attention"][1]["state"] == "due_today"
    assert [h["book_title"] for h in data["holds"]] == ["Beta"]
    assert {m["name"] for m in data["mix"]} == {"Fiction", "Science"} and abs(sum(m["share"] for m in data["mix"]) - 1) < 0.01
    assert {"id", "event_type", "summary", "created_at", "actor_name"} <= set(data["activity"][0])


def test_collection_value_leaves_out_lost_and_withdrawn_copies(librarian_client, school, category):
    book = make_book(school, category, title="Priced", copies=4, cost_per_copy=Decimal("100"))
    one, two, three, four = book.copies.order_by("id")
    type(one).objects.filter(pk=two.pk).update(status="lost")
    type(one).objects.filter(pk=three.pk).update(status="withdrawn")
    type(one).objects.filter(pk=four.pk).update(status="damaged")
    tiles = librarian_client.get(SUMMARY).json()["data"]["tiles"]
    assert tiles["collection_value"] == "200.00"  # available + damaged copies
    assert tiles["copies_total"] == 3  # withdrawn is off the books; lost still counts as a copy


def test_empty_school_summary_is_all_zeros(librarian_client):
    data = librarian_client.get(SUMMARY).json()["data"]
    assert data["tiles"] == {
        "titles": 0, "collection_value": "0.00", "copies_total": 0, "copies_available": 0, "available_share": 0,
        "active_loans": 0, "overdue": 0, "pending_reports": 0,
    }
    assert data["attention"] == [] and data["holds"] == [] and data["mix"] == [] and data["activity"] == []


def test_summary_is_school_scoped(librarian_client, other_book, other_issue, other_member):
    Hold.objects.create(school=other_book.school, book=other_book, member=other_member)
    data = librarian_client.get(SUMMARY).json()["data"]
    assert data["tiles"]["titles"] == 0 and data["tiles"]["active_loans"] == 0 and data["holds_waiting"] == 0
    assert data["attention"] == [] and data["mix"] == []


def test_summary_query_count_is_fixed_whatever_the_amount_of_data(librarian_client, school, category, django_assert_max_num_queries):
    small = make_book(school, category, title="Small", copies=2)
    librarian_client.get(SUMMARY)  # creates the settings row
    with django_assert_max_num_queries(14):
        librarian_client.get(SUMMARY)
    for n in range(40):
        member = make_member(school, f"QC-{n}", member_type="staff")
        book = make_book(school, category, title=f"Many {n}", copies=2)
        lend(school, book, member, (n % 5))
        Hold.objects.create(school=school, book=small, member=member)
    with django_assert_max_num_queries(14):
        data = librarian_client.get(SUMMARY).json()["data"]
    assert data["tiles"]["titles"] == 41 and len(data["attention"]) == 8 and len(data["holds"]) == 8 and len(data["activity"]) == 10


def test_summary_needs_the_console_code(school):
    assert client_for(make_user(school, ["library.console.view"])).get(SUMMARY).status_code == 200
    for code in ("library.books.view", "library.book_issues.view", "library.reports.view"):
        assert client_for(make_user(school, [code])).get(SUMMARY).status_code == 403


def test_a_superuser_sees_only_their_own_school(school, other_issue):
    from django.contrib.auth import get_user_model

    root = get_user_model().objects.create_superuser(username="root_console", password="x", school=school)
    assert client_for(root).get(SUMMARY).json()["data"]["tiles"]["active_loans"] == 0


def test_summary_requires_authentication(api_client):
    assert api_client.get(SUMMARY).status_code == 401
