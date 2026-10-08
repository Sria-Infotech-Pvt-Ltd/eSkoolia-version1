"""Transactions and Logs (activity feed) and its CSV export, plus the four reports."""
from datetime import date

from django.http import StreamingHttpResponse
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.negotiation import DefaultContentNegotiation
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import PermissionDenied
from apps.library.models import LibraryActivityLog
from apps.library.services import activity_feed, reports

from .base import LibraryViewSet


class AnyAcceptNegotiation(DefaultContentNegotiation):
    """A browser or script that asks for text/csv would get 406 from the JSON-only renderer list; the export
    builds its own response, and everything else here is JSON whatever the client says."""

    def select_renderer(self, request, renderers, format_suffix=None):
        return renderers[0], renderers[0].media_type


class ActivityLogSerializer(serializers.ModelSerializer):
    """One feed line. Needs select_related("actor") and nothing else."""

    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = LibraryActivityLog
        fields = ["id", "event_type", "summary", "created_at", "actor", "actor_name", "member", "book", "issue"]
        read_only_fields = fields

    def get_actor_name(self, obj):
        if not obj.actor_id:
            return ""
        return obj.actor.get_full_name() or obj.actor.username


class ActivityLogViewSet(LibraryViewSet):
    """Read only. Rows are written by services, never through the API."""

    model = LibraryActivityLog
    serializer_class = ActivityLogSerializer
    content_negotiation_class = AnyAcceptNegotiation
    http_method_names = ["get", "head", "options"]
    select_related_fields = ("actor",)
    filterset_fields = []
    search_fields = []
    default_ordering = ["-created_at", "-id"]
    permission_codes = {
        "list": "library.activity_logs.view",
        "retrieve": "library.activity_logs.view",
        "export": "library.activity_logs.export",
    }

    def filter_queryset(self, queryset):
        # Own filters (validated, school scoped by get_queryset); the DRF filter backends are not used here.
        return activity_feed.apply_filters(queryset, activity_feed.clean_filters(self.request.query_params))

    @action(detail=False, methods=["get"], url_path="export")
    def export(self, request):
        school = self.get_school_or_deny()
        filters = activity_feed.clean_filters(request.query_params)
        queryset = activity_feed.apply_filters(self.get_queryset(), filters).select_related(None)
        lines, rows = activity_feed.start_export(school, request.user, queryset, filters)
        response = StreamingHttpResponse(lines, content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="library-activity-{date.today():%Y%m%d}.csv"'
        response["Cache-Control"] = "no-store"
        response["X-Export-Rows"] = str(rows)
        return response


class _ReportView(APIView):
    permission_classes = [IsAuthenticated]
    content_negotiation_class = AnyAcceptNegotiation
    report = None

    def get(self, request):
        user = request.user
        if not user.has_permission_code("library.reports.view"):
            raise PermissionDenied("You do not have permission to perform this action.")
        if user.school is None:
            raise PermissionDenied("School context is required.")
        data = self.build(user.school, request.query_params)
        return Response({"success": True, "message": "Data retrieved successfully", "data": data})

    def build(self, school, params):
        start, end, year = reports.resolve_range(school, params)
        return type(self).report(school, start, end, year)


class CirculationByCategoryView(_ReportView):
    report = staticmethod(reports.circulation_by_category)


class MonthlyTrendView(_ReportView):
    report = staticmethod(reports.monthly_trend)


class FinesAndFeesView(_ReportView):
    report = staticmethod(reports.fines_and_fees)


class BudgetVsSpendView(_ReportView):
    def build(self, school, params):
        year = reports._year_for(school, params)
        if year is None:
            raise NotFound("No current academic year is set for this school.")
        return reports.budget_vs_spend(school, year)
