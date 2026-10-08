from decimal import Decimal

from rest_framework import serializers

from apps.core.models import AcademicYear
from apps.library.models import Book, BookRequest, Donation, PurchaseOrder

from .base import LibraryModelSerializer

DONATIONS_VIEW_CODE = "library.donations.view"


def _school_id(serializer):
    return getattr(getattr(serializer.context.get("request"), "user", None), "school_id", None)


class PurchaseOrderSerializer(LibraryModelSerializer):
    linked_books = serializers.IntegerField(read_only=True, default=0)
    academic_year_name = serializers.CharField(source="academic_year.name", read_only=True, default="")

    class Meta:
        model = PurchaseOrder
        fields = [
            "id", "po_number", "order_date", "vendor_name", "invoice_number", "books_count", "total_cost",
            "status", "payment_status", "academic_year", "academic_year_name", "notes", "linked_books",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "po_number", "linked_books", "academic_year_name", "created_at", "updated_at"]
        extra_kwargs = {"academic_year": {"required": False, "allow_null": True}}

    def validate_academic_year(self, value):
        if value is not None and value.school_id != _school_id(self):
            raise serializers.ValidationError("Selected academic year does not belong to your school.")
        return value

    def validate_books_count(self, value):
        if value < 1:
            raise serializers.ValidationError("Enter at least one book.")
        return value

    def validate_vendor_name(self, value):
        if not value.strip():
            raise serializers.ValidationError("Vendor name is required.")
        return value.strip()


class DonationSerializer(LibraryModelSerializer):
    """`contact` is shown only to a caller who holds library.donations.view (blueprint 4.8)."""

    linked_books = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Donation
        fields = [
            "id", "donor_name", "donor_type", "contact", "donation_date", "books_count", "estimated_value",
            "receipt_no", "acknowledgement_sent", "acknowledgement_sent_at", "notes", "linked_books",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "receipt_no", "acknowledgement_sent_at", "linked_books", "created_at", "updated_at"]

    def validate_donor_name(self, value):
        if not value.strip():
            raise serializers.ValidationError("Donor name is required.")
        return value.strip()

    def validate_books_count(self, value):
        if value < 1:
            raise serializers.ValidationError("Enter at least one book.")
        return value

    def to_representation(self, instance):
        data = super().to_representation(instance)
        user = getattr(self.context.get("request"), "user", None)
        if user is None or not user.has_permission_code(DONATIONS_VIEW_CODE):
            data.pop("contact", None)
        return data


class BudgetInputSerializer(serializers.Serializer):
    academic_year = serializers.PrimaryKeyRelatedField(queryset=AcademicYear.objects.all())
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))

    def validate_academic_year(self, value):
        if value.school_id != _school_id(self):
            raise serializers.ValidationError("Selected academic year does not belong to your school.")
        return value


class BookRequestSerializer(LibraryModelSerializer):
    requested_by_name = serializers.SerializerMethodField()
    class_name = serializers.CharField(source="school_class.name", read_only=True, default="")
    section_name = serializers.CharField(source="section.name", read_only=True, default="")
    reviewed_by_name = serializers.SerializerMethodField()
    linked_book_title = serializers.CharField(source="linked_book.title", read_only=True, default="")

    class Meta:
        model = BookRequest
        fields = [
            "id", "title", "notes", "status", "requested_by", "requested_by_name", "school_class", "class_name",
            "section", "section_name", "reviewed_by", "reviewed_by_name", "reviewed_at", "review_note",
            "linked_book", "linked_book_title", "created_at", "updated_at",
        ]
        read_only_fields = fields

    @staticmethod
    def _name(user):
        if user is None:
            return ""
        return (user.get_full_name() or user.get_username()).strip()

    def get_requested_by_name(self, obj):
        return self._name(obj.requested_by)

    def get_reviewed_by_name(self, obj):
        return self._name(obj.reviewed_by)


class BookRequestReviewSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=[value for value in BookRequest.STATUS_CHOICES if value[0] != BookRequest.STATUS_PENDING]
    )
    note = serializers.CharField(required=False, allow_blank=True, max_length=1000, default="")
    linked_book = serializers.PrimaryKeyRelatedField(queryset=Book.objects.all(), required=False, allow_null=True)

    def validate_linked_book(self, value):
        if value is not None and value.school_id != _school_id(self):
            raise serializers.ValidationError("Selected title does not belong to your school.")
        return value
