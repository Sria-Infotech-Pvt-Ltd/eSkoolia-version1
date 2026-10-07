"""Categories, titles and copies: accession, codes, add and withdraw, filters, history refusals, permissions."""
import pytest

from apps.library.models import Book, BookCategory, BookCopy, LibraryActivityLog
from apps.library.tests.conftest import client_for, make_book, make_user

BASE = "/api/v1/library"


def wizard(category, **extra):
    return {
        "title": "Wonder", "author": "R. J. Palacio", "category": category.pk, "age_band": "middle",
        "for_students": True, "copies_count": 3, **extra,
    }


# ---- categories ------------------------------------------------------------


def test_category_code_is_derived_and_made_unique(librarian_client):
    first = librarian_client.post(f"{BASE}/categories/", {"name": "Fiction"}, format="json").json()["data"]
    second = librarian_client.post(f"{BASE}/categories/", {"name": "Fiction Two"}, format="json").json()["data"]
    assert first["code"] == "FIC" and second["code"] == "FIC2"


def test_category_code_can_be_given_and_is_validated(librarian_client, category):
    ok = librarian_client.post(f"{BASE}/categories/", {"name": "Science", "code": "sci", "color_key": "sky"}, format="json")
    assert ok.status_code == 201 and ok.json()["data"]["code"] == "SCI"
    dup = librarian_client.post(f"{BASE}/categories/", {"name": "Other", "code": "FIC"}, format="json")
    assert dup.status_code == 400 and "code" in dup.json()["field_errors"]
    bad = librarian_client.post(f"{BASE}/categories/", {"name": "Odd", "code": "no way!"}, format="json")
    assert bad.status_code == 400 and "code" in bad.json()["field_errors"]


@pytest.mark.parametrize("value", ["#ff0000", "Red", "rgb(1,2,3)"])
def test_color_key_must_be_a_token_not_a_colour(librarian_client, value):
    resp = librarian_client.post(f"{BASE}/categories/", {"name": "Tinted", "color_key": value}, format="json")
    assert resp.status_code == 400 and "color_key" in resp.json()["field_errors"]


def test_duplicate_category_name_is_a_field_error(librarian_client, category):
    resp = librarian_client.post(f"{BASE}/categories/", {"name": "fiction"}, format="json")
    assert resp.status_code == 400 and "name" in resp.json()["field_errors"]


def test_category_code_is_locked_once_it_has_titles(librarian_client, category, book):
    resp = librarian_client.patch(f"{BASE}/categories/{category.pk}/", {"code": "NEW"}, format="json")
    assert resp.status_code == 400 and "code" in resp.json()["field_errors"]
    assert librarian_client.patch(f"{BASE}/categories/{category.pk}/", {"code": "FIC", "color_key": "rose"}, format="json").status_code == 200


def test_category_code_is_editable_while_empty(librarian_client, category):
    resp = librarian_client.patch(f"{BASE}/categories/{category.pk}/", {"code": "FCT"}, format="json")
    assert resp.status_code == 200 and resp.json()["data"]["code"] == "FCT"


def test_category_rows_carry_title_count(librarian_client, category, book):
    row = librarian_client.get(f"{BASE}/categories/").json()["results"][0]
    assert row["title_count"] == 1


def test_category_delete_refused_with_titles_but_allowed_when_empty(librarian_client, category, book):
    resp = librarian_client.delete(f"{BASE}/categories/{category.pk}/")
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_has_history"
    empty = BookCategory.objects.create(school=category.school, name="Empty", code="EMP")
    assert librarian_client.delete(f"{BASE}/categories/{empty.pk}/").status_code == 204


# ---- accession -------------------------------------------------------------


def test_accession_creates_the_right_codes(librarian_client, category):
    resp = librarian_client.post(f"{BASE}/books/", wizard(category), format="json")
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert data["accession_code"] == "LIB-FIC-0001"
    assert [c["code"] for c in data["copies"]] == ["LIB-FIC-0001/C1", "LIB-FIC-0001/C2", "LIB-FIC-0001/C3"]
    assert data["copies_total"] == 3 and data["copies_available"] == 3 and data["availability_status"] == "available"
    assert all(c["status"] == "available" and c["condition"] == "new" for c in data["copies"])
    second = librarian_client.post(f"{BASE}/books/", wizard(category, title="Wonder 2"), format="json").json()["data"]
    assert second["accession_code"] == "LIB-FIC-0002"
    category.refresh_from_db()
    assert category.next_sequence == 2


def test_codes_are_per_category(librarian_client, category):
    other = BookCategory.objects.create(school=category.school, name="Science", code="SCI")
    librarian_client.post(f"{BASE}/books/", wizard(category), format="json")
    data = librarian_client.post(f"{BASE}/books/", wizard(other, title="Cells"), format="json").json()["data"]
    assert data["accession_code"] == "LIB-SCI-0001"


def test_accession_code_is_never_taken_from_the_client(librarian_client, category):
    resp = librarian_client.post(f"{BASE}/books/", wizard(category, accession_code="LIB-X-9999"), format="json")
    assert resp.status_code == 400 and "accession_code" in resp.json()["field_errors"]


def test_accession_writes_one_activity_row_without_personal_data(librarian_client, librarian, category):
    librarian_client.post(
        f"{BASE}/books/", wizard(category, source="donated", donor_name="Secret Donor", vendor_name="Acme"), format="json"
    )
    rows = list(LibraryActivityLog.objects.filter(school=librarian.school, event_type="accession"))
    assert len(rows) == 1 and rows[0].actor_id == librarian.pk and rows[0].book_id
    assert "Secret Donor" not in rows[0].summary and "Secret Donor" not in str(rows[0].metadata)


def test_audience_needs_at_least_one_flag(librarian_client, category):
    body = wizard(category, for_students=False, for_teachers=False, for_staff=False)
    resp = librarian_client.post(f"{BASE}/books/", body, format="json")
    assert resp.status_code == 400 and "for_students" in resp.json()["field_errors"]
    assert Book.objects.filter(title="Wonder").count() == 0


def test_inactive_category_is_refused_for_new_titles(librarian_client, category):
    category.is_active = False
    category.save()
    resp = librarian_client.post(f"{BASE}/books/", wizard(category), format="json")
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "library_category_inactive"


def test_inactive_category_stays_valid_on_existing_titles(librarian_client, category, book):
    category.is_active = False
    category.save()
    assert librarian_client.patch(f"{BASE}/books/{book.pk}/", {"rack": "R9"}, format="json").status_code == 200
    other = BookCategory.objects.create(school=category.school, name="Old", code="OLD", is_active=False)
    resp = librarian_client.patch(f"{BASE}/books/{book.pk}/", {"category": other.pk}, format="json")
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "library_category_inactive"


def test_required_wizard_fields(librarian_client, category):
    resp = librarian_client.post(f"{BASE}/books/", {"title": "Bare"}, format="json")
    assert resp.status_code == 400
    assert {"category", "copies_count"} <= set(resp.json()["field_errors"])
    zero = librarian_client.post(f"{BASE}/books/", wizard(category, copies_count=0), format="json")
    assert zero.status_code == 400 and "copies_count" in zero.json()["field_errors"]


def test_same_title_edition_or_part_is_a_duplicate_but_a_new_edition_is_not(librarian_client, category):
    assert librarian_client.post(f"{BASE}/books/", wizard(category, edition="1st"), format="json").status_code == 201
    dup = librarian_client.post(f"{BASE}/books/", wizard(category, edition="1st"), format="json")
    assert dup.status_code == 400 and "title" in dup.json()["field_errors"]
    assert librarian_client.post(f"{BASE}/books/", wizard(category, edition="2nd"), format="json").status_code == 201
    assert librarian_client.post(f"{BASE}/books/", wizard(category, part_label="Vol 2"), format="json").status_code == 201


def test_cross_school_category_is_a_field_error(librarian_client, other_category):
    resp = librarian_client.post(f"{BASE}/books/", wizard(other_category), format="json")
    assert resp.status_code == 400 and "category" in resp.json()["field_errors"]


def test_quantity_columns_are_never_written(librarian_client, category):
    data = librarian_client.post(f"{BASE}/books/", wizard(category), format="json").json()["data"]
    assert (data["quantity"], data["available_quantity"]) == (3, 3)  # derived aliases
    book = Book.objects.get(pk=data["id"])
    assert (book.quantity, book.available_quantity) == (0, 0)  # stored columns untouched
    resp = librarian_client.patch(f"{BASE}/books/{book.pk}/", {"quantity": 50}, format="json")
    assert resp.status_code == 200
    book.refresh_from_db()
    assert book.quantity == 0


def test_patch_keeps_the_accession_code_and_rejects_changing_it(librarian_client, category, book):
    other = BookCategory.objects.create(school=category.school, name="Science", code="SCI")
    resp = librarian_client.patch(f"{BASE}/books/{book.pk}/", {"category": other.pk, "title": "Renamed"}, format="json")
    assert resp.status_code == 200
    assert resp.json()["data"]["accession_code"] == book.accession_code and resp.json()["data"]["category"]["code"] == "SCI"
    bad = librarian_client.patch(f"{BASE}/books/{book.pk}/", {"accession_code": "X"}, format="json")
    assert bad.status_code == 400


# ---- add copies and withdraw -----------------------------------------------


def test_add_copies_appends_after_the_last_number(librarian_client, librarian, book):
    resp = librarian_client.post(f"{BASE}/books/{book.pk}/add-copies/", {"count": 2, "condition": "good"}, format="json")
    assert resp.status_code == 201
    assert resp.json()["added"] == [f"{book.accession_code}/C3", f"{book.accession_code}/C4"]
    assert resp.json()["data"]["copies_total"] == 4
    assert BookCopy.objects.filter(book=book, condition="good").count() == 2
    assert LibraryActivityLog.objects.filter(school=librarian.school, event_type="accession", metadata__added=2).count() == 1


def test_add_copies_never_reuses_a_withdrawn_number(librarian_client, book):
    last = book.copies.order_by("-id").first()
    assert librarian_client.post(f"{BASE}/copies/{last.pk}/withdraw/", {"reason": "Torn"}, format="json").status_code == 200
    resp = librarian_client.post(f"{BASE}/books/{book.pk}/add-copies/", {"count": 1}, format="json")
    assert resp.json()["added"] == [f"{book.accession_code}/C3"]
    assert book.copies.values("code").distinct().count() == 3


def test_copy_codes_are_unique_per_school(school, category, book):
    with pytest.raises(Exception):
        BookCopy.objects.create(school=school, book=book, code=book.copies.first().code)


def test_withdraw_only_when_available(librarian_client, librarian, book):
    copy = book.copies.first()
    resp = librarian_client.post(f"{BASE}/copies/{copy.pk}/withdraw/", {"reason": "Water damage"}, format="json")
    assert resp.status_code == 200 and resp.json()["data"]["status"] == "withdrawn"
    copy.refresh_from_db()
    assert copy.status == "withdrawn" and copy.withdrawn_reason == "Water damage"
    assert LibraryActivityLog.objects.filter(school=librarian.school, copy=copy).count() == 1
    again = librarian_client.post(f"{BASE}/copies/{copy.pk}/withdraw/", {"reason": "x"}, format="json")
    assert again.status_code == 409 and again.json()["error"]["code"] == "library_invalid_state_transition"
    issued = book.copies.exclude(pk=copy.pk).first()
    issued.status = "issued"
    issued.save()
    assert librarian_client.post(f"{BASE}/copies/{issued.pk}/withdraw/", {"reason": "x"}, format="json").status_code == 409


def test_withdraw_needs_a_reason(librarian_client, book):
    copy = book.copies.first()
    resp = librarian_client.post(f"{BASE}/copies/{copy.pk}/withdraw/", {}, format="json")
    assert resp.status_code == 400 and "reason" in resp.json()["field_errors"]


# ---- delete with history ---------------------------------------------------


def test_book_delete_refused_with_copies_or_loans(librarian_client, school, book, member):
    resp = librarian_client.delete(f"{BASE}/books/{book.pk}/")
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_has_history"
    assert Book.objects.filter(pk=book.pk).exists()


def test_book_delete_refused_with_a_legacy_loan_only(librarian_client, school, category, member):
    from apps.library.models import BookIssue

    legacy = Book.objects.create(school=school, category=category, title="Old", author="X", accession_code="LIB-FIC-0900")
    BookIssue.objects.create(school=school, book=legacy, member=member, issue_date="2026-01-01", due_date="2026-01-09")
    assert librarian_client.delete(f"{BASE}/books/{legacy.pk}/").status_code == 409


def test_a_title_with_nothing_attached_can_be_deleted(librarian_client, school, category):
    bare = Book.objects.create(school=school, category=category, title="Bare", author="X", accession_code="LIB-FIC-0901")
    assert librarian_client.delete(f"{BASE}/books/{bare.pk}/").status_code == 204


# ---- list, filters, ordering -----------------------------------------------


def test_list_row_shape(librarian_client, book):
    row = librarian_client.get(f"{BASE}/books/").json()["results"][0]
    assert {
        "id", "accession_code", "call_number", "title", "edition", "part_label", "author", "category", "age_band",
        "for_students", "for_teachers", "for_staff", "cost_per_copy", "copies_total", "copies_available",
        "copies_lost", "copies_damaged", "copies_withdrawn", "availability_status", "is_reference_only", "rack",
        "holds_waiting",
    } <= set(row)
    assert row["category"] == {"id": book.category_id, "name": "Fiction", "code": "FIC", "color_key": ""}
    assert "donor_name" not in row and "remarks" not in row


def test_counts_by_status(librarian_client, book):
    copies = list(book.copies.all())
    book.copies.filter(pk=copies[0].pk).update(status="lost")
    add = librarian_client.post(f"{BASE}/books/{book.pk}/add-copies/", {"count": 3}, format="json")
    new = BookCopy.objects.filter(book=book).order_by("-id")
    new[0].__class__.objects.filter(pk=new[0].pk).update(status="damaged")
    new[1].__class__.objects.filter(pk=new[1].pk).update(status="withdrawn")
    row = librarian_client.get(f"{BASE}/books/{book.pk}/").json()["data"]
    assert (row["copies_total"], row["copies_available"], row["copies_lost"], row["copies_damaged"], row["copies_withdrawn"]) == (4, 2, 1, 1, 1)
    assert add.status_code == 201


def _titles(client, query):
    return sorted(r["title"] for r in client.get(f"{BASE}/books/?{query}").json()["results"])


def test_availability_filter_uses_the_low_stock_ratio(librarian_client, school, category):
    plenty = make_book(school, category, title="Plenty", copies=10)
    low = make_book(school, category, title="Low", copies=3)  # 1 of 3 = 0.33 <= 0.34
    gone = make_book(school, category, title="Gone", copies=2)
    low.copies.exclude(pk=low.copies.first().pk).update(status="issued")
    gone.copies.update(status="issued")
    assert _titles(librarian_client, "availability=available") == ["Plenty"]
    assert _titles(librarian_client, "availability=low") == ["Low"]
    assert _titles(librarian_client, "availability=issued") == ["Gone"]
    statuses = {r["title"]: r["availability_status"] for r in librarian_client.get(f"{BASE}/books/").json()["results"]}
    assert statuses == {"Plenty": "available", "Low": "low", "Gone": "issued"}
    assert plenty and librarian_client.get(f"{BASE}/books/?availability=nope").status_code == 400


def test_other_filters_and_search(librarian_client, school, category):
    science = BookCategory.objects.create(school=school, name="Science", code="SCI")
    make_book(school, category, title="Tales", age_band="early_years", format="fiction", rack="A1", for_teachers=False, for_staff=False)
    ref = make_book(school, science, title="Atlas", author="Maps Ltd", age_band="senior", is_reference_only=True, rack="B2")
    BookCopy.objects.filter(book=ref).update(condition="worn")
    c = librarian_client
    assert _titles(c, f"category={science.pk}") == ["Atlas"]
    assert _titles(c, "age_band=early_years") == ["Tales"]
    assert _titles(c, "format=fiction") == ["Tales"]
    assert _titles(c, "rack=B2") == ["Atlas"]
    assert _titles(c, "is_reference_only=true") == ["Atlas"]
    assert _titles(c, "for_teachers=false") == ["Tales"]
    assert _titles(c, "condition=worn") == ["Atlas"]
    assert c.get(f"{BASE}/books/?condition=weird").status_code == 400
    assert _titles(c, "search=maps") == ["Atlas"]
    assert _titles(c, f"search={ref.accession_code}") == ["Atlas"]


def test_ordering_by_derived_counts(librarian_client, school, category):
    make_book(school, category, title="Few", copies=1)
    make_book(school, category, title="Many", copies=5)
    rows = librarian_client.get(f"{BASE}/books/?ordering=-copies_total").json()["results"]
    assert [r["title"] for r in rows] == ["Many", "Few"]


def test_books_list_query_count_is_bounded(librarian_client, school, category, django_assert_max_num_queries):
    for number in range(30):
        make_book(school, category, title=f"Title {number}", copies=2)
    librarian_client.get(f"{BASE}/books/")  # creates the settings row
    with django_assert_max_num_queries(8):
        resp = librarian_client.get(f"{BASE}/books/?page_size=50")
    assert resp.json()["count"] == 30 and len(resp.json()["results"]) == 30


def test_copies_list_query_count_is_bounded(librarian_client, school, category, django_assert_max_num_queries):
    make_book(school, category, title="Many copies", copies=30)
    with django_assert_max_num_queries(7):
        resp = librarian_client.get(f"{BASE}/copies/?page_size=50")
    assert resp.json()["count"] == 30


# ---- lookup, copies, by-code ------------------------------------------------


def test_lookup_by_text_and_exact_copy_code_first(librarian_client, school, category, book):
    other = make_book(school, category, title="Treasure Hunt", author="Someone", copies=1)
    rows = librarian_client.get(f"{BASE}/books/lookup/?q=treasure").json()["results"]
    assert {r["title"] for r in rows} == {"Treasure Island", "Treasure Hunt"}
    first = librarian_client.get(f"{BASE}/books/lookup/", {"q": other.copies.first().code.lower()}).json()["results"]
    assert first[0]["id"] == other.pk and first[0]["matched_copy"]["code"] == other.copies.first().code
    assert {"copies_available", "is_reference_only"} <= set(first[0])
    assert librarian_client.get(f"{BASE}/books/lookup/?q=").json()["results"] == []


def test_lookup_is_capped_at_ten_and_school_scoped(librarian_client, school, category, other_book):
    for number in range(12):
        make_book(school, category, title=f"Alpha {number}", copies=1)
    assert len(librarian_client.get(f"{BASE}/books/lookup/?q=alpha&limit=50").json()["results"]) == 10
    assert librarian_client.get(f"{BASE}/books/lookup/?q=kidnapped").json()["results"] == []
    # the other school's copy code is not found through this school (codes repeat across schools)
    found = librarian_client.get(f"{BASE}/books/lookup/", {"q": other_book.copies.first().code}).json()["results"]
    assert other_book.pk not in [row["id"] for row in found]


def test_book_copies_register_and_copies_list(librarian_client, book):
    register = librarian_client.get(f"{BASE}/books/{book.pk}/copies/").json()
    assert [c["code"] for c in register["results"]] == [f"{book.accession_code}/C1", f"{book.accession_code}/C2"]
    assert register["results"][0]["book_title"] == "Treasure Island"
    assert librarian_client.get(f"{BASE}/copies/?book={book.pk}&status=available").json()["count"] == 2
    assert librarian_client.get(f"{BASE}/copies/?search=C2").json()["count"] == 1


def test_by_code_handles_the_slash_in_a_code(librarian_client, book):
    code = book.copies.first().code
    resp = librarian_client.get(f"{BASE}/copies/by-code/{code}/")
    assert resp.status_code == 200 and resp.json()["data"]["code"] == code
    assert librarian_client.get(f"{BASE}/copies/by-code/{code.lower()}/").status_code == 200
    assert librarian_client.get(f"{BASE}/copies/by-code/NOPE/C1/").status_code == 404


def test_copy_patch_edits_condition_only(librarian_client, book):
    copy = book.copies.first()
    ok = librarian_client.patch(f"{BASE}/copies/{copy.pk}/", {"condition": "worn"}, format="json")
    assert ok.status_code == 200 and ok.json()["data"]["condition"] == "worn"
    for body in ({"status": "lost"}, {"code": "X"}, {"condition": "worn", "withdrawn_reason": "x"}):
        assert librarian_client.patch(f"{BASE}/copies/{copy.pk}/", body, format="json").status_code == 400
    copy.refresh_from_db()
    assert copy.status == "available"


def test_copies_cannot_be_created_replaced_or_deleted_directly(librarian_client, book):
    copy = book.copies.first()
    assert librarian_client.post(f"{BASE}/copies/", {"book": book.pk, "code": "X"}, format="json").status_code == 405
    assert librarian_client.put(f"{BASE}/copies/{copy.pk}/", {"condition": "new"}, format="json").status_code == 405
    assert librarian_client.delete(f"{BASE}/copies/{copy.pk}/").status_code == 405


# ---- scoping and permissions ------------------------------------------------


def test_cross_school_copy_and_book_actions_are_404(admin_user, other_book):
    client = client_for(admin_user)
    copy = other_book.copies.first()
    assert client.get(f"{BASE}/copies/{copy.pk}/").status_code == 404
    assert client.get(f"{BASE}/copies/by-code/{copy.code}/").status_code == 404
    assert client.post(f"{BASE}/copies/{copy.pk}/withdraw/", {"reason": "x"}, format="json").status_code == 404
    assert client.patch(f"{BASE}/copies/{copy.pk}/", {"condition": "worn"}, format="json").status_code == 404
    assert client.post(f"{BASE}/books/{other_book.pk}/add-copies/", {"count": 1}, format="json").status_code == 404
    assert client.get(f"{BASE}/books/{other_book.pk}/copies/").status_code == 404
    copy.refresh_from_db()
    assert copy.status == "available"


@pytest.mark.parametrize(
    "code,call,expected",
    [
        ("library.books.create", lambda c, b, k: c.post(f"{BASE}/books/", wizard(k), format="json"), 201),
        ("library.books.update", lambda c, b, k: c.patch(f"{BASE}/books/{b.pk}/", {"rack": "Z"}, format="json"), 200),
        ("library.books.update", lambda c, b, k: c.post(f"{BASE}/books/{b.pk}/add-copies/", {"count": 1}, format="json"), 201),
        ("library.books.delete", lambda c, b, k: c.delete(f"{BASE}/books/{b.pk}/"), 409),
        ("library.books.view", lambda c, b, k: c.get(f"{BASE}/books/{b.pk}/"), 200),
        ("library.book_copies.view", lambda c, b, k: c.get(f"{BASE}/books/{b.pk}/copies/"), 200),
        ("library.book_copies.view", lambda c, b, k: c.get(f"{BASE}/copies/"), 200),
        ("library.book_copies.update", lambda c, b, k: c.patch(f"{BASE}/copies/{b.copies.first().pk}/", {"condition": "fair"}, format="json"), 200),
        ("library.book_copies.withdraw", lambda c, b, k: c.post(f"{BASE}/copies/{b.copies.first().pk}/withdraw/", {"reason": "r"}, format="json"), 200),
        ("library.book_issues.view", lambda c, b, k: c.get(f"{BASE}/books/lookup/?q=treasure"), 200),
    ],
)
def test_each_endpoint_needs_its_own_code(school, category, book, code, call, expected):
    assert call(client_for(make_user(school, [code])), book, category).status_code == expected
    # a user holding only an unrelated library code is refused
    wrong = "library.reports.view"
    assert call(client_for(make_user(school, [wrong])), book, category).status_code == 403


def test_view_only_user_cannot_change_the_catalogue(view_only_client, book, category):
    assert view_only_client.get(f"{BASE}/books/").status_code == 200
    assert view_only_client.post(f"{BASE}/books/", wizard(category), format="json").status_code == 403
    assert view_only_client.post(f"{BASE}/books/{book.pk}/add-copies/", {"count": 1}, format="json").status_code == 403
    assert view_only_client.get(f"{BASE}/copies/").status_code == 403  # book_copies.view is a new code


def test_unauthenticated_catalogue_calls_are_401(api_client, book):
    for path in ("books/", "books/lookup/?q=a", "copies/", f"books/{book.pk}/copies/"):
        assert api_client.get(f"{BASE}/{path}").status_code == 401
