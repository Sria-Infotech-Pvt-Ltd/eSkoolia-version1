"""Collecting and waiving charges. Both lock the row, require it to be pending and log the action."""
from django.db import transaction
from django.utils import timezone

from apps.library.exceptions import LibraryInvalidStateTransition
from apps.library.models import Charge, LibraryActivityLog

from .activity import log_event
from .members import person_name, receipt_number


def _lock_pending(school, charge_id):
    charge = Charge.objects.select_for_update().select_related("member__student", "member__staff").get(pk=charge_id, school=school)
    if charge.status != Charge.STATUS_PENDING:
        raise LibraryInvalidStateTransition(f"This charge is already {charge.status.replace('_', ' ')}.")
    return charge


def _event_for(charge):
    return LibraryActivityLog.EVENT_MEMBER if charge.charge_type == Charge.TYPE_REGISTRATION else LibraryActivityLog.EVENT_FINE


@transaction.atomic
def collect_charge(school, actor, charge_id, receipt_no=""):
    """Pending to paid. The receipt number is the one given or a generated LIBR- number."""
    charge = _lock_pending(school, charge_id)
    charge.status = Charge.STATUS_PAID
    charge.resolved_at = timezone.now()
    charge.resolved_by = actor
    charge.updated_by = actor
    charge.receipt_no = (receipt_no or "").strip()[:40] or receipt_number(charge)
    charge.save()
    log_event(
        school, actor, _event_for(charge),
        f"Collected {charge.amount} ({charge.charge_type.replace('_', ' ')}) from {person_name(charge.member)}",
        member=charge.member, issue=charge.issue,
        metadata={"charge_id": charge.pk, "amount": str(charge.amount), "action": "collect", "receipt_no": charge.receipt_no},
    )
    return charge


@transaction.atomic
def waive_charge(school, actor, charge_id, reason):
    """Pending to waived. The reason is required and stored on the charge."""
    charge = _lock_pending(school, charge_id)
    charge.status = Charge.STATUS_WAIVED
    charge.resolved_at = timezone.now()
    charge.resolved_by = actor
    charge.updated_by = actor
    charge.resolution_note = reason
    charge.save()
    log_event(
        school, actor, _event_for(charge),
        f"Waived {charge.amount} ({charge.charge_type.replace('_', ' ')}) for {person_name(charge.member)}",
        member=charge.member, issue=charge.issue,
        metadata={"charge_id": charge.pk, "amount": str(charge.amount), "action": "waive"},
    )
    return charge
