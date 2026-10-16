"""Data step for members: no retroactive registration billing, and an integrity check.

Existing members get registration_fee_amount 0 (the column default; set explicitly here so a
re-run is harmless). Member type stays as it is: moving staff to teacher is a manual step (D11).

Before 0008 adds the one-membership-per-person and type-matches-person constraints this step
looks for rows that would break them. If it finds any it stops with the member ids, because
silently merging or editing membership history would be worse than a clear message. Fix those
rows (deactivate or re-point duplicates by hand) and run the migration again.
"""
from django.db import migrations

from apps.library.services.backfill import backfill_members


def forwards(apps, schema_editor):
    backfill_members(apps)


class Migration(migrations.Migration):

    dependencies = [
        ('library', '0006_members_charges'),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
