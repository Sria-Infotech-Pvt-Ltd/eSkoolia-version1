import math
import re
import requests as http_requests
from datetime import date

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.db.models import Avg, Count, Q
from django.db.models.functions import Lower
from config.pagination import ApiPageNumberPagination
from .portal_scoping import scope_to_school
from .models import AcademicYear, Class, ClassPeriod, ClassRoom, LevelScheduleConfig, Section, Stream, Subject, Vehicle, TransportRoute, AssignVehicle
from .models import BusStop, BusLocation, TransportAlert, BusRoutePickupUpdate
from .models import VehicleDriverAssignment, TransportNotificationLog, RoutePerformanceLog
from .models import ItemCategory, ItemStore, Supplier, Item, ItemReceive, ItemIssue, ItemSell
from .models import Holiday
from .services.parent_notifications import send_email_sendgrid, send_sms_twilio, safe_guardian_phone
from .serializers import (
    AcademicYearSerializer,
    ClassPeriodSerializer,
    ClassRoomSerializer,
    ClassSerializer,
    LevelScheduleConfigSerializer,
    SectionSerializer,
    SubjectSerializer,
    VehicleSerializer,
    TransportRouteSerializer,
    AssignVehicleSerializer,
    BusStopSerializer,
    BusLocationSerializer,
    TransportAlertSerializer,
    BusRoutePickupUpdateSerializer,
    VehicleDriverAssignmentSerializer,
    TransportNotificationLogSerializer,
    RoutePerformanceLogSerializer,
    ItemCategorySerializer,
    ItemStoreSerializer,
    SupplierSerializer,
    ItemSerializer,
    ItemReceiveSerializer,
    ItemIssueSerializer,
    ItemSellSerializer,
)
from .serializers import HolidaySerializer, StreamSerializer


class TenantQueryMixin:
    """Filter queryset to the authenticated user's school."""
    model = None

    def get_queryset(self):
        user = self.request.user
        qs = self.model.objects.all()
        return scope_to_school(qs, self.model, user)

    def perform_create(self, serializer):
        school = getattr(self.request.user, "school", None)
        if school is None:
            from rest_framework.exceptions import ValidationError as DRFValidationError
            raise DRFValidationError({
                "school": [
                    "Your account is not linked to a school. "
                    "Please ask an administrator to assign your user to a school before adding records."
                ]
            })
        serializer.save(school=school)


class PermissionScopedViewSet(viewsets.ModelViewSet):
    permission_codes = {}
    pagination_class = ApiPageNumberPagination

    def get_required_permission_code(self):
        action = getattr(self, "action", None)
        if action and action in self.permission_codes:
            return self.permission_codes[action]
        return self.permission_codes.get("*")

    def check_permissions(self, request):
        super().check_permissions(request)
        code = self.get_required_permission_code()
        if not code:
            return

        user = request.user
        if user.is_superuser:
            return

        if not hasattr(user, "has_permission_code") or not user.has_permission_code(code):
            raise PermissionDenied("You do not have permission to perform this action.")


# class AcademicYearViewSet(TenantQueryMixin, viewsets.ModelViewSet):
#     model = AcademicYear
#     serializer_class = AcademicYearSerializer
#     permission_classes = [permissions.IsAuthenticated]

#     def list(self, request, *args, **kwargs):
#         print("=" * 50)
#         print("HOST:", request.get_host())
#         print("USER:", request.user)
#         print("SCHOOL_ID:", getattr(request.user, "school_id", None))
#         print("SCHOOL:", getattr(request.user, "school", None))
#         print("TENANT:", getattr(request, "tenant", None))
#         print("=" * 50)
#         return super().list(request, *args, **kwargs)

class AcademicYearViewSet(TenantQueryMixin, viewsets.ModelViewSet):
    model = AcademicYear
    serializer_class = AcademicYearSerializer
    permission_classes = [permissions.IsAuthenticated]




class ClassViewSet(TenantQueryMixin, viewsets.ModelViewSet):
    model = Class
    serializer_class = ClassSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = ApiPageNumberPagination  # 10 per page by default

    def get_queryset(self):
        from django.db.models import Count as DbCount
        from django.db.models import Prefetch
        from apps.core.models import Section as SectionModel

        user = self.request.user
        # Annotate sections with student counts in a single DB aggregation query
        sections_qs = SectionModel.objects.annotate(
            _student_count=DbCount("students", filter=Q(students__is_active=True))
        ).order_by("name")

        qs = Class.objects.prefetch_related(
            Prefetch("sections", queryset=sections_qs)
        ).order_by("numeric_order", "name", "id")

        if user.school_id:
            qs = qs.filter(school_id=user.school_id)
            return qs.annotate(_total_students=DbCount("students", filter=Q(students__is_active=True)))
        return qs.none()

    @action(detail=False, methods=["get"])
    def options(self, request):
        return Response(Class.valid_class_options())

    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, "message_dict", {"name": exc.messages}))
        except IntegrityError as exc:
            message = str(exc).lower()
            if "school_classes.school_id" in message and "school_classes.name" in message:
                raise ValidationError({"name": ["Class name already exists"]})
            raise ValidationError({"detail": "Unable to save class due to data integrity rules."})

    def update(self, request, *args, **kwargs):
        try:
            return super().update(request, *args, **kwargs)
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, "message_dict", {"name": exc.messages}))
        except IntegrityError as exc:
            message = str(exc).lower()
            if "school_classes.school_id" in message and "school_classes.name" in message:
                raise ValidationError({"name": ["Class name already exists"]})
            raise ValidationError({"detail": "Unable to update class due to data integrity rules."})

    def partial_update(self, request, *args, **kwargs):
        try:
            return super().partial_update(request, *args, **kwargs)
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, "message_dict", {"name": exc.messages}))
        except IntegrityError as exc:
            message = str(exc).lower()
            if "school_classes.school_id" in message and "school_classes.name" in message:
                raise ValidationError({"name": ["Class name already exists"]})
            raise ValidationError({"detail": "Unable to update class due to data integrity rules."})


class StreamViewSet(TenantQueryMixin, viewsets.ModelViewSet):
    model = Stream
    serializer_class = StreamSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.school_id:
            # Lazily seed the default streams for this school on first access.
            try:
                school = getattr(user, "school", None)
                if school is not None:
                    Stream.ensure_defaults(school)
            except Exception:
                pass
            return Stream.objects.filter(school_id=user.school_id).order_by("name")
        return Stream.objects.none()

    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, "message_dict", {"name": exc.messages}))
        except IntegrityError:
            raise ValidationError({"name": ["A stream with this name already exists."]})

    def update(self, request, *args, **kwargs):
        try:
            return super().update(request, *args, **kwargs)
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, "message_dict", {"name": exc.messages}))
        except IntegrityError:
            raise ValidationError({"name": ["A stream with this name already exists."]})

    def partial_update(self, request, *args, **kwargs):
        try:
            return super().partial_update(request, *args, **kwargs)
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, "message_dict", {"name": exc.messages}))
        except IntegrityError:
            raise ValidationError({"name": ["A stream with this name already exists."]})


class SectionViewSet(viewsets.ModelViewSet):
    serializer_class = SectionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def _split_section_names(self, raw_value):
        if raw_value is None:
            return []
        parts = [part.strip() for part in str(raw_value).split(",")]
        return [part for part in parts if part]

    def _normalize_legacy_combined_sections(self, queryset):
        combined_rows = queryset.filter(name__contains=",")
        for row in combined_rows:
            names = self._split_section_names(row.name)
            if not names:
                row.delete()
                continue

            existing_lower = set(
                Section.objects.filter(school_class_id=row.school_class_id)
                .exclude(pk=row.pk)
                .values_list("name", flat=True)
            )
            existing_lower = {name.casefold() for name in existing_lower if name}

            for section_name in names:
                if section_name.casefold() in existing_lower:
                    continue
                Section.objects.create(
                    school_class_id=row.school_class_id,
                    name=section_name,
                    capacity=row.capacity,
                )
                existing_lower.add(section_name.casefold())

            row.delete()

    def get_queryset(self):
        user = self.request.user
        qs = Section.objects.select_related("school_class__school")
        class_filter = (self.request.query_params.get("class") or self.request.query_params.get("school_class") or "").strip()
        if user.school_id:
            scoped_qs = qs.filter(school_class__school_id=user.school_id)
            self._normalize_legacy_combined_sections(scoped_qs)
            scoped = Section.objects.select_related("school_class__school").filter(school_class__school_id=user.school_id)
            if class_filter.isdigit():
                scoped = scoped.filter(school_class_id=int(class_filter))
            return scoped
        return qs.none()

    def create(self, request, *args, **kwargs):
        data = request.data.copy()
        school_class_id = data.get("school_class")
        split_names = self._split_section_names(data.get("name"))

        if not split_names:
            raise ValidationError({"name": "Section name is required."})

        if len(split_names) == 1:
            data["name"] = split_names[0]
            serializer = self.get_serializer(data=data)
            serializer.is_valid(raise_exception=True)
            self.perform_create(serializer)
            headers = self.get_success_headers(serializer.data)
            return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

        duplicate_input = []
        seen_input = set()
        for name in split_names:
            key = name.casefold()
            if key in seen_input:
                duplicate_input.append(name)
            seen_input.add(key)

        if duplicate_input:
            raise ValidationError({"name": [f"Duplicate section names in input: {', '.join(sorted(set(duplicate_input)))}"]})

        existing_lower = set(
            Section.objects.filter(school_class_id=school_class_id).values_list("name", flat=True)
        )
        existing_lower = {name.casefold() for name in existing_lower if name}

        max_sections_per_class = getattr(SectionSerializer, "MAX_SECTIONS_PER_CLASS", 26)
        existing_count = Section.objects.filter(school_class_id=school_class_id).count()
        if existing_count + len(split_names) > max_sections_per_class:
            raise ValidationError({"name": ["Section limit reached for this class."]})

        duplicate_existing = [name for name in split_names if name.casefold() in existing_lower]
        if duplicate_existing:
            raise ValidationError({"name": ["Section name already exists"]})

        created_rows = []
        for section_name in split_names:
            row_data = data.copy()
            row_data["name"] = section_name
            serializer = self.get_serializer(data=row_data)
            serializer.is_valid(raise_exception=True)
            self.perform_create(serializer)
            created_rows.append(serializer.data)

        return Response(
            {
                "success": True,
                "message": "Sections created successfully.",
                "count": len(created_rows),
                "data": created_rows,
            },
            status=status.HTTP_201_CREATED,
        )



class SectionReplaceView(APIView):
    """POST /api/v1/core/sections/replace/

    Delete old-pattern sections and create new-pattern sections for given classes.

    Request body:
        class_ids  – non-empty list of integer class IDs (must belong to user's school)
        old_names  – list of section names to delete (case-insensitive, may be empty)
        new_names  – non-empty list of section names to create (max 10)
        capacity   – integer 1–200 (default 40)

    Returns: { deleted: N, created: N }
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        user = request.user
        data = request.data

        # --- validate class_ids ---
        class_ids = data.get("class_ids", [])
        if not class_ids or not isinstance(class_ids, list):
            raise ValidationError({"class_ids": "Must be a non-empty list of class IDs."})
        try:
            class_ids = [int(cid) for cid in class_ids]
        except (TypeError, ValueError):
            raise ValidationError({"class_ids": "Must contain valid integer class IDs."})

        # --- validate new_names ---
        new_names = data.get("new_names", [])
        if not new_names or not isinstance(new_names, list):
            raise ValidationError({"new_names": "Must be a non-empty list of section names."})
        new_names = [str(n).strip() for n in new_names if str(n).strip()]
        if not new_names:
            raise ValidationError({"new_names": "Must contain at least one valid section name."})
        if len(new_names) > 10:
            raise ValidationError({"new_names": "Maximum 10 sections allowed per class."})

        # --- validate old_names (optional) ---
        old_names = data.get("old_names", [])
        if not isinstance(old_names, list):
            raise ValidationError({"old_names": "Must be a list of section names."})
        old_names = [str(n).strip() for n in old_names if str(n).strip()]

        # --- validate capacity ---
        try:
            capacity = int(data.get("capacity", 40))
            if not (1 <= capacity <= 200):
                raise ValueError
        except (TypeError, ValueError):
            raise ValidationError({"capacity": "Capacity must be an integer between 1 and 200."})

        # --- scope class_ids to the user's school ---
        if getattr(user, "school_id", None):
            base_qs = Class.objects.filter(id__in=class_ids, school_id=user.school_id)
        else:
            return Response({"detail": "No school access."}, status=status.HTTP_403_FORBIDDEN)

        valid_class_ids = set(base_qs.values_list("id", flat=True))
        invalid = set(class_ids) - valid_class_ids
        if invalid:
            raise ValidationError({"class_ids": f"Classes not found or not accessible: {sorted(invalid)}"})

        old_names_lower = {n.casefold() for n in old_names}
        deleted_total = 0
        created_total = 0

        for class_id in valid_class_ids:
            if old_names_lower:
                del_count, _ = (
                    Section.objects.filter(school_class_id=class_id)
                    .annotate(name_lower=Lower("name"))
                    .filter(name_lower__in=old_names_lower)
                    .delete()
                )
                deleted_total += del_count

            existing_lower = {
                n.casefold()
                for n in Section.objects.filter(school_class_id=class_id).values_list("name", flat=True)
                if n
            }
            for name in new_names:
                if name.casefold() not in existing_lower:
                    Section.objects.create(
                        school_class_id=class_id,
                        name=name,
                        capacity=capacity,
                    )
                    existing_lower.add(name.casefold())
                    created_total += 1

        return Response(
            {
                "success": True,
                "message": f"Replaced sections: {deleted_total} deleted, {created_total} created.",
                "deleted": deleted_total,
                "created": created_total,
            },
            status=status.HTTP_200_OK,
        )


class SectionBulkDeleteView(APIView):
    """POST /api/v1/core/sections/bulk-delete/

    Bulk-delete sections by ID list.

    Request body: { ids: [1, 2, 3] }
    Returns:      { deleted: N }
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        user = request.user
        ids = request.data.get("ids", [])
        if not ids or not isinstance(ids, list):
            raise ValidationError({"ids": "Must be a non-empty list of section IDs."})
        try:
            ids = [int(i) for i in ids]
        except (TypeError, ValueError):
            raise ValidationError({"ids": "Must contain valid integer section IDs."})

        if getattr(user, "school_id", None):
            qs = Section.objects.filter(id__in=ids, school_class__school_id=user.school_id)
        else:
            return Response({"detail": "No school access."}, status=status.HTTP_403_FORBIDDEN)

        count, _ = qs.delete()
        return Response({"success": True, "deleted": count}, status=status.HTTP_200_OK)


class SubjectViewSet(TenantQueryMixin, viewsets.ModelViewSet):
    model = Subject
    serializer_class = SubjectSerializer
    permission_classes = [permissions.IsAuthenticated]

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        return Response(
            {
                "success": True,
                "message": "Subject created successfully",
                "data": response.data,
            },
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        response = super().update(request, *args, **kwargs)
        return Response(
            {
                "success": True,
                "message": "Subject updated successfully",
                "data": response.data,
            },
            status=status.HTTP_200_OK,
        )

    def partial_update(self, request, *args, **kwargs):
        response = super().partial_update(request, *args, **kwargs)
        return Response(
            {
                "success": True,
                "message": "Subject updated successfully",
                "data": response.data,
            },
            status=status.HTTP_200_OK,
        )

    def destroy(self, request, *args, **kwargs):
        subject = self.get_object()

        # Business rule: prevent deletion if in timetable/exams/attendance.
        from apps.academics.models import ClassRoutineSlot
        from apps.exams.models import ExamSchedule, ExamSetup, ExamRoutine, ExamAttendance
        from apps.attendance.models import SubjectAttendance

        blockers = []
        school_id = subject.school_id

        if ClassRoutineSlot.objects.filter(school_id=school_id, subject_id=subject.id).exists():
            blockers.append("Timetable")
        if ExamSchedule.objects.filter(school_id=school_id, subject_id=subject.id).exists() \
            or ExamSetup.objects.filter(school_id=school_id, subject_id=subject.id).exists() \
            or ExamRoutine.objects.filter(school_id=school_id, subject_id=subject.id).exists() \
            or ExamAttendance.objects.filter(school_id=school_id, subject_id=subject.id).exists():
            blockers.append("Exams")
        if SubjectAttendance.objects.filter(school_id=school_id, subject_id=subject.id).exists():
            blockers.append("Attendance")

        if blockers:
            raise ValidationError(
                {
                    "subject": [f"Subject cannot be deleted because it is used in: {', '.join(blockers)}."],
                }
            )

        super().destroy(request, *args, **kwargs)
        return Response(
            {
                "success": True,
                "message": "Subject deleted successfully",
            },
            status=status.HTTP_200_OK,
        )


class ClassPeriodViewSet(TenantQueryMixin, viewsets.ModelViewSet):
    model = ClassPeriod
    serializer_class = ClassPeriodSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = super().get_queryset()
        period_type = self.request.query_params.get("period_type") or self.request.query_params.get("type")
        if period_type:
            queryset = queryset.filter(period_type=period_type)
        return queryset.order_by("start_time", "period")


class ClassRoomViewSet(TenantQueryMixin, viewsets.ModelViewSet):
    model = ClassRoom
    serializer_class = ClassRoomSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = super().get_queryset()
        return queryset.order_by("room_no", "id")

    def _normalized_errors(self, serializer_errors):
        if isinstance(serializer_errors, dict):
            message_values = serializer_errors.get("message")
            if isinstance(message_values, list) and message_values:
                return serializer_errors, str(message_values[0])
            if isinstance(message_values, str) and message_values:
                return serializer_errors, message_values

            cleaned = {}
            for key, value in serializer_errors.items():
                if isinstance(value, list):
                    cleaned[key] = [str(item) for item in value]
                else:
                    cleaned[key] = [str(value)]
            return cleaned, "Validation failed"
        return {}, "Validation failed"

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            errors, message = self._normalized_errors(serializer.errors)
            payload = {"success": False, "message": message}
            if errors:
                payload["errors"] = errors
            return Response(payload, status=status.HTTP_400_BAD_REQUEST)

        try:
            user_school = getattr(request.user, "school", None)
            if not user_school:
                return Response(
                    {
                        "success": False,
                        "message": "Your account is not linked to a school. Contact your administrator.",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            self.perform_create(serializer)
        except IntegrityError as exc:
            msg = str(exc).lower()
            if "uq_class_room_school_room_no" in msg or "room_no" in msg:
                friendly = "Room already exists"
            elif "section" in msg:
                friendly = "Selected section is invalid."
            elif "school" in msg:
                friendly = "Could not determine your school. Please re-login."
            else:
                friendly = "Could not save room due to a database constraint."
            return Response(
                {"success": False, "message": friendly},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            {
                "success": True,
                "message": "Room added successfully",
                "data": serializer.data,
            },
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        if not serializer.is_valid():
            errors, message = self._normalized_errors(serializer.errors)
            payload = {"success": False, "message": message}
            if errors:
                payload["errors"] = errors
            return Response(payload, status=status.HTTP_400_BAD_REQUEST)

        try:
            self.perform_update(serializer)
        except IntegrityError as exc:
            msg = str(exc).lower()
            if "uq_class_room_school_room_no" in msg or "room_no" in msg:
                friendly = "Room already exists"
            elif "section" in msg:
                friendly = "Selected section is invalid."
            else:
                friendly = "Could not update room due to a database constraint."
            return Response(
                {
                    "success": False,
                    "message": friendly,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            {
                "success": True,
                "message": "Room updated successfully",
                "data": serializer.data,
            },
            status=status.HTTP_200_OK,
        )

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        room = self.get_object()

        # Prevent deletion when room is already used in timetable or lesson planning.
        from apps.academics.models import ClassRoutineSlot, LessonPlanner

        in_use = ClassRoutineSlot.objects.filter(school_id=room.school_id, class_room_id=room.id).exists() or \
            LessonPlanner.objects.filter(school_id=room.school_id, class_room_id=room.id).exists()

        if in_use:
            return Response(
                {
                    "success": False,
                    "message": "Cannot delete. Room is already assigned",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        super().destroy(request, *args, **kwargs)
        return Response(
            {
                "success": True,
                "message": "Room deleted successfully",
            },
            status=status.HTTP_200_OK,
        )


class LevelScheduleConfigViewSet(TenantQueryMixin, viewsets.ModelViewSet):
    model = LevelScheduleConfig
    serializer_class = LevelScheduleConfigSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = super().get_queryset()
        academic_year_id = self.request.query_params.get("academic_year_id") or self.request.query_params.get("academic_year")
        if academic_year_id:
            queryset = queryset.filter(academic_year_id=academic_year_id)
        return queryset

    def create(self, request, *args, **kwargs):
        # Configuring a level's hours is naturally a "save", not a one-time
        # create — re-saving the same (school, academic_year, level_group)
        # should update the existing row rather than fail. This also avoids
        # ever hitting the uq_level_schedule_config_scope constraint from a
        # normal save, so a genuine IntegrityError below means something
        # else went wrong (e.g. a missing required field) and should say so.
        academic_year_id = request.data.get("academic_year")
        level_group = request.data.get("level_group")
        existing = None
        if request.user.school_id and academic_year_id and level_group:
            existing = self.get_queryset().filter(academic_year_id=academic_year_id, level_group=level_group).first()

        if existing:
            serializer = self.get_serializer(existing, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response({"success": True, "message": "Schedule configuration updated.", "data": serializer.data})

        try:
            return super().create(request, *args, **kwargs)
        except IntegrityError as exc:
            message = str(exc).lower()
            if "uq_level_schedule_config_scope" in message:
                return Response(
                    {"success": False, "message": "Schedule configuration for this level and academic year already exists."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(
                {"success": False, "message": "Unable to save schedule configuration — a required field may be missing."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def update(self, request, *args, **kwargs):
        try:
            return super().update(request, *args, **kwargs)
        except IntegrityError as exc:
            message = str(exc).lower()
            if "uq_level_schedule_config_scope" in message:
                return Response(
                    {"success": False, "message": "Another schedule configuration for this level and academic year already exists."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(
                {"success": False, "message": "Unable to update schedule configuration — a required field may be missing."},
                status=status.HTTP_400_BAD_REQUEST,
            )


# ===== TRANSPORT MODULE VIEWSETS =====
class VehicleViewSet(TenantQueryMixin, PermissionScopedViewSet):
    model = Vehicle
    serializer_class = VehicleSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": "transport.vehicle.view"}

    def get_queryset(self):
        queryset = super().get_queryset()
        return queryset.select_related("driver", "academic_year", "school")

    def perform_create(self, serializer):
        from rest_framework.exceptions import ValidationError
        
        school = self.request.user.school
        if not school:
            raise ValidationError({"school": "User does not have a school assigned."})
        
        # Try to get current academic year, fallback to latest one
        academic_year = AcademicYear.objects.filter(school=school, is_current=True).first()
        if not academic_year:
            academic_year = AcademicYear.objects.filter(school=school).order_by("-start_date").first()
        
        if not academic_year:
            raise ValidationError({"academic_year": "No academic year found for your school. Please create one first."})
        
        serializer.save(school=school, academic_year=academic_year)


class TransportRouteViewSet(TenantQueryMixin, PermissionScopedViewSet):
    model = TransportRoute
    serializer_class = TransportRouteSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": "transport.route.view"}

    def get_queryset(self):
        queryset = super().get_queryset()
        return queryset.select_related("academic_year", "school")

    def perform_create(self, serializer):
        from rest_framework.exceptions import ValidationError
        
        school = self.request.user.school
        if not school:
            raise ValidationError({"school": "User does not have a school assigned."})
        
        # Try to get current academic year, fallback to latest one
        academic_year = AcademicYear.objects.filter(school=school, is_current=True).first()
        if not academic_year:
            academic_year = AcademicYear.objects.filter(school=school).order_by("-start_date").first()
        
        if not academic_year:
            raise ValidationError({"academic_year": "No academic year found for your school. Please create one first."})
        
        serializer.save(school=school, academic_year=academic_year)

    @action(detail=True, methods=["get"], url_path="builder")
    def builder(self, request, pk=None):
        route = self.get_object()
        stops_qs = BusStop.objects.filter(route=route, active_status=True).order_by("stop_order", "id")
        stops_data = BusStopSerializer(stops_qs, many=True).data

        total_distance_km = 0.0
        previous_stop = None
        for stop in stops_qs:
            if previous_stop is not None:
                total_distance_km += self._haversine_km(
                    float(previous_stop.latitude),
                    float(previous_stop.longitude),
                    float(stop.latitude),
                    float(stop.longitude),
                )
            previous_stop = stop

        return Response(
            {
                "id": route.id,
                "title": route.title,
                "fare": route.fare,
                "active_status": route.active_status,
                "total_stops": len(stops_data),
                "total_distance_km": round(total_distance_km, 3),
                "stops": stops_data,
            }
        )

    @action(detail=True, methods=["get"], url_path="optimize")
    def optimize(self, request, pk=None):
        """Nearest-neighbor stop optimization with pickup density as tie-breaker."""
        route = self.get_object()
        stops = list(BusStop.objects.filter(route=route, active_status=True).order_by("stop_order", "id"))
        if len(stops) < 2:
            return Response({"route_id": route.id, "optimized_stops": BusStopSerializer(stops, many=True).data})

        pickup_counts = {
            row["stop_id"]: row["count"]
            for row in (
                BusRoutePickupUpdate.objects.filter(stop__route=route)
                .values("stop_id")
                .annotate(count=Count("id"))
            )
        }

        start = min(stops, key=lambda s: s.stop_order)
        unvisited = [s for s in stops if s.id != start.id]
        ordered = [start]
        cursor = start

        while unvisited:
            unvisited.sort(
                key=lambda s: (
                    self._haversine_km(float(cursor.latitude), float(cursor.longitude), float(s.latitude), float(s.longitude)),
                    -(pickup_counts.get(s.id, 0) or 0),
                )
            )
            next_stop = unvisited.pop(0)
            ordered.append(next_stop)
            cursor = next_stop

        data = []
        for idx, stop in enumerate(ordered, start=1):
            data.append(
                {
                    "id": stop.id,
                    "stop_name": stop.stop_name,
                    "latitude": stop.latitude,
                    "longitude": stop.longitude,
                    "current_order": stop.stop_order,
                    "suggested_order": idx,
                    "pickup_weight": int(pickup_counts.get(stop.id, 0) or 0),
                }
            )

        return Response({"route_id": route.id, "optimized_stops": data})

    @action(detail=True, methods=["get"], url_path="analytics")
    def analytics(self, request, pk=None):
        route = self.get_object()
        logs_qs = RoutePerformanceLog.objects.filter(route=route).order_by("-log_date", "-id")
        vehicle_id = request.query_params.get("vehicle_id")
        if vehicle_id:
            logs_qs = logs_qs.filter(vehicle_id=vehicle_id)

        serializer = RoutePerformanceLogSerializer(logs_qs[:90], many=True)
        aggregate = logs_qs.aggregate(
            avg_delay=Avg("delay_minutes"),
            avg_speed=Avg("avg_speed_kmh"),
            avg_distance=Avg("total_distance_km"),
        )
        return Response(
            {
                "route_id": route.id,
                "route_title": route.title,
                "summary": {
                    "avg_delay_minutes": round(float(aggregate.get("avg_delay") or 0), 2),
                    "avg_speed_kmh": round(float(aggregate.get("avg_speed") or 0), 2),
                    "avg_distance_km": round(float(aggregate.get("avg_distance") or 0), 3),
                    "total_logs": logs_qs.count(),
                },
                "logs": serializer.data,
            }
        )

    def _haversine_km(self, lat1, lng1, lat2, lng2):
        radius_km = 6371
        lat_delta = math.radians(lat2 - lat1)
        lng_delta = math.radians(lng2 - lng1)
        a = (
            math.sin(lat_delta / 2) ** 2
            + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(lng_delta / 2) ** 2
        )
        return radius_km * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))


class AssignVehicleViewSet(TenantQueryMixin, PermissionScopedViewSet):
    model = AssignVehicle
    serializer_class = AssignVehicleSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": "transport.assign_vehicle.view"}

    def get_queryset(self):
        queryset = super().get_queryset()
        return queryset.select_related("vehicle", "route", "academic_year", "school")

    def perform_create(self, serializer):
        from rest_framework.exceptions import ValidationError
        
        school = self.request.user.school
        if not school:
            raise ValidationError({"school": "User does not have a school assigned."})
        
        # Try to get current academic year, fallback to latest one
        academic_year = AcademicYear.objects.filter(school=school, is_current=True).first()
        if not academic_year:
            academic_year = AcademicYear.objects.filter(school=school).order_by("-start_date").first()
        
        if not academic_year:
            raise ValidationError({"academic_year": "No academic year found for your school. Please create one first."})
        
        serializer.save(school=school, academic_year=academic_year)


# ===== BUS TRACKING MODULE VIEWSETS =====
class BusStopViewSet(TenantQueryMixin, PermissionScopedViewSet):
    model = BusStop
    serializer_class = BusStopSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": "transport.route.view"}
    
    def get_queryset(self):
        user = self.request.user
        queryset = BusStop.objects.all()
        if user.school_id:
            queryset = queryset.filter(route__school_id=user.school_id)
        else:
            return queryset.none()
        route_id = self.request.query_params.get("route_id")
        if route_id:
            queryset = queryset.filter(route_id=route_id)
        return queryset.select_related("route").order_by("stop_order")

    def create(self, request, *args, **kwargs):
        payload = request.data.copy()
        self._validate_coordinates(payload)

        route_id = payload.get("route")
        stop_order = payload.get("stop_order")
        if route_id and (stop_order is None or str(stop_order).strip() == ""):
            max_order = BusStop.objects.filter(route_id=route_id).order_by("-stop_order").values_list("stop_order", flat=True).first() or 0
            payload["stop_order"] = max_order + 1

        serializer = self.get_serializer(data=payload)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def update(self, request, *args, **kwargs):
        payload = request.data.copy()
        self._validate_coordinates(payload)
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=payload, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        route_id = instance.route_id
        response = super().destroy(request, *args, **kwargs)
        remaining_stops = BusStop.objects.filter(route_id=route_id).order_by("stop_order", "id")
        for index, stop in enumerate(remaining_stops, start=1):
            if stop.stop_order != index:
                stop.stop_order = index
                stop.save(update_fields=["stop_order"])
        return response

    @action(detail=False, methods=["put"], url_path="reorder")
    def reorder(self, request):
        items = request.data.get("stops")
        if not isinstance(items, list):
            raise ValidationError({"stops": "Expected a list of stop order updates."})

        stop_ids = [item.get("id") for item in items if item.get("id") is not None]
        requested_orders = [item.get("stop_order") for item in items]
        if len(stop_ids) != len(items):
            raise ValidationError({"stops": "Each item must include id and stop_order."})
        if any(order is None for order in requested_orders):
            raise ValidationError({"stops": "Each item must include stop_order."})

        stops = list(self.get_queryset().filter(id__in=stop_ids))
        stop_by_id = {stop.id: stop for stop in stops}
        if len(stop_by_id) != len(stop_ids):
            raise ValidationError({"stops": "One or more stops were not found."})

        route_ids = {stop.route_id for stop in stops}
        if len(route_ids) != 1:
            raise ValidationError({"stops": "Reorder supports one route at a time."})

        for item in items:
            stop = stop_by_id[item["id"]]
            stop.stop_order = int(item["stop_order"])

        BusStop.objects.bulk_update(stops, ["stop_order"])  # type: ignore[arg-type]
        ordered = BusStop.objects.filter(route_id=stops[0].route_id).order_by("stop_order", "id")
        for index, stop in enumerate(ordered, start=1):
            if stop.stop_order != index:
                stop.stop_order = index
                stop.save(update_fields=["stop_order"])

        return Response({"success": True})

    def _validate_coordinates(self, payload):
        latitude = payload.get("latitude")
        longitude = payload.get("longitude")

        if latitude is None or longitude is None:
            return

        try:
            lat_value = float(latitude)
            lng_value = float(longitude)
        except (TypeError, ValueError):
            raise ValidationError({"latitude": "Latitude/longitude must be numeric."})

        if not (-90 <= lat_value <= 90):
            raise ValidationError({"latitude": "Latitude must be between -90 and 90."})
        if not (-180 <= lng_value <= 180):
            raise ValidationError({"longitude": "Longitude must be between -180 and 180."})


class BusLocationViewSet(TenantQueryMixin, PermissionScopedViewSet):
    model = BusLocation
    serializer_class = BusLocationSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": "transport.vehicle.view"}
    
    def get_queryset(self):
        user = self.request.user
        queryset = BusLocation.objects.all()
        if user.school_id:
            queryset = queryset.filter(vehicle__school_id=user.school_id)
        else:
            return queryset.none()

        route_id = self.request.query_params.get("route_id")
        if route_id:
            queryset = queryset.filter(vehicle__assignments__route_id=route_id)

        vehicle_id = self.request.query_params.get("vehicle_id")
        if vehicle_id:
            queryset = queryset.filter(vehicle_id=vehicle_id)
        return queryset.select_related("vehicle").order_by("-timestamp").distinct()

    @action(detail=False, methods=["get"], url_path="eta")
    def eta(self, request):
        vehicle_id = request.query_params.get("vehicle_id")
        if not vehicle_id:
            return Response({"error": "vehicle_id required"}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        if not user.school_id:
            return Response({"error": "vehicle_id required"}, status=status.HTTP_400_BAD_REQUEST)

        assignment = (
            AssignVehicle.objects.filter(
                vehicle_id=vehicle_id, active_status=True, school_id=user.school_id
            )
            .select_related("route")
            .first()
        )
        if not assignment:
            return Response({"vehicle_id": int(vehicle_id), "stops": [], "next_stop": None})

        location = BusLocation.objects.filter(vehicle_id=vehicle_id).order_by("-timestamp").first()
        route_stops = list(BusStop.objects.filter(route_id=assignment.route_id, active_status=True).order_by("stop_order", "id"))
        pickup_updates = list(
            BusRoutePickupUpdate.objects.filter(vehicle_id=vehicle_id, stop__route_id=assignment.route_id)
            .select_related("stop")
            .order_by("-arrived_at")
        )

        reached_stop_ids = set()
        reached_time_by_stop = {}
        for update in pickup_updates:
            if update.status in ["arrived", "picked_up"]:
                reached_stop_ids.add(update.stop_id)
                timestamp = update.picked_up_at or update.arrived_at
                if timestamp and update.stop_id not in reached_time_by_stop:
                    reached_time_by_stop[update.stop_id] = timestamp

        next_stop = None
        for stop in route_stops:
            if stop.id not in reached_stop_ids:
                next_stop = stop
                break

        speed_kmh = 0
        current_lat = None
        current_lng = None
        if location:
            speed_kmh = max(0, int(location.speed or 0))
            current_lat = float(location.latitude)
            current_lng = float(location.longitude)

        eta_rows = []
        previous_upcoming_coords = (current_lat, current_lng)
        cumulative_eta = 0
        for stop in route_stops:
            stop_lat = float(stop.latitude)
            stop_lng = float(stop.longitude)
            if stop.id in reached_stop_ids:
                eta_rows.append(
                    {
                        "stop_id": stop.id,
                        "stop_name": stop.stop_name,
                        "stop_order": stop.stop_order,
                        "scheduled_time": stop.scheduled_time.isoformat() if stop.scheduled_time else None,
                        "status": "reached",
                        "eta_minutes": None,
                        "reached_at": reached_time_by_stop.get(stop.id).isoformat() if reached_time_by_stop.get(stop.id) else None,
                    }
                )
                continue

            status_value = "next" if next_stop and next_stop.id == stop.id else "upcoming"
            eta_minutes = None

            if previous_upcoming_coords[0] is not None and previous_upcoming_coords[1] is not None:
                leg_distance = self._haversine_km(previous_upcoming_coords[0], previous_upcoming_coords[1], stop_lat, stop_lng)
                if speed_kmh >= 5:
                    leg_eta = max(1, round((leg_distance / speed_kmh) * 60))
                    cumulative_eta += leg_eta
                    eta_minutes = cumulative_eta

            eta_rows.append(
                {
                    "stop_id": stop.id,
                    "stop_name": stop.stop_name,
                    "stop_order": stop.stop_order,
                    "scheduled_time": stop.scheduled_time.isoformat() if stop.scheduled_time else None,
                    "status": status_value,
                    "eta_minutes": eta_minutes,
                    "reached_at": None,
                }
            )

            previous_upcoming_coords = (stop_lat, stop_lng)

        return Response(
            {
                "vehicle_id": int(vehicle_id),
                "route_id": assignment.route_id,
                "next_stop":
                    {
                        "id": next_stop.id,
                        "name": next_stop.stop_name,
                        "order": next_stop.stop_order,
                    }
                    if next_stop
                    else None,
                "stops": eta_rows,
            }
        )
    
    def create(self, request, *args, **kwargs):
        """Update or create bus location and compute live route progress metadata."""
        vehicle_id = request.data.get("vehicle")
        if not vehicle_id:
            return Response({"error": "vehicle_id required"}, status=status.HTTP_400_BAD_REQUEST)

        latitude = request.data.get("latitude")
        longitude = request.data.get("longitude")
        if latitude is None or longitude is None:
            return Response({"error": "latitude and longitude required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            latitude_value = float(latitude)
            longitude_value = float(longitude)
            speed_value = int(request.data.get("speed", 0) or 0)
            heading_value = int(request.data.get("heading", 0) or 0)
            accuracy_value = int(request.data.get("accuracy", 0) or 0)
        except (TypeError, ValueError):
            return Response({"error": "Invalid numeric payload"}, status=status.HTTP_400_BAD_REQUEST)

        if not (-90 <= latitude_value <= 90):
            return Response({"error": "latitude must be between -90 and 90"}, status=status.HTTP_400_BAD_REQUEST)
        if not (-180 <= longitude_value <= 180):
            return Response({"error": "longitude must be between -180 and 180"}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        if not user.school_id:
            return Response({"error": "No school access."}, status=status.HTTP_403_FORBIDDEN)

        vehicle = Vehicle.objects.filter(id=vehicle_id, school_id=user.school_id).first()
        if not vehicle:
            return Response({"error": "vehicle not found"}, status=status.HTTP_404_NOT_FOUND)

        # Get or create - update existing location
        location, _created = BusLocation.objects.update_or_create(
            vehicle_id=vehicle_id,
            defaults={
                "latitude": latitude_value,
                "longitude": longitude_value,
                "speed": speed_value,
                "heading": heading_value,
                "accuracy": accuracy_value,
                "is_active": True,
            }
        )

        assignment = AssignVehicle.objects.filter(vehicle_id=vehicle_id, active_status=True).select_related("route").first()
        next_stop = None
        eta_minutes = None
        distance_to_next_km = None
        stop_reached_payload = None
        reached_count = 0

        if assignment:
            route_stops = list(BusStop.objects.filter(route_id=assignment.route_id, active_status=True).order_by("stop_order", "id"))
            reached_stop_ids = set(
                BusRoutePickupUpdate.objects.filter(
                    vehicle_id=vehicle_id,
                    arrived_at__date=timezone.localdate(),
                    status__in=["arrived", "picked_up"],
                ).values_list("stop_id", flat=True)
            )

            for stop in route_stops:
                if stop.id not in reached_stop_ids:
                    next_stop = stop
                    break

            if next_stop:
                distance_to_next_km = self._haversine_km(
                    latitude_value,
                    longitude_value,
                    float(next_stop.latitude),
                    float(next_stop.longitude),
                )
                if speed_value >= 5:
                    eta_minutes = max(1, round((distance_to_next_km / max(speed_value, 1)) * 60))

                geofence_m = max(1, int(next_stop.geofence_radius or 100))
                if distance_to_next_km * 1000 <= geofence_m:
                    now = timezone.now()
                    from apps.students.models import Student

                    students = Student.objects.filter(is_active=True, is_deleted=False).filter(
                        Q(vehicle_id=vehicle_id) | Q(transport_route_id=assignment.route_id)
                    )

                    for student in students:
                        pickup, _pickup_created = BusRoutePickupUpdate.objects.get_or_create(
                            stop_id=next_stop.id,
                            vehicle_id=vehicle_id,
                            student_id=student.id,
                            defaults={
                                "arrived_at": now,
                                "picked_up_at": now,
                                "status": "picked_up",
                            },
                        )
                        if pickup.status != "picked_up":
                            pickup.arrived_at = now
                            pickup.picked_up_at = now
                            pickup.status = "picked_up"
                            pickup.save(update_fields=["arrived_at", "picked_up_at", "status"])
                        reached_count += 1

                    self._auto_mark_attendance(students, now.date())

                    alert_message = f"{vehicle.vehicle_no} reached {next_stop.stop_name} - {reached_count} students marked picked up"
                    alert = TransportAlert.objects.create(
                        vehicle_id=vehicle_id,
                        route_id=assignment.route_id,
                        alert_type="arrived",
                        message=alert_message,
                        severity="info",
                        latitude=latitude_value,
                        longitude=longitude_value,
                    )

                    stop_reached_payload = {
                        "stop_id": next_stop.id,
                        "stop_name": next_stop.stop_name,
                        "students_picked": reached_count,
                        "timestamp": now.isoformat(),
                    }

                    self._notify_parents_for_stop_reach(vehicle, students, next_stop)
                    self._broadcast_alert(alert)

        vehicle.current_latitude = latitude_value
        vehicle.current_longitude = longitude_value
        vehicle.current_speed = speed_value
        vehicle.status = "at_stop" if stop_reached_payload else ("in_transit" if speed_value > 0 else "idle")
        vehicle.last_location_update = timezone.now()
        vehicle.next_stop = next_stop
        vehicle.is_tracking_active = True
        vehicle.save(
            update_fields=[
                "current_latitude",
                "current_longitude",
                "current_speed",
                "status",
                "last_location_update",
                "next_stop",
                "is_tracking_active",
            ]
        )

        if assignment:
            total_stops = BusStop.objects.filter(route_id=assignment.route_id, active_status=True).count()
            RoutePerformanceLog.objects.update_or_create(
                route_id=assignment.route_id,
                vehicle_id=vehicle_id,
                log_date=timezone.localdate(),
                defaults={
                    "avg_speed_kmh": speed_value,
                    "completed_stops": BusRoutePickupUpdate.objects.filter(
                        vehicle_id=vehicle_id,
                        stop__route_id=assignment.route_id,
                        status__in=["arrived", "picked_up"],
                    ).values("stop_id").distinct().count(),
                    "total_stops": total_stops,
                    "completed": next_stop is None and total_stops > 0,
                },
            )

        serializer = self.get_serializer(location)
        self._broadcast_location(serializer.data)
        return Response(
            {
                "location": serializer.data,
                "next_stop": {
                    "id": next_stop.id,
                    "name": next_stop.stop_name,
                    "order": next_stop.stop_order,
                }
                if next_stop
                else None,
                "eta_minutes": eta_minutes,
                "distance_to_next_km": round(distance_to_next_km, 3) if distance_to_next_km is not None else None,
                "stop_reached": stop_reached_payload,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["get"], url_path="live")
    def live(self, request):
        """Parent/operations live feed with latest status per vehicle."""
        vehicles = Vehicle.objects.all()
        if request.user.school_id:
            vehicles = vehicles.filter(school_id=request.user.school_id)
        else:
            vehicles = vehicles.none()

        payload = []
        for vehicle in vehicles.order_by("vehicle_no"):
            payload.append(
                {
                    "vehicle_id": vehicle.id,
                    "vehicle_no": vehicle.vehicle_no,
                    "latitude": float(vehicle.current_latitude) if vehicle.current_latitude is not None else None,
                    "longitude": float(vehicle.current_longitude) if vehicle.current_longitude is not None else None,
                    "speed": vehicle.current_speed,
                    "status": vehicle.status,
                    "next_stop": vehicle.next_stop.stop_name if vehicle.next_stop else None,
                    "last_location_update": vehicle.last_location_update.isoformat() if vehicle.last_location_update else None,
                }
            )
        return Response(payload)

    def _auto_mark_attendance(self, students, attendance_date):
        from apps.attendance.models import StudentAttendance

        for student in students:
            StudentAttendance.objects.get_or_create(
                school_id=student.school_id,
                academic_year_id=student.academic_year_id,
                student_id=student.id,
                attendance_date=attendance_date,
                defaults={
                    "class_id": student.current_class_id,
                    "section_id": student.current_section_id,
                    "attendance_type": "P",
                    "notes": "Auto-marked present by transport pickup.",
                },
            )

    def _notify_parents_for_stop_reach(self, vehicle, students, stop):
        message = f"{vehicle.vehicle_no} reached {stop.stop_name}."
        subject = f"Bus Update: {vehicle.vehicle_no}"

        for student in students:
            guardian = student.guardian
            if not guardian:
                continue

            phone = safe_guardian_phone(getattr(guardian, "phone", ""))
            email = (getattr(guardian, "email", "") or "").strip()

            if phone:
                sms_status, sms_provider, sms_error = send_sms_twilio(phone, message)
                TransportNotificationLog.objects.create(
                    vehicle=vehicle,
                    student=student,
                    channel="sms",
                    provider=sms_provider,
                    recipient=phone,
                    message=message,
                    status=sms_status,
                    error_message=sms_error,
                )

            if email:
                email_status, email_provider, email_error = send_email_sendgrid(email, subject, message)
                TransportNotificationLog.objects.create(
                    vehicle=vehicle,
                    student=student,
                    channel="email",
                    provider=email_provider,
                    recipient=email,
                    message=message,
                    status=email_status,
                    error_message=email_error,
                )

    def _broadcast_location(self, location_payload):
        channel_layer = get_channel_layer()
        if not channel_layer:
            return
        async_to_sync(channel_layer.group_send)(
            "bus_location_all",
            {
                "type": "bus_location_update",
                "location": location_payload,
            },
        )

    def _broadcast_alert(self, alert):
        channel_layer = get_channel_layer()
        if not channel_layer:
            return
        async_to_sync(channel_layer.group_send)(
            "bus_alerts_all",
            {
                "type": "alert_message",
                "alert": {
                    "id": alert.id,
                    "vehicle": alert.vehicle_id,
                    "vehicle_no": alert.vehicle.vehicle_no,
                    "route": alert.route_id,
                    "route_title": alert.route.title if alert.route else None,
                    "alert_type": alert.alert_type,
                    "message": alert.message,
                    "severity": alert.severity,
                    "latitude": float(alert.latitude) if alert.latitude is not None else None,
                    "longitude": float(alert.longitude) if alert.longitude is not None else None,
                    "is_resolved": alert.is_resolved,
                    "created_at": alert.created_at.isoformat(),
                    "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
                },
            },
        )

    def _haversine_km(self, lat1, lng1, lat2, lng2):
        radius_km = 6371
        lat_delta = math.radians(lat2 - lat1)
        lng_delta = math.radians(lng2 - lng1)
        a = (
            math.sin(lat_delta / 2) ** 2
            + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(lng_delta / 2) ** 2
        )
        return radius_km * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))


class TransportAlertViewSet(TenantQueryMixin, PermissionScopedViewSet):
    model = TransportAlert
    serializer_class = TransportAlertSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": "transport.vehicle.view"}
    
    def get_queryset(self):
        user = self.request.user
        queryset = TransportAlert.objects.all()
        if user.school_id:
            queryset = queryset.filter(vehicle__school_id=user.school_id)
        else:
            return queryset.none()

        vehicle_id = self.request.query_params.get("vehicle_id")
        alert_type = self.request.query_params.get("alert_type")
        is_resolved = self.request.query_params.get("is_resolved")
        
        if vehicle_id:
            queryset = queryset.filter(vehicle_id=vehicle_id)
        if alert_type:
            queryset = queryset.filter(alert_type=alert_type)
        if is_resolved is not None:
            queryset = queryset.filter(is_resolved=(is_resolved.lower() == 'true'))
        
        return queryset.select_related("vehicle", "route").order_by("-created_at")
    
    def update(self, request, *args, **kwargs):
        """Resolve alert by setting is_resolved & resolved_at"""
        instance = self.get_object()
        if request.data.get("is_resolved") and not instance.resolved_at:
            from django.utils import timezone
            instance.resolved_at = timezone.now()
        return super().update(request, *args, **kwargs)


class BusRoutePickupUpdateViewSet(TenantQueryMixin, PermissionScopedViewSet):
    model = BusRoutePickupUpdate
    serializer_class = BusRoutePickupUpdateSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": "transport.vehicle.view"}
    
    def get_queryset(self):
        user = self.request.user
        queryset = BusRoutePickupUpdate.objects.all()
        if user.school_id:
            queryset = queryset.filter(vehicle__school_id=user.school_id)
        else:
            return queryset.none()

        vehicle_id = self.request.query_params.get("vehicle_id")
        stop_id = self.request.query_params.get("stop_id")
        student_id = self.request.query_params.get("student_id")
        status_filter = self.request.query_params.get("status")
        
        if vehicle_id:
            queryset = queryset.filter(vehicle_id=vehicle_id)
        if stop_id:
            queryset = queryset.filter(stop_id=stop_id)
        if student_id:
            queryset = queryset.filter(student_id=student_id)
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        
        return queryset.select_related("stop", "vehicle", "student").order_by("-arrived_at")


class VehicleDriverAssignmentViewSet(TenantQueryMixin, PermissionScopedViewSet):
    model = VehicleDriverAssignment
    serializer_class = VehicleDriverAssignmentSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": "transport.vehicle.view"}

    def get_queryset(self):
        queryset = VehicleDriverAssignment.objects.all()
        if self.request.user.school_id:
            queryset = queryset.filter(vehicle__school_id=self.request.user.school_id)
        else:
            return queryset.none()

        vehicle_id = self.request.query_params.get("vehicle_id")
        if vehicle_id:
            queryset = queryset.filter(vehicle_id=vehicle_id)
        return queryset.select_related("vehicle", "driver").order_by("-is_primary", "-created_at")


class TransportNotificationLogViewSet(TenantQueryMixin, PermissionScopedViewSet):
    model = TransportNotificationLog
    serializer_class = TransportNotificationLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": "transport.vehicle.view"}

    def get_queryset(self):
        queryset = TransportNotificationLog.objects.all()
        if self.request.user.school_id:
            queryset = queryset.filter(vehicle__school_id=self.request.user.school_id)
        else:
            return queryset.none()

        vehicle_id = self.request.query_params.get("vehicle_id")
        channel = self.request.query_params.get("channel")
        if vehicle_id:
            queryset = queryset.filter(vehicle_id=vehicle_id)
        if channel:
            queryset = queryset.filter(channel=channel)
        return queryset.select_related("vehicle", "student").order_by("-created_at")


class RoutePerformanceLogViewSet(TenantQueryMixin, PermissionScopedViewSet):
    model = RoutePerformanceLog
    serializer_class = RoutePerformanceLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": "transport.route.view"}

    def get_queryset(self):
        queryset = RoutePerformanceLog.objects.all()
        if self.request.user.school_id:
            queryset = queryset.filter(route__school_id=self.request.user.school_id)
        else:
            return queryset.none()

        route_id = self.request.query_params.get("route_id")
        vehicle_id = self.request.query_params.get("vehicle_id")
        if route_id:
            queryset = queryset.filter(route_id=route_id)
        if vehicle_id:
            queryset = queryset.filter(vehicle_id=vehicle_id)
        return queryset.select_related("route", "vehicle").order_by("-log_date", "-id")


# ===== INVENTORY MODULE VIEWSETS =====
class ItemCategoryViewSet(TenantQueryMixin, PermissionScopedViewSet):
    model = ItemCategory
    serializer_class = ItemCategorySerializer
    pagination_class = ApiPageNumberPagination
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": "inventory.item_category.view"}

    def get_queryset(self):
        queryset = super().get_queryset()
        return queryset.order_by("title")


class ItemStoreViewSet(TenantQueryMixin, PermissionScopedViewSet):
    model = ItemStore
    serializer_class = ItemStoreSerializer
    pagination_class = ApiPageNumberPagination
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": "inventory.item_store.view"}

    def get_queryset(self):
        queryset = super().get_queryset()
        return queryset.order_by("title")


class SupplierViewSet(TenantQueryMixin, PermissionScopedViewSet):
    model = Supplier
    serializer_class = SupplierSerializer
    pagination_class = ApiPageNumberPagination
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": "inventory.supplier.view"}

    def get_queryset(self):
        queryset = super().get_queryset()
        return queryset.order_by("name")


class ItemViewSet(TenantQueryMixin, PermissionScopedViewSet):
    model = Item
    serializer_class = ItemSerializer
    pagination_class = ApiPageNumberPagination
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": "inventory.item.view"}

    def get_queryset(self):
        queryset = super().get_queryset()
        return queryset.select_related("category", "supplier").order_by("item_code")

    def perform_create(self, serializer):
        school = self.request.user.school
        if not school:
            raise PermissionDenied("School context is required.")
        serializer.save(school=school)


class ItemReceiveViewSet(TenantQueryMixin, PermissionScopedViewSet):
    model = ItemReceive
    serializer_class = ItemReceiveSerializer
    pagination_class = ApiPageNumberPagination
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": "inventory.item_receive.view"}

    def get_queryset(self):
        queryset = super().get_queryset()
        return queryset.select_related("supplier", "created_by").order_by("-receive_date")

    def perform_create(self, serializer):
        school = self.request.user.school
        if not school:
            raise PermissionDenied("School context is required.")
        serializer.save(school=school, created_by=self.request.user)


class ItemIssueViewSet(TenantQueryMixin, PermissionScopedViewSet):
    model = ItemIssue
    serializer_class = ItemIssueSerializer
    pagination_class = ApiPageNumberPagination
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": "inventory.item_issue.view"}

    def get_queryset(self):
        queryset = super().get_queryset()
        return queryset.select_related("store", "issued_by").order_by("-issue_date")

    def perform_create(self, serializer):
        school = self.request.user.school
        if not school:
            raise PermissionDenied("School context is required.")
        serializer.save(school=school, issued_by=self.request.user)


class ItemSellViewSet(TenantQueryMixin, PermissionScopedViewSet):
    model = ItemSell
    serializer_class = ItemSellSerializer
    pagination_class = ApiPageNumberPagination
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": "inventory.item_sell.view"}

    def get_queryset(self):
        queryset = super().get_queryset()
        return queryset.select_related("created_by").order_by("-sell_date")

    def perform_create(self, serializer):
        school = self.request.user.school
        if not school:
            raise PermissionDenied("School context is required.")
        serializer.save(school=school, created_by=self.request.user)


class HolidayViewSet(TenantQueryMixin, viewsets.ModelViewSet):
    model = Holiday
    serializer_class = HolidaySerializer
    permission_classes = [permissions.IsAuthenticated]

    class _Pagination(ApiPageNumberPagination):
        page_size = 15
        max_page_size = 200

    pagination_class = _Pagination

    def get_queryset(self):
        user = self.request.user
        if not user.school_id:
            return Holiday.objects.none()
        # Include school-wide holidays (school=None) alongside this school's own —
        # global rows represent a platform-wide declaration (e.g. a national holiday).
        queryset = Holiday.objects.filter(Q(school_id=user.school_id) | Q(school__isnull=True))
        academic_year = self.request.query_params.get("academic_year")
        year = self.request.query_params.get("year")
        htype = self.request.query_params.get("type")
        if academic_year:
            try:
                queryset = queryset.filter(academic_year_id=int(academic_year))
            except (TypeError, ValueError):
                pass
        if year:
            try:
                queryset = queryset.filter(date__year=int(year))
            except (TypeError, ValueError):
                pass
        if htype:
            queryset = queryset.filter(holiday_type=htype)
        return queryset.order_by("-date", "name")

    @action(detail=False, methods=["get"], url_path="sample-defaults")
    def sample_defaults(self, request):
        """Return a static list of common holidays (no DB writes) for empty-state seeding."""
        year_param = request.query_params.get("year")
        try:
            year = int(year_param) if year_param else date.today().year
        except (TypeError, ValueError):
            year = date.today().year
        samples = [
            {"name": "New Year's Day",       "month": 1,  "day": 1,  "holiday_type": "public",    "description": "Start of the calendar year"},
            {"name": "Republic Day",         "month": 1,  "day": 26, "holiday_type": "national",  "description": "National holiday"},
            {"name": "Holi",                 "month": 3,  "day": 14, "holiday_type": "religious", "description": "Festival of colours"},
            {"name": "Good Friday",          "month": 4,  "day": 18, "holiday_type": "religious", "description": ""},
            {"name": "Labour Day",           "month": 5,  "day": 1,  "holiday_type": "public",    "description": ""},
            {"name": "Independence Day",     "month": 8,  "day": 15, "holiday_type": "national",  "description": "National holiday"},
            {"name": "Gandhi Jayanti",       "month": 10, "day": 2,  "holiday_type": "national",  "description": ""},
            {"name": "Dussehra",             "month": 10, "day": 2,  "holiday_type": "religious", "description": ""},
            {"name": "Diwali",               "month": 11, "day": 1,  "holiday_type": "religious", "description": "Festival of lights"},
            {"name": "Christmas",            "month": 12, "day": 25, "holiday_type": "religious", "description": ""},
        ]
        out = []
        for item in samples:
            try:
                d = date(year, item["month"], item["day"])
            except ValueError:
                continue
            out.append({
                "name": item["name"],
                "date": d.isoformat(),
                "end_date": None,
                "holiday_type": item["holiday_type"],
                "description": item["description"],
            })
        return Response({"success": True, "year": year, "count": len(out), "results": out})

    @action(detail=False, methods=["post"], url_path="copy-from-year")
    def copy_from_year(self, request):
        """Copy holidays from a source academic year into a target academic year.

        Body: { "source_academic_year": <id>, "target_academic_year": <id>, "shift_year": true|false }
        - If shift_year is true (default), dates are shifted by (target.start_year - source.start_year) years.
        - Skips holidays that would collide with existing (date, name) entries.
        """
        if not getattr(request.user, "school", None):
            return Response(
                {"success": False, "message": "Your account is not linked to a school."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        src_id = request.data.get("source_academic_year")
        tgt_id = request.data.get("target_academic_year")
        shift_year = request.data.get("shift_year", True)
        if not src_id or not tgt_id:
            return Response(
                {"success": False, "message": "source_academic_year and target_academic_year are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            src = AcademicYear.objects.get(pk=int(src_id), school=request.user.school)
            tgt = AcademicYear.objects.get(pk=int(tgt_id), school=request.user.school)
        except (AcademicYear.DoesNotExist, ValueError, TypeError):
            return Response(
                {"success": False, "message": "Source or target academic year not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if src.id == tgt.id:
            return Response(
                {"success": False, "message": "Source and target academic year must differ."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        year_offset = 0
        if shift_year:
            try:
                year_offset = tgt.start_date.year - src.start_date.year
            except AttributeError:
                year_offset = 0

        source_holidays = Holiday.objects.filter(school=request.user.school, academic_year=src)
        created, skipped = 0, 0
        for h in source_holidays:
            try:
                new_date = h.date.replace(year=h.date.year + year_offset) if year_offset else h.date
                new_end = h.end_date.replace(year=h.end_date.year + year_offset) if (h.end_date and year_offset) else h.end_date
            except ValueError:
                # Feb 29 → Feb 28 fallback
                new_date = h.date.replace(year=h.date.year + year_offset, day=28) if year_offset else h.date
                new_end = h.end_date.replace(year=h.end_date.year + year_offset, day=28) if (h.end_date and year_offset) else h.end_date

            if Holiday.objects.filter(school=request.user.school, date=new_date, name__iexact=h.name).exists():
                skipped += 1
                continue
            try:
                Holiday.objects.create(
                    school=request.user.school,
                    academic_year=tgt,
                    name=h.name,
                    date=new_date,
                    end_date=new_end,
                    holiday_type=h.holiday_type,
                    description=h.description,
                    active_status=h.active_status,
                )
                created += 1
            except IntegrityError:
                skipped += 1

        return Response({
            "success": True,
            "message": f"Copied {created} holiday{'s' if created != 1 else ''}"
                       + (f", skipped {skipped} duplicate{'s' if skipped != 1 else ''}." if skipped else "."),
            "created": created,
            "skipped": skipped,
        })

    def _normalized_errors(self, serializer_errors):
        if isinstance(serializer_errors, dict):
            for key in ("name", "date", "end_date", "holiday_type"):
                vals = serializer_errors.get(key)
                if isinstance(vals, list) and vals:
                    return serializer_errors, str(vals[0])
            non_field = serializer_errors.get("non_field_errors")
            if isinstance(non_field, list) and non_field:
                return serializer_errors, str(non_field[0])
            cleaned = {}
            for key, value in serializer_errors.items():
                cleaned[key] = [str(item) for item in value] if isinstance(value, list) else [str(value)]
            return cleaned, "Please correct the highlighted fields."
        return {}, "Validation failed"

    def create(self, request, *args, **kwargs):
        if not getattr(request.user, "school", None):
            return Response(
                {"success": False, "message": "Your account is not linked to a school. Contact your administrator."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            errors, message = self._normalized_errors(serializer.errors)
            return Response({"success": False, "message": message, "errors": errors},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            self.perform_create(serializer)
        except IntegrityError as exc:
            msg = str(exc).lower()
            if "uq_holiday_school_date_name" in msg or ("date" in msg and "name" in msg):
                friendly = "A holiday with this name already exists on that date."
            else:
                friendly = "Could not save holiday due to a database constraint."
            return Response({"success": False, "message": friendly}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {"success": True, "message": f'Holiday "{serializer.data.get("name")}" added.', "data": serializer.data},
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        if not serializer.is_valid():
            errors, message = self._normalized_errors(serializer.errors)
            return Response({"success": False, "message": message, "errors": errors},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            self.perform_update(serializer)
        except IntegrityError as exc:
            msg = str(exc).lower()
            if "uq_holiday_school_date_name" in msg or ("date" in msg and "name" in msg):
                friendly = "A holiday with this name already exists on that date."
            else:
                friendly = "Could not update holiday due to a database constraint."
            return Response({"success": False, "message": friendly}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {"success": True, "message": "Holiday updated.", "data": serializer.data},
            status=status.HTTP_200_OK,
        )

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        name = instance.name
        self.perform_destroy(instance)
        return Response({"success": True, "message": f'Holiday "{name}" deleted.'},
                        status=status.HTTP_200_OK)


class PincodeLookupView(APIView):
    """
    GET /api/v1/core/pincode-lookup/?pincode=500081

    Proxies to the Indian Postal PIN code API and returns:
        {"city": "...", "state": "...", "country": "India"}

    Returns 404 if the pincode is not found; 400 for invalid input.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        pincode = request.query_params.get("pincode", "").strip()
        if not pincode:
            return Response(
                {"detail": "pincode query parameter is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not re.fullmatch(r"\d{5,6}", pincode):
            return Response(
                {"detail": "Invalid pincode. Must be 5 or 6 digits."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            resp = http_requests.get(
                f"https://api.postalpincode.in/pincode/{pincode}",
                timeout=8,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            )
            resp.raise_for_status()
            data = resp.json()
            if (
                data
                and isinstance(data, list)
                and len(data) > 0
                and data[0].get("Status") == "Success"
                and data[0].get("PostOffice")
                and len(data[0]["PostOffice"]) > 0
            ):
                po = data[0]["PostOffice"][0]
                return Response({
                    "city":    po.get("District", ""),
                    "state":   po.get("State", ""),
                    "country": po.get("Country", "India"),
                })
            # API returned but said Not Found or invalid structure
            return Response(
                {"detail": "Location not found for this PIN code."},
                status=status.HTTP_404_NOT_FOUND,
            )
        except http_requests.Timeout:
            return Response(
                {"detail": "PIN code lookup service is taking too long. Please try again."},
                status=status.HTTP_504_GATEWAY_TIMEOUT,
            )
        except http_requests.HTTPError as exc:
            import logging
            logging.getLogger(__name__).warning("PIN code API HTTP error: %s", exc)
            return Response(
                {"detail": "PIN code lookup service is temporarily unavailable."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except Exception as exc:
            import logging
            logging.getLogger(__name__).exception("PIN code lookup unexpected error: %s", exc)
            return Response(
                {"detail": "Unable to lookup PIN code at this time. Please enter city/state manually."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
