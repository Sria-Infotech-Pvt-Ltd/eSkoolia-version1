"""
Transport reports, calculated from stored records for the user's school.

Each report returns one table shape the Reports screen can preview and export:
    {"key", "name", "period", "scope", "stats": [{label, value, kind}],
     "columns": [{key, header, kind}], "rows": [{<column key>: value, "_tone": ...}],
     "totals": {<column key>: value}, "notes": [...]}
`kind` is text | int | money | percent | km | date so the frontend formats values;
`_tone` (ok | warn | danger) marks rows worth highlighting. No figure is
estimated: where the data does not exist yet the value is null and a note says why.
"""
from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.utils import timezone

from ..models import (
    AssignVehicle, BusStop, FuelEntry, StudentTransportAllocation, TransportAttendance, TransportRoute,
    TransportStaffProfile, Vehicle, VehicleServiceRecord,
)
from .dashboard import vehicle_capacity

REPORTS = [
    {"key": "route-strength", "name": "Route-wise strength", "category": "Students", "rhythm": "Monthly",
     "description": "Allocated students, stops and seat utilisation per route."},
    {"key": "vehicle-utilisation", "name": "Vehicle utilisation", "category": "Fleet", "rhythm": "Monthly",
     "description": "Seats used, kilometres run (from the fuel log) and utilisation per vehicle."},
    {"key": "fee-collection", "name": "Transport fee collection", "category": "Finance", "rhythm": "Monthly",
     "description": "Monthly transport fares billed from allocations against posted fee payments."},
    {"key": "driver-roster", "name": "Driver duty roster", "category": "Staff", "rhythm": "Weekly",
     "description": "Drivers and attendants with shift, duty status, vehicle and document validity."},
    {"key": "boarding-register", "name": "Daily boarding register", "category": "Attendance", "rhythm": "Daily",
     "description": "Allocated, boarded, not boarded, unmarked and late students per route for a day and shift."},
    {"key": "fuel-maintenance-cost", "name": "Fuel & maintenance cost", "category": "Finance", "rhythm": "Monthly",
     "description": "Fuel spend and completed maintenance per vehicle, with cost per allocated student."},
]
REPORT_KEYS = {r["key"] for r in REPORTS}
TRANSPORT_FEE_MATCH = "transport"  # fee types / groups whose name contains this count as transport fees


def col(key, header, kind="text"):
    return {"key": key, "header": header, "kind": kind}


def pct(part, whole):
    return round(float(part) * 100 / float(whole), 1) if whole else None


def tone_for_utilisation(value):
    if value is None:
        return None
    return "danger" if value > 95 else "warn" if value > 80 else "ok"


def month_bounds(month):
    """(first day, last day) of a date's month."""
    start = month.replace(day=1)
    following = (start + timedelta(days=32)).replace(day=1)
    return start, following - timedelta(days=1)


def _route_vehicles(school_id):
    assignments = AssignVehicle.objects.filter(school_id=school_id, active_status=True).select_related("vehicle", "route")
    by_route, by_vehicle = {}, {}
    for assignment in assignments:
        by_route.setdefault(assignment.route_id, assignment.vehicle)
        by_vehicle.setdefault(assignment.vehicle_id, assignment.route)
    return by_route, by_vehicle


def _routes(school_id, route_id):
    routes = TransportRoute.objects.filter(school_id=school_id, active_status=True)
    if route_id:
        routes = routes.filter(pk=route_id)
    return list(routes.order_by("code", "title", "id"))


def _route_label(route):
    return f"{route.code} - {route.title}" if route.code else route.title


def _allocated(school_id):
    return StudentTransportAllocation.objects.filter(
        school_id=school_id, status="allocated", student__is_active=True, student__is_deleted=False
    )


def build_report(key, school_id, *, route_id=None, month=None, day=None, shift="morning"):
    today = timezone.localdate()
    month = month or today
    day = day or today
    builder = {
        "route-strength": _route_strength,
        "vehicle-utilisation": _vehicle_utilisation,
        "fee-collection": _fee_collection,
        "driver-roster": _driver_roster,
        "boarding-register": _boarding_register,
        "fuel-maintenance-cost": _fuel_maintenance_cost,
    }[key]
    definition = next(r for r in REPORTS if r["key"] == key)
    route = TransportRoute.objects.filter(school_id=school_id, pk=route_id).first() if route_id else None
    body = builder(school_id, route_id=route_id, month=month, day=day, shift=shift)
    return {
        "key": key,
        "name": definition["name"],
        "scope": _route_label(route) if route else "All routes",
        "notes": [],
        **body,
    }


# Reports
def _route_strength(school_id, route_id, **_):
    by_route, _by_vehicle = _route_vehicles(school_id)
    students = dict(
        _allocated(school_id).order_by().values("route_id").annotate(n=Count("id")).values_list("route_id", "n")
    )
    stops = dict(
        BusStop.objects.filter(route__school_id=school_id, active_status=True)
        .order_by().values("route_id").annotate(n=Count("id")).values_list("route_id", "n")
    )
    rows = []
    for route in _routes(school_id, route_id):
        vehicle = by_route.get(route.id)
        capacity = vehicle_capacity(vehicle) if vehicle else 0
        count = students.get(route.id, 0)
        utilisation = pct(count, capacity)
        rows.append({
            "route": _route_label(route), "vehicle": vehicle.vehicle_no if vehicle else None,
            "stops": stops.get(route.id, 0), "students": count, "capacity": capacity,
            "utilisation": utilisation, "_tone": tone_for_utilisation(utilisation),
        })
    total_students = sum(r["students"] for r in rows)
    total_capacity = sum(r["capacity"] for r in rows)
    return {
        "period": f"As of {timezone.localdate():%d %b %Y}",
        "stats": [
            {"label": "Students", "value": total_students, "kind": "int"},
            {"label": "Stops", "value": sum(r["stops"] for r in rows), "kind": "int"},
            {"label": "Avg utilisation", "value": pct(total_students, total_capacity), "kind": "percent"},
        ],
        "columns": [col("route", "Route"), col("vehicle", "Vehicle"), col("stops", "Stops", "int"),
                    col("students", "Students", "int"), col("capacity", "Seats", "int"),
                    col("utilisation", "Utilisation", "percent")],
        "rows": rows,
        "totals": {"route": "Total", "stops": sum(r["stops"] for r in rows), "students": total_students,
                   "capacity": total_capacity, "utilisation": pct(total_students, total_capacity)},
    }


def _vehicle_utilisation(school_id, route_id, month, **_):
    start, end = month_bounds(month)
    _by_route, by_vehicle = _route_vehicles(school_id)
    vehicles = Vehicle.objects.filter(school_id=school_id, active_status=True).order_by("vehicle_no", "id")
    if route_id:
        vehicles = vehicles.filter(assignments__route_id=route_id, assignments__active_status=True).distinct()
    seats = dict(
        _allocated(school_id).order_by().values("vehicle_id").annotate(n=Count("id")).values_list("vehicle_id", "n")
    )
    fuel = {
        row["vehicle_id"]: row
        for row in FuelEntry.objects.filter(school_id=school_id, date__gte=start, date__lte=end)
        .order_by().values("vehicle_id").annotate(km=Sum("distance_km"), litres=Sum("litres"))
    }
    rows = []
    for vehicle in vehicles:
        capacity = vehicle_capacity(vehicle)
        used = seats.get(vehicle.id, 0)
        utilisation = pct(used, capacity)
        route = by_vehicle.get(vehicle.id)
        rows.append({
            "vehicle": vehicle.vehicle_no, "route": _route_label(route) if route else None,
            "status": vehicle.get_operational_status_display(), "seats_used": used, "capacity": capacity,
            "km": fuel.get(vehicle.id, {}).get("km") or 0, "litres": fuel.get(vehicle.id, {}).get("litres") or 0,
            "utilisation": utilisation, "_tone": tone_for_utilisation(utilisation),
        })
    used_total = sum(r["seats_used"] for r in rows)
    capacity_total = sum(r["capacity"] for r in rows)
    km_total = sum(r["km"] for r in rows)
    return {
        "period": f"{start:%B %Y}",
        "stats": [
            {"label": "Km run", "value": km_total, "kind": "km"},
            {"label": "Vehicles", "value": len(rows), "kind": "int"},
            {"label": "Seat utilisation", "value": pct(used_total, capacity_total), "kind": "percent"},
        ],
        "columns": [col("vehicle", "Vehicle"), col("route", "Route"), col("status", "Status"),
                    col("seats_used", "Seats used", "int"), col("capacity", "Seats", "int"),
                    col("km", "Km run", "km"), col("litres", "Fuel (L)", "int"), col("utilisation", "Utilisation", "percent")],
        "rows": rows,
        "totals": {"vehicle": "Total", "seats_used": used_total, "capacity": capacity_total, "km": km_total,
                   "litres": sum(r["litres"] for r in rows), "utilisation": pct(used_total, capacity_total)},
        "notes": ["Kilometres come from fuel-log odometer readings (full-tank method) in the period."],
    }


def _fee_collection(school_id, route_id, month, **_):
    from apps.fees.models import Payment

    start, end = month_bounds(month)
    allocations = list(_allocated(school_id).select_related("route"))
    if route_id:
        allocations = [a for a in allocations if a.route_id == int(route_id)]
    student_route = {a.student_id: a.route_id for a in allocations}
    paid = dict(
        Payment.objects.filter(
            student_id__in=student_route.keys(), status="posted", paid_at__date__gte=start, paid_at__date__lte=end,
        ).filter(
            Q(assignment__fees_type__name__icontains=TRANSPORT_FEE_MATCH)
            | Q(assignment__fees_type__fees_group__name__icontains=TRANSPORT_FEE_MATCH)
        ).order_by().values("student_id").annotate(total=Sum("amount_paid")).values_list("student_id", "total")
    )
    per_route = {}
    for allocation in allocations:
        row = per_route.setdefault(allocation.route_id, {
            "route": _route_label(allocation.route) if allocation.route else None,
            "students": 0, "billed": Decimal("0"), "collected": Decimal("0"), "defaulters": 0,
        })
        fare = allocation.monthly_fare or Decimal("0")
        collected = paid.get(allocation.student_id) or Decimal("0")
        row["students"] += 1
        row["billed"] += fare
        row["collected"] += collected
        if fare > 0 and collected < fare:
            row["defaulters"] += 1
    rows = []
    for row in sorted(per_route.values(), key=lambda r: r["route"] or ""):
        row["outstanding"] = max(row["billed"] - row["collected"], Decimal("0"))
        row["_tone"] = "danger" if row["outstanding"] > 0 else "ok"
        rows.append(row)
    billed = sum((r["billed"] for r in rows), Decimal("0"))
    collected = sum((r["collected"] for r in rows), Decimal("0"))
    return {
        "period": f"{start:%B %Y}",
        "stats": [
            {"label": "Billed", "value": billed, "kind": "money"},
            {"label": "Collected", "value": collected, "kind": "money"},
            {"label": "Collection rate", "value": pct(collected, billed), "kind": "percent"},
        ],
        "columns": [col("route", "Route"), col("students", "Students", "int"), col("billed", "Billed", "money"),
                    col("collected", "Collected", "money"), col("outstanding", "Outstanding", "money"),
                    col("defaulters", "Defaulters", "int")],
        "rows": rows,
        "totals": {"route": "Total", "students": sum(r["students"] for r in rows), "billed": billed,
                   "collected": collected, "outstanding": sum((r["outstanding"] for r in rows), Decimal("0")),
                   "defaulters": sum(r["defaulters"] for r in rows)},
        "notes": [
            "Billed = monthly fare on each allocated student's transport allocation.",
            "Collected = posted Fees payments in the month on fee types or groups whose name contains "
            f"\"{TRANSPORT_FEE_MATCH}\". Transport is not yet linked to a specific fee type.",
        ],
    }


def _driver_roster(school_id, **_):
    today = timezone.localdate()
    profiles = TransportStaffProfile.objects.filter(school_id=school_id).select_related("staff", "assigned_vehicle")
    driven = {
        v.driver_id: v for v in Vehicle.objects.filter(school_id=school_id, active_status=True, driver__isnull=False)
    }
    _by_route, by_vehicle = _route_vehicles(school_id)
    rows = []
    for profile in profiles.order_by("role", "staff__first_name", "id"):
        vehicle = driven.get(profile.staff_id) if profile.role == "driver" else profile.assigned_vehicle
        route = by_vehicle.get(vehicle.id) if vehicle else None
        valid_till = profile.licence_valid_till if profile.role == "driver" else profile.first_aid_valid_till
        expired = valid_till is not None and valid_till < today
        rows.append({
            "name": f"{profile.staff.first_name} {profile.staff.last_name}".strip(),
            "role": profile.get_role_display(), "shift": profile.get_shift_display(),
            "duty_status": profile.get_duty_status_display(),
            "vehicle": vehicle.vehicle_no if vehicle else None, "route": _route_label(route) if route else None,
            "document_valid_till": valid_till,
            "_tone": "danger" if expired else ("warn" if profile.duty_status == "on_leave" or valid_till is None else None),
        })
    return {
        "period": f"As of {today:%d %b %Y}",
        "stats": [
            {"label": "Drivers", "value": profiles.filter(role="driver").count(), "kind": "int"},
            {"label": "Attendants", "value": profiles.filter(role="attendant").count(), "kind": "int"},
            {"label": "On leave", "value": profiles.filter(duty_status="on_leave").count(), "kind": "int"},
        ],
        "columns": [col("name", "Name"), col("role", "Role"), col("shift", "Shift"), col("duty_status", "Duty status"),
                    col("vehicle", "Vehicle"), col("route", "Route"), col("document_valid_till", "Licence / first aid till", "date")],
        "rows": rows,
        "totals": {"name": f"{len(rows)} staff"},
        "notes": ["Document = driving licence for drivers, first-aid certificate for attendants."],
    }


def _boarding_register(school_id, route_id, day, shift, **_):
    allocations = _allocated(school_id).select_related("route", "vehicle")
    if route_id:
        allocations = allocations.filter(route_id=route_id)
    lines = {
        line.student_id: line
        for line in TransportAttendance.objects.filter(school_id=school_id, date=day, shift=shift)
    }
    per_route = {}
    for allocation in allocations:
        row = per_route.setdefault(allocation.route_id, {
            "route": _route_label(allocation.route) if allocation.route else None,
            "vehicle": allocation.vehicle.vehicle_no if allocation.vehicle else None,
            "allocated": 0, "boarded": 0, "not_boarded": 0, "unmarked": 0, "late": 0,
        })
        line = lines.get(allocation.student_id)
        row["allocated"] += 1
        if line is None:
            row["unmarked"] += 1
        elif line.boarded:
            row["boarded"] += 1
            row["late"] += int(line.late)
        else:
            row["not_boarded"] += 1
    rows = []
    for row in sorted(per_route.values(), key=lambda r: r["route"] or ""):
        row["on_time"] = pct(row["boarded"] - row["late"], row["allocated"])
        row["_tone"] = "danger" if row["not_boarded"] else ("warn" if row["unmarked"] else "ok")
        rows.append(row)

    def total(field):
        return sum(r[field] for r in rows)

    return {
        "period": f"{day:%d %b %Y} - {'morning pickup' if shift == 'morning' else 'afternoon drop'}",
        "stats": [
            {"label": "Boarded", "value": total("boarded"), "kind": "int"},
            {"label": "Not boarded", "value": total("not_boarded"), "kind": "int"},
            {"label": "Unmarked", "value": total("unmarked"), "kind": "int"},
        ],
        "columns": [col("vehicle", "Vehicle"), col("route", "Route"), col("allocated", "Allocated", "int"),
                    col("boarded", "Boarded", "int"), col("not_boarded", "Not boarded", "int"),
                    col("unmarked", "Unmarked", "int"), col("late", "Late", "int"), col("on_time", "On time", "percent")],
        "rows": rows,
        "totals": {"vehicle": "Total", **{f: total(f) for f in ("allocated", "boarded", "not_boarded", "unmarked", "late")},
                   "on_time": pct(total("boarded") - total("late"), total("allocated"))},
    }


def _fuel_maintenance_cost(school_id, route_id, month, **_):
    start, end = month_bounds(month)
    _by_route, by_vehicle = _route_vehicles(school_id)
    vehicles = Vehicle.objects.filter(school_id=school_id, active_status=True).order_by("vehicle_no", "id")
    if route_id:
        vehicles = vehicles.filter(assignments__route_id=route_id, assignments__active_status=True).distinct()
    fuel = dict(
        FuelEntry.objects.filter(school_id=school_id, date__gte=start, date__lte=end)
        .order_by().values("vehicle_id").annotate(t=Sum("amount")).values_list("vehicle_id", "t")
    )
    maintenance = dict(
        VehicleServiceRecord.objects.filter(
            school_id=school_id, status="completed", service_date__gte=start, service_date__lte=end
        ).order_by().values("vehicle_id").annotate(t=Sum("cost")).values_list("vehicle_id", "t")
    )
    students = dict(
        _allocated(school_id).order_by().values("vehicle_id").annotate(n=Count("id")).values_list("vehicle_id", "n")
    )
    rows = []
    for vehicle in vehicles:
        fuel_cost = fuel.get(vehicle.id) or Decimal("0")
        maint_cost = maintenance.get(vehicle.id) or Decimal("0")
        riders = students.get(vehicle.id, 0)
        route = by_vehicle.get(vehicle.id)
        rows.append({
            "vehicle": vehicle.vehicle_no, "route": _route_label(route) if route else None,
            "fuel": fuel_cost, "maintenance": maint_cost, "total": fuel_cost + maint_cost, "students": riders,
            "per_student": round((fuel_cost + maint_cost) / riders, 2) if riders else None,
        })
    fuel_total = sum((r["fuel"] for r in rows), Decimal("0"))
    maint_total = sum((r["maintenance"] for r in rows), Decimal("0"))
    riders_total = sum(r["students"] for r in rows)
    per_student = round((fuel_total + maint_total) / riders_total, 2) if riders_total else None
    return {
        "period": f"{start:%B %Y}",
        "stats": [
            {"label": "Fuel", "value": fuel_total, "kind": "money"},
            {"label": "Maintenance", "value": maint_total, "kind": "money"},
            {"label": "Cost per student", "value": per_student, "kind": "money"},
        ],
        "columns": [col("vehicle", "Vehicle"), col("route", "Route"), col("fuel", "Fuel", "money"),
                    col("maintenance", "Maintenance", "money"), col("total", "Total", "money"),
                    col("students", "Students", "int"), col("per_student", "Per student", "money")],
        "rows": rows,
        "totals": {"vehicle": "Total", "fuel": fuel_total, "maintenance": maint_total,
                   "total": fuel_total + maint_total, "students": riders_total, "per_student": per_student},
        "notes": ["Maintenance counts completed service records dated in the period."],
    }
