"""Activity feed, CSV export and the four reports (prompt 10)."""
from datetime import date, datetime
from decimal import Decimal

import csv
import io

import pytest
from django.utils import timezone

from apps.core.models import AcademicYear
from apps.library.models import BookCategory, BookIssue, Charge, LibraryActivityLog, PurchaseOrder
from apps.library.services import activity_feed
from apps.library.services.activity import log_event
from apps.library.tests.conftest import client_for, make_book, make_member, make_user

BASE = "/api/v1/library/"
LOGS = f"{BASE}activity-logs/"
EXPORT = f"{LOGS}export/"


def stamp(row, year, month, day):
    LibraryActivityLog.objects.filter(pk=row.pk).update(created_at=timezone.make_aware(datetime(year, month, day, 12, 0)))
    return row


def body(response):
    return b"".join(response.streaming_content).decode("utf-8")


def lines(response):
    return [line for line in body(response).split("\r\n") if line]


# ---- activity feed ---------------------------------------------------------------------------------------------------


def test_feed_is_newest_first_paginated_and_school_scoped(librarian_client, school, other_school):
    first = log_event(school, None, "issue", "First")
    second = log_event(school, None, "return", "Second")
    log_event(other_school, None, "issue", "Not ours")
    data = librarian_client.get(LOGS).json()
    assert [r["summary"] for r in data["results"]] == ["Second", "First"] and data["count"] == 2
    assert data["success"] is True and data["results"][0]["id"] == second.pk > first.pk
    assert {"event_type", "summary", "created_at", "actor_name", "member", "book"} <= set(data["results"][0])
    assert librarian_client.get(LOGS, {"page_size": 1}).json()["count"] == 2


def test_feed_is_read_only(librarian_client, school):
    row = log_event(school, None, "issue", "Row")
    assert librarian_client.post(LOGS, {"summary": "x"}, format="json").status_code == 405
    assert librarian_client.patch(f"{LOGS}{row.pk}/", {"summary": "x"}, format="json").status_code == 405
    assert librarian_client.delete(f"{LOGS}{row.pk}/").status_code == 405


def test_filter_by_event_type_single_and_several(librarian_client, school):
    for kind in ("issue", "return", "lost", "issue"):
        log_event(school, None, kind, f"{kind} row")
    assert librarian_client.get(LOGS, {"event_type": "issue"}).json()["count"] == 2
    assert librarian_client.get(LOGS, {"event_type": "return,lost"}).json()["count"] == 2
    resp = librarian_client.get(LOGS, {"event_type": "issue,teleport"})
    assert resp.status_code == 400 and "event_type" in resp.json()["field_errors"]


def test_filter_by_dates_is_inclusive_and_validated(librarian_client, school):
    for day in (1, 2, 3):
        stamp(log_event(school, None, "issue", f"Day {day}"), 2026, 3, day)
    both = librarian_client.get(LOGS, {"from": "2026-03-02", "to": "2026-03-02"}).json()
    assert [r["summary"] for r in both["results"]] == ["Day 2"]
    assert librarian_client.get(LOGS, {"from": "2026-03-02"}).json()["count"] == 2
    assert librarian_client.get(LOGS, {"to": "2026-03-01"}).json()["count"] == 1
    for bad in ({"from": "soon"}, {"to": "2026-13-45"}, {"from": "2026-03-05", "to": "2026-03-01"}):
        assert librarian_client.get(LOGS, bad).status_code == 400


def test_filter_by_actor_member_book_and_search(librarian_client, school, librarian, admin_user, book, member):
    log_event(school, librarian, "issue", "Issued Treasure Island", book=book, member=member)
    log_event(school, admin_user, "return", "Returned something else")
    assert librarian_client.get(LOGS, {"actor": librarian.pk}).json()["count"] == 1
    assert librarian_client.get(LOGS, {"member": member.pk}).json()["count"] == 1
    # The fixture's accession already logged a row for the book, so the issue is the second.
    assert librarian_client.get(LOGS, {"book": book.pk}).json()["count"] == 2
    assert librarian_client.get(LOGS, {"book": book.pk, "event_type": "issue"}).json()["count"] == 1
    assert librarian_client.get(LOGS, {"search": "treasure", "event_type": "issue"}).json()["count"] == 1
    assert librarian_client.get(LOGS, {"search": "nothing like this"}).json()["count"] == 0
    assert librarian_client.get(LOGS, {"actor": "abc"}).status_code == 400
    assert librarian_client.get(LOGS, {"member": "1; drop"}).status_code == 400


def test_another_schools_ids_return_nothing_not_their_rows(librarian_client, other_school, other_book, other_member, other_admin):
    log_event(other_school, other_admin, "issue", "Foreign", book=other_book, member=other_member)
    for name, value in (("actor", other_admin.pk), ("member", other_member.pk), ("book", other_book.pk)):
        assert librarian_client.get(LOGS, {name: value}).json()["count"] == 0
    assert librarian_client.get(f"{LOGS}{LibraryActivityLog.objects.first().pk}/").status_code == 404


def test_feed_query_count_is_fixed_with_many_rows(librarian_client, school, librarian, django_assert_max_num_queries):
    log_event(school, librarian, "issue", "warm up")
    librarian_client.get(LOGS)
    with django_assert_max_num_queries(8):
        librarian_client.get(LOGS, {"page_size": 100})
    for n in range(60):
        log_event(school, librarian if n % 2 else None, "issue", f"Row {n}")
    with django_assert_max_num_queries(8):
        data = librarian_client.get(LOGS, {"page_size": 100}).json()
    assert data["count"] == 61 and len(data["results"]) == 61 and data["results"][0]["actor_name"] in ("", librarian.get_full_name() or librarian.username)


# ---- export -----------------------------------------------------------------------------------------------------------


def test_export_streams_csv_with_header_and_rows(librarian_client, school, librarian):
    log_event(school, librarian, "issue", "Issued a book")
    log_event(school, None, "return", "Returned, with a comma")
    resp = librarian_client.get(EXPORT)
    assert resp.status_code == 200 and resp.streaming and resp["Content-Type"].startswith("text/csv")
    assert resp["Content-Disposition"].startswith('attachment; filename="library-activity-') and resp["Cache-Control"] == "no-store"
    rows = lines(resp)
    assert rows[0] == "Timestamp,Type,Details,Staff,Member id,Book id"
    assert len(rows) == 3 and any('"Returned, with a comma"' in r for r in rows)


def test_export_works_when_the_client_asks_for_csv(librarian_client, school):
    log_event(school, None, "issue", "Row")
    resp = librarian_client.get(EXPORT, HTTP_ACCEPT="text/csv")
    assert resp.status_code == 200 and len(lines(resp)) == 2


def test_export_applies_the_same_filters_and_stays_in_school(librarian_client, school, other_school):
    log_event(school, None, "issue", "Keep me")
    log_event(school, None, "return", "Drop me")
    log_event(other_school, None, "issue", "Foreign row")
    text = body(librarian_client.get(EXPORT, {"event_type": "issue"}))
    assert "Keep me" in text and "Drop me" not in text and "Foreign row" not in text
    assert librarian_client.get(EXPORT, {"from": "nonsense"}).status_code == 400


def test_export_is_capped(librarian_client, school, monkeypatch):
    monkeypatch.setattr(activity_feed, "EXPORT_ROW_CAP", 3)
    for n in range(10):
        log_event(school, None, "issue", f"Row {n}")
    resp = librarian_client.get(EXPORT)
    assert len(lines(resp)) == 1 + 3 and resp["X-Export-Rows"] == "3"
    marker = LibraryActivityLog.objects.get(event_type="export")
    assert marker.metadata["rows"] == 3 and marker.metadata["capped"] is True and "(capped)" in marker.summary


def test_the_cap_is_fifty_thousand():
    assert activity_feed.EXPORT_ROW_CAP == 50_000


@pytest.mark.parametrize("text", [
    "=HYPERLINK(\"http://example.test\",\"x\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1", "  =cmd", "\n=1",
])
def test_export_neutralises_formula_cells(librarian_client, school, text):
    log_event(school, None, "issue", text)
    rows = list(csv.reader(io.StringIO(body(librarian_client.get(EXPORT)), newline="")))
    cell = next(r[2] for r in rows[1:] if r[1] == "issue")
    assert cell == "'" + text and not cell.startswith(("=", "+", "-", "@", "\t", "\r"))


def test_csv_cell_unit_rules():
    assert activity_feed.csv_cell("=1") == "'=1"
    assert activity_feed.csv_cell(" +1") == "' +1"
    assert activity_feed.csv_cell("plain") == "plain" and activity_feed.csv_cell("a-b") == "a-b" and activity_feed.csv_cell("x=1") == "x=1"
    assert activity_feed.csv_cell(None) == "" and activity_feed.csv_cell(7) == "7"
    assert activity_feed.csv_cell("-") == "'-"


def test_export_is_logged_with_its_own_row_and_leaves_it_out_of_the_file(librarian_client, school, librarian):
    log_event(school, None, "issue", "One")
    log_event(school, None, "issue", "Two")
    resp = librarian_client.get(EXPORT, {"event_type": "issue", "search": "secret-name"})
    assert len(lines(resp)) == 1  # search matched nothing
    marker = LibraryActivityLog.objects.get(event_type="export")
    assert marker.actor_id == librarian.pk and marker.metadata["rows"] == 0
    assert marker.metadata["filters"] == {"event_type": ["issue"]} and marker.metadata["searched"] is True
    assert "secret-name" not in str(marker.metadata) and "secret-name" not in marker.summary
    second = body(librarian_client.get(EXPORT))
    assert second.count("Exported the activity log") == 1  # the first export's row is a normal row; this export's own row is left out
    assert LibraryActivityLog.objects.filter(event_type="export").count() == 2


def test_each_export_writes_exactly_one_row(librarian_client, school):
    log_event(school, None, "issue", "One")
    librarian_client.get(EXPORT)
    assert LibraryActivityLog.objects.filter(event_type="export").count() == 1
    librarian_client.get(LOGS)  # viewing never writes
    assert LibraryActivityLog.objects.filter(event_type="export").count() == 1


def test_export_needs_its_own_code(school):
    log_event(school, None, "issue", "Row")
    viewer = client_for(make_user(school, ["library.activity_logs.view"]))
    exporter = client_for(make_user(school, ["library.activity_logs.export"]))
    assert viewer.get(LOGS).status_code == 200 and viewer.get(EXPORT).status_code == 403
    assert exporter.get(EXPORT).status_code == 200 and exporter.get(LOGS).status_code == 403
    assert LibraryActivityLog.objects.filter(event_type="export").count() == 1  # the refused call wrote nothing


# ---- reports ----------------------------------------------------------------------------------------------------------


@pytest.fixture
def year(school):
    return AcademicYear.objects.create(school=school, name="2026-2027", start_date="2026-06-01", end_date="2027-03-31", is_current=True)


def loan(school, book, member, issued, returned=None, status="issued", copy=None):
    return BookIssue.objects.create(
        school=school, book=book, copy=copy or book.copies.first(), member=member, issue_date=issued, due_date=date(2030, 1, 1),
        return_date=returned, status="returned" if returned else status,
    )


@pytest.fixture
def seeded(school, category, year):
    fiction, science = category, BookCategory.objects.create(school=school, name="Science", code="SCI", color_key="info")
    novel = make_book(school, fiction, title="Novel", copies=6)
    atlas = make_book(school, science, title="Atlas", copies=6)
    loose = make_book(school, fiction, title="Loose", copies=2)
    type(loose).objects.filter(pk=loose.pk).update(category=None)
    member = make_member(school, "R-1", member_type="teacher")
    copies = list(novel.copies.all())
    loan(school, novel, member, date(2026, 7, 10), returned=date(2026, 7, 20), copy=copies[0])
    loan(school, novel, member, date(2026, 7, 15), returned=date(2026, 8, 1), copy=copies[1])
    loan(school, novel, member, date(2026, 9, 2), copy=copies[2])
    loan(school, atlas, member, date(2026, 7, 5), returned=date(2026, 9, 9), copy=atlas.copies.first())
    loan(school, loose, member, date(2026, 10, 1), copy=loose.copies.first())
    loan(school, novel, member, date(2026, 4, 1), returned=date(2026, 4, 5), copy=copies[3])  # before the year
    return member


def test_circulation_by_category_counts_issues_in_the_year(librarian_client, seeded, year):
    data = librarian_client.get(f"{BASE}reports/circulation-by-category/").json()["data"]
    assert data["from"] == "2026-06-01" and data["to"] == "2027-03-31" and data["academic_year"] == year.pk
    rows = {r["category_name"]: r for r in data["results"]}
    assert rows["Fiction"]["issues"] == 3 and rows["Science"]["issues"] == 1 and rows["Uncategorised"]["issues"] == 1
    assert data["total"] == 5 and rows["Science"]["color_key"] == "info"
    assert sum(r["share"] for r in data["results"]) == pytest.approx(1, abs=0.001)
    assert [r["issues"] for r in data["results"]] == sorted((r["issues"] for r in data["results"]), reverse=True)


def test_report_range_overrides_and_validation(librarian_client, seeded):
    url = f"{BASE}reports/circulation-by-category/"
    data = librarian_client.get(url, {"from": "2026-04-01", "to": "2026-04-30"}).json()["data"]
    assert data["total"] == 1 and data["from"] == "2026-04-01"
    only_to = librarian_client.get(url, {"to": "2026-07-31"}).json()["data"]
    assert only_to["from"] == "2026-06-01" and only_to["total"] == 3
    assert librarian_client.get(url, {"from": "2026-05-01", "to": "2026-04-01"}).status_code == 400
    assert librarian_client.get(url, {"from": "bad"}).status_code == 400


def test_reports_without_a_current_year_need_dates(librarian_client, school):
    url = f"{BASE}reports/circulation-by-category/"
    resp = librarian_client.get(url)
    assert resp.status_code == 400 and set(resp.json()["field_errors"]) == {"from", "to"}
    ok = librarian_client.get(url, {"from": "2026-01-01", "to": "2026-01-31"})
    assert ok.status_code == 200 and ok.json()["data"]["total"] == 0 and ok.json()["data"]["academic_year"] is None


def test_academic_year_parameter_picks_another_year_and_refuses_a_foreign_one(librarian_client, school, other_school, seeded):
    older = AcademicYear.objects.create(school=school, name="2025-2026", start_date="2026-03-01", end_date="2026-05-31")
    foreign = AcademicYear.objects.create(school=other_school, name="2026-2027", start_date="2026-06-01", end_date="2027-03-31")
    url = f"{BASE}reports/circulation-by-category/"
    assert librarian_client.get(url, {"academic_year": older.pk}).json()["data"]["total"] == 1
    for name in ("circulation-by-category", "monthly-trend", "fines-and-fees", "budget-vs-spend"):
        assert librarian_client.get(f"{BASE}reports/{name}/", {"academic_year": foreign.pk}).status_code == 404, name
        assert librarian_client.get(f"{BASE}reports/{name}/", {"academic_year": "abc"}).status_code == 404, name


def test_reports_leave_out_another_schools_loans(librarian_client, seeded, other_school, other_category):
    book = make_book(other_school, other_category, title="Foreign", copies=2)
    foreign_member = make_member(other_school, "F-1", member_type="teacher")
    loan(other_school, book, foreign_member, date(2026, 7, 11))
    assert librarian_client.get(f"{BASE}reports/circulation-by-category/").json()["data"]["total"] == 5
    assert librarian_client.get(f"{BASE}reports/monthly-trend/").json()["data"]["total_issues"] == 5


def test_monthly_trend_fills_empty_months_and_counts_returns(librarian_client, seeded):
    data = librarian_client.get(f"{BASE}reports/monthly-trend/", {"from": "2026-06-01", "to": "2026-10-31"}).json()["data"]
    by_month = {r["month"]: r for r in data["results"]}
    assert list(by_month) == ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]
    assert [by_month[m]["issues"] for m in by_month] == [0, 3, 0, 1, 1]
    assert [by_month[m]["returns"] for m in by_month] == [0, 1, 1, 1, 0]
    assert data["total_issues"] == 5 and data["total_returns"] == 3


def test_monthly_trend_across_a_year_boundary(librarian_client, seeded):
    data = librarian_client.get(f"{BASE}reports/monthly-trend/", {"from": "2026-11-15", "to": "2027-02-02"}).json()["data"]
    assert [r["month"] for r in data["results"]] == ["2026-11", "2026-12", "2027-01", "2027-02"]


def test_fines_and_fees_columns_add_up(librarian_client, school, member, year):
    def charge(kind, status, amount, on="2026-08-01"):
        return Charge.objects.create(school=school, member=member, charge_type=kind, amount=amount, status=status, assessed_on=on)
    charge("overdue_fine", "paid", "40.00")
    charge("overdue_fine", "paid", "10.50")
    charge("overdue_fine", "waived", "20.00")
    charge("overdue_fine", "pending", "5.00")
    charge("replacement", "paid", "150.00")
    charge("replacement", "written_off", "200.00")
    charge("registration", "pending", "300.00")
    charge("overdue_fine", "paid", "999.00", on="2026-01-01")  # outside the year
    data = librarian_client.get(f"{BASE}reports/fines-and-fees/").json()["data"]
    rows = {r["charge_type"]: r for r in data["results"]}
    fine = rows["overdue_fine"]
    assert (fine["charged"], fine["collected"], fine["waived"], fine["outstanding"], fine["count"]) == ("75.50", "50.50", "20.00", "5.00", 4)
    assert rows["replacement"]["collected"] == "150.00" and rows["replacement"]["written_off"] == "200.00"
    assert rows["registration"]["outstanding"] == "300.00" and rows["registration"]["collected"] == "0.00"
    totals = data["totals"]
    assert totals["charged"] == "725.50" and totals["collected"] == "200.50" and totals["waived"] == "20.00" and totals["count"] == 7
    for row in data["results"]:
        parts = sum(Decimal(row[k]) for k in ("collected", "waived", "written_off", "outstanding"))
        assert parts == Decimal(row["charged"])
    assert librarian_client.get(f"{BASE}reports/fines-and-fees/", {"from": "2026-01-01", "to": "2026-01-31"}).json()["data"]["totals"]["collected"] == "999.00"


def test_fines_and_fees_is_empty_not_an_error_with_no_charges(librarian_client, year):
    data = librarian_client.get(f"{BASE}reports/fines-and-fees/").json()["data"]
    assert data["totals"]["charged"] == "0.00" and data["totals"]["count"] == 0 and len(data["results"]) == 3


def test_budget_vs_spend_matches_the_acquisitions_summary(librarian_client, school, year):
    librarian_client.put(f"{BASE}budgets/", {"academic_year": year.pk, "amount": "10000.00"}, format="json")
    for cost, status, pay in (("1500.00", "received", "paid"), ("2000.00", "ordered", "pending"), ("4000.00", "cancelled", "pending")):
        PurchaseOrder.objects.create(school=school, po_number=f"PO-{cost}", order_date="2026-08-01", vendor_name="V", books_count=1,
                                     total_cost=cost, status=status, payment_status=pay, academic_year=year)
    data = librarian_client.get(f"{BASE}reports/budget-vs-spend/").json()["data"]
    summary = librarian_client.get(f"{BASE}acquisitions/summary/").json()["data"]
    for key in ("budget", "committed", "paid", "remaining"):
        assert Decimal(data[key]) == Decimal(str(summary[key]))
    assert data["has_budget"] == summary["has_budget"]
    assert data["committed"] == "3500.00" and data["paid"] == "1500.00" and data["remaining"] == "6500.00"
    assert {r["status"]: (r["orders"], r["total"]) for r in data["by_status"]} == {
        "cancelled": (1, "4000.00"), "ordered": (1, "2000.00"), "received": (1, "1500.00")}


def test_budget_vs_spend_without_a_year_is_404(librarian_client, school):
    assert librarian_client.get(f"{BASE}reports/budget-vs-spend/").status_code == 404


def test_reports_use_a_fixed_number_of_queries(librarian_client, school, category, year, django_assert_max_num_queries):
    member = make_member(school, "Q-1", member_type="teacher")
    book = make_book(school, category, title="Many", copies=40)
    names = ("circulation-by-category", "monthly-trend", "fines-and-fees", "budget-vs-spend")
    for name in names:
        librarian_client.get(f"{BASE}reports/{name}/")
    for index, copy in enumerate(book.copies.all()):
        loan(school, book, member, date(2026, 7, 1 + index % 27), returned=date(2026, 8, 1) if index % 2 else None, copy=copy)
        Charge.objects.create(school=school, member=member, charge_type="overdue_fine", amount=1, assessed_on="2026-08-01")
    for name in names:
        with django_assert_max_num_queries(8):
            assert librarian_client.get(f"{BASE}reports/{name}/").status_code == 200, name


# ---- permissions ------------------------------------------------------------------------------------------------------


MATRIX = [
    ("library.activity_logs.view", LOGS),
    ("library.activity_logs.export", EXPORT),
    ("library.reports.view", f"{BASE}reports/circulation-by-category/"),
    ("library.reports.view", f"{BASE}reports/monthly-trend/"),
    ("library.reports.view", f"{BASE}reports/fines-and-fees/"),
    ("library.reports.view", f"{BASE}reports/budget-vs-spend/"),
]


@pytest.mark.parametrize("index", range(len(MATRIX)))
def test_each_door_opens_for_its_own_code_and_for_no_other(school, year, index):
    code, url = MATRIX[index]
    assert client_for(make_user(school, [code])).get(url).status_code != 403, code
    others = sorted({c for c, _ in MATRIX if c != code})
    assert client_for(make_user(school, others)).get(url).status_code == 403, code


def test_a_user_with_no_library_code_is_refused_everywhere(school, year):
    nobody = client_for(make_user(school, []))
    for _code, url in MATRIX:
        assert nobody.get(url).status_code == 403, url
    assert not LibraryActivityLog.objects.filter(event_type="export").exists()
