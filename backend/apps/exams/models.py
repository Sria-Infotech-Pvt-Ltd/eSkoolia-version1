from decimal import Decimal

from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q

SHARED_EXAM_ROOMS = {"EXAM-HALL", "AUDITORIUM", "SPORTS-HALL"}


class ExamType(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="exam_types")
    academic_year = models.ForeignKey(
        "core.AcademicYear",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_types",
    )
    title = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    active_status = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    is_average = models.BooleanField(default=False)
    average_mark = models.DecimalField(max_digits=6, decimal_places=2, default=Decimal("0.00"))
    counts_to_average = models.BooleanField(default=True)
    weight_percent = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "exam_types"
        ordering = ["title"]
        constraints = [
            models.UniqueConstraint(fields=["school", "academic_year", "title"], name="uq_exam_type_school_year_title"),
        ]

    def __str__(self):
        return self.title


class Exam(models.Model):
    STATUS_DRAFT = "draft"
    STATUS_PUBLISHED = "published"
    STATUS_MARKS_OPEN = "marks_open"
    STATUS_CLOSED = "closed"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_PUBLISHED, "Published"),
        (STATUS_MARKS_OPEN, "Marks Open"),
        (STATUS_CLOSED, "Closed"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="exams")
    academic_year = models.ForeignKey("core.AcademicYear", on_delete=models.CASCADE, related_name="exams")
    exam_type = models.ForeignKey(ExamType, on_delete=models.CASCADE, related_name="exams")
    name = models.CharField(max_length=150)
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    is_result_published = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True)
    published_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="published_exam_results",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "exams"
        ordering = ["-start_date", "name"]
        constraints = [
            models.UniqueConstraint(fields=["school", "academic_year", "name"], name="uq_exam_school_year_name"),
        ]

    def __str__(self):
        return self.name


class ExamGradeScaleGroup(models.Model):
    STYLE_PERCENTAGE = "percentage"
    STYLE_LETTER = "letter"
    STYLE_GPA = "gpa"
    STYLE_CHOICES = [
        (STYLE_PERCENTAGE, "Percentage only"),
        (STYLE_LETTER, "Letter grades"),
        (STYLE_GPA, "GPA / points only"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="exam_grade_scale_groups")
    name = models.CharField(max_length=120)
    style = models.CharField(max_length=12, choices=STYLE_CHOICES, default=STYLE_LETTER)
    min_pass_percent = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("33.00"))
    is_default = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "exam_grade_scale_groups"
        ordering = ["-is_default", "name"]
        constraints = [
            models.UniqueConstraint(fields=["school", "name"], name="uq_exam_grade_scale_group_school_name"),
        ]

    def __str__(self):
        return self.name


class ExamGradeScale(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="exam_grade_scales")
    group = models.ForeignKey(
        ExamGradeScaleGroup,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="bands",
    )
    name = models.CharField(max_length=5)
    min_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.00")), MaxValueValidator(Decimal("100.00"))],
    )
    max_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.00")), MaxValueValidator(Decimal("100.00"))],
    )
    gpa = models.DecimalField(max_digits=4, decimal_places=2, default=Decimal("0.00"))
    is_fail = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "exam_grade_scales"
        ordering = ["-min_percent"]
        constraints = [
            models.UniqueConstraint(fields=["school", "group", "name"], name="uq_exam_grade_scale_school_group_name"),
        ]

    def __str__(self):
        return self.name


class ExamSchedule(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="exam_schedules")
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="schedules")
    school_class = models.ForeignKey("core.Class", on_delete=models.CASCADE, related_name="exam_schedules")
    section = models.ForeignKey(
        "core.Section",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_schedules",
    )
    subject = models.ForeignKey("core.Subject", on_delete=models.CASCADE, related_name="exam_schedules")
    exam_date = models.DateField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    room = models.CharField(max_length=80, blank=True)
    full_marks = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("100.00"))
    pass_marks = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("33.00"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "exam_schedules"
        ordering = ["exam_date", "start_time"]
        constraints = [
            models.UniqueConstraint(
                fields=["school", "exam", "school_class", "section", "subject"],
                name="uq_exam_schedule_scope",
            ),
        ]


class ExamMark(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="exam_marks")
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name="marks")
    schedule = models.ForeignKey(ExamSchedule, on_delete=models.CASCADE, related_name="marks")
    student = models.ForeignKey("students.Student", on_delete=models.CASCADE, related_name="exam_marks")
    obtained_marks = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.00")), MaxValueValidator(Decimal("1000.00"))],
    )
    absent = models.BooleanField(default=False)
    note = models.TextField(blank=True)
    created_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_marks_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "exam_marks"
        ordering = ["student_id"]
        constraints = [
            models.UniqueConstraint(fields=["schedule", "student"], name="uq_exam_mark_schedule_student"),
        ]


class ExamSetup(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="exam_setups")
    academic_year = models.ForeignKey(
        "core.AcademicYear",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_setups",
    )
    exam_term = models.ForeignKey(ExamType, on_delete=models.CASCADE, related_name="setup_items")
    school_class = models.ForeignKey("core.Class", on_delete=models.CASCADE, related_name="exam_setups")
    section = models.ForeignKey("core.Section", on_delete=models.CASCADE, related_name="exam_setups")
    subject = models.ForeignKey("core.Subject", on_delete=models.CASCADE, related_name="exam_setups")
    exam_title = models.CharField(max_length=120)
    exam_mark = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("0.00"))
    created_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_setups_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "exam_setups"
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["school", "exam_term", "school_class", "section", "subject", "exam_title"],
                name="uq_exam_setup_scope_title",
            ),
        ]


class ExamRoutine(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="exam_routines")
    academic_year = models.ForeignKey(
        "core.AcademicYear",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_routines",
    )
    exam_term = models.ForeignKey(ExamType, on_delete=models.CASCADE, related_name="routines")
    school_class = models.ForeignKey("core.Class", on_delete=models.CASCADE, related_name="exam_routines")
    section = models.ForeignKey(
        "core.Section",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_routines",
    )
    subject = models.ForeignKey("core.Subject", on_delete=models.CASCADE, related_name="exam_routines")
    teacher = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_routines",
    )
    exam_period = models.ForeignKey(
        "core.ClassPeriod",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_routines",
    )
    exam_date = models.DateField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    room = models.CharField(max_length=80, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "exam_routines"
        ordering = ["exam_date", "start_time", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["school", "exam_term", "school_class", "section", "subject"],
                name="uq_exam_routine_scope_subject",
            ),
            models.UniqueConstraint(
                fields=["school", "exam_term", "school_class", "section", "exam_date", "exam_period"],
                name="uq_exam_routine_scope_date_period",
            ),
        ]
        indexes = [
            models.Index(fields=["exam_date"], name="idx_exam_routine_exam_date"),
        ]

    def clean(self):
        if not self.school_id:
            return

        if self.end_time <= self.start_time:
            raise ValidationError({"detail": "End time must be later than start time.", "conflict_type": "invalid_time"})

        from apps.core.models import Holiday

        holiday = (
            Holiday.objects.filter(active_status=True)
            .filter(Q(school_id=self.school_id) | Q(school_id__isnull=True))
            .filter(date__lte=self.exam_date)
            .filter(Q(end_date__isnull=True, date__gte=self.exam_date) | Q(end_date__gte=self.exam_date))
            .order_by("date")
            .first()
        )
        if holiday:
            raise ValidationError(
                {
                    "detail": f"Cannot schedule on holiday: {holiday.name} ({self.exam_date}).",
                    "conflict_type": "holiday_lockout",
                }
            )

        overlap_filter = Q(start_time__lt=self.end_time) & Q(end_time__gt=self.start_time)
        base_qs = ExamRoutine.objects.filter(school_id=self.school_id, exam_date=self.exam_date).filter(overlap_filter)
        if self.pk:
            base_qs = base_qs.exclude(pk=self.pk)

        room_value = (self.room or "").strip()
        if room_value and room_value.upper() not in SHARED_EXAM_ROOMS:
            room_conflict = base_qs.filter(room__iexact=room_value).select_related("exam_term", "school_class", "section", "subject").first()
            if room_conflict:
                raise ValidationError(
                    {
                        "detail": (
                            f"Room {room_value} is already booked for {room_conflict.exam_term.title}: "
                            f"{room_conflict.school_class.name}-{room_conflict.section.name if room_conflict.section else 'All'} "
                            f"{room_conflict.subject.name} at {room_conflict.start_time.strftime('%H:%M')}-{room_conflict.end_time.strftime('%H:%M')}."
                        ),
                        "conflict_type": "room_conflict",
                    }
                )

        class_conflict_qs = base_qs.filter(school_class_id=self.school_class_id)
        if self.section_id:
            class_conflict_qs = class_conflict_qs.filter(section_id=self.section_id)
        else:
            class_conflict_qs = class_conflict_qs.filter(section_id__isnull=True)

        class_conflict = class_conflict_qs.select_related("subject").first()
        if class_conflict:
            class_name = class_conflict.school_class.name
            section_name = class_conflict.section.name if class_conflict.section else "All"
            raise ValidationError(
                {
                    "detail": (
                        f"Class {class_name}-{section_name} already has {class_conflict.subject.name} "
                        f"in {class_conflict.room or 'N/A'} at "
                        f"{class_conflict.start_time.strftime('%H:%M')}-{class_conflict.end_time.strftime('%H:%M')}."
                    ),
                    "conflict_type": "class_conflict",
                }
            )

        if self.teacher_id:
            teacher_conflict = base_qs.filter(teacher_id=self.teacher_id).select_related("school_class", "section", "subject", "teacher").first()
            if teacher_conflict:
                class_name = teacher_conflict.school_class.name
                section_name = teacher_conflict.section.name if teacher_conflict.section else "All"
                teacher_name = (
                    f"{(teacher_conflict.teacher.first_name or '').strip()} {(teacher_conflict.teacher.last_name or '').strip()}".strip()
                    if teacher_conflict.teacher
                    else "Teacher"
                )
                raise ValidationError(
                    {
                        "detail": (
                            f"Teacher {teacher_name} is already assigned to {class_name}-{section_name} "
                            f"{teacher_conflict.subject.name} in {teacher_conflict.room or 'N/A'} at "
                            f"{teacher_conflict.start_time.strftime('%H:%M')}-{teacher_conflict.end_time.strftime('%H:%M')}."
                        ),
                        "conflict_type": "teacher_conflict",
                    }
                )


class ExamAttendance(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="exam_attendances")
    academic_year = models.ForeignKey(
        "core.AcademicYear",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_attendances",
    )
    exam_term = models.ForeignKey(ExamType, on_delete=models.CASCADE, related_name="attendances")
    school_class = models.ForeignKey("core.Class", on_delete=models.CASCADE, related_name="exam_attendances")
    section = models.ForeignKey(
        "core.Section",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_attendances",
    )
    subject = models.ForeignKey("core.Subject", on_delete=models.CASCADE, related_name="exam_attendances")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "exam_attendances"
        ordering = ["-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["school", "exam_term", "school_class", "section", "subject"],
                name="uq_exam_attendance_scope",
            ),
        ]


class ExamAttendanceChild(models.Model):
    ATTENDANCE_CHOICES = [
        ("P", "Present"),
        ("A", "Absent"),
    ]

    attendance = models.ForeignKey(ExamAttendance, on_delete=models.CASCADE, related_name="children")
    student = models.ForeignKey("students.Student", on_delete=models.CASCADE, related_name="exam_attendance_children")
    student_record_id = models.BigIntegerField(null=True, blank=True)
    school_class = models.ForeignKey("core.Class", on_delete=models.CASCADE, related_name="exam_attendance_children")
    section = models.ForeignKey(
        "core.Section",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_attendance_children",
    )
    attendance_type = models.CharField(max_length=1, choices=ATTENDANCE_CHOICES, default="P")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "exam_attendance_children"
        ordering = ["student_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["attendance", "student"],
                name="uq_exam_attendance_child_attendance_student",
            ),
        ]


class ExamMarkRegister(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="exam_mark_registers")
    academic_year = models.ForeignKey(
        "core.AcademicYear",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_mark_registers",
    )
    exam_term = models.ForeignKey(ExamType, on_delete=models.CASCADE, related_name="mark_registers")
    school_class = models.ForeignKey("core.Class", on_delete=models.CASCADE, related_name="exam_mark_registers")
    section = models.ForeignKey(
        "core.Section",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_mark_registers",
    )
    subject = models.ForeignKey("core.Subject", on_delete=models.CASCADE, related_name="exam_mark_registers")
    student = models.ForeignKey("students.Student", on_delete=models.CASCADE, related_name="exam_mark_registers")
    student_record_id = models.BigIntegerField(null=True, blank=True)
    is_absent = models.BooleanField(default=False)
    total_marks = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("0.00"))
    total_gpa_point = models.DecimalField(max_digits=4, decimal_places=2, default=Decimal("0.00"))
    total_gpa_grade = models.CharField(max_length=10, blank=True)
    teacher_remarks = models.CharField(max_length=255, blank=True)
    # Lock / submission tracking
    is_locked = models.BooleanField(default=False, help_text="Set True when teacher submits. Admin can unlock.")
    locked_at = models.DateTimeField(null=True, blank=True)
    submitted_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="submitted_mark_registers",
    )
    created_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_mark_registers_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "exam_mark_registers"
        ordering = ["student_id", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["school", "exam_term", "school_class", "section", "subject", "student"],
                name="uq_exam_mark_register_scope_student",
            ),
        ]


class ExamMarkRegisterPart(models.Model):
    register = models.ForeignKey(ExamMarkRegister, on_delete=models.CASCADE, related_name="parts")
    exam_setup = models.ForeignKey(ExamSetup, on_delete=models.CASCADE, related_name="mark_register_parts")
    marks = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("0.00"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "exam_mark_register_parts"
        ordering = ["exam_setup_id", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["register", "exam_setup"],
                name="uq_exam_mark_register_part_register_setup",
            ),
        ]


class ExamResultPublish(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="exam_result_publishes")
    academic_year = models.ForeignKey(
        "core.AcademicYear",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_result_publishes",
    )
    exam_term = models.ForeignKey(ExamType, on_delete=models.CASCADE, related_name="result_publishes")
    school_class = models.ForeignKey("core.Class", on_delete=models.CASCADE, related_name="exam_result_publishes")
    section = models.ForeignKey(
        "core.Section",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_result_publishes",
    )
    is_published = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True)
    published_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_result_publishes",
    )
    principal_signoff = models.BooleanField(default=False)
    principal_signoff_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_result_publish_signoffs",
    )
    principal_signoff_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "exam_result_publishes"
        ordering = ["-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["school", "exam_term", "school_class", "section"],
                name="uq_exam_result_publish_scope",
            ),
        ]


class OnlineExam(models.Model):
    STATUS_DRAFT = 0
    STATUS_PUBLISHED = 1
    STATUS_ARCHIVED = 2

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="online_exams")
    academic_year = models.ForeignKey(
        "core.AcademicYear",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="online_exams",
    )
    title = models.CharField(max_length=150)
    school_class = models.ForeignKey("core.Class", on_delete=models.CASCADE, related_name="online_exams")
    section = models.ForeignKey("core.Section", on_delete=models.CASCADE, related_name="online_exams")
    subject = models.ForeignKey("core.Subject", on_delete=models.CASCADE, related_name="online_exams")
    date = models.DateField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    end_date_time = models.DateTimeField()
    percentage = models.DecimalField(max_digits=6, decimal_places=2, default=Decimal("0.00"))
    instruction = models.TextField(blank=True)
    status = models.PositiveSmallIntegerField(default=STATUS_DRAFT)
    auto_mark = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "online_exams"
        ordering = ["-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["school", "school_class", "section", "subject", "title"],
                name="uq_online_exam_scope_title",
            ),
        ]


class OnlineExamTake(models.Model):
    online_exam = models.ForeignKey(OnlineExam, on_delete=models.CASCADE, related_name="takes")
    student = models.ForeignKey("students.Student", on_delete=models.CASCADE, related_name="online_exam_takes")
    total_marks = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("0.00"))
    status = models.PositiveSmallIntegerField(default=0)
    submitted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "online_exam_takes"
        ordering = ["student_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["online_exam", "student"],
                name="uq_online_exam_take_exam_student",
            ),
        ]


class AdmitCardSetting(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="admit_card_settings")
    academic_year = models.ForeignKey(
        "core.AcademicYear",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="admit_card_settings",
    )
    admit_layout = models.PositiveSmallIntegerField(default=1)
    student_photo = models.BooleanField(default=True)
    student_name = models.BooleanField(default=True)
    admission_no = models.BooleanField(default=True)
    class_section = models.BooleanField(default=True)
    exam_name = models.BooleanField(default=True)
    academic_year_label = models.BooleanField(default=True)
    principal_signature = models.BooleanField(default=False)
    guardian_name = models.BooleanField(default=False)
    class_teacher_signature = models.BooleanField(default=False)
    school_address = models.BooleanField(default=False)
    student_download = models.BooleanField(default=True)
    parent_download = models.BooleanField(default=True)
    student_notification = models.BooleanField(default=False)
    parent_notification = models.BooleanField(default=False)
    admit_sub_title = models.CharField(max_length=190, blank=True)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "admit_card_settings"
        ordering = ["-id"]
        constraints = [
            models.UniqueConstraint(fields=["school", "academic_year"], name="uq_admit_card_setting_scope"),
        ]


class AdmitCard(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="admit_cards")
    academic_year = models.ForeignKey(
        "core.AcademicYear",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="admit_cards",
    )
    exam_term = models.ForeignKey(ExamType, on_delete=models.CASCADE, related_name="admit_cards")
    student = models.ForeignKey("students.Student", on_delete=models.CASCADE, related_name="admit_cards")
    student_record_id = models.BigIntegerField(null=True, blank=True)
    created_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="admit_cards_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "admit_cards"
        ordering = ["-id"]
        constraints = [
            models.UniqueConstraint(fields=["school", "academic_year", "exam_term", "student"], name="uq_admit_card_scope"),
        ]


class SeatPlanSetting(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="seat_plan_settings")
    academic_year = models.ForeignKey(
        "core.AcademicYear",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="seat_plan_settings",
    )
    school_name = models.BooleanField(default=True)
    student_photo = models.BooleanField(default=True)
    student_name = models.BooleanField(default=True)
    roll_no = models.BooleanField(default=True)
    admission_no = models.BooleanField(default=True)
    class_section = models.BooleanField(default=True)
    exam_name = models.BooleanField(default=True)
    academic_year_label = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "seat_plan_settings"
        ordering = ["-id"]
        constraints = [
            models.UniqueConstraint(fields=["school", "academic_year"], name="uq_seat_plan_setting_scope"),
        ]


class SeatPlan(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="seat_plans")
    academic_year = models.ForeignKey(
        "core.AcademicYear",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="seat_plans",
    )
    exam_term = models.ForeignKey(ExamType, on_delete=models.CASCADE, related_name="seat_plans")
    student = models.ForeignKey("students.Student", on_delete=models.CASCADE, related_name="seat_plans")
    student_record_id = models.BigIntegerField(null=True, blank=True)
    created_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="seat_plans_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "seat_plans"
        ordering = ["-id"]
        constraints = [
            models.UniqueConstraint(fields=["school", "academic_year", "exam_term", "student"], name="uq_seat_plan_scope"),
        ]


class ReportCardSetting(models.Model):
    TEMPLATE_CBSE = "cbse"
    TEMPLATE_ICSE = "icse"
    TEMPLATE_CAMBRIDGE = "cambridge"
    TEMPLATE_IB = "ib"
    TEMPLATE_SSC = "ssc"
    TEMPLATE_OTHER = "other"
    TEMPLATE_CHOICES = [
        (TEMPLATE_CBSE, "CBSE style"),
        (TEMPLATE_ICSE, "ICSE style"),
        (TEMPLATE_CAMBRIDGE, "Cambridge style"),
        (TEMPLATE_IB, "IB style"),
        (TEMPLATE_SSC, "SSC style"),
        (TEMPLATE_OTHER, "Other style"),
    ]

    WORKFLOW_AS_YOU_GO = "as_you_go"
    WORKFLOW_BULK = "bulk"
    WORKFLOW_CUSTOM = "custom"
    WORKFLOW_CHOICES = [
        (WORKFLOW_AS_YOU_GO, "As-you-go"),
        (WORKFLOW_BULK, "Bulk"),
        (WORKFLOW_CUSTOM, "Custom"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="report_card_settings")
    academic_year = models.ForeignKey(
        "core.AcademicYear",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="report_card_settings",
    )
    visible_to_class_teacher = models.BooleanField(default=True)
    visible_to_subject_teacher = models.BooleanField(default=False)
    template = models.CharField(max_length=20, choices=TEMPLATE_CHOICES, default=TEMPLATE_CBSE)
    include_photo = models.BooleanField(default=True)
    include_co_scholastic = models.BooleanField(default=True)
    include_attendance = models.BooleanField(default=True)
    include_comments = models.BooleanField(default=True)
    include_overall_notes = models.BooleanField(default=True)
    include_improvement = models.BooleanField(default=True)
    moderation_workflow = models.CharField(max_length=12, choices=WORKFLOW_CHOICES, default=WORKFLOW_AS_YOU_GO)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "exam_report_card_settings"
        ordering = ["-id"]
        constraints = [
            models.UniqueConstraint(fields=["school", "academic_year"], name="uq_report_card_setting_scope"),
        ]


class ExamResultModerationFlag(models.Model):
    STATUS_PENDING = "pending"
    STATUS_APPROVED = "approved"
    STATUS_REJECTED = "rejected"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_REJECTED, "Rejected"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="exam_result_moderation_flags")
    exam_term = models.ForeignKey(ExamType, on_delete=models.CASCADE, related_name="moderation_flags")
    school_class = models.ForeignKey("core.Class", on_delete=models.CASCADE, related_name="exam_result_moderation_flags")
    section = models.ForeignKey(
        "core.Section",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_result_moderation_flags",
    )
    student = models.ForeignKey("students.Student", on_delete=models.CASCADE, related_name="exam_result_moderation_flags")
    mark_register = models.ForeignKey(
        ExamMarkRegister,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="moderation_flags",
    )
    reason = models.CharField(max_length=255)
    detail = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_PENDING)
    resolved_by = models.ForeignKey(
        "users.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exam_result_moderation_flags_resolved",
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "exam_result_moderation_flags"
        ordering = ["-id"]


class ExamFeeGate(models.Model):
    """School-level toggle for the fee-dues gate on admit card generation.
    OFF by default — a school must explicitly enable this. Cannot accidentally
    block any student on merge.
    """
    school = models.OneToOneField(
        "tenancy.School", on_delete=models.CASCADE, related_name="exam_fee_gate"
    )
    academic_year = models.ForeignKey(
        "core.AcademicYear", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="exam_fee_gates"
    )
    is_enabled = models.BooleanField(
        default=False,
        help_text="When True, admit card generation is blocked for students with outstanding dues."
    )
    enabled_by = models.ForeignKey(
        "users.User", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="exam_fee_gates_enabled"
    )
    enabled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "exam_fee_gates"

    def __str__(self):
        return f"FeeGate(school={self.school_id}, enabled={self.is_enabled})"


class ExamAdmitCardFeeOverride(models.Model):
    """Audit record when a Principal overrides the fee-dues block for a student.
    Immutable — rows are never updated after creation.
    """
    school = models.ForeignKey(
        "tenancy.School", on_delete=models.CASCADE, related_name="admit_card_fee_overrides"
    )
    exam_term = models.ForeignKey(
        ExamType, on_delete=models.CASCADE, related_name="admit_card_fee_overrides"
    )
    student = models.ForeignKey(
        "students.Student", on_delete=models.CASCADE, related_name="admit_card_fee_overrides"
    )
    overridden_by = models.ForeignKey(
        "users.User", on_delete=models.PROTECT, related_name="admit_card_fee_overrides"
    )
    reason = models.TextField(help_text="Mandatory reason provided by the Principal.")
    outstanding_balance = models.DecimalField(
        max_digits=12, decimal_places=2,
        help_text="Outstanding balance at the time of override."
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "exam_admit_card_fee_overrides"
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise ValidationError("Fee override audit records cannot be modified.")
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Override({self.student_id}) by {self.overridden_by_id} for {self.exam_term_id}"
