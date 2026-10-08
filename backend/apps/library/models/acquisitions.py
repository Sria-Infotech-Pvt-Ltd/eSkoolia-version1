from decimal import Decimal

from django.db import models
from django.db.models import Q

from .base import LibraryAuditModel


class PurchaseOrder(LibraryAuditModel):
    """A purchase order (blueprint 2.2 table 10). Vendors are free text (D10)."""

    STATUS_ORDERED = "ordered"
    STATUS_RECEIVED = "received"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [(STATUS_ORDERED, "Ordered"), (STATUS_RECEIVED, "Received"), (STATUS_CANCELLED, "Cancelled")]

    PAYMENT_PENDING = "pending"
    PAYMENT_PAID = "paid"
    PAYMENT_CHOICES = [(PAYMENT_PENDING, "Pending"), (PAYMENT_PAID, "Paid")]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="library_purchase_orders")
    # Server generated from the settings counter when left blank.
    po_number = models.CharField(max_length=30)
    order_date = models.DateField()
    vendor_name = models.CharField(max_length=180)
    invoice_number = models.CharField(max_length=60, blank=True)
    books_count = models.PositiveIntegerField()
    total_cost = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_ORDERED)
    payment_status = models.CharField(max_length=10, choices=PAYMENT_CHOICES, default=PAYMENT_PENDING)
    # For budget reporting (D9). Set to the current academic year when the order is made.
    academic_year = models.ForeignKey("core.AcademicYear", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_purchase_orders"
        ordering = ["-order_date", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["school", "po_number"], name="uq_library_purchase_orders_school_po"),
            models.CheckConstraint(condition=Q(books_count__gte=1), name="ck_library_po_books_count_min"),
            models.CheckConstraint(condition=Q(total_cost__gte=0), name="ck_library_po_total_nonneg"),
        ]
        indexes = [
            models.Index(fields=["school", "order_date"], name="idx_lib_po_school_date"),
            models.Index(fields=["school", "academic_year", "status"], name="idx_lib_po_school_year_st"),
        ]

    def __str__(self):
        return self.po_number


class Donation(LibraryAuditModel):
    """A donation of books (table 11). Donor name and contact are personal data: never logged or put in notifications."""

    TYPE_PARENT = "parent"
    TYPE_ALUMNI = "alumni"
    TYPE_STAFF = "staff"
    TYPE_PUBLISHER = "publisher"
    TYPE_NGO_TRUST = "ngo_trust"
    TYPE_CHOICES = [
        (TYPE_PARENT, "Parent"),
        (TYPE_ALUMNI, "Alumni"),
        (TYPE_STAFF, "Staff"),
        (TYPE_PUBLISHER, "Publisher"),
        (TYPE_NGO_TRUST, "NGO or trust"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="library_donations")
    donor_name = models.CharField(max_length=180)
    donor_type = models.CharField(max_length=12, choices=TYPE_CHOICES, default=TYPE_PARENT)
    contact = models.CharField(max_length=120, blank=True)
    donation_date = models.DateField()
    books_count = models.PositiveIntegerField()
    estimated_value = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    receipt_no = models.CharField(max_length=30)
    acknowledgement_sent = models.BooleanField(default=False)
    acknowledgement_sent_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_donations"
        ordering = ["-donation_date", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["school", "receipt_no"], name="uq_library_donations_school_receipt"),
            models.CheckConstraint(condition=Q(books_count__gte=1), name="ck_library_donations_books_min"),
            models.CheckConstraint(condition=Q(estimated_value__gte=0), name="ck_library_donations_value_nonneg"),
        ]
        indexes = [models.Index(fields=["school", "donation_date"], name="idx_lib_don_school_date")]

    def __str__(self):
        return self.receipt_no


class Budget(LibraryAuditModel):
    """The library budget for one academic year (table 12)."""

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="library_budgets")
    academic_year = models.ForeignKey("core.AcademicYear", on_delete=models.PROTECT, related_name="+")
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_budgets"
        constraints = [
            models.UniqueConstraint(fields=["school", "academic_year"], name="uq_library_budgets_school_year"),
            models.CheckConstraint(condition=Q(amount__gte=0), name="ck_library_budgets_amount_nonneg"),
        ]

    def __str__(self):
        return f"Budget {self.academic_year_id}: {self.amount}"


class BookRequest(LibraryAuditModel):
    """A teacher's recommendation for a new title (table 17). Created from the teacher portal; reviewed here."""

    STATUS_PENDING = "pending"
    STATUS_APPROVED = "approved"
    STATUS_REJECTED = "rejected"
    STATUS_ORDERED = "ordered"
    STATUS_FULFILLED = "fulfilled"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_REJECTED, "Rejected"),
        (STATUS_ORDERED, "Ordered"),
        (STATUS_FULFILLED, "Fulfilled"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="library_book_requests")
    requested_by = models.ForeignKey("users.User", on_delete=models.PROTECT, related_name="+")
    school_class = models.ForeignKey("core.Class", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    section = models.ForeignKey("core.Section", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    title = models.CharField(max_length=255)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_PENDING)
    reviewed_by = models.ForeignKey("users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True)
    linked_book = models.ForeignKey("library.Book", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_book_requests"
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["school", "status"], name="idx_lib_req_school_status"),
            models.Index(fields=["school", "requested_by"], name="idx_lib_req_school_user"),
        ]

    def __str__(self):
        return f"{self.title} ({self.status})"
