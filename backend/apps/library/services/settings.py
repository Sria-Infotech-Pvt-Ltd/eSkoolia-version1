from django.db import IntegrityError, transaction

from apps.core.models import Class
from apps.library.models import LibrarySettings

# D6: the junior fee group is stored as a list of class ids, filled once from
# these canonical class names (Class.normalize_name output).
JUNIOR_CLASS_NAMES = frozenset({"Nursery", "LKG", "UKG", "Grade 1", "Grade 2", "Grade 3", "Grade 4"})


def default_junior_class_ids(school):
    ids = []
    for class_id, name in Class.objects.filter(school=school).values_list("id", "name"):
        if Class.normalize_name(name) in JUNIOR_CLASS_NAMES:
            ids.append(class_id)
    return sorted(ids)


def get_settings(school):
    """Return the school's settings row, creating it with the D1 to D6 defaults on first use."""
    existing = LibrarySettings.objects.filter(school=school).first()
    if existing:
        return existing
    try:
        with transaction.atomic():
            return LibrarySettings.objects.create(
                school=school,
                junior_class_ids=default_junior_class_ids(school),
            )
    except IntegrityError:
        # A concurrent request created the row first (uq_library_settings_school).
        return LibrarySettings.objects.get(school=school)
