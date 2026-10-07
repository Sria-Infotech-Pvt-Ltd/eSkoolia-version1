from decimal import Decimal

from rest_framework import serializers

from apps.core.models import Class
from apps.library.models import LibrarySettings

from .base import AUDIT_FIELDS, AUDIT_READ_ONLY, LibraryModelSerializer

COUNTER_FIELDS = ["po_sequence", "donation_receipt_sequence"]
_NON_NEGATIVE_AMOUNT = {"min_value": Decimal(0)}


class LibrarySettingsSerializer(LibraryModelSerializer):
    junior_class_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), required=False)

    class Meta:
        model = LibrarySettings
        fields = [
            "id",
            "school",
            "fine_per_day",
            "fine_grace_days",
            "fine_cap",
            "cap_fine_at_replacement_cost",
            "limit_student",
            "limit_teacher",
            "limit_staff",
            "student_min_due_days",
            "flat_loan_days",
            "max_renewals",
            "replacement_processing_fee",
            "replacement_default_cost",
            "registration_fee_junior",
            "registration_fee_senior",
            "junior_class_ids",
            "notify_sms_email_enabled",
            "low_stock_ratio",
            "unscanned_flag_minutes",
            "undo_return_minutes",
            *COUNTER_FIELDS,
            "created_at",
            "updated_at",
            *AUDIT_FIELDS,
        ]
        read_only_fields = [*AUDIT_READ_ONLY, *COUNTER_FIELDS]
        extra_kwargs = {
            "fine_per_day": _NON_NEGATIVE_AMOUNT,
            "fine_cap": _NON_NEGATIVE_AMOUNT,
            "replacement_processing_fee": _NON_NEGATIVE_AMOUNT,
            "replacement_default_cost": _NON_NEGATIVE_AMOUNT,
            "registration_fee_junior": _NON_NEGATIVE_AMOUNT,
            "registration_fee_senior": _NON_NEGATIVE_AMOUNT,
            "low_stock_ratio": {"min_value": Decimal(0), "max_value": Decimal(1)},
        }

    def validate_junior_class_ids(self, value):
        ids = list(dict.fromkeys(value))
        school_id = self.request_school_id()
        found = set(Class.objects.filter(school_id=school_id, id__in=ids).values_list("id", flat=True))
        missing = [class_id for class_id in ids if class_id not in found]
        if missing:
            raise serializers.ValidationError("Every class must belong to your school.")
        return ids
