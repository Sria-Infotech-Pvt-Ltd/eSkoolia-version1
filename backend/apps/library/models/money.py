from decimal import Decimal

from django.db import models
from django.db.models import Q

from .base import LibraryAuditModel


class Charge(LibraryAuditModel):
    """The library ledger: one row per money item (blueprint 2.2 table 8).

    The accruing fine on an open overdue loan is computed on read and is NOT a row.
    It becomes a row at return.
    """

    TYPE_REGISTRATION = "registration"
    TYPE_OVERDUE_FINE = "overdue_fine"
    TYPE_REPLACEMENT = "replacement"
    TYPE_CHOICES = [
        (TYPE_REGISTRATION, "Registration fee"),
        (TYPE_OVERDUE_FINE, "Overdue fine"),
        (TYPE_REPLACEMENT, "Replacement fee"),
    ]

    STATUS_PENDING = "pending"
    STATUS_PAID = "paid"
    STATUS_WAIVED = "waived"
    STATUS_WRITTEN_OFF = "written_off"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_PAID, "Paid"),
        (STATUS_WAIVED, "Waived"),
        (STATUS_WRITTEN_OFF, "Written off"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="library_charges")
    member = models.ForeignKey("library.LibraryMember", on_delete=models.PROTECT, related_name="charges")
    charge_type = models.CharField(max_length=14, choices=TYPE_CHOICES)
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_PENDING)
    issue = models.ForeignKey("library.BookIssue", on_delete=models.SET_NULL, null=True, blank=True, related_name="charges")
    report = models.ForeignKey("library.LostDamagedReport", on_delete=models.SET_NULL, null=True, blank=True, related_name="charges")
    assessed_on = models.DateField()
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey("users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    resolution_note = models.TextField(blank=True)
    receipt_no = models.CharField(max_length=40, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_charges"
        ordering = ["-assessed_on", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["school", "issue"],
                condition=Q(charge_type="overdue_fine", issue__isnull=False),
                name="uq_library_charges_issue_fine",
            ),
            models.UniqueConstraint(
                fields=["school", "member"],
                condition=Q(charge_type="registration"),
                name="uq_library_charges_member_registration",
            ),
            models.UniqueConstraint(
                fields=["school", "report"],
                condition=Q(charge_type="replacement", report__isnull=False),
                name="uq_library_charges_report_replacement",
            ),
            models.CheckConstraint(condition=Q(amount__gte=0), name="ck_library_charges_amount_nonneg"),
        ]
        indexes = [
            models.Index(fields=["school", "member", "status"], name="idx_lib_chg_school_member_st"),
            models.Index(fields=["school", "charge_type", "status"], name="idx_lib_chg_school_type_st"),
            models.Index(fields=["school", "assessed_on"], name="idx_lib_chg_school_assessed"),
        ]

    def __str__(self):
        return f"{self.charge_type} {self.amount} ({self.status})"


class LostDamagedReport(LibraryAuditModel):
    """A lost or damaged copy (blueprint 2.2 table 9). The fee status is read from the linked replacement charge."""

    TYPE_LOST = "lost"
    TYPE_DAMAGED = "damaged"
    TYPE_CHOICES = [(TYPE_LOST, "Lost"), (TYPE_DAMAGED, "Damaged")]

    SOURCE_DESK_RETURN = "desk_return"
    SOURCE_MANUAL = "manual"
    SOURCE_STOCK_AUDIT = "stock_audit"
    SOURCE_CHOICES = [
        (SOURCE_DESK_RETURN, "Desk return"),
        (SOURCE_MANUAL, "Manual"),
        (SOURCE_STOCK_AUDIT, "Stock audit"),
    ]

    RESOLUTION_PENDING = "pending"
    RESOLUTION_RESOLVED = "resolved"
    RESOLUTION_CHOICES = [(RESOLUTION_PENDING, "Pending"), (RESOLUTION_RESOLVED, "Resolved")]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="library_reports")
    book = models.ForeignKey("library.Book", on_delete=models.PROTECT, related_name="reports")
    copy = models.ForeignKey("library.BookCopy", on_delete=models.PROTECT, related_name="reports")
    # Null for losses found in a stock check: nobody to bill.
    member = models.ForeignKey("library.LibraryMember", on_delete=models.PROTECT, null=True, blank=True, related_name="reports")
    issue = models.ForeignKey("library.BookIssue", on_delete=models.SET_NULL, null=True, blank=True, related_name="reports")
    report_type = models.CharField(max_length=10, choices=TYPE_CHOICES)
    reported_on = models.DateField()
    reported_by = models.ForeignKey("users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    source = models.CharField(max_length=12, choices=SOURCE_CHOICES, default=SOURCE_MANUAL)
    notes = models.TextField(blank=True)
    # Computed from the settings (D5) and stored for history.
    replacement_cost = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    resolution = models.CharField(max_length=10, choices=RESOLUTION_CHOICES, default=RESOLUTION_PENDING)
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_lost_damaged_reports"
        ordering = ["-reported_on", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["school", "copy"], condition=Q(resolution="pending"), name="uq_library_reports_open_copy"),
            models.CheckConstraint(condition=Q(replacement_cost__gte=0), name="ck_library_reports_cost_nonneg"),
        ]
        indexes = [
            models.Index(fields=["school", "resolution"], name="idx_lib_reports_school_res"),
            models.Index(fields=["school", "member"], name="idx_lib_reports_school_member"),
        ]

    def __str__(self):
        return f"{self.report_type} {self.copy_id} ({self.resolution})"
