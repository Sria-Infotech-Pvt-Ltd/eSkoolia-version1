"""
Transport Attendance (boarding register) business logic.

A register for (date, shift) lists every student with an *allocated*
StudentTransportAllocation in the school, merged with any TransportAttendance
lines already recorded. Lines nobody has marked yet are returned as
`marked: false` - nothing is fabricated or written until someone marks them.
"""
from django.db import transaction

from ..models import StudentTransportAllocation, TransportAttendance


def allocated_queryset(school_id, route_id=None, vehicle_id=None, shift=None):
    queryset = StudentTransportAllocation.objects.filter(
        school_id=school_id, status="allocated", student__is_active=True, student__is_deleted=False
    )
    if shift:
        # Only routes that run this shift: a morning-only route has no afternoon drop register.
        queryset = queryset.filter(route__shift__in=[shift, "both"])
    queryset = queryset.select_related(
        "student", "student__current_class", "student__current_section", "route", "stop", "vehicle"
    )
    if route_id:
        queryset = queryset.filter(route_id=route_id)
    if vehicle_id:
        queryset = queryset.filter(vehicle_id=vehicle_id)
    return queryset.order_by("route__title", "stop__stop_order", "student__first_name")


def build_register(school_id, date, shift, route_id=None, vehicle_id=None):
    """One row per allocated student for the given date and shift."""
    allocations = list(allocated_queryset(school_id, route_id, vehicle_id, shift=shift))
    lines = {
        line.student_id: line
        for line in TransportAttendance.objects.filter(
            school_id=school_id, date=date, shift=shift, student_id__in=[a.student_id for a in allocations]
        )
    }
    rows = []
    for allocation in allocations:
        student = allocation.student
        line = lines.get(student.id)
        rows.append({
            "student": student.id,
            "student_name": f"{student.first_name} {student.last_name}".strip(),
            "admission_no": student.admission_no,
            "class_name": getattr(student.current_class, "name", None),
            "section_name": getattr(student.current_section, "name", None),
            "allocation": allocation.id,
            "route": allocation.route_id,
            "route_title": allocation.route.title if allocation.route else None,
            "stop": allocation.stop_id,
            "stop_name": allocation.stop.stop_name if allocation.stop else None,
            "scheduled_time": (
                (allocation.stop.scheduled_time if shift == "morning" else allocation.stop.drop_time)
                if allocation.stop else None
            ),
            "vehicle": allocation.vehicle_id,
            "vehicle_no": allocation.vehicle.vehicle_no if allocation.vehicle else None,
            "marked": line is not None,
            "boarded": line.boarded if line else False,
            "late": line.late if line else False,
            "note": line.note if line else "",
            "scanned_at": line.scanned_at if line else None,
            "source": line.source if line else None,
        })
    return rows


@transaction.atomic
def mark_entries(school_id, date, shift, entries, user):
    """
    Upsert register lines. Each entry: {"student": id, "boarded"?, "late"?, "note"?}.
    Only students with an allocated allocation in this school are accepted; one
    line per (student, date, shift) is guaranteed by the model's unique constraint.
    Marking a student late implies boarded.
    """
    allocations = {
        a.student_id: a
        for a in StudentTransportAllocation.objects.filter(
            school_id=school_id, status="allocated", student_id__in=[e["student"] for e in entries]
        )
    }
    unknown = [e["student"] for e in entries if e["student"] not in allocations]
    if unknown:
        raise ValueError(f"Students not allocated to transport in this school: {unknown}")

    saved = []
    for entry in entries:
        allocation = allocations[entry["student"]]
        line, _created = TransportAttendance.objects.get_or_create(
            student_id=entry["student"], date=date, shift=shift,
            defaults={
                "school_id": school_id, "allocation": allocation, "route_id": allocation.route_id,
                "stop_id": allocation.stop_id, "vehicle_id": allocation.vehicle_id,
            },
        )
        if "boarded" in entry:
            line.boarded = bool(entry["boarded"])
            if not line.boarded:
                line.late = False
        if "late" in entry:
            line.late = bool(entry["late"])
            if line.late:
                line.boarded = True
        if "note" in entry:
            line.note = (entry["note"] or "")[:255]
        line.source = "manual"
        line.marked_by = user
        line.save()
        saved.append(line)
    return saved


def absent_students(school_id, date, shift):
    """Allocated students not marked boarded for that date/shift (unmarked counts as absent)."""
    boarded_ids = set(
        TransportAttendance.objects.filter(school_id=school_id, date=date, shift=shift, boarded=True)
        .values_list("student_id", flat=True)
    )
    return [a for a in allocated_queryset(school_id, shift=shift) if a.student_id not in boarded_ids]
