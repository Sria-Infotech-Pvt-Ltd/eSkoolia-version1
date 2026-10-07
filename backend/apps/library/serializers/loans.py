"""Loans, holds and lost or damaged reports.

Input serializers look every related id up inside the caller's school only, so another school's id
is an "invalid choice" exactly like an id that does not exist (blueprint 3.3). None of them has a
money, date or status field: those are computed by services.circulation.
"""
from rest_framework import serializers

from apps.core.models import Class, Section
from apps.library.models import (
    Book,
    BookCopy,
    BookIssue,
    Hold,
    LibraryActivityLog,
    LibraryMember,
    LostDamagedReport,
)
from apps.library.services.dues import days_overdue, loan_fine
from apps.library.services.members import person_name

MAX_BULK_MEMBERS = 200


def _school_id(serializer):
    request = serializer.context.get("request")
    return getattr(getattr(request, "user", None), "school_id", None)


# ---- loan rows ------------------------------------------------------------------------------------------


def loan_state(loan, today):
    """R10: overdue, due today and open are derived from the dates, never stored."""
    if loan.status == BookIssue.STATUS_LOST:
        return "lost"
    if loan.status == BookIssue.STATUS_RETURNED:
        return "returned"
    if loan.due_date < today:
        return "overdue"
    return "due_today" if loan.due_date == today else "open"


class IssueRowSerializer(serializers.ModelSerializer):
    """Needs `settings` and `today` in the context and a queryset with the loan list select_related set."""

    book_title = serializers.CharField(source="book.title", read_only=True)
    copy_code = serializers.SerializerMethodField()
    member_name = serializers.SerializerMethodField()
    member_card_no = serializers.CharField(source="member.card_no", read_only=True)
    member_type = serializers.CharField(source="member.member_type", read_only=True)
    school_class = serializers.SerializerMethodField()
    section = serializers.SerializerMethodField()
    days_overdue = serializers.SerializerMethodField()
    accrued_fine = serializers.SerializerMethodField()
    state = serializers.SerializerMethodField()
    renewed = serializers.SerializerMethodField()

    class Meta:
        model = BookIssue
        fields = [
            "id", "book", "book_title", "copy", "copy_code", "member", "member_name", "member_card_no", "member_type",
            "school_class", "section", "issue_date", "due_date", "return_date", "returned_at", "days_overdue",
            "accrued_fine", "fine_amount", "renew_count", "renewed", "status", "state",
        ]
        read_only_fields = fields

    def _open(self, obj):
        return obj.status == BookIssue.STATUS_ISSUED

    def get_copy_code(self, obj):
        return obj.copy.code if obj.copy_id else ""

    def get_member_name(self, obj):
        return person_name(obj.member)

    def get_school_class(self, obj):
        student = obj.member.student if obj.member.student_id else None
        return student.current_class.name if student and student.current_class_id else ""

    def get_section(self, obj):
        student = obj.member.student if obj.member.student_id else None
        return student.current_section.name if student and student.current_section_id else ""

    def get_days_overdue(self, obj):
        return days_overdue(obj.due_date, self.context["today"]) if self._open(obj) else 0

    def get_accrued_fine(self, obj):
        if not self._open(obj):
            return "0.00"
        return str(loan_fine(obj.due_date, self.context["today"], obj.book.cost_per_copy, self.context["settings"]))

    def get_state(self, obj):
        return loan_state(obj, self.context["today"])

    def get_renewed(self, obj):
        return obj.renew_count > 0


class DeskLogSerializer(serializers.ModelSerializer):
    """One line of the Today at the Desk log. Needs select_related("actor")."""

    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = LibraryActivityLog
        fields = ["id", "event_type", "summary", "created_at", "actor_name", "issue"]
        read_only_fields = fields

    def get_actor_name(self, obj):
        if not obj.actor_id:
            return ""
        return obj.actor.get_full_name() or obj.actor.username


class IssueDetailSerializer(IssueRowSerializer):
    charges = serializers.SerializerMethodField()
    issued_by_name = serializers.CharField(source="issued_by.get_full_name", read_only=True, default=None)

    class Meta(IssueRowSerializer.Meta):
        fields = [*IssueRowSerializer.Meta.fields, "issued_by", "issued_by_name", "last_renewed_on", "charges", "created_at"]
        read_only_fields = fields

    def get_charges(self, obj):
        return [
            {"id": c.pk, "charge_type": c.charge_type, "amount": str(c.amount), "status": c.status, "receipt_no": c.receipt_no}
            for c in obj.charges.all()
        ]


# ---- loan inputs ------------------------------------------------------------------------------------------


class IssueInputSerializer(serializers.Serializer):
    member = serializers.PrimaryKeyRelatedField(queryset=LibraryMember.objects.none())
    copy = serializers.PrimaryKeyRelatedField(queryset=BookCopy.objects.none(), required=False)
    book = serializers.PrimaryKeyRelatedField(queryset=Book.objects.none(), required=False)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        school_id = _school_id(self)
        self.fields["member"].queryset = LibraryMember.objects.filter(school_id=school_id)
        self.fields["copy"].queryset = BookCopy.objects.filter(school_id=school_id)
        self.fields["book"].queryset = Book.objects.filter(school_id=school_id)

    def validate(self, attrs):
        if ("copy" in attrs) == ("book" in attrs):
            raise serializers.ValidationError({"copy": "Give either a copy or a book."})
        return attrs


class BulkIssueInputSerializer(serializers.Serializer):
    book = serializers.PrimaryKeyRelatedField(queryset=Book.objects.none())
    school_class = serializers.PrimaryKeyRelatedField(queryset=Class.objects.none())
    section = serializers.PrimaryKeyRelatedField(queryset=Section.objects.none(), required=False, allow_null=True)
    member_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), required=False, max_length=MAX_BULK_MEMBERS)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        school_id = _school_id(self)
        self.fields["book"].queryset = Book.objects.filter(school_id=school_id)
        self.fields["school_class"].queryset = Class.objects.filter(school_id=school_id)
        self.fields["section"].queryset = Section.objects.filter(school_class__school_id=school_id)

    def validate(self, attrs):
        section = attrs.get("section")
        if section is not None and section.school_class_id != attrs["school_class"].pk:
            raise serializers.ValidationError({"section": "This section does not belong to the class."})
        return attrs


class ReportInputSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=LostDamagedReport.TYPE_CHOICES)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=1000)


class ReturnInputSerializer(serializers.Serializer):
    """Only what the librarian decides. Any fine_amount or return_date in the body is ignored: the server computes both."""

    fine_action = serializers.ChoiceField(choices=[("collect", "Collect"), ("waive", "Waive")], required=False, allow_blank=True)
    waive_reason = serializers.CharField(required=False, allow_blank=True, max_length=500)
    condition = serializers.ChoiceField(choices=BookCopy.CONDITION_CHOICES, required=False, allow_blank=True)
    report = ReportInputSerializer(required=False)


# ---- holds ---------------------------------------------------------------------------------------------------


class HoldSerializer(serializers.ModelSerializer):
    book_title = serializers.CharField(source="book.title", read_only=True)
    member_name = serializers.SerializerMethodField()
    card_no = serializers.CharField(source="member.card_no", read_only=True)

    class Meta:
        model = Hold
        fields = ["id", "book", "book_title", "member", "member_name", "card_no", "status", "fulfilled_issue", "created_at"]
        read_only_fields = fields

    def get_member_name(self, obj):
        return person_name(obj.member)


class HoldCreateSerializer(serializers.Serializer):
    book = serializers.PrimaryKeyRelatedField(queryset=Book.objects.none())
    member = serializers.PrimaryKeyRelatedField(queryset=LibraryMember.objects.none())

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        school_id = _school_id(self)
        self.fields["book"].queryset = Book.objects.filter(school_id=school_id)
        self.fields["member"].queryset = LibraryMember.objects.filter(school_id=school_id)


# ---- lost and damaged ------------------------------------------------------------------------------------------


class ReportSerializer(serializers.ModelSerializer):
    """Fee status is read from the replacement charge (annotated by the view), not stored twice."""

    book_title = serializers.CharField(source="book.title", read_only=True)
    copy_code = serializers.CharField(source="copy.code", read_only=True)
    member_name = serializers.SerializerMethodField()
    card_no = serializers.SerializerMethodField()
    reported_by_name = serializers.CharField(source="reported_by.get_full_name", read_only=True, default=None)
    fee_status = serializers.SerializerMethodField()
    charge_id = serializers.IntegerField(source="fee_charge_id", read_only=True, default=None)

    class Meta:
        model = LostDamagedReport
        fields = [
            "id", "book", "book_title", "copy", "copy_code", "member", "member_name", "card_no", "issue", "report_type",
            "reported_on", "reported_by", "reported_by_name", "source", "notes", "replacement_cost", "resolution",
            "resolved_at", "fee_status", "charge_id", "created_at",
        ]
        read_only_fields = fields

    def get_member_name(self, obj):
        return person_name(obj.member) if obj.member_id else ""

    def get_card_no(self, obj):
        return obj.member.card_no if obj.member_id else ""

    def get_fee_status(self, obj):
        status = getattr(obj, "fee_charge_status", None)
        return {"pending": "charged", "paid": "paid", "waived": "waived", "written_off": "written_off"}.get(status, "none")


class ReportCreateSerializer(serializers.Serializer):
    copy = serializers.PrimaryKeyRelatedField(queryset=BookCopy.objects.none())
    member = serializers.PrimaryKeyRelatedField(queryset=LibraryMember.objects.none(), required=False, allow_null=True)
    issue = serializers.PrimaryKeyRelatedField(queryset=BookIssue.objects.none(), required=False, allow_null=True)
    report_type = serializers.ChoiceField(choices=LostDamagedReport.TYPE_CHOICES)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=1000)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        school_id = _school_id(self)
        self.fields["copy"].queryset = BookCopy.objects.filter(school_id=school_id)
        self.fields["member"].queryset = LibraryMember.objects.filter(school_id=school_id)
        self.fields["issue"].queryset = BookIssue.objects.filter(school_id=school_id)


class ReportNotesSerializer(serializers.Serializer):
    """PATCH: notes only. Any other key is refused rather than silently dropped."""

    notes = serializers.CharField(allow_blank=True, max_length=1000)

    def to_internal_value(self, data):
        extra = sorted(set(getattr(data, "keys", lambda: [])()) - {"notes"})
        if extra:
            raise serializers.ValidationError({name: "This field cannot be edited." for name in extra})
        return super().to_internal_value(data)


class FeePaidSerializer(serializers.Serializer):
    receipt_no = serializers.CharField(required=False, allow_blank=True, max_length=40)
