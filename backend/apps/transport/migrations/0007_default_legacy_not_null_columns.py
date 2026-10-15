from django.db import migrations

# Some databases still carry columns added by older core migrations that are no
# longer in this codebase (core 0017-0022 from an earlier branch). They are
# NOT NULL without a default, and the current models never write them, so every
# INSERT into these tables failed ("null value in column ... violates not-null
# constraint", returned to the screens as a 400). Giving each one a database
# default makes inserts work again. Nothing is dropped and no existing value
# changes; databases that don't have these columns are left untouched.
LEGACY_COLUMNS = [
    # (table, column, default SQL literal)
    ("vehicles", "capacity", "0"),
    ("transport_routes", "route_code", "''"),
    ("transport_routes", "color", "''"),
    ("transport_routes", "direction", "''"),
    ("transport_routes", "start_location", "''"),
    ("transport_routes", "end_location", "''"),
    ("transport_routes", "description", "''"),
]


def _needs_default(cursor, table, column):
    cursor.execute(
        """
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = %s AND column_name = %s
          AND is_nullable = 'NO' AND column_default IS NULL
        """,
        [table, column],
    )
    return cursor.fetchone() is not None


def add_defaults(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        for table, column, default in LEGACY_COLUMNS:
            if _needs_default(cursor, table, column):
                cursor.execute(f'ALTER TABLE "{table}" ALTER COLUMN "{column}" SET DEFAULT {default}')


def noop(apps, schema_editor):
    # Leaving the defaults in place on reverse is harmless and keeps inserts working.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("transport", "0006_phase4_settings"),
    ]

    operations = [
        migrations.RunPython(add_defaults, noop),
    ]
