"""Fines, dues, suspension and borrowing limits as pure functions (decisions D1 to D5, rules R3 and R10).

Nothing here touches the database. `settings` is any object with the LibrarySettings
attribute names, so tests can pass a simple namespace.
"""
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")
ZERO = Decimal("0.00")

# Member type to the settings field holding its borrowing limit (D2).
_LIMIT_FIELD = {"student": "limit_student", "teacher": "limit_teacher", "staff": "limit_staff"}


def money(value):
    """Round to two decimals, half up, as a Decimal."""
    return Decimal(value or 0).quantize(CENT, rounding=ROUND_HALF_UP)


def days_overdue(due_date: date, as_of: date) -> int:
    """Whole days past the due date. Due today is 0, not overdue (R10)."""
    return max(0, (as_of - due_date).days)


def replacement_cost(cost_per_copy, processing_fee, default_cost) -> Decimal:
    """D5: copy cost plus the handling fee, or the default cost when the copy cost is 0."""
    cost = Decimal(cost_per_copy or 0)
    return money(cost + Decimal(processing_fee or 0)) if cost > 0 else money(default_cost)


def accrued_fine(
    due_date: date,
    as_of: date,
    *,
    per_day,
    grace_days: int = 0,
    cap=None,
    replacement=None,
    cap_at_replacement: bool = True,
) -> Decimal:
    """Fine accrued on an open loan (D1).

    Days past the due date, minus the grace days (never below 0), times the daily rate. Then the
    lower of: the school's fine cap (when set) and the copy's replacement cost (when the cap at
    replacement cost is on and a cost is known).
    """
    chargeable = max(0, days_overdue(due_date, as_of) - int(grace_days or 0))
    fine = Decimal(per_day or 0) * chargeable
    if cap is not None:
        fine = min(fine, Decimal(cap))
    if cap_at_replacement and replacement is not None:
        fine = min(fine, Decimal(replacement))
    return money(fine)


def loan_fine(due_date: date, as_of: date, cost_per_copy, settings) -> Decimal:
    """accrued_fine with every parameter taken from the school's settings and the copy's cost."""
    return accrued_fine(
        due_date,
        as_of,
        per_day=settings.fine_per_day,
        grace_days=settings.fine_grace_days,
        cap=settings.fine_cap,
        replacement=replacement_cost(cost_per_copy, settings.replacement_processing_fee, settings.replacement_default_cost),
        cap_at_replacement=settings.cap_fine_at_replacement_cost,
    )


def borrowing_limit(member_type: str, settings) -> int:
    """D2: how many books at once for this member type."""
    return int(getattr(settings, _LIMIT_FIELD[member_type]))


@dataclass(frozen=True)
class DuesSummary:
    overdue_fines: Decimal
    replacement_fees: Decimal
    registration_due: Decimal
    total: Decimal
    suspended: bool


def summarise_dues(overdue_fines, replacement_fees, registration_due) -> DuesSummary:
    """Totals and the suspension rule (R3).

    Suspended means overdue fines or unpaid replacement fees above zero. An unpaid registration
    fee counts toward the total owed but never suspends borrowing (D6).
    """
    fines, replacements, registration = money(overdue_fines), money(replacement_fees), money(registration_due)
    return DuesSummary(
        overdue_fines=fines,
        replacement_fees=replacements,
        registration_due=registration,
        total=money(fines + replacements + registration),
        suspended=fines > 0 or replacements > 0,
    )
