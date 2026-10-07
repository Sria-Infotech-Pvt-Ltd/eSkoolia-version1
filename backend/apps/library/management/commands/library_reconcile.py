"""
Management command: python manage.py library_reconcile

READ-ONLY. Lists legacy titles whose old ``available_quantity`` differs from
the number of available copies the catalogue backfill derived. The derived copy
state is the truth; this report exists so a librarian can check the numbers.

Run it straight after migrating. Once circulation runs on copies the old counter
no longer moves, so differences after that point are expected. Prints ids,
accession codes and titles only.
"""
from django.core.management.base import BaseCommand

from apps.library.models import Book, BookCopy
from apps.library.services.backfill import find_reconcile_mismatches


class Command(BaseCommand):
    help = "Read-only: list titles whose old available_quantity differs from the derived available copies."

    def add_arguments(self, parser):
        parser.add_argument("--school", type=int, help="Only report this school id.")

    def handle(self, *args, **options):
        rows = find_reconcile_mismatches(Book, BookCopy)
        if options.get("school"):
            rows = [row for row in rows if row["school_id"] == options["school"]]
        if not rows:
            self.stdout.write("No mismatches: old available_quantity matches the derived copy state.")
            return
        self.stdout.write("school | book | accession | old available | derived available | title")
        for row in rows:
            self.stdout.write(
                f"{row['school_id']} | {row['book_id']} | {row['accession_code']} | "
                f"{row['old_available']} | {row['derived_available']} | {row['title']}"
            )
        self.stdout.write(f"\n{len(rows)} title(s) differ. The derived copy state is used. Nothing was changed.")
