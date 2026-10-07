from rest_framework import serializers

from apps.library.models import Charge
from apps.library.services.members import person_name


class ChargeSerializer(serializers.ModelSerializer):
    member_name = serializers.SerializerMethodField()
    card_no = serializers.CharField(source="member.card_no", read_only=True)
    resolved_by_name = serializers.CharField(source="resolved_by.get_full_name", read_only=True, default=None)

    class Meta:
        model = Charge
        fields = [
            "id", "member", "member_name", "card_no", "charge_type", "amount", "status", "issue", "assessed_on",
            "resolved_at", "resolved_by", "resolved_by_name", "resolution_note", "receipt_no", "created_at",
        ]
        read_only_fields = fields

    def get_member_name(self, obj):
        return person_name(obj.member)


class WaiveChargeSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500)
