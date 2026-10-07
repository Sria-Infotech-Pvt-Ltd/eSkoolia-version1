"""Tenant isolation and authentication for the library API (blueprint 4.1, 4.3)."""
import pytest

RESOURCES = ["categories", "books", "members", "issues"]


def url(resource, pk=None, suffix=""):
    base = f"/api/v1/library/{resource}/"
    return base if pk is None else f"{base}{pk}/{suffix}"


@pytest.mark.parametrize("resource", RESOURCES + ["settings"])
def test_requires_authentication(api_client, resource):
    assert api_client.get(url(resource)).status_code == 401


@pytest.mark.parametrize("resource", RESOURCES)
def test_write_requires_authentication(api_client, resource):
    assert api_client.post(url(resource), {}, format="json").status_code == 401


def other_school_pk(resource, other_category, other_book, other_member, other_issue):
    return {"categories": other_category, "books": other_book, "members": other_member, "issues": other_issue}[resource].pk


@pytest.mark.parametrize("resource", RESOURCES)
def test_cross_school_detail_is_404(admin_user, other_category, other_book, other_member, other_issue, resource):
    from apps.library.tests.conftest import client_for

    pk = other_school_pk(resource, other_category, other_book, other_member, other_issue)
    assert client_for(admin_user).get(url(resource, pk)).status_code == 404


@pytest.mark.parametrize("resource", ["categories", "books", "members"])
def test_cross_school_update_and_delete_are_404(admin_user, other_category, other_book, other_member, other_issue, resource):
    from apps.library.tests.conftest import client_for

    client = client_for(admin_user)
    pk = other_school_pk(resource, other_category, other_book, other_member, other_issue)
    assert client.patch(url(resource, pk), {"is_active": False}, format="json").status_code == 404
    assert client.put(url(resource, pk), {}, format="json").status_code == 404
    assert client.delete(url(resource, pk)).status_code == 404


def test_cross_school_return_action_is_404(admin_user, other_issue):
    from apps.library.tests.conftest import client_for

    assert client_for(admin_user).post(url("issues", other_issue.pk, "return/")).status_code == 404
    other_issue.refresh_from_db()
    assert other_issue.status == "issued"


@pytest.mark.parametrize("resource", RESOURCES)
def test_lists_never_include_other_school_rows(admin_user, category, book, member, other_category, other_book, other_member, other_issue, resource):
    from apps.library.tests.conftest import client_for

    body = client_for(admin_user).get(url(resource)).json()
    ids = {row["id"] for row in body["results"]}
    foreign = other_school_pk(resource, other_category, other_book, other_member, other_issue)
    assert foreign not in ids
    assert body["success"] is True and body["data"] == body["results"]


def test_superuser_is_scoped_like_everyone_else(school, other_category, other_book):
    from django.contrib.auth import get_user_model

    from apps.library.models import BookCategory
    from apps.library.tests.conftest import client_for

    root = get_user_model().objects.create_superuser(username="root_lib", password="x", school=school)
    BookCategory.objects.create(school=school, name="Mine")
    names = {row["name"] for row in client_for(root).get(url("categories")).json()["results"]}
    assert names == {"Mine"}
    assert client_for(root).get(url("books", other_book.pk)).status_code == 404


def test_cross_school_fk_is_rejected_on_create(librarian_client, other_category, other_book, other_member):
    resp = librarian_client.post(url("books"), {"title": "X", "author": "Y", "category": other_category.pk}, format="json")
    assert resp.status_code == 400
    assert "category" in resp.json()["field_errors"]

    resp = librarian_client.post(
        url("issues"),
        {"book": other_book.pk, "member": other_member.pk, "issue_date": "2026-01-01", "due_date": "2026-01-10"},
        format="json",
    )
    assert resp.status_code == 400
    assert {"book", "member"} & set(resp.json()["field_errors"])


def test_school_is_never_taken_from_the_payload(librarian_client, librarian, other_school):
    resp = librarian_client.post(url("categories"), {"name": "Sneaky", "school": other_school.pk}, format="json")
    assert resp.status_code == 201
    assert resp.json()["data"]["school"] == librarian.school_id


def test_cross_school_student_cannot_become_a_member(librarian_client, other_student):
    resp = librarian_client.post(
        url("members"), {"member_type": "student", "card_no": "S-X", "student": other_student.pk}, format="json"
    )
    assert resp.status_code == 400
    assert "student" in resp.json()["field_errors"]
