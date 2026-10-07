from django.db import transaction
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import PermissionDenied
from apps.library.models import LibraryActivityLog
from apps.library.serializers import LibrarySettingsSerializer
from apps.library.services.activity import log_event
from apps.library.services.settings import get_settings

VIEW_CODE = "library.settings.view"
MANAGE_CODE = "library.settings.manage"


class LibrarySettingsView(APIView):
    """GET and PUT /api/v1/library/settings/ for the caller's own school.

    The row is created on first read. Counters (po_sequence and
    donation_receipt_sequence) are read-only. PUT accepts any subset of the
    editable fields.
    """

    permission_classes = [IsAuthenticated]

    def _require(self, request, code):
        if not request.user.has_permission_code(code):
            raise PermissionDenied("You do not have permission to perform this action.")
        if request.user.school is None:
            raise PermissionDenied("School context is required.")
        return request.user.school

    def get(self, request):
        school = self._require(request, VIEW_CODE)
        data = LibrarySettingsSerializer(get_settings(school), context={"request": request}).data
        return Response({"success": True, "message": "Data retrieved successfully", "data": data})

    @transaction.atomic
    def put(self, request):
        school = self._require(request, MANAGE_CODE)
        instance = get_settings(school)
        serializer = LibrarySettingsSerializer(instance, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        changed = sorted(
            name for name, value in serializer.validated_data.items() if getattr(instance, name) != value
        )
        serializer.save(updated_by=request.user)
        if changed:
            log_event(
                school,
                request.user,
                LibraryActivityLog.EVENT_SETTINGS,
                "Library settings updated",
                metadata={"fields": changed},
            )
        return Response(
            {"success": True, "message": "Resource updated successfully", "data": serializer.data},
            status=status.HTTP_200_OK,
        )
