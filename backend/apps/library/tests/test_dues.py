"""Fines, dues, suspension and limits: the pure functions (D1 to D5, R3, R10)."""
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest

from apps.library.services.dues import (
    accrued_fine,
    borrowing_limit,
    days_overdue,
    loan_fine,
    replacement_cost,
    summarise_dues,
)

DUE = date(2026, 3, 10)


def fine(days_late, **kwargs):
    kwargs.setdefault("per_day", Decimal("10"))
    return accrued_fine(DUE, DUE + timedelta(days=days_late), **kwargs)


def test_not_overdue_on_or_before_the_due_date():
    assert days_overdue(DUE, DUE) == 0 and days_overdue(DUE, DUE - timedelta(days=3)) == 0
    assert fine(0) == Decimal("0.00") and fine(-2) == Decimal("0.00")


def test_one_day_late_costs_one_day():
    assert fine(1) == Decimal("10.00") and fine(7) == Decimal("70.00")


@pytest.mark.parametrize("late,expected", [(1, "0.00"), (2, "0.00"), (3, "10.00"), (5, "30.00")])
def test_grace_days_are_free(late, expected):
    assert fine(late, grace_days=2) == Decimal(expected)


def test_zero_rate_never_fines():
    assert fine(40, per_day=Decimal("0")) == Decimal("0.00")


def test_fine_cap_applies_when_set_and_not_when_none():
    assert fine(30, cap=Decimal("100")) == Decimal("100.00")
    assert fine(5, cap=Decimal("100")) == Decimal("50.00")
    assert fine(30, cap=None, cap_at_replacement=False) == Decimal("300.00")


def test_cap_at_replacement_cost_on_and_off():
    assert fine(30, replacement=Decimal("200"), cap_at_replacement=True) == Decimal("200.00")
    assert fine(30, replacement=Decimal("200"), cap_at_replacement=False) == Decimal("300.00")
    assert fine(5, replacement=Decimal("200"), cap_at_replacement=True) == Decimal("50.00")
    assert fine(30, replacement=None, cap_at_replacement=True) == Decimal("300.00")  # cost unknown


def test_the_lower_of_cap_and_replacement_wins():
    assert fine(30, cap=Decimal("120"), replacement=Decimal("200")) == Decimal("120.00")
    assert fine(30, cap=Decimal("250"), replacement=Decimal("200")) == Decimal("200.00")


def test_fine_is_rounded_to_cents():
    assert fine(3, per_day=Decimal("3.333")) == Decimal("10.00")  # 9.999 rounds up


def test_replacement_cost_d5():
    assert replacement_cost(Decimal("200"), Decimal("50"), Decimal("150")) == Decimal("250.00")
    assert replacement_cost(Decimal("0"), Decimal("50"), Decimal("150")) == Decimal("150.00")
    assert replacement_cost(None, Decimal("50"), Decimal("150")) == Decimal("150.00")


SETTINGS = SimpleNamespace(
    fine_per_day=Decimal("10"), fine_grace_days=0, fine_cap=None, cap_fine_at_replacement_cost=True,
    replacement_processing_fee=Decimal("50"), replacement_default_cost=Decimal("150"),
    limit_student=2, limit_teacher=5, limit_staff=3,
)


def test_loan_fine_uses_the_schools_settings_and_the_copys_cost():
    # 30 days late = 300, capped at 100 + 50 = 150 replacement
    assert loan_fine(DUE, DUE + timedelta(days=30), Decimal("100"), SETTINGS) == Decimal("150.00")
    # free-cost copy: replacement default 150
    assert loan_fine(DUE, DUE + timedelta(days=30), Decimal("0"), SETTINGS) == Decimal("150.00")
    assert loan_fine(DUE, DUE + timedelta(days=4), Decimal("100"), SETTINGS) == Decimal("40.00")


def test_borrowing_limits_by_member_type_d2():
    assert [borrowing_limit(t, SETTINGS) for t in ("student", "teacher", "staff")] == [2, 5, 3]


def test_suspended_by_overdue_fines_or_replacement_fees():
    assert summarise_dues("10", "0", "0").suspended is True
    assert summarise_dues("0", "150", "0").suspended is True
    assert summarise_dues("0.01", "0", "0").suspended is True


def test_unpaid_registration_alone_does_not_suspend_but_counts_in_the_total():
    summary = summarise_dues("0", "0", "300")
    assert summary.suspended is False and summary.total == Decimal("300.00") and summary.registration_due == Decimal("300.00")


def test_total_adds_all_three_and_clean_member_is_not_suspended():
    summary = summarise_dues("30", "250", "500")
    assert summary.total == Decimal("780.00") and summary.suspended is True
    clean = summarise_dues(0, 0, 0)
    assert clean.total == Decimal("0.00") and clean.suspended is False
