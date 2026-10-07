"""Library error codes (blueprint 2.3).

Each class subclasses a core exception and only sets ``default_code``,
``default_detail`` and (through the parent) ``status_code``. Raise with the
code's own message, or pass ``detail`` and ``extra_data`` for the payload:

    raise LibraryMemberSuspended(extra_data={"amount_due": "350.00"})

The central handler (config/exception_handler.py) renders these through
``get_response_data`` as ``{success: false, error: {code, message, **extra}}``.
"""

from apps.core.exceptions import ConflictError, ValidationError


class LibraryMemberSuspended(ConflictError):
    default_code = "library_member_suspended"
    default_detail = "Pending fines or replacement fees block borrowing."


class LibraryLimitReached(ConflictError):
    default_code = "library_limit_reached"
    default_detail = "The member has reached their borrowing limit."


class LibraryCopyUnavailable(ConflictError):
    default_code = "library_copy_unavailable"
    default_detail = "No copy of this title is available to issue."


class LibraryReferenceOnly(ValidationError):
    default_code = "library_reference_only"
    default_detail = "This title is reference only and cannot be issued for home use."


class LibraryNotEligibleAudience(ValidationError):
    default_code = "library_not_eligible_audience"
    default_detail = "This title is not open to this type of member."


class LibraryRenewalCap(ConflictError):
    default_code = "library_renewal_cap"
    default_detail = "The renewal limit for this loan has been reached."


class LibraryHoldExists(ConflictError):
    default_code = "library_hold_exists"
    default_detail = "Another member is waiting for this title, so it cannot be renewed."


class LibraryLoanOverdue(ConflictError):
    default_code = "library_loan_overdue"
    default_detail = "An overdue loan cannot be renewed. Return it, settle the fine, then issue again."


class LibraryReminderAlreadySent(ConflictError):
    default_code = "library_reminder_already_sent"
    default_detail = "A reminder for this loan has already been sent today."


class LibraryAlreadyReturned(ConflictError):
    default_code = "library_already_returned"
    default_detail = "This loan is already closed."


class LibraryUndoExpired(ConflictError):
    default_code = "library_undo_expired"
    default_detail = "The undo window has passed or the copy was issued again."


class LibraryCategoryInactive(ValidationError):
    default_code = "library_category_inactive"
    default_detail = "An inactive category cannot be used for a new title."


class LibraryAuditInProgress(ConflictError):
    default_code = "library_audit_in_progress"
    default_detail = "A stock check is already open for this scope."


class LibraryInvalidStateTransition(ConflictError):
    default_code = "library_invalid_state_transition"
    default_detail = "This status change is not allowed."


class LibraryHasHistory(ConflictError):
    default_code = "library_has_history"
    default_detail = "This record has history and cannot be deleted. Deactivate or withdraw it instead."


LIBRARY_ERRORS = (
    LibraryMemberSuspended,
    LibraryLimitReached,
    LibraryCopyUnavailable,
    LibraryReferenceOnly,
    LibraryNotEligibleAudience,
    LibraryRenewalCap,
    LibraryHoldExists,
    LibraryLoanOverdue,
    LibraryReminderAlreadySent,
    LibraryAlreadyReturned,
    LibraryUndoExpired,
    LibraryCategoryInactive,
    LibraryAuditInProgress,
    LibraryInvalidStateTransition,
    LibraryHasHistory,
)
