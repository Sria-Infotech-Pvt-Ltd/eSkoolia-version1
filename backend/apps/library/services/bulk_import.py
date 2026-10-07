"""Bulk import of titles (blueprint 2.4, 4.8).

`validate_rows` is the single source of truth: the preview endpoint shows its
output and the commit endpoint re-runs it, so a tampered preview is never
trusted. Text cells are neutralised against spreadsheet formula injection.
"""
import re
from decimal import Decimal, InvalidOperation

from django.db import transaction

from apps.library.models import (
    Book,
    BookCategory,
    BookCopy,
    LibraryActivityLog,
    LibrarySettings,
)

from .accession import create_book_with_copies
from .activity import log_event
from .settings import get_settings

MAX_ROWS = 500
MAX_COPIES_PER_ROW = 500
MAX_COPIES_PER_BATCH = 5000
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
MAX_COST = Decimal("9999999999.99")
TITLE_MAX = Book._meta.get_field("title").max_length
AUTHOR_MAX = Book._meta.get_field("author").max_length


def neutralise(value):
    """Prefix an apostrophe when a cell starts with a formula character, so it is text in any spreadsheet."""
    return "'" + value if value.startswith(FORMULA_PREFIXES) else value


def _text(raw):
    return "" if raw is None else re.sub(r"\s+", " ", str(raw)).strip(" ")


def _copies(raw):
    if raw is None or str(raw).strip() == "":
        return 1, None
    text = str(raw).strip()
    if not re.fullmatch(r"\d{1,6}", text) or not (1 <= int(text) <= MAX_COPIES_PER_ROW):
        return None, f"Copies must be a whole number from 1 to {MAX_COPIES_PER_ROW}"
    return int(text), None


def _cost(raw):
    if raw is None or str(raw).strip() == "":
        return Decimal("0.00"), None
    try:
        value = Decimal(str(raw).strip())
    except InvalidOperation:
        return None, "Cost must be a number of 0 or more"
    if not value.is_finite() or value < 0 or value > MAX_COST:
        return None, "Cost must be a number of 0 or more"
    return value.quantize(Decimal("0.01")), None


def validate_rows(school, rows):
    """Return one dict per input row: normalised values, `valid` and `error` (None when valid)."""
    categories = {c.name.lower(): c for c in BookCategory.objects.filter(school=school)}
    existing = {
        (title.lower(), author.lower()): code
        for title, author, code in Book.objects.filter(school=school, edition="", part_label="").values_list(
            "title", "author", "accession_code"
        )
    }
    seen = set()
    out = []
    for number, raw in enumerate(rows, start=1):
        row = {"row": number, "title": "", "author": "", "category": "", "category_id": None,
               "copies": 1, "cost": "0.00", "valid": False, "error": None}
        out.append(row)
        if not isinstance(raw, dict):
            row["error"] = "Row must be an object"
            continue
        title, author, category_name = _text(raw.get("title")), _text(raw.get("author")), _text(raw.get("category"))
        copies, copies_error = _copies(raw.get("copies"))
        cost, cost_error = _cost(raw.get("cost"))
        row.update(title=neutralise(title), author=neutralise(author), category=neutralise(category_name))
        if copies is not None:
            row["copies"] = copies
        if cost is not None:
            row["cost"] = str(cost)

        category = categories.get(category_name.lower()) if category_name else None
        if not title:
            row["error"] = "Missing title"
        elif len(row["title"]) > TITLE_MAX or len(row["author"]) > AUTHOR_MAX:
            row["error"] = "Title or author is too long"
        elif category is None:
            row["error"] = f'Unrecognised category "{row["category"]}"'
        elif not category.is_active:
            row["error"] = f'Category "{category.name}" is inactive'
        elif copies_error or cost_error:
            row["error"] = copies_error or cost_error
        else:
            identity = (row["title"].lower(), row["author"].lower())
            if identity in existing:
                row["error"] = f"Title already exists ({existing[identity]})" if existing[identity] else "Title already exists"
            elif identity in seen:
                row["error"] = "Duplicate of an earlier row in this import"
            else:
                seen.add(identity)
                row["category_id"] = category.pk
                row["valid"] = True
        if not row["valid"] and category is not None:
            row["category_id"] = category.pk
    return out


def preview(school, rows):
    checked = validate_rows(school, rows)
    valid = sum(1 for r in checked if r["valid"])
    return {"rows": checked, "valid_count": valid, "invalid_count": len(checked) - valid}


def _find_batch(school, batch_id):
    return LibraryActivityLog.objects.filter(
        school=school, event_type=LibraryActivityLog.EVENT_ACCESSION, metadata__client_batch_id=batch_id
    ).first()


@transaction.atomic
def commit(school, actor, rows, client_batch_id):
    """Create every valid row in one transaction. Returns (result, replayed).

    result = {"created": [{"id", "accession_code", "copies"}], "skipped": [{"row", "error"}]}.
    A repeated `client_batch_id` returns the stored first result and creates nothing.
    """
    batch_id = str(client_batch_id)
    # Serialise commits per school so two requests with one batch id cannot both pass the check.
    LibrarySettings.objects.select_for_update().get(pk=get_settings(school).pk)
    previous = _find_batch(school, batch_id)
    if previous is not None:
        return {"created": previous.metadata.get("created", []), "skipped": previous.metadata.get("skipped", [])}, True

    created, skipped = [], []
    for row in validate_rows(school, rows):
        if not row["valid"]:
            skipped.append({"row": row["row"], "error": row["error"]})
            continue
        category = BookCategory.objects.get(pk=row["category_id"], school=school)
        book, copies = create_book_with_copies(
            school, actor,
            {"category": category, "title": row["title"], "author": row["author"], "cost_per_copy": Decimal(row["cost"])},
            row["copies"], BookCopy.CONDITION_NEW, log=False,
        )
        created.append({"id": book.pk, "accession_code": book.accession_code, "copies": len(copies)})
    log_event(
        school, actor, LibraryActivityLog.EVENT_ACCESSION,
        f"Bulk import: {len(created)} title(s), {sum(c['copies'] for c in created)} cop(ies), {len(skipped)} skipped",
        metadata={"action": "bulk_import", "client_batch_id": batch_id, "created": created, "skipped": skipped},
    )
    return {"created": created, "skipped": skipped}, False
