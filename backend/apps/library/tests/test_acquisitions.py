"""Purchase orders, donations, budget, summary and the teacher request queue (prompt 8)."""
import threading
from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.db import connection

from apps.communication.models import CommunicationNotification
from apps.core.models import AcademicYear
from apps.library import tasks
from apps.library.models import (
    BookRequest,
    Budget,
    Donation,
    LibraryActivityLog,
    PurchaseOrder,
)
from apps.library.services import notifications
from apps.library.services.numbering import next_po_number, next_receipt_number
from apps.library.services.settings import get_settings
from apps.library.tests.conftest import client_for, make_book, make_user

User = get_user_model()
BASE = "/api/v1/library/"
CONTACT = "9998887777"
DONOR = "Asha Donor Example"


def po_payload(**extra):
    return {"order_date": "2026-01-10", "vendor_name": "Vendor One", "books_count": 10, "total_cost": "1000.00", **extra}


def donation_payload(**extra):
    return {"donor_name": DONOR, "donor_type": "parent", "contact": CONTACT, "donation_date": "2026-01-10",
            "books_count": 5, "estimated_value": "250.00", **extra}


def make_po(client, **extra):
    resp = client.post(f"{BASE}purchase-orders/", po_payload(**extra), format="json")
    assert resp.status_code == 201, resp.json()
    return resp.json()["data"]


def make_request(school, teacher, title="Atlas of the World"):
    return BookRequest.objects.create(school=school, requested_by=teacher, title=title)


@pytest.fixture
def teacher(school):
    return User.objects.create_user(username=f"teacher_{uuid4().hex[:8]}", password="x", school=school)


@pytest.fixture
def other_year(other_school):
    return AcademicYear.objects.create(
        school=other_school, name="2025-2026", start_date="2025-06-01", end_date="2026-03-31", is_current=True
    )


@pytest.fixture
def eager(monkeypatch):
    conf = tasks.deliver_library_event.app.conf
    monkeypatch.setattr(conf, "task_always_eager", True)
    monkeypatch.setattr(conf, "task_eager_propagates", True)


@pytest.fixture
def pushes(monkeypatch):
    sent = []
    monkeypatch.setattr(notifications, "push_portal_event", lambda user_id, payload: sent.append((user_id, payload)) or True)
    return sent


# ---- numbering ---------------------------------------------------------------------------------------------------


def test_po_and_receipt_numbers_come_from_the_settings_counters(school, other_school):
    assert [next_po_number(school) for _ in range(3)] == ["PO-0001", "PO-0002", "PO-0003"]
    assert next_receipt_number(school) == "DR-0001"
    assert next_po_number(other_school) == "PO-0001"
    row = get_settings(school)
    assert (row.po_sequence, row.donation_receipt_sequence) == (3, 1)


def test_numbering_skips_a_number_that_is_already_taken(school):
    PurchaseOrder.objects.create(school=school, po_number="PO-0001", order_date="2026-01-01", vendor_name="V", books_count=1)
    assert next_po_number(school) == "PO-0002"


@pytest.mark.skipif(connection.vendor != "postgresql", reason="needs real row locks (PostgreSQL)")
@pytest.mark.django_db(transaction=True)
def test_numbering_under_concurrency_gives_every_caller_a_different_number(school):
    """Unverified on SQLite: twelve callers at once must each get a distinct PO number."""
    from django.db import connections, transaction

    numbers = []

    def worker():
        try:
            with transaction.atomic():
                number = next_po_number(school)
                PurchaseOrder.objects.create(
                    school=school, po_number=number, order_date="2026-01-01", vendor_name="V", books_count=1
                )
                numbers.append(number)
        finally:
            connections.close_all()

    threads = [threading.Thread(target=worker) for _ in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(numbers) == 12 and len(set(numbers)) == 12


# ---- purchase orders ---------------------------------------------------------------------------------------------


def test_create_po_numbers_it_stamps_the_current_year_and_logs(librarian_client, school, academic_year):
    row = make_po(librarian_client)
    assert row["po_number"] == "PO-0001" and row["status"] == "ordered" and row["payment_status"] == "pending"
    assert row["academic_year"] == academic_year.pk
    log = LibraryActivityLog.objects.get(event_type="purchase")
    assert log.metadata["po_number"] == "PO-0001"


def test_client_cannot_set_number_status_or_payment_on_create(librarian_client, academic_year):
    row = make_po(librarian_client, po_number="HACK-1", status="received", payment_status="paid")
    assert (row["po_number"], row["status"], row["payment_status"]) == ("PO-0001", "ordered", "pending")


@pytest.mark.parametrize("target", ["received", "cancelled"])
def test_an_open_order_can_be_received_or_cancelled(librarian_client, academic_year, target):
    po = make_po(librarian_client)
    resp = librarian_client.patch(f"{BASE}purchase-orders/{po['id']}/", {"status": target}, format="json")
    assert resp.status_code == 200 and resp.json()["data"]["status"] == target


@pytest.mark.parametrize("start,target", [
    ("received", "ordered"), ("received", "cancelled"), ("cancelled", "ordered"), ("cancelled", "received"),
])
def test_status_cannot_be_reversed_or_changed_once_final(librarian_client, academic_year, start, target):
    po = make_po(librarian_client)
    librarian_client.patch(f"{BASE}purchase-orders/{po['id']}/", {"status": start}, format="json")
    resp = librarian_client.patch(f"{BASE}purchase-orders/{po['id']}/", {"status": target}, format="json")
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_invalid_state_transition"
    assert PurchaseOrder.objects.get(pk=po["id"]).status == start


def test_payment_goes_pending_to_paid_once_and_never_back(librarian_client, academic_year):
    po = make_po(librarian_client)
    url = f"{BASE}purchase-orders/{po['id']}/"
    assert librarian_client.patch(url, {"payment_status": "paid"}, format="json").status_code == 200
    resp = librarian_client.patch(url, {"payment_status": "pending"}, format="json")
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_invalid_state_transition"


def test_a_cancelled_order_cannot_be_paid(librarian_client, academic_year):
    po = make_po(librarian_client)
    url = f"{BASE}purchase-orders/{po['id']}/"
    librarian_client.patch(url, {"status": "cancelled"}, format="json")
    resp = librarian_client.patch(url, {"payment_status": "paid"}, format="json")
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_invalid_state_transition"


def test_money_fields_are_frozen_once_the_order_is_closed_but_notes_stay_editable(librarian_client, academic_year):
    po = make_po(librarian_client)
    url = f"{BASE}purchase-orders/{po['id']}/"
    librarian_client.patch(url, {"status": "received"}, format="json")
    resp = librarian_client.patch(url, {"total_cost": "1.00"}, format="json")
    assert resp.status_code == 409
    resp = librarian_client.patch(url, {"invoice_number": "INV-9", "notes": "arrived"}, format="json")
    assert resp.status_code == 200 and resp.json()["data"]["invoice_number"] == "INV-9"
    assert PurchaseOrder.objects.get(pk=po["id"]).total_cost == Decimal("1000.00")


def test_delete_only_when_ordered_and_unlinked(librarian_client, school, category, academic_year):
    open_po = make_po(librarian_client)
    linked_po = make_po(librarian_client)
    closed_po = make_po(librarian_client)
    make_book(school, category, title="Linked", purchase_order=PurchaseOrder.objects.get(pk=linked_po["id"]))
    librarian_client.patch(f"{BASE}purchase-orders/{closed_po['id']}/", {"status": "received"}, format="json")

    assert librarian_client.delete(f"{BASE}purchase-orders/{closed_po['id']}/").status_code == 409
    resp = librarian_client.delete(f"{BASE}purchase-orders/{linked_po['id']}/")
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_has_history"
    assert librarian_client.delete(f"{BASE}purchase-orders/{open_po['id']}/").status_code == 204
    assert not PurchaseOrder.objects.filter(pk=open_po["id"]).exists()


def test_po_input_is_validated(librarian_client, academic_year):
    resp = librarian_client.post(f"{BASE}purchase-orders/", po_payload(books_count=0, vendor_name=" "), format="json")
    assert resp.status_code == 400
    assert set(resp.json()["field_errors"]) >= {"books_count", "vendor_name"}


def test_po_cross_school_academic_year_is_refused(librarian_client, other_year):
    resp = librarian_client.post(f"{BASE}purchase-orders/", po_payload(academic_year=other_year.pk), format="json")
    assert resp.status_code == 400 and "academic_year" in resp.json()["field_errors"]


def test_cross_school_po_is_not_found(librarian_client, other_school):
    other = PurchaseOrder.objects.create(
        school=other_school, po_number="PO-0001", order_date="2026-01-01", vendor_name="V", books_count=1
    )
    assert librarian_client.get(f"{BASE}purchase-orders/{other.pk}/").status_code == 404
    assert librarian_client.patch(f"{BASE}purchase-orders/{other.pk}/", {"notes": "x"}, format="json").status_code == 404
    assert librarian_client.delete(f"{BASE}purchase-orders/{other.pk}/").status_code == 404


# ---- books linked to a PO or donation ----------------------------------------------------------------------------


def test_accession_accepts_same_school_links_and_refuses_cross_school(librarian_client, school, other_school, category):
    po = PurchaseOrder.objects.create(school=school, po_number="PO-0001", order_date="2026-01-01", vendor_name="V", books_count=1)
    foreign = Donation.objects.create(
        school=other_school, donor_name="X", donation_date="2026-01-01", books_count=1, receipt_no="DR-0001"
    )
    body = {"title": "Linked Title", "category": category.pk, "copies_count": 1, "purchase_order": po.pk}
    resp = librarian_client.post(f"{BASE}books/", body, format="json")
    assert resp.status_code == 201 and resp.json()["data"]["purchase_order"] == po.pk

    body = {"title": "Other Title", "category": category.pk, "copies_count": 1, "donation": foreign.pk}
    resp = librarian_client.post(f"{BASE}books/", body, format="json")
    assert resp.status_code == 400 and "donation" in resp.json()["field_errors"]


# ---- donations ---------------------------------------------------------------------------------------------------


def test_create_donation_numbers_the_receipt_and_keeps_donor_data_out_of_the_log(librarian_client, school):
    resp = librarian_client.post(f"{BASE}donations/", donation_payload(), format="json")
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert data["receipt_no"] == "DR-0001" and data["contact"] == CONTACT
    log = LibraryActivityLog.objects.get(event_type="donation")
    assert DONOR not in log.summary and CONTACT not in log.summary
    assert DONOR not in str(log.metadata) and CONTACT not in str(log.metadata)


def test_patch_donation_sets_and_clears_the_acknowledgement_stamp(librarian_client):
    row = librarian_client.post(f"{BASE}donations/", donation_payload(), format="json").json()["data"]
    url = f"{BASE}donations/{row['id']}/"
    sent = librarian_client.patch(url, {"acknowledgement_sent": True}, format="json").json()["data"]
    assert sent["acknowledgement_sent"] and sent["acknowledgement_sent_at"]
    cleared = librarian_client.patch(url, {"acknowledgement_sent": False}, format="json").json()["data"]
    assert cleared["acknowledgement_sent_at"] is None
    for log in LibraryActivityLog.objects.filter(event_type="donation"):
        assert CONTACT not in log.summary and CONTACT not in str(log.metadata)


def test_contact_is_hidden_from_a_caller_without_the_donations_view_code(school, librarian_client):
    creator = client_for(make_user(school, ["library.donations.create", "library.donations.update"]))
    created = creator.post(f"{BASE}donations/", donation_payload(), format="json")
    assert created.status_code == 201 and "contact" not in created.json()["data"]
    donation_id = created.json()["data"]["id"]
    patched = creator.patch(f"{BASE}donations/{donation_id}/", {"notes": "thanks"}, format="json")
    assert patched.status_code == 200 and "contact" not in patched.json()["data"]
    assert creator.get(f"{BASE}donations/").status_code == 403
    assert librarian_client.get(f"{BASE}donations/{donation_id}/").json()["data"]["contact"] == CONTACT


def test_contact_is_not_searchable(librarian_client):
    librarian_client.post(f"{BASE}donations/", donation_payload(), format="json")
    assert librarian_client.get(f"{BASE}donations/", {"search": CONTACT}).json()["count"] == 0
    assert librarian_client.get(f"{BASE}donations/", {"search": "DR-0001"}).json()["count"] == 1


def test_receipt_returns_print_data_and_is_school_scoped(librarian_client, other_admin, school):
    row = librarian_client.post(f"{BASE}donations/", donation_payload(), format="json").json()["data"]
    resp = librarian_client.get(f"{BASE}donations/{row['id']}/receipt/")
    assert resp.status_code == 200
    assert resp.json()["data"]["receipt_no"] == "DR-0001" and resp.json()["data"]["school_name"] == school.name
    assert client_for(other_admin).get(f"{BASE}donations/{row['id']}/receipt/").status_code == 404


def test_donations_cannot_be_deleted(librarian_client):
    row = librarian_client.post(f"{BASE}donations/", donation_payload(), format="json").json()["data"]
    assert librarian_client.delete(f"{BASE}donations/{row['id']}/").status_code == 405


# ---- budget and summary ------------------------------------------------------------------------------------------


def test_budget_put_upserts_one_row_and_get_reads_it(librarian_client, academic_year):
    url = f"{BASE}budgets/"
    assert librarian_client.get(url).json()["data"]["amount"] is None
    first = librarian_client.put(url, {"academic_year": academic_year.pk, "amount": "50000.00"}, format="json")
    assert first.status_code == 200
    librarian_client.put(url, {"academic_year": academic_year.pk, "amount": "60000.00"}, format="json")
    assert Budget.objects.count() == 1
    assert Decimal(librarian_client.get(url, {"academic_year": academic_year.pk}).json()["data"]["amount"]) == Decimal("60000.00")


def test_budget_refuses_a_negative_amount_and_a_foreign_year(librarian_client, academic_year, other_year):
    url = f"{BASE}budgets/"
    assert librarian_client.put(url, {"academic_year": academic_year.pk, "amount": "-1"}, format="json").status_code == 400
    resp = librarian_client.put(url, {"academic_year": other_year.pk, "amount": "10"}, format="json")
    assert resp.status_code == 400 and "academic_year" in resp.json()["field_errors"]
    assert librarian_client.get(url, {"academic_year": other_year.pk}).status_code == 404


def test_summary_maths_counts_committed_as_every_open_or_received_order(librarian_client, academic_year):
    librarian_client.put(f"{BASE}budgets/", {"academic_year": academic_year.pk, "amount": "10000.00"}, format="json")
    paid = make_po(librarian_client, total_cost="1500.50")
    make_po(librarian_client, total_cost="2000.00")
    cancelled = make_po(librarian_client, total_cost="4000.00")
    librarian_client.patch(f"{BASE}purchase-orders/{paid['id']}/", {"payment_status": "paid", "status": "received"}, format="json")
    librarian_client.patch(f"{BASE}purchase-orders/{cancelled['id']}/", {"status": "cancelled"}, format="json")

    data = librarian_client.get(f"{BASE}acquisitions/summary/").json()["data"]
    assert data["has_budget"] is True
    assert Decimal(data["budget"]) == Decimal("10000.00")
    assert Decimal(data["committed"]) == Decimal("3500.50")
    assert Decimal(data["paid"]) == Decimal("1500.50")
    assert Decimal(data["remaining"]) == Decimal("6499.50")


def test_summary_without_a_budget_shows_zero_and_can_go_negative(librarian_client, academic_year):
    make_po(librarian_client, total_cost="300.00")
    data = librarian_client.get(f"{BASE}acquisitions/summary/").json()["data"]
    assert data["has_budget"] is False and Decimal(data["remaining"]) == Decimal("-300.00")


def test_summary_other_year_and_other_school_orders_are_not_counted(librarian_client, school, other_school, academic_year, other_year):
    older = AcademicYear.objects.create(school=school, name="2024-2025", start_date="2024-06-01", end_date="2025-03-31")
    PurchaseOrder.objects.create(school=school, po_number="PO-9001", order_date="2025-01-01", vendor_name="V",
                                 books_count=1, total_cost=700, academic_year=older)
    PurchaseOrder.objects.create(school=other_school, po_number="PO-9002", order_date="2026-01-01", vendor_name="V",
                                 books_count=1, total_cost=900, academic_year=other_year)
    make_po(librarian_client, total_cost="100.00")
    data = librarian_client.get(f"{BASE}acquisitions/summary/").json()["data"]
    assert Decimal(data["committed"]) == Decimal("100.00")
    older_data = librarian_client.get(f"{BASE}acquisitions/summary/", {"academic_year": older.pk}).json()["data"]
    assert Decimal(older_data["committed"]) == Decimal("700.00")


def test_summary_cross_school_academic_year_is_not_found(librarian_client, other_year):
    assert librarian_client.get(f"{BASE}acquisitions/summary/", {"academic_year": other_year.pk}).status_code == 404
    assert librarian_client.get(f"{BASE}acquisitions/summary/", {"academic_year": "abc"}).status_code == 404


def test_summary_without_a_current_year_is_not_found(librarian_client):
    assert librarian_client.get(f"{BASE}acquisitions/summary/").status_code == 404


# ---- teacher requests --------------------------------------------------------------------------------------------


def test_request_list_is_school_scoped_and_filterable(librarian_client, school, other_school, teacher):
    mine = make_request(school, teacher)
    other_teacher = User.objects.create_user(username=f"t_{uuid4().hex[:6]}", password="x", school=other_school)
    make_request(other_school, other_teacher, title="Not mine")
    rows = librarian_client.get(f"{BASE}book-requests/").json()["results"]
    assert [r["id"] for r in rows] == [mine.pk]
    assert librarian_client.get(f"{BASE}book-requests/", {"status": "approved"}).json()["count"] == 0


def test_review_fires_exactly_one_notification_to_the_requesting_teacher(
    librarian_client, school, teacher, eager, pushes, django_capture_on_commit_callbacks
):
    book_request = make_request(school, teacher)
    with django_capture_on_commit_callbacks(execute=True):
        resp = librarian_client.post(
            f"{BASE}book-requests/{book_request.pk}/review/", {"status": "approved", "note": "Good pick"}, format="json"
        )
    assert resp.status_code == 200 and resp.json()["data"]["status"] == "approved"
    note = CommunicationNotification.objects.get()
    assert note.recipient == teacher and note.data["event"] == "request_reviewed"
    assert note.link_url == "/teacher/library/recommend" and "Atlas of the World" in note.body
    assert [p[0] for p in pushes] == [teacher.pk]
    book_request.refresh_from_db()
    assert book_request.reviewed_at and book_request.reviewed_by is not None and book_request.review_note == "Good pick"
    assert LibraryActivityLog.objects.filter(event_type="request").count() == 1


def test_delivering_the_same_review_twice_does_not_notify_twice(school, teacher, eager, pushes):
    book_request = make_request(school, teacher)
    book_request.status = "approved"
    book_request.save()
    ids = {"request_id": book_request.pk}
    assert notifications.deliver_event(school.pk, "request_reviewed", ids)["status"] == "created"
    assert notifications.deliver_event(school.pk, "request_reviewed", ids)["status"] == "duplicate"
    assert CommunicationNotification.objects.count() == 1


def test_a_request_that_is_still_pending_is_stale_for_delivery(school, teacher):
    book_request = make_request(school, teacher)
    assert notifications.deliver_event(school.pk, "request_reviewed", {"request_id": book_request.pk}) == {"status": "stale"}


@pytest.mark.parametrize("path", [
    ["approved", "ordered", "fulfilled"],
    ["approved", "fulfilled"],
    ["rejected"],
])
def test_request_status_moves_forward_along_every_allowed_path(librarian_client, school, teacher, path):
    book_request = make_request(school, teacher)
    for step in path:
        resp = librarian_client.post(f"{BASE}book-requests/{book_request.pk}/review/", {"status": step}, format="json")
        assert resp.status_code == 200, resp.json()
    book_request.refresh_from_db()
    assert book_request.status == path[-1]


@pytest.mark.parametrize("start,target", [
    ("pending", "ordered"), ("pending", "fulfilled"), ("approved", "approved"), ("approved", "rejected"),
    ("ordered", "approved"), ("ordered", "rejected"), ("rejected", "approved"), ("fulfilled", "ordered"),
    ("fulfilled", "rejected"),
])
def test_request_refuses_every_backward_or_skipped_move_and_notifies_nobody(
    librarian_client, school, teacher, start, target, eager, pushes, django_capture_on_commit_callbacks
):
    book_request = make_request(school, teacher)
    BookRequest.objects.filter(pk=book_request.pk).update(status=start)
    with django_capture_on_commit_callbacks(execute=True):
        resp = librarian_client.post(f"{BASE}book-requests/{book_request.pk}/review/", {"status": target}, format="json")
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_invalid_state_transition"
    assert BookRequest.objects.get(pk=book_request.pk).status == start
    assert not CommunicationNotification.objects.exists() and not LibraryActivityLog.objects.filter(event_type="request").exists()


def test_review_cannot_set_pending_and_links_only_a_same_school_title(librarian_client, school, teacher, book, other_book):
    book_request = make_request(school, teacher)
    url = f"{BASE}book-requests/{book_request.pk}/review/"
    assert librarian_client.post(url, {"status": "pending"}, format="json").status_code == 400
    resp = librarian_client.post(url, {"status": "approved", "linked_book": other_book.pk}, format="json")
    assert resp.status_code == 400 and "linked_book" in resp.json()["field_errors"]
    resp = librarian_client.post(url, {"status": "approved", "linked_book": book.pk}, format="json")
    assert resp.status_code == 200 and resp.json()["data"]["linked_book"] == book.pk


def test_cross_school_request_review_is_not_found(librarian_client, other_school):
    other_teacher = User.objects.create_user(username=f"t_{uuid4().hex[:6]}", password="x", school=other_school)
    other = make_request(other_school, other_teacher)
    assert librarian_client.post(f"{BASE}book-requests/{other.pk}/review/", {"status": "approved"}, format="json").status_code == 404


def test_requests_cannot_be_created_edited_or_deleted_here(librarian_client, school, teacher):
    book_request = make_request(school, teacher)
    assert librarian_client.post(f"{BASE}book-requests/", {"title": "x"}, format="json").status_code == 405
    assert librarian_client.patch(f"{BASE}book-requests/{book_request.pk}/", {"title": "y"}, format="json").status_code == 405
    assert librarian_client.delete(f"{BASE}book-requests/{book_request.pk}/").status_code == 405


# ---- permission matrix -------------------------------------------------------------------------------------------


def _requests(school, teacher):
    return make_request(school, teacher).pk


MATRIX = [
    # (code, method, url builder, body)
    ("library.purchase_orders.view", "get", lambda ctx: f"{BASE}purchase-orders/", None),
    ("library.purchase_orders.create", "post", lambda ctx: f"{BASE}purchase-orders/", po_payload()),
    ("library.purchase_orders.update", "patch", lambda ctx: f"{BASE}purchase-orders/{ctx['po']}/", {"notes": "n"}),
    ("library.purchase_orders.delete", "delete", lambda ctx: f"{BASE}purchase-orders/{ctx['po']}/", None),
    ("library.donations.view", "get", lambda ctx: f"{BASE}donations/", None),
    ("library.donations.view", "get", lambda ctx: f"{BASE}donations/{ctx['donation']}/receipt/", None),
    ("library.donations.create", "post", lambda ctx: f"{BASE}donations/", donation_payload()),
    ("library.donations.update", "patch", lambda ctx: f"{BASE}donations/{ctx['donation']}/", {"notes": "n"}),
    ("library.budgets.view", "get", lambda ctx: f"{BASE}budgets/", None),
    ("library.budgets.view", "get", lambda ctx: f"{BASE}acquisitions/summary/", None),
    ("library.budgets.manage", "put", lambda ctx: f"{BASE}budgets/", lambda ctx: {"academic_year": ctx["year"], "amount": "1"}),
    ("library.book_requests.view", "get", lambda ctx: f"{BASE}book-requests/", None),
    ("library.book_requests.review", "post", lambda ctx: f"{BASE}book-requests/{ctx['request']}/review/", {"status": "approved"}),
]


@pytest.mark.parametrize("index", range(len(MATRIX)))
def test_each_door_opens_for_its_own_code_and_for_no_other(school, teacher, academic_year, librarian_client, index):
    code, method, build, body = MATRIX[index]
    po = make_po(librarian_client)["id"]
    donation = librarian_client.post(f"{BASE}donations/", donation_payload(), format="json").json()["data"]["id"]
    ctx = {"po": po, "donation": donation, "year": academic_year.pk, "request": _requests(school, teacher)}
    url = build(ctx)
    body = body(ctx) if callable(body) else body

    allowed = client_for(make_user(school, [code]))
    resp = getattr(allowed, method)(url, body, format="json") if body is not None else getattr(allowed, method)(url)
    assert resp.status_code != 403, (code, resp.status_code)

    others = sorted({c for c, *_ in MATRIX if c != code})
    denied = client_for(make_user(school, others))
    resp = getattr(denied, method)(url, body, format="json") if body is not None else getattr(denied, method)(url)
    assert resp.status_code == 403, (code, resp.status_code)


def test_a_user_with_no_library_code_is_refused_everywhere(school, teacher, academic_year, librarian_client):
    nobody = client_for(make_user(school, []))
    ctx = {"po": make_po(librarian_client)["id"], "donation": 1, "year": academic_year.pk, "request": _requests(school, teacher)}
    for _code, method, build, body in MATRIX:
        url = build(ctx)
        body = body(ctx) if callable(body) else body
        resp = getattr(nobody, method)(url, body, format="json") if body is not None else getattr(nobody, method)(url)
        assert resp.status_code == 403, url
