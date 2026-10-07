from rest_framework import status
from rest_framework.response import Response

from apps.core.exceptions import PermissionDenied
from apps.core.viewsets import PaginatedModelViewSet


class LibraryViewSet(PaginatedModelViewSet):
    """Base for every library CRUD resource (blueprint 3.1).

    Composes PaginatedModelViewSet (school scoping through ``scope_to_school``,
    search, ordering) with a per-action permission-code check. There is no
    ``is_superuser`` branch: ``User.has_permission_code`` already grants
    superusers and school admins, and data scoping never widens.

    Subclasses set ``model``, ``serializer_class`` and ``permission_codes``,
    keyed by DRF action name (``list``, ``retrieve``, ``create``, ``update``,
    ``destroy``, or a custom ``@action`` name). ``partial_update`` falls back to
    ``update`` and ``summary`` to ``list``. ``"*"`` is an optional default. An
    action with no code is refused: the check fails closed.

    Differences from PaginatedModelViewSet, which this class overrides on
    purpose:

    * Its CRUD methods wrap everything in ``except Exception`` and answer 400
      ``retrieve_error`` and so on, which turns a cross-school 404 into a 400
      and hides 403s and library error codes. Here exceptions reach the central
      handler (config/exception_handler.py), so 404, 400 ``validation_error``
      with ``field_errors``, and the library 409 codes keep their shape.
    * Its ``filter_queryset`` re-applies every ``filterset_fields`` value with a
      raw ``.filter(field=value)``. That rejects ``?is_active=true``, which the
      library pages send. DjangoFilterBackend already handles it.
    * ``school``, ``created_by`` and ``updated_by`` are set here and never
      read from the payload.

    Success envelope: ``{success, message, data}``. Lists also carry ``count``,
    ``next``, ``previous`` and ``results`` at the top level, as before.
    """

    permission_codes = {}
    select_related_fields = ()
    action_aliases = {"partial_update": "update", "summary": "list"}

    # -- permissions ------------------------------------------------------

    def get_required_permission_code(self):
        action = getattr(self, "action", None)
        codes = self.permission_codes
        if action in codes:
            return codes[action]
        alias = self.action_aliases.get(action)
        if alias in codes:
            return codes[alias]
        return codes.get("*")

    def check_permissions(self, request):
        super().check_permissions(request)
        if request.method.lower() not in self.http_method_names:
            return  # dispatch() answers 405 and runs no handler, so there is nothing to guard
        code = self.get_required_permission_code()
        if not code or not request.user.has_permission_code(code):
            raise PermissionDenied("You do not have permission to perform this action.")

    # -- queryset ---------------------------------------------------------

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.select_related_fields:
            queryset = queryset.select_related(*self.select_related_fields)
        return queryset

    def filter_queryset(self, queryset):
        # Skip PaginatedModelViewSet.filter_queryset (see class docstring).
        return super(PaginatedModelViewSet, self).filter_queryset(queryset)

    # -- writes -----------------------------------------------------------

    def get_school_or_deny(self):
        school = self.request.user.school
        if school is None:
            raise PermissionDenied("School context is required.")
        return school

    def perform_create(self, serializer):
        user = self.request.user
        serializer.save(school=self.get_school_or_deny(), created_by=user, updated_by=user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    # -- envelope ---------------------------------------------------------

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(
            {"success": True, "message": "Resource created successfully", "data": serializer.data},
            status=status.HTTP_201_CREATED,
        )

    def list(self, request, *args, **kwargs):
        return self.list_response(self.filter_queryset(self.get_queryset()))

    def list_response(self, queryset):
        """Paginate ``queryset`` and wrap it in the list envelope (also used by list-style actions)."""
        page = self.paginate_queryset(queryset)
        if page is not None:
            payload = dict(self.get_paginated_response(self.get_serializer(page, many=True).data).data)
            rows = payload["results"]
        else:
            rows = self.get_serializer(queryset, many=True).data
            payload = {"count": len(rows), "next": None, "previous": None, "results": rows}
        payload.update({"success": True, "message": "Data retrieved successfully", "data": rows})
        return Response(payload, status=status.HTTP_200_OK)

    def retrieve(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_object())
        return Response(
            {"success": True, "message": "Resource retrieved successfully", "data": serializer.data},
            status=status.HTTP_200_OK,
        )

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        # Drop the prefetch cache so the response reflects the write.
        if getattr(instance, "_prefetched_objects_cache", None):
            instance._prefetched_objects_cache = {}
        return Response(
            {"success": True, "message": "Resource updated successfully", "data": serializer.data},
            status=status.HTTP_200_OK,
        )

    def destroy(self, request, *args, **kwargs):
        self.perform_destroy(self.get_object())
        return Response(status=status.HTTP_204_NO_CONTENT)

