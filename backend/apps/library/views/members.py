from apps.library.models import LibraryMember
from apps.library.serializers import LibraryMemberSerializer

from .base import LibraryViewSet


class LibraryMemberViewSet(LibraryViewSet):
    model = LibraryMember
    serializer_class = LibraryMemberSerializer
    select_related_fields = ("student", "staff", "created_by", "updated_by")
    filterset_fields = ["member_type", "is_active"]
    search_fields = ["card_no", "student__first_name", "student__last_name", "staff__first_name", "staff__last_name"]
    ordering_fields = ["created_at", "card_no"]
    default_ordering = ["-created_at"]
    permission_codes = {
        "list": "library.library_members.view",
        "retrieve": "library.library_members.view",
        "create": "library.library_members.create",
        "update": "library.library_members.update",
        "destroy": "library.library_members.delete",
    }
