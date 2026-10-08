"""Loans: the issue desk. Loans are never created, edited or deleted through generic verbs;
every change is an action that calls services.circulation (blueprint 2.4)."""
from datetime import date, timedelta

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.library.models import BookIssue, LibraryActivityLog
from apps.library.serializers import ChargeSerializer
from apps.library.serializers.loans import (
    BulkIssueInputSerializer,
    DeskLogSerializer,
    IssueDetailSerializer,
    IssueInputSerializer,
    IssueRowSerializer,
    RemindInputSerializer,
    ReportSerializer,
    ReturnInputSerializer,
)
from apps.library.services import circulation, reminders
from apps.library.services.settings import get_settings

from .base import LibraryViewSet

OPEN_LOOKUP_MAX = 10
DESK_LOG_MAX = 100
# What the desk did today: issues, returns (including returns filed with a lost or damaged report) and renewals.
DESK_EVENTS = (
    LibraryActivityLog.EVENT_ISSUE,
    LibraryActivityLog.EVENT_RETURN,
    LibraryActivityLog.EVENT_RENEWAL,
    LibraryActivityLog.EVENT_LOST,
    LibraryActivityLog.EVENT_DAMAGED,
)
STATES = ("open", "overdue", "due_today", "returned", "lost")


def _date_param(params, name):
    value = params.get(name)
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValidationError({name: "Use a date like 2026-03-31."})


class BookIssueViewSet(LibraryViewSet):
    model = BookIssue
    serializer_class = IssueRowSerializer
    http_method_names = ["get", "post", "head", "options"]
    disabled_actions = ("create", "update", "destroy")
    select_related_fields = (
        "book", "copy", "member__student__current_class", "member__student__current_section", "member__staff", "issued_by",
    )
    filterset_fields = ["member", "book", "copy"]
    search_fields = [
        "book__title", "copy__code", "member__card_no", "member__student__first_name", "member__student__last_name",
        "member__staff__first_name", "member__staff__last_name",
    ]
    ordering_fields = ["issue_date", "due_date", "created_at"]
    default_ordering = ["-issue_date", "-id"]
    permission_codes = {
        "list": "library.book_issues.view",
        "retrieve": "library.book_issues.view",
        "due_today": "library.book_issues.view",
        "overdue": "library.book_issues.view",
        "open_lookup": "library.book_issues.view",
        "desk_log": "library.book_issues.view",
        "issue": "library.book_issues.issue",
        "bulk_issue": "library.book_issues.issue",
        "return_loan": "library.book_issues.return",
        "undo_return": "library.book_issues.return",
        "renew": "library.book_issues.renew",
        "remind": "library.book_issues.remind",
    }

    # -- context and filters -----------------------------------------------------------------------

    def get_serializer_class(self):
        return IssueDetailSerializer if self.action == "retrieve" else IssueRowSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        user = getattr(self.request, "user", None)
        if user is not None and user.is_authenticated and user.school_id:
            if not hasattr(self, "_settings"):
                self._settings = get_settings(user.school)
            context["settings"] = self._settings
            context["today"] = timezone.localdate()
        return context

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action == "retrieve":
            queryset = queryset.prefetch_related("charges")
        return queryset

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        params = self.request.query_params
        today = timezone.localdate()
        state = params.get("state")
        if state:
            if state not in STATES:
                raise ValidationError({"state": f"Use one of: {', '.join(STATES)}."})
            queryset = {
                "open": lambda q: q.filter(status=BookIssue.STATUS_ISSUED),
                "overdue": lambda q: q.filter(status=BookIssue.STATUS_ISSUED, due_date__lt=today),
                "due_today": lambda q: q.filter(status=BookIssue.STATUS_ISSUED, due_date=today),
                "returned": lambda q: q.filter(status=BookIssue.STATUS_RETURNED),
                "lost": lambda q: q.filter(status=BookIssue.STATUS_LOST),
            }[state](queryset)
        if params.get("school_class"):
            try:
                queryset = queryset.filter(member__student__current_class_id=int(params["school_class"]))
            except ValueError:
                raise ValidationError({"school_class": "Enter a whole number."})
        issued_from, issued_to = _date_param(params, "issued_from"), _date_param(params, "issued_to")
        if issued_from:
            queryset = queryset.filter(issue_date__gte=issued_from)
        if issued_to:
            queryset = queryset.filter(issue_date__lte=issued_to)
        return queryset

    def _rows(self, ids):
        loans = list(self.get_queryset().filter(pk__in=ids).order_by("due_date", "id"))
        return IssueRowSerializer(loans, many=True, context=self.get_serializer_context()).data

    @staticmethod
    def _returned_at(pk):
        return BookIssue.objects.filter(pk=pk).values_list("returned_at", flat=True).first()

    def _row(self, pk):
        return IssueRowSerializer(self.get_queryset().get(pk=pk), context=self.get_serializer_context()).data

    @staticmethod
    def _due(note):
        return {"due_date": note["due_date"], "snapped": note["snapped"], "note": note["note"]}

    # -- reads ------------------------------------------------------------------------------------------

    @action(detail=False, methods=["get"], url_path="due-today")
    def due_today(self, request):
        queryset = self.filter_queryset(self.get_queryset().filter(status=BookIssue.STATUS_ISSUED, due_date=timezone.localdate()))
        return self.list_response(queryset.order_by("due_date", "id"))

    @action(detail=False, methods=["get"], url_path="overdue")
    def overdue(self, request):
        queryset = self.filter_queryset(self.get_queryset().filter(status=BookIssue.STATUS_ISSUED, due_date__lt=timezone.localdate()))
        return self.list_response(queryset.order_by("due_date", "id"))

    @action(detail=False, methods=["get"], url_path="desk-log")
    def desk_log(self, request):
        """Today's issue, return and renewal events from the activity log, newest first (at most 100)."""
        events = LibraryActivityLog.objects.filter(
            school=self.get_school_or_deny(), event_type__in=DESK_EVENTS, created_at__date=timezone.localdate()
        )
        counts = dict(events.order_by().values("event_type").annotate(n=Count("id")).values_list("event_type", "n"))
        rows = DeskLogSerializer(events.select_related("actor").order_by("-created_at", "-id")[:DESK_LOG_MAX], many=True).data
        return Response(
            {
                "success": True,
                "message": "Data retrieved successfully",
                "count": sum(counts.values()),
                "counts": {name: counts.get(name, 0) for name in DESK_EVENTS},
                "results": rows,
                "data": rows,
            }
        )

    @action(detail=False, methods=["get"], url_path="open/lookup")
    def open_lookup(self, request):
        """Return and renew tabs: find the open loan by copy code (exact, first) or by title, borrower or card."""
        query = (request.query_params.get("q") or "").strip()
        if not query:
            rows = []
        else:
            open_loans = self.get_queryset().filter(status=BookIssue.STATUS_ISSUED)
            exact = list(open_loans.filter(copy__code__iexact=query)[:OPEN_LOOKUP_MAX])
            others = open_loans.filter(
                Q(book__title__icontains=query) | Q(copy__code__icontains=query) | Q(member__card_no__icontains=query)
                | Q(member__student__first_name__icontains=query) | Q(member__student__last_name__icontains=query)
                | Q(member__staff__first_name__icontains=query) | Q(member__staff__last_name__icontains=query)
            ).exclude(pk__in=[loan.pk for loan in exact]).order_by("due_date", "id")[: OPEN_LOOKUP_MAX - len(exact)]
            rows = IssueRowSerializer([*exact, *others], many=True, context=self.get_serializer_context()).data
        return Response(
            {"success": True, "message": "Data retrieved successfully", "count": len(rows), "next": None, "previous": None,
             "results": rows, "data": rows}
        )

    # -- actions ---------------------------------------------------------------------------------------------

    @action(detail=False, methods=["post"], url_path="issue")
    def issue(self, request):
        serializer = IssueInputSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        result = circulation.issue_copy(
            self.get_school_or_deny(), request.user, member_id=data["member"].pk,
            copy_id=data["copy"].pk if "copy" in data else None, book_id=data["book"].pk if "book" in data else None,
        )
        return Response(
            {"success": True, "message": "Book issued", "data": {"loan": self._row(result.loan.pk), "due": self._due(result.due_note)}},
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["post"], url_path="bulk-issue")
    def bulk_issue(self, request):
        serializer = BulkIssueInputSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        section = data.get("section")
        result = circulation.bulk_issue(
            self.get_school_or_deny(), request.user, book_id=data["book"].pk, school_class_id=data["school_class"].pk,
            section_id=section.pk if section else None, member_ids=data.get("member_ids"),
        )
        return Response(
            {"success": True, "message": f"Issued {len(result['issued'])} book(s)",
             "data": {"issued": self._rows([loan.pk for loan in result["issued"]]), "skipped": result["skipped"]}},
            status=status.HTTP_201_CREATED if result["issued"] else status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="return")
    def return_loan(self, request, pk=None):
        loan = self.get_object()
        serializer = ReturnInputSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        outcome = circulation.return_loan(
            self.get_school_or_deny(), request.user, loan.pk,
            fine_action=data.get("fine_action", ""), waive_reason=data.get("waive_reason", ""),
            condition=data.get("condition", ""), report=data.get("report"),
        )
        report = outcome["report"]
        # Undo is offered only when the copy is back on the shelf: a lost or damaged report rules it out.
        returned_at = self._returned_at(loan.pk)
        undo_expires_at = None
        if report is None and returned_at is not None:
            undo_expires_at = returned_at + timedelta(minutes=self.get_serializer_context()["settings"].undo_return_minutes)
        report_data = None
        if report is not None:
            report_data = ReportSerializer(report).data
        return Response(
            {
                "success": True,
                "message": "Book returned",
                "data": {
                    "loan": self._row(loan.pk),
                    "charge": ChargeSerializer(outcome["charge"]).data if outcome["charge"] else None,
                    "report": report_data,
                    "replacement_charge": ChargeSerializer(outcome["replacement_charge"]).data if outcome["replacement_charge"] else None,
                    "hold_queue_count": outcome["hold_queue_count"],
                    "undo_expires_at": undo_expires_at,
                },
            }
        )

    @action(detail=True, methods=["post"], url_path="undo-return")
    def undo_return(self, request, pk=None):
        loan = self.get_object()
        circulation.undo_return(self.get_school_or_deny(), request.user, loan.pk)
        return Response({"success": True, "message": "Return undone", "data": {"loan": self._row(loan.pk)}})

    @action(detail=False, methods=["post"], url_path="remind")
    def remind(self, request):
        """Queue overdue reminders for named loans or for every overdue loan. Once per loan per day."""
        serializer = RemindInputSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        result = reminders.send_reminders(
            self.get_school_or_deny(), request.user, issue_ids=data.get("issue_ids"), all_overdue=data.get("all_overdue", False)
        )
        return Response(
            {"success": True, "message": f"Queued {result['queued']} reminder(s)", "data": result}
        )

    @action(detail=True, methods=["post"], url_path="renew")
    def renew(self, request, pk=None):
        loan = self.get_object()
        _loan, note = circulation.renew_loan(self.get_school_or_deny(), request.user, loan.pk)
        return Response({"success": True, "message": "Loan renewed", "data": {"loan": self._row(loan.pk), "due": self._due(note)}})
