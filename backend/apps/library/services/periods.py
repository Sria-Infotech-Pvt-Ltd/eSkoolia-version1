"""Library periods, visits and occupancy (decision D8, blueprint 2.4 and 4.7).

A slot is "the class comes to the library on this day during this class period". Everything that reads
the clock goes through `local_now()` so tests can fix the time. Counts are grouped queries: the
scheduled head count comes from one grouped students query, never a loop per slot.
"""
from collections import defaultdict
from datetime import date, datetime, timedelta

from django.db import IntegrityError, transaction
from django.db.models import Count, Exists, OuterRef, Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError as FieldValidationError

from apps.core.exceptions import ConflictError
from apps.library.models import BookCopy, BookIssue, Hold, LibraryMember, PeriodSlot, Visit
from apps.library.models.periods import DAYS
from apps.students.models import Student

from .dues import days_overdue
from .members import person_name, suspended_member_ids
from .settings import get_settings

LIST_LIMIT = 50


def local_now():
    return timezone.localtime()


def day_name(moment) -> str | None:
    """Mon to Sat for a date or datetime. None on a Sunday, when no slot can exist."""
    weekday = moment.weekday()
    return DAYS[weekday] if weekday < len(DAYS) else None


def base_slots(school):
    return PeriodSlot.objects.filter(school=school).select_related("school_class", "section", "period", "supervisor")


def slot_summary(slot) -> dict:
    """Plain data about a slot, also used as the 409 payload that names the clashing slot."""
    return {
        "id": slot.pk,
        "class_name": slot.school_class.name,
        "section_name": slot.section.name if slot.section_id else "",
        "day": slot.day,
        "period_name": slot.period.period,
        "start_time": slot.period.start_time.strftime("%H:%M"),
        "end_time": slot.period.end_time.strftime("%H:%M"),
        "room_label": slot.room_label,
    }


# ---- conflicts -------------------------------------------------------------------------------------------------


def find_conflict(school, *, school_class, section, day, period, room_label, exclude_pk=None):
    """("room" | "twin" | "class", slot) for the first slot that clashes with the proposed one, else None.

    The room is free for one class at a time (mirrors uq_library_period_slots_room_slot, so an
    inactive slot still holds its room). "twin" is the same class and section at the same time, which
    the unique constraints refuse even when the other slot is switched off. A class cannot have two
    active periods at the same time: a class-wide slot clashes with any section slot of that class and
    the other way round ("class").
    """
    others = base_slots(school).filter(day=day, period=period)
    if exclude_pk:
        others = others.exclude(pk=exclude_pk)
    room = others.filter(room_label=room_label).first()
    if room is not None:
        return "room", room
    twin = others.filter(school_class=school_class, section=section) if section is not None else others.filter(
        school_class=school_class, section__isnull=True
    )
    twin = twin.first()
    if twin is not None:
        return "twin", twin
    same_class = others.filter(school_class=school_class, is_active=True)
    if section is not None:
        same_class = same_class.filter(Q(section__isnull=True) | Q(section=section))
    clash = same_class.first()
    return ("class", clash) if clash is not None else None


def raise_conflict(kind, slot):
    what = "room" if kind == "room" else "class"  # a twin is also the class being booked twice
    summary = slot_summary(slot)
    where = f"{summary['class_name']} {summary['section_name']}".strip()
    raise ConflictError(
        detail=f"The {what} is already booked on {summary['day']} for {summary['period_name']} ({where}, {summary['room_label']}).",
        code="conflict",
        extra_data={"conflict": kind, "slot": summary},
    )


# ---- live slots and head counts --------------------------------------------------------------------------------


def live_slots(school, now=None):
    """Active slots whose period is running at `now`, ordered by room."""
    now = now or local_now()
    day = day_name(now)
    if day is None:
        return []
    return list(
        base_slots(school)
        .filter(is_active=True, day=day, period__start_time__lte=now.time(), period__end_time__gte=now.time())
        .order_by("room_label", "id")
    )


def scheduled_counts(school, slots) -> dict:
    """{slot id: active students scheduled}. One grouped query for all the slots."""
    if not slots:
        return {}
    rows = (
        Student.objects.filter(school=school, status="active", current_class_id__in={s.school_class_id for s in slots})
        .values("current_class_id", "current_section_id")
        .annotate(n=Count("id"))
    )
    by_class = defaultdict(int)
    by_section = defaultdict(int)
    for row in rows:
        by_class[row["current_class_id"]] += row["n"]
        by_section[(row["current_class_id"], row["current_section_id"])] += row["n"]
    return {
        slot.pk: by_section[(slot.school_class_id, slot.section_id)] if slot.section_id else by_class[slot.school_class_id]
        for slot in slots
    }


def checked_in_counts(school, slots, visit_date) -> dict:
    if not slots:
        return {}
    rows = (
        Visit.objects.filter(school=school, visit_date=visit_date, period_slot__in=[s.pk for s in slots])
        .values("period_slot_id")
        .annotate(n=Count("id"))
    )
    return {row["period_slot_id"]: row["n"] for row in rows}


def occupancy(school, slots, visit_date) -> dict:
    """Checked in versus scheduled for each of `slots` on `visit_date`, plus the totals."""
    scheduled = scheduled_counts(school, slots)
    checked = checked_in_counts(school, slots, visit_date)
    rows = [
        {**slot_summary(slot), "slot_id": slot.pk, "checked_in": checked.get(slot.pk, 0), "scheduled": scheduled.get(slot.pk, 0)}
        for slot in slots
    ]
    return {
        "date": visit_date.isoformat(),
        "checked_in": sum(r["checked_in"] for r in rows),
        "scheduled": sum(r["scheduled"] for r in rows),
        "slots": rows,
    }


def console_card(school, now=None) -> dict:
    """The Console's live-period card: empty when no period is running."""
    now = now or local_now()
    slots = live_slots(school, now)
    if not slots:
        return {}
    data = occupancy(school, slots, now.date())
    first = slots[0]
    data["label"] = f"{first.period.period}, {first.period.start_time.strftime('%H:%M')} to {first.period.end_time.strftime('%H:%M')}"
    return data


# ---- check-in --------------------------------------------------------------------------------------------------


def _member_matches_slot(member, slot) -> bool:
    student = member.student if member.student_id else None
    if student is None or student.current_class_id != slot.school_class_id:
        return False
    return slot.section_id is None or student.current_section_id == slot.section_id


def infer_slot(school, member, now):
    """The running slot this member belongs to. Students: their class. Others: the only running slot."""
    running = live_slots(school, now)
    if member.member_type == LibraryMember.MEMBER_STUDENT:
        matches = [slot for slot in running if _member_matches_slot(member, slot)]
    else:
        matches = running
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise FieldValidationError({"period_slot": "No library period is running for this member right now. Choose a period."})
    raise FieldValidationError({"period_slot": "More than one library period is running. Choose a period."})


def check_in(school, actor, *, member, slot=None, method=Visit.METHOD_CARD_TAP, now=None):
    """Record a visit. Returns (visit, created, occupancy_row). Repeating it for the same slot, member
    and date returns the first visit and changes nothing."""
    now = now or local_now()
    if not member.is_active:
        raise FieldValidationError({"member": "This member is inactive."})
    if slot is None:
        slot = infer_slot(school, member, now)
    elif not slot.is_active:
        raise FieldValidationError({"period_slot": "This library period is switched off."})
    elif slot.day != day_name(now):
        raise FieldValidationError({"period_slot": "This library period is not today."})
    visit_date = now.date()
    existing = Visit.objects.filter(school=school, period_slot=slot, member=member, visit_date=visit_date).first()
    created = existing is None
    visit = existing
    if created:
        try:
            with transaction.atomic():
                visit = Visit.objects.create(
                    school=school, period_slot=slot, member=member, visit_date=visit_date, checked_in_at=now,
                    method=method, created_by=actor, updated_by=actor,
                )
        except IntegrityError:  # another desk got there first
            visit = Visit.objects.get(school=school, period_slot=slot, member=member, visit_date=visit_date)
            created = False
    row = occupancy(school, [slot], visit_date)["slots"][0]
    return visit, created, row


# ---- week grid, prep briefing, footfall -----------------------------------------------------------------------


def week_grid(school, now=None) -> dict:
    """Everything the Mon to Sat grid needs: the school's class periods, every slot, and the live marker."""
    from apps.core.models import ClassPeriod

    now = now or local_now()
    periods = list(
        ClassPeriod.objects.filter(school=school, period_type="class", is_break=False).order_by("start_time", "period")
    )
    slots = list(base_slots(school).order_by("day", "period__start_time", "room_label", "id"))
    live_ids = {s.pk for s in live_slots(school, now)}
    return {
        "days": list(DAYS),
        "today": day_name(now),
        "now": now.isoformat(),
        "periods": [
            {"id": p.pk, "name": p.period, "start_time": p.start_time.strftime("%H:%M"), "end_time": p.end_time.strftime("%H:%M")}
            for p in periods
        ],
        "slots": [
            {
                **slot_summary(slot),
                "period": slot.period_id,
                "school_class": slot.school_class_id,
                "section": slot.section_id,
                "supervisor_name": person_name_of(slot.supervisor),
                "is_active": slot.is_active,
                "live": slot.pk in live_ids,
            }
            for slot in slots
        ],
        "live_slot_ids": sorted(live_ids),
    }


def person_name_of(staff) -> str:
    if staff is None:
        return ""
    return " ".join(part for part in (staff.first_name, getattr(staff, "last_name", "")) if part)


def next_slot(school, now=None):
    """(slot, date) of the next active slot that has not started yet, looking a week ahead. (None, None) if there is none."""
    now = now or local_now()
    for offset in range(8):
        day = now.date() + timedelta(days=offset)
        name = day_name(day)
        if name is None:
            continue
        slots = base_slots(school).filter(is_active=True, day=name)
        if offset == 0:
            slots = slots.filter(period__start_time__gt=now.time())
        slot = slots.order_by("period__start_time", "room_label", "id").first()
        if slot is not None:
            return slot, day
    return None, None


def prep_briefing(school, now=None) -> dict:
    """What the librarian should have ready for the next period: books due back, blocked members, holds to hand over."""
    now = now or local_now()
    slot, slot_date = next_slot(school, now)
    if slot is None:
        return {}
    members = LibraryMember.objects.filter(
        school=school, member_type=LibraryMember.MEMBER_STUDENT, is_active=True, student__current_class_id=slot.school_class_id
    )
    if slot.section_id:
        members = members.filter(student__current_section_id=slot.section_id)

    loans = BookIssue.objects.filter(
        school=school, status=BookIssue.STATUS_ISSUED, member__in=members, due_date__lte=slot_date
    ).select_related("book", "member__student")
    due_back = [
        {
            "issue_id": loan.pk,
            "book_title": loan.book.title,
            "member_name": person_name(loan.member),
            "due_date": loan.due_date.isoformat(),
            "days_overdue": days_overdue(loan.due_date, slot_date),
        }
        for loan in loans.order_by("due_date", "id")[:LIST_LIMIT]
    ]
    due_back_count = loans.count()

    blocked_ids = suspended_member_ids(school, get_settings(school))
    blocked_qs = members.filter(pk__in=blocked_ids).select_related("student")
    blocked = [
        {"member_id": m.pk, "member_name": person_name(m), "card_no": m.card_no}
        for m in blocked_qs.order_by("card_no")[:LIST_LIMIT]
    ]

    shelf = BookCopy.objects.filter(school=school, book=OuterRef("book"), status=BookCopy.STATUS_AVAILABLE)
    holds = (
        Hold.objects.filter(school=school, status=Hold.STATUS_WAITING, member__in=members)
        .filter(Exists(shelf))
        .select_related("book", "member__student")
    )
    holds_ready = [
        {"hold_id": h.pk, "book_title": h.book.title, "member_name": person_name(h.member)}
        for h in holds.order_by("created_at", "id")[:LIST_LIMIT]
    ]

    starts = datetime.combine(slot_date, slot.period.start_time, tzinfo=now.tzinfo)
    return {
        "slot": slot_summary(slot),
        "date": slot_date.isoformat(),
        "starts_in_minutes": max(0, int((starts - now).total_seconds() // 60)) if slot_date == now.date() else None,
        "due_back": {"count": due_back_count, "rows": due_back},
        "blocked": {"count": blocked_qs.count(), "rows": blocked},
        "holds_ready": {"count": holds.count(), "rows": holds_ready},
    }


def default_week_start(today: date) -> date:
    return today - timedelta(days=today.weekday())


def footfall(school, date_from: date, date_to: date) -> dict:
    """Visits per class between two dates (inclusive). Classes with a slot but no visits show 0."""
    rows = (
        Visit.objects.filter(school=school, visit_date__gte=date_from, visit_date__lte=date_to)
        .values("period_slot__school_class_id", "period_slot__school_class__name")
        .annotate(visits=Count("id"), members=Count("member", distinct=True))
    )
    by_class = {
        row["period_slot__school_class_id"]: {
            "school_class": row["period_slot__school_class_id"],
            "class_name": row["period_slot__school_class__name"],
            "visits": row["visits"],
            "members": row["members"],
        }
        for row in rows
    }
    for class_id, name in (
        PeriodSlot.objects.filter(school=school, is_active=True).values_list("school_class_id", "school_class__name").distinct()
    ):
        by_class.setdefault(class_id, {"school_class": class_id, "class_name": name, "visits": 0, "members": 0})
    results = sorted(by_class.values(), key=lambda r: (-r["visits"], r["class_name"]))
    return {
        "from": date_from.isoformat(),
        "to": date_to.isoformat(),
        "total": sum(r["visits"] for r in results),
        "results": results,
    }
