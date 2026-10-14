"""
Frontend ↔ backend contract for the Transport screens.

Replays the requests that frontend/lib/transport/api.ts (load) and
frontend/lib/transport/actions.ts (store actions) send - same paths, same
payload shapes - and checks the response fields the adapters read. If a
serializer field or endpoint the screens depend on changes, this fails.
"""
from datetime import date, timedelta

from django.utils import timezone

from apps.hr.models import Staff
from apps.students.models import Guardian, Student
from apps.transport.models import BusStop, TransportAlert

B = "/api/v1/core"
PAGE = "page_size=10000"


def rows(response):
    body = response.data
    return body if isinstance(body, list) else body["results"]


def test_load_endpoints_return_the_fields_the_adapters_read(admin_client, school, academic_year):
    today = timezone.localdate()
    checks = {
        f"{B}/vehicles/?{PAGE}": None,
        f"{B}/transport-routes/?{PAGE}": None,
        f"{B}/bus-stops/?{PAGE}": None,
        f"{B}/transport-staff/?{PAGE}": None,
        f"{B}/transport-staff/candidates/": None,
        f"{B}/transport-allocations/?{PAGE}": None,
        f"{B}/transport-allocations/candidates/": None,
        f"{B}/transport-alerts/?exclude_types=arrived,left,near_school&{PAGE}": None,
        f"{B}/transport-maintenance/?{PAGE}": None,
        f"{B}/transport-fuel/?{PAGE}": None,
        f"{B}/transport-fuel/summary/": {"month", "spend", "litres", "km", "avg_kml", "per_vehicle", "trend"},
        f"{B}/transport-reports/": None,
        f"{B}/transport-reports/recent/": None,
        f"{B}/transport-settings/": {"geofence", "shifts", "thresholds", "notifications", "fees", "fareSlabs", "reminders"},
        f"{B}/transport-dashboard/": {"date", "shift", "last_synced", "fleet", "students", "seats", "alerts", "maintenance", "fuel", "boardings_week"},
        f"{B}/transport-attendance/boarding-rates/?days=30": {"days", "results"},
        f"{B}/bus-locations/live/": None,
        f"{B}/transport-attendance/register/?date={today.isoformat()}&shift=morning": {"date", "shift", "count", "results"},
    }
    for url, keys in checks.items():
        response = admin_client.get(url)
        assert response.status_code == 200, (url, response.status_code, getattr(response, "data", None))
        if keys:
            assert keys <= set(response.data), (url, keys - set(response.data))


def test_store_actions_round_trip(admin_client, school, academic_year):
    """Every store action, in screen order, through the same endpoints and payloads."""
    # vehicle/add (+ route assignment happens after route/add below)
    vehicle = admin_client.post(f"{B}/vehicles/", {
        "vehicle_no": "TS 01 AB 1234", "vehicle_model": "Tata", "vehicle_type": "van", "operational_status": "active",
        "fitness_valid_till": None, "insurance_valid_till": (date.today() + timedelta(days=200)).isoformat(),
        "driver": None, "active_status": True,
    }, format="json")
    assert vehicle.status_code == 201, vehicle.data
    vid = vehicle.data["id"]
    for key in ("vehicle_no", "vehicle_type", "capacity", "seats_occupied", "operational_status", "route", "odometer_km", "active_status"):
        assert key in vehicle.data

    # route/add with stops (coordinates required) and crew
    route = admin_client.post(f"{B}/transport-routes/", {
        "title": "Madhapur", "code": "R1", "shift": "both", "first_pickup_time": "06:40", "fare": 1800, "active_status": True,
    }, format="json")
    assert route.status_code == 201, route.data
    rid = route.data["id"]
    stop_ids = []
    for i, (name, lat) in enumerate([("A", 17.40), ("B", 17.45), ("C", 17.50)], start=1):
        stop = admin_client.post(f"{B}/bus-stops/", {
            "route": rid, "stop_order": i, "stop_name": name, "landmark": "", "latitude": lat, "longitude": 78.38,
        }, format="json")
        assert stop.status_code == 201, stop.data
        stop_ids.append(stop.data["id"])
    assigned = admin_client.post(f"{B}/assign-vehicles/", {"vehicle": vid, "route": rid, "active_status": True}, format="json")
    assert assigned.status_code == 201, assigned.data
    assignments = rows(admin_client.get(f"{B}/assign-vehicles/?{PAGE}"))
    assert {a["vehicle"] for a in assignments} == {vid}
    routes = rows(admin_client.get(f"{B}/transport-routes/?{PAGE}"))
    assert routes[0]["vehicle"]["vehicle_no"] == "TS 01 AB 1234"

    # stop/update with times, stop/reorder, stop/move, stop/remove
    assert admin_client.patch(f"{B}/bus-stops/{stop_ids[0]}/", {"scheduled_time": "06:40", "drop_time": None, "monthly_fare": 1500}, format="json").status_code == 200
    reorder = admin_client.put(f"{B}/bus-stops/reorder/", {"stops": [{"id": stop_ids[1], "stop_order": 1}, {"id": stop_ids[0], "stop_order": 2}, {"id": stop_ids[2], "stop_order": 3}]}, format="json")
    assert reorder.status_code == 200, reorder.data
    other = admin_client.post(f"{B}/transport-routes/", {"title": "Other", "code": "R2", "shift": "morning", "fare": 0, "active_status": True}, format="json")
    assert admin_client.patch(f"{B}/bus-stops/{stop_ids[2]}/", {"route": other.data["id"], "stop_order": 1}, format="json").status_code == 200
    assert admin_client.delete(f"{B}/bus-stops/{stop_ids[2]}/").status_code == 204

    # driver/add and attendant/add from HR staff, then assignVehicle via PATCH
    driver_staff = Staff.objects.create(school=school, staff_no="D1", first_name="Ravi", join_date="2024-01-01")
    attendant_staff = Staff.objects.create(school=school, staff_no="A1", first_name="Asha", join_date="2024-01-01")
    candidates = admin_client.get(f"{B}/transport-staff/candidates/").data
    assert {c["id"] for c in candidates} == {driver_staff.id, attendant_staff.id}
    driver = admin_client.post(f"{B}/transport-staff/", {
        "staff": driver_staff.id, "role": "driver", "shift": "full_day", "duty_status": "on_duty", "experience_years": 5,
        "licence_number": "TS0012345", "licence_valid_till": None, "vehicle": vid,
    }, format="json")
    assert driver.status_code == 201, driver.data
    for key in ("staff", "staff_name", "phone", "emergency_contact", "licence_number", "vehicle_detail", "duty_status", "shift"):
        assert key in driver.data
    attendant = admin_client.post(f"{B}/transport-staff/", {
        "staff": attendant_staff.id, "role": "attendant", "shift": "morning", "duty_status": "on_duty",
        "first_aid_certificate_no": "FA-1", "first_aid_valid_till": None, "vehicle": None,
    }, format="json")
    assert attendant.status_code == 201, attendant.data
    assert admin_client.patch(f"{B}/transport-staff/{attendant.data['id']}/", {"vehicle": vid}, format="json").status_code == 200

    # student/allocate (bulk-allocate), student/update to Waitlisted (PATCH), student/remove (release)
    guardian = Guardian.objects.create(school=school, full_name="[Guardian]", relation="mother", phone="9000000003")
    students = [Student.objects.create(school=school, academic_year=academic_year, admission_no=f"S{i}", first_name=f"N{i}", gender="male", guardian=guardian) for i in range(3)]
    pool = admin_client.get(f"{B}/transport-allocations/candidates/").data
    assert {"id", "name", "admission_no", "class_name", "section_name", "guardian_name", "guardian_phone"} <= set(pool[0])
    stop_a = stop_ids[1]
    bulk = admin_client.post(f"{B}/transport-allocations/bulk-allocate/", {"students": [s.id for s in students], "route": rid, "stop": stop_a}, format="json")
    assert bulk.status_code == 201, bulk.data
    allocations = rows(admin_client.get(f"{B}/transport-allocations/?{PAGE}"))
    for key in ("student", "student_name", "class_name", "section_name", "route", "stop", "vehicle_no", "monthly_fare", "status", "guardian_phone"):
        assert key in allocations[0]
    waitlist = admin_client.patch(f"{B}/transport-allocations/{allocations[0]['id']}/", {"status": "waitlisted", "route": None, "stop": None, "vehicle": None}, format="json")
    assert waitlist.status_code == 200, waitlist.data
    assert admin_client.post(f"{B}/transport-allocations/release/", {"ids": [allocations[1]["id"]]}, format="json").status_code == 200

    # attendance/set (mark) and notify-absent
    today = timezone.localdate().isoformat()
    marked = admin_client.post(f"{B}/transport-attendance/mark/", {
        "date": today, "shift": "morning", "entries": [{"student": allocations[2]["student"], "boarded": True, "late": False, "note": ""}],
    }, format="json")
    assert marked.status_code == 200, marked.data
    register = admin_client.get(f"{B}/transport-attendance/register/?date={today}&shift=morning").data["results"]
    assert {"student", "marked", "boarded", "late", "note", "scanned_at", "source"} <= set(register[0])
    assert admin_client.post(f"{B}/transport-attendance/notify-absent/", {"date": today, "shift": "morning"}, format="json").status_code == 200
    rates = admin_client.get(f"{B}/transport-attendance/boarding-rates/?days=30").data["results"]
    assert rates == [{"student": allocations[2]["student"], "marked": 1, "boarded": 1}]

    # alert/raise (+ acknowledge), alert/ack, alert/resolve (bulk)
    raised = admin_client.post(f"{B}/transport-alerts/", {
        "vehicle": vid, "route": rid, "alert_type": "running_late", "severity": "warning", "message": "Late — traffic",
    }, format="json")
    assert raised.status_code == 201, raised.data
    assert admin_client.post(f"{B}/transport-alerts/{raised.data['id']}/acknowledge/").status_code == 200
    TransportAlert.objects.create(vehicle_id=vid, alert_type="arrived", message="routine")
    listed = rows(admin_client.get(f"{B}/transport-alerts/?exclude_types=arrived,left,near_school&{PAGE}"))
    assert [a["alert_type"] for a in listed] == ["running_late"]  # routine stop events stay off the alerts desk
    for key in ("vehicle_no", "route_title", "alert_type", "severity", "message", "state", "created_at", "acknowledged_by_name", "resolved_by_name", "document"):
        assert key in listed[0]
    assert admin_client.post(f"{B}/transport-alerts/bulk-resolve/", {"ids": [raised.data["id"]]}, format="json").data["updated"] == 1

    # service/add, service/update, service/complete, service/delete
    service = admin_client.post(f"{B}/transport-maintenance/", {
        "vehicle": vid, "service_date": today, "service_type": "Oil change", "work_done": "", "cost": 1200,
        "odometer_km": None, "vendor": "Depot", "status": "scheduled",
    }, format="json")
    assert service.status_code == 201, service.data
    assert "display_status" in service.data
    assert admin_client.patch(f"{B}/transport-maintenance/{service.data['id']}/", {"status": "in_workshop"}, format="json").status_code == 200
    assert admin_client.post(f"{B}/transport-maintenance/complete/", {"ids": [service.data["id"]]}, format="json").data["completed"] == 1
    assert admin_client.post(f"{B}/transport-maintenance/bulk-delete/", {"ids": [service.data["id"]]}, format="json").data["deleted"] == 1

    # fuel/add ×2, fuel/update, fuel/verify, fuel/delete
    yesterday = (timezone.localdate() - timedelta(days=1)).isoformat()
    first = admin_client.post(f"{B}/transport-fuel/", {"vehicle": vid, "date": yesterday, "litres": 20, "rate": 100, "odometer_km": 1000, "station": "HP"}, format="json")
    second = admin_client.post(f"{B}/transport-fuel/", {"vehicle": vid, "date": today, "litres": 20, "rate": 100, "odometer_km": 1240, "station": "HP"}, format="json")
    assert first.status_code == 201 and second.status_code == 201, (first.data, second.data)
    assert second.data["kml"] == "12.00"
    for key in ("amount", "distance_km", "kml", "baseline_kml", "anomaly", "verified"):
        assert key in second.data
    updated = admin_client.patch(f"{B}/transport-fuel/{second.data['id']}/", {"vehicle": vid, "date": today, "litres": 24, "rate": 100, "odometer_km": 1240, "station": "HP"}, format="json")
    assert updated.status_code == 200 and updated.data["kml"] == "10.00", updated.data
    assert admin_client.post(f"{B}/transport-fuel/verify/", {"ids": [first.data["id"]]}, format="json").data["verified"] == 1
    assert admin_client.post(f"{B}/transport-fuel/bulk-delete/", {"ids": [first.data["id"]]}, format="json").data["deleted"] == 1

    # report preview + report/add (log), settings/save
    preview = admin_client.get(f"{B}/transport-reports/route-strength/?month={today[:7]}")
    assert preview.status_code == 200 and {"columns", "rows", "totals", "stats", "period", "scope", "notes"} <= set(preview.data)
    logged = admin_client.post(f"{B}/transport-reports/route-strength/log/", {"period": "October 2026", "scope": "All routes", "file_format": "pdf"}, format="json")
    assert logged.status_code == 201, logged.data
    saved = admin_client.patch(f"{B}/transport-settings/save/", {"reminders": {"vehicleDocsDays": 45, "licenceDays": 60, "firstAidDays": 60, "blockExpired": True}}, format="json")
    assert saved.status_code == 200 and saved.data["reminders"]["vehicleDocsDays"] == 45

    # vehicle/renewDoc, vehicle/breakdown, vehicle/update (driver, odometer), route/archive, vehicle/archive
    future = (date.today() + timedelta(days=365)).isoformat()
    assert admin_client.post(f"{B}/vehicles/{vid}/renew-document/", {"document": "fitness_valid_till", "valid_till": future}, format="json").status_code == 200
    assert admin_client.post(f"{B}/vehicles/{vid}/mark-breakdown/").status_code == 200
    assert admin_client.patch(f"{B}/vehicles/{vid}/", {"driver": driver_staff.id, "odometer_km": 1300}, format="json").status_code == 200
    assert admin_client.patch(f"{B}/transport-routes/{rid}/", {"active_status": False}, format="json").status_code == 200
    assert admin_client.post(f"{B}/vehicles/{vid}/archive/").status_code == 200
    assert BusStop.objects.filter(route_id=rid).count() == 2
