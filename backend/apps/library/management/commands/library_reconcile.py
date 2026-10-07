"""
Management command: python manage.py library_reconcile

READ-ONLY. Two checks, both printed with ids only:

1. Stock: legacy titles whose old ``available_quantity`` differs from the number of available
   copies the catalogue backfill derived. The derived copy state is the truth.
2. Loans: loan and copy state that disagree (an open loan without a copy, an issued copy with no
   open loan, an open loan on a copy that is not marked issued, a lost loan without a copy).

Run it straight after migrating. Once circulation runs on copies the old counter no longer moves,
so stock differences after that point are expected; loan differences never should be.
"""
from django.core.management.base import BaseCommand

from apps.library.models import Book, BookCopy, BookIssue
from apps.library.services.backfill import (
    find_loan_mismatches,
    find_reconcile_mismatches,
)

LOAN_LABELS = {
    "open_loans_without_copy": "open loans without a copy (loan ids)",
    "lost_loans_without_copy": "lost loans without a copy (loan ids)",
    "issued_copies_without_open_loan": "issued copies with no open loan (copy ids)",
    "open_loans_on_unissued_copy": "open loans whose copy is not marked issued (loan ids)",
}


class Command(BaseCommand):
    help = "Read-only: list stock and loan state that disagree after the catalogue and circulation backfills."

    def add_arguments(self, parser):
        parser.add_argument("--school", type=int, help="Only report this school id (stock section).")

    def handle(self, *args, **options):
        rows = find_reconcile_mismatches(Book, BookCopy)
        if options.get("school"):
            rows = [row for row in rows if row["school_id"] == options["school"]]
        if not rows:
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
        self.stdout.write("\nNothing was changed.")
