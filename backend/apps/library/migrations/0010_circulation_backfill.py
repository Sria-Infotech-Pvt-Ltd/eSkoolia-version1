"""Data step: bind every open and lost loan to a copy (blueprint section 5, loan binding).

Open loans take an issued copy of their title (or an available one, or a new copy when the
title has too few), lost loans take a lost copy. Delegates to services.backfill. Idempotent.
Writes no files; run ``manage.py library_reconcile`` afterwards.

Before 0011 adds the loan constraints it checks that no existing loan breaks them (a due or
return date before the issue date). If one does it stops with the loan ids so a person can fix
the dates; it never rewrites history on its own. Reverse is a no-op: undoing 0009 drops the
copy column that holds the binding.
"""
from django.db import migrations

from apps.library.services.backfill import backfill_loans


def forwards(apps, schema_editor):
    backfill_loans(apps)


class Migration(migrations.Migration):

    dependencies = [
        ('library', '0009_circulation'),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
