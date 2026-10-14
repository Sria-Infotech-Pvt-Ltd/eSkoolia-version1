"""
Maintenance and Fuel business logic.

Service records: the stored status is what the transport desk set (scheduled,
in workshop, completed). For jobs not yet done, the displayed status is derived
from the service date: past -> overdue, within DUE_SOON_DAYS -> due soon.

Fuel: mileage uses the full-tank method on the vehicle's own log, ordered by
date then odometer. Derived fields are recomputed for the whole vehicle after
every create / edit / delete, because one entry's km/L depends on the previous
entry's odometer.
"""
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from ..models import FuelEntry, Vehicle

DUE_SOON_DAYS = 7  # moves to Transport Settings in Phase 4
ANOMALY_RATIO = Decimal("0.80")  # km/L below 80% of the vehicle's baseline is flagged
BASELINE_WINDOW = 5  # baseline = average km/L of up to 5 earlier entries
CENT = Decimal("0.01")


# Maintenance
def service_display_status(record, today=None):
    """completed | in_workshop | overdue | due_soon | scheduled."""
    if record.status in ("completed", "in_workshop"):
        return record.status
    today = today or timezone.localdate()
    days = (record.service_date - today).days
    if days < 0:
        return "overdue"
    if days <= DUE_SOON_DAYS:
        return "due_soon"
    return "scheduled"


def due_services(queryset, today=None):
    """Records that are overdue or due soon (not completed, not in the workshop)."""
    today = today or timezone.localdate()
    return queryset.filter(status="scheduled", service_date__lte=today + timedelta(days=DUE_SOON_DAYS))


@transaction.atomic
def complete_services(records, user=None):
    now = timezone.now()
    done = []
    for record in records:
        if record.status != "completed":
            record.status = "completed"
            record.completed_at = now
            record.save(update_fields=["status", "completed_at", "updated_at"])
            done.append(record)
    return done


# Fuel Management
def _money(value):
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


@transaction.atomic
def recompute_vehicle_fuel(vehicle_id):
    """Recompute amount, distance, km/L, baseline and anomaly for one vehicle's log."""
    history = []
    previous = None
    for entry in FuelEntry.objects.select_for_update().filter(vehicle_id=vehicle_id).order_by("date", "odometer_km", "id"):
        amount = _money(entry.litres * entry.rate)
        distance = None
        kml = None
        if previous is not None and entry.odometer_km > previous.odometer_km:
            distance = entry.odometer_km - previous.odometer_km
            if entry.litres > 0:
                kml = _money(Decimal(distance) / entry.litres)
        recent = history[-BASELINE_WINDOW:]
        baseline = _money(sum(recent) / len(recent)) if recent else None
        anomaly = kml is not None and baseline is not None and kml < baseline * ANOMALY_RATIO

        changed = (entry.amount, entry.distance_km, entry.kml, entry.baseline_kml, entry.anomaly) != (
            amount, distance, kml, baseline, anomaly
        )
        if changed:
            entry.amount, entry.distance_km, entry.kml, entry.baseline_kml, entry.anomaly = (
                amount, distance, kml, baseline, anomaly
            )
            entry.save(update_fields=["amount", "distance_km", "kml", "baseline_kml", "anomaly", "updated_at"])
        if kml is not None:
            history.append(kml)
        previous = entry

    # Keep the vehicle's odometer at the highest reading logged anywhere.
    highest = FuelEntry.objects.filter(vehicle_id=vehicle_id).aggregate(top=Max("odometer_km"))["top"]
    if highest is not None:
        Vehicle.objects.filter(pk=vehicle_id).exclude(odometer_km__gte=highest).update(odometer_km=highest)


def neighbouring_odometers(vehicle_id, date, exclude_id=None):
    """(highest odometer logged on/before `date`, lowest odometer logged after `date`) for validation."""
    entries = FuelEntry.objects.filter(vehicle_id=vehicle_id)
    if exclude_id:
        entries = entries.exclude(pk=exclude_id)
    before = entries.filter(date__lte=date).aggregate(top=Max("odometer_km"))["top"]
    after = entries.filter(date__gt=date).order_by("odometer_km").values_list("odometer_km", flat=True).first()
    return before, after

