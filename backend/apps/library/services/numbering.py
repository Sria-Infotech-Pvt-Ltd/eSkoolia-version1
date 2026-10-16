"""Sequences and codes. Everything that increments a counter does it under a row lock."""
from apps.library.models import Book, BookCategory

from .codes import code_from_name, format_accession_code


def derive_category_code(school, name, exclude_pk=None):
    """A prefix for `name` that no other category of the school uses."""
    taken = BookCategory.objects.filter(school=school)
    if exclude_pk:
        taken = taken.exclude(pk=exclude_pk)
    return code_from_name(name, taken.values_list("code", flat=True))


def next_accession_code(school, category_id):
    """Lock the category row, advance its counter and return (category, accession_code).

    Must run inside the caller's ``transaction.atomic()`` so the lock lasts until
    the book row that uses the code is committed. The existence check skips a
    code that is somehow already taken (for example a hand-entered one) rather
    than failing the accession.
    """
    category = BookCategory.objects.select_for_update().get(pk=category_id, school=school)
    while True:
        category.next_sequence += 1
        code = format_accession_code(category.code, category.next_sequence)
        if not Book.objects.filter(school=school, accession_code=code).exists():
            break
    category.save(update_fields=["next_sequence", "updated_at"])
    return category, code


def _next_counter_number(school, field, prefix, model, number_field):
    """Lock the school's settings row, advance `field` and return the next unused "<prefix>-<n:04d>".

    Must run inside the caller's ``transaction.atomic()`` so the lock lasts until the row that uses
    the number is committed. A number that is somehow taken already (typed in by hand) is skipped.
    """
    from apps.library.models import LibrarySettings

    from .settings import get_settings

    get_settings(school)  # make sure the row exists before locking it
    row = LibrarySettings.objects.select_for_update().get(school=school)
    while True:
        setattr(row, field, getattr(row, field) + 1)
        number = f"{prefix}-{getattr(row, field):04d}"
        if not model.objects.filter(school=school, **{number_field: number}).exists():
            break
    row.save(update_fields=[field, "updated_at"])
    return number


def next_po_number(school):
    from apps.library.models import PurchaseOrder

    return _next_counter_number(school, "po_sequence", "PO", PurchaseOrder, "po_number")


def next_receipt_number(school):
    from apps.library.models import Donation

    return _next_counter_number(school, "donation_receipt_sequence", "DR", Donation, "receipt_no")
