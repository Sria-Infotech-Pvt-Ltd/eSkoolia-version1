from decimal import Decimal

from django.db import models
from django.db.models import Q

from .base import LibraryAuditModel
from .catalogue import Book


class LibraryMember(LibraryAuditModel):
    MEMBER_STUDENT = "student"
    MEMBER_TEACHER = "teacher"
    MEMBER_STAFF = "staff"
    MEMBER_CHOICES = [
        (MEMBER_STUDENT, "Student"),
        (MEMBER_TEACHER, "Teacher"),
        (MEMBER_STAFF, "Staff"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="library_members")
    member_type = models.CharField(max_length=10, choices=MEMBER_CHOICES)
    # PROTECT: a person with a library membership cannot be deleted from under the loan history.
    student = models.ForeignKey("students.Student", on_delete=models.PROTECT, null=True, blank=True, related_name="library_memberships")
    staff = models.ForeignKey("hr.Staff", on_delete=models.PROTECT, null=True, blank=True, related_name="library_memberships")
    card_no = models.CharField(max_length=40)
    # Amount charged at registration (D6). 0 means waived. The registration charge row is the ledger entry.
    registration_fee_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_members"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["school", "card_no"], name="uq_lib_member_card"),
            models.UniqueConstraint(
                fields=["school", "student"], condition=Q(student__isnull=False), name="uq_library_members_school_student"
            ),
            models.UniqueConstraint(
                fields=["school", "staff"], condition=Q(staff__isnull=False), name="uq_library_members_school_staff"
            ),
            models.CheckConstraint(
                condition=(
                    Q(member_type="student", student__isnull=False, staff__isnull=True)
                    | Q(member_type__in=["teacher", "staff"], staff__isnull=False, student__isnull=True)
                ),
                name="ck_library_members_type_matches_person",
            ),
            models.CheckConstraint(condition=Q(registration_fee_amount__gte=0), name="ck_library_members_fee_nonneg"),
        ]
        indexes = [
            models.Index(fields=["school", "member_type", "is_active"], name="idx_lib_members_school_type"),
        ]

    def __str__(self):
        return self.card_no


class BookIssue(LibraryAuditModel):
    STATUS_ISSUED = "issued"
    STATUS_RETURNED = "returned"
    STATUS_LOST = "lost"
    STATUS_CHOICES = [
        (STATUS_ISSUED, "Issued"),
        (STATUS_RETURNED, "Returned"),
        (STATUS_LOST, "Lost"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="book_issues")
    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="issues")
    member = models.ForeignKey(LibraryMember, on_delete=models.PROTECT, related_name="book_issues")
    issue_date = models.DateField()
    due_date = models.DateField()
    return_date = models.DateField(null=True, blank=True)
    fine_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_ISSUED)
    issued_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="books_issued_by",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_book_issues"
        ordering = ["-issue_date", "-id"]
        indexes = [
            models.Index(fields=["school", "status", "due_date"], name="idx_lib_issue_st_due"),
        ]

    def __str__(self):
        return f"{self.book_id}/{self.member_id} ({self.status})"
