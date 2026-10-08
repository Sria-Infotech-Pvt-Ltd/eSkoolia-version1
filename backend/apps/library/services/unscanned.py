"""The unscanned-student flag (blueprint 6.1): once per slot per day, tell the class teacher who has not checked in.

`flag_unscanned` runs from the every-minute Celery task. A `reminder` activity row with
`metadata.action = "unscanned_flag"`, the slot id and the date is the marker: once it exists the slot
is never flagged again that day, even when nobody was missing or nobody could be told. The notification
carries counts only, never student names.
"""
from datetime import datetime, timedelta

from django.db import transaction
from django.db.models import Q

from apps.academics.models import ClassTeacherAssignment
from apps.library.models import LibraryActivityLog, PeriodSlot, Visit
from apps.students.models import Student

from .activity import log_event
from .notifications import EVENT_UNSCANNED_FLAG, enqueue_event
from .periods import base_slots, day_name, local_now
from .settings import get_settings

MARKER_ACTION = "unscanned_flag"


def unscanned_count(school, slot, visit_date) -> tuple[int, int]:
    """(unscanned, scheduled) for the students of the slot's class (and section) on `visit_date`."""
    students = Student.objects.filter(school=school, status="active", current_class_id=slot.school_class_id)
    if slot.section_id:
        students = students.filter(current_section_id=slot.section_id)
    scheduled = students.count()
    visits = Visit.objects.filter(
        school=school, period_slot=slot, visit_date=visit_date, member__student__current_class_id=slot.school_class_id
    )
    if slot.section_id:
        visits = visits.filter(member__student__current_section_id=slot.section_id)
    scanned = visits.values("member__student_id").distinct().count()
    return max(0, scheduled - scanned), scheduled


def class_teacher_ids(school, slot) -> list[int]:
    """Active class teachers for the slot: those of its section, and those of the whole class."""
    assignments = ClassTeacherAssignment.objects.filter(school=school, school_class_id=slot.school_class_id, active_status=True)
    if slot.section_id:
        assignments = assignments.filter(Q(section__isnull=True) | Q(section_id=slot.section_id))
    return sorted(set(assignments.values_list("teacher_id", flat=True)))


def _already_flagged(school, slot_id, day_iso) -> bool:
    """True when the marker row for this slot and date exists (exact JSON key lookups, no date arithmetic)."""
    return LibraryActivityLog.objects.filter(
        school=school,
        event_type=LibraryActivityLog.EVENT_REMINDER,
        metadata__action=MARKER_ACTION,
        metadata__slot_id=slot_id,
        metadata__date=day_iso,
    ).exists()


def _past_threshold(slot, now, minutes) -> bool:
    started = datetime.combine(now.date(), slot.period.start_time, tzinfo=now.tzinfo)
    ends = datetime.combine(now.date(), slot.period.end_time, tzinfo=now.tzinfo)
    return started + timedelta(minutes=minutes) <= now <= ends


def flag_unscanned(school, now=None) -> list[dict]:
    """Flag every slot of `school` that started more than `unscanned_flag_minutes` ago and was not flagged today.

    Returns one dict per slot handled (slot id, unscanned, scheduled, teachers told).
    """
    now = now or local_now()
    day = day_name(now)
    if day is None:
        return []
    minutes = get_settings(school).unscanned_flag_minutes
    day_iso = now.date().isoformat()
    handled = []
    candidates = [
        slot for slot in base_slots(school).filter(is_active=True, day=day) if _past_threshold(slot, now, minutes)
    ]
    for candidate in candidates:
        with transaction.atomic():
            # Lock the slot so two overlapping runs cannot both write the marker.
            slot = base_slots(school).select_for_update(of=("self",)).get(pk=candidate.pk) if _can_lock() else candidate
            if _already_flagged(school, slot.pk, day_iso):
                continue
            unscanned, scheduled = unscanned_count(school, slot, now.date())
            teachers = class_teacher_ids(school, slot) if unscanned else []
            log_event(
                school, None, LibraryActivityLog.EVENT_REMINDER,
                f"Unscanned check for {slot.school_class.name} {slot.section.name if slot.section_id else ''}".strip()
                + f": {unscanned} of {scheduled} not checked in",
                metadata={
                    "action": MARKER_ACTION, "slot_id": slot.pk, "date": day_iso, "unscanned": unscanned,
                    "scheduled": scheduled, "teachers": len(teachers),
                },
            )
            for teacher_id in teachers:
                enqueue_event(school.pk, EVENT_UNSCANNED_FLAG, {"slot_id": slot.pk, "date": day_iso, "teacher_id": teacher_id})
            handled.append({"slot_id": slot.pk, "unscanned": unscanned, "scheduled": scheduled, "teachers": len(teachers)})
    return handled


def _can_lock() -> bool:
    from django.db import connection

    return connection.features.has_select_for_update


def slots_today_school_ids(now=None) -> list[int]:
    now = now or local_now()
    day = day_name(now)
    if day is None:
        return []
    return list(PeriodSlot.objects.filter(is_active=True, day=day).values_list("school_id", flat=True).distinct())
