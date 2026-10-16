"""The activity feed behind Transactions and Logs: filters and the CSV export (blueprint 2.4, 4.8).

The feed is append-only. The export is capped, streamed, neutralised against spreadsheet formulas, and
writes its own `export` row before streaming begins.
"""
import csv
from datetime import date

from rest_framework.exceptions import ValidationError as FieldValidationError

from apps.library.models import LibraryActivityLog

from .activity import VALID_EVENT_TYPES, log_event
from .bulk_import import FORMULA_PREFIXES

EXPORT_ROW_CAP = 50_000
CSV_HEADER = ["Timestamp", "Type", "Details", "Staff", "Member id", "Book id"]
FILTER_NAMES = ("event_type", "from", "to", "actor", "member", "book", "search")


def _date(raw, name):
    try:
        return date.fromisoformat(raw)
    except (TypeError, ValueError):
        raise FieldValidationError({name: "Use a date like 2026-01-31."})


def _id(raw, name):
    if not str(raw).isdigit():
        raise FieldValidationError({name: "Use a numeric id."})
    return int(raw)


def clean_filters(params) -> dict:
    """Validate the query string once. Returns only the filters that were given."""
    out = {}
    event_type = (params.get("event_type") or "").strip()
    if event_type:
        types = [t for t in event_type.split(",") if t]
        unknown = [t for t in types if t not in VALID_EVENT_TYPES]
        if unknown:
            raise FieldValidationError({"event_type": f"Unknown type: {', '.join(unknown)}."})
        out["event_type"] = types
    if params.get("from"):
        out["from"] = _date(params["from"], "from")
    if params.get("to"):
        out["to"] = _date(params["to"], "to")
    if "from" in out and "to" in out and out["to"] < out["from"]:
        raise FieldValidationError({"to": "The end date is before the start date."})
    for name in ("actor", "member", "book"):
        if params.get(name):
            out[name] = _id(params[name], name)
    search = (params.get("search") or "").strip()
    if search:
        out["search"] = search[:100]
    return out


def apply_filters(queryset, filters: dict):
    """Narrow an already school-scoped activity queryset. Dates are inclusive."""
    if "event_type" in filters:
        queryset = queryset.filter(event_type__in=filters["event_type"])
    if "from" in filters:
        queryset = queryset.filter(created_at__date__gte=filters["from"])
    if "to" in filters:
        queryset = queryset.filter(created_at__date__lte=filters["to"])
    if "actor" in filters:
        queryset = queryset.filter(actor_id=filters["actor"])
    if "member" in filters:
        queryset = queryset.filter(member_id=filters["member"])
    if "book" in filters:
        queryset = queryset.filter(book_id=filters["book"])
    if "search" in filters:
        queryset = queryset.filter(summary__icontains=filters["search"])
    return queryset


def csv_cell(value) -> str:
    """Text for one CSV cell. A cell a spreadsheet could read as a formula gets a leading apostrophe."""
    text = "" if value is None else str(value)
    return "'" + text if text.lstrip().startswith(FORMULA_PREFIXES) else text


class _Echo:
    def write(self, value):
        return value


def csv_rows(queryset, limit):
    """Generator of CSV lines for at most `limit` rows, header first. Rows are read in chunks."""
    writer = csv.writer(_Echo())
    yield writer.writerow(CSV_HEADER)
    for row in queryset.select_related("actor")[:limit].iterator(chunk_size=2000):
        staff = ""
        if row.actor_id:
            staff = row.actor.get_full_name() or row.actor.username
        yield writer.writerow([
            csv_cell(row.created_at.isoformat()), csv_cell(row.event_type), csv_cell(row.summary), csv_cell(staff),
            csv_cell(row.member_id), csv_cell(row.book_id),
        ])


def start_export(school, actor, queryset, filters: dict):
    """Write the export's own log row and return (lines generator, row count). The new row is left out of the file."""
    total = queryset.count()
    rows = min(total, EXPORT_ROW_CAP)
    logged_filters = {k: (v.isoformat() if isinstance(v, date) else v) for k, v in filters.items() if k != "search"}
    marker = log_event(
        school, actor, LibraryActivityLog.EVENT_EXPORT,
        f"Exported the activity log: {rows} row{'' if rows == 1 else 's'}" + (" (capped)" if total > EXPORT_ROW_CAP else ""),
        metadata={"rows": rows, "capped": total > EXPORT_ROW_CAP, "filters": logged_filters, "searched": "search" in filters},
    )
    return csv_rows(queryset.exclude(pk=marker.pk), EXPORT_ROW_CAP), rows
