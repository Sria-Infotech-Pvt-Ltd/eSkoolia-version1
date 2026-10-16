"""
Management command: python manage.py library_reconcile

READ-ONLY. Three checks, all printed with ids or counts only:

1. Stock: legacy titles whose old ``available_quantity`` differs from the number of available
   copies the catalogue backfill derived. The derived copy state is the truth. This check needs the
   old columns, so it runs only until migration 0014 (cleanup) has dropped them; after that it says so.
2. Loans: loan and copy state that disagree (an open loan without a copy, an issued copy with no
   open loan, an open loan on a copy that is not marked issued, a lost loan without a copy).
3. Tightening: how many titles have no category and how many loans have no copy, by status. The
   "make it required" step (blueprint section 5, step 5) is safe only when the title count is 0 and the
   only loans without a copy are returned ones that predate copies (see the note it prints).

Run it straight after migrating, and again before the cleanup migration. Once circulation runs on
copies the old counter no longer moves, so stock differences after that point are expected; loan
differences never should be. Nothing is ever changed.
"""
from django.core.management.base import BaseCommand
from django.db import connection
from django.db.models import Count

from apps.library.models import Book, BookCopy, BookIssue
from apps.library.services.backfill import find_loan_mismatches

LOAN_LABELS = {
    "open_loans_without_copy": "open loans without a copy (loan ids)",
    "lost_loans_without_copy": "lost loans without a copy (loan ids)",
    "issued_copies_without_open_loan": "issued copies with no open loan (copy ids)",
    "open_loans_on_unissued_copy": "open loans whose copy is not marked issued (loan ids)",
}

LEGACY_COLUMNS = ("quantity", "available_quantity")


def legacy_counters_exist() -> bool:
    """True while library_books still has the two old counter columns (before migration 0014)."""
    with connection.cursor() as cursor:
        columns = {column.name for column in connection.introspection.get_table_description(cursor, "library_books")}
    return all(name in columns for name in LEGACY_COLUMNS)


def stock_mismatches(school_id=None):
    """Titles with old counters above 0 whose available_quantity differs from the derived available copies.

    Plain SQL on purpose: the model no longer has the columns. Returns [] when they are gone.
    """
    if not legacy_counters_exist():
        return None
    sql = (
        "SELECT b.school_id, b.id, b.accession_code, b.title, b.available_quantity, "
        "(SELECT COUNT(*) FROM library_book_copies c WHERE c.book_id = b.id AND c.status = 'available') "
        "FROM library_books b WHERE b.quantity > 0"
    )
    params = []
    if school_id:
        sql += " AND b.school_id = %s"
        params.append(school_id)
    sql += " ORDER BY b.school_id, b.id"
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        rows = cursor.fetchall()
    return [
        {"school_id": s, "book_id": b, "accession_code": code, "title": title, "old_available": old, "derived_available": derived}
        for s, b, code, title, old, derived in rows
        if old != derived
    ]


def tightening_counts():
    """({school_id: titles with no category}, {status: loans with no copy}). Counts only, no row data."""
    books = {
        row["school_id"]: row["n"]
        for row in Book.objects.filter(category__isnull=True).values("school_id").annotate(n=Count("id")).order_by("school_id")
    }
    loans = {
        row["status"]: row["n"]
        for row in BookIssue.objects.filter(copy__isnull=True).values("status").annotate(n=Count("id")).order_by("status")
    }
    return books, loans


class Command(BaseCommand):
    help = "Read-only: list stock and loan state that disagree, and whether the tightening step is safe."

    def add_arguments(self, parser):
        parser.add_argument("--school", type=int, help="Only report this school id (stock section).")

    def handle(self, *args, **options):
        rows = stock_mismatches(options.get("school"))
        if rows is None:
            self.stdout.write("Stock: the old quantity columns have been dropped (migration 0014), nothing to compare.")
        elif not rows:
            self.stdout.write("Stock: no mismatches, old available_quantity matches the derived copy state.")
        else:
            self.stdout.write("Stock: school | book | accession | old available | derived available | title")
            for row in rows:
                self.stdout.write(
                    f"{row['school_id']} | {row['book_id']} | {row['accession_code']} | "
                    f"{row['old_available']} | {row['derived_available']} | {row['title']}"
                )
            self.stdout.write(f"{len(rows)} title(s) differ. The derived copy state is used.")

        loans = {name: ids for name, ids in find_loan_mismatches(BookCopy, BookIssue).items() if ids}
        if not loans:
            self.stdout.write("Loans: no mismatches, every open loan is bound to an issued copy.")
        else:
            for name, ids in loans.items():
                self.stdout.write(f"Loans: {LOAN_LABELS[name]}: {ids}")

        no_category, no_copy = tightening_counts()
        if no_category:
            self.stdout.write(
                "Tightening: titles with no category by school: "
                + ", ".join(f"school {school} = {count}" for school, count in no_category.items())
                + ". Run the catalogue backfill first; do not make category required."
            )
        else:
            self.stdout.write("Tightening: every title has a category, so category could be made required.")
        if no_copy:
            self.stdout.write("Tightening: loans with no copy by status: " + ", ".join(f"{status} = {count}" for status, count in no_copy.items()) + ".")
            if set(no_copy) - {BookIssue.STATUS_RETURNED}:
                self.stdout.write("Tightening: open or lost loans have no copy: bind them before anything else.")
            else:
                self.stdout.write(
                    "Tightening: only returned loans lack a copy. They predate copies by design, so the loan copy link "
                    "stays optional (making it required would need a placeholder copy for each of them)."
                )
        else:
            self.stdout.write("Tightening: every loan has a copy, so the copy link could be made required.")
        self.stdout.write("\nNothing was changed.")
