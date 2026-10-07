from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.library.exceptions import LibraryAlreadyReturned, LibraryCopyUnavailable
from apps.library.models import Book, BookIssue
from apps.library.serializers import BookIssueSerializer

from .base import LibraryViewSet


class BookIssueViewSet(LibraryViewSet):
    """LEGACY loan endpoints, replaced by the issue-desk service in prompt 5.

    Kept working for the existing Book Issues page: list, retrieve, create
    (guarded by ``book_issues.issue``), ``return`` (``book_issues.return``) and
    ``overdue``. Generic PUT, PATCH and DELETE are not offered: no permission
    code exists for them and they adjusted stock without any check.
    """

    model = BookIssue
    serializer_class = BookIssueSerializer
    http_method_names = ["get", "post", "head", "options"]
    select_related_fields = ("book", "member", "issued_by", "created_by", "updated_by")
    filterset_fields = ["book", "member", "status", "issue_date", "due_date"]
    search_fields = ["book__title", "member__card_no"]
    ordering_fields = ["issue_date", "due_date", "created_at"]
    default_ordering = ["-issue_date", "-id"]
    permission_codes = {
        "list": "library.book_issues.view",
        "retrieve": "library.book_issues.view",
        "overdue": "library.book_issues.view",
        "create": "library.book_issues.issue",  # LEGACY
        "mark_returned": "library.book_issues.return",  # LEGACY
    }

    @transaction.atomic
    def perform_create(self, serializer):
        user = self.request.user
        school = self.get_school_or_deny()
        # The conditional UPDATE is the stock check: two requests for the last
        # copy cannot both pass it.
        taken = Book.objects.filter(
            pk=serializer.validated_data["book"].pk, school=school, available_quantity__gt=0
        ).update(available_quantity=F("available_quantity") - 1)
        if not taken:
            raise LibraryCopyUnavailable("No available copies for this book.")
        serializer.save(
            school=school, issued_by=user, created_by=user, updated_by=user, status=BookIssue.STATUS_ISSUED
        )

    @action(detail=True, methods=["post"], url_path="return")
    @transaction.atomic
    def mark_returned(self, request, pk=None):
        # LEGACY: the body is ignored. The server sets the return date and never
        # takes a fine from the client.
        issue = self.get_object()
        closed = BookIssue.objects.filter(pk=issue.pk, status=BookIssue.STATUS_ISSUED).update(
            status=BookIssue.STATUS_RETURNED,
            return_date=timezone.localdate(),
            updated_by=request.user,
            updated_at=timezone.now(),
        )
        if not closed:
            raise LibraryAlreadyReturned()
        Book.objects.filter(pk=issue.book_id).update(available_quantity=F("available_quantity") + 1)
        issue.refresh_from_db()
        return Response(
            {
                "success": True,
                "message": "Book returned",
                "data": {"id": issue.id, "status": issue.status, "return_date": issue.return_date},
            }
        )

    @action(detail=False, methods=["get"], url_path="overdue")
    def overdue(self, request):
        queryset = self.filter_queryset(
            self.get_queryset().filter(status=BookIssue.STATUS_ISSUED, due_date__lt=timezone.localdate())
        )
        return self.list_response(queryset)
