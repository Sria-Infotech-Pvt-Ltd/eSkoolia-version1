from django.db import migrations


# Transport Phase 3: maintenance and fuel get view/add/edit/delete codes; the
# dashboard summary and reports get view codes. Granted to roles that hold
# transport.vehicle.view (who could already open these screens), so no role
# loses access. Literal list (not imported) so this migration stays stable.
CODES = [
    ("transport.maintenance.view", "Transport Maintenance"),
    ("transport.maintenance.add", "Transport Maintenance Add"),
    ("transport.maintenance.edit", "Transport Maintenance Edit"),
    ("transport.maintenance.delete", "Transport Maintenance Delete"),
    ("transport.fuel.view", "Transport Fuel"),
    ("transport.fuel.add", "Transport Fuel Add"),
    ("transport.fuel.edit", "Transport Fuel Edit"),
    ("transport.fuel.delete", "Transport Fuel Delete"),
    ("transport.dashboard.view", "Transport Dashboard"),
    ("transport.report.view", "Transport Reports"),
]
GRANTED_WITH = "transport.vehicle.view"


def seed_and_grant(apps, schema_editor):
    Permission = apps.get_model("access_control", "Permission")
    RolePermission = apps.get_model("access_control", "RolePermission")
    role_ids = set(RolePermission.objects.filter(permission__code=GRANTED_WITH).values_list("role_id", flat=True))
    for code, name in CODES:
        permission, _ = Permission.objects.update_or_create(code=code, defaults={"name": name, "module": "transport"})
        for role_id in role_ids:
            RolePermission.objects.get_or_create(role_id=role_id, permission=permission)


def remove_codes(apps, schema_editor):
    Permission = apps.get_model("access_control", "Permission")
    Permission.objects.filter(code__in=[code for code, _name in CODES]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("access_control", "0018_seed_transport_phase2_permissions"),
    ]

    operations = [
        migrations.RunPython(seed_and_grant, remove_codes),
    ]
