"""
Tests — Cross-Tenant / Cross-Portal / Micro-Permission Isolation
==================================================================
Written as part of the 2026-09-28 RBAC/ABAC portal-rendering audit.

Covers the three vectors from that audit's Phase 3 protocol:
  1. Cross-tenant breach attempts (School A user reaching School B data)
  2. Cross-portal breach attempts (wrong portal_type hitting admin-only APIs)
  3. Micro-permission fuzzing (granted on one module, denied on another)

Also pins down regression coverage for the two concrete cross-tenant write
bugs fixed in this same audit:
  - apps/core/views.py::BusLocationViewSet.create() (unscoped vehicle_id)
  - apps/communication/serializers.py recipient_id fields (unscoped recipient)
"""

import pytest


def _make_school_b():
    from apps.tenancy.models import School
    from uuid import uuid4

    suffix = uuid4().hex[:6].upper()
    return School.objects.create(
        name=f"School B {suffix}",
        code=f"SB{suffix}",
        is_active=True,
    )


@pytest.fixture
def school_b():
    return _make_school_b()


@pytest.fixture
def parent_client(parent_user):
    from rest_framework.test import APIClient
    client = APIClient()
    client.force_authenticate(user=parent_user)
    return client


@pytest.mark.api
class TestCrossTenantBreach:
    """A School A token must never be able to read or write School B data."""

    def test_admin_cannot_see_other_school_roles(self, admin_client, school_b):
        from apps.access_control.models import Role
        Role.objects.create(school=school_b, name="School B Only Role")
        response = admin_client.get("/api/v1/access-control/roles/")
        assert response.status_code == 200
        names = [r["name"] for r in response.data.get("data", response.data.get("results", []))]
        assert "School B Only Role" not in names

    def test_bus_location_create_rejects_other_school_vehicle(self, admin_client, school_b):
        """Regression test for the BusLocationViewSet.create() cross-school write fix."""
        from apps.core.models import Vehicle, AcademicYear
        from datetime import date

        ay_b = AcademicYear.objects.create(
            school=school_b, name="2025-2026", start_date=date(2025, 4, 1), end_date=date(2026, 3, 31),
        )
        vehicle_b = Vehicle.objects.create(school=school_b, academic_year=ay_b, vehicle_no="B-VEH-1", vehicle_model="Bus")

        response = admin_client.post(
            "/api/v1/core/bus-locations/",
            {"vehicle": vehicle_b.id, "latitude": 22.57, "longitude": 88.36, "speed": 10},
            format="json",
        )
        # admin_client belongs to `school`, not `school_b` — must not be able to
        # write a location update for a vehicle it does not own.
        assert response.status_code in (403, 404)

    def test_notification_recipient_must_be_same_school(self, admin_client, school_b):
        """Regression test for the communication recipient_id cross-school write fix."""
        from django.contrib.auth import get_user_model
        User = get_user_model()
        other_school_user = User.objects.create_user(
            username="b_user", password="TestPass@123", school=school_b,
        )
        response = admin_client.post(
            "/api/v1/utilities/communication/notifications/",
            {"recipient_id": other_school_user.id, "title": "Hi", "body": "Test", "notification_type": "info"},
            format="json",
        )
        assert response.status_code == 400


@pytest.mark.api
class TestCrossPortalBreach:
    """A user's portal_type / role must gate which portals' APIs they can call."""

    def test_parent_cannot_manage_roles(self, parent_client):
        response = parent_client.get("/api/v1/access-control/roles/")
        assert response.status_code in (401, 403)

    def test_parent_cannot_create_role(self, parent_client, school):
        response = parent_client.post(
            "/api/v1/access-control/roles/", {"name": "Injected Role"}, format="json",
        )
        assert response.status_code in (401, 403)

    def test_teacher_without_permission_cannot_list_payroll(self, teacher_client):
        """Teacher has no HR permission codes assigned — payroll must 403, not 200."""
        response = teacher_client.get("/api/v1/hr/payroll/")
        assert response.status_code in (401, 403)


@pytest.mark.api
class TestMicroPermissionFuzzing:
    """A permission granted for one module must not leak access to another."""

    def test_teacher_with_no_roles_denied_hr_staff(self, teacher_client):
        response = teacher_client.get("/api/v1/hr/staff/")
        assert response.status_code in (401, 403)

    def test_teacher_with_no_roles_denied_finance(self, teacher_client):
        # NOTE: /api/v1/finance/ (no trailing resource) is DRF's DefaultRouter
        # api-root — it lists endpoint *names*, not data, and is intentionally
        # open to any authenticated user. Probe an actual resource instead.
        response = teacher_client.get("/api/v1/finance/ledger-entries/")
        assert response.status_code in (401, 403)
