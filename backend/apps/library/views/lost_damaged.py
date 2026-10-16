from django.db.models import OuterRef, Subquery
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.library.models import Charge, LostDamagedReport
from apps.library.serializers.loans import (
    FeePaidSerializer,
    ReportCreateSerializer,
    ReportNotesSerializer,
    ReportSerializer,
)
from apps.library.services import circulation

from .base import LibraryViewSet


class LostDamagedViewSet(LibraryViewSet):
    model = LostDamagedReport
    serializer_class = ReportSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]
    disabled_actions = ("update", "destroy")
    select_related_fields = ("book", "copy", "member__student", "member__staff", "reported_by")
    filterset_fields = ["report_type", "resolution", "member"]
    search_fields = ["book__title", "copy__code", "member__card_no", "notes"]
    ordering_fields = ["reported_on", "created_at"]
    default_ordering = ["-reported_on", "-id"]
    permission_codes = {
        "list": "library.lost_damaged.view",
        "retrieve": "library.lost_damaged.view",
        "bill": "library.lost_damaged.view",
        "create": "library.lost_damaged.create",
        "partial_update": "library.lost_damaged.update",
        "mark_fee_paid": "library.charges.collect",
        "resolve": "library.lost_damaged.resolve",
    }

    def annotate_queryset(self, queryset):
        fee = Charge.objects.filter(report=OuterRef("pk"), charge_type=Charge.TYPE_REPLACEMENT)
        return queryset.annotate(
            fee_charge_status=Subquery(fee.values("status")[:1]),
            fee_charge_id=Subquery(fee.values("id")[:1]),
        )

    def _row(self, pk, message, status_code=status.HTTP_200_OK):
        data = ReportSerializer(self.get_queryset().get(pk=pk)).data
        return Response({"success": True, "message": message, "data": data}, status=status_code)

    def create(self, request, *args, **kwargs):
        serializer = ReportCreateSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        member, issue = data.get("member"), data.get("issue")
        report, _charge, created = circulation.create_report(
            self.get_school_or_deny(), request.user, copy_id=data["copy"].pk, report_type=data["report_type"],
            member_id=member.pk if member else None, issue_id=issue.pk if issue else None, notes=data.get("notes", ""),
        )
        return self._row(
            report.pk, "Report created" if created else "This copy already has an open report",
            status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def partial_update(self, request, *args, **kwargs):
        report = self.get_object()
        serializer = ReportNotesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        report.notes = serializer.validated_data["notes"]
        report.updated_by = request.user
        report.save(update_fields=["notes", "updated_by", "updated_at"])
        return self._row(report.pk, "Notes saved")

    @action(detail=True, methods=["post"], url_path="mark-fee-paid")
    def mark_fee_paid(self, request, pk=None):
        report = self.get_object()
        serializer = FeePaidSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        circulation.mark_fee_paid(self.get_school_or_deny(), request.user, report.pk, serializer.validated_data.get("receipt_no", ""))
        return self._row(report.pk, "Fee marked as paid")

    @action(detail=True, methods=["post"], url_path="resolve")
    def resolve(self, request, pk=None):
        report = self.get_object()
        circulation.resolve_report(self.get_school_or_deny(), request.user, report.pk)
        return self._row(report.pk, "Report resolved")

    @action(detail=True, methods=["get"], url_path="bill")
    def bill(self, request, pk=None):
        report = self.get_object()
        return Response({"success": True, "message": "Data retrieved successfully", "data": circulation.report_bill(report.school, report)})
