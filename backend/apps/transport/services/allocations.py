"""
Student Transport Allocation business logic.

The allocation (StudentTransportAllocation) is the source of truth. The older
Student.transport_route / Student.vehicle columns - still read by the student
transport report, the student portal and the legacy pages - are kept as a mirror
of the *allocated* route and vehicle, so those keep working unchanged.
"""
from django.db import transaction

from apps.core.models import AcademicYear
from apps.students.models import Student

from ..models import AssignVehicle, StudentTransportAllocation


def route_vehicle(route):
    """The vehicle actively assigned to a route (AssignVehicle), if any."""
    if route is None:
        return None
    assignment = (
        AssignVehicle.objects.filter(route=route, school_id=route.school_id, active_status=True)
        .select_related("vehicle")
        .first()
    )
    return assignment.vehicle if assignment else None


def default_fare(route, stop):
    """Stop fare when set, otherwise the route's fare."""
    if stop is not None and stop.monthly_fare is not None:
        return stop.monthly_fare
    return route.fare if route is not None else None


def academic_year_for(student):
    """The student's own academic year, else the school's current (or latest) year."""
    if student.academic_year_id:
        return student.academic_year
    year = AcademicYear.objects.filter(school_id=student.school_id, is_current=True).first()
    return year or AcademicYear.objects.filter(school_id=student.school_id).order_by("-start_date").first()


def mirror_to_student(allocation):
    """Copy the allocated route/vehicle onto the legacy Student columns (cleared when not allocated)."""
    allocated = allocation.status == "allocated"
    Student.objects.filter(pk=allocation.student_id).update(
        transport_route=allocation.route if allocated else None,
        vehicle=allocation.vehicle if allocated else None,
    )


@transaction.atomic
def allocate_students(students, route, stop, vehicle=None, status="allocated", monthly_fare=None):
    """
    Create or update one allocation per student (per academic year).
    Vehicle defaults to the route's assigned vehicle; fare to the stop/route fare.
    """
    vehicle = vehicle or route_vehicle(route)
    fare = monthly_fare if monthly_fare is not None else default_fare(route, stop)
    allocations = []
    for student in students:
        allocation, _created = StudentTransportAllocation.objects.update_or_create(
            student=student,
            academic_year=academic_year_for(student),
            defaults={
                "school_id": student.school_id,
                "route": route,
                "stop": stop,
                "vehicle": vehicle,
                "status": status,
                "monthly_fare": fare if status == "allocated" else None,
            },
        )
        mirror_to_student(allocation)
        allocations.append(allocation)
    return allocations


@transaction.atomic
def release_allocations(allocations):
    """Remove students from transport: back to Pending with no route/stop/vehicle/fare."""
    for allocation in allocations:
        allocation.status = "pending"
        allocation.route = None
        allocation.stop = None
        allocation.vehicle = None
        allocation.monthly_fare = None
        allocation.save(update_fields=["status", "route", "stop", "vehicle", "monthly_fare", "updated_at"])
        mirror_to_student(allocation)
    return allocations
