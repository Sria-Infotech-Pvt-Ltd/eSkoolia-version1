"""
Transport Settings (one record per school, stored in TransportSettings.config).

`DEFAULTS` mirrors the Settings screen. Saved values are merged over the
defaults section by section, so a school that never saved settings - or a
section added later - always gets a complete, valid configuration. The school
location (geofence lat/lng) has no default: it stays empty until the school
sets it.
"""
import copy

from ..models import TransportSettings

DEFAULTS = {
    "geofence": {"lat": None, "lng": None, "radius": 150},
    "shifts": {"morningPickup": "06:30", "schoolArrival": "08:50", "afternoonDrop": "15:20"},
    "thresholds": {"overspeed": 50, "lateMin": 8, "deviationM": 500, "idleMin": 10, "sosEscalation": "Transport in-charge"},
    "notifications": {"boardedDropped": True, "approaching": True, "delay": True, "smsFallback": False, "language": "English"},
    "fees": {"billingCycle": "Monthly", "siblingConcession": 10},
    "fareSlabs": [
        {"from": 0, "to": 3, "fare": 1400}, {"from": 3, "to": 6, "fare": 1800},
        {"from": 6, "to": 10, "fare": 2200}, {"from": 10, "to": 15, "fare": 2600},
    ],
    "reminders": {"vehicleDocsDays": 30, "licenceDays": 60, "firstAidDays": 60, "blockExpired": True},
}


def merged(config):
    """Defaults overlaid with the saved config (dict sections merged key by key)."""
    result = copy.deepcopy(DEFAULTS)
    for section, value in (config or {}).items():
        if section not in result:
            continue
        if isinstance(result[section], dict) and isinstance(value, dict):
            result[section].update({k: v for k, v in value.items() if k in result[section]})
        else:
            result[section] = value
    return result


def get_settings(school_id):
    """Complete settings for a school (defaults when nothing is saved)."""
    if not school_id:
        return copy.deepcopy(DEFAULTS)
    row = TransportSettings.objects.filter(school_id=school_id).only("config").first()
    return merged(row.config if row else None)


def reminder_days(school_id, key):
    return int(get_settings(school_id)["reminders"][key])
