"""Data step: codes for categories and titles, an Uncategorised category, and copies (blueprint section 5, step 3).

Delegates to services.backfill so the logic is testable. Writes no files; run
``manage.py library_reconcile`` afterwards to list titles whose old counters
disagree with the derived copy state.

Reverse is a no-op: undoing 0003 drops the new columns and the copies table, and
the codes live in those columns.
"""
from django.db import migrations

from apps.library.services.backfill import backfill_catalogue


def forwards(apps, schema_editor):
    backfill_catalogue(apps)


class Migration(migrations.Migration):

    dependencies = [
        ('library', '0003_catalogue'),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
