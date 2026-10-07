"""services.activity.log_event"""
import pytest

from apps.library.models import LibraryActivityLog
from apps.library.services.activity import log_event


def test_log_event_writes_a_row_with_references(school, admin_user, book, member):
    row = log_event(
        school, admin_user, "issue", "Issued Treasure Island to member CARD-001", book=book, member=member,
        metadata={"book_id": book.pk, "amount": "0.00"},
    )
    saved = LibraryActivityLog.objects.get(pk=row.pk)
    assert saved.school_id == school.id and saved.actor_id == admin_user.pk
    assert saved.created_by_id == admin_user.pk and saved.updated_by_id == admin_user.pk
    assert saved.event_type == "issue" and saved.book_id == book.pk and saved.member_id == member.pk
    assert saved.issue_id is None and saved.metadata == {"book_id": book.pk, "amount": "0.00"}


def test_actor_may_be_none_for_system_events(school):
    row = log_event(school, None, "reminder", "Nightly reminder run")
    assert row.actor_id is None and row.metadata == {}


def test_unknown_event_type_is_rejected(school, admin_user):
    with pytest.raises(ValueError):
        log_event(school, admin_user, "teleport", "nope")
    assert LibraryActivityLog.objects.count() == 0


def test_unknown_reference_is_rejected(school, admin_user):
    with pytest.raises(TypeError):
        log_event(school, admin_user, "issue", "x", student=1)


def test_reference_from_another_school_is_rejected(school, admin_user, other_book):
    with pytest.raises(ValueError):
        log_event(school, admin_user, "issue", "x", book=other_book)
    assert LibraryActivityLog.objects.filter(school=school).count() == 0


def test_summary_is_truncated_to_the_column_width(school, admin_user):
    row = log_event(school, admin_user, "member", "x" * 900)
    assert len(LibraryActivityLog.objects.get(pk=row.pk).summary) == 500


def test_every_blueprint_event_type_is_accepted(school, admin_user):
    expected = {
        "accession", "issue", "return", "renewal", "lost", "damaged", "fine", "donation", "purchase",
        "member", "hold", "request", "reminder", "audit", "settings", "export",
    }
    assert {value for value, _ in LibraryActivityLog.EVENT_CHOICES} == expected
    for event in expected:
        log_event(school, admin_user, event, event)
    assert LibraryActivityLog.objects.filter(school=school).count() == len(expected)
