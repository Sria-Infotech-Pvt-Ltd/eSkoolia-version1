"""
Live tracking business logic: processing one GPS position for a vehicle.

Shared by the GPS update API (BusLocationViewSet.create) and the development
simulator (manage.py simulate_bus_gps), so both follow the same rules.

Rules (Phase 2):
- A stop counts as reached when the vehicle enters its geofence; that is stored as
  a StopArrival, independent of whether anyone boards there.
- Only students *allocated to that stop* (StudentTransportAllocation) are marked
  picked up - previously every student on the route was marked at every stop.
- Simulated positions never notify parents and never mark school attendance.
- Speed above Transport Settings thresholds.overspeed raises an overspeed alert
  (at most one open overspeed alert per vehicle per OVERSPEED_COOLDOWN).
"""
import math
from dataclasses import dataclass, field
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from ..models import (
    AssignVehicle,
    BusLocation,
    BusRoutePickupUpdate,
    BusStop,
    RoutePerformanceLog,
    StopArrival,
    StudentTransportAllocation,
    TransportAlert,
    TransportAttendance,
)
from .settings import get_settings

OVERSPEED_COOLDOWN = timedelta(minutes=10)


def haversine_km(lat1, lng1, lat2, lng2):
    """Great-circle distance in km."""
    radius_km = 6371
    lat_delta = math.radians(lat2 - lat1)
    lng_delta = math.radians(lng2 - lng1)
    a = (
        math.sin(lat_delta / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(lng_delta / 2) ** 2
    )
    return radius_km * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))


def shift_for(moment=None):
    """Morning pickup before noon (local time), afternoon drop after."""
    local = timezone.localtime(moment or timezone.now())
    return "morning" if local.hour < 12 else "afternoon"


@dataclass
class GpsResult:
    location: BusLocation
    next_stop: BusStop | None = None
    eta_minutes: int | None = None
    distance_to_next_km: float | None = None
    stop_reached: dict | None = None
    alert: TransportAlert | None = None
    overspeed_alert: TransportAlert | None = None
    # Students picked up at the reached stop - notified after the transaction commits.
    picked_students: list = field(default_factory=list)


def _reached_stop_ids_today(vehicle, today):
    arrived = set(StopArrival.objects.filter(vehicle=vehicle, date=today).values_list("stop_id", flat=True))
    # Pickup rows written before StopArrival existed still count.
    legacy = set(
        BusRoutePickupUpdate.objects.filter(
            vehicle=vehicle, arrived_at__date=today, status__in=["arrived", "picked_up"]
        ).values_list("stop_id", flat=True)
    )
    return arrived | legacy


@transaction.atomic
def process_gps_update(vehicle, latitude, longitude, speed=0, heading=0, accuracy=0, *, simulated=False):
    """Store the position, detect stop arrival and update route progress. Returns a GpsResult."""
    now = timezone.now()
    today = timezone.localdate()

    location, _created = BusLocation.objects.update_or_create(
        vehicle=vehicle,
        defaults={
            "latitude": latitude,
            "longitude": longitude,
            "speed": speed,
            "heading": heading,
            "accuracy": accuracy,
            "is_active": True,
            "is_simulated": simulated,
        },
    )
    result = GpsResult(location=location)

    assignment = (
        AssignVehicle.objects.filter(vehicle=vehicle, school_id=vehicle.school_id, active_status=True)
        .select_related("route")
        .first()
    )
    if assignment:
        route_stops = list(BusStop.objects.filter(route_id=assignment.route_id, active_status=True).order_by("stop_order", "id"))
        reached = _reached_stop_ids_today(vehicle, today)
        next_stop = next((stop for stop in route_stops if stop.id not in reached), None)
        result.next_stop = next_stop

        if next_stop:
            distance_km = haversine_km(latitude, longitude, float(next_stop.latitude), float(next_stop.longitude))
            result.distance_to_next_km = distance_km
            if speed >= 5:
                result.eta_minutes = max(1, round((distance_km / max(speed, 1)) * 60))

            geofence_m = max(1, int(next_stop.geofence_radius or 100))
            if distance_km * 1000 <= geofence_m:
                # As before the refactor, this ping still reports the reached stop as next_stop;
                # the following ping moves on (the stop is now in StopArrival).
                _record_stop_arrival(result, vehicle, assignment, next_stop, latitude, longitude, now, today, simulated)

    result.overspeed_alert = _check_overspeed(vehicle, assignment, speed, now, simulated)

    vehicle.current_latitude = latitude
    vehicle.current_longitude = longitude
    vehicle.current_speed = speed
    vehicle.status = "at_stop" if result.stop_reached else ("in_transit" if speed > 0 else "idle")
    vehicle.last_location_update = now
    vehicle.next_stop = result.next_stop
    vehicle.is_tracking_active = True
    vehicle.save(update_fields=[
        "current_latitude", "current_longitude", "current_speed", "status",
        "last_location_update", "next_stop", "is_tracking_active",
    ])

    if assignment:
        total_stops = BusStop.objects.filter(route_id=assignment.route_id, active_status=True).count()
        completed = StopArrival.objects.filter(vehicle=vehicle, date=today, stop__route_id=assignment.route_id).count()
        RoutePerformanceLog.objects.update_or_create(
            route_id=assignment.route_id,
            vehicle=vehicle,
            log_date=today,
            defaults={
                "avg_speed_kmh": speed,
                "completed_stops": completed,
                "total_stops": total_stops,
                "completed": result.next_stop is None and total_stops > 0,
            },
        )
    return result


def _check_overspeed(vehicle, assignment, speed, now, simulated):
    limit = int(get_settings(vehicle.school_id)["thresholds"]["overspeed"])
    if speed <= limit:
        return None
    recent = TransportAlert.objects.filter(
        vehicle=vehicle, alert_type="overspeed", created_at__gte=now - OVERSPEED_COOLDOWN
    ).exclude(state="resolved")
    if recent.exists():
        return None
    suffix = " (simulated)" if simulated else ""
    return TransportAlert.objects.create(
        vehicle=vehicle,
        route_id=assignment.route_id if assignment else None,
        alert_type="overspeed",
        severity="critical" if speed >= limit + 20 else "warning",
        message=f"{vehicle.vehicle_no} at {speed} km/h - limit {limit} km/h{suffix}",
    )


def _record_stop_arrival(result, vehicle, assignment, stop, latitude, longitude, now, today, simulated):
    StopArrival.objects.get_or_create(
        vehicle=vehicle, stop=stop, date=today, defaults={"arrived_at": now, "is_simulated": simulated}
    )
    allocations = list(
        StudentTransportAllocation.objects.filter(
            school_id=vehicle.school_id, status="allocated", stop=stop,
            student__is_active=True, student__is_deleted=False,
        ).select_related("student")
    )
    shift = shift_for(now)
    for allocation in allocations:
        student = allocation.student
        pickup, created = BusRoutePickupUpdate.objects.get_or_create(
            stop=stop, vehicle=vehicle, student=student,
            defaults={"arrived_at": now, "picked_up_at": now, "status": "picked_up"},
        )
        if not created and pickup.status != "picked_up":
            pickup.arrived_at = now
            pickup.picked_up_at = now
            pickup.status = "picked_up"
            pickup.save(update_fields=["arrived_at", "picked_up_at", "status"])
        # Boarding register: GPS only fills lines nobody has marked yet - manual marks win.
        TransportAttendance.objects.get_or_create(
            student=student, date=today, shift=shift,
            defaults={
                "school_id": vehicle.school_id, "allocation": allocation, "route_id": assignment.route_id,
                "stop": stop, "vehicle": vehicle, "boarded": True, "scanned_at": now, "source": "gps",
            },
        )
    result.picked_students = [a.student for a in allocations]

    if not simulated:
        _mark_school_attendance_present(result.picked_students, now.date())

    suffix = " (simulated)" if simulated else ""
    result.alert = TransportAlert.objects.create(
        vehicle=vehicle,
        route_id=assignment.route_id,
        alert_type="arrived",
        message=f"{vehicle.vehicle_no} reached {stop.stop_name} - {len(allocations)} students marked picked up{suffix}",
        severity="info",
        latitude=latitude,
        longitude=longitude,
    )
    result.stop_reached = {
        "stop_id": stop.id,
        "stop_name": stop.stop_name,
        "students_picked": len(allocations),
        "timestamp": now.isoformat(),
        "simulated": simulated,
    }


def _mark_school_attendance_present(students, attendance_date):
    """Existing behaviour kept: boarding the bus marks the student present for the day."""
    from apps.attendance.models import StudentAttendance

    for student in students:
        StudentAttendance.objects.get_or_create(
            school_id=student.school_id,
            academic_year_id=student.academic_year_id,
            student_id=student.id,
            attendance_date=attendance_date,
            defaults={
                "class_id": student.current_class_id,
                "section_id": student.current_section_id,
                "attendance_type": "P",
                "notes": "Auto-marked present by transport pickup.",
            },
        )
