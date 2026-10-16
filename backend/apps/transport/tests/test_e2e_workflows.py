"""
End-to-end Transport workflows, as the screens run them.

Each test sends the same requests frontend/lib/transport/actions.ts builds
(paths, payload shapes, enum values) and then re-reads through the endpoints
frontend/lib/transport/api.ts loads, i.e. what a screen shows after a refresh.
Complements test_frontend_contract.py (one pass over every action) with
cross-screen workflows, validation / duplicate handling and access checks.
"""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.core.models import AcademicYear
from apps.hr.models import Staff
from apps.transport.tests.test_phase1_api import transport_dept
from apps.students.models import Guardian, Student
from apps.transport.models import (
    AssignVehicle, StudentTransportAllocation, TransportAttendance, TransportRoute, TransportStaffProfile, Vehicle,
)
from apps.transport.services.reports import REPORT_KEYS

B = "/api/v1/core"
PAGE = "page_size=10000"


def rows(response):
    body = response.data
    return body if isinstance(body, list) else body["results"]


def by_id(response, pk):
    return next(r for r in rows(response) if r["id"] == pk)


def iso(days=0):
    return (timezone.localdate() + timedelta(days=days)).isoformat()


@pytest.fixture
def fleet(admin_client, school, academic_year):
    """Workflow 1 - fleet setup: vehicle, driver and attendant linked to it (Vehicles + Staff screens)."""
    vehicle = admin_client.post(f"{B}/vehicles/", {
        "vehicle_no": "TS 09 ZZ 0001", "vehicle_model": "Tata Starbus", "vehicle_type": "bus", "operational_status": "active",
        "fitness_valid_till": iso(300), "insurance_valid_till": iso(300), "permit_valid_till": None, "pollution_valid_till": None,
        "driver": None, "active_status": True,
    }, format="json")
    assert vehicle.status_code == 201, vehicle.data
    driver_staff = Staff.objects.create(school=school, staff_no="ZD1", first_name="Test", last_name="Driver", join_date="2024-01-01", department=transport_dept(school))
    attendant_staff = Staff.objects.create(school=school, staff_no="ZA1", first_name="Test", last_name="Attendant", join_date="2024-01-01", department=transport_dept(school))
    driver = admin_client.post(f"{B}/transport-staff/", {
        "staff": driver_staff.id, "role": "driver", "shift": "full_day", "duty_status": "on_duty", "experience_years": 6,
        "licence_number": "TS0920240000001", "licence_valid_till": iso(400), "vehicle": vehicle.data["id"],
    }, format="json")
    assert driver.status_code == 201, driver.data
    attendant = admin_client.post(f"{B}/transport-staff/", {
        "staff": attendant_staff.id, "role": "attendant", "shift": "morning", "duty_status": "on_duty", "experience_years": 2,
        "first_aid_certificate_no": "FA-0001-00001", "first_aid_valid_till": iso(200), "vehicle": vehicle.data["id"],
    }, format="json")
    assert attendant.status_code == 201, attendant.data
    return {"vehicle": vehicle.data["id"], "driver": driver.data, "attendant": attendant.data,
            "driver_staff": driver_staff, "attendant_staff": attendant_staff}


@pytest.fixture
def route_setup(admin_client, fleet):
    """Workflow 2 - route setup: route + ordered pickup points + bus assignment (Routes + Pickup Points screens)."""
    route = admin_client.post(f"{B}/transport-routes/", {
        "title": "ZZ Test Route", "code": "zz1", "shift": "both", "first_pickup_time": "06:45", "fare": 1500, "active_status": True,
    }, format="json")
    assert route.status_code == 201, route.data
    stops = []
    for order, (name, lat) in enumerate([("Gate", 17.401), ("Market", 17.412), ("Temple", 17.423)], start=1):
        stop = admin_client.post(f"{B}/bus-stops/", {
            "route": route.data["id"], "stop_order": order, "stop_name": name, "landmark": f"{name} landmark",
            "latitude": lat, "longitude": 78.381,
        }, format="json")
        assert stop.status_code == 201, stop.data
        stops.append(stop.data["id"])
    assigned = admin_client.post(f"{B}/assign-vehicles/", {"vehicle": fleet["vehicle"], "route": route.data["id"], "active_status": True}, format="json")
    assert assigned.status_code == 201, assigned.data
    return {"route": route.data["id"], "stops": stops}


@pytest.fixture
def pupils(school, academic_year, school_class, section):
    guardian = Guardian.objects.create(school=school, full_name="[Guardian]", relation="father", phone="9000000099")
    return [
        Student.objects.create(
            school=school, academic_year=academic_year, admission_no=f"ZZ{i}", first_name=f"Pupil{i}", gender="male",
            guardian=guardian, current_class=school_class, current_section=section,
        )
        for i in range(3)
    ]


# ─── Workflow 1: fleet setup ──────────────────────────────────────────────────

def test_fleet_setup_persists_and_links(admin_client, fleet):
    vehicle = by_id(admin_client.get(f"{B}/vehicles/?{PAGE}"), fleet["vehicle"])
    assert vehicle["vehicle_no"] == "TS 09 ZZ 0001" and vehicle["vehicle_type"] == "bus" and vehicle["capacity"] > 0
    assert {c["state"] for c in vehicle["compliance"]} >= {"valid", "missing"}
    staff = rows(admin_client.get(f"{B}/transport-staff/?{PAGE}"))
    assert {(s["role"], s["vehicle_detail"]["id"]) for s in staff} == {("driver", fleet["vehicle"]), ("attendant", fleet["vehicle"])}
    # Both staff members left the "add" candidate list once they have a profile.
    candidate_ids = {c["id"] for c in admin_client.get(f"{B}/transport-staff/candidates/").data}
    assert fleet["driver_staff"].id not in candidate_ids and fleet["attendant_staff"].id not in candidate_ids


def test_fleet_edit_persists(admin_client, fleet):
    # vehicle/update (Edit vehicle) and driver/update (Edit driver) as the screens send them.
    assert admin_client.patch(f"{B}/vehicles/{fleet['vehicle']}/", {"vehicle_model": "Eicher Skyline", "odometer_km": 15000, "operational_status": "under_maintenance"}, format="json").status_code == 200
    assert admin_client.patch(f"{B}/transport-staff/{fleet['driver']['id']}/", {"duty_status": "on_leave", "experience_years": 7}, format="json").status_code == 200
    vehicle = by_id(admin_client.get(f"{B}/vehicles/?{PAGE}"), fleet["vehicle"])
    assert (vehicle["vehicle_model"], vehicle["odometer_km"], vehicle["operational_status"]) == ("Eicher Skyline", 15000, "under_maintenance")
    driver = by_id(admin_client.get(f"{B}/transport-staff/?{PAGE}"), fleet["driver"]["id"])
    assert (driver["duty_status"], driver["experience_years"]) == ("on_leave", 7)


def test_duplicate_vehicle_number_is_refused_not_a_server_error(admin_client, fleet):
    again = admin_client.post(f"{B}/vehicles/", {"vehicle_no": "TS 09 ZZ 0001", "vehicle_type": "van", "operational_status": "active", "active_status": True}, format="json")
    assert 400 <= again.status_code < 500, (again.status_code, again.data)
    assert Vehicle.objects.filter(vehicle_no="TS 09 ZZ 0001").count() == 1


def test_duplicate_staff_profile_and_invalid_vehicle_are_refused(admin_client, fleet, other_school):
    again = admin_client.post(f"{B}/transport-staff/", {"staff": fleet["driver_staff"].id, "role": "driver", "licence_number": "X"}, format="json")
    assert again.status_code == 400 and "staff" in str(again.data), again.data
    foreign = Vehicle.objects.create(school=other_school, vehicle_no="OTHER 1", academic_year=AcademicYear.objects.get(school=other_school))
    bad = admin_client.patch(f"{B}/transport-staff/{fleet['driver']['id']}/", {"vehicle": foreign.id}, format="json")
    assert bad.status_code == 400, bad.data


def test_staff_deactivate_and_archive_keep_hr_record(admin_client, fleet):
    # driver/deactivate then driver/archive (DELETE of the transport profile only).
    assert admin_client.patch(f"{B}/transport-staff/{fleet['driver']['id']}/", {"duty_status": "inactive", "vehicle": None}, format="json").status_code == 200
    assert admin_client.delete(f"{B}/transport-staff/{fleet['driver']['id']}/").status_code == 204
    assert Staff.objects.filter(pk=fleet["driver_staff"].id).exists()
    assert fleet["driver_staff"].id in {c["id"] for c in admin_client.get(f"{B}/transport-staff/candidates/").data}


# ─── Workflow 2: route setup ──────────────────────────────────────────────────

def test_route_setup_orders_stops_and_shows_crew(admin_client, fleet, route_setup):
    detail = admin_client.get(f"{B}/transport-routes/{route_setup['route']}/").data
    assert detail["code"] == "ZZ1"  # codes are normalised to upper case
    assert [s["stop_name"] for s in detail["stops"]] == ["Gate", "Market", "Temple"]
    assert detail["vehicle"]["id"] == fleet["vehicle"] and detail["stops_count"] == 3
    # stop/reorder (move Temple up one) as the Routes screen sends it.
    order = [route_setup["stops"][0], route_setup["stops"][2], route_setup["stops"][1]]
    assert admin_client.put(f"{B}/bus-stops/reorder/", {"stops": [{"id": pk, "stop_order": i + 1} for i, pk in enumerate(order)]}, format="json").status_code == 200
    assert [s["stop_name"] for s in admin_client.get(f"{B}/transport-routes/{route_setup['route']}/").data["stops"]] == ["Gate", "Temple", "Market"]


def test_route_and_stop_duplicates_are_refused(admin_client, route_setup):
    same_code = admin_client.post(f"{B}/transport-routes/", {"title": "Another", "code": "ZZ1", "shift": "morning", "fare": 0, "active_status": True}, format="json")
    assert same_code.status_code == 400 and "already in use" in str(same_code.data), same_code.data
    same_title = admin_client.post(f"{B}/transport-routes/", {"title": "ZZ Test Route", "code": "ZZ2", "shift": "morning", "fare": 0, "active_status": True}, format="json")
    assert 400 <= same_title.status_code < 500, (same_title.status_code, same_title.data)
    same_stop = admin_client.post(f"{B}/bus-stops/", {"route": route_setup["route"], "stop_order": 4, "stop_name": "Gate", "landmark": "", "latitude": 17.5, "longitude": 78.4}, format="json")
    assert 400 <= same_stop.status_code < 500, (same_stop.status_code, same_stop.data)


def test_pickup_point_edit_persists_and_new_stop_needs_coordinates(admin_client, route_setup):
    # stop/update (Edit pickup point) - name, landmark, fare and times.
    pk = route_setup["stops"][1]
    patch = {"stop_name": "Main Market", "landmark": "Clock tower", "monthly_fare": 1700, "scheduled_time": "07:05", "drop_time": "15:40"}
    assert admin_client.patch(f"{B}/bus-stops/{pk}/", patch, format="json").status_code == 200
    stop = by_id(admin_client.get(f"{B}/bus-stops/?{PAGE}"), pk)
    assert (stop["stop_name"], stop["landmark"], stop["effective_fare"], stop["scheduled_time"][:5], stop["drop_time"][:5]) == ("Main Market", "Clock tower", "1700.00", "07:05", "15:40")
    missing = admin_client.post(f"{B}/bus-stops/", {"route": route_setup["route"], "stop_order": 9, "stop_name": "No coords", "landmark": ""}, format="json")
    assert missing.status_code == 400, missing.data


# ─── Workflow 3: student transport ────────────────────────────────────────────

def test_student_allocation_reflects_on_vehicle_route_and_candidates(admin_client, fleet, route_setup, pupils):
    stop = route_setup["stops"][1]
    bulk = admin_client.post(f"{B}/transport-allocations/bulk-allocate/", {"students": [p.id for p in pupils[:2]], "route": route_setup["route"], "stop": stop}, format="json")
    assert bulk.status_code == 201, bulk.data
    allocations = rows(admin_client.get(f"{B}/transport-allocations/?{PAGE}"))
    mine = [a for a in allocations if a["student"] in {p.id for p in pupils[:2]}]
    assert len(mine) == 2 and {(a["route"], a["stop"], a["status"], a["vehicle_no"]) for a in mine} == {(route_setup["route"], stop, "allocated", "TS 09 ZZ 0001")}
    assert {a["class_name"] for a in mine} == {"Grade 5"} and {a["section_name"] for a in mine} == {"A"}
    vehicle = by_id(admin_client.get(f"{B}/vehicles/?{PAGE}"), fleet["vehicle"])
    assert vehicle["seats_occupied"] == 2
    assert by_id(admin_client.get(f"{B}/transport-routes/?{PAGE}"), route_setup["route"])["students_count"] == 2
    # Allocating the same student again updates the one allocation - no duplicate.
    admin_client.post(f"{B}/transport-allocations/bulk-allocate/", {"students": [pupils[0].id], "route": route_setup["route"], "stop": route_setup["stops"][2]}, format="json")
    assert StudentTransportAllocation.objects.filter(student=pupils[0]).count() == 1
    assert StudentTransportAllocation.objects.get(student=pupils[0]).stop_id == route_setup["stops"][2]


def test_allocation_waitlist_remove_and_validation(admin_client, route_setup, pupils):
    # student/update -> Waitlisted for a student with no allocation yet (POST), then remove (release).
    waitlisted = admin_client.post(f"{B}/transport-allocations/", {"status": "waitlisted", "route": None, "stop": None, "vehicle": None, "student": pupils[2].id}, format="json")
    assert waitlisted.status_code == 201, waitlisted.data
    duplicate = admin_client.post(f"{B}/transport-allocations/", {"status": "waitlisted", "route": None, "stop": None, "vehicle": None, "student": pupils[2].id}, format="json")
    assert duplicate.status_code == 400, duplicate.data
    no_stop = admin_client.patch(f"{B}/transport-allocations/{waitlisted.data['id']}/", {"status": "allocated", "route": route_setup["route"], "stop": None}, format="json")
    assert no_stop.status_code == 400, no_stop.data
    admin_client.post(f"{B}/transport-allocations/bulk-allocate/", {"students": [pupils[1].id], "route": route_setup["route"], "stop": route_setup["stops"][0]}, format="json")
    allocation = StudentTransportAllocation.objects.get(student=pupils[1])
    assert admin_client.post(f"{B}/transport-allocations/release/", {"ids": [allocation.id]}, format="json").status_code == 200
    allocation.refresh_from_db()
    assert (allocation.status, allocation.route_id, allocation.stop_id) == ("pending", None, None)
    assert Student.objects.get(pk=pupils[1].id).transport_route_id is None


# ─── Workflow 4: daily operations ─────────────────────────────────────────────

def test_attendance_marking_persists_per_shift_and_date(admin_client, route_setup, pupils):
    admin_client.post(f"{B}/transport-allocations/bulk-allocate/", {"students": [p.id for p in pupils], "route": route_setup["route"], "stop": route_setup["stops"][0]}, format="json")
    today = iso()
    entries = [
        {"student": pupils[0].id, "boarded": True, "late": False, "note": ""},
        {"student": pupils[1].id, "boarded": True, "late": True, "note": "Came running"},
        {"student": pupils[2].id, "boarded": False, "late": False, "note": ""},
    ]
    assert admin_client.post(f"{B}/transport-attendance/mark/", {"date": today, "shift": "morning", "entries": entries}, format="json").status_code == 200
    # Re-marking one student (attendant correction) must not duplicate or touch the others.
    assert admin_client.post(f"{B}/transport-attendance/mark/", {"date": today, "shift": "morning", "entries": [{"student": pupils[2].id, "boarded": True, "late": False, "note": ""}]}, format="json").status_code == 200
    assert TransportAttendance.objects.filter(date=today, shift="morning").count() == 3
    register = {r["student"]: r for r in admin_client.get(f"{B}/transport-attendance/register/?date={today}&shift=morning").data["results"]}
    assert (register[pupils[0].id]["boarded"], register[pupils[1].id]["late"], register[pupils[1].id]["note"], register[pupils[2].id]["boarded"]) == (True, True, "Came running", True)
    # The afternoon register for the same day is separate and unmarked.
    afternoon = admin_client.get(f"{B}/transport-attendance/register/?date={today}&shift=afternoon").data["results"]
    assert all(not r["marked"] for r in afternoon)
    # Absent-parent notification only counts students not boarded (none now).
    notified = admin_client.post(f"{B}/transport-attendance/notify-absent/", {"date": today, "shift": "morning"}, format="json")
    assert notified.status_code == 200 and notified.data["absent"] == 0, notified.data


def test_alert_raise_acknowledge_resolve_persists(admin_client, fleet, route_setup):
    raised = admin_client.post(f"{B}/transport-alerts/", {"vehicle": fleet["vehicle"], "route": route_setup["route"], "alert_type": "running_late", "severity": "warning", "message": "ZZ late — traffic"}, format="json")
    assert raised.status_code == 201, raised.data
    assert admin_client.post(f"{B}/transport-alerts/bulk-acknowledge/", {"ids": [raised.data["id"]]}, format="json").status_code == 200
    listed = by_id(admin_client.get(f"{B}/transport-alerts/?exclude_types=arrived,left,near_school&{PAGE}"), raised.data["id"])
    assert listed["state"] == "acknowledged" and listed["acknowledged_by_name"] is not None
    assert admin_client.post(f"{B}/transport-alerts/bulk-resolve/", {"ids": [raised.data["id"]]}, format="json").data["updated"] == 1
    assert by_id(admin_client.get(f"{B}/transport-alerts/?exclude_types=arrived,left,near_school&{PAGE}"), raised.data["id"])["state"] == "resolved"


def test_live_tracking_without_gps_is_empty_not_an_error(admin_client, fleet):
    live = admin_client.get(f"{B}/bus-locations/live/")
    assert live.status_code == 200, live.data
    entries = live.data if isinstance(live.data, list) else live.data.get("results", live.data)
    # No GPS fix was ever sent: nothing fabricated.
    for entry in entries if isinstance(entries, list) else []:
        assert entry.get("current_latitude") in (None, "") or entry.get("vehicle") != fleet["vehicle"]


# ─── Workflow 5: maintenance and fuel ─────────────────────────────────────────

def test_maintenance_and_fuel_flow_into_dashboard_and_cost_report(admin_client, fleet):
    service = admin_client.post(f"{B}/transport-maintenance/", {
        "vehicle": fleet["vehicle"], "service_date": iso(-2), "service_type": "Brake service", "work_done": "Pads replaced",
        "cost": 4200, "odometer_km": 15200, "vendor": "ZZ Garage", "status": "completed",
    }, format="json")
    assert service.status_code == 201, service.data
    first = admin_client.post(f"{B}/transport-fuel/", {"vehicle": fleet["vehicle"], "date": iso(-3), "litres": 40, "rate": 95, "odometer_km": 15000, "station": "ZZ Fuels"}, format="json")
    second = admin_client.post(f"{B}/transport-fuel/", {"vehicle": fleet["vehicle"], "date": iso(-1), "litres": 40, "rate": 95, "odometer_km": 15240, "station": "ZZ Fuels"}, format="json")
    assert first.status_code == 201 and second.status_code == 201, (first.data, second.data)
    assert (second.data["amount"], second.data["distance_km"], second.data["kml"]) == ("3800.00", 240, "6.00")
    # fuel/update (Edit) recalculates from the saved values.
    edited = admin_client.patch(f"{B}/transport-fuel/{second.data['id']}/", {"vehicle": fleet["vehicle"], "date": iso(-1), "litres": 30, "rate": 95, "odometer_km": 15240, "station": "ZZ Fuels"}, format="json")
    assert edited.status_code == 200 and edited.data["kml"] == "8.00", edited.data
    listed = rows(admin_client.get(f"{B}/transport-fuel/?{PAGE}"))
    assert {e["id"] for e in listed} == {first.data["id"], second.data["id"]}
    services = rows(admin_client.get(f"{B}/transport-maintenance/?{PAGE}"))
    assert [(s["service_type"], s["cost"], s["display_status"]) for s in services] == [("Brake service", "4200.00", "completed")]
    dashboard = admin_client.get(f"{B}/transport-dashboard/").data
    assert dashboard["fleet"] and dashboard["fuel"] is not None and dashboard["maintenance"] is not None
    month = iso(-1)[:7]
    cost = admin_client.get(f"{B}/transport-reports/fuel-maintenance-cost/?month={month}")
    assert cost.status_code == 200, cost.data
    if iso(-3)[:7] == month and iso(-2)[:7] == month:
        flat = str(cost.data["rows"]) + str(cost.data["totals"])
        assert "4200" in flat, cost.data  # the saved service cost reaches the report


def test_maintenance_and_fuel_validation(admin_client, fleet):
    future_done = admin_client.post(f"{B}/transport-maintenance/", {"vehicle": fleet["vehicle"], "service_date": iso(5), "service_type": "Oil", "work_done": "", "cost": 100, "odometer_km": None, "vendor": "", "status": "completed"}, format="json")
    assert future_done.status_code == 400, future_done.data
    future_fuel = admin_client.post(f"{B}/transport-fuel/", {"vehicle": fleet["vehicle"], "date": iso(2), "litres": 10, "rate": 90, "odometer_km": 100, "station": ""}, format="json")
    assert future_fuel.status_code == 400, future_fuel.data
    for bad in ({"litres": 0}, {"litres": -5}, {"rate": -1}):
        body = {"vehicle": fleet["vehicle"], "date": iso(-1), "litres": 10, "rate": 90, "odometer_km": 100, "station": "", **bad}
        response = admin_client.post(f"{B}/transport-fuel/", body, format="json")
        assert response.status_code == 400, (bad, response.status_code, response.data)


# ─── Reports and settings ─────────────────────────────────────────────────────

@pytest.mark.parametrize("key", sorted(REPORT_KEYS))
def test_every_report_previews_and_logs(admin_client, fleet, route_setup, key):
    preview = admin_client.get(f"{B}/transport-reports/{key}/?month={iso()[:7]}&date={iso()}&shift=morning&route={route_setup['route']}")
    assert preview.status_code == 200, (key, preview.data)
    assert {"columns", "rows", "totals", "stats", "period", "scope"} <= set(preview.data)
    column_keys = {c["key"] for c in preview.data["columns"]}
    for row in preview.data["rows"]:
        assert set(row) - {"_tone"} <= column_keys, (key, row)
    for file_format in ("pdf", "excel"):
        logged = admin_client.post(f"{B}/transport-reports/{key}/log/", {"period": "Test", "scope": "All routes", "file_format": file_format}, format="json")
        assert logged.status_code == 201, (key, file_format, logged.data)
    assert key in {r["report"] for r in admin_client.get(f"{B}/transport-reports/recent/").data}


def test_settings_save_persists_across_reload(admin_client, school):
    patch = {
        "shifts": {"morningPickup": "06:15", "schoolArrival": "08:40", "afternoonDrop": "15:10"},
        "thresholds": {"overspeed": 45, "lateMin": 10, "deviationM": 400, "idleMin": 12, "sosEscalation": "Transport in-charge"},
        "fees": {"billingCycle": "Monthly", "siblingConcession": 15},
    }
    saved = admin_client.patch(f"{B}/transport-settings/save/", patch, format="json")
    assert saved.status_code == 200, saved.data
    reloaded = admin_client.get(f"{B}/transport-settings/").data
    assert reloaded["shifts"] == patch["shifts"] and reloaded["thresholds"]["overspeed"] == 45 and reloaded["fees"]["siblingConcession"] == 15
    # Untouched sections keep their defaults.
    assert reloaded["reminders"]["licenceDays"] == 60


# ─── Access control ───────────────────────────────────────────────────────────

LOAD_PATHS = [
    "vehicles/", "transport-routes/", "bus-stops/", "transport-staff/", "transport-allocations/", "transport-alerts/",
    "transport-maintenance/", "transport-fuel/", "transport-reports/", "transport-settings/", "transport-dashboard/",
]


@pytest.mark.parametrize("path", LOAD_PATHS)
def test_anonymous_requests_are_rejected(api_client, path):
    assert api_client.get(f"{B}/{path}").status_code in (401, 403)


def test_role_without_transport_codes_cannot_write(teacher_client, fleet):
    assert teacher_client.post(f"{B}/vehicles/", {"vehicle_no": "NOPE 1", "vehicle_type": "van"}, format="json").status_code == 403
    assert teacher_client.patch(f"{B}/vehicles/{fleet['vehicle']}/", {"vehicle_model": "x"}, format="json").status_code == 403
    assert teacher_client.post(f"{B}/transport-fuel/", {"vehicle": fleet["vehicle"], "date": iso(-1), "litres": 1, "rate": 1, "odometer_km": 1}, format="json").status_code == 403
    assert teacher_client.patch(f"{B}/transport-settings/save/", {"fees": {"billingCycle": "Monthly", "siblingConcession": 0}}, format="json").status_code == 403


# ─── Regression tests for bugs fixed in the 14/10/2026 audit ──────────────────

def test_archiving_a_vehicle_frees_its_route_and_crew(admin_client, fleet, route_setup):
    assert admin_client.post(f"{B}/vehicles/{fleet['vehicle']}/archive/").status_code == 200
    assert admin_client.get(f"{B}/transport-routes/{route_setup['route']}/").data["vehicle"] is None
    assert not AssignVehicle.objects.filter(vehicle_id=fleet["vehicle"], active_status=True).exists()
    assert Vehicle.objects.get(pk=fleet["vehicle"]).driver_id is None
    assert TransportStaffProfile.objects.get(pk=fleet["attendant"]["id"]).assigned_vehicle_id is None
    # The attendant can be edited afterwards (the archived bus no longer blocks the save).
    edited = admin_client.patch(f"{B}/transport-staff/{fleet['attendant']['id']}/", {"shift": "full_day"}, format="json")
    assert edited.status_code == 200, edited.data


def test_removing_a_driver_profile_clears_the_vehicle_driver(admin_client, fleet, route_setup):
    assert admin_client.delete(f"{B}/transport-staff/{fleet['driver']['id']}/").status_code == 204
    assert Vehicle.objects.get(pk=fleet["vehicle"]).driver_id is None
    route = by_id(admin_client.get(f"{B}/transport-routes/?{PAGE}"), route_setup["route"])
    assert route["vehicle"]["driver_name"] is None


def test_register_and_notifications_follow_the_route_shift(admin_client, route_setup, pupils):
    admin_client.post(f"{B}/transport-allocations/bulk-allocate/", {"students": [p.id for p in pupils], "route": route_setup["route"], "stop": route_setup["stops"][0]}, format="json")
    TransportRoute.objects.filter(pk=route_setup["route"]).update(shift="morning")
    today = iso()
    assert len(admin_client.get(f"{B}/transport-attendance/register/?date={today}&shift=morning").data["results"]) == 3
    assert admin_client.get(f"{B}/transport-attendance/register/?date={today}&shift=afternoon").data["results"] == []
    notified = admin_client.post(f"{B}/transport-attendance/notify-absent/", {"date": today, "shift": "afternoon"}, format="json")
    assert notified.data["absent"] == 0, notified.data


def test_notify_absent_reports_messages_actually_sent(admin_client, route_setup, pupils, settings):
    # No SMS/email provider is configured in tests: attempts are logged as skipped, none count as sent.
    admin_client.post(f"{B}/transport-allocations/bulk-allocate/", {"students": [p.id for p in pupils], "route": route_setup["route"], "stop": route_setup["stops"][0]}, format="json")
    notified = admin_client.post(f"{B}/transport-attendance/notify-absent/", {"date": iso(), "shift": "morning"}, format="json")
    assert notified.status_code == 200 and notified.data["absent"] == 3
    assert notified.data["notifications_logged"] >= 3 and notified.data["notifications_sent"] == 0, notified.data


def test_morning_pickup_and_afternoon_drop_are_separate_records(admin_client, fleet, route_setup, pupils):
    """The single-student workflow run in the UI on 14/10/2026: board in the morning, drop in the afternoon."""
    student = pupils[0]
    stop = route_setup["stops"][2]
    admin_client.post(f"{B}/transport-allocations/bulk-allocate/", {"students": [student.id], "route": route_setup["route"], "stop": stop}, format="json")
    today = iso()
    for shift in ("morning", "afternoon"):
        marked = admin_client.post(f"{B}/transport-attendance/mark/", {"date": today, "shift": shift, "entries": [{"student": student.id, "boarded": True, "late": False, "note": ""}]}, format="json")
        assert marked.status_code == 200, marked.data
        line = marked.data["results"][0]
        assert (line["shift"], line["boarded"], line["route"], line["stop"], line["vehicle"]) == (shift, True, route_setup["route"], stop, fleet["vehicle"])
    rows_ = TransportAttendance.objects.filter(student=student, date=today).order_by("shift")
    assert [(r.shift, r.boarded) for r in rows_] == [("afternoon", True), ("morning", True)]
    for shift in ("morning", "afternoon"):
        register = admin_client.get(f"{B}/transport-attendance/register/?date={today}&shift={shift}").data["results"]
        assert [(r["student"], r["marked"], r["boarded"]) for r in register] == [(student.id, True, True)]
    report = admin_client.get(f"{B}/transport-reports/boarding-register/?date={today}&shift=afternoon&route={route_setup['route']}")
    assert report.status_code == 200 and report.data["totals"], report.data
