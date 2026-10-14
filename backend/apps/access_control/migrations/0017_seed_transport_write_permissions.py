from django.db import migrations


# Transport Phase 1: writes now need add/edit/delete codes instead of only `.view`
# (see apps/transport/permissions.py). Each new code is granted to every role that
# already holds the matching view code, so no existing role loses the access it
# effectively had - admins can then narrow roles down from the Roles screen.
# Kept as a literal list (not imported) so the migration stays stable if the app changes.
NEW_CODES = [
    # (code, name, granted to holders of)
    ("transport.vehicle.add", "Vehicle Add", "transport.vehicle.view"),
    ("transport.vehicle.edit", "Vehicle Edit", "transport.vehicle.view"),
    ("transport.vehicle.delete", "Vehicle Delete", "transport.vehicle.view"),
    ("transport.route.add", "Transport Route Add", "transport.route.view"),
    ("transport.route.edit", "Transport Route Edit", "transport.route.view"),
    ("transport.route.delete", "Transport Route Delete", "transport.route.view"),
    ("transport.assign_vehicle.add", "Assign Vehicle Add", "transport.assign_vehicle.view"),
    ("transport.assign_vehicle.edit", "Assign Vehicle Edit", "transport.assign_vehicle.view"),
    ("transport.assign_vehicle.delete", "Assign Vehicle Delete", "transport.assign_vehicle.view"),
    ("transport.tracking.update", "Bus GPS Update", "transport.vehicle.view"),
]


def seed_and_grant(apps, schema_editor):
    Permission = apps.get_model("access_control", "Permission")
    RolePermission = apps.get_model("access_control", "RolePermission")
    for code, name, granted_with in NEW_CODES:
        permission, _ = Permission.objects.update_or_create(
            code=code, defaults={"name": name, "module": "transport"}
        )
        role_ids = RolePermission.objects.filter(permission__code=granted_with).values_list("role_id", flat=True)
        for role_id in set(role_ids):
            RolePermission.objects.get_or_create(role_id=role_id, permission=permission)


def remove_codes(apps, schema_editor):
    Permission = apps.get_model("access_control", "Permission")
    # Deleting the Permission rows cascades to their RolePermission grants.
    Permission.objects.filter(code__in=[code for code, _name, _src in NEW_CODES]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("access_control", "0016_seed_approval_chain_permission"),
    ]

    operations = [
        migrations.RunPython(seed_and_grant, remove_codes),
    ]
