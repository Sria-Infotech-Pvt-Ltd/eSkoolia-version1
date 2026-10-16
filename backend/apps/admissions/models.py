from django.db import models
from django.core.exceptions import ValidationError
from django.utils import timezone

INQUIRY_STATUS_CHOICES = [
    ("new", "New"),
    ("contacted", "Contacted"),
    ("visited", "Visited"),
    ("enrolled", "Enrolled"),
    ("declined", "Declined"),
]

PIPELINE_STAGE_CHOICES = [
    ("new_lead", "New Lead"),
    ("first_contact", "First Contact"),
    ("campus_visit", "Campus Visit"),
    ("application_submitted", "Application Submitted"),
    ("documents_pending", "Documents Pending"),
    ("enrolled", "Enrolled"),
    ("declined", "Declined"),
]

CONTACT_CHANNEL_CHOICES = [
    ("call", "Call"),
    ("whatsapp", "WhatsApp"),
    ("sms", "SMS"),
    ("email", "Email"),
    ("walk_in", "Walk-in"),
]

CONTACT_DIRECTION_CHOICES = [
    ("outbound", "Outbound"),
    ("inbound", "Inbound"),
]

BULK_JOB_STATUS_CHOICES = [
    ("pending", "Pending"),
    ("running", "Running"),
    ("done", "Done"),
    ("failed", "Failed"),
]

BULK_JOB_ACTION_CHOICES = [
    ("send_whatsapp", "Send WhatsApp"),
    ("send_sms", "Send SMS"),
    ("send_email", "Send Email"),
    ("assign", "Assign"),
    ("update_status", "Update Status"),
    ("update_stage", "Update Stage"),
]

DOCUMENTS_STATUS_CHOICES = [
    ("not_requested", "Not Requested"),
    ("requested", "Requested"),
    ("partial", "Partial"),
    ("complete", "Complete"),
]


class PipelineStage(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="pipeline_stages")
    name = models.CharField(max_length=120)
    slug = models.CharField(max_length=60, choices=PIPELINE_STAGE_CHOICES, blank=True)
    order = models.PositiveSmallIntegerField(default=0)
    color = models.CharField(max_length=20, default="#6366f1")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "admission_pipeline_stages"
        ordering = ["order", "name"]
        unique_together = ("school", "name")

    def __str__(self):
        return self.name


class AIMessageTemplate(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="ai_message_templates")
    name = models.CharField(max_length=255)
    system_prompt = models.TextField(
        default=(
            "You are a helpful assistant that writes short, clear, and culturally appropriate messages "
            "for Indian school admissions. Produce two variants: Formal and Friendly. "
            "Keep messages under 220 characters for SMS/WhatsApp. Use the lead context to personalize."
        )
    )
    user_prompt_template = models.TextField(
        default=(
            "Lead context:\n"
            "- name: {{lead.name}}\n"
            "- child_grade: {{lead.grade_interest}}\n"
            "- next_step: {{next_step}}\n"
            "- source: {{lead.source}}\n"
            "- school_name: {{school.name}}\n"
            "Generate:\n"
            "1) Variant A (Formal): ...\n"
            "2) Variant B (Friendly): ...\n"
            "Also return the prompt used (redact PII in logs)."
        )
    )
    channel = models.CharField(max_length=20, choices=CONTACT_CHANNEL_CHOICES, default="whatsapp")
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        "users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="ai_templates_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "admission_ai_message_templates"
        ordering = ["name"]

    def __str__(self):
        return self.name


class AdmissionInquiry(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="admission_inquiries")
    full_name = models.CharField(max_length=255)
    phone = models.CharField(max_length=32, blank=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    description = models.TextField(blank=True)
    query_date = models.DateField(null=True, blank=True)
    follow_up_date = models.DateField(null=True, blank=True)
    next_follow_up_date = models.DateField(null=True, blank=True)
    assigned = models.CharField(max_length=255, blank=True)
    reference = models.ForeignKey(
        "admissions.AdminSetupEntry",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="admission_reference_inquiries",
    )
    source = models.ForeignKey(
        "admissions.AdminSetupEntry",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="admission_source_inquiries",
    )
    school_class = models.ForeignKey(
        "core.Class",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="admission_inquiries",
    )
    no_of_child = models.PositiveIntegerField(default=1)
    child_name = models.CharField(max_length=255, blank=True, help_text="Name of the child seeking admission")
    has_sibling_enrolled = models.CharField(
        max_length=3, blank=True, choices=[("yes", "Yes"), ("no", "No")],
        help_text="Does the family already have a sibling enrolled in this school?"
    )
    sibling_name = models.CharField(max_length=255, blank=True, help_text="Name of the enrolled sibling (if any)")
    active_status = models.PositiveSmallIntegerField(default=1)
    created_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_admission_inquiries",
    )
    class_name = models.CharField(max_length=120, blank=True)
    note = models.TextField(blank=True)
    status = models.CharField(max_length=32, choices=INQUIRY_STATUS_CHOICES, default="new")
    # --- Command Center Extension fields (additive, nullable) ---
    pipeline_stage = models.ForeignKey(
        "admissions.PipelineStage",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="inquiries",
    )
    lead_score = models.PositiveSmallIntegerField(default=0, help_text="Score 0-100 based on engagement signals")
    last_contacted_at = models.DateTimeField(null=True, blank=True)
    documents_status = models.CharField(
        max_length=20, choices=DOCUMENTS_STATUS_CHOICES, default="not_requested"
    )
    calendar_event_id = models.CharField(max_length=255, blank=True, help_text="External calendar event ID if synced")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def clean(self):
        if self.follow_up_date and self.follow_up_date > timezone.localdate():
            raise ValidationError({"follow_up_date": "Follow-up date cannot be in the future."})
        if self.next_follow_up_date and self.next_follow_up_date < timezone.localdate():
            raise ValidationError({"next_follow_up_date": "Next follow-up date cannot be in the past."})
        if self.follow_up_date and self.next_follow_up_date and self.next_follow_up_date < self.follow_up_date:
            raise ValidationError({"next_follow_up_date": "Next follow-up date must be on or after last follow-up date."})

    def __str__(self):
        return self.full_name

    class Meta:
        db_table = "admission_inquiries"
        ordering = ["-created_at"]


class AdmissionFollowUp(models.Model):
    inquiry = models.ForeignKey(AdmissionInquiry, on_delete=models.CASCADE, related_name="follow_ups")
    author = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="admission_follow_ups",
    )
    response = models.TextField(blank=True)
    note = models.TextField(blank=True)
    status_after = models.CharField(
        max_length=32,
        choices=INQUIRY_STATUS_CHOICES,
        blank=True,
        help_text="Inquiry status set at the time of this follow-up (optional)",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "admission_follow_ups"
        ordering = ["created_at"]


class VisitorBookEntry(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="visitor_book_entries")
    purpose = models.CharField(max_length=255)
    name = models.CharField(max_length=255)
    phone = models.CharField(max_length=32, blank=True)
    visitor_id = models.CharField(max_length=64)
    no_of_person = models.PositiveIntegerField(default=1)
    date = models.DateField()
    in_time = models.CharField(max_length=32)
    out_time = models.CharField(max_length=32)
    file_url = models.FileField(upload_to="admissions/visitor_book/", blank=True, null=True)
    created_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="visitor_book_entries_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "visitor_book_entries"
        ordering = ["-created_at"]


class ComplaintType(models.Model):
    """Master data for complaint types (Academic Issue, Fee & Billing, Transport, etc.)"""
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="complaint_types")
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "complaint_types"
        unique_together = ("school", "name")
        ordering = ["name"]

    def __str__(self):
        return self.name


class ComplaintSource(models.Model):
    """Master data for complaint sources (Parent, Student, Staff, Email, Phone Call, etc.)"""
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="complaint_sources")
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "complaint_sources"
        unique_together = ("school", "name")
        ordering = ["name"]

    def __str__(self):
        return self.name


class ComplaintEntry(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="complaint_entries")
    complaint_by = models.CharField(max_length=255)
    complaint_type = models.ForeignKey("ComplaintType", on_delete=models.PROTECT, null=True, blank=True, related_name="complaints")
    complaint_source = models.ForeignKey("ComplaintSource", on_delete=models.PROTECT, null=True, blank=True, related_name="complaints")
    phone = models.CharField(max_length=32, blank=True)
    date = models.DateField(null=True, blank=True)
    action_taken = models.CharField(max_length=500, blank=True)
    assigned_to = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_complaints",
    )
    description = models.TextField(blank=True)
    file = models.FileField(upload_to="admissions/complaints/", blank=True, null=True)
    created_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="complaint_entries_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "complaint_entries"
        ordering = ["-created_at"]


class PostalReceiveEntry(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="postal_receive_entries")
    from_title = models.CharField(max_length=255)
    reference_no = models.CharField(max_length=120)
    address = models.CharField(max_length=255)
    note = models.TextField(blank=True)
    to_title = models.CharField(max_length=255)
    date = models.DateField(null=True, blank=True)
    file = models.FileField(upload_to="admissions/postal_receive/", blank=True, null=True)
    created_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="postal_receive_entries_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "postal_receive_entries"
        ordering = ["-created_at"]


class PostalDispatchEntry(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="postal_dispatch_entries")
    from_title = models.CharField(max_length=255)
    reference_no = models.CharField(max_length=120)
    address = models.CharField(max_length=255)
    note = models.TextField(blank=True)
    to_title = models.CharField(max_length=255)
    date = models.DateField(null=True, blank=True)
    file = models.FileField(upload_to="admissions/postal_dispatch/", blank=True, null=True)
    created_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="postal_dispatch_entries_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "postal_dispatch_entries"
        ordering = ["-created_at"]


PHONE_CALL_TYPE_CHOICES = [
    ("I", "Incoming"),
    ("O", "Outgoing"),
]


class PhoneCallLogEntry(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="phone_call_log_entries")
    name = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=32)
    date = models.DateField(null=True, blank=True)
    next_follow_up_date = models.DateField(null=True, blank=True)
    call_duration = models.CharField(max_length=120, blank=True)
    description = models.TextField(blank=True)
    call_type = models.CharField(max_length=1, choices=PHONE_CALL_TYPE_CHOICES, default="I")
    created_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="phone_call_log_entries_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "phone_call_log_entries"
        ordering = ["-created_at"]


ADMIN_SETUP_TYPE_CHOICES = [
    ("1", "Purpose"),
    ("2", "Complaint Type"),
    ("3", "Source"),
    ("4", "Reference"),
]


class AdminSetupEntry(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="admin_setup_entries")
    type = models.CharField(max_length=1, choices=ADMIN_SETUP_TYPE_CHOICES)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="admin_setup_entries_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "admin_setup_entries"
        ordering = ["type", "name"]
        unique_together = ("school", "type", "name")


ID_CARD_LAYOUT_CHOICES = [
    ("horizontal", "Horizontal"),
    ("vertical", "Vertical"),
]


ID_CARD_PHOTO_STYLE_CHOICES = [
    ("squre", "Square"),
    ("round", "Round"),
]


class IdCardTemplate(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="id_card_templates")
    title = models.CharField(max_length=255)
    page_layout_style = models.CharField(max_length=16, choices=ID_CARD_LAYOUT_CHOICES, default="horizontal")
    applicable_role_ids = models.JSONField(default=list, blank=True)
    pl_width = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    pl_height = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    user_photo_style = models.CharField(max_length=16, choices=ID_CARD_PHOTO_STYLE_CHOICES, default="squre")
    user_photo_width = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    user_photo_height = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    t_space = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    b_space = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    l_space = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    r_space = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    background_img = models.FileField(upload_to="admissions/id_cards/backgrounds/", blank=True, null=True)
    profile_image = models.FileField(upload_to="admissions/id_cards/profiles/", blank=True, null=True)
    logo = models.FileField(upload_to="admissions/id_cards/logos/", blank=True, null=True)
    signature = models.FileField(upload_to="admissions/id_cards/signatures/", blank=True, null=True)
    created_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="id_card_templates_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "id_card_templates"
        ordering = ["-created_at"]


CERTIFICATE_TYPE_CHOICES = [
    ("School", "School"),
    ("Lms", "Lms"),
]


class CertificateTemplate(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="certificate_templates")
    type = models.CharField(max_length=16, choices=CERTIFICATE_TYPE_CHOICES, default="School")
    title = models.CharField(max_length=255)
    applicable_role_id = models.IntegerField(null=True, blank=True)
    background_height = models.DecimalField(max_digits=8, decimal_places=2, default=144)
    background_width = models.DecimalField(max_digits=8, decimal_places=2, default=165)
    padding_top = models.DecimalField(max_digits=8, decimal_places=2, default=5)
    padding_right = models.DecimalField(max_digits=8, decimal_places=2, default=5)
    padding_bottom = models.DecimalField(max_digits=8, decimal_places=2, default=5)
    pading_left = models.DecimalField(max_digits=8, decimal_places=2, default=5)
    body = models.TextField()
    background_image = models.FileField(upload_to="admissions/certificates/backgrounds/", blank=True, null=True)
    created_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="certificate_templates_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "certificate_templates"
        ordering = ["-created_at"]


# ──────────────────────────────────────────────────────────────────────────────
# Command Center models
# ──────────────────────────────────────────────────────────────────────────────

class ContactLog(models.Model):
    """Records every outreach attempt (call, WhatsApp, SMS, email) against an inquiry."""
    inquiry = models.ForeignKey(AdmissionInquiry, on_delete=models.CASCADE, related_name="contact_logs")
    channel = models.CharField(max_length=20, choices=CONTACT_CHANNEL_CHOICES)
    direction = models.CharField(max_length=10, choices=CONTACT_DIRECTION_CHOICES, default="outbound")
    status = models.CharField(max_length=32, default="initiated", help_text="initiated, delivered, failed, answered")
    provider_message_id = models.CharField(max_length=255, blank=True, help_text="Provider-assigned message/call ID")
    call_session_id = models.CharField(max_length=255, blank=True)
    call_url = models.URLField(blank=True)
    subject = models.CharField(max_length=255, blank=True)
    body = models.TextField(blank=True)
    template_id = models.IntegerField(null=True, blank=True)
    performed_by = models.ForeignKey(
        "users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="admission_contact_logs"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "admission_contact_logs"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.channel}/{self.direction} on {self.inquiry_id} at {self.created_at:%Y-%m-%d %H:%M}"


class ConsentLog(models.Model):
    """Records opt-in / opt-out consent for messaging channels."""
    CONSENT_CHOICES = [("opt_in", "Opt In"), ("opt_out", "Opt Out")]

    inquiry = models.ForeignKey(AdmissionInquiry, on_delete=models.CASCADE, related_name="consent_logs")
    channel = models.CharField(max_length=20, choices=CONTACT_CHANNEL_CHOICES)
    consent = models.CharField(max_length=10, choices=CONSENT_CHOICES)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    recorded_by = models.ForeignKey(
        "users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="admission_consent_logs"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "admission_consent_logs"
        ordering = ["-created_at"]


class BulkJob(models.Model):
    """Tracks async bulk action jobs (WhatsApp blast, bulk assign, etc.)."""
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="admission_bulk_jobs")
    action = models.CharField(max_length=30, choices=BULK_JOB_ACTION_CHOICES)
    lead_ids = models.JSONField(default=list)
    payload = models.JSONField(default=dict, help_text="Extra payload for the action (template_id, text, etc.)")
    status = models.CharField(max_length=10, choices=BULK_JOB_STATUS_CHOICES, default="pending")
    total = models.PositiveIntegerField(default=0)
    processed = models.PositiveIntegerField(default=0)
    failed = models.PositiveIntegerField(default=0)
    error_detail = models.JSONField(default=list, help_text="List of {lead_id, error} for failed items")
    celery_task_id = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        "users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="admission_bulk_jobs_created"
    )
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "admission_bulk_jobs"
        ordering = ["-created_at"]

    def __str__(self):
        return f"BulkJob {self.id} – {self.action} ({self.status})"


class AuditLog(models.Model):
    """Lightweight audit trail for all write actions in the admissions module."""
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="admission_audit_logs")
    actor = models.ForeignKey(
        "users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="admission_audit_logs"
    )
    action = models.CharField(max_length=80, help_text="e.g. inquiry.create, inquiry.update_status, bulk.send_whatsapp")
    object_type = models.CharField(max_length=60, blank=True)
    object_id = models.CharField(max_length=60, blank=True)
    changes = models.JSONField(default=dict, help_text="Snapshot of changed fields")
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "admission_audit_logs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["school", "action"]),
            models.Index(fields=["object_type", "object_id"]),
        ]

    def __str__(self):
        return f"{self.action} by {self.actor_id} at {self.created_at:%Y-%m-%d %H:%M}"


class Campaign(models.Model):
    """Admissions marketing campaign (Communication -> Campaigns tab).

    Previously this whole feature was a frontend-only mockup seeded from a
    hardcoded demo array — every create/cancel/activate/pause/delete action
    just mutated local React state with no backend at all, so a page refresh
    always reset to the two hardcoded rows (QA: campaigns created or
    cancelled don't survive a refresh). This is the real persistence layer.
    """

    CHANNEL_CHOICES = [
        ("WhatsApp", "WhatsApp"),
        ("Email", "Email"),
        ("WhatsApp + Email", "WhatsApp + Email"),
        ("SMS", "SMS"),
    ]
    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("scheduled", "Scheduled"),
        ("active", "Active"),
        ("sent", "Sent"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="admission_campaigns")
    name = models.CharField(max_length=255)
    channel = models.CharField(max_length=32, choices=CHANNEL_CHOICES, default="WhatsApp")
    audience = models.CharField(max_length=120, default="All active inquiries")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="draft")
    scheduled_for = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    sent_count = models.PositiveIntegerField(default=0)
    delivered_pct = models.PositiveSmallIntegerField(null=True, blank=True)
    replies = models.PositiveIntegerField(null=True, blank=True)
    created_by = models.ForeignKey(
        "users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="created_campaigns"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "admission_campaigns"
        ordering = ["-created_at"]

    def __str__(self):
        return self.name

