"""Library error codes (blueprint 2.3)."""
import pytest
from rest_framework import status

from apps.core.exceptions import ConflictError, ValidationError
from apps.library import exceptions as lib

EXPECTED = {
    "library_member_suspended": (lib.LibraryMemberSuspended, 409),
    "library_limit_reached": (lib.LibraryLimitReached, 409),
    "library_copy_unavailable": (lib.LibraryCopyUnavailable, 409),
    "library_reference_only": (lib.LibraryReferenceOnly, 400),
    "library_not_eligible_audience": (lib.LibraryNotEligibleAudience, 400),
    "library_renewal_cap": (lib.LibraryRenewalCap, 409),
    "library_hold_exists": (lib.LibraryHoldExists, 409),
    "library_loan_overdue": (lib.LibraryLoanOverdue, 409),
    "library_reminder_already_sent": (lib.LibraryReminderAlreadySent, 409),
    "library_already_returned": (lib.LibraryAlreadyReturned, 409),
    "library_undo_expired": (lib.LibraryUndoExpired, 409),
    "library_category_inactive": (lib.LibraryCategoryInactive, 400),
    "library_audit_in_progress": (lib.LibraryAuditInProgress, 409),
    "library_invalid_state_transition": (lib.LibraryInvalidStateTransition, 409),
    "library_has_history": (lib.LibraryHasHistory, 409),
}


def test_all_fifteen_codes_are_defined_once():
    assert len(EXPECTED) == 15
    assert {cls.default_code for cls in lib.LIBRARY_ERRORS} == set(EXPECTED)
    assert len(lib.LIBRARY_ERRORS) == 15


@pytest.mark.parametrize("code", sorted(EXPECTED))
def test_code_status_and_parent(code):
    cls, http_status = EXPECTED[code]
    exc = cls()
    assert exc.status_code == http_status
    assert issubclass(cls, ConflictError if http_status == 409 else ValidationError)
    body = exc.get_response_data()
    assert body["success"] is False
    assert body["error"]["code"] == code and body["error"]["message"]


def test_payload_can_carry_the_amount_owed():
    exc = lib.LibraryMemberSuspended(extra_data={"amount_due": "350.00"})
    assert exc.get_response_data()["error"] == {
        "code": "library_member_suspended",
        "message": lib.LibraryMemberSuspended.default_detail,
        "amount_due": "350.00",
    }
    assert exc.status_code == status.HTTP_409_CONFLICT


def test_custom_message_is_kept():
    assert lib.LibraryCopyUnavailable("Gone").get_response_data()["error"]["message"] == "Gone"


def test_central_handler_renders_the_code_and_status(school):
    from config.exception_handler import custom_exception_handler

    response = custom_exception_handler(lib.LibraryLimitReached(), {})
    assert response.status_code == 409
    assert response.data["error"]["code"] == "library_limit_reached"
