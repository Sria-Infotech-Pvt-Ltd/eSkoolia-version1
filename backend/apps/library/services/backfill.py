"""Catalogue backfill for rows that predate accession codes and copies (blueprint section 5, step 3).

Runs from migration 0004 with the historical models, and can be called with
``django.apps.apps`` in tests. It is idempotent: it only touches categories
without a code, books without a code, and books without any copy. It writes no
files and never fails on a count mismatch; ``find_reconcile_mismatches`` (used
by the library_reconcile command) reports those for a human.

Loan binding (which open loan holds which copy) is NOT done here. Open loans
only decide how many copies start as issued, and lost loans how many start as
lost. Prompt 5 binds loans to copies.
"""
from django.db.models import Count, Q

from .codes import code_from_name, format_accession_code, format_copy_code

UNCATEGORISED_NAME = "Uncategorised"


def _assign_category_codes(BookCategory, school_id):
    taken = set(BookCategory.objects.filter(school_id=school_id).exclude(code="").values_list("code", flat=True))
    for category in BookCategory.objects.filter(school_id=school_id, code="").order_by("id"):
        category.code = code_from_name(category.name, taken)
        taken.add(category.code)
        category.save(update_fields=["code"])


def _uncategorised(BookCategory, school_id):
    category = BookCategory.objects.filter(school_id=school_id, name=UNCATEGORISED_NAME).first()
    if category is None:
        taken = set(BookCategory.objects.filter(school_id=school_id).values_list("code", flat=True))
        category = BookCategory.objects.create(
            school_id=school_id, name=UNCATEGORISED_NAME, code=code_from_name(UNCATEGORISED_NAME, taken)
        )
    return category


def _next_free_accession(Book, category):
    while True:
        category.next_sequence += 1
        code = format_accession_code(category.code, category.next_sequence)
        if not Book.objects.filter(school_id=category.school_id, accession_code=code).exists():
            return code


def backfill_catalogue(apps_registry):
    """Backfill every school. Returns the reconcile mismatches (also see find_reconcile_mismatches)."""
    BookCategory = apps_registry.get_model("library", "BookCategory")
    Book = apps_registry.get_model("library", "Book")
    BookCopy = apps_registry.get_model("library", "BookCopy")

    school_ids = set(Book.objects.values_list("school_id", flat=True)) | set(
        BookCategory.objects.values_list("school_id", flat=True)
    )
    for school_id in sorted(school_ids):
        _assign_category_codes(BookCategory, school_id)

        orphans = Book.objects.filter(school_id=school_id, category__isnull=True)
        if orphans.exists():
            orphans.update(category=_uncategorised(BookCategory, school_id))

        categories = {}  # one shared instance per category so next_sequence advances across its books
        for book in Book.objects.filter(school_id=school_id, accession_code="").select_related("category").order_by("id"):
            category = categories.setdefault(book.category_id, book.category)
            book.accession_code = _next_free_accession(Book, category)
            book.save(update_fields=["accession_code"])
            category.save(update_fields=["next_sequence"])

        books = (
            Book.objects.filter(school_id=school_id)
            .annotate(
                n_copies=Count("copies", distinct=True),
                n_open=Count("issues", filter=Q(issues__status="issued"), distinct=True),
                n_lost=Count("issues", filter=Q(issues__status="lost"), distinct=True),
            )
            .filter(n_copies=0)
            .order_by("id")
        )
        for book in books:
            total = max(book.quantity, book.n_open + book.n_lost)
            statuses = ["lost"] * book.n_lost + ["issued"] * book.n_open
            statuses += ["available"] * (total - len(statuses))
            BookCopy.objects.bulk_create(
                BookCopy(
                    school_id=school_id,
                    book=book,
                    code=format_copy_code(book.accession_code, number),
                    status=status,
                )
                for number, status in enumerate(statuses, start=1)
            )
    return find_reconcile_mismatches(Book, BookCopy)


def find_reconcile_mismatches(Book, BookCopy):
    """Legacy titles (quantity above 0) whose old available_quantity differs from the derived available copies.

    New titles never write the old counters, so they are excluded. After circulation
    resumes on the copy model the two numbers drift legitimately: run the check
    straight after migrating.
    """
    rows = []
    books = (
        Book.objects.filter(quantity__gt=0)
        .annotate(derived_available=Count("copies", filter=Q(copies__status="available")))
        .order_by("school_id", "id")
    )
    for book in books:
        if book.available_quantity != book.derived_available:
            rows.append(
                {
                    "school_id": book.school_id,
                    "book_id": book.id,
                    "accession_code": book.accession_code,
                    "title": book.title,
                    "old_available": book.available_quantity,
                    "derived_available": book.derived_available,
                }
            )
    return rows
