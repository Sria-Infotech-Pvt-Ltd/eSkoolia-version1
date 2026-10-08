from rest_framework import serializers

from apps.library.models import StockAudit, StockAuditItem, Visit
from apps.library.models.periods import DAYS, PeriodSlot
from apps.library.services import periods as period_service

from .base import LibraryModelSerializer


class PeriodSlotSerializer(LibraryModelSerializer):
    class_name = serializers.CharField(source="school_class.name", read_only=True)
    section_name = serializers.CharField(source="section.name", read_only=True, default="")
    period_name = serializers.CharField(source="period.period", read_only=True)
    start_time = serializers.TimeField(source="period.start_time", format="%H:%M", read_only=True)
    end_time = serializers.TimeField(source="period.end_time", format="%H:%M", read_only=True)
    supervisor_name = serializers.SerializerMethodField()

    class Meta:
        model = PeriodSlot
        fields = [
            "id", "school_class", "class_name", "section", "section_name", "day", "period", "period_name",
            "start_time", "end_time", "room_label", "supervisor", "supervisor_name", "is_active", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "class_name", "section_name", "period_name", "start_time", "end_time", "supervisor_name",
            "created_at", "updated_at",
        ]
        extra_kwargs = {
            "section": {"required": False, "allow_null": True},
            "supervisor": {"required": False, "allow_null": True},
            "room_label": {"required": False},
        }

    def get_supervisor_name(self, obj):
        return period_service.person_name_of(obj.supervisor)

    def _school_check(self, value, label):
        if value is not None and value.school_id != self.request_school_id():
            raise serializers.ValidationError(f"Selected {label} does not belong to your school.")
        return value

    def validate_school_class(self, value):
        return self._school_check(value, "class")

    def validate_period(self, value):
        self._school_check(value, "period")
        if value.period_type != "class" or value.is_break:
            raise serializers.ValidationError("Choose a class period, not an exam period or a break.")
        return value

    def validate_supervisor(self, value):
        return self._school_check(value, "supervisor")

    def validate_day(self, value):
        if value not in DAYS:
            raise serializers.ValidationError("Use Mon, Tue, Wed, Thu, Fri or Sat.")
        return value

    def validate_room_label(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Room name is required.")
        return value

    def _merged(self, attrs, name):
        if name in attrs:
            return attrs[name]
        return getattr(self.instance, name) if self.instance is not None else None

    def validate(self, attrs):
        school_class, section = self._merged(attrs, "school_class"), self._merged(attrs, "section")
        if section is not None and school_class is not None and section.school_class_id != school_class.pk:
            raise serializers.ValidationError({"section": "This section does not belong to the selected class."})
        day, period = self._merged(attrs, "day"), self._merged(attrs, "period")
        room = self._merged(attrs, "room_label") or "Main Library"
        school_id = self.request_school_id()
        if None not in (school_class, day, period) and school_id is not None and attrs.keys() & {
            "school_class", "section", "day", "period", "room_label", "is_active"
        }:
            clash = period_service.find_conflict(
                school_id, school_class=school_class, section=section, day=day, period=period,
                room_label=room, exclude_pk=self.instance.pk if self.instance else None,
            )
            active = attrs.get("is_active", self.instance.is_active if self.instance else True)
            # A switched-off slot only holds its room and its exact place; it cannot overlap on class time.
            if clash is not None and (clash[0] in ("room", "twin") or active):
                period_service.raise_conflict(*clash)
        return attrs


class CheckInSerializer(serializers.Serializer):
    card_no = serializers.CharField(required=False, allow_blank=False, max_length=40)
    member = serializers.IntegerField(required=False, min_value=1)
    period_slot = serializers.IntegerField(required=False, min_value=1, allow_null=True)
    method = serializers.ChoiceField(choices=Visit.METHOD_CHOICES, required=False, default=Visit.METHOD_CARD_TAP)

    def validate(self, attrs):
        if not attrs.get("card_no") and not attrs.get("member"):
            raise serializers.ValidationError({"card_no": "Give a card number or a member."})
        return attrs


class StockAuditSerializer(LibraryModelSerializer):
    progress = serializers.SerializerMethodField()

    class Meta:
        model = StockAudit
        fields = [
            "id", "scope_rack", "status", "started_at", "finished_at", "total_in_scope", "accounted_count",
            "missing_count", "value_at_risk", "progress", "created_at", "updated_at",
        ]
        read_only_fields = fields

    def get_progress(self, obj):
        total = getattr(obj, "items_total", None)
        if total is None:  # not annotated: frozen counts after finish
            return {"found": obj.accounted_count, "total": obj.total_in_scope}
        return {"found": obj.items_found, "total": total}


class StockAuditStartSerializer(serializers.Serializer):
    rack = serializers.CharField(required=False, allow_blank=True, max_length=50, default="")


class StockAuditItemSerializer(LibraryModelSerializer):
    copy_code = serializers.CharField(source="copy.code", read_only=True)
    copy_status = serializers.CharField(source="copy.status", read_only=True)
    book = serializers.IntegerField(source="copy.book_id", read_only=True)
    book_title = serializers.CharField(source="copy.book.title", read_only=True)
    rack = serializers.CharField(source="copy.book.rack", read_only=True)
    cost_per_copy = serializers.DecimalField(source="copy.book.cost_per_copy", max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = StockAuditItem
        fields = ["id", "copy", "copy_code", "copy_status", "book", "book_title", "rack", "cost_per_copy", "found", "verified_at"]
        read_only_fields = fields


class ItemFoundSerializer(serializers.Serializer):
    found = serializers.BooleanField()


class BulkMarkSerializer(ItemFoundSerializer):
    item_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), min_length=1, max_length=2000)


class MarkLostSerializer(serializers.Serializer):
    notes = serializers.CharField(required=False, allow_blank=True, max_length=1000, default="")
