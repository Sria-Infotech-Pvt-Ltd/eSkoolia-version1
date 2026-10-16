"""
Teacher Portal: Library (decisions D15 and D16, blueprint 2.4 and 3.4).

Plain JSON, no permission codes, no admin envelope. Like every sibling teacher view these are
`APIView`s with JWTAuthentication and IsTeacherPortalUser, and every query is filtered on the teacher's
own school. Nothing here accepts a school, class, section or student id from the client:

  * My Class  : students inside get_attendance_scope(user). A loan outside it is a 404; no scope is an empty list.
  * My Books  : only the loans of the teacher's own library member (found through Staff.user).
  * Requests  : requested_by is request.user; class and section come from the scope.

Errors from the library services (409 library_reminder_already_sent, library_renewal_cap, ...) are rendered by
the project's exception handler in the same {success, error: {code, message}} shape as the admin API.
"""
from django.db import transaction
from rest_framework import serializers
from rest_framework import status as http_status
from rest_framework.exceptions import ValidationError as FieldValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.core.exceptions import ConflictError
from apps.library.models import BookRequest, LibraryActivityLog
from apps.library.services import circulation, reminders, teacher
from apps.library.services.activity import log_event
from apps.library.services.dues import borrowing_limit
from apps.library.services.members import dues_for_member
from apps.library.services.settings import get_settings

from .permissions import IsTeacherPortalUser
from .utils import get_attendance_scope

SEARCH_MIN_CHARS = 2
SEARCH_LIMIT = 10


class _LibraryTeacherView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsTeacherPortalUser]

    @staticmethod
    def today():
        from django.utils import timezone

        return timezone.localdate()


class LibraryOverviewView(_LibraryTeacherView):
    """GET /api/v1/teacher/library/overview/: own membership summary and whether the teacher has a class scope."""

    def get(self, request):
        user = request.user
        school = user.school
        settings = get_settings(school)
        pairs = get_attendance_scope(user)
        member = teacher.member_for_teacher(school, user)
        summary = None
        if member is not None:
            dues = dues_for_member(school, member, settings, self.today())
            summary = {
                "card_no": member.card_no,
                "is_active": member.is_active,
                "borrowing_limit": borrowing_limit(member.member_type, settings),
                "open_loans": member.book_issues.filter(status="issued").count(),
                "suspended": dues.suspended,
            }
        return Response({"registered": member is not None, "member": summary, "has_class_scope": bool(pairs), "class_count": len(pairs)})


class LibraryMyClassView(_LibraryTeacherView):
    """GET /api/v1/teacher/library/my-class/: per class and section in scope, the next library period and open loans."""

    def get(self, request):
        user = request.user
        school = user.school
        today = self.today()
        pairs = get_attendance_scope(user)
        settings = get_settings(school)
        reminded = reminders.reminded_loan_ids(school, today)
        groups = teacher.class_groups(school, pairs, settings, reminded, today=today)
        return Response({"has_class_scope": bool(pairs), "today": today.isoformat(), "classes": groups})


class LibraryRemindView(_LibraryTeacherView):
    """POST /api/v1/teacher/library/my-class/loans/<issue_id>/remind/: tell the guardian about an overdue loan, once a day."""

    def post(self, request, issue_id):
        user = request.user
        school = user.school
        loan = teacher.loan_in_scope(school, get_attendance_scope(user), issue_id)
        reminders.send_reminders(school, user, issue_ids=[loan.pk], today=self.today())
        return Response({"queued": True, "loan": loan.pk, "reminded_today": True}, status=http_status.HTTP_200_OK)


class LibraryMyBooksView(_LibraryTeacherView):
    """GET /api/v1/teacher/library/my-books/: the teacher's own open loans with renewal state."""

    def get(self, request):
        user = request.user
        school = user.school
        member = teacher.member_for_teacher(school, user)
        if member is None:
            return Response({"registered": False, "borrowing_limit": None, "open_loans": 0, "loans": []})
        settings = get_settings(school)
        rows = teacher.my_loan_rows(school, member, settings, self.today())
        return Response({
            "registered": True,
            "is_active": member.is_active,
            "card_no": member.card_no,
            "borrowing_limit": borrowing_limit(member.member_type, settings),
            "open_loans": len(rows),
            "loans": rows,
        })


class LibraryRenewView(_LibraryTeacherView):
    """POST /api/v1/teacher/library/my-books/loans/<issue_id>/renew/: renew one of the teacher's own loans (R5)."""

    def post(self, request, issue_id):
        user = request.user
        school = user.school
        member = teacher.member_for_teacher(school, user)
        teacher.own_loan(school, member, issue_id)
        loan, due = circulation.renew_loan(school, user, issue_id)
        return Response({
            "id": loan.pk,
            "due_date": due["due_date"].isoformat(),
            "snapped": due["snapped"],
            "note": due["note"],
            "renew_count": loan.renew_count,
        })


class BookRequestCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=1000, default="")

    def validate_title(self, value):
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError("Title is required.")
        return value


class LibraryBookRequestsView(_LibraryTeacherView):
    """GET and POST /api/v1/teacher/library/book-requests/: the teacher's own recommendations."""

    def get(self, request):
        rows = (
            BookRequest.objects.filter(school=request.user.school, requested_by=request.user)
            .select_related("linked_book")
            .order_by("-created_at", "-id")[:200]
        )
        results = [teacher.request_row(row) for row in rows]
        return Response({"count": len(results), "results": results})

    @transaction.atomic
    def post(self, request):
        user = request.user
        school = user.school
        serializer = BookRequestCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        title, notes = serializer.validated_data["title"], serializer.validated_data["notes"].strip()

        open_requests = teacher.pending_requests(school, user)
        if open_requests.filter(title__iexact=title).exists():
            raise ConflictError(detail="You already have a pending request for this title.", code="conflict")
        if open_requests.count() >= teacher.MAX_PENDING_REQUESTS:
            raise FieldValidationError({"title": f"You already have {teacher.MAX_PENDING_REQUESTS} requests waiting. Wait for the library to review some."})

        class_id, section_id = teacher.home_scope(get_attendance_scope(user))
        book_request = BookRequest.objects.create(
            school=school, requested_by=user, school_class_id=class_id, section_id=section_id, title=title, notes=notes,
            created_by=user, updated_by=user,
        )
        log_event(
            school, user, LibraryActivityLog.EVENT_REQUEST, f"Book request {book_request.pk} submitted by {user.get_full_name() or user.get_username()}",
            metadata={"request_id": book_request.pk, "source": "teacher_portal"},
        )
        return Response(teacher.request_row(book_request), status=http_status.HTTP_201_CREATED)


class LibraryBookSearchView(_LibraryTeacherView):
    """GET /api/v1/teacher/library/books/search/?q=: title, author and availability. No cost or accession fields."""

    def get(self, request):
        term = (request.query_params.get("q") or "").strip()
        if len(term) < SEARCH_MIN_CHARS:
            return Response({"count": 0, "results": []})
        rows = teacher.search_books_queryset(request.user.school, term[:100])[:SEARCH_LIMIT]
        results = [
            {
                "id": book.pk,
                "title": book.title,
                "author": book.author,
                "edition": book.edition,
                "category_name": book.category.name if book.category_id else "",
                "available_copies": book.available_copies,
                "total_copies": book.total_copies,
                "reference_only": book.is_reference_only,
            }
            for book in rows
        ]
        return Response({"count": len(results), "results": results})

