"""Celery tasks for the library. Tasks take ids only and re-read everything inside (blueprint 6.1)."""
from celery import shared_task

MAX_RETRY_DELAY_SECONDS = 900


@shared_task(bind=True, name="library.deliver_event", max_retries=4)
def deliver_library_event(self, school_id, event, ids):
    """Deliver one notification event: hold_ready, overdue_reminder or replacement_fee.

    In-app delivery is idempotent, so a retry never notifies twice. Only an SMS or email failure
    raises, and is retried with exponential backoff (30s, 60s, 120s, 240s, capped at 15 minutes).
    """
    from apps.library.services.notifications import DeliveryFailed, deliver_event

    try:
        return deliver_event(school_id, event, ids)
    except DeliveryFailed as exc:
        raise self.retry(exc=exc, countdown=min(30 * 2 ** self.request.retries, MAX_RETRY_DELAY_SECONDS))
