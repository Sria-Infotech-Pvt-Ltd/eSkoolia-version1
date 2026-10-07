from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.library.models import Hold
from apps.library.serializers.loans import HoldCreateSerializer, HoldSerializer
from apps.library.services import circulation

from .base import LibraryViewSet


class HoldViewSet(LibraryViewSet):
    """The reservation queue, first come first served. Created through place_hold, ended through cancel."""

    model = Hold
    serializer_class = HoldSerializer
    http_method_names = ["get", "post", "head", "options"]
    disabled_actions = ("update", "destroy")
    select_related_fields = ("book", "member__student", "member__staff")
    filterset_fields = ["book", "member", "status"]
    search_fields = ["book__title", "member__card_no"]
    ordering_fields = ["created_at"]
    default_ordering = ["created_at", "id"]
    permission_codes = {
        "list": "library.holds.view",
        "retrieve": "library.holds.view",
        "create": "library.holds.create",
        "cancel": "library.holds.cancel",
    }

    def _row(self, pk):
        return HoldSerializer(self.get_queryset().get(pk=pk)).data

    def create(self, request, *args, **kwargs):
        serializer = HoldCreateSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        hold = circulation.place_hold(
            self.get_school_or_deny(), request.user,
            book_id=serializer.validated_data["book"].pk, member_id=serializer.validated_data["member"].pk,
        )
        return Response({"success": True, "message": "Hold placed", "data": self._row(hold.pk)}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        hold = self.get_object()
        circulation.cancel_hold(self.get_school_or_deny(), request.user, hold.pk)
        return Response({"success": True, "message": "Hold cancelled", "data": self._row(hold.pk)})
