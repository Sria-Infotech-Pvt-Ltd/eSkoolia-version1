from rest_framework import serializers

from apps.library.models import Book, BookCategory

from .base import AUDIT_FIELDS, AUDIT_READ_ONLY, LibraryModelSerializer


class BookCategorySerializer(LibraryModelSerializer):
    class Meta:
        model = BookCategory
        fields = ["id", "school", "name", "description", "is_active", "created_at", *AUDIT_FIELDS]
        read_only_fields = AUDIT_READ_ONLY


class BookSerializer(LibraryModelSerializer):
    class Meta:
        model = Book
        fields = [
            "id",
            "school",
            "category",
            "title",
            "author",
            "isbn",
            "publisher",
            "quantity",
            "available_quantity",
            "rack",
            "created_at",
            "updated_at",
            *AUDIT_FIELDS,
        ]
        read_only_fields = AUDIT_READ_ONLY

    def validate(self, attrs):
        category = attrs.get("category") or getattr(self.instance, "category", None)
        quantity = attrs.get("quantity")
        available = attrs.get("available_quantity")
        school_id = self.request_school_id()

        if school_id and category and category.school_id != school_id:
            raise serializers.ValidationError({"category": "Selected category does not belong to your school."})
        if quantity is not None and available is not None and available > quantity:
            raise serializers.ValidationError({"available_quantity": "Available quantity cannot exceed total quantity."})
        return attrs
