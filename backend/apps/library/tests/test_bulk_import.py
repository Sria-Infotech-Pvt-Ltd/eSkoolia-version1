"""Bulk import preview and commit, and the label endpoint."""
import uuid

import pytest

from apps.library.models import Book, BookCategory, BookCopy, LibraryActivityLog
from apps.library.services.bulk_import import neutralise
from apps.library.tests.conftest import client_for, make_user

BASE = "/api/v1/library/books"


def row(title="Matilda", author="Roald Dahl", category="Fiction", copies=2, cost="199.50"):
    return {"title": title, "author": author, "category": category, "copies": copies, "cost": cost}


def preview(client, rows):
    return client.post(f"{BASE}/bulk-import/preview/", {"rows": rows}, format="json")


def commit(client, rows, batch=None):
    return client.post(
        f"{BASE}/bulk-import/commit/", {"rows": rows, "client_batch_id": str(batch or uuid.uuid4())}, format="json"
    )


def test_preview_marks_valid_and_invalid_rows_and_writes_nothing(librarian_client, category):
    rows = [row(), row(title="", author="X"), row(title="Ghost", category="Nowhere"), row(title="Defaults", copies=None, cost=None)]
    data = preview(librarian_client, rows).json()["data"]
    assert [r["valid"] for r in data["rows"]] == [True, False, False, True]
    assert data["rows"][1]["error"] == "Missing title"
    assert data["rows"][2]["error"] == 'Unrecognised category "Nowhere"'
    assert (data["valid_count"], data["invalid_count"]) == (2, 2)
    assert data["rows"][3]["copies"] == 1 and data["rows"][3]["cost"] == "0.00"  # defaults
    assert data["rows"][0]["category_id"] == category.pk and data["rows"][0]["cost"] == "199.50"
    assert Book.objects.count() == 0 and LibraryActivityLog.objects.count() == 0


def test_category_match_ignores_case_and_inactive_is_flagged(librarian_client, category):
    BookCategory.objects.create(school=category.school, name="Old", code="OLD", is_active=False)
    data = preview(librarian_client, [row(category="fiction"), row(title="B", category="Old")]).json()["data"]
    assert data["rows"][0]["valid"] is True
    assert data["rows"][1]["error"] == 'Category "Old" is inactive'


@pytest.mark.parametrize("copies", ["0", "-1", "abc", "1.5", 501, 10**9])
def test_bad_copies_are_row_errors(librarian_client, category, copies):
    out = preview(librarian_client, [row(copies=copies)]).json()["data"]["rows"][0]
    assert out["valid"] is False and "Copies" in out["error"]


@pytest.mark.parametrize("cost", ["-5", "free", "NaN", "Infinity", "1e30"])
def test_bad_cost_is_a_row_error(librarian_client, category, cost):
    out = preview(librarian_client, [row(cost=cost)]).json()["data"]["rows"][0]
    assert out["valid"] is False and "Cost" in out["error"]


def test_more_than_500_rows_is_refused_up_front(librarian_client, category):
    rows = [row(title=f"T{n}") for n in range(501)]
    assert preview(librarian_client, rows).status_code == 400
    assert commit(librarian_client, rows).status_code == 400
    assert Book.objects.count() == 0
    assert preview(librarian_client, [row(title=f"T{n}") for n in range(500)]).status_code == 200


def test_empty_and_non_list_payloads_are_400(librarian_client, category):
    assert preview(librarian_client, []).status_code == 400
    assert librarian_client.post(f"{BASE}/bulk-import/preview/", {"rows": "nope"}, format="json").status_code == 400
    assert librarian_client.post(f"{BASE}/bulk-import/commit/", {"rows": [row()]}, format="json").status_code == 400
    assert librarian_client.post(f"{BASE}/bulk-import/commit/", {"rows": [row()], "client_batch_id": "x"}, format="json").status_code == 400


def test_a_malformed_row_is_a_row_error_not_a_500(librarian_client, category):
    data = preview(librarian_client, ["just text", 5, None, row()]).json()["data"]
    assert [r["valid"] for r in data["rows"]] == [False, False, False, True]


@pytest.mark.parametrize("lead", ["=", "+", "-", "@", "\t"])
def test_formula_characters_are_neutralised(librarian_client, category, lead):
    out = commit(librarian_client, [row(title=f"{lead}SUM(A1)", author=f"{lead}cmd|calc")]).json()["data"]
    assert len(out["created"]) == 1
    book = Book.objects.get()
    if lead != "	":  # a leading tab is collapsed as whitespace and dropped; the rest get an apostrophe
        assert book.title.startswith("'") and book.author.startswith("'")
    assert not book.title.startswith(("=", "+", "-", "@", "\t")) and not book.author.startswith(("=", "+", "-", "@", "\t"))


def test_neutralise_leaves_ordinary_text_alone():
    assert neutralise("Matilda") == "Matilda" and neutralise("=1+1") == "'=1+1" and neutralise("") == ""


def test_commit_creates_valid_rows_and_reports_skipped(librarian_client, librarian, category):
    rows = [row(), row(title="", author="X"), row(title="Second", copies=3), row(title="Bad", category="Nope")]
    resp = commit(librarian_client, rows)
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert [c["accession_code"] for c in data["created"]] == ["LIB-FIC-0001", "LIB-FIC-0002"]
    assert [(s["row"], s["error"]) for s in data["skipped"]] == [(2, "Missing title"), (4, 'Unrecognised category "Nope"')]
    assert data["replayed"] is False and {t["title"] for t in data["titles"]} == {"Matilda", "Second"}
    assert BookCopy.objects.filter(book__title="Second").count() == 3
    book = Book.objects.get(title="Matilda")
    assert str(book.cost_per_copy) == "199.50" and book.created_by_id == librarian.pk
    assert set(BookCopy.objects.filter(book=book).values_list("condition", flat=True)) == {"new"}


def test_commit_revalidates_on_the_server(librarian_client, category):
    """A client that skips preview, or tampers with it, gets no unchecked rows through."""
    rows = [{**row(), "valid": True, "category_id": 999999, "error": None}, row(title="", author="")]
    data = commit(librarian_client, rows).json()["data"]
    assert len(data["created"]) == 1 and data["skipped"][0]["error"] == "Missing title"
    assert Book.objects.get().category_id == category.pk


def test_commit_writes_one_activity_row_per_batch(librarian_client, librarian, category):
    batch = uuid.uuid4()
    commit(librarian_client, [row(title=f"T{n}") for n in range(5)], batch)
    logs = LibraryActivityLog.objects.filter(school=librarian.school, event_type="accession")
    assert logs.count() == 1
    meta = logs.get().metadata
    assert meta["client_batch_id"] == str(batch) and len(meta["created"]) == 5 and meta["action"] == "bulk_import"
    assert logs.get().actor_id == librarian.pk


def test_repeated_batch_id_creates_nothing_and_returns_the_first_result(librarian_client, librarian, category):
    batch = uuid.uuid4()
    first = commit(librarian_client, [row(), row(title="Other")], batch).json()["data"]
    again = commit(librarian_client, [row(title="Brand new"), row(title="Another")], batch)  # even different rows
    assert again.status_code == 200
    data = again.json()["data"]
    assert data["replayed"] is True
    assert data["created"] == first["created"] and {t["title"] for t in data["titles"]} == {"Matilda", "Other"}
    assert Book.objects.count() == 2 and BookCopy.objects.count() == 4
    assert LibraryActivityLog.objects.filter(school=librarian.school, event_type="accession").count() == 1


def test_batch_ids_are_per_school(librarian_client, other_admin, other_category, category):
    batch = uuid.uuid4()
    commit(librarian_client, [row()], batch)
    resp = commit(client_for(other_admin), [row()], batch)
    assert resp.status_code == 201 and resp.json()["data"]["replayed"] is False
    assert Book.objects.count() == 2


def test_duplicate_titles_are_skipped_not_fatal(librarian_client, category, book):
    rows = [row(title="Treasure Island", author="R. L. Stevenson"), row(title="Fresh"), row(title="fresh")]
    data = commit(librarian_client, rows).json()["data"]
    assert len(data["created"]) == 1
    assert [s["row"] for s in data["skipped"]] == [1, 3]
    assert data["skipped"][0]["error"].startswith("Title already exists")


def test_import_uses_only_this_schools_categories(librarian_client, other_category):
    out = preview(librarian_client, [row(category="Fiction")]).json()["data"]["rows"][0]
    assert out["valid"] is False and out["error"].startswith("Unrecognised category")


def test_import_needs_the_import_code_and_the_catalogue_view_code_is_not_enough(school, category):
    body = {"rows": [row()]}
    for code in ("library.books.view", "library.books.create"):
        client = client_for(make_user(school, [code]))
        assert client.post(f"{BASE}/bulk-import/preview/", body, format="json").status_code == 403
        assert commit(client, [row()]).status_code == 403
    importer = client_for(make_user(school, ["library.books.import"]))
    assert importer.post(f"{BASE}/bulk-import/preview/", body, format="json").status_code == 200
    assert commit(importer, [row()]).status_code == 201


def test_import_requires_authentication(api_client):
    assert api_client.post(f"{BASE}/bulk-import/preview/", {"rows": [row()]}, format="json").status_code == 401


# ---- labels -----------------------------------------------------------------------


def test_labels_return_codes_and_the_title_line(librarian_client, book):
    data = librarian_client.get(f"{BASE}/{book.pk}/labels/").json()["data"]
    assert data["title_line"] == "Treasure Island - R. L. Stevenson"
    assert [c["code"] for c in data["copies"]] == [f"{book.accession_code}/C1", f"{book.accession_code}/C2"]
    assert data["accession_code"] == book.accession_code


def test_labels_skip_withdrawn_copies_unless_asked_and_can_pick_one(librarian_client, book):
    first, second = book.copies.order_by("id")
    BookCopy.objects.filter(pk=second.pk).update(status="withdrawn")
    assert len(librarian_client.get(f"{BASE}/{book.pk}/labels/").json()["data"]["copies"]) == 1
    assert len(librarian_client.get(f"{BASE}/{book.pk}/labels/?all=true").json()["data"]["copies"]) == 2
    only = librarian_client.get(f"{BASE}/{book.pk}/labels/?copy={first.pk}").json()["data"]["copies"]
    assert [c["id"] for c in only] == [first.pk]
    assert librarian_client.get(f"{BASE}/{book.pk}/labels/?copy=abc").json()["data"]["copies"] == []


def test_labels_title_line_includes_edition_and_part(librarian_client, school, category):
    from apps.library.tests.conftest import make_book

    book = make_book(school, category, title="Atlas", author="Maps", edition="3rd", part_label="Vol 2")
    assert librarian_client.get(f"{BASE}/{book.pk}/labels/").json()["data"]["title_line"] == "Atlas (3rd ed. Vol 2) - Maps"


def test_labels_are_scoped_and_guarded(admin_user, other_book, view_only_client, book):
    assert client_for(admin_user).get(f"{BASE}/{other_book.pk}/labels/").status_code == 404
    assert view_only_client.get(f"{BASE}/{book.pk}/labels/").status_code == 403  # book_copies.view is a new code
