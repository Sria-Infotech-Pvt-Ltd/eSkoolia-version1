"""Library reports (blueprint 2.4, decision D9). Every figure is a grouped query; nothing loops over loans.

The default range is the current academic year (D9). `academic_year` picks another of the school's years
and `from` and `to` override either end. Counting rules are stated on each function and in the progress file.
"""
from datetime import date
from decimal import Decimal

from django.db.models import Count, Sum
from django.db.models.functions import TruncMonth
from rest_framework.exceptions import NotFound
from rest_framework.exceptions import ValidationError as FieldValidationError

from apps.core.models import AcademicYear
from apps.library.models import BookIssue, Charge, PurchaseOrder

from . import acquisitions
from .activity_feed import _date

ZERO = Decimal("0.00")


def _year_for(school, params):
    """The academic year the request names (404 when it is not this school's), else the current one, else None."""
    raw = params.get("academic_year")
    if raw not in (None, ""):
        try:
            return AcademicYear.objects.get(pk=int(raw), school=school)
        except (ValueError, TypeError, AcademicYear.DoesNotExist):
            raise NotFound("Academic year not found.")
    return acquisitions.current_academic_year(school)


def resolve_range(school, params):
    """(from, to, academic year or None). `from` and `to` win; a missing end comes from the year."""
    year = _year_for(school, params)
    start = _date(params["from"], "from") if params.get("from") else (year.start_date if year else None)
    end = _date(params["to"], "to") if params.get("to") else (year.end_date if year else None)
    missing = {name: "No current academic year is set: give a date." for name, value in (("from", start), ("to", end)) if value is None}
    if missing:
        raise FieldValidationError(missing)
    if end < start:
        raise FieldValidationError({"to": "The end date is before the start date."})
    return start, end, year


def _range_meta(start, end, year):
    return {
        "from": start.isoformat(),
        "to": end.isoformat(),
        "academic_year": year.pk if year else None,
        "academic_year_name": year.name if year else "",
    }


def circulation_by_category(school, start, end, year=None) -> dict:
    """Loans issued in the range (any status), grouped by the title's category. Titles with none show as Uncategorised."""
    rows = (
        BookIssue.objects.filter(school=school, issue_date__gte=start, issue_date__lte=end)
        .values("book__category_id", "book__category__name", "book__category__color_key")
        .annotate(issues=Count("id"))
        .order_by("-issues", "book__category__name")
    )
    total = sum(row["issues"] for row in rows)
    results = [
        {
            "category": row["book__category_id"],
            "category_name": row["book__category__name"] or "Uncategorised",
            "color_key": row["book__category__color_key"] or "",
            "issues": row["issues"],
            "share": round(row["issues"] / total, 4) if total else 0,
        }
        for row in rows
    ]
    return {**_range_meta(start, end, year), "total": total, "results": results}


def _months(start: date, end: date):
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        yield date(year, month, 1)
        month += 1
        if month > 12:
            year, month = year + 1, 1


def monthly_trend(school, start, end, year=None) -> dict:
    """Loans issued and loans returned per calendar month of the range. Empty months show 0."""
    issued = {
        row["month"]: row["n"]
        for row in BookIssue.objects.filter(school=school, issue_date__gte=start, issue_date__lte=end)
        .annotate(month=TruncMonth("issue_date"))
        .values("month")
        .annotate(n=Count("id"))
    }
    returned = {
        row["month"]: row["n"]
        for row in BookIssue.objects.filter(school=school, return_date__gte=start, return_date__lte=end)
        .annotate(month=TruncMonth("return_date"))
        .values("month")
        .annotate(n=Count("id"))
    }
    results = [
        {"month": first.strftime("%Y-%m"), "issues": issued.get(first, 0), "returns": returned.get(first, 0)}
        for first in _months(start, end)
    ]
    return {
        **_range_meta(start, end, year),
        "total_issues": sum(r["issues"] for r in results),
        "total_returns": sum(r["returns"] for r in results),
        "results": results,
    }


def fines_and_fees(school, start, end, year=None) -> dict:
    """Charges assessed in the range, by type. Charged is everything assessed; collected is paid; waived is waived;
    written off and outstanding (still pending) are shown so the columns add up to charged."""
    grouped = (
        Charge.objects.filter(school=school, assessed_on__gte=start, assessed_on__lte=end)
        .values("charge_type", "status")
        .annotate(total=Sum("amount"), n=Count("id"))
    )
    buckets = {t: {"charge_type": t, "count": 0, "charged": ZERO, "collected": ZERO, "waived": ZERO, "written_off": ZERO, "outstanding": ZERO}
               for t, _label in Charge.TYPE_CHOICES}
    column = {
        Charge.STATUS_PAID: "collected",
        Charge.STATUS_WAIVED: "waived",
        Charge.STATUS_WRITTEN_OFF: "written_off",
        Charge.STATUS_PENDING: "outstanding",
    }
    for row in grouped:  # at most 3 types x 4 statuses rows
        bucket = buckets[row["charge_type"]]
        amount = Decimal(row["total"] or 0)
        bucket["count"] += row["n"]
        bucket["charged"] += amount
        bucket[column[row["status"]]] += amount
    results = list(buckets.values())
    totals = {key: sum((r[key] for r in results), ZERO) for key in ("charged", "collected", "waived", "written_off", "outstanding")}
    totals["count"] = sum(r["count"] for r in results)
    quantise = lambda d: {k: (str(v.quantize(ZERO)) if isinstance(v, Decimal) else v) for k, v in d.items()}  # noqa: E731
    return {**_range_meta(start, end, year), "results": [quantise(r) for r in results], "totals": quantise(totals)}


def budget_vs_spend(school, year) -> dict:
    """The year's budget against committed and paid (same maths as acquisitions/summary), plus orders by status."""
    summary = acquisitions.budget_summary(school, year)
    by_status = (
        PurchaseOrder.objects.filter(school=school, academic_year=year)
        .values("status")
        .annotate(orders=Count("id"), total=Sum("total_cost"))
        .order_by("status")
    )
    money = {key: str(Decimal(summary[key]).quantize(ZERO)) for key in ("budget", "committed", "paid", "remaining")}
    return {
        **summary,
        **money,
        "from": year.start_date.isoformat(),
        "to": year.end_date.isoformat(),
        "by_status": [{"status": r["status"], "orders": r["orders"], "total": str(Decimal(r["total"] or 0).quantize(ZERO))} for r in by_status],
    }
