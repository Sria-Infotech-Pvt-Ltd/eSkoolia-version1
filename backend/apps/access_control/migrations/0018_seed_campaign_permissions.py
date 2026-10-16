from django.db import migrations


# Permission codes for the new Campaign endpoint (apps.admissions.views.CampaignViewSet),
# added as part of building real backend persistence for Admissions -> Communication ->
# Campaigns (previously a frontend-only mockup with no backend at all). Uses the
# "admin_section" module key, matching the existing complaint/certificate/admission_query
# codes in 0003_seed_expanded_permissions — that's this area's established grouping in
# the Roles & Permissions "Assign Permission" screen.
PERMISSIONS = [
    ("admin_section.campaign.view", "Campaign", "admin_section"),
    ("admin_section.campaign.add", "Campaign Add", "admin_section"),
    ("admin_section.campaign.edit", "Campaign Edit", "admin_section"),
    ("admin_section.campaign.delete", "Campaign Delete", "admin_section"),
]


def seed_permissions(apps, schema_editor):
    Permission = apps.get_model("access_control", "Permission")
    for code, name, module in PERMISSIONS:
        Permission.objects.update_or_create(
            code=code,
            defaults={"name": name, "module": module},
        )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("access_control", "0017_seed_academics_crud_permissions"),
    ]

    operations = [
        migrations.RunPython(seed_permissions, noop_reverse),
    ]
