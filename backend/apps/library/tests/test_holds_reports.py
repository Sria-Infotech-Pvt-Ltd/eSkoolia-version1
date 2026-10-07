"""Holds, lost and damaged reports, the replacement ledger and charge transitions."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.library.models import (
    BookCopy,
    BookIssue,
    Charge,
    Hold,
    LibraryActivityLog,
    LostDamagedReport,
)
from apps.library.services.settings import get_settings
from apps.library.tests.conftest import client_for, make_book, make_member, make_user

BASE = "/api/v1/library"
HOLDS = f"{BASE}/holds/"
REPORTS = f"{BASE}/lost-damaged/"


def today():
    return timezone.localdate()


def ago(days):
    return today() - timedelta(days=days)


def log_count(school, event):
    return LibraryActivityLog.objects.filter(school=school, event_type=event).count()


@pytest.fixture
def staff_member(school):
    return make_member(school, "ST-1", member_type="staff")


@pytest.fixture
def other_staff(school):
    return make_member(school, "ST-2", member_type="staff")


def place(client, book, member):
    return client.post(HOLDS, {"book": book.pk, "member": member.pk}, format="json")


def report(client, copy, **extra):
    return client.post(REPORTS, {"copy": copy.pk, "report_type": "lost", **extra}, format="json")


# ---- holds -------------------------------------------------------------------------------------------------------------


def test_place_a_hold_logs_once_and_lists_in_queue_order(librarian_client, school, book, staff_member, other_staff):
    first = place(librarian_client, book, staff_member)
    assert first.status_code == 201
    data = first.json()["data"]
    assert data["status"] == "waiting" and data["book_title"] == "Treasure Island" and data["card_no"] == "ST-1"
    place(librarian_client, book, other_staff)
    assert log_count(school, "hold") == 2
    rows = librarian_client.get(HOLDS).json()["results"]
    assert [r["card_no"] for r in rows] == ["ST-1", "ST-2"]  # first come, first served
    assert LibraryActivityLog.objects.filter(school=school, event_type="hold").first().metadata["position"] in (1, 2)


def test_second_hold_by_the_same_member_is_refused(librarian_client, book, staff_member):
    place(librarian_client, book, staff_member)
    resp = place(librarian_client, book, staff_member)
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_hold_exists"
    assert Hold.objects.count() == 1


def test_a_member_cannot_hold_a_title_they_have_out(librarian_client, school, book, staff_member):
    BookIssue.objects.create(school=school, book=book, copy=book.copies.first(), member=staff_member, issue_date=ago(1), due_date=today())
    resp = place(librarian_client, book, staff_member)
    assert resp.status_code == 409 and not Hold.objects.exists()


def test_reference_only_and_inactive_cases_cannot_be_held(librarian_client, school, category, staff_member):
    ref = make_book(school, category, title="Atlas", is_reference_only=True)
    assert place(librarian_client, ref, staff_member).json()["error"]["code"] == "library_reference_only"
    staff_member.is_active = False
    staff_member.save()
    assert place(librarian_client, make_book(school, category, title="Open"), staff_member).status_code == 409


def test_cancel_a_hold_only_while_waiting(librarian_client, school, book, staff_member):
    hold_id = place(librarian_client, book, staff_member).json()["data"]["id"]
    resp = librarian_client.post(f"{HOLDS}{hold_id}/cancel/")
    assert resp.status_code == 200 and resp.json()["data"]["status"] == "cancelled"
    again = librarian_client.post(f"{HOLDS}{hold_id}/cancel/")
    assert again.status_code == 409 and again.json()["error"]["code"] == "library_invalid_state_transition"
    assert log_count(school, "hold") == 2
    # a cancelled hold frees the slot for a new one
    assert place(librarian_client, book, staff_member).status_code == 201


def test_a_fulfilled_hold_cannot_be_cancelled(librarian_client, school, book, staff_member):
    place(librarian_client, book, staff_member)
    librarian_client.post(f"{BASE}/issues/issue/", {"member": staff_member.pk, "book": book.pk}, format="json")
    hold = Hold.objects.get()
    assert hold.status == "fulfilled"
    assert librarian_client.post(f"{HOLDS}{hold.pk}/cancel/").status_code == 409


def test_hold_filters(librarian_client, school, category, book, staff_member, other_staff):
    other_book = make_book(school, category, title="Second")
    place(librarian_client, book, staff_member)
    place(librarian_client, other_book, other_staff)
    cancelled = place(librarian_client, book, other_staff).json()["data"]["id"]
    librarian_client.post(f"{HOLDS}{cancelled}/cancel/")
    assert librarian_client.get(f"{HOLDS}?book={other_book.pk}").json()["count"] == 1
    assert librarian_client.get(f"{HOLDS}?member={other_staff.pk}").json()["count"] == 2
    assert librarian_client.get(f"{HOLDS}?status=cancelled").json()["count"] == 1


def test_hold_inputs_must_belong_to_the_school(librarian_client, book, staff_member, other_book, other_member):
    resp = librarian_client.post(HOLDS, {"book": other_book.pk, "member": other_member.pk}, format="json")
    assert resp.status_code == 400 and {"book", "member"} <= set(resp.json()["field_errors"])
    assert "member" in place(librarian_client, book, other_member).json()["field_errors"]
    assert not Hold.objects.exists()


def test_holds_cannot_be_edited_or_deleted_through_generic_verbs(librarian_client, book, staff_member):
    hold_id = place(librarian_client, book, staff_member).json()["data"]["id"]
    assert librarian_client.patch(f"{HOLDS}{hold_id}/", {"status": "fulfilled"}, format="json").status_code == 405
    assert librarian_client.put(f"{HOLDS}{hold_id}/", {}, format="json").status_code == 405
    assert librarian_client.delete(f"{HOLDS}{hold_id}/").status_code == 405


# ---- reports -----------------------------------------------------------------------------------------------------------


def test_report_marks_the_copy_and_bills_the_member(librarian_client, librarian, school, category, staff_member):
    book = make_book(school, category, title="Costly", copies=2, cost_per_copy=Decimal("100"))
    copy = book.copies.first()
    resp = report(librarian_client, copy, member=staff_member.pk, notes="Missing since June")
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert data["report_type"] == "lost" and data["replacement_cost"] == "150.00" and data["fee_status"] == "charged"
    assert data["resolution"] == "pending" and data["source"] == "manual" and data["reported_by"] == librarian.pk
    copy.refresh_from_db()
    assert copy.status == "lost"
    charge = Charge.objects.get(report_id=data["id"])
    assert charge.charge_type == "replacement" and charge.amount == Decimal("150.00") and charge.status == "pending" and charge.member_id == staff_member.pk
    assert log_count(school, "lost") == 1


def test_damaged_report_sets_the_condition(librarian_client, book, staff_member):
    copy = book.copies.first()
    assert report(librarian_client, copy, report_type="damaged", member=staff_member.pk).status_code == 201
    copy.refresh_from_db()
    assert copy.status == "damaged" and copy.condition == "damaged"


def test_a_loss_found_in_a_stock_check_has_no_member_and_no_charge(librarian_client, book):
    data = report(librarian_client, book.copies.first()).json()["data"]
    assert data["member"] is None and data["fee_status"] == "none" and data["member_name"] == ""
    assert not Charge.objects.exists()


def test_reporting_the_same_open_copy_twice_is_idempotent(librarian_client, school, book, staff_member):
    copy = book.copies.first()
    first = report(librarian_client, copy, member=staff_member.pk)
    again = report(librarian_client, copy, member=staff_member.pk, notes="again")
    assert first.status_code == 201 and again.status_code == 200
    assert first.json()["data"]["id"] == again.json()["data"]["id"]
    assert LostDamagedReport.objects.count() == 1 and Charge.objects.count() == 1 and log_count(school, "lost") == 1


def test_a_copy_on_loan_must_go_through_the_return_desk(librarian_client, book, staff_member):
    copy = book.copies.first()
    librarian_client.post(f"{BASE}/issues/issue/", {"member": staff_member.pk, "copy": copy.pk}, format="json")
    resp = report(librarian_client, copy)
    assert resp.status_code == 409 and not LostDamagedReport.objects.exists()


def test_withdrawn_or_already_lost_copies_cannot_be_reported_again(librarian_client, book):
    one, two = book.copies.order_by("id")
    BookCopy.objects.filter(pk=one.pk).update(status="withdrawn")
    assert report(librarian_client, one).status_code == 409
    BookCopy.objects.filter(pk=two.pk).update(status="lost")
    assert report(librarian_client, two).status_code == 409


def test_issue_and_member_must_match_the_report(librarian_client, school, book, staff_member, other_staff):
    copy_a, copy_b = book.copies.order_by("id")
    loan = BookIssue.objects.create(school=school, book=book, copy=copy_a, member=staff_member, issue_date=ago(9), due_date=ago(5), status="returned")
    assert "issue" in report(librarian_client, copy_b, issue=loan.pk).json()["field_errors"]  # another copy
    assert "issue" in report(librarian_client, copy_a, issue=loan.pk, member=other_staff.pk).json()["field_errors"]  # another member
    ok = report(librarian_client, copy_a, issue=loan.pk)
    assert ok.status_code == 201 and ok.json()["data"]["member"] == staff_member.pk  # member taken from the loan


def test_report_inputs_must_belong_to_the_school(librarian_client, book, other_book, other_member, other_issue):
    foreign_copy = other_book.copies.first()
    for body in ({"copy": foreign_copy.pk}, {"copy": book.copies.first().pk, "member": other_member.pk}, {"copy": book.copies.first().pk, "issue": other_issue.pk}):
        resp = librarian_client.post(REPORTS, {"report_type": "lost", **body}, format="json")
        assert resp.status_code == 400 and set(resp.json()["field_errors"]) & {"copy", "member", "issue"}
    foreign_copy.refresh_from_db()
    assert foreign_copy.status == "available" and not LostDamagedReport.objects.exists()


def test_report_type_is_required_and_checked(librarian_client, book):
    copy = book.copies.first()
    assert librarian_client.post(REPORTS, {"copy": copy.pk}, format="json").status_code == 400
    assert report(librarian_client, copy, report_type="stolen").status_code == 400


def test_replacement_cost_follows_the_settings(librarian_client, school, category, staff_member):
    settings = get_settings(school)
    settings.replacement_processing_fee, settings.replacement_default_cost = Decimal("20"), Decimal("75")
    settings.save()
    priced = make_book(school, category, title="P", cost_per_copy=Decimal("80"))
    free = make_book(school, category, title="F")
    assert report(librarian_client, priced.copies.first()).json()["data"]["replacement_cost"] == "100.00"
    assert report(librarian_client, free.copies.first()).json()["data"]["replacement_cost"] == "75.00"


def test_patch_changes_notes_only(librarian_client, book):
    rid = report(librarian_client, book.copies.first()).json()["data"]["id"]
    ok = librarian_client.patch(f"{REPORTS}{rid}/", {"notes": "Found a torn cover"}, format="json")
    assert ok.status_code == 200 and ok.json()["data"]["notes"] == "Found a torn cover"
    for body in ({"report_type": "damaged"}, {"resolution": "resolved"}, {"replacement_cost": "1"}, {"notes": "x", "copy": 1}):
        assert librarian_client.patch(f"{REPORTS}{rid}/", body, format="json").status_code == 400
    row = LostDamagedReport.objects.get(pk=rid)
    assert row.report_type == "lost" and row.resolution == "pending" and row.notes == "Found a torn cover"
    assert librarian_client.put(f"{REPORTS}{rid}/", {}, format="json").status_code == 405
    assert librarian_client.delete(f"{REPORTS}{rid}/").status_code == 405


def test_mark_fee_paid_collects_the_charge(librarian_client, school, book, staff_member):
    rid = report(librarian_client, book.copies.first(), member=staff_member.pk).json()["data"]["id"]
    resp = librarian_client.post(f"{REPORTS}{rid}/mark-fee-paid/", {"receipt_no": "PAPER-77"}, format="json")
    assert resp.status_code == 200 and resp.json()["data"]["fee_status"] == "paid"
    charge = Charge.objects.get(report_id=rid)
    assert charge.status == "paid" and charge.receipt_no == "PAPER-77" and charge.resolved_at
    assert log_count(school, "fine") == 1
    assert librarian_client.post(f"{REPORTS}{rid}/mark-fee-paid/").status_code == 409  # forward only


def test_mark_fee_paid_without_a_charge_is_a_409(librarian_client, book):
    rid = report(librarian_client, book.copies.first()).json()["data"]["id"]
    assert librarian_client.post(f"{REPORTS}{rid}/mark-fee-paid/").status_code == 409


def test_resolve_needs_the_fee_settled_and_works_once(librarian_client, school, book, staff_member):
    rid = report(librarian_client, book.copies.first(), member=staff_member.pk).json()["data"]["id"]
    refused = librarian_client.post(f"{REPORTS}{rid}/resolve/")
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "library_invalid_state_transition"
    librarian_client.post(f"{REPORTS}{rid}/mark-fee-paid/")
    done = librarian_client.post(f"{REPORTS}{rid}/resolve/")
    assert done.status_code == 200 and done.json()["data"]["resolution"] == "resolved"
    assert LostDamagedReport.objects.get(pk=rid).resolved_at
    assert librarian_client.post(f"{REPORTS}{rid}/resolve/").status_code == 409
    assert log_count(school, "lost") == 2  # the report and its resolution


def test_resolve_after_a_waiver_and_without_a_fee(librarian_client, book, staff_member):
    first, second = book.copies.order_by("id")
    waived = report(librarian_client, first, member=staff_member.pk).json()["data"]
    librarian_client.post(f"{BASE}/charges/{waived['charge_id']}/waive/", {"reason": "Found"}, format="json")
    assert librarian_client.post(f"{REPORTS}{waived['id']}/resolve/").status_code == 200
    feeless = report(librarian_client, second).json()["data"]
    assert librarian_client.post(f"{REPORTS}{feeless['id']}/resolve/").status_code == 200


def test_a_resolved_report_lets_the_copy_be_reported_again(librarian_client, book):
    copy = book.copies.first()
    rid = report(librarian_client, copy).json()["data"]["id"]
    librarian_client.post(f"{REPORTS}{rid}/resolve/")
    BookCopy.objects.filter(pk=copy.pk).update(status="available")
    assert report(librarian_client, copy, report_type="damaged").status_code == 201
    assert LostDamagedReport.objects.count() == 2


def test_charge_transitions_only_move_forward(librarian_client, school, book, staff_member):
    charge = Charge.objects.create(school=school, member=staff_member, charge_type="replacement", amount=Decimal("90"), assessed_on=today())
    assert librarian_client.post(f"{BASE}/charges/{charge.pk}/collect/", {"receipt_no": "R-1"}, format="json").status_code == 200
    charge.refresh_from_db()
    assert charge.status == "paid" and charge.receipt_no == "R-1"
    assert librarian_client.post(f"{BASE}/charges/{charge.pk}/waive/", {"reason": "x"}, format="json").status_code == 409
    assert librarian_client.post(f"{BASE}/charges/{charge.pk}/collect/").status_code == 409
    waived = Charge.objects.create(school=school, member=staff_member, charge_type="replacement", amount=Decimal("5"), assessed_on=today(), status="waived")
    assert librarian_client.post(f"{BASE}/charges/{waived.pk}/collect/").status_code == 409


def test_bill_returns_the_print_data(librarian_client, school, category, staff_member):
    book = make_book(school, category, title="Billed", cost_per_copy=Decimal("100"))
    rid = report(librarian_client, book.copies.first(), member=staff_member.pk, notes="Lost on trip").json()["data"]["id"]
    bill = librarian_client.get(f"{REPORTS}{rid}/bill/").json()["data"]
    assert bill["title"] == "Billed" and bill["replacement_cost"] == "150.00" and bill["card_no"] == "ST-1"
    assert bill["charge_status"] == "pending" and bill["copy_code"].endswith("/C1") and bill["notes"] == "Lost on trip"
    librarian_client.post(f"{REPORTS}{rid}/mark-fee-paid/")
    assert librarian_client.get(f"{REPORTS}{rid}/bill/").json()["data"]["charge_status"] == "paid"


def test_report_list_filters_and_fee_status(librarian_client, school, book, staff_member, other_staff):
    one, two = book.copies.order_by("id")
    a = report(librarian_client, one, member=staff_member.pk).json()["data"]
    report(librarian_client, two, report_type="damaged", member=other_staff.pk)
    librarian_client.post(f"{REPORTS}{a['id']}/mark-fee-paid/")
    rows = {r["id"]: r for r in librarian_client.get(REPORTS).json()["results"]}
    assert rows[a["id"]]["fee_status"] == "paid"
    assert librarian_client.get(f"{REPORTS}?report_type=damaged").json()["count"] == 1
    assert librarian_client.get(f"{REPORTS}?member={staff_member.pk}").json()["count"] == 1
    assert librarian_client.get(f"{REPORTS}?resolution=resolved").json()["count"] == 0
    assert librarian_client.get(f"{REPORTS}?search=treasure").json()["count"] == 2


def test_reports_list_query_count_is_bounded(librarian_client, school, category, staff_member, django_assert_max_num_queries):
    book = make_book(school, category, title="Many", copies=30)
    for copy in book.copies.all():
        report(librarian_client, copy, member=staff_member.pk)
    with django_assert_max_num_queries(8):
        resp = librarian_client.get(f"{REPORTS}?page_size=50")
    assert resp.json()["count"] == 30


def test_lost_damaged_and_holds_are_school_scoped(admin_user, school, other_school, other_book, other_member):
    admin = client_for(admin_user)
    copy = other_book.copies.first()
    foreign_report = LostDamagedReport.objects.create(
        school=other_school, book=other_book, copy=copy, member=other_member, report_type="lost", reported_on=today()
    )
    foreign_hold = Hold.objects.create(school=other_school, book=other_book, member=other_member)
    for method, url, body in (
        ("get", f"{REPORTS}{foreign_report.pk}/", None),
        ("get", f"{REPORTS}{foreign_report.pk}/bill/", None),
        ("patch", f"{REPORTS}{foreign_report.pk}/", {"notes": "x"}),
        ("post", f"{REPORTS}{foreign_report.pk}/resolve/", None),
        ("post", f"{REPORTS}{foreign_report.pk}/mark-fee-paid/", None),
        ("get", f"{HOLDS}{foreign_hold.pk}/", None),
        ("post", f"{HOLDS}{foreign_hold.pk}/cancel/", None),
    ):
        assert getattr(admin, method)(url, body, format="json").status_code == 404, url
    assert admin.get(REPORTS).json()["count"] == 0 and admin.get(HOLDS).json()["count"] == 0
    foreign_hold.refresh_from_db()
    assert foreign_hold.status == "waiting"


# ---- permission matrix --------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "code,call,expected",
    [
        ("library.holds.view", lambda c, ctx: c.get(HOLDS), 200),
        ("library.holds.create", lambda c, ctx: c.post(HOLDS, {"book": ctx["book"].pk, "member": ctx["member"].pk}, format="json"), 201),
        ("library.holds.cancel", lambda c, ctx: c.post(f"{HOLDS}{ctx['hold'].pk}/cancel/"), 200),
        ("library.lost_damaged.view", lambda c, ctx: c.get(REPORTS), 200),
        ("library.lost_damaged.view", lambda c, ctx: c.get(f"{REPORTS}{ctx['report'].pk}/bill/"), 200),
        ("library.lost_damaged.create", lambda c, ctx: c.post(REPORTS, {"copy": ctx["copy"].pk, "report_type": "lost"}, format="json"), 201),
        ("library.lost_damaged.update", lambda c, ctx: c.patch(f"{REPORTS}{ctx['report'].pk}/", {"notes": "n"}, format="json"), 200),
        ("library.charges.collect", lambda c, ctx: c.post(f"{REPORTS}{ctx['report'].pk}/mark-fee-paid/"), 200),
        ("library.lost_damaged.resolve", lambda c, ctx: c.post(f"{REPORTS}{ctx['feeless'].pk}/resolve/"), 200),
    ],
)
def test_each_hold_and_report_endpoint_needs_its_own_code(school, category, code, call, expected):
    book = make_book(school, category, title="Matrix", copies=6)
    member = make_member(school, "MX-1", member_type="staff")
    copies = list(book.copies.order_by("id"))
    ctx = {"book": book, "member": member, "copy": copies[0]}
    boss = client_for(make_user(school, ["library.holds.create", "library.lost_damaged.create"]))
    held = make_member(school, "MX-2", member_type="staff")
    ctx["hold"] = Hold.objects.create(school=school, book=book, member=held)
    ctx["report"] = LostDamagedReport.objects.get(pk=report(boss, copies[1], member=held.pk).json()["data"]["id"])
    ctx["feeless"] = LostDamagedReport.objects.get(pk=report(boss, copies[2]).json()["data"]["id"])
    assert call(client_for(make_user(school, [code])), ctx).status_code == expected
    ctx["copy"] = copies[3]
    assert call(client_for(make_user(school, ["library.reports.view"])), ctx).status_code == 403


def test_view_only_user_cannot_use_holds_or_reports(view_only_client, book, staff_member):
    assert view_only_client.get(HOLDS).status_code == 403  # holds.view is a new code
    assert view_only_client.post(HOLDS, {"book": book.pk, "member": staff_member.pk}, format="json").status_code == 403
    assert view_only_client.get(REPORTS).status_code == 403
    assert view_only_client.post(REPORTS, {"copy": book.copies.first().pk, "report_type": "lost"}, format="json").status_code == 403


def test_unauthenticated_calls_are_401(api_client):
    for path in ("holds/", "lost-damaged/", "issues/", "issues/due-today/", "issues/overdue/", "issues/open/lookup/?q=a"):
        assert api_client.get(f"{BASE}/{path}").status_code == 401
