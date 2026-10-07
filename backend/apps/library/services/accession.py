"""Accession: creating titles with copies, appending copies, withdrawing a copy.

Services take `school` and `actor` explicitly and never read a request. Each one
runs in a single transaction and writes its activity row inside it.
"""
from django.db import transaction

from apps.library.exceptions import (
    LibraryCategoryInactive,
    LibraryInvalidStateTransition,
)
from apps.library.models import Book, BookCopy, LibraryActivityLog

from .activity import log_event
from .codes import copy_number_from_code, format_copy_code
from .numbering import next_accession_code

# Fields a client may set on a title. accession_code, counters and the
# deprecated quantities are never accepted.
BOOK_FIELDS = (
    "title", "author", "isbn", "publisher", "publication_year", "language", "age_band",
    "for_students", "for_teachers", "for_staff", "format", "is_reference_only", "cost_per_copy",
    "edition", "part_label", "source", "vendor_name", "donor_name", "rack", "remarks", "call_number",
)


def _new_copies(school, actor, book, first_number, count, condition):
    copies = [
        BookCopy(
            school=school,
            book=book,
            code=format_copy_code(book.accession_code, number),
            status=BookCopy.STATUS_AVAILABLE,
            condition=condition,
            created_by=actor,
            updated_by=actor,
        )
        for number in range(first_number, first_number + count)
    ]
    return BookCopy.objects.bulk_create(copies)


@transaction.atomic
def create_book_with_copies(school, actor, data, copies_count, condition=BookCopy.CONDITION_NEW, log=True):
    """One transaction: lock the category, take the next sequence, create the title and its copies, log it.

    `data` holds the title fields plus `category` (a BookCategory of `school`).
    Returns (book, copies). Bulk import passes ``log=False`` and writes one row per batch.
    """
    category, accession_code = next_accession_code(school, data["category"].pk)
    if not category.is_active:
        raise LibraryCategoryInactive()
    book = Book.objects.create(
        school=school,
        category=category,
        accession_code=accession_code,
        created_by=actor,
        updated_by=actor,
        **{name: data[name] for name in BOOK_FIELDS if name in data},
    )
    copies = _new_copies(school, actor, book, 1, copies_count, condition)
    if log:
        log_event(
            school,
            actor,
            LibraryActivityLog.EVENT_ACCESSION,
            f"Accessioned {book.title} ({accession_code}) with {copies_count} cop{'y' if copies_count == 1 else 'ies'}",
            book=book,
            metadata={"book_id": book.pk, "accession_code": accession_code, "copies": copies_count},
        )
    return book, copies


@transaction.atomic
def add_copies(school, actor, book_id, count, condition=BookCopy.CONDITION_NEW):
    """Append `count` copies C(n+1)... to a title. The title row is locked so numbers never collide."""
    book = Book.objects.select_for_update().get(pk=book_id, school=school)
    if not book.accession_code:
        raise ValueError("Title has no accession code; run the catalogue backfill first")
    last = max((copy_number_from_code(code) for code in book.copies.values_list("code", flat=True)), default=0)
    copies = _new_copies(school, actor, book, last + 1, count, condition)
    log_event(
        school,
        actor,
        LibraryActivityLog.EVENT_ACCESSION,
        f"Added {count} cop{'y' if count == 1 else 'ies'} to {book.title} ({book.accession_code})",
        book=book,
        metadata={"book_id": book.pk, "added": count, "first": copies[0].code, "last": copies[-1].code},
    )
    return book, copies


@transaction.atomic
def withdraw_copy(school, actor, copy_id, reason):
    """Withdraw a copy from circulation. Only an available copy can be withdrawn."""
    copy = BookCopy.objects.select_for_update().select_related("book").get(pk=copy_id, school=school)
    if copy.status != BookCopy.STATUS_AVAILABLE:
        raise LibraryInvalidStateTransition(
            f"Only an available copy can be withdrawn; this copy is {copy.status}."
        )
    copy.status = BookCopy.STATUS_WITHDRAWN
    copy.withdrawn_reason = reason
    copy.updated_by = actor
    copy.save(update_fields=["status", "withdrawn_reason", "updated_by", "updated_at"])
    log_event(
        school,
        actor,
        LibraryActivityLog.EVENT_ACCESSION,
        f"Withdrew copy {copy.code} of {copy.book.title}",
        book=copy.book,
        copy=copy,
        metadata={"book_id": copy.book_id, "copy_id": copy.pk, "action": "withdraw"},
    )
    return copy

