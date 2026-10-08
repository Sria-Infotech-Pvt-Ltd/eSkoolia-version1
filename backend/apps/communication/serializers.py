from datetime import date

from django.contrib.auth import get_user_model
from rest_framework import serializers

from apps.access_control.models import Role
from apps.core.models import Holiday
from .models import (
    BroadcastMessage,
    CommunicationNotification,
    CommunicationPreference,
    EmailMessageLog,
    EmailSmsLog,
    InAppMessage,
    NoticeBoard,
)

User = get_user_model()


class UserBasicSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "email"]


class BroadcastMessageSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    audience_label = serializers.SerializerMethodField()

    class Meta:
        model = BroadcastMessage
        fields = [
            "id", "template", "message", "audience_type", "audience_label", "audience_class_ids",
            "channels", "status", "scheduled_at", "sent_at", "recipient_count", "error",
            "created_by_name", "created_at",
        ]
        read_only_fields = fields

    def get_created_by_name(self, obj):
        if not obj.created_by:
            return "—"
        name = f"{obj.created_by.first_name} {obj.created_by.last_name}".strip()
        return name or obj.created_by.username

    def get_audience_label(self, obj):
        return dict(BroadcastMessage.AUDIENCE_CHOICES).get(obj.audience_type, obj.audience_type)


class CommunicationPreferenceSerializer(serializers.ModelSerializer):
    user = UserBasicSerializer(read_only=True)

    class Meta:
        model = CommunicationPreference
        fields = [
            "id",
            "user",
            "allow_email",
            "allow_in_app",
            "allow_notifications",
            "mute_all",
            "digest_frequency",
            "quiet_hours_start",
            "quiet_hours_end",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "user", "created_at", "updated_at"]

    def validate(self, attrs):
        start = attrs.get("quiet_hours_start")
        end = attrs.get("quiet_hours_end")
        if (start and not end) or (end and not start):
            raise serializers.ValidationError("Both quiet_hours_start and quiet_hours_end are required together.")
        return attrs


class CommunicationNotificationSerializer(serializers.ModelSerializer):
    recipient = UserBasicSerializer(read_only=True)
    recipient_id = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), source="recipient", write_only=True)
    created_by = UserBasicSerializer(read_only=True)

    class Meta:
        model = CommunicationNotification
        fields = [
            "id",
            "recipient",
            "recipient_id",
            "created_by",
            "title",
            "body",
            "notification_type",
            "link_url",
            "data",
            "is_read",
            "read_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "is_read", "read_at", "created_at", "updated_at"]

    def validate_recipient(self, recipient):
        request = self.context.get("request")
        if request and request.user.school_id and recipient.school_id != request.user.school_id:
            raise serializers.ValidationError("You can only notify users in your own school.")
        return recipient


class InAppMessageSerializer(serializers.ModelSerializer):
    sender = UserBasicSerializer(read_only=True)
    recipient = UserBasicSerializer(read_only=True)
    recipient_id = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), source="recipient", write_only=True)

    class Meta:
        model = InAppMessage
        fields = [
            "id",
            "sender",
            "recipient",
            "recipient_id",
            "subject",
            "body",
            "category",
            "metadata",
            "is_read",
            "read_at",
            "delivered_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "sender", "is_read", "read_at", "delivered_at", "created_at", "updated_at"]

    def validate_recipient(self, recipient):
        request = self.context.get("request")
        if request and request.user == recipient:
            raise serializers.ValidationError("You cannot send an in-app message to yourself.")
        if request and request.user.school_id and recipient.school_id != request.user.school_id:
            raise serializers.ValidationError("You can only message users in your own school.")
        return recipient


class EmailMessageLogSerializer(serializers.ModelSerializer):
    recipient = UserBasicSerializer(read_only=True)
    recipient_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), source="recipient", write_only=True, required=False, allow_null=True
    )
    created_by = UserBasicSerializer(read_only=True)

    class Meta:
        model = EmailMessageLog
        fields = [
            "id",
            "recipient",
            "recipient_id",
            "created_by",
            "to_email",
            "subject",
            "body",
            "status",
            "error_message",
            "metadata",
            "sent_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "created_by",
            "status",
            "error_message",
            "sent_at",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        recipient = attrs.get("recipient")
        to_email = attrs.get("to_email")

        if not recipient and not to_email:
            raise serializers.ValidationError("Either recipient_id or to_email must be provided.")

        request = self.context.get("request")
        if recipient and request and request.user.school_id and recipient.school_id != request.user.school_id:
            raise serializers.ValidationError({"recipient_id": "You can only log email to users in your own school."})

        if recipient and not to_email:
            if not recipient.email:
                raise serializers.ValidationError("Recipient does not have an email address.")
            attrs["to_email"] = recipient.email

        return attrs


class NoticeBoardSerializer(serializers.ModelSerializer):
    created_by = UserBasicSerializer(read_only=True)
    updated_by = UserBasicSerializer(read_only=True)
    inform_to_labels = serializers.SerializerMethodField()

    class Meta:
        model = NoticeBoard
        fields = [
            "id",
            "notice_title",
            "notice_message",
            "notice_date",
            "publish_on",
            "inform_to",
            "inform_to_labels",
            "is_published",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "updated_by", "inform_to_labels", "created_at", "updated_at"]

    def get_inform_to_labels(self, obj):
        role_ids = obj.inform_to or []
        if not isinstance(role_ids, list):
            return []
        role_map = {
            str(role.id): role.name
            for role in Role.objects.filter(id__in=role_ids)
        }
        return [role_map.get(str(role_id), str(role_id)) for role_id in role_ids]

    def validate_inform_to(self, value):
        if not isinstance(value, list) or not value:
            raise serializers.ValidationError("At least one role must be selected.")
        return [int(item) for item in value]


class EmailSmsLogSerializer(serializers.ModelSerializer):
    created_by = UserBasicSerializer(read_only=True)
    target_data = serializers.JSONField(required=False)
    select_tab = serializers.ChoiceField(choices=["G", "I", "C"], required=False, write_only=True)
    send_date = serializers.DateField(required=False)
    role_ids = serializers.ListField(child=serializers.IntegerField(), required=False, write_only=True)
    role_id = serializers.IntegerField(required=False, write_only=True, allow_null=True)
    message_to_individual = serializers.ListField(child=serializers.IntegerField(), required=False, write_only=True)
    class_id = serializers.IntegerField(required=False, write_only=True, allow_null=True)
    message_to_section = serializers.ListField(child=serializers.IntegerField(), required=False, write_only=True)
    message_to_student_parent = serializers.ListField(child=serializers.IntegerField(), required=False, write_only=True)

    class Meta:
        model = EmailSmsLog
        fields = [
            "id",
            "title",
            "description",
            "send_through",
            "send_to",
            "send_date",
            "target_data",
            "select_tab",
            "role_ids",
            "role_id",
            "message_to_individual",
            "class_id",
            "message_to_section",
            "message_to_student_parent",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "send_to", "created_by", "created_at", "updated_at"]

    def validate_send_through(self, value):
        if value != EmailSmsLog.SEND_THROUGH_EMAIL:
            raise serializers.ValidationError("SMS is not supported in the rewrite communication module.")
        return value

    def validate(self, attrs):
        send_to = attrs.get("select_tab")
        if not send_to:
            if attrs.get("role_ids"):
                send_to = EmailSmsLog.SEND_TO_GROUP
            elif attrs.get("message_to_individual"):
                send_to = EmailSmsLog.SEND_TO_INDIVIDUAL
            else:
                send_to = EmailSmsLog.SEND_TO_CLASS

        target_data = {
            "role_ids": attrs.get("role_ids") or [],
            "role_id": attrs.get("role_id"),
            "message_to_individual": attrs.get("message_to_individual") or [],
            "class_id": attrs.get("class_id"),
            "message_to_section": attrs.get("message_to_section") or [],
            "message_to_student_parent": attrs.get("message_to_student_parent") or [],
        }

        attrs["send_to"] = send_to
        attrs["target_data"] = target_data
        if not attrs.get("send_date"):
            attrs["send_date"] = date.today()
        return attrs


class HolidayCalendarSerializer(serializers.ModelSerializer):
    """Backed by core.Holiday (the same table Academics > Foundation and
    Settings > Holiday Calendar read/write) rather than a forked copy — field
    names below are aliased to the legacy communication.HolidayCalendar wire
    format so the existing frontend page needed no changes."""

    holiday_title = serializers.CharField(source="name", max_length=120)
    holiday_date = serializers.DateField(source="date")
    is_active = serializers.BooleanField(source="active_status", default=True)

    class Meta:
        model = Holiday
        fields = [
            "id",
            "holiday_title",
            "holiday_date",
            "end_date",
            "description",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        holiday_date = attrs.get("date")
        end_date = attrs.get("end_date")
        if holiday_date and end_date and end_date < holiday_date:
            raise serializers.ValidationError("End date cannot be before holiday date.")
        return attrs
