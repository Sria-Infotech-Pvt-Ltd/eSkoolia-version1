"""Issue desk reads, filters, lookup, scoping and the permission matrix."""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.library.models import BookIssue, Charge
from apps.library.tests.conftest import (
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


def lend(school, book, member, due, status="issued", issue_days_ago=20, copy=None):
    copy = copy or book.copies.exclude(loans__status="issued").first()
    loan = BookIssue.objects.create(
        school=school, book=book, copy=copy, member=member, issue_date=ago(issue_days_ago), due_date=due, status=status,
        return_date=today() if status != "issued" else None,
    )
    if status == "issued":
        BookCopy_set(copy, "issued")
    return loan


def BookCopy_set(copy, status):
    type(copy).objects.filter(pk=copy.pk).update(status=status)


@pytest.fixture
def staff_member(school):
    return make_member(school, "ST-1", member_type="staff")


def ids(client, query=""):
    return [r["id"] for r in client.get(f"{ISSUES}?{query}").json()["results"]]


def test_list_row_shape_and_derived_fields(librarian_client, school, book, staff_member):
    loan = lend(school, book, staff_member, due=ago(3))
    row = librarian_client.get(ISSUES).json()["results"][0]
    assert {"id", "book", "book_title", "copy", "copy_code", "member", "member_name", "member_card_no", "member_type", "school_class",
            "issue_date", "due_date", "days_overdue", "accrued_fine", "renew_count", "state", "status"} <= set(row)
    assert row["id"] == loan.pk and row["book_title"] == "Treasure Island" and row["copy_code"].endswith("/C1")
    assert (row["state"], row["days_overdue"], row["accrued_fine"], row["member_card_no"]) == ("overdue", 3, "30.00", "ST-1")


def test_state_is_derived_from_dates_not_stored(librarian_client, school, category, staff_member):
    books = [make_book(school, category, title=f"S{n}") for n in range(5)]
    overdue = lend(school, books[0], staff_member, due=ago(1))
    due_today = lend(school, books[1], staff_member, due=today())
    open_ = lend(school, books[2], staff_member, due=today() + timedelta(days=5))
    returned = lend(school, books[3], staff_member, due=ago(2), status="returned")
    lost = lend(school, books[4], staff_member, due=ago(2), status="lost")
    states = {r["id"]: r["state"] for r in librarian_client.get(ISSUES).json()["results"]}
    assert states == {overdue.pk: "overdue", due_today.pk: "due_today", open_.pk: "open", returned.pk: "returned", lost.pk: "lost"}
    assert set(ids(librarian_client, "state=open")) == {overdue.pk, due_today.pk, open_.pk}
    assert ids(librarian_client, "state=overdue") == [overdue.pk]
    assert ids(librarian_client, "state=due_today") == [due_today.pk]
    assert ids(librarian_client, "state=returned") == [returned.pk]
    assert ids(librarian_client, "state=lost") == [lost.pk]
    assert librarian_client.get(f"{ISSUES}?state=weird").status_code == 400


def test_closed_loans_show_no_accrued_fine(librarian_client, school, book, staff_member):
    lend(school, book, staff_member, due=ago(9), status="returned")
    row = librarian_client.get(ISSUES).json()["results"][0]
    assert (row["days_overdue"], row["accrued_fine"]) == (0, "0.00")


def test_due_today_and_overdue_lists(librarian_client, school, category, staff_member):
    books = [make_book(school, category, title=f"D{n}") for n in range(3)]
    overdue = lend(school, books[0], staff_member, due=ago(2))
    due_today = lend(school, books[1], staff_member, due=today())
    lend(school, books[2], staff_member, due=today() + timedelta(days=3))
    body = librarian_client.get(f"{ISSUES}overdue/").json()
    assert [r["id"] for r in body["results"]] == [overdue.pk] and body["success"] is True
    assert [r["id"] for r in librarian_client.get(f"{ISSUES}due-today/").json()["results"]] == [due_today.pk]


def test_filters_member_book_copy_class_dates_and_search(librarian_client, school, category, class_six_pupil=None):
    from apps.core.models import Class

    klass = Class.objects.create(school=school, name="Grade 6")
    student = _student(school, "SC-1")
    student.current_class, student.first_name = klass, "Zoya"
    student.save()
    pupil = make_member(school, "PU-9", member_type="student", student=student)
    staff = make_member(school, "ST-8", member_type="staff")
    b1, b2 = make_book(school, category, title="Alpha"), make_book(school, category, title="Beta")
    a = lend(school, b1, pupil, due=today() + timedelta(days=9), issue_days_ago=2)
    b = lend(school, b2, staff, due=today() + timedelta(days=9), issue_days_ago=30)
    assert ids(librarian_client, f"member={pupil.pk}") == [a.pk] and ids(librarian_client, f"book={b2.pk}") == [b.pk]
    assert ids(librarian_client, f"copy={a.copy_id}") == [a.pk] and ids(librarian_client, f"school_class={klass.pk}") == [a.pk]
    assert ids(librarian_client, f"issued_from={ago(5).isoformat()}") == [a.pk]
    assert ids(librarian_client, f"issued_to={ago(10).isoformat()}") == [b.pk]
    assert ids(librarian_client, "search=zoya") == [a.pk] and ids(librarian_client, "search=ST-8") == [b.pk]
    assert ids(librarian_client, f"search={a.copy.code}") == [a.pk] and ids(librarian_client, "search=beta") == [b.pk]
    assert librarian_client.get(f"{ISSUES}?issued_from=yesterday").status_code == 400
    assert librarian_client.get(f"{ISSUES}?school_class=x").status_code == 400


def test_detail_includes_charges_and_issuer(librarian_client, school, book, staff_member):
    loan = lend(school, book, staff_member, due=ago(1))
    Charge.objects.create(school=school, member=staff_member, charge_type="overdue_fine", amount=10, issue=loan, assessed_on=today(), status="paid", receipt_no="R")
    data = librarian_client.get(f"{ISSUES}{loan.pk}/").json()["data"]
    assert data["charges"] == [{"id": Charge.objects.get().pk, "charge_type": "overdue_fine", "amount": "10.00", "status": "paid", "receipt_no": "R"}]
    assert "issued_by_name" in data and data["renew_count"] == 0


def test_open_lookup_finds_by_exact_copy_code_first_and_by_text(librarian_client, school, category, staff_member):
    b1, b2 = make_book(school, category, title="Moby Dick"), make_book(school, category, title="Dick Whittington")
    first = lend(school, b1, staff_member, due=today() + timedelta(days=3))
    other = make_member(school, "ST-3", member_type="staff")
    second = lend(school, b2, other, due=today() + timedelta(days=3))
    rows = librarian_client.get(f"{ISSUES}open/lookup/", {"q": second.copy.code.lower()}).json()["results"]
    assert rows[0]["id"] == second.pk
    assert {r["id"] for r in librarian_client.get(f"{ISSUES}open/lookup/?q=dick").json()["results"]} == {first.pk, second.pk}
    assert [r["id"] for r in librarian_client.get(f"{ISSUES}open/lookup/?q=ST-3").json()["results"]] == [second.pk]
    assert librarian_client.get(f"{ISSUES}open/lookup/?q=").json()["results"] == []
    lend(school, make_book(school, category, title="Closed Book"), staff_member, due=ago(2), status="returned")
    assert librarian_client.get(f"{ISSUES}open/lookup/?q=closed").json()["results"] == []  # open loans only


def test_issues_list_query_count_is_bounded(librarian_client, school, category, django_assert_max_num_queries):
    book = make_book(school, category, title="Bulk", copies=30)
    for number, copy in enumerate(book.copies.order_by("id")):
        member = make_member(school, f"QC-{number}", member_type="student" if number % 2 else "staff")
        lend(school, book, member, due=ago(number % 4), copy=copy)
    librarian_client.get(ISSUES)  # creates the settings row
    with django_assert_max_num_queries(8):
        resp = librarian_client.get(f"{ISSUES}?page_size=50")
    assert resp.json()["count"] == 30 and len(resp.json()["results"]) == 30
    with django_assert_max_num_queries(8):
        assert librarian_client.get(f"{ISSUES}overdue/?page_size=50").json()["count"] > 0


# ---- generic verbs are gone --------------------------------------------------------------------------------------------------


def test_loans_cannot_be_created_edited_or_deleted_through_generic_verbs(librarian_client, school, book, staff_member):
    loan = lend(school, book, staff_member, due=today() + timedelta(days=3))
    body = {"book": book.pk, "member": staff_member.pk, "issue_date": "2026-01-01", "due_date": "2026-01-10"}
    assert librarian_client.post(ISSUES, body, format="json").status_code == 405
    assert librarian_client.patch(f"{ISSUES}{loan.pk}/", {"status": "returned", "fine_amount": "0"}, format="json").status_code == 405
    assert librarian_client.put(f"{ISSUES}{loan.pk}/", body, format="json").status_code == 405
    assert librarian_client.delete(f"{ISSUES}{loan.pk}/").status_code == 405
    loan.refresh_from_db()
    assert loan.status == "issued"


def test_the_legacy_mark_returned_route_is_the_new_return_action(librarian_client, school, book, staff_member):
    loan = lend(school, book, staff_member, due=today() + timedelta(days=3))
    resp = librarian_client.post(f"{ISSUES}{loan.pk}/return/", {"fine_amount": "500", "return_date": "1999-01-01"}, format="json")
    assert resp.status_code == 200 and resp.json()["data"]["loan"]["fine_amount"] == "0.00"


# ---- scoping ---------------------------------------------------------------------------------------------------------------------


def test_every_loan_action_url_is_school_scoped(admin_user, other_issue, other_book, other_member):
    admin = client_for(admin_user)
    for method, suffix in (("get", ""), ("post", "return/"), ("post", "undo-return/"), ("post", "renew/")):
        assert getattr(admin, method)(f"{ISSUES}{other_issue.pk}/{suffix}", {}, format="json").status_code == 404, suffix
    other_issue.refresh_from_db()
    assert other_issue.status == "issued"
    assert other_issue.pk not in ids(admin)
    for path in ("overdue/", "due-today/", "open/lookup/?q=Kidnapped"):
        assert other_issue.pk not in [r["id"] for r in admin.get(f"{ISSUES}{path}").json()["results"]]


def test_a_superuser_sees_only_their_own_schools_loans(school, other_issue):
    from django.contrib.auth import get_user_model

    root = get_user_model().objects.create_superuser(username="root_loans", password="x", school=school)
    assert client_for(root).get(f"{ISSUES}{other_issue.pk}/").status_code == 404
    assert ids(client_for(root)) == []


# ---- permission matrix -------------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "code,call,expected",
    [
        ("library.book_issues.view", lambda c, x: c.get(ISSUES), 200),
        ("library.book_issues.view", lambda c, x: c.get(f"{ISSUES}{x['loan'].pk}/"), 200),
        ("library.book_issues.view", lambda c, x: c.get(f"{ISSUES}due-today/"), 200),
        ("library.book_issues.view", lambda c, x: c.get(f"{ISSUES}overdue/"), 200),
        ("library.book_issues.view", lambda c, x: c.get(f"{ISSUES}open/lookup/?q=a"), 200),
        ("library.book_issues.issue", lambda c, x: c.post(f"{ISSUES}issue/", {"member": x["member"].pk, "book": x["book"].pk}, format="json"), 201),
        ("library.book_issues.issue", lambda c, x: c.post(f"{ISSUES}bulk-issue/", {"book": x["book"].pk, "school_class": x["klass"].pk}, format="json"), 200),
        ("library.book_issues.return", lambda c, x: c.post(f"{ISSUES}{x['loan'].pk}/return/"), 200),
        ("library.book_issues.renew", lambda c, x: c.post(f"{ISSUES}{x['loan'].pk}/renew/"), 200),
    ],
)
def test_each_loan_endpoint_needs_its_own_code(school, category, code, call, expected):
    from apps.core.models import Class

    book = make_book(school, category, title="Matrix", copies=4)
    member = make_member(school, "PM-1", member_type="staff")
    loan = lend(school, book, make_member(school, "PM-2", member_type="staff"), due=today() + timedelta(days=5))
    ctx = {"book": book, "member": member, "loan": loan, "klass": Class.objects.create(school=school, name="Grade 6")}
    assert call(client_for(make_user(school, [code])), ctx).status_code == expected
    loan = lend(school, book, make_member(school, "PM-3", member_type="staff"), due=today() + timedelta(days=5))
    ctx["loan"] = loan
    assert call(client_for(make_user(school, ["library.reports.view"])), ctx).status_code == 403


def test_undo_return_needs_the_return_code(school, category):
    book = make_book(school, category, title="U")
    member = make_member(school, "UM-1", member_type="staff")
    desk = client_for(make_user(school, ["library.book_issues.issue", "library.book_issues.return"]))
    loan_id = desk.post(f"{ISSUES}issue/", {"member": member.pk, "book": book.pk}, format="json").json()["data"]["loan"]["id"]
    desk.post(f"{ISSUES}{loan_id}/return/")
    renewer = client_for(make_user(school, ["library.book_issues.renew"]))
    assert renewer.post(f"{ISSUES}{loan_id}/undo-return/").status_code == 403
    assert desk.post(f"{ISSUES}{loan_id}/undo-return/").status_code == 200


def test_view_only_user_can_read_but_not_act(view_only_client, school, book, staff_member):
    loan = lend(school, book, staff_member, due=today() + timedelta(days=5))
    assert view_only_client.get(ISSUES).status_code == 200
    assert view_only_client.post(f"{ISSUES}issue/", {"member": staff_member.pk, "book": book.pk}, format="json").status_code == 403
    assert view_only_client.post(f"{ISSUES}{loan.pk}/return/").status_code == 403
    assert view_only_client.post(f"{ISSUES}{loan.pk}/renew/").status_code == 403
    assert view_only_client.post(f"{ISSUES}{loan.pk}/undo-return/").status_code == 403
    assert view_only_client.post(f"{ISSUES}bulk-issue/", {}, format="json").status_code == 403
