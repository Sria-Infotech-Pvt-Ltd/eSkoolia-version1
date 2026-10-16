"""What a parent sees about one child's library use (blueprint 2.4 parent portal, 3.4, decision D15).

Everything starts from a Student the view has already resolved through `_resolve_child` (the guardian owns
the child and the child is active). Nothing here takes an id from the client, and every query filters on the
child's member record and the child's school. Read only.
"""
from django.db.models.functions import Coalesce

from apps.library.models import BookIssue, Charge, LibraryMember, PeriodSlot
from apps.library.serializers.loans import loan_state

from .dues import borrowing_limit, days_overdue, loan_fine
from .members import accrued_fines_by_member, annotate_member_dues, member_dues
from .periods import local_now
from .settings import get_settings
from .teacher import next_slot_for, slot_payload

HISTORY_PAGE_SIZE = 20


def member_for_child(student):
    """The child's library member, annotated with its dues figures in one query, or None when not registered."""
    return annotate_member_dues(LibraryMember.objects.filter(school_id=student.school_id, student=student)).first()


def next_slot_for_child(student, now=None):
    """The next library period for the child's class (and section), or None."""
    if not student.current_class_id:
        return None
    now = now or local_now()
    slots = list(
        PeriodSlot.objects.filter(school_id=student.school_id, is_active=True, school_class_id=student.current_class_id).select_related("period")
    )
    slot, day = next_slot_for(slots, student.current_class_id, student.current_section_id, now)
    return slot_payload(slot, day)


def _loan_row(loan, today, settings):
    return {
        "id": loan.pk,
        "book_title": loan.book.title,
        "author": loan.book.author,
        "copy_code": loan.copy.code if loan.copy_id else "",
        "issue_date": loan.issue_date.isoformat(),
        "due_date": loan.due_date.isoformat(),
        "overdue": loan.due_date < today,
        "days_overdue": days_overdue(loan.due_date, today),
        "accrued_fine": str(loan_fine(loan.due_date, today, loan.book.cost_per_copy, settings)),
        "state": loan_state(loan, today),
        "renew_count": loan.renew_count,
    }


def current_summary(student, now=None):
    """The Current and Due page for one child. An unregistered child is `registered: false`, not an error."""
    now = now or local_now()
    today = now.date()
    slot = next_slot_for_child(student, now)
    member = member_for_child(student)
    if member is None:
        return {
            "registered": False, "next_slot": slot, "loans": [], "open_loans": 0, "loan_limit": None, "suspended": False,
            "is_active": None, "card_no": "", "fines": {"total": "0.00"}, "replacement_fees": {"total": "0.00", "items": []},
            "registration": {"status": None, "amount": "0.00"}, "total_due": "0.00",
        }
    settings = get_settings(student.school)
    loans = list(
        BookIssue.objects.filter(school_id=student.school_id, member=member, status=BookIssue.STATUS_ISSUED)
        .select_related("book", "copy")
        .order_by("due_date", "id")
    )
    accrued = accrued_fines_by_member(student.school, settings, [member.pk], today).get(member.pk, 0)
    dues = member_dues(member, accrued, settings)
    fees = list(
        Charge.objects.filter(
            school_id=student.school_id, member=member, charge_type=Charge.TYPE_REPLACEMENT, status=Charge.STATUS_PENDING
        )
        .select_related("report__book")
        .order_by("assessed_on", "id")
    )
    return {
        "registered": True,
        "is_active": member.is_active,
        "card_no": member.card_no,
        "next_slot": slot,
        "loans": [_loan_row(loan, today, settings) for loan in loans],
        "open_loans": len(loans),
        "loan_limit": borrowing_limit(LibraryMember.MEMBER_STUDENT, settings),
        "suspended": dues.suspended,
        "fines": {"total": str(dues.overdue_fines)},
        "replacement_fees": {
            "total": str(dues.replacement_fees),
            "items": [
                {
                    "book_title": fee.report.book.title if fee.report_id else "",
                    "amount": str(fee.amount),
                    "assessed_on": fee.assessed_on.isoformat(),
                }
                for fee in fees
            ],
        },
        "registration": {"status": member.registration_state, "amount": str(member.registration_fee_amount)},
        "total_due": str(dues.total),
    }


def history_queryset(student):
    """Closed loans (returned or lost) of the child's own member, most recently closed first. Empty when unregistered."""
    member = LibraryMember.objects.filter(school_id=student.school_id, student=student).first()
    if member is None:
        return BookIssue.objects.none()
    return (
        BookIssue.objects.filter(school_id=student.school_id, member=member)
        .exclude(status=BookIssue.STATUS_ISSUED)
        .select_related("book", "copy")
        .annotate(closed_on=Coalesce("return_date", "issue_date"))
        .order_by("-closed_on", "-id")
    )


def history_row(loan):
    return {
        "id": loan.pk,
        "book_title": loan.book.title,
        "author": loan.book.author,
        "copy_code": loan.copy.code if loan.copy_id else "",
        "issue_date": loan.issue_date.isoformat(),
        "due_date": loan.due_date.isoformat(),
        "return_date": loan.return_date.isoformat() if loan.return_date else None,
        "state": loan.status,
        "returned_late": bool(loan.return_date and loan.return_date > loan.due_date),
        "fine_amount": str(loan.fine_amount),
    }

