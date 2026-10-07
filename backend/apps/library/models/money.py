from decimal import Decimal

from django.db import models
from django.db.models import Q

from .base import LibraryAuditModel


class Charge(LibraryAuditModel):
    """The library ledger: one row per money item (blueprint 2.2 table 8).

    The accruing fine on an open overdue loan is computed on read and is NOT a row.
    It becomes a row at return. The replacement-report link arrives with prompt 5.
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
            models.CheckConstraint(condition=Q(amount__gte=0), name="ck_library_charges_amount_nonneg"),
        ]
        indexes = [
            models.Index(fields=["school", "member", "status"], name="idx_lib_chg_school_member_st"),
            models.Index(fields=["school", "charge_type", "status"], name="idx_lib_chg_school_type_st"),
            models.Index(fields=["school", "assessed_on"], name="idx_lib_chg_school_assessed"),
        ]

    def __str__(self):
        return f"{self.charge_type} {self.amount} ({self.status})"
