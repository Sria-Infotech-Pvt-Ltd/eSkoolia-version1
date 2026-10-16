"""What a teacher sees and does in the portal (blueprint 2.4 teacher portal, 3.4, decisions D4, D15, D16).

Two scopes, never mixed:
  * My Class: students of the class-teacher scope, `(class_id, section_id)` pairs from `get_attendance_scope`.
    A pair whose section is None means every section of that class.
  * My Books: only the loans of the teacher's own library member, found through `Staff.user`.

Nothing here takes a school, class or student id from the client.
"""
from datetime import timedelta

from django.db.models import Q

from apps.core.exceptions import ResourceNotFound
from apps.library.models import BookIssue, BookRequest, Hold, LibraryMember, PeriodSlot
from apps.library.serializers.loans import loan_state

from .dues import days_overdue, loan_fine
from .members import person_name
from .periods import day_name, local_now

MAX_PENDING_REQUESTS = 20

REASON_TEXT = {
    "hold": "On hold for someone else",
    "cap": "Renewal limit reached",
    "overdue": "Overdue, please return",
}


# ---- My Books ---------------------------------------------------------------------------------------------------


def member_for_teacher(school, user):
    """The teacher's own library member, or None when they are not registered."""
    return (
        LibraryMember.objects.filter(school=school, staff__user=user, staff__school=school)
        .select_related("staff")
        .order_by("-is_active", "id")
        .first()
    )


def renew_block(loan, settings, today, waiting_book_ids) -> str:
    """Why this open loan cannot be renewed (R5), or "" when it can. Checked in the same order renew_loan checks."""
    if loan.due_date < today:
        return "overdue"
    if loan.renew_count >= settings.max_renewals:
        return "cap"
    if loan.book_id in waiting_book_ids:
        return "hold"
    return ""


def my_loan_rows(school, member, settings, today):
    """Open loans of `member`, oldest due first, with `can_renew` and the reason. Two queries."""
    loans = list(
        BookIssue.objects.filter(school=school, member=member, status=BookIssue.STATUS_ISSUED)
        .select_related("book", "copy")
        .order_by("due_date", "id")
    )
    waiting = set(
        Hold.objects.filter(school=school, status=Hold.STATUS_WAITING, book_id__in={loan.book_id for loan in loans})
        .values_list("book_id", flat=True)
    )
    rows = []
    for loan in loans:
        reason = renew_block(loan, settings, today, waiting)
        rows.append({
            "id": loan.pk,
            "book_title": loan.book.title,
            "author": loan.book.author,
            "copy_code": loan.copy.code if loan.copy_id else "",
            "issue_date": loan.issue_date.isoformat(),
            "due_date": loan.due_date.isoformat(),
            "days_overdue": days_overdue(loan.due_date, today),
            "accrued_fine": str(loan_fine(loan.due_date, today, loan.book.cost_per_copy, settings)),
            "renew_count": loan.renew_count,
            "max_renewals": settings.max_renewals,
            "state": loan_state(loan, today),
            "can_renew": reason == "",
            "reason": reason,
            "reason_text": REASON_TEXT.get(reason, ""),
        })
    return rows


def own_loan(school, member, issue_id):
    """The teacher's own open loan, else 404 (another member's loan and another school's are the same answer)."""
    if member is None or not BookIssue.objects.filter(pk=issue_id, school=school, member=member).exists():
        raise ResourceNotFound("Loan not found.")
    return issue_id


# ---- My Class ---------------------------------------------------------------------------------------------------


def scope_filter(pairs, prefix="member__student__") -> Q:
    """Q matching students inside the (class, section) pairs. An empty scope matches nothing."""
    query = Q(pk__in=[])
    for class_id, section_id in pairs:
        clause = Q(**{f"{prefix}current_class_id": class_id})
        if section_id is not None:
            clause &= Q(**{f"{prefix}current_section_id": section_id})
        query |= clause
    return query


def loan_in_scope(school, pairs, issue_id):
    """The open loan of a student inside the scope, else 404."""
    loan = (
        BookIssue.objects.filter(pk=issue_id, school=school, status=BookIssue.STATUS_ISSUED, member__member_type=LibraryMember.MEMBER_STUDENT)
        .filter(scope_filter(pairs))
        .first()
        if pairs
        else None
    )
    if loan is None:
        raise ResourceNotFound("Loan not found.")
    return loan


def next_slot_for(slots, class_id, section_id, now):
    """(slot, date) of the next active slot for the class (and section) that has not started, within a week."""
    mine = [s for s in slots if s.school_class_id == class_id and (s.section_id is None or s.section_id == section_id)]
    for offset in range(8):
        day = now.date() + timedelta(days=offset)
        name = day_name(day)
        if name is None:
            continue
        today_slots = [s for s in mine if s.day == name and (offset > 0 or s.period.start_time > now.time())]
        if today_slots:
            return min(today_slots, key=lambda s: (s.period.start_time, s.pk)), day
    return None, None


def slot_payload(slot, day):
    if slot is None:
        return None
    return {
        "id": slot.pk,
        "date": day.isoformat(),
        "day": slot.day,
        "period_name": slot.period.period,
        "start_time": slot.period.start_time.strftime("%H:%M"),
        "end_time": slot.period.end_time.strftime("%H:%M"),
        "room_label": slot.room_label,
    }


def class_groups(school, pairs, settings, reminded, today=None, now=None, limit=300):
    """One group per scope pair: the class, its next library period, and the open loans of its students.

    Loans are fetched once for the whole scope and grouped in Python by the student's class and section; the
    slots are fetched once too. `reminded` is the set of loan ids already reminded today.
    """
    from apps.core.models import Class, Section

    now = now or local_now()
    today = today or now.date()
    if not pairs:
        return []
    loans = list(
        BookIssue.objects.filter(school=school, status=BookIssue.STATUS_ISSUED, member__member_type=LibraryMember.MEMBER_STUDENT)
        .filter(scope_filter(pairs))
        .select_related("book", "copy", "member__student")
        .order_by("due_date", "id")[: limit * max(1, len(pairs))]
    )
    class_ids = {c for c, _ in pairs}
    slots = list(PeriodSlot.objects.filter(school=school, is_active=True, school_class_id__in=class_ids).select_related("period"))
    classes = {c.pk: c.name for c in Class.objects.filter(school=school, pk__in=class_ids)}
    sections = {s.pk: s.name for s in Section.objects.filter(pk__in={s for _, s in pairs if s is not None})}

    groups = []
    for class_id, section_id in sorted(pairs, key=lambda p: (classes.get(p[0], ""), p[1] or 0)):
        rows = []
        for loan in loans:
            student = loan.member.student
            if student.current_class_id != class_id or (section_id is not None and student.current_section_id != section_id):
                continue
            rows.append({
                "id": loan.pk,
                "student_name": person_name(loan.member),
                "section_name": sections.get(student.current_section_id, ""),
                "book_title": loan.book.title,
                "copy_code": loan.copy.code if loan.copy_id else "",
                "due_date": loan.due_date.isoformat(),
                "days_overdue": days_overdue(loan.due_date, today),
                "accrued_fine": str(loan_fine(loan.due_date, today, loan.book.cost_per_copy, settings)),
                "state": loan_state(loan, today),
                "reminded_today": loan.pk in reminded,
            })
        slot, day = next_slot_for(slots, class_id, section_id, now)
        groups.append({
            "school_class": class_id,
            "class_name": classes.get(class_id, ""),
            "section": section_id,
            "section_name": sections.get(section_id, ""),
            "next_slot": slot_payload(slot, day),
            "loans": rows[:limit],
            "loan_count": len(rows),
        })
    return groups


# ---- recommendations ----------------------------------------------------------------------------------------------


def request_row(book_request):
    return {
        "id": book_request.pk,
        "title": book_request.title,
        "notes": book_request.notes,
        "status": book_request.status,
        "review_note": book_request.review_note,
        "reviewed_at": book_request.reviewed_at.isoformat() if book_request.reviewed_at else None,
        "linked_book_title": book_request.linked_book.title if book_request.linked_book_id else "",
        "created_at": book_request.created_at.isoformat(),
    }


def home_scope(pairs):
    """The (class, section) a new request is filed under: the first pair in a stable order, or (None, None)."""
    if not pairs:
        return None, None
    return sorted(pairs, key=lambda p: (p[0], p[1] or 0))[0]


def pending_requests(school, user):
    return BookRequest.objects.filter(school=school, requested_by=user, status=BookRequest.STATUS_PENDING)


def search_books_queryset(school, term):
    from django.db.models import Count

    from apps.library.models import Book, BookCopy

    on_books = ~Q(copies__status=BookCopy.STATUS_WITHDRAWN)
    return (
        Book.objects.filter(school=school)
        .filter(Q(title__icontains=term) | Q(author__icontains=term) | Q(isbn__icontains=term))
        .select_related("category")
        .annotate(
            total_copies=Count("copies", filter=on_books),
            available_copies=Count("copies", filter=Q(copies__status=BookCopy.STATUS_AVAILABLE)),
        )
        .order_by("title", "id")
    )

