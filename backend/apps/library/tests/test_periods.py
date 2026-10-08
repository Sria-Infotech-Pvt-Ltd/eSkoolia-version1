"""Library periods, check-in, occupancy, the unscanned flag and the beat command (prompt 9)."""
from datetime import date, datetime, time, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.core.management.base import CommandError
from django.utils import timezone

from apps.academics.models import ClassTeacherAssignment
from apps.communication.models import CommunicationNotification
from apps.core.models import Class, ClassPeriod, Section
from apps.library import tasks
from apps.library.management.commands import library_register_periodic_tasks as beat_command
from apps.library.models import (
    BookIssue,
    Charge,
    Hold,
    LibraryActivityLog,
    PeriodSlot,
    Visit,
)
from apps.library.services import notifications, periods, unscanned
from apps.library.services.due_dates import compute_due_date
from apps.library.services.settings import get_settings
from apps.library.tests.conftest import client_for, make_book, make_member, make_staff, make_user
from apps.students.models import Student

User = get_user_model()
BASE = "/api/v1/library/"
SLOTS = f"{BASE}period-slots/"
MONDAY, TUESDAY = 5, 6  # 5 and 6 October 2026


def at(hour, minute=0, day=MONDAY):
    return timezone.make_aware(datetime(2026, 10, day, hour, minute))


@pytest.fixture
def clock(monkeypatch):
    def set_time(hour, minute=0, day=MONDAY):
        moment = at(hour, minute, day)
        monkeypatch.setattr(periods, "local_now", lambda: moment)
        monkeypatch.setattr(unscanned, "local_now", lambda: moment)
        return moment

    return set_time


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


@pytest.fixture
def grid(school):
    """Grade 4 with sections A and B, a library period 10:00 to 10:40, plus a break and an exam period."""
    grade = Class.objects.create(school=school, name="Grade 4")
    section_a = Section.objects.create(school_class=grade, name="A")
    section_b = Section.objects.create(school_class=grade, name="B")
    period = ClassPeriod.objects.create(school=school, period="Period 3", start_time=time(10, 0), end_time=time(10, 40))
    later = ClassPeriod.objects.create(school=school, period="Period 5", start_time=time(12, 0), end_time=time(12, 40))
    brk = ClassPeriod.objects.create(school=school, period="Lunch", start_time=time(11, 0), end_time=time(11, 30), is_break=True)
    exam = ClassPeriod.objects.create(school=school, period="Exam 1", start_time=time(9, 0), end_time=time(10, 0), period_type="exam")
    return SimpleNamespace(grade=grade, a=section_a, b=section_b, period=period, later=later, brk=brk, exam=exam)


def make_slot(school, grid, *, section="a", day="Mon", period=None, room="Main Library", cls=None, **extra):
    section_obj = getattr(grid, section) if isinstance(section, str) else section
    return PeriodSlot.objects.create(
        school=school, school_class=cls or grid.grade, section=section_obj, day=day, period=period or grid.period,
        room_label=room, **extra,
    )


def make_student(school, grid, section, n, status="active"):
    return Student.objects.create(
        school=school, admission_no=f"ADM-P-{section.name}-{n}-{uuid4().hex[:4]}", first_name=f"Pupil{n}", last_name="Test",
        gender="male", status=status, current_class=grid.grade, current_section=section,
    )


def member_for(school, student, card):
    return make_member(school, card, member_type="student", student=student)


def payload(grid, **extra):
    return {"school_class": grid.grade.pk, "section": grid.a.pk, "day": "Mon", "period": grid.period.pk, **extra}


# ---- slot CRUD and conflicts ------------------------------------------------------------------------------------


def test_create_slot_returns_names_and_times(librarian_client, grid):
    resp = librarian_client.post(SLOTS, payload(grid, room_label="Reading Room"), format="json")
    assert resp.status_code == 201, resp.json()
    data = resp.json()["data"]
    assert (data["class_name"], data["section_name"], data["period_name"], data["room_label"]) == ("Grade 4", "A", "Period 3", "Reading Room")
    assert (data["start_time"], data["end_time"]) == ("10:00", "10:40") and data["is_active"] is True


def test_room_conflict_is_a_409_naming_the_clashing_slot(librarian_client, school, grid):
    first = make_slot(school, grid, section="a")
    resp = librarian_client.post(SLOTS, payload(grid, section=grid.b.pk), format="json")
    assert resp.status_code == 409
    error = resp.json()["error"]
    assert error["conflict"] == "room" and error["slot"]["id"] == first.pk
    assert error["slot"]["class_name"] == "Grade 4" and error["slot"]["room_label"] == "Main Library"
    assert PeriodSlot.objects.count() == 1


def test_same_class_in_another_room_at_the_same_time_is_a_class_conflict(librarian_client, school, grid):
    first = make_slot(school, grid, section="a")
    resp = librarian_client.post(SLOTS, payload(grid, room_label="Annexe"), format="json")
    assert resp.status_code == 409 and resp.json()["error"]["slot"]["id"] == first.pk


def test_a_class_wide_slot_and_a_section_slot_of_the_same_class_clash_both_ways(librarian_client, school, grid):
    wide = make_slot(school, grid, section=None, room="Annexe")
    resp = librarian_client.post(SLOTS, payload(grid, section=grid.b.pk, room_label="Room 2"), format="json")
    assert resp.status_code == 409 and resp.json()["error"]["slot"]["id"] == wide.pk
    wide.delete()
    make_slot(school, grid, section="b", room="Room 2")
    resp = librarian_client.post(SLOTS, {**payload(grid, room_label="Annexe"), "section": None}, format="json")
    assert resp.status_code == 409


def test_different_class_period_or_day_is_not_a_conflict(librarian_client, school, grid):
    make_slot(school, grid, section="a")
    other = Class.objects.create(school=school, name="Grade 5")
    assert librarian_client.post(SLOTS, {"school_class": other.pk, "day": "Mon", "period": grid.period.pk, "room_label": "Room 2"}, format="json").status_code == 201
    assert librarian_client.post(SLOTS, payload(grid, day="Tue", room_label="Room 3"), format="json").status_code == 201
    assert librarian_client.post(SLOTS, payload(grid, period=grid.later.pk, room_label="Room 4"), format="json").status_code == 201


def test_a_slot_does_not_clash_with_itself_on_update(librarian_client, school, grid):
    slot = make_slot(school, grid, section="a")
    resp = librarian_client.patch(f"{SLOTS}{slot.pk}/", {"room_label": "Main Library", "supervisor": None}, format="json")
    assert resp.status_code == 200


def test_switching_a_slot_off_frees_the_class_but_not_the_room(librarian_client, school, grid):
    slot = make_slot(school, grid, section="a")
    assert librarian_client.patch(f"{SLOTS}{slot.pk}/", {"is_active": False}, format="json").status_code == 200
    assert librarian_client.post(SLOTS, payload(grid, section=grid.b.pk, room_label="Room 2"), format="json").status_code == 201
    resp = librarian_client.post(SLOTS, {"school_class": grid.grade.pk, "section": grid.b.pk, "day": "Mon", "period": grid.period.pk}, format="json")
    assert resp.status_code == 409 and resp.json()["error"]["conflict"] == "room"


def test_an_exact_inactive_twin_is_a_409_not_a_server_error(librarian_client, school, grid):
    make_slot(school, grid, section="a", is_active=False)
    resp = librarian_client.post(SLOTS, payload(grid, room_label="Room 2"), format="json")
    assert resp.status_code == 409 and resp.json()["error"]["conflict"] == "twin"


def test_slot_foreign_ids_and_bad_periods_are_refused(librarian_client, school, other_school, grid):
    foreign_class = Class.objects.create(school=other_school, name="Grade 4")
    foreign_period = ClassPeriod.objects.create(school=other_school, period="Period 3", start_time=time(10, 0), end_time=time(10, 40))
    foreign_staff = make_staff(other_school)
    for field, value in (("school_class", foreign_class.pk), ("period", foreign_period.pk), ("supervisor", foreign_staff.pk)):
        resp = librarian_client.post(SLOTS, payload(grid, **{field: value}), format="json")
        assert resp.status_code == 400 and field in resp.json()["field_errors"], field
    other_section = Section.objects.create(school_class=Class.objects.create(school=school, name="Grade 6"), name="A")
    resp = librarian_client.post(SLOTS, payload(grid, section=other_section.pk), format="json")
    assert resp.status_code == 400 and "section" in resp.json()["field_errors"]
    for bad in (grid.brk, grid.exam):
        resp = librarian_client.post(SLOTS, payload(grid, period=bad.pk), format="json")
        assert resp.status_code == 400 and "period" in resp.json()["field_errors"]
    assert librarian_client.post(SLOTS, payload(grid, day="Sun"), format="json").status_code == 400


def test_supervisor_is_saved_and_named(librarian_client, school, grid):
    staff = make_staff(school, first_name="Meera")
    data = librarian_client.post(SLOTS, payload(grid, supervisor=staff.pk), format="json").json()["data"]
    assert data["supervisor"] == staff.pk and data["supervisor_name"].startswith("Meera")


def test_cross_school_slot_is_not_found(librarian_client, other_school, grid):
    foreign_class = Class.objects.create(school=other_school, name="Grade 4")
    foreign_period = ClassPeriod.objects.create(school=other_school, period="P", start_time=time(10, 0), end_time=time(10, 40))
    other = PeriodSlot.objects.create(school=other_school, school_class=foreign_class, day="Mon", period=foreign_period)
    assert librarian_client.get(f"{SLOTS}{other.pk}/").status_code == 404
    assert librarian_client.patch(f"{SLOTS}{other.pk}/", {"is_active": False}, format="json").status_code == 404
    assert librarian_client.delete(f"{SLOTS}{other.pk}/").status_code == 404
    assert librarian_client.get(SLOTS).json()["count"] == 0


def test_a_slot_with_check_ins_cannot_be_deleted_but_an_empty_one_can(librarian_client, school, grid, clock):
    used = make_slot(school, grid, section="a")
    spare = make_slot(school, grid, section="b", room="Room 2")
    member = member_for(school, make_student(school, grid, grid.a, 1), "V-1")
    clock(10, 5)
    periods.check_in(school, None, member=member)
    resp = librarian_client.delete(f"{SLOTS}{used.pk}/")
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_has_history"
    assert librarian_client.delete(f"{SLOTS}{spare.pk}/").status_code == 204


# ---- week grid, current, briefing ------------------------------------------------------------------------------


def test_week_grid_lists_class_periods_slots_and_the_live_marker(librarian_client, school, grid, clock):
    live = make_slot(school, grid, section="a")
    later = make_slot(school, grid, section="a", period=grid.later)
    clock(10, 10)
    data = librarian_client.get(f"{SLOTS}week/").json()["data"]
    assert data["days"] == ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] and data["today"] == "Mon"
    assert [p["name"] for p in data["periods"]] == ["Period 3", "Period 5"]  # no break, no exam
    by_id = {s["id"]: s for s in data["slots"]}
    assert by_id[live.pk]["live"] is True and by_id[later.pk]["live"] is False
    assert data["live_slot_ids"] == [live.pk]
    clock(10, 10, day=TUESDAY)
    assert librarian_client.get(f"{SLOTS}week/").json()["data"]["live_slot_ids"] == []


def test_current_returns_running_slots_with_counts(librarian_client, school, grid, clock):
    make_slot(school, grid, section="a")
    make_student(school, grid, grid.a, 1)
    clock(10, 10)
    data = librarian_client.get(f"{SLOTS}current/").json()["data"]
    assert [s["scheduled"] for s in data["slots"]] == [1] and data["checked_in"] == 0
    clock(9, 0)
    assert librarian_client.get(f"{SLOTS}current/").json()["data"]["slots"] == []


def test_prep_briefing_lists_due_back_blocked_and_holds_for_the_next_class(librarian_client, school, category, grid, clock):
    slot = make_slot(school, grid, section="a")
    other_slot = make_slot(school, grid, section="b", room="Room 2", period=grid.later)
    owes, clear, other_section = (make_student(school, grid, grid.a, 1), make_student(school, grid, grid.a, 2), make_student(school, grid, grid.b, 3))
    m_owes, m_clear, m_other = (member_for(school, s, f"B-{i}") for i, s in enumerate((owes, clear, other_section)))
    book = make_book(school, category, title="Due Back Book", copies=3)
    copy = book.copies.first()
    BookIssue.objects.create(school=school, book=book, copy=copy, member=m_clear, issue_date=date(2026, 9, 20), due_date=date(2026, 10, 5))
    BookIssue.objects.create(school=school, book=book, copy=book.copies.last(), member=m_other, issue_date=date(2026, 9, 20), due_date=date(2026, 10, 5))
    Charge.objects.create(school=school, member=m_owes, charge_type="overdue_fine", amount=40, assessed_on=date(2026, 10, 1))
    wanted = make_book(school, category, title="Wanted Book", copies=1)
    Hold.objects.create(school=school, book=wanted, member=m_clear)
    Hold.objects.create(school=school, book=wanted, member=m_other)
    clock(9, 30)
    data = librarian_client.get(f"{SLOTS}prep-briefing/").json()["data"]
    assert data["slot"]["id"] == slot.pk and data["slot"]["id"] != other_slot.pk
    assert data["starts_in_minutes"] == 30 and data["date"] == "2026-10-05"
    assert [r["book_title"] for r in data["due_back"]["rows"]] == ["Due Back Book"] and data["due_back"]["count"] == 1
    # B-0 owes a fine; B-1 is blocked too because the loan due back is overdue and its fine has accrued.
    assert sorted(r["card_no"] for r in data["blocked"]["rows"]) == ["B-0", "B-1"] and data["blocked"]["count"] == 2
    assert [r["book_title"] for r in data["holds_ready"]["rows"]] == ["Wanted Book"] and data["holds_ready"]["count"] == 1


def test_prep_briefing_looks_to_the_next_day_and_is_empty_with_no_slots(librarian_client, school, grid, clock):
    clock(9, 0)
    assert librarian_client.get(f"{SLOTS}prep-briefing/").json()["data"] == {}
    make_slot(school, grid, section="a", day="Tue")
    data = librarian_client.get(f"{SLOTS}prep-briefing/").json()["data"]
    assert data["date"] == "2026-10-06" and data["starts_in_minutes"] is None


# ---- check-in -----------------------------------------------------------------------------------------------------


def test_check_in_infers_the_slot_from_the_clock_and_the_class_and_is_idempotent(librarian_client, school, grid, clock):
    slot = make_slot(school, grid, section="a")
    make_slot(school, grid, section=None, cls=Class.objects.create(school=school, name="Grade 5"), room="Room 2")
    mine = member_for(school, make_student(school, grid, grid.a, 1), "C-1")
    make_student(school, grid, grid.a, 2)
    clock(10, 7)
    first = librarian_client.post(f"{BASE}visits/check-in/", {"card_no": "C-1"}, format="json")
    assert first.status_code == 201, first.json()
    data = first.json()["data"]
    assert data["created"] is True and data["visit"]["period_slot"] == slot.pk and data["visit"]["member"] == mine.pk
    assert (data["checked_in"], data["scheduled"]) == (1, 2)
    again = librarian_client.post(f"{BASE}visits/check-in/", {"card_no": "C-1"}, format="json")
    assert again.status_code == 200 and again.json()["data"]["created"] is False
    assert again.json()["data"]["visit"]["id"] == data["visit"]["id"]
    assert Visit.objects.count() == 1 and again.json()["data"]["checked_in"] == 1


def test_check_in_is_per_day_a_new_week_is_a_new_visit(school, grid, clock):
    make_slot(school, grid, section="a")
    member = member_for(school, make_student(school, grid, grid.a, 1), "D-1")
    periods.check_in(school, None, member=member, now=clock(10, 5))
    _visit, created, _row = periods.check_in(school, None, member=member, now=at(10, 5, day=MONDAY + 7))
    assert created is True and Visit.objects.count() == 2


def test_check_in_by_member_id_with_an_explicit_slot(librarian_client, school, grid, clock):
    slot = make_slot(school, grid, section="a")
    teacher_member = make_member(school, "T-1", member_type="teacher")
    clock(10, 5)
    resp = librarian_client.post(f"{BASE}visits/check-in/", {"member": teacher_member.pk, "period_slot": slot.pk, "method": "manual"}, format="json")
    assert resp.status_code == 201 and resp.json()["data"]["visit"]["method"] == "manual"


def test_a_non_student_with_one_running_slot_is_placed_in_it(school, grid, clock):
    slot = make_slot(school, grid, section="a")
    member = make_member(school, "T-2", member_type="teacher")
    visit, created, _ = periods.check_in(school, None, member=member, now=clock(10, 5))
    assert created and visit.period_slot_id == slot.pk


def test_check_in_refusals(librarian_client, school, other_school, grid, clock):
    make_slot(school, grid, section="a")
    student = member_for(school, make_student(school, grid, grid.a, 1), "R-1")
    outsider = member_for(school, make_student(school, grid, grid.b, 2), "R-2")
    inactive = member_for(school, make_student(school, grid, grid.a, 3), "R-3")
    inactive.is_active = False
    inactive.save()
    foreign = make_member(other_school, "R-FOREIGN", member_type="teacher")
    url = f"{BASE}visits/check-in/"
    clock(9, 0)  # nothing running
    resp = librarian_client.post(url, {"card_no": "R-1"}, format="json")
    assert resp.status_code == 400 and "period_slot" in resp.json()["field_errors"]
    clock(10, 5)
    assert librarian_client.post(url, {"card_no": "R-2"}, format="json").status_code == 400  # section B has no slot
    assert librarian_client.post(url, {"card_no": "R-3"}, format="json").status_code == 400
    assert librarian_client.post(url, {"card_no": "NOPE"}, format="json").status_code == 404
    assert librarian_client.post(url, {"card_no": "R-FOREIGN"}, format="json").status_code == 404
    assert librarian_client.post(url, {"member": foreign.pk}, format="json").status_code == 400
    assert librarian_client.post(url, {}, format="json").status_code == 400
    assert librarian_client.post(url, {"card_no": "R-1", "period_slot": 999999}, format="json").status_code == 400
    assert Visit.objects.count() == 0
    del student, outsider


def test_explicit_slot_must_be_for_today_and_active(librarian_client, school, grid, clock):
    tuesday = make_slot(school, grid, section="a", day="Tue")
    off = make_slot(school, grid, section="b", room="Room 2", is_active=False)
    member = member_for(school, make_student(school, grid, grid.a, 1), "E-1")
    clock(10, 5)
    for slot in (tuesday, off):
        resp = librarian_client.post(f"{BASE}visits/check-in/", {"card_no": "E-1", "period_slot": slot.pk}, format="json")
        assert resp.status_code == 400 and "period_slot" in resp.json()["field_errors"]
    del member


def test_cross_school_slot_id_on_check_in_is_refused(librarian_client, school, other_school, grid, clock):
    foreign_slot = PeriodSlot.objects.create(
        school=other_school, school_class=Class.objects.create(school=other_school, name="Grade 1"), day="Mon",
        period=ClassPeriod.objects.create(school=other_school, period="P", start_time=time(10, 0), end_time=time(10, 40)),
    )
    member_for(school, make_student(school, grid, grid.a, 1), "X-1")
    clock(10, 5)
    resp = librarian_client.post(f"{BASE}visits/check-in/", {"card_no": "X-1", "period_slot": foreign_slot.pk}, format="json")
    assert resp.status_code == 400 and "period_slot" in resp.json()["field_errors"]


# ---- occupancy and footfall ---------------------------------------------------------------------------------------


def test_occupancy_maths_counts_active_students_of_the_class_and_section(librarian_client, school, grid, clock):
    section_slot = make_slot(school, grid, section="a")
    wide_slot = make_slot(school, grid, section=None, cls=Class.objects.create(school=school, name="Grade 5"), room="Room 2")
    grade5 = wide_slot.school_class
    sec5 = Section.objects.create(school_class=grade5, name="X")
    in_a = [make_student(school, grid, grid.a, n) for n in range(3)]
    make_student(school, grid, grid.a, 9, status="inactive")  # not scheduled
    make_student(school, grid, grid.b, 8)  # other section
    for n in range(4):
        Student.objects.create(school=school, admission_no=f"G5-{n}", first_name="Five", gender="male", status="active", current_class=grade5, current_section=sec5)
    m1, m2 = member_for(school, in_a[0], "O-1"), member_for(school, in_a[1], "O-2")
    clock(10, 10)
    for member in (m1, m2):
        periods.check_in(school, None, member=member)
    data = librarian_client.get(f"{BASE}visits/occupancy/").json()["data"]
    rows = {r["slot_id"]: r for r in data["slots"]}
    assert (rows[section_slot.pk]["checked_in"], rows[section_slot.pk]["scheduled"]) == (2, 3)
    assert (rows[wide_slot.pk]["checked_in"], rows[wide_slot.pk]["scheduled"]) == (0, 4)  # class-wide counts every section
    assert (data["checked_in"], data["scheduled"]) == (2, 7)


def test_occupancy_for_a_given_slot_and_unknown_slot(librarian_client, school, grid, clock):
    slot = make_slot(school, grid, section="a", period=grid.later)
    make_student(school, grid, grid.a, 1)
    clock(10, 10)  # the slot is not running now
    data = librarian_client.get(f"{BASE}visits/occupancy/", {"period_slot": slot.pk}).json()["data"]
    assert data["scheduled"] == 1 and data["checked_in"] == 0
    assert librarian_client.get(f"{BASE}visits/occupancy/", {"period_slot": 999999}).status_code == 404
    assert librarian_client.get(f"{BASE}visits/occupancy/", {"period_slot": "x"}).status_code == 404
    assert librarian_client.get(f"{BASE}visits/occupancy/").json()["data"]["slots"] == []


def test_occupancy_uses_a_fixed_number_of_queries(librarian_client, school, grid, clock, django_assert_max_num_queries):
    clock(10, 10)
    make_slot(school, grid, section="a")
    librarian_client.get(f"{BASE}visits/occupancy/")
    with django_assert_max_num_queries(8):
        librarian_client.get(f"{BASE}visits/occupancy/")
    for n in range(6):
        cls = Class.objects.create(school=school, name=f"Grade {n + 6}")
        make_slot(school, grid, section=None, cls=cls, room=f"Room {n}")
        for k in range(3):
            Student.objects.create(school=school, admission_no=f"EX-{n}-{k}", first_name="E", gender="male", status="active", current_class=cls)
    with django_assert_max_num_queries(8):
        data = librarian_client.get(f"{BASE}visits/occupancy/").json()["data"]
    assert len(data["slots"]) == 7 and data["scheduled"] == 18


def test_footfall_groups_visits_by_class_and_lists_idle_classes(librarian_client, school, grid, clock):
    make_slot(school, grid, section="a")
    other = Class.objects.create(school=school, name="Grade 5")
    make_slot(school, grid, section=None, cls=other, room="Room 2", period=grid.later)
    members = [member_for(school, make_student(school, grid, grid.a, n), f"F-{n}") for n in range(3)]
    for member in members[:2]:
        periods.check_in(school, None, member=member, now=clock(10, 5))
    clock(11, 0)
    data = librarian_client.get(f"{BASE}visits/footfall/").json()["data"]
    assert data["total"] == 2 and data["from"] == "2026-10-05" and data["to"] == "2026-10-05"
    assert [(r["class_name"], r["visits"]) for r in data["results"]] == [("Grade 4", 2), ("Grade 5", 0)]
    empty = librarian_client.get(f"{BASE}visits/footfall/", {"from": "2026-09-01", "to": "2026-09-30"}).json()["data"]
    assert empty["total"] == 0
    assert librarian_client.get(f"{BASE}visits/footfall/", {"from": "nonsense"}).status_code == 400
    assert librarian_client.get(f"{BASE}visits/footfall/", {"from": "2026-10-09", "to": "2026-10-01"}).status_code == 400


def test_footfall_is_school_scoped(librarian_client, other_school, grid):
    foreign_class = Class.objects.create(school=other_school, name="Grade 1")
    foreign_period = ClassPeriod.objects.create(school=other_school, period="P", start_time=time(10, 0), end_time=time(10, 40))
    foreign_slot = PeriodSlot.objects.create(school=other_school, school_class=foreign_class, day="Mon", period=foreign_period)
    member = make_member(other_school, "FOREIGN-F", member_type="teacher")
    Visit.objects.create(school=other_school, period_slot=foreign_slot, member=member, visit_date=date(2026, 10, 5), checked_in_at=at(10, 5))
    data = librarian_client.get(f"{BASE}visits/footfall/", {"from": "2026-10-01", "to": "2026-10-09"}).json()["data"]
    assert data["total"] == 0 and data["results"] == []


# ---- console card -------------------------------------------------------------------------------------------------


def test_console_period_card_is_empty_then_filled_from_the_running_slot(librarian_client, school, grid, clock):
    make_slot(school, grid, section="a")
    make_student(school, grid, grid.a, 1)
    member = member_for(school, make_student(school, grid, grid.a, 2), "K-1")
    clock(9, 0)
    assert librarian_client.get(f"{BASE}console/summary/").json()["data"]["period"] == {}
    clock(10, 5)
    periods.check_in(school, None, member=member)
    card = librarian_client.get(f"{BASE}console/summary/").json()["data"]["period"]
    assert (card["checked_in"], card["scheduled"]) == (1, 2) and "Period 3" in card["label"]


# ---- due dates snap to a real slot ----------------------------------------------------------------------------


def test_student_due_date_now_snaps_to_the_classs_real_library_day(school, grid):
    make_slot(school, grid, section="a", day="Wed")
    settings = get_settings(school)
    pupil = member_for(school, make_student(school, grid, grid.a, 1), "DD-1")
    pupil = type(pupil).objects.select_related("student").get(pk=pupil.pk)
    due = compute_due_date(school, pupil, settings, date(2026, 10, 5))  # Monday + 10 days = Thursday 15th
    assert due.snapped is True and due.due_date == date(2026, 10, 21) and due.due_date.weekday() == 2


def test_due_date_ignores_other_sections_inactive_slots_and_non_students(school, grid):
    make_slot(school, grid, section="b", day="Wed")
    make_slot(school, grid, section="a", day="Thu", room="Room 2", is_active=False)
    settings = get_settings(school)
    pupil = type(member_for(school, make_student(school, grid, grid.a, 1), "DD-2")).objects.select_related("student").get(card_no="DD-2")
    flat = compute_due_date(school, pupil, settings, date(2026, 10, 5))
    assert flat.snapped is False and flat.due_date == date(2026, 10, 5) + timedelta(days=settings.flat_loan_days)
    teacher = make_member(school, "DD-T", member_type="teacher")
    assert compute_due_date(school, teacher, settings, date(2026, 10, 5)).snapped is False
    make_slot(school, grid, section=None, day="Fri", room="Room 3", period=grid.later)  # class-wide slot counts for section A
    assert compute_due_date(school, pupil, settings, date(2026, 10, 5)).snapped is True


# ---- unscanned flag -----------------------------------------------------------------------------------------------


def teacher_user(school, grid, section="a"):
    user = User.objects.create_user(username=f"ct_{uuid4().hex[:8]}", password="x", school=school)
    ClassTeacherAssignment.objects.create(school=school, school_class=grid.grade, section=getattr(grid, section) if section else None, teacher=user)
    return user


def run_flag(django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        return tasks.flag_unscanned_students()


def test_flag_task_notifies_the_class_teacher_once_per_slot_per_day(
    school, grid, clock, eager, pushes, django_capture_on_commit_callbacks
):
    slot = make_slot(school, grid, section="a")
    teacher = teacher_user(school, grid)
    present = member_for(school, make_student(school, grid, grid.a, 1), "U-1")
    for n in (2, 3):
        make_student(school, grid, grid.a, n)
    clock(10, 2)
    periods.check_in(school, None, member=present)

    clock(10, 4)  # started 4 minutes ago: not yet
    assert run_flag(django_capture_on_commit_callbacks) == {"flagged_slots": 0}
    assert not CommunicationNotification.objects.exists()

    clock(10, 6)  # more than 5 minutes
    assert run_flag(django_capture_on_commit_callbacks) == {"flagged_slots": 1}
    note = CommunicationNotification.objects.get()
    assert note.recipient == teacher and note.data["event"] == "unscanned_flag" and note.link_url == "/teacher/library"
    assert note.notification_type == "reminder" and "2 of 3" in note.body and "Grade 4 A" in note.body
    assert [p[0] for p in pushes] == [teacher.pk]
    marker = LibraryActivityLog.objects.get(event_type="reminder", metadata__action="unscanned_flag")
    assert marker.metadata["slot_id"] == slot.pk and marker.metadata["date"] == "2026-10-05" and marker.metadata["unscanned"] == 2

    clock(10, 20)  # later runs the same day do nothing
    assert run_flag(django_capture_on_commit_callbacks) == {"flagged_slots": 0}
    assert CommunicationNotification.objects.count() == 1 and len(pushes) == 1

    clock(10, 6, day=MONDAY + 7)  # next Monday is a new day
    assert run_flag(django_capture_on_commit_callbacks) == {"flagged_slots": 1}
    assert CommunicationNotification.objects.count() == 2


def test_flag_notification_carries_no_student_names_or_contact_details(school, grid, clock, eager, pushes, django_capture_on_commit_callbacks):
    make_slot(school, grid, section="a")
    teacher_user(school, grid)
    student = make_student(school, grid, grid.a, 1)
    clock(10, 6)
    run_flag(django_capture_on_commit_callbacks)
    note = CommunicationNotification.objects.get()
    marker = LibraryActivityLog.objects.get(metadata__action="unscanned_flag")
    for text in (note.title, note.body, marker.summary, str(marker.metadata), str(note.data)):
        assert student.first_name not in text and student.admission_no not in text


def test_flag_marks_the_slot_when_everyone_scanned_or_there_is_no_teacher_and_sends_nothing(
    school, grid, clock, eager, pushes, django_capture_on_commit_callbacks
):
    make_slot(school, grid, section="a")
    member = member_for(school, make_student(school, grid, grid.a, 1), "S-1")
    teacher_user(school, grid)
    periods.check_in(school, None, member=member, now=clock(10, 1))
    clock(10, 6)
    assert run_flag(django_capture_on_commit_callbacks) == {"flagged_slots": 1}
    assert not CommunicationNotification.objects.exists()
    assert LibraryActivityLog.objects.get(metadata__action="unscanned_flag").metadata["unscanned"] == 0

    make_slot(school, grid, section="b", room="Room 2")  # section B: students missing, no class teacher assigned
    make_student(school, grid, grid.b, 5)
    assert run_flag(django_capture_on_commit_callbacks) == {"flagged_slots": 1}
    assert not CommunicationNotification.objects.exists() and pushes == []
    assert LibraryActivityLog.objects.filter(metadata__action="unscanned_flag").count() == 2


def test_flag_skips_inactive_slots_sundays_and_other_days(school, grid, clock, django_capture_on_commit_callbacks):
    make_slot(school, grid, section="a", is_active=False)
    make_slot(school, grid, section="b", room="Room 2", day="Tue")
    clock(10, 6)
    assert run_flag(django_capture_on_commit_callbacks) == {"flagged_slots": 0}
    clock(10, 6, day=11)  # a Sunday
    assert run_flag(django_capture_on_commit_callbacks) == {"flagged_slots": 0}
    assert not LibraryActivityLog.objects.filter(metadata__action="unscanned_flag").exists()


def test_flag_honours_the_schools_own_threshold(school, grid, clock, django_capture_on_commit_callbacks):
    make_slot(school, grid, section="a")
    make_student(school, grid, grid.a, 1)
    settings = get_settings(school)
    settings.unscanned_flag_minutes = 15
    settings.save()
    clock(10, 10)
    assert run_flag(django_capture_on_commit_callbacks) == {"flagged_slots": 0}
    clock(10, 16)
    assert run_flag(django_capture_on_commit_callbacks) == {"flagged_slots": 1}


def test_flag_for_a_stale_event_is_dropped(school, grid):
    slot = make_slot(school, grid, section="a")
    teacher = teacher_user(school, grid)
    ids = {"slot_id": slot.pk, "date": "2026-10-05", "teacher_id": teacher.pk}
    assert notifications.deliver_event(school.pk, "unscanned_flag", ids) == {"status": "stale"}  # nobody is missing
    assert notifications.deliver_event(school.pk, "unscanned_flag", {**ids, "teacher_id": 999999}) == {"status": "stale"}


# ---- beat command -------------------------------------------------------------------------------------------------


def test_register_command_is_idempotent_through_update_or_create(monkeypatch):
    calls = []

    class FakeManager:
        def __init__(self, name):
            self.name = name

        def get_or_create(self, **kwargs):
            calls.append((self.name, "get_or_create", kwargs))
            return SimpleNamespace(pk=1), False

        def update_or_create(self, name, defaults):
            calls.append((self.name, "update_or_create", name, defaults))
            return SimpleNamespace(), len([c for c in calls if c[1] == "update_or_create"]) == 1

    interval = SimpleNamespace(objects=FakeManager("interval"), MINUTES="minutes")
    task = SimpleNamespace(objects=FakeManager("task"))
    monkeypatch.setattr(beat_command, "beat_models", lambda: (interval, task))
    from django.core.management import call_command

    call_command("library_register_periodic_tasks")
    call_command("library_register_periodic_tasks")
    updates = [c for c in calls if c[1] == "update_or_create"]
    assert len(updates) == 2 and updates[0][2] == updates[1][2] == "library-flag-unscanned-students"
    assert updates[0][3]["task"] == "library.flag_unscanned_students" and updates[0][3]["enabled"] is True
    assert ("interval", "get_or_create", {"every": 1, "period": "minutes"}) in calls


def test_register_command_explains_when_the_beat_app_is_not_installed():
    from django.core.management import call_command

    with pytest.raises(CommandError, match="django_celery_beat"):
        call_command("library_register_periodic_tasks")


def test_the_default_beat_schedule_carries_the_same_entry():
    from config.celery import app

    entry = app.conf.beat_schedule["library-flag-unscanned-students"]
    assert entry["task"] == "library.flag_unscanned_students" and entry["schedule"] == 60.0


# ---- permissions --------------------------------------------------------------------------------------------------


MATRIX = [
    ("library.periods.view", "get", lambda c: SLOTS, None),
    ("library.periods.view", "get", lambda c: f"{SLOTS}week/", None),
    ("library.periods.view", "get", lambda c: f"{SLOTS}current/", None),
    ("library.periods.view", "get", lambda c: f"{SLOTS}prep-briefing/", None),
    ("library.periods.view", "get", lambda c: f"{BASE}visits/occupancy/", None),
    ("library.periods.view", "get", lambda c: f"{BASE}visits/footfall/", None),
    ("library.periods.manage", "post", lambda c: SLOTS, lambda c: payload(c["grid"], room_label="Matrix Room")),
    ("library.periods.manage", "patch", lambda c: f"{SLOTS}{c['slot']}/", {"is_active": True}),
    ("library.periods.manage", "delete", lambda c: f"{SLOTS}{c['spare']}/", None),
    ("library.visits.check_in", "post", lambda c: f"{BASE}visits/check-in/", {"card_no": "NO-SUCH-CARD"}),
]


@pytest.mark.parametrize("index", range(len(MATRIX)))
def test_each_door_opens_for_its_own_code_and_for_no_other(school, grid, index):
    code, method, build, body = MATRIX[index]
    slot = make_slot(school, grid, section="a", room="Matrix A")
    spare = make_slot(school, grid, section="b", room="Matrix B", period=grid.later)
    ctx = {"grid": grid, "slot": slot.pk, "spare": spare.pk}
    url = build(ctx)
    body = body(ctx) if callable(body) else body

    def call(client):
        return getattr(client, method)(url, body, format="json") if body is not None else getattr(client, method)(url)

    assert call(client_for(make_user(school, [code]))).status_code != 403, code
    others = sorted({c for c, *_ in MATRIX if c != code})
    assert call(client_for(make_user(school, others))).status_code == 403, code


def test_a_user_with_no_library_code_is_refused_by_every_period_endpoint(school, grid):
    slot = make_slot(school, grid, section="a")
    nobody = client_for(make_user(school, []))
    for _code, method, build, body in MATRIX:
        ctx = {"grid": grid, "slot": slot.pk, "spare": slot.pk}
        body = body(ctx) if callable(body) else body
        url = build(ctx)
        resp = getattr(nobody, method)(url, body, format="json") if body is not None else getattr(nobody, method)(url)
        assert resp.status_code == 403, url
