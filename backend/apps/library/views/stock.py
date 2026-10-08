"""Stock check endpoints (blueprint 2.4)."""
from django.db.models import Count, Q
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as FieldValidationError
from rest_framework.response import Response

from apps.library.models import BookCopy, LostDamagedReport, StockAudit, StockAuditItem
from apps.library.serializers.loans import ReportSerializer
from apps.library.serializers.periods import (
    BulkMarkSerializer,
    ItemFoundSerializer,
    MarkLostSerializer,
    StockAuditItemSerializer,
    StockAuditSerializer,
    StockAuditStartSerializer,
)
from apps.library.services import stock_audit

from .base import LibraryViewSet


class StockAuditViewSet(LibraryViewSet):
    model = StockAudit
    serializer_class = StockAuditSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]
    disabled_actions = ("update", "partial_update", "destroy")
    filterset_fields = ["status"]
    ordering_fields = ["started_at"]
    default_ordering = ["-started_at", "-id"]
    permission_codes = {
        "list": "library.stock_audits.view",
        "retrieve": "library.stock_audits.view",
        "items": "library.stock_audits.view",
        "racks": "library.stock_audits.view",
        "create": "library.stock_audits.run",
        "set_item": "library.stock_audits.run",
        "bulk_mark": "library.stock_audits.run",
        "finish": "library.stock_audits.run",
        "cancel": "library.stock_audits.run",
        "mark_lost": "library.lost_damaged.create",
    }

    def annotate_queryset(self, queryset):
        return queryset.annotate(items_total=Count("items"), items_found=Count("items", filter=Q(items__found=True)))

    def _audit(self, pk):
        return StockAuditSerializer(self.get_queryset().get(pk=pk)).data

    def _item(self, item_id):
        item = StockAuditItem.objects.select_related("copy__book").get(pk=item_id)
        return StockAuditItemSerializer(item).data

    def create(self, request, *args, **kwargs):
        serializer = StockAuditStartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        audit = stock_audit.start_audit(self.get_school_or_deny(), request.user, serializer.validated_data["rack"])
        return Response({"success": True, "message": "Stock check started", "data": self._audit(audit.pk)}, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="racks")
    def racks(self, request):
        """Racks that have copies on the shelf, for the picker. Copies with no rack are only reachable through "all racks"."""
        rows = (
            BookCopy.objects.filter(school=self.get_school_or_deny(), status=BookCopy.STATUS_AVAILABLE)
            .exclude(book__rack="")
            .values("book__rack")
            .annotate(copies=Count("id"))
            .order_by("book__rack")
        )
        data = [{"rack": row["book__rack"], "copies": row["copies"]} for row in rows]
        unracked = BookCopy.objects.filter(
            school=self.get_school_or_deny(), status=BookCopy.STATUS_AVAILABLE, book__rack=""
        ).count()
        return Response({"success": True, "message": "Data retrieved successfully", "data": {"racks": data, "no_rack": unracked}})

    @action(detail=True, methods=["get"], url_path="items")
    def items(self, request, pk=None):
        audit = self.get_object()
        queryset = StockAuditItem.objects.filter(audit=audit, school=audit.school).select_related("copy__book")
        found = request.query_params.get("found")
        if found in ("true", "false"):
            queryset = queryset.filter(found=(found == "true"))
        elif found not in (None, ""):
            raise FieldValidationError({"found": "Use true or false."})
        book = request.query_params.get("book")
        if book:
            if not book.isdigit():
                raise FieldValidationError({"book": "Use a title id."})
            queryset = queryset.filter(copy__book_id=int(book))
        return self.list_response(queryset.order_by("copy__book__title", "copy__code"), StockAuditItemSerializer)

    @action(detail=True, methods=["patch"], url_path=r"items/(?P<item_id>\d+)")
    def set_item(self, request, pk=None, item_id=None):
        audit = self.get_object()
        serializer = ItemFoundSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = stock_audit.mark_item(self.get_school_or_deny(), request.user, audit.pk, int(item_id), serializer.validated_data["found"])
        return Response({
            "success": True, "message": "Item updated",
            "data": {"item": self._item(item.pk), "progress": stock_audit.progress(audit.pk)},
        })

    @action(detail=True, methods=["post"], url_path="items/bulk-mark")
    def bulk_mark(self, request, pk=None):
        audit = self.get_object()
        serializer = BulkMarkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        changed = stock_audit.bulk_mark(self.get_school_or_deny(), request.user, audit.pk, data["item_ids"], data["found"])
        return Response({
            "success": True, "message": "Items updated",
            "data": {"changed": changed, "progress": stock_audit.progress(audit.pk)},
        })

    @action(detail=True, methods=["post"], url_path="finish")
    def finish(self, request, pk=None):
        audit = self.get_object()
        done, missing = stock_audit.finish_audit(self.get_school_or_deny(), request.user, audit.pk)
        data = self._audit(done.pk)
        data["missing"] = StockAuditItemSerializer(missing, many=True).data
        return Response({"success": True, "message": "Stock check finished", "data": data})

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        audit = self.get_object()
        stock_audit.cancel_audit(self.get_school_or_deny(), request.user, audit.pk)
        return Response({"success": True, "message": "Stock check cancelled", "data": self._audit(audit.pk)})

    @action(detail=True, methods=["post"], url_path=r"items/(?P<item_id>\d+)/mark-lost")
    def mark_lost(self, request, pk=None, item_id=None):
        audit = self.get_object()
        serializer = MarkLostSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        report, created = stock_audit.mark_missing_lost(
            self.get_school_or_deny(), request.user, audit.pk, int(item_id), serializer.validated_data["notes"]
        )
        row = LostDamagedReport.objects.select_related("book", "copy", "member__student", "member__staff", "reported_by").get(pk=report.pk)
        return Response(
            {
                "success": True,
                "message": "Copy reported lost" if created else "This copy was already reported lost",
                "data": {"report": ReportSerializer(row).data, "item": self._item(int(item_id)), "created": created},
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )
