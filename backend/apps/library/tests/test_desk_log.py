"""Today at the Desk log, and the undo deadline the return response carries."""
from datetime import datetime, timedelta

import pytest
from django.utils import timezone

from apps.library.models import LibraryActivityLog
from apps.library.services.activity import log_event
from apps.library.services.settings import get_settings
from apps.library.tests.conftest import client_for, make_book, make_member, make_user

LOG = "/api/v1/library/issues/desk-log/"
ISSUES = "/api/v1/library/issues/"


@pytest.fixture
def staff_member(school):
    return make_member(school, "ST-1", member_type="staff")


def backdate(row, days):
    LibraryActivityLog.objects.filter(pk=row.pk).update(created_at=timezone.now() - timedelta(days=days))


def test_log_lists_todays_desk_events_newest_first(librarian_client, school, book, staff_member):
    loan = librarian_client.post(f"{ISSUES}issue/", {"member": staff_member.pk, "book": book.pk}, format="json").json()["data"]["loan"]
    librarian_client.post(f"{ISSUES}{loan['id']}/renew/")
    librarian_client.post(f"{ISSUES}{loan['id']}/return/")
    body = librarian_client.get(LOG).json()
    assert body["success"] is True and body["data"] == body["results"]
    assert [r["event_type"] for r in body["results"]] == ["return", "renewal", "issue"]
    assert body["counts"] == {"issue": 1, "return": 1, "renewal": 1, "lost": 0, "damaged": 0} and body["count"] == 3
    row = body["results"][0]
    assert {"id", "event_type", "summary", "created_at", "actor_name", "issue"} <= set(row)
    assert row["issue"] == loan["id"] and "Returned" in row["summary"]


def test_log_ignores_other_event_types_and_other_days(librarian_client, librarian, school, book, staff_member):
    old = log_event(school, librarian, "issue", "Issued yesterday")
    backdate(old, 1)
    log_event(school, librarian, "member", "Registered someone")
    log_event(school, librarian, "hold", "Hold placed")
    log_event(school, librarian, "settings", "Settings changed")
    mine = log_event(school, librarian, "issue", "Issued today")
    rows = librarian_client.get(LOG).json()["results"]
    assert [r["id"] for r in rows] == [mine.pk]


def test_returns_with_a_lost_or_damaged_report_show_in_the_log(librarian_client, school, book, staff_member):
    loan = librarian_client.post(f"{ISSUES}issue/", {"member": staff_member.pk, "book": book.pk}, format="json").json()["data"]["loan"]
    librarian_client.post(f"{ISSUES}{loan['id']}/return/", {"report": {"type": "damaged", "notes": "Wet"}}, format="json")
    types = [r["event_type"] for r in librarian_client.get(LOG).json()["results"]]
    assert "damaged" in types and "return" not in types


def test_log_is_school_scoped(librarian_client, admin_user, other_admin, school, other_school, librarian):
    log_event(school, librarian, "issue", "Mine")
    log_event(other_school, other_admin, "issue", "Theirs")
    mine = librarian_client.get(LOG).json()
    assert [r["summary"] for r in mine["results"]] == ["Mine"] and mine["count"] == 1
    theirs = client_for(other_admin).get(LOG).json()
    assert [r["summary"] for r in theirs["results"]] == ["Theirs"]
    from django.contrib.auth import get_user_model

    root = get_user_model().objects.create_superuser(username="root_log", password="x", school=school)
    assert [r["summary"] for r in client_for(root).get(LOG).json()["results"]] == ["Mine"]


def test_log_names_the_actor_or_leaves_it_blank_for_system_events(librarian_client, librarian, school):
    log_event(school, librarian, "issue", "By a person")
    log_event(school, None, "return", "By the system")
    names = {r["summary"]: r["actor_name"] for r in librarian_client.get(LOG).json()["results"]}
    assert names["By a person"] == librarian.username and names["By the system"] == ""


def test_log_is_capped_at_100_rows_but_counts_everything(librarian_client, librarian, school):
    for number in range(105):
        log_event(school, librarian, "issue", f"Issue {number}")
    body = librarian_client.get(LOG).json()
    assert len(body["results"]) == 100 and body["count"] == 105 and body["counts"]["issue"] == 105


def test_log_query_count_is_bounded(librarian_client, librarian, school, django_assert_max_num_queries):
    for number in range(40):
        log_event(school, librarian, ("issue", "return", "renewal")[number % 3], f"Event {number}")
    with django_assert_max_num_queries(6):
        assert len(librarian_client.get(LOG).json()["results"]) == 40


def test_log_needs_the_issue_view_code(school, librarian):
    log_event(school, librarian, "issue", "x")
    assert client_for(make_user(school, ["library.book_issues.view"])).get(LOG).status_code == 200
    assert client_for(make_user(school, ["library.reports.view"])).get(LOG).status_code == 403
    assert client_for(make_user(school, ["library.activity_logs.view"])).get(LOG).status_code == 403


def test_log_requires_authentication(api_client):
    assert api_client.get(LOG).status_code == 401


# ---- undo deadline -------------------------------------------------------------------------------------------


def test_return_response_carries_the_undo_deadline(librarian_client, school, book, staff_member):
    loan = librarian_client.post(f"{ISSUES}issue/", {"member": staff_member.pk, "book": book.pk}, format="json").json()["data"]["loan"]
    before = timezone.now()
    data = librarian_client.post(f"{ISSUES}{loan['id']}/return/").json()["data"]
    expires = datetime.fromisoformat(data["undo_expires_at"].replace("Z", "+00:00"))
    assert before + timedelta(minutes=10) <= expires <= timezone.now() + timedelta(minutes=10)


def test_the_undo_deadline_follows_the_setting(librarian_client, school, book, staff_member):
    settings = get_settings(school)
    settings.undo_return_minutes = 2
    settings.save()
    loan = librarian_client.post(f"{ISSUES}issue/", {"member": staff_member.pk, "book": book.pk}, format="json").json()["data"]["loan"]
    expires = datetime.fromisoformat(librarian_client.post(f"{ISSUES}{loan['id']}/return/").json()["data"]["undo_expires_at"].replace("Z", "+00:00"))
    assert expires - timezone.now() <= timedelta(minutes=2)


def test_no_undo_deadline_when_a_report_was_filed(librarian_client, school, category, staff_member):
    book = make_book(school, category, title="Torn")
    loan = librarian_client.post(f"{ISSUES}issue/", {"member": staff_member.pk, "book": book.pk}, format="json").json()["data"]["loan"]
    data = librarian_client.post(f"{ISSUES}{loan['id']}/return/", {"report": {"type": "lost"}}, format="json").json()["data"]
    assert data["undo_expires_at"] is None
