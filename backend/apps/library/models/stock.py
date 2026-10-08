from decimal import Decimal

from django.db import models
from django.db.models import Q

from .base import LibraryAuditModel


class StockAudit(LibraryAuditModel):
    """A shelf check of one rack, or of every rack when `scope_rack` is blank (blueprint 2.2 table 15)."""

    STATUS_IN_PROGRESS = "in_progress"
    STATUS_COMPLETED = "completed"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_IN_PROGRESS, "In progress"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="library_stock_audits")
    scope_rack = models.CharField(max_length=50, blank=True, default="")
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_IN_PROGRESS)
    started_at = models.DateTimeField()
    finished_at = models.DateTimeField(null=True, blank=True)
    # Set at finish and frozen.
    total_in_scope = models.PositiveIntegerField(default=0)
    accounted_count = models.PositiveIntegerField(default=0)
    missing_count = models.PositiveIntegerField(default=0)
    value_at_risk = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_stock_audits"
        ordering = ["-started_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["school", "scope_rack"],
                condition=Q(status="in_progress"),
                name="uq_library_stock_audits_open_scope",
            ),
        ]
        indexes = [models.Index(fields=["school", "status", "started_at"], name="idx_lib_audit_school_st_ts")]

    def __str__(self):
        return f"audit {self.pk} ({self.status})"


class StockAuditItem(LibraryAuditModel):
    """One on-shelf copy captured when the audit started."""

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="library_stock_audit_items")
    audit = models.ForeignKey(StockAudit, on_delete=models.PROTECT, related_name="items")
    copy = models.ForeignKey("library.BookCopy", on_delete=models.PROTECT, related_name="audit_items")
    found = models.BooleanField(default=False)
    verified_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_stock_audit_items"
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["audit", "copy"], name="uq_library_stock_audit_items_audit_copy"),
        ]
        indexes = [models.Index(fields=["school", "audit", "found"], name="idx_lib_aitem_school_aud_fnd")]

    def __str__(self):
        return f"audit {self.audit_id} copy {self.copy_id}"
