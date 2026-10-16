"""
Add Driver / Add Attendant only offer (and only accept) HR staff of the same school
who are active in the HR department "Transport" (any letter case) with a fitting
designation - see apps/transport/services/staff_eligibility.py.
"""
from apps.hr.models import Department, Designation, Staff
from apps.transport.models import TransportStaffProfile

CANDIDATES = "/api/v1/core/transport-staff/candidates/"
PROFILES = "/api/v1/core/transport-staff/"


def dept(school, name):
    return Department.objects.get_or_create(school=school, name=name)[0]


def staff(school, no, department=None, designation=None, status=Staff.STATUS_ACTIVE):
    desig = Designation.objects.get_or_create(school=school, department=department, name=designation)[0] if designation else None
    return Staff.objects.create(school=school, staff_no=no, first_name=no, join_date="2024-01-01",
                                department=department, designation=desig, status=status)


def ids(response):
    assert response.status_code == 200, response.data
    return {row["id"] for row in response.data}


def test_every_case_variant_of_transport_is_accepted(admin_client, school, academic_year):
    members = [staff(school, f"T{i}", dept(school, name)) for i, name in enumerate(["Transport", "TRANSPORT", "transport", "TrAnSpOrT", " Transport "])]
    assert ids(admin_client.get(CANDIDATES)) == {m.id for m in members}


def test_teachers_principals_other_departments_and_inactive_staff_are_excluded(admin_client, school, academic_year):
    transport = dept(school, "Transport")
    eligible = staff(school, "OK1", transport)
    staff(school, "TEACH", dept(school, "Teaching"), "Teacher")
    staff(school, "PRIN", dept(school, "Administration"), "Principal")
    staff(school, "NODEPT")  # no department at all
    staff(school, "MGR", transport, "Transport Manager")  # Transport, but neither driver nor attendant
    staff(school, "GONE", transport, status=Staff.STATUS_INACTIVE)
    staff(school, "LEFT", transport, status=Staff.STATUS_TERMINATED)
    assert ids(admin_client.get(CANDIDATES)) == {eligible.id}


def test_driver_and_attendant_lists_follow_the_designation(admin_client, school, academic_year):
    transport = dept(school, "transport")
    driver = staff(school, "DRV", transport, "Bus Driver")
    attendant = staff(school, "ATT", transport, "Bus Attendant")
    either = staff(school, "ANY", transport)  # no designation: eligible for both
    assert ids(admin_client.get(f"{CANDIDATES}?role=driver")) == {driver.id, either.id}
    assert ids(admin_client.get(f"{CANDIDATES}?role=attendant")) == {attendant.id, either.id}
    rows = {r["id"]: r["eligible_roles"] for r in admin_client.get(CANDIDATES).data}
    assert rows == {driver.id: ["driver"], attendant.id: ["attendant"], either.id: ["driver", "attendant"]}
    assert admin_client.get(f"{CANDIDATES}?role=teacher").status_code == 400


def test_staff_from_another_school_are_excluded(admin_client, school, academic_year, other_school):
    staff(other_school, "X1", dept(other_school, "Transport"))
    mine = staff(school, "M1", dept(school, "Transport"))
    assert ids(admin_client.get(CANDIDATES)) == {mine.id}


def test_empty_list_when_no_one_is_eligible(admin_client, school, academic_year):
    staff(school, "TEACH", dept(school, "Teaching"))
    assert admin_client.get(CANDIDATES).data == []


def test_ineligible_staff_cannot_be_submitted_directly(admin_client, school, academic_year, other_school):
    transport = dept(school, "TRANSPORT")
    teacher = staff(school, "TEACH", dept(school, "Teaching"), "Teacher")
    attendant_only = staff(school, "ATT", transport, "Attendant")
    inactive = staff(school, "GONE", transport, status=Staff.STATUS_INACTIVE)
    foreign = staff(other_school, "X1", dept(other_school, "Transport"))
    for member, role in [(teacher, "driver"), (teacher, "attendant"), (attendant_only, "driver"), (inactive, "driver"), (foreign, "driver")]:
        response = admin_client.post(PROFILES, {"staff": member.id, "role": role}, format="json")
        assert response.status_code == 400, (member.staff_no, role, response.data)
    assert not TransportStaffProfile.objects.exists()

    ok = admin_client.post(PROFILES, {"staff": attendant_only.id, "role": "attendant"}, format="json")
    assert ok.status_code == 201, ok.data


def test_role_change_is_checked_but_existing_profiles_stay_editable(admin_client, school, academic_year):
    transport = dept(school, "Transport")
    attendant_only = staff(school, "ATT", transport, "Attendant")
    profile = admin_client.post(PROFILES, {"staff": attendant_only.id, "role": "attendant"}, format="json").data
    assert admin_client.patch(f"{PROFILES}{profile['id']}/", {"role": "driver"}, format="json").status_code == 400

    # A profile created before this rule (staff outside Transport) can still be edited.
    teacher = staff(school, "TEACH", dept(school, "Teaching"), "Teacher")
    legacy = TransportStaffProfile.objects.create(school=school, staff=teacher, role="driver")
    edited = admin_client.patch(f"{PROFILES}{legacy.id}/", {"duty_status": "on_leave"}, format="json")
    assert edited.status_code == 200, edited.data
