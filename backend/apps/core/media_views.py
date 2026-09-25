"""Authenticated, tenant-scoped serving for uploaded media files.

Replaces Django's unauthenticated static.serve() for /media/*. Every
sensitive uploaded file (student documents, staff onboarding documents,
photos, admissions attachments) belongs to exactly one school; this view
requires a valid JWT and, for non-superusers, verifies the requesting
user's school actually owns the requested file before streaming it.

Paths that don't match any known school-scoped upload location fall back
to "any authenticated user" rather than being blocked outright — this is
still strictly tighter than the previous fully-public behavior, and avoids
guessing at locations this audit didn't confirm are sensitive.
"""
from django.conf import settings
from django.db.models import Q
from django.http import Http404, HttpResponseForbidden
from django.views.static import serve as _django_serve
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication


def _authenticate(request):
    """Authenticate via JWT bearer token, falling back to an existing session."""
    user = getattr(request, "user", None)
    if user is not None and user.is_authenticated:
        return user
    try:
        result = JWTAuthentication().authenticate(request)
    except AuthenticationFailed:
        return None
    if result is None:
        return None
    user, _token = result
    return user


def _school_owns_path(user, rel_path: str) -> bool:
    """Return True if `user` may access `rel_path` (relative to MEDIA_ROOT).

    Every user, including superusers, must belong to the school that owns
    the file, for every upload location this audit could positively
    attribute to a model. Unrecognized locations return True
    (authenticated-only fallback) — see module docstring.
    """
    school_id = getattr(user, "school_id", None)
    if not school_id:
        return False

    if rel_path.startswith("staff_onboard_docs/"):
        from apps.hr.models import StaffOnboardDocument
        return StaffOnboardDocument.objects.filter(file=rel_path, school_id=school_id).exists()

    if rel_path.startswith("staff/photos/"):
        from apps.hr.models import Staff
        return Staff.objects.filter(staff_photo=rel_path, school_id=school_id).exists()

    if rel_path.startswith("student_documents/"):
        from apps.students.models import StudentDocument
        return StudentDocument.objects.filter(file=rel_path, school_id=school_id).exists()

    if rel_path.startswith("student_photos/"):
        from apps.students.models import Student
        owner_qs = Student.objects.filter(photo__icontains=rel_path)
        if owner_qs.exists():
            return owner_qs.filter(school_id=school_id).exists()
        # Not linked to any Student yet — the enrollment wizard uploads the photo
        # immediately on file pick, well before a student row (draft or final)
        # exists to attach it to. Requiring a Student match here made the
        # thumbnail 404 until autosave/submit later wrote this path onto a
        # student (QA: upload toast succeeds, thumbnail stays blank). Uploads
        # are saved under student_photos/<school_id>/..., so allow it pre-link
        # only when the path's school segment matches the requester's own
        # school; still enforce the strict same-school check above the moment
        # it's actually attached to a Student.
        return rel_path.startswith(f"student_photos/{school_id}/")

    if rel_path.startswith("admissions/visitor_book/"):
        from apps.admissions.models import VisitorBookEntry
        return VisitorBookEntry.objects.filter(file_url=rel_path, school_id=school_id).exists()

    if rel_path.startswith("admissions/complaints/"):
        from apps.admissions.models import ComplaintEntry
        return ComplaintEntry.objects.filter(file=rel_path, school_id=school_id).exists()

    if rel_path.startswith("admissions/postal_receive/"):
        from apps.admissions.models import PostalReceiveEntry
        return PostalReceiveEntry.objects.filter(file=rel_path, school_id=school_id).exists()

    if rel_path.startswith("admissions/postal_dispatch/"):
        from apps.admissions.models import PostalDispatchEntry
        return PostalDispatchEntry.objects.filter(file=rel_path, school_id=school_id).exists()

    if rel_path.startswith("admissions/id_cards/"):
        from apps.admissions.models import IdCardTemplate
        return IdCardTemplate.objects.filter(
            Q(background_img=rel_path) | Q(profile_image=rel_path) | Q(logo=rel_path) | Q(signature=rel_path),
            school_id=school_id,
        ).exists()

    if rel_path.startswith("admissions/certificates/backgrounds/"):
        from apps.admissions.models import CertificateTemplate
        return CertificateTemplate.objects.filter(background_image=rel_path, school_id=school_id).exists()

    if rel_path.startswith("settings/policy_docs/"):
        from apps.settings.models import SchoolPolicyDocument
        return SchoolPolicyDocument.objects.filter(file=rel_path, school_id=school_id).exists()

    if rel_path.startswith("school_logos/"):
        from apps.tenancy.models import SchoolTenant
        return SchoolTenant.objects.filter(logo_url__endswith=f"/{rel_path}", school_id=school_id).exists()

    if rel_path.startswith("settings/branding/"):
        from apps.settings.models import DocumentBrandingSettings
        return DocumentBrandingSettings.objects.filter(
            Q(letterhead_source_file=rel_path) | Q(letterhead_rendered_image=rel_path),
            school_id=school_id,
        ).exists()

    # Unrecognized location — require authentication only (handled by the
    # caller already having a `user`), don't guess at ownership.
    return True


def serve_media(request, path):
    """Drop-in replacement for django.views.static.serve, gated by auth + school ownership."""
    user = _authenticate(request)
    if user is None:
        return HttpResponseForbidden("Authentication required.")

    rel_path = path.replace("\\", "/").lstrip("/")
    if not _school_owns_path(user, rel_path):
        raise Http404("File not found.")

    return _django_serve(request, path, document_root=settings.MEDIA_ROOT)
