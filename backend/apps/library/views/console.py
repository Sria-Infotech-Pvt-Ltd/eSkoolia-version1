"""Librarian console summary: one endpoint, a fixed small number of aggregate queries (blueprint 4.7)."""
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import PermissionDenied
from apps.library.models import (
    Book,
    BookCopy,
    BookIssue,
    Hold,
    LibraryActivityLog,
    LostDamagedReport,
)
from apps.library.serializers import (
    DeskLogSerializer,
    HoldSerializer,
    IssueRowSerializer,
)
from apps.library.services import periods
from apps.library.services.settings import get_settings

from .issue_desk import BookIssueViewSet

VIEW_CODE = "library.console.view"
LIST_LIMIT = 8
ACTIVITY_LIMIT = 10


class ConsoleSummaryView(APIView):
    """GET /api/v1/library/console/summary/ for the caller's own school.

    Queries, whatever the amount of data: settings (1), copies (1), loans (1), titles (1), reports (1),
    holds (1), collection mix (1), the attention list (1), the holds list (1) and recent activity (1).
    The live period card adds up to three more queries (running slots, head count, check-ins) and is an empty object when no period is running.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        if not user.has_permission_code(VIEW_CODE):
            raise PermissionDenied("You do not have permission to perform this action.")
        school = user.school
        if school is None:
            raise PermissionDenied("School context is required.")

        today = timezone.localdate()
        settings = get_settings(school)

        on_the_books = ~Q(status=BookCopy.STATUS_WITHDRAWN)
        in_value = ~Q(status__in=[BookCopy.STATUS_WITHDRAWN, BookCopy.STATUS_LOST])
        copies = BookCopy.objects.filter(school=school).aggregate(
            total=Count("id", filter=on_the_books),
            available=Count("id", filter=Q(status=BookCopy.STATUS_AVAILABLE)),
            value=Sum("book__cost_per_copy", filter=in_value),
        )
        open_loans = Q(status=BookIssue.STATUS_ISSUED)
        loans = BookIssue.objects.filter(school=school).aggregate(
            active=Count("id", filter=open_loans),
            overdue=Count("id", filter=open_loans & Q(due_date__lt=today)),
            due_today=Count("id", filter=open_loans & Q(due_date=today)),
        )
        titles = Book.objects.filter(school=school).count()
        pending_reports = LostDamagedReport.objects.filter(school=school, resolution=LostDamagedReport.RESOLUTION_PENDING).count()
        holds_waiting = Hold.objects.filter(school=school, status=Hold.STATUS_WAITING).count()

        total = copies["total"] or 0
        mix = [
            {
                "category_id": row["book__category_id"],
                "name": row["book__category__name"] or "Uncategorised",
                "code": row["book__category__code"] or "",
                "color_key": row["book__category__color_key"] or "",
                "copies": row["copies"],
                "share": round(row["copies"] / total, 4) if total else 0,
            }
            for row in BookCopy.objects.filter(school=school)
            .exclude(status=BookCopy.STATUS_WITHDRAWN)
            .values("book__category_id", "book__category__name", "book__category__code", "book__category__color_key")
            .annotate(copies=Count("id"))
            .order_by("-copies", "book__category__name")
        ]

        context = {"settings": settings, "today": today, "request": request}
        attention = (
            BookIssue.objects.filter(school=school, status=BookIssue.STATUS_ISSUED, due_date__lte=today)
            .select_related(*BookIssueViewSet.select_related_fields)
            .order_by("due_date", "id")[:LIST_LIMIT]
        )
        holds = (
            Hold.objects.filter(school=school, status=Hold.STATUS_WAITING)
            .select_related("book", "member__student", "member__staff")
            .order_by("created_at", "id")[:LIST_LIMIT]
        )
        activity = LibraryActivityLog.objects.filter(school=school).select_related("actor").order_by("-created_at", "-id")[:ACTIVITY_LIMIT]

        return Response(
            {
                "success": True,
                "message": "Data retrieved successfully",
                "data": {
                    "generated_at": timezone.now().isoformat(),
                    "tiles": {
                        "titles": titles,
                        "collection_value": f"{(copies['value'] or 0):.2f}",
                        "copies_total": total,
                        "copies_available": copies["available"] or 0,
                        "available_share": round((copies["available"] or 0) / total, 4) if total else 0,
                        "active_loans": loans["active"],
                        "overdue": loans["overdue"],
                        "pending_reports": pending_reports,
                    },
                    "due_today": loans["due_today"],
                    "overdue": loans["overdue"],
                    "holds_waiting": holds_waiting,
                    "attention": IssueRowSerializer(attention, many=True, context=context).data,
                    "holds": HoldSerializer(holds, many=True).data,
                    "mix": mix,
                    "activity": DeskLogSerializer(activity, many=True).data,
                    "period": periods.console_card(school),
                },
            }
        )
