from django.db.models import Count, Exists, OuterRef, Q
from django.http import Http404
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.negotiation import DefaultContentNegotiation
from rest_framework.response import Response
from rest_framework.settings import api_settings

from apps.library.exceptions import LibraryHasHistory
from apps.library.models import Book, BookCategory, BookCopy
from apps.library.serializers import (
    AddCopiesSerializer,
    BookCategorySerializer,
    BookCopySerializer,
    BookDetailSerializer,
    BookListSerializer,
    BookLookupSerializer,
    BookWriteSerializer,
    BulkImportCommitSerializer,
    BulkImportSerializer,
    WithdrawCopySerializer,
)
from apps.library.services import accession, bulk_import
from apps.library.services.catalogue import (
    AVAILABILITY_VALUES,
    annotate_copy_counts,
    filter_availability,
)
from apps.library.services.settings import get_settings

from .base import LibraryViewSet

LOOKUP_MAX = 10


class _SettingsWithoutFormatOverride:
    """api_settings with URL_FORMAT_OVERRIDE switched off."""

    def __getattr__(self, name):
        return None if name == "URL_FORMAT_OVERRIDE" else getattr(api_settings, name)


class IgnoreFormatQueryParam(DefaultContentNegotiation):
    """DRF reads ``?format=`` as a renderer override, which would swallow the catalogue's
    own ``format`` filter (fiction, textbook, ...). This API only renders JSON, so ignore it."""

    settings = _SettingsWithoutFormatOverride()


class BookCategoryViewSet(LibraryViewSet):
    model = BookCategory
    serializer_class = BookCategorySerializer
    select_related_fields = ("created_by", "updated_by")
    filterset_fields = ["is_active"]
    search_fields = ["name", "description", "code"]
    ordering_fields = ["name", "code", "created_at"]
    default_ordering = ["name"]
    permission_codes = {
        "list": "library.book_categories.view",
        "retrieve": "library.book_categories.view",
        "create": "library.book_categories.create",
        "update": "library.book_categories.update",
        "destroy": "library.book_categories.delete",
    }

    def annotate_queryset(self, queryset):
        return queryset.annotate(title_count=Count("books"))

    def perform_destroy(self, instance):
        if instance.books.exists():
            raise LibraryHasHistory("This category has titles. Make it inactive instead of deleting it.")
        instance.delete()


class BookViewSet(LibraryViewSet):
    model = Book
    content_negotiation_class = IgnoreFormatQueryParam
    select_related_fields = ("category", "created_by", "updated_by")
    filterset_fields = [
        "category", "age_band", "format", "rack", "for_students", "for_teachers", "for_staff", "is_reference_only",
    ]
    search_fields = ["title", "author", "isbn", "accession_code", "call_number"]
    ordering_fields = [
        "title", "author", "accession_code", "call_number", "cost_per_copy", "created_at",
        "copies_total", "copies_available",
    ]
    default_ordering = ["title", "id"]
    permission_codes = {
        "list": "library.books.view",
        "retrieve": "library.books.view",
        "create": "library.books.create",
        "update": "library.books.update",
        "destroy": "library.books.delete",
        "add_copies": "library.books.update",
        "lookup": "library.book_issues.view",
        "copies": "library.book_copies.view",
        "labels": "library.book_copies.view",
        "bulk_import_preview": "library.books.import",
        "bulk_import_commit": "library.books.import",
    }

    # -- queryset and serializers ------------------------------------------

    def annotate_queryset(self, queryset):
        return annotate_copy_counts(queryset)

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action in ("retrieve", "create", "update", "partial_update", "add_copies"):
            queryset = queryset.prefetch_related("copies")
        return queryset

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return BookWriteSerializer
        if self.action == "retrieve":
            return BookDetailSerializer
        if self.action == "add_copies":
            return AddCopiesSerializer
        if self.action == "lookup":
            return BookLookupSerializer
        if self.action == "bulk_import_preview":
            return BulkImportSerializer
        if self.action == "bulk_import_commit":
            return BulkImportCommitSerializer
        return BookListSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        user = getattr(self.request, "user", None)
        if user is not None and user.is_authenticated and user.school_id:
            if not hasattr(self, "_low_stock_ratio"):
                self._low_stock_ratio = get_settings(user.school).low_stock_ratio
            context["low_stock_ratio"] = self._low_stock_ratio
        return context

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        params = self.request.query_params
        condition = params.get("condition")
        if condition:
            if condition not in dict(BookCopy.CONDITION_CHOICES):
                raise ValidationError({"condition": "Unknown condition."})
            queryset = queryset.filter(
                Exists(BookCopy.objects.filter(book=OuterRef("pk"), condition=condition))
            )
        availability = params.get("availability")
        if availability:
            if availability not in AVAILABILITY_VALUES:
                raise ValidationError({"availability": f"Use one of: {', '.join(AVAILABILITY_VALUES)}."})
            queryset = filter_availability(queryset, availability, self.get_serializer_context().get("low_stock_ratio", "0.34"))
        return queryset

    def detail_response(self, pk, message, status_code=status.HTTP_200_OK, **extra):
        book = self.get_queryset().prefetch_related("copies").get(pk=pk)
        data = BookDetailSerializer(book, context=self.get_serializer_context()).data
        return Response({"success": True, "message": message, "data": data, **extra}, status=status_code)

    # -- writes --------------------------------------------------------------

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        copies_count = data.pop("copies_count")
        condition = data.pop("condition", BookCopy.CONDITION_NEW)
        book, _copies = accession.create_book_with_copies(
            self.get_school_or_deny(), request.user, data, copies_count, condition
        )
        return self.detail_response(book.pk, "Resource created successfully", status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        data = {k: v for k, v in serializer.validated_data.items() if k not in ("copies_count", "condition")}
        for name, value in data.items():
            setattr(instance, name, value)
        instance.updated_by = request.user
        instance.save()
        return self.detail_response(instance.pk, "Resource updated successfully")

    def perform_destroy(self, instance):
        if instance.copies.exists() or instance.issues.exists():
            raise LibraryHasHistory("This title has copies or loans. Withdraw its copies instead of deleting it.")
        instance.delete()

    # -- actions -------------------------------------------------------------

    @action(detail=True, methods=["post"], url_path="add-copies")
    def add_copies(self, request, pk=None):
        book = self.get_object()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _book, copies = accession.add_copies(
            self.get_school_or_deny(), request.user, book.pk,
            serializer.validated_data["count"], serializer.validated_data["condition"],
        )
        return self.detail_response(
            book.pk, "Copies added", status.HTTP_201_CREATED, added=[copy.code for copy in copies]
        )

    @action(detail=True, methods=["get"], url_path="copies")
    def copies(self, request, pk=None):
        book = self.get_object()
        queryset = BookCopy.objects.filter(school=book.school_id, book=book).select_related("book", "created_by", "updated_by")
        return self.list_response(queryset.order_by("id"), serializer_class=BookCopySerializer)

    @action(detail=True, methods=["get"], url_path="labels")
    def labels(self, request, pk=None):
        """Copy codes and the title line for printing. Withdrawn copies are left out unless ?all=true;
        ?copy=<id> returns a single label."""
        book = self.get_object()
        copies = BookCopy.objects.filter(school=book.school_id, book=book).order_by("id")
        if request.query_params.get("all") != "true":
            copies = copies.exclude(status=BookCopy.STATUS_WITHDRAWN)
        if request.query_params.get("copy"):
            copies = copies.filter(pk=request.query_params["copy"]) if request.query_params["copy"].isdigit() else copies.none()
        extra = " ".join(part for part in (f"{book.edition} ed." if book.edition else "", book.part_label) if part)
        data = {
            "book_id": book.pk,
            "title_line": " - ".join(part for part in (book.title + (f" ({extra})" if extra else ""), book.author) if part),
            "accession_code": book.accession_code,
            "call_number": book.call_number,
            "rack": book.rack,
            "copies": [{"id": c.pk, "code": c.code, "status": c.status, "condition": c.condition} for c in copies],
        }
        return Response({"success": True, "message": "Data retrieved successfully", "data": data})

    @action(detail=False, methods=["post"], url_path="bulk-import/preview")
    def bulk_import_preview(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = bulk_import.preview(self.get_school_or_deny(), serializer.validated_data["rows"])
        return Response({"success": True, "message": "Preview ready. Nothing was saved.", "data": data})

    @action(detail=False, methods=["post"], url_path="bulk-import/commit")
    def bulk_import_commit(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result, replayed = bulk_import.commit(
            self.get_school_or_deny(), request.user,
            serializer.validated_data["rows"], serializer.validated_data["client_batch_id"],
        )
        ids = [item["id"] for item in result["created"]]
        books = self.get_queryset().filter(pk__in=ids).order_by("accession_code")
        titles = BookListSerializer(books, many=True, context=self.get_serializer_context()).data
        return Response(
            {
                "success": True,
                "message": "Import already applied" if replayed else "Import complete",
                "data": {"created": result["created"], "skipped": result["skipped"], "titles": titles, "replayed": replayed},
            },
            status=status.HTTP_200_OK if replayed else status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["get"], url_path="lookup")
    def lookup(self, request):
        """Issue-desk search. An exact copy code puts that copy's title first."""
        query = (request.query_params.get("q") or "").strip()
        try:
            limit = max(1, min(int(request.query_params.get("limit", LOOKUP_MAX)), LOOKUP_MAX))
        except ValueError:
            raise ValidationError({"limit": "Enter a whole number."})
        books = []
        if query:
            queryset = self.get_queryset()
            copy = BookCopy.objects.filter(school=request.user.school, code__iexact=query).first()
            first = None
            if copy is not None:
                first = queryset.filter(pk=copy.book_id).first()
                if first is not None:
                    first.matched_copy = copy
                    books.append(first)
            text = queryset.filter(
                Q(title__icontains=query) | Q(author__icontains=query)
                | Q(accession_code__icontains=query) | Q(call_number__icontains=query)
            )
            if first is not None:
                text = text.exclude(pk=first.pk)
            books.extend(text.order_by("title", "id")[: limit - len(books)])
        context = self.get_serializer_context()
        rows = BookLookupSerializer(books[:limit], many=True, context=context).data
        return Response(
            {"success": True, "message": "Data retrieved successfully", "count": len(rows),
             "next": None, "previous": None, "results": rows, "data": rows}
        )


class BookCopyViewSet(LibraryViewSet):
    """Copies are created by accession and add-copies, never directly. PATCH edits condition only."""

    model = BookCopy
    serializer_class = BookCopySerializer
    http_method_names = ["get", "patch", "post", "head", "options"]
    disabled_actions = ("create", "update", "destroy")
    select_related_fields = ("book", "created_by", "updated_by")
    filterset_fields = ["book", "status", "condition"]
    search_fields = ["code", "book__title"]
    ordering_fields = ["code", "status", "condition", "created_at"]
    default_ordering = ["book_id", "id"]
    permission_codes = {
        "list": "library.book_copies.view",
        "retrieve": "library.book_copies.view",
        "by_code": "library.book_copies.view",
        "update": "library.book_copies.update",
        "withdraw": "library.book_copies.withdraw",
    }

    def get_serializer_class(self):
        return WithdrawCopySerializer if self.action == "withdraw" else BookCopySerializer

    @action(detail=False, methods=["get"], url_path=r"by-code/(?P<code>.+)")
    def by_code(self, request, code=None):
        copy = self.get_queryset().filter(code__iexact=code).first()
        if copy is None:
            raise Http404
        return Response(
            {"success": True, "message": "Resource retrieved successfully", "data": BookCopySerializer(copy).data}
        )

    @action(detail=True, methods=["post"], url_path="withdraw")
    def withdraw(self, request, pk=None):
        copy = self.get_object()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        accession.withdraw_copy(self.get_school_or_deny(), request.user, copy.pk, serializer.validated_data["reason"])
        copy = self.get_queryset().get(pk=copy.pk)
        return Response(
            {"success": True, "message": "Copy withdrawn", "data": BookCopySerializer(copy).data}
        )
