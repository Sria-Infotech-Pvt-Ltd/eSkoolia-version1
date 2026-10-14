"""Fixtures shared by the transport API tests (on top of backend/conftest.py)."""
import pytest

from apps.core.models import AcademicYear
from apps.tenancy.models import School


@pytest.fixture
def other_school(db):
    """A second school, to prove records never cross school boundaries."""
    school = School.objects.create(name="Other School", code="OTHER", is_active=True)
    AcademicYear.objects.create(
        school=school, name="2025-2026", start_date="2025-06-01", end_date="2026-03-31", is_current=True
    )
    return school
