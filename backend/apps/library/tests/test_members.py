"""Members, registration, dues, candidates, the issue-desk roster and the charges ledger."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.library.models import BookIssue, Charge, LibraryActivityLog, LibraryMember
from apps.library.services.settings import get_settings
from apps.library.tests.conftest import (
    _student,
    client_for,
    make_book,
    make_member,
    make_staff,
    make_user,
)

BASE = "/api/v1/library"
MEMBERS = f"{BASE}/members/"


def ago(days):
    return timezone.localdate() - timedelta(days=days)


def overdue_loan(school, book, member, days_late=3):
    return BookIssue.objects.create(
        school=school, book=book, member=member, issue_date=ago(days_late + 10), due_date=ago(days_late)
    )


def teacher_staff(school):
    """Staff whose user holds an active teacher-portal role (D11)."""
    from django.contrib.auth import get_user_model

    from apps.access_control.models import Role, UserRole

    user = get_user_model().objects.create_user(username=f"t_{timezone.now().timestamp()}", password="x", school=school)
    role = Role.objects.create(school=school, name=f"tch_{user.pk}", portal_type="teacher")
    UserRole.objects.create(user=user, role=role)
    return make_staff(school, user=user)


def register(client, **body):
    return client.post(MEMBERS, body, format="json")


# ---- registration and fees -----------------------------------------------------------


def test_junior_class_student_gets_the_junior_fee_and_others_the_senior_fee(librarian_client, school):
    from apps.core.models import Class

    junior = Class.objects.create(school=school, name="Grade 2")
    senior = Class.objects.create(school=school, name="Grade 9")
    a = _student(school, "J1")
    a.current_class = junior
    a.save()
    b = _student(school, "S1")
    b.current_class = senior
    b.save()
    c = _student(school, "N1")  # no class at all: not in the junior list
    first = register(librarian_client, student=a.pk).json()["data"]
    second = register(librarian_client, student=b.pk).json()["data"]
    third = register(librarian_client, student=c.pk).json()["data"]
    assert (first["registration_fee_amount"], second["registration_fee_amount"], third["registration_fee_amount"]) == ("300.00", "500.00", "500.00")
    assert first["member_type"] == "student"


def test_junior_fee_follows_the_stored_class_list_not_the_class_name(librarian_client, school):
    from apps.core.models import Class

    klass = Class.objects.create(school=school, name="Grade 9")
    settings = get_settings(school)
    settings.junior_class_ids = [klass.pk]
    settings.registration_fee_junior = Decimal("120")
    settings.save()
    student = _student(school, "X1")
    student.current_class = klass
    student.save()
    assert register(librarian_client, student=student.pk).json()["data"]["registration_fee_amount"] == "120.00"


def test_staff_type_is_inferred_from_the_teacher_portal_role_d11(librarian_client, school):
    teacher = teacher_staff(school)
    plain = make_staff(school)
    t = register(librarian_client, staff=teacher.pk).json()["data"]
    s = register(librarian_client, staff=plain.pk).json()["data"]
    assert (t["member_type"], s["member_type"]) == ("teacher", "staff")
    assert (t["registration_fee_amount"], s["registration_fee_amount"]) == ("0.00", "0.00")


def test_librarian_can_override_the_inferred_type(librarian_client, school):
    teacher = teacher_staff(school)
    resp = register(librarian_client, staff=teacher.pk, member_type="staff")
    assert resp.json()["data"]["member_type"] == "staff"


def test_inactive_role_does_not_make_a_teacher(librarian_client, school):
    from apps.access_control.models import Role

    staff = teacher_staff(school)
    Role.objects.filter(user_roles__user=staff.user).update(is_active=False)
    assert register(librarian_client, staff=staff.pk).json()["data"]["member_type"] == "staff"


def test_type_must_match_the_person(librarian_client, school, student):
    staff = make_staff(school)
    assert register(librarian_client, student=student.pk, member_type="teacher").status_code == 400
    assert register(librarian_client, staff=staff.pk, member_type="student").status_code == 400


def test_exactly_one_person_is_required(librarian_client, school, student):
    staff = make_staff(school)
    assert register(librarian_client, student=student.pk, staff=staff.pk).status_code == 400
    both_missing = register(librarian_client, member_type="staff")
    assert both_missing.status_code == 400 and "student" in both_missing.json()["field_errors"]


def test_registration_charge_pending_waived_or_paid(librarian_client, school, student):
    other = _student(school, "W1")
    zero = _student(school, "Z1")
    pending = register(librarian_client, student=student.pk).json()["data"]
    assert (pending["registration_status"], pending["total_dues"], pending["standing"]) == ("unpaid", "500.00", "active")
    waived = register(librarian_client, student=other.pk, registration_fee_amount="0").json()["data"]
    assert (waived["registration_status"], waived["total_dues"]) == ("waived", "0.00")
    paid = register(librarian_client, student=zero.pk, registration_fee_amount="250.50", collect_fee_now=True).json()["data"]
    assert (paid["registration_status"], paid["total_dues"], paid["registration_fee_amount"]) == ("paid", "0.00", "250.50")
    charge = Charge.objects.get(member_id=paid["id"])
    assert charge.status == "paid" and charge.receipt_no.startswith("LIBR-") and charge.resolved_by_id
    assert Charge.objects.get(member_id=waived["id"]).status == "waived"
    assert Charge.objects.get(member_id=pending["id"]).receipt_no == ""


def test_collecting_at_registration_needs_the_collect_code(school, student):
    creator = client_for(make_user(school, ["library.library_members.create"]))
    resp = register(creator, student=student.pk, collect_fee_now=True)
    assert resp.status_code == 403
    assert not LibraryMember.objects.exists()
    assert register(creator, student=student.pk).status_code == 201


def test_card_numbers_are_generated_and_unique(librarian_client, school, student):
    other = _student(school, "C2")
    a = register(librarian_client, student=student.pk).json()["data"]
    b = register(librarian_client, student=other.pk).json()["data"]
    assert a["card_no"].startswith("LM-") and a["card_no"] != b["card_no"]
    third = _student(school, "C3")
    assert register(librarian_client, student=third.pk, card_no=a["card_no"]).status_code == 400
    assert register(librarian_client, student=third.pk, card_no="MY-CARD").json()["data"]["card_no"] == "MY-CARD"


def test_one_membership_per_person(librarian_client, school, student):
    staff = make_staff(school)
    assert register(librarian_client, student=student.pk).status_code == 201
    again = register(librarian_client, student=student.pk)
    assert again.status_code == 400 and "student" in again.json()["field_errors"]
    assert register(librarian_client, staff=staff.pk).status_code == 201
    assert "staff" in register(librarian_client, staff=staff.pk).json()["field_errors"]
    assert LibraryMember.objects.count() == 2


def test_cross_school_and_inactive_people_are_invalid_choices(librarian_client, other_student, school):
    from apps.hr.models import Staff

    other_staff = make_staff(school.__class__.objects.exclude(pk=school.pk).get())
    resp = register(librarian_client, student=other_student.pk)
    assert resp.status_code == 400 and "student" in resp.json()["field_errors"]
    resp = register(librarian_client, staff=other_staff.pk)
    assert resp.status_code == 400 and "staff" in resp.json()["field_errors"]
    quitter = _student(school, "Q1")
    quitter.status = "dropped"
    quitter.save()
    assert "student" in register(librarian_client, student=quitter.pk).json()["field_errors"]
    gone = make_staff(school, status=Staff.STATUS_TERMINATED)
    assert "staff" in register(librarian_client, staff=gone.pk).json()["field_errors"]


def test_registration_writes_an_activity_row(librarian_client, librarian, student):
    register(librarian_client, student=student.pk)
    row = LibraryActivityLog.objects.get(school=librarian.school, event_type="member")
    assert row.actor_id == librarian.pk and row.member_id and "Aarav" in row.summary
    assert row.metadata["fee_status"] == "pending" and "phone" not in row.summary.lower()


# ---- database constraints -------------------------------------------------------------


def test_database_rejects_a_student_member_without_a_student(school):
    with pytest.raises(IntegrityError), transaction.atomic():
        LibraryMember.objects.create(school=school, member_type="student", card_no="X")


def test_database_rejects_both_person_links_and_a_mismatched_type(school, student):
    staff = make_staff(school)
    with pytest.raises(IntegrityError), transaction.atomic():
        LibraryMember.objects.create(school=school, member_type="student", card_no="A", student=student, staff=staff)
    with pytest.raises(IntegrityError), transaction.atomic():
        LibraryMember.objects.create(school=school, member_type="teacher", card_no="B", student=student)
    with pytest.raises(IntegrityError), transaction.atomic():
        LibraryMember.objects.create(school=school, member_type="staff", card_no="C", staff=staff, student=student)


def test_database_allows_one_membership_per_person_only(school, student):
    LibraryMember.objects.create(school=school, member_type="student", card_no="A", student=student)
    with pytest.raises(IntegrityError), transaction.atomic():
        LibraryMember.objects.create(school=school, member_type="student", card_no="B", student=student)
    staff = make_staff(school)
    LibraryMember.objects.create(school=school, member_type="teacher", card_no="C", staff=staff)
    with pytest.raises(IntegrityError), transaction.atomic():
        LibraryMember.objects.create(school=school, member_type="staff", card_no="D", staff=staff)


def test_database_rejects_a_negative_registration_fee(school):
    with pytest.raises(IntegrityError), transaction.atomic():
        make_member(school, "N", registration_fee_amount=Decimal("-1"))


def test_integrity_check_helper_reports_nothing_on_clean_data(school, member):
    from apps.library.services.backfill import find_member_integrity_problems

    assert find_member_integrity_problems(LibraryMember) == {"duplicate_students": [], "duplicate_staff": [], "type_mismatch": []}


# ---- list, dues, standing ---------------------------------------------------------------


def test_list_row_shape_and_filters(librarian_client, school, student):
    from apps.core.models import Class, Section

    klass = Class.objects.create(school=school, name="Grade 5")
    section = Section.objects.create(school_class=klass, name="A", capacity=40)
    student.current_class, student.current_section = klass, section
    student.save()
    s = register(librarian_client, student=student.pk).json()["data"]
    t = register(librarian_client, staff=teacher_staff(school).pk).json()["data"]
    rows = librarian_client.get(MEMBERS).json()["results"]
    assert {"id", "display_name", "member_type", "school_class", "section", "card_no", "active_loans", "borrowing_limit",
            "registration_status", "total_dues", "standing"} <= set(rows[0])
    by_id = {r["id"]: r for r in rows}
    assert by_id[s["id"]]["school_class"] == "Grade 5" and by_id[s["id"]]["section"] == "A"
    assert (by_id[s["id"]]["borrowing_limit"], by_id[t["id"]]["borrowing_limit"]) == (2, 5)

    def ids(query):
        return {r["id"] for r in librarian_client.get(f"{MEMBERS}?{query}").json()["results"]}

    assert ids("member_type=teacher") == {t["id"]} and ids("member_type=student") == {s["id"]}
    assert ids(f"school_class={klass.pk}") == {s["id"]} and ids(f"section={section.pk}") == {s["id"]}
    assert ids("registration=unpaid") == {s["id"]} and ids("registration=waived") == {t["id"]}
    assert ids("search=aarav") == {s["id"]} and ids(f"search={t['card_no']}") == {t["id"]}
    assert ids("is_active=false") == set()
    assert librarian_client.get(f"{MEMBERS}?registration=maybe").status_code == 400
    assert librarian_client.get(f"{MEMBERS}?standing=maybe").status_code == 400


def test_overdue_loan_accrues_a_fine_and_suspends(librarian_client, school, category, book, student):
    member = register(librarian_client, student=student.pk, registration_fee_amount="0").json()["data"]
    row = LibraryMember.objects.get(pk=member["id"])
    overdue_loan(school, book, row, days_late=3)  # 3 days x 10 = 30
    data = {r["id"]: r for r in librarian_client.get(MEMBERS).json()["results"]}[row.pk]
    assert (data["standing"], data["total_dues"], data["active_loans"]) == ("suspended", "30.00", 1)


def test_fine_is_capped_at_replacement_cost_and_respects_grace(librarian_client, school, book, student):
    row = LibraryMember.objects.get(pk=register(librarian_client, student=student.pk, registration_fee_amount="0").json()["data"]["id"])
    overdue_loan(school, book, row, days_late=60)  # 600, capped at the 150 default replacement
    assert librarian_client.get(f"{MEMBERS}{row.pk}/dues/").json()["data"]["overdue_fines"] == "150.00"
    settings = get_settings(school)
    settings.cap_fine_at_replacement_cost = False
    settings.save()
    assert librarian_client.get(f"{MEMBERS}{row.pk}/dues/").json()["data"]["overdue_fines"] == "600.00"
    settings.fine_grace_days, settings.fine_cap = 5, Decimal("100")
    settings.save()
    assert librarian_client.get(f"{MEMBERS}{row.pk}/dues/").json()["data"]["overdue_fines"] == "100.00"


def test_due_today_and_future_loans_do_not_fine_or_suspend(librarian_client, school, book, student):
    row = LibraryMember.objects.get(pk=register(librarian_client, student=student.pk, registration_fee_amount="0").json()["data"]["id"])
    BookIssue.objects.create(school=school, book=book, member=row, issue_date=ago(5), due_date=timezone.localdate())
    data = librarian_client.get(f"{MEMBERS}{row.pk}/dues/").json()["data"]
    assert data["total"] == "0.00" and data["suspended"] is False


def test_unpaid_registration_alone_does_not_suspend(librarian_client, student):
    member = register(librarian_client, student=student.pk).json()["data"]
    dues = librarian_client.get(f"{MEMBERS}{member['id']}/dues/").json()["data"]
    assert dues["registration_due"] == "500.00" and dues["total"] == "500.00" and dues["suspended"] is False
    assert member["standing"] == "active"
    assert dues["pending_charges"] == [{"id": Charge.objects.get().pk, "charge_type": "registration", "amount": "500.00"}]


def test_pending_replacement_fee_suspends_and_standing_filter_finds_it(librarian_client, school, student):
    other = _student(school, "OK1")
    bad = LibraryMember.objects.get(pk=register(librarian_client, student=student.pk).json()["data"]["id"])
    good = LibraryMember.objects.get(pk=register(librarian_client, student=other.pk).json()["data"]["id"])
    Charge.objects.create(school=school, member=bad, charge_type="replacement", amount=Decimal("250"), assessed_on=ago(1))
    suspended = {r["id"] for r in librarian_client.get(f"{MEMBERS}?standing=suspended").json()["results"]}
    active = {r["id"] for r in librarian_client.get(f"{MEMBERS}?standing=active").json()["results"]}
    assert suspended == {bad.pk} and active == {good.pk}
    assert librarian_client.get(f"{MEMBERS}{bad.pk}/dues/").json()["data"]["replacement_fees"] == "250.00"


def test_paid_and_waived_charges_stop_counting(librarian_client, school, student):
    bad = LibraryMember.objects.get(pk=register(librarian_client, student=student.pk, registration_fee_amount="0").json()["data"]["id"])
    for status in ("paid", "waived", "written_off"):
        Charge.objects.create(school=school, member=bad, charge_type="replacement", amount=Decimal("99"), status=status, assessed_on=ago(1))
    assert librarian_client.get(f"{MEMBERS}{bad.pk}/dues/").json()["data"]["suspended"] is False


def test_detail_lists_open_loans_with_accrued_fine(librarian_client, school, book, student):
    row = LibraryMember.objects.get(pk=register(librarian_client, student=student.pk).json()["data"]["id"])
    overdue_loan(school, book, row, days_late=2)
    data = librarian_client.get(f"{MEMBERS}{row.pk}/").json()["data"]
    assert data["open_loans"][0]["title"] == "Treasure Island"
    assert (data["open_loans"][0]["days_overdue"], data["open_loans"][0]["accrued_fine"]) == (2, "20.00")
    assert data["dues"]["total"] == "520.00" and data["dues"]["suspended"] is True


def test_members_list_query_count_is_bounded(librarian_client, school, category, django_assert_max_num_queries):
    book = make_book(school, category, title="Shared", copies=3)
    for number in range(30):
        member = make_member(school, f"B{number}", member_type="student")
        Charge.objects.create(school=school, member=member, charge_type="registration", amount=Decimal("300"), assessed_on=ago(1))
        if number % 3 == 0:
            overdue_loan(school, book, member, days_late=number + 1)
    librarian_client.get(MEMBERS)  # creates the settings row
    with django_assert_max_num_queries(10):
        resp = librarian_client.get(f"{MEMBERS}?page_size=50&search=")
    assert resp.json()["count"] == 30 and len(resp.json()["results"]) == 30
    with django_assert_max_num_queries(12):
        assert librarian_client.get(f"{MEMBERS}?standing=suspended&page_size=50").json()["count"] == 10


# ---- patch and delete ----------------------------------------------------------------------


def test_patch_card_active_and_type_switch(librarian_client, school):
    staff_member = make_member(school, "OLD", member_type="staff")
    resp = librarian_client.patch(f"{MEMBERS}{staff_member.pk}/", {"card_no": "NEW-1", "is_active": False, "member_type": "teacher"}, format="json")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert (data["card_no"], data["is_active"], data["member_type"]) == ("NEW-1", False, "teacher")
    staff_member.refresh_from_db()
    assert staff_member.updated_by_id


def test_patch_rejects_duplicate_card_blank_card_and_student_type_change(librarian_client, school):
    a = make_member(school, "A1")
    make_member(school, "A2")
    student_member = make_member(school, "S1", member_type="student")
    assert "card_no" in librarian_client.patch(f"{MEMBERS}{a.pk}/", {"card_no": "A2"}, format="json").json()["field_errors"]
    assert librarian_client.patch(f"{MEMBERS}{a.pk}/", {"card_no": " "}, format="json").status_code == 400
    assert librarian_client.patch(f"{MEMBERS}{student_member.pk}/", {"member_type": "staff"}, format="json").status_code == 400
    assert librarian_client.patch(f"{MEMBERS}{a.pk}/", {"member_type": "student"}, format="json").status_code == 400


def test_patch_cannot_touch_money_or_the_person(librarian_client, school, student):
    member = make_member(school, "M1")
    librarian_client.patch(f"{MEMBERS}{member.pk}/", {"registration_fee_amount": "999", "student": student.pk, "staff": None}, format="json")
    member.refresh_from_db()
    assert member.registration_fee_amount == 0 and member.student_id is None and member.staff_id


def test_delete_refused_with_loans_or_charges_allowed_when_clean(librarian_client, school, book):
    clean = make_member(school, "CLEAN")
    with_charge = make_member(school, "CH")
    Charge.objects.create(school=school, member=with_charge, charge_type="registration", amount=Decimal("0"), status="waived", assessed_on=ago(1))
    with_loan = make_member(school, "LN")
    overdue_loan(school, book, with_loan, 1)
    for member in (with_charge, with_loan):
        resp = librarian_client.delete(f"{MEMBERS}{member.pk}/")
        assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_has_history"
    assert librarian_client.delete(f"{MEMBERS}{clean.pk}/").status_code == 204
    assert not LibraryMember.objects.filter(pk=clean.pk).exists()


# ---- candidates -------------------------------------------------------------------------------


def test_candidates_are_non_members_of_this_school_with_limited_fields(librarian_client, school, student, other_student):
    member_student = _student(school, "MEM1")
    LibraryMember.objects.create(school=school, member_type="student", card_no="MEM", student=member_student)
    rows = librarian_client.get(f"{MEMBERS}candidates/?type=student").json()["results"]
    assert [r["identifier"] for r in rows] == ["ADM-LIB-1"]
    assert set(rows[0]) == {"id", "member_type", "name", "identifier", "school_class", "section", "suggested_fee"}
    assert rows[0]["suggested_fee"] == "500.00"
    assert librarian_client.get(f"{MEMBERS}candidates/?type=student&q=zzz").json()["results"] == []
    assert [r["identifier"] for r in librarian_client.get(f"{MEMBERS}candidates/?type=student&q=lib-1").json()["results"]] == ["ADM-LIB-1"]


def test_candidates_split_teachers_from_other_staff_and_skip_inactive(librarian_client, school):
    from apps.hr.models import Staff

    teacher = teacher_staff(school)
    plain = make_staff(school, first_name="Bina")
    make_staff(school, first_name="Gone", status=Staff.STATUS_INACTIVE)
    teachers = librarian_client.get(f"{MEMBERS}candidates/?type=teacher").json()["results"]
    others = librarian_client.get(f"{MEMBERS}candidates/?type=staff").json()["results"]
    assert [r["id"] for r in teachers] == [teacher.pk] and [r["id"] for r in others] == [plain.pk]


def test_candidates_validate_type_and_limit(librarian_client, school):
    assert librarian_client.get(f"{MEMBERS}candidates/").status_code == 400
    assert librarian_client.get(f"{MEMBERS}candidates/?type=alien").status_code == 400
    for number in range(25):
        _student(school, f"L{number}")
    assert len(librarian_client.get(f"{MEMBERS}candidates/?type=student&limit=100").json()["results"]) == 20


def test_candidates_need_the_create_code(school, student):
    assert client_for(make_user(school, ["library.library_members.view"])).get(f"{MEMBERS}candidates/?type=student").status_code == 403
    assert client_for(make_user(school, ["library.library_members.create"])).get(f"{MEMBERS}candidates/?type=student").status_code == 200


# ---- eligible roster ---------------------------------------------------------------------------


def test_eligible_roster_reasons(librarian_client, school, category):
    from apps.core.models import Class

    klass = Class.objects.create(school=school, name="Grade 6")
    book = make_book(school, category, title="Open", copies=5, for_students=True, for_teachers=False, for_staff=False)
    people = {}
    for name in ("ok", "suspended", "limit", "holding"):
        student = _student(school, f"E-{name}")
        student.current_class = klass
        student.first_name = name.title()
        student.save()
        people[name] = LibraryMember.objects.create(school=school, member_type="student", card_no=f"E-{name}", student=student)
    inactive = _student(school, "E-off")
    inactive.current_class = klass
    inactive.save()
    LibraryMember.objects.create(school=school, member_type="student", card_no="E-off", student=inactive, is_active=False)
    other_book = make_book(school, category, title="Other", copies=3)
    Charge.objects.create(school=school, member=people["suspended"], charge_type="replacement", amount=Decimal("100"), assessed_on=ago(1))
    for _ in range(2):
        BookIssue.objects.create(school=school, book=other_book, member=people["limit"], issue_date=ago(1), due_date=ago(-9))
    BookIssue.objects.create(school=school, book=book, member=people["holding"], issue_date=ago(1), due_date=ago(-9))
    data = librarian_client.get(f"{MEMBERS}eligible/?school_class={klass.pk}&book={book.pk}").json()["results"]
    reasons = {r["card_no"]: (r["eligible"], r["reason"]) for r in data}
    assert reasons == {
        "E-ok": (True, "ok"), "E-suspended": (False, "suspended"),
        "E-limit": (False, "limit_reached"), "E-holding": (False, "already_holding"),
    }
    assert {"display_name", "member_type", "school_class", "active_loans", "borrowing_limit", "standing"} <= set(data[0])


def test_eligible_checks_audience_and_reference_only(librarian_client, school, category):
    teacher = make_member(school, "T1", member_type="teacher")
    students_only = make_book(school, category, title="Kids", for_students=True, for_teachers=False, for_staff=False)
    ref = make_book(school, category, title="Atlas", is_reference_only=True)
    def reason(book):
        rows = librarian_client.get(f"{MEMBERS}eligible/?member_type=teacher&book={book.pk}").json()["results"]
        return {r["card_no"]: r["reason"] for r in rows}["T1"]
    assert reason(students_only) == "not_eligible_audience" and reason(ref) == "reference_only"
    rows = librarian_client.get(f"{MEMBERS}eligible/?member_type=teacher").json()["results"]
    assert rows[0]["eligible"] is True and teacher.pk == rows[0]["id"]


def test_eligible_needs_a_filter_and_a_valid_book_and_stays_in_school(librarian_client, other_book, school):
    assert librarian_client.get(f"{MEMBERS}eligible/").status_code == 400
    assert librarian_client.get(f"{MEMBERS}eligible/?member_type=staff&book={other_book.pk}").status_code == 400
    assert librarian_client.get(f"{MEMBERS}eligible/?member_type=alien").status_code == 400


def test_eligible_roster_uses_the_issue_view_code(school, member):
    assert client_for(make_user(school, ["library.book_issues.view"])).get(f"{MEMBERS}eligible/?member_type=staff").status_code == 200
    assert client_for(make_user(school, ["library.library_members.view"])).get(f"{MEMBERS}eligible/?member_type=staff").status_code == 403


# ---- charges ledger ------------------------------------------------------------------------------


@pytest.fixture
def pending_charge(school, member):
    return Charge.objects.create(school=school, member=member, charge_type="overdue_fine", amount=Decimal("40"), assessed_on=ago(1))


def test_charges_list_filters_and_row_shape(librarian_client, school, member, pending_charge):
    Charge.objects.create(school=school, member=member, charge_type="registration", amount=Decimal("0"), status="waived", assessed_on=ago(2))
    rows = librarian_client.get(f"{BASE}/charges/").json()["results"]
    assert {"id", "member", "member_name", "card_no", "charge_type", "amount", "status", "assessed_on", "receipt_no"} <= set(rows[0])
    assert [r["id"] for r in librarian_client.get(f"{BASE}/charges/?status=pending").json()["results"]] == [pending_charge.pk]
    assert [r["id"] for r in librarian_client.get(f"{BASE}/charges/?charge_type=overdue_fine&member={member.pk}").json()["results"]] == [pending_charge.pk]
    assert librarian_client.get(f"{BASE}/charges/?search=CARD-001").json()["count"] == 2


def test_collect_charge_marks_paid_with_receipt_and_logs(librarian_client, librarian, pending_charge):
    resp = librarian_client.post(f"{BASE}/charges/{pending_charge.pk}/collect/")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "paid" and data["receipt_no"] == f"LIBR-{pending_charge.pk:07d}" and data["resolved_by"] == librarian.pk
    log = LibraryActivityLog.objects.get(school=librarian.school, event_type="fine")
    assert log.metadata["action"] == "collect" and log.metadata["amount"] == "40.00"


def test_collect_twice_is_a_409(librarian_client, pending_charge):
    assert librarian_client.post(f"{BASE}/charges/{pending_charge.pk}/collect/").status_code == 200
    again = librarian_client.post(f"{BASE}/charges/{pending_charge.pk}/collect/")
    assert again.status_code == 409 and again.json()["error"]["code"] == "library_invalid_state_transition"


def test_waive_needs_a_reason_and_logs(librarian_client, librarian, pending_charge):
    assert librarian_client.post(f"{BASE}/charges/{pending_charge.pk}/waive/", {}, format="json").status_code == 400
    resp = librarian_client.post(f"{BASE}/charges/{pending_charge.pk}/waive/", {"reason": "Book was returned on time"}, format="json")
    assert resp.status_code == 200 and resp.json()["data"]["status"] == "waived"
    pending_charge.refresh_from_db()
    assert pending_charge.resolution_note == "Book was returned on time"
    assert LibraryActivityLog.objects.filter(school=librarian.school, metadata__action="waive").count() == 1
    assert librarian_client.post(f"{BASE}/charges/{pending_charge.pk}/collect/").status_code == 409


def test_waiving_a_charge_lifts_the_suspension(librarian_client, school, member):
    charge = Charge.objects.create(school=school, member=member, charge_type="replacement", amount=Decimal("150"), assessed_on=ago(1))
    assert librarian_client.get(f"{MEMBERS}{member.pk}/dues/").json()["data"]["suspended"] is True
    librarian_client.post(f"{BASE}/charges/{charge.pk}/waive/", {"reason": "Found"}, format="json")
    assert librarian_client.get(f"{MEMBERS}{member.pk}/dues/").json()["data"]["suspended"] is False


def test_registration_collect_flow_from_the_dues_drawer(librarian_client, student):
    member = register(librarian_client, student=student.pk).json()["data"]
    charge_id = librarian_client.get(f"{MEMBERS}{member['id']}/dues/").json()["data"]["pending_charges"][0]["id"]
    assert librarian_client.post(f"{BASE}/charges/{charge_id}/collect/").status_code == 200
    after = librarian_client.get(f"{MEMBERS}{member['id']}/").json()["data"]
    assert after["registration_status"] == "paid" and after["total_dues"] == "0.00"


def test_charges_cannot_be_created_edited_or_deleted_and_are_school_scoped(librarian_client, admin_user, other_school, other_member, pending_charge):
    assert librarian_client.post(f"{BASE}/charges/", {"member": 1}, format="json").status_code == 405
    assert librarian_client.patch(f"{BASE}/charges/{pending_charge.pk}/", {"amount": "1"}, format="json").status_code == 405
    assert librarian_client.delete(f"{BASE}/charges/{pending_charge.pk}/").status_code == 405
    foreign = Charge.objects.create(school=other_school, member=other_member, charge_type="replacement", amount=Decimal("10"), assessed_on=ago(1))
    admin = client_for(admin_user)
    assert admin.get(f"{BASE}/charges/{foreign.pk}/").status_code == 404
    assert admin.post(f"{BASE}/charges/{foreign.pk}/collect/").status_code == 404
    assert admin.post(f"{BASE}/charges/{foreign.pk}/waive/", {"reason": "x"}, format="json").status_code == 404
    assert foreign.pk not in {r["id"] for r in admin.get(f"{BASE}/charges/").json()["results"]}
    foreign.refresh_from_db()
    assert foreign.status == "pending"


# ---- permission matrix ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "code,call,expected",
    [
        ("library.library_members.view", lambda c, m, ch, s: c.get(MEMBERS), 200),
        ("library.library_members.view", lambda c, m, ch, s: c.get(f"{MEMBERS}{m.pk}/"), 200),
        ("library.library_members.view", lambda c, m, ch, s: c.get(f"{MEMBERS}{m.pk}/dues/"), 200),
        ("library.library_members.create", lambda c, m, ch, s: c.post(MEMBERS, {"student": s.pk}, format="json"), 201),
        ("library.library_members.update", lambda c, m, ch, s: c.patch(f"{MEMBERS}{m.pk}/", {"is_active": False}, format="json"), 200),
        ("library.library_members.delete", lambda c, m, ch, s: c.delete(f"{MEMBERS}{m.pk}/"), 409),  # allowed through; refused only because the fixture member has a charge
        ("library.charges.view", lambda c, m, ch, s: c.get(f"{BASE}/charges/"), 200),
        ("library.charges.collect", lambda c, m, ch, s: c.post(f"{BASE}/charges/{ch.pk}/collect/"), 200),
        ("library.charges.waive", lambda c, m, ch, s: c.post(f"{BASE}/charges/{ch.pk}/waive/", {"reason": "r"}, format="json"), 200),
    ],
)
def test_each_member_and_charge_endpoint_needs_its_own_code(school, student, code, call, expected):
    def fresh():
        member = make_member(school, f"P{timezone.now().timestamp()}")
        charge = Charge.objects.create(school=school, member=member, charge_type="overdue_fine", amount=Decimal("5"), assessed_on=ago(1))
        return member, charge

    member, charge = fresh()
    assert call(client_for(make_user(school, [code])), member, charge, student).status_code == expected
    member, charge = fresh()
    assert call(client_for(make_user(school, ["library.reports.view"])), member, charge, student).status_code == 403


def test_view_only_user_cannot_register_edit_collect_or_waive(view_only_client, member, student, school):
    charge = Charge.objects.create(school=school, member=member, charge_type="overdue_fine", amount=Decimal("5"), assessed_on=ago(1))
    assert view_only_client.get(MEMBERS).status_code == 200
    assert view_only_client.post(MEMBERS, {"student": student.pk}, format="json").status_code == 403
    assert view_only_client.patch(f"{MEMBERS}{member.pk}/", {"is_active": False}, format="json").status_code == 403
    assert view_only_client.delete(f"{MEMBERS}{member.pk}/").status_code == 403
    assert view_only_client.get(f"{BASE}/charges/").status_code == 403  # charges.view is a new code
    assert view_only_client.post(f"{BASE}/charges/{charge.pk}/collect/").status_code == 403


def test_members_are_school_scoped(admin_user, other_member, other_school):
    admin = client_for(admin_user)
    assert admin.get(f"{MEMBERS}{other_member.pk}/dues/").status_code == 404
    assert admin.get(f"{MEMBERS}{other_member.pk}/").status_code == 404
    assert other_member.pk not in {r["id"] for r in admin.get(MEMBERS).json()["results"]}
    assert admin.get(f"{MEMBERS}?member_type=staff").json()["count"] == 0


def test_unauthenticated_member_calls_are_401(api_client):
    for path in ("members/", "members/candidates/?type=student", "members/eligible/?member_type=staff", "charges/"):
        assert api_client.get(f"{BASE}/{path}").status_code == 401
