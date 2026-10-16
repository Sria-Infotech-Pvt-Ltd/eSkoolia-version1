"""
Which HR staff may become Transport drivers / attendants.

Read-only over the existing HR records (nothing in HR is created or changed):
- same school as the request (never another school's staff);
- active in HR (status "active");
- HR department named "Transport", in any letter case (surrounding spaces ignored);
- the HR designation must fit the role: its name contains "driver" (drivers) or
  "attendant" (attendants). Staff with no designation set are eligible for both,
  so a Transport department without designations still works. Other Transport
  designations (e.g. "Transport Manager") are eligible for neither.
"""
from django.db.models import Q
from django.db.models.functions import Lower, Trim

TRANSPORT_DEPARTMENT = "transport"
ROLE_KEYWORD = {"driver": "driver", "attendant": "attendant"}


def eligible_staff(school_id, role=None):
    """Active Transport-department staff of one school eligible for `role` (or, with no role, for either)."""
    from apps.hr.models import Staff

    if not school_id:
        return Staff.objects.none()
    queryset = (
        Staff.objects.filter(school_id=school_id, status=Staff.STATUS_ACTIVE, department__isnull=False)
        .annotate(_transport_dept=Lower(Trim("department__name")))
        .filter(_transport_dept=TRANSPORT_DEPARTMENT)
    )
    roles = [role] if role is not None else list(ROLE_KEYWORD)
    match = role_filter(roles[0])
    for other in roles[1:]:
        match |= role_filter(other)
    return queryset.filter(match).distinct()


def role_filter(role):
    keyword = ROLE_KEYWORD[role]
    return Q(designation__isnull=True) | Q(designation__name__icontains=keyword)


def eligible_roles(staff):
    """Roles ("driver", "attendant") a Transport-department staff member's designation allows."""
    designation = getattr(getattr(staff, "designation", None), "name", None)
    if not designation:
        return list(ROLE_KEYWORD)
    lowered = designation.lower()
    return [role for role, keyword in ROLE_KEYWORD.items() if keyword in lowered]


def is_eligible(staff, role, school_id):
    return eligible_staff(school_id, role).filter(pk=staff.pk).exists()
