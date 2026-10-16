from decimal import Decimal

from django.db import models
from django.db.models import F, Q

from .base import LibraryAuditModel
from .catalogue import Book, BookCopy


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
    """A loan of one specific copy. Changed only through services.circulation (blueprint 3.1)."""

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
    # Null only for returned loans that predate copies. Migration 0010 binds every open and lost loan.
    copy = models.ForeignKey(BookCopy, on_delete=models.PROTECT, null=True, blank=True, related_name="loans")
    member = models.ForeignKey(LibraryMember, on_delete=models.PROTECT, related_name="book_issues")
    issue_date = models.DateField()
    due_date = models.DateField()
    return_date = models.DateField(null=True, blank=True)
    renew_count = models.PositiveSmallIntegerField(default=0)
    last_renewed_on = models.DateField(null=True, blank=True)
    returned_at = models.DateTimeField(null=True, blank=True)
    returned_by = models.ForeignKey("users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    # Fine assessed at return. Written by the server only.
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
        constraints = [
            models.UniqueConstraint(
                fields=["copy"], condition=Q(status="issued", copy__isnull=False), name="uq_library_book_issues_open_copy"
            ),
            models.CheckConstraint(condition=Q(due_date__gte=F("issue_date")), name="ck_library_book_issues_due_after_issue"),
            models.CheckConstraint(
                condition=Q(return_date__isnull=True) | Q(return_date__gte=F("issue_date")),
                name="ck_library_book_issues_return_after_issue",
            ),
        ]
        indexes = [
            models.Index(fields=["school", "status", "due_date"], name="idx_lib_issue_st_due"),
            models.Index(fields=["school", "member", "status"], name="idx_lib_issue_member_st"),
            models.Index(fields=["school", "copy"], name="idx_lib_issue_copy"),
            models.Index(fields=["school", "book", "status"], name="idx_lib_issue_book_st"),
            models.Index(fields=["school", "issue_date"], name="idx_lib_issue_school_date"),
        ]

    def __str__(self):
        return f"{self.book_id}/{self.member_id} ({self.status})"


class Hold(LibraryAuditModel):
    """A member waiting for a title. First come, first served per title (R16)."""

    STATUS_WAITING = "waiting"
    STATUS_FULFILLED = "fulfilled"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_WAITING, "Waiting"),
        (STATUS_FULFILLED, "Fulfilled"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="library_holds")
    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="holds")
    member = models.ForeignKey(LibraryMember, on_delete=models.PROTECT, related_name="holds")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_WAITING)
    fulfilled_issue = models.ForeignKey(BookIssue, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_holds"
        ordering = ["created_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["school", "book", "member"], condition=Q(status="waiting"), name="uq_library_holds_waiting"
            ),
        ]
        indexes = [
            models.Index(fields=["school", "book", "status", "created_at"], name="idx_lib_holds_queue"),
        ]

    def __str__(self):
        return f"hold {self.book_id}/{self.member_id} ({self.status})"
