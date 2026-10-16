"""Circulation: issue, bulk issue, return, renew, undo, holds, lost and damaged reports.

Rules (blueprint 3.1, 4.5):
* Every function runs in one ``transaction.atomic()`` and takes `school` and `actor` explicitly.
* Locks are always taken in the same order: copy, then member, then loan. That keeps two desks from
  deadlocking and makes the copy row the arbiter of "who gets the last copy".
* Money and dates are computed here from the settings, never read from a client.
* Each action writes exactly one activity row inside the same transaction.
* No notification is sent here (prompt 7). `hold_queue_count` is returned so the caller can.
"""
from dataclasses import dataclass
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError as FieldValidationError

from apps.core.exceptions import PermissionDenied, ResourceNotFound
from apps.core.models import Class, Section
from apps.library.exceptions import (
    LibraryAlreadyReturned,
    LibraryCopyUnavailable,
    LibraryHoldExists,
    LibraryInvalidStateTransition,
    LibraryLimitReached,
    LibraryLoanOverdue,
    LibraryMemberSuspended,
    LibraryNotEligibleAudience,
    LibraryReferenceOnly,
    LibraryRenewalCap,
    LibraryUndoExpired,
)
from apps.library.models import (
    Book,
    BookCopy,
    BookIssue,
    Charge,
    Hold,
    LibraryActivityLog,
    LibraryMember,
    LostDamagedReport,
)

from . import charges as charges_service
from . import notifications
from .activity import log_event
from .due_dates import compute_due_date
from .dues import ZERO, borrowing_limit, loan_fine, replacement_cost
from .members import dues_for_member, holding_member_ids, person_name, receipt_number
from .settings import get_settings

WAIVE_CODE = "library.book_issues.waive_fine"
MAX_BULK_MEMBERS = 200
FINE_ACTIONS = ("collect", "waive")

# Library errors a bulk issue turns into a per-member "skipped" reason instead of failing the batch.
SKIP_REASONS = {
    LibraryMemberSuspended: "suspended",
    LibraryLimitReached: "limit_reached",
    LibraryNotEligibleAudience: "not_eligible_audience",
    LibraryReferenceOnly: "reference_only",
    LibraryCopyUnavailable: "no_copy_left",
    LibraryInvalidStateTransition: "inactive",
}


# ---- locking helpers --------------------------------------------------------------------------


def _locked_copy(school, copy_id):
    try:
        return BookCopy.objects.select_for_update(of=("self",)).select_related("book").get(pk=copy_id, school=school)
    except BookCopy.DoesNotExist:
        raise ResourceNotFound("Copy not found.")


def _locked_member(school, member_id):
    try:
        return LibraryMember.objects.select_for_update(of=("self",)).select_related("student", "staff").get(pk=member_id, school=school)
    except LibraryMember.DoesNotExist:
        raise ResourceNotFound("Member not found.")


def _locked_loan(school, loan_id):
    try:
        return BookIssue.objects.select_for_update(of=("self",)).select_related("book", "copy").get(pk=loan_id, school=school)
    except BookIssue.DoesNotExist:
        raise ResourceNotFound("Loan not found.")


def _get_book(school, book_id):
    book = Book.objects.filter(pk=book_id, school=school).first()
    if book is None:
        raise ResourceNotFound("Title not found.")
    return book


def hold_queue_count(school, book_id):
    return Hold.objects.filter(school=school, book_id=book_id, status=Hold.STATUS_WAITING).count()


def _touch(instance, actor, *fields):
    instance.updated_by = actor
    instance.save(update_fields=[*fields, "updated_by", "updated_at"])


# ---- issue ---------------------------------------------------------------------------------------


@dataclass
class IssueResult:
    loan: BookIssue
    due_note: dict


def _pick_and_lock_copy(school, copy_id, book_id):
    """Lock the named copy, or the first available copy of the title. The copy must still be available once locked."""
    if copy_id is not None:
        copy = _locked_copy(school, copy_id)
        if copy.status != BookCopy.STATUS_AVAILABLE:
            raise LibraryCopyUnavailable()
        return copy
    _get_book(school, book_id)
    # Lock candidates one at a time and re-check the status after the lock is granted: on PostgreSQL a
    # waiter can be handed a row that another desk just issued, so one failure is not "no copy".
    candidates = list(
        BookCopy.objects.filter(school=school, book_id=book_id, status=BookCopy.STATUS_AVAILABLE)
        .order_by("id")
        .values_list("id", flat=True)[:5]
    )
    for candidate in candidates:
        copy = _locked_copy(school, candidate)
        if copy.status == BookCopy.STATUS_AVAILABLE:
            return copy
    raise LibraryCopyUnavailable()


def _issue_locked(school, actor, copy, member, settings, today):
    """Checks R1 to R3 and creates the loan. `copy` and `member` are already locked."""
    book = copy.book
    if not member.is_active:
        raise LibraryInvalidStateTransition("This member is inactive.")
    if book.is_reference_only:
        raise LibraryReferenceOnly()
    allowed = {"student": book.for_students, "teacher": book.for_teachers, "staff": book.for_staff}[member.member_type]
    if not allowed:
        raise LibraryNotEligibleAudience()
    dues = dues_for_member(school, member, settings, today)
    if dues.suspended:
        raise LibraryMemberSuspended(extra_data={"amount_due": str(dues.overdue_fines + dues.replacement_fees)})
    limit = borrowing_limit(member.member_type, settings)
    active = BookIssue.objects.filter(member=member, status=BookIssue.STATUS_ISSUED).count()
    if active >= limit:
        raise LibraryLimitReached(extra_data={"limit": limit, "active_loans": active})

    due = compute_due_date(school, member, settings, today)
    try:
        with transaction.atomic():  # savepoint: a lost race on the partial unique index must not poison the outer transaction
            loan = BookIssue.objects.create(
                school=school,
                book=book,
                copy=copy,
                member=member,
                issue_date=today,
                due_date=due.due_date,
                status=BookIssue.STATUS_ISSUED,
                issued_by=actor,
                created_by=actor,
                updated_by=actor,
            )
    except IntegrityError:
        raise LibraryCopyUnavailable()
    copy.status = BookCopy.STATUS_ISSUED
    _touch(copy, actor, "status")

    hold = Hold.objects.select_for_update().filter(school=school, book=book, member=member, status=Hold.STATUS_WAITING).first()
    if hold is not None:
        hold.status, hold.fulfilled_issue = Hold.STATUS_FULFILLED, loan
        _touch(hold, actor, "status", "fulfilled_issue")

    log_event(
        school, actor, LibraryActivityLog.EVENT_ISSUE,
        f"Issued {book.title} ({copy.code}) to {person_name(member)}, due {due.due_date.isoformat()}",
        book=book, copy=copy, member=member, issue=loan,
        metadata={"loan_id": loan.pk, "due_date": due.due_date.isoformat(), "snapped": due.snapped, "hold_fulfilled": hold is not None},
    )
    return IssueResult(loan, {"due_date": due.due_date, "snapped": due.snapped, "note": due.note})


@transaction.atomic
def issue_copy(school, actor, *, member_id, copy_id=None, book_id=None, today=None):
    """Issue one copy (named, or the first available of a title) to a member."""
    if (copy_id is None) == (book_id is None):
        raise FieldValidationError({"copy": "Give either a copy or a book."})
    settings = get_settings(school)
    today = today or timezone.localdate()
    copy = _pick_and_lock_copy(school, copy_id, book_id)
    member = _locked_member(school, member_id)
    return _issue_locked(school, actor, copy, member, settings, today)


def _block_reason(school, member, book, settings, today, holding):
    """Why `member` cannot be issued `book` right now, as a reason code, or None. Does not look at copies."""
    if not member.is_active:
        return "inactive"
    if dues_for_member(school, member, settings, today).suspended:
        return "suspended"
    if BookIssue.objects.filter(member=member, status=BookIssue.STATUS_ISSUED).count() >= borrowing_limit(member.member_type, settings):
        return "limit_reached"
    if book.is_reference_only:
        return "reference_only"
    if not {"student": book.for_students, "teacher": book.for_teachers, "staff": book.for_staff}[member.member_type]:
        return "not_eligible_audience"
    if member.pk in holding:
        return "already_holding"
    return None


@transaction.atomic
def bulk_issue(school, actor, *, book_id, school_class_id, section_id=None, member_ids=None, today=None):
    """Issue one title to a class roster (R9). The server re-evaluates eligibility for every member.

    Returns {"issued": [loan, ...], "skipped": [{"member", "reason"}]}. Members are issued one at a
    time, each in its own savepoint, until the copies run out; the rest are skipped as no_copy_left.
    """
    book = _get_book(school, book_id)
    school_class = Class.objects.filter(pk=school_class_id, school=school).first()
    if school_class is None:
        raise FieldValidationError({"school_class": "Invalid class."})
    roster = LibraryMember.objects.filter(
        school=school, member_type=LibraryMember.MEMBER_STUDENT, is_active=True, student__current_class_id=school_class.pk
    )
    if section_id is not None:
        if not Section.objects.filter(pk=section_id, school_class=school_class).exists():
            raise FieldValidationError({"section": "This section does not belong to the class."})
        roster = roster.filter(student__current_section_id=section_id)
    members = list(roster.select_related("student").order_by("student__first_name", "student__last_name", "id"))
    if member_ids is not None:
        if len(member_ids) > MAX_BULK_MEMBERS:
            raise FieldValidationError({"member_ids": f"At most {MAX_BULK_MEMBERS} members at a time."})
        wanted = set(member_ids)
        unknown = wanted - {m.pk for m in members}
        if unknown:
            raise FieldValidationError({"member_ids": "Every member must be an active student member of this class."})
        members = [m for m in members if m.pk in wanted]

    today = today or timezone.localdate()
    holding = holding_member_ids(book, [m.pk for m in members])
    settings = get_settings(school)
    issued, skipped = [], []
    out_of_copies = False
    for member in members:
        # Judge the member first: a suspended member is "suspended" even when the copies have run out.
        reason = _block_reason(school, member, book, settings, today, holding)
        if reason:
            skipped.append({"member": member.pk, "reason": reason})
            continue
        if out_of_copies:
            skipped.append({"member": member.pk, "reason": "no_copy_left"})
            continue
        try:
            with transaction.atomic():
                result = issue_copy(school, actor, member_id=member.pk, book_id=book.pk, today=today)
        except tuple(SKIP_REASONS) as error:
            reason = SKIP_REASONS[type(error)]
            skipped.append({"member": member.pk, "reason": reason})
            out_of_copies = out_of_copies or reason == "no_copy_left"
            continue
        issued.append(result.loan)
    return {"issued": issued, "skipped": skipped}


# ---- lost and damaged reports ----------------------------------------------------------------------


def _new_report(school, actor, *, copy, member, issue, report_type, notes, source, settings, today):
    """Create the report and, when someone is to blame, its replacement charge. Idempotent per open copy."""
    existing = LostDamagedReport.objects.filter(school=school, copy=copy, resolution=LostDamagedReport.RESOLUTION_PENDING).first()
    if existing is not None:
        return existing, existing.charges.filter(charge_type=Charge.TYPE_REPLACEMENT).first(), False
    cost = replacement_cost(copy.book.cost_per_copy, settings.replacement_processing_fee, settings.replacement_default_cost)
    report = LostDamagedReport.objects.create(
        school=school, book=copy.book, copy=copy, member=member, issue=issue, report_type=report_type,
        reported_on=today, reported_by=actor, source=source, notes=notes or "", replacement_cost=cost,
        created_by=actor, updated_by=actor,
    )
    charge = None
    if member is not None:
        charge = Charge.objects.create(
            school=school, member=member, charge_type=Charge.TYPE_REPLACEMENT, amount=cost, issue=issue, report=report,
            assessed_on=today, created_by=actor, updated_by=actor,
        )
    return report, charge, True


def _set_copy_for_report(copy, actor, report_type):
    copy.status = BookCopy.STATUS_LOST if report_type == LostDamagedReport.TYPE_LOST else BookCopy.STATUS_DAMAGED
    fields = ["status"]
    if report_type == LostDamagedReport.TYPE_DAMAGED:
        copy.condition = BookCopy.CONDITION_DAMAGED
        fields.append("condition")
    _touch(copy, actor, *fields)


def _check_report_type(report_type):
    if report_type not in (LostDamagedReport.TYPE_LOST, LostDamagedReport.TYPE_DAMAGED):
        raise FieldValidationError({"report_type": "Use lost or damaged."})


@transaction.atomic
def create_report(school, actor, *, copy_id, report_type, member_id=None, issue_id=None, notes="", source=LostDamagedReport.SOURCE_MANUAL, today=None):
    """Report a copy lost or damaged outside the return desk. Returns (report, charge, created).

    Repeating it for a copy that already has an open report returns that report and creates nothing.
    A copy that is out on loan must go through the return desk, so the loan is closed with it.
    """
    _check_report_type(report_type)
    settings = get_settings(school)
    today = today or timezone.localdate()
    copy = _locked_copy(school, copy_id)
    member = _locked_member(school, member_id) if member_id is not None else None
    issue = None
    if issue_id is not None:
        issue = BookIssue.objects.filter(pk=issue_id, school=school).first()
        if issue is None:
            raise FieldValidationError({"issue": "Invalid loan."})
        if issue.copy_id != copy.pk or (member is not None and issue.member_id != member.pk):
            raise FieldValidationError({"issue": "This loan does not match the copy and member."})
        member = member or _locked_member(school, issue.member_id)

    existing = LostDamagedReport.objects.filter(school=school, copy=copy, resolution=LostDamagedReport.RESOLUTION_PENDING).first()
    if existing is not None:
        return existing, existing.charges.filter(charge_type=Charge.TYPE_REPLACEMENT).first(), False
    if copy.status == BookCopy.STATUS_ISSUED:
        raise LibraryInvalidStateTransition("This copy is out on loan. Return it with a lost or damaged report instead.")
    if copy.status == BookCopy.STATUS_WITHDRAWN:
        raise LibraryInvalidStateTransition("This copy has been withdrawn.")
    if copy.status == report_type:
        raise LibraryInvalidStateTransition(f"This copy is already marked {copy.status}.")

    report, charge, _created = _new_report(
        school, actor, copy=copy, member=member, issue=issue, report_type=report_type, notes=notes, source=source,
        settings=settings, today=today,
    )
    _set_copy_for_report(copy, actor, report_type)
    log_event(
        school, actor, LibraryActivityLog.EVENT_LOST if report_type == "lost" else LibraryActivityLog.EVENT_DAMAGED,
        f"Reported {copy.code} ({copy.book.title}) {report_type}" + (f" for {person_name(member)}" if member else ""),
        book=copy.book, copy=copy, member=member, issue=issue,
        metadata={"report_id": report.pk, "replacement_cost": str(report.replacement_cost), "source": source},
    )
    if charge is not None:
        notifications.enqueue_event(school.id, notifications.EVENT_REPLACEMENT_FEE, {"report_id": report.pk})
    return report, charge, True


@transaction.atomic
def mark_fee_paid(school, actor, report_id, receipt_no=""):
    """The report's replacement charge goes pending to paid."""
    report = LostDamagedReport.objects.filter(pk=report_id, school=school).first()
    if report is None:
        raise ResourceNotFound("Report not found.")
    charge = report.charges.filter(charge_type=Charge.TYPE_REPLACEMENT).first()
    if charge is None:
        raise LibraryInvalidStateTransition("This report has no fee to collect.")
    return charges_service.collect_charge(school, actor, charge.pk, receipt_no)


@transaction.atomic
def resolve_report(school, actor, report_id):
    """Close a report once its fee is paid or waived (or it never had one)."""
    try:
        report = LostDamagedReport.objects.select_for_update().select_related("book", "copy").get(pk=report_id, school=school)
    except LostDamagedReport.DoesNotExist:
        raise ResourceNotFound("Report not found.")
    if report.resolution != LostDamagedReport.RESOLUTION_PENDING:
        raise LibraryInvalidStateTransition("This report is already resolved.")
    if report.charges.filter(status=Charge.STATUS_PENDING).exists():
        raise LibraryInvalidStateTransition("Collect or waive the replacement fee before resolving this report.")
    report.resolution, report.resolved_at = LostDamagedReport.RESOLUTION_RESOLVED, timezone.now()
    _touch(report, actor, "resolution", "resolved_at")
    log_event(
        school, actor, LibraryActivityLog.EVENT_LOST if report.report_type == "lost" else LibraryActivityLog.EVENT_DAMAGED,
        f"Resolved {report.report_type} report for {report.copy.code} ({report.book.title})",
        book=report.book, copy=report.copy, member=report.member, issue=report.issue,
        metadata={"report_id": report.pk, "action": "resolve"},
    )
    return report


def report_bill(school, report):
    """Plain data for the printed replacement bill."""
    charge = report.charges.filter(charge_type=Charge.TYPE_REPLACEMENT).first()
    return {
        "report_id": report.pk,
        "report_type": report.report_type,
        "reported_on": report.reported_on,
        "title": report.book.title,
        "accession_code": report.book.accession_code,
        "copy_code": report.copy.code,
        "member_name": person_name(report.member) if report.member_id else "",
        "card_no": report.member.card_no if report.member_id else "",
        "replacement_cost": str(report.replacement_cost),
        "charge_status": charge.status if charge else "none",
        "receipt_no": charge.receipt_no if charge else "",
        "notes": report.notes,
    }


# ---- return --------------------------------------------------------------------------------------------


@transaction.atomic
def return_loan(school, actor, loan_id, *, fine_action="", waive_reason="", condition="", report=None, today=None):
    """Close a loan. The server computes the fine and the return date; the client only chooses collect or waive.

    A fine due needs `fine_action`; waiving needs the waive permission and a reason. `report`
    ({"type": "lost" or "damaged", "notes"}) records a lost or damaged copy with its replacement
    charge. A lost report closes the loan as lost and assesses no fine (the replacement fee covers
    it); a damaged one returns the loan, assesses the normal fine and bills the replacement.

    Returns {"loan", "charge", "report", "replacement_charge", "hold_queue_count"}.
    """
    settings = get_settings(school)
    today = today or timezone.localdate()
    first_look = BookIssue.objects.filter(pk=loan_id, school=school).values("copy_id", "member_id").first()
    if first_look is None:
        raise ResourceNotFound("Loan not found.")
    copy = _locked_copy(school, first_look["copy_id"]) if first_look["copy_id"] else None
    member = _locked_member(school, first_look["member_id"])
    loan = _locked_loan(school, loan_id)

    if loan.status != BookIssue.STATUS_ISSUED:
        raise LibraryAlreadyReturned(
            extra_data={"loan_id": loan.pk, "status": loan.status, "return_date": loan.return_date.isoformat() if loan.return_date else None}
        )

    report_type = None
    if report:
        report_type = report.get("type")
        _check_report_type(report_type)
        if copy is None:
            raise LibraryInvalidStateTransition("This loan has no copy to report on.")
    if condition and condition not in dict(BookCopy.CONDITION_CHOICES):
        raise FieldValidationError({"condition": "Unknown condition."})

    fine = ZERO
    if report_type != LostDamagedReport.TYPE_LOST and loan.due_date < today:
        fine = loan_fine(loan.due_date, today, loan.book.cost_per_copy, settings)
    if fine > 0:
        if fine_action not in FINE_ACTIONS:
            raise FieldValidationError({"fine_action": f"This loan has a fine of {fine}. Choose collect or waive."})
        if fine_action == "waive":
            if not (waive_reason or "").strip():
                raise FieldValidationError({"waive_reason": "A reason is required to waive a fine."})
            if not actor.has_permission_code(WAIVE_CODE):
                raise PermissionDenied("Waiving a fine needs the waive fine permission.")

    now = timezone.now()
    fine_charge = None
    if fine > 0:
        paid = fine_action == "collect"
        fine_charge = Charge.objects.create(
            school=school, member=member, charge_type=Charge.TYPE_OVERDUE_FINE, amount=fine, issue=loan,
            status=Charge.STATUS_PAID if paid else Charge.STATUS_WAIVED, assessed_on=today, resolved_at=now,
            resolved_by=actor, resolution_note="" if paid else waive_reason.strip(), created_by=actor, updated_by=actor,
        )
        if paid:
            fine_charge.receipt_no = receipt_number(fine_charge)
            fine_charge.save(update_fields=["receipt_no", "updated_at"])

    new_report = replacement_charge = None
    if report_type:
        new_report, replacement_charge, created_report = _new_report(
            school, actor, copy=copy, member=member, issue=loan, report_type=report_type,
            notes=report.get("notes", ""), source=LostDamagedReport.SOURCE_DESK_RETURN, settings=settings, today=today,
        )
        _set_copy_for_report(copy, actor, report_type)
    elif copy is not None:
        copy.status = BookCopy.STATUS_AVAILABLE
        fields = ["status"]
        if condition:
            copy.condition = condition
            fields.append("condition")
        _touch(copy, actor, *fields)

    loan.status = BookIssue.STATUS_LOST if report_type == LostDamagedReport.TYPE_LOST else BookIssue.STATUS_RETURNED
    loan.return_date = max(today, loan.issue_date)
    loan.returned_at, loan.returned_by, loan.fine_amount = now, actor, fine
    _touch(loan, actor, "status", "return_date", "returned_at", "returned_by", "fine_amount")

    queue = hold_queue_count(school, loan.book_id)
    if new_report is None and copy is not None and queue > 0:
        # The copy is back on the shelf and someone is waiting: tell the first in the queue once this commits.
        first_hold = (
            Hold.objects.filter(school=school, book_id=loan.book_id, status=Hold.STATUS_WAITING).order_by("created_at", "id").first()
        )
        if first_hold is not None:
            notifications.enqueue_event(school.id, notifications.EVENT_HOLD_READY, {"hold_id": first_hold.pk})
    elif new_report is not None and created_report and replacement_charge is not None:
        notifications.enqueue_event(school.id, notifications.EVENT_REPLACEMENT_FEE, {"report_id": new_report.pk})
    event = {"lost": LibraryActivityLog.EVENT_LOST, "damaged": LibraryActivityLog.EVENT_DAMAGED}.get(report_type, LibraryActivityLog.EVENT_RETURN)
    log_event(
        school, actor, event,
        f"{'Returned' if report_type != 'lost' else 'Lost'} {loan.book.title} ({copy.code if copy else 'no copy'}) "
        f"{'from' if report_type != 'lost' else 'by'} {person_name(member)}" + (f", fine {fine}" if fine > 0 else ""),
        book=loan.book, copy=copy, member=member, issue=loan,
        metadata={
            "loan_id": loan.pk, "fine": str(fine), "fine_action": fine_action if fine > 0 else "",
            "report_id": new_report.pk if new_report else None, "hold_queue_count": queue,
        },
    )
    return {"loan": loan, "charge": fine_charge, "report": new_report, "replacement_charge": replacement_charge, "hold_queue_count": queue}


@transaction.atomic
def undo_return(school, actor, loan_id, *, now=None):
    """Reopen a loan that was just returned (R7).

    Only the user who returned it, within `undo_return_minutes`, and only while its copy is still
    available and has not been issued again. Removes the fine charge that return created.
    """
    settings = get_settings(school)
    now = now or timezone.now()
    first_look = BookIssue.objects.filter(pk=loan_id, school=school).values("copy_id", "member_id").first()
    if first_look is None:
        raise ResourceNotFound("Loan not found.")
    if first_look["copy_id"] is None:
        raise LibraryUndoExpired()
    copy = _locked_copy(school, first_look["copy_id"])
    member = _locked_member(school, first_look["member_id"])
    loan = _locked_loan(school, loan_id)

    window = timedelta(minutes=settings.undo_return_minutes)
    if (
        loan.status != BookIssue.STATUS_RETURNED
        or loan.returned_by_id != actor.pk
        or loan.returned_at is None
        or now - loan.returned_at > window
        or copy.status != BookCopy.STATUS_AVAILABLE
        or BookIssue.objects.filter(copy=copy, status=BookIssue.STATUS_ISSUED).exists()
    ):
        raise LibraryUndoExpired()

    fine_removed = loan.fine_amount
    Charge.objects.filter(school=school, issue=loan, charge_type=Charge.TYPE_OVERDUE_FINE).delete()
    loan.status, loan.return_date, loan.returned_at, loan.returned_by, loan.fine_amount = BookIssue.STATUS_ISSUED, None, None, None, ZERO
    _touch(loan, actor, "status", "return_date", "returned_at", "returned_by", "fine_amount")
    copy.status = BookCopy.STATUS_ISSUED
    _touch(copy, actor, "status")
    log_event(
        school, actor, LibraryActivityLog.EVENT_RETURN,
        f"Undid the return of {loan.book.title} ({copy.code}) for {person_name(member)}",
        book=loan.book, copy=copy, member=member, issue=loan,
        metadata={"loan_id": loan.pk, "action": "undo", "fine_removed": str(fine_removed)},
    )
    return loan


# ---- renew ---------------------------------------------------------------------------------------------


@transaction.atomic
def renew_loan(school, actor, loan_id, *, today=None):
    """Renew an open loan (R5). Refused when overdue, at the renewal cap, or when anyone is waiting for the title.

    The new due date is computed again by the due-date rule from today. Returns (loan, due note).
    """
    settings = get_settings(school)
    today = today or timezone.localdate()
    first_look = BookIssue.objects.filter(pk=loan_id, school=school).values("copy_id", "member_id").first()
    if first_look is None:
        raise ResourceNotFound("Loan not found.")
    copy = _locked_copy(school, first_look["copy_id"]) if first_look["copy_id"] else None
    member = _locked_member(school, first_look["member_id"])
    loan = _locked_loan(school, loan_id)

    if loan.status != BookIssue.STATUS_ISSUED:
        raise LibraryAlreadyReturned(extra_data={"loan_id": loan.pk, "status": loan.status})
    if loan.due_date < today:
        raise LibraryLoanOverdue()
    if loan.renew_count >= settings.max_renewals:
        raise LibraryRenewalCap(extra_data={"max_renewals": settings.max_renewals})
    if Hold.objects.filter(school=school, book_id=loan.book_id, status=Hold.STATUS_WAITING).exists():
        raise LibraryHoldExists()

    due = compute_due_date(school, member, settings, today)
    loan.due_date = max(due.due_date, loan.issue_date)
    loan.renew_count += 1
    loan.last_renewed_on = today
    _touch(loan, actor, "due_date", "renew_count", "last_renewed_on")
    log_event(
        school, actor, LibraryActivityLog.EVENT_RENEWAL,
        f"Renewed {loan.book.title} ({copy.code if copy else 'no copy'}) for {person_name(member)}, due {loan.due_date.isoformat()}",
        book=loan.book, copy=copy, member=member, issue=loan,
        metadata={"loan_id": loan.pk, "due_date": loan.due_date.isoformat(), "renew_count": loan.renew_count},
    )
    return loan, {"due_date": loan.due_date, "snapped": due.snapped, "note": due.note}


# ---- holds ---------------------------------------------------------------------------------------------


@transaction.atomic
def place_hold(school, actor, *, book_id, member_id):
    """Put a member in the queue for a title (R16). Refused for a title they already wait for or have out."""
    book = _get_book(school, book_id)
    member = _locked_member(school, member_id)
    if not member.is_active:
        raise LibraryInvalidStateTransition("This member is inactive.")
    if book.is_reference_only:
        raise LibraryReferenceOnly()
    if Hold.objects.filter(school=school, book=book, member=member, status=Hold.STATUS_WAITING).exists():
        raise LibraryHoldExists("This member is already waiting for this title.")
    if BookIssue.objects.filter(school=school, book=book, member=member, status=BookIssue.STATUS_ISSUED).exists():
        raise LibraryInvalidStateTransition("This member already has this title out.")
    try:
        with transaction.atomic():
            hold = Hold.objects.create(school=school, book=book, member=member, created_by=actor, updated_by=actor)
    except IntegrityError:
        raise LibraryHoldExists("This member is already waiting for this title.")
    position = Hold.objects.filter(school=school, book=book, status=Hold.STATUS_WAITING, created_at__lte=hold.created_at).count()
    log_event(
        school, actor, LibraryActivityLog.EVENT_HOLD,
        f"{person_name(member)} is waiting for {book.title} (place {position} in the queue)",
        book=book, member=member, metadata={"hold_id": hold.pk, "action": "place", "position": position},
    )
    return hold


@transaction.atomic
def cancel_hold(school, actor, hold_id):
    try:
        hold = Hold.objects.select_for_update(of=("self",)).select_related("book", "member__student", "member__staff").get(pk=hold_id, school=school)
    except Hold.DoesNotExist:
        raise ResourceNotFound("Hold not found.")
    if hold.status != Hold.STATUS_WAITING:
        raise LibraryInvalidStateTransition(f"Only a waiting hold can be cancelled; this one is {hold.status}.")
    hold.status = Hold.STATUS_CANCELLED
    _touch(hold, actor, "status")
    log_event(
        school, actor, LibraryActivityLog.EVENT_HOLD,
        f"Cancelled the hold of {person_name(hold.member)} on {hold.book.title}",
        book=hold.book, member=hold.member, metadata={"hold_id": hold.pk, "action": "cancel"},
    )
    return hold
