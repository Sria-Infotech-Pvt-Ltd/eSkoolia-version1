from decimal import Decimal

from django.db import models
from django.db.models import Q

from .base import LibraryAuditModel


class BookCategory(LibraryAuditModel):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="book_categories")
    name = models.CharField(max_length=120)
    # Uppercase accession prefix. Derived from the name on create; editable only
    # while the category has no titles (the serializer enforces it).
    code = models.CharField(max_length=8, blank=True, default="")
    # A design-token key, never a hex value (blueprint 8.4).
    color_key = models.CharField(max_length=24, blank=True, default="")
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    # Accession counter. Only services.numbering increments it, under a row lock.
    next_sequence = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_book_categories"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["school", "name"], name="uq_lib_cat_school_name"),
            models.UniqueConstraint(fields=["school", "code"], name="uq_library_book_categories_school_code"),
        ]
        indexes = [
            models.Index(fields=["school", "is_active"], name="idx_lib_cat_school_active"),
        ]

    def __str__(self):
        return self.name


class Book(LibraryAuditModel):
    AGE_EARLY_YEARS = "early_years"
    AGE_PRIMARY = "primary"
    AGE_MIDDLE = "middle"
    AGE_SENIOR = "senior"
    AGE_STAFF_ADULT = "staff_adult"
    AGE_BAND_CHOICES = [
        (AGE_EARLY_YEARS, "Early years"),
        (AGE_PRIMARY, "Primary"),
        (AGE_MIDDLE, "Middle"),
        (AGE_SENIOR, "Senior"),
        (AGE_STAFF_ADULT, "Staff and adult"),
    ]

    FORMAT_FICTION = "fiction"
    FORMAT_NON_FICTION = "non_fiction"
    FORMAT_TEXTBOOK = "textbook"
    FORMAT_REFERENCE = "reference"
    FORMAT_PERIODICAL = "periodical"
    FORMAT_CHOICES = [
        (FORMAT_FICTION, "Fiction"),
        (FORMAT_NON_FICTION, "Non-fiction"),
        (FORMAT_TEXTBOOK, "Textbook"),
        (FORMAT_REFERENCE, "Reference"),
        (FORMAT_PERIODICAL, "Periodical"),
    ]

    SOURCE_PURCHASED = "purchased"
    SOURCE_DONATED = "donated"
    SOURCE_CHOICES = [
        (SOURCE_PURCHASED, "Purchased"),
        (SOURCE_DONATED, "Donated"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="books")
    # Nullable only for rows that predate categories; new titles must have one
    # (serializer rule). PROTECT: a category with titles cannot be deleted.
    category = models.ForeignKey(BookCategory, on_delete=models.PROTECT, null=True, blank=True, related_name="books")
    accession_code = models.CharField(max_length=40, blank=True, default="")
    call_number = models.CharField(max_length=40, blank=True, default="")
    title = models.CharField(max_length=255)
    author = models.CharField(max_length=180, blank=True, default="")
    isbn = models.CharField(max_length=40, blank=True)
    publisher = models.CharField(max_length=180, blank=True)
    publication_year = models.PositiveSmallIntegerField(null=True, blank=True)
    language = models.CharField(max_length=30, default="English")
    age_band = models.CharField(max_length=20, choices=AGE_BAND_CHOICES, default=AGE_PRIMARY)
    for_students = models.BooleanField(default=True)
    for_teachers = models.BooleanField(default=True)
    for_staff = models.BooleanField(default=True)
    format = models.CharField(max_length=24, choices=FORMAT_CHOICES, default=FORMAT_NON_FICTION)
    is_reference_only = models.BooleanField(default=False)
    cost_per_copy = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    edition = models.CharField(max_length=80, blank=True, default="")
    part_label = models.CharField(max_length=80, blank=True, default="")
    source = models.CharField(max_length=12, choices=SOURCE_CHOICES, default=SOURCE_PURCHASED)
    # Donor name is personal data: never copy it into logs.
    vendor_name = models.CharField(max_length=180, blank=True)
    donor_name = models.CharField(max_length=180, blank=True)
    rack = models.CharField(max_length=50, blank=True)
    remarks = models.TextField(blank=True)
    # DEPRECATED (blueprint 2.2): nothing writes these any more. Every count comes
    # from library_book_copies. Dropped in the final cleanup slice.
    quantity = models.PositiveIntegerField(default=0)
    available_quantity = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_books"
        ordering = ["title"]
        constraints = [
            models.UniqueConstraint(fields=["school", "accession_code"], name="uq_library_books_school_accession"),
            models.UniqueConstraint(
                fields=["school", "title", "author", "edition", "part_label"], name="uq_library_books_identity"
            ),
            models.CheckConstraint(
                condition=Q(for_students=True) | Q(for_teachers=True) | Q(for_staff=True),
                name="ck_library_books_audience_any",
            ),
            models.CheckConstraint(condition=Q(cost_per_copy__gte=0), name="ck_library_books_cost_nonneg"),
        ]
        indexes = [
            models.Index(fields=["school", "category"], name="idx_lib_books_school_cat"),
            models.Index(fields=["school", "age_band"], name="idx_lib_books_school_age"),
            models.Index(fields=["school", "rack"], name="idx_lib_books_school_rack"),
            models.Index(fields=["school", "title"], name="idx_lib_books_school_title"),
        ]

    def __str__(self):
        return self.title


class BookCopy(LibraryAuditModel):
    """One physical copy. Status is changed only by services, never by a client."""

    STATUS_AVAILABLE = "available"
    STATUS_ISSUED = "issued"
    STATUS_LOST = "lost"
    STATUS_DAMAGED = "damaged"
    STATUS_WITHDRAWN = "withdrawn"
    STATUS_CHOICES = [
        (STATUS_AVAILABLE, "Available"),
        (STATUS_ISSUED, "Issued"),
        (STATUS_LOST, "Lost"),
        (STATUS_DAMAGED, "Damaged"),
        (STATUS_WITHDRAWN, "Withdrawn"),
    ]

    CONDITION_NEW = "new"
    CONDITION_GOOD = "good"
    CONDITION_FAIR = "fair"
    CONDITION_WORN = "worn"
    CONDITION_DAMAGED = "damaged"
    CONDITION_CHOICES = [
        (CONDITION_NEW, "New"),
        (CONDITION_GOOD, "Good"),
        (CONDITION_FAIR, "Fair"),
        (CONDITION_WORN, "Worn"),
        (CONDITION_DAMAGED, "Damaged"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="book_copies")
    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="copies")
    # "<book accession_code>/C<n>". Never reused: copies are never deleted.
    code = models.CharField(max_length=50)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_AVAILABLE)
    condition = models.CharField(max_length=10, choices=CONDITION_CHOICES, default=CONDITION_GOOD)
    last_verified_on = models.DateField(null=True, blank=True)
    withdrawn_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_book_copies"
        ordering = ["book_id", "id"]
        constraints = [
            models.UniqueConstraint(fields=["school", "code"], name="uq_library_book_copies_school_code"),
        ]
        indexes = [
            models.Index(fields=["school", "book", "status"], name="idx_lib_copies_school_book_st"),
            models.Index(fields=["school", "status"], name="idx_lib_copies_school_status"),
            models.Index(fields=["school", "condition"], name="idx_lib_copies_school_cond"),
        ]

    def __str__(self):
        return self.code
