"""Permission codes and response shapes on the four existing resources (blueprint 3.6, D12)."""
import pytest

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
    assert view_only_client.post(f"{issues}issue/", {"member": member.pk, "book": book.pk}, format="json").status_code == 403


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


def test_member_create_needs_a_student_and_stays_in_school(librarian_client, student):
    resp = librarian_client.post(f"{BASE}/members/", {"member_type": "student", "card_no": "S-1", "student": student.pk}, format="json")
    assert resp.status_code == 201
    assert librarian_client.post(f"{BASE}/members/", {"member_type": "student", "card_no": "S-2"}, format="json").status_code == 400
