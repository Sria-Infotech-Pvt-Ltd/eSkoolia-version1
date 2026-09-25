from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
import logging
import csv
import io
import os
import re
from uuid import uuid4
from datetime import datetime
from django.conf import settings
from django.core.cache import cache
from django.core.files.storage import default_storage
from django.utils import timezone
from django.db.models.deletion import ProtectedError
from django.db.models import Count, Q
import requests
from rest_framework import permissions, status, viewsets
from config.pagination import ApiPageNumberPagination
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from .forms import StudentValidationModelForm
from .models import (
    Guardian,
    PromotionAuditLog,
    PromotionBatch,
    PromotionRecord,
    Student,
    StudentCategory,
    StudentClubMembership,
    StudentDocument,
    StudentGroup,
    StudentMultiClassRecord,
    StudentRecordAudit,
    StudentSubjectAssignment,
    StudentPromotionHistory,
    StudentTransferHistory,
)
from .serializers import (
    GuardianSerializer,
    PromotionAiRequestSerializer,
    PromotionAuditLogSerializer,
    PromotionBatchCreateSerializer,
    PromotionBatchSerializer,
    PromotionBulkUpdateSerializer,
    PromotionRecordSerializer,
    PromotionRecordUpdateSerializer,
    StudentCategorySerializer,
    StudentDocumentSerializer,
    StudentGroupSerializer,
    StudentMultiClassBulkSaveSerializer,
    StudentMultiClassRecordSerializer,
    StudentRecordAuditSerializer,
    StudentSubjectAssignmentRequestSerializer,
    StudentSubjectAssignmentSerializer,
    StudentPromoteRequestSerializer,
    StudentPromotionHistorySerializer,
    PincodeLookupQuerySerializer,
    StudentListSerializer,
    StudentSerializer,
    StudentTransferHistorySerializer,
)

logger = logging.getLogger(__name__)

class TenantScopedModelViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = ApiPageNumberPagination
    model = None
    permission_codes = {}

    def get_required_permission_code(self):
        action = getattr(self, "action", None)
        if action and action in self.permission_codes:
            return self.permission_codes[action]
        return self.permission_codes.get("*")

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        code = self.get_required_permission_code()
        if not code:
            return
        user = request.user
        if user.is_superuser:
            return
        if not hasattr(user, "has_permission_code") or not user.has_permission_code(code):
            raise PermissionDenied("You do not have permission to perform this action.")

    def get_queryset(self):
        user = self.request.user
        qs = self.model.objects.all()
        if user.school_id:
            return qs.filter(school_id=user.school_id)
        return qs.none()

    def perform_create(self, serializer):
        school = self.request.user.school
        if not school and getattr(self.request, "school", None):
            school = self.request.school
        if school:
            serializer.save(school=school)
            return
        # Superuser without school can provide school explicitly in payload
        serializer.save()

    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except IntegrityError:
            raise ValidationError({"detail": "Duplicate value violates a uniqueness constraint."})

    def update(self, request, *args, **kwargs):
        try:
            return super().update(request, *args, **kwargs)
        except IntegrityError:
            raise ValidationError({"detail": "Duplicate value violates a uniqueness constraint."})

    def partial_update(self, request, *args, **kwargs):
        try:
            return super().partial_update(request, *args, **kwargs)
        except IntegrityError:
            raise ValidationError({"detail": "Duplicate value violates a uniqueness constraint."})

class StudentCategoryViewSet(TenantScopedModelViewSet):
    model = StudentCategory
    serializer_class = StudentCategorySerializer
    pagination_class = ApiPageNumberPagination
    permission_codes = {"*": "student_info.student_category.view"}

    def _build_validation_error_response(self, field_errors=None, message="Validation failed"):
        return Response(
            {
                "success": False,
                "error_code": "VALIDATION_ERROR",
                "message": message,
                "field_errors": field_errors or {},
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    def _normalize_field_errors(self, serializer_errors):
        normalized = {}
        for field, errors in serializer_errors.items():
            if isinstance(errors, (list, tuple)):
                normalized[field] = [str(error) for error in errors]
            else:
                normalized[field] = [str(errors)]
        return normalized

    def _first_error_message(self, field_errors):
        for errors in field_errors.values():
            if isinstance(errors, list) and errors:
                return str(errors[0])
        return "Validation failed"

    def get_queryset(self):
        qs = super().get_queryset().order_by("name")
        params = self.request.query_params
        search = str(params.get("search") or params.get("q") or "").strip()
        status_filter = str(params.get("status") or "").strip().lower()
        name_filter = str(params.get("name") or "").strip()

        if search:
            qs = qs.filter(
                Q(name__icontains=search)
                | Q(code__icontains=search)
                | Q(description__icontains=search)
            )
        if name_filter:
            qs = qs.filter(name__icontains=name_filter)
        if status_filter in {"active", "inactive"}:
            qs = qs.filter(status=status_filter)
        # AI flagged / "needs attention" filter — categories with missing
        # description or zero students assigned.
        attention = str(params.get("attention") or "").strip()
        if attention in {"1", "true", "yes"}:
            qs = qs.annotate(_students_n=Count("students", distinct=True)).filter(
                Q(description="") | Q(description__isnull=True) | Q(_students_n=0)
            )
        return qs

    @action(detail=False, methods=["get"], url_path="summary", permission_classes=[permissions.IsAuthenticated])
    def summary(self, request):
        # KPI summary for the Student Categories page. Reads live from DB so a
        # refresh / DB restart always reflects current state. Tenant scope is
        # applied via super().get_queryset() (TenantScopedModelViewSet).
        base = super().get_queryset()
        annotated = base.annotate(students_n=Count("students", distinct=True))
        total = annotated.count()
        active = annotated.filter(status="active").count()
        inactive = annotated.filter(status="inactive").count()
        attention = annotated.filter(
            Q(description="") | Q(description__isnull=True) | Q(students_n=0)
        ).count()

        top_qs = annotated.filter(students_n__gt=0).order_by("-students_n", "name")[:5]
        top_categories = [
            {"id": c.id, "name": c.name, "students_count": c.students_n}
            for c in top_qs
        ]
        top_total_students = sum(c["students_count"] for c in top_categories)

        recent_qs = base.order_by("-created_at")[:5]
        recent_activity = [
            {
                "id": c.id,
                "name": c.name,
                "action": "Created",
                "created_at": c.created_at.isoformat() if c.created_at else "",
            }
            for c in recent_qs
        ]

        return Response({
            "success": True,
            "total_count": total,
            "active_count": active,
            "inactive_count": inactive,
            "attention_count": attention,
            "top_total_students": top_total_students,
            "top_categories": top_categories,
            "recent_activity": recent_activity,
        })

    @action(detail=False, methods=["get"], url_path="check-name")
    def check_name(self, request):
        name = str(request.query_params.get("name") or "").strip()
        if not name:
            return Response({"success": False, "message": "Category name is required."}, status=status.HTTP_400_BAD_REQUEST)

        queryset = self.get_queryset().filter(name__iexact=name)
        if getattr(self, "action", None) == "check_name" and self.request.query_params.get("exclude_id"):
            queryset = queryset.exclude(id=self.request.query_params.get("exclude_id"))
        exists = queryset.exists()
        return Response({"success": True, "exists": exists, "message": "Category exists." if exists else "Category available."})

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            field_errors = self._normalize_field_errors(serializer.errors)
            return self._build_validation_error_response(field_errors, self._first_error_message(field_errors))

        try:
            self.perform_create(serializer)
        except IntegrityError:
            return self._build_validation_error_response(
                {"name": ["Category name already exists."]},
                "Category name already exists.",
            )

        headers = self.get_success_headers(serializer.data)
        return Response(
            {
                "success": True,
                "message": "Student category created successfully.",
                "data": serializer.data,
            },
            status=status.HTTP_201_CREATED,
            headers=headers,
        )

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        if not serializer.is_valid():
            field_errors = self._normalize_field_errors(serializer.errors)
            return self._build_validation_error_response(field_errors, self._first_error_message(field_errors))

        try:
            self.perform_update(serializer)
        except IntegrityError:
            return self._build_validation_error_response(
                {"name": ["Category name already exists."]},
                "Category name already exists.",
            )

        return Response(
            {
                "success": True,
                "message": "Student category updated successfully.",
                "data": serializer.data,
            },
            status=status.HTTP_200_OK,
        )

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    @action(detail=False, methods=["patch"], url_path="bulk-status")
    def bulk_status(self, request):
        ids = request.data.get("ids") or []
        status_value = str(request.data.get("status") or "").strip().lower()
        if status_value not in {"active", "inactive"}:
            return self._build_validation_error_response({}, "Status must be either active or inactive.")
        if not isinstance(ids, list) or not ids:
            return self._build_validation_error_response({}, "Select at least one category.")

        queryset = self.get_queryset().filter(id__in=ids)
        already_count = queryset.filter(status=status_value).count()
        update_queryset = queryset.exclude(status=status_value)
        updated = update_queryset.update(status=status_value)

        if updated == 0:
            message = f"Selected categories are already {status_value}."
        elif already_count == 0:
            noun = "category" if updated == 1 else "categories"
            message = f"{updated} {noun} updated successfully."
        else:
            updated_noun = "category" if updated == 1 else "categories"
            already_noun = "category is" if already_count == 1 else "categories are"
            message = (
                f"{updated} {updated_noun} updated successfully. "
                f"{already_count} {already_noun} already {status_value}."
            )

        return Response({"success": True, "message": message})

    @action(detail=False, methods=["delete"], url_path="bulk-delete")
    def bulk_delete(self, request):
        ids = request.data.get("ids") or []
        if not isinstance(ids, list) or not ids:
            return self._build_validation_error_response({}, "Select at least one category.")

        queryset = self.get_queryset().filter(id__in=ids)
        blocked = queryset.filter(students__isnull=False).distinct()
        if blocked.exists():
            return self._build_validation_error_response({}, "One or more selected categories are assigned to students and cannot be deleted.")

        count = queryset.count()
        queryset.delete()
        return Response({"success": True, "message": f"{count} categories deleted successfully."}, status=status.HTTP_200_OK)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.students.exists():
            return self._build_validation_error_response(
                {},
                "Cannot delete category as it is assigned to students",
            )

        self.perform_destroy(instance)
        return Response(
            {
                "success": True,
                "message": "Student category deleted successfully.",
            },
            status=status.HTTP_200_OK,
        )

class StudentGroupViewSet(TenantScopedModelViewSet):
    model = StudentGroup
    serializer_class = StudentGroupSerializer
    pagination_class = ApiPageNumberPagination
    permission_codes = {"*": "student_info.student_group.view"}

    def _school_id(self):
        user = self.request.user
        return getattr(user, "school_id", None)

    def get_queryset(self):
        user = self.request.user
        qs = StudentGroup.objects.all()
        search = str(self.request.query_params.get("search") or "").strip()
        sort_by = str(self.request.query_params.get("sort_by") or "name").strip().lower()

        if user.school_id:
            qs = qs.filter(school_id=user.school_id).annotate(students_count=Count("students", distinct=True))
        else:
            return qs.none()

        if search:
            qs = qs.filter(name__icontains=search)

        group_type = str(self.request.query_params.get("type") or "").strip().upper()
        if group_type:
            qs = qs.filter(type=group_type)

        if sort_by == "count":
            return qs.order_by("-students_count", "name")

        if sort_by == "name":
            return qs.order_by("name")

        return qs.order_by("name")

    def perform_create(self, serializer):
        user = self.request.user
        school_id = getattr(user, "school_id", None)
        if not school_id:
            raw_school_id = self.request.data.get("school")
            if raw_school_id not in (None, ""):
                try:
                    school_id = int(raw_school_id)
                except (TypeError, ValueError):
                    raise ValidationError({"school": "School must be a valid numeric id."})

        if not school_id:
            raise ValidationError({"school": "School is required to create a student group."})

        serializer.save(school_id=school_id)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        # Unassign all students from this group (SET_NULL via FK cascade is automatic,
        # but we do it explicitly to be safe and return meaningful data)
        instance.students.update(student_group=None)
        self.perform_destroy(instance)
        return Response({"success": True, "message": "Group deleted successfully."}, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="stats")
    def stats(self, request):
        school_id = self._school_id()
        qs = Student.objects.filter(is_deleted=False, is_active=True)
        if school_id:
            qs = qs.filter(school_id=school_id)
        groups_qs = StudentGroup.objects.all()
        if school_id:
            groups_qs = groups_qs.filter(school_id=school_id)

        total = qs.count()
        assigned = qs.filter(student_group__isnull=False).count()
        unassigned = total - assigned
        house_count = groups_qs.filter(type="HOUSE").count()
        club_count = groups_qs.filter(type="CLUB").count()
        return Response({
            "totalStudents": total,
            "assigned": assigned,
            "unassigned": unassigned,
            "houseCount": house_count,
            "clubCount": club_count,
        })

    @action(detail=False, methods=["get"], url_path="students")
    def list_students(self, request):
        school_id = self._school_id()
        qs = Student.objects.filter(is_deleted=False, is_active=True)
        if school_id:
            qs = qs.filter(school_id=school_id)
        qs = qs.select_related("current_class", "current_section", "student_group")

        # Filters
        class_name = request.query_params.get("class")
        section_name = request.query_params.get("section")
        group_id = request.query_params.get("groupId")
        query_status = request.query_params.get("status")

        if class_name:
            qs = qs.filter(current_class__name=class_name)
        if section_name:
            qs = qs.filter(current_section__name=section_name)
        if group_id:
            ids = [gid.strip() for gid in group_id.split(",") if gid.strip().isdigit()]
            if ids:
                qs = qs.filter(student_group_id__in=ids)
        if query_status == "unassigned":
            qs = qs.filter(student_group__isnull=True)

        qs = qs.order_by(
            "current_class__numeric_order", "current_section__name",
            "first_name", "last_name"
        )

        # Evaluate queryset once into a list — avoids double-hit on the DB
        student_list = list(qs)
        student_ids = [st.id for st in student_list]

        # Fetch all club memberships for these students in one query (avoid N+1)
        from collections import defaultdict as _dd
        club_map = _dd(list)
        if student_ids:
            memberships = StudentClubMembership.objects.filter(
                student_id__in=student_ids
            ).values("student_id", "club_id", "role")
            for m in memberships:
                club_map[m["student_id"]].append({"clubId": m["club_id"], "role": m["role"]})

        def _serialize(st):
            return {
                "id": st.id,
                "name": f"{st.first_name} {st.last_name}".strip(),
                "admissionNo": st.admission_no,
                "class": st.current_class.name if st.current_class else "",
                "section": st.current_section.name if st.current_section else "",
                "classIndex": st.current_class.numeric_order if st.current_class else 999,
                "currentGroupId": st.student_group_id,  # HOUSE assignment (single FK)
                "clubIds": [m["clubId"] for m in club_map[st.id]],  # CLUB memberships (M2M)
                "clubMemberships": club_map[st.id],  # includes role
                "gender": st.gender,
            }

        # Optional pagination: only activated when ?page= is present.
        # Without it the response is the original flat array (backward-compatible).
        raw_page = request.query_params.get("page")
        if raw_page is not None:
            try:
                page = max(1, int(raw_page))
            except (ValueError, TypeError):
                page = 1
            try:
                page_size = max(1, min(int(request.query_params.get("page_size", 10)), 200))
            except (ValueError, TypeError):
                page_size = 10
            total = len(student_list)
            total_pages = max(1, (total + page_size - 1) // page_size)
            page = min(page, total_pages)
            offset = (page - 1) * page_size
            results = [_serialize(st) for st in student_list[offset:offset + page_size]]
            return Response({
                "results": results,
                "total": total,
                "page": page,
                "page_size": page_size,
                "total_pages": total_pages,
            })

        # No ?page= — return full flat list (original behaviour)
        return Response([_serialize(st) for st in student_list])

    @action(detail=False, methods=["post"], url_path="assign")
    def assign(self, request):
        school_id = self._school_id()
        student_id = request.data.get("studentId")
        group_id = request.data.get("groupId")

        if not student_id:
            return Response({"error": "studentId is required"}, status=400)

        qs = Student.objects.filter(id=student_id)
        if school_id:
            qs = qs.filter(school_id=school_id)
        student = qs.first()
        if not student:
            return Response({"error": "Student not found"}, status=404)

        if group_id is None:
            student.student_group = None
        else:
            group_qs = StudentGroup.objects.filter(id=group_id)
            if school_id:
                group_qs = group_qs.filter(school_id=school_id)
            group = group_qs.first()
            if not group:
                return Response({"error": "Group not found"}, status=404)
            student.student_group = group

        student.save(update_fields=["student_group"])
        return Response({"studentId": student.id, "groupId": student.student_group_id})

    @action(detail=False, methods=["post"], url_path="bulk-assign")
    def bulk_assign(self, request):
        school_id = self._school_id()
        student_ids = request.data.get("studentIds", [])
        group_id = request.data.get("groupId")

        if not isinstance(student_ids, list) or not student_ids:
            return Response({"error": "studentIds must be a non-empty list"}, status=400)

        qs = Student.objects.filter(id__in=student_ids)
        if school_id:
            qs = qs.filter(school_id=school_id)

        if group_id is None:
            assigned = qs.update(student_group=None)
        else:
            group_qs = StudentGroup.objects.filter(id=group_id)
            if school_id:
                group_qs = group_qs.filter(school_id=school_id)
            group = group_qs.first()
            if not group:
                return Response({"error": "Group not found"}, status=404)
            assigned = qs.update(student_group=group)

        return Response({"assigned": assigned})

    # ------------------------------------------------------------------
    # CLUB membership endpoints (M2M — a student can join many clubs)
    # ------------------------------------------------------------------

    @action(detail=False, methods=["post"], url_path="club-toggle")
    def club_toggle(self, request):
        """Add or remove a student from a club (toggle).

        Body: { studentId, clubId, role? }
        Returns: { studentId, clubId, action: "added"|"removed", clubIds: [...] }
        """
        school_id = self._school_id()
        student_id = request.data.get("studentId")
        club_id = request.data.get("clubId")
        role = request.data.get("role", "member")

        if not student_id or not club_id:
            return Response({"error": "studentId and clubId are required"}, status=400)

        student_qs = Student.objects.filter(id=student_id, is_deleted=False)
        if school_id:
            student_qs = student_qs.filter(school_id=school_id)
        student = student_qs.first()
        if not student:
            return Response({"error": "Student not found"}, status=404)

        club_qs = StudentGroup.objects.filter(id=club_id, type="CLUB")
        if school_id:
            club_qs = club_qs.filter(school_id=school_id)
        club = club_qs.first()
        if not club:
            return Response({"error": "Club not found"}, status=404)

        membership = StudentClubMembership.objects.filter(student=student, club=club).first()
        if membership:
            membership.delete()
            action_taken = "removed"
        else:
            StudentClubMembership.objects.create(student=student, club=club, role=role)
            action_taken = "added"

        club_ids = list(
            StudentClubMembership.objects.filter(student=student).values_list("club_id", flat=True)
        )
        return Response({
            "studentId": student.id,
            "clubId": club.id,
            "action": action_taken,
            "clubIds": club_ids,
        })

    @action(detail=False, methods=["post"], url_path="club-assign")
    def club_assign(self, request):
        """Add a student to a club (idempotent — no error if already a member).

        Body: { studentId, clubId, role? }
        """
        school_id = self._school_id()
        student_id = request.data.get("studentId")
        club_id = request.data.get("clubId")
        role = request.data.get("role", "member")

        if not student_id or not club_id:
            return Response({"error": "studentId and clubId are required"}, status=400)

        student_qs = Student.objects.filter(id=student_id, is_deleted=False)
        if school_id:
            student_qs = student_qs.filter(school_id=school_id)
        student = student_qs.first()
        if not student:
            return Response({"error": "Student not found"}, status=404)

        club_qs = StudentGroup.objects.filter(id=club_id, type="CLUB")
        if school_id:
            club_qs = club_qs.filter(school_id=school_id)
        club = club_qs.first()
        if not club:
            return Response({"error": "Club not found"}, status=404)

        membership, created = StudentClubMembership.objects.get_or_create(
            student=student, club=club, defaults={"role": role}
        )
        if not created and membership.role != role:
            membership.role = role
            membership.save(update_fields=["role"])

        club_ids = list(
            StudentClubMembership.objects.filter(student=student).values_list("club_id", flat=True)
        )
        return Response({
            "studentId": student.id,
            "clubId": club.id,
            "role": membership.role,
            "created": created,
            "clubIds": club_ids,
        })

    @action(detail=False, methods=["post"], url_path="club-remove")
    def club_remove(self, request):
        """Remove a student from a club.

        Body: { studentId, clubId }
        """
        school_id = self._school_id()
        student_id = request.data.get("studentId")
        club_id = request.data.get("clubId")

        if not student_id or not club_id:
            return Response({"error": "studentId and clubId are required"}, status=400)

        deleted, _ = StudentClubMembership.objects.filter(
            student_id=student_id,
            club_id=club_id,
            student__school_id=school_id,
        ).delete()

        club_ids = list(
            StudentClubMembership.objects.filter(
                student_id=student_id, student__school_id=school_id
            ).values_list("club_id", flat=True)
        )
        return Response({"studentId": student_id, "clubId": club_id, "removed": deleted > 0, "clubIds": club_ids})

    @action(detail=False, methods=["get"], url_path="club-members")
    def club_members(self, request):
        """List all members of a specific club.

        Query params: clubId (required), class (optional), section (optional)
        Returns list of student objects with their role in the club.
        """
        school_id = self._school_id()
        club_id = request.query_params.get("clubId")
        class_name = request.query_params.get("class")
        section_name = request.query_params.get("section")

        if not club_id:
            return Response({"error": "clubId is required"}, status=400)

        club_qs = StudentGroup.objects.filter(id=club_id, type="CLUB")
        if school_id:
            club_qs = club_qs.filter(school_id=school_id)
        if not club_qs.exists():
            return Response({"error": "Club not found"}, status=404)

        memberships_qs = StudentClubMembership.objects.filter(
            club_id=club_id
        ).select_related(
            "student", "student__current_class", "student__current_section"
        )
        if school_id:
            memberships_qs = memberships_qs.filter(student__school_id=school_id)
        if class_name:
            memberships_qs = memberships_qs.filter(student__current_class__name=class_name)
        if section_name:
            memberships_qs = memberships_qs.filter(student__current_section__name=section_name)

        memberships_qs = memberships_qs.order_by(
            "student__current_class__numeric_order",
            "student__current_section__name",
            "student__first_name",
            "student__last_name",
        )

        result = []
        for m in memberships_qs:
            st = m.student
            result.append({
                "id": st.id,
                "name": f"{st.first_name} {st.last_name}".strip(),
                "admissionNo": st.admission_no,
                "class": st.current_class.name if st.current_class else "",
                "section": st.current_section.name if st.current_section else "",
                "classIndex": st.current_class.numeric_order if st.current_class else 999,
                "role": m.role,
                "joinedAt": m.joined_at.isoformat() if m.joined_at else None,
                "clubId": int(club_id),
            })
        return Response(result)

    @action(detail=False, methods=["get"], url_path="student-clubs")
    def student_clubs(self, request):
        """Return all clubs a given student belongs to.

        Query params: studentId (required)
        """
        school_id = self._school_id()
        student_id = request.query_params.get("studentId")
        if not student_id:
            return Response({"error": "studentId is required"}, status=400)

        memberships_qs = StudentClubMembership.objects.filter(
            student_id=student_id
        ).select_related("club")
        if school_id:
            memberships_qs = memberships_qs.filter(club__school_id=school_id)

        result = []
        for m in memberships_qs.order_by("club__name"):
            result.append({
                "clubId": m.club_id,
                "name": m.club.name,
                "emoji": m.club.emoji or "",
                "color": m.club.color or "#2980b9",
                "bgColor": m.club.bg_color or "#e8f4fd",
                "role": m.role,
                "joinedAt": m.joined_at.isoformat() if m.joined_at else None,
            })
        return Response(result)

    @action(detail=False, methods=["get"], url_path="sortwell-preview")
    def sortwell_preview(self, request):
        school_id = self._school_id()
        scope = request.query_params.get("scope", "unassigned")

        houses = list(StudentGroup.objects.filter(
            **{"school_id": school_id} if school_id else {},
            type="HOUSE"
        ).order_by("id"))

        if not houses:
            return Response({"houses": [], "total": 0})

        qs = Student.objects.filter(is_deleted=False, is_active=True)
        if school_id:
            qs = qs.filter(school_id=school_id)
        if scope == "unassigned":
            qs = qs.filter(student_group__isnull=True)

        total = qs.count()
        n = len(houses)
        base = total // n
        remainder = total % n

        preview = []
        for i, house in enumerate(houses):
            count = base + (1 if i < remainder else 0)
            preview.append({
                "groupId": house.id,
                "groupName": house.name,
                "emoji": house.emoji,
                "color": house.color,
                "bgColor": house.bg_color,
                "count": count,
            })

        return Response({"houses": preview, "total": total, "houseCount": n})

    @action(detail=False, methods=["post"], url_path="sortwell")
    def sortwell(self, request):
        import random as rnd
        school_id = self._school_id()
        method = request.data.get("method", "random")
        scope = request.data.get("scope", "unassigned")

        houses = list(StudentGroup.objects.filter(
            **{"school_id": school_id} if school_id else {},
            type="HOUSE"
        ).order_by("id"))

        if not houses:
            return Response({"error": "No house-type groups found"}, status=400)

        with transaction.atomic():
            if scope == "all":
                # Clear all house-type assignments
                qs_clear = Student.objects.filter(student_group__type="HOUSE")
                if school_id:
                    qs_clear = qs_clear.filter(school_id=school_id)
                qs_clear.update(student_group=None)

            qs = Student.objects.filter(is_deleted=False, is_active=True)
            if school_id:
                qs = qs.filter(school_id=school_id)
            if scope == "unassigned":
                qs = qs.filter(student_group__isnull=True)

            students = list(qs.select_related("current_class"))

            if method == "random":
                rnd.shuffle(students)
            elif method == "alpha":
                students.sort(key=lambda s: f"{s.first_name} {s.last_name}".strip().lower())
            elif method == "classwise":
                students.sort(key=lambda s: (
                    s.current_class.numeric_order if s.current_class else 999,
                    f"{s.first_name} {s.last_name}".strip().lower()
                ))
            elif method == "gender":
                males = [s for s in students if s.gender == "male"]
                females = [s for s in students if s.gender != "male"]
                interleaved = []
                for idx in range(max(len(males), len(females))):
                    if idx < len(males):
                        interleaved.append(males[idx])
                    if idx < len(females):
                        interleaved.append(females[idx])
                students = interleaved

            distribution = {h.id: [] for h in houses}
            for idx, student in enumerate(students):
                house = houses[idx % len(houses)]
                distribution[house.id].append(student.id)

            total = 0
            for house_id, sids in distribution.items():
                if sids:
                    Student.objects.filter(id__in=sids).update(student_group_id=house_id)
                    total += len(sids)

        dist_result = [
            {"groupId": h.id, "groupName": h.name, "count": len(distribution[h.id])}
            for h in houses
        ]
        return Response({"assigned": total, "distribution": dist_result})

    @action(detail=True, methods=["post"], url_path="assign-students")
    def assign_students(self, request, *args, **kwargs):
        group = self.get_object()
        raw_ids = request.data.get("student_ids")
        if not isinstance(raw_ids, list) or not raw_ids:
            return Response(
                {"success": False, "message": "student_ids is required.", "field_errors": {"student_ids": "Select at least one student."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        valid_ids = []
        for value in raw_ids:
            try:
                valid_ids.append(int(value))
            except (TypeError, ValueError):
                continue

        if not valid_ids:
            return Response(
                {"success": False, "message": "No valid student ids provided.", "field_errors": {"student_ids": "Invalid student ids."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        students_qs = Student.objects.filter(id__in=valid_ids, school_id=request.user.school_id)

        updated = students_qs.update(student_group=group)
        return Response(
            {
                "success": True,
                "message": f"{updated} student(s) assigned to group successfully.",
                "updated": updated,
            },
            status=status.HTTP_200_OK,
        )

class GuardianViewSet(TenantScopedModelViewSet):
    model = Guardian
    serializer_class = GuardianSerializer
    pagination_class = ApiPageNumberPagination
    permission_codes = {"*": "student_info.add_student.view"}

class StudentViewSet(TenantScopedModelViewSet):
    model = Student
    serializer_class = StudentSerializer
    pagination_class = ApiPageNumberPagination
    permission_codes = {
        # NOTE: perform_create is overridden below to auto-create a User login
        # account for every new student (Task 6 — LLM integration).
        "list": "student_info.student_list.view",
        "retrieve": "student_info.student_list.view",
        "create": "student_info.add_student.view",
        "update": "student_info.add_student.view",
        "partial_update": "student_info.add_student.view",
        "check_admission_no": "student_info.add_student.view",
        "next_admission_no": "student_info.add_student.view",
        "upload_photo": "student_info.add_student.view",
        "pincode_details": "student_info.add_student.view",
        "destroy": "student_info.delete_student_record.view",
        "soft_delete": "student_info.delete_student_record.view",
        "set_status": "student_info.add_student.view",
        "restore": "student_info.delete_student_record.view",
        "permanent_delete": "student_info.delete_student_record.view",
        "promote": "student_info.student_promote.view",
        "auto_assign_classes": "student_info.student_list.view",
        "next_roll_no": "student_info.add_student.view",
        "sections_summary": "student_info.add_student.view",
    }

    # ------------------------------------------------------------------
    # Task 6 (LLM integration): auto-create a User login on admission
    # ------------------------------------------------------------------

    def _auto_create_student_user(self, student):
        """Create a User account for the student and link student.user to it.

        Username: student's primary email if provided, otherwise admission_no.
        Password: DOB as DDMMYYYY, or admission_no if DOB is absent.
        must_change_password is set so the student is forced to change on first login.
        Failures are logged as warnings; they never rollback the student record.
        Credentials are stored on self._student_creds for inclusion in the API response.
        """
        User = get_user_model()
        self._student_creds = None
        try:
            student_school = student.school

            # Username = full name (e.g. "ArjunKumar"); if taken, append last 2 digits of admission_no
            email = (student.email or "").strip()
            full_name = f"{student.first_name or ''}{student.last_name or ''}".strip()
            base_username = re.sub(r"\s+", "", full_name).lower() or student.admission_no
            if not User.objects.filter(username=base_username).exists():
                username = base_username
            else:
                suffix = (student.admission_no or "")[-2:]
                username = f"{base_username}{suffix}"
                # Last resort: keep incrementing if suffix still collides
                counter = 1
                while User.objects.filter(username=username).exists():
                    username = f"{base_username}{suffix}{counter}"
                    counter += 1

            default_password = (
                student.date_of_birth.strftime("%d%m%Y")
                if student.date_of_birth
                else student.admission_no
            )

            user = User(
                username=username,
                first_name=student.first_name,
                last_name=student.last_name,
                email=email,
                school=student_school,
                must_change_password=True,
            )
            user.set_password(default_password)
            user.save()

            student.user = user
            student.save(update_fields=["user"])
            self._student_creds = {"username": username, "password": default_password}
        except Exception:
            logger.warning(
                "Auto-create user failed for student admission_no=%s; "
                "student saved without login account.",
                student.admission_no,
                exc_info=True,
            )

    def _auto_create_guardian_user(self, student):
        """Create a User account for the student's guardian and link guardian.user to it.

        Username = Guardian 1's phone number.
        Password = phone number (must_change_password=True forces change on first login).
        If the phone already has an account, re-use it and add the Parent role.
        Failures never roll back the student record.
        Credentials are stored on self._guardian_creds for inclusion in the API response.
        """
        guardian = getattr(student, "guardian", None)
        self._guardian_creds = None
        if guardian is None:
            return
        if guardian.user_id:
            return  # Already has a login account

        phone = (guardian.phone or "").strip()
        if not phone:
            return

        User = get_user_model()
        try:
            from apps.access_control.models import Role, UserRole

            # Re-use the account if the phone is already registered.
            user = User.objects.filter(username=phone).first()
            if user is None:
                user = User(
                    username=phone,
                    first_name=(guardian.full_name or "").split()[0] if guardian.full_name else "",
                    last_name=" ".join((guardian.full_name or "").split()[1:]),
                    email=guardian.email or "",
                    school=student.school,
                    must_change_password=True,
                )
                # Initial password = phone number itself (shown to admin after enrollment)
                user.set_password(phone)
                user.save()
                self._guardian_creds = {"username": phone, "password": phone}

            # Link guardian → user
            guardian.user = user
            guardian.save(update_fields=["user"])

            # Assign the school's "Parent" role (portal_type='parent') if it exists.
            parent_role = (
                Role.objects.filter(
                    school=student.school,
                    portal_type="parent",
                ).first()
                or Role.objects.filter(
                    school=student.school,
                    name__icontains="parent",
                ).first()
            )
            if parent_role:
                UserRole.objects.get_or_create(user=user, role=parent_role)

        except Exception:
            logger.warning(
                "Auto-create guardian user failed for student admission_no=%s; "
                "student saved without guardian login account.",
                student.admission_no,
                exc_info=True,
            )

    def perform_create(self, serializer):
        school = self.request.user.school
        if not school and getattr(self.request, "school", None):
            school = self.request.school
        student = serializer.save(school=school) if school else serializer.save()
        self._auto_create_student_user(student)
        self._auto_create_guardian_user(student)
        # Aggregate credentials for the create() response
        self._enrollment_credentials = {}
        if getattr(self, "_student_creds", None):
            self._enrollment_credentials["student"] = self._student_creds
        if getattr(self, "_guardian_creds", None):
            self._enrollment_credentials["parent"] = self._guardian_creds

    def get_serializer_class(self):
        if getattr(self, "action", None) == "list":
            return StudentListSerializer
        return super().get_serializer_class()

    def get_queryset(self):
        user = self.request.user
        action = getattr(self, "action", None)

        if action == "list":
            qs = Student.objects.select_related("current_class", "current_section", "guardian", "category", "student_group").only(
                "id",
                "school_id",
                "academic_year_id",
                "admission_no",
                "roll_no",
                "first_name",
                "middle_name",
                "last_name",
                "date_of_birth",
                "gender",
                "phone",
                "category_id",
                "student_group_id",
                "guardian_id",
                "guardian__full_name",
                "guardian__phone",
                "current_class_id",
                "current_section_id",
                "status",
                "is_disabled",
                "is_active",
                "is_deleted",
                "created_at",
            )
        else:
            qs = Student.objects.select_related(
                "school",
                "academic_year",
                "category",
                "student_group",
                "guardian",
                "current_class",
                "current_section",
                "admission_inquiry",
            )

        if action in {"retrieve", "create", "update", "partial_update"}:
            qs = qs.prefetch_related("documents")

        search = (self.request.query_params.get("search") or "").strip()
        class_id = self.request.query_params.get("class") or self.request.query_params.get("current_class")
        section_id = self.request.query_params.get("section") or self.request.query_params.get("current_section")
        academic_year_id = self.request.query_params.get("academic_year")
        is_active_param = (self.request.query_params.get("is_active") or "").strip().lower()
        include_deleted = (self.request.query_params.get("include_deleted") or "").strip().lower() in {"1", "true", "yes"}
        deleted_only = (self.request.query_params.get("deleted_only") or "").strip().lower() in {"1", "true", "yes"}
        unassigned_only = (self.request.query_params.get("unassigned") or "").strip().lower() in {"1", "true", "yes"}

        if deleted_only:
            qs = qs.filter(is_deleted=True)
        elif not include_deleted:
            qs = qs.filter(is_deleted=False)

        if search and not re.fullmatch(r"[A-Za-z0-9 _\-./]+", search):
            raise ValidationError({"search": "Please enter valid search text"})

        if class_id and not str(class_id).isdigit():
            raise ValidationError({"current_class": "Please select a valid class."})
        if section_id and not str(section_id).isdigit():
            raise ValidationError({"current_section": "Please select a valid section."})
        if academic_year_id and not str(academic_year_id).isdigit():
            raise ValidationError({"academic_year": "Please select a valid academic year."})

        from apps.core.models import AcademicYear, Class, Section

        if class_id:
            class_qs = Class.objects.filter(id=int(class_id), school_id=user.school_id)
            if not class_qs.exists():
                raise ValidationError({"current_class": "Selected class is not available."})

        if section_id:
            section_qs = Section.objects.filter(id=int(section_id))
            if class_id:
                section_qs = section_qs.filter(school_class_id=int(class_id))
            section_qs = section_qs.filter(school_class__school_id=user.school_id)
            if not section_qs.exists():
                raise ValidationError({"current_section": "Selected section is not available."})

        if academic_year_id:
            year_qs = AcademicYear.objects.filter(id=int(academic_year_id), school_id=user.school_id)
            if not year_qs.exists():
                raise ValidationError({"academic_year": "Selected academic year is not available."})

        if class_id:
            qs = qs.filter(current_class_id=class_id)
        if section_id:
            qs = qs.filter(current_section_id=section_id)
        if unassigned_only:
            qs = qs.filter(current_class_id__isnull=True, current_section_id__isnull=True)
        if academic_year_id:
            qs = qs.filter(academic_year_id=academic_year_id)
        if is_active_param in {"1", "true", "yes"}:
            qs = qs.filter(is_active=True)
        elif is_active_param in {"0", "false", "no"}:
            qs = qs.filter(is_active=False)
        if search:
            parts = search.strip().split()
            q = (
                Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(admission_no__icontains=search)
                | Q(roll_no__icontains=search)
            )
            if len(parts) >= 2:
                # "Vamshi Yadav" → first_name=Vamshi, last_name=Yadav (and reversed)
                q |= Q(first_name__icontains=parts[0]) & Q(last_name__icontains=parts[-1])
                q |= Q(first_name__icontains=parts[-1]) & Q(last_name__icontains=parts[0])
            qs = qs.filter(q)

        if user.school_id:
            return qs.filter(school_id=user.school_id)
        return qs.none()

    def _field_alias(self, field):
        aliases = {
            "current_class": "class",
            "current_section": "section",
            "date_of_birth": "dob",
        }
        return aliases.get(field, field)

    def _normalize_pincode_office(self, office):
        office = office or {}
        return {
            "name": str(office.get("Name") or "").strip(),
            "branch_type": str(office.get("BranchType") or "").strip(),
            "delivery_status": str(office.get("DeliveryStatus") or "").strip(),
            "district": str(office.get("District") or "").strip(),
            "state": str(office.get("State") or "").strip(),
            "region": str(office.get("Region") or "").strip(),
            "division": str(office.get("Division") or "").strip(),
            "circle": str(office.get("Circle") or "").strip(),
            "taluk": str(office.get("Taluk") or "").strip(),
            "block": str(office.get("Block") or "").strip(),
            "country": str(office.get("Country") or "").strip(),
            "pincode": str(office.get("Pincode") or "").strip(),
        }

    def _city_from_post_office_name(self, office):
        raw_name = str((office or {}).get("name") or "").strip()
        if not raw_name:
            return ""

        # Remove common India Post branch suffixes so UI gets clean city-like values.
        cleaned = re.sub(r"\s*[-(]?\s*(?:S\.?O|B\.?O|H\.?O|G\.?P\.?O|SO|BO|HO|GPO)\s*[).-]*\s*$", "", raw_name, flags=re.IGNORECASE)
        return cleaned.strip()

    def _fetch_pincode_details(self, pincode):
        cache_key = f"student_pincode_details:v2:{pincode}"
        try:
            cached = cache.get(cache_key)
        except Exception as cache_err:  # Redis down / auth / allowlist — degrade gracefully
            logger.warning("Pincode cache read failed (%s); continuing without cache.", cache_err)
            cached = None
        if cached:
            return cached

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json",
        }
        response = requests.get(f"https://api.postalpincode.in/pincode/{pincode}", timeout=8, headers=headers)
        response.raise_for_status()
        payload = response.json()

        if not isinstance(payload, list) or not payload:
            raise ValidationError({"pincode": "Invalid PIN Code"})

        entry = payload[0] or {}
        if str(entry.get("Status") or "").strip().lower() != "success":
            raise ValidationError({"pincode": "Invalid PIN Code"})

        offices = entry.get("PostOffice") or []
        normalized_offices = [self._normalize_pincode_office(office) for office in offices if office]
        normalized_offices = [office for office in normalized_offices if office.get("name")]

        if not normalized_offices:
            raise ValidationError({"pincode": "Invalid PIN Code"})

        selected_office = next((office for office in normalized_offices if office.get("district")), normalized_offices[0])
        district = str(selected_office.get("district") or "").strip()
        state = str(selected_office.get("state") or "").strip()

        if not district or not state:
            raise ValidationError({"pincode": "Invalid PIN Code"})

        city_options = []
        for office in normalized_offices:
            city_candidate = self._city_from_post_office_name(office)
            if city_candidate:
                city_options.append(city_candidate)

        # District fallback only when post-office names are unavailable.
        if not city_options and district:
            city_options = [district]

        city_options = sorted(set(city_options), key=lambda value: value.lower())
        city = city_options[0] if city_options else ""

        result = {
            "pincode": pincode,
            "state": state,
            "district": district,
            "city": city,
            "city_options": city_options,
            "selected_post_office": selected_office,
            "post_offices": normalized_offices,
            "multiple_post_offices": len(normalized_offices) > 1,
        }
        try:
            cache.set(cache_key, result, 24 * 60 * 60)
        except Exception as cache_err:  # Redis down / auth / allowlist — skip caching
            logger.warning("Pincode cache write failed (%s); response still returned.", cache_err)
        return result

    def _normalize_field_errors(self, serializer_errors):
        normalized = {}
        for field, errors in serializer_errors.items():
            key = self._field_alias(str(field))
            if isinstance(errors, (list, tuple)):
                normalized[key] = str(errors[0]) if errors else "Validation failed"
            else:
                normalized[key] = str(errors)
        return normalized

    def _validation_response(self, serializer_errors=None, message="Validation failed"):
        return Response(
            {
                "success": False,
                "message": message,
                "field_errors": self._normalize_field_errors(serializer_errors or {}),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    def _normalize_import_row(self, raw_row):
        key_aliases = {
            "admission no": "admission_no",
            "admission_no": "admission_no",
            "admission number": "admission_no",
            "admission_number": "admission_no",
            "roll no": "roll_no",
            "roll_no": "roll_no",
            "roll number": "roll_no",
            "roll_number": "roll_no",
            "first name": "first_name",
            "first_name": "first_name",
            "last name": "last_name",
            "last_name": "last_name",
            "dob": "date_of_birth",
            "date of birth": "date_of_birth",
            "date_of_birth": "date_of_birth",
            "academic year": "academic_year",
            "academic_year": "academic_year",
            "class": "current_class",
            "current class": "current_class",
            "current_class": "current_class",
            "section": "current_section",
            "current section": "current_section",
            "current_section": "current_section",
            "custom gender": "custom_gender",
            "custom_gender": "custom_gender",
            "blood group": "blood_group",
            "blood_group": "blood_group",
            "address": "address_line",
            "address line": "address_line",
            "address_line": "address_line",
            "pin": "pincode",
            "zip": "pincode",
            "postal code": "pincode",
            "postal_code": "pincode",
            "student category": "category",
            "student_category": "category",
        }

        cleaned = {}
        for key, value in (raw_row or {}).items():
            key_text = str(key or "").strip()
            if not key_text:
                continue
            normalized_key = key_aliases.get(key_text.lower(), key_text.replace(" ", "_").lower())

            value_text = "" if value is None else str(value).strip()
            if value_text == "":
                cleaned[normalized_key] = ""
                continue

            if normalized_key == "date_of_birth":
                parsed = None
                for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
                    try:
                        parsed = datetime.strptime(value_text, fmt).date().isoformat()
                        break
                    except ValueError:
                        continue
                cleaned[normalized_key] = parsed or value_text
                continue

            if normalized_key in {"academic_year", "current_class", "current_section", "category", "guardian"}:
                cleaned[normalized_key] = int(value_text) if value_text.isdigit() else value_text
                continue

            if normalized_key in {"is_active", "is_disabled"}:
                lowered = value_text.lower()
                if lowered in {"true", "1", "yes", "y"}:
                    cleaned[normalized_key] = True
                elif lowered in {"false", "0", "no", "n"}:
                    cleaned[normalized_key] = False
                else:
                    cleaned[normalized_key] = value_text
                continue

            cleaned[normalized_key] = value_text

        return cleaned

    def _duplicate_warning(self, validated_data):
        first_name = (validated_data.get("first_name") or "").strip()
        last_name = (validated_data.get("last_name") or "").strip()
        dob = validated_data.get("date_of_birth")
        phone = (validated_data.get("phone") or "").strip()
        if not (first_name and dob and phone):
            return None

        queryset = Student.objects.filter(
            school_id=self.request.user.school_id,
            first_name__iexact=first_name,
            last_name__iexact=last_name,
            date_of_birth=dob,
            phone=phone,
        )
        if queryset.exists():
            return "Possible duplicate found: same name, DOB and phone already exists"
        return None

    def _build_model_form_data(self, data):
        if hasattr(data, "dict"):
            raw_data = data.dict()
        else:
            raw_data = dict(data or {})

        normalized = {}
        for key, value in raw_data.items():
            if isinstance(value, (list, tuple)):
                normalized[str(key)] = value[-1] if value else ""
            else:
                normalized[str(key)] = value

        if "class" in normalized and "current_class" not in normalized:
            normalized["current_class"] = normalized.get("class")
        if "section" in normalized and "current_section" not in normalized:
            normalized["current_section"] = normalized.get("section")
        if "dob" in normalized and "date_of_birth" not in normalized:
            normalized["date_of_birth"] = normalized.get("dob")

        return normalized

    def _validate_with_model_form(self, data, instance=None, partial=False):
        form = StudentValidationModelForm(
            data=self._build_model_form_data(data),
            instance=instance,
            partial=partial,
            user=self.request.user,
        )
        if form.is_valid():
            return None
        return self._validation_response(form.errors)

    def _combine_warnings(self, *parts):
        joined = "; ".join(p for p in parts if p)
        return joined or None

    def create(self, request, *args, **kwargs):
        form_error_response = self._validate_with_model_form(request.data)
        if form_error_response:
            return form_error_response

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return self._validation_response(serializer.errors)

        warning = self._combine_warnings(
            self._duplicate_warning(serializer.validated_data),
            getattr(serializer, "_age_class_warning", None),
        )

        try:
            self.perform_create(serializer)
        except IntegrityError:
            return self._validation_response({"admission_no": ["Admission number already exists"]})

        headers = self.get_success_headers(serializer.data)
        return Response(
            {
                "success": True,
                "message": "Student added successfully",
                "warning": warning,
                "data": serializer.data,
                "credentials": getattr(self, "_enrollment_credentials", {}),
            },
            status=status.HTTP_201_CREATED,
            headers=headers,
        )

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()

        form_error_response = self._validate_with_model_form(request.data, instance=instance, partial=partial)
        if form_error_response:
            return form_error_response

        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        if not serializer.is_valid():
            return self._validation_response(serializer.errors)

        warning = getattr(serializer, "_age_class_warning", None)

        try:
            self.perform_update(serializer)
        except IntegrityError:
            return self._validation_response({"admission_no": ["Admission number already exists"]})

        return Response(
            {
                "success": True,
                "message": "Student updated successfully",
                "warning": warning,
                "data": serializer.data,
            },
            status=status.HTTP_200_OK,
        )

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    @action(detail=False, methods=["get"], url_path="summary", permission_classes=[permissions.IsAuthenticated])
    def summary(self, request):
        """KPI summary for the Student List page.

        Honours search/current_class/current_section/academic_year filters.
        Always returns totals across is_active and deleted statuses so each
        KPI card reflects an absolute number (not limited by the currently
        selected status pill).
        """
        from datetime import timedelta
        from django.utils import timezone

        user = request.user
        qs = Student.objects.all()
        if not user.school_id:
            return Response(
                {
                    "success": True,
                    "message": "Summary retrieved successfully",
                    "data": {
                        "total_count": 0,
                        "active_count": 0,
                        "inactive_count": 0,
                        "archived_count": 0,
                        "new_count": 0,
                        "docs_pending_count": 0,
                    },
                },
                status=status.HTTP_200_OK,
            )
        qs = qs.filter(school_id=user.school_id)

        search = (request.query_params.get("search") or "").strip()
        class_id = request.query_params.get("class") or request.query_params.get("current_class")
        section_id = request.query_params.get("section") or request.query_params.get("current_section")
        academic_year_id = request.query_params.get("academic_year")

        if class_id and str(class_id).isdigit():
            qs = qs.filter(current_class_id=int(class_id))
        if section_id and str(section_id).isdigit():
            qs = qs.filter(current_section_id=int(section_id))
        if academic_year_id and str(academic_year_id).isdigit():
            qs = qs.filter(academic_year_id=int(academic_year_id))
        if search and re.fullmatch(r"[A-Za-z0-9 _\-./]+", search):
            qs = qs.filter(
                Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(admission_no__icontains=search)
                | Q(roll_no__icontains=search)
            )

        total = qs.count()
        archived = qs.filter(is_deleted=True).count()
        live = qs.filter(is_deleted=False)
        active = live.filter(is_active=True, is_disabled=False).count()
        inactive = live.filter(is_active=False).count()
        docs_pending = live.filter(is_disabled=True).count()
        cutoff = timezone.now() - timedelta(days=30)
        new_count = live.filter(created_at__gte=cutoff).count()

        return Response(
            {
                "success": True,
                "message": "Summary retrieved successfully",
                "data": {
                    "total_count": total,
                    "active_count": active,
                    "inactive_count": inactive,
                    "archived_count": archived,
                    "new_count": new_count,
                    "docs_pending_count": docs_pending,
                },
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["get"], url_path="export-xlsx")
    def export_xlsx(self, request):
        """Export students as an Excel (.xlsx) file using openpyxl.

        Uses the same filter params as the list view (search, is_active,
        include_deleted, deleted_only, current_class, current_section).
        Optional ?ids=1,2,3 restricts export to those specific student IDs.
        """
        import io
        from datetime import datetime

        import openpyxl
        from openpyxl.styles import Alignment, Font, PatternFill
        from django.http import HttpResponse

        qs = self.get_queryset().select_related("current_class", "current_section", "guardian")

        # Optional specific-IDs filter
        ids_param = request.query_params.get("ids", "").strip()
        if ids_param:
            id_list = [int(x) for x in ids_param.split(",") if x.strip().isdigit()]
            if id_list:
                qs = qs.filter(id__in=id_list)

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Students"

        headers = ["Admission No", "Student", "Class", "Section", "Guardian", "Phone", "DOB", "Status"]

        # Header style
        header_fill = PatternFill(start_color="5B4FCF", end_color="5B4FCF", fill_type="solid")
        header_font = Font(color="FFFFFF", bold=True, size=11)
        header_align = Alignment(horizontal="center", vertical="center")

        for col_idx, header in enumerate(headers, start=1):
            cell = ws.cell(row=1, column=col_idx, value=header)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = header_align

        # Column widths
        col_widths = [15, 25, 12, 12, 22, 14, 12, 12]
        for col_idx, width in enumerate(col_widths, start=1):
            ws.column_dimensions[ws.cell(row=1, column=col_idx).column_letter].width = width

        row_align = Alignment(vertical="center")
        for row_idx, student in enumerate(qs.iterator(chunk_size=500), start=2):
            full_name = f"{student.first_name or ''} {student.last_name or ''}".strip() or "-"
            cls = student.current_class.name if student.current_class else "-"
            sec = student.current_section.name if student.current_section else "-"
            guardian = student.guardian.full_name if student.guardian else "-"
            phone = student.phone or "-"
            dob = student.date_of_birth.strftime("%d/%m/%Y") if student.date_of_birth else "-"
            if student.is_deleted or getattr(student, "status", None) == "deleted":
                status_label = "Archived"
            elif student.is_active:
                status_label = "Docs pending" if student.is_disabled else "Active"
            else:
                status_label = "Inactive"

            row_data = [student.admission_no or "-", full_name, cls, sec, guardian, phone, dob, status_label]
            for col_idx, value in enumerate(row_data, start=1):
                cell = ws.cell(row=row_idx, column=col_idx, value=value)
                cell.alignment = row_align

        # Freeze header row
        ws.freeze_panes = "A2"

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)

        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        filename = f"students-export-{timestamp}.xlsx"
        response = HttpResponse(
            output.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(detail=False, methods=["get"], url_path="next-admission-no")
    def next_admission_no(self, request):
        """Suggest the next admission number for the current school.

        Format: ``ADM<YYYY><NNN>`` (10 chars total, e.g. ``ADM2026001``).
        Strategy:
          * Filter existing admission_no values matching the current year's
            ``ADM<YYYY>`` prefix and find the maximum 3-digit suffix.
          * Junky/legacy values that don't match the prefix are ignored, so a
            stray ``2222222222`` row no longer poisons the next number.
          * If no matching row exists yet for this year, start at ``001``.
        """
        from datetime import date

        year = date.today().year
        prefix = f"ADM{year}"
        # Scan ALL rows for this school (including soft-deleted) — the
        # school+admission_no uniqueness constraint doesn't exempt soft-deleted
        # students, so a suggestion that ignores them can collide on save.
        qs = Student.objects.filter(
            school_id=request.user.school_id, admission_no__startswith=prefix
        ).values_list("admission_no", flat=True)
        max_num = 0
        for value in qs:
            if not value:
                continue
            text = str(value).strip()
            suffix = text[len(prefix):]
            if not suffix.isdigit():
                continue
            try:
                num = int(suffix)
            except (TypeError, ValueError):
                continue
            if num > max_num:
                max_num = num

        next_num = max_num + 1
        # Pad to at least 3 digits; widen automatically once sequence passes 999
        # so we never have to truncate (truncation corrupts the prefix).
        padding = max(3, len(str(next_num)))
        admission_no = f"{prefix}{str(next_num).zfill(padding)}"
        return Response(
            {"success": True, "admission_no": admission_no},
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["get"], url_path="check-admission-no")
    def check_admission_no(self, request):
        admission_no = str(request.query_params.get("admission_no") or "").strip()
        exclude_id = str(request.query_params.get("exclude_id") or "").strip()

        if not admission_no:
            return Response(
                {
                    "success": False,
                    "message": "Admission number is required.",
                    "field_errors": {"admission_no": "Admission number is required."},
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not re.fullmatch(r"[A-Za-z0-9]+", admission_no):
            return Response(
                {
                    "success": False,
                    "message": "Admission number should contain only letters and numbers.",
                    "field_errors": {"admission_no": "Admission number should contain only letters and numbers."},
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Match validate_admission_no's semantics exactly (school-scoped, ALL
        # rows including soft-deleted) — the DB constraint (school, admission_no)
        # doesn't exempt soft-deleted students, so this check must not either,
        # or "available" here can still be rejected on submit.
        queryset = Student.objects.filter(
            school_id=request.user.school_id, admission_no__iexact=admission_no
        )
        if exclude_id.isdigit():
            queryset = queryset.exclude(id=int(exclude_id))

        exists = queryset.exists()
        conflict_student = None
        if exists:
            student = queryset.select_related("current_class", "current_section").first()
            if student:
                class_name = str(student.current_class) if student.current_class else "—"
                section_name = str(student.current_section) if student.current_section else "—"
                conflict_student = {
                    "id": student.id,
                    "name": f"{student.first_name} {student.last_name}".strip(),
                    "class_name": class_name,
                    "section_name": section_name,
                    "is_draft": getattr(student, "is_draft", False),
                }
        return Response(
            {
                "success": True,
                "exists": exists,
                "conflict_student": conflict_student,
                "message": "Admission number already exists." if exists else "Admission number is available.",
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["get"], url_path="pincode-details")
    def pincode_details(self, request):
        serializer = PincodeLookupQuerySerializer(data=request.query_params)
        if not serializer.is_valid():
            field_errors = {}
            for field, errors in serializer.errors.items():
                field_errors[field] = [str(error) for error in (errors or [])] if isinstance(errors, (list, tuple)) else [str(errors)]
            message = field_errors.get("pincode", ["Pincode must be exactly 6 digits."])[0]
            return Response(
                {
                    "success": False,
                    "message": message,
                    "field_errors": field_errors,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        pincode = serializer.validated_data["pincode"]

        try:
            data = self._fetch_pincode_details(pincode)
        except ValidationError as exc:
            message = "Invalid PIN Code"
            detail = exc.detail
            if isinstance(detail, dict):
                pincode_message = detail.get("pincode")
                if isinstance(pincode_message, list) and pincode_message:
                    message = str(pincode_message[0])
                elif isinstance(pincode_message, str):
                    message = pincode_message
            return Response(
                {
                    "success": False,
                    "message": message,
                    "field_errors": {"pincode": message},
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        except requests.RequestException:
            return Response(
                {
                    "success": False,
                    "message": "Unable to fetch pincode details right now.",
                    "field_errors": {"pincode": "Unable to fetch pincode details right now."},
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response(
            {
                "success": True,
                "message": "Pincode details fetched successfully.",
                "data": data,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["get"], url_path="next-roll-no")
    def next_roll_no(self, request):
        """Return the next available roll number for a class+section+academic_year combo."""
        import re as _re

        class_id = str(request.query_params.get("class_id") or "").strip()
        section_id = str(request.query_params.get("section_id") or "").strip()
        academic_year_id = str(request.query_params.get("academic_year_id") or "").strip()

        if not class_id.isdigit() or not section_id.isdigit() or not academic_year_id.isdigit():
            return Response(
                {"success": False, "message": "class_id, section_id, and academic_year_id are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        qs = self.get_queryset().filter(
            current_class_id=int(class_id),
            current_section_id=int(section_id),
            academic_year_id=int(academic_year_id),
            is_deleted=False,
        )
        roll_nos = []
        for s in qs.values_list("roll_no", flat=True):
            m = _re.fullmatch(r"\d+", str(s or "").strip())
            if m:
                roll_nos.append(int(m.group()))
        next_no = (max(roll_nos) + 1) if roll_nos else 1
        return Response({"success": True, "roll_no": str(next_no).zfill(3)})

    @action(detail=False, methods=["get"], url_path="sections-summary")
    def sections_summary(self, request):
        """Return section capacity and enrollment count for a class+academic_year."""
        from apps.core.models import Section

        class_id = str(request.query_params.get("class_id") or "").strip()
        academic_year_id = str(request.query_params.get("academic_year_id") or "").strip()

        if not class_id.isdigit() or not academic_year_id.isdigit():
            return Response(
                {"success": False, "message": "class_id and academic_year_id are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = request.user
        sections_qs = Section.objects.filter(school_class_id=int(class_id))
        if getattr(user, "school_id", None):
            sections_qs = sections_qs.filter(school_class__school_id=user.school_id)

        result = []
        for sec in sections_qs.order_by("name"):
            count = self.get_queryset().filter(
                current_class_id=int(class_id),
                current_section_id=sec.id,
                academic_year_id=int(academic_year_id),
                is_deleted=False,
            ).count()
            result.append({
                "section_id": sec.id,
                "name": sec.name,
                "count": count,
                "capacity": getattr(sec, "capacity", None) or 35,
            })
        return Response({"success": True, "sections": result})

    @action(detail=False, methods=["post"], url_path="upload-photo", parser_classes=[MultiPartParser, FormParser])
    def upload_photo(self, request):
        school_id = request.user.school_id
        if not school_id:
            raise ValidationError("User school context is required.")

        image = request.FILES.get("photo")
        if not image:
            return Response(
                {
                    "success": False,
                    "message": "Photo file is required.",
                    "field_errors": {"photo": "Photo file is required."},
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        allowed_types = {"image/jpeg", "image/png"}
        if image.content_type not in allowed_types:
            return Response(
                {
                    "success": False,
                    "message": "Only JPEG and PNG files are allowed.",
                    "field_errors": {"photo": "Only JPEG and PNG files are allowed."},
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        max_size_bytes = 2 * 1024 * 1024
        if image.size > max_size_bytes:
            return Response(
                {
                    "success": False,
                    "message": "Photo size must be 2MB or less.",
                    "field_errors": {"photo": "Photo size must be 2MB or less."},
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        ext = os.path.splitext(image.name or "")[1].lower()
        if ext not in {".jpg", ".jpeg", ".png"}:
            ext = ".jpg" if image.content_type == "image/jpeg" else ".png"

        relative_path = f"student_photos/{school_id}/{uuid4().hex}{ext}"
        saved_path = default_storage.save(relative_path, image)
        normalized = str(saved_path).replace("\\", "/")
        media_prefix = settings.MEDIA_URL if settings.MEDIA_URL.endswith("/") else f"{settings.MEDIA_URL}/"
        photo_url = request.build_absolute_uri(f"{media_prefix}{normalized}")

        return Response(
            {
                "success": True,
                "message": "Photo uploaded successfully.",
                "data": {"photo": photo_url},
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["post"], url_path="promote")
    def promote(self, request):
        serializer = StudentPromoteRequestSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        school_id = request.user.school_id
        if not school_id:
            raise ValidationError("User school context is required.")

        target_class_id = data["to_class"]
        target_section_id = data.get("to_section")
        target_year_id = data.get("to_academic_year")

        from apps.core.models import AcademicYear, Class, Section

        # Validate target class/section/year belongs to same school for tenant safety
        class_qs = Class.objects.filter(id=target_class_id, school_id=school_id)
        target_class = class_qs.first()
        if not target_class:
            raise ValidationError("Target class not found in your school.")

        if target_section_id:
            section_qs = Section.objects.filter(id=target_section_id, school_class_id=target_class_id)
            if not section_qs.exists():
                raise ValidationError("Target section not found under target class.")

        if target_year_id:
            year_qs = AcademicYear.objects.filter(id=target_year_id, school_id=school_id)
            if not year_qs.exists():
                raise ValidationError("Target academic year not found in your school.")

        students_qs = Student.objects.filter(id__in=data["student_ids"], school_id=school_id)
        students = list(students_qs)

        if not students:
            raise ValidationError("No students found for promotion.")

        # Track promoted count and errors for partial success
        promoted_count = 0
        failed_count = 0
        errors_list = []

        # Process each student individually to support partial success
        for st in students:
            try:
                # Validate: prevent promoting to same class
                if st.current_class_id == target_class_id:
                    failed_count += 1
                    errors_list.append({
                        "student_id": st.id,
                        "admission_no": st.admission_no,
                        "error": f"Cannot promote to the same class ({target_class.name})"
                    })
                    continue

                # Create promotion history
                StudentPromotionHistory.objects.create(
                    student=st,
                    from_class=st.current_class,
                    from_section=st.current_section,
                    to_class_id=target_class_id,
                    to_section_id=target_section_id,
                    to_academic_year_id=target_year_id,
                    note=data.get("note", ""),
                    promoted_by=request.user,
                )

                # Update student's current class and section
                st.current_class_id = target_class_id
                st.current_section_id = target_section_id
                st.save(update_fields=["current_class", "current_section", "updated_at"])
                promoted_count += 1

            except Exception as e:
                failed_count += 1
                errors_list.append({
                    "student_id": st.id,
                    "admission_no": st.admission_no,
                    "error": str(e)
                })
                continue

        # Return comprehensive response
        response_data = {
            "promoted": promoted_count,
            "failed": failed_count,
            "total": promoted_count + failed_count,
            "success": failed_count == 0
        }

        if errors_list:
            # Limit errors to first 50 for response
            response_data["errors"] = errors_list[:50]

        # Determine status code based on promotion success
        if promoted_count == 0:
            # Complete failure
            return Response(response_data, status=status.HTTP_400_BAD_REQUEST)
        elif failed_count > 0:
            # Partial success
            return Response(response_data, status=status.HTTP_200_OK)
        else:
            # Complete success
            return Response(response_data, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"], url_path="auto-assign-classes")
    def auto_assign_classes(self, request):
        """
        Auto-assign current_class and current_section to students who are missing either.
        Uses date_of_birth to pick the appropriate grade where available, otherwise
        distributes round-robin across classes.
        Pass ?dry_run=true to preview without saving.
        """
        from datetime import date as date_type
        import re as _re
        from django.db import models as db_models
        from apps.core.models import Class, Section

        school_id = request.user.school_id
        if not school_id:
            return Response({"error": "School context required."}, status=status.HTTP_403_FORBIDDEN)

        dry_run = str(request.data.get("dry_run", "false")).lower() in ("1", "true", "yes")
        ref_year = int(request.data.get("year", date_type.today().year))

        unassigned_qs = Student.objects.filter(
            is_deleted=False,
            **self.school_filter(request),
        ).filter(
            db_models.Q(current_class__isnull=True) | db_models.Q(current_section__isnull=True)
        )
        students = list(unassigned_qs.select_related("current_class").order_by("id"))

        if not students:
            return Response({"assigned": 0, "message": "All students already have class and section assigned."})

        # Load classes with their first section, ordered correctly
        cls_qs = (
            Class.objects.filter(**self.school_filter(request))
            .prefetch_related("sections")
            .order_by("numeric_order", "name")
        )
        school_classes = []
        for c in cls_qs:
            secs = list(c.sections.order_by("name"))
            if secs:
                m = _re.search(r"\d+", c.name)
                school_classes.append({
                    "cls": c,
                    "sections": secs,
                    "grade": int(m.group()) if m else 0,
                })

        if not school_classes:
            return Response({"error": "No classes with sections found."}, status=status.HTTP_400_BAD_REQUEST)

        def grade_from_dob(dob):
            age = ref_year - dob.year - (1 if (dob.month, dob.day) > (4, 1) else 0)
            return max(0, min(age - 4, 12))

        results = []
        to_update = []

        for idx, student in enumerate(students):
            chosen = None

            if student.date_of_birth and not student.current_class_id:
                grade = grade_from_dob(student.date_of_birth)
                if grade <= 0:
                    for entry in school_classes:
                        if entry["cls"].name.upper() in ("LKG", "UKG", "NURSERY"):
                            chosen = entry
                            break
                if not chosen:
                    best, best_diff = None, 9999
                    for entry in school_classes:
                        diff = abs(entry["grade"] - grade)
                        if diff < best_diff:
                            best_diff = diff
                            best = entry
                    chosen = best

            if not chosen:
                chosen = school_classes[idx % len(school_classes)]

            # Determine section: if student already has a class, use a section from it
            if student.current_class_id:
                existing_secs = list(Section.objects.filter(school_class_id=student.current_class_id).order_by("name"))
                target_section = existing_secs[0] if existing_secs else chosen["sections"][0]
                target_class = student.current_class
            else:
                target_class = chosen["cls"]
                target_section = chosen["sections"][0]

            results.append({
                "student_id": student.id,
                "admission_no": student.admission_no,
                "name": f"{student.first_name} {student.last_name}".strip(),
                "assigned_class": target_class.name,
                "assigned_section": target_section.name,
            })

            if not dry_run:
                update_fields = {}
                if not student.current_class_id:
                    update_fields["current_class_id"] = target_class.id
                if not student.current_section_id:
                    update_fields["current_section_id"] = target_section.id
                if update_fields:
                    to_update.append((student.pk, update_fields))

        if not dry_run:
            with transaction.atomic():
                for pk, fields in to_update:
                    Student.objects.filter(pk=pk).update(**fields)

        return Response({
            "assigned": len(results),
            "dry_run": dry_run,
            "students": results[:100],  # cap response at 100 rows
        })

    def destroy(self, request, *args, **kwargs):
        return self.soft_delete(request, *args, **kwargs)

    def _linked_record_exists(self, student):
        from apps.attendance.models import StudentAttendance, SubjectAttendance
        from apps.exams.models import ExamAttendanceChild, ExamMark, ExamMarkRegister, OnlineExamTake
        from apps.fees.models import FeesAssignment, FeesPayment

        return (
            StudentAttendance.objects.filter(student=student).exists()
            or SubjectAttendance.objects.filter(student=student).exists()
            or ExamMark.objects.filter(student=student).exists()
            or ExamAttendanceChild.objects.filter(student=student).exists()
            or ExamMarkRegister.objects.filter(student=student).exists()
            or OnlineExamTake.objects.filter(student=student).exists()
            or FeesAssignment.objects.filter(student=student).exists()
            or FeesPayment.objects.filter(student=student).exists()
        )

    def _audit_log(self, *, action, student, request, note="", metadata=None):
        try:
            school = getattr(student, "school", None)
            if not school:
                return
            StudentRecordAudit.objects.create(
                school=school,
                student=student,
                action=action,
                performed_by=request.user,
                note=note,
                metadata=metadata or {},
            )
        except Exception:
            # Audit failures should not block primary record operations.
            logger.exception("Unable to write student audit log")

    def _get_student_for_record_action(self, request, pk):
        qs = Student.objects.select_related("school")
        qs = qs.filter(school_id=request.user.school_id)
        return qs.filter(pk=pk).first()

    @action(detail=True, methods=["post"], url_path="soft-delete")
    def soft_delete(self, request, *args, **kwargs):
        student = self._get_student_for_record_action(request, kwargs.get("pk"))
        if not student:
            return Response(
                {"success": False, "message": "Student record not found", "field_errors": {}},
                status=status.HTTP_404_NOT_FOUND,
            )
        if student.is_deleted:
            return Response(
                {"success": False, "message": "Student record already deleted", "field_errors": {}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if self._linked_record_exists(student):
            return Response(
                {"success": False, "message": "Cannot delete student. Linked records exist", "field_errors": {}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reason = (request.data.get("reason") or "").strip()
        if not reason:
            reason = "(no reason provided)"

        student.is_deleted = True
        student.is_active = False
        student.is_disabled = True
        student.status = "deleted"
        student.deleted_at = timezone.now()
        student.deleted_by = request.user
        student.save(update_fields=["is_deleted", "is_active", "is_disabled", "status", "deleted_at", "deleted_by", "updated_at"])

        self._audit_log(
            action=StudentRecordAudit.ACTION_SOFT_DELETE,
            student=student,
            request=request,
            note=f"Student archived · reason: {reason}",
            metadata={"student_id": student.id, "admission_no": student.admission_no, "reason": reason},
        )

        return Response({"success": True, "message": "Student deleted successfully"}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="set-status")
    def set_status(self, request, *args, **kwargs):
        student = self._get_student_for_record_action(request, kwargs.get("pk"))
        if not student:
            return Response(
                {"success": False, "message": "Student record not found", "field_errors": {}},
                status=status.HTTP_404_NOT_FOUND,
            )
        if student.is_deleted:
            return Response(
                {"success": False, "message": "Cannot change status of an archived student. Restore first.", "field_errors": {}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        raw_active = request.data.get("is_active")
        if isinstance(raw_active, str):
            next_active = raw_active.strip().lower() in {"1", "true", "yes", "active"}
        else:
            next_active = bool(raw_active)
        reason = (request.data.get("reason") or "").strip()
        if not next_active and not reason:
            return Response(
                {"success": False, "message": "A reason is required to deactivate a student.", "field_errors": {"reason": "Reason is required."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        student.is_active = next_active
        student.is_disabled = False
        student.status = "active" if next_active else "inactive"
        student.save(update_fields=["is_active", "is_disabled", "status", "updated_at"])
        self._audit_log(
            action=StudentRecordAudit.ACTION_UPDATE,
            student=student,
            request=request,
            note=("Student activated" if next_active else f"Student deactivated · reason: {reason}"),
            metadata={"student_id": student.id, "is_active": next_active, "reason": reason},
        )
        return Response({"success": True, "message": "Student activated" if next_active else "Student deactivated"})

    @action(detail=True, methods=["post"], url_path="restore")
    def restore(self, request, *args, **kwargs):
        student = self._get_student_for_record_action(request, kwargs.get("pk"))
        if not student:
            return Response(
                {"success": False, "message": "Student record not found", "field_errors": {}},
                status=status.HTTP_404_NOT_FOUND,
            )
        if not student.is_deleted:
            return Response(
                {"success": False, "message": "Student is not deleted", "field_errors": {}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with transaction.atomic():
                student.is_deleted = False
                student.is_disabled = False
                student.is_active = True
                student.status = "active"
                student.deleted_at = None
                student.deleted_by = None
                student.save(update_fields=["is_deleted", "is_disabled", "is_active", "status", "deleted_at", "deleted_by", "updated_at"])

                self._audit_log(
                    action=StudentRecordAudit.ACTION_RESTORE,
                    student=student,
                    request=request,
                    note="Student restored",
                    metadata={"student_id": student.id, "admission_no": student.admission_no},
                )
        except IntegrityError:
            return Response(
                {"success": False, "message": "Unable to restore student due to data dependency.", "field_errors": {}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception:
            logger.exception("Restore student failed")
            return Response(
                {"success": False, "message": "Unable to restore student at this time.", "field_errors": {}},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response({"success": True, "message": "Student restored successfully"}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["delete"], url_path="permanent-delete")
    def permanent_delete(self, request, *args, **kwargs):
        if not request.user.is_superuser:
            return Response(
                {"success": False, "message": "You do not have permission to delete student records", "field_errors": {}},
                status=status.HTTP_403_FORBIDDEN,
            )

        student = self._get_student_for_record_action(request, kwargs.get("pk"))
        if not student:
            return Response(
                {"success": False, "message": "Student record not found", "field_errors": {}},
                status=status.HTTP_404_NOT_FOUND,
            )
        if self._linked_record_exists(student):
            return Response(
                {
                    "success": False,
                    "message": "Unable to permanently delete student due to linked records",
                    "field_errors": {},
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with transaction.atomic():
                self._audit_log(
                    action=StudentRecordAudit.ACTION_PERMANENT_DELETE,
                    student=student,
                    request=request,
                    note="Student permanently deleted",
                    metadata={"student_id": student.id, "admission_no": student.admission_no},
                )
                student.delete()
        except ProtectedError:
            return Response(
                {
                    "success": False,
                    "message": "Unable to permanently delete student due to linked records",
                    "field_errors": {},
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        except IntegrityError:
            return Response(
                {
                    "success": False,
                    "message": "Unable to permanently delete student due to data dependency.",
                    "field_errors": {},
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception:
            return Response(
                {
                    "success": False,
                    "message": "Unable to permanently delete student at this time.",
                    "field_errors": {},
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response({"success": True, "message": "Student permanently deleted successfully"}, status=status.HTTP_200_OK)

    _OPTIONAL_CATEGORY_TYPES = (
        "first_language", "second_language", "third_language", "sport", "club", "co_curricular", "optional",
    )

    @classmethod
    def _configured_category_counts_by_class(cls, school_id):
        """{class_id: number of distinct non-empty optional categories configured}."""
        from apps.academics.models import ClassSubjectEntry

        rows = (
            ClassSubjectEntry.objects.filter(
                school_id=school_id,
                subject_type__in=cls._OPTIONAL_CATEGORY_TYPES,
                active_status=True,
            )
            .values("school_class_id", "subject_type")
            .distinct()
        )
        counts: dict = {}
        for row in rows:
            counts[row["school_class_id"]] = counts.get(row["school_class_id"], 0) + 1
        return counts

    @action(detail=False, methods=["get"], url_path="subject-assignment-stats")
    def subject_assignment_stats(self, request):
        """Return KPI counts for the Multi Subject Assignment page."""
        user = request.user
        base_qs = Student.objects.filter(is_deleted=False, school_id=user.school_id).select_related(
            "current_class"
        ).prefetch_related("subject_assignments")

        enrolled = base_qs.count()
        category_counts = self._configured_category_counts_by_class(user.school_id)

        assigned = partial = pending = 0
        for st in base_qs:
            required = category_counts.get(st.current_class_id, 0)
            filled = {
                a.category for a in st.subject_assignments.all() if a.is_optional and a.category
            }
            if required == 0 or len(filled) >= required:
                assigned += 1
            elif filled:
                partial += 1
            else:
                pending += 1

        return Response(
            {
                "enrolled": enrolled,
                "assigned": assigned,
                "partial": partial,
                "pending": pending,
            },
            status=status.HTTP_200_OK,
        )

    @staticmethod
    def _serialize_assignment_student(st, required_categories=None):
        optional_assignments = [a for a in st.subject_assignments.all() if a.is_optional]
        by_category: dict = {}
        for a in optional_assignments:
            if not a.category:
                continue
            by_category.setdefault(a.category, []).append(a.subject.name)
        opt_subs = [a.subject.name for a in optional_assignments]

        required = required_categories if required_categories is not None else len(by_category)
        filled = len(by_category)
        if required == 0 or filled >= required:
            sstatus = "done"
        elif filled > 0:
            sstatus = "partial"
        else:
            sstatus = "empty"

        return {
            "id": st.id,
            "name": f"{st.first_name} {st.last_name}".strip(),
            "admNo": st.admission_no,
            "rollNo": st.roll_no or "",
            "optionalByCategory": by_category,
            "optionalSubjects": opt_subs,
            "status": sstatus,
        }

    @action(detail=False, methods=["get"], url_path="subject-categories")
    def subject_categories(self, request):
        """Return subjects configured in Academics ▸ Foundation ▸ Subjects for a class,
        grouped by category, for the Multi Subject Assignment page to render dynamically."""
        from apps.academics.models import ClassSubjectEntry

        user = request.user
        class_id = request.query_params.get("class_id")
        if not class_id:
            return Response({"detail": "class_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        qs = ClassSubjectEntry.objects.filter(
            school_class_id=class_id, active_status=True
        ).order_by("name")
        if user.school_id:
            qs = qs.filter(school_id=user.school_id)

        grouped: dict = {"mandatory": []}
        for key in StudentViewSet._OPTIONAL_CATEGORY_TYPES:
            grouped[key] = []

        for entry in qs:
            key = "mandatory" if entry.subject_type == ClassSubjectEntry.TYPE_CORE else entry.subject_type
            if key in grouped:
                grouped[key].append(entry.name)

        return Response(grouped, status=status.HTTP_200_OK)

    _TICKER_CATEGORY_TYPES = ("sport", "club", "co_curricular", "optional")

    @action(detail=False, methods=["get"], url_path="subject-categories-summary")
    def subject_categories_summary(self, request):
        """School-wide activity ticker data: every sport/club/co_curricular/optional
        subject configured anywhere in Academics ▸ Foundation ▸ Subjects, each with
        its real assigned-student count (0 if none yet). Unlike deriving this from
        the paginated class/section tree, this always reflects the full catalog and
        true counts regardless of how many students have been loaded client-side."""
        from apps.academics.models import ClassSubjectEntry

        user = request.user
        school_id = user.school_id

        catalog_qs = ClassSubjectEntry.objects.filter(
            school_id=school_id, active_status=True,
            subject_type__in=self._TICKER_CATEGORY_TYPES,
        ).values("subject_type", "name").distinct()

        names_by_type: dict = {}
        for row in catalog_qs:
            names_by_type.setdefault(row["subject_type"], set()).add(row["name"])

        counts = (
            StudentSubjectAssignment.objects.filter(
                student__school_id=school_id,
                is_optional=True,
                category__in=self._TICKER_CATEGORY_TYPES,
            )
            .values("category", "subject__name")
            .annotate(n=Count("student_id", distinct=True))
        )
        count_map = {(row["category"], row["subject__name"]): row["n"] for row in counts}

        result = {}
        for cat in self._TICKER_CATEGORY_TYPES:
            names = sorted(names_by_type.get(cat, []))
            result[cat] = [{"name": n, "count": count_map.get((cat, n), 0)} for n in names]

        return Response(result, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="class-section-tree")
    def class_section_tree(self, request):
        """Return classes → sections → students tree with subject assignment data.

        Per-section students are paginated. The first page (default 10 students)
        is returned inline along with `student_total` so the frontend can render
        page controls and lazily fetch additional pages via `section-students`.
        """
        from apps.core.models import Class

        user = request.user
        school_id = user.school_id

        # Pagination params (per-section)
        try:
            page_size = int(request.query_params.get("page_size", 10) or 10)
        except (TypeError, ValueError):
            page_size = 10
        page_size = max(1, min(page_size, 200))

        # Fetch all classes for this school
        cls_qs = Class.objects.all()
        if school_id:
            cls_qs = cls_qs.filter(school_id=school_id)
        cls_qs = cls_qs.prefetch_related("sections")
        category_counts = self._configured_category_counts_by_class(school_id)

        # Fetch all students with their optional subject assignments. We still
        # load all students up-front because we need accurate per-section
        # totals; only the first page is serialised for each section.
        student_qs = Student.objects.filter(
            is_deleted=False,
            current_class__isnull=False,
        ).select_related("current_class", "current_section").prefetch_related(
            "subject_assignments__subject"
        ).order_by("roll_no", "first_name", "last_name")
        if school_id:
            student_qs = student_qs.filter(school_id=school_id)

        # Build a lookup: {(class_id, section_id): [student, ...]}
        from collections import defaultdict
        section_map = defaultdict(list)
        for st in student_qs:
            key = (st.current_class_id, st.current_section_id)
            section_map[key].append(st)

        result = []
        for cls in cls_qs:
            sections_out = []
            for sec in cls.sections.all():
                students_here = section_map.get((cls.id, sec.id), [])
                total = len(students_here)
                first_page = students_here[:page_size]
                required = category_counts.get(cls.id, 0)
                students_out = [
                    self._serialize_assignment_student(st, required) for st in first_page
                ]
                sections_out.append({
                    "id": sec.id,
                    "letter": sec.name,
                    "teacher": "",
                    "students": students_out,
                    "student_total": total,
                    "student_page": 1,
                    "student_page_size": page_size,
                    "student_total_pages": max(1, (total + page_size - 1) // page_size),
                })
            result.append({
                "id": cls.id,
                "label": cls.name,
                "sections": sections_out,
            })

        return Response(result, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="section-students")
    def section_students(self, request):
        """Return a paginated slice of students for a single class/section.

        Query params: class_id (required), section_id (required),
        page (default 1), page_size (default 10, max 200).
        """
        user = request.user
        school_id = user.school_id

        try:
            class_id = int(request.query_params.get("class_id") or 0)
            section_id = int(request.query_params.get("section_id") or 0)
        except (TypeError, ValueError):
            return Response(
                {"detail": "class_id and section_id must be integers."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not class_id or not section_id:
            return Response(
                {"detail": "class_id and section_id are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            page = int(request.query_params.get("page", 1) or 1)
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = int(request.query_params.get("page_size", 10) or 10)
        except (TypeError, ValueError):
            page_size = 10
        page = max(1, page)
        page_size = max(1, min(page_size, 200))

        qs = Student.objects.filter(
            is_deleted=False,
            current_class_id=class_id,
            current_section_id=section_id,
        ).select_related("current_class", "current_section").prefetch_related(
            "subject_assignments__subject"
        ).order_by("roll_no", "first_name", "last_name")
        if school_id:
            qs = qs.filter(school_id=school_id)

        total = qs.count()
        total_pages = max(1, (total + page_size - 1) // page_size)
        page = min(page, total_pages)
        offset = (page - 1) * page_size
        required = self._configured_category_counts_by_class(school_id).get(class_id, 0)
        students_out = [
            self._serialize_assignment_student(st, required)
            for st in qs[offset:offset + page_size]
        ]

        return Response({
            "count": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "students": students_out,
        }, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"], url_path="bulk-import")
    def bulk_import(self, request):
        upload = request.FILES.get("file")
        if not upload:
            return self._validation_response({"file": ["Please upload a file"]})

        filename = (upload.name or "").lower()
        if not filename.endswith((".csv", ".xlsx")):
            return self._validation_response({"file": ["Only CSV or XLSX files are supported"]})

        rows = []
        if filename.endswith(".csv"):
            decoded = upload.read().decode("utf-8", errors="ignore")
            reader = csv.DictReader(io.StringIO(decoded))
            rows = list(reader)
        else:
            try:
                from openpyxl import load_workbook
            except Exception:
                return self._validation_response({"file": ["XLSX import requires openpyxl installation"]})
            workbook = load_workbook(upload, read_only=True)
            worksheet = workbook.active
            header = [str(cell.value or "").strip() for cell in next(worksheet.iter_rows(min_row=1, max_row=1))]
            for data_row in worksheet.iter_rows(min_row=2, values_only=True):
                rows.append({header[index]: value for index, value in enumerate(data_row)})

        created = 0
        errors = []
        for index, row in enumerate(rows, start=2):
            normalized_row = self._normalize_import_row(row)
            if not any(str(value or "").strip() for value in normalized_row.values()):
                continue

            serializer = self.get_serializer(data=normalized_row)
            if serializer.is_valid():
                try:
                    self.perform_create(serializer)
                    created += 1
                except IntegrityError:
                    errors.append({"row": index, "field_errors": {"admission_no": "Admission number already exists"}})
            else:
                errors.append({"row": index, "field_errors": self._normalize_field_errors(serializer.errors)})

        return Response(
            {
                "success": len(errors) == 0,
                "message": "Bulk import completed",
                "created": created,
                "failed": len(errors),
                "errors": errors,
            },
            status=status.HTTP_200_OK,
        )

class StudentDocumentViewSet(TenantScopedModelViewSet):
    serializer_class = StudentDocumentSerializer
    model = StudentDocument
    permission_codes = {"*": "student_info.student_list.view"}

    def get_queryset(self):
        user = self.request.user
        qs = StudentDocument.objects.select_related("student__school")
        if user.school_id:
            return qs.filter(student__school_id=user.school_id)
        return qs.none()

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def upload_document(self, request):
        """
        Upload a student document.
        
        Expects:
        - student_id (required): Student ID (database ID or UUID)
        - document_type (required): Document type (birth_certificate, aadhaar_card, medical_information)
        - file (required): File to upload
        """
        try:
            student_id_input = request.data.get("student_id")
            document_type = request.data.get("document_type")
            file_obj = request.FILES.get("file")
            
            logger.info(f"Document upload attempt: student_id={student_id_input}, document_type={document_type}, file={file_obj.name if file_obj else None}")
            
            # Validations
            if not student_id_input:
                return Response(
                    {"error": "Student ID is required."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            if not document_type:
                return Response(
                    {"error": "Document type is required."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            if not file_obj:
                return Response(
                    {"error": "No file selected."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Check student exists and user has access.
            # The frontend may send either the numeric DB id or the UUID student_id.
            # We detect which one it is up front — querying a UUIDField with a
            # non-UUID string raises django.core.exceptions.ValidationError, not
            # Student.DoesNotExist, so we must validate the format ourselves.
            import uuid as _uuid
            student = None
            sid_str = str(student_id_input).strip()

            if sid_str.isdigit():
                try:
                    student = Student.objects.get(id=int(sid_str))
                except Student.DoesNotExist:
                    student = None

            if student is None:
                try:
                    _uuid.UUID(sid_str)
                except ValueError:
                    pass
                else:
                    try:
                        student = Student.objects.get(student_id=sid_str)
                    except Student.DoesNotExist:
                        student = None

            if student is None:
                logger.warning(f"Student not found with ID: {student_id_input}")
                return Response(
                    {"error": "Student not found."},
                    status=status.HTTP_404_NOT_FOUND
                )
            
            # Check permission
            if student.school_id != request.user.school_id:
                logger.warning(f"Permission denied: user school {request.user.school_id} != student school {student.school_id}")
                raise PermissionDenied("You don't have permission to upload documents for this student.")
            
            # Validate file type
            allowed_extensions = [".pdf", ".jpg", ".jpeg", ".png"]
            file_name_lower = file_obj.name.lower()
            if not any(file_name_lower.endswith(ext) for ext in allowed_extensions):
                return Response(
                    {"error": "Only PDF, JPG, JPEG, and PNG files are allowed."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Validate file size (5MB)
            if file_obj.size > 5242880:
                return Response(
                    {"error": "File size must be less than 5MB."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Create document record
            document = StudentDocument.objects.create(
                student=student,
                school=student.school,
                document_type=document_type,
                title=document_type.replace("_", " ").title(),
                file=file_obj,
                original_name=file_obj.name,
                file_size=file_obj.size,
                uploaded_by=request.user,
            )
            
            # Serialize and return
            serializer = self.get_serializer(document)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        
        except Exception as e:
            logger.error(f"Document upload error: {str(e)}", exc_info=True)
            return Response(
                {"error": "An error occurred during file upload. Please try again."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

class StudentTransferHistoryViewSet(TenantScopedModelViewSet):
    serializer_class = StudentTransferHistorySerializer
    model = StudentTransferHistory
    permission_codes = {"*": "student_info.delete_student_record.view"}

    def get_queryset(self):
        user = self.request.user
        qs = StudentTransferHistory.objects.select_related("student__school", "from_school", "to_school")
        if user.school_id:
            return qs.filter(student__school_id=user.school_id)
        return qs.none()

class PromotionBatchViewSet(TenantScopedModelViewSet):
    serializer_class = PromotionBatchSerializer
    model = PromotionBatch
    permission_codes = {"*": "student_info.student_promote.view"}

    def get_queryset(self):
        from django.db.models import Prefetch

        user = self.request.user
        # CHANGED (perf): use a Prefetch so records are loaded with select_related
        # for student/from_class/to_class — avoids N+1 during nested serialization.
        records_qs = (
            PromotionRecord.objects.select_related(
                "student",
                "from_class",
                "from_section",
                "to_class",
                "to_section",
            )
            .prefetch_related("failed_subjects")
            .order_by("id")
        )
        qs = PromotionBatch.objects.select_related(
            "school", "academic_year", "target_year", "created_by", "confirmed_by",
        ).prefetch_related(Prefetch("records", queryset=records_qs))
        if user.school_id:
            return qs.filter(school_id=user.school_id)
        return qs.none()

    def _recompute_counts(self, batch: PromotionBatch):
        # CHANGED (perf): single aggregate query instead of three count() round-trips.
        from django.db.models import Count, Q
        agg = batch.records.aggregate(
            total=Count("id"),
            promoted=Count("id", filter=Q(status=PromotionRecord.STATUS_PROMOTE)),
            retained=Count("id", filter=Q(status=PromotionRecord.STATUS_NOT_PROMOTED)),
        )
        batch.total_students = agg["total"] or 0
        batch.promoted_count = agg["promoted"] or 0
        batch.retained_count = agg["retained"] or 0
        batch.save(update_fields=["total_students", "promoted_count", "retained_count"])

    def _get_client_ip(self, request):
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "")

    def _initialize_records(self, batch: PromotionBatch):
        from apps.core.models import Class

        if batch.records.exists():
            self._recompute_counts(batch)
            return

        classes = list(Class.objects.filter(school_id=batch.school_id).order_by("numeric_order", "id"))
        next_map = {}
        for idx, row in enumerate(classes):
            next_map[row.id] = classes[idx + 1].id if idx + 1 < len(classes) else None

        students = Student.objects.filter(
            school_id=batch.school_id,
            academic_year_id=batch.academic_year_id,
            is_active=True,
            is_deleted=False,
        ).select_related("current_class", "current_section")

        to_create = []
        for student in students:
            to_create.append(
                PromotionRecord(
                    batch=batch,
                    student=student,
                    from_class=student.current_class,
                    from_section=student.current_section,
                    to_class_id=next_map.get(student.current_class_id),
                    status=PromotionRecord.STATUS_PENDING,
                )
            )

        PromotionRecord.objects.bulk_create(to_create, ignore_conflicts=True)
        if to_create:
            batch.status = PromotionBatch.STATUS_IN_PROGRESS
            batch.save(update_fields=["status"])
        self._recompute_counts(batch)

    @action(detail=False, methods=["post"], url_path="create-or-get")
    def create_or_get(self, request):
        serializer = PromotionBatchCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        school = request.user.school
        year = data["academic_year_obj"]
        target = data["target_year_obj"]

        batch, created = PromotionBatch.objects.get_or_create(
            school=school,
            academic_year=year,
            defaults={
                "target_year": target,
                "created_by": request.user,
                "status": PromotionBatch.STATUS_DRAFT,
            },
        )

        if not created and batch.status == PromotionBatch.STATUS_DRAFT and batch.target_year_id != target.id:
            batch.target_year = target
            batch.save(update_fields=["target_year"])

        self._initialize_records(batch)
        # CHANGED (perf): re-fetch through prefetched queryset so nested record
        # serialization doesn't trigger N+1 queries on student/class/section.
        batch = self.get_queryset().get(pk=batch.pk)
        return Response(self.get_serializer(batch).data)

    @action(detail=False, methods=["get"], url_path=r"by-year/(?P<year_name>[^/.]+)")
    def by_year(self, request, year_name=None):
        from apps.core.models import AcademicYear

        school_id = request.user.school_id
        year_qs = AcademicYear.objects.filter(name=year_name, school_id=school_id)
        year = year_qs.first()
        if not year:
            return Response({"error": "Academic year not found"}, status=status.HTTP_404_NOT_FOUND)

        batch_qs = self.get_queryset().filter(academic_year=year)
        batch = batch_qs.first()
        if not batch:
            return Response({"error": "No promotion batch for this year"}, status=status.HTTP_404_NOT_FOUND)

        return Response(self.get_serializer(batch).data)

    @action(detail=True, methods=["post"], url_path="update-record")
    def update_record(self, request, pk=None):
        from apps.core.models import Class, Section, Subject

        batch = self.get_object()
        serializer = PromotionRecordUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            record = batch.records.get(id=data["record_id"])
        except PromotionRecord.DoesNotExist:
            return Response({"error": "Record not found"}, status=status.HTTP_404_NOT_FOUND)

        if "to_class" in data:
            class_id = data.get("to_class")
            if class_id:
                target_class = Class.objects.filter(id=class_id, school_id=batch.school_id).first()
                if not target_class:
                    raise ValidationError({"to_class": "Invalid class."})
            record.to_class_id = class_id
        if "to_section" in data:
            section_id = data.get("to_section")
            if section_id:
                section = Section.objects.filter(id=section_id, school_class__school_id=batch.school_id).first()
                if not section:
                    raise ValidationError({"to_section": "Invalid section."})
                if record.to_class_id and section.school_class_id != record.to_class_id:
                    raise ValidationError({"to_section": "Section must belong to selected class."})
            record.to_section_id = section_id

        record.status = data["status"]
        if record.status == PromotionRecord.STATUS_NOT_PROMOTED:
            record.retention_reason = data.get("retention_reason", "")
            if not record.retention_reason:
                raise ValidationError({"retention_reason": "Retention reason is required for not promoted status."})
        else:
            record.retention_reason = ""

        if "notes" in data:
            record.notes = data.get("notes", "")

        record.decision_made_at = timezone.now()
        record.decision_made_by = request.user
        record.last_modified_by = request.user
        record.save()

        if "failed_subject_ids" in data:
            subjects = Subject.objects.filter(id__in=data.get("failed_subject_ids", []), school_id=batch.school_id)
            record.failed_subjects.set(subjects)

        PromotionAuditLog.objects.create(
            batch=batch,
            action="record_updated",
            performed_by=request.user,
            record=record,
            details=f"Record updated for {record.student.admission_no}",
            ip_address=self._get_client_ip(request),
        )

        self._recompute_counts(batch)
        return Response(PromotionRecordSerializer(record).data)

    @action(detail=True, methods=["post"], url_path="bulk-update")
    def bulk_update(self, request, pk=None):
        batch = self.get_object()
        serializer = PromotionBulkUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        records = batch.records.all()
        scope = data["scope"]
        if scope == "class":
            records = records.filter(from_class_id=data["class_id"])
        elif scope == "section":
            records = records.filter(from_section_id=data["section_id"])
        else:
            records = records.filter(id__in=data["record_ids"])

        now = timezone.now()
        action_name = data["action"]
        changed = 0
        for record in records:
            if action_name == "promote":
                if not record.to_class_id:
                    continue
                record.status = PromotionRecord.STATUS_PROMOTE
                record.retention_reason = ""
            elif action_name == "skip":
                record.status = PromotionRecord.STATUS_NOT_PROMOTED
                record.retention_reason = record.retention_reason or PromotionRecord.REASON_OTHER
            else:
                record.status = PromotionRecord.STATUS_PENDING
                record.retention_reason = ""
                record.notes = ""
                record.failed_subjects.clear()

            record.decision_made_at = now
            record.decision_made_by = request.user
            record.last_modified_by = request.user
            record.save()
            changed += 1

        PromotionAuditLog.objects.create(
            batch=batch,
            action=f"bulk_{action_name}",
            performed_by=request.user,
            details=f"Bulk action {action_name} applied to {changed} record(s)",
            ip_address=self._get_client_ip(request),
        )

        self._recompute_counts(batch)
        return Response({"updated": changed, "batch": self.get_serializer(batch).data})

    @action(detail=True, methods=["post"], url_path="ai-recommendation")
    def ai_recommendation(self, request, pk=None):
        batch = self.get_object()
        serializer = PromotionAiRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            record = batch.records.select_related("student", "from_class").get(id=data["record_id"])
        except PromotionRecord.DoesNotExist:
            return Response({"error": "Record not found"}, status=status.HTTP_404_NOT_FOUND)

        reason = data.get("reason") or record.retention_reason or "other"
        failed_subject_names = list(record.failed_subjects.values_list("name", flat=True))

        # CHANGED (Fix 5): structured Assessment / Recommendation / Interventions output
        student_name = f"{record.student.first_name} {record.student.last_name}".strip() or record.student.admission_no
        first_name = student_name.split()[0] if student_name else "the student"
        class_name = getattr(record.from_class, "name", "the current class")

        # Pull subjects of concern from notes if present (frontend stores them there)
        notes_subject_match = None
        if record.notes:
            import re as _re
            m = _re.search(r"Subjects of concern:\s*([^\n]+)", record.notes, _re.IGNORECASE)
            if m:
                notes_subject_match = [s.strip() for s in m.group(1).split(",") if s.strip()]
        focus_subjects = failed_subject_names or notes_subject_match or []
        top_subjects = ", ".join(focus_subjects[:2]) if focus_subjects else "core subjects"

        context_map = {
            "academic":       f"{student_name} has not met the academic promotion criteria for {class_name}." + (f" Areas of concern: {', '.join(focus_subjects)}." if focus_subjects else ""),
            "attendance":     f"{student_name}'s attendance for {class_name} is below the minimum 75% required for promotion.",
            "medical":        f"{student_name} had prolonged medical absence in {class_name} that significantly impacted curriculum coverage.",
            "behavioral":     f"{student_name} has recurring behavioural concerns in {class_name} despite multiple documented interventions.",
            "parent_request": f"The parent/guardian of {student_name} has formally requested retention in {class_name}.",
            "other":          f"{student_name} requires retention in {class_name} based on administrative assessment." + (f" Areas of concern: {', '.join(focus_subjects)}." if focus_subjects else ""),
        }
        situation = context_map.get(reason, context_map["other"])

        intervention_map = {
            "academic": [
                f"Enrol {first_name} in targeted remedial sessions for {top_subjects} for the first 6 weeks.",
                f"Pair {first_name} with a peer-mentor and assign weekly graded practice in the weakest subject.",
                "Schedule fortnightly progress reviews with subject teachers and share results with parents.",
                "Use diagnostic assessments at week 4 and week 12 to confirm conceptual recovery.",
                f"Provide {first_name} with a personalised study plan and quiet supervised study slots after class.",
            ],
            "attendance": [
                f"Implement an attendance improvement plan with daily tracking for {first_name}.",
                "Hold a parent–counsellor meeting to identify and resolve the root cause of absences.",
                "Set a written attendance contract with weekly targets shared with the family.",
                "Provide catch-up notes and lesson recordings for any future absence.",
                "Review attendance every fortnight and recognise consecutive on-time weeks.",
            ],
            "medical": [
                f"Design a flexible learning schedule that accommodates {first_name}'s ongoing care needs.",
                "Co-ordinate with the school nurse to maintain a wellness log throughout the year.",
                "Provide bridging worksheets covering missed curriculum topics in priority order.",
                "Offer assistive learning resources (recorded lessons, extended deadlines) where required.",
                "Schedule monthly check-ins with class teacher and parent to reassess workload.",
            ],
            "behavioral": [
                f"Assign a school counsellor to {first_name} with weekly one-to-one sessions for the first term.",
                f"Introduce a behaviour contract co-signed by {first_name}, parents and the class teacher.",
                "Use positive-reinforcement tracking with measurable weekly goals.",
                "Provide structured peer-group activities to develop social and emotional skills.",
                "Review behaviour log monthly and adjust the support plan as needed.",
            ],
            "parent_request": [
                f"Develop an enrichment plan that strengthens {first_name}'s foundational skills during the repeat year.",
                f"Hold a goal-setting meeting with {first_name} and parents to define success criteria for the year.",
                "Encourage participation in co-curricular activities to build confidence and leadership.",
                f"Offer optional advanced practice in subjects of strength to keep {first_name} challenged.",
                "Schedule quarterly reviews with parents to track holistic progress.",
            ],
            "other": [
                f"Create an individualised learning plan tailored to {first_name}'s specific needs.",
                "Hold a meeting with parents and key teachers to align on the support strategy.",
                "Set measurable progress goals and review them monthly.",
                "Offer additional academic and pastoral support resources as required.",
                f"Document all interventions in {first_name}'s student file for continuity.",
            ],
        }
        interventions = intervention_map.get(reason, intervention_map["other"])

        recommendation = (
            f"## Assessment Summary\n"
            f"{situation} A formal review of {first_name}'s academic, attendance and pastoral records "
            f"indicates that promotion to the next class would not be in the student's best interest at this stage. "
            f"The school has carefully weighed continuity, peer relationships and academic readiness before reaching this recommendation. "
            f"This is an opportunity for {first_name} to consolidate learning rather than a setback.\n\n"
            f"## Recommendation\n"
            f"It is recommended that {first_name} be retained for one academic year in {class_name}. "
            f"The repeat year should focus on {top_subjects} alongside building consistent study habits and confidence. "
            f"With targeted support, {first_name} has clear potential to thrive and progress strongly in the following year.\n\n"
            f"## Suggested Interventions\n"
            + "\n".join(f"• {item}" for item in interventions)
        )

        record.ai_recommendation = recommendation
        record.last_modified_by = request.user
        record.save(update_fields=["ai_recommendation", "last_modified_by", "last_modified_at"])

        PromotionAuditLog.objects.create(
            batch=batch,
            action="ai_generated",
            performed_by=request.user,
            record=record,
            details=f"AI recommendation generated for {record.student.admission_no}",
            ip_address=self._get_client_ip(request),
        )

        return Response({"recommendation": recommendation})

    @action(detail=True, methods=["post"], url_path="confirm")
    def confirm(self, request, pk=None):
        batch = self.get_object()
        if batch.status == PromotionBatch.STATUS_FINALIZED:
            return Response({"error": "Finalized batch cannot be modified."}, status=status.HTTP_400_BAD_REQUEST)

        promote_records = batch.records.filter(status=PromotionRecord.STATUS_PROMOTE).select_related(
            "student",
            "to_class",
            "to_section",
        )

        promoted = 0
        with transaction.atomic():
            for record in promote_records:
                if not record.to_class_id:
                    continue

                student = record.student
                StudentPromotionHistory.objects.create(
                    student=student,
                    from_class=student.current_class,
                    from_section=student.current_section,
                    to_class=record.to_class,
                    to_section=record.to_section,
                    from_academic_year=batch.academic_year,
                    to_academic_year=batch.target_year,
                    note="Promoted from Promotion Batch",
                    promoted_by=request.user,
                )
                student.current_class = record.to_class
                student.current_section = record.to_section
                student.academic_year = batch.target_year
                student.save(update_fields=["current_class", "current_section", "academic_year", "updated_at"])
                promoted += 1

            batch.status = PromotionBatch.STATUS_CONFIRMED
            batch.confirmed_at = timezone.now()
            batch.confirmed_by = request.user
            batch.save(update_fields=["status", "confirmed_at", "confirmed_by"])

        PromotionAuditLog.objects.create(
            batch=batch,
            action="confirmed",
            performed_by=request.user,
            details=f"Batch confirmed. Promoted {promoted} students.",
            ip_address=self._get_client_ip(request),
        )

        self._recompute_counts(batch)
        return Response({"message": f"Promotion batch confirmed. Promoted {promoted} students.", "batch": self.get_serializer(batch).data})

    @action(detail=True, methods=["post"], url_path="finalize")
    def finalize(self, request, pk=None):
        batch = self.get_object()
        if batch.status != PromotionBatch.STATUS_CONFIRMED:
            return Response({"error": "Only confirmed batches can be finalized."}, status=status.HTTP_400_BAD_REQUEST)

        batch.status = PromotionBatch.STATUS_FINALIZED
        batch.save(update_fields=["status"])
        PromotionAuditLog.objects.create(
            batch=batch,
            action="finalized",
            performed_by=request.user,
            details="Batch finalized",
            ip_address=self._get_client_ip(request),
        )
        return Response(self.get_serializer(batch).data)

class PromotionAuditLogViewSet(TenantScopedModelViewSet):
    serializer_class = PromotionAuditLogSerializer
    model = PromotionAuditLog
    permission_codes = {"*": "student_info.student_promote.view"}

    def get_queryset(self):
        user = self.request.user
        qs = PromotionAuditLog.objects.select_related("batch", "performed_by", "record", "batch__school")
        if user.school_id:
            return qs.filter(batch__school_id=user.school_id)
        return qs.none()

class StudentPromotionHistoryViewSet(TenantScopedModelViewSet):
    serializer_class = StudentPromotionHistorySerializer
    model = StudentPromotionHistory
    permission_codes = {"*": "student_info.student_promote.view"}

    def get_queryset(self):
        user = self.request.user
        qs = StudentPromotionHistory.objects.select_related(
            "student__school",
            "from_class",
            "from_section",
            "to_class",
            "to_section",
            "from_academic_year",
            "to_academic_year",
            "promoted_by",
        )
        if user.school_id:
            return qs.filter(student__school_id=user.school_id)
        return qs.none()

class StudentMultiClassRecordViewSet(TenantScopedModelViewSet):
    serializer_class = StudentMultiClassRecordSerializer
    model = StudentMultiClassRecord
    permission_codes = {
        "*": "student_info.multi_class_student.view",
        "bulk_save": "student_info.multi_class_student.view",
    }

    def get_queryset(self):
        user = self.request.user
        qs = StudentMultiClassRecord.objects.select_related("student", "school_class", "section", "student__school")

        student_id = self.request.query_params.get("student")
        if student_id:
            qs = qs.filter(student_id=student_id)

        if user.school_id:
            return qs.filter(student__school_id=user.school_id)
        return qs.none()

    def perform_create(self, serializer):
        record = serializer.save()
        if record.is_default:
            StudentMultiClassRecord.objects.filter(student_id=record.student_id).exclude(id=record.id).update(is_default=False)
            Student.objects.filter(id=record.student_id).update(
                current_class_id=record.school_class_id,
                current_section_id=record.section_id,
            )

    def perform_update(self, serializer):
        record = serializer.save()
        if record.is_default:
            StudentMultiClassRecord.objects.filter(student_id=record.student_id).exclude(id=record.id).update(is_default=False)
            Student.objects.filter(id=record.student_id).update(
                current_class_id=record.school_class_id,
                current_section_id=record.section_id,
            )

    @action(detail=False, methods=["post"], url_path="bulk-save")
    def bulk_save(self, request):
        serializer = StudentMultiClassBulkSaveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        student_id = data["student_id"]
        user = request.user
        student_qs = Student.objects.filter(id=student_id, school_id=user.school_id)
        student = student_qs.first()
        if not student:
            raise ValidationError("Student not found in your school.")

        records = data.get("records", [])
        default_seen = False

        with transaction.atomic():
            StudentMultiClassRecord.objects.filter(student=student).delete()
            created = []

            for item in records:
                school_class_id = item["school_class"]
                section_id = item.get("section")
                is_default = bool(item.get("is_default", False))
                if is_default:
                    if default_seen:
                        is_default = False
                    default_seen = True

                from apps.core.models import Class, Section

                class_qs = Class.objects.filter(id=school_class_id, school_id=student.school_id)
                if not class_qs.exists():
                    raise ValidationError("One or more classes are invalid for this student school.")

                if section_id:
                    section_qs = Section.objects.filter(id=section_id, school_class_id=school_class_id)
                    if not section_qs.exists():
                        raise ValidationError("One or more sections do not belong to selected class.")

                created.append(
                    StudentMultiClassRecord.objects.create(
                        student=student,
                        school_class_id=school_class_id,
                        section_id=section_id,
                        roll_no=item.get("roll_no", ""),
                        is_default=is_default,
                    )
                )

            default_record = next((item for item in created if item.is_default), None)
            if not default_record and created:
                default_record = created[0]
                default_record.is_default = True
                default_record.save(update_fields=["is_default", "updated_at"])

            if default_record:
                student.current_class_id = default_record.school_class_id
                student.current_section_id = default_record.section_id
                student.save(update_fields=["current_class", "current_section", "updated_at"])

        response_data = StudentMultiClassRecordSerializer(
            StudentMultiClassRecord.objects.filter(student=student).order_by("-is_default", "id"),
            many=True,
        ).data
        return Response({"student_id": student.id, "records": response_data}, status=status.HTTP_200_OK)

class StudentSubjectAssignmentViewSet(TenantScopedModelViewSet):
    serializer_class = StudentSubjectAssignmentSerializer
    model = StudentSubjectAssignment
    permission_codes = {
        "*": "student_info.multi_class_student.view",
        "assign_individual": "student_info.multi_class_student.view",
        "assign_bulk": "student_info.multi_class_student.view",
        "upsert_optional": "student_info.multi_class_student.view",
    }

    def get_queryset(self):
        user = self.request.user
        qs = StudentSubjectAssignment.objects.select_related(
            "student",
            "subject",
            "academic_year",
            "school_class",
            "section",
            "assigned_by",
        )
        student_id = self.request.query_params.get("student_id")
        class_id = self.request.query_params.get("class") or self.request.query_params.get("school_class")
        section_id = self.request.query_params.get("section")
        academic_year_id = self.request.query_params.get("academic_year")
        if student_id:
            qs = qs.filter(student_id=student_id)
        if class_id:
            qs = qs.filter(school_class_id=class_id)
        if section_id:
            qs = qs.filter(section_id=section_id)
        if academic_year_id:
            qs = qs.filter(academic_year_id=academic_year_id)
        if user.school_id:
            return qs.filter(student__school_id=user.school_id)
        return qs.none()

    def _validation_response(self, field_errors=None, message="Validation failed"):
        normalized = {}
        for key, value in (field_errors or {}).items():
            if isinstance(value, (list, tuple)):
                normalized[key] = str(value[0]) if value else "Validation failed"
            else:
                normalized[key] = str(value)
        return Response(
            {
                "success": False,
                "message": message,
                "field_errors": normalized,
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    def _resolve_students(self, *, student_ids, class_id, section_id, user):
        queryset = Student.objects.filter(
            id__in=student_ids, current_class_id=class_id, current_section_id=section_id, school_id=user.school_id
        )
        return list(queryset)

    def _create_assignments(self, *, students, subject_ids, academic_year_id, class_id, section_id, is_optional, user):
        existing = StudentSubjectAssignment.objects.filter(
            student_id__in=[row.id for row in students],
            subject_id__in=subject_ids,
            academic_year_id=academic_year_id,
        )
        if existing.exists():
            return self._validation_response({"subject_ids": "Subject already assigned to this student"})

        payload = [
            StudentSubjectAssignment(
                student_id=student.id,
                subject_id=subject_id,
                academic_year_id=academic_year_id,
                school_class_id=class_id,
                section_id=section_id,
                is_optional=is_optional,
                assigned_by=user,
            )
            for student in students
            for subject_id in subject_ids
        ]
        StudentSubjectAssignment.objects.bulk_create(payload)
        return None

    @action(detail=False, methods=["post"], url_path="assign-individual")
    def assign_individual(self, request):
        serializer = StudentSubjectAssignmentRequestSerializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            return self._validation_response(serializer.errors)

        data = serializer.validated_data
        student_id = request.data.get("student_id")
        if not student_id:
            return self._validation_response({"student_id": "Please select a student"})

        students = self._resolve_students(
            student_ids=[int(student_id)],
            class_id=data["school_class"],
            section_id=data["section"],
            user=request.user,
        )
        if not students:
            return self._validation_response({"student_id": "Unable to load students. Please try again"})

        with transaction.atomic():
            error = self._create_assignments(
                students=students,
                subject_ids=data["subject_ids"],
                academic_year_id=data["academic_year"],
                class_id=data["school_class"],
                section_id=data["section"],
                is_optional=data.get("is_optional", False),
                user=request.user,
            )
            if error:
                return error

        return Response({"success": True, "message": "Subjects assigned successfully"}, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"], url_path="assign-bulk")
    def assign_bulk(self, request):
        serializer = StudentSubjectAssignmentRequestSerializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            return self._validation_response(serializer.errors)

        data = serializer.validated_data
        student_ids = data.get("student_ids") or request.data.get("student_ids") or []

        if student_ids:
            students = self._resolve_students(
                student_ids=student_ids,
                class_id=data["school_class"],
                section_id=data["section"],
                user=request.user,
            )
        else:
            students_qs = Student.objects.filter(
                current_class_id=data["school_class"], current_section_id=data["section"], school_id=request.user.school_id
            )
            students = list(students_qs)

        if not students:
            return self._validation_response({"students": "Unable to load students. Please try again"})

        with transaction.atomic():
            error = self._create_assignments(
                students=students,
                subject_ids=data["subject_ids"],
                academic_year_id=data["academic_year"],
                class_id=data["school_class"],
                section_id=data["section"],
                is_optional=data.get("is_optional", False),
                user=request.user,
            )
            if error:
                return error

        return Response({"success": True, "message": "Subjects assigned successfully"}, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"], url_path="upsert-optional")
    def upsert_optional(self, request):
        """
        Upsert optional (category-tagged) subjects for one student.
        Replaces all existing optional assignments.
        Payload: { student_id, assignments: [{category, subject_name}, ...] }
        """
        import traceback
        from apps.core.models import AcademicYear, Subject

        valid_categories = dict(StudentSubjectAssignment.CATEGORY_CHOICES)

        try:
            student_id = request.data.get("student_id")
            raw_assignments = request.data.get("assignments", [])
            if not isinstance(raw_assignments, list):
                raw_assignments = []

            if not student_id:
                return Response({"success": False, "message": "student_id is required"}, status=status.HTTP_400_BAD_REQUEST)

            user = request.user
            student_qs = Student.objects.filter(id=student_id)
            if getattr(user, "school_id", None):
                student_qs = student_qs.filter(school_id=user.school_id)
            student = student_qs.select_related("current_class", "current_section").first()
            if not student:
                return Response({"success": False, "message": "Student not found"}, status=status.HTTP_404_NOT_FOUND)

            # Determine active academic year for this school
            school_id = student.school_id
            year_qs = AcademicYear.objects.filter(is_current=True, school_id=school_id)
            year = year_qs.first()
            if not year:
                # Fallback: any current academic year
                year = AcademicYear.objects.filter(is_current=True).first()
            if not year:
                # Last fallback: most recent year for this school
                year = AcademicYear.objects.filter(school_id=school_id).order_by("-start_date").first()
            if not year:
                return Response({"success": False, "message": "No active academic year found"}, status=status.HTTP_400_BAD_REQUEST)

            # Clean incoming {category, subject_name} pairs
            cleaned = []
            for item in raw_assignments:
                if not isinstance(item, dict):
                    continue
                category = (item.get("category") or "").strip()
                name = (item.get("subject_name") or "").strip()
                if not name or category not in valid_categories:
                    continue
                cleaned.append((category, name))

            # Resolve subjects by name (bulk lookup + get-or-create for missing)
            names_clean = list({name for _, name in cleaned})
            subj_by_lower = {}
            if names_clean:
                existing = {
                    s.name.lower(): s
                    for s in Subject.objects.filter(school_id=school_id, name__in=names_clean)
                }
                subj_by_lower = {k.lower(): v for k, v in existing.items()}
                for name in names_clean:
                    subj = subj_by_lower.get(name.lower())
                    if not subj:
                        try:
                            subj, _ = Subject.objects.get_or_create(
                                school_id=school_id,
                                name=name,
                                defaults={"subject_type": "optional"},
                            )
                        except Exception:
                            subj = Subject.objects.filter(school_id=school_id, name__iexact=name).first()
                        if subj:
                            subj_by_lower[name.lower()] = subj

            resolved = [
                (category, subj_by_lower[name.lower()])
                for category, name in cleaned
                if name.lower() in subj_by_lower
            ]

            with transaction.atomic():
                # Remove previous optional assignments for this student + academic year
                StudentSubjectAssignment.objects.filter(
                    student=student,
                    academic_year=year,
                    is_optional=True,
                ).delete()

                if resolved and student.current_class and student.current_section:
                    # Exclude subjects already assigned as non-optional (unique constraint guard)
                    non_optional_ids = set(
                        StudentSubjectAssignment.objects.filter(
                            student=student,
                            academic_year=year,
                            is_optional=False,
                        ).values_list("subject_id", flat=True)
                    )
                    new_assignments = [
                        StudentSubjectAssignment(
                            student=student,
                            subject=subj,
                            academic_year=year,
                            school_class=student.current_class,
                            section=student.current_section,
                            is_optional=True,
                            category=category,
                            assigned_by=user,
                        )
                        for category, subj in resolved if subj.id not in non_optional_ids
                    ]
                    if new_assignments:
                        StudentSubjectAssignment.objects.bulk_create(new_assignments, ignore_conflicts=True)

            return Response(
                {"success": True, "message": "Optional subjects updated", "assigned_count": len(resolved)},
                status=status.HTTP_200_OK,
            )

        except Exception as exc:
            logger.error("upsert_optional failed: %s\n%s", exc, traceback.format_exc())
            return Response(
                {"success": False, "message": f"Server error: {exc}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

class StudentRecordAuditViewSet(TenantScopedModelViewSet):
    serializer_class = StudentRecordAuditSerializer
    model = StudentRecordAudit
    permission_codes = {"*": "student_info.delete_student_record.view"}
    http_method_names = ["get", "head", "options"]

    def get_queryset(self):
        user = self.request.user
        qs = StudentRecordAudit.objects.select_related("student", "performed_by", "school", "student__current_class", "student__current_section")

        student_id = self.request.query_params.get("student_id")
        action = (self.request.query_params.get("action") or "").strip()
        search = (self.request.query_params.get("search") or "").strip()
        class_id = self.request.query_params.get("class")
        section_id = self.request.query_params.get("section")

        if student_id:
            qs = qs.filter(student_id=student_id)
        if action:
            qs = qs.filter(action=action)
        if class_id:
            qs = qs.filter(student__current_class_id=class_id)
        if section_id:
            qs = qs.filter(student__current_section_id=section_id)
        if search:
            qs = qs.filter(
                Q(student__first_name__icontains=search)
                | Q(student__last_name__icontains=search)
                | Q(student__admission_no__icontains=search)
                | Q(note__icontains=search)
            )

        if user.school_id:
            return qs.filter(school_id=user.school_id)
        return qs.none()
