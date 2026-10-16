from django.db import migrations


# Transport Phase 2: drivers/attendants (staff), student allocation, boarding
# register (attendance) and alerts get their own view/add/edit/delete codes.
# Alerts previously used transport.vehicle.* codes, so every new code is granted
# to roles that hold transport.vehicle.view - no role loses access it had.
# Literal list (not imported) so this migration stays stable if the app changes.
FEATURES = [
    ("staff", "Transport Staff"),
    ("allocation", "Student Transport Allocation"),
    ("attendance", "Transport Attendance"),
    ("alert", "Transport Alert"),
]
ACTIONS = [("view", ""), ("add", " Add"), ("edit", " Edit"), ("delete", " Delete")]
GRANTED_WITH = "transport.vehicle.view"


def new_codes():
    return [
        (f"transport.{feature}.{action}", f"{label}{suffix}")
        for feature, label in FEATURES
        for action, suffix in ACTIONS
    ]


def seed_and_grant(apps, schema_editor):
    Permission = apps.get_model("access_control", "Permission")
    RolePermission = apps.get_model("access_control", "RolePermission")
    role_ids = set(RolePermission.objects.filter(permission__code=GRANTED_WITH).values_list("role_id", flat=True))
    for code, name in new_codes():
        permission, _ = Permission.objects.update_or_create(code=code, defaults={"name": name, "module": "transport"})
        for role_id in role_ids:
            RolePermission.objects.get_or_create(role_id=role_id, permission=permission)


def remove_codes(apps, schema_editor):
    Permission = apps.get_model("access_control", "Permission")
    Permission.objects.filter(code__in=[code for code, _name in new_codes()]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("access_control", "0017_seed_transport_write_permissions"),
    ]

    operations = [
        migrations.RunPython(seed_and_grant, remove_codes),
    ]
