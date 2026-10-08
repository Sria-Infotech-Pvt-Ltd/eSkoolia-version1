"""Cleanup (blueprint section 5, step 6): drop the deprecated `quantity` and `available_quantity` columns of `library_books`.

APPLY AFTER A BACKUP. Take a database snapshot first, and run `python manage.py library_reconcile` before this
migration: its stock section compares the old counters with the derived copy state and can only do that while
the columns still exist.

This step is NOT cleanly reversible. Reversing it re-adds both columns filled with 0, so the old counter values
are gone for good; the only real rollback is restoring the snapshot. Nothing reads or writes these columns any
more (every count comes from `library_book_copies`), which is why they are safe to drop.

Earlier migrations (0004 and the catalogue backfill) use historical models that still carry the two fields, so
they keep working on a database that has not been migrated yet.
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("library", "0013_periods_stock"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="book",
            name="available_quantity",
        ),
        migrations.RemoveField(
            model_name="book",
            name="quantity",
        ),
    ]
