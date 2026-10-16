from django.db import models

from .base import LibraryAuditModel


class LibraryActivityLog(LibraryAuditModel):
    """Immutable feed of library events. Written only through services.activity.log_event.
    """

    EVENT_ACCESSION = "accession"
    EVENT_ISSUE = "issue"
    EVENT_RETURN = "return"
    EVENT_RENEWAL = "renewal"
    EVENT_LOST = "lost"
    EVENT_DAMAGED = "damaged"
    EVENT_FINE = "fine"
    EVENT_DONATION = "donation"
    EVENT_PURCHASE = "purchase"
    EVENT_MEMBER = "member"
    EVENT_HOLD = "hold"
    EVENT_REQUEST = "request"
    EVENT_REMINDER = "reminder"
    EVENT_AUDIT = "audit"
    EVENT_SETTINGS = "settings"
    EVENT_EXPORT = "export"
    EVENT_CHOICES = [
        (EVENT_ACCESSION, "Accession"),
        (EVENT_ISSUE, "Issue"),
        (EVENT_RETURN, "Return"),
        (EVENT_RENEWAL, "Renewal"),
        (EVENT_LOST, "Lost"),
        (EVENT_DAMAGED, "Damaged"),
        (EVENT_FINE, "Fine"),
        (EVENT_DONATION, "Donation"),
        (EVENT_PURCHASE, "Purchase"),
        (EVENT_MEMBER, "Member"),
        (EVENT_HOLD, "Hold"),
        (EVENT_REQUEST, "Request"),
        (EVENT_REMINDER, "Reminder"),
        (EVENT_AUDIT, "Audit"),
        (EVENT_SETTINGS, "Settings"),
        (EVENT_EXPORT, "Export"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="library_activity_logs")
    actor = models.ForeignKey(
        "users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    event_type = models.CharField(max_length=16, choices=EVENT_CHOICES)
    summary = models.CharField(max_length=500)
    book = models.ForeignKey("library.Book", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    copy = models.ForeignKey("library.BookCopy", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    member = models.ForeignKey("library.LibraryMember", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    issue = models.ForeignKey("library.BookIssue", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_activity_logs"
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["school", "created_at"], name="idx_lib_act_school_created"),
            models.Index(fields=["school", "event_type", "created_at"], name="idx_lib_act_school_type_ts"),
            models.Index(fields=["school", "member", "created_at"], name="idx_lib_act_school_member_ts"),
        ]

    def __str__(self):
        return f"{self.event_type}: {self.summary[:60]}"
