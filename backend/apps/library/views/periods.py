"""Periods, visits and occupancy (blueprint 2.4)."""
from datetime import date

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as FieldValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import PermissionDenied, ResourceNotFound
from apps.library.exceptions import LibraryHasHistory
from apps.library.models import LibraryMember, PeriodSlot
from apps.library.serializers.periods import CheckInSerializer, PeriodSlotSerializer
from apps.library.services import periods as service
from apps.library.services.members import person_name

from .base import LibraryViewSet

VIEW_CODE = "library.periods.view"


class PeriodSlotViewSet(LibraryViewSet):
    model = PeriodSlot
    serializer_class = PeriodSlotSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    select_related_fields = ("school_class", "section", "period", "supervisor")
    filterset_fields = ["school_class", "section", "day", "is_active"]
    ordering_fields = ["day", "period__start_time"]
    default_ordering = ["day", "period__start_time", "id"]
    permission_codes = {
        "list": VIEW_CODE,
        "retrieve": VIEW_CODE,
        "week": VIEW_CODE,
        "current": VIEW_CODE,
        "prep_briefing": VIEW_CODE,
        "create": "library.periods.manage",
        "update": "library.periods.manage",
        "destroy": "library.periods.manage",
    }

    def _row(self, pk, message, status_code=status.HTTP_200_OK):
        data = self.get_serializer(self.get_queryset().get(pk=pk)).data
        return Response({"success": True, "message": message, "data": data}, status=status_code)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        slot = serializer.save(school=self.get_school_or_deny(), created_by=request.user, updated_by=request.user)
        return self._row(slot.pk, "Resource created successfully", status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        if instance.visits.exists():
            raise LibraryHasHistory("This period has check-ins. Switch it off instead of deleting it.")
        instance.delete()

    @action(detail=False, methods=["get"], url_path="week")
    def week(self, request):
        return Response({"success": True, "message": "Data retrieved successfully", "data": service.week_grid(self.get_school_or_deny())})

    @action(detail=False, methods=["get"], url_path="current")
    def current(self, request):
        school = self.get_school_or_deny()
        now = service.local_now()
        slots = service.live_slots(school, now)
        data = service.occupancy(school, slots, now.date())
        return Response({"success": True, "message": "Data retrieved successfully", "data": data})

    @action(detail=False, methods=["get"], url_path="prep-briefing")
    def prep_briefing(self, request):
        return Response({"success": True, "message": "Data retrieved successfully", "data": service.prep_briefing(self.get_school_or_deny())})


class _PermissionView(APIView):
    permission_classes = [IsAuthenticated]

    def _school(self, request, code):
        if not request.user.has_permission_code(code):
            raise PermissionDenied("You do not have permission to perform this action.")
        if request.user.school is None:
            raise PermissionDenied("School context is required.")
        return request.user.school


def _parse_date(raw, name):
    try:
        return date.fromisoformat(raw)
    except (TypeError, ValueError):
        raise FieldValidationError({name: "Use a date like 2026-01-31."})


class CheckInView(_PermissionView):
    """POST visits/check-in/: by card number (or member id). Repeating it for the same slot and day changes nothing."""

    def post(self, request):
        school = self._school(request, "library.visits.check_in")
        serializer = CheckInSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        members = LibraryMember.objects.filter(school=school).select_related("student", "staff")
        if data.get("card_no"):
            member = members.filter(card_no=data["card_no"].strip()).first()
            if member is None:
                raise ResourceNotFound("No member has that card number.")
        else:
            member = members.filter(pk=data["member"]).first()
            if member is None:
                raise FieldValidationError({"member": "Invalid member."})
        slot = None
        if data.get("period_slot"):
            slot = service.base_slots(school).filter(pk=data["period_slot"]).first()
            if slot is None:
                raise FieldValidationError({"period_slot": "Invalid library period."})

        visit, created, row = service.check_in(school, request.user, member=member, slot=slot, method=data["method"])
        payload = {
            "created": created,
            "visit": {
                "id": visit.pk,
                "member": member.pk,
                "member_name": person_name(member),
                "card_no": member.card_no,
                "period_slot": visit.period_slot_id,
                "checked_in_at": visit.checked_in_at.isoformat(),
                "method": visit.method,
            },
            "slot": row,
            "checked_in": row["checked_in"],
            "scheduled": row["scheduled"],
        }
        return Response(
            {"success": True, "message": "Checked in" if created else "Already checked in", "data": payload},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class OccupancyView(_PermissionView):
    """GET visits/occupancy/?period_slot=<id>: checked in versus scheduled. Default: every running period."""

    def get(self, request):
        school = self._school(request, VIEW_CODE)
        now = service.local_now()
        raw = request.query_params.get("period_slot")
        if raw:
            try:
                slot = service.base_slots(school).filter(pk=int(raw)).first()
            except ValueError:
                slot = None
            if slot is None:
                raise ResourceNotFound("Library period not found.")
            slots = [slot]
        else:
            slots = service.live_slots(school, now)
        return Response({"success": True, "message": "Data retrieved successfully", "data": service.occupancy(school, slots, now.date())})


class FootfallView(_PermissionView):
    """GET visits/footfall/?from=&to=: visits per class. Default: this week up to today."""

    def get(self, request):
        school = self._school(request, VIEW_CODE)
        today = service.local_now().date()
        start = _parse_date(request.query_params["from"], "from") if request.query_params.get("from") else service.default_week_start(today)
        end = _parse_date(request.query_params["to"], "to") if request.query_params.get("to") else today
        if end < start:
            raise FieldValidationError({"to": "The end date is before the start date."})
        return Response({"success": True, "message": "Data retrieved successfully", "data": service.footfall(school, start, end)})
