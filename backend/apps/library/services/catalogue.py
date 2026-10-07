"""Read-side helpers for the catalogue: the annotated queryset behind every title list (blueprint 4.7)."""
from decimal import Decimal

from django.db.models import (
    Count,
    DecimalField,
    ExpressionWrapper,
    F,
    IntegerField,
    Q,
    Value,
)

from apps.library.models import BookCopy

AVAILABLE, LOW, ISSUED = "available", "low", "issued"
AVAILABILITY_VALUES = (AVAILABLE, LOW, ISSUED)


def _count(status):
    return Count("copies", filter=Q(copies__status=status))


def annotate_copy_counts(queryset):
    """Add copy counts in one grouped query.

    copies_total excludes withdrawn copies (they have left the collection); the
    other counts are per status. holds_waiting is 0 until the holds model exists.
    """
    return queryset.annotate(
        copies_total=Count("copies", filter=~Q(copies__status=BookCopy.STATUS_WITHDRAWN)),
        copies_available=_count(BookCopy.STATUS_AVAILABLE),
        copies_issued=_count(BookCopy.STATUS_ISSUED),
        copies_lost=_count(BookCopy.STATUS_LOST),
        copies_damaged=_count(BookCopy.STATUS_DAMAGED),
        copies_withdrawn=_count(BookCopy.STATUS_WITHDRAWN),
        holds_waiting=Value(0, output_field=IntegerField()),
    )


def availability_status(available, total, low_ratio):
    """R11: all issued at 0 available, low at or under the ratio, otherwise available."""
    if available <= 0:
        return ISSUED
    if total and Decimal(available) / Decimal(total) <= Decimal(low_ratio):
        return LOW
    return AVAILABLE


def filter_availability(queryset, value, low_ratio):
    """Filter an annotated queryset by derived availability."""
    threshold = ExpressionWrapper(F("copies_total") * Value(Decimal(low_ratio)), output_field=DecimalField(max_digits=14, decimal_places=4))
    if value == ISSUED:
        return queryset.filter(copies_available=0)
    if value == LOW:
        return queryset.filter(copies_available__gt=0).filter(copies_available__lte=threshold)
    if value == AVAILABLE:
        return queryset.filter(copies_available__gt=0).filter(copies_available__gt=threshold)
    return queryset
