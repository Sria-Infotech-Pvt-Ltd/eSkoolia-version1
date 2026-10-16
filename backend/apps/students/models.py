
from django.db import models
import uuid


class StudentCategory(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="student_categories")
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    code = models.CharField(max_length=30, blank=True, null=True)
    status = models.CharField(max_length=10, choices=[("active", "Active"), ("inactive", "Inactive")], default="active")
    is_active = models.BooleanField(default=True)
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="student_categories_deleted",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "student_categories"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["school", "name"], name="uq_student_category_school_name"),
            models.UniqueConstraint(fields=["school", "code"], name="uq_student_category_school_code"),
        ]

    def __str__(self):
        return self.name


class StudentGroup(models.Model):
    GROUP_TYPE_CHOICES = [
        ("HOUSE", "House"),
        ("CLUB", "Club"),
        ("CUSTOM", "Custom"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="student_groups")
    name = models.CharField(max_length=80)
    type = models.CharField(max_length=10, choices=GROUP_TYPE_CHOICES, default="CUSTOM")
    emoji = models.CharField(max_length=10, default="📚")
    description = models.TextField(blank=True)
    color = models.CharField(max_length=20, default="#00b894")
    bg_color = models.CharField(max_length=20, default="#e6f9f5")
    capacity = models.PositiveIntegerField(default=40)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "student_groups"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["school", "name"], name="uq_student_group_school_name"),
        ]

    def __str__(self):
        return self.name


class Guardian(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="guardians")
    full_name = models.CharField(max_length=120)
    relation = models.CharField(max_length=50, help_text="e.g. Father, Mother, Uncle")
    phone = models.CharField(max_length=32)
    email = models.EmailField(blank=True)
    occupation = models.CharField(max_length=120, blank=True)
    address = models.TextField(blank=True)
    # Portal login account for this parent/guardian
    user = models.OneToOneField(
        "users.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="guardian_profile",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "guardians"
        ordering = ["full_name"]

    def __str__(self):
        return f"{self.full_name} ({self.relation})"


class StudentGuardian(models.Model):
    """
    Links a Student to more than one Guardian. Added alongside the legacy
    `Student.guardian` FK (kept as-is for the many existing call sites that read
    it directly — parent portal auth, attendance/fee notifications, reports,
    broadcasts) rather than replacing it, so this is purely additive: the FK
    always mirrors whichever linked guardian is flagged `is_primary`.
    """
    student = models.ForeignKey("Student", on_delete=models.CASCADE, related_name="guardian_links")
    guardian = models.ForeignKey(Guardian, on_delete=models.CASCADE, related_name="student_links")
    is_primary = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "student_guardians"
        ordering = ["-is_primary", "id"]
        constraints = [
            models.UniqueConstraint(fields=["student", "guardian"], name="uq_student_guardian_link"),
        ]

    def __str__(self):
        return f"{self.student_id} -> {self.guardian_id} ({'primary' if self.is_primary else 'secondary'})"


class Student(models.Model):
    GENDER_CHOICES = [
        ("male", "Male"),
        ("female", "Female"),
        ("other", "Other"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="students")
    student_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True)
    admission_no = models.CharField(max_length=40)
    roll_no = models.CharField(max_length=40, blank=True)
    first_name = models.CharField(max_length=80)
    middle_name = models.CharField(max_length=80, blank=True, default="")
    last_name = models.CharField(max_length=80, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    academic_year = models.ForeignKey(
        "core.AcademicYear",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="students",
    )
    gender = models.CharField(max_length=10, choices=GENDER_CHOICES)
    custom_gender = models.CharField(max_length=60, blank=True)
    blood_group = models.CharField(max_length=5, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    address_line = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=100, blank=True)
    district = models.CharField(max_length=100, blank=True)
    state = models.CharField(max_length=100, blank=True)
    pincode = models.CharField(max_length=20, blank=True)
    photo = models.URLField(max_length=500, blank=True)
    status = models.CharField(
        max_length=20,
        choices=[
            ("active", "Active"),
            ("inactive", "Inactive"),
            ("transferred", "Transferred"),
            ("dropped", "Dropped"),
            ("deleted", "Deleted"),
        ],
        default="active",
    )
    category = models.ForeignKey(
        StudentCategory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="students",
    )
    student_group = models.ForeignKey(
        StudentGroup,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="students",
    )
    guardian = models.ForeignKey(
        Guardian,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="students",
    )
    current_class = models.ForeignKey(
        "core.Class",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="students",
    )
    current_section = models.ForeignKey(
        "core.Section",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="students",
    )
    admission_inquiry = models.ForeignKey(
        "admissions.AdmissionInquiry",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="students",
    )
    # Transport Module Fields
    transport_route = models.ForeignKey(
        "transport.TransportRoute",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="students",
    )
    vehicle = models.ForeignKey(
        "transport.Vehicle",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="students",
    )
    # LLM / login integration — links this student record to a User account
    user = models.OneToOneField(
        "users.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="student_profile",
    )
    # Identity extras (captured on the enrollment wizard's Identity/Academic steps)
    mother_tongue = models.CharField(max_length=40, blank=True)
    other_mother_tongue = models.CharField(max_length=60, blank=True)
    religion = models.CharField(max_length=30, blank=True, default="Prefer not to say")
    nationality = models.CharField(max_length=30, blank=True)
    other_nationality = models.CharField(max_length=60, blank=True)
    admission_type = models.CharField(max_length=20, blank=True)
    previous_school_name = models.CharField(max_length=150, blank=True)
    rte_certificate_no = models.CharField(max_length=40, blank=True)
    stream = models.CharField(max_length=20, blank=True)

    # Contact extras
    landmark = models.CharField(max_length=150, blank=True)
    transport_modes = models.JSONField(default=list, blank=True)
    transport_custom = models.CharField(max_length=60, blank=True)

    # Government identity (India's "One Nation, One Student ID" + related IDs)
    apaar_id = models.CharField(max_length=20, blank=True)
    aadhaar_no = models.CharField(max_length=20, blank=True)
    pen = models.CharField(max_length=20, blank=True, verbose_name="PEN / UDISE+")
    digilocker_mobile = models.CharField(max_length=20, blank=True)
    abc_id = models.CharField(max_length=30, blank=True, verbose_name="ABC Portal ID")

    # Medical & emergency
    height_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    weight_kg = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    vision = models.CharField(max_length=30, blank=True)
    medical_conditions = models.JSONField(default=list, blank=True)
    allergies = models.JSONField(default=list, blank=True)
    current_medications = models.CharField(max_length=255, blank=True)
    treating_doctor = models.CharField(max_length=120, blank=True)
    vaccinations = models.JSONField(default=list, blank=True)
    medical_notes = models.TextField(blank=True)
    emergency_contact_name = models.CharField(max_length=120, blank=True)
    emergency_contact_phone = models.CharField(max_length=20, blank=True)

    # Specially abled (Rights of Persons with Disabilities Act, 2016) — disclosure
    # is voluntary; `is_pwd` records whether it was disclosed, distinct from
    # `is_disabled` above which is an enrollment/account-status flag.
    is_pwd = models.BooleanField(default=False)
    disability_types = models.JSONField(default=list, blank=True)
    disability_percent = models.PositiveSmallIntegerField(null=True, blank=True)
    udid = models.CharField(max_length=30, blank=True, verbose_name="UDID")
    disability_accommodations = models.JSONField(default=list, blank=True)
    disability_notes = models.TextField(blank=True)
    other_disability_text = models.CharField(max_length=120, blank=True)

    # Identity marks — physical descriptors, administrative identity verification only
    identity_marks = models.JSONField(default=list, blank=True)
    eye_colour = models.CharField(max_length=20, blank=True)
    hair_colour = models.CharField(max_length=20, blank=True)
    complexion = models.CharField(max_length=20, blank=True)
    build = models.CharField(max_length=20, blank=True)

    is_disabled = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="students_deleted",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "students"
        ordering = ["first_name", "last_name"]
        constraints = [
            models.UniqueConstraint(fields=["school", "admission_no"], name="uq_student_school_admission_no"),
        ]
        indexes = [
            models.Index(fields=["admission_no"], name="idx_students_admission_no"),
            models.Index(fields=["first_name", "last_name"], name="idx_students_name"),
            models.Index(fields=["current_class"], name="idx_students_class"),
            models.Index(fields=["current_section"], name="idx_students_section"),
        ]

    def __str__(self):
        full_name = f"{self.first_name} {self.last_name}".strip()
        return f"{full_name} ({self.admission_no})"


class StudentDocument(models.Model):
    DOCUMENT_TYPES = [
        ("birth_certificate", "Birth Certificate"),
        ("aadhaar_card", "Aadhaar Card"),
        ("medical_information", "Medical Information"),
        ("caste_certificate", "Caste Certificate"),
        ("consent_form", "Signed Consent Form"),
        ("other", "Other"),
    ]
    
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="documents")
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="student_documents", null=True, blank=True)
    document_type = models.CharField(max_length=30, choices=DOCUMENT_TYPES, default="other")
    title = models.CharField(max_length=150, blank=True)
    file = models.FileField(upload_to="student_documents/%Y/%m/", null=True, blank=True)
    original_name = models.CharField(max_length=255, blank=True)
    file_size = models.PositiveBigIntegerField(help_text="File size in bytes", null=True, blank=True)
    uploaded_by = models.ForeignKey("users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="student_documents_uploaded")
    is_verified = models.BooleanField(default=False)
    remarks = models.TextField(blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "student_documents"
        ordering = ["-uploaded_at"]
        indexes = [
            models.Index(fields=["student", "document_type"], name="idx_student_doc_type"),
            models.Index(fields=["school"], name="idx_student_doc_school"),
        ]


class StudentTransferHistory(models.Model):
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="transfer_history")
    from_school = models.ForeignKey(
        "tenancy.School",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="student_transfers_from",
    )
    to_school = models.ForeignKey(
        "tenancy.School",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="student_transfers_to",
    )
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "student_transfer_history"
        ordering = ["-created_at"]


class StudentMultiClassRecord(models.Model):
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="multi_class_records")
    school_class = models.ForeignKey("core.Class", on_delete=models.CASCADE, related_name="multi_class_students")
    section = models.ForeignKey(
        "core.Section",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="multi_class_students",
    )
    roll_no = models.CharField(max_length=40, blank=True)
    is_default = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "student_multi_class_records"
        ordering = ["student_id", "-is_default", "school_class_id", "section_id", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["student", "school_class", "section", "roll_no"],
                name="uq_student_multiclass_unique_record",
            ),
        ]

    def __str__(self):
        section = self.section.name if self.section else "-"
        return f"{self.student_id}:{self.school_class_id}:{section}"


class StudentSubjectAssignment(models.Model):
    CATEGORY_FIRST_LANGUAGE = "first_language"
    CATEGORY_SECOND_LANGUAGE = "second_language"
    CATEGORY_THIRD_LANGUAGE = "third_language"
    CATEGORY_SPORT = "sport"
    CATEGORY_CLUB = "club"
    CATEGORY_CO_CURRICULAR = "co_curricular"
    CATEGORY_OPTIONAL = "optional"
    CATEGORY_CHOICES = [
        (CATEGORY_FIRST_LANGUAGE, "First Language"),
        (CATEGORY_SECOND_LANGUAGE, "Second Language"),
        (CATEGORY_THIRD_LANGUAGE, "Third Language"),
        (CATEGORY_SPORT, "Sports"),
        (CATEGORY_CLUB, "Clubs"),
        (CATEGORY_CO_CURRICULAR, "Co-curricular"),
        (CATEGORY_OPTIONAL, "Optional Subjects"),
    ]

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="subject_assignments")
    subject = models.ForeignKey("core.Subject", on_delete=models.CASCADE, related_name="student_assignments")
    academic_year = models.ForeignKey("core.AcademicYear", on_delete=models.CASCADE, related_name="student_subject_assignments")
    school_class = models.ForeignKey("core.Class", on_delete=models.CASCADE, related_name="student_subject_assignments")
    section = models.ForeignKey("core.Section", on_delete=models.CASCADE, related_name="student_subject_assignments")
    is_optional = models.BooleanField(default=False)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, blank=True)
    assigned_at = models.DateTimeField(auto_now_add=True)
    assigned_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="student_subject_assignments_done",
    )

    class Meta:
        db_table = "student_subject_assignments"
        ordering = ["-assigned_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["student", "subject", "academic_year"],
                name="uq_student_subject_academic_year",
            ),
        ]
        indexes = [
            models.Index(fields=["student", "academic_year"], name="idx_ssa_student_year"),
            models.Index(fields=["school_class", "section", "academic_year"], name="idx_ssa_class_section_year"),
            models.Index(fields=["subject", "academic_year"], name="idx_ssa_subject_year"),
        ]


class StudentRecordAudit(models.Model):
    ACTION_SOFT_DELETE = "soft_delete"
    ACTION_RESTORE = "restore"
    ACTION_PERMANENT_DELETE = "permanent_delete"
    ACTION_UPDATE = "update"
    ACTION_CHOICES = [
        (ACTION_SOFT_DELETE, "Soft Delete"),
        (ACTION_RESTORE, "Restore"),
        (ACTION_PERMANENT_DELETE, "Permanent Delete"),
        (ACTION_UPDATE, "Update"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="student_record_audits")
    student = models.ForeignKey("students.Student", on_delete=models.SET_NULL, null=True, blank=True, related_name="delete_audits")
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    performed_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="student_record_audits_done",
    )
    note = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "student_record_audits"
        ordering = ["-created_at", "id"]


class StudentPromotionHistory(models.Model):
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="promotion_history")
    from_class = models.ForeignKey(
        "core.Class",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="promotions_from_class",
    )
    from_section = models.ForeignKey(
        "core.Section",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="promotions_from_section",
    )
    to_class = models.ForeignKey(
        "core.Class",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="promotions_to_class",
    )
    to_section = models.ForeignKey(
        "core.Section",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="promotions_to_section",
    )
    from_academic_year = models.ForeignKey(
        "core.AcademicYear",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="promotions_from_year",
    )
    to_academic_year = models.ForeignKey(
        "core.AcademicYear",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="promotions_to_year",
    )
    note = models.TextField(blank=True)
    promoted_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="student_promotions_done",
    )
    promoted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "student_promotion_history"
        ordering = ["-promoted_at"]


class PromotionBatch(models.Model):
    STATUS_DRAFT = "draft"
    STATUS_IN_PROGRESS = "in_progress"
    STATUS_CONFIRMED = "confirmed"
    STATUS_FINALIZED = "finalized"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_IN_PROGRESS, "In Progress"),
        (STATUS_CONFIRMED, "Confirmed"),
        (STATUS_FINALIZED, "Finalized"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="promotion_batches")
    academic_year = models.ForeignKey("core.AcademicYear", on_delete=models.CASCADE, related_name="promotion_batches")
    target_year = models.ForeignKey(
        "core.AcademicYear",
        on_delete=models.CASCADE,
        related_name="incoming_promotion_batches",
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    created_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="promotion_batches_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    confirmed_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="promotion_batches_confirmed",
    )
    total_students = models.PositiveIntegerField(default=0)
    promoted_count = models.PositiveIntegerField(default=0)
    retained_count = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "promotion_batches"
        ordering = ["-created_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["school", "academic_year"], name="uq_promotion_batch_school_year"),
        ]

    def __str__(self):
        return f"Promotion {self.academic_year} -> {self.target_year}"


class PromotionRecord(models.Model):
    STATUS_PENDING = "pending"
    STATUS_PROMOTE = "promote"
    STATUS_NOT_PROMOTED = "not_promoted"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_PROMOTE, "Promote"),
        (STATUS_NOT_PROMOTED, "Not Promoted"),
    ]

    REASON_ACADEMIC = "academic"
    REASON_ATTENDANCE = "attendance"
    REASON_MEDICAL = "medical"
    REASON_BEHAVIORAL = "behavioral"
    REASON_PARENT_REQUEST = "parent_request"
    REASON_OTHER = "other"
    REASON_CHOICES = [
        (REASON_ACADEMIC, "Academic Performance"),
        (REASON_ATTENDANCE, "Attendance"),
        (REASON_MEDICAL, "Medical Leave"),
        (REASON_BEHAVIORAL, "Behavioral"),
        (REASON_PARENT_REQUEST, "Parent Request"),
        (REASON_OTHER, "Other"),
    ]

    batch = models.ForeignKey(PromotionBatch, on_delete=models.CASCADE, related_name="records")
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name="promotion_records")
    from_class = models.ForeignKey(
        "core.Class",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="promotion_records_from_class",
    )
    from_section = models.ForeignKey(
        "core.Section",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="promotion_records_from_section",
    )
    to_class = models.ForeignKey(
        "core.Class",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="promotion_records_to_class",
    )
    to_section = models.ForeignKey(
        "core.Section",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="promotion_records_to_section",
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    retention_reason = models.CharField(max_length=30, choices=REASON_CHOICES, blank=True)
    failed_subjects = models.ManyToManyField("core.Subject", blank=True, related_name="failed_promotion_records")
    notes = models.TextField(blank=True)
    ai_recommendation = models.TextField(blank=True)
    decision_made_at = models.DateTimeField(null=True, blank=True)
    decision_made_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="promotion_record_decisions",
    )
    last_modified_at = models.DateTimeField(auto_now=True)
    last_modified_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="promotion_record_modifications",
    )

    class Meta:
        db_table = "promotion_records"
        ordering = ["from_class__numeric_order", "from_section__name", "student__roll_no", "student__id"]
        constraints = [
            models.UniqueConstraint(fields=["batch", "student"], name="uq_promotion_record_batch_student"),
        ]

    def __str__(self):
        return f"{self.student} - {self.get_status_display()}"


class StudentClubMembership(models.Model):
    """Through table allowing a student to belong to multiple clubs.

    The legacy `Student.student_group` FK is kept exclusively for HOUSE
    assignments (one house per student).  All CLUB memberships go through
    this table so a student can join many clubs simultaneously.
    """

    ROLE_CHOICES = [
        ("member", "Member"),
        ("captain", "Captain"),
        ("co_captain", "Co-Captain"),
        ("secretary", "Secretary"),
        ("treasurer", "Treasurer"),
    ]

    student = models.ForeignKey(
        "students.Student",
        on_delete=models.CASCADE,
        related_name="club_memberships",
    )
    club = models.ForeignKey(
        "students.StudentGroup",
        on_delete=models.CASCADE,
        related_name="memberships",
        limit_choices_to={"type": "CLUB"},
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default="member")
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "student_club_memberships"
        ordering = ["club__name", "student__first_name", "student__last_name"]
        constraints = [
            models.UniqueConstraint(
                fields=["student", "club"], name="uq_student_club_membership"
            ),
        ]

    def __str__(self):
        return f"{self.student} - {self.club.name}"


class PromotionAuditLog(models.Model):
    batch = models.ForeignKey(PromotionBatch, on_delete=models.CASCADE, related_name="audit_logs")
    action = models.CharField(max_length=40)
    performed_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="promotion_audit_actions",
    )
    record = models.ForeignKey(
        PromotionRecord,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    details = models.TextField(blank=True)
    ip_address = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "promotion_audit_logs"
        ordering = ["-created_at", "id"]
