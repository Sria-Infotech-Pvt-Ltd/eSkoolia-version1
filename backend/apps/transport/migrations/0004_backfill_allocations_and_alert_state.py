from django.db import migrations

BACKFILL_NOTE = "Backfilled from Student transport fields (Phase 2 migration)."


def backfill(apps, schema_editor):
    """
    1. Every student that already rides transport (Student.transport_route or
       Student.vehicle set) gets an *allocated* StudentTransportAllocation for their
       academic year, so existing transport students carry over. The pickup stop was
       never recorded before, so `stop` stays empty until someone sets it.
    2. Existing alerts get `state` from the legacy `is_resolved` flag.
    """
    Student = apps.get_model("students", "Student")
    AcademicYear = apps.get_model("core", "AcademicYear")
    AssignVehicle = apps.get_model("transport", "AssignVehicle")
    Allocation = apps.get_model("transport", "StudentTransportAllocation")
    TransportAlert = apps.get_model("transport", "TransportAlert")

    current_year_by_school = {}

    def year_for(student):
        if student.academic_year_id:
            return student.academic_year_id
        if student.school_id not in current_year_by_school:
            year = (
                AcademicYear.objects.filter(school_id=student.school_id, is_current=True).first()
                or AcademicYear.objects.filter(school_id=student.school_id).order_by("-start_date").first()
            )
            current_year_by_school[student.school_id] = year.id if year else None
        return current_year_by_school[student.school_id]

    riders = Student.objects.filter(is_deleted=False).exclude(transport_route__isnull=True, vehicle__isnull=True)
    for student in riders.iterator():
        year_id = year_for(student)
        if Allocation.objects.filter(student_id=student.id, academic_year_id=year_id).exists():
            continue
        vehicle_id = student.vehicle_id
        if vehicle_id is None and student.transport_route_id:
            assignment = AssignVehicle.objects.filter(route_id=student.transport_route_id, active_status=True).first()
            vehicle_id = assignment.vehicle_id if assignment else None
        fare = None
        if student.transport_route_id:
            route = student.transport_route
            fare = route.fare
        Allocation.objects.create(
            school_id=student.school_id,
            academic_year_id=year_id,
            student_id=student.id,
            route_id=student.transport_route_id,
            vehicle_id=vehicle_id,
            stop_id=None,
            status="allocated",
            monthly_fare=fare,
            notes=BACKFILL_NOTE,
        )

    TransportAlert.objects.filter(is_resolved=True).update(state="resolved")
    TransportAlert.objects.filter(is_resolved=False).update(state="open")


def undo_backfill(apps, schema_editor):
    Allocation = apps.get_model("transport", "StudentTransportAllocation")
    Allocation.objects.filter(notes=BACKFILL_NOTE).delete()
    # Alert `state` column is dropped by reversing 0003; nothing to undo here.


class Migration(migrations.Migration):

    dependencies = [
        ("transport", "0003_phase2_staff_allocation_attendance_alerts"),
        ("students", "0027_alter_student_transport_route_alter_student_vehicle"),
    ]

    operations = [
        migrations.RunPython(backfill, undo_backfill),
    ]
