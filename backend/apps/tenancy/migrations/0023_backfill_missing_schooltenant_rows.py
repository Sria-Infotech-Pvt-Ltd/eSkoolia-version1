import uuid

from django.db import migrations


# QA: "School info -> Save button not saving." Root cause found live: 12 of 19
# schools had NO SchoolTenant row at all (not an orphaned/unlinked one — just
# never created), because the "School Tenancy > Add School" flow
# (apps.tenancy.views.SchoolViewSet.perform_create) never created one; the only
# other code path that does is provisioning.py's provision_tenant(), which is
# gated behind MULTI_TENANCY_ENABLED and raises immediately since that's unset
# in this deployment. For any of those 12 schools, Settings > School Info
# can't even load (SchoolInfoView.get_object hard-fails with "No tenant record
# exists for this school yet"), let alone save. perform_create is fixed
# separately so this can't recur for schools added from now on; this backfills
# the schools that already existed without one.
def sanitize_subdomain(subdomain):
    import re
    safe = subdomain.lower().replace("-", "_")
    safe = re.sub(r"[^a-z0-9_]", "", safe).strip("_")
    if not safe:
        safe = "school"
    schema_name = f"school_{safe}"
    return schema_name[:63]


def backfill_missing_tenants(apps, schema_editor):
    School = apps.get_model("tenancy", "School")
    SchoolTenant = apps.get_model("tenancy", "SchoolTenant")

    for school in School.objects.filter(tenant_record__isnull=True):
        base = sanitize_subdomain(school.subdomain or school.code or f"school{school.id}")
        schema_name = base
        suffix = 1
        while SchoolTenant.objects.filter(schema_name=schema_name).exists():
            suffix += 1
            schema_name = f"{base[:58]}_{suffix}"
        SchoolTenant.objects.create(
            tenant_id=f"TNT{uuid.uuid4().hex[:12].upper()}",
            schema_name=schema_name,
            school=school,
            name=school.name,
            status="active",
        )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("tenancy", "0022_alter_domain_domain_alter_domain_is_primary"),
    ]

    operations = [
        migrations.RunPython(backfill_missing_tenants, noop_reverse),
    ]
