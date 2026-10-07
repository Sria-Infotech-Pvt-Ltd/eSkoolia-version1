from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from apps.hr.models import Staff
from apps.library.models import BookIssue, LibraryMember
from apps.library.services import members as members_service
from apps.library.services.dues import borrowing_limit, days_overdue, loan_fine, money
from apps.students.models import Student

from .base import LibraryModelSerializer


class MemberRowMixin:
    """Shared output for member rows. Needs a queryset from services.members.annotate_member_dues and,
    in the serializer context, `settings` (LibrarySettings) and `accrued` ({member_id: open-loan fine})."""

    def _dues(self, obj):
        cached = getattr(obj, "_dues_cache", None)
        if cached is None:
            cached = members_service.member_dues(obj, self.context.get("accrued", {}).get(obj.pk))
            obj._dues_cache = cached
        return cached

    def get_display_name(self, obj):
        return members_service.person_name(obj)

    def get_school_class(self, obj):
        return obj.student.current_class.name if obj.student_id and obj.student.current_class_id else ""

    def get_section(self, obj):
        return obj.student.current_section.name if obj.student_id and obj.student.current_section_id else ""

    def get_borrowing_limit(self, obj):
        return borrowing_limit(obj.member_type, self.context["settings"])

    def get_total_dues(self, obj):
        return str(self._dues(obj).total)

    def get_standing(self, obj):
        return "suspended" if self._dues(obj).suspended else "active"


class MemberListSerializer(MemberRowMixin, serializers.ModelSerializer):
    display_name = serializers.SerializerMethodField()
    school_class = serializers.SerializerMethodField()
    section = serializers.SerializerMethodField()
    active_loans = serializers.IntegerField(read_only=True)
    borrowing_limit = serializers.SerializerMethodField()
    registration_status = serializers.CharField(source="registration_state", read_only=True)
    total_dues = serializers.SerializerMethodField()
    standing = serializers.SerializerMethodField()

    class Meta:
        model = LibraryMember
        fields = [
            "id", "display_name", "member_type", "student", "staff", "school_class", "section", "card_no",
            "active_loans", "borrowing_limit", "registration_fee_amount", "registration_status", "total_dues",
            "standing", "is_active", "created_at",
        ]
        read_only_fields = fields


def dues_payload(summary, accrued=None):
    return {
        "overdue_fines": str(summary.overdue_fines),
        "replacement_fees": str(summary.replacement_fees),
        "registration_due": str(summary.registration_due),
        "total": str(summary.total),
        "suspended": summary.suspended,
        "accrued_open_loan_fines": str(money(accrued or 0)),
    }


class MemberDetailSerializer(MemberListSerializer):
    open_loans = serializers.SerializerMethodField()
    dues = serializers.SerializerMethodField()

    class Meta(MemberListSerializer.Meta):
        fields = [*MemberListSerializer.Meta.fields, "open_loans", "dues", "updated_at"]
        read_only_fields = fields

    def get_open_loans(self, obj):
        today = timezone.localdate()
        settings = self.context["settings"]
        loans = BookIssue.objects.filter(member=obj, status=BookIssue.STATUS_ISSUED).select_related("book").order_by("due_date")
        return [
            {
                "id": loan.pk,
                "book": loan.book_id,
                "title": loan.book.title,
                "issue_date": loan.issue_date,
                "due_date": loan.due_date,
                "days_overdue": days_overdue(loan.due_date, today),
                "accrued_fine": str(loan_fine(loan.due_date, today, loan.book.cost_per_copy, settings)),
            }
            for loan in loans
        ]

    def get_dues(self, obj):
        return dues_payload(self._dues(obj), self.context.get("accrued", {}).get(obj.pk))


class MemberEligibleSerializer(MemberListSerializer):
    """Issue-desk roster row. Context also carries `book` and `holding` (member ids already holding that title)."""

    eligible = serializers.SerializerMethodField()
    reason = serializers.SerializerMethodField()

    class Meta(MemberListSerializer.Meta):
        fields = [
            "id", "display_name", "member_type", "school_class", "section", "card_no",
            "active_loans", "borrowing_limit", "standing", "eligible", "reason",
        ]
        read_only_fields = fields

    def _eligibility(self, obj):
        cached = getattr(obj, "_eligibility_cache", None)
        if cached is None:
            cached = members_service.eligibility(
                obj,
                dues=self._dues(obj),
                settings=self.context["settings"],
                book=self.context.get("book"),
                holding=obj.pk in self.context.get("holding", set()),
            )
            obj._eligibility_cache = cached
        return cached

    def get_eligible(self, obj):
        return self._eligibility(obj)[0]

    def get_reason(self, obj):
        return self._eligibility(obj)[1]


class MemberCreateSerializer(LibraryModelSerializer):
    """Register a member. Person ids are looked up inside the caller's school only, so another
    school's id is an invalid choice, exactly like an id that does not exist."""

    student = serializers.PrimaryKeyRelatedField(queryset=Student.objects.none(), required=False, allow_null=True)
    staff = serializers.PrimaryKeyRelatedField(queryset=Staff.objects.none(), required=False, allow_null=True)
    member_type = serializers.ChoiceField(choices=LibraryMember.MEMBER_CHOICES, required=False)
    card_no = serializers.CharField(max_length=40, required=False, allow_blank=True)
    registration_fee_amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal(0), required=False)
    collect_fee_now = serializers.BooleanField(required=False, default=False)

    class Meta:
        model = LibraryMember
        fields = ["id", "member_type", "student", "staff", "card_no", "registration_fee_amount", "collect_fee_now"]
        read_only_fields = ["id"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        school_id = self.request_school_id()
        self.fields["student"].queryset = Student.objects.filter(school_id=school_id, status="active")
        self.fields["staff"].queryset = Staff.objects.filter(school_id=school_id, status=Staff.STATUS_ACTIVE)

    def validate(self, attrs):
        student, staff = attrs.get("student"), attrs.get("staff")
        if bool(student) == bool(staff):
            raise serializers.ValidationError({"student": "Choose either a student or a staff member."})
        member_type = attrs.get("member_type")
        if student and member_type not in (None, LibraryMember.MEMBER_STUDENT):
            raise serializers.ValidationError({"member_type": "A student is registered as a student member."})
        if staff and member_type == LibraryMember.MEMBER_STUDENT:
            raise serializers.ValidationError({"member_type": "Staff are registered as teacher or staff members."})
        existing = LibraryMember.objects.filter(school_id=self.request_school_id())
        if student and existing.filter(student=student).exists():
            raise serializers.ValidationError({"student": "This student is already a library member."})
        if staff and existing.filter(staff=staff).exists():
            raise serializers.ValidationError({"staff": "This staff member is already a library member."})
        card = (attrs.get("card_no") or "").strip()
        if card and existing.filter(card_no=card).exists():
            raise serializers.ValidationError({"card_no": "This card number is already in use."})
        attrs["card_no"] = card
        return attrs


class MemberUpdateSerializer(LibraryModelSerializer):
    """PATCH: activate or deactivate, change the card number, or switch a staff-linked member between teacher and staff."""

    class Meta:
        model = LibraryMember
        fields = ["id", "is_active", "card_no", "member_type"]
        read_only_fields = ["id"]

    def validate_card_no(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Card number cannot be blank.")
        clash = LibraryMember.objects.filter(school_id=self.request_school_id(), card_no=value).exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("This card number is already in use.")
        return value

    def validate_member_type(self, value):
        is_student = self.instance.student_id is not None
        if is_student != (value == LibraryMember.MEMBER_STUDENT):
            raise serializers.ValidationError("The person decides student or staff; only teacher and staff can be switched.")
        return value
