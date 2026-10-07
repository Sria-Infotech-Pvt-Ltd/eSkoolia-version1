"""Permission codes and response shapes on the four existing resources (blueprint 3.6, D12)."""
from datetime import date

import pytest
from django.utils import timezone

from apps.library.tests.conftest import client_for, make_user

BASE = "/api/v1/library"

# resource -> (list url, payload that creates one row, model field used to prove an update)
CRUD = {
    "book_categories": (f"{BASE}/categories/", {"name": "Poetry"}, "description"),
    "books": (f"{BASE}/books/", {"title": "Poems", "author": "A. Poet"}, "rack"),
}


@pytest.mark.parametrize("resource", sorted(CRUD))
def test_view_only_user_can_read_but_not_write(view_only_client, category, book, resource):
    list_url, payload, _field = CRUD[resource]
    assert view_only_client.get(list_url).status_code == 200
    assert view_only_client.post(list_url, payload, format="json").status_code == 403
    pk = {"book_categories": category, "books": book}[resource].pk
    assert view_only_client.get(f"{list_url}{pk}/").status_code == 200
    assert view_only_client.patch(f"{list_url}{pk}/", {"description": "x"}, format="json").status_code == 403
    assert view_only_client.put(f"{list_url}{pk}/", payload, format="json").status_code == 403
    assert view_only_client.delete(f"{list_url}{pk}/").status_code == 403


def test_view_only_user_cannot_write_members_or_loans(view_only_client, member, book):
    members = f"{BASE}/members/"
    assert view_only_client.get(members).status_code == 200
    assert view_only_client.post(members, {"member_type": "staff", "card_no": "N"}, format="json").status_code == 403
    assert view_only_client.patch(f"{members}{member.pk}/", {"is_active": False}, format="json").status_code == 403
    assert view_only_client.delete(f"{members}{member.pk}/").status_code == 403

    issues = f"{BASE}/issues/"
    assert view_only_client.get(issues).status_code == 200
    body = {"book": book.pk, "member": member.pk, "issue_date": "2026-01-01", "due_date": "2026-01-10"}
    assert view_only_client.post(issues, body, format="json").status_code == 403


@pytest.mark.parametrize(
    "code,method,expected",
    [
        ("library.book_categories.create", "post", 201),
        ("library.book_categories.update", "patch", 200),
        ("library.book_categories.delete", "delete", 204),
    ],
)
def test_matching_code_opens_exactly_that_door(school, category, code, method, expected):
    user = make_user(school, [code])  # note: no .view code at all
    client = client_for(user)
    detail = f"{BASE}/categories/{category.pk}/"
    calls = {
        "post": lambda: client.post(f"{BASE}/categories/", {"name": "New"}, format="json"),
        "patch": lambda: client.patch(detail, {"description": "d"}, format="json"),
        "delete": lambda: client.delete(detail),
    }
    assert calls[method]().status_code == expected
    # ...and not the other two writes
    for other, call in calls.items():
        if other != method:
            assert call().status_code == 403


def test_user_without_any_library_code_gets_403(school):
    client = client_for(make_user(school, []))
    for resource in ("categories", "books", "members", "issues", "settings"):
        assert client.get(f"{BASE}/{resource}/").status_code == 403


def test_user_of_another_module_gets_403(school):
    client = client_for(make_user(school, ["fees.fees_group.view"]))
    assert client.get(f"{BASE}/books/").status_code == 403


def test_school_admin_needs_no_codes(admin_user):
    client = client_for(admin_user)
    assert client.post(f"{BASE}/categories/", {"name": "Admin made"}, format="json").status_code == 201


def test_created_and_updated_by_are_stamped_from_the_request(librarian_client, librarian):
    created = librarian_client.post(f"{BASE}/categories/", {"name": "Stamped"}, format="json").json()["data"]
    assert created["created_by"] == librarian.pk and created["updated_by"] == librarian.pk
    other = make_user(librarian.school, ["library.book_categories.update"])
    updated = client_for(other).patch(f"{BASE}/categories/{created['id']}/", {"description": "x"}, format="json").json()["data"]
    assert updated["created_by"] == librarian.pk and updated["updated_by"] == other.pk


def test_audit_fields_cannot_be_assigned_by_the_client(librarian_client, librarian, admin_user):
    resp = librarian_client.post(
        f"{BASE}/categories/", {"name": "Forged", "created_by": admin_user.pk, "updated_by": admin_user.pk}, format="json"
    )
    assert resp.status_code == 201
    assert resp.json()["data"]["created_by"] == librarian.pk


# ---- envelope -----------------------------------------------------------


def test_list_envelope_keeps_results_and_adds_success_and_data(librarian_client, category):
    body = librarian_client.get(f"{BASE}/categories/?is_active=true").json()
    assert body["success"] is True
    assert {"count", "next", "previous", "results", "data"} <= set(body)
    assert body["results"][0]["name"] == "Fiction"


def test_unknown_field_on_create_is_a_400_with_field_errors(librarian_client):
    resp = librarian_client.post(f"{BASE}/categories/", {"name": "Odd", "colour": "red"}, format="json")
    assert resp.status_code == 400
    body = resp.json()
    assert body["success"] is False and body["error"]["code"] == "validation_error"
    assert "colour" in body["field_errors"]


def test_validation_error_shape(librarian_client):
    resp = librarian_client.post(f"{BASE}/categories/", {}, format="json")
    assert resp.status_code == 400
    assert "name" in resp.json()["field_errors"]


def test_permission_denied_shape(view_only_client):
    resp = view_only_client.post(f"{BASE}/categories/", {"name": "x"}, format="json")
    assert resp.status_code == 403
    assert resp.json() == {
        "success": False,
        "error": {"code": "permission_denied", "message": "You do not have permission to perform this action."},
    }


def test_not_found_keeps_404_through_the_envelope(librarian_client):
    resp = librarian_client.get(f"{BASE}/books/999999/")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"


def test_book_category_filter_and_search(librarian_client, category, book):
    resp = librarian_client.get(f"{BASE}/books/?category={category.pk}&search=treasure")
    assert [row["title"] for row in resp.json()["results"]] == ["Treasure Island"]
    assert librarian_client.get(f"{BASE}/books/?search=nothing-like-this").json()["count"] == 0


# ---- legacy loan endpoints ---------------------------------------------


def available_copies(book):
    return book.copies.filter(status="available").count()


def issue_body(book, member):
    return {"book": book.pk, "member": member.pk, "issue_date": "2026-01-01", "due_date": "2026-01-15", "status": "issued"}


def test_legacy_issue_takes_a_copy_and_records_the_actor(librarian_client, librarian, book, member):
    resp = librarian_client.post(f"{BASE}/issues/", issue_body(book, member), format="json")
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert data["status"] == "issued" and data["issued_by"] == librarian.pk and data["created_by"] == librarian.pk
    assert available_copies(book) == 1


def test_legacy_issue_refuses_when_no_copy_is_left(librarian_client, book, member):
    book.copies.update(status="issued")
    resp = librarian_client.post(f"{BASE}/issues/", issue_body(book, member), format="json")
    assert resp.status_code == 400  # caught by serializer validation first


def test_legacy_issue_stock_guard_holds_even_if_validation_was_stale(librarian_client, book, member, monkeypatch):
    """The conditional UPDATE is the real guard: simulate a request that validated before another took the last copy."""
    from apps.library.serializers import circulation

    book.copies.update(status="issued")  # another desk took every copy after validation passed
    monkeypatch.setattr(circulation.BookIssueSerializer, "validate", lambda self, attrs: attrs)
    resp = librarian_client.post(f"{BASE}/issues/", issue_body(book, member), format="json")
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "library_copy_unavailable"
    assert available_copies(book) == 0


def test_legacy_issue_cannot_be_created_closed_or_with_a_fine(librarian_client, book, member):
    body = {**issue_body(book, member), "status": "returned", "fine_amount": "99.00", "return_date": "2026-01-02"}
    data = librarian_client.post(f"{BASE}/issues/", body, format="json").json()["data"]
    assert data["status"] == "issued" and data["fine_amount"] == "0.00" and data["return_date"] is None


def test_legacy_return_ignores_client_fine_and_date_and_restocks(librarian_client, book, member):
    issue_id = librarian_client.post(f"{BASE}/issues/", issue_body(book, member), format="json").json()["data"]["id"]
    resp = librarian_client.post(
        f"{BASE}/issues/{issue_id}/return/", {"fine_amount": "500.00", "return_date": "1999-01-01"}, format="json"
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["return_date"] == timezone.localdate().isoformat()
    from apps.library.models import BookIssue

    issue = BookIssue.objects.get(pk=issue_id)
    assert issue.status == "returned" and str(issue.fine_amount) == "0.00"
    assert issue.return_date != date(1999, 1, 1)
    assert available_copies(book) == 2


def test_legacy_return_twice_is_a_409_and_stock_is_not_double_counted(librarian_client, book, member):
    issue_id = librarian_client.post(f"{BASE}/issues/", issue_body(book, member), format="json").json()["data"]["id"]
    assert librarian_client.post(f"{BASE}/issues/{issue_id}/return/").status_code == 200
    again = librarian_client.post(f"{BASE}/issues/{issue_id}/return/")
    assert again.status_code == 409 and again.json()["error"]["code"] == "library_already_returned"
    assert available_copies(book) == 2


def test_return_needs_the_return_code_not_just_view(school, book, member):
    from apps.library.models import BookIssue

    issue = BookIssue.objects.create(school=school, book=book, member=member, issue_date="2026-01-01", due_date="2026-01-10")
    viewer = client_for(make_user(school, ["library.book_issues.view"]))
    returner = client_for(make_user(school, ["library.book_issues.return"]))
    assert viewer.post(f"{BASE}/issues/{issue.pk}/return/").status_code == 403
    assert returner.post(f"{BASE}/issues/{issue.pk}/return/").status_code == 200


def test_generic_loan_mutations_are_not_offered(librarian_client, book, member):
    issue_id = librarian_client.post(f"{BASE}/issues/", issue_body(book, member), format="json").json()["data"]["id"]
    detail = f"{BASE}/issues/{issue_id}/"
    assert librarian_client.patch(detail, {"status": "returned"}, format="json").status_code == 405
    assert librarian_client.put(detail, issue_body(book, member), format="json").status_code == 405
    assert librarian_client.delete(detail).status_code == 405


def test_overdue_lists_only_open_past_due_loans(librarian_client, school, book, member):
    from apps.library.models import BookIssue

    late = BookIssue.objects.create(school=school, book=book, member=member, issue_date="2020-01-01", due_date="2020-01-10")
    BookIssue.objects.create(school=school, book=book, member=member, issue_date="2020-01-01", due_date="2020-01-10", status="returned")
    body = librarian_client.get(f"{BASE}/issues/overdue/").json()
    assert [row["id"] for row in body["results"]] == [late.pk]
    assert body["success"] is True


def test_member_create_needs_a_student_and_stays_in_school(librarian_client, student):
    resp = librarian_client.post(f"{BASE}/members/", {"member_type": "student", "card_no": "S-1", "student": student.pk}, format="json")
    assert resp.status_code == 201
    assert librarian_client.post(f"{BASE}/members/", {"member_type": "student", "card_no": "S-2"}, format="json").status_code == 400
