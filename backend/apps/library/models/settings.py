from decimal import Decimal

from django.db import models
from django.db.models import Q

from .base import LibraryAuditModel


class LibrarySettings(LibraryAuditModel):
    """One row per school, created lazily by services.settings.get_settings.

    Defaults are the locked decisions D1 to D6 and D17 in the blueprint.
    po_sequence and donation_receipt_sequence are counters: read-only over the
    API, incremented under a row lock by the numbering service.
    """

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="library_settings")

    # D1 overdue fine
    fine_per_day = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("10.00"))
    fine_grace_days = models.PositiveSmallIntegerField(default=0)
    fine_cap = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    cap_fine_at_replacement_cost = models.BooleanField(default=True)

    # D2 borrowing limits
    limit_student = models.PositiveSmallIntegerField(default=2)
    limit_teacher = models.PositiveSmallIntegerField(default=5)
    limit_staff = models.PositiveSmallIntegerField(default=3)

    # D3 loan period, D4 renewals
    student_min_due_days = models.PositiveSmallIntegerField(default=10)
    flat_loan_days = models.PositiveSmallIntegerField(default=14)
    max_renewals = models.PositiveSmallIntegerField(default=2)

    # D5 replacement cost
    replacement_processing_fee = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("50.00"))
    replacement_default_cost = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("150.00"))

    # D6 registration fee
    registration_fee_junior = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("300.00"))
    registration_fee_senior = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("500.00"))
    junior_class_ids = models.JSONField(default=list, blank=True)

    # D17 notifications
    notify_sms_email_enabled = models.BooleanField(default=False)

    low_stock_ratio = models.DecimalField(max_digits=3, decimal_places=2, default=Decimal("0.34"))
    unscanned_flag_minutes = models.PositiveSmallIntegerField(default=5)
    undo_return_minutes = models.PositiveSmallIntegerField(default=10)

    # Counters
    po_sequence = models.PositiveIntegerField(default=0)
    donation_receipt_sequence = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_settings"
        verbose_name_plural = "library settings"
        constraints = [
            models.UniqueConstraint(fields=["school"], name="uq_library_settings_school"),
            models.CheckConstraint(
                condition=(
                    Q(fine_per_day__gte=0)
                    & Q(replacement_processing_fee__gte=0)
                    & Q(replacement_default_cost__gte=0)
                    & Q(registration_fee_junior__gte=0)
                    & Q(registration_fee_senior__gte=0)
                    & (Q(fine_cap__isnull=True) | Q(fine_cap__gte=0))
                ),
                name="ck_library_settings_amounts_nonneg",
            ),
            models.CheckConstraint(
                condition=Q(low_stock_ratio__gte=0) & Q(low_stock_ratio__lte=1),
                name="ck_library_settings_low_stock_ratio",
            ),
        ]

    def __str__(self):
        return f"Library settings (school {self.school_id})"
