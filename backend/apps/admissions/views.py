import logging
from datetime import datetime

import requests
from django.core.cache import cache
from django.db import IntegrityError, models, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.access_control.models import Role, UserRole
from apps.core.models import Class, Section
from apps.students.models import Student
from apps.tenancy.models import School
from config.pagination import ApiPageNumberPagination

from .models import (
    AdmissionFollowUp,
    AdmissionInquiry,
    AdminSetupEntry,
    AuditLog,
    BulkJob,
    CertificateTemplate,
    ComplaintEntry,
    ComplaintType,
    ComplaintSource,
    ContactLog,
    IdCardTemplate,
    PhoneCallLogEntry,
    PipelineStage,
    PostalDispatchEntry,
    PostalReceiveEntry,
    VisitorBookEntry,
)
from .serializers import (
    AdmissionFollowUpSerializer,
    AdmissionInquirySerializer,
    AdmissionPincodeLookupQuerySerializer,
    AdminSetupEntrySerializer,
    AIGenerateRequestSerializer,
    AIGenerateResponseSerializer,
    BulkJobSerializer,
    CertificateTemplateSerializer,
    ComplaintEntrySerializer,
    ComplaintTypeSerializer,
    ComplaintSourceSerializer,
    StaffLookupSerializer,
    ConsentLogSerializer,
    IdCardTemplateSerializer,
    PhoneCallLogEntrySerializer,
    PipelineStageSerializer,
    PostalDispatchEntrySerializer,
    PostalReceiveEntrySerializer,
    VisitorBookEntrySerializer,
)

logger = logging.getLogger(__name__)


class VisitorBookPagination(ApiPageNumberPagination):
    page_size = 10
    max_page_size = 50

    def get_page_size(self, request):
        requested = super().get_page_size(request)
        if not requested:
            requested = self.page_size
        return max(5, min(50, requested))


class AdminSetupPagination(ApiPageNumberPagination):
    page_size = 5
    max_page_size = 50

    def get_page_size(self, request):
        requested = super().get_page_size(request)
        if not requested:
            requested = self.page_size
        return max(5, min(50, requested))


class AdminSectionRBACMixin:
    permission_codes = {}

    def _get_permission_code(self):
        action = getattr(self, "action", None)
        if action in self.permission_codes:
            return self.permission_codes[action]
        return self.permission_codes.get("*")

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)

        code = self._get_permission_code()


        # Enforce permission checks for all admin section operations (fail-safe)
        # If no permission code is configured, deny access by default
        if code is None:
            raise PermissionDenied("This action requires specific permissions that are not configured.")

        user = request.user
        if user.is_superuser:
            return

        has_perm = hasattr(user, "has_permission_code") and user.has_permission_code(code)
        if not has_perm:
            raise PermissionDenied("You do not have permission to perform this action.")


class DuplicateSafeWriteMixin:
    duplicate_error_message = "Record already exists"
    create_success_message = "Record created successfully"
    update_success_message = "Record updated successfully"
    delete_success_message = "Record deleted successfully"

    def _normalize_field_errors(self, serializer_errors):
        normalized = {}
        for field, errors in (serializer_errors or {}).items():
            if isinstance(errors, (list, tuple)):
                normalized[field] = [str(error) for error in errors]
            else:
                normalized[field] = [str(errors)]
        return normalized

    def _first_error_message(self, field_errors):
        for errors in field_errors.values():
            if isinstance(errors, list) and errors:
                return str(errors[0])
        return "Validation failed"

    def _validation_response(self, field_errors=None, message="Validation failed", status_code=status.HTTP_400_BAD_REQUEST):
        return Response(
            {
                "success": False,
                "message": message,
                "field_errors": field_errors or {},
            },
            status=status_code,
        )

    def _success_response(self, message, data=None, status_code=status.HTTP_200_OK):
        payload = {"success": True, "message": message}
        if data is not None:
            payload["data"] = data
        return Response(payload, status=status_code)

    def _raise_integrity_validation_error(self, exc):
        message = str(exc).lower()
        if "duplicate" in message or "unique" in message or "uq_" in message:
            raise ValidationError({"detail": self.duplicate_error_message})
        raise ValidationError({"detail": "Invalid request data."})

    def _integrity_response(self, exc):
        try:
            self._raise_integrity_validation_error(exc)
        except ValidationError as error:
            detail = error.detail
            if isinstance(detail, dict):
                field_errors = self._normalize_field_errors(detail)
                message = self._first_error_message(field_errors)
            else:
                message = str(detail)
                field_errors = {"detail": [message]}
            return self._validation_response(field_errors, message)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            field_errors = self._normalize_field_errors(serializer.errors)
            return self._validation_response(field_errors, self._first_error_message(field_errors))
        try:
            self.perform_create(serializer)
        except IntegrityError as exc:
            return self._integrity_response(exc)
        output = self.get_serializer(serializer.instance)
        return self._success_response(self.create_success_message, output.data, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        if not serializer.is_valid():
            field_errors = self._normalize_field_errors(serializer.errors)
            return self._validation_response(field_errors, self._first_error_message(field_errors))
        try:
            self.perform_update(serializer)
        except IntegrityError as exc:
            return self._integrity_response(exc)
        output = self.get_serializer(serializer.instance)
        return self._success_response(self.update_success_message, output.data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        self.perform_destroy(instance)
        return self._success_response(self.delete_success_message)


class AdmissionPincodeLookupAPIView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def _has_access(self, user):
        if user.is_superuser:
            return True
        if not hasattr(user, "has_permission_code"):
            return False
        return user.has_permission_code("admin_section.admission_query.view")

    def _normalize_post_office(self, office):
        office = office or {}
        return {
            "name": str(office.get("Name") or "").strip(),
            "branch_type": str(office.get("BranchType") or "").strip(),
            "delivery_status": str(office.get("DeliveryStatus") or "").strip(),
            "district": str(office.get("District") or "").strip(),
            "state": str(office.get("State") or "").strip(),
            "region": str(office.get("Region") or "").strip(),
            "division": str(office.get("Division") or "").strip(),
            "circle": str(office.get("Circle") or "").strip(),
            "taluk": str(office.get("Taluk") or "").strip(),
            "block": str(office.get("Block") or "").strip(),
            "country": str(office.get("Country") or "").strip(),
            "pincode": str(office.get("Pincode") or "").strip(),
        }

    def get(self, request):
        if not self._has_access(request.user):
            raise PermissionDenied("You do not have permission to perform this action.")

        serializer = AdmissionPincodeLookupQuerySerializer(data=request.query_params)
        if not serializer.is_valid():
            field_errors = {
                field: [str(error) for error in (errors or [])] if isinstance(errors, (list, tuple)) else [str(errors)]
                for field, errors in serializer.errors.items()
            }
            message = field_errors.get("pincode", ["Pincode must be exactly 6 digits."])[0]
            return Response(
                {
                    "success": False,
                    "message": message,
                    "field_errors": field_errors,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        pincode = serializer.validated_data["pincode"]
        cache_key = f"admission_pincode_details:v1:{pincode}"
        cached = cache.get(cache_key)
        if cached:
            return Response({"success": True, "message": "Pincode details fetched successfully.", "data": cached})

        headers = {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
        }
        try:
            upstream = requests.get(f"https://api.postalpincode.in/pincode/{pincode}", timeout=8, headers=headers)
            upstream.raise_for_status()
            payload = upstream.json()
        except requests.RequestException:
            return Response(
                {
                    "success": False,
                    "message": "Unable to fetch pincode details right now.",
                    "field_errors": {"pincode": "Unable to fetch pincode details right now."},
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        if not isinstance(payload, list) or not payload:
            return Response(
                {
                    "success": False,
                    "message": "Invalid PIN Code",
                    "field_errors": {"pincode": "Invalid PIN Code"},
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        entry = payload[0] or {}
        if str(entry.get("Status") or "").strip().lower() != "success":
            return Response(
                {
                    "success": False,
                    "message": "Invalid PIN Code",
                    "field_errors": {"pincode": "Invalid PIN Code"},
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_post_offices = entry.get("PostOffice") or []
        post_offices = [self._normalize_post_office(item) for item in raw_post_offices if item]
        post_offices = [item for item in post_offices if item.get("name")]

        if not post_offices:
            return Response(
                {
                    "success": False,
                    "message": "Invalid PIN Code",
                    "field_errors": {"pincode": "Invalid PIN Code"},
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        selected_post_office = post_offices[0]
        state = str(selected_post_office.get("state") or "").strip()
        district = str(selected_post_office.get("district") or "").strip()

        if not state or not district:
            return Response(
                {
                    "success": False,
                    "message": "Invalid PIN Code",
                    "field_errors": {"pincode": "Invalid PIN Code"},
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        data = {
            "pincode": pincode,
            "state": state,
            "district": district,
            "post_office": selected_post_office.get("name") or "",
            "selected_post_office": selected_post_office,
            "post_offices": post_offices,
            "multiple_post_offices": len(post_offices) > 1,
        }
        cache.set(cache_key, data, 24 * 60 * 60)

        return Response(
            {
                "success": True,
                "message": "Pincode details fetched successfully.",
                "data": data,
            },
            status=status.HTTP_200_OK,
        )


class AdmissionInquiryViewSet(AdminSectionRBACMixin, DuplicateSafeWriteMixin, viewsets.ModelViewSet):
    serializer_class = AdmissionInquirySerializer
    pagination_class = ApiPageNumberPagination
    permission_classes = [permissions.IsAuthenticated]
    create_success_message = "Admission query created successfully"
    update_success_message = "Record updated successfully"
    delete_success_message = "Record deleted successfully"
    permission_codes = {
        "list": "admin_section.admission_query.view",
        "retrieve": "admin_section.admission_query.view",
        "create": "admin_section.admission_query.add",
        "update": "admin_section.admission_query.edit",
        "partial_update": "admin_section.admission_query.edit",
        "destroy": "admin_section.admission_query.delete",
    }

    def get_queryset(self):
        user = self.request.user
        queryset = AdmissionInquiry.objects.select_related(
            "school",
            "created_by",
            "source",
            "reference",
            "school_class",
        ).prefetch_related("follow_ups__author")
        if user.school_id:
            scoped = queryset.filter(school_id=user.school_id)
        else:
            return queryset.none()

        query = self.request.query_params
        date_from = query.get("date_from")
        date_to = query.get("date_to")
        source = query.get("source")
        active_status = query.get("active_status") or query.get("status")

        if date_from:
            scoped = scoped.filter(query_date__gte=date_from)
        if date_to:
            scoped = scoped.filter(query_date__lte=date_to)
        if source:
            scoped = scoped.filter(source_id=source)
        if active_status:
            scoped = scoped.filter(active_status=active_status)
        phone = query.get("phone")
        if phone:
            scoped = scoped.filter(phone=phone)
        search = query.get("search")
        if search:
            scoped = scoped.filter(
                models.Q(full_name__icontains=search)
                | models.Q(phone__icontains=search)
            )

        return scoped

    def perform_create(self, serializer):
        user = self.request.user
        school = getattr(user, "school", None) or getattr(self.request, "school", None)

        # Fallback for users where only school_id is present.
        if not school and getattr(user, "school_id", None):
            school = School.objects.filter(id=user.school_id, is_active=True).first()

        if not school:
            raise PermissionDenied("School context is required.")

        instance = serializer.save(school=school, created_by=user)
        if not instance.query_date:
            instance.query_date = timezone.localdate()
        if instance.school_class_id and not instance.class_name:
            instance.class_name = instance.school_class.name
        instance.save(update_fields=["query_date", "class_name", "updated_at"])

    def perform_update(self, serializer):
        instance = serializer.save()
        if instance.school_class_id and not instance.class_name:
            instance.class_name = instance.school_class.name
            instance.save(update_fields=["class_name", "updated_at"])

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            field_errors = self._normalize_field_errors(serializer.errors)
            return self._validation_response(field_errors, self._first_error_message(field_errors))
        try:
            self.perform_create(serializer)
        except IntegrityError as exc:
            return self._integrity_response(exc)
        output = self.get_serializer(serializer.instance)
        return self._success_response(self.create_success_message, output.data, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        if not serializer.is_valid():
            field_errors = self._normalize_field_errors(serializer.errors)
            return self._validation_response(field_errors, self._first_error_message(field_errors))
        try:
            self.perform_update(serializer)
        except IntegrityError as exc:
            return self._integrity_response(exc)
        output = self.get_serializer(serializer.instance)
        return self._success_response(self.update_success_message, output.data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    # ── Contact action endpoints ─────────────────────────────────────────────

    def _get_school_inquiry(self, pk):
        user = self.request.user
        qs = AdmissionInquiry.objects.select_related("school")
        try:
            return qs.get(pk=pk, school_id=user.school_id)
        except AdmissionInquiry.DoesNotExist:
            raise PermissionDenied("Inquiry not found.")

    def _log_contact(self, inquiry, channel, body="", subject="", provider_id="", direction="outbound"):
        ContactLog.objects.create(
            inquiry=inquiry,
            channel=channel,
            direction=direction,
            status="sent",
            provider_message_id=provider_id,
            body=body,
            subject=subject,
            performed_by=self.request.user,
        )
        inquiry.last_contacted_at = timezone.now()
        inquiry.save(update_fields=["last_contacted_at"])
        AuditLog.objects.create(
            school=inquiry.school,
            actor=self.request.user,
            action=f"contact.{channel}",
            object_type="AdmissionInquiry",
            object_id=str(inquiry.pk),
        )

    @action(detail=True, methods=["post"], url_path="actions/call")
    def action_call(self, request, pk=None):
        from apps.admissions.providers import get_sms_adapter
        inquiry = self._get_school_inquiry(pk)
        adapter = get_sms_adapter()
        result = adapter.initiate_call(to=inquiry.phone)
        self._log_contact(inquiry, "call", body="Click-to-call initiated")
        return Response(
            {"success": True, "call_session_id": result.get("call_session_id"), "call_url": result.get("call_url")},
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="actions/whatsapp")
    def action_whatsapp(self, request, pk=None):
        from apps.admissions.providers import get_sms_adapter
        inquiry = self._get_school_inquiry(pk)
        text = request.data.get("text", "")
        template_id = request.data.get("template_id")
        adapter = get_sms_adapter()
        result = adapter.send_whatsapp(to=inquiry.phone, body=text, template_id=template_id)
        self._log_contact(inquiry, "whatsapp", body=text, provider_id=result.get("message_id", ""))
        return Response(
            {"success": True, "message": "WhatsApp sent.", "provider_message_id": result.get("message_id")},
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="actions/sms")
    def action_sms(self, request, pk=None):
        from apps.admissions.providers import get_sms_adapter
        inquiry = self._get_school_inquiry(pk)
        text = request.data.get("text", "")
        adapter = get_sms_adapter()
        result = adapter.send_sms(to=inquiry.phone, body=text)
        self._log_contact(inquiry, "sms", body=text, provider_id=result.get("message_id", ""))
        return Response(
            {"success": True, "message": "SMS sent.", "provider_message_id": result.get("message_id")},
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="actions/email")
    def action_email(self, request, pk=None):
        from django.core.mail import send_mail
        inquiry = self._get_school_inquiry(pk)
        subject = request.data.get("subject", "")
        body = request.data.get("body", "")
        if inquiry.email:
            send_mail(subject=subject, message=body, from_email=None, recipient_list=[inquiry.email])
        self._log_contact(inquiry, "email", body=body, subject=subject)
        return Response({"success": True, "message": "Email sent."}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="merge")
    def merge(self, request, pk=None):
        """
        Merge a duplicate inquiry (source) into this one (target).
        POST /api/v1/admissions/inquiries/{target_id}/merge/
        Body: { "source_id": <int> }
        """
        target = self._get_school_inquiry(pk)
        source_id = request.data.get("source_id")
        if not source_id:
            return Response({"success": False, "error": "source_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            source = AdmissionInquiry.objects.get(pk=source_id, school=target.school)
        except AdmissionInquiry.DoesNotExist:
            return Response({"success": False, "error": "Source inquiry not found."}, status=status.HTTP_404_NOT_FOUND)
        if source.pk == target.pk:
            return Response({"success": False, "error": "Cannot merge an inquiry with itself."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            # Fill empty fields in target from source
            mergeable_fields = [
                "email", "address", "description", "child_name", "has_sibling_enrolled",
                "sibling_name", "assigned", "source_id", "reference_id", "next_follow_up_date",
            ]
            changed = []
            for field in mergeable_fields:
                target_val = getattr(target, field, None)
                source_val = getattr(source, field, None)
                if not target_val and source_val:
                    setattr(target, field, source_val)
                    changed.append(field)

            # Merge notes
            source_note = (source.note or "").strip()
            target_note = (target.note or "").strip()
            if source_note and source_note not in target_note:
                target.note = (f"{target_note}\n[Merged] {source_note}".strip() if target_note else f"[Merged] {source_note}")
                changed.append("note")

            if changed:
                target.save(update_fields=changed + ["updated_at"])

            # Reassign follow-ups from source to target
            from apps.admissions.models import AdmissionFollowUp
            AdmissionFollowUp.objects.filter(inquiry=source).update(inquiry=target)

            # Audit log
            AuditLog.objects.create(
                school=target.school,
                actor=request.user,
                action="inquiry.merge",
                object_type="AdmissionInquiry",
                object_id=str(target.pk),
            )
            source.delete()

        ser = self.get_serializer(target)
        return Response({"success": True, "message": "Inquiries merged successfully.", "data": ser.data}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="followups")
    def add_followup(self, request, pk=None):
        inquiry = self._get_school_inquiry(pk)
        data = {**request.data, "inquiry": inquiry.pk}
        ser = AdmissionFollowUpSerializer(data=data, context={"request": request})
        if not ser.is_valid():
            return Response({"success": False, "field_errors": ser.errors}, status=status.HTTP_400_BAD_REQUEST)
        follow_up = ser.save(author=request.user)
        AuditLog.objects.create(
            school=inquiry.school,
            actor=request.user,
            action="followup.create",
            object_type="AdmissionInquiry",
            object_id=str(inquiry.pk),
        )
        return Response(
            {"success": True, "message": "Follow-up scheduled.", "data": AdmissionFollowUpSerializer(follow_up).data},
            status=status.HTTP_201_CREATED,
        )


class AdmissionFollowUpViewSet(AdminSectionRBACMixin, DuplicateSafeWriteMixin, viewsets.ModelViewSet):
    serializer_class = AdmissionFollowUpSerializer
    pagination_class = ApiPageNumberPagination
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "delete", "head", "options"]
    create_success_message = "Follow-up saved successfully"
    delete_success_message = "Follow-up deleted successfully"
    permission_codes = {
        "list": "admin_section.admission_query.view",
        "retrieve": "admin_section.admission_query.view",
        "create": "admin_section.admission_query.edit",
        "destroy": "admin_section.admission_query.edit",
    }

    def get_queryset(self):
        user = self.request.user
        qs = AdmissionFollowUp.objects.select_related("inquiry__school", "author")
        inquiry_id = self.request.query_params.get("inquiry")
        if user.school_id:
            scoped = qs.filter(inquiry__school_id=user.school_id)
        else:
            return qs.none()

        if inquiry_id:
            scoped = scoped.filter(inquiry_id=inquiry_id)

        return scoped.order_by("-created_at")

    def perform_create(self, serializer):
        user = self.request.user
        inquiry_id = self.request.data.get("inquiry")
        # Ensure the inquiry belongs to the user's school
        if inquiry_id:
            if not AdmissionInquiry.objects.filter(id=inquiry_id, school_id=user.school_id).exists():
                raise PermissionDenied("Inquiry not found in your school.")

        instance = serializer.save(author=user)

        follow_up_raw = self.request.data.get("follow_up_date")
        follow_up_date = timezone.localdate()
        if follow_up_raw:
            try:
                follow_up_date = datetime.strptime(str(follow_up_raw), "%Y-%m-%d").date()
            except ValueError as exc:
                raise ValidationError({"follow_up_date": "Follow up date is invalid."}) from exc

        inquiry_updates = {
            "follow_up_date": follow_up_date,
        }

        next_follow_up_date = self.request.data.get("next_follow_up_date")
        active_status = self.request.data.get("active_status") or self.request.data.get("status")

        if follow_up_date > timezone.localdate():
            raise ValidationError({"follow_up_date": "Follow-up date cannot be in the future."})

        if next_follow_up_date:
            try:
                parsed_next = datetime.strptime(str(next_follow_up_date), "%Y-%m-%d").date()
            except ValueError as exc:
                raise ValidationError({"next_follow_up_date": "Next follow up date is invalid."}) from exc
            if parsed_next < timezone.localdate():
                raise ValidationError({"next_follow_up_date": "Next follow-up date cannot be in the past."})
            if parsed_next < follow_up_date:
                raise ValidationError({"next_follow_up_date": "Next follow-up date must be on or after the follow-up date."})

        if next_follow_up_date:
            inquiry_updates["next_follow_up_date"] = parsed_next
        if active_status:
            inquiry_updates["active_status"] = active_status

        # Keep lifecycle status update support for existing screens.
        if instance.status_after:
            inquiry_updates["status"] = instance.status_after

        AdmissionInquiry.objects.filter(pk=instance.inquiry_id).update(**inquiry_updates)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            field_errors = self._normalize_field_errors(serializer.errors)
            return self._validation_response(field_errors, self._first_error_message(field_errors))
        try:
            self.perform_create(serializer)
        except IntegrityError as exc:
            return self._integrity_response(exc)
        output = self.get_serializer(serializer.instance)
        return self._success_response(self.create_success_message, output.data, status.HTTP_201_CREATED)


class VisitorBookEntryViewSet(AdminSectionRBACMixin, DuplicateSafeWriteMixin, viewsets.ModelViewSet):
    serializer_class = VisitorBookEntrySerializer
    pagination_class = VisitorBookPagination
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    create_success_message = "Visitor record created successfully"
    update_success_message = "Record updated successfully"
    permission_codes = {
        "list": "admin_section.visitor_book.view",
        "retrieve": "admin_section.visitor_book.view",
        "create": "admin_section.visitor_book.add",
        "update": "admin_section.visitor_book.edit",
        "partial_update": "admin_section.visitor_book.edit",
        "destroy": "admin_section.visitor_book.delete",
    }

    def get_queryset(self):
        user = self.request.user
        qs = VisitorBookEntry.objects.select_related("school", "created_by")
        if user.school_id:
            qs = qs.filter(school_id=user.school_id)
        else:
            return qs.none()

        search = self.request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(
                models.Q(name__icontains=search) |
                models.Q(purpose__icontains=search) |
                models.Q(phone__icontains=search) |
                models.Q(visitor_id__icontains=search)
            )

        purpose = self.request.query_params.get("purpose", "").strip()
        if purpose:
            qs = qs.filter(models.Q(purpose=purpose) | models.Q(purpose__icontains=purpose))

        date = self.request.query_params.get("date", "").strip()
        if date:
            qs = qs.filter(date=date)

        return qs

    def _build_next_visitor_id(self, school_id: int, year: int) -> str:
        prefix = f"VIS-{year}-"
        last_row = (
            VisitorBookEntry.objects.filter(school_id=school_id, visitor_id__startswith=prefix)
            .order_by("-visitor_id")
            .only("visitor_id")
            .first()
        )

        next_number = 1
        if last_row and last_row.visitor_id:
            try:
                next_number = int(last_row.visitor_id.rsplit("-", 1)[1]) + 1
            except (IndexError, ValueError):
                next_number = 1
        return f"{prefix}{next_number:04d}"

    def perform_create(self, serializer):
        user = self.request.user
        school = user.school
        if not school and getattr(self.request, "school", None):
            school = self.request.school
        if not school:
            raise PermissionDenied("School context is required.")

        now_year = timezone.localdate().year
        for _ in range(5):
            try:
                with transaction.atomic():
                    School.objects.select_for_update().filter(pk=school.id).first()
                    visitor_id = self._build_next_visitor_id(school.id, now_year)
                    serializer.save(school=school, created_by=user, visitor_id=visitor_id)
                return
            except IntegrityError:
                continue

        raise ValidationError({"detail": "Unable to generate visitor ID. Please retry."})

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            field_errors = self._normalize_field_errors(serializer.errors)
            return self._validation_response(field_errors, self._first_error_message(field_errors))
        try:
            self.perform_create(serializer)
        except IntegrityError as exc:
            return self._integrity_response(exc)
        output = self.get_serializer(serializer.instance)
        return self._success_response(self.create_success_message, output.data, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        if not serializer.is_valid():
            field_errors = self._normalize_field_errors(serializer.errors)
            return self._validation_response(field_errors, self._first_error_message(field_errors))
        try:
            self.perform_update(serializer)
        except IntegrityError as exc:
            return self._integrity_response(exc)
        output = self.get_serializer(serializer.instance)
        return self._success_response(self.update_success_message, output.data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)


class ComplaintTypeListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        qs = ComplaintType.objects.filter(is_active=True).select_related("school")

        if user.school_id:
            qs = qs.filter(school_id=user.school_id)
        else:
            qs = qs.none()
        
        paginator = ApiPageNumberPagination()
        paginated_qs = paginator.paginate_queryset(qs, request)
        serializer = ComplaintTypeSerializer(paginated_qs, many=True)
        return paginator.get_paginated_response(serializer.data)

    def post(self, request):
        user = request.user
        if not user.school_id:
            return Response({"detail": "School context is required."}, status=status.HTTP_400_BAD_REQUEST)
        serializer = ComplaintTypeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(school_id=user.school_id)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def _get_object(self, request, pk):
        return get_object_or_404(ComplaintType, pk=pk, school_id=request.user.school_id)

    def patch(self, request, pk=None):
        instance = self._get_object(request, pk)
        serializer = ComplaintTypeSerializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, pk=None):
        instance = self._get_object(request, pk)
        instance.is_active = False
        instance.save(update_fields=["is_active"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class ComplaintSourceListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        qs = ComplaintSource.objects.filter(is_active=True).select_related("school")

        if user.school_id:
            qs = qs.filter(school_id=user.school_id)
        else:
            qs = qs.none()

        paginator = ApiPageNumberPagination()
        paginated_qs = paginator.paginate_queryset(qs, request)
        serializer = ComplaintSourceSerializer(paginated_qs, many=True)
        return paginator.get_paginated_response(serializer.data)

    def post(self, request):
        user = request.user
        if not user.school_id:
            return Response({"detail": "School context is required."}, status=status.HTTP_400_BAD_REQUEST)
        serializer = ComplaintSourceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(school_id=user.school_id)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def _get_object(self, request, pk):
        return get_object_or_404(ComplaintSource, pk=pk, school_id=request.user.school_id)

    def patch(self, request, pk=None):
        instance = self._get_object(request, pk)
        serializer = ComplaintSourceSerializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, pk=None):
        instance = self._get_object(request, pk)
        instance.is_active = False
        instance.save(update_fields=["is_active"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class StaffLookupListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from apps.users.models import User
        user = request.user
        qs = User.objects.filter(is_active=True).select_related("school")

        if user.school_id:
            qs = qs.filter(school_id=user.school_id)
        else:
            qs = qs.none()
        
        paginator = ApiPageNumberPagination()
        paginated_qs = paginator.paginate_queryset(qs, request)
        serializer = StaffLookupSerializer(paginated_qs, many=True)
        return paginator.get_paginated_response(serializer.data)


class ComplaintEntryViewSet(AdminSectionRBACMixin, DuplicateSafeWriteMixin, viewsets.ModelViewSet):
    serializer_class = ComplaintEntrySerializer
    pagination_class = ApiPageNumberPagination
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    create_success_message = "Complaint created successfully"
    update_success_message = "Record updated successfully"
    permission_codes = {
        "list": "admin_section.complaint.view",
        "retrieve": "admin_section.complaint.view",
        "create": "admin_section.complaint.add",
        "update": "admin_section.complaint.edit",
        "partial_update": "admin_section.complaint.edit",
        "destroy": "admin_section.complaint.delete",
    }

    def get_queryset(self):
        user = self.request.user
        qs = ComplaintEntry.objects.select_related("school", "created_by", "complaint_type", "complaint_source", "assigned_to")

        if user.school_id:
            base_qs = qs.filter(school_id=user.school_id)
        else:
            return qs.none()
        
        # Apply backend filtering from query_params
        search = self.request.query_params.get("search", "").strip()
        complaint_type_id = self.request.query_params.get("complaint_type", "").strip()
        complaint_source_id = self.request.query_params.get("complaint_source", "").strip()
        date_value = self.request.query_params.get("date", "").strip()
        
        if search:
            base_qs = base_qs.filter(
                models.Q(complaint_by__icontains=search)
                | models.Q(phone__icontains=search)
                | models.Q(description__icontains=search)
            )
        
        if complaint_type_id and complaint_type_id.isdigit():
            base_qs = base_qs.filter(complaint_type_id=int(complaint_type_id))
        
        if complaint_source_id and complaint_source_id.isdigit():
            base_qs = base_qs.filter(complaint_source_id=int(complaint_source_id))
        
        if date_value:
            try:
                from datetime import datetime as dt
                date_obj = dt.strptime(date_value, "%Y-%m-%d").date()
                base_qs = base_qs.filter(date=date_obj)
            except (ValueError, TypeError):
                pass
        
        return base_qs

    def perform_create(self, serializer):
        user = self.request.user
        school = user.school if hasattr(user, 'school') else None
        if not school and getattr(self.request, "school", None):
            school = self.request.school
        if not school:
            raise PermissionDenied("User must belong to a school to create complaints.")
        serializer.save(school=school, created_by=user)

    def create(self, request, *args, **kwargs):

        try:
            serializer = self.get_serializer(data=request.data)
            if not serializer.is_valid():
                field_errors = self._normalize_field_errors(serializer.errors)
                return self._validation_response(field_errors, self._first_error_message(field_errors))

            try:
                self.perform_create(serializer)
            except IntegrityError as exc:
                return self._integrity_response(exc)

            output = self.get_serializer(serializer.instance)
            return self._success_response(self.create_success_message, output.data, status.HTTP_201_CREATED)
        except Exception as e:
            logger.exception("Exception in ComplaintEntryViewSet.create: %s", e)
            return self._validation_response(
                {"error": [str(e)]},
                f"Failed to process request: {str(e)}"
            )

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        if not serializer.is_valid():
            field_errors = self._normalize_field_errors(serializer.errors)
            return self._validation_response(field_errors, self._first_error_message(field_errors))
        try:
            self.perform_update(serializer)
        except IntegrityError as exc:
            return self._integrity_response(exc)
        output = self.get_serializer(serializer.instance)
        return self._success_response(self.update_success_message, output.data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)


class PostalReceiveEntryViewSet(AdminSectionRBACMixin, DuplicateSafeWriteMixin, viewsets.ModelViewSet):
    serializer_class = PostalReceiveEntrySerializer
    pagination_class = ApiPageNumberPagination
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    create_success_message = "Postal receive record created successfully"
    update_success_message = "Record updated successfully"
    permission_codes = {
        "list": "admin_section.postal_receive.view",
        "retrieve": "admin_section.postal_receive.view",
        "create": "admin_section.postal_receive.add",
        "update": "admin_section.postal_receive.edit",
        "partial_update": "admin_section.postal_receive.edit",
        "destroy": "admin_section.postal_receive.delete",
    }

    def get_queryset(self):
        user = self.request.user
        qs = PostalReceiveEntry.objects.select_related("school", "created_by")
        if user.school_id:
            return qs.filter(school_id=user.school_id)
        return qs.none()

    def perform_create(self, serializer):
        user = self.request.user
        school = user.school
        if not school and getattr(self.request, "school", None):
            school = self.request.school
        serializer.save(school=school, created_by=user)


class PostalDispatchEntryViewSet(AdminSectionRBACMixin, DuplicateSafeWriteMixin, viewsets.ModelViewSet):
    serializer_class = PostalDispatchEntrySerializer
    pagination_class = ApiPageNumberPagination
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    create_success_message = "Postal dispatch record created successfully"
    update_success_message = "Record updated successfully"
    permission_codes = {
        "list": "admin_section.postal_dispatch.view",
        "retrieve": "admin_section.postal_dispatch.view",
        "create": "admin_section.postal_dispatch.add",
        "update": "admin_section.postal_dispatch.edit",
        "partial_update": "admin_section.postal_dispatch.edit",
        "destroy": "admin_section.postal_dispatch.delete",
    }

    def get_queryset(self):
        user = self.request.user
        qs = PostalDispatchEntry.objects.select_related("school", "created_by")
        if user.school_id:
            return qs.filter(school_id=user.school_id)
        return qs.none()

    def perform_create(self, serializer):
        user = self.request.user
        school = user.school
        if not school and getattr(self.request, "school", None):
            school = self.request.school
        serializer.save(school=school, created_by=user)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            field_errors = self._normalize_field_errors(serializer.errors)
            return self._validation_response(field_errors, self._first_error_message(field_errors))
        try:
            self.perform_create(serializer)
        except IntegrityError as exc:
            return self._integrity_response(exc)
        output = self.get_serializer(serializer.instance)
        return self._success_response(self.create_success_message, output.data, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        if not serializer.is_valid():
            field_errors = self._normalize_field_errors(serializer.errors)
            return self._validation_response(field_errors, self._first_error_message(field_errors))
        try:
            self.perform_update(serializer)
        except IntegrityError as exc:
            return self._integrity_response(exc)
        output = self.get_serializer(serializer.instance)
        return self._success_response(self.update_success_message, output.data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)


class PhoneCallLogEntryViewSet(AdminSectionRBACMixin, DuplicateSafeWriteMixin, viewsets.ModelViewSet):
    serializer_class = PhoneCallLogEntrySerializer
    pagination_class = ApiPageNumberPagination
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    create_success_message = "Phone call log added successfully"
    update_success_message = "Record updated successfully"
    permission_codes = {
        "list": "admin_section.phone_call_log.view",
        "retrieve": "admin_section.phone_call_log.view",
        "create": "admin_section.phone_call_log.add",
        "update": "admin_section.phone_call_log.edit",
        "partial_update": "admin_section.phone_call_log.edit",
        "destroy": "admin_section.phone_call_log.delete",
    }

    def get_queryset(self):
        user = self.request.user
        qs = PhoneCallLogEntry.objects.select_related("school", "created_by")
        if user.school_id:
            return qs.filter(school_id=user.school_id)
        return qs.none()

    def perform_create(self, serializer):
        user = self.request.user
        school = user.school
        if not school and getattr(self.request, "school", None):
            school = self.request.school
        serializer.save(school=school, created_by=user)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            field_errors = self._normalize_field_errors(serializer.errors)
            return self._validation_response(field_errors, self._first_error_message(field_errors))
        try:
            self.perform_create(serializer)
        except IntegrityError as exc:
            return self._integrity_response(exc)
        output = self.get_serializer(serializer.instance)
        return self._success_response(self.create_success_message, output.data, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        if not serializer.is_valid():
            field_errors = self._normalize_field_errors(serializer.errors)
            return self._validation_response(field_errors, self._first_error_message(field_errors))
        try:
            self.perform_update(serializer)
        except IntegrityError as exc:
            return self._integrity_response(exc)
        output = self.get_serializer(serializer.instance)
        return self._success_response(self.update_success_message, output.data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)


class AdminSetupEntryViewSet(AdminSectionRBACMixin, DuplicateSafeWriteMixin, viewsets.ModelViewSet):
    serializer_class = AdminSetupEntrySerializer
    pagination_class = AdminSetupPagination
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {
        "list": "admin_section.admin_setup.view",
        "retrieve": "admin_section.admin_setup.view",
        "create": "admin_section.admin_setup.add",
        "update": "admin_section.admin_setup.edit",
        "partial_update": "admin_section.admin_setup.edit",
        "destroy": "admin_section.admin_setup.delete",
    }

    def _resolve_school(self):
        user = self.request.user
        school = getattr(user, "school", None) or getattr(self.request, "school", None)

        # Some users may only have school_id set without relation preloaded.
        if not school and getattr(user, "school_id", None):
            school = School.objects.filter(id=user.school_id, is_active=True).first()

        # In single-school local/UAT setups, allow graceful fallback.
        if not school:
            active_schools = School.objects.filter(is_active=True).only("id")[:2]
            if len(active_schools) == 1:
                school = active_schools[0]

        return school

    def get_queryset(self):
        qs = AdminSetupEntry.objects.select_related("school", "created_by")
        school = self._resolve_school()
        if not school:
            return qs.none()
        scoped = qs.filter(school_id=school.id)

        type_filter = str(self.request.query_params.get("type", "")).strip()
        if type_filter in {"1", "2", "3", "4"}:
            scoped = scoped.filter(type=type_filter)

        return scoped

    def perform_create(self, serializer):
        user = self.request.user
        school = self._resolve_school()
        if not school:
            raise ValidationError({
                "school": "Your account is not linked to any school. Contact your administrator.",
            })
        serializer.save(school=school, created_by=user)

    def _dependency_blockers(self, instance: AdminSetupEntry):
        school_id = instance.school_id
        label = (instance.name or "").strip()
        blockers = []

        if instance.type == "1":
            visitor_exists = VisitorBookEntry.objects.filter(
                school_id=school_id,
                purpose__iexact=label,
            ).exists()
            if visitor_exists:
                blockers.append("Visitor Book")

        elif instance.type == "2":
            complaint_type_exists = ComplaintEntry.objects.filter(
                school_id=school_id,
                complaint_type__name__iexact=label,
            ).exists()
            if complaint_type_exists:
                blockers.append("Complaints by type")

        elif instance.type == "3":
            inquiry_source_exists = AdmissionInquiry.objects.filter(
                school_id=school_id,
                source_id=instance.id,
            ).exists()
            complaint_source_exists = ComplaintEntry.objects.filter(
                school_id=school_id,
                complaint_source__name__iexact=label,
            ).exists()
            if inquiry_source_exists:
                blockers.append("Admission Inquiries source")
            if complaint_source_exists:
                blockers.append("Complaints source")

        elif instance.type == "4":
            inquiry_reference_exists = AdmissionInquiry.objects.filter(
                school_id=school_id,
                reference_id=instance.id,
            ).exists()
            if inquiry_reference_exists:
                blockers.append("Admission Inquiries reference")

        return blockers

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        blockers = self._dependency_blockers(instance)
        if blockers:
            msg = (
                f"Cannot delete '{instance.name}'. It is used in: "
                f"{', '.join(blockers)}. Remove related data first."
            )
            return self._validation_response({"dependency": [msg]}, msg)
        return super().destroy(request, *args, **kwargs)


class IdCardTemplateViewSet(AdminSectionRBACMixin, DuplicateSafeWriteMixin, viewsets.ModelViewSet):
    serializer_class = IdCardTemplateSerializer
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_codes = {
        "list": "admin_section.id_card.view",
        "retrieve": "admin_section.id_card.view",
        "create": "admin_section.id_card.add",
        "update": "admin_section.id_card.edit",
        "partial_update": "admin_section.id_card.edit",
        "destroy": "admin_section.id_card.delete",
        "generate_setup": "admin_section.id_card.view",
        "recipients": "admin_section.id_card.view",
    }

    def get_queryset(self):
        user = self.request.user
        qs = IdCardTemplate.objects.select_related("school", "created_by")
        if user.school_id:
            return qs.filter(school_id=user.school_id)
        return qs.none()

    def perform_create(self, serializer):
        user = self.request.user
        school = user.school
        if not school and getattr(self.request, "school", None):
            school = self.request.school
        serializer.save(school=school, created_by=user)

    @action(detail=False, methods=["get"], url_path="generate-setup")
    def generate_setup(self, request):
        user = request.user

        templates = self.get_queryset()

        roles_qs = Role.objects.order_by("name")
        classes_qs = Class.objects.order_by("numeric_order", "name")
        sections_qs = Section.objects.select_related("school_class").order_by("name")

        roles_qs = roles_qs.filter(school_id=user.school_id) | roles_qs.filter(school__isnull=True)
        classes_qs = classes_qs.filter(school_id=user.school_id)
        sections_qs = sections_qs.filter(school_class__school_id=user.school_id)

        role_rows = []
        for role in roles_qs.distinct():
            role_rows.append({"id": role.id, "name": role.name})

        class_rows = []
        for row in classes_qs:
            class_rows.append({"id": row.id, "name": row.name})

        section_rows = []
        for row in sections_qs:
            section_rows.append({"id": row.id, "school_class": row.school_class_id, "name": row.name})

        serialized_templates = self.get_serializer(templates, many=True).data

        return Response(
            {
                "roles": role_rows,
                "classes": class_rows,
                "sections": section_rows,
                "templates": serialized_templates,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["get"], url_path="recipients")
    def recipients(self, request):
        user = request.user
        role_id = request.query_params.get("role")
        class_id = request.query_params.get("class")
        section_id = request.query_params.get("section")

        if not role_id:
            return Response({"detail": "role query param is required."}, status=status.HTTP_400_BAD_REQUEST)

        roles_qs = Role.objects.all()
        if user.school_id:
            roles_qs = roles_qs.filter(school_id=user.school_id) | roles_qs.filter(school__isnull=True)

        role = roles_qs.distinct().filter(id=role_id).first()
        if not role:
            return Response({"detail": "Role not found."}, status=status.HTTP_404_NOT_FOUND)

        is_student_role = role.name.strip().lower() == "student"

        if is_student_role:
            students_qs = Student.objects.select_related("current_class", "current_section")
            students_qs = students_qs.filter(school_id=user.school_id)
            if class_id:
                students_qs = students_qs.filter(current_class_id=class_id)
            if section_id:
                students_qs = students_qs.filter(current_section_id=section_id)

            rows = []
            for student in students_qs.order_by("first_name", "last_name"):
                label = f"{(student.first_name or '').strip()} {(student.last_name or '').strip()}".strip() or f"Student #{student.id}"
                rows.append(
                    {
                        "id": student.id,
                        "label": label,
                        "first_name": student.first_name or "",
                        "last_name": student.last_name or "",
                        "admission_no": student.admission_no or "",
                        "roll_no": student.roll_no or "",
                        "current_class": student.current_class_id,
                        "current_section": student.current_section_id,
                        "date_of_birth": student.date_of_birth,
                        "className": student.current_class.name if student.current_class else "",
                        "sectionName": student.current_section.name if student.current_section else "",
                        "gender": student.gender or "",
                        "dateOfBirth": student.date_of_birth,
                    }
                )

            paginator = ApiPageNumberPagination()
            page = paginator.paginate_queryset(rows, request, view=self)
            if page is not None:
                response = paginator.get_paginated_response(page)
                response.data["is_student_role"] = True
                return response

            return Response({"is_student_role": True, "recipients": rows}, status=status.HTTP_200_OK)

        user_role_qs = UserRole.objects.select_related("user", "role").filter(role_id=role.id)
        if user.school_id:
            user_role_qs = user_role_qs.filter(user__school_id=user.school_id)

        seen = set()
        rows = []
        for row in user_role_qs.order_by("user_id"):
            if row.user_id in seen:
                continue
            seen.add(row.user_id)
            full_name = f"{(row.user.first_name or '').strip()} {(row.user.last_name or '').strip()}".strip()
            rows.append({"id": row.user_id, "label": full_name or row.user.username})

        paginator = ApiPageNumberPagination()
        page = paginator.paginate_queryset(rows, request, view=self)
        if page is not None:
            response = paginator.get_paginated_response(page)
            response.data["is_student_role"] = False
            return response

        return Response({"is_student_role": False, "recipients": rows}, status=status.HTTP_200_OK)


class CertificateTemplateViewSet(AdminSectionRBACMixin, DuplicateSafeWriteMixin, viewsets.ModelViewSet):
    serializer_class = CertificateTemplateSerializer
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_codes = {
        "list": "admin_section.certificate.view",
        "retrieve": "admin_section.certificate.view",
        "create": "admin_section.certificate.add",
        "update": "admin_section.certificate.edit",
        "partial_update": "admin_section.certificate.edit",
        "destroy": "admin_section.certificate.delete",
        "generate_setup": "admin_section.generate_certificate.view",
        "recipients": "admin_section.generate_certificate.view",
    }

    def get_queryset(self):
        user = self.request.user
        qs = CertificateTemplate.objects.select_related("school", "created_by")
        if user.school_id:
            return qs.filter(school_id=user.school_id)
        return qs.none()

    def perform_create(self, serializer):
        user = self.request.user
        school = user.school
        if not school and getattr(self.request, "school", None):
            school = self.request.school
        serializer.save(school=school, created_by=user)

    @action(detail=False, methods=["get"], url_path="generate-setup")
    def generate_setup(self, request):
        user = request.user

        templates = self.get_queryset()

        roles_qs = Role.objects.order_by("name")
        classes_qs = Class.objects.order_by("numeric_order", "name")
        sections_qs = Section.objects.select_related("school_class").order_by("name")

        roles_qs = roles_qs.filter(school_id=user.school_id) | roles_qs.filter(school__isnull=True)
        classes_qs = classes_qs.filter(school_id=user.school_id)
        sections_qs = sections_qs.filter(school_class__school_id=user.school_id)

        role_rows = []
        for role in roles_qs.distinct():
            role_rows.append({"id": role.id, "name": role.name})

        class_rows = []
        for row in classes_qs:
            class_rows.append({"id": row.id, "name": row.name})

        section_rows = []
        for row in sections_qs:
            section_rows.append({"id": row.id, "school_class": row.school_class_id, "name": row.name})

        serialized_templates = self.get_serializer(templates, many=True).data

        return Response(
            {
                "roles": role_rows,
                "classes": class_rows,
                "sections": section_rows,
                "templates": serialized_templates,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["get"], url_path="recipients")
    def recipients(self, request):
        user = request.user
        role_id = request.query_params.get("role")
        class_id = request.query_params.get("class")
        section_id = request.query_params.get("section")

        if not role_id:
            return Response({"detail": "role query param is required."}, status=status.HTTP_400_BAD_REQUEST)

        roles_qs = Role.objects.all()
        if user.school_id:
            roles_qs = roles_qs.filter(school_id=user.school_id) | roles_qs.filter(school__isnull=True)

        role = roles_qs.distinct().filter(id=role_id).first()
        if not role:
            return Response({"detail": "Role not found."}, status=status.HTTP_404_NOT_FOUND)

        is_student_role = role.name.strip().lower() == "student"

        if is_student_role:
            students_qs = Student.objects.select_related("current_class", "current_section")
            students_qs = students_qs.filter(school_id=user.school_id)
            if class_id:
                students_qs = students_qs.filter(current_class_id=class_id)
            if section_id:
                students_qs = students_qs.filter(current_section_id=section_id)

            rows = []
            for student in students_qs.order_by("first_name", "last_name"):
                label = f"{(student.first_name or '').strip()} {(student.last_name or '').strip()}".strip() or f"Student #{student.id}"
                rows.append(
                    {
                        "id": student.id,
                        "label": label,
                        "first_name": student.first_name or "",
                        "last_name": student.last_name or "",
                        "admission_no": student.admission_no or "",
                        "roll_no": student.roll_no or "",
                        "current_class": student.current_class_id,
                        "current_section": student.current_section_id,
                        "date_of_birth": student.date_of_birth,
                        "className": student.current_class.name if student.current_class else "",
                        "sectionName": student.current_section.name if student.current_section else "",
                        "gender": student.gender or "",
                        "dateOfBirth": student.date_of_birth,
                    }
                )

            return Response({"is_student_role": True, "recipients": rows}, status=status.HTTP_200_OK)

        user_role_qs = UserRole.objects.select_related("user", "role").filter(role_id=role.id)
        if user.school_id:
            user_role_qs = user_role_qs.filter(user__school_id=user.school_id)

        seen = set()
        rows = []
        for row in user_role_qs.order_by("user_id"):
            if row.user_id in seen:
                continue
            seen.add(row.user_id)
            full_name = f"{(row.user.first_name or '').strip()} {(row.user.last_name or '').strip()}".strip()
            rows.append({"id": row.user_id, "label": full_name or row.user.username})

        return Response({"is_student_role": False, "recipients": rows}, status=status.HTTP_200_OK)


class CertificateReadOnlyViewSet(AdminSectionRBACMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Read-only API for listing and retrieving certificates."""
    serializer_class = CertificateTemplateSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {
        "list": "admin_section.certificate.view",
        "retrieve": "admin_section.certificate.view",
    }

    def get_queryset(self):
        user = self.request.user
        qs = CertificateTemplate.objects.select_related("school", "created_by")
        if user.school_id:
            return qs.filter(school_id=user.school_id)
        return qs.none()


class IdCardReadOnlyViewSet(AdminSectionRBACMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Read-only API for listing and retrieving ID card templates."""
    serializer_class = IdCardTemplateSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {
        "list": "admin_section.id_card.view",
        "retrieve": "admin_section.id_card.view",
    }

    def get_queryset(self):
        user = self.request.user
        qs = IdCardTemplate.objects.select_related("school", "created_by")
        if user.school_id:
            return qs.filter(school_id=user.school_id)
        return qs.none()


# ══════════════════════════════════════════════════════════════════════════════
# Admissions Command Center – new viewsets
# ══════════════════════════════════════════════════════════════════════════════


class PipelineViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET  /api/v1/admissions/pipeline/      – list pipeline stages + counts
    GET  /api/v1/admissions/pipeline/{id}/ – stage detail
    """
    serializer_class = PipelineStageSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = PipelineStage.objects.all()
        if getattr(user, "school_id", None):
            return qs.filter(school_id=user.school_id)
        return qs.none()

    def list(self, request, *args, **kwargs):
        stages = self.get_queryset()
        data = []
        for stage in stages:
            count = AdmissionInquiry.objects.filter(pipeline_stage=stage).count()
            row = PipelineStageSerializer(stage).data
            row["lead_count"] = count
            data.append(row)
        return Response({"success": True, "results": data})


class BulkJobViewSet(viewsets.GenericViewSet,
                     mixins.CreateModelMixin,
                     mixins.RetrieveModelMixin):
    """
    POST /api/v1/admissions/bulk/      – create & enqueue bulk job
    GET  /api/v1/admissions/bulk/{id}/ – check status
    """
    serializer_class = BulkJobSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = BulkJob.objects.all()
        if getattr(user, "school_id", None):
            return qs.filter(school_id=user.school_id)
        return qs.none()

    def create(self, request, *args, **kwargs):
        from apps.admissions.tasks import process_bulk_job
        user = request.user
        school = getattr(user, "school", None)
        if not school and getattr(user, "school_id", None):
            school = School.objects.filter(id=user.school_id).first()
        if not school:
            return Response({"success": False, "message": "School context required."}, status=400)

        serializer = BulkJobSerializer(data=request.data)
        if not serializer.is_valid():
            return Response({"success": False, "field_errors": serializer.errors}, status=400)

        job = serializer.save(school=school, created_by=user, status="pending")
        AuditLog.objects.create(
            school=school,
            actor=user,
            action="bulk_job.create",
            object_type="BulkJob",
            object_id=str(job.pk),
        )
        process_bulk_job.delay(job.pk)
        return Response(
            {"success": True, "job_id": job.pk, "status": job.status},
            status=status.HTTP_201_CREATED,
        )

    def retrieve(self, request, pk=None):
        try:
            job = self.get_queryset().get(pk=pk)
        except BulkJob.DoesNotExist:
            return Response({"success": False, "message": "Job not found."}, status=404)
        return Response({"success": True, "data": BulkJobSerializer(job).data})


class AIGenerateView(APIView):
    """
    POST /api/v1/admissions/ai/generate/
    Input:  {lead_id, template_id, tone_preferences?}
    Output: {variant_a, variant_b, prompt_used}
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from apps.admissions.providers import AIMessageService
        serializer = AIGenerateRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response({"success": False, "field_errors": serializer.errors}, status=400)

        lead_id = serializer.validated_data["lead_id"]
        template_id = serializer.validated_data.get("template_id")
        tone = serializer.validated_data.get("tone_preferences", "")

        user = request.user
        try:
            inquiry = AdmissionInquiry.objects.get(pk=lead_id, school_id=user.school_id)
        except AdmissionInquiry.DoesNotExist:
            return Response({"success": False, "message": "Lead not found."}, status=404)

        from apps.admissions.models import AIMessageTemplate
        template = None
        if template_id:
            template = AIMessageTemplate.objects.filter(pk=template_id, school_id=user.school_id).first()

        svc = AIMessageService()
        result = svc.generate(inquiry=inquiry, template=template, tone_preferences=tone)

        AuditLog.objects.create(
            school=inquiry.school,
            actor=user,
            action="ai.generate",
            object_type="AdmissionInquiry",
            object_id=str(inquiry.pk),
        )

        out_ser = AIGenerateResponseSerializer(data=result)
        out_ser.is_valid()
        return Response({"success": True, "data": out_ser.data if out_ser.is_valid() else result})


class ConsentLogView(APIView):
    """
    POST /api/v1/admissions/consent/
    Body: {lead_id, channel, consent_given}
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = ConsentLogSerializer(data=request.data)
        if not serializer.is_valid():
            return Response({"success": False, "field_errors": serializer.errors}, status=400)

        user = request.user
        lead_id = request.data.get("lead_id") or request.data.get("inquiry")
        if not lead_id:
            return Response({"success": False, "message": "lead_id is required."}, status=400)

        try:
            inquiry = AdmissionInquiry.objects.get(
                pk=lead_id,
                school_id=user.school_id,
            )
        except AdmissionInquiry.DoesNotExist:
            return Response({"success": False, "message": "Lead not found."}, status=404)

        log = serializer.save(inquiry=inquiry, recorded_by=user)
        AuditLog.objects.create(
            school=inquiry.school,
            actor=user,
            action="consent.log",
            object_type="AdmissionInquiry",
            object_id=str(inquiry.pk),
        )
        return Response(
            {"success": True, "message": "Consent recorded.", "data": ConsentLogSerializer(log).data},
            status=status.HTTP_201_CREATED,
        )


class AnalyticsOverviewView(APIView):
    """
    GET /api/v1/admissions/analytics/overview/?period=month|quarter|year|all
    Returns full conversion metrics, monthly trend, counsellor leaderboard, channel breakdown.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from django.db.models import Count, Q
        from django.db.models.functions import TruncMonth
        from datetime import timedelta

        user = request.user
        school_id = getattr(user, "school_id", None)
        if not school_id:
            return Response({"success": False, "message": "School context is required."}, status=status.HTTP_403_FORBIDDEN)
        base_qs = AdmissionInquiry.objects.filter(school_id=school_id)

        # Period filter
        period = request.query_params.get("period", "all")
        today = timezone.localdate()
        if period == "month":
            base_qs = base_qs.filter(query_date__gte=today.replace(day=1))
        elif period == "quarter":
            base_qs = base_qs.filter(query_date__gte=today - timedelta(days=90))
        elif period == "year":
            base_qs = base_qs.filter(query_date__year=today.year)

        # Funnel counts
        total = base_qs.count()
        contacted = base_qs.exclude(status="new").count()
        visited = base_qs.filter(status__in=["visited", "enrolled", "declined"]).count()
        enrolled = base_qs.filter(status="enrolled").count()
        declined = base_qs.filter(status="declined").count()

        # By pipeline status
        by_status = list(
            base_qs.values("status").annotate(count=Count("id")).order_by("status")
        )

        # By source with enrolled count
        by_source = list(
            base_qs.values("source__name").annotate(
                count=Count("id"),
                enrolled=Count("id", filter=Q(status="enrolled")),
            ).order_by("-count")[:10]
        )

        # By grade
        by_grade = list(
            base_qs.values("school_class__name").annotate(count=Count("id")).order_by("-count")[:10]
        )

        # Monthly trend — last 6 months
        six_months_ago = today - timedelta(days=180)
        monthly_qs = (
            base_qs
            .filter(query_date__gte=six_months_ago)
            .annotate(month=TruncMonth("query_date"))
            .values("month")
            .annotate(
                inquiries=Count("id"),
                enrolled=Count("id", filter=Q(status="enrolled")),
            )
            .order_by("month")
        )
        monthly_trend = [
            {
                "month": str(item["month"])[:7] if item["month"] else None,
                "inquiries": item["inquiries"],
                "enrolled": item["enrolled"],
            }
            for item in monthly_qs
        ]

        # Counsellor leaderboard (by assigned text field)
        counsellor_stats = list(
            base_qs.exclude(assigned="").values("assigned").annotate(
                total=Count("id"),
                enrolled=Count("id", filter=Q(status="enrolled")),
                contacted=Count("id", filter=~Q(status="new")),
            ).order_by("-total")[:8]
        )
        for c in counsellor_stats:
            c["conversion_pct"] = round(c["enrolled"] / c["total"] * 100, 1) if c["total"] else 0.0

        # Channel breakdown from ContactLog
        contact_qs = ContactLog.objects.all()
        if getattr(user, "school_id", None):
            contact_qs = contact_qs.filter(inquiry__school_id=user.school_id)
        channel_breakdown = list(
            contact_qs.values("channel").annotate(count=Count("id")).order_by("-count")
        )

        return Response(
            {
                "success": True,
                "data": {
                    "total": total,
                    "contacted": contacted,
                    "visited": visited,
                    "enrolled": enrolled,
                    "declined": declined,
                    "contact_rate_pct": round(contacted / total * 100, 1) if total else 0.0,
                    "visit_rate_pct": round(visited / total * 100, 1) if total else 0.0,
                    "enroll_rate_pct": round(enrolled / total * 100, 1) if total else 0.0,
                    "monthly_trend": monthly_trend,
                    "by_status": by_status,
                    "by_source": by_source,
                    "by_grade": by_grade,
                    "counsellor_stats": counsellor_stats,
                    "channel_breakdown": channel_breakdown,
                    # Legacy fields kept for backwards compatibility
                    "total_leads": total,
                    "conversion_rate_pct": round(enrolled / total * 100, 1) if total else 0.0,
                },
            }
        )


# ──────────────────────────────────────────────────────────────────────────────
# Campaign (Admissions -> Communication -> Campaigns)
# ──────────────────────────────────────────────────────────────────────────────
from .models import Campaign  # noqa: E402
from .serializers import CampaignSerializer  # noqa: E402


class CampaignViewSet(AdminSectionRBACMixin, viewsets.ModelViewSet):
    serializer_class = CampaignSerializer
    pagination_class = ApiPageNumberPagination
    # module key is "admin_section" (not "admissions") to match every other
    # permission code in this area — admin_section.complaint.*, .certificate.*,
    # .admission_query.*, etc. — so Campaign shows up in the same Roles &
    # Permissions module group as the rest of Admissions instead of an orphan one.
    permission_codes = {
        "list": "admin_section.campaign.view",
        "retrieve": "admin_section.campaign.view",
        "create": "admin_section.campaign.add",
        "update": "admin_section.campaign.edit",
        "partial_update": "admin_section.campaign.edit",
        "destroy": "admin_section.campaign.delete",
        # Custom status-change actions read as an edit, not a separate permission.
        "activate": "admin_section.campaign.edit",
        "pause": "admin_section.campaign.edit",
        "cancel": "admin_section.campaign.edit",
    }

    def get_queryset(self):
        user = self.request.user
        qs = Campaign.objects.select_related("school", "created_by")
        if not user.school_id:
            return qs.none()
        return qs.filter(school_id=user.school_id)

    def perform_create(self, serializer):
        user = self.request.user
        if not user.school_id:
            raise PermissionDenied("User must belong to a school to create campaigns.")
        status_value = "scheduled" if serializer.validated_data.get("scheduled_for") else "draft"
        serializer.save(school_id=user.school_id, created_by=user, status=status_value)

    def _set_status(self, request, pk, new_status):
        campaign = self.get_object()
        campaign.status = new_status
        campaign.save(update_fields=["status", "updated_at"])
        return Response({"success": True, "data": CampaignSerializer(campaign).data})

    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        return self._set_status(request, pk, "active")

    @action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        return self._set_status(request, pk, "draft")

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return self._set_status(request, pk, "draft")

