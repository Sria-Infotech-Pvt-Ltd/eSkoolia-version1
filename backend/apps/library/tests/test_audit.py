"""Final audit proofs (prompt 13). docs/LIBRARY_AUDIT.md points at these tests.

They cover the rows of the audit table that earlier prompts proved only indirectly: a permission code on every
endpoint, authentication on every route, no is_superuser branch in data scoping, query-count bounds on every
list endpoint, row locks in the money and stock paths, the partial unique indexes, money and dates the server
never takes from the client, and donor data never reaching a log.
"""
import ast
import inspect
import logging
from datetime import date, time
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.urls import reverse
from rest_framework.test import APIClient

from apps.communication.models import CommunicationNotification
from apps.core.models import Class, ClassPeriod
from apps.library import urls as library_urls
from apps.library.models import (
    Budget,
    Charge,
    Donation,
    Hold,
    LibraryActivityLog,
    LostDamagedReport,
    PeriodSlot,
    PurchaseOrder,
    BookRequest,
    StockAudit,
    StockAuditItem,
    Visit,
)
from apps.library.services import accession, circulation
from apps.library.tests.conftest import client_for, make_book, make_member, make_user

User = get_user_model()
BASE = "/api/v1/library/"
LIBRARY_DIR = Path(library_urls.__file__).parent
BACKEND_DIR = LIBRARY_DIR.parent.parent


# ---- a permission code on every endpoint -----------------------------------------------------------------------------


def _router_actions():
    for prefix, viewset, _basename in library_urls.router.registry:
        for route in library_urls.router.get_routes(viewset):
            for method, action in route.mapping.items():
                if not hasattr(viewset, action):
                    continue
                if method not in viewset.http_method_names or action in viewset.disabled_actions:
                    continue
                yield prefix, viewset, method, action


def test_every_router_action_has_a_permission_code():
    seen = 0
    for prefix, viewset, method, action in _router_actions():
        instance = viewset()
        instance.action = action
        assert instance.get_required_permission_code(), f"{prefix}: {method.upper()} {action} has no permission code"
        seen += 1
    assert seen > 60  # the router really was walked


def test_a_viewset_with_no_code_for_an_action_fails_closed(school):
    """The base class refuses an action it has no code for: 403, never a quiet pass."""
    from apps.library.views.base import LibraryViewSet

    class Bare(LibraryViewSet):
        permission_codes = {}

    instance = Bare()
    instance.action = "list"
    assert instance.get_required_permission_code() is None


NON_ROUTER = [
    ("library-settings", "get"), ("library-console-summary", "get"), ("library-budget", "get"),
    ("library-acquisitions-summary", "get"), ("library-visit-check-in", "post"), ("library-visit-occupancy", "get"),
    ("library-visit-footfall", "get"), ("library-report-circulation", "get"), ("library-report-trend", "get"),
    ("library-report-fines", "get"), ("library-report-budget", "get"),
]


@pytest.mark.parametrize("name,method", NON_ROUTER)
def test_every_plain_endpoint_needs_a_login_and_a_code(school, name, method):
    url = reverse(name)
    assert getattr(APIClient(), method)(url).status_code == 401
    nobody = client_for(make_user(school, []))
    assert getattr(nobody, method)(url).status_code == 403


def test_every_router_route_needs_a_login():
    anonymous = APIClient()
    for prefix, _viewset, _basename in library_urls.router.registry:
        assert anonymous.get(f"{BASE}{prefix}/").status_code == 401, prefix


def test_every_router_list_refuses_a_user_with_no_code(school):
    nobody = client_for(make_user(school, []))
    for prefix, viewset, _basename in library_urls.router.registry:
        if "get" not in {m for r in library_urls.router.get_routes(viewset) for m in r.mapping} or "list" in viewset.disabled_actions:
            continue
        assert nobody.get(f"{BASE}{prefix}/").status_code == 403, prefix


# ---- no is_superuser branch in data scoping --------------------------------------------------------------------------


def _scoped_source_files():
    files = [
        path
        for path in LIBRARY_DIR.rglob("*.py")
        if "tests" not in path.parts and "migrations" not in path.parts and "__pycache__" not in path.parts
    ]
    files += [BACKEND_DIR / "apps" / "teacher_portal" / "library_views.py", BACKEND_DIR / "apps" / "parent_portal" / "library_views.py"]
    return files


def test_no_library_code_branches_on_is_superuser():
    """A real use (attribute or name), not the word in a docstring. Docstrings only say it is NOT used."""
    offenders = []
    files = _scoped_source_files()
    assert len(files) > 40
    for path in files:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if (isinstance(node, ast.Attribute) and node.attr == "is_superuser") or (isinstance(node, ast.Name) and node.id == "is_superuser"):
                offenders.append(f"{path.name}:{node.lineno}")
            if isinstance(node, ast.keyword) and node.arg == "is_superuser":
                offenders.append(f"{path.name}:{node.value.lineno}")
    assert offenders == []


def test_a_superuser_sees_only_their_own_school_in_every_new_list(school, other_school, other_category, other_book, other_member, other_admin):
    root = User.objects.create_superuser(username=f"root_{uuid4().hex[:6]}", password="x", school=school)
    PurchaseOrder.objects.create(school=other_school, po_number="PO-0001", order_date="2026-01-01", vendor_name="V", books_count=1)
    Donation.objects.create(school=other_school, donor_name="D", donation_date="2026-01-01", books_count=1, receipt_no="DR-0001")
    BookRequest.objects.create(school=other_school, requested_by=other_admin, title="Foreign")
    StockAudit.objects.create(school=other_school, scope_rack="X", started_at="2026-01-01T00:00:00Z", status="completed")
    period = ClassPeriod.objects.create(school=other_school, period="P", start_time=time(9, 0), end_time=time(9, 40))
    PeriodSlot.objects.create(school=other_school, school_class=Class.objects.create(school=other_school, name="Grade 1"), day="Mon", period=period)
    LibraryActivityLog.objects.create(school=other_school, event_type="issue", summary="Foreign")
    api = client_for(root)
    for resource in ("categories", "books", "members", "purchase-orders", "donations", "book-requests", "stock-audits", "period-slots", "activity-logs", "charges", "holds", "lost-damaged"):
        assert api.get(f"{BASE}{resource}/").json()["count"] == 0, resource
    assert api.get(f"{BASE}console/summary/").json()["data"]["tiles"]["titles"] == 0


# ---- query counts on every list endpoint -----------------------------------------------------------------------------


def _seed_lists(school, category, admin):
    for n in range(35):
        from apps.library.models import BookCategory

        BookCategory.objects.create(school=school, name=f"Shelf {n}", code=f"S{n:02d}")
    book = make_book(school, category, title="Seed", copies=2)
    members = [make_member(school, f"AUD-{n}", member_type="teacher") for n in range(35)]
    for n, member in enumerate(members):
        Hold.objects.create(school=school, book=book, member=member)
        Charge.objects.create(school=school, member=member, charge_type="registration", amount="10.00", assessed_on=date(2026, 1, 1))
        PurchaseOrder.objects.create(school=school, po_number=f"PO-{n:04d}", order_date="2026-01-01", vendor_name="V", books_count=1)
        Donation.objects.create(school=school, donor_name=f"D{n}", donation_date="2026-01-01", books_count=1, receipt_no=f"DR-{n:04d}")
        BookRequest.objects.create(school=school, requested_by=admin, title=f"Title {n}")
        StockAudit.objects.create(school=school, scope_rack=f"R{n}", started_at="2026-01-01T00:00:00Z", status="completed")
    grade = Class.objects.create(school=school, name="Grade 4")
    periods = [ClassPeriod.objects.create(school=school, period=f"Slot {i}", start_time=time(8 + i, 0), end_time=time(8 + i, 40)) for i in range(6)]
    for index in range(36):
        PeriodSlot.objects.create(
            school=school, school_class=grade, day=("Mon", "Tue", "Wed", "Thu", "Fri", "Sat")[index % 6], period=periods[index // 6], room_label=f"Room {index}",
        )
    return members


@pytest.mark.parametrize("resource", ["categories", "charges", "holds", "purchase-orders", "donations", "book-requests", "period-slots", "stock-audits"])
def test_every_remaining_list_has_a_query_bound(librarian_client, school, category, admin_user, django_assert_max_num_queries, resource):
    _seed_lists(school, category, admin_user)
    librarian_client.get(f"{BASE}{resource}/")  # warm: creates any lazy rows
    with django_assert_max_num_queries(10):
        body = librarian_client.get(f"{BASE}{resource}/", {"page_size": 100}).json()
    assert body["count"] >= 30 and len(body["results"]) >= 30


# ---- row locks in the money and stock paths --------------------------------------------------------------------------


def test_the_lock_helpers_really_lock_rows():
    for helper in (circulation._locked_copy, circulation._locked_member, circulation._locked_loan):
        assert "select_for_update" in inspect.getsource(helper), helper.__name__


@pytest.mark.parametrize("function", [circulation.issue_copy, circulation.renew_loan, circulation.return_loan, circulation.undo_return])
def test_circulation_writes_lock_through_the_helpers_inside_a_transaction(function):
    source = inspect.getsource(function)
    assert "_locked_" in source, function.__name__
    assert "transaction.atomic" in inspect.getsource(inspect.getmodule(function)) and "atomic" in source.split("def ")[0] + source


def test_withdraw_locks_the_copy_and_numbering_locks_the_counter_row():
    from apps.library.services import numbering

    assert "select_for_update" in inspect.getsource(accession.withdraw_copy)
    assert "select_for_update" in inspect.getsource(accession.add_copies)
    assert "select_for_update" in inspect.getsource(numbering.next_accession_code)
    assert "select_for_update" in inspect.getsource(numbering._next_counter_number)


# ---- partial unique indexes and constraints --------------------------------------------------------------------------


def _two(factory):
    factory(1)
    with pytest.raises(IntegrityError), transaction.atomic():
        factory(2)


def test_one_waiting_hold_per_member_and_title(school, category):
    book = make_book(school, category, copies=1)
    member = make_member(school, "UQ-H", member_type="teacher")
    _two(lambda n: Hold.objects.create(school=school, book=book, member=member, status="waiting"))
    Hold.objects.create(school=school, book=book, member=member, status="cancelled")  # only waiting rows are unique


def test_one_open_stock_check_per_scope(school):
    _two(lambda n: StockAudit.objects.create(school=school, scope_rack="R1", started_at="2026-01-01T00:00:00Z"))
    StockAudit.objects.create(school=school, scope_rack="R1", started_at="2026-01-01T00:00:00Z", status="completed")


def test_a_class_wide_slot_is_unique_even_though_the_section_is_null(school):
    grade = Class.objects.create(school=school, name="Grade 2")
    period = ClassPeriod.objects.create(school=school, period="UQ", start_time=time(9, 0), end_time=time(9, 40))
    _two(lambda n: PeriodSlot.objects.create(school=school, school_class=grade, day="Mon", period=period, room_label=f"Room {n}"))


def test_a_room_holds_one_class_at_a_time(school):
    period = ClassPeriod.objects.create(school=school, period="UQ", start_time=time(9, 0), end_time=time(9, 40))
    classes = [Class.objects.create(school=school, name=f"Grade {n}") for n in (1, 2)]
    _two(lambda n: PeriodSlot.objects.create(school=school, school_class=classes[n - 1], day="Mon", period=period, room_label="Main Library"))


def test_numbers_and_receipts_are_unique_per_school(school, other_school):
    _two(lambda n: PurchaseOrder.objects.create(school=school, po_number="PO-0001", order_date="2026-01-01", vendor_name="V", books_count=1))
    PurchaseOrder.objects.create(school=other_school, po_number="PO-0001", order_date="2026-01-01", vendor_name="V", books_count=1)
    _two(lambda n: Donation.objects.create(school=school, donor_name="D", donation_date="2026-01-01", books_count=1, receipt_no="DR-0001"))


def test_one_budget_per_year_and_one_visit_per_slot_member_day(school, academic_year, category):
    from apps.library.models import BookCopy

    _two(lambda n: Budget.objects.create(school=school, academic_year=academic_year, amount="1.00"))
    grade = Class.objects.create(school=school, name="Grade 3")
    period = ClassPeriod.objects.create(school=school, period="UQ2", start_time=time(9, 0), end_time=time(9, 40))
    slot = PeriodSlot.objects.create(school=school, school_class=grade, day="Mon", period=period)
    member = make_member(school, "UQ-V", member_type="teacher")
    _two(lambda n: Visit.objects.create(school=school, period_slot=slot, member=member, visit_date=date(2026, 10, 5), checked_in_at="2026-10-05T10:00:00Z"))
    book = make_book(school, category, copies=1)
    audit = StockAudit.objects.create(school=school, scope_rack="Z", started_at="2026-01-01T00:00:00Z", status="completed")
    copy = BookCopy.objects.filter(book=book).first()
    _two(lambda n: StockAuditItem.objects.create(school=school, audit=audit, copy=copy))


def test_a_check_constraint_refuses_negative_money(school):
    with pytest.raises(IntegrityError), transaction.atomic():
        PurchaseOrder.objects.create(school=school, po_number="PO-NEG", order_date="2026-01-01", vendor_name="V", books_count=1, total_cost=Decimal("-1"))


# ---- money and dates the server never takes from the client ----------------------------------------------------------


def test_issue_ignores_a_client_due_date_issue_date_status_and_fine(librarian_client, school, category):
    book = make_book(school, category, copies=2)
    member = make_member(school, "CT-1", member_type="teacher")
    resp = librarian_client.post(
        f"{BASE}issues/issue/",
        {"member": member.pk, "book": book.pk, "due_date": "2099-01-01", "issue_date": "1999-01-01", "status": "returned", "fine_amount": "999", "renew_count": 9},
        format="json",
    )
    assert resp.status_code == 201, resp.json()
    from apps.library.models import BookIssue
    from apps.library.services.settings import get_settings

    loan = BookIssue.objects.get()
    assert loan.issue_date == date.today() and loan.status == "issued" and loan.renew_count == 0 and loan.fine_amount == 0
    assert (loan.due_date - loan.issue_date).days == get_settings(school).flat_loan_days


def test_a_lost_report_ignores_a_client_cost_resolution_source_and_date(librarian_client, school, category):
    book = make_book(school, category, copies=2)
    copy = book.copies.first()
    resp = librarian_client.post(
        f"{BASE}lost-damaged/",
        {"copy": copy.pk, "report_type": "lost", "replacement_cost": "1.00", "resolution": "resolved", "source": "desk_return", "reported_on": "1999-01-01"},
        format="json",
    )
    assert resp.status_code == 201, resp.json()
    report = LostDamagedReport.objects.get()
    assert report.replacement_cost > Decimal("1.00")
    assert report.resolution == "pending" and report.source == "manual" and report.reported_on == date.today()


def test_collecting_a_charge_ignores_a_client_amount_and_status(librarian_client, school):
    member = make_member(school, "CT-2", member_type="teacher")
    charge = Charge.objects.create(school=school, member=member, charge_type="replacement", amount="200.00", assessed_on=date(2026, 1, 1))
    resp = librarian_client.post(f"{BASE}charges/{charge.pk}/collect/", {"amount": "1.00", "status": "waived"}, format="json")
    assert resp.status_code == 200
    charge.refresh_from_db()
    assert charge.amount == Decimal("200.00") and charge.status == "paid"


# ---- donor data never reaches a log -----------------------------------------------------------------------------------


def test_donor_name_and_contact_never_reach_a_log_row_a_notification_or_a_log_line(librarian_client, school, caplog):
    donor, contact = "Unique Donor Zed", "9871234560"
    caplog.set_level(logging.DEBUG)
    created = librarian_client.post(
        f"{BASE}donations/",
        {"donor_name": donor, "donor_type": "parent", "contact": contact, "donation_date": "2026-01-10", "books_count": 3, "estimated_value": "50.00"},
        format="json",
    ).json()["data"]
    librarian_client.patch(f"{BASE}donations/{created['id']}/", {"acknowledgement_sent": True, "notes": "thanks"}, format="json")
    librarian_client.get(f"{BASE}donations/{created['id']}/receipt/")
    librarian_client.get(f"{BASE}activity-logs/export/")
    refused = librarian_client.post(f"{BASE}donations/", {"donor_name": donor, "contact": contact, "books_count": 0, "donation_date": "2026-01-10"}, format="json")
    assert refused.status_code == 400 and contact not in refused.content.decode() and donor not in refused.content.decode()
    for row in LibraryActivityLog.objects.all():
        assert donor not in row.summary and contact not in row.summary
        assert donor not in str(row.metadata) and contact not in str(row.metadata)
    assert not CommunicationNotification.objects.filter(body__contains=donor).exists()
    assert not CommunicationNotification.objects.filter(body__contains=contact).exists()
    assert donor not in caplog.text and contact not in caplog.text
    export = b"".join(librarian_client.get(f"{BASE}activity-logs/export/").streaming_content).decode()
    assert donor not in export and contact not in export


# ---- blueprint 3.3 rows that earlier prompts proved only partly ----------------------------------------------------------


def test_a_foreign_purchase_order_is_a_field_error_on_a_title(librarian_client, other_school, category):
    foreign = PurchaseOrder.objects.create(school=other_school, po_number="PO-0001", order_date="2026-01-01", vendor_name="V", books_count=1)
    resp = librarian_client.post(
        f"{BASE}books/", {"title": "Linked", "category": category.pk, "copies_count": 1, "purchase_order": foreign.pk}, format="json"
    )
    assert resp.status_code == 400 and "purchase_order" in resp.json()["field_errors"]


def test_add_copies_takes_no_source_link_so_a_foreign_one_changes_nothing(librarian_client, other_school, book):
    foreign = PurchaseOrder.objects.create(school=other_school, po_number="PO-0002", order_date="2026-01-01", vendor_name="V", books_count=1)
    resp = librarian_client.post(f"{BASE}books/{book.pk}/add-copies/", {"count": 1, "purchase_order": foreign.pk, "donation": 999}, format="json")
    assert resp.status_code in (200, 201), resp.json()
    book.refresh_from_db()
    assert book.purchase_order_id is None and book.donation_id is None
