"""
Transport Phase 1 API tests: school scoping, related-record validation, the
view/add/edit/delete permission split, the create fixes for models without a
`school` column, GPS update scoping, vehicle actions and WebSocket security.

Uses the shared fixtures in backend/conftest.py (school, academic_year,
admin_user, admin_client).
"""
import uuid
from datetime import date, timedelta

import pytest
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.access_control.models import Permission, Role, RolePermission, UserRole
from apps.core.models import AcademicYear
from apps.hr.models import Staff
from apps.students.models import Student
from apps.transport.models import AssignVehicle, BusStop, TransportRoute, Vehicle
from apps.transport.routing import websocket_urlpatterns

User = get_user_model()


# Helpers (the other_school fixture lives in conftest.py)
def make_staff(school, staff_no, first_name="Ravi"):
    return Staff.objects.create(school=school, staff_no=staff_no, first_name=first_name, join_date="2024-01-01")


def make_vehicle(school, number="TS 07 UB 4421", **extra):
    year = AcademicYear.objects.filter(school=school).first()
    return Vehicle.objects.create(school=school, academic_year=year, vehicle_no=number, vehicle_model="Tata", **extra)


def make_route(school, title="Madhapur", **extra):
    year = AcademicYear.objects.filter(school=school).first()
    return TransportRoute.objects.create(school=school, academic_year=year, title=title, fare=1500, **extra)


def make_stop(route, name="Stop A", order=1):
    return BusStop.objects.create(route=route, stop_name=name, latitude=17.49, longitude=78.38, stop_order=order)


def client_with_codes(school, codes):
    """A non-admin user whose only permissions are `codes`."""
    user = User.objects.create_user(username=f"u_{uuid.uuid4().hex[:10]}", password="x", school=school)
    role = Role.objects.create(school=school, name="Transport test")
    for code in codes:
        permission, _ = Permission.objects.get_or_create(code=code, defaults={"name": code, "module": "transport"})
        RolePermission.objects.create(role=role, permission=permission)
    UserRole.objects.create(user=user, role=role)
    client = APIClient()
    client.force_authenticate(user=user)
    return client


# Vehicles
def test_vehicle_create_uses_new_fields_and_ignores_gps_fields(admin_client, academic_year):
    response = admin_client.post("/api/v1/core/vehicles/", {
        "vehicle_no": "TS 08 LM 2290", "vehicle_model": "Force Traveller", "vehicle_type": "mini_bus",
        "insurance_valid_till": (date.today() + timedelta(days=10)).isoformat(),
        "current_latitude": "1.0", "current_speed": 99,  # read-only: must be ignored
    }, format="json")
    assert response.status_code == 201, response.data
    body = response.data
    assert body["capacity"] == 26  # default for mini-bus
    assert body["current_latitude"] is None and body["current_speed"] == 0
    insurance = next(d for d in body["compliance"] if d["field"] == "insurance_valid_till")
    assert insurance["state"] == "expiring"


def test_old_vehicle_payload_still_works(admin_client, academic_year):
    """The legacy VehiclePanel only sends these fields."""
    response = admin_client.post("/api/v1/core/vehicles/", {
        "vehicle_no": "TS 00 AA 0001", "vehicle_model": "Old form", "made_year": 2019, "note": "", "active_status": True,
    }, format="json")
    assert response.status_code == 201, response.data
    assert response.data["vehicle_type"] == "bus" and response.data["operational_status"] == "active"


def test_vehicle_list_is_school_scoped(admin_client, school, academic_year, other_school):
    make_vehicle(school, "MINE 1")
    theirs = make_vehicle(other_school, "THEIRS 1")
    numbers = [v["vehicle_no"] for v in admin_client.get("/api/v1/core/vehicles/").data["results"]]
    assert numbers == ["MINE 1"]
    assert admin_client.get(f"/api/v1/core/vehicles/{theirs.id}/").status_code == 404


def test_vehicle_rejects_driver_from_another_school(admin_client, academic_year, other_school):
    foreign_driver = make_staff(other_school, "X-1")
    response = admin_client.post("/api/v1/core/vehicles/", {
        "vehicle_no": "TS 01", "vehicle_model": "Bus", "driver": foreign_driver.id,
    }, format="json")
    assert response.status_code == 400
    assert "driver" in response.data["field_errors"]  # project exception handler format


def test_vehicle_actions_archive_breakdown_and_document_renewal(admin_client, school, academic_year):
    vehicle = make_vehicle(school)
    base = f"/api/v1/core/vehicles/{vehicle.id}"
    assert admin_client.post(f"{base}/mark-breakdown/").data["operational_status"] == "breakdown"

    past = admin_client.post(f"{base}/renew-document/", {"document": "insurance_valid_till", "valid_till": "2020-01-01"}, format="json")
    assert past.status_code == 400
    future = (date.today() + timedelta(days=365)).isoformat()
    renewed = admin_client.post(f"{base}/renew-document/", {"document": "insurance_valid_till", "valid_till": future}, format="json")
    assert renewed.status_code == 200 and renewed.data["insurance_valid_till"] == future

    assert admin_client.post(f"{base}/archive/").data["active_status"] is False
    assert Vehicle.objects.filter(id=vehicle.id).exists()  # archived, not deleted
    active = admin_client.get("/api/v1/core/vehicles/?archived=false").data["results"]
    assert all(v["id"] != vehicle.id for v in active)


def test_vehicle_compliance_filter(admin_client, school, academic_year):
    make_vehicle(school, "EXPIRED", fitness_valid_till=date.today() - timedelta(days=3))
    make_vehicle(school, "SOON", insurance_valid_till=date.today() + timedelta(days=5))
    make_vehicle(school, "FINE", insurance_valid_till=date.today() + timedelta(days=300))
    expired = {v["vehicle_no"] for v in admin_client.get("/api/v1/core/vehicles/?compliance=expired").data["results"]}
    expiring = {v["vehicle_no"] for v in admin_client.get("/api/v1/core/vehicles/?compliance=expiring").data["results"]}
    assert expired == {"EXPIRED"} and expiring == {"SOON"}


# Permissions
def test_view_only_role_can_read_but_not_write(school, academic_year):
    viewer = client_with_codes(school, ["transport.vehicle.view"])
    assert viewer.get("/api/v1/core/vehicles/").status_code == 200
    assert viewer.post("/api/v1/core/vehicles/", {"vehicle_no": "N1", "vehicle_model": "M"}, format="json").status_code == 403
    vehicle = make_vehicle(school)
    assert viewer.post(f"/api/v1/core/vehicles/{vehicle.id}/archive/").status_code == 403
    assert viewer.delete(f"/api/v1/core/vehicles/{vehicle.id}/").status_code == 403


def test_add_code_allows_create_only(school, academic_year):
    writer = client_with_codes(school, ["transport.vehicle.view", "transport.vehicle.add"])
    assert writer.post("/api/v1/core/vehicles/", {"vehicle_no": "N2", "vehicle_model": "M"}, format="json").status_code == 201
    vehicle = Vehicle.objects.get(vehicle_no="N2")
    assert writer.patch(f"/api/v1/core/vehicles/{vehicle.id}/", {"note": "x"}, format="json").status_code == 403


# Routes and stops
def test_route_code_is_unique_per_school_and_detail_has_stops(admin_client, school, academic_year, other_school):
    make_route(other_school, "Their R3", code="R3")  # same code in another school is fine
    created = admin_client.post("/api/v1/core/transport-routes/", {"title": "Madhapur", "fare": "1500", "code": "r3", "zone": "West"}, format="json")
    assert created.status_code == 201, created.data
    assert created.data["code"] == "R3"
    dup = admin_client.post("/api/v1/core/transport-routes/", {"title": "Other", "fare": "1500", "code": "R3"}, format="json")
    assert dup.status_code == 400

    route = TransportRoute.objects.get(id=created.data["id"])
    make_stop(route, "B", 2)
    make_stop(route, "A", 1)
    detail = admin_client.get(f"/api/v1/core/transport-routes/{route.id}/").data
    assert [s["stop_name"] for s in detail["stops"]] == ["A", "B"]
    assert detail["stops_count"] == 2
    # Existing route-builder action still works.
    assert admin_client.get(f"/api/v1/core/transport-routes/{route.id}/builder/").data["total_stops"] == 2


def test_bus_stop_create_works_and_rejects_foreign_route(admin_client, school, academic_year, other_school):
    """POST /bus-stops/ used to fail: perform_create passed school= to a model without that column."""
    route = make_route(school)
    response = admin_client.post("/api/v1/core/bus-stops/", {
        "route": route.id, "stop_name": "Kondapur", "latitude": "17.46", "longitude": "78.36",
        "landmark": "near bus shelter", "monthly_fare": "1800",
    }, format="json")
    assert response.status_code == 201, response.data
    assert response.data["stop_order"] == 1 and response.data["effective_fare"] == "1800.00"

    foreign = make_route(other_school, "Theirs")
    rejected = admin_client.post("/api/v1/core/bus-stops/", {
        "route": foreign.id, "stop_name": "X", "latitude": "17.4", "longitude": "78.3",
    }, format="json")
    assert rejected.status_code == 400


def test_alert_create_works_and_rejects_foreign_vehicle(admin_client, school, academic_year, other_school):
    mine = make_vehicle(school)
    created = admin_client.post("/api/v1/core/transport-alerts/", {
        "vehicle": mine.id, "alert_type": "mechanical", "message": "Coolant leak", "severity": "critical",
    }, format="json")
    assert created.status_code == 201, created.data
    theirs = make_vehicle(other_school, "THEIRS")
    rejected = admin_client.post("/api/v1/core/transport-alerts/", {
        "vehicle": theirs.id, "alert_type": "mechanical", "message": "x",
    }, format="json")
    assert rejected.status_code == 400


def test_pickup_list_serializes_student_name(admin_client, school, academic_year):
    """student_name used source='student.full_name', which Student does not have."""
    route = make_route(school)
    stop = make_stop(route)
    vehicle = make_vehicle(school)
    student = Student.objects.create(school=school, admission_no="ADM1", first_name="Aarav", last_name="Reddy", gender="male")
    created = admin_client.post("/api/v1/core/bus-pickups/", {
        "stop": stop.id, "vehicle": vehicle.id, "student": student.id, "arrived_at": "2026-10-06T07:05:00Z", "status": "arrived",
    }, format="json")
    assert created.status_code == 201, created.data
    rows = admin_client.get("/api/v1/core/bus-pickups/").data["results"]
    assert rows[0]["student_name"] == "Aarav Reddy"


# Live Tracking and GPS
def test_gps_update_rejects_other_schools_vehicle(admin_client, school, academic_year, other_school):
    theirs = make_vehicle(other_school, "THEIRS")
    response = admin_client.post("/api/v1/core/bus-locations/", {"vehicle": theirs.id, "latitude": 17.4, "longitude": 78.3}, format="json")
    assert response.status_code == 404
    theirs.refresh_from_db()
    assert theirs.current_latitude is None  # untouched


def test_gps_update_needs_tracking_permission(school, academic_year):
    vehicle = make_vehicle(school)
    payload = {"vehicle": vehicle.id, "latitude": 17.4, "longitude": 78.3, "speed": 30}
    viewer = client_with_codes(school, ["transport.vehicle.view"])
    assert viewer.post("/api/v1/core/bus-locations/", payload, format="json").status_code == 403
    tracker = client_with_codes(school, ["transport.vehicle.view", "transport.tracking.update"])
    response = tracker.post("/api/v1/core/bus-locations/", payload, format="json")
    assert response.status_code == 201, response.data
    vehicle.refresh_from_db()
    assert vehicle.status == "in_transit" and float(vehicle.current_latitude) == 17.4


def test_gps_update_broadcasts_only_to_own_school(admin_client, school, academic_year, other_school):
    vehicle = make_vehicle(school)
    layer = get_channel_layer()
    mine = async_to_sync(layer.new_channel)()
    theirs = async_to_sync(layer.new_channel)()
    async_to_sync(layer.group_add)(f"bus_location_school_{school.id}", mine)
    async_to_sync(layer.group_add)(f"bus_location_school_{other_school.id}", theirs)

    admin_client.post("/api/v1/core/bus-locations/", {"vehicle": vehicle.id, "latitude": 17.4, "longitude": 78.3}, format="json")

    message = async_to_sync(layer.receive)(mine)
    assert message["type"] == "bus_location_update" and message["location"]["vehicle"] == vehicle.id
    assert layer.channels.get(theirs) is None or layer.channels[theirs].empty()


# WebSockets
def _socket(path):
    return WebsocketCommunicator(URLRouter(websocket_urlpatterns), path)


@pytest.mark.django_db(transaction=True)
def test_websocket_rejects_anonymous_and_accepts_jwt(school, admin_user):
    async def run():
        anonymous = _socket("/ws/bus-alerts/")
        connected, _ = await anonymous.connect()
        assert connected is False

        token = str(AccessToken.for_user(admin_user))
        authed = _socket(f"/ws/bus-alerts/?token={token}")
        connected, _ = await authed.connect()
        assert connected is True
        await authed.disconnect()

    async_to_sync(run)()


@pytest.mark.django_db(transaction=True)
def test_websocket_route_from_other_school_is_forbidden(school, academic_year, admin_user, other_school):
    foreign_route = make_route(other_school, "Theirs")
    token = str(AccessToken.for_user(admin_user))

    async def run():
        socket = _socket(f"/ws/bus-tracking/location/{foreign_route.id}/?token={token}")
        connected, _ = await socket.connect()
        assert connected is False

    async_to_sync(run)()


def test_route_vehicle_counts_from_existing_students(admin_client, school, academic_year):
    """Seat occupancy comes from existing Student.vehicle links - no duplicated student records."""
    vehicle = make_vehicle(school, vehicle_type="van")
    route = make_route(school)
    AssignVehicle.objects.create(school=school, academic_year=vehicle.academic_year, vehicle=vehicle, route=route)
    for i in range(3):
        Student.objects.create(school=school, admission_no=f"A{i}", first_name=f"S{i}", gender="male", vehicle=vehicle, transport_route=route)
    body = admin_client.get(f"/api/v1/core/vehicles/{vehicle.id}/").data
    assert body["seats_occupied"] == 3 and body["capacity"] == 12
    assert body["route"]["id"] == route.id
    route_body = admin_client.get(f"/api/v1/core/transport-routes/{route.id}/").data
    assert route_body["students_count"] == 3 and route_body["vehicle"]["vehicle_no"] == vehicle.vehicle_no
