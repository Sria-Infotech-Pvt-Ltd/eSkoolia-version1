"""Library notification events (blueprint 6.1 and 6.2, decision D17).

Flow: a service queues an event with `enqueue_event` (ids only, started from
``transaction.on_commit`` so a rolled-back action never notifies), the Celery task
`library.deliver_event` calls `deliver_event`, which re-reads the rows, resolves who to
tell, creates one CommunicationNotification and pushes it over the user's WebSocket group.
SMS and email go out only when the school turned `notify_sms_email_enabled` on.

Nothing here may break circulation: queueing swallows broker errors, the push swallows
channel-layer errors, and an external channel failure only raises `DeliveryFailed` inside the
task so Celery retries it with backoff. No phone number or email address is passed as a task
argument, stored in an activity row or written to a log line.
"""
import logging
from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone

from apps.communication.models import CommunicationNotification
from apps.communication.realtime import push_portal_event
from apps.core.services.parent_notifications import send_email_sendgrid, send_sms_twilio
from apps.library.models import (
    BookIssue,
    BookRequest,
    Hold,
    LibraryActivityLog,
    LibraryMember,
    LostDamagedReport,
)
from apps.tenancy.models import School

from .activity import log_event
from .dues import days_overdue, loan_fine
from .members import person_name
from .settings import get_settings

logger = logging.getLogger(__name__)

EVENT_HOLD_READY = "hold_ready"
EVENT_OVERDUE_REMINDER = "overdue_reminder"
EVENT_REPLACEMENT_FEE = "replacement_fee"
EVENT_REQUEST_REVIEWED = "request_reviewed"
EVENTS = (EVENT_HOLD_READY, EVENT_OVERDUE_REMINDER, EVENT_REPLACEMENT_FEE, EVENT_REQUEST_REVIEWED)

LINK_STAFF = "/teacher/library/my-books"
LINK_GUARDIAN = "/parent/library"
LINK_REQUESTS = "/teacher/library/recommend"

# Notification type per event (blueprint 6.2): reminders and fees are "reminder", the rest "system".
NOTIFICATION_TYPE = {
    EVENT_HOLD_READY: CommunicationNotification.TYPE_SYSTEM,
    EVENT_OVERDUE_REMINDER: CommunicationNotification.TYPE_REMINDER,
    EVENT_REPLACEMENT_FEE: CommunicationNotification.TYPE_REMINDER,
    EVENT_REQUEST_REVIEWED: CommunicationNotification.TYPE_SYSTEM,
}


class DeliveryFailed(Exception):
    """An external channel (SMS or email) failed. Raised only so the Celery task retries."""


@dataclass
class Recipient:
    user: object | None
    phone: str = ""
    email: str = ""
    reason: str = ""
    link_url: str = LINK_STAFF


def resolve_recipient(member) -> Recipient:
    """Who is told about a member's loan. A student's primary guardian, otherwise the member's own user.

    Needs ``member.student.guardian.user`` or ``member.staff.user`` to be loadable (select_related is
    done by deliver_event). A missing user yields ``Recipient(user=None, reason=...)``.
    """
    if member.student_id:
        guardian = member.student.guardian
        if guardian is None:
            return Recipient(None, reason="the student has no guardian", link_url=LINK_GUARDIAN)
        user = guardian.user
        return Recipient(
            user, phone=guardian.phone or "", email=guardian.email or "",
            reason="" if user else "the guardian has no portal account", link_url=LINK_GUARDIAN,
        )
    staff = member.staff
    user = staff.user if staff is not None else None
    email = (staff.email if staff is not None else "") or (user.email if user else "")
    return Recipient(user, phone=(staff.phone if staff is not None else "") or "", email=email or "", reason="" if user else "the staff member has no user account")


# ---- queueing ---------------------------------------------------------------------------------------------------


def enqueue_event(school_id, event, ids):
    """Queue `event` for delivery once the surrounding transaction commits. `ids` holds ids and ISO dates only."""
    if event not in EVENTS:
        raise ValueError(f"Unknown library notification event: {event!r}")

    def dispatch():
        try:
            from apps.library.tasks import deliver_library_event

            # retry=False: with no broker this fails at once instead of stalling the librarian's request.
            deliver_library_event.apply_async(args=(school_id, event, ids), retry=False)
        except Exception:
            # A broker outage must not turn a committed return into an error for the librarian.
            logger.warning("Library event %s could not be queued", event)

    transaction.on_commit(dispatch)


# ---- builders: each returns None when the event is stale, else what to say and to whom ---------------------------------


def _member(school, member_id):
    return (
        LibraryMember.objects.select_related("student__guardian__user", "staff__user")
        .filter(pk=member_id, school=school)
        .first()
    )


def _build_hold_ready(school, ids):
    hold = Hold.objects.select_related("book").filter(pk=ids["hold_id"], school=school, status=Hold.STATUS_WAITING).first()
    member = _member(school, hold.member_id) if hold else None
    if hold is None or member is None:
        return None
    return {
        "member": member,
        "title": "Your reserved book is ready",
        "body": f"{hold.book.title} has been returned and is being kept for {person_name(member)}.",
        "key": {"hold_id": hold.pk},
    }


def _build_overdue(school, ids, settings):
    loan = BookIssue.objects.select_related("book").filter(pk=ids["issue_id"], school=school, status=BookIssue.STATUS_ISSUED).first()
    today = timezone.localdate()
    if loan is None or loan.due_date >= today:
        return None
    member = _member(school, loan.member_id)
    if member is None:
        return None
    late = days_overdue(loan.due_date, today)
    fine = loan_fine(loan.due_date, today, loan.book.cost_per_copy, settings)
    return {
        "member": member,
        "title": "Library book overdue",
        "body": f"{loan.book.title} borrowed by {person_name(member)} was due on {loan.due_date.isoformat()} "
        f"and is {late} day(s) overdue. Fine so far: {fine}.",
        "key": {"issue_id": loan.pk, "date": ids.get("date") or today.isoformat()},
    }


def _build_replacement_fee(school, ids):
    report = LostDamagedReport.objects.select_related("book").filter(pk=ids["report_id"], school=school).first()
    if report is None or report.member_id is None:
        return None
    member = _member(school, report.member_id)
    if member is None:
        return None
    return {
        "member": member,
        "title": "Library replacement fee",
        "body": f"{report.book.title} was reported {report.report_type} for {person_name(member)}. "
        f"Replacement fee: {report.replacement_cost}.",
        "key": {"report_id": report.pk},
    }


def _build_request_reviewed(school, ids):
    """Tell the teacher who asked. Only the title they typed and the librarian's note are used: no donor or contact data."""
    book_request = (
        BookRequest.objects.select_related("requested_by")
        .filter(pk=ids["request_id"], school=school)
        .exclude(status=BookRequest.STATUS_PENDING)
        .first()
    )
    if book_request is None:
        return None
    body = f'Your book request "{book_request.title}" is now {book_request.get_status_display().lower()}.'
    if book_request.review_note:
        body += f" Librarian's note: {book_request.review_note}"
    return {
        "member": None,
        "recipient": Recipient(book_request.requested_by, link_url=LINK_REQUESTS),
        "title": "Your library book request was reviewed",
        "body": body,
        "key": {"request_id": book_request.pk, "status": book_request.status},
    }


# ---- delivery ---------------------------------------------------------------------------------------------------------


def _send_external(notification, recipient, settings):
    """SMS and email, only when enabled. Returns True if a channel failed (the task then retries).

    The status of each channel is kept on the notification so a retry only repeats what did not go out.
    """
    if not settings.notify_sms_email_enabled:
        return False
    failed = False
    text = f"{notification.title}: {notification.body}"
    channels = (("sms", recipient.phone, lambda: send_sms_twilio(recipient.phone, text)),
                ("email", recipient.email, lambda: send_email_sendgrid(recipient.email, notification.title, text)))
    for name, address, send in channels:
        if notification.data.get(name) in ("sent", "skipped"):
            continue
        status = "skipped" if not address else send()[0]
        notification.data[name] = status
        if status == "failed":
            failed = True
            logger.warning("Library %s delivery failed for notification %s", name, notification.pk)
    notification.save(update_fields=["data", "updated_at"])
    return failed


def deliver_event(school_id, event, ids):
    """Create (once) and push the notification for one event. Returns {"status", "notification_id"?}.

    status is "created", "duplicate" (already delivered, nothing sent again), "stale" (the loan, hold
    or report no longer needs it) or "no_recipient" (nobody to tell: a reminder row is logged instead).
    Raises DeliveryFailed when SMS or email failed, so the caller (the Celery task) can retry.
    """
    school = School.objects.get(pk=school_id)
    settings = get_settings(school)
    if event == EVENT_HOLD_READY:
        built = _build_hold_ready(school, ids)
    elif event == EVENT_OVERDUE_REMINDER:
        built = _build_overdue(school, ids, settings)
    elif event == EVENT_REPLACEMENT_FEE:
        built = _build_replacement_fee(school, ids)
    elif event == EVENT_REQUEST_REVIEWED:
        built = _build_request_reviewed(school, ids)
    else:
        raise ValueError(f"Unknown library notification event: {event!r}")
    if built is None:
        return {"status": "stale"}

    member = built["member"]
    recipient = built.get("recipient") or resolve_recipient(member)
    if recipient.user is None:
        who = person_name(member) if member is not None else "a book request"
        log_event(
            school, None, LibraryActivityLog.EVENT_REMINDER,
            f"No one to notify for {who}: {recipient.reason}",
            member=member, metadata={"event": event, "skipped": "no_recipient", **built["key"]},
        )
        return {"status": "no_recipient"}

    lookups = {f"data__{name}": value for name, value in {"event": event, **built["key"]}.items()}
    notification = CommunicationNotification.objects.filter(school=school, recipient=recipient.user, **lookups).first()
    created = notification is None
    if created:
        notification = CommunicationNotification.objects.create(
            school=school,
            recipient=recipient.user,
            title=built["title"],
            body=built["body"],
            notification_type=NOTIFICATION_TYPE[event],
            link_url=recipient.link_url,
            data={"event": event, "library": True, **built["key"]},
        )
        push_portal_event(
            recipient.user.pk,
            {
                "kind": "library",
                "event": event,
                "id": notification.pk,
                "title": notification.title,
                "body": notification.body,
                "link_url": notification.link_url,
                "created_at": notification.created_at.isoformat(),
            },
        )
    if _send_external(notification, recipient, settings):
        raise DeliveryFailed(f"{event} external delivery failed")
    return {"status": "created" if created else "duplicate", "notification_id": notification.pk}
