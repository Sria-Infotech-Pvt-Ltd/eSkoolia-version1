from django.db import migrations


# Every academics.* permission seeded in 0003_seed_expanded_permissions was
# .view only — no .add/.edit/.delete codes exist for this module at all. The
# Assign Permission screen's CRUD checkboxes/operation-level buttons for
# Academics have nothing to bind to as a result (QA: "Assign->Academics->
# operation level->CRUD operations is not working") — this isn't a broken save
# path, the underlying Permission rows were simply never created. Adds the
# missing add/edit/delete codes alongside each existing .view code, following
# the same code/name convention already used for admin_section's features.
ACADEMICS_FEATURES = [
    ("core_setup", "Core Setup"),
    ("lesson", "Lesson"),
    ("topic", "Topic"),
    ("lesson_planner", "Lesson Planner"),
    ("add_homework", "Add Homework"),
    ("homework_list", "Homework List"),
    ("homework_evaluation_report", "Homework Evaluation Report"),
    ("upload_content", "Upload Content"),
    ("assignment_list", "Assignment List"),
    ("study_material_list", "Study Material List"),
    ("syllabus_list", "Syllabus List"),
    ("other_downloads_list", "Other Downloads List"),
]

PERMISSIONS = [
    (f"academics.{feature}.{action}", f"{label} {action.capitalize()}", "academics")
    for feature, label in ACADEMICS_FEATURES
    for action in ("add", "edit", "delete")
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
        ("access_control", "0016_seed_approval_chain_permission"),
    ]

    operations = [
        migrations.RunPython(seed_permissions, noop_reverse),
    ]
