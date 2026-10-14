from django.contrib import admin
from django.urls import include, path, re_path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from apps.core.media_views import serve_media
from apps.dashboard.views import AIBriefView, AttentionCountView
from apps.users.views import HealthView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", HealthView.as_view(), name="health-check"),
    # Legacy compatibility endpoints expected by older UAT documents.
    path("admissions/", include("apps.admissions.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/v1/dashboard/", include("apps.dashboard.urls")),
    path("api/v1/auth/", include("apps.users.urls")),
    path("api/v1/access-control/", include("apps.access_control.urls")),
    path("api/v1/admissions/", include("apps.admissions.urls")),
    path("api/v1/core/", include("apps.core.urls")),
    # Transport endpoints moved to apps.transport; same /api/v1/core/ prefix keeps existing URLs working.
    path("api/v1/core/", include("apps.transport.urls")),
    path("api/v1/students/", include("apps.students.urls")),
    path("api/v1/academics/", include("apps.academics.urls")),
    path("api/v1/attendance/", include("apps.attendance.urls")),
    path("api/v1/fees/", include("apps.fees.urls")),
    path("api/fees/", include("apps.fees.urls")),
    path("api/v1/exams/", include("apps.exams.urls")),
    path("api/v1/finance/", include("apps.finance.urls")),
    path("api/v1/hr/", include("apps.hr.urls")),
    path("api/master/", include("apps.master.urls")),
    path("api/v1/master/", include("apps.master.urls")),
    path("api/v1/library/", include("apps.library.urls")),
    path("api/v1/behaviour/", include("apps.behaviour.urls")),
    path("api/v1/reports/", include("apps.reports.urls")),
    path("api/v1/tenancy/", include("apps.tenancy.urls")),
    path("api/super-admin/", include("apps.super_admin.urls")),
    path("api/v1/super-admin/", include("apps.super_admin.urls")),
    path("api/chat/", include("apps.chat.urls")),
    path("api/notes/", include("apps.notes.urls")),
    path("api/user/todos/", include("apps.todos.urls")),
    path("api/v1/assistant/", include("apps.assistant.urls")),
    path("api/ai/calls-queue/", include("apps.calls_queue.urls")),
    path("api/v1/settings/", include("apps.settings.urls")),
    path("api/ai/brief/", AIBriefView.as_view(), name="ai-brief"),
    path("api/dashboard/attention-count/", AttentionCountView.as_view(), name="dashboard-attention-count"),
    path("api/v1/utilities/communication/", include("apps.communication.urls")),
    path("api/v1/competitions/", include("apps.competitions.urls")),
    path("api/v1/teacher/", include("apps.teacher_portal.urls")),
    path("api/v1/parent/", include("apps.parent_portal.urls")),
    path("api/v1/student/", include("apps.student_portal.urls")),
]


# /media/* always goes through serve_media, which requires authentication
# and checks the requesting user's school owns the file — DEBUG and
# production both need this since uploaded documents contain student/staff
# PII. In real production, prefer serving /media/ via nginx/CDN with the
# same auth+ownership check (e.g. an auth_request subrequest to this view).
urlpatterns += [
    re_path(r"^media/(?P<path>.*)$", serve_media),
]


