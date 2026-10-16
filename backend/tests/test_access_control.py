"""
Tests — Access Control / RBAC
================================
Covers: Role creation, permission assignment, UserRole binding
"""

import pytest


@pytest.mark.model
class TestRoleModel:

    def test_create_role(self, school):
        from apps.access_control.models import Role
        role = Role.objects.create(
            school=school,
            name="Class Teacher",
        )
        assert role.pk is not None
        assert role.name == "Class Teacher"

    def test_role_unique_per_school(self, school):
        from apps.access_control.models import Role
        from django.db import IntegrityError
        Role.objects.create(school=school, name="Duplicate Role")
        with pytest.raises(IntegrityError):
            Role.objects.create(school=school, name="Duplicate Role")

    def test_role_str(self, school):
        from apps.access_control.models import Role
        role = Role.objects.create(school=school, name="Principal")
        assert "Principal" in str(role)


@pytest.mark.model
class TestUserRoleAssignment:

    def test_assign_role_to_user(self, school, teacher_user):
        from apps.access_control.models import Role, UserRole
        role = Role.objects.create(school=school, name="Homeroom Teacher")
        user_role = UserRole.objects.create(
            user=teacher_user,
            role=role,
            school=school,
        )
        assert user_role.pk is not None
        assert user_role.user == teacher_user
        assert user_role.role == role

    def test_user_can_have_multiple_roles(self, school, teacher_user):
        from apps.access_control.models import Role, UserRole
        role1 = Role.objects.create(school=school, name="Subject Teacher")
        role2 = Role.objects.create(school=school, name="Sports Coach")
        UserRole.objects.create(user=teacher_user, role=role1, school=school)
        UserRole.objects.create(user=teacher_user, role=role2, school=school)
        count = UserRole.objects.filter(user=teacher_user).count()
        assert count == 2

    @pytest.mark.smoke
    def test_role_scoped_to_school(self, school, teacher_user):
        """A role created for school A must not appear when querying school B."""
        from apps.access_control.models import Role
        from apps.tenancy.models import School
        Role.objects.create(school=school, name="School A Only Role")
        school_b = School.objects.create(
            name="School B Roles Test",
            code="SROLE",
            email="roles@school.test",
            phone="1100001111",
            address="Roles Address",
            city="Kolkata",
            state="West Bengal",
            country="India",
            pincode="700001",
            is_active=True,
        )
        b_roles = Role.objects.filter(school=school_b)
        assert b_roles.count() == 0


@pytest.mark.api
class TestAccessControlAPI:

    def test_list_roles_requires_auth(self, api_client):
        response = api_client.get("/api/access-control/roles/")
        assert response.status_code in (401, 403)

    def test_admin_can_create_role(self, admin_client, school):
        payload = {
            "name": "API Created Role",
            "description": "Created via API test",
        }
        response = admin_client.post("/api/access-control/roles/", payload, format="json")
        assert response.status_code == 201

    def test_admin_can_list_roles(self, admin_client, school):
        from apps.access_control.models import Role
        Role.objects.create(school=school, name="Listed Role")
        response = admin_client.get("/api/access-control/roles/")
        assert response.status_code == 200

    def test_assign_role_to_user_via_api(self, admin_client, teacher_user, school):
        from apps.access_control.models import Role
        role = Role.objects.create(school=school, name="API Assigned Role")
        payload = {
            "user": teacher_user.pk,
            "role": role.pk,
        }
        response = admin_client.post("/api/access-control/user-roles/", payload, format="json")
        assert response.status_code in (200, 201)
