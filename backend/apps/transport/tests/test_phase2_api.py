"""
Transport Phase 2 API tests: student allocation over existing students, the
boarding register (transport attendance), driver/attendant profiles over
hr.Staff, the alert workflow, per-stop GPS pickups and the dev-only simulator.

Uses the shared fixtures in backend/conftest.py (school, academic_year,
admin_user, admin_client) and helpers from test_phase1_api.
"""
from datetime import date, timedelta

import pytest
from django.core.management import CommandError, call_command
from django.utils import timezone

from apps.attendance.models import StudentAttendance
from apps.students.models import Guardian, Student
from apps.transport.models import (
    AssignVehicle,
    BusRoutePickupUpdate,
    BusStop,
    StopArrival,
    StudentTransportAllocation,
    TransportAlert,
    TransportAttendance,
    TransportNotificationLog,
    TransportStaffProfile,
)
from apps.transport.services.tracking import process_gps_update, shift_for

from .test_phase1_api import client_with_codes, make_route, make_staff, make_stop, make_vehicle

ALLOC = "/api/v1/core/transport-allocations/"
ATTENDANCE = "/api/v1/core/transport-attendance/"
STAFF = "/api/v1/core/transport-staff/"
ALERTS = "/api/v1/core/transport-alerts/"


def make_student(school, admission_no, first_name="Aarav", **extra):
    return Student.objects.create(school=school, admission_no=admission_no, first_name=first_name, gender="male", **extra)


@pytest.fixture
def fleet(school, academic_year):
    """A route with two stops and an assigned vehicle."""
    route = make_route(school, "Madhapur", code="R1")
    stop_a = make_stop(route, "Stop A", 1)
    stop_b = make_stop_at(route, "Stop B", 2, 17.60, 78.50)
    vehicle = make_vehicle(school)
    AssignVehicle.objects.create(school=school, academic_year=academic_year, vehicle=vehicle, route=route)
    return {"route": route, "stop_a": stop_a, "stop_b": stop_b, "vehicle": vehicle}


def make_stop_at(route, name, order, lat, lng):
    return BusStop.objects.create(route=route, stop_name=name, latitude=lat, longitude=lng, stop_order=order)


def allocate(student, fleet, stop_key="stop_a"):
    return StudentTransportAllocation.objects.create(
        school=student.school, academic_year=student.academic_year, student=student,
        route=fleet["route"], stop=fleet[stop_key], vehicle=fleet["vehicle"], status="allocated",
    )


# Student Transport Allocation
def test_allocation_create_defaults_vehicle_fare_and_mirrors_student(admin_client, school, academic_year, fleet):
    student = make_student(school, "A1", academic_year=academic_year)
    response = admin_client.post(ALLOC, {
        "student": student.id, "route": fleet["route"].id, "stop": fleet["stop_a"].id, "status": "allocated",
    }, format="json")
    assert response.status_code == 201, response.data
    assert response.data["vehicle"] == fleet["vehicle"].id  # route's assigned vehicle
    assert float(response.data["monthly_fare"]) == 1500.0  # route fare (stop has none)
    student.refresh_from_db()
    assert student.transport_route_id == fleet["route"].id and student.vehicle_id == fleet["vehicle"].id

    duplicate = admin_client.post(ALLOC, {
        "student": student.id, "route": fleet["route"].id, "stop": fleet["stop_b"].id, "status": "allocated",
    }, format="json")
    assert duplicate.status_code == 400  # one allocation per student per academic year

    assert admin_client.delete(f"{ALLOC}{response.data['id']}/").status_code == 204
    student.refresh_from_db()
    assert student.transport_route_id is None and student.vehicle_id is None


def test_allocation_rejects_stop_off_route_and_foreign_records(admin_client, school, academic_year, fleet, other_school):
    student = make_student(school, "A1", academic_year=academic_year)
    other_route = make_route(school, "Kukatpally")
    off_route = admin_client.post(ALLOC, {
        "student": student.id, "route": other_route.id, "stop": fleet["stop_a"].id, "status": "allocated",
    }, format="json")
    assert off_route.status_code == 400

    missing_stop = admin_client.post(ALLOC, {"student": student.id, "route": fleet["route"].id, "status": "allocated"}, format="json")
    assert missing_stop.status_code == 400  # allocated needs route and stop

    foreign_student = make_student(other_school, "X1")
    foreign = admin_client.post(ALLOC, {
        "student": foreign_student.id, "route": fleet["route"].id, "stop": fleet["stop_a"].id, "status": "allocated",
    }, format="json")
    assert foreign.status_code == 400
    assert not StudentTransportAllocation.objects.exists()


def test_allocation_list_is_school_scoped(admin_client, school, academic_year, fleet, other_school):
    allocate(make_student(school, "A1", academic_year=academic_year), fleet)
    StudentTransportAllocation.objects.create(school=other_school, student=make_student(other_school, "X1"), status="pending")
    rows = admin_client.get(ALLOC).data["results"]
    assert [r["student"] for r in rows] == [Student.objects.get(admission_no="A1").id]


def test_bulk_allocate_and_release(admin_client, school, academic_year, fleet, other_school):
    students = [make_student(school, f"A{i}", f"S{i}", academic_year=academic_year) for i in range(3)]
    response = admin_client.post(f"{ALLOC}bulk-allocate/", {
        "students": [s.id for s in students], "route": fleet["route"].id, "stop": fleet["stop_b"].id, "monthly_fare": "1200",
    }, format="json")
    assert response.status_code == 201, response.data
    assert response.data["allocated"] == 3
    assert Student.objects.filter(transport_route=fleet["route"], vehicle=fleet["vehicle"]).count() == 3

    foreign = make_student(other_school, "X1")
    rejected = admin_client.post(f"{ALLOC}bulk-allocate/", {
        "students": [foreign.id], "route": fleet["route"].id, "stop": fleet["stop_b"].id,
    }, format="json")
    assert rejected.status_code == 400

    ids = list(StudentTransportAllocation.objects.values_list("id", flat=True))
    released = admin_client.post(f"{ALLOC}release/", {"ids": ids}, format="json")
    assert released.data["released"] == 3
    assert set(StudentTransportAllocation.objects.values_list("status", flat=True)) == {"pending"}
    assert not Student.objects.filter(transport_route__isnull=False).exists()


def test_allocation_permissions(school, academic_year, fleet):
    student = make_student(school, "A1", academic_year=academic_year)
    viewer = client_with_codes(school, ["transport.allocation.view"])
    assert viewer.get(ALLOC).status_code == 200
    payload = {"students": [student.id], "route": fleet["route"].id, "stop": fleet["stop_a"].id}
    assert viewer.post(f"{ALLOC}bulk-allocate/", payload, format="json").status_code == 403
    assert viewer.post(f"{ALLOC}release/", {"ids": [1]}, format="json").status_code == 403


# Transport Attendance
def test_register_lists_allocated_students_without_fabricating(admin_client, school, academic_year, fleet):
    allocate(make_student(school, "A1", "Aarav", academic_year=academic_year), fleet)
    make_student(school, "A2", "Not allocated", academic_year=academic_year)
    body = admin_client.get(f"{ATTENDANCE}register/?date=2026-10-12&shift=morning").data
    assert body["count"] == 1
    row = body["results"][0]
    assert row["marked"] is False and row["boarded"] is False and row["stop_name"] == "Stop A"
    assert not TransportAttendance.objects.exists()  # nothing written by reading


def test_mark_upserts_and_rejects_unallocated(admin_client, school, academic_year, fleet):
    rider = make_student(school, "A1", academic_year=academic_year)
    allocate(rider, fleet)
    payload = {"date": "2026-10-12", "shift": "morning", "entries": [{"student": rider.id, "late": True}]}
    first = admin_client.post(f"{ATTENDANCE}mark/", payload, format="json")
    assert first.status_code == 200, first.data
    payload["entries"] = [{"student": rider.id, "boarded": False, "note": "sick"}]
    admin_client.post(f"{ATTENDANCE}mark/", payload, format="json")
    line = TransportAttendance.objects.get()  # unique per (student, date, shift)
    assert line.boarded is False and line.late is False and line.note == "sick" and line.source == "manual"

    outsider = make_student(school, "A2", academic_year=academic_year)
    payload["entries"] = [{"student": outsider.id, "boarded": True}]
    assert admin_client.post(f"{ATTENDANCE}mark/", payload, format="json").status_code == 400
    assert admin_client.post(ATTENDANCE, {}, format="json").status_code == 405  # writes only via mark/


def test_notify_absent_logs_guardian_messages(admin_client, school, academic_year, fleet):
    guardian = Guardian.objects.create(school=school, full_name="[Guardian]", relation="father", phone="9000000001")
    absent = make_student(school, "A1", academic_year=academic_year, guardian=guardian)
    boarded = make_student(school, "A2", academic_year=academic_year, guardian=guardian)
    allocate(absent, fleet)
    allocate(boarded, fleet)
    admin_client.post(f"{ATTENDANCE}mark/", {
        "date": "2026-10-12", "shift": "morning", "entries": [{"student": boarded.id, "boarded": True}],
    }, format="json")
    response = admin_client.post(f"{ATTENDANCE}notify-absent/", {"date": "2026-10-12", "shift": "morning"}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["absent"] == 1
    logs = TransportNotificationLog.objects.all()
    assert {log.student_id for log in logs} == {absent.id}
    assert all(log.status == "skipped" for log in logs)  # no SMS provider configured in tests


def test_attendance_permissions(school, academic_year, fleet):
    viewer = client_with_codes(school, ["transport.attendance.view"])
    assert viewer.get(f"{ATTENDANCE}register/").status_code == 200
    assert viewer.post(f"{ATTENDANCE}mark/", {"date": "2026-10-12", "shift": "morning", "entries": []}, format="json").status_code == 403


# Driver and Attendant Profiles
def test_driver_profile_links_vehicle_and_writes_hr_licence(admin_client, school, academic_year, fleet):
    staff = make_staff(school, "D-1", "Ravi")
    candidates = admin_client.get(f"{STAFF}candidates/").data
    assert [c["id"] for c in candidates] == [staff.id]

    response = admin_client.post(STAFF, {
        "staff": staff.id, "role": "driver", "licence_number": "TS0920190001234",
        "licence_valid_till": (date.today() + timedelta(days=20)).isoformat(), "vehicle": fleet["vehicle"].id,
    }, format="json")
    assert response.status_code == 201, response.data
    staff.refresh_from_db()
    fleet["vehicle"].refresh_from_db()
    assert staff.driving_license == "TS0920190001234"  # same field HR uses, not a copy
    assert fleet["vehicle"].driver_id == staff.id
    assert response.data["vehicle_detail"]["route"]["id"] == fleet["route"].id
    assert response.data["document_state"]["state"] == "expiring"
    assert admin_client.get(f"{STAFF}candidates/").data == []

    # Moving the driver to another vehicle frees the first one.
    second = make_vehicle(school, "TS 09 ZZ 0002")
    admin_client.patch(f"{STAFF}{response.data['id']}/", {"vehicle": second.id}, format="json")
    fleet["vehicle"].refresh_from_db()
    second.refresh_from_db()
    assert fleet["vehicle"].driver_id is None and second.driver_id == staff.id

    duplicate = admin_client.post(STAFF, {"staff": staff.id, "role": "attendant"}, format="json")
    assert duplicate.status_code == 400


def test_attendant_profile_and_cross_school_rejection(admin_client, school, academic_year, fleet, other_school):
    attendant = make_staff(school, "AT-1", "Lakshmi")
    response = admin_client.post(STAFF, {"staff": attendant.id, "role": "attendant", "vehicle": fleet["vehicle"].id}, format="json")
    assert response.status_code == 201, response.data
    assert TransportStaffProfile.objects.get().assigned_vehicle_id == fleet["vehicle"].id

    foreign_staff = make_staff(other_school, "X-1")
    assert admin_client.post(STAFF, {"staff": foreign_staff.id, "role": "driver"}, format="json").status_code == 400
    foreign_vehicle = make_vehicle(other_school, "THEIRS")
    other = make_staff(school, "AT-2")
    assert admin_client.post(STAFF, {"staff": other.id, "role": "attendant", "vehicle": foreign_vehicle.id}, format="json").status_code == 400


# Alerts and Notifications
def test_alert_acknowledge_resolve_workflow(admin_client, admin_user, school, academic_year, fleet):
    alert = TransportAlert.objects.create(vehicle=fleet["vehicle"], alert_type="sos", message="SOS", severity="critical")
    acked = admin_client.post(f"{ALERTS}{alert.id}/acknowledge/").data
    assert acked["state"] == "acknowledged" and acked["is_resolved"] is False
    resolved = admin_client.post(f"{ALERTS}{alert.id}/resolve/").data
    assert resolved["state"] == "resolved" and resolved["is_resolved"] is True
    alert.refresh_from_db()
    assert alert.acknowledged_by_id == admin_user.id and alert.resolved_by_id == admin_user.id and alert.resolved_at

    open_ids = [
        TransportAlert.objects.create(vehicle=fleet["vehicle"], alert_type="running_late", message=f"d{i}").id for i in range(2)
    ]
    assert admin_client.post(f"{ALERTS}bulk-resolve/", {"ids": open_ids}, format="json").data["updated"] == 2
    assert admin_client.get(f"{ALERTS}?state=open").data["results"] == []


def test_legacy_is_resolved_patch_records_resolved_at(admin_client, school, academic_year, fleet):
    alert = TransportAlert.objects.create(vehicle=fleet["vehicle"], alert_type="running_late", message="late")
    response = admin_client.patch(f"{ALERTS}{alert.id}/", {"is_resolved": True}, format="json")
    assert response.status_code == 200, response.data
    alert.refresh_from_db()
    assert alert.state == "resolved" and alert.resolved_at is not None  # used to be lost


def test_alert_bulk_ignores_other_schools(admin_client, school, academic_year, fleet, other_school):
    theirs = TransportAlert.objects.create(vehicle=make_vehicle(other_school, "THEIRS"), alert_type="sos", message="x")
    assert admin_client.post(f"{ALERTS}bulk-resolve/", {"ids": [theirs.id]}, format="json").data["updated"] == 0
    theirs.refresh_from_db()
    assert theirs.state == "open"


def test_alert_permissions(school, academic_year, fleet):
    alert = TransportAlert.objects.create(vehicle=fleet["vehicle"], alert_type="sos", message="x")
    viewer = client_with_codes(school, ["transport.alert.view"])
    assert viewer.get(ALERTS).status_code == 200
    assert viewer.post(f"{ALERTS}{alert.id}/resolve/").status_code == 403


def test_breakdown_raises_alert_and_renewal_closes_expiry_alert(admin_client, school, academic_year, fleet):
    vehicle = fleet["vehicle"]
    admin_client.post(f"/api/v1/core/vehicles/{vehicle.id}/mark-breakdown/")
    breakdown = TransportAlert.objects.get(alert_type="breakdown")
    assert breakdown.severity == "critical" and breakdown.route_id == fleet["route"].id

    expiry = TransportAlert.objects.create(vehicle=vehicle, alert_type="document_expiry", document="insurance_valid_till", message="x")
    future = (date.today() + timedelta(days=365)).isoformat()
    admin_client.post(f"/api/v1/core/vehicles/{vehicle.id}/renew-document/", {"document": "insurance_valid_till", "valid_till": future}, format="json")
    expiry.refresh_from_db()
    assert expiry.state == "resolved" and expiry.is_resolved is True


# Live Tracking and GPS
def test_gps_arrival_picks_only_students_at_that_stop(admin_client, school, academic_year, fleet):
    at_a = make_student(school, "A1", academic_year=academic_year)
    at_b = make_student(school, "A2", academic_year=academic_year)
    allocate(at_a, fleet, "stop_a")
    allocate(at_b, fleet, "stop_b")

    response = admin_client.post("/api/v1/core/bus-locations/", {
        "vehicle": fleet["vehicle"].id, "latitude": 17.49, "longitude": 78.38, "speed": 20,
    }, format="json")
    assert response.status_code == 201, response.data
    assert StopArrival.objects.filter(stop=fleet["stop_a"]).exists()
    assert set(BusRoutePickupUpdate.objects.values_list("student_id", flat=True)) == {at_a.id}
    line = TransportAttendance.objects.get()
    assert line.student_id == at_a.id and line.boarded and line.source == "gps"
    assert StudentAttendance.objects.filter(student=at_a).exists()  # existing behaviour kept for real GPS
    assert TransportAlert.objects.filter(alert_type="arrived").count() == 1


def test_gps_does_not_override_manual_mark(school, academic_year, fleet, admin_user):
    student = make_student(school, "A1", academic_year=academic_year)
    allocation = allocate(student, fleet)
    TransportAttendance.objects.create(
        school=school, student=student, allocation=allocation, date=timezone.localdate(),
        shift=shift_for(timezone.now()), boarded=False, note="absent", source="manual",
    )
    process_gps_update(fleet["vehicle"], 17.49, 78.38, 20)
    line = TransportAttendance.objects.get()
    assert line.boarded is False and line.source == "manual"


def test_simulated_gps_is_flagged_and_does_not_mark_school_attendance(school, academic_year, fleet):
    student = make_student(school, "A1", academic_year=academic_year)
    allocate(student, fleet)
    result = process_gps_update(fleet["vehicle"], 17.49, 78.38, 20, simulated=True)
    assert result.location.is_simulated is True
    assert StopArrival.objects.get().is_simulated is True
    assert not StudentAttendance.objects.exists()
    assert "(simulated)" in result.alert.message


def test_simulator_refuses_without_debug(settings, school, academic_year, fleet):
    settings.DEBUG = False
    with pytest.raises(CommandError, match="development-only"):
        call_command("simulate_bus_gps", vehicle=fleet["vehicle"].id, interval=0)


def test_simulator_runs_in_debug(settings, school, academic_year, fleet):
    settings.DEBUG = True
    call_command("simulate_bus_gps", vehicle=fleet["vehicle"].id, steps=1, interval=0)
    assert StopArrival.objects.filter(is_simulated=True).count() == 2
    assert not TransportNotificationLog.objects.exists()
