from django.db import migrations


# QA: "Complaint source dropdown is not working." The dropdown/backend wiring
# itself is correct (fixed in an earlier pass — see AdminSetupPanel's
# ComplaintSource routing); the actual cause is that only 3 of 19 schools have
# any ComplaintSource rows at all (and only 6 have any ComplaintType rows), so
# for every other school the dropdown is legitimately empty with no
# explanation. Backfill the same sensible defaults the one already-configured
# school (id=1) uses, for every school that currently has zero rows — this is
# purely additive (never touches a school that already has its own data) and
# gets every school to a working starting point without requiring an admin to
# discover the Admin Setup screen first.
DEFAULT_SOURCES = ["Email", "Parent", "Phone Call", "Staff", "Student", "Walk-in"]
DEFAULT_TYPES = [
    "Academic Issue",
    "Administrative Issue",
    "Behavioral Issue",
    "Facility Complaint",
    "Safety Concern",
]


def backfill_defaults(apps, schema_editor):
    School = apps.get_model("tenancy", "School")
    ComplaintSource = apps.get_model("admissions", "ComplaintSource")
    ComplaintType = apps.get_model("admissions", "ComplaintType")

    schools_with_sources = set(ComplaintSource.objects.values_list("school_id", flat=True).distinct())
    schools_with_types = set(ComplaintType.objects.values_list("school_id", flat=True).distinct())

    for school in School.objects.all():
        if school.id not in schools_with_sources:
            ComplaintSource.objects.bulk_create(
                [ComplaintSource(school_id=school.id, name=name) for name in DEFAULT_SOURCES]
            )
        if school.id not in schools_with_types:
            ComplaintType.objects.bulk_create(
                [ComplaintType(school_id=school.id, name=name) for name in DEFAULT_TYPES]
            )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("admissions", "0016_drop_orphaned_complaint_text_columns"),
        ("tenancy", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(backfill_defaults, noop_reverse),
    ]
