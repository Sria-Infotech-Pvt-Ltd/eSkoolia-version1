"""Celery tasks for the library. Tasks take ids only and re-read everything inside (blueprint 6.1)."""
from celery import shared_task

import logging

MAX_RETRY_DELAY_SECONDS = 900
logger = logging.getLogger(__name__)
FLAG_TASK_NAME = "library.flag_unscanned_students"


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


@shared_task(name=FLAG_TASK_NAME)
def flag_unscanned_students():
    """Every minute: for each school with a library period today, flag slots that started more than
    `unscanned_flag_minutes` ago and have not been flagged yet. Safe to run twice: the activity-log
    marker makes each slot flag at most once per day. One school failing never stops the others.
    """
    from apps.library.services.settings import get_settings  # noqa: F401  (settings row is created on first use)
    from apps.library.services.unscanned import flag_unscanned, slots_today_school_ids
    from apps.tenancy.models import School

    flagged = 0
    for school in School.objects.filter(pk__in=slots_today_school_ids()):
        try:
            flagged += len(flag_unscanned(school))
        except Exception:
            logger.exception("Unscanned flag failed for school %s", school.pk)
    return {"flagged_slots": flagged}
