"""
Parent Portal: Library (decision D15, blueprint 2.4 and 3.4). Read only.

Plain JSON, no permission codes. Like every sibling parent view these are `APIView`s with JWTAuthentication
and IsParentPortalUser, and the child always comes from `?child_id=` resolved by `_resolve_child`:
no child_id is a 400, and a child that is not this guardian's, is inactive, or does not exist is a 404.
Nothing else in the request names a student, a member or a school.
"""
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.library.services import parent

from .permissions import IsParentPortalUser
from .views import _resolve_child


class _HistoryPagination(PageNumberPagination):
    """Fixed page size of 20: the client cannot ask for more."""

    page_size = parent.HISTORY_PAGE_SIZE
    page_size_query_param = None


class ParentLibraryCurrentView(APIView):
    """GET /api/v1/parent/library/current/?child_id=<id>"""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsParentPortalUser]

    def get(self, request):
        student = _resolve_child(request)
        return Response(parent.current_summary(student))


class ParentLibraryHistoryView(APIView):
    """GET /api/v1/parent/library/history/?child_id=<id>&page=<n>: closed loans, newest first, 20 a page."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsParentPortalUser]

    def get(self, request):
        student = _resolve_child(request)
        paginator = _HistoryPagination()
        page = paginator.paginate_queryset(parent.history_queryset(student), request, view=self)
        body = paginator.get_paginated_response([parent.history_row(loan) for loan in page]).data
        return Response(body)
