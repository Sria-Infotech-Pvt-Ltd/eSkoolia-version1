"""
Transport Phase 4 API tests: persistent Transport Settings (validation, merge
over defaults, school scoping, permissions), settings driving reminder windows
and the overspeed alert, and the allocation candidates list.
"""
from datetime import date, timedelta

from apps.students.models import Guardian, Student
from apps.transport.models import AssignVehicle, StudentTransportAllocation, TransportAlert, TransportSettings
from apps.transport.services.tracking import process_gps_update

from .test_phase1_api import client_with_codes, make_route, make_staff, make_stop, make_vehicle

SETTINGS = "/api/v1/core/transport-settings/"
SAVE = f"{SETTINGS}save/"


# Transport Settings
def test_settings_default_then_save_and_merge(admin_client, school, academic_year):
    body = admin_client.get(SETTINGS).data
    assert body["thresholds"]["overspeed"] == 50 and body["geofence"]["lat"] is None  # no invented location

    saved = admin_client.patch(SAVE, {
        "thresholds": {"overspeed": 45, "lateMin": 10},
        "geofence": {"lat": 17.49, "lng": 78.38, "radius": 200},
    }, format="json")
    assert saved.status_code == 200, saved.data
    again = admin_client.get(SETTINGS).data
    assert again["thresholds"]["overspeed"] == 45 and again["thresholds"]["idleMin"] == 10  # untouched key kept
    assert again["geofence"] == {"lat": 17.49, "lng": 78.38, "radius": 200}
    assert again["reminders"]["licenceDays"] == 60  # untouched section kept
    assert TransportSettings.objects.get(school=school).updated_by is not None


def test_settings_validation(admin_client, school, academic_year):
    bad = [
        {"thresholds": {"overspeed": 500}},
        {"shifts": {"morningPickup": "25:99"}},
        {"geofence": {"lat": 17.4, "lng": None}},
        {"fareSlabs": [{"from": 0, "to": 5, "fare": 1000}, {"from": 4, "to": 8, "fare": 1500}]},
        {"fareSlabs": [{"from": 5, "to": 2, "fare": 1000}]},
        {"reminders": {"vehicleDocsDays": 0}},
    ]
    for payload in bad:
        assert admin_client.patch(SAVE, payload, format="json").status_code == 400, payload
    assert not TransportSettings.objects.exists()


def test_settings_are_per_school_and_need_permission(admin_client, school, academic_year, other_school):
    TransportSettings.objects.create(school=other_school, config={"thresholds": {"overspeed": 30}})
    assert admin_client.get(SETTINGS).data["thresholds"]["overspeed"] == 50
    viewer = client_with_codes(school, ["transport.settings.view"])
    assert viewer.get(SETTINGS).status_code == 200
    assert viewer.patch(SAVE, {"fees": {"siblingConcession": 5}}, format="json").status_code == 403
    assert client_with_codes(school, ["transport.vehicle.view"]).get(SETTINGS).status_code == 403


def test_reminder_settings_drive_document_states(admin_client, school, academic_year):
    vehicle = make_vehicle(school, insurance_valid_till=date.today() + timedelta(days=40))
    insurance = lambda: next(d for d in admin_client.get(f"/api/v1/core/vehicles/{vehicle.id}/").data["compliance"]
                             if d["field"] == "insurance_valid_till")["state"]
    assert insurance() == "valid"  # default window 30 days
    admin_client.patch(SAVE, {"reminders": {"vehicleDocsDays": 45}}, format="json")
    assert insurance() == "expiring"
    assert [v["vehicle_no"] for v in admin_client.get("/api/v1/core/vehicles/?compliance=expiring").data["results"]] == [vehicle.vehicle_no]

    staff = make_staff(school, "D-9")
    admin_client.patch(SAVE, {"reminders": {"licenceDays": 10}}, format="json")
    profile = admin_client.post("/api/v1/core/transport-staff/", {
        "staff": staff.id, "role": "driver", "licence_valid_till": (date.today() + timedelta(days=20)).isoformat(),
    }, format="json")
    assert profile.data["document_state"]["state"] == "valid"


def test_overspeed_alert_uses_threshold_and_cools_down(admin_client, school, academic_year):
    vehicle = make_vehicle(school)
    route = make_route(school)
    make_stop(route)
    AssignVehicle.objects.create(school=school, academic_year=academic_year, vehicle=vehicle, route=route)
    admin_client.patch(SAVE, {"thresholds": {"overspeed": 40}}, format="json")

    assert process_gps_update(vehicle, 17.0, 78.0, 38).overspeed_alert is None
    first = process_gps_update(vehicle, 17.0, 78.0, 65).overspeed_alert
    assert first is not None and first.severity == "critical" and first.route_id == route.id
    assert process_gps_update(vehicle, 17.0, 78.0, 55).overspeed_alert is None  # one open alert per cooldown
    assert TransportAlert.objects.filter(alert_type="overspeed").count() == 1


# Student Transport Allocation
def test_allocation_candidates_and_guardian_details(admin_client, school, academic_year, other_school):
    guardian = Guardian.objects.create(school=school, full_name="[Guardian]", relation="father", phone="9000000002")
    rider = Student.objects.create(school=school, academic_year=academic_year, admission_no="A1", first_name="Rider", gender="male", guardian=guardian)
    walker = Student.objects.create(school=school, academic_year=academic_year, admission_no="A2", first_name="Walker", gender="male")
    Student.objects.create(school=other_school, admission_no="X1", first_name="Elsewhere", gender="male")
    StudentTransportAllocation.objects.create(school=school, academic_year=academic_year, student=rider, status="pending")

    candidates = admin_client.get("/api/v1/core/transport-allocations/candidates/").data
    assert [c["id"] for c in candidates] == [walker.id]
    row = admin_client.get("/api/v1/core/transport-allocations/").data["results"][0]
    assert row["guardian_name"] == "[Guardian]" and row["guardian_phone"] == "9000000002"
