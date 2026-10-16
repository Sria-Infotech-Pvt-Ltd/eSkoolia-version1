"""Stock check (blueprint 2.4, rule R15): snapshot the on-shelf copies, tick them off, freeze the result.

Only copies whose status is `available` are in scope. Counts are frozen at finish. A copy found missing can
be reported lost once, and only while it is still on the shelf (R15); asking again returns the same report.
"""
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError as FieldValidationError

from apps.core.exceptions import ResourceNotFound
from apps.library.exceptions import LibraryAuditInProgress, LibraryInvalidStateTransition
from apps.library.models import BookCopy, LibraryActivityLog, LostDamagedReport, StockAudit, StockAuditItem

from . import circulation
from .activity import log_event

ZERO = Decimal("0.00")
MISSING_LIST_LIMIT = 500


def _locked_audit(school, audit_id):
    try:
        return StockAudit.objects.select_for_update().get(pk=audit_id, school=school)
    except StockAudit.DoesNotExist:
        raise ResourceNotFound("Stock check not found.")


def _scope_label(audit) -> str:
    return f"rack {audit.scope_rack}" if audit.scope_rack else "all racks"


@transaction.atomic
def start_audit(school, actor, rack=""):
    rack = (rack or "").strip()
    if StockAudit.objects.filter(school=school, scope_rack=rack, status=StockAudit.STATUS_IN_PROGRESS).exists():
        raise LibraryAuditInProgress()
    copies = BookCopy.objects.filter(school=school, status=BookCopy.STATUS_AVAILABLE)
    if rack:
        copies = copies.filter(book__rack=rack)
    copy_ids = list(copies.values_list("pk", flat=True))
    if not copy_ids:
        raise FieldValidationError({"rack": "No copies are on the shelf for this rack."})
    try:
        with transaction.atomic():
            audit = StockAudit.objects.create(
                school=school, scope_rack=rack, started_at=timezone.now(), total_in_scope=len(copy_ids),
                created_by=actor, updated_by=actor,
            )
    except IntegrityError:  # another desk started the same scope first (uq_library_stock_audits_open_scope)
        raise LibraryAuditInProgress()
    StockAuditItem.objects.bulk_create(
        [StockAuditItem(school=school, audit=audit, copy_id=pk, created_by=actor, updated_by=actor) for pk in copy_ids]
    )
    log_event(
        school, actor, LibraryActivityLog.EVENT_AUDIT, f"Stock check started for {_scope_label(audit)}: {len(copy_ids)} copies",
        metadata={"audit_id": audit.pk, "rack": rack, "total": len(copy_ids)},
    )
    return audit


def _require_open(audit):
    if audit.status != StockAudit.STATUS_IN_PROGRESS:
        raise LibraryInvalidStateTransition("This stock check is no longer in progress.")


@transaction.atomic
def mark_item(school, actor, audit_id, item_id, found):
    audit = _locked_audit(school, audit_id)
    _require_open(audit)
    try:
        item = StockAuditItem.objects.select_related("copy__book").get(pk=item_id, audit=audit, school=school)
    except StockAuditItem.DoesNotExist:
        raise ResourceNotFound("Stock check item not found.")
    item.found = found
    item.verified_at = timezone.now() if found else None
    item.updated_by = actor
    item.save(update_fields=["found", "verified_at", "updated_by", "updated_at"])
    return item


@transaction.atomic
def bulk_mark(school, actor, audit_id, item_ids, found):
    """Set `found` on every listed item. Returns how many rows changed state."""
    audit = _locked_audit(school, audit_id)
    _require_open(audit)
    ids = set(item_ids)
    items = StockAuditItem.objects.filter(audit=audit, school=school, pk__in=ids)
    if items.count() != len(ids):
        raise FieldValidationError({"item_ids": "Some items do not belong to this stock check."})
    changed = items.exclude(found=found).update(
        found=found, verified_at=timezone.now() if found else None, updated_by=actor, updated_at=timezone.now()
    )
    return changed


def progress(audit_id) -> dict:
    counts = StockAuditItem.objects.filter(audit_id=audit_id).aggregate(n_total=Count("id"), n_found=Count("id", filter=Q(found=True)))
    return {"total": counts["n_total"], "found": counts["n_found"]}


@transaction.atomic
def finish_audit(school, actor, audit_id):
    """Freeze the counts, set last_verified_on on the found copies, and return (audit, missing items)."""
    audit = _locked_audit(school, audit_id)
    _require_open(audit)
    items = StockAuditItem.objects.filter(audit=audit)
    totals = items.aggregate(
        n_total=Count("id"),
        n_found=Count("id", filter=Q(found=True)),
        at_risk=Sum("copy__book__cost_per_copy", filter=Q(found=False)),
    )
    now = timezone.now()
    audit.status = StockAudit.STATUS_COMPLETED
    audit.finished_at = now
    audit.total_in_scope = totals["n_total"]
    audit.accounted_count = totals["n_found"]
    audit.missing_count = totals["n_total"] - totals["n_found"]
    audit.value_at_risk = Decimal(totals["at_risk"] or 0).quantize(ZERO)
    audit.updated_by = actor
    audit.save()
    BookCopy.objects.filter(pk__in=items.filter(found=True).values("copy_id")).update(
        last_verified_on=timezone.localdate(now), updated_at=now
    )
    log_event(
        school, actor, LibraryActivityLog.EVENT_AUDIT,
        f"Stock check finished for {_scope_label(audit)}: {audit.accounted_count} found, {audit.missing_count} missing",
        metadata={"audit_id": audit.pk, "accounted": audit.accounted_count, "missing": audit.missing_count,
                  "value_at_risk": str(audit.value_at_risk)},
    )
    missing = items.filter(found=False).select_related("copy__book").order_by("copy__code")[:MISSING_LIST_LIMIT]
    return audit, list(missing)


@transaction.atomic
def cancel_audit(school, actor, audit_id):
    audit = _locked_audit(school, audit_id)
    _require_open(audit)
    audit.status = StockAudit.STATUS_CANCELLED
    audit.finished_at = timezone.now()
    audit.updated_by = actor
    audit.save(update_fields=["status", "finished_at", "updated_by", "updated_at"])
    log_event(
        school, actor, LibraryActivityLog.EVENT_AUDIT, f"Stock check cancelled for {_scope_label(audit)}",
        metadata={"audit_id": audit.pk, "cancelled": True},
    )
    return audit


@transaction.atomic
def mark_missing_lost(school, actor, audit_id, item_id, notes=""):
    """Report a missing copy lost. Returns (report, created). Repeating it returns the same report (R15)."""
    audit = _locked_audit(school, audit_id)
    if audit.status != StockAudit.STATUS_COMPLETED:
        raise LibraryInvalidStateTransition("Only a finished stock check can report copies lost.")
    try:
        item = StockAuditItem.objects.select_related("copy__book").get(pk=item_id, audit=audit, school=school)
    except StockAuditItem.DoesNotExist:
        raise ResourceNotFound("Stock check item not found.")
    if item.found:
        raise LibraryInvalidStateTransition("This copy was found, so it cannot be reported lost.")
    existing = LostDamagedReport.objects.filter(
        school=school, copy=item.copy, source=LostDamagedReport.SOURCE_STOCK_AUDIT, created_at__gte=audit.finished_at
    ).first()
    if existing is not None:
        return existing, False
    if item.copy.status != BookCopy.STATUS_AVAILABLE:
        raise LibraryInvalidStateTransition("Only a copy that is still on the shelf can be reported lost here.")
    report, _charge, created = circulation.create_report(
        school, actor, copy_id=item.copy_id, report_type=LostDamagedReport.TYPE_LOST,
        notes=notes or "Missing in stock check", source=LostDamagedReport.SOURCE_STOCK_AUDIT,
    )
    return report, created
