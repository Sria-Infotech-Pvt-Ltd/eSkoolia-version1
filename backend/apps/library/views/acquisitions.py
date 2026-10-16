"""Acquisitions endpoints (blueprint 2.4): purchase orders, donations, budget, summary, teacher requests."""
from django.db.models import Count
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import PermissionDenied
from apps.core.models import AcademicYear
from apps.library.models import BookRequest, Budget, Donation, PurchaseOrder
from apps.library.serializers.acquisitions import (
    BookRequestReviewSerializer,
    BookRequestSerializer,
    BudgetInputSerializer,
    DonationSerializer,
    PurchaseOrderSerializer,
)
from apps.library.services import acquisitions

from .base import LibraryViewSet


class PurchaseOrderViewSet(LibraryViewSet):
    model = PurchaseOrder
    serializer_class = PurchaseOrderSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    select_related_fields = ("academic_year",)
    filterset_fields = ["status", "payment_status", "academic_year"]
    search_fields = ["po_number", "vendor_name", "invoice_number"]
    ordering_fields = ["order_date", "total_cost", "po_number"]
    default_ordering = ["-order_date", "-id"]
    permission_codes = {
        "list": "library.purchase_orders.view",
        "retrieve": "library.purchase_orders.view",
        "create": "library.purchase_orders.create",
        "update": "library.purchase_orders.update",
        "destroy": "library.purchase_orders.delete",
    }

    def annotate_queryset(self, queryset):
        return queryset.annotate(linked_books=Count("books"))

    def _row(self, pk, message, status_code=status.HTTP_200_OK):
        data = self.get_serializer(self.get_queryset().get(pk=pk)).data
        return Response({"success": True, "message": message, "data": data}, status=status_code)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = {k: v for k, v in serializer.validated_data.items() if k not in ("status", "payment_status")}
        order = acquisitions.create_purchase_order(self.get_school_or_deny(), request.user, data)
        return self._row(order.pk, "Resource created successfully", status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", True)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        acquisitions.update_purchase_order(
            self.get_school_or_deny(), request.user, instance.pk, dict(serializer.validated_data)
        )
        return self._row(instance.pk, "Resource updated successfully")

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        acquisitions.delete_purchase_order(self.get_school_or_deny(), request.user, instance.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


class DonationViewSet(LibraryViewSet):
    model = Donation
    serializer_class = DonationSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]
    disabled_actions = ("destroy",)
    filterset_fields = ["donor_type", "acknowledgement_sent"]
    # The contact is deliberately not searchable: a search must not reveal it.
    search_fields = ["donor_name", "receipt_no"]
    ordering_fields = ["donation_date", "receipt_no"]
    default_ordering = ["-donation_date", "-id"]
    permission_codes = {
        "list": "library.donations.view",
        "retrieve": "library.donations.view",
        "receipt": "library.donations.view",
        "create": "library.donations.create",
        "update": "library.donations.update",
    }

    def annotate_queryset(self, queryset):
        return queryset.annotate(linked_books=Count("books"))

    def _row(self, pk, message, status_code=status.HTTP_200_OK):
        data = self.get_serializer(self.get_queryset().get(pk=pk)).data
        return Response({"success": True, "message": message, "data": data}, status=status_code)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        donation = acquisitions.create_donation(
            self.get_school_or_deny(), request.user, dict(serializer.validated_data)
        )
        return self._row(donation.pk, "Resource created successfully", status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", True)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        acquisitions.update_donation(
            self.get_school_or_deny(), request.user, instance.pk, dict(serializer.validated_data)
        )
        return self._row(instance.pk, "Resource updated successfully")

    @action(detail=True, methods=["get"], url_path="receipt")
    def receipt(self, request, pk=None):
        """Everything the printed receipt needs. Requires library.donations.view, so the contact may be shown."""
        donation = self.get_object()
        data = self.get_serializer(donation).data
        school = self.get_school_or_deny()
        data["school_name"] = getattr(school, "name", "")
        return Response({"success": True, "message": "Data retrieved successfully", "data": data})


class _AcquisitionsView(APIView):
    permission_classes = [IsAuthenticated]

    def _require(self, request, code):
        if not request.user.has_permission_code(code):
            raise PermissionDenied("You do not have permission to perform this action.")
        if request.user.school is None:
            raise PermissionDenied("School context is required.")
        return request.user.school

    @staticmethod
    def _year(school, raw):
        """The requested academic year of this school, else the current one, else 404."""
        if raw not in (None, ""):
            try:
                return AcademicYear.objects.get(pk=int(raw), school=school)
            except (ValueError, TypeError, AcademicYear.DoesNotExist):
                raise NotFound("Academic year not found.")
        year = acquisitions.current_academic_year(school)
        if year is None:
            raise NotFound("No current academic year is set for this school.")
        return year


class BudgetView(_AcquisitionsView):
    """GET budgets/?academic_year=<id> and PUT budgets/ (upsert) for the caller's own school."""

    def get(self, request):
        school = self._require(request, "library.budgets.view")
        year = self._year(school, request.query_params.get("academic_year"))
        budget = Budget.objects.filter(school=school, academic_year=year).first()
        data = {"academic_year": year.pk, "academic_year_name": year.name, "amount": budget.amount if budget else None}
        return Response({"success": True, "message": "Data retrieved successfully", "data": data})

    def put(self, request):
        school = self._require(request, "library.budgets.manage")
        serializer = BudgetInputSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        budget = acquisitions.set_budget(
            school, request.user, serializer.validated_data["academic_year"], serializer.validated_data["amount"]
        )
        data = {"academic_year": budget.academic_year_id, "amount": budget.amount}
        return Response({"success": True, "message": "Resource updated successfully", "data": data})


class AcquisitionsSummaryView(_AcquisitionsView):
    """GET acquisitions/summary/?academic_year=<id>: budget, committed, paid and remaining."""

    def get(self, request):
        school = self._require(request, "library.budgets.view")
        year = self._year(school, request.query_params.get("academic_year"))
        return Response(
            {"success": True, "message": "Data retrieved successfully", "data": acquisitions.budget_summary(school, year)}
        )


class BookRequestViewSet(LibraryViewSet):
    """The teacher requests queue. Requests are created from the teacher portal (prompt 11); only review is here."""

    model = BookRequest
    serializer_class = BookRequestSerializer
    http_method_names = ["get", "post", "head", "options"]
    disabled_actions = ("create", "update", "destroy")
    select_related_fields = ("requested_by", "reviewed_by", "school_class", "section", "linked_book")
    filterset_fields = ["status"]
    search_fields = ["title"]
    ordering_fields = ["created_at", "status"]
    default_ordering = ["-created_at", "-id"]
    permission_codes = {
        "list": "library.book_requests.view",
        "retrieve": "library.book_requests.view",
        "review": "library.book_requests.review",
    }

    @action(detail=True, methods=["post"], url_path="review")
    def review(self, request, pk=None):
        instance = self.get_object()
        serializer = BookRequestReviewSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        acquisitions.review_book_request(
            self.get_school_or_deny(), request.user, instance.pk, data["status"],
            note=data.get("note", ""), linked_book=data.get("linked_book"),
        )
        row = BookRequestSerializer(self.get_queryset().get(pk=instance.pk), context=self.get_serializer_context()).data
        return Response({"success": True, "message": "Request reviewed", "data": row})
