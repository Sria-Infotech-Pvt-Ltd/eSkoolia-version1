from django.db.models import Exists, OuterRef, Q
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.access_control.models import UserRole
from apps.core.exceptions import PermissionDenied
from apps.hr.models import Staff
from apps.library.exceptions import LibraryHasHistory
from apps.library.models import Book, Charge, LibraryMember
from apps.library.serializers import (
    ChargeSerializer,
    MemberCreateSerializer,
    MemberDetailSerializer,
    MemberEligibleSerializer,
    MemberListSerializer,
    MemberUpdateSerializer,
    WaiveChargeSerializer,
)
from apps.library.serializers.circulation import dues_payload
from apps.library.services import charges as charges_service
from apps.library.services import members as members_service
from apps.library.services.settings import get_settings
from apps.students.models import Student

from .base import LibraryViewSet

CANDIDATE_LIMIT = 20


class LibraryMemberViewSet(LibraryViewSet):
    model = LibraryMember
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    select_related_fields = ("student__current_class", "student__current_section", "staff", "created_by", "updated_by")
    filterset_fields = ["member_type", "is_active"]
    search_fields = ["card_no", "student__first_name", "student__last_name", "staff__first_name", "staff__last_name"]
    ordering_fields = ["created_at", "card_no"]
    default_ordering = ["-created_at"]
    permission_codes = {
        "list": "library.library_members.view",
        "retrieve": "library.library_members.view",
        "dues": "library.library_members.view",
        "create": "library.library_members.create",
        "candidates": "library.library_members.create",
        "update": "library.library_members.update",
        "destroy": "library.library_members.delete",
        "eligible": "library.book_issues.view",
    }

    # -- queryset, serializers, context ----------------------------------------

    def annotate_queryset(self, queryset):
        return members_service.annotate_member_dues(queryset)

    def get_serializer_class(self):
        return {
            "retrieve": MemberDetailSerializer,
            "create": MemberCreateSerializer,
            "update": MemberUpdateSerializer,
            "partial_update": MemberUpdateSerializer,
            "eligible": MemberEligibleSerializer,
        }.get(self.action, MemberListSerializer)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        user = getattr(self.request, "user", None)
        if user is not None and user.is_authenticated and user.school_id:
            if not hasattr(self, "_settings"):
                self._settings = get_settings(user.school)
            context["settings"] = self._settings
        return context

    def page_context(self, rows):
        ids = [m.pk for m in rows]
        context = {"accrued": members_service.accrued_fines_by_member(self.request.user.school, self._school_settings(), ids)}
        if self.action == "eligible":
            book = getattr(self, "_book", None)
            context["book"] = book
            context["holding"] = members_service.holding_member_ids(book, ids) if book else set()
        return context

    def _school_settings(self):
        if not hasattr(self, "_settings"):
            self._settings = get_settings(self.request.user.school)
        return self._settings

    def _detail(self, pk, message, status_code=status.HTTP_200_OK):
        member = self.get_queryset().get(pk=pk)
        context = {**self.get_serializer_context(), **self.page_context([member])}
        data = MemberDetailSerializer(member, context=context).data
        return Response({"success": True, "message": message, "data": data}, status=status_code)

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        params = self.request.query_params
        if params.get("school_class"):
            queryset = queryset.filter(student__current_class_id=self._int("school_class"))
        if params.get("section"):
            queryset = queryset.filter(student__current_section_id=self._int("section"))
        if params.get("registration"):
            if params["registration"] not in ("paid", "unpaid", "waived"):
                raise ValidationError({"registration": "Use paid, unpaid or waived."})
            queryset = queryset.filter(registration_state=params["registration"])
        if params.get("standing"):
            if params["standing"] not in ("active", "suspended"):
                raise ValidationError({"standing": "Use active or suspended."})
            blocked = members_service.suspended_member_ids(self.request.user.school, self._school_settings())
            queryset = queryset.filter(pk__in=blocked) if params["standing"] == "suspended" else queryset.exclude(pk__in=blocked)
        return queryset

    def _int(self, name):
        try:
            return int(self.request.query_params[name])
        except ValueError:
            raise ValidationError({name: "Enter a whole number."})

    # -- writes -------------------------------------------------------------------

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if data.get("collect_fee_now") and not request.user.has_permission_code("library.charges.collect"):
            raise PermissionDenied("Collecting the registration fee needs the charges collect permission.")
        member, _charge = members_service.register_member(
            self.get_school_or_deny(),
            request.user,
            student=data.get("student"),
            staff=data.get("staff"),
            member_type=data.get("member_type"),
            card_no=data.get("card_no", ""),
            fee=data.get("registration_fee_amount"),
            collect_now=data.get("collect_fee_now", False),
        )
        return self._detail(member.pk, "Resource created successfully", status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        for name, value in serializer.validated_data.items():
            setattr(instance, name, value)
        instance.updated_by = request.user
        instance.save()
        return self._detail(instance.pk, "Resource updated successfully")

    def perform_destroy(self, instance):
        if instance.book_issues.exists() or instance.charges.exists():
            raise LibraryHasHistory("This member has loans or charges. Make the member inactive instead of deleting.")
        instance.delete()

    # -- reads ----------------------------------------------------------------------

    def retrieve(self, request, *args, **kwargs):
        return self._detail(self.get_object().pk, "Resource retrieved successfully")

    @action(detail=True, methods=["get"], url_path="dues")
    def dues(self, request, pk=None):
        member = self.get_object()
        accrued = self.page_context([member])["accrued"].get(member.pk)
        data = dues_payload(members_service.member_dues(member, accrued), accrued)
        data["pending_charges"] = [
            {"id": c.pk, "charge_type": c.charge_type, "amount": str(c.amount)}
            for c in Charge.objects.filter(member=member, status=Charge.STATUS_PENDING).order_by("id")
        ]
        return Response({"success": True, "message": "Data retrieved successfully", "data": data})

    @action(detail=False, methods=["get"], url_path="candidates")
    def candidates(self, request):
        """Students or staff who are not members yet, in this school only, with the fields needed to register them."""
        kind = request.query_params.get("type", "")
        if kind not in ("student", "teacher", "staff"):
            raise ValidationError({"type": "Use student, teacher or staff."})
        try:
            limit = max(1, min(int(request.query_params.get("limit", CANDIDATE_LIMIT)), CANDIDATE_LIMIT))
        except ValueError:
            raise ValidationError({"limit": "Enter a whole number."})
        query = (request.query_params.get("q") or "").strip()
        school = self.get_school_or_deny()
        settings = get_settings(school)
        rows = []
        if kind == "student":
            students = (
                Student.objects.filter(school=school, status="active")
                .exclude(library_memberships__isnull=False)
                .select_related("current_class", "current_section")
            )
            if query:
                students = students.filter(Q(first_name__icontains=query) | Q(last_name__icontains=query) | Q(admission_no__icontains=query))
            for student in students.order_by("first_name", "last_name", "id")[:limit]:
                rows.append(
                    {
                        "id": student.pk,
                        "member_type": "student",
                        "name": " ".join(p for p in (student.first_name, student.last_name) if p),
                        "identifier": student.admission_no,
                        "school_class": student.current_class.name if student.current_class_id else "",
                        "section": student.current_section.name if student.current_section_id else "",
                        "suggested_fee": str(members_service.default_registration_fee(settings, "student", student)),
                    }
                )
        else:
            is_teacher = Exists(UserRole.objects.filter(user=OuterRef("user"), role__is_active=True, role__portal_type="teacher"))
            staff = Staff.objects.filter(school=school, status=Staff.STATUS_ACTIVE).exclude(library_memberships__isnull=False).annotate(is_teacher=is_teacher)
            staff = staff.filter(is_teacher=(kind == "teacher"))
            if query:
                staff = staff.filter(Q(first_name__icontains=query) | Q(last_name__icontains=query) | Q(staff_no__icontains=query))
            for person in staff.order_by("first_name", "last_name", "id")[:limit]:
                rows.append(
                    {
                        "id": person.pk,
                        "member_type": kind,
                        "name": " ".join(p for p in (person.first_name, person.last_name) if p),
                        "identifier": person.staff_no,
                        "school_class": "",
                        "section": "",
                        "suggested_fee": "0.00",
                    }
                )
        return Response({"success": True, "message": "Data retrieved successfully", "count": len(rows),
                         "next": None, "previous": None, "results": rows, "data": rows})

    @action(detail=False, methods=["get"], url_path="eligible")
    def eligible(self, request):
        """Issue-desk roster: active members of a class or type, each with `eligible` and a reason code."""
        params = request.query_params
        if not params.get("school_class") and not params.get("member_type"):
            raise ValidationError({"school_class": "Give school_class or member_type."})
        queryset = self.get_queryset().filter(is_active=True)
        if params.get("school_class"):
            queryset = queryset.filter(student__current_class_id=self._int("school_class"))
        if params.get("member_type"):
            if params["member_type"] not in dict(LibraryMember.MEMBER_CHOICES):
                raise ValidationError({"member_type": "Unknown member type."})
            queryset = queryset.filter(member_type=params["member_type"])
        self._book = None
        if params.get("book"):
            self._book = Book.objects.filter(school=request.user.school, pk=self._int("book")).first()
            if self._book is None:
                raise ValidationError({"book": "Invalid book."})
        return self.list_response(queryset.order_by("student__current_section_id", "student__first_name", "staff__first_name", "id"))


class ChargeViewSet(LibraryViewSet):
    """The library ledger. Rows are created by registration and circulation, never directly."""

    model = Charge
    serializer_class = ChargeSerializer
    http_method_names = ["get", "post", "head", "options"]
    disabled_actions = ("create", "update", "destroy")
    select_related_fields = ("member__student", "member__staff", "issue__book", "resolved_by")
    filterset_fields = ["member", "charge_type", "status"]
    search_fields = ["receipt_no", "member__card_no", "member__student__first_name", "member__student__last_name",
                     "member__staff__first_name", "member__staff__last_name"]
    ordering_fields = ["assessed_on", "amount", "created_at"]
    default_ordering = ["-assessed_on", "-id"]
    permission_codes = {
        "list": "library.charges.view",
        "retrieve": "library.charges.view",
        "collect": "library.charges.collect",
        "waive": "library.charges.waive",
    }

    def _row(self, pk, message):
        charge = self.get_queryset().get(pk=pk)
        return Response({"success": True, "message": message, "data": ChargeSerializer(charge).data})

    @action(detail=True, methods=["post"], url_path="collect")
    def collect(self, request, pk=None):
        charge = self.get_object()
        charges_service.collect_charge(
            self.get_school_or_deny(), request.user, charge.pk, str(request.data.get("receipt_no", ""))[:40]
        )
        return self._row(charge.pk, "Charge collected")

    @action(detail=True, methods=["post"], url_path="waive")
    def waive(self, request, pk=None):
        charge = self.get_object()
        serializer = WaiveChargeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        charges_service.waive_charge(self.get_school_or_deny(), request.user, charge.pk, serializer.validated_data["reason"])
        return self._row(charge.pk, "Charge waived")
