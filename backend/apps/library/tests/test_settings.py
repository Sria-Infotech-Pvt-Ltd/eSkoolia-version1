"""Library settings: lazy defaults, update, read-only counters, school isolation."""
from decimal import Decimal

import pytest

from apps.library.models import LibraryActivityLog, LibrarySettings
from apps.library.services.settings import get_settings
from apps.library.tests.conftest import client_for, make_user

URL = "/api/v1/library/settings/"


@pytest.fixture
def classes(school, other_school):
    from apps.core.models import Class

    made = {name: Class.objects.create(school=school, name=name, numeric_order=i) for i, name in enumerate(
        ["Nursery", "LKG", "UKG", "Grade 1", "Grade 4", "Grade 5", "Grade 10"]
    )}
    made["other_grade_1"] = Class.objects.create(school=other_school, name="Grade 1")
    return made


def test_get_creates_the_row_with_the_locked_defaults(librarian_client, school):
    assert not LibrarySettings.objects.filter(school=school).exists()
    body = librarian_client.get(URL).json()
    assert body["success"] is True
    data = body["data"]
    assert data["fine_per_day"] == "10.00" and data["fine_grace_days"] == 0 and data["fine_cap"] is None
    assert data["cap_fine_at_replacement_cost"] is True
    assert (data["limit_student"], data["limit_teacher"], data["limit_staff"]) == (2, 5, 3)
    assert (data["student_min_due_days"], data["flat_loan_days"], data["max_renewals"]) == (10, 14, 2)
    assert data["replacement_processing_fee"] == "50.00" and data["replacement_default_cost"] == "150.00"
    assert data["registration_fee_junior"] == "300.00" and data["registration_fee_senior"] == "500.00"
    assert data["notify_sms_email_enabled"] is False
    assert data["low_stock_ratio"] == "0.34" and data["unscanned_flag_minutes"] == 5 and data["undo_return_minutes"] == 10
    assert data["po_sequence"] == 0 and data["donation_receipt_sequence"] == 0
    assert LibrarySettings.objects.filter(school=school).count() == 1


def test_junior_classes_are_filled_from_the_schools_own_class_names(school, classes):
    row = get_settings(school)
    expected = {classes[name].id for name in ["Nursery", "LKG", "UKG", "Grade 1", "Grade 4"]}
    assert set(row.junior_class_ids) == expected
    assert classes["other_grade_1"].id not in row.junior_class_ids
    assert get_settings(school).pk == row.pk  # idempotent, filled once


def test_junior_classes_are_not_recomputed_after_creation(school, classes):
    from apps.core.models import Class

    first = get_settings(school)
    Class.objects.create(school=school, name="Grade 2")
    assert get_settings(school).junior_class_ids == first.junior_class_ids


def test_each_school_gets_its_own_row(librarian_client, other_admin, school, other_school):
    librarian_client.put(URL, {"fine_per_day": "25.00"}, format="json")
    other = client_for(other_admin).get(URL).json()["data"]
    assert other["fine_per_day"] == "10.00" and other["school"] == other_school.pk
    assert LibrarySettings.objects.get(school=school).fine_per_day == Decimal("25.00")


def test_put_updates_editable_fields_and_stamps_updated_by(librarian_client, librarian, school):
    resp = librarian_client.put(
        URL, {"fine_per_day": "12.50", "limit_student": 3, "fine_cap": "400.00", "notify_sms_email_enabled": True}, format="json"
    )
    assert resp.status_code == 200
    row = LibrarySettings.objects.get(school=school)
    assert (row.fine_per_day, row.limit_student, row.fine_cap, row.notify_sms_email_enabled) == (
        Decimal("12.50"), 3, Decimal("400.00"), True,
    )
    assert row.updated_by_id == librarian.pk
    assert librarian_client.put(URL, {"fine_cap": None}, format="json").status_code == 200
    row.refresh_from_db()
    assert row.fine_cap is None


def test_counters_and_audit_fields_are_read_only(librarian_client, school, admin_user):
    resp = librarian_client.put(
        URL, {"po_sequence": 99, "donation_receipt_sequence": 99, "created_by": admin_user.pk, "school": 12345}, format="json"
    )
    assert resp.status_code == 200
    row = LibrarySettings.objects.get(school=school)
    assert (row.po_sequence, row.donation_receipt_sequence) == (0, 0)
    assert row.school_id == school.id and row.created_by_id != admin_user.pk


@pytest.mark.parametrize(
    "payload,field",
    [
        ({"fine_per_day": "-1"}, "fine_per_day"),
        ({"fine_cap": "-5"}, "fine_cap"),
        ({"limit_student": -1}, "limit_student"),
        ({"low_stock_ratio": "1.5"}, "low_stock_ratio"),
        ({"replacement_default_cost": "-0.01"}, "replacement_default_cost"),
    ],
)
def test_invalid_values_are_rejected(librarian_client, payload, field):
    resp = librarian_client.put(URL, payload, format="json")
    assert resp.status_code == 400
    assert field in resp.json()["field_errors"]


def test_junior_class_ids_must_belong_to_the_school(librarian_client, school, classes):
    ok = librarian_client.put(URL, {"junior_class_ids": [classes["Grade 5"].id, classes["Nursery"].id]}, format="json")
    assert ok.status_code == 200
    assert set(ok.json()["data"]["junior_class_ids"]) == {classes["Grade 5"].id, classes["Nursery"].id}
    bad = librarian_client.put(URL, {"junior_class_ids": [classes["other_grade_1"].id]}, format="json")
    assert bad.status_code == 400 and "junior_class_ids" in bad.json()["field_errors"]


def test_view_code_reads_manage_code_writes(school):
    reader = client_for(make_user(school, ["library.settings.view"]))
    manager = client_for(make_user(school, ["library.settings.manage"]))
    assert reader.get(URL).status_code == 200
    assert reader.put(URL, {"fine_per_day": "11"}, format="json").status_code == 403
    assert manager.put(URL, {"fine_per_day": "11"}, format="json").status_code == 200
    assert manager.get(URL).status_code == 403


def test_legacy_view_codes_do_not_open_settings(view_only_client):
    assert view_only_client.get(URL).status_code == 403


def test_update_writes_one_activity_row_without_values_in_the_summary(librarian_client, librarian, school):
    librarian_client.put(URL, {"fine_per_day": "30.00", "limit_staff": 4}, format="json")
    rows = list(LibraryActivityLog.objects.filter(school=school))
    assert len(rows) == 1
    row = rows[0]
    assert row.event_type == "settings" and row.actor_id == librarian.pk
    assert row.metadata == {"fields": ["fine_per_day", "limit_staff"]}


def test_no_activity_row_when_nothing_changed(librarian_client, school):
    librarian_client.put(URL, {"fine_per_day": "10.00"}, format="json")
    assert LibraryActivityLog.objects.filter(school=school).count() == 0
