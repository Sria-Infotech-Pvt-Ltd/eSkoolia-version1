"""
Transport dashboard summary. Every number is counted from stored records for
the user's school - vehicles, allocations, boarding register, alerts,
maintenance and fuel. Nothing is estimated; empty data gives zeros / nulls.
"""
from datetime import timedelta

from django.db.models import Count, Max, Q, Sum

from ..models import (
    DEFAULT_CAPACITY_BY_TYPE, FuelEntry, StudentTransportAllocation, TransportAlert, TransportAttendance, Vehicle,
    VehicleServiceRecord,
)
from .settings import reminder_days
from .upkeep import DUE_SOON_DAYS

COMPLIANCE_FIELDS = ["fitness_valid_till", "insurance_valid_till", "permit_valid_till", "pollution_valid_till"]


def vehicle_capacity(vehicle):
    return vehicle.seating_capacity or DEFAULT_CAPACITY_BY_TYPE.get(vehicle.vehicle_type, 0)


def build_summary(school_id, today, shift):
    vehicles = list(Vehicle.objects.filter(school_id=school_id, active_status=True))
    month_start = today.replace(day=1)

    # Fleet
    by_status = {}
    for vehicle in vehicles:
        by_status[vehicle.operational_status] = by_status.get(vehicle.operational_status, 0) + 1
    soon = today + timedelta(days=reminder_days(school_id, "vehicleDocsDays"))
    expired_docs = expiring_docs = 0
    for vehicle in vehicles:
        for field in COMPLIANCE_FIELDS:
            valid_till = getattr(vehicle, field)
            if valid_till is None:
                continue
            if valid_till < today:
                expired_docs += 1
            elif valid_till <= soon:
                expiring_docs += 1

    # Students and seats
    allocations = StudentTransportAllocation.objects.filter(
        school_id=school_id, student__is_active=True, student__is_deleted=False
    )
    allocation_counts = allocations.aggregate(
        allocated=Count("id", filter=Q(status="allocated")),
        pending=Count("id", filter=Q(status="pending")),
        waitlisted=Count("id", filter=Q(status="waitlisted")),
    )
    active_ids = [v.id for v in vehicles]
    seats_used = allocations.filter(status="allocated", vehicle_id__in=active_ids).count()
    seats_total = sum(vehicle_capacity(v) for v in vehicles)

    # Boarding register (today, current shift)
    register = TransportAttendance.objects.filter(school_id=school_id, date=today, shift=shift)
    boarding = register.aggregate(
        marked=Count("id"), boarded=Count("id", filter=Q(boarded=True)), late=Count("id", filter=Q(late=True)),
    )
    week_start = today - timedelta(days=6)
    per_day = dict(
        TransportAttendance.objects.filter(
            school_id=school_id, shift="morning", boarded=True, date__gte=week_start, date__lte=today
        ).order_by().values("date").annotate(total=Count("id")).values_list("date", "total")
    )
    boardings_week = [
        {"date": day, "day": day.strftime("%a"), "value": per_day.get(day, 0)}
        for day in (week_start + timedelta(days=i) for i in range(7))
    ]

    # Alerts
    alerts = TransportAlert.objects.filter(vehicle__school_id=school_id).exclude(state="resolved")
    alert_counts = alerts.aggregate(
        open=Count("id"),
        critical=Count("id", filter=Q(severity="critical")),
        delays_today=Count("id", filter=Q(alert_type="running_late", created_at__date=today)),
    )

    # Maintenance and fuel
    services = VehicleServiceRecord.objects.filter(school_id=school_id, vehicle__active_status=True)
    due_window = today + timedelta(days=DUE_SOON_DAYS)
    maintenance = services.aggregate(
        overdue=Count("id", filter=Q(status="scheduled", service_date__lt=today)),
        due_soon=Count("id", filter=Q(status="scheduled", service_date__gte=today, service_date__lte=due_window)),
        in_workshop=Count("id", filter=Q(status="in_workshop")),
        spend_mtd=Sum("cost", filter=Q(status="completed", service_date__gte=month_start, service_date__lte=today)),
    )
    fuel = FuelEntry.objects.filter(school_id=school_id, date__gte=month_start, date__lte=today).aggregate(
        spend=Sum("amount"), litres=Sum("litres"), anomalies=Count("id", filter=Q(anomaly=True, verified=False)),
    )

    last_synced = Vehicle.objects.filter(school_id=school_id).aggregate(last=Max("last_location_update"))["last"]

    return {
        "date": today,
        "shift": shift,
        "last_synced": last_synced,
        "fleet": {
            "total": len(vehicles),
            "by_status": by_status,
            "documents_expired": expired_docs,
            "documents_expiring": expiring_docs,
        },
        "students": {
            **allocation_counts,
            "boarded": boarding["boarded"],
            "marked": boarding["marked"],
            "late": boarding["late"],
        },
        "seats": {
            "used": seats_used,
            "total": seats_total,
            "utilisation_pct": round(seats_used * 100 / seats_total, 1) if seats_total else None,
        },
        "alerts": alert_counts,
        "maintenance": {
            "overdue": maintenance["overdue"],
            "due_soon": maintenance["due_soon"],
            "due": maintenance["overdue"] + maintenance["due_soon"],
            "in_workshop": maintenance["in_workshop"],
            "spend_mtd": maintenance["spend_mtd"] or 0,
        },
        "fuel": {
            "spend_mtd": fuel["spend"] or 0,
            "litres_mtd": fuel["litres"] or 0,
            "open_anomalies": fuel["anomalies"],
        },
        "boardings_week": boardings_week,
    }
