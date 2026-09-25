import uuid

from rest_framework import permissions, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import School, SchoolTenant
from .provisioning import sanitize_subdomain
from .serializers import SchoolSerializer


class SchoolViewSet(viewsets.ModelViewSet):
    serializer_class = SchoolSerializer
    permission_classes = [permissions.IsAuthenticated]

    def _require_admin(self):
        user = self.request.user
        if not (user.is_superuser or getattr(user, "is_school_admin", False)):
            raise PermissionDenied("You do not have permission to manage schools.")

    def get_queryset(self):
        self._require_admin()
        user = self.request.user
        queryset = School.objects.all().order_by("name")
        if user.is_superuser:
            return queryset
        if user.school_id:
            return queryset.filter(id=user.school_id)
        return queryset.none()

    def perform_create(self, serializer):
        user = self.request.user
        if not user.is_superuser:
            raise PermissionDenied("Only superusers can add schools.")
        school = serializer.save()
        self._ensure_school_tenant(school)

    def _ensure_school_tenant(self, school):
        """Every school added here needs a SchoolTenant row — Settings > School
        Info (apps.settings.views.SchoolInfoView.get_object) hard-fails with "No
        tenant record exists for this school yet" otherwise, and there was no
        code path creating one for a school added through this endpoint (the
        only other place SchoolTenant rows get created is provisioning.py's
        provision_tenant(), which is gated behind MULTI_TENANCY_ENABLED and
        raises immediately since that flag is unset in this deployment — see
        CLAUDE.md's tenancy policy). This mirrors none of that heavier
        schema-provisioning logic (intentionally inactive); it just creates the
        lightweight metadata row School Info actually reads and writes.
        """
        if getattr(school, "tenant_record", None):
            return
        base = sanitize_subdomain(school.subdomain or school.code or f"school{school.id}")
        schema_name = base
        suffix = 1
        while SchoolTenant.objects.filter(schema_name=schema_name).exists():
            suffix += 1
            schema_name = f"{base[:58]}_{suffix}"
        SchoolTenant.objects.create(
            tenant_id=f"TNT{uuid.uuid4().hex[:12].upper()}",
            schema_name=schema_name,
            school=school,
            name=school.name,
            status="active",
        )

    def perform_destroy(self, instance):
        user = self.request.user
        if not user.is_superuser:
            raise PermissionDenied("Only superusers can delete schools.")
        super().perform_destroy(instance)


@api_view(["GET"])
@permission_classes([AllowAny])
def school_info_view(request):
    """Public endpoint — returns school branding info for the login page.

    Called by the frontend BEFORE the user logs in so the login page can
    display the correct school name, logo, and brand colour.

    Query params:
        subdomain (required) — e.g. ?subdomain=springdale
    """
    subdomain = request.query_params.get("subdomain", "").strip().lower()
    if not subdomain:
        return Response({"error": "subdomain query parameter is required"}, status=400)

    try:
        from apps.tenancy.models import Domain
        
        # First try exact match (subdomain stored as-is)
        domain = Domain.objects.select_related("tenant").filter(domain=subdomain).first()
        # Fall back to prefix match for full FQDNs like "testschool.eskoolia.local"
        if domain is None:
            domain = Domain.objects.select_related("tenant").filter(
                domain__startswith=f"{subdomain}."
            ).first()
        if domain is None:
            return Response({"error": "School not found"}, status=404)
        tenant = domain.tenant
        return Response({
            "name": tenant.name,
            "subdomain": tenant.subdomain_url,
            "logo_url": tenant.logo_url or None,
            "brand_color": tenant.brand_color or "#0d9488",
            "status": tenant.status,
        })
    except Exception:
        return Response({"error": "School not found"}, status=404)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_school_info_view(request):
    """Authenticated endpoint — returns the current user's school details for receipts and documents."""
    school_id = getattr(request.user, "school_id", None)
    if not school_id:
        return Response({"error": "No school associated with this account"}, status=404)
    try:
        school = School.objects.get(id=school_id)
        # Address/contact fields live on SchoolTenant, not School. Prefer the
        # explicit FK (school.tenant_record) added in migration
        # 0019_schooltenant_school; fall back to the legacy subdomain match
        # only for tenants provisioned before that migration and never
        # backfilled (see backfill_schooltenant_school_links command).
        tenant = getattr(school, "tenant_record", None)
        if tenant is None and school.subdomain:
            try:
                from apps.tenancy.models import SchoolTenant
                tenant = SchoolTenant.objects.filter(subdomain_url__iexact=school.subdomain).first()
            except Exception:
                pass
        address_parts = []
        campus_address = getattr(tenant, "campus_address", None) or ""
        city = getattr(tenant, "city", None) or ""
        pin_code = getattr(tenant, "pin_code", None) or ""
        if campus_address:
            address_parts.append(campus_address.strip())
        if city:
            address_parts.append(city)
        if pin_code:
            address_parts.append(pin_code)
        return Response({
            "name": school.name,
            "address": ", ".join(address_parts),
            "email": getattr(tenant, "principal_email", None) or "",
            "phone": getattr(tenant, "principal_phone", None) or "",
            "logo_url": getattr(tenant, "logo_url", None) or "",
        })
    except School.DoesNotExist:
        return Response({"error": "School not found"}, status=404)


@api_view(["GET"])
@permission_classes([AllowAny])
def whoami_view(request):
    """Public diagnostic — reflects how TenantMainMiddleware resolved *this*
    request (driven purely by the Host header it received). No auth needed,
    since the point is to check routing before a session exists - e.g.
    confirming a given subdomain reaches the right tenant end-to-end through
    Nginx and the frontend's server-side proxying."""
    tenant = getattr(request, "tenant", None)
    return Response({
        "host": request.get_host(),
        "resolved_tenant": tenant.name if tenant else None,
        "schema_name": getattr(request, "schema_name", None),
    })
