"""Stock check: snapshot, ticking, finishing, cancelling and reporting missing copies lost (prompt 9)."""
import threading
from datetime import date
from decimal import Decimal

import pytest
from django.db import connection

from apps.library.models import (
    BookCopy,
    BookIssue,
    LibraryActivityLog,
    LostDamagedReport,
    StockAudit,
    StockAuditItem,
)
from apps.library.services import stock_audit
from apps.library.tests.conftest import client_for, make_book, make_member, make_user

AUDITS = "/api/v1/library/stock-audits/"


def shelf(school, category, title, rack, copies=2, cost="100.00"):
    return make_book(school, category, title=title, copies=copies, rack=rack, cost_per_copy=Decimal(cost))


def start(client, rack=""):
    resp = client.post(AUDITS, {"rack": rack}, format="json")
    assert resp.status_code == 201, resp.json()
    return resp.json()["data"]


def item_ids(audit_id, **filters):
    return list(StockAuditItem.objects.filter(audit_id=audit_id, **filters).order_by("id").values_list("pk", flat=True))


# ---- start and snapshot -------------------------------------------------------------------------------------------


def test_snapshot_holds_only_copies_on_the_shelf(librarian_client, school, category):
    book = shelf(school, category, "Mixed", "R1", copies=6)
    copies = list(book.copies.order_by("id"))
    for copy, state in zip(copies[1:], ("issued", "lost", "damaged", "withdrawn")):
        copy.status = state
        copy.save()
    audit = start(librarian_client, "R1")
    assert audit["progress"] == {"found": 0, "total": 2} and audit["total_in_scope"] == 2
    ids = set(StockAuditItem.objects.filter(audit_id=audit["id"]).values_list("copy_id", flat=True))
    assert ids == {copies[0].pk, copies[5].pk}


def test_rack_scope_and_all_racks(librarian_client, school, category):
    shelf(school, category, "On R1", "R1", copies=2)
    shelf(school, category, "On R2", "R2", copies=3)
    assert start(librarian_client, "R2")["total_in_scope"] == 3
    assert start(librarian_client, "")["total_in_scope"] == 5
    assert start(librarian_client, "  R1  ")["scope_rack"] == "R1"


def test_a_rack_with_nothing_on_the_shelf_cannot_be_audited(librarian_client, school, category):
    shelf(school, category, "On R1", "R1")
    resp = librarian_client.post(AUDITS, {"rack": "NOPE"}, format="json")
    assert resp.status_code == 400 and "rack" in resp.json()["field_errors"]
    assert not StockAudit.objects.exists()


def test_one_open_audit_per_scope(librarian_client, school, category):
    shelf(school, category, "On R1", "R1")
    shelf(school, category, "On R2", "R2")
    first = start(librarian_client, "R1")
    resp = librarian_client.post(AUDITS, {"rack": "R1"}, format="json")
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_audit_in_progress"
    assert start(librarian_client, "R2")["id"] != first["id"]  # another scope is fine
    assert start(librarian_client, "")["scope_rack"] == ""  # so is all racks
    assert librarian_client.post(AUDITS, {}, format="json").status_code == 409
    assert StockAudit.objects.count() == 3


def test_a_finished_or_cancelled_audit_frees_its_scope(librarian_client, school, category):
    shelf(school, category, "On R1", "R1")
    first = start(librarian_client, "R1")
    librarian_client.post(f"{AUDITS}{first['id']}/cancel/")
    second = start(librarian_client, "R1")
    librarian_client.post(f"{AUDITS}{second['id']}/finish/")
    assert start(librarian_client, "R1")["status"] == "in_progress"


def test_start_logs_an_audit_event(librarian_client, school, category):
    shelf(school, category, "On R1", "R1", copies=2)
    audit = start(librarian_client, "R1")
    log = LibraryActivityLog.objects.get(event_type="audit")
    assert log.metadata["audit_id"] == audit["id"] and log.metadata["total"] == 2


def test_racks_lists_racks_with_shelf_copies_only(librarian_client, school, category, other_school, other_category):
    book = shelf(school, category, "On R1", "R1", copies=3)
    shelf(school, category, "On R2", "R2", copies=1)
    shelf(school, category, "No rack", "", copies=2)
    book.copies.first().status = "lost"
    BookCopy.objects.filter(pk=book.copies.first().pk).update(status="lost")
    make_book(other_school, other_category, title="Foreign", copies=4, rack="R9")
    data = librarian_client.get(f"{AUDITS}racks/").json()["data"]
    assert data["racks"] == [{"rack": "R1", "copies": 2}, {"rack": "R2", "copies": 1}] and data["no_rack"] == 2


# ---- ticking items -------------------------------------------------------------------------------------------------


def test_mark_found_single_and_progress(librarian_client, school, category):
    shelf(school, category, "On R1", "R1", copies=3)
    audit = start(librarian_client, "R1")
    first = item_ids(audit["id"])[0]
    resp = librarian_client.patch(f"{AUDITS}{audit['id']}/items/{first}/", {"found": True}, format="json")
    assert resp.status_code == 200
    body = resp.json()["data"]
    assert body["item"]["found"] is True and body["item"]["verified_at"] and body["progress"] == {"total": 3, "found": 1}
    undone = librarian_client.patch(f"{AUDITS}{audit['id']}/items/{first}/", {"found": False}, format="json").json()["data"]
    assert undone["item"]["verified_at"] is None and undone["progress"]["found"] == 0


def test_bulk_mark_and_detail_progress(librarian_client, school, category):
    shelf(school, category, "On R1", "R1", copies=4)
    audit = start(librarian_client, "R1")
    ids = item_ids(audit["id"])
    resp = librarian_client.post(f"{AUDITS}{audit['id']}/items/bulk-mark/", {"item_ids": ids[:3], "found": True}, format="json")
    assert resp.json()["data"] == {"changed": 3, "progress": {"total": 4, "found": 3}}
    again = librarian_client.post(f"{AUDITS}{audit['id']}/items/bulk-mark/", {"item_ids": ids[:3], "found": True}, format="json")
    assert again.json()["data"]["changed"] == 0
    assert librarian_client.get(f"{AUDITS}{audit['id']}/").json()["data"]["progress"] == {"total": 4, "found": 3}
    listed = librarian_client.get(AUDITS).json()["results"][0]
    assert listed["progress"] == {"total": 4, "found": 3}


def test_bulk_mark_refuses_items_of_another_audit_or_school(librarian_client, school, other_school, other_category, category):
    shelf(school, category, "On R1", "R1", copies=2)
    shelf(school, category, "On R2", "R2", copies=2)
    first, second = start(librarian_client, "R1"), start(librarian_client, "R2")
    foreign_book = make_book(other_school, other_category, title="Foreign", copies=1)
    foreign_audit = stock_audit.start_audit(other_school, None, "")
    ours = item_ids(first["id"])
    for bad in (item_ids(second["id"])[:1], item_ids(foreign_audit.pk)[:1], [999999]):
        resp = librarian_client.post(f"{AUDITS}{first['id']}/items/bulk-mark/", {"item_ids": ours[:1] + bad, "found": True}, format="json")
        assert resp.status_code == 400 and "item_ids" in resp.json()["field_errors"]
    assert not StockAuditItem.objects.filter(found=True).exists()
    resp = librarian_client.patch(f"{AUDITS}{first['id']}/items/{item_ids(second['id'])[0]}/", {"found": True}, format="json")
    assert resp.status_code == 404
    del foreign_book


def test_items_list_filters_paginates_and_stays_in_one_query_shape(librarian_client, school, category, django_assert_max_num_queries):
    for n in range(6):
        shelf(school, category, f"Title {n}", "R1", copies=5)
    audit = start(librarian_client, "R1")
    ids = item_ids(audit["id"])
    librarian_client.post(f"{AUDITS}{audit['id']}/items/bulk-mark/", {"item_ids": ids[:10], "found": True}, format="json")
    with django_assert_max_num_queries(12):
        page = librarian_client.get(f"{AUDITS}{audit['id']}/items/", {"page_size": 30}).json()
    assert page["count"] == 30 and len(page["results"]) == 30
    row = page["results"][0]
    assert {"copy_code", "book_title", "rack", "cost_per_copy", "found", "copy_status"} <= set(row)
    assert librarian_client.get(f"{AUDITS}{audit['id']}/items/", {"found": "true"}).json()["count"] == 10
    assert librarian_client.get(f"{AUDITS}{audit['id']}/items/", {"found": "false"}).json()["count"] == 20
    book_id = page["results"][0]["book"]
    assert librarian_client.get(f"{AUDITS}{audit['id']}/items/", {"book": book_id}).json()["count"] == 5
    assert librarian_client.get(f"{AUDITS}{audit['id']}/items/", {"found": "maybe"}).status_code == 400
    assert librarian_client.get(f"{AUDITS}{audit['id']}/items/", {"book": "x"}).status_code == 400


# ---- finish, cancel -------------------------------------------------------------------------------------------------


def test_finish_freezes_counts_value_at_risk_and_last_verified(librarian_client, school, category):
    cheap = shelf(school, category, "Cheap", "R1", copies=2, cost="50.00")
    dear = shelf(school, category, "Dear", "R1", copies=2, cost="200.00")
    audit = start(librarian_client, "R1")
    by_copy = {i.copy_id: i for i in StockAuditItem.objects.filter(audit_id=audit["id"])}
    found = [by_copy[cheap.copies.first().pk].pk, by_copy[dear.copies.first().pk].pk]
    librarian_client.post(f"{AUDITS}{audit['id']}/items/bulk-mark/", {"item_ids": found, "found": True}, format="json")

    resp = librarian_client.post(f"{AUDITS}{audit['id']}/finish/")
    assert resp.status_code == 200, resp.json()
    data = resp.json()["data"]
    assert data["status"] == "completed" and data["finished_at"]
    assert (data["total_in_scope"], data["accounted_count"], data["missing_count"]) == (4, 2, 2)
    assert Decimal(data["value_at_risk"]) == Decimal("250.00")  # one cheap and one dear copy missing
    assert sorted(m["book_title"] for m in data["missing"]) == ["Cheap", "Dear"]
    today = date.today()
    verified = BookCopy.objects.filter(last_verified_on__isnull=False)
    assert verified.count() == 2 and all(c.last_verified_on <= today for c in verified)
    assert set(verified.values_list("pk", flat=True)) == {cheap.copies.first().pk, dear.copies.first().pk}
    log = LibraryActivityLog.objects.filter(event_type="audit").order_by("-id").first()
    assert log.metadata["missing"] == 2 and log.metadata["value_at_risk"] == "250.00"


def test_counts_stay_frozen_after_finish(librarian_client, school, category):
    shelf(school, category, "Frozen", "R1", copies=3, cost="10.00")
    audit = start(librarian_client, "R1")
    librarian_client.post(f"{AUDITS}{audit['id']}/finish/")
    book = BookCopy.objects.first().book
    make_book(school, category, title="Added Later", copies=2, rack="R1")
    detail = librarian_client.get(f"{AUDITS}{audit['id']}/").json()["data"]
    assert (detail["total_in_scope"], detail["missing_count"]) == (3, 3) and detail["progress"] == {"total": 3, "found": 0}
    del book


def test_a_finished_audit_cannot_be_edited_finished_or_cancelled_again(librarian_client, school, category):
    shelf(school, category, "Done", "R1", copies=2)
    audit = start(librarian_client, "R1")
    item = item_ids(audit["id"])[0]
    librarian_client.post(f"{AUDITS}{audit['id']}/finish/")
    for call in (
        lambda: librarian_client.patch(f"{AUDITS}{audit['id']}/items/{item}/", {"found": True}, format="json"),
        lambda: librarian_client.post(f"{AUDITS}{audit['id']}/items/bulk-mark/", {"item_ids": [item], "found": True}, format="json"),
        lambda: librarian_client.post(f"{AUDITS}{audit['id']}/finish/"),
        lambda: librarian_client.post(f"{AUDITS}{audit['id']}/cancel/"),
    ):
        resp = call()
        assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_invalid_state_transition"
    assert StockAuditItem.objects.filter(found=True).count() == 0


def test_cancel_in_progress_leaves_copies_untouched(librarian_client, school, category):
    shelf(school, category, "Cancelled", "R1", copies=2)
    audit = start(librarian_client, "R1")
    ids = item_ids(audit["id"])
    librarian_client.post(f"{AUDITS}{audit['id']}/items/bulk-mark/", {"item_ids": ids, "found": True}, format="json")
    resp = librarian_client.post(f"{AUDITS}{audit['id']}/cancel/")
    assert resp.status_code == 200 and resp.json()["data"]["status"] == "cancelled"
    assert BookCopy.objects.filter(last_verified_on__isnull=False).count() == 0
    assert librarian_client.post(f"{AUDITS}{audit['id']}/finish/").status_code == 409


def test_cross_school_audit_is_not_found_everywhere(librarian_client, other_school, other_category):
    make_book(other_school, other_category, title="Foreign", copies=1)
    audit = stock_audit.start_audit(other_school, None, "")
    item = item_ids(audit.pk)[0]
    assert librarian_client.get(f"{AUDITS}{audit.pk}/").status_code == 404
    assert librarian_client.get(f"{AUDITS}{audit.pk}/items/").status_code == 404
    assert librarian_client.patch(f"{AUDITS}{audit.pk}/items/{item}/", {"found": True}, format="json").status_code == 404
    assert librarian_client.post(f"{AUDITS}{audit.pk}/finish/").status_code == 404
    assert librarian_client.post(f"{AUDITS}{audit.pk}/cancel/").status_code == 404
    assert librarian_client.post(f"{AUDITS}{audit.pk}/items/{item}/mark-lost/", {}, format="json").status_code == 404
    assert librarian_client.get(AUDITS).json()["count"] == 0


# ---- mark lost (R15) -------------------------------------------------------------------------------------------------


def finished_with_missing(client, school, category, copies=2, rack="R1"):
    shelf(school, category, "Missing Title", rack, copies=copies, cost="120.00")
    audit = start(client, rack)
    client.post(f"{AUDITS}{audit['id']}/finish/")
    return audit, item_ids(audit["id"])


def test_mark_lost_creates_a_stock_audit_report_with_no_borrower(librarian_client, school, category):
    audit, items = finished_with_missing(librarian_client, school, category)
    resp = librarian_client.post(f"{AUDITS}{audit['id']}/items/{items[0]}/mark-lost/", {"notes": "Not on the shelf"}, format="json")
    assert resp.status_code == 201, resp.json()
    data = resp.json()["data"]
    assert data["created"] is True and data["item"]["copy_status"] == "lost"
    report = LostDamagedReport.objects.get()
    assert report.source == "stock_audit" and report.report_type == "lost" and report.member_id is None
    assert report.notes == "Not on the shelf" and report.copy_id == StockAuditItem.objects.get(pk=items[0]).copy_id
    assert report.charges.count() == 0  # nobody to bill
    assert BookCopy.objects.get(pk=report.copy_id).status == "lost"


def test_mark_lost_is_idempotent(librarian_client, school, category):
    audit, items = finished_with_missing(librarian_client, school, category)
    url = f"{AUDITS}{audit['id']}/items/{items[0]}/mark-lost/"
    first = librarian_client.post(url, {}, format="json")
    second = librarian_client.post(url, {}, format="json")
    assert (first.status_code, second.status_code) == (201, 200)
    assert second.json()["data"]["created"] is False
    assert second.json()["data"]["report"]["id"] == first.json()["data"]["report"]["id"]
    assert LostDamagedReport.objects.count() == 1
    assert LibraryActivityLog.objects.filter(event_type="lost").count() == 1


def test_mark_lost_needs_a_finished_audit_and_a_missing_item(librarian_client, school, category):
    shelf(school, category, "Open", "R1", copies=2)
    audit = start(librarian_client, "R1")
    items = item_ids(audit["id"])
    resp = librarian_client.post(f"{AUDITS}{audit['id']}/items/{items[0]}/mark-lost/", {}, format="json")
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_invalid_state_transition"
    librarian_client.patch(f"{AUDITS}{audit['id']}/items/{items[0]}/", {"found": True}, format="json")
    librarian_client.post(f"{AUDITS}{audit['id']}/finish/")
    assert librarian_client.post(f"{AUDITS}{audit['id']}/items/{items[0]}/mark-lost/", {}, format="json").status_code == 409  # found
    assert librarian_client.post(f"{AUDITS}{audit['id']}/items/{items[1]}/mark-lost/", {}, format="json").status_code == 201
    assert LostDamagedReport.objects.count() == 1


def test_mark_lost_only_applies_to_a_copy_still_on_the_shelf(librarian_client, school, category):
    audit, items = finished_with_missing(librarian_client, school, category)
    copy = StockAuditItem.objects.get(pk=items[0]).copy
    member = make_member(school, "LOAN-1", member_type="teacher")
    BookIssue.objects.create(school=school, book=copy.book, copy=copy, member=member, issue_date=date(2026, 1, 1), due_date=date(2026, 1, 15))
    copy.status = "issued"
    copy.save()
    resp = librarian_client.post(f"{AUDITS}{audit['id']}/items/{items[0]}/mark-lost/", {}, format="json")
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "library_invalid_state_transition"
    assert not LostDamagedReport.objects.exists() and BookCopy.objects.get(pk=copy.pk).status == "issued"


def test_mark_lost_unknown_item_is_404(librarian_client, school, category):
    audit, _items = finished_with_missing(librarian_client, school, category)
    assert librarian_client.post(f"{AUDITS}{audit['id']}/items/999999/mark-lost/", {}, format="json").status_code == 404


# ---- concurrency (Postgres only) ------------------------------------------------------------------------------------


@pytest.mark.skipif(connection.vendor != "postgresql", reason="needs real row locks (PostgreSQL)")
@pytest.mark.django_db(transaction=True)
def test_two_desks_starting_the_same_scope_give_one_audit(school, category):
    """Unverified on SQLite: the partial unique index and the existence check must leave exactly one open audit."""
    from django.db import connections

    from apps.library.exceptions import LibraryAuditInProgress

    shelf(school, category, "Race", "R1", copies=2)
    outcomes = []

    def worker():
        try:
            stock_audit.start_audit(school, None, "R1")
            outcomes.append("ok")
        except LibraryAuditInProgress:
            outcomes.append("conflict")
        finally:
            connections.close_all()

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(outcomes) == ["conflict", "ok"]
    assert StockAudit.objects.filter(status="in_progress").count() == 1


# ---- permissions -----------------------------------------------------------------------------------------------------


def _matrix_ctx(client, school, category):
    shelf(school, category, "Matrix", "RX", copies=3)
    open_audit = start(client, "RX")
    done_audit = start(client, "")  # all racks, finished below
    client.post(f"{AUDITS}{done_audit['id']}/finish/")
    return {"open": open_audit["id"], "done": done_audit["id"], "item": item_ids(open_audit["id"])[0], "missing": item_ids(done_audit["id"])[0]}


MATRIX = [
    ("library.stock_audits.view", "get", lambda c: AUDITS, None),
    ("library.stock_audits.view", "get", lambda c: f"{AUDITS}{c['open']}/", None),
    ("library.stock_audits.view", "get", lambda c: f"{AUDITS}{c['open']}/items/", None),
    ("library.stock_audits.view", "get", lambda c: f"{AUDITS}racks/", None),
    ("library.stock_audits.run", "post", lambda c: AUDITS, {"rack": "NO-SUCH-RACK"}),
    ("library.stock_audits.run", "patch", lambda c: f"{AUDITS}{c['open']}/items/{c['item']}/", {"found": True}),
    ("library.stock_audits.run", "post", lambda c: f"{AUDITS}{c['open']}/items/bulk-mark/", {"item_ids": [1], "found": True}),
    ("library.stock_audits.run", "post", lambda c: f"{AUDITS}{c['open']}/finish/", None),
    ("library.stock_audits.run", "post", lambda c: f"{AUDITS}{c['open']}/cancel/", None),
    ("library.lost_damaged.create", "post", lambda c: f"{AUDITS}{c['done']}/items/{c['missing']}/mark-lost/", {}),
]


@pytest.mark.parametrize("index", range(len(MATRIX)))
def test_each_door_opens_for_its_own_code_and_for_no_other(school, category, librarian_client, index):
    code, method, build, body = MATRIX[index]
    ctx = _matrix_ctx(librarian_client, school, category)
    url = build(ctx)

    def call(client):
        return getattr(client, method)(url, body, format="json") if body is not None else getattr(client, method)(url)

    assert call(client_for(make_user(school, [code]))).status_code != 403, code
    others = sorted({c for c, *_ in MATRIX if c != code})
    assert call(client_for(make_user(school, others))).status_code == 403, code


def test_a_user_with_no_library_code_is_refused_by_every_stock_endpoint(school, category, librarian_client):
    ctx = _matrix_ctx(librarian_client, school, category)
    nobody = client_for(make_user(school, []))
    for _code, method, build, body in MATRIX:
        url = build(ctx)
        resp = getattr(nobody, method)(url, body, format="json") if body is not None else getattr(nobody, method)(url)
        assert resp.status_code == 403, url
