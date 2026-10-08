"""Overdue reminders sent by the librarian (blueprint 2.4 issues/remind/, 4.8 reminder spam).

Rate limit: one reminder per loan per day, enforced through the activity log. Each batch writes one
`reminder` row holding the loan ids it queued and the date; the next request reads today's rows to
see which loans were already reminded. Delivery itself is queued (services.notifications) and is also
idempotent per loan and day, so two simultaneous batches still notify a family once.
"""
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError as FieldValidationError

from apps.core.exceptions import ResourceNotFound
from apps.library.exceptions import (
    LibraryInvalidStateTransition,
    LibraryReminderAlreadySent,
)
from apps.library.models import BookIssue, LibraryActivityLog

from . import notifications
from .activity import log_event

MAX_REMIND_BATCH = 200


def reminded_loan_ids(school, today):
    """Loan ids that already had a reminder queued today."""
    rows = LibraryActivityLog.objects.filter(
        school=school, event_type=LibraryActivityLog.EVENT_REMINDER, created_at__date=today, metadata__action="remind"
    ).values_list("metadata", flat=True)
    sent = set()
    for metadata in rows:
        sent.update(metadata.get("loan_ids", []))
    return sent


@transaction.atomic
def send_reminders(school, actor, *, issue_ids=None, all_overdue=False, today=None):
    """Queue overdue reminders for the named loans, or for every overdue loan.

    Returns {"queued", "queued_ids", "skipped": [{"issue", "reason"}], "remaining"}. Skip reasons are
    not_found, not_overdue and already_sent. An all_overdue run silently leaves out loans already
    reminded today (they are not "skipped" one by one), so the batch cap always works on loans that
    still need a reminder and repeated runs reach the rest. A request for exactly one loan answers with an error
    instead of a skip: 404, 409 library_invalid_state_transition, or 409 library_reminder_already_sent.
    `remaining` counts overdue loans left out of an all_overdue run by the batch cap.
    """
    if bool(issue_ids) == bool(all_overdue):
        raise FieldValidationError({"issue_ids": "Give issue_ids or set all_overdue, not both and not neither."})
    today = today or timezone.localdate()
    remaining = 0
    skipped = []

    already = reminded_loan_ids(school, today)

    if all_overdue:
        pending = BookIssue.objects.filter(school=school, status=BookIssue.STATUS_ISSUED, due_date__lt=today).exclude(pk__in=already)
        loans = list(pending.order_by("due_date", "id")[: MAX_REMIND_BATCH + 1])
        if len(loans) > MAX_REMIND_BATCH:
            remaining = pending.count() - MAX_REMIND_BATCH
            loans = loans[:MAX_REMIND_BATCH]
    else:
        ids = list(dict.fromkeys(issue_ids))
        if len(ids) > MAX_REMIND_BATCH:
            raise FieldValidationError({"issue_ids": f"At most {MAX_REMIND_BATCH} loans at a time."})
        found = {loan.pk: loan for loan in BookIssue.objects.filter(school=school, pk__in=ids)}
        loans = []
        for loan_id in ids:
            if loan_id in found:
                loans.append(found[loan_id])
            else:
                skipped.append({"issue": loan_id, "reason": "not_found"})
        if len(ids) == 1 and not loans:
            raise ResourceNotFound("Loan not found.")

    to_send = []
    for loan in loans:
        if loan.status != BookIssue.STATUS_ISSUED or loan.due_date >= today:
            skipped.append({"issue": loan.pk, "reason": "not_overdue"})
        elif loan.pk in already:
            skipped.append({"issue": loan.pk, "reason": "already_sent"})
        else:
            to_send.append(loan)

    if issue_ids and len(set(issue_ids)) == 1 and not to_send:
        reason = skipped[0]["reason"]
        if reason == "already_sent":
            raise LibraryReminderAlreadySent()
        raise LibraryInvalidStateTransition("This loan is not overdue, so there is nothing to remind about.")

    for loan in to_send:
        notifications.enqueue_event(
            school.id, notifications.EVENT_OVERDUE_REMINDER, {"issue_id": loan.pk, "date": today.isoformat()}
        )
    if to_send:
        log_event(
            school, actor, LibraryActivityLog.EVENT_REMINDER,
            f"Queued overdue reminders for {len(to_send)} loan(s)",
            metadata={"action": "remind", "date": today.isoformat(), "loan_ids": [loan.pk for loan in to_send], "skipped": len(skipped)},
        )
    return {"queued": len(to_send), "queued_ids": [loan.pk for loan in to_send], "skipped": skipped, "remaining": remaining}
