from rest_framework import serializers

from apps.library.models import BookIssue, LibraryMember

from .base import AUDIT_FIELDS, AUDIT_READ_ONLY, LibraryModelSerializer


class LibraryMemberSerializer(LibraryModelSerializer):
    class Meta:
        model = LibraryMember
        fields = ["id", "school", "member_type", "student", "staff", "card_no", "is_active", "created_at", *AUDIT_FIELDS]
        read_only_fields = AUDIT_READ_ONLY

    def validate(self, attrs):
        school_id = self.request_school_id()
        member_type = attrs.get("member_type") or getattr(self.instance, "member_type", None)
        student = attrs.get("student") or getattr(self.instance, "student", None)
        staff = attrs.get("staff") or getattr(self.instance, "staff", None)

        if member_type == LibraryMember.MEMBER_STUDENT and not student:
            raise serializers.ValidationError({"student": "Student is required for student member type."})
        if member_type == LibraryMember.MEMBER_STAFF and not staff:
            raise serializers.ValidationError({"staff": "Staff is required for staff member type."})
        if member_type == LibraryMember.MEMBER_STUDENT and staff:
            raise serializers.ValidationError({"staff": "Staff must be empty for student member type."})
        if member_type == LibraryMember.MEMBER_STAFF and student:
            raise serializers.ValidationError({"student": "Student must be empty for staff member type."})

        if school_id and student and student.school_id != school_id:
            raise serializers.ValidationError({"student": "Selected student does not belong to your school."})
        if school_id and staff and staff.school_id != school_id:
            raise serializers.ValidationError({"staff": "Selected staff does not belong to your school."})

        return attrs


class BookIssueSerializer(LibraryModelSerializer):
    """LEGACY loan serializer, replaced by the issue-desk serializers in prompt 5.

    Money, dates of return and status are written by the server only: a loan is
    always created as ``issued`` and closed through the return action.
    """

    class Meta:
        model = BookIssue
        fields = [
            "id",
            "school",
            "book",
            "member",
            "issue_date",
            "due_date",
            "return_date",
            "fine_amount",
            "status",
            "issued_by",
            "created_at",
            "updated_at",
            *AUDIT_FIELDS,
        ]
        read_only_fields = [*AUDIT_READ_ONLY, "issued_by", "return_date", "fine_amount", "status"]

    def validate(self, attrs):
        school_id = self.request_school_id()
        issue_date = attrs.get("issue_date") or getattr(self.instance, "issue_date", None)
        due_date = attrs.get("due_date") or getattr(self.instance, "due_date", None)
        book = attrs.get("book") or getattr(self.instance, "book", None)
        member = attrs.get("member") or getattr(self.instance, "member", None)

        if issue_date and due_date and due_date < issue_date:
            raise serializers.ValidationError({"due_date": "Due date cannot be earlier than issue date."})

        if school_id and book and book.school_id != school_id:
            raise serializers.ValidationError({"book": "Selected book does not belong to your school."})
        if school_id and member and member.school_id != school_id:
            raise serializers.ValidationError({"member": "Selected member does not belong to your school."})

        if book and book.available_quantity <= 0:
            raise serializers.ValidationError({"book": "No available copies for this book."})

        return attrs
