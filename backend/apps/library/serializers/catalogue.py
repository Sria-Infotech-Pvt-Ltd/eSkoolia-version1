import re
from datetime import date

from rest_framework import serializers

from apps.library.exceptions import LibraryCategoryInactive
from apps.library.models import Book, BookCategory, BookCopy
from apps.library.services.catalogue import availability_status
from apps.library.services.codes import CATEGORY_CODE_PATTERN
from apps.library.services.numbering import derive_category_code

from .base import AUDIT_FIELDS, AUDIT_READ_ONLY, LibraryModelSerializer

COLOR_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{0,23}$")
MAX_COPIES_PER_REQUEST = 500


class BookCategorySerializer(LibraryModelSerializer):
    title_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = BookCategory
        fields = [
            "id", "school", "name", "code", "color_key", "description", "is_active", "title_count",
            "created_at", "updated_at", *AUDIT_FIELDS,
        ]
        read_only_fields = AUDIT_READ_ONLY
        extra_kwargs = {"code": {"required": False, "allow_blank": True}, "color_key": {"required": False}}

    def _others(self):
        qs = BookCategory.objects.filter(school_id=self.request_school_id())
        return qs.exclude(pk=self.instance.pk) if self.instance else qs

    def validate_name(self, value):
        value = " ".join(value.split())
        if self._others().filter(name__iexact=value).exists():
            raise serializers.ValidationError("A category with this name already exists.")
        return value

    def validate_code(self, value):
        value = value.strip().upper()
        if not value:
            return ""
        if not CATEGORY_CODE_PATTERN.match(value):
            raise serializers.ValidationError("Use 1 to 8 letters or digits.")
        if self._others().filter(code=value).exists():
            raise serializers.ValidationError("This code is already used by another category.")
        return value

    def validate_color_key(self, value):
        if value and not COLOR_KEY_PATTERN.match(value):
            raise serializers.ValidationError("Use a design token key such as 'rose', not a colour value.")
        return value

    def validate(self, attrs):
        new_code = attrs.get("code")
        if self.instance and new_code and new_code != self.instance.code and self.instance.books.exists():
            raise serializers.ValidationError({"code": "The code cannot change once the category has titles."})
        return attrs

    def create(self, validated_data):
        if not validated_data.get("code"):
            validated_data["code"] = derive_category_code(validated_data["school"], validated_data["name"])
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if not validated_data.get("code"):
            validated_data.pop("code", None)  # a blank code never wipes the existing prefix
        return super().update(instance, validated_data)


class CategoryBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = BookCategory
        fields = ["id", "name", "code", "color_key"]
        read_only_fields = fields


class CopyBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = BookCopy
        fields = ["id", "code", "status", "condition"]
        read_only_fields = fields


class BookListSerializer(serializers.ModelSerializer):
    """One catalogue row. Needs a queryset from services.catalogue.annotate_copy_counts.

    ``quantity`` and ``available_quantity`` are kept as derived aliases of the copy
    counts so the legacy Books page still shows real numbers; the stored columns
    are deprecated and never written.
    """

    category = CategoryBriefSerializer(read_only=True)
    copies_total = serializers.IntegerField(read_only=True)
    copies_available = serializers.IntegerField(read_only=True)
    copies_issued = serializers.IntegerField(read_only=True)
    copies_lost = serializers.IntegerField(read_only=True)
    copies_damaged = serializers.IntegerField(read_only=True)
    copies_withdrawn = serializers.IntegerField(read_only=True)
    holds_waiting = serializers.IntegerField(read_only=True)
    quantity = serializers.IntegerField(source="copies_total", read_only=True)
    available_quantity = serializers.IntegerField(source="copies_available", read_only=True)
    availability_status = serializers.SerializerMethodField()

    class Meta:
        model = Book
        fields = [
            "id", "accession_code", "call_number", "title", "edition", "part_label", "author", "category",
            "isbn", "publisher", "publication_year", "language", "age_band",
            "for_students", "for_teachers", "for_staff", "format", "is_reference_only", "source",
            "cost_per_copy", "rack",
            "copies_total", "copies_available", "copies_issued", "copies_lost", "copies_damaged",
            "copies_withdrawn", "holds_waiting", "availability_status", "quantity", "available_quantity",
            "created_at",
        ]
        read_only_fields = fields

    def get_availability_status(self, obj):
        ratio = self.context.get("low_stock_ratio", "0.34")
        return availability_status(obj.copies_available, obj.copies_total, ratio)


class BookLookupSerializer(BookListSerializer):
    matched_copy = serializers.SerializerMethodField()

    class Meta(BookListSerializer.Meta):
        fields = [*BookListSerializer.Meta.fields, "matched_copy"]
        read_only_fields = fields

    def get_matched_copy(self, obj):
        copy = getattr(obj, "matched_copy", None)
        return CopyBriefSerializer(copy).data if copy else None


class BookDetailSerializer(BookListSerializer):
    copies = CopyBriefSerializer(many=True, read_only=True)

    class Meta(BookListSerializer.Meta):
        fields = [
            *BookListSerializer.Meta.fields,
            "school", "vendor_name", "donor_name", "remarks", "copies", "updated_at", *AUDIT_FIELDS,
        ]
        read_only_fields = fields

    created_by_name = serializers.CharField(source="created_by.get_full_name", read_only=True, default=None)
    updated_by_name = serializers.CharField(source="updated_by.get_full_name", read_only=True, default=None)


class BookWriteSerializer(LibraryModelSerializer):
    """The accession wizard. Input only; responses use BookDetailSerializer."""

    copies_count = serializers.IntegerField(write_only=True, required=False, min_value=1, max_value=MAX_COPIES_PER_REQUEST)
    condition = serializers.ChoiceField(choices=BookCopy.CONDITION_CHOICES, write_only=True, required=False)

    class Meta:
        model = Book
        fields = [
            "id", "title", "author", "isbn", "publisher", "publication_year", "language", "category",
            "age_band", "for_students", "for_teachers", "for_staff", "format", "is_reference_only",
            "cost_per_copy", "edition", "part_label", "source", "vendor_name", "donor_name", "rack",
            "remarks", "call_number", "copies_count", "condition",
        ]
        read_only_fields = ["id"]
        extra_kwargs = {
            "author": {"required": False},
            "edition": {"required": False},
            "part_label": {"required": False},
            "category": {"required": False, "allow_null": True},
            "call_number": {"required": False},
        }

    def to_internal_value(self, data):
        if self.instance is not None and hasattr(data, "keys") and "accession_code" in data:
            raise serializers.ValidationError({"accession_code": "The accession code cannot be changed."})
        return super().to_internal_value(data)

    def validate_category(self, value):
        if value is not None and value.school_id != self.request_school_id():
            raise serializers.ValidationError("Selected category does not belong to your school.")
        return value

    def validate_publication_year(self, value):
        if value is not None and not (1000 <= value <= date.today().year + 1):
            raise serializers.ValidationError("Enter a valid year.")
        return value

    def _merged(self, attrs, name, default):
        if name in attrs:
            return attrs[name]
        return getattr(self.instance, name) if self.instance is not None else default

    def validate(self, attrs):
        creating = self.instance is None
        missing = {}
        if creating and attrs.get("category") is None:
            missing["category"] = "Category is required."
        if not creating and "category" in attrs and attrs["category"] is None:
            missing["category"] = "A title must keep a category."
        if creating and "copies_count" not in attrs:
            missing["copies_count"] = "This field is required."
        if missing:
            raise serializers.ValidationError(missing)

        category = attrs.get("category")
        if category is not None and not category.is_active and (creating or category.pk != self.instance.category_id):
            raise LibraryCategoryInactive()

        if not any(self._merged(attrs, flag, True) for flag in ("for_students", "for_teachers", "for_staff")):
            raise serializers.ValidationError({"for_students": "Select at least one reader group."})

        identity = {name: self._merged(attrs, name, "") for name in ("title", "author", "edition", "part_label")}
        clash = Book.objects.filter(school_id=self.request_school_id(), **identity)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(
                {"title": "A title with the same author, edition and part already exists. Add copies to it instead."}
            )
        return attrs


class BookCopySerializer(LibraryModelSerializer):
    """A copy. Only `condition` can be written; status moves through services."""

    book_title = serializers.CharField(source="book.title", read_only=True)
    book_accession_code = serializers.CharField(source="book.accession_code", read_only=True)

    class Meta:
        model = BookCopy
        fields = [
            "id", "school", "book", "book_title", "book_accession_code", "code", "status", "condition",
            "last_verified_on", "withdrawn_reason", "created_at", "updated_at", *AUDIT_FIELDS,
        ]
        read_only_fields = [name for name in fields if name != "condition"]

    def to_internal_value(self, data):
        if hasattr(data, "keys"):
            extra = sorted(set(data.keys()) - {"condition"})
            if extra:
                raise serializers.ValidationError({name: "This field cannot be edited here." for name in extra})
        return super().to_internal_value(data)


class AddCopiesSerializer(serializers.Serializer):
    count = serializers.IntegerField(min_value=1, max_value=MAX_COPIES_PER_REQUEST)
    condition = serializers.ChoiceField(choices=BookCopy.CONDITION_CHOICES, required=False, default=BookCopy.CONDITION_NEW)


class BulkImportSerializer(serializers.Serializer):
    """Rows are free-form on purpose: the service reports a per-row error instead of failing the request."""

    rows = serializers.ListField(child=serializers.JSONField(allow_null=True), min_length=1, max_length=500)


class BulkImportCommitSerializer(BulkImportSerializer):
    client_batch_id = serializers.UUIDField()


class WithdrawCopySerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500)
