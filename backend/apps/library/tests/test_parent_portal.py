"""Parent portal: Current and Due, and History (prompt 12)."""
from datetime import time, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from apps.access_control.models import Role, UserRole
from apps.core.models import Class, ClassPeriod, Section
from apps.library.models import BookIssue, Charge, LostDamagedReport, PeriodSlot
from apps.library.services.dues import loan_fine
from apps.library.services.members import dues_for_member
from apps.library.services.settings import get_settings
from apps.library.tests.conftest import make_book, make_member
from apps.students.models import Guardian, Student

User = get_user_model()
P = "/api/v1/parent/library/"
CURRENT, HISTORY = f"{P}current/", f"{P}history/"


def today():
    return timezone.localdate()


def parent_of(school, portal="parent", guardian=True):
    user = User.objects.create_user(username=f"pp_{uuid4().hex[:8]}", password="x", school=school)
    role = Role.objects.create(school=school, name=f"{portal}-{uuid4().hex[:6]}", portal_type=portal, is_active=True)
    UserRole.objects.create(user=user, role=role)
    profile = Guardian.objects.create(school=school, full_name="Parent One", relation="Mother", phone="9990001111", user=user) if guardian else None
    return user, profile


def client(user):
    api = APIClient()
    api.force_authenticate(user=user)
    return api


def child(school, guardian, cls, section, n=1, status="active"):
    return Student.objects.create(
        school=school, admission_no=f"PP-{n}-{uuid4().hex[:4]}", first_name=f"Child{n}", last_name="Test", gender="male", status=status,
        current_class=cls, current_section=section, guardian=guardian,
    )


def registered(school, student, card="PC-1"):
    return make_member(school, card, member_type="student", student=student)


def loan(school, book, member, due_in=-3, copy=None, status="issued", **extra):
    extra.setdefault("issue_date", today() - timedelta(days=20))
    return BookIssue.objects.create(
        school=school, book=book, copy=copy or book.copies.first(), member=member,
        due_date=today() + timedelta(days=due_in), status=status, **extra,
    )


def lend(loan_obj):
    loan_obj.copy.status = "issued"
    loan_obj.copy.save()
    return loan_obj


@pytest.fixture
def family(school):
    grade = Class.objects.create(school=school, name="Grade 4")
    section = Section.objects.create(school_class=grade, name="A")
    user, guardian = parent_of(school)
    kid = child(school, guardian, grade, section)
    return type("Family", (), dict(grade=grade, section=section, user=user, guardian=guardian, kid=kid, api=client(user)))


def current(family, kid=None):
    return family.api.get(CURRENT, {"child_id": (kid or family.kid).pk})


# ---- who may come in ---------------------------------------------------------------------------------------------------

URLS = [CURRENT, HISTORY]


@pytest.mark.parametrize("url", URLS)
def test_unauthenticated_is_refused(url):
    assert APIClient().get(url).status_code in (401, 403)


@pytest.mark.parametrize("url", URLS)
def test_a_user_of_another_portal_gets_403(school, family, url):
    teacher, _ = parent_of(school, portal="teacher")
    assert client(teacher).get(url, {"child_id": family.kid.pk}).status_code == 403


@pytest.mark.parametrize("url", URLS)
def test_a_school_admin_without_a_parent_role_gets_403(admin_user, family, url):
    assert client(admin_user).get(url, {"child_id": family.kid.pk}).status_code == 403


@pytest.mark.parametrize("url", URLS)
def test_a_superuser_gets_403_even_with_a_parent_role(school, family, url):
    root, _ = parent_of(school)
    root.is_superuser = True
    root.save()
    assert client(root).get(url, {"child_id": family.kid.pk}).status_code == 403


@pytest.mark.parametrize("url", URLS)
def test_a_parent_role_without_a_guardian_profile_gets_403(school, family, url):
    ghost, _ = parent_of(school, guardian=False)
    assert client(ghost).get(url, {"child_id": family.kid.pk}).status_code == 403


# ---- which child -------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("url", URLS)
def test_no_child_id_is_a_400(family, url):
    assert family.api.get(url).status_code == 400


@pytest.mark.parametrize("url", URLS)
def test_another_guardians_child_is_a_404(school, family, url):
    _other_user, other_guardian = parent_of(school)
    stranger = child(school, other_guardian, family.grade, family.section, n=2)
    assert family.api.get(url, {"child_id": stranger.pk}).status_code == 404


@pytest.mark.parametrize("url", URLS)
def test_an_inactive_child_is_a_404(school, family, url):
    gone = child(school, family.guardian, family.grade, family.section, n=3, status="inactive")
    assert family.api.get(url, {"child_id": gone.pk}).status_code == 404


@pytest.mark.parametrize("url", URLS)
def test_an_unknown_or_malformed_child_id_is_a_404(family, url):
    assert family.api.get(url, {"child_id": 999999}).status_code == 404
    assert family.api.get(url, {"child_id": "abc"}).status_code == 404


def test_a_child_of_another_school_is_a_404(school, other_school, family):
    foreign_grade = Class.objects.create(school=other_school, name="Grade 4")
    _u, foreign_guardian = parent_of(other_school)
    foreign_kid = child(other_school, foreign_guardian, foreign_grade, None)
    assert family.api.get(CURRENT, {"child_id": foreign_kid.pk}).status_code == 404


# ---- current -----------------------------------------------------------------------------------------------------------


def test_an_unregistered_child_gets_an_explicit_response_not_an_error(family):
    resp = current(family)
    assert resp.status_code == 200
    data = resp.json()
    assert data["registered"] is False and data["loans"] == [] and data["loan_limit"] is None and data["suspended"] is False
    assert data["next_slot"] is None and data["registration"]["status"] is None


def test_an_unregistered_child_still_sees_the_class_library_period(school, family):
    period = ClassPeriod.objects.create(school=school, period="Period 3", start_time=time(10, 0), end_time=time(10, 40))
    PeriodSlot.objects.create(school=school, school_class=family.grade, section=None, day="Mon", period=period)
    slot = current(family).json()["next_slot"]
    assert slot is not None and slot["period_name"] == "Period 3" and slot["start_time"] == "10:00"


def test_current_lists_open_loans_with_overdue_state_and_fine(school, category, family):
    member = registered(school, family.kid)
    book = make_book(school, category, title="Atlas", copies=4, cost_per_copy=Decimal("200.00"))
    copies = list(book.copies.all())
    late = lend(loan(school, book, member, due_in=-4, copy=copies[0]))
    fine_ok = lend(loan(school, book, member, due_in=6, copy=copies[1]))
    loan(school, book, member, copy=copies[2], status="returned", return_date=today())
    data = current(family).json()
    settings = get_settings(school)
    assert data["registered"] is True and data["open_loans"] == 2 and data["card_no"] == "PC-1"
    rows = {r["id"]: r for r in data["loans"]}
    assert set(rows) == {late.pk, fine_ok.pk}
    assert rows[late.pk]["overdue"] is True and rows[late.pk]["days_overdue"] == 4 and rows[late.pk]["state"] == "overdue"
    assert Decimal(rows[late.pk]["accrued_fine"]) == loan_fine(late.due_date, today(), Decimal("200.00"), settings)
    assert Decimal(rows[late.pk]["accrued_fine"]) > 0
    assert rows[fine_ok.pk]["overdue"] is False and rows[fine_ok.pk]["accrued_fine"] == "0.00" and rows[fine_ok.pk]["state"] == "open"
    assert rows[late.pk]["book_title"] == "Atlas" and rows[late.pk]["copy_code"]


def test_limits_fines_and_suspension_match_the_dues_service(school, category, family):
    member = registered(school, family.kid)
    settings = get_settings(school)
    book = make_book(school, category, copies=4, cost_per_copy=Decimal("150.00"))
    lend(loan(school, book, member, due_in=-6, copy=book.copies.first()))
    Charge.objects.create(school=school, member=member, charge_type="overdue_fine", amount="25.00", status="pending", assessed_on=today())
    data = current(family).json()
    dues = dues_for_member(school, member, settings, today())
    assert data["loan_limit"] == settings.limit_student
    assert Decimal(data["fines"]["total"]) == dues.overdue_fines > Decimal("25.00")
    assert data["suspended"] is dues.suspended is True
    assert Decimal(data["total_due"]) == dues.total


def test_pending_replacement_fees_are_listed_and_paid_ones_are_not(school, category, family):
    member = registered(school, family.kid)
    book = make_book(school, category, title="Lost Atlas", copies=3)
    copies = list(book.copies.all())
    for index, status in enumerate(("pending", "paid")):
        report = LostDamagedReport.objects.create(
            school=school, book=book, copy=copies[index], member=member, report_type="lost", reported_on=today(), replacement_cost="200.00",
        )
        Charge.objects.create(school=school, member=member, charge_type="replacement", amount="200.00", status=status, report=report, assessed_on=today())
    data = current(family).json()
    assert data["replacement_fees"]["total"] == "200.00" and data["suspended"] is True
    assert [i["book_title"] for i in data["replacement_fees"]["items"]] == ["Lost Atlas"]
    assert data["replacement_fees"]["items"][0]["amount"] == "200.00"


@pytest.mark.parametrize("state,expected", [("pending", "unpaid"), ("paid", "paid"), (None, "waived")])
def test_registration_fee_status(school, family, state, expected):
    member = registered(school, family.kid)
    if state:
        Charge.objects.create(school=school, member=member, charge_type="registration", amount="300.00", status=state, assessed_on=today())
        member.registration_fee_amount = Decimal("300.00")
        member.save()
    data = current(family).json()
    assert data["registration"]["status"] == expected
    assert data["suspended"] is False  # an unpaid registration fee never suspends borrowing (D6)
    if expected == "unpaid":
        assert Decimal(data["total_due"]) == Decimal("300.00")


def test_current_never_shows_another_childs_or_another_schools_loans(school, other_school, other_category, category, family):
    member = registered(school, family.kid)
    sibling = child(school, family.guardian, family.grade, family.section, n=2)
    sibling_member = registered(school, sibling, "PC-2")
    book = make_book(school, category, copies=4)
    copies = list(book.copies.all())
    mine = lend(loan(school, book, member, copy=copies[0]))
    lend(loan(school, book, sibling_member, copy=copies[1]))
    foreign_book = make_book(other_school, other_category, copies=2)
    lend(loan(other_school, foreign_book, make_member(other_school, "FC-1", member_type="teacher")))
    assert [r["id"] for r in current(family).json()["loans"]] == [mine.pk]
    assert [r["id"] for r in current(family, sibling).json()["loans"]] != [mine.pk]


def test_current_query_count_is_fixed_whatever_the_number_of_loans(school, category, family, django_assert_max_num_queries):
    member = registered(school, family.kid)
    book = make_book(school, category, copies=40)
    current(family)
    with django_assert_max_num_queries(22):
        current(family)
    for copy in list(book.copies.all())[:25]:
        lend(loan(school, book, member, due_in=-2, copy=copy))
    with django_assert_max_num_queries(22):
        data = current(family).json()
    assert data["open_loans"] == 25


# ---- history -----------------------------------------------------------------------------------------------------------


def test_history_is_closed_loans_newest_first_and_hides_open_ones(school, category, family):
    member = registered(school, family.kid)
    book = make_book(school, category, title="Old", copies=6)
    copies = list(book.copies.all())
    older = loan(school, book, member, copy=copies[0], status="returned", return_date=today() - timedelta(days=10))
    newer = loan(school, book, member, copy=copies[1], status="returned", return_date=today() - timedelta(days=2))
    lost = loan(school, book, member, copy=copies[2], status="lost")
    lend(loan(school, book, member, copy=copies[3]))
    data = family.api.get(HISTORY, {"child_id": family.kid.pk}).json()
    ids = [r["id"] for r in data["results"]]
    assert data["count"] == 3 and set(ids) == {older.pk, newer.pk, lost.pk}
    assert ids.index(newer.pk) < ids.index(older.pk)
    row = next(r for r in data["results"] if r["id"] == lost.pk)
    assert row["state"] == "lost" and row["return_date"] is None
    # Both are due 3 days ago: returned 10 days ago is on time, returned 2 days ago is late.
    assert next(r for r in data["results"] if r["id"] == older.pk)["returned_late"] is False
    assert next(r for r in data["results"] if r["id"] == newer.pk)["returned_late"] is True


def test_history_is_paginated_by_twenty_and_the_client_cannot_change_it(school, category, family):
    member = registered(school, family.kid)
    book = make_book(school, category, copies=50)
    for index, copy in enumerate(list(book.copies.all())[:45]):
        loan(school, book, member, copy=copy, status="returned", issue_date=today() - timedelta(days=100), due_in=-60, return_date=today() - timedelta(days=index))
    first = family.api.get(HISTORY, {"child_id": family.kid.pk, "page_size": 500}).json()
    assert first["count"] == 45 and len(first["results"]) == 20 and first["previous"] is None and "child_id=" in first["next"]
    third = family.api.get(HISTORY, {"child_id": family.kid.pk, "page": 3}).json()
    assert len(third["results"]) == 5 and third["next"] is None
    assert family.api.get(HISTORY, {"child_id": family.kid.pk, "page": 9}).status_code == 404
    pages = [family.api.get(HISTORY, {"child_id": family.kid.pk, "page": n}).json()["results"] for n in (1, 2, 3)]
    ids = [row["id"] for page in pages for row in page]
    assert len(ids) == len(set(ids)) == 45


def test_history_for_an_unregistered_child_is_an_empty_page(family):
    data = family.api.get(HISTORY, {"child_id": family.kid.pk}).json()
    assert data["count"] == 0 and data["results"] == [] and data["next"] is None


def test_history_never_shows_other_children_or_schools(school, other_school, other_category, category, family):
    member = registered(school, family.kid)
    sibling = child(school, family.guardian, family.grade, family.section, n=2)
    sibling_member = registered(school, sibling, "PC-2")
    book = make_book(school, category, copies=4)
    copies = list(book.copies.all())
    mine = loan(school, book, member, copy=copies[0], status="returned", return_date=today())
    loan(school, book, sibling_member, copy=copies[1], status="returned", return_date=today())
    foreign_book = make_book(other_school, other_category, copies=2)
    loan(other_school, foreign_book, make_member(other_school, "FC-2", member_type="teacher"), status="returned", return_date=today())
    data = family.api.get(HISTORY, {"child_id": family.kid.pk}).json()
    assert [r["id"] for r in data["results"]] == [mine.pk]


def test_the_endpoints_are_read_only(family):
    for url in URLS:
        assert family.api.post(url, {"child_id": family.kid.pk}, format="json").status_code == 405
        assert family.api.delete(f"{url}?child_id={family.kid.pk}").status_code == 405
