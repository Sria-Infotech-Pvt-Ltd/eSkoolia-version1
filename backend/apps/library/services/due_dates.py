"""Due dates (decision D3, rules R4 and R5).

Students: the class's next library period that is at least `student_min_due_days` away. If the
class has no library period, the flat period. Teachers and staff: always the flat period.

Library periods (`library_period_slots`) arrive in a later slice. `class_slot_weekdays` looks the
model up by name and answers "no slots" while it does not exist or has no rows for the class, so
every student currently gets the flat period.
"""
from dataclasses import dataclass
from datetime import date, timedelta

from django.apps import apps as django_apps
from django.db.models import Q

DAY_INDEX = {"Mon": 0, "Tue": 1, "Wed": 2, "Thu": 3, "Fri": 4, "Sat": 5}


@dataclass(frozen=True)
class DueDate:
    due_date: date
    snapped: bool  # True when it landed on the class's library period
    note: str


def class_slot_weekdays(school, school_class_id, section_id=None):
    """Weekday numbers (Monday is 0) on which the class has an active library period. Empty when none."""
    if not school_class_id:
        return set()
    try:
        slot_model = django_apps.get_model("library", "PeriodSlot")
    except LookupError:
        return set()
    slots = slot_model.objects.filter(school=school, school_class_id=school_class_id, is_active=True).filter(
        Q(section__isnull=True) | Q(section_id=section_id)
    )
    return {DAY_INDEX[day] for day in slots.values_list("day", flat=True) if day in DAY_INDEX}


def next_slot_date(earliest: date, weekdays) -> date | None:
    """The first date on or after `earliest` whose weekday is in `weekdays`. None when there are none."""
    if not weekdays:
        return None
    for offset in range(7):
        candidate = earliest + timedelta(days=offset)
        if candidate.weekday() in weekdays:
            return candidate
    return None


def compute_due_date(school, member, settings, issue_date: date) -> DueDate:
    """Due date for `member` borrowing on `issue_date` (R4). `member` needs member_type and, for students, the student."""
    flat = issue_date + timedelta(days=int(settings.flat_loan_days))
    if member.member_type != "student":
        return DueDate(flat, False, f"Flat loan period of {settings.flat_loan_days} days.")
    student = member.student
    weekdays = class_slot_weekdays(
        school, getattr(student, "current_class_id", None), getattr(student, "current_section_id", None)
    )
    slot = next_slot_date(issue_date + timedelta(days=int(settings.student_min_due_days)), weekdays)
    if slot is None:
        return DueDate(flat, False, f"No library period for this class: flat loan period of {settings.flat_loan_days} days.")
    return DueDate(slot, True, f"Due on the class's next library period, at least {settings.student_min_due_days} days away.")
