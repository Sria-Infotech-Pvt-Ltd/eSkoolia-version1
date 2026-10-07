"""Catalogue backfill, reconcile command, numbering and (Postgres only) concurrent accession.

Legacy rows are built by hand: blank codes, null category, and the old counters.
The unique constraints on code and accession code (added by migration 0005, after
the backfill) forbid two blank-coded rows in one school, so each scenario adds
its legacy rows one at a time or uses a separate school.
"""
import threading
from io import StringIO

import pytest
from django.apps import apps as django_apps
from django.core.management import call_command
from django.db import connection

from apps.library.models import Book, BookCategory, BookCopy, BookIssue
from apps.library.services.backfill import backfill_catalogue
from apps.library.services.codes import code_from_name, copy_number_from_code
from apps.library.services.numbering import derive_category_code, next_accession_code
from apps.library.tests.conftest import make_book, make_member


def legacy_book(school, title, quantity, available, category=None):
    return Book.objects.create(
        school=school, category=category, title=title, author="Legacy", quantity=quantity, available_quantity=available
    )


def loans(school, book, member, *statuses):
    for status in statuses:
        BookIssue.objects.create(
            school=school, book=book, member=member, issue_date="2026-01-01", due_date="2026-01-15", status=status
        )


def copies_of(book):
    return [(c.code, c.status) for c in BookCopy.objects.filter(book=book).order_by("id")]


def test_backfill_codes_uncategorised_and_copies(school, member):
    book = legacy_book(school, "Orphan", quantity=3, available=1)  # null category
    loans(school, book, member, "issued", "lost", "returned")
    mismatches = backfill_catalogue(django_apps)

    book.refresh_from_db()
    unc = BookCategory.objects.get(school=school, name="Uncategorised")
    assert unc.code == "UNC" and book.category_id == unc.pk
    assert book.accession_code == "LIB-UNC-0001" and unc.next_sequence == 1
    assert copies_of(book) == [
        ("LIB-UNC-0001/C1", "lost"), ("LIB-UNC-0001/C2", "issued"), ("LIB-UNC-0001/C3", "available"),
    ]
    assert book.age_band == "primary" and (book.for_students, book.for_teachers, book.for_staff) == (True, True, True)
    assert book.format == "non_fiction" and book.cost_per_copy == 0 and book.source == "purchased"
    assert mismatches == []  # old available 1 equals derived available 1


def test_backfill_continues_sequences_and_reports_mismatches(school, member):
    fiction = BookCategory.objects.create(school=school, name="Fiction")  # no code yet
    first = legacy_book(school, "One", quantity=2, available=2, category=fiction)
    loans(school, first, member, "issued")  # one copy is out, so derived available is 1, not 2
    mismatches = backfill_catalogue(django_apps)
    fiction.refresh_from_db()
    assert fiction.code == "FIC"
    assert [row["book_id"] for row in mismatches] == [first.pk]
    assert (mismatches[0]["old_available"], mismatches[0]["derived_available"]) == (2, 1)

    second = legacy_book(school, "Two", quantity=1, available=1, category=fiction)
    backfill_catalogue(django_apps)
    first.refresh_from_db()
    second.refresh_from_db()
    assert (first.accession_code, second.accession_code) == ("LIB-FIC-0001", "LIB-FIC-0002")
    assert copies_of(second) == [("LIB-FIC-0002/C1", "available")]


def test_backfill_gives_colliding_names_distinct_codes(school):
    BookCategory.objects.create(school=school, name="Fiction", code="")
    backfill_catalogue(django_apps)
    BookCategory.objects.create(school=school, name="Fiction Two", code="")
    backfill_catalogue(django_apps)
    assert sorted(BookCategory.objects.filter(school=school).values_list("code", flat=True)) == ["FIC", "FIC2"]


def test_backfill_makes_a_copy_for_every_loan_even_if_quantity_is_too_low(other_school, other_category):
    member = make_member(other_school, "C-2")
    book = legacy_book(other_school, "Overbooked", quantity=1, available=0, category=other_category)
    loans(other_school, book, member, "issued", "issued")
    backfill_catalogue(django_apps)
    assert [status for _code, status in copies_of(book)] == ["issued", "issued"]


def test_backfill_is_idempotent_and_leaves_new_books_alone(school, category, book, member):
    before = (book.accession_code, copies_of(book))
    legacy = legacy_book(school, "Legacy", quantity=1, available=1, category=category)
    backfill_catalogue(django_apps)
    backfill_catalogue(django_apps)
    book.refresh_from_db()
    assert (book.accession_code, copies_of(book)) == before
    assert BookCopy.objects.filter(book=legacy).count() == 1
    assert BookCopy.objects.filter(book=book).count() == 2


def test_library_reconcile_is_read_only_and_lists_differences(school, member):
    fiction = BookCategory.objects.create(school=school, name="Fiction")
    book = legacy_book(school, "Mismatch", 2, 2, category=fiction)
    loans(school, book, member, "issued")
    backfill_catalogue(django_apps)
    snapshot = list(BookCopy.objects.values_list("id", "status"))

    out = StringIO()
    call_command("library_reconcile", stdout=out)
    text = out.getvalue()
    assert "Mismatch" in text and "LIB-FIC-0001" in text and "| 2 | 1 |" in text
    assert "Nothing was changed" in text
    assert list(BookCopy.objects.values_list("id", "status")) == snapshot

    scoped = StringIO()
    call_command("library_reconcile", "--school", "999999", stdout=scoped)
    assert "No mismatches" in scoped.getvalue()


def test_library_reconcile_ignores_titles_created_after_the_backfill(school, category, book):
    out = StringIO()
    call_command("library_reconcile", stdout=out)
    assert "No mismatches" in out.getvalue()


# ---- numbering -----------------------------------------------------------------


@pytest.mark.parametrize(
    "name,taken,expected",
    [
        ("Fiction", [], "FIC"),
        ("Fiction", ["FIC"], "FIC2"),
        ("Fiction", ["FIC", "FIC2"], "FIC3"),
        ("fiction", ["fic"], "FIC2"),
        ("A", [], "A"),
        ("!!", [], "CAT"),
        ("Uncategorised", [], "UNC"),
    ],
)
def test_code_from_name(name, taken, expected):
    assert code_from_name(name, taken) == expected


def test_derive_category_code_ignores_other_schools_and_self(school, other_school, category):
    assert derive_category_code(other_school, "Fiction") == "FIC"
    assert derive_category_code(school, "Fiction") == "FIC2"
    assert derive_category_code(school, "Fiction", exclude_pk=category.pk) == "FIC"


def test_copy_number_from_code():
    assert copy_number_from_code("LIB-FIC-0001/C12") == 12 and copy_number_from_code("junk") == 0


def test_next_accession_code_advances_and_formats(school, category):
    assert next_accession_code(school, category.pk)[1] == "LIB-FIC-0001"
    assert next_accession_code(school, category.pk)[1] == "LIB-FIC-0002"
    category.refresh_from_db()
    assert category.next_sequence == 2


def test_next_accession_code_skips_a_code_that_is_already_taken(school, category):
    Book.objects.create(school=school, category=category, title="Manual", author="x", accession_code="LIB-FIC-0001")
    assert next_accession_code(school, category.pk)[1] == "LIB-FIC-0002"


def test_next_accession_code_is_scoped_to_the_school(other_school, category):
    from django.core.exceptions import ObjectDoesNotExist

    with pytest.raises(ObjectDoesNotExist):
        next_accession_code(other_school, category.pk)


@pytest.mark.skipif(connection.vendor != "postgresql", reason="needs real row locks (PostgreSQL)")
@pytest.mark.django_db(transaction=True)
def test_concurrent_accession_in_one_category_never_repeats_a_code(school, category):
    """Unverified on SQLite: ten threads accession into one category and every code must be distinct."""
    from django.db import connections

    results, errors = [], []

    def worker(number):
        try:
            book = make_book(school, category, title=f"Concurrent {number}", copies=1)
            results.append(book.accession_code)
        except Exception as exc:  # pragma: no cover
            errors.append(exc)
        finally:
            connections.close_all()

    threads = [threading.Thread(target=worker, args=(n,)) for n in range(10)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert not errors
    assert len(set(results)) == 10
    category.refresh_from_db()
    assert category.next_sequence == 10
