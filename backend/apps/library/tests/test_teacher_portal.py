"""Teacher portal: My Class, My Books, Recommend a Book and the book search (prompt 11)."""
from datetime import date, time, timedelta
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from apps.academics.models import ClassTeacherAssignment
from apps.access_control.models import Role, UserRole
from apps.communication.models import CommunicationNotification
from apps.core.models import Class, ClassPeriod, Section
from apps.library import tasks
from apps.library.models import BookIssue, BookRequest, Hold, LibraryActivityLog, PeriodSlot
from apps.library.services import notifications
from apps.library.services.settings import get_settings
from apps.library.tests.conftest import make_book, make_member, make_staff
from apps.students.models import Guardian, Student

User = get_user_model()
T = "/api/v1/teacher/library/"
OVERVIEW, MY_CLASS, MY_BOOKS, REQUESTS, SEARCH = f"{T}overview/", f"{T}my-class/", f"{T}my-books/", f"{T}book-requests/", f"{T}books/search/"


def today():
    return timezone.localdate()


def teacher_with_staff(school, portal="teacher", staff=True, superuser=False):
    user = User.objects.create_user(username=f"tp_{uuid4().hex[:8]}", password="x", school=school)
    role = Role.objects.create(school=school, name=f"{portal}-{uuid4().hex[:6]}", portal_type=portal, is_active=True)
    UserRole.objects.create(user=user, role=role)
    member_staff = make_staff(school, user=user) if staff else None
    if superuser:
        user.is_superuser = True
        user.save()
    return user, member_staff


def client(user):
    api = APIClient()
    api.force_authenticate(user=user)
    return api


@pytest.fixture
def world(school, academic_year):
    grade = Class.objects.create(school=school, name="Grade 4")
    sec_a = Section.objects.create(school_class=grade, name="A")
    sec_b = Section.objects.create(school_class=grade, name="B")
    other_grade = Class.objects.create(school=school, name="Grade 5")
    other_sec = Section.objects.create(school_class=other_grade, name="A")
    user, staff = teacher_with_staff(school)
    ClassTeacherAssignment.objects.create(school=school, academic_year=academic_year, school_class=grade, section=sec_a, teacher=user)
    return type("World", (), dict(grade=grade, a=sec_a, b=sec_b, other_grade=other_grade, other_sec=other_sec, user=user, staff=staff, api=client(user)))


def pupil(school, cls, section, n, guardian=None):
    return Student.objects.create(
        school=school, admission_no=f"TP-{n}-{uuid4().hex[:4]}", first_name=f"Pupil{n}", last_name="Test", gender="male", status="active",
        current_class=cls, current_section=section, guardian=guardian,
    )


def student_member(school, student, card):
    return make_member(school, card, member_type="student", student=student)


def loan(school, book, member, due_in=-3, copy=None, **extra):
    return BookIssue.objects.create(
        school=school, book=book, copy=copy or book.copies.filter(status="available").first(), member=member,
        issue_date=today() - timedelta(days=20), due_date=today() + timedelta(days=due_in), **extra,
    )


def lend_copy(loan_obj):
    loan_obj.copy.status = "issued"
    loan_obj.copy.save()
    return loan_obj


@pytest.fixture
def eager(monkeypatch):
    conf = tasks.deliver_library_event.app.conf
    monkeypatch.setattr(conf, "task_always_eager", True)
    monkeypatch.setattr(conf, "task_eager_propagates", True)


@pytest.fixture
def pushes(monkeypatch):
    sent = []
    monkeypatch.setattr(notifications, "push_portal_event", lambda user_id, payload: sent.append((user_id, payload)) or True)
    return sent


# ---- who may come in -------------------------------------------------------------------------------------------------

ALL_URLS = [
    ("get", OVERVIEW), ("get", MY_CLASS), ("get", MY_BOOKS), ("get", REQUESTS), ("get", f"{SEARCH}?q=ab"),
    ("post", REQUESTS), ("post", f"{T}my-class/loans/1/remind/"), ("post", f"{T}my-books/loans/1/renew/"),
]


@pytest.mark.parametrize("method,url", ALL_URLS)
def test_unauthenticated_is_refused(method, url):
    assert getattr(APIClient(), method)(url).status_code in (401, 403)


@pytest.mark.parametrize("method,url", ALL_URLS)
def test_a_user_of_another_portal_gets_403(school, method, url):
    parent, _ = teacher_with_staff(school, portal="parent")
    assert getattr(client(parent), method)(url).status_code == 403


@pytest.mark.parametrize("method,url", ALL_URLS)
def test_a_school_admin_without_a_teacher_role_gets_403(admin_user, method, url):
    api = client(admin_user)
    assert getattr(api, method)(url).status_code == 403


@pytest.mark.parametrize("method,url", ALL_URLS)
def test_a_superuser_gets_403_even_with_a_teacher_role(school, method, url):
    root, _ = teacher_with_staff(school, superuser=True)
    assert getattr(client(root), method)(url).status_code == 403


@pytest.mark.parametrize("method,url", ALL_URLS)
def test_a_teacher_without_a_staff_profile_gets_403(school, method, url):
    nobody, _ = teacher_with_staff(school, staff=False)
    assert getattr(client(nobody), method)(url).status_code == 403


# ---- overview --------------------------------------------------------------------------------------------------------


def test_overview_for_an_unregistered_teacher_with_a_class(world):
    data = world.api.get(OVERVIEW).json()
    assert data == {"registered": False, "member": None, "has_class_scope": True, "class_count": 1}


def test_overview_for_a_registered_teacher_without_a_class(school, world):
    other, staff = teacher_with_staff(school)
    member = make_member(school, "OV-1", member_type="teacher", staff=staff)
    book = make_book(school, __import__("apps.library.models", fromlist=["BookCategory"]).BookCategory.objects.create(school=school, name="Fic", code="FIC"), copies=2)
    lend_copy(loan(school, book, member, due_in=5))
    data = client(other).get(OVERVIEW).json()
    assert data["registered"] is True and data["has_class_scope"] is False and data["class_count"] == 0
    assert data["member"]["card_no"] == "OV-1" and data["member"]["open_loans"] == 1
    assert data["member"]["borrowing_limit"] == get_settings(school).limit_teacher and data["member"]["suspended"] is False


# ---- My Class --------------------------------------------------------------------------------------------------------


def test_my_class_lists_only_open_loans_of_students_in_scope(school, category, world):
    mine = student_member(school, pupil(school, world.grade, world.a, 1), "MC-1")
    other_section = student_member(school, pupil(school, world.grade, world.b, 2), "MC-2")
    other_class = student_member(school, pupil(school, world.other_grade, world.other_sec, 3), "MC-3")
    staff_member = make_member(school, "MC-4", member_type="teacher")
    book = make_book(school, category, title="Atlas", copies=8)
    copies = list(book.copies.all())
    mine_loan = lend_copy(loan(school, book, mine, due_in=-4, copy=copies[0]))
    for index, member in enumerate((other_section, other_class, staff_member), start=1):
        lend_copy(loan(school, book, member, copy=copies[index]))
    loan(school, book, mine, due_in=2, copy=copies[5], status="returned")  # closed loans never show
    data = world.api.get(MY_CLASS).json()
    assert data["has_class_scope"] is True and len(data["classes"]) == 1
    group = data["classes"][0]
    assert (group["class_name"], group["section_name"], group["loan_count"]) == ("Grade 4", "A", 1)
    row = group["loans"][0]
    assert row["id"] == mine_loan.pk and row["book_title"] == "Atlas" and row["student_name"].startswith("Pupil1")
    assert row["state"] == "overdue" and row["days_overdue"] == 4 and row["reminded_today"] is False
    assert "card_no" not in row and "member_card_no" not in row


def test_my_class_without_a_scope_is_an_empty_list_not_an_error(school):
    lonely, _ = teacher_with_staff(school)
    data = client(lonely).get(MY_CLASS).json()
    assert data["has_class_scope"] is False and data["classes"] == []


def test_a_whole_class_assignment_covers_every_section(school, academic_year, world, category):
    boss, _ = teacher_with_staff(school)
    ClassTeacherAssignment.objects.create(school=school, academic_year=academic_year, school_class=world.grade, section=None, teacher=boss)
    member = student_member(school, pupil(school, world.grade, world.b, 1), "WC-1")
    book = make_book(school, category, copies=2)
    lend_copy(loan(school, book, member))
    group = client(boss).get(MY_CLASS).json()["classes"][0]
    assert group["section"] is None and group["loan_count"] == 1


def test_my_class_shows_the_next_library_period(school, category, world):
    period = ClassPeriod.objects.create(school=school, period="Period 3", start_time=time(10, 0), end_time=time(10, 40))
    now = timezone.localtime()
    PeriodSlot.objects.create(school=school, school_class=world.grade, section=world.a, day=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Mon"][now.weekday()], period=period)
    other = PeriodSlot.objects.create(school=school, school_class=world.grade, section=world.b, day="Mon", period=period, room_label="Annexe")
    slot = world.api.get(MY_CLASS).json()["classes"][0]["next_slot"]
    assert slot is not None and slot["period_name"] == "Period 3" and slot["start_time"] == "10:00" and slot["room_label"] == "Main Library"
    assert slot["id"] != other.pk


def test_my_class_without_a_library_period_has_no_next_slot(world):
    assert world.api.get(MY_CLASS).json()["classes"][0]["next_slot"] is None


def test_my_class_query_count_is_fixed(school, category, world, django_assert_max_num_queries):
    book = make_book(school, category, copies=30)
    world.api.get(MY_CLASS)
    for n, copy in enumerate(book.copies.all()[:20]):
        member = student_member(school, pupil(school, world.grade, world.a, n), f"QC-{n}")
        lend_copy(loan(school, book, member, copy=copy))
    with django_assert_max_num_queries(16):
        data = world.api.get(MY_CLASS).json()
    assert data["classes"][0]["loan_count"] == 20


def test_other_schools_loans_never_appear(school, other_school, other_category, world):
    foreign_class = Class.objects.create(school=other_school, name="Grade 4")
    foreign_section = Section.objects.create(school_class=foreign_class, name="A")
    member = student_member(other_school, pupil(other_school, foreign_class, foreign_section, 9), "FOREIGN-1")
    book = make_book(other_school, other_category, copies=2)
    foreign_loan = lend_copy(loan(other_school, book, member))
    assert world.api.get(MY_CLASS).json()["classes"][0]["loan_count"] == 0
    assert world.api.post(f"{T}my-class/loans/{foreign_loan.pk}/remind/").status_code == 404


# ---- remind ---------------------------------------------------------------------------------------------------------


def guardian_for(school, with_user=True):
    user = User.objects.create_user(username=f"g_{uuid4().hex[:8]}", password="x", school=school) if with_user else None
    return Guardian.objects.create(school=school, full_name="Parent One", relation="Mother", phone="9990001111", email="p@example.test", user=user)


def test_remind_notifies_the_guardian_once_per_loan_per_day(school, category, world, eager, pushes, django_capture_on_commit_callbacks):
    guardian = guardian_for(school)
    member = student_member(school, pupil(school, world.grade, world.a, 1, guardian=guardian), "RM-1")
    book = make_book(school, category, title="Overdue Book", copies=2)
    target = lend_copy(loan(school, book, member, due_in=-5))
    url = f"{T}my-class/loans/{target.pk}/remind/"
    with django_capture_on_commit_callbacks(execute=True):
        first = world.api.post(url)
    assert first.status_code == 200 and first.json() == {"queued": True, "loan": target.pk, "reminded_today": True}
    note = CommunicationNotification.objects.get()
    assert note.recipient == guardian.user and note.data["event"] == "overdue_reminder" and "Overdue Book" in note.body
    again = world.api.post(url)
    assert again.status_code == 409 and again.json()["error"]["code"] == "library_reminder_already_sent"
    assert CommunicationNotification.objects.count() == 1
    assert LibraryActivityLog.objects.filter(event_type="reminder", metadata__action="remind").count() == 1
    row = world.api.get(MY_CLASS).json()["classes"][0]["loans"][0]
    assert row["reminded_today"] is True


def test_remind_refuses_a_loan_that_is_not_overdue(school, category, world):
    member = student_member(school, pupil(school, world.grade, world.a, 1), "RM-2")
    book = make_book(school, category, copies=2)
    target = lend_copy(loan(school, book, member, due_in=3))
    resp = world.api.post(f"{T}my-class/loans/{target.pk}/remind/")
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_invalid_state_transition"
    assert not LibraryActivityLog.objects.filter(event_type="reminder").exists()


def test_remind_refuses_loans_outside_the_scope_with_404(school, category, world):
    book = make_book(school, category, copies=6)
    copies = list(book.copies.all())
    outside = student_member(school, pupil(school, world.grade, world.b, 1), "RM-3")
    far = student_member(school, pupil(school, world.other_grade, world.other_sec, 2), "RM-4")
    colleague = make_member(school, "RM-5", member_type="teacher")
    returned_member = student_member(school, pupil(school, world.grade, world.a, 3), "RM-6")
    ids = [
        lend_copy(loan(school, book, outside, copy=copies[0])).pk,
        lend_copy(loan(school, book, far, copy=copies[1])).pk,
        lend_copy(loan(school, book, colleague, copy=copies[2])).pk,
        loan(school, book, returned_member, copy=copies[3], status="returned").pk,
        999999,
    ]
    for issue_id in ids:
        assert world.api.post(f"{T}my-class/loans/{issue_id}/remind/").status_code == 404, issue_id
    assert not LibraryActivityLog.objects.filter(event_type="reminder").exists()


def test_a_teacher_with_no_scope_cannot_remind_anyone(school, category, world):
    member = student_member(school, pupil(school, world.grade, world.a, 1), "RM-7")
    book = make_book(school, category, copies=2)
    target = lend_copy(loan(school, book, member))
    lonely, _ = teacher_with_staff(school)
    assert client(lonely).post(f"{T}my-class/loans/{target.pk}/remind/").status_code == 404


# ---- My Books -------------------------------------------------------------------------------------------------------


@pytest.fixture
def mine(school, world):
    return make_member(school, "TB-1", member_type="teacher", staff=world.staff)


def test_my_books_for_an_unregistered_teacher(world):
    assert world.api.get(MY_BOOKS).json() == {"registered": False, "borrowing_limit": None, "open_loans": 0, "loans": []}


def test_my_books_lists_only_the_teachers_own_open_loans(school, category, world, mine):
    book = make_book(school, category, title="Mine", copies=8)
    copies = list(book.copies.all())
    colleague, colleague_staff = teacher_with_staff(school)
    other_member = make_member(school, "TB-2", member_type="teacher", staff=colleague_staff)
    pupil_member = student_member(school, pupil(school, world.grade, world.a, 1), "TB-3")
    own = lend_copy(loan(school, book, mine, due_in=7, copy=copies[0]))
    lend_copy(loan(school, book, other_member, copy=copies[1]))
    lend_copy(loan(school, book, pupil_member, copy=copies[2]))
    loan(school, book, mine, copy=copies[3], status="returned")
    data = world.api.get(MY_BOOKS).json()
    assert data["registered"] is True and data["card_no"] == "TB-1" and data["open_loans"] == 1
    assert [row["id"] for row in data["loans"]] == [own.pk]
    assert data["borrowing_limit"] == get_settings(school).limit_teacher
    row = data["loans"][0]
    assert row["can_renew"] is True and row["reason"] == "" and row["max_renewals"] == 2 and row["state"] == "open"


def test_my_books_explains_why_a_loan_cannot_be_renewed(school, category, world, mine):
    book = make_book(school, category, copies=6)
    held = make_book(school, category, title="Held", copies=3)
    copies, held_copies = list(book.copies.all()), list(held.copies.all())
    overdue = lend_copy(loan(school, book, mine, due_in=-2, copy=copies[0]))
    capped = lend_copy(loan(school, book, mine, due_in=5, copy=copies[1], renew_count=2))
    waiting = lend_copy(loan(school, held, mine, due_in=5, copy=held_copies[0]))
    Hold.objects.create(school=school, book=held, member=make_member(school, "TB-9", member_type="teacher"))
    rows = {r["id"]: r for r in world.api.get(MY_BOOKS).json()["loans"]}
    assert (rows[overdue.pk]["reason"], rows[overdue.pk]["reason_text"], rows[overdue.pk]["can_renew"]) == ("overdue", "Overdue, please return", False)
    assert (rows[capped.pk]["reason"], rows[capped.pk]["reason_text"]) == ("cap", "Renewal limit reached")
    assert (rows[waiting.pk]["reason"], rows[waiting.pk]["reason_text"]) == ("hold", "On hold for someone else")


def test_renew_extends_the_loan_and_counts_it(school, category, world, mine):
    book = make_book(school, category, copies=2)
    target = lend_copy(loan(school, book, mine, due_in=3))
    resp = world.api.post(f"{T}my-books/loans/{target.pk}/renew/")
    assert resp.status_code == 200, resp.json()
    data = resp.json()
    assert data["renew_count"] == 1 and date.fromisoformat(data["due_date"]) > today() + timedelta(days=3)
    target.refresh_from_db()
    assert target.renew_count == 1 and target.due_date.isoformat() == data["due_date"]
    assert LibraryActivityLog.objects.filter(event_type="renewal", issue=target).count() == 1


@pytest.mark.parametrize("setup,code", [
    ("overdue", "library_loan_overdue"), ("cap", "library_renewal_cap"), ("hold", "library_hold_exists"), ("returned", "library_already_returned"),
])
def test_renew_refusals_use_the_library_codes(school, category, world, mine, setup, code):
    book = make_book(school, category, copies=2)
    target = lend_copy(loan(school, book, mine, due_in=-1 if setup == "overdue" else 4, renew_count=2 if setup == "cap" else 0,
                            status="returned" if setup == "returned" else "issued"))
    if setup == "hold":
        Hold.objects.create(school=school, book=book, member=make_member(school, "TB-8", member_type="teacher"))
    resp = world.api.post(f"{T}my-books/loans/{target.pk}/renew/")
    assert resp.status_code == 409 and resp.json()["error"]["code"] == code
    target.refresh_from_db()
    assert target.renew_count == (2 if setup == "cap" else 0)


def test_renew_only_works_on_the_teachers_own_loans(school, other_school, other_category, category, world, mine):
    book = make_book(school, category, copies=6)
    copies = list(book.copies.all())
    colleague, colleague_staff = teacher_with_staff(school)
    theirs = lend_copy(loan(school, book, make_member(school, "TB-5", member_type="teacher", staff=colleague_staff), due_in=4, copy=copies[0]))
    pupil_loan = lend_copy(loan(school, book, student_member(school, pupil(school, world.grade, world.a, 1), "TB-6"), due_in=4, copy=copies[1]))
    foreign_book = make_book(other_school, other_category, copies=2)
    foreign = lend_copy(loan(other_school, foreign_book, make_member(other_school, "FT-1", member_type="teacher"), due_in=4))
    for issue_id in (theirs.pk, pupil_loan.pk, foreign.pk, 999999):
        assert world.api.post(f"{T}my-books/loans/{issue_id}/renew/").status_code == 404, issue_id
    for row in BookIssue.objects.all():
        assert row.renew_count == 0


def test_an_unregistered_teacher_cannot_renew_anything(school, category, world):
    book = make_book(school, category, copies=2)
    colleague, colleague_staff = teacher_with_staff(school)
    theirs = lend_copy(loan(school, book, make_member(school, "TB-7", member_type="teacher", staff=colleague_staff), due_in=4))
    assert world.api.post(f"{T}my-books/loans/{theirs.pk}/renew/").status_code == 404


# ---- recommendations -------------------------------------------------------------------------------------------------


def test_creating_a_request_files_it_under_the_teachers_class_and_logs_it(school, world):
    resp = world.api.post(REQUESTS, {"title": "  Atlas   of the World ", "notes": "For Grade 4"}, format="json")
    assert resp.status_code == 201, resp.json()
    data = resp.json()
    assert data["title"] == "Atlas of the World" and data["status"] == "pending" and data["notes"] == "For Grade 4"
    row = BookRequest.objects.get()
    assert row.requested_by_id == world.user.pk and row.school_id == school.id
    assert (row.school_class_id, row.section_id) == (world.grade.pk, world.a.pk)
    log = LibraryActivityLog.objects.get(event_type="request")
    assert log.actor_id == world.user.pk and log.metadata["request_id"] == row.pk and "Atlas" not in log.summary


def test_the_client_cannot_choose_class_status_or_requester(school, world):
    resp = world.api.post(REQUESTS, {"title": "Mine", "school_class": world.other_grade.pk, "section": world.other_sec.pk, "status": "approved",
                                     "requested_by": 1, "school": 999}, format="json")
    assert resp.status_code == 201
    row = BookRequest.objects.get()
    assert (row.school_class_id, row.section_id, row.status, row.requested_by_id) == (world.grade.pk, world.a.pk, "pending", world.user.pk)


def test_a_teacher_without_a_class_files_a_request_with_no_class(school):
    lonely, _ = teacher_with_staff(school)
    assert client(lonely).post(REQUESTS, {"title": "Anything"}, format="json").status_code == 201
    row = BookRequest.objects.get()
    assert row.school_class_id is None and row.section_id is None


def test_request_validation_and_duplicates(world):
    assert world.api.post(REQUESTS, {"title": "   "}, format="json").status_code == 400
    assert world.api.post(REQUESTS, {}, format="json").status_code == 400
    assert world.api.post(REQUESTS, {"title": "x" * 256}, format="json").status_code == 400
    assert world.api.post(REQUESTS, {"title": "Dune"}, format="json").status_code == 201
    dup = world.api.post(REQUESTS, {"title": "dune"}, format="json")
    assert dup.status_code == 409 and BookRequest.objects.count() == 1


def test_a_reviewed_title_can_be_requested_again(school, world):
    world.api.post(REQUESTS, {"title": "Dune"}, format="json")
    BookRequest.objects.update(status="rejected")
    assert world.api.post(REQUESTS, {"title": "Dune"}, format="json").status_code == 201


def test_a_teacher_cannot_have_more_than_twenty_pending_requests(world):
    for n in range(20):
        assert world.api.post(REQUESTS, {"title": f"Title {n}"}, format="json").status_code == 201
    resp = world.api.post(REQUESTS, {"title": "One more"}, format="json")
    assert resp.status_code == 400 and BookRequest.objects.count() == 20


def test_own_requests_newest_first_with_the_librarians_answer(school, world):
    colleague, _ = teacher_with_staff(school)
    BookRequest.objects.create(school=school, requested_by=colleague, title="Theirs")
    world.api.post(REQUESTS, {"title": "First"}, format="json")
    second = world.api.post(REQUESTS, {"title": "Second"}, format="json").json()
    BookRequest.objects.filter(pk=second["id"]).update(status="approved", review_note="Ordered next week", reviewed_at=timezone.now())
    data = world.api.get(REQUESTS).json()
    assert data["count"] == 2 and [r["title"] for r in data["results"]] == ["Second", "First"]
    assert data["results"][0]["status"] == "approved" and data["results"][0]["review_note"] == "Ordered next week"
    assert "requested_by" not in data["results"][0]


def test_another_schools_requests_never_appear(school, other_school, world):
    foreign_teacher, _ = teacher_with_staff(other_school)
    BookRequest.objects.create(school=other_school, requested_by=foreign_teacher, title="Foreign")
    assert world.api.get(REQUESTS).json()["count"] == 0


# ---- book search ---------------------------------------------------------------------------------------------------


def test_search_shows_availability_and_no_cost_fields(school, category, world, mine):
    book = make_book(school, category, title="Treasure Island", author="Stevenson", copies=3, cost_per_copy="250.00")
    lend_copy(loan(school, book, mine, due_in=5))
    data = world.api.get(SEARCH, {"q": "treasure"}).json()
    assert data["count"] == 1
    row = data["results"][0]
    assert (row["title"], row["author"], row["available_copies"], row["total_copies"]) == ("Treasure Island", "Stevenson", 2, 3)
    assert not ({"cost_per_copy", "accession_code", "vendor_name", "donor_name", "rack", "purchase_order"} & set(row))
    assert world.api.get(SEARCH, {"q": "steven"}).json()["count"] == 1


def test_search_needs_two_characters_and_stays_in_school(school, other_school, other_category, category, world):
    make_book(other_school, other_category, title="Foreign Title", copies=1)
    make_book(school, category, title="Ours", copies=1)
    assert world.api.get(SEARCH, {"q": "f"}).json() == {"count": 0, "results": []}
    assert world.api.get(SEARCH).json() == {"count": 0, "results": []}
    assert world.api.get(SEARCH, {"q": "Foreign"}).json()["count"] == 0
    assert world.api.get(SEARCH, {"q": "Ours"}).json()["count"] == 1


def test_search_is_capped_at_ten_rows(school, category, world):
    for n in range(14):
        make_book(school, category, title=f"Cap Title {n:02d}", copies=1)
    assert world.api.get(SEARCH, {"q": "Cap Title"}).json()["count"] == 10


# ---- the notification bell ---------------------------------------------------------------------------------------------


def test_library_notifications_appear_in_both_bell_endpoints(school, world, eager, pushes, django_capture_on_commit_callbacks):
    """request_reviewed (type system) and unscanned_flag (type reminder) are ordinary rows for the bell."""
    from apps.library.services import acquisitions

    posted = world.api.post(REQUESTS, {"title": "Atlas"}, format="json").json()
    reviewer = User.objects.create_user(username="reviewer_x", password="x", school=school)
    with django_capture_on_commit_callbacks(execute=True):
        acquisitions.review_book_request(school, reviewer, posted["id"], "approved", note="Ordered")
    CommunicationNotification.objects.create(
        school=school, recipient=world.user, title="Students missing", body="2 of 3", notification_type="reminder", link_url="/teacher/library",
        data={"event": "unscanned_flag", "library": True},
    )
    teacher_bell = world.api.get("/api/v1/teacher/notifications/").json()
    assert {n["notification_type"] for n in teacher_bell["notifications"]} == {"system", "reminder"}
    assert {n["link_url"] for n in teacher_bell["notifications"]} == {"/teacher/library/recommend", "/teacher/library"}
    shared = world.api.get("/api/v1/utilities/communication/notifications/").json()
    rows = shared["results"] if isinstance(shared, dict) and "results" in shared else shared
    assert {n["notification_type"] for n in rows} == {"system", "reminder"}
