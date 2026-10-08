"""Purchase orders, donations, the annual budget and the teacher request queue (blueprint 2.4).

Every write runs in one ``transaction.atomic()`` with its activity-log row. Donor name and contact are
personal data: they never reach a log summary, metadata, notification text or error message. Rows are
referred to by receipt number and id only.
"""
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.core.models import AcademicYear
from apps.library.exceptions import LibraryHasHistory, LibraryInvalidStateTransition
from apps.library.models import (
    Book,
    BookRequest,
    Budget,
    Donation,
    LibraryActivityLog,
    PurchaseOrder,
)

from .activity import log_event
from .notifications import EVENT_REQUEST_REVIEWED, enqueue_event
from .numbering import next_po_number, next_receipt_number

ZERO = Decimal("0.00")

# Forward only. Cancelled and received are final; payment never goes back to pending.
PO_STATUS_MOVES = {
    PurchaseOrder.STATUS_ORDERED: {PurchaseOrder.STATUS_RECEIVED, PurchaseOrder.STATUS_CANCELLED},
    PurchaseOrder.STATUS_RECEIVED: set(),
    PurchaseOrder.STATUS_CANCELLED: set(),
}
# Fields a client may change only while the order is still open.
PO_OPEN_ONLY_FIELDS = ("order_date", "vendor_name", "books_count", "total_cost", "academic_year")
PO_ALWAYS_FIELDS = ("invoice_number", "notes")

REQUEST_STATUS_MOVES = {
    BookRequest.STATUS_PENDING: {BookRequest.STATUS_APPROVED, BookRequest.STATUS_REJECTED},
    BookRequest.STATUS_APPROVED: {BookRequest.STATUS_ORDERED, BookRequest.STATUS_FULFILLED},
    BookRequest.STATUS_ORDERED: {BookRequest.STATUS_FULFILLED},
    BookRequest.STATUS_REJECTED: set(),
    BookRequest.STATUS_FULFILLED: set(),
}


def current_academic_year(school):
    return AcademicYear.objects.filter(school=school, is_current=True).first()


# ---- purchase orders ---------------------------------------------------------------------------------------------


@transaction.atomic
def create_purchase_order(school, actor, data):
    data = dict(data)
    year = data.pop("academic_year", None) or current_academic_year(school)
    order = PurchaseOrder.objects.create(
        school=school, created_by=actor, updated_by=actor,
        po_number=next_po_number(school), academic_year=year, **data,
    )
    log_event(
        school, actor, LibraryActivityLog.EVENT_PURCHASE,
        f"Purchase order {order.po_number} created for {order.books_count} book(s)",
        metadata={"purchase_order_id": order.pk, "po_number": order.po_number, "total_cost": str(order.total_cost)},
    )
    return order


@transaction.atomic
def update_purchase_order(school, actor, order_id, data):
    order = PurchaseOrder.objects.select_for_update().get(pk=order_id, school=school)
    data = dict(data)
    new_status = data.pop("status", None)
    new_payment = data.pop("payment_status", None)
    changed = []

    open_only = [name for name in PO_OPEN_ONLY_FIELDS if name in data and data[name] != getattr(order, name)]
    if open_only and order.status != PurchaseOrder.STATUS_ORDERED:
        raise LibraryInvalidStateTransition(detail="Only an open order can have its details changed.")
    for name in (*PO_OPEN_ONLY_FIELDS, *PO_ALWAYS_FIELDS):
        if name in data and data[name] != getattr(order, name):
            setattr(order, name, data[name])
            changed.append(name)

    if new_status is not None and new_status != order.status:
        if new_status not in PO_STATUS_MOVES[order.status]:
            raise LibraryInvalidStateTransition(
                detail=f"A {order.status} order cannot be changed to {new_status}."
            )
        order.status = new_status
        changed.append("status")
    if new_payment is not None and new_payment != order.payment_status:
        if new_payment != PurchaseOrder.PAYMENT_PAID:
            raise LibraryInvalidStateTransition(detail="A paid order cannot go back to pending.")
        if order.status == PurchaseOrder.STATUS_CANCELLED:
            raise LibraryInvalidStateTransition(detail="A cancelled order cannot be marked paid.")
        order.payment_status = new_payment
        changed.append("payment_status")

    if changed:
        order.updated_by = actor
        order.save(update_fields=[*changed, "updated_by", "updated_at"])
        log_event(
            school, actor, LibraryActivityLog.EVENT_PURCHASE,
            f"Purchase order {order.po_number} updated",
            metadata={"purchase_order_id": order.pk, "fields": sorted(changed), "status": order.status,
                      "payment_status": order.payment_status},
        )
    return order


@transaction.atomic
def delete_purchase_order(school, actor, order_id):
    order = PurchaseOrder.objects.select_for_update().get(pk=order_id, school=school)
    if order.status != PurchaseOrder.STATUS_ORDERED:
        raise LibraryInvalidStateTransition(detail="Only an order that is still open can be deleted.")
    if Book.objects.filter(school=school, purchase_order=order).exists():
        raise LibraryHasHistory(detail="Titles are linked to this order, so it cannot be deleted.")
    log_event(
        school, actor, LibraryActivityLog.EVENT_PURCHASE,
        f"Purchase order {order.po_number} deleted",
        metadata={"purchase_order_id": order.pk, "po_number": order.po_number, "deleted": True},
    )
    order.delete()


# ---- donations ---------------------------------------------------------------------------------------------------


@transaction.atomic
def create_donation(school, actor, data):
    donation = Donation.objects.create(
        school=school, created_by=actor, updated_by=actor, receipt_no=next_receipt_number(school), **data
    )
    # Receipt number and counts only: the donor's name and contact stay out of the feed.
    log_event(
        school, actor, LibraryActivityLog.EVENT_DONATION,
        f"Donation {donation.receipt_no} logged: {donation.books_count} book(s)",
        metadata={"donation_id": donation.pk, "receipt_no": donation.receipt_no, "books_count": donation.books_count},
    )
    return donation


@transaction.atomic
def update_donation(school, actor, donation_id, data):
    donation = Donation.objects.select_for_update().get(pk=donation_id, school=school)
    data = dict(data)
    changed = []
    for name, value in data.items():
        if getattr(donation, name) != value:
            setattr(donation, name, value)
            changed.append(name)
    if "acknowledgement_sent" in changed:
        # The stamp follows the flag: set when it turns on, cleared when it turns off.
        donation.acknowledgement_sent_at = timezone.now() if donation.acknowledgement_sent else None
        changed.append("acknowledgement_sent_at")
    if changed:
        donation.updated_by = actor
        donation.save(update_fields=[*changed, "updated_by", "updated_at"])
        log_event(
            school, actor, LibraryActivityLog.EVENT_DONATION,
            f"Donation {donation.receipt_no} updated",
            metadata={"donation_id": donation.pk, "receipt_no": donation.receipt_no, "fields": sorted(changed)},
        )
    return donation


# ---- budget and summary ------------------------------------------------------------------------------------------


@transaction.atomic
def set_budget(school, actor, academic_year, amount):
    budget = Budget.objects.select_for_update().filter(school=school, academic_year=academic_year).first()
    if budget is None:
        budget = Budget.objects.create(
            school=school, academic_year=academic_year, amount=amount, created_by=actor, updated_by=actor
        )
        previous = None
    else:
        previous = budget.amount
        budget.amount = amount
        budget.updated_by = actor
        budget.save(update_fields=["amount", "updated_by", "updated_at"])
    log_event(
        school, actor, LibraryActivityLog.EVENT_SETTINGS,
        f"Library budget set for academic year {academic_year.pk}",
        metadata={"academic_year_id": academic_year.pk, "amount": str(amount),
                  "previous": None if previous is None else str(previous)},
    )
    return budget


def budget_summary(school, academic_year):
    """Budget, committed (every PO that is not cancelled), paid (those marked paid) and remaining."""
    budget = Budget.objects.filter(school=school, academic_year=academic_year).first()
    orders = PurchaseOrder.objects.filter(school=school, academic_year=academic_year).exclude(
        status=PurchaseOrder.STATUS_CANCELLED
    )
    committed = orders.aggregate(total=Sum("total_cost"))["total"] or ZERO
    paid = orders.filter(payment_status=PurchaseOrder.PAYMENT_PAID).aggregate(total=Sum("total_cost"))["total"] or ZERO
    amount = budget.amount if budget else ZERO
    return {
        "academic_year": academic_year.pk,
        "academic_year_name": academic_year.name,
        "has_budget": budget is not None,
        "budget": amount,
        "committed": committed,
        "paid": paid,
        "remaining": amount - committed,
    }


# ---- teacher book requests ---------------------------------------------------------------------------------------


@transaction.atomic
def review_book_request(school, actor, request_id, new_status, note="", linked_book=None):
    """Move a request forward and tell the teacher who made it, once the transaction commits."""
    book_request = BookRequest.objects.select_for_update().get(pk=request_id, school=school)
    if new_status not in REQUEST_STATUS_MOVES[book_request.status]:
        raise LibraryInvalidStateTransition(
            detail=f"A {book_request.status} request cannot be changed to {new_status}."
        )
    book_request.status = new_status
    book_request.reviewed_by = actor
    book_request.reviewed_at = timezone.now()
    if note:
        book_request.review_note = note
    if linked_book is not None:
        book_request.linked_book = linked_book
    book_request.updated_by = actor
    book_request.save()
    log_event(
        school, actor, LibraryActivityLog.EVENT_REQUEST,
        f"Book request {book_request.pk} marked {new_status}",
        book=linked_book, metadata={"request_id": book_request.pk, "status": new_status},
    )
    enqueue_event(school.pk, EVENT_REQUEST_REVIEWED, {"request_id": book_request.pk})
    return book_request
