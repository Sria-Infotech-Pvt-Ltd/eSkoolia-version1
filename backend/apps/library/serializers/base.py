from rest_framework import serializers

from apps.core.base_serializers import TenantScopedSerializer


class LibraryModelSerializer(TenantScopedSerializer):
    """TenantScopedSerializer with ISO timestamps and unknown-field rejection on create.

    The core base renders timestamps as "%Y-%m-%d %H:%M:%S"; the library pages
    already receive ISO strings, so keep that format.

    Fields named in ``read_only_fields`` are ignored when a client sends them
    (school, created_by, money and counters can never be assigned from the
    payload). Keys that are not fields at all are rejected on create so a typo
    cannot silently vanish (blueprint 3.2).
    """

    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)

    def to_internal_value(self, data):
        if self.instance is None and hasattr(data, "keys"):
            unknown = sorted(set(data.keys()) - set(self.fields.keys()))
            if unknown:
                raise serializers.ValidationError({name: "Unknown field." for name in unknown})
        return super().to_internal_value(data)

    def request_school_id(self):
        request = self.context.get("request")
        return getattr(getattr(request, "user", None), "school_id", None)


AUDIT_FIELDS = ["created_by", "updated_by", "created_by_name", "updated_by_name"]
AUDIT_READ_ONLY = ["id", "school", "created_at", "updated_at", *AUDIT_FIELDS]
