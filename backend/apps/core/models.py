import re

from django.core.exceptions import ValidationError
from django.db import models
from decimal import Decimal


class AcademicYear(models.Model):
    BOARD_CHOICES = [
        ('CBSE', 'CBSE'),
        ('ICSE', 'ICSE'),
        ('State Board', 'State Board'),
        ('IB', 'IB (International Baccalaureate)'),
        ('IGCSE', 'IGCSE (Cambridge)'),
        ('NIOS', 'NIOS'),
        ('Other', 'Other'),
    ]
    
    TERM_CHOICES = [
        ('2 Terms (Semester)', '2 Terms (Semester)'),
        ('3 Terms (Trimester)', '3 Terms (Trimester)'),
        ('4 Terms (Quarter)', '4 Terms (Quarter)'),
    ]
    
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="academic_years")
    name = models.CharField(max_length=64, help_text="e.g. 2025-2026")
    board = models.CharField(max_length=100, choices=BOARD_CHOICES, blank=True, null=True, help_text="Board/Curriculum")
    number_of_terms = models.CharField(max_length=50, choices=TERM_CHOICES, blank=True, null=True, help_text="Number of terms per year")
    start_date = models.DateField()
    end_date = models.DateField()
    is_current = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "academic_years"
        ordering = ["-start_date"]
        constraints = [
            models.UniqueConstraint(fields=["school", "name"], name="uq_academic_year_school_name"),
        ]

    def save(self, *args, **kwargs):
        if self.is_current:
            AcademicYear.objects.filter(school=self.school, is_current=True).exclude(pk=self.pk).update(is_current=False)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Stream(models.Model):
    """Academic stream (e.g. Science, Commerce) applicable to Senior Secondary classes."""

    DEFAULT_NAMES = ["Science", "Commerce", "Humanities / Arts", "Vocational"]
    NAME_REGEX = re.compile(r"^[A-Za-z][A-Za-z0-9 /&.\-]{0,49}$")

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="streams")
    name = models.CharField(max_length=50)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "academic_streams"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["school", "name"], name="uq_stream_school_name"),
        ]

    @classmethod
    def ensure_defaults(cls, school):
        for default_name in cls.DEFAULT_NAMES:
            cls.objects.get_or_create(school=school, name=default_name)

    def clean(self):
        cleaned = " ".join((self.name or "").strip().split())
        if not cleaned:
            raise ValidationError({"name": "Stream name is required."})
        if not self.NAME_REGEX.fullmatch(cleaned):
            raise ValidationError({"name": "Stream name must start with a letter and contain only letters, numbers, spaces, / & . -."})
        self.name = cleaned

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Class(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="classes")
    name = models.CharField(max_length=64, help_text="e.g. Grade 1, Class 10")
    numeric_order = models.PositiveSmallIntegerField(default=0, help_text="For sorting")
    is_active = models.BooleanField(default=True)
    streams = models.ManyToManyField(
        Stream,
        through="ClassStream",
        blank=True,
        related_name="classes",
        help_text="Applicable to Senior Secondary (Grade 11-12).",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class_names = ["Nursery", "LKG", "UKG"] + [f"Grade {index}" for index in range(1, 13)]

    class Meta:
        db_table = "school_classes"
        ordering = ["numeric_order", "name", "id"]
        constraints = [
            models.UniqueConstraint(fields=["school", "name"], name="uq_class_school_name"),
        ]

    @staticmethod
    def normalize_name(name):
        cleaned = " ".join((name or "").strip().split())
        if not cleaned:
            return None

        upper = cleaned.upper()
        if upper == "NURSERY":
            return "Nursery"
        if upper == "LKG":
            return "LKG"
        if upper == "UKG":
            return "UKG"

        match = re.fullmatch(r"(?:GRADE\s*)?([1-9]|1[0-2])", upper)
        if match:
            return f"Grade {int(match.group(1))}"

        return None

    @classmethod
    def resolve_numeric_order(cls, name):
        normalized = cls.normalize_name(name)
        if normalized == "Nursery":
            return 1
        if normalized == "LKG":
            return 2
        if normalized == "UKG":
            return 3

        match = re.fullmatch(r"Grade ([1-9]|1[0-2])", normalized or "")
        if match:
            return int(match.group(1)) + 3

        return 1000

    # Level group is derived from numeric_order rather than stored as its own
    # column: `save()` above already forces `name`/`numeric_order` to one of a
    # fixed set of values (Nursery/LKG/UKG/Grade 1-12), so a stored `level`
    # field would just be a second source of truth that could drift out of
    # sync. Ranges mirror the Academics Timetable prototype's level groups.
    LEVEL_GROUPS = [
        ("pre_primary", "Pre-Primary", range(1, 4)),        # Nursery, LKG, UKG
        ("primary", "Primary", range(4, 9)),                 # Grade 1-5
        ("middle", "Middle", range(9, 12)),                  # Grade 6-8
        ("secondary", "Secondary", range(12, 14)),           # Grade 9-10
        ("senior_secondary", "Senior Secondary", range(14, 16)),  # Grade 11-12
    ]

    @property
    def level(self):
        for code, _label, order_range in self.LEVEL_GROUPS:
            if self.numeric_order in order_range:
                return code
        return None

    @classmethod
    def valid_class_options(cls):
        return [{"value": name, "label": name} for name in cls.class_names]

    def save(self, *args, **kwargs):
        normalized_name = self.normalize_name(self.name)
        if not normalized_name:
            raise ValidationError({"name": "Class name must be Nursery, LKG, UKG, or Grade 1 to Grade 12."})

        self.name = normalized_name
        self.numeric_order = self.resolve_numeric_order(normalized_name)

        update_fields = kwargs.get("update_fields")
        if update_fields is not None:
            update_fields = set(update_fields)
            update_fields.update({"name", "numeric_order"})
            kwargs["update_fields"] = list(update_fields)

        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Section(models.Model):
    school_class = models.ForeignKey(Class, on_delete=models.CASCADE, related_name="sections")
    name = models.CharField(max_length=32, help_text="e.g. A, B, Red")
    capacity = models.PositiveSmallIntegerField(default=40)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "class_sections"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["school_class", "name"], name="uq_section_class_name"),
        ]

    def __str__(self):
        return f"{self.school_class.name} - {self.name}"


class ClassStream(models.Model):
    """Per-class stream link with its own capacity (Senior Secondary only)."""

    MIN_CAPACITY = 1
    MAX_CAPACITY = 200

    school_class = models.ForeignKey(Class, on_delete=models.CASCADE, related_name="class_streams")
    stream = models.ForeignKey(Stream, on_delete=models.CASCADE, related_name="class_links")
    capacity = models.PositiveSmallIntegerField(default=40)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "class_streams"
        ordering = ["stream__name"]
        constraints = [
            models.UniqueConstraint(fields=["school_class", "stream"], name="uq_class_stream"),
        ]

    def clean(self):
        if self.capacity is None or self.capacity < self.MIN_CAPACITY or self.capacity > self.MAX_CAPACITY:
            raise ValidationError({
                "capacity": f"Capacity must be between {self.MIN_CAPACITY} and {self.MAX_CAPACITY} students per stream."
            })

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.school_class.name} \u2014 {self.stream.name} ({self.capacity})"


class Subject(models.Model):
    SUBJECT_TYPE_CHOICES = [
        ("compulsory", "Compulsory"),
        ("elective", "Elective"),
        ("optional", "Optional"),
    ]
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="subjects")
    name = models.CharField(max_length=128)
    code = models.CharField(max_length=32, blank=True)
    subject_type = models.CharField(max_length=16, choices=SUBJECT_TYPE_CHOICES, default="compulsory")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "subjects"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["school", "name"], name="uq_subject_school_name"),
        ]

    def __str__(self):
        return self.name


class ClassPeriod(models.Model):
    PERIOD_TYPE_CHOICES = [
        ("class", "Class"),
        ("exam", "Exam"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="class_periods")
    period = models.CharField(max_length=100)
    start_time = models.TimeField()
    end_time = models.TimeField()
    period_type = models.CharField(max_length=10, choices=PERIOD_TYPE_CHOICES, default="class")
    is_break = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "class_periods"
        ordering = ["start_time", "period"]
        constraints = [
            models.UniqueConstraint(fields=["school", "period", "period_type"], name="uq_class_period_school_name_type"),
        ]

    def __str__(self):
        return self.period


class ClassRoom(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="class_rooms")
    room_no = models.CharField(max_length=50)
    floor = models.CharField(max_length=64, blank=True, default="", help_text="e.g. Ground, First, Block A")
    capacity = models.PositiveIntegerField(null=True, blank=True)
    section = models.ForeignKey(
        "Section",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="class_rooms",
        help_text="Optional default section assigned to this room",
    )
    active_status = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "class_rooms"
        ordering = ["room_no"]
        constraints = [
            models.UniqueConstraint(fields=["school", "room_no"], name="uq_class_room_school_room_no"),
        ]

    def __str__(self):
        return self.room_no


class LevelScheduleConfig(models.Model):
    """
    Working-hours configuration for one level group (Pre-Primary, Primary, ...)
    for one academic year — start/end time, period length, breaks, bus
    dispersal, and working days. Feeds the Timetable module's period grid.
    Nothing writes here yet; this is schema-only until the Timetable
    frontend is built.
    """

    LEVEL_GROUP_CHOICES = [(code, label) for code, label, _range in Class.LEVEL_GROUPS]

    WEEKDAY_CHOICES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="level_schedule_configs")
    academic_year = models.ForeignKey(
        "AcademicYear",
        on_delete=models.CASCADE,
        related_name="level_schedule_configs",
    )
    level_group = models.CharField(max_length=20, choices=LEVEL_GROUP_CHOICES)
    start_time = models.TimeField()
    end_time = models.TimeField()
    period_duration_minutes = models.PositiveSmallIntegerField()
    periods_per_day = models.PositiveSmallIntegerField(
        help_text="Server-computed on save from start/end time, period duration, and break durations.",
    )
    snack_break_after_period = models.PositiveSmallIntegerField(null=True, blank=True)
    snack_break_minutes = models.PositiveSmallIntegerField(null=True, blank=True)
    lunch_break_after_period = models.PositiveSmallIntegerField(null=True, blank=True)
    lunch_break_minutes = models.PositiveSmallIntegerField(null=True, blank=True)
    bus_dispersal_time = models.TimeField(null=True, blank=True)
    pickup_time = models.TimeField(null=True, blank=True)
    working_days = models.JSONField(
        default=list,
        blank=True,
        help_text=f"List of weekday codes, e.g. {WEEKDAY_CHOICES[:5]}",
    )
    is_configured = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "level_schedule_configs"
        ordering = ["level_group"]
        constraints = [
            models.UniqueConstraint(
                fields=["school", "academic_year", "level_group"],
                name="uq_level_schedule_config_scope",
            ),
        ]

    def __str__(self):
        return f"{self.get_level_group_display()} ({self.academic_year_id})"


# ===== INVENTORY MODULE =====
class ItemCategory(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="item_categories")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "item_categories"
        ordering = ["title"]
        constraints = [
            models.UniqueConstraint(fields=["school", "title"], name="uq_item_category_school_title"),
        ]

    def __str__(self):
        return self.title


class ItemStore(models.Model):
    """Storage locations/warehouses"""
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="item_stores")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    location = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "item_stores"
        ordering = ["title"]
        constraints = [
            models.UniqueConstraint(fields=["school", "title"], name="uq_item_store_school_title"),
        ]

    def __str__(self):
        return self.title


class Supplier(models.Model):
    """Vendors/Suppliers"""
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="suppliers")
    name = models.CharField(max_length=200)
    contact_person = models.CharField(max_length=200, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=20, blank=True)
    address = models.TextField(blank=True)
    city = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=100, blank=True)
    tax_id = models.CharField(max_length=50, blank=True)
    payment_terms = models.CharField(max_length=100, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "suppliers"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["school", "name"], name="uq_supplier_school_name"),
        ]

    def __str__(self):
        return self.name


class Item(models.Model):
    """Inventory items with stock tracking"""
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="inventory_items")
    category = models.ForeignKey(ItemCategory, on_delete=models.SET_NULL, null=True, blank=True, related_name="items")
    item_code = models.CharField(max_length=100)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    unit = models.CharField(max_length=50, default="piece")
    quantity = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    reorder_level = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    unit_cost = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    unit_price = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    supplier = models.ForeignKey(Supplier, on_delete=models.SET_NULL, null=True, blank=True, related_name="items")
    item_photo = models.CharField(max_length=300, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "items"
        ordering = ["item_code", "name"]
        constraints = [
            models.UniqueConstraint(fields=["school", "item_code"], name="uq_item_school_code"),
        ]

    def __str__(self):
        return f"{self.item_code} - {self.name}"


class ItemReceive(models.Model):
    """Purchase/Receive transactions"""
    PAYMENT_STATUS_PAID = "P"
    PAYMENT_STATUS_UNPAID = "U"
    PAYMENT_STATUS_PARTIAL = "PP"
    PAYMENT_STATUS_CHOICES = [
        (PAYMENT_STATUS_PAID, "Paid"),
        (PAYMENT_STATUS_UNPAID, "Unpaid"),
        (PAYMENT_STATUS_PARTIAL, "Partially Paid"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="item_receives")
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="receives")
    receive_date = models.DateField()
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    discount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    tax = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    payment_status = models.CharField(max_length=2, choices=PAYMENT_STATUS_CHOICES, default=PAYMENT_STATUS_UNPAID)
    paid_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    reference_no = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey("users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="item_receives_created")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "item_receives"
        ordering = ["-receive_date", "-created_at"]

    def __str__(self):
        return f"Receive {self.id} - {self.supplier.name}"


class ItemReceiveChild(models.Model):
    """Line items for purchase transactions"""
    receive = models.ForeignKey(ItemReceive, on_delete=models.CASCADE, related_name="line_items")
    item = models.ForeignKey(Item, on_delete=models.PROTECT)
    quantity = models.DecimalField(max_digits=12, decimal_places=2)
    unit_cost = models.DecimalField(max_digits=10, decimal_places=2)
    total_cost = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    class Meta:
        db_table = "item_receive_children"

    def save(self, *args, **kwargs):
        self.total_cost = self.quantity * self.unit_cost
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.receive.id} - {self.item.name}"


class ItemIssue(models.Model):
    """Item distribution/allocation"""
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="item_issues")
    issue_date = models.DateField()
    store = models.ForeignKey(ItemStore, on_delete=models.SET_NULL, null=True, blank=True)
    subject = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    issued_by = models.ForeignKey("users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="item_issues_issued")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "item_issues"
        ordering = ["-issue_date"]

    def __str__(self):
        return f"Issue {self.id}"


class ItemSell(models.Model):
    """Sales/Distribution transactions"""
    PAYMENT_STATUS_PAID = "P"
    PAYMENT_STATUS_UNPAID = "U"
    PAYMENT_STATUS_PARTIAL = "PP"
    PAYMENT_STATUS_CHOICES = [
        (PAYMENT_STATUS_PAID, "Paid"),
        (PAYMENT_STATUS_UNPAID, "Unpaid"),
        (PAYMENT_STATUS_PARTIAL, "Partially Paid"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="item_sells")
    sell_date = models.DateField()
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    discount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    tax = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    payment_status = models.CharField(max_length=2, choices=PAYMENT_STATUS_CHOICES, default=PAYMENT_STATUS_UNPAID)
    paid_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    reference_no = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    sold_to = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey("users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="item_sells_created")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "item_sells"
        ordering = ["-sell_date", "-created_at"]

    def __str__(self):
        return f"Sell {self.id}"


class ItemSellChild(models.Model):
    """Line items for sales transactions"""
    sell = models.ForeignKey(ItemSell, on_delete=models.CASCADE, related_name="line_items")
    item = models.ForeignKey(Item, on_delete=models.PROTECT)
    quantity = models.DecimalField(max_digits=12, decimal_places=2)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    total_price = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    class Meta:
        db_table = "item_sell_children"

    def save(self, *args, **kwargs):
        self.total_price = self.quantity * self.unit_price
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.sell.id} - {self.item.name}"


# ===== HOLIDAY CALENDAR =====
class Holiday(models.Model):
    TYPE_CHOICES = [
        ("public",    "Public Holiday"),
        ("religious", "Religious"),
        ("national",  "National"),
        ("school",    "School Event"),
        ("other",     "Other"),
    ]

    AUDIENCE_ALL = "all"
    AUDIENCE_STAFF_ONLY = "staff_only"
    AUDIENCE_CHOICES = [
        (AUDIENCE_ALL, "All (students & staff)"),
        (AUDIENCE_STAFF_ONLY, "Staff only"),
    ]

    school        = models.ForeignKey(
        "tenancy.School", on_delete=models.CASCADE, related_name="holidays", null=True, blank=True,
        help_text="Null = applies to every school (e.g. a national holiday declared platform-wide).",
    )
    academic_year = models.ForeignKey(
        "core.AcademicYear",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="holidays",
    )
    name          = models.CharField(max_length=120)
    date          = models.DateField()
    end_date      = models.DateField(null=True, blank=True, help_text="Optional - for multi-day holidays")
    holiday_type  = models.CharField(max_length=20, choices=TYPE_CHOICES, default="public")
    description   = models.CharField(max_length=255, blank=True, default="")
    active_status = models.BooleanField(default=True)
    # Default "all" preserves existing Foundation behavior exactly; only
    # apps.settings' staff-only holiday creation ever sets "staff_only".
    audience      = models.CharField(max_length=16, choices=AUDIENCE_CHOICES, default=AUDIENCE_ALL)
    # "Restricted" holiday — staff may individually opt in rather than it
    # being mandatory for everyone. Default False preserves existing behavior.
    is_optional   = models.BooleanField(default=False)
    created_at    = models.DateTimeField(auto_now_add=True)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "holidays"
        ordering = ["-date", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["school", "date", "name"],
                name="uq_holiday_school_date_name",
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.date})"

