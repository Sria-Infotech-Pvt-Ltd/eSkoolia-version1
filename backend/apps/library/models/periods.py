from django.db import models
from django.db.models import Q

from .base import LibraryAuditModel

DAY_CHOICES = [("Mon", "Monday"), ("Tue", "Tuesday"), ("Wed", "Wednesday"), ("Thu", "Thursday"), ("Fri", "Friday"), ("Sat", "Saturday")]
DAYS = tuple(value for value, _label in DAY_CHOICES)


class PeriodSlot(LibraryAuditModel):
    """A library period for a class (decision D8): the class comes to the library on `day` during `period`."""

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="library_period_slots")
    school_class = models.ForeignKey("core.Class", on_delete=models.CASCADE, related_name="+")
    # Blank means every section of the class.
    section = models.ForeignKey("core.Section", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    day = models.CharField(max_length=3, choices=DAY_CHOICES)
    period = models.ForeignKey("core.ClassPeriod", on_delete=models.PROTECT, related_name="+")
    room_label = models.CharField(max_length=50, default="Main Library")
    supervisor = models.ForeignKey("hr.Staff", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_period_slots"
        ordering = ["day", "period__start_time", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["school", "school_class", "section", "day", "period"], name="uq_library_period_slots_class_slot"
            ),
            # NULL sections never collide in a plain unique constraint, so a class-wide slot gets its own.
            models.UniqueConstraint(
                fields=["school", "school_class", "day", "period"],
                condition=Q(section__isnull=True),
                name="uq_library_period_slots_class_wide",
            ),
            models.UniqueConstraint(
                fields=["school", "room_label", "day", "period"], name="uq_library_period_slots_room_slot"
            ),
        ]
        indexes = [models.Index(fields=["school", "day", "period"], name="idx_lib_slot_school_day_per")]

    def __str__(self):
        return f"{self.day} {self.period_id} {self.room_label}"


class Visit(LibraryAuditModel):
    """One member checking in to one period slot on one date. Repeating the check-in changes nothing."""

    METHOD_CARD_TAP = "card_tap"
    METHOD_MANUAL = "manual"
    METHOD_CAMERA = "camera"
    METHOD_CHOICES = [(METHOD_CARD_TAP, "Card tap"), (METHOD_MANUAL, "Manual"), (METHOD_CAMERA, "Camera")]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="library_visits")
    period_slot = models.ForeignKey(PeriodSlot, on_delete=models.PROTECT, related_name="visits")
    member = models.ForeignKey("library.LibraryMember", on_delete=models.PROTECT, related_name="visits")
    visit_date = models.DateField()
    checked_in_at = models.DateTimeField()
    method = models.CharField(max_length=10, choices=METHOD_CHOICES, default=METHOD_CARD_TAP)

    class Meta:
        db_table = "library_visits"
        ordering = ["-checked_in_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["school", "period_slot", "member", "visit_date"], name="uq_library_visits_slot_member_date"
            ),
        ]
        indexes = [
            models.Index(fields=["school", "visit_date"], name="idx_lib_visit_school_date"),
            models.Index(fields=["school", "period_slot", "visit_date"], name="idx_lib_visit_school_slot_dt"),
        ]

    def __str__(self):
        return f"visit {self.member_id} {self.visit_date}"
