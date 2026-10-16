from django.utils.html import strip_tags
from django.db import transaction
import re
from datetime import date
from rest_framework import serializers
from .models import (
    Guardian,
    PromotionAuditLog,
    PromotionBatch,
    PromotionRecord,
    Student,
    StudentCategory,
    StudentDocument,
    StudentGroup,
    StudentGuardian,
    StudentMultiClassRecord,
    StudentRecordAudit,
    StudentSubjectAssignment,
    StudentPromotionHistory,
    StudentTransferHistory,
)


class PincodeLookupQuerySerializer(serializers.Serializer):
    pincode = serializers.CharField()

    def validate_pincode(self, value):
        pincode = str(value or "").strip()
        if not re.fullmatch(r"\d{6}", pincode):
            raise serializers.ValidationError("Pincode must be exactly 6 digits.")
        return pincode


class StudentCategorySerializer(serializers.ModelSerializer):
    NAME_PATTERN = re.compile(r"^[A-Za-z0-9 ]+$")
    students_count = serializers.IntegerField(read_only=True)

    def validate_name(self, value):
        name = str(value or "").strip()
        if not name:
            raise serializers.ValidationError("Category name is required.")
        if len(name) < 2:
            raise serializers.ValidationError("Category name must be at least 2 characters.")
        if len(name) > 100:
            raise serializers.ValidationError("Category name must not exceed 100 characters.")
        if not self.NAME_PATTERN.fullmatch(name):
            raise serializers.ValidationError("Category name may contain only letters, numbers, and spaces.")
        if not re.search(r"[A-Za-z0-9]", name):
            raise serializers.ValidationError("Category name must include at least one letter or number.")

        request = self.context.get("request")
        school_id = getattr(getattr(request, "user", None), "school_id", None)
        if school_id:
            queryset = StudentCategory.objects.filter(school_id=school_id, is_deleted=False, name__iexact=name)
            if self.instance:
                queryset = queryset.exclude(id=self.instance.id)
            if queryset.exists():
                raise serializers.ValidationError("Category name already exists.")
        return name

    def validate_description(self, value):
        description = strip_tags(str(value or "")).strip()
        if len(description) > 500:
            raise serializers.ValidationError("Description must not exceed 500 characters.")
        return description

    def validate_code(self, value):
        code = str(value or "").strip()
        if not code:
            return None
        if not re.fullmatch(r"[A-Za-z0-9 ]+", code):
            raise serializers.ValidationError("Code may contain only letters, numbers, and spaces.")

        request = self.context.get("request")
        school_id = getattr(getattr(request, "user", None), "school_id", None)
        if school_id:
            queryset = StudentCategory.objects.filter(school_id=school_id, is_deleted=False, code__iexact=code)
            if self.instance:
                queryset = queryset.exclude(id=self.instance.id)
            if queryset.exists():
                raise serializers.ValidationError("Category code already exists.")
        return code

    def validate_status(self, value):
        status = str(value or "").strip().lower()
        if not status:
            return "active"
        if status not in {"active", "inactive"}:
            raise serializers.ValidationError("Status must be either active or inactive.")
        return status

    class Meta:
        model = StudentCategory
        fields = [
            "id",
            "school",
            "name",
            "description",
            "code",
            "status",
            "is_active",
            "is_deleted",
            "deleted_at",
            "deleted_by",
            "students_count",
            "created_at",
        ]
        read_only_fields = ["id", "school", "created_at", "is_deleted", "deleted_at", "deleted_by"]


class StudentGroupSerializer(serializers.ModelSerializer):
    students_count = serializers.IntegerField(read_only=True, default=0)

    # Club color palettes (cycled by existing club count mod 4)
    CLUB_COLORS = ["#2980b9", "#27ae60", "#f39c12", "#8e44ad"]
    CLUB_BG_COLORS = ["#e8f4fd", "#eafaf1", "#fef9e7", "#f5eefb"]
    # House color palettes (cycled by existing house count mod 4)
    HOUSE_COLORS = ["#00b894", "#6c5ce7", "#e67e22", "#2980b9"]
    HOUSE_BG_COLORS = ["#e6f9f5", "#f0eeff", "#fef3e8", "#e8f4fd"]

    def _clean_text(self, value):
        return strip_tags(str(value or "")).strip()

    def validate_name(self, value):
        name = self._clean_text(value)
        if not name:
            raise serializers.ValidationError("Group name is required.")
        if len(name) > 80:
            raise serializers.ValidationError("Group name must not exceed 80 characters.")
        if not re.search(r"[A-Za-z0-9]", name):
            raise serializers.ValidationError("Group name must include at least one valid character.")

        request = self.context.get("request")
        school_id = getattr(getattr(request, "user", None), "school_id", None)
        if school_id:
            queryset = StudentGroup.objects.filter(school_id=school_id, name__iexact=name)
            if self.instance:
                queryset = queryset.exclude(id=self.instance.id)
            if queryset.exists():
                raise serializers.ValidationError("Group name already exists")
        return name

    def validate_description(self, value):
        description = self._clean_text(value)
        if len(description) > 500:
            raise serializers.ValidationError("Description must not exceed 500 characters.")
        return description

    def create(self, validated_data):
        request = self.context.get("request")
        school_id = getattr(getattr(request, "user", None), "school_id", None)
        group_type = validated_data.get("type", "CUSTOM")

        # Auto-assign colors if not provided
        if "color" not in validated_data or not validated_data.get("color"):
            if group_type == "CLUB" and school_id:
                idx = StudentGroup.objects.filter(school_id=school_id, type="CLUB").count() % 4
                validated_data["color"] = self.CLUB_COLORS[idx]
                validated_data["bg_color"] = self.CLUB_BG_COLORS[idx]
            elif group_type == "HOUSE" and school_id:
                idx = StudentGroup.objects.filter(school_id=school_id, type="HOUSE").count() % 4
                validated_data["color"] = self.HOUSE_COLORS[idx]
                validated_data["bg_color"] = self.HOUSE_BG_COLORS[idx]

        return super().create(validated_data)

    class Meta:
        model = StudentGroup
        fields = [
            "id", "school", "name", "type", "emoji", "description",
            "color", "bg_color", "capacity", "students_count",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "school", "students_count", "created_at", "updated_at"]


class GuardianSerializer(serializers.ModelSerializer):
    def validate_phone(self, value):
        phone = str(value or "").strip()
        if not phone:
            raise serializers.ValidationError("Phone is required.")
        if not re.fullmatch(r"\d{1,12}", phone):
            raise serializers.ValidationError("Phone number must contain digits only and must not exceed 12 digits.")
        return phone

    class Meta:
        model = Guardian
        fields = [
            "id",
            "school",
            "full_name",
            "relation",
            "phone",
            "email",
            "occupation",
            "address",
            "created_at",
        ]
        read_only_fields = ["id", "school", "created_at"]


class StudentDocumentSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.CharField(source="uploaded_by.full_name", read_only=True)
    file_url = serializers.SerializerMethodField(read_only=True)
    
    class Meta:
        model = StudentDocument
        fields = [
            "id",
            "student",
            "school",
            "document_type",
            "title",
            "file",
            "file_url",
            "original_name",
            "file_size",
            "uploaded_by",
            "uploaded_by_name",
            "is_verified",
            "remarks",
            "uploaded_at",
            "updated_at",
        ]
        read_only_fields = ["id", "school", "file_size", "uploaded_by", "uploaded_at", "updated_at"]

    def get_file_url(self, obj):
        if obj.file:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.file.url)
            return obj.file.url
        return None

    def validate_file(self, value):
        # Validate file type
        allowed_extensions = [".pdf", ".jpg", ".jpeg", ".png"]
        file_name = value.name.lower()
        if not any(file_name.endswith(ext) for ext in allowed_extensions):
            raise serializers.ValidationError(
                "Only PDF, JPG, JPEG, and PNG files are allowed."
            )
        
        # Validate file size (5MB = 5242880 bytes)
        if value.size > 5242880:
            raise serializers.ValidationError("File size must be less than 5MB.")
        
        return value

    def create(self, validated_data):
        file_obj = validated_data.get("file")
        if file_obj:
            validated_data["file_size"] = file_obj.size
            validated_data["original_name"] = file_obj.name
        
        request = self.context.get("request")
        if request and request.user:
            validated_data["uploaded_by"] = request.user
        
        return super().create(validated_data)


class StudentTransferHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentTransferHistory
        fields = ["id", "student", "from_school", "to_school", "note", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate(self, attrs):
        request = self.context.get("request")
        school_id = getattr(getattr(request, "user", None), "school_id", None)
        student = attrs.get("student") or getattr(self.instance, "student", None)
        if school_id and student and student.school_id != school_id:
            raise serializers.ValidationError({"student": "Student not found."})
        return attrs


class StudentRecordAuditSerializer(serializers.ModelSerializer):
    student_name = serializers.SerializerMethodField()
    student_admission_no = serializers.CharField(source="student.admission_no", read_only=True, allow_null=True)
    performed_by_name = serializers.SerializerMethodField()

    def get_student_name(self, obj):
        if not obj.student:
            return "-"
        return f"{obj.student.first_name} {obj.student.last_name}".strip()

    def get_performed_by_name(self, obj):
        if not obj.performed_by:
            return "-"
        full_name = obj.performed_by.get_full_name() if hasattr(obj.performed_by, "get_full_name") else ""
        return full_name or getattr(obj.performed_by, "email", "-")

    class Meta:
        model = StudentRecordAudit
        fields = [
            "id",
            "student",
            "student_name",
            "student_admission_no",
            "action",
            "performed_by",
            "performed_by_name",
            "note",
            "metadata",
            "created_at",
        ]
        read_only_fields = fields


class StudentPromotionHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentPromotionHistory
        fields = [
            "id",
            "student",
            "from_class",
            "from_section",
            "to_class",
            "to_section",
            "from_academic_year",
            "to_academic_year",
            "note",
            "promoted_by",
            "promoted_at",
        ]
        read_only_fields = ["id", "promoted_by", "promoted_at"]


class PromotionRecordSerializer(serializers.ModelSerializer):
    student_name = serializers.SerializerMethodField()
    admission_no = serializers.CharField(source="student.admission_no", read_only=True)
    from_class_name = serializers.CharField(source="from_class.name", read_only=True)
    from_section_name = serializers.CharField(source="from_section.name", read_only=True)
    to_class_name = serializers.CharField(source="to_class.name", read_only=True)
    to_section_name = serializers.CharField(source="to_section.name", read_only=True)
    failed_subject_ids = serializers.PrimaryKeyRelatedField(
        source="failed_subjects",
        many=True,
        read_only=True,
    )

    class Meta:
        model = PromotionRecord
        fields = [
            "id",
            "student",
            "student_name",
            "admission_no",
            "from_class",
            "from_class_name",
            "from_section",
            "from_section_name",
            "to_class",
            "to_class_name",
            "to_section",
            "to_section_name",
            "status",
            "retention_reason",
            "failed_subject_ids",
            "notes",
            "ai_recommendation",
            "decision_made_at",
        ]
        read_only_fields = ["id", "decision_made_at"]

    def get_student_name(self, obj):
        return f"{obj.student.first_name} {obj.student.last_name}".strip()


class PromotionBatchSerializer(serializers.ModelSerializer):
    academic_year_name = serializers.CharField(source="academic_year.name", read_only=True)
    target_year_name = serializers.CharField(source="target_year.name", read_only=True)
    created_by_name = serializers.SerializerMethodField()
    kpi = serializers.SerializerMethodField()
    records = PromotionRecordSerializer(many=True, read_only=True)

    class Meta:
        model = PromotionBatch
        fields = [
            "id",
            "academic_year",
            "academic_year_name",
            "target_year",
            "target_year_name",
            "status",
            "created_by_name",
            "created_at",
            "confirmed_at",
            "total_students",
            "promoted_count",
            "retained_count",
            "kpi",
            "records",
        ]

    def get_created_by_name(self, obj):
        if not obj.created_by:
            return "-"
        return obj.created_by.get_full_name() or obj.created_by.email

    def get_kpi(self, obj):
        total = max(0, obj.total_students)
        promoted = max(0, obj.promoted_count)
        retained = max(0, obj.retained_count)
        pending = max(0, total - (promoted + retained))
        completion = round(((promoted + retained) / total) * 100, 1) if total else 0
        return {
            "total": total,
            "promoted": promoted,
            "not_promoted": retained,
            "pending": pending,
            "completion_percentage": completion,
        }


class PromotionBatchCreateSerializer(serializers.Serializer):
    academic_year = serializers.IntegerField(min_value=1)
    target_year = serializers.IntegerField(min_value=1)

    def validate(self, attrs):
        from apps.core.models import AcademicYear

        request = self.context.get("request")
        user = getattr(request, "user", None)
        school_id = getattr(user, "school_id", None)

        academic_year_id = attrs.get("academic_year")
        target_year_id = attrs.get("target_year")
        if academic_year_id == target_year_id:
            raise serializers.ValidationError({"target_year": "Target year must be different from current academic year."})

        year_qs = AcademicYear.objects.filter(id=academic_year_id)
        target_qs = AcademicYear.objects.filter(id=target_year_id)
        if user and school_id:
            year_qs = year_qs.filter(school_id=school_id)
            target_qs = target_qs.filter(school_id=school_id)

        year = year_qs.first()
        target = target_qs.first()
        if not year:
            raise serializers.ValidationError({"academic_year": "Invalid academic year."})
        if not target:
            raise serializers.ValidationError({"target_year": "Invalid target academic year."})

        attrs["academic_year_obj"] = year
        attrs["target_year_obj"] = target
        return attrs


class PromotionRecordUpdateSerializer(serializers.Serializer):
    record_id = serializers.IntegerField(min_value=1)
    status = serializers.ChoiceField(choices=[value for value, _ in PromotionRecord.STATUS_CHOICES])
    retention_reason = serializers.ChoiceField(
        choices=[value for value, _ in PromotionRecord.REASON_CHOICES],
        required=False,
        allow_blank=True,
    )
    failed_subject_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), required=False)
    notes = serializers.CharField(required=False, allow_blank=True)
    to_class = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    to_section = serializers.IntegerField(min_value=1, required=False, allow_null=True)


class PromotionBulkUpdateSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["promote", "skip", "reset"])
    scope = serializers.ChoiceField(choices=["class", "section", "selection"])
    class_id = serializers.IntegerField(min_value=1, required=False)
    section_id = serializers.IntegerField(min_value=1, required=False)
    record_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), required=False)

    def validate(self, attrs):
        scope = attrs.get("scope")
        if scope == "class" and not attrs.get("class_id"):
            raise serializers.ValidationError({"class_id": "class_id is required when scope is class."})
        if scope == "section" and not attrs.get("section_id"):
            raise serializers.ValidationError({"section_id": "section_id is required when scope is section."})
        if scope == "selection" and not attrs.get("record_ids"):
            raise serializers.ValidationError({"record_ids": "record_ids is required when scope is selection."})
        return attrs


class PromotionAiRequestSerializer(serializers.Serializer):
    record_id = serializers.IntegerField(min_value=1)
    reason = serializers.ChoiceField(
        choices=[value for value, _ in PromotionRecord.REASON_CHOICES],
        required=False,
        allow_blank=True,
    )


class PromotionAuditLogSerializer(serializers.ModelSerializer):
    performed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PromotionAuditLog
        fields = ["id", "batch", "action", "performed_by", "performed_by_name", "record", "details", "ip_address", "created_at"]
        read_only_fields = fields

    def get_performed_by_name(self, obj):
        if not obj.performed_by:
            return "-"
        return obj.performed_by.get_full_name() or obj.performed_by.email


class StudentPromoteRequestSerializer(serializers.Serializer):
    student_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), allow_empty=False)
    to_class = serializers.IntegerField(min_value=1)
    to_section = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    to_academic_year = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        from apps.core.models import AcademicYear, Class, Section

        request = self.context.get("request")
        user = getattr(request, "user", None)
        school_id = getattr(user, "school_id", None)

        class_id = attrs.get("to_class")
        section_id = attrs.get("to_section")
        year_id = attrs.get("to_academic_year")
        student_ids = attrs.get("student_ids", [])

        # Remove accidental duplicates while preserving order.
        attrs["student_ids"] = list(dict.fromkeys(student_ids))

        class_qs = Class.objects.filter(id=class_id)
        if user and school_id:
            class_qs = class_qs.filter(school_id=school_id)
        if not class_qs.exists():
            raise serializers.ValidationError({"to_class": "Please select a valid target class."})

        if section_id:
            section_qs = Section.objects.filter(id=section_id, school_class_id=class_id)
            if not section_qs.exists():
                raise serializers.ValidationError({"to_section": "Please select a valid target section for the selected class."})

        if year_id:
            year_qs = AcademicYear.objects.filter(id=year_id)
            if user and school_id:
                year_qs = year_qs.filter(school_id=school_id)
            year = year_qs.first()
            if not year:
                raise serializers.ValidationError({"to_academic_year": "Please select a valid target academic year."})

            year_name = str(getattr(year, "name", "") or "").strip()
            if not re.fullmatch(r"\d{4}-\d{4}", year_name):
                raise serializers.ValidationError({"to_academic_year": "Academic year must follow YYYY-YYYY format."})

            start_year, end_year = [int(part) for part in year_name.split("-")]
            if end_year != start_year + 1:
                raise serializers.ValidationError({"to_academic_year": "Academic year range is invalid."})

        return attrs


class StudentMultiClassRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentMultiClassRecord
        fields = ["id", "student", "school_class", "section", "roll_no", "is_default", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        school_class = attrs.get("school_class") or getattr(self.instance, "school_class", None)
        section = attrs.get("section") if "section" in attrs else getattr(self.instance, "section", None)
        student = attrs.get("student") or getattr(self.instance, "student", None)

        request = self.context.get("request")
        school_id = getattr(getattr(request, "user", None), "school_id", None)
        if school_id:
            if student and student.school_id != school_id:
                raise serializers.ValidationError({"student": "Student not found."})
            if school_class and school_class.school_id != school_id:
                raise serializers.ValidationError({"school_class": "Class not found."})
            if section and section.school_class.school_id != school_id:
                raise serializers.ValidationError({"section": "Section not found."})

        if section and school_class and section.school_class_id != school_class.id:
            raise serializers.ValidationError({"section": "Section must belong to selected class."})

        return attrs


class StudentMultiClassRecordItemSerializer(serializers.Serializer):
    school_class = serializers.IntegerField(min_value=1)
    section = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    roll_no = serializers.CharField(required=False, allow_blank=True, max_length=40)
    is_default = serializers.BooleanField(required=False)


class StudentMultiClassBulkSaveSerializer(serializers.Serializer):
    student_id = serializers.IntegerField(min_value=1)
    records = StudentMultiClassRecordItemSerializer(many=True)


class StudentSubjectAssignmentSerializer(serializers.ModelSerializer):
    subject_name = serializers.CharField(source="subject.name", read_only=True)
    student_name = serializers.SerializerMethodField()

    class Meta:
        model = StudentSubjectAssignment
        fields = [
            "id",
            "student",
            "student_name",
            "subject",
            "subject_name",
            "academic_year",
            "school_class",
            "section",
            "is_optional",
            "category",
            "assigned_at",
            "assigned_by",
        ]
        read_only_fields = ["id", "assigned_at", "assigned_by", "subject_name", "student_name"]

    def get_student_name(self, obj):
        return f"{obj.student.first_name} {obj.student.last_name}".strip()


class StudentSubjectAssignmentRequestSerializer(serializers.Serializer):
    academic_year = serializers.IntegerField(min_value=1, required=True)
    school_class = serializers.IntegerField(min_value=1, required=True)
    section = serializers.IntegerField(min_value=1, required=True)
    subject_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), allow_empty=False)
    student_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), required=False, allow_empty=False)
    is_optional = serializers.BooleanField(required=False, default=False)

    def validate_school_class(self, value):
        if not value:
            raise serializers.ValidationError("Please select a class")
        return value

    def validate_subject_ids(self, value):
        cleaned = [item for item in value if item]
        if not cleaned:
            raise serializers.ValidationError("Please select at least one subject")
        return cleaned

    def validate(self, attrs):
        from apps.core.models import AcademicYear, Class, Section, Subject

        request = self.context.get("request")
        school_id = getattr(getattr(request, "user", None), "school_id", None)
        user = getattr(request, "user", None)

        class_id = attrs.get("school_class")
        section_id = attrs.get("section")
        year_id = attrs.get("academic_year")
        subject_ids = attrs.get("subject_ids", [])

        class_qs = Class.objects.filter(id=class_id)
        if user and school_id:
            class_qs = class_qs.filter(school_id=school_id)
        if not class_qs.exists():
            raise serializers.ValidationError({"class": "Please select a class"})

        section_qs = Section.objects.filter(id=section_id, school_class_id=class_id)
        if not section_qs.exists():
            raise serializers.ValidationError({"section": "Section does not belong to selected class"})

        year_qs = AcademicYear.objects.filter(id=year_id)
        if user and school_id:
            year_qs = year_qs.filter(school_id=school_id)
        year = year_qs.first()
        if not year or not year.is_current:
            raise serializers.ValidationError({"academic_year": "Academic year must be active"})

        subject_qs = Subject.objects.filter(id__in=subject_ids)
        if user and school_id:
            subject_qs = subject_qs.filter(school_id=school_id)
        if subject_qs.count() != len(set(subject_ids)):
            raise serializers.ValidationError({"subject_ids": "Please select at least one subject"})

        return attrs


class StudentSerializer(serializers.ModelSerializer):
    documents = StudentDocumentSerializer(many=True, read_only=True)
    transport_route_title = serializers.CharField(source="transport_route.title", read_only=True, allow_null=True)
    vehicle_no = serializers.CharField(source="vehicle.vehicle_no", read_only=True, allow_null=True)
    # Read-only nested view of every guardian linked to this student (see
    # StudentGuardian). Writes go through `_sync_guardian_links`, driven by the raw
    # `guardians` list in the request body (popped in `to_internal_value` below so
    # ModelSerializer doesn't try to validate it as a `Student` field) rather than a
    # normal writable serializer field, to keep read/write shapes independent.
    guardians = serializers.SerializerMethodField()

    def get_guardians(self, obj):
        links = list(obj.guardian_links.select_related("guardian").order_by("-is_primary", "id"))
        if not links and obj.guardian_id:
            # Backward-compat: students created before multi-guardian support have
            # no StudentGuardian row yet — fall back to the legacy single FK so
            # they still show their guardian instead of an empty list. The next
            # edit-save backfills the through-row via `_sync_guardian_links`.
            g = obj.guardian
            return [{
                "id": g.id,
                "full_name": g.full_name,
                "relation": g.relation,
                "phone": g.phone,
                "email": g.email,
                "occupation": g.occupation,
                "is_primary": True,
            }]
        return [
            {
                "id": link.guardian_id,
                "full_name": link.guardian.full_name,
                "relation": link.guardian.relation,
                "phone": link.guardian.phone,
                "email": link.guardian.email,
                "occupation": link.guardian.occupation,
                "is_primary": link.is_primary,
            }
            for link in links
        ]

    REQUIRED_CREATE_FIELDS = {
        "admission_no": "Admission number is required",
        "first_name": "First name is required",
        "date_of_birth": "Date of birth is required",
        "academic_year": "Academic year is required",
        "current_class": "Please select a class",
        "current_section": "Section is required",
    }

    CLASS_AGE_RULES = {
        1: (5, 7),
        2: (6, 8),
        3: (7, 9),
        4: (8, 10),
        5: (9, 11),
        6: (10, 12),
        7: (11, 13),
        8: (12, 14),
        9: (13, 15),
        10: (14, 16),
        11: (15, 17),
        12: (16, 18),
    }

    def _validate_plain_text_name(self, value, field_label):
        cleaned = strip_tags((value or "").strip())
        if cleaned != (value or "").strip():
            raise serializers.ValidationError(f"{field_label} cannot contain HTML tags.")
        return value

    def _extract_class_grade(self, selected_class):
        if not selected_class:
            return None
        class_name = str(getattr(selected_class, "name", "") or "")
        match = re.search(r"\d+", class_name)
        if not match:
            return None
        return int(match.group())

    def _validate_dob_for_class(self, dob, selected_class):
        if not dob:
            return None
        age_years = (date.today() - dob).days / 365.25
        if age_years < 3:
            return "Student must be at least 3 years old"

        grade = self._extract_class_grade(selected_class)
        if grade and grade in self.CLASS_AGE_RULES:
            min_age, max_age = self.CLASS_AGE_RULES[grade]
            if age_years < min_age or age_years > max_age:
                return f"Selected DOB does not match the required age for the selected class (Expected age: {min_age}-{max_age} years)"
        return None

    def validate_first_name(self, value):
        first_name = self._validate_plain_text_name(value, "First name").strip()
        if not re.fullmatch(r"[A-Za-z\s'-]+", first_name):
            raise serializers.ValidationError("First name can only contain letters, spaces, and hyphens")
        return first_name

    def validate_last_name(self, value):
        cleaned = self._validate_plain_text_name(value, "Last name")
        if not cleaned:
            return ""
        if not re.fullmatch(r"[A-Za-z\s'-]+", cleaned.strip()):
            raise serializers.ValidationError("Last name can only contain letters, spaces, and hyphens")
        return cleaned.strip()

    def validate_admission_no(self, value):
        admission_no = str(value or "").strip()
        if not admission_no:
            raise serializers.ValidationError("Admission number is required")
        if not re.fullmatch(r"[A-Za-z0-9]+", admission_no):
            raise serializers.ValidationError("Admission/Roll number should contain only numbers (or alphanumeric if needed)")

        request = self.context.get("request")
        school_id = getattr(getattr(request, "user", None), "school_id", None)
        if school_id:
            queryset = Student.objects.filter(school_id=school_id, admission_no__iexact=admission_no)
            if self.instance:
                queryset = queryset.exclude(id=self.instance.id)
            if queryset.exists():
                raise serializers.ValidationError("Admission number already exists")
        return admission_no

    def validate_roll_no(self, value):
        roll_no = str(value or "").strip()
        if not roll_no:
            return ""
        if not re.fullmatch(r"\d+", roll_no):
            raise serializers.ValidationError("Roll number must contain numbers only")
        return roll_no

    def validate_phone(self, value):
        phone = str(value or "").strip()
        if not phone:
            return ""
        if not re.fullmatch(r"\d{10}", phone):
            raise serializers.ValidationError("Phone number must be exactly 10 digits")
        return phone

    def validate_pincode(self, value):
        pincode = str(value or "").strip()
        if not pincode:
            return ""
        if not re.fullmatch(r"\d{6}", pincode):
            raise serializers.ValidationError("Pincode must be exactly 6 digits")
        return pincode

    def validate_district(self, value):
        district = strip_tags(str(value or "")).strip()
        if len(district) > 100:
            raise serializers.ValidationError("District must not exceed 100 characters")
        return district

    def validate_date_of_birth(self, value):
        if value and value > date.today():
            raise serializers.ValidationError("Date of birth cannot be in the future")
        return value

    def validate_dob(self, value, selected_class=None):
        if value and value > date.today():
            raise serializers.ValidationError("Date of birth cannot be in the future")
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        errors = {}
        raw_draft_flag = self.initial_data.get("is_draft") if hasattr(self, "initial_data") else None
        is_draft = str(raw_draft_flag).strip().lower() in {"1", "true", "yes"}

        if self.instance is None:
            for field, message in self.REQUIRED_CREATE_FIELDS.items():
                value = attrs.get(field)
                if value in [None, ""]:
                    errors[field] = message

        dob = attrs.get("date_of_birth") or getattr(self.instance, "date_of_birth", None)
        # Age-vs-class mismatch: informational only, never blocks (product decision —
        # late admissions, repeated grades, etc. are legitimate real cases). Was a
        # hard reject here via validate_dob()/_validate_dob_for_class raising
        # ValidationError; now just recorded on the instance so the view can surface
        # it as a non-blocking "warning" in the success response (same pattern as
        # _duplicate_warning), instead of rejecting the request outright.
        self._age_class_warning = None
        if dob:
            try:
                self.validate_dob(dob)
            except serializers.ValidationError as exc:
                errors["dob"] = str(exc.detail[0]) if isinstance(exc.detail, list) else str(exc.detail)
            else:
                selected_class = attrs.get("current_class") or getattr(self.instance, "current_class", None)
                self._age_class_warning = self._validate_dob_for_class(dob, selected_class)

        selected_class = attrs.get("current_class") or getattr(self.instance, "current_class", None)
        selected_section = attrs.get("current_section") or getattr(self.instance, "current_section", None)
        roll_no = (attrs.get("roll_no") if "roll_no" in attrs else getattr(self.instance, "roll_no", "") or "").strip()
        if selected_section and selected_class and selected_section.school_class_id != selected_class.id:
            errors["section"] = "Selected section does not belong to selected class"

        if roll_no and selected_class:
            request = self.context.get("request")
            school_id = getattr(getattr(request, "user", None), "school_id", None) or getattr(getattr(self.instance, "school", None), "id", None)
            duplicate_roll_qs = Student.objects.filter(current_class_id=selected_class.id, roll_no=roll_no, is_deleted=False)
            if school_id:
                duplicate_roll_qs = duplicate_roll_qs.filter(school_id=school_id)
            if self.instance:
                duplicate_roll_qs = duplicate_roll_qs.exclude(id=self.instance.id)
            if duplicate_roll_qs.exists():
                errors["roll_no"] = "Roll number must be unique within the selected class"

        if selected_section:
            students_in_section = Student.objects.filter(
                current_class_id=selected_section.school_class_id,
                current_section_id=selected_section.id,
            )
            request = self.context.get("request")
            school_id = getattr(getattr(request, "user", None), "school_id", None)
            if school_id:
                students_in_section = students_in_section.filter(school_id=school_id)
            if self.instance:
                students_in_section = students_in_section.exclude(id=self.instance.id)
            # Legacy data can have missing/invalid capacity values; avoid runtime errors.
            capacity = getattr(selected_section, "capacity", None)
            try:
                capacity_value = int(capacity) if capacity is not None else None
            except (TypeError, ValueError):
                capacity_value = None
            if capacity_value and students_in_section.count() >= capacity_value:
                errors["section"] = "Section capacity is full"

        gender = (attrs.get("gender") or getattr(self.instance, "gender", "")).lower()
        custom_gender = (attrs.get("custom_gender") or getattr(self.instance, "custom_gender", "")).strip()
        if gender == "other" and not custom_gender:
            errors["custom_gender"] = "Custom gender is required"

        phone = (attrs.get("phone") or getattr(self.instance, "phone", "")).strip()
        if not phone and not is_draft:
            errors["phone"] = "Phone number is required"

        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    def to_internal_value(self, data):
        mutable = dict(data)
        mutable.pop("is_draft", None)
        mutable.pop("guardians", None)  # synced separately in create()/update(), not a Student model field
        if "class" in mutable and "current_class" not in mutable:
            mutable["current_class"] = mutable.get("class")
        if "section" in mutable and "current_section" not in mutable:
            mutable["current_section"] = mutable.get("section")
        if "dob" in mutable and "date_of_birth" not in mutable:
            mutable["date_of_birth"] = mutable.get("dob")
        return super().to_internal_value(mutable)

    def _next_roll_number(self, school_id, class_id):
        queryset = Student.objects.filter(
            school_id=school_id,
            current_class_id=class_id,
            roll_no__regex=r"^\d+$",
            is_deleted=False,
        )
        max_roll = 0
        for roll in queryset.values_list("roll_no", flat=True):
            max_roll = max(max_roll, int(roll))
        return str(max_roll + 1)

    def _sync_guardian_links(self, instance, guardians_payload):
        """
        guardians_payload: list of {"id": <guardian pk>, "is_primary": bool}, sent by
        the frontend once it has resolved/created every guardian card. Replaces the
        full set of links for this student — safe because the frontend always sends
        the complete, current list of cards, not a partial patch.
        """
        if guardians_payload is None:
            return
        request = self.context.get("request")
        school_id = getattr(getattr(request, "user", None), "school_id", None)

        valid_ids = []
        primary_id = None
        for item in guardians_payload:
            if not isinstance(item, dict):
                continue
            gid = item.get("id")
            try:
                gid = int(gid)
            except (TypeError, ValueError):
                continue
            # Scope check — never link a guardian belonging to another school.
            guardian_qs = Guardian.objects.filter(id=gid)
            if school_id:
                guardian_qs = guardian_qs.filter(school_id=school_id)
            if not guardian_qs.exists():
                continue
            valid_ids.append(gid)
            if item.get("is_primary") and primary_id is None:
                primary_id = gid

        if not valid_ids:
            return
        if primary_id is None:
            primary_id = valid_ids[0]

        StudentGuardian.objects.filter(student=instance).exclude(guardian_id__in=valid_ids).delete()
        for gid in valid_ids:
            StudentGuardian.objects.update_or_create(
                student=instance, guardian_id=gid,
                defaults={"is_primary": gid == primary_id},
            )
        # Keep the legacy single FK in sync — the many existing call sites (parent
        # portal auth, attendance/fee notifications, reports, broadcasts) read it
        # directly and don't know about StudentGuardian.
        if instance.guardian_id != primary_id:
            instance.guardian_id = primary_id
            instance.save(update_fields=["guardian"])

    def create(self, validated_data):
        request = self.context.get("request")
        school_id = getattr(getattr(request, "user", None), "school_id", None)
        class_id = validated_data.get("current_class").id if validated_data.get("current_class") else None

        if not validated_data.get("roll_no") and school_id and class_id:
            validated_data["roll_no"] = self._next_roll_number(school_id, class_id)

        status_value = (validated_data.get("status") or "active").lower()
        validated_data["is_active"] = status_value == "active"
        validated_data["is_disabled"] = status_value in {"transferred", "dropped", "deleted"}
        validated_data["is_deleted"] = status_value == "deleted"

        # Student row + guardian-link sync must land together: if the link sync
        # fails partway (e.g. a bad guardian id, a DB error), a half-written
        # student with no guardians attached is worse than no student at all.
        # This does NOT cover the separate guardian-creation POST the frontend
        # sends before this request — that remains its own transaction (see
        # StudentAddPanel.tsx submit()'s compensating delete on student-create
        # failure), but it does stop *this* endpoint from ever partially committing.
        with transaction.atomic():
            instance = super().create(validated_data)
            self._sync_guardian_links(instance, self.initial_data.get("guardians"))
        return instance

    def update(self, instance, validated_data):
        status_value = (validated_data.get("status") or instance.status or "active").lower()
        validated_data["is_active"] = status_value == "active"
        validated_data["is_disabled"] = status_value in {"transferred", "dropped", "deleted"}
        validated_data["is_deleted"] = status_value == "deleted"
        with transaction.atomic():
            instance = super().update(instance, validated_data)
            self._sync_guardian_links(instance, self.initial_data.get("guardians"))
        return instance

    class Meta:
        model = Student
        fields = [
            "id",
            "student_id",
            "school",
            "admission_no",
            "roll_no",
            "first_name",
            "middle_name",
            "last_name",
            "date_of_birth",
            "academic_year",
            "gender",
            "custom_gender",
            "blood_group",
            "phone",
            "email",
            "address_line",
            "city",
            "district",
            "state",
            "pincode",
            "landmark",
            "transport_modes",
            "transport_custom",
            "photo",
            "mother_tongue",
            "other_mother_tongue",
            "religion",
            "nationality",
            "other_nationality",
            "admission_type",
            "previous_school_name",
            "rte_certificate_no",
            "stream",
            "apaar_id",
            "aadhaar_no",
            "pen",
            "digilocker_mobile",
            "abc_id",
            "height_cm",
            "weight_kg",
            "vision",
            "medical_conditions",
            "allergies",
            "current_medications",
            "treating_doctor",
            "vaccinations",
            "medical_notes",
            "emergency_contact_name",
            "emergency_contact_phone",
            "is_pwd",
            "disability_types",
            "disability_percent",
            "udid",
            "disability_accommodations",
            "disability_notes",
            "other_disability_text",
            "identity_marks",
            "eye_colour",
            "hair_colour",
            "complexion",
            "build",
            "status",
            "is_deleted",
            "deleted_at",
            "deleted_by",
            "category",
            "student_group",
            "guardian",
            "guardians",
            "current_class",
            "current_section",
            "admission_inquiry",
            "transport_route",
            "transport_route_title",
            "vehicle",
            "vehicle_no",
            "is_disabled",
            "is_active",
            "documents",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "student_id",
            "school",
            "documents",
            "transport_route_title",
            "vehicle_no",
            "deleted_at",
            "deleted_by",
            "created_at",
            "updated_at",
        ]


class StudentListSerializer(serializers.ModelSerializer):
    current_class_name = serializers.CharField(source="current_class.name", read_only=True, default=None)
    current_section_name = serializers.CharField(source="current_section.name", read_only=True, default=None)
    guardian_name = serializers.CharField(source="guardian.full_name", read_only=True, default=None)
    guardian_phone = serializers.CharField(source="guardian.phone", read_only=True, default=None)

    class Meta:
        model = Student
        fields = [
            "id",
            "admission_no",
            "roll_no",
            "first_name",
            "middle_name",
            "last_name",
            "date_of_birth",
            "gender",
            "phone",
            "category",
            "student_group",
            "guardian",
            "guardian_name",
            "guardian_phone",
            "current_class",
            "current_class_name",
            "current_section",
            "current_section_name",
            "status",
            "is_deleted",
            "is_disabled",
            "is_active",
            "created_at",
        ]
        read_only_fields = fields
