"""Issue, bulk issue, return, renew, undo (blueprint section 9, Circulation and Money rows)."""
import threading
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.db import IntegrityError, connection, transaction
from django.utils import timezone

from apps.library.models import BookCopy, BookIssue, Charge, Hold, LibraryActivityLog
from apps.library.services import circulation, due_dates
from apps.library.services.settings import get_settings
from apps.library.tests.conftest import (
    LIBRARY_CODES,
    _student,
    client_for,
    make_book,
    make_member,
    make_user,
)

BASE = "/api/v1/library"
ISSUES = f"{BASE}/issues/"


def today():
    return timezone.localdate()


def ago(days):
    return today() - timedelta(days=days)


def issue(client, member, **target):
    return client.post(f"{ISSUES}issue/", {"member": member.pk, **target}, format="json")


def loan_of(response):
    return response.json()["data"]["loan"]


def make_overdue(loan_id, days):
    BookIssue.objects.filter(pk=loan_id).update(issue_date=ago(days + 14), due_date=ago(days))


def log_count(school, event=None):
    rows = LibraryActivityLog.objects.filter(school=school)
    return rows.filter(event_type=event).count() if event else rows.count()


@pytest.fixture
def staff_member(school):
    return make_member(school, "ST-1", member_type="staff")


@pytest.fixture
def class_six(school):
    from apps.core.models import Class

    return Class.objects.create(school=school, name="Grade 6")


def class_member(school, klass, card, first_name="Aarav", section=None):
    student = _student(school, f"A-{card}")
    student.first_name, student.current_class, student.current_section = first_name, klass, section
    student.save()
    return make_member(school, card, member_type="student", student=student)


@pytest.fixture
def pupil(school, class_six):
    return class_member(school, class_six, "PU-1")


# ---- issue ------------------------------------------------------------------------------------------------------


def test_issue_success_creates_the_loan_sets_the_copy_and_logs_once(librarian_client, librarian, school, book, staff_member):
    before = log_count(school)
    resp = issue(librarian_client, staff_member, book=book.pk)
    assert resp.status_code == 201
    loan = loan_of(resp)
    assert loan["status"] == "issued" and loan["state"] == "open" and loan["copy_code"] == f"{book.accession_code}/C1"
    assert loan["issue_date"] == today().isoformat() and loan["due_date"] == (today() + timedelta(days=14)).isoformat()
    assert resp.json()["data"]["due"]["snapped"] is False
    row = BookIssue.objects.get(pk=loan["id"])
    assert row.issued_by_id == librarian.pk and row.created_by_id == librarian.pk and row.copy.status == "issued"
    assert book.copies.filter(status="available").count() == 1
    assert log_count(school) - before == 1 and log_count(school, "issue") == 1


def test_issue_a_named_copy_by_id(librarian_client, book, staff_member):
    second = book.copies.order_by("id").last()
    loan = loan_of(issue(librarian_client, staff_member, copy=second.pk))
    assert loan["copy"] == second.pk


def test_flat_period_comes_from_the_settings(librarian_client, school, book, staff_member):
    settings = get_settings(school)
    settings.flat_loan_days = 21
    settings.save()
    assert loan_of(issue(librarian_client, staff_member, book=book.pk))["due_date"] == (today() + timedelta(days=21)).isoformat()


def test_client_cannot_choose_dates_or_status(librarian_client, book, staff_member):
    body = {"member": staff_member.pk, "book": book.pk, "issue_date": "2000-01-01", "due_date": "2000-01-02", "status": "returned", "fine_amount": "9"}
    loan = loan_of(librarian_client.post(f"{ISSUES}issue/", body, format="json"))
    assert loan["issue_date"] == today().isoformat() and loan["status"] == "issued" and loan["fine_amount"] == "0.00"


def test_reference_only_is_refused(librarian_client, school, category, staff_member):
    ref = make_book(school, category, title="Atlas", is_reference_only=True)
    resp = issue(librarian_client, staff_member, book=ref.pk)
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "library_reference_only"
    assert not BookIssue.objects.exists() and ref.copies.filter(status="available").count() == 2


@pytest.mark.parametrize(
    "member_type,flags",
    [("teacher", dict(for_students=True, for_teachers=False, for_staff=False)), ("staff", dict(for_students=True, for_teachers=True, for_staff=False))],
)
def test_audience_mismatch_is_refused(librarian_client, school, category, member_type, flags):
    closed = make_book(school, category, title="Kids only", **flags)
    member = make_member(school, "AU-1", member_type=member_type)
    resp = issue(librarian_client, member, book=closed.pk)
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "library_not_eligible_audience"
    assert not BookIssue.objects.exists()


def test_student_is_refused_a_teachers_only_title(librarian_client, school, category, pupil):
    book = make_book(school, category, title="Staff room", for_students=False, for_teachers=True, for_staff=True)
    assert issue(librarian_client, pupil, book=book.pk).json()["error"]["code"] == "library_not_eligible_audience"


def test_suspended_member_is_refused_with_the_amount_owed(librarian_client, school, book, staff_member):
    Charge.objects.create(school=school, member=staff_member, charge_type="replacement", amount=Decimal("250"), assessed_on=ago(1))
    resp = issue(librarian_client, staff_member, book=book.pk)
    assert resp.status_code == 409
    error = resp.json()["error"]
    assert error["code"] == "library_member_suspended" and error["amount_due"] == "250.00"
    assert not BookIssue.objects.exists()


def test_overdue_loan_fine_suspends_the_next_issue(librarian_client, school, category, book, staff_member):
    first = loan_of(issue(librarian_client, staff_member, book=book.pk))
    make_overdue(first["id"], 3)
    other = make_book(school, category, title="Another")
    resp = issue(librarian_client, staff_member, book=other.pk)
    assert resp.status_code == 409 and resp.json()["error"]["amount_due"] == "30.00"


def test_unpaid_registration_alone_does_not_block_issue(librarian_client, school, book, staff_member):
    Charge.objects.create(school=school, member=staff_member, charge_type="registration", amount=Decimal("500"), assessed_on=ago(1))
    assert issue(librarian_client, staff_member, book=book.pk).status_code == 201


def test_borrowing_limit_is_refused_by_member_type(librarian_client, school, category, pupil):
    books = [make_book(school, category, title=f"T{n}") for n in range(3)]
    assert issue(librarian_client, pupil, book=books[0].pk).status_code == 201
    assert issue(librarian_client, pupil, book=books[1].pk).status_code == 201
    resp = issue(librarian_client, pupil, book=books[2].pk)
    assert resp.status_code == 409
    error = resp.json()["error"]
    assert error["code"] == "library_limit_reached" and error["limit"] == 2 and error["active_loans"] == 2
    assert BookIssue.objects.count() == 2


def test_limit_follows_the_settings(librarian_client, school, category, staff_member):
    settings = get_settings(school)
    settings.limit_staff = 1
    settings.save()
    books = [make_book(school, category, title=f"L{n}") for n in range(2)]
    assert issue(librarian_client, staff_member, book=books[0].pk).status_code == 201
    assert issue(librarian_client, staff_member, book=books[1].pk).json()["error"]["code"] == "library_limit_reached"


def test_no_available_copy_is_a_409_and_changes_nothing(librarian_client, book, staff_member):
    book.copies.update(status="issued")
    resp = issue(librarian_client, staff_member, book=book.pk)
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_copy_unavailable"
    one = book.copies.first()
    assert issue(librarian_client, staff_member, copy=one.pk).json()["error"]["code"] == "library_copy_unavailable"
    assert not BookIssue.objects.exists()


@pytest.mark.parametrize("status", ["lost", "damaged", "withdrawn"])
def test_a_copy_that_is_not_on_the_shelf_cannot_be_issued(librarian_client, book, staff_member, status):
    copy = book.copies.first()
    BookCopy.objects.filter(pk=copy.pk).update(status=status)
    assert issue(librarian_client, staff_member, copy=copy.pk).status_code == 409
    # by title it skips that copy and uses the other one
    assert issue(librarian_client, staff_member, book=book.pk).status_code == 201


def test_inactive_member_cannot_borrow(librarian_client, book, staff_member):
    staff_member.is_active = False
    staff_member.save()
    resp = issue(librarian_client, staff_member, book=book.pk)
    assert resp.status_code == 409 and not BookIssue.objects.exists()


def test_exactly_one_of_copy_or_book_is_required(librarian_client, book, staff_member):
    assert issue(librarian_client, staff_member).status_code == 400
    assert issue(librarian_client, staff_member, book=book.pk, copy=book.copies.first().pk).status_code == 400


def test_cross_school_ids_are_invalid_choices(librarian_client, other_book, other_member, book, staff_member):
    foreign_copy = other_book.copies.first()
    assert "member" in issue(librarian_client, other_member, book=book.pk).json()["field_errors"]
    assert "copy" in issue(librarian_client, staff_member, copy=foreign_copy.pk).json()["field_errors"]
    assert "book" in issue(librarian_client, staff_member, book=other_book.pk).json()["field_errors"]
    foreign_copy.refresh_from_db()
    assert foreign_copy.status == "available" and not BookIssue.objects.exists()


def test_issue_fulfils_the_members_own_waiting_hold(librarian_client, school, book, staff_member):
    other = make_member(school, "ST-2", member_type="staff")
    Hold.objects.create(school=school, book=book, member=staff_member)
    Hold.objects.create(school=school, book=book, member=other)
    loan = loan_of(issue(librarian_client, staff_member, book=book.pk))
    mine = Hold.objects.get(member=staff_member)
    assert mine.status == "fulfilled" and mine.fulfilled_issue_id == loan["id"]
    assert Hold.objects.get(member=other).status == "waiting"


def test_database_blocks_a_second_open_loan_on_one_copy(school, book, staff_member):
    copy = book.copies.first()
    other = make_member(school, "ST-9", member_type="staff")
    BookIssue.objects.create(school=school, book=book, copy=copy, member=staff_member, issue_date=ago(1), due_date=today())
    with pytest.raises(IntegrityError), transaction.atomic():
        BookIssue.objects.create(school=school, book=book, copy=copy, member=other, issue_date=ago(1), due_date=today())
    # a closed loan on the same copy is fine
    BookIssue.objects.create(school=school, book=book, copy=copy, member=other, issue_date=ago(9), due_date=ago(5), status="returned")


def test_database_rejects_impossible_loan_dates(school, book, staff_member):
    with pytest.raises(IntegrityError), transaction.atomic():
        BookIssue.objects.create(school=school, book=book, member=staff_member, issue_date=today(), due_date=ago(1))
    with pytest.raises(IntegrityError), transaction.atomic():
        BookIssue.objects.create(school=school, book=book, member=staff_member, issue_date=today(), due_date=today(), status="returned", return_date=ago(1))


def test_database_allows_one_fine_charge_per_loan(school, book, staff_member):
    loan = BookIssue.objects.create(school=school, book=book, member=staff_member, issue_date=ago(9), due_date=ago(5))
    Charge.objects.create(school=school, member=staff_member, charge_type="overdue_fine", amount=1, issue=loan, assessed_on=today())
    with pytest.raises(IntegrityError), transaction.atomic():
        Charge.objects.create(school=school, member=staff_member, charge_type="overdue_fine", amount=1, issue=loan, assessed_on=today())


@pytest.mark.skipif(connection.vendor != "postgresql", reason="needs real row locks (PostgreSQL)")
@pytest.mark.django_db(transaction=True)
def test_last_copy_race_gives_one_success_and_one_conflict(school, category):
    """Unverified on SQLite: two desks issue the last copy at once; exactly one loan may exist."""
    from django.db import connections

    from apps.library.exceptions import LibraryCopyUnavailable

    book = make_book(school, category, title="Last", copies=1)
    members = [make_member(school, f"RC-{n}", member_type="staff") for n in range(2)]
    outcomes = []

    def worker(member):
        try:
            circulation.issue_copy(school, None, member_id=member.pk, book_id=book.pk)
            outcomes.append("ok")
        except LibraryCopyUnavailable:
            outcomes.append("conflict")
        finally:
            connections.close_all()

    threads = [threading.Thread(target=worker, args=(m,)) for m in members]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(outcomes) == ["conflict", "ok"]
    assert BookIssue.objects.filter(book=book, status="issued").count() == 1


# ---- due dates ----------------------------------------------------------------------------------------------------


def test_next_slot_date_picks_the_first_matching_weekday():
    wednesday = 2
    assert due_dates.next_slot_date(date(2026, 3, 9), {wednesday}) == date(2026, 3, 11)  # Monday to Wednesday
    assert due_dates.next_slot_date(date(2026, 3, 11), {wednesday}) == date(2026, 3, 11)  # already that day
    assert due_dates.next_slot_date(date(2026, 3, 12), {wednesday}) == date(2026, 3, 18)  # just missed it
    assert due_dates.next_slot_date(date(2026, 3, 9), {0, 4}) == date(2026, 3, 9)
    assert due_dates.next_slot_date(date(2026, 3, 9), set()) is None


def test_no_slot_model_or_rows_means_no_slots(school, class_six):
    assert due_dates.class_slot_weekdays(school, class_six.pk) == set()
    assert due_dates.class_slot_weekdays(school, None) == set()


def test_students_without_a_library_slot_get_the_flat_period(librarian_client, book, pupil):
    resp = issue(librarian_client, pupil, book=book.pk)
    assert resp.json()["data"]["due"]["snapped"] is False
    assert loan_of(resp)["due_date"] == (today() + timedelta(days=14)).isoformat()


@pytest.mark.parametrize("weekday", [0, 1, 2, 3, 4, 5])
def test_students_snap_to_the_class_slot_at_least_the_minimum_days_away(librarian_client, book, pupil, monkeypatch, weekday):
    monkeypatch.setattr(due_dates, "class_slot_weekdays", lambda school, class_id, section_id=None: {weekday})
    resp = issue(librarian_client, pupil, book=book.pk)
    due = date.fromisoformat(loan_of(resp)["due_date"])
    assert resp.json()["data"]["due"]["snapped"] is True
    assert due.weekday() == weekday
    assert today() + timedelta(days=10) <= due < today() + timedelta(days=17)


def test_teachers_and_staff_ignore_class_slots(librarian_client, book, staff_member, monkeypatch):
    monkeypatch.setattr(due_dates, "class_slot_weekdays", lambda *a, **k: {0})
    assert loan_of(issue(librarian_client, staff_member, book=book.pk))["due_date"] == (today() + timedelta(days=14)).isoformat()


def test_minimum_days_setting_moves_the_snap(librarian_client, school, book, pupil, monkeypatch):
    monkeypatch.setattr(due_dates, "class_slot_weekdays", lambda *a, **k: {0, 1, 2, 3, 4, 5})
    settings = get_settings(school)
    settings.student_min_due_days = 3
    settings.save()
    due = date.fromisoformat(loan_of(issue(librarian_client, pupil, book=book.pk))["due_date"])
    assert due - today() in (timedelta(days=3), timedelta(days=4))  # Sunday is not a slot day


# ---- renew --------------------------------------------------------------------------------------------------------


def open_loan(client, member, book):
    return loan_of(issue(client, member, book=book.pk))


def renew(client, loan):
    return client.post(f"{ISSUES}{loan['id']}/renew/")


def test_renew_recomputes_the_due_date_and_counts(librarian_client, school, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    BookIssue.objects.filter(pk=loan["id"]).update(due_date=today() + timedelta(days=2))
    before = log_count(school)
    resp = renew(librarian_client, loan)
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["loan"]["renew_count"] == 1 and data["loan"]["renewed"] is True
    assert data["loan"]["due_date"] == (today() + timedelta(days=14)).isoformat()
    assert BookIssue.objects.get(pk=loan["id"]).last_renewed_on == today()
    assert log_count(school) - before == 1 and log_count(school, "renewal") == 1


def test_renew_stops_at_the_cap(librarian_client, school, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    assert renew(librarian_client, loan).status_code == 200
    assert renew(librarian_client, loan).status_code == 200
    third = renew(librarian_client, loan)
    assert third.status_code == 409 and third.json()["error"]["code"] == "library_renewal_cap"
    assert BookIssue.objects.get(pk=loan["id"]).renew_count == 2


def test_renew_cap_follows_the_settings(librarian_client, school, book, staff_member):
    settings = get_settings(school)
    settings.max_renewals = 0
    settings.save()
    assert renew(librarian_client, open_loan(librarian_client, staff_member, book)).json()["error"]["code"] == "library_renewal_cap"


def test_a_waiting_hold_blocks_renewal(librarian_client, school, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    waiting = make_member(school, "ST-W", member_type="staff")
    Hold.objects.create(school=school, book=book, member=waiting)
    resp = renew(librarian_client, loan)
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_hold_exists"
    Hold.objects.update(status="cancelled")
    assert renew(librarian_client, loan).status_code == 200


def test_an_overdue_loan_cannot_be_renewed(librarian_client, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    make_overdue(loan["id"], 1)
    resp = renew(librarian_client, loan)
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_loan_overdue"
    assert BookIssue.objects.get(pk=loan["id"]).renew_count == 0


def test_a_loan_due_today_can_still_be_renewed(librarian_client, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    BookIssue.objects.filter(pk=loan["id"]).update(due_date=today())
    assert renew(librarian_client, loan).status_code == 200


def test_renewing_a_closed_loan_is_a_409(librarian_client, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    librarian_client.post(f"{ISSUES}{loan['id']}/return/")
    resp = renew(librarian_client, loan)
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_already_returned"


# ---- return -------------------------------------------------------------------------------------------------------


def give_back(client, loan, **body):
    return client.post(f"{ISSUES}{loan['id']}/return/", body, format="json")


def test_return_on_time_releases_the_copy_without_a_fine(librarian_client, librarian, school, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    before = log_count(school)
    resp = give_back(librarian_client, loan)
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["loan"]["status"] == "returned" and data["loan"]["state"] == "returned" and data["loan"]["return_date"] == today().isoformat()
    assert data["charge"] is None and data["report"] is None and data["hold_queue_count"] == 0
    row = BookIssue.objects.get(pk=loan["id"])
    assert row.returned_by_id == librarian.pk and row.returned_at and row.copy.status == "available" and row.fine_amount == 0
    assert log_count(school) - before == 1 and log_count(school, "return") == 1


def test_overdue_return_needs_a_choice_and_changes_nothing_without_it(librarian_client, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    make_overdue(loan["id"], 3)
    resp = give_back(librarian_client, loan)
    assert resp.status_code == 400 and "fine_action" in resp.json()["field_errors"]
    assert BookIssue.objects.get(pk=loan["id"]).status == "issued" and not Charge.objects.exists()
    assert BookIssue.objects.get(pk=loan["id"]).copy.status == "issued"


def test_overdue_return_with_collect_records_a_paid_fine(librarian_client, librarian, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    make_overdue(loan["id"], 3)
    resp = give_back(librarian_client, loan, fine_action="collect")
    assert resp.status_code == 200
    charge = resp.json()["data"]["charge"]
    assert charge["amount"] == "30.00" and charge["status"] == "paid" and charge["charge_type"] == "overdue_fine"
    assert charge["receipt_no"].startswith("LIBR-") and charge["resolved_by"] == librarian.pk
    assert resp.json()["data"]["loan"]["fine_amount"] == "30.00"
    assert Charge.objects.get(pk=charge["id"]).issue_id == loan["id"]


def test_fine_boundaries_through_the_api(librarian_client, school, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    BookIssue.objects.filter(pk=loan["id"]).update(issue_date=ago(20), due_date=today())  # due today: nothing to pay
    assert give_back(librarian_client, loan).json()["data"]["charge"] is None


def test_fine_respects_grace_cap_and_replacement_cap(librarian_client, school, category, staff_member):
    settings = get_settings(school)
    settings.fine_grace_days, settings.fine_cap = 2, Decimal("45")
    settings.save()
    b = make_book(school, category, title="Capped", copies=3, cost_per_copy=Decimal("100"))
    loan = open_loan(librarian_client, staff_member, b)
    make_overdue(loan["id"], 5)  # (5 - 2) x 10 = 30
    assert give_back(librarian_client, loan, fine_action="collect").json()["data"]["charge"]["amount"] == "30.00"
    other = make_member(school, "ST-C", member_type="staff")
    loan = open_loan(librarian_client, other, b)
    make_overdue(loan["id"], 60)  # 580 -> cap 45
    assert give_back(librarian_client, loan, fine_action="collect").json()["data"]["charge"]["amount"] == "45.00"
    settings.fine_cap = None
    settings.save()
    third = make_member(school, "ST-D", member_type="staff")
    loan = open_loan(librarian_client, third, b)
    make_overdue(loan["id"], 60)  # replacement cost 150 caps it
    assert give_back(librarian_client, loan, fine_action="collect").json()["data"]["charge"]["amount"] == "150.00"


def test_waiving_needs_the_waive_code_and_a_reason(school, category, staff_member):
    book = make_book(school, category, title="W")
    desk = client_for(make_user(school, ["library.book_issues.issue", "library.book_issues.return", "library.book_issues.view"]))
    boss = client_for(make_user(school, ["library.book_issues.return", "library.book_issues.view", "library.book_issues.waive_fine"]))
    loan = open_loan(desk, staff_member, book)
    make_overdue(loan["id"], 4)
    resp = give_back(desk, loan, fine_action="waive", waive_reason="Parent request")
    assert resp.status_code == 403 and BookIssue.objects.get(pk=loan["id"]).status == "issued"
    no_reason = give_back(boss, loan, fine_action="waive")
    assert no_reason.status_code == 400 and "waive_reason" in no_reason.json()["field_errors"]
    ok = give_back(boss, loan, fine_action="waive", waive_reason="  Parent request ")
    assert ok.status_code == 200
    charge = ok.json()["data"]["charge"]
    assert charge["status"] == "waived" and charge["amount"] == "40.00" and charge["resolution_note"] == "Parent request"
    assert charge["receipt_no"] == ""


def test_school_admin_may_waive(admin_user, school, category, staff_member):
    admin = client_for(admin_user)
    loan = open_loan(admin, staff_member, make_book(school, category, title="Adm"))
    make_overdue(loan["id"], 2)
    assert give_back(admin, loan, fine_action="waive", waive_reason="ok").status_code == 200


def test_returning_twice_is_a_409_with_the_current_state(librarian_client, school, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    assert give_back(librarian_client, loan).status_code == 200
    before = log_count(school)
    again = give_back(librarian_client, loan)
    assert again.status_code == 409
    error = again.json()["error"]
    assert error["code"] == "library_already_returned" and error["status"] == "returned" and error["return_date"] == today().isoformat()
    assert book.copies.filter(status="available").count() == 2 and log_count(school) == before


def test_return_with_a_damage_report_bills_the_replacement(librarian_client, school, category, staff_member):
    b = make_book(school, category, title="Torn", copies=2, cost_per_copy=Decimal("100"))
    loan = open_loan(librarian_client, staff_member, b)
    resp = give_back(librarian_client, loan, report={"type": "damaged", "notes": "Water damage"}, condition="good")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["loan"]["status"] == "returned"
    assert data["report"]["report_type"] == "damaged" and data["report"]["source"] == "desk_return" and data["report"]["fee_status"] in ("charged", "none")
    assert data["replacement_charge"]["amount"] == "150.00" and data["replacement_charge"]["status"] == "pending"
    copy = BookIssue.objects.get(pk=loan["id"]).copy
    assert copy.status == "damaged" and copy.condition == "damaged"
    assert log_count(school, "damaged") == 1 and log_count(school, "return") == 0


def test_return_with_a_lost_report_closes_the_loan_as_lost_without_a_fine(librarian_client, school, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    make_overdue(loan["id"], 5)
    resp = give_back(librarian_client, loan, report={"type": "lost", "notes": "Left on a bus"})
    data = resp.json()["data"]
    assert data["loan"]["status"] == "lost" and data["charge"] is None
    assert data["replacement_charge"]["amount"] == "150.00"  # default cost, copy cost is 0
    assert BookIssue.objects.get(pk=loan["id"]).copy.status == "lost"
    assert log_count(school, "lost") == 1
    # the member is now suspended until the replacement fee is settled
    assert issue(librarian_client, staff_member, book=book.pk).json()["error"]["code"] == "library_member_suspended"


def test_replacement_cost_uses_the_settings(librarian_client, school, category, staff_member):
    settings = get_settings(school)
    settings.replacement_processing_fee, settings.replacement_default_cost = Decimal("25"), Decimal("80")
    settings.save()
    priced = make_book(school, category, title="Priced", cost_per_copy=Decimal("200"))
    free = make_book(school, category, title="Free")
    first = open_loan(librarian_client, staff_member, priced)
    other = make_member(school, "ST-P", member_type="staff")
    second = open_loan(librarian_client, other, free)
    assert give_back(librarian_client, first, report={"type": "lost"}).json()["data"]["replacement_charge"]["amount"] == "225.00"
    assert give_back(librarian_client, second, report={"type": "lost"}).json()["data"]["replacement_charge"]["amount"] == "80.00"


def test_return_sets_the_condition_and_ignores_a_client_fine_and_date(librarian_client, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    make_overdue(loan["id"], 2)
    resp = give_back(librarian_client, loan, fine_action="collect", condition="worn", fine_amount="999.00", return_date="1999-01-01", due_date="2030-01-01")
    data = resp.json()["data"]
    assert data["charge"]["amount"] == "20.00" and data["loan"]["return_date"] == today().isoformat() and data["loan"]["fine_amount"] == "20.00"
    assert BookIssue.objects.get(pk=loan["id"]).copy.condition == "worn"


def test_bad_return_input_is_refused_before_anything_changes(librarian_client, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    for body in ({"condition": "ruined"}, {"report": {"type": "stolen"}}, {"fine_action": "forgive"}):
        assert give_back(librarian_client, loan, **body).status_code == 400
    assert BookIssue.objects.get(pk=loan["id"]).status == "issued"


def test_return_reports_the_hold_queue_without_notifying(librarian_client, school, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    for n in range(2):
        Hold.objects.create(school=school, book=book, member=make_member(school, f"HQ-{n}", member_type="staff"))
    assert give_back(librarian_client, loan).json()["data"]["hold_queue_count"] == 2


def test_returning_pays_down_suspension_only_when_the_fee_is_settled(librarian_client, school, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    make_overdue(loan["id"], 3)
    give_back(librarian_client, loan, fine_action="collect")
    assert issue(librarian_client, staff_member, book=book.pk).status_code == 201  # paid fine: not suspended


# ---- undo ----------------------------------------------------------------------------------------------------------


def undo(client, loan):
    return client.post(f"{ISSUES}{loan['id']}/undo-return/")


def test_undo_inside_the_window_by_the_same_user_restores_everything(librarian_client, school, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    make_overdue(loan["id"], 3)
    give_back(librarian_client, loan, fine_action="collect")
    before = log_count(school)
    resp = undo(librarian_client, loan)
    assert resp.status_code == 200
    data = resp.json()["data"]["loan"]
    assert data["status"] == "issued" and data["return_date"] is None and data["fine_amount"] == "0.00"
    row = BookIssue.objects.get(pk=loan["id"])
    assert row.copy.status == "issued" and row.returned_by_id is None and row.returned_at is None
    assert not Charge.objects.filter(issue=row, charge_type="overdue_fine").exists()
    assert log_count(school) - before == 1
    # the loan can be returned again, and the fine is assessed afresh
    assert give_back(librarian_client, loan, fine_action="collect").json()["data"]["charge"]["amount"] == "30.00"


def test_undo_is_refused_for_another_user(librarian_client, school, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    give_back(librarian_client, loan)
    colleague = client_for(make_user(school, LIBRARY_CODES))
    resp = undo(colleague, loan)
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_undo_expired"
    assert BookIssue.objects.get(pk=loan["id"]).status == "returned"


def test_undo_is_refused_after_the_window(librarian_client, school, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    give_back(librarian_client, loan)
    BookIssue.objects.filter(pk=loan["id"]).update(returned_at=timezone.now() - timedelta(minutes=11))
    assert undo(librarian_client, loan).json()["error"]["code"] == "library_undo_expired"
    settings = get_settings(school)
    settings.undo_return_minutes = 30
    settings.save()
    assert undo(librarian_client, loan).status_code == 200


def test_undo_is_refused_once_the_copy_was_issued_again(librarian_client, school, book, staff_member):
    loan = open_loan(librarian_client, staff_member, book)
    copy = BookIssue.objects.get(pk=loan["id"]).copy
    give_back(librarian_client, loan)
    other = make_member(school, "ST-R", member_type="staff")
    assert issue(librarian_client, other, copy=copy.pk).status_code == 201
    resp = undo(librarian_client, loan)
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_undo_expired"
    assert BookIssue.objects.filter(copy=copy, status="issued").count() == 1


def test_undo_is_refused_when_nothing_was_returned_or_a_report_was_filed(librarian_client, book, staff_member):
    open_one = open_loan(librarian_client, staff_member, book)
    assert undo(librarian_client, open_one).status_code == 409
    give_back(librarian_client, open_one, report={"type": "damaged"})
    assert undo(librarian_client, open_one).json()["error"]["code"] == "library_undo_expired"  # copy is damaged, not available


# ---- bulk issue ------------------------------------------------------------------------------------------------------


def bulk(client, book, klass, **extra):
    return client.post(f"{ISSUES}bulk-issue/", {"book": book.pk, "school_class": klass.pk, **extra}, format="json")


def test_bulk_issue_applies_the_rules_to_each_member_and_stops_when_copies_run_out(librarian_client, school, category, class_six):
    book = make_book(school, category, title="Class set", copies=2)
    ann = class_member(school, class_six, "B-1", "Ann")
    bob = class_member(school, class_six, "B-2", "Bob")
    cat = class_member(school, class_six, "B-3", "Cat")
    dan = class_member(school, class_six, "B-4", "Dan")
    eve = class_member(school, class_six, "B-5", "Eve")
    Charge.objects.create(school=school, member=bob, charge_type="replacement", amount=Decimal("90"), assessed_on=ago(1))
    BookIssue.objects.create(school=school, book=book, copy=book.copies.first(), member=dan, issue_date=ago(1), due_date=today())
    book.copies.filter(pk=book.copies.first().pk).update(status="issued")
    book.copies.exclude(status="issued").update(status="available")
    make_book(school, category, title="Filler")
    resp = bulk(librarian_client, book, class_six)
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert [r["member"] for r in data["issued"]] == [ann.pk]
    reasons = {s["member"]: s["reason"] for s in data["skipped"]}
    assert reasons == {bob.pk: "suspended", cat.pk: "no_copy_left", dan.pk: "already_holding", eve.pk: "no_copy_left"}
    assert BookIssue.objects.filter(book=book, status="issued").count() == 2


def test_bulk_issue_writes_one_log_row_per_loan(librarian_client, school, category, class_six):
    book = make_book(school, category, title="Set", copies=3)
    for n in range(3):
        class_member(school, class_six, f"L-{n}", f"S{n}")
    before = log_count(school, "issue")
    assert len(bulk(librarian_client, book, class_six).json()["data"]["issued"]) == 3
    assert log_count(school, "issue") - before == 3


def test_bulk_issue_respects_limits_and_audience(librarian_client, school, category, class_six):
    closed = make_book(school, category, title="Adults", for_students=False, for_teachers=True, for_staff=True, copies=3)
    member = class_member(school, class_six, "BL-1")
    data = bulk(librarian_client, closed, class_six).json()["data"]
    assert data["issued"] == [] and data["skipped"] == [{"member": member.pk, "reason": "not_eligible_audience"}]
    ref = make_book(school, category, title="Atlas", is_reference_only=True)
    assert bulk(librarian_client, ref, class_six).json()["data"]["skipped"][0]["reason"] == "reference_only"
    filler, target = make_book(school, category, title="Filler", copies=3), make_book(school, category, title="Target", copies=3)
    for n in range(2):
        BookIssue.objects.create(school=school, book=filler, member=member, issue_date=ago(1), due_date=today())
    assert bulk(librarian_client, target, class_six).json()["data"]["skipped"][0]["reason"] == "limit_reached"


def test_bulk_issue_to_chosen_members_and_section(librarian_client, school, category, class_six):
    from apps.core.models import Section

    a, b = Section.objects.create(school_class=class_six, name="A", capacity=40), Section.objects.create(school_class=class_six, name="B", capacity=40)
    in_a, in_b = class_member(school, class_six, "S-A", "Ann", section=a), class_member(school, class_six, "S-B", "Bea", section=b)
    book = make_book(school, category, title="Pick", copies=5)
    assert [r["member"] for r in bulk(librarian_client, book, class_six, section=a.pk).json()["data"]["issued"]] == [in_a.pk]
    assert [r["member"] for r in bulk(librarian_client, book, class_six, member_ids=[in_b.pk]).json()["data"]["issued"]] == [in_b.pk]


def test_bulk_issue_rejects_members_outside_the_class_and_other_schools(librarian_client, school, category, class_six, other_member, other_school, other_category):
    from apps.core.models import Class, Section

    elsewhere = Class.objects.create(school=school, name="Grade 7")
    stray = class_member(school, elsewhere, "ST-X")
    book = make_book(school, category, title="Guard", copies=2)
    assert "member_ids" in bulk(librarian_client, book, class_six, member_ids=[stray.pk]).json()["field_errors"]
    assert "member_ids" in bulk(librarian_client, book, class_six, member_ids=[other_member.pk]).json()["field_errors"]
    foreign_class = Class.objects.create(school=other_school, name="Grade 6")
    assert "school_class" in bulk(librarian_client, book, foreign_class).json()["field_errors"]
    foreign_section = Section.objects.create(school_class=foreign_class, name="A", capacity=5)
    assert "section" in bulk(librarian_client, book, class_six, section=foreign_section.pk).json()["field_errors"]
    other_section = Section.objects.create(school_class=elsewhere, name="Z", capacity=5)
    assert "section" in bulk(librarian_client, book, class_six, section=other_section.pk).json()["field_errors"]
    foreign_book = make_book(other_school, other_category, title="Theirs")
    assert "book" in bulk(librarian_client, foreign_book, class_six).json()["field_errors"]
    assert not BookIssue.objects.exists()


def test_bulk_issue_with_no_one_to_issue_is_a_plain_200(librarian_client, school, category, class_six):
    book = make_book(school, category, title="Empty roster")
    resp = bulk(librarian_client, book, class_six)
    assert resp.status_code == 200 and resp.json()["data"] == {"issued": [], "skipped": []}
