import re

from rest_framework import serializers

from apps.access_control.models import Role
from apps.core.models import Holiday
from apps.hr.models import LeaveType
from apps.tenancy.models import SchoolTenant

from .models import (
    CarryForwardLog,
    DocumentBrandingSettings,
    LeaveBalance,
    SchoolAttendancePolicy,
    SchoolPolicyDocument,
    SchoolSMTPSettings,
    SettingsAuditLog,
    StaffHolidayExclusion,
)


class SchoolInfoSerializer(serializers.ModelSerializer):
    """Settings > School Info. Edits SchoolTenant (via school.tenant_record),
    auto-filled from whatever was set at School Tenancy > Add School."""

    school_id = serializers.IntegerField(source="school.id", read_only=True)
    school_name = serializers.CharField(source="school.name", read_only=True)
    school_code = serializers.CharField(source="school.code", read_only=True)

    class Meta:
        model = SchoolTenant
        fields = [
            "school_id", "school_name", "school_code",
            "board", "school_type", "medium_of_instruction", "year_established", "motto",
            "principal_name", "principal_email", "principal_phone",
            "school_phone", "school_email", "website",
            "campus_address", "city", "state", "region", "pin_code", "country",
            "latitude", "longitude", "geofence_radius_meters",
            "affiliation_number", "udise_code", "gstin", "pan",
            "logo_url", "brand_color",
        ]
        read_only_fields = ["school_id", "school_name", "school_code"]


class LeavePolicySerializer(serializers.ModelSerializer):
    """Settings > Leave Policy — the primary place leave types are created,
    configured, and (for non-built-in types) deleted, matching Royal HRMS's
    own Settings-owned leave-policy flow. HR's own /hr/leave-types/ screen
    still works against the same underlying LeaveType rows (allocation via
    LeaveDefine is unaffected), but Settings is now where a school actually
    designs its leave policy."""

    class Meta:
        model = LeaveType
        fields = ["id", "school", "name", "max_days_per_year", "is_paid", "is_active", "is_builtin"] + LeaveType.POLICY_FIELDS
        read_only_fields = ["id", "school", "is_builtin"]

    def validate_name(self, value):
        normalized = (value or "").strip()
        if not normalized:
            raise serializers.ValidationError("Leave type name is required.")
        request = self.context.get("request")
        school_id = getattr(getattr(request, "user", None), "school_id", None)
        if school_id:
            qs = LeaveType.objects.filter(school_id=school_id, name__iexact=normalized)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError("A leave type with this name already exists.")
        return normalized


class LeaveBalanceSerializer(serializers.ModelSerializer):
    staff_name = serializers.SerializerMethodField()
    leave_type_name = serializers.CharField(source="leave_type.name", read_only=True)
    available_days = serializers.DecimalField(max_digits=5, decimal_places=1, read_only=True)

    class Meta:
        model = LeaveBalance
        fields = [
            "id", "school", "staff", "staff_name", "leave_type", "leave_type_name", "year",
            "total_days", "used_days", "carried_forward", "carry_forward_expiry_date", "available_days",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "school", "created_at", "updated_at"]

    def get_staff_name(self, obj):
        return str(obj.staff)

    def validate_staff(self, value):
        request = self.context.get("request")
        if request and request.user and request.user.school_id and value.school_id != request.user.school_id:
            raise serializers.ValidationError("You can only manage balances for your own school's staff.")
        return value

    def validate_leave_type(self, value):
        request = self.context.get("request")
        if request and request.user and request.user.school_id and value.school_id != request.user.school_id:
            raise serializers.ValidationError("You can only manage balances for your own school's leave types.")
        return value


class CarryForwardLogSerializer(serializers.ModelSerializer):
    executed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CarryForwardLog
        fields = [
            "id", "from_year", "to_year", "executed_by_name", "process_mode",
            "total_processed", "total_skipped", "total_failed", "is_completed", "created_at",
        ]

    def get_executed_by_name(self, obj):
        if not obj.executed_by_id:
            return "System"
        return obj.executed_by.get_full_name() or obj.executed_by.username


class StaffHolidayExclusionSerializer(serializers.ModelSerializer):
    holiday_name = serializers.CharField(source="holiday.name", read_only=True)
    holiday_date = serializers.DateField(source="holiday.date", read_only=True)

    class Meta:
        model = StaffHolidayExclusion
        fields = ["id", "school", "holiday", "holiday_name", "holiday_date", "reason", "created_by", "created_at"]
        read_only_fields = ["id", "school", "created_by", "created_at"]

    def validate_holiday(self, value):
        request = self.context.get("request")
        if request and request.user and request.user.school_id:
            if value.school_id != request.user.school_id:
                raise serializers.ValidationError("You can only exclude holidays belonging to your own school.")
            if value.audience != Holiday.AUDIENCE_ALL:
                raise serializers.ValidationError("Only school-wide (audience='all') holidays can be excluded for staff.")
        return value


class StaffHolidaySerializer(serializers.ModelSerializer):
    """Read-only merged staff calendar entry (apps.core.Holiday rows with
    audience in [all, staff_only] that aren't in StaffHolidayExclusion)."""

    class Meta:
        model = Holiday
        fields = ["id", "name", "date", "end_date", "holiday_type", "description", "audience", "is_optional"]


class SchoolSMTPSettingsSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    password_display = serializers.SerializerMethodField()

    class Meta:
        model = SchoolSMTPSettings
        fields = [
            "id", "school", "name", "smtp_type", "host", "port", "username", "password", "password_display",
            "use_tls", "from_email", "bcc_email", "sender_name", "priority", "receiver_email_type",
            "is_active", "updated_by", "updated_at", "created_at",
        ]
        read_only_fields = ["id", "school", "is_active", "updated_by", "updated_at", "created_at"]

    def get_password_display(self, obj):
        return "••••••••" if obj.password else ""

    def update(self, instance, validated_data):
        # Preserve the stored password if the client didn't resubmit one
        # (the raw value is never sent back to the client, so a blank
        # submission means "leave it unchanged", not "clear it").
        if not validated_data.get("password"):
            validated_data.pop("password", None)
        return super().update(instance, validated_data)


class SettingsAuditLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = SettingsAuditLog
        fields = ["id", "actor_name", "action", "object_type", "object_id", "ip_address", "created_at"]

    def get_actor_name(self, obj):
        if not obj.actor_id:
            return "System"
        return obj.actor.get_full_name() or obj.actor.username


class SchoolAttendancePolicySerializer(serializers.ModelSerializer):
    updated_by_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    applies_to_roles = serializers.PrimaryKeyRelatedField(many=True, queryset=Role.objects.all(), required=False)
    applies_to_roles_detail = serializers.SerializerMethodField()

    class Meta:
        model = SchoolAttendancePolicy
        fields = [
            "id", "school", "name", "is_default", "is_active",
            "applies_to_roles", "applies_to_roles_detail",
            "shift_start", "shift_end", "grace_period_minutes", "missing_punch_grace_minutes",
            "break_duration_minutes", "min_hours_full_day", "min_hours_half_day", "early_exit_grace_minutes",
            "ot_threshold_hours", "ot_multiplier_regular", "ot_multiplier_holiday",
            "late_marks_per_lop", "lop_deduction_unit",
            "weekly_off_mon", "weekly_off_tue", "weekly_off_wed", "weekly_off_thu",
            "weekly_off_fri", "weekly_off_sat", "weekly_off_sun",
            "absence_alert_enabled", "absence_alert_after_days", "absence_alert_notify_whom",
            "created_by", "created_by_name", "updated_by", "updated_by_name", "updated_at", "created_at",
        ]
        read_only_fields = ["id", "school", "is_default", "created_by", "updated_by", "updated_at", "created_at"]

    def validate_name(self, value):
        normalized = (value or "").strip()
        if not normalized:
            raise serializers.ValidationError("Policy name is required.")
        if not re.fullmatch(r"[A-Za-z\s'.-]+", normalized):
            raise serializers.ValidationError("Policy name can only contain letters, spaces, and '.- characters.")
        return normalized

    def validate_applies_to_roles(self, roles):
        request = self.context.get("request")
        school_id = getattr(getattr(request, "user", None), "school_id", None)
        for role in roles:
            if school_id and role.school_id not in (None, school_id):
                raise serializers.ValidationError("One or more roles do not belong to your school.")
        return roles

    def _display_name(self, user):
        if not user:
            return None
        return user.get_full_name() or user.username

    def get_updated_by_name(self, obj):
        return self._display_name(obj.updated_by)

    def get_created_by_name(self, obj):
        return self._display_name(obj.created_by)

    def get_applies_to_roles_detail(self, obj):
        return [{"id": r.id, "name": r.name} for r in obj.applies_to_roles.all()]


class SchoolPolicyDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = SchoolPolicyDocument
        fields = [
            "id", "school", "title", "category", "file", "file_name", "file_type", "file_size",
            "uploaded_by", "is_active", "uploaded_at", "updated_at",
        ]
        # is_active is read-only: DRF's BooleanField treats a field absent from
        # multipart/form-data as an explicit False (default_empty_html), which
        # would silently override the model's default=True on every upload
        # otherwise — clients should never set this directly; only the
        # viewset's soft-delete path (perform_destroy) flips it.
        read_only_fields = [
            "id", "school", "file_name", "file_type", "file_size", "uploaded_by", "is_active",
            "uploaded_at", "updated_at",
        ]

    def validate_file(self, value):
        if value.size > SchoolPolicyDocument.MAX_FILE_SIZE:
            raise serializers.ValidationError(
                f"File exceeds the {SchoolPolicyDocument.MAX_FILE_SIZE // (1024*1024)}MB limit."
            )
        content_type = getattr(value, "content_type", None)
        if content_type and content_type not in SchoolPolicyDocument.ALLOWED_MIME_TYPES:
            raise serializers.ValidationError(
                f"File type '{content_type}' is not allowed. Allowed: PDF, Word, Excel, PowerPoint, JPG, PNG, TXT, CSV."
            )
        return value

    def create(self, validated_data):
        f = validated_data.get("file")
        if f is not None:
            validated_data["file_name"] = f.name
            validated_data["file_size"] = f.size
            content_type = getattr(f, "content_type", None)
            validated_data["file_type"] = SchoolPolicyDocument.MIME_TO_TYPE.get(content_type, "")
        return super().create(validated_data)


class DocumentBrandingSettingsSerializer(serializers.ModelSerializer):
    """The settings half of Document Branding — mode/style/color and the
    per-document declaration texts. The letterhead file itself is managed
    only through DocumentBrandingUploadLetterheadView (a dedicated
    multipart endpoint), not through this serializer, matching the
    SchoolPolicyDocument pattern of keeping file uploads on their own path."""

    letterhead_file_name = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = DocumentBrandingSettings
        fields = [
            "id",
            "header_mode",
            "header_style",
            "header_text_color",
            "accent_color",
            "header_size",
            "logo_position",
            "show_divider",
            "divider_style",
            "show_watermark",
            "watermark_text",
            "show_logo",
            "letterhead_source_file_type",
            "letterhead_file_name",
            "declaration_student_verification",
            "declaration_staff_onboarding",
            "declaration_payslip",
            "declaration_fee_receipt",
            "declaration_transfer_certificate",
            "declaration_admission",
            "updated_by_name",
            "updated_at",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "letterhead_source_file_type",
            "letterhead_file_name",
            "updated_by_name",
            "updated_at",
            "created_at",
        ]

    def get_letterhead_file_name(self, obj):
        return obj.letterhead_source_file.name.rsplit("/", 1)[-1] if obj.letterhead_source_file else None

    def get_updated_by_name(self, obj):
        if not obj.updated_by:
            return None
        return obj.updated_by.get_full_name() or obj.updated_by.username

    def _validate_hex_color(self, value, field_name="color"):
        import re
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", value or ""):
            raise serializers.ValidationError("Must be a hex color like #1A1A2E.")
        return value

    def validate_header_text_color(self, value):
        return self._validate_hex_color(value)

    def validate_accent_color(self, value):
        return self._validate_hex_color(value)

    def validate_header_mode(self, value):
        if value == DocumentBrandingSettings.MODE_UPLOADED:
            instance = self.instance
            has_letterhead = instance and instance.letterhead_rendered_image
            if not has_letterhead:
                raise serializers.ValidationError(
                    "Upload a letterhead first before switching to uploaded mode."
                )
        return value
