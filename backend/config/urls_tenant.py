"""Tenant URL routes — served from a specific school's schema.

These routes handle all school-scoped data (students, academics, fees, etc.).
Each request that hits these routes already has the Postgres search_path
set to the school's schema by TenantMainMiddleware.

Active when MULTI_TENANCY_ENABLED=True and django-tenants routes
tenant-schema requests here. When the flag is off, config/urls.py
serves as the unified fallback.
"""
from django.urls import include, path

urlpatterns = [
    # Auth (school users need login/me within their tenant context)
    path("api/v1/auth/", include("apps.users.urls")),
    # Core school data
    path("api/v1/access-control/", include("apps.access_control.urls")),
    path("api/v1/admissions/", include("apps.admissions.urls")),
    path("api/v1/core/", include("apps.core.urls")),
    # Transport endpoints moved to apps.transport; same /api/v1/core/ prefix keeps existing URLs working.
    path("api/v1/core/", include("apps.transport.urls")),
    path("api/v1/students/", include("apps.students.urls")),
    path("api/v1/academics/", include("apps.academics.urls")),
    path("api/v1/attendance/", include("apps.attendance.urls")),
    path("api/v1/fees/", include("apps.fees.urls")),
    path("api/v1/exams/", include("apps.exams.urls")),
    path("api/v1/finance/", include("apps.finance.urls")),
    path("api/v1/hr/", include("apps.hr.urls")),
    path("api/master/", include("apps.master.urls")),
    path("api/v1/library/", include("apps.library.urls")),
    path("api/v1/behaviour/", include("apps.behaviour.urls")),
    path("api/v1/reports/", include("apps.reports.urls")),
    path("api/chat/", include("apps.chat.urls")),
    path("api/v1/utilities/communication/", include("apps.communication.urls")),
    path("api/v1/competitions/", include("apps.competitions.urls")),
    path("api/v1/student/", include("apps.student_portal.urls")),
    # Legacy compatibility
    path("admissions/", include("apps.admissions.urls")),
]
