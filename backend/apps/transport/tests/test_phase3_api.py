"""
Transport Phase 3 API tests: maintenance records, the fuel log and its mileage
calculations, the dashboard summary and the reports - all from stored records.
"""
from datetime import date, timedelta

import pytest
from django.utils import timezone

from apps.students.models import Student
from apps.transport.models import (
    AssignVehicle, FuelEntry, StudentTransportAllocation, TransportAlert, TransportAttendance, VehicleServiceRecord,
)

from .test_phase1_api import client_with_codes, make_route, make_stop, make_vehicle

MAINT = "/api/v1/core/transport-maintenance/"
FUEL = "/api/v1/core/transport-fuel/"
DASH = "/api/v1/core/transport-dashboard/"
REPORTS = "/api/v1/core/transport-reports/"
SEPT = date(2026, 9, 1)


@pytest.fixture
def fleet(school, academic_year):
    route = make_route(school, "Madhapur", code="R1")
    stop = make_stop(route, "Stop A", 1)
    vehicle = make_vehicle(school, vehicle_type="van")  # 12 seats
    AssignVehicle.objects.create(school=school, academic_year=academic_year, vehicle=vehicle, route=route)
    return {"route": route, "stop": stop, "vehicle": vehicle}


def ride(fleet, school, academic_year, n, fare=1500):
    students = []
    for i in range(n):
        student = Student.objects.create(
            school=school, academic_year=academic_year, admission_no=f"R{i}", first_name=f"S{i}", gender="male"
        )
        StudentTransportAllocation.objects.create(
            school=school, academic_year=academic_year, student=student, route=fleet["route"], stop=fleet["stop"],
            vehicle=fleet["vehicle"], status="allocated", monthly_fare=fare,
        )
        students.append(student)
    return students


def log_fuel(client, vehicle, day, odometer, litres="50", rate="100"):
    return client.post(FUEL, {
        "vehicle": vehicle.id, "date": day.isoformat(), "odometer_km": odometer, "litres": litres, "rate": rate,
        "station": "HP Madhapur",
    }, format="json")


# Maintenance
def test_service_record_status_is_derived_and_filterable(admin_client, school, academic_year, fleet):
    today = timezone.localdate()
    vehicle = fleet["vehicle"].id
    overdue = admin_client.post(MAINT, {
        "vehicle": vehicle, "service_date": (today - timedelta(days=2)).isoformat(), "service_type": "Oil change",
        "cost": "2400", "vendor": "City Motors",
    }, format="json")
    assert overdue.status_code == 201, overdue.data
    assert overdue.data["display_status"] == "overdue"
    soon = admin_client.post(MAINT, {"vehicle": vehicle, "service_date": (today + timedelta(days=3)).isoformat(),
                                     "service_type": "Brakes"}, format="json")
    assert soon.data["display_status"] == "due_soon"
    later = admin_client.post(MAINT, {"vehicle": vehicle, "service_date": (today + timedelta(days=40)).isoformat(),
                                      "service_type": "Tyres"}, format="json")
    assert later.data["display_status"] == "scheduled"

    assert [r["id"] for r in admin_client.get(f"{MAINT}?status=overdue").data["results"]] == [overdue.data["id"]]
    assert admin_client.get(f"{MAINT}?status=nonsense").status_code == 400

    done = admin_client.post(f"{MAINT}complete/", {"ids": [overdue.data["id"], soon.data["id"]]}, format="json")
    assert done.data["completed"] == 2
    record = VehicleServiceRecord.objects.get(pk=overdue.data["id"])
    assert record.status == "completed" and record.completed_at is not None


def test_service_record_validation_and_school_scope(admin_client, school, academic_year, fleet, other_school):
    future = (timezone.localdate() + timedelta(days=5)).isoformat()
    completed_future = admin_client.post(MAINT, {"vehicle": fleet["vehicle"].id, "service_date": future,
                                                 "service_type": "x", "status": "completed"}, format="json")
    assert completed_future.status_code == 400
    theirs = make_vehicle(other_school, "THEIRS")
    foreign = admin_client.post(MAINT, {"vehicle": theirs.id, "service_date": future, "service_type": "x"}, format="json")
    assert foreign.status_code == 400
    VehicleServiceRecord.objects.create(school=other_school, vehicle=theirs, service_date=SEPT, service_type="x")
    assert admin_client.get(MAINT).data["results"] == []


def test_maintenance_permissions(school, academic_year, fleet):
    record = VehicleServiceRecord.objects.create(school=school, vehicle=fleet["vehicle"], service_date=SEPT, service_type="x")
    viewer = client_with_codes(school, ["transport.maintenance.view"])
    assert viewer.get(MAINT).status_code == 200
    assert viewer.post(f"{MAINT}complete/", {"ids": [record.id]}, format="json").status_code == 403
    assert viewer.post(f"{MAINT}bulk-delete/", {"ids": [record.id]}, format="json").status_code == 403


# Fuel Management
def test_fuel_mileage_baseline_and_anomaly_are_calculated(admin_client, school, academic_year, fleet):
    vehicle = fleet["vehicle"]
    first = log_fuel(admin_client, vehicle, SEPT, 1000)
    assert first.status_code == 201, first.data
    assert first.data["amount"] == "5000.00" and first.data["kml"] is None  # no previous reading
    log_fuel(admin_client, vehicle, SEPT + timedelta(days=3), 1300)
    third = log_fuel(admin_client, vehicle, SEPT + timedelta(days=6), 1600)
    fourth = log_fuel(admin_client, vehicle, SEPT + timedelta(days=9), 1800)

    rows = {r["odometer_km"]: r for r in admin_client.get(FUEL).data["results"]}
    assert rows[1300]["kml"] == "6.00" and rows[1300]["baseline_kml"] is None
    assert rows[1600]["kml"] == "6.00" and rows[1600]["baseline_kml"] == "6.00"
    assert rows[1800]["kml"] == "4.00" and rows[1800]["anomaly"] is True  # 4.0 < 80% of 6.0
    vehicle.refresh_from_db()
    assert vehicle.odometer_km == 1800

    # Deleting an entry recomputes the chain: 1300 -> 1800 is now 500 km on 50 L.
    assert admin_client.delete(f"{FUEL}{third.data['id']}/").status_code == 204
    entry = FuelEntry.objects.get(pk=fourth.data["id"])
    assert str(entry.kml) == "10.00" and entry.anomaly is False


def test_fuel_rejects_bad_odometer_future_date_and_foreign_vehicle(admin_client, school, academic_year, fleet, other_school):
    vehicle = fleet["vehicle"]
    log_fuel(admin_client, vehicle, SEPT, 1000)
    log_fuel(admin_client, vehicle, SEPT + timedelta(days=5), 1400)
    assert log_fuel(admin_client, vehicle, SEPT + timedelta(days=7), 1200).status_code == 400  # below earlier reading
    assert log_fuel(admin_client, vehicle, SEPT + timedelta(days=2), 1500).status_code == 400  # above later reading
    assert log_fuel(admin_client, vehicle, SEPT + timedelta(days=2), 1200).status_code == 201  # fits between
    assert log_fuel(admin_client, vehicle, timezone.localdate() + timedelta(days=1), 9000).status_code == 400
    assert log_fuel(admin_client, vehicle, SEPT + timedelta(days=8), 1600, litres="0").status_code == 400
    assert log_fuel(admin_client, make_vehicle(other_school, "THEIRS"), SEPT, 10).status_code == 400


def test_fuel_verify_summary_and_permissions(admin_client, school, academic_year, fleet):
    vehicle = fleet["vehicle"]
    ids = [log_fuel(admin_client, vehicle, SEPT + timedelta(days=d), odo).data["id"] for d, odo in ((0, 1000), (4, 1300))]
    assert admin_client.post(f"{FUEL}verify/", {"ids": ids}, format="json").data["verified"] == 2
    summary = admin_client.get(f"{FUEL}summary/?month=2026-09").data
    assert float(summary["spend"]) == 10000 and summary["km"] == 300 and summary["avg_kml"] == 3.0
    assert summary["per_vehicle"][0]["vehicle_no"] == vehicle.vehicle_no
    assert summary["trend"][-1]["month"] == "2026-09"

    viewer = client_with_codes(school, ["transport.fuel.view"])
    assert viewer.get(FUEL).status_code == 200
    assert viewer.post(f"{FUEL}verify/", {"ids": ids}, format="json").status_code == 403
    assert log_fuel(viewer, vehicle, SEPT + timedelta(days=9), 1600).status_code == 403


# Dashboard
def test_dashboard_summary_counts_stored_records(admin_client, school, academic_year, fleet):
    today = timezone.localdate()
    students = ride(fleet, school, academic_year, 3)
    TransportAttendance.objects.create(school=school, student=students[0], date=today, shift="morning", boarded=True, late=True)
    TransportAttendance.objects.create(school=school, student=students[1], date=today, shift="morning", boarded=False)
    TransportAlert.objects.create(vehicle=fleet["vehicle"], alert_type="sos", message="x", severity="critical")
    VehicleServiceRecord.objects.create(school=school, vehicle=fleet["vehicle"], service_date=today - timedelta(days=1), service_type="x")
    FuelEntry.objects.create(school=school, vehicle=fleet["vehicle"], date=today, litres=10, rate=100, amount=1000, odometer_km=5)

    body = admin_client.get(f"{DASH}?shift=morning").data
    assert body["students"]["allocated"] == 3 and body["students"]["boarded"] == 1 and body["students"]["late"] == 1
    assert body["seats"] == {"used": 3, "total": 12, "utilisation_pct": 25.0}
    assert body["alerts"]["open"] == 1 and body["alerts"]["critical"] == 1
    assert body["maintenance"]["overdue"] == 1 and body["maintenance"]["due"] == 1
    assert float(body["fuel"]["spend_mtd"]) == 1000
    assert len(body["boardings_week"]) == 7 and body["boardings_week"][-1]["value"] == 1


def test_dashboard_is_empty_for_new_school_and_needs_permission(school, academic_year):
    viewer = client_with_codes(school, ["transport.dashboard.view"])
    body = viewer.get(DASH).data
    assert body["fleet"]["total"] == 0 and body["seats"]["utilisation_pct"] is None
    assert client_with_codes(school, ["transport.fuel.view"]).get(DASH).status_code == 403


# Reports
def test_report_catalogue_preview_and_log(admin_client, school, academic_year, fleet):
    catalogue = admin_client.get(REPORTS).data
    assert len(catalogue) == 6 and all(r["last_generated"] is None for r in catalogue)

    ride(fleet, school, academic_year, 6)
    strength = admin_client.get(f"{REPORTS}route-strength/").data
    row = strength["rows"][0]
    assert row["students"] == 6 and row["capacity"] == 12 and row["utilisation"] == 50.0 and row["_tone"] == "ok"
    assert strength["totals"]["students"] == 6

    logged = admin_client.post(f"{REPORTS}route-strength/log/", {"period": "Oct 2026", "scope": "All routes", "file_format": "excel"}, format="json")
    assert logged.status_code == 201, logged.data
    assert admin_client.get(f"{REPORTS}recent/").data[0]["report"] == "route-strength"
    assert next(r for r in admin_client.get(REPORTS).data if r["key"] == "route-strength")["last_generated"]

    assert admin_client.get(f"{REPORTS}no-such-report/").status_code == 404
    assert admin_client.get(f"{REPORTS}route-strength/?month=2026-13").status_code == 400


def test_boarding_register_report(admin_client, school, academic_year, fleet):
    students = ride(fleet, school, academic_year, 4)
    day = date(2026, 10, 6)
    TransportAttendance.objects.create(school=school, student=students[0], date=day, shift="morning", boarded=True)
    TransportAttendance.objects.create(school=school, student=students[1], date=day, shift="morning", boarded=True, late=True)
    TransportAttendance.objects.create(school=school, student=students[2], date=day, shift="morning", boarded=False)
    body = admin_client.get(f"{REPORTS}boarding-register/?date=2026-10-06&shift=morning").data
    row = body["rows"][0]
    assert (row["allocated"], row["boarded"], row["not_boarded"], row["unmarked"], row["late"]) == (4, 2, 1, 1, 1)
    assert row["on_time"] == 25.0 and row["_tone"] == "danger"


def test_cost_and_fee_reports_use_stored_amounts(admin_client, school, academic_year, fleet):
    ride(fleet, school, academic_year, 2, fare=1200)
    vehicle = fleet["vehicle"]
    FuelEntry.objects.create(school=school, vehicle=vehicle, date=SEPT, litres=30, rate=100, amount=3000, odometer_km=10)
    VehicleServiceRecord.objects.create(school=school, vehicle=vehicle, service_date=SEPT, service_type="x", cost=1000, status="completed")
    VehicleServiceRecord.objects.create(school=school, vehicle=vehicle, service_date=SEPT, service_type="y", cost=999)  # not done
    cost = admin_client.get(f"{REPORTS}fuel-maintenance-cost/?month=2026-09").data
    row = cost["rows"][0]
    assert float(row["fuel"]) == 3000 and float(row["maintenance"]) == 1000 and float(row["per_student"]) == 2000

    fees = admin_client.get(f"{REPORTS}fee-collection/?month=2026-09").data
    assert float(fees["totals"]["billed"]) == 2400 and float(fees["totals"]["collected"]) == 0
    assert fees["totals"]["defaulters"] == 2 and fees["notes"]


def test_reports_are_school_scoped_and_need_permission(school, academic_year, fleet, other_school):
    other_route = make_route(other_school, "Theirs", code="T1")
    viewer = client_with_codes(school, ["transport.report.view"])
    rows = viewer.get(f"{REPORTS}route-strength/").data["rows"]
    assert [r["route"] for r in rows] == ["R1 - Madhapur"]
    assert viewer.get(f"{REPORTS}route-strength/?route={other_route.id}").data["rows"] == []
    assert client_with_codes(school, ["transport.vehicle.view"]).get(REPORTS).status_code == 403
