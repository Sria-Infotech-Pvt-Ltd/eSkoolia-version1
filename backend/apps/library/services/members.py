"""Member registration, dues queries and the roster used by the issue desk.

The one place that writes a membership and its registration charge. Accrued fines on open
overdue loans are never stored: `accrued_fines_by_member` computes them for many members in
a single query, and the list endpoints call it once per page.
"""
from collections import defaultdict
from decimal import Decimal

from django.db import transaction
from django.db.models import (
    Case,
    CharField,
    Count,
    DecimalField,
    Exists,
    IntegerField,
    OuterRef,
    Q,
    Subquery,
    Sum,
    Value,
    When,
)
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.access_control.models import UserRole
from apps.library.exceptions import LibraryInvalidStateTransition
from apps.library.models import (
    BookIssue,
    Charge,
    LibraryActivityLog,
    LibraryMember,
    LibrarySettings,
)

from .activity import log_event
from .dues import ZERO, borrowing_limit, loan_fine, money, summarise_dues
from .settings import get_settings

# ---- names and types -----------------------------------------------------------


def person_name(member):
    person = member.student if member.student_id else member.staff
    if person is None:
        return ""
    return " ".join(part for part in (person.first_name, getattr(person, "last_name", "")) if part)


def infer_member_type(staff):
    """D11: teacher when the staff user holds an active role with portal_type teacher, else staff."""
    if staff.user_id and UserRole.objects.filter(user_id=staff.user_id, role__is_active=True, role__portal_type="teacher").exists():
        return LibraryMember.MEMBER_TEACHER
    return LibraryMember.MEMBER_STAFF


def default_registration_fee(settings, member_type, student=None):
    """D6: junior class group pays the junior fee, other students the senior fee, teachers and staff nothing."""
    if member_type != LibraryMember.MEMBER_STUDENT:
        return ZERO
    junior = set(settings.junior_class_ids or [])
    if student is not None and student.current_class_id in junior:
        return money(settings.registration_fee_junior)
    return money(settings.registration_fee_senior)


def _next_card_no(school):
    number = LibraryMember.objects.filter(school=school).count() + 1
    while True:
        card = f"LM-{number:05d}"
        if not LibraryMember.objects.filter(school=school, card_no=card).exists():
            return card
        number += 1


def receipt_number(charge):
    return f"LIBR-{charge.pk:07d}"


# ---- registration ----------------------------------------------------------------


@transaction.atomic
def register_member(school, actor, *, student=None, staff=None, member_type=None, card_no="", fee=None, collect_now=False):
    """Create a membership and its registration charge in one transaction.

    The charge is paid now (`collect_now`), pending, or waived when the fee is 0. The caller has
    already checked that the person belongs to `school`, is active and is not a member yet; this
    re-checks school and uniqueness under the lock because the data can change in between.
    """
    settings = get_settings(school)
    # Serialise registrations per school so card numbers cannot collide.
    LibrarySettings.objects.select_for_update().get(pk=settings.pk)

    person = student or staff
    if person is None or person.school_id != school.id:
        raise ValueError("Person does not belong to this school")
    if student is not None:
        member_type = LibraryMember.MEMBER_STUDENT
    elif member_type not in (LibraryMember.MEMBER_TEACHER, LibraryMember.MEMBER_STAFF):
        member_type = infer_member_type(staff)
    amount = money(fee) if fee is not None else default_registration_fee(settings, member_type, student)
    if LibraryMember.objects.filter(school=school).filter(Q(student=student) if student else Q(staff=staff)).exists():
        raise LibraryInvalidStateTransition("This person is already a library member.")

    member = LibraryMember.objects.create(
        school=school,
        member_type=member_type,
        student=student,
        staff=staff,
        card_no=(card_no or "").strip() or _next_card_no(school),
        registration_fee_amount=amount,
        created_by=actor,
        updated_by=actor,
    )
    now = timezone.now()
    charge = Charge.objects.create(
        school=school,
        member=member,
        charge_type=Charge.TYPE_REGISTRATION,
        amount=amount,
        assessed_on=timezone.localdate(),
        created_by=actor,
        updated_by=actor,
        status=Charge.STATUS_WAIVED if amount == 0 else Charge.STATUS_PAID if collect_now else Charge.STATUS_PENDING,
        resolution_note="No registration fee" if amount == 0 else "",
        resolved_at=now if (amount == 0 or collect_now) else None,
        resolved_by=actor if (amount == 0 or collect_now) else None,
    )
    if charge.status == Charge.STATUS_PAID:
        charge.receipt_no = receipt_number(charge)
        charge.save(update_fields=["receipt_no", "updated_at"])
    member.student, member.staff = student, staff  # already loaded, spare the display name a query
    log_event(
        school,
        actor,
        LibraryActivityLog.EVENT_MEMBER,
        f"Registered {member_type} member {person_name(member)} ({member.card_no}), fee {amount} {charge.status}",
        member=member,
        metadata={"member_id": member.pk, "member_type": member_type, "fee": str(amount), "fee_status": charge.status},
    )
    return member, charge


# ---- queries -----------------------------------------------------------------------


def _charge_total(member_ref, charge_type, status=Charge.STATUS_PENDING):
    return Coalesce(
        Subquery(
            Charge.objects.filter(member=member_ref, charge_type=charge_type, status=status)
            .values("member")
            .annotate(total=Sum("amount"))
            .values("total")[:1],
            output_field=DecimalField(max_digits=14, decimal_places=2),
        ),
        Value(ZERO),
        output_field=DecimalField(max_digits=14, decimal_places=2),
    )


def annotate_member_dues(queryset):
    """Add loan and charge figures to a LibraryMember queryset in one query, with no per-row lookups."""
    ref = OuterRef("pk")
    return queryset.annotate(
        active_loans=Coalesce(
            Subquery(
                BookIssue.objects.filter(member=ref, status=BookIssue.STATUS_ISSUED).values("member").annotate(n=Count("id")).values("n")[:1],
                output_field=IntegerField(),
            ),
            Value(0),
        ),
        pending_fines=_charge_total(ref, Charge.TYPE_OVERDUE_FINE),
        pending_replacements=_charge_total(ref, Charge.TYPE_REPLACEMENT),
        pending_registration=_charge_total(ref, Charge.TYPE_REGISTRATION),
        registration_state=Case(
            When(Exists(Charge.objects.filter(member=ref, charge_type=Charge.TYPE_REGISTRATION, status=Charge.STATUS_PENDING)), then=Value("unpaid")),
            When(Exists(Charge.objects.filter(member=ref, charge_type=Charge.TYPE_REGISTRATION, status=Charge.STATUS_PAID)), then=Value("paid")),
            default=Value("waived"),
            output_field=CharField(),
        ),
    )


def accrued_fines_by_member(school, settings, member_ids=None, today=None):
    """{member_id: accrued fine} for open overdue loans, in one query.

    Members with nothing accrued are absent. Pass `member_ids` to limit it to one page.
    """
    today = today or timezone.localdate()
    loans = BookIssue.objects.filter(school=school, status=BookIssue.STATUS_ISSUED, due_date__lt=today)
    if member_ids is not None:
        loans = loans.filter(member_id__in=list(member_ids))
    totals = defaultdict(lambda: ZERO)
    for member_id, due_date, cost in loans.values_list("member_id", "due_date", "book__cost_per_copy"):
        totals[member_id] += loan_fine(due_date, today, cost, settings)
    return {member_id: total for member_id, total in totals.items() if total > 0}


def member_dues(member, accrued, settings=None):
    """DuesSummary for an annotated member (`annotate_member_dues`) and its accrued open-loan fine."""
    return summarise_dues(
        Decimal(accrued or 0) + member.pending_fines,
        member.pending_replacements,
        member.pending_registration,
    )


def suspended_member_ids(school, settings):
    """Ids of members blocked from borrowing: accrued or pending fines, or unpaid replacement fees."""
    ids = set(accrued_fines_by_member(school, settings))
    ids |= set(
        Charge.objects.filter(
            school=school,
            status=Charge.STATUS_PENDING,
            charge_type__in=[Charge.TYPE_OVERDUE_FINE, Charge.TYPE_REPLACEMENT],
            amount__gt=0,
        ).values_list("member_id", flat=True)
    )
    return ids


# ---- issue-desk roster ---------------------------------------------------------------

ELIGIBLE = "ok"
REASONS = ("ok", "suspended", "limit_reached", "already_holding", "not_eligible_audience", "reference_only")


def eligibility(member, *, dues, settings, book=None, holding=False):
    """(eligible, reason) for issuing `book` (or any book when None) to an annotated member."""
    if dues.suspended:
        return False, "suspended"
    if member.active_loans >= borrowing_limit(member.member_type, settings):
        return False, "limit_reached"
    if book is not None:
        if book.is_reference_only:
            return False, "reference_only"
        allowed = {"student": book.for_students, "teacher": book.for_teachers, "staff": book.for_staff}[member.member_type]
        if not allowed:
            return False, "not_eligible_audience"
        if holding:
            return False, "already_holding"
    return True, ELIGIBLE


def holding_member_ids(book, member_ids):
    return set(
        BookIssue.objects.filter(book=book, member_id__in=list(member_ids), status=BookIssue.STATUS_ISSUED).values_list("member_id", flat=True)
    )
