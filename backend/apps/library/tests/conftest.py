"""Fixtures for the library tests.

The root conftest supplies ``school``, ``admin_user`` (a school admin) and
``api_client``. This file adds a second school and users that hold explicit
permission codes, so a test can prove exactly which code opens which door.
"""
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.access_control.management.commands.seed_permissions import PERMISSIONS

User = get_user_model()

LIBRARY_CODES = [code for code, _name, module in PERMISSIONS if module == "library"]
LEGACY_VIEW_CODES = [
    "library.book_categories.view",
    "library.books.view",
    "library.library_members.view",
    "library.book_issues.view",
]


def make_user(school, codes, username=None):
    """A non-admin user of `school` whose single role holds exactly `codes`."""
    from apps.access_control.models import Permission, Role, RolePermission, UserRole

    username = username or f"lib_{uuid4().hex[:8]}"
    user = User.objects.create_user(username=username, password="TestPass@123", school=school)
    role = Role.objects.create(school=school, name=f"role_{uuid4().hex[:8]}")
    for code in codes:
        permission, _ = Permission.objects.get_or_create(
            code=code, defaults={"name": code, "module": code.split(".")[0]}
        )
        RolePermission.objects.create(role=role, permission=permission)
    UserRole.objects.create(user=user, role=role)
    return user


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def other_school(db):
    from apps.tenancy.models import School

    suffix = uuid4().hex[:6].upper()
    return School.objects.create(name=f"Other School {suffix}", code=f"OS{suffix}", is_active=True)


@pytest.fixture
def librarian(school):
    """Librarian-style user: every library code."""
    return make_user(school, LIBRARY_CODES)


@pytest.fixture
def view_only(school):
    """Holds the four legacy .view codes and nothing else (the pre-split 'reader')."""
    return make_user(school, LEGACY_VIEW_CODES)


@pytest.fixture
def librarian_client(librarian):
    return client_for(librarian)


@pytest.fixture
def view_only_client(view_only):
    return client_for(view_only)


@pytest.fixture
def other_admin(other_school):
    return User.objects.create_user(
        username=f"admin_{uuid4().hex[:8]}", password="TestPass@123", school=other_school, is_school_admin=True
    )


def make_book(school, category, title="Treasure Island", author="R. L. Stevenson", copies=2, **extra):
    """A title with `copies` available copies, created through the accession service."""
    from apps.library.services.accession import create_book_with_copies

    data = {"category": category, "title": title, "author": author, **extra}
    book, _ = create_book_with_copies(school, None, data, copies)
    return book


@pytest.fixture
def category(school):
    from apps.library.models import BookCategory

    return BookCategory.objects.create(school=school, name="Fiction", code="FIC")


@pytest.fixture
def book(school, category):
    return make_book(school, category)


def make_staff(school, staff_no=None, first_name="Asha", **extra):
    from uuid import uuid4

    from apps.hr.models import Staff

    return Staff.objects.create(
        school=school, staff_no=staff_no or f"S{uuid4().hex[:6]}", first_name=first_name, join_date="2020-01-01", **extra
    )


def make_member(school, card_no, member_type="staff", **extra):
    """A library member with the person its type requires (the database enforces it)."""
    from apps.library.models import LibraryMember

    if member_type == "student":
        extra.setdefault("student", _student(school, f"ADM-{card_no}"))
    else:
        extra.setdefault("staff", make_staff(school))
    return LibraryMember.objects.create(school=school, member_type=member_type, card_no=card_no, **extra)


@pytest.fixture
def member(school):
    return make_member(school, "CARD-001")


@pytest.fixture
def other_category(other_school):
    from apps.library.models import BookCategory

    return BookCategory.objects.create(school=other_school, name="Fiction", code="FIC")


@pytest.fixture
def other_book(other_school, other_category):
    return make_book(other_school, other_category, title="Kidnapped", copies=1)


@pytest.fixture
def other_member(other_school):
    return make_member(other_school, "CARD-OTHER")


@pytest.fixture
def other_issue(other_school, other_book, other_member):
    from apps.library.models import BookIssue

    return BookIssue.objects.create(
        school=other_school, book=other_book, member=other_member, issue_date="2026-01-01", due_date="2026-01-15"
    )


def _student(school, admission_no):
    from apps.students.models import Student

    return Student.objects.create(
        school=school, admission_no=admission_no, first_name="Aarav", last_name="Test", gender="male", status="active"
    )


@pytest.fixture
def student(school):
    return _student(school, "ADM-LIB-1")


@pytest.fixture
def other_student(other_school):
    return _student(other_school, "ADM-LIB-2")
