"""
Transport serializers (moved from apps.core.serializers, extended in Phase 1).

Every serializer that accepts a related-record id validates that record against
request.user.school_id (CLAUDE.md tenancy policy) via SchoolScopedRelationsMixin -
an unscoped PrimaryKeyRelatedField alone is never trusted.
"""
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from .models import (
    DEFAULT_CAPACITY_BY_TYPE,
    AssignVehicle,
    BusLocation,
    BusRoutePickupUpdate,
    BusStop,
    FuelEntry,
    RoutePerformanceLog,
    StudentTransportAllocation,
    TransportAlert,
    TransportAttendance,
    TransportNotificationLog,
    TransportReportLog,
    TransportRoute,
    TransportSettings,
    TransportStaffProfile,
    Vehicle,
    VehicleDriverAssignment,
    VehicleServiceRecord,
)
from .services.allocations import academic_year_for, default_fare, mirror_to_student, route_vehicle
from .services.reports import REPORT_KEYS
from .services.settings import DEFAULTS as SETTINGS_DEFAULTS
from .services.settings import get_settings, merged
from .services.upkeep import neighbouring_odometers, service_display_status

# Compliance documents tracked on Vehicle: (field, label). The reminder window
# comes from Transport Settings (reminders.vehicleDocsDays).
COMPLIANCE_DOCUMENTS = [
    ("fitness_valid_till", "Fitness certificate"),
    ("insurance_valid_till", "Insurance"),
    ("permit_valid_till", "Road permit"),
    ("pollution_valid_till", "Pollution (PUC)"),
]


# Permission and School Validation
def _school_id_of(obj, path):
    """Follow a dotted attribute path (e.g. "route.school_id") on a related object."""
    for part in path.split("."):
        obj = getattr(obj, part, None)
        if obj is None:
            return None
    return obj


def school_settings(serializer):
    """The requesting school's Transport Settings, loaded once per request (shared by list children)."""
    context = serializer.context
    if "_transport_settings" not in context:
        request = context.get("request")
        context["_transport_settings"] = get_settings(getattr(getattr(request, "user", None), "school_id", None))
    return context["_transport_settings"]


class SchoolScopedRelationsMixin:
    """
    Rejects related records from another school.

    Subclasses declare `school_scoped_relations = {field_name: path_to_school_id}`,
    e.g. {"route": "school_id", "stop": "route.school_id"}.
    """

    school_scoped_relations: dict = {}

    def validate(self, attrs):
        attrs = super().validate(attrs)
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is None:
            return attrs
        school_id = getattr(user, "school_id", None)
        for field_name, path in self.school_scoped_relations.items():
            related = attrs.get(field_name) or getattr(self.instance, field_name, None)
            if related is not None and _school_id_of(related, path) != school_id:
                raise serializers.ValidationError({field_name: f"Invalid {field_name}."})
        return attrs


def _staff_name(staff):
    return f"{staff.first_name} {staff.last_name}".strip() if staff else None


# Vehicle Serializers
class VehicleSerializer(SchoolScopedRelationsMixin, serializers.ModelSerializer):
    """
    Vehicle CRUD. GPS fields are read-only here - they are written only by the
    secured GPS update endpoint, so a vehicle edit can't spoof a bus position.
    """

    school_scoped_relations = {"driver": "school_id"}

    driver_name = serializers.SerializerMethodField()
    capacity = serializers.SerializerMethodField()
    seats_occupied = serializers.SerializerMethodField()
    route = serializers.SerializerMethodField()
    compliance = serializers.SerializerMethodField()

    class Meta:
        model = Vehicle
        fields = [
            "id", "school", "academic_year", "vehicle_no", "vehicle_model", "made_year", "note",
            "driver", "driver_name", "active_status",
            # Fleet & compliance
            "vehicle_type", "seating_capacity", "capacity", "seats_occupied", "operational_status",
            "fitness_valid_till", "insurance_valid_till", "permit_valid_till", "pollution_valid_till",
            "odometer_km", "route", "compliance",
            # GPS (read-only)
            "current_latitude", "current_longitude", "current_speed", "status", "last_location_update",
            "next_stop", "is_tracking_active",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "school", "academic_year", "created_at", "updated_at",
            "current_latitude", "current_longitude", "current_speed", "status", "last_location_update",
            "next_stop", "is_tracking_active",
        ]

    def get_driver_name(self, obj):
        return _staff_name(obj.driver)

    def get_capacity(self, obj):
        return obj.seating_capacity or DEFAULT_CAPACITY_BY_TYPE.get(obj.vehicle_type, 0)

    def get_seats_occupied(self, obj):
        # Annotated by VehicleViewSet; falls back to a query for single objects built elsewhere.
        value = getattr(obj, "occupied_count", None)
        if value is None:
            value = obj.students.filter(is_active=True, is_deleted=False).count()
        return value

    def get_route(self, obj):
        """The vehicle's active route assignment (AssignVehicle), if any."""
        assignment = next((a for a in obj.assignments.all() if a.active_status), None)
        if not assignment:
            return None
        route = assignment.route
        return {"id": route.id, "title": route.title, "code": route.code}

    def get_compliance(self, obj):
        today = timezone.localdate()
        window = int(school_settings(self)["reminders"]["vehicleDocsDays"])
        result = []
        for field, label in COMPLIANCE_DOCUMENTS:
            valid_till = getattr(obj, field)
            if valid_till is None:
                state, days_left = "missing", None
            else:
                days_left = (valid_till - today).days
                state = "expired" if days_left < 0 else "expiring" if days_left <= window else "valid"
            result.append({"document": label, "field": field, "valid_till": valid_till, "days_left": days_left, "state": state})
        return result

    def validate_seating_capacity(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError("Seating capacity must be greater than zero.")
        return value

    def validate_vehicle_no(self, value):
        # Unique per school (archived vehicles included); checked here so a duplicate gets a clear message
        # instead of a database error (`school` is read-only, so DRF doesn't run the unique check itself).
        request = self.context.get("request")
        school_id = getattr(getattr(request, "user", None), "school_id", None)
        clash = Vehicle.objects.filter(school_id=school_id, vehicle_no=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("A vehicle with this registration number already exists (it may be archived).")
        return value


class VehicleDocumentRenewalSerializer(serializers.Serializer):
    """Input for POST /vehicles/{id}/renew-document/."""

    DOCUMENT_CHOICES = [field for field, _label in COMPLIANCE_DOCUMENTS]

    document = serializers.ChoiceField(choices=DOCUMENT_CHOICES)
    valid_till = serializers.DateField()

    def validate_valid_till(self, value):
        if value <= timezone.localdate():
            raise serializers.ValidationError("Choose a date after today.")
        return value


# Route and Stop Serializers
class BusStopSerializer(SchoolScopedRelationsMixin, serializers.ModelSerializer):
    """A route stop; the same record is the "pickup point" on the Transport screens."""

    school_scoped_relations = {"route": "school_id"}

    route_title = serializers.CharField(source="route.title", read_only=True)
    route_code = serializers.CharField(source="route.code", read_only=True)
    zone = serializers.CharField(source="route.zone", read_only=True)
    effective_fare = serializers.SerializerMethodField()

    class Meta:
        model = BusStop
        fields = [
            "id",
            "route",
            "route_title",
            "route_code",
            "zone",
            "stop_name",
            "landmark",
            "latitude",
            "longitude",
            "stop_order",
            "stop_type",
            "scheduled_time",
            "drop_time",
            "monthly_fare",
            "effective_fare",
            "geofence_radius",
            "arrival_time_window",
            "active_status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_effective_fare(self, obj):
        """Stop fare when set, otherwise the route's default fare (string, like DRF DecimalFields)."""
        fare = obj.monthly_fare if obj.monthly_fare is not None else obj.route.fare
        return None if fare is None else f"{fare:.2f}"


class TransportRouteSerializer(serializers.ModelSerializer):
    """Route list/edit. Counts are annotated by TransportRouteViewSet."""

    vehicle = serializers.SerializerMethodField()
    stops_count = serializers.SerializerMethodField()
    students_count = serializers.SerializerMethodField()

    class Meta:
        model = TransportRoute
        fields = [
            "id", "school", "academic_year", "title", "fare", "active_status",
            "code", "zone", "shift", "first_pickup_time",
            "vehicle", "stops_count", "students_count",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "school", "academic_year", "created_at", "updated_at"]

    def get_vehicle(self, obj):
        """The active vehicle assigned to this route (AssignVehicle) with its driver."""
        assignment = next((a for a in obj.assignments.all() if a.active_status), None)
        if not assignment:
            return None
        vehicle = assignment.vehicle
        return {
            "id": vehicle.id,
            "vehicle_no": vehicle.vehicle_no,
            "driver": vehicle.driver_id,
            "driver_name": _staff_name(vehicle.driver),
        }

    def get_stops_count(self, obj):
        value = getattr(obj, "stops_total", None)
        return value if value is not None else obj.stops.filter(active_status=True).count()

    def get_students_count(self, obj):
        value = getattr(obj, "students_total", None)
        return value if value is not None else obj.students.filter(is_active=True, is_deleted=False).count()

    def validate_title(self, value):
        # Unique per school (archived routes included), like the route code below.
        request = self.context.get("request")
        school_id = getattr(getattr(request, "user", None), "school_id", None)
        clash = TransportRoute.objects.filter(school_id=school_id, title=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("A route with this name already exists (it may be archived).")
        return value

    def validate_code(self, value):
        value = (value or "").strip().upper()
        if not value:
            return ""
        request = self.context.get("request")
        school_id = getattr(getattr(request, "user", None), "school_id", None)
        clash = TransportRoute.objects.filter(school_id=school_id, code=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("This route code is already in use.")
        return value


class TransportRouteDetailSerializer(TransportRouteSerializer):
    """Route detail with its ordered stops (pickup points)."""

    stops = serializers.SerializerMethodField()

    class Meta(TransportRouteSerializer.Meta):
        fields = TransportRouteSerializer.Meta.fields + ["stops"]

    def get_stops(self, obj):
        stops = obj.stops.filter(active_status=True).order_by("stop_order", "id")
        return BusStopSerializer(stops, many=True, context=self.context).data


class AssignVehicleSerializer(SchoolScopedRelationsMixin, serializers.ModelSerializer):
    school_scoped_relations = {"vehicle": "school_id", "route": "school_id"}

    vehicle_no = serializers.CharField(source="vehicle.vehicle_no", read_only=True)
    route_title = serializers.CharField(source="route.title", read_only=True)

    class Meta:
        model = AssignVehicle
        fields = ["id", "school", "academic_year", "vehicle", "vehicle_no", "route", "route_title", "active_status", "created_at", "updated_at"]
        read_only_fields = ["id", "school", "academic_year", "created_at", "updated_at"]


# Live Tracking and GPS
class BusLocationSerializer(SchoolScopedRelationsMixin, serializers.ModelSerializer):
    school_scoped_relations = {"vehicle": "school_id"}

    vehicle_no = serializers.CharField(source="vehicle.vehicle_no", read_only=True)

    class Meta:
        model = BusLocation
        fields = ["id", "vehicle", "vehicle_no", "latitude", "longitude", "speed", "heading", "accuracy", "timestamp", "is_active"]
        read_only_fields = ["id", "timestamp"]


class TransportAlertSerializer(SchoolScopedRelationsMixin, serializers.ModelSerializer):
    """
    Alerts. `state` moves through open -> acknowledged -> resolved via the
    acknowledge/resolve actions (which record who did it); `is_resolved` stays
    writable for legacy clients and is kept in sync by the model.
    """

    school_scoped_relations = {"vehicle": "school_id", "route": "school_id"}

    vehicle_no = serializers.CharField(source="vehicle.vehicle_no", read_only=True)
    route_title = serializers.CharField(source="route.title", read_only=True, allow_null=True)
    raised_by_name = serializers.SerializerMethodField()
    acknowledged_by_name = serializers.SerializerMethodField()
    resolved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = TransportAlert
        fields = [
            "id", "vehicle", "vehicle_no", "route", "route_title", "alert_type", "message", "severity",
            "latitude", "longitude", "is_resolved", "created_at", "resolved_at",
            "state", "document", "raised_by", "raised_by_name", "acknowledged_by", "acknowledged_by_name",
            "acknowledged_at", "resolved_by", "resolved_by_name",
        ]
        read_only_fields = [
            "id", "created_at", "state", "raised_by", "acknowledged_by", "acknowledged_at", "resolved_by",
        ]

    @staticmethod
    def _user_name(user):
        if not user:
            return None
        return (f"{user.first_name} {user.last_name}".strip() or user.username)

    def get_raised_by_name(self, obj):
        return self._user_name(obj.raised_by)

    def get_acknowledged_by_name(self, obj):
        return self._user_name(obj.acknowledged_by)

    def get_resolved_by_name(self, obj):
        return self._user_name(obj.resolved_by)


class AlertIdsSerializer(serializers.Serializer):
    """Input for bulk acknowledge / resolve."""

    ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=False)


class BusRoutePickupUpdateSerializer(SchoolScopedRelationsMixin, serializers.ModelSerializer):
    school_scoped_relations = {"stop": "route.school_id", "vehicle": "school_id", "student": "school_id"}

    # Student has first_name/last_name (no full_name field) - the old
    # source="student.full_name" raised AttributeError for every pickup row.
    student_name = serializers.SerializerMethodField()
    stop_name = serializers.CharField(source="stop.stop_name", read_only=True)
    vehicle_no = serializers.CharField(source="vehicle.vehicle_no", read_only=True)

    class Meta:
        model = BusRoutePickupUpdate
        fields = ["id", "stop", "stop_name", "vehicle", "vehicle_no", "student", "student_name", "arrived_at", "picked_up_at", "status"]
        read_only_fields = ["id"]

    def get_student_name(self, obj):
        student = obj.student
        return f"{student.first_name} {student.last_name}".strip() if student else None


class VehicleDriverAssignmentSerializer(SchoolScopedRelationsMixin, serializers.ModelSerializer):
    school_scoped_relations = {"vehicle": "school_id", "driver": "school_id"}

    vehicle_no = serializers.CharField(source="vehicle.vehicle_no", read_only=True)
    driver_name = serializers.SerializerMethodField()

    def get_driver_name(self, obj):
        return _staff_name(obj.driver)

    class Meta:
        model = VehicleDriverAssignment
        fields = [
            "id", "vehicle", "vehicle_no", "driver", "driver_name", "assigned_from", "assigned_to",
            "is_primary", "active_status", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class TransportNotificationLogSerializer(SchoolScopedRelationsMixin, serializers.ModelSerializer):
    school_scoped_relations = {"vehicle": "school_id", "student": "school_id"}

    vehicle_no = serializers.CharField(source="vehicle.vehicle_no", read_only=True)

    class Meta:
        model = TransportNotificationLog
        fields = [
            "id", "vehicle", "vehicle_no", "student", "channel", "provider", "recipient", "message",
            "status", "error_message", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class RoutePerformanceLogSerializer(SchoolScopedRelationsMixin, serializers.ModelSerializer):
    school_scoped_relations = {"route": "school_id", "vehicle": "school_id"}

    route_title = serializers.CharField(source="route.title", read_only=True)
    vehicle_no = serializers.CharField(source="vehicle.vehicle_no", read_only=True)

    class Meta:
        model = RoutePerformanceLog
        fields = [
            "id", "route", "route_title", "vehicle", "vehicle_no", "log_date", "total_distance_km",
            "avg_speed_kmh", "delay_minutes", "completed_stops", "total_stops", "completed",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


# Driver and Attendant Profiles
class TransportStaffProfileSerializer(SchoolScopedRelationsMixin, serializers.ModelSerializer):
    """
    Driver / attendant profile on top of an existing hr.Staff record. Name, staff no.
    and phone are read from hr.Staff; `licence_number` reads and writes
    hr.Staff.driving_license (the same field HR uses - not a copy).

    Drivers: `vehicle` sets Vehicle.driver (the existing driver link) and frees the
    driver's previous vehicle. Attendants: `vehicle` sets assigned_vehicle.
    """

    school_scoped_relations = {"staff": "school_id", "assigned_vehicle": "school_id"}

    staff_name = serializers.SerializerMethodField()
    staff_no = serializers.CharField(source="staff.staff_no", read_only=True)
    phone = serializers.CharField(source="staff.phone", read_only=True)
    emergency_contact = serializers.CharField(source="staff.emergency_mobile", read_only=True)
    # Not a model field: read from / written to hr.Staff.driving_license (see to_representation / _save_licence).
    licence_number = serializers.CharField(required=False, allow_blank=True, max_length=80)
    vehicle = serializers.PrimaryKeyRelatedField(
        queryset=Vehicle.objects.all(), required=False, allow_null=True, write_only=True
    )
    vehicle_detail = serializers.SerializerMethodField()
    document_state = serializers.SerializerMethodField()

    class Meta:
        model = TransportStaffProfile
        fields = [
            "id", "staff", "staff_name", "staff_no", "phone", "emergency_contact", "role", "shift", "duty_status",
            "experience_years", "licence_number", "licence_valid_till", "badge_number",
            "first_aid_certificate_no", "first_aid_valid_till", "assigned_vehicle", "vehicle", "vehicle_detail",
            "rating", "notes", "document_state", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "assigned_vehicle", "created_at", "updated_at"]

    def get_staff_name(self, obj):
        return _staff_name(obj.staff)

    def _current_vehicle(self, obj):
        if obj.role == "driver":
            return Vehicle.objects.filter(driver_id=obj.staff_id, school_id=obj.school_id, active_status=True).first()
        return obj.assigned_vehicle

    def get_vehicle_detail(self, obj):
        vehicle = self._current_vehicle(obj)
        if not vehicle:
            return None
        assignment = next((a for a in vehicle.assignments.all() if a.active_status), None)
        route = assignment.route if assignment else None
        return {
            "id": vehicle.id, "vehicle_no": vehicle.vehicle_no,
            "route": {"id": route.id, "title": route.title, "code": route.code} if route else None,
        }

    def get_document_state(self, obj):
        """Licence (drivers) or first-aid certificate (attendants) expiry state."""
        valid_till = obj.licence_valid_till if obj.role == "driver" else obj.first_aid_valid_till
        if valid_till is None:
            return {"valid_till": None, "days_left": None, "state": "missing"}
        days_left = (valid_till - timezone.localdate()).days
        reminders = school_settings(self)["reminders"]
        window = int(reminders["licenceDays"] if obj.role == "driver" else reminders["firstAidDays"])
        state = "expired" if days_left < 0 else "expiring" if days_left <= window else "valid"
        return {"valid_till": valid_till, "days_left": days_left, "state": state}

    def validate(self, attrs):
        attrs = super().validate(attrs)
        vehicle = attrs.get("vehicle")
        request = self.context.get("request")
        school_id = getattr(getattr(request, "user", None), "school_id", None)
        if vehicle is not None and vehicle.school_id != school_id:
            raise serializers.ValidationError({"vehicle": "Invalid vehicle."})
        staff = attrs.get("staff")
        if self.instance is None and staff is not None and TransportStaffProfile.objects.filter(staff=staff).exists():
            raise serializers.ValidationError({"staff": "This staff member already has a transport profile."})
        if self.instance is not None and staff is not None and staff != self.instance.staff:
            raise serializers.ValidationError({"staff": "The staff member of a profile can't be changed."})
        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["licence_number"] = instance.staff.driving_license
        return data

    def _save_licence(self, profile, licence_number):
        if licence_number is not None:
            profile.staff.driving_license = licence_number
            profile.staff.save(update_fields=["driving_license"])

    def _save_vehicle(self, profile, vehicle):
        if profile.role == "driver":
            # One vehicle per driver: free the previous one, then point the new one at this driver.
            Vehicle.objects.filter(driver_id=profile.staff_id, school_id=profile.school_id).exclude(
                pk=getattr(vehicle, "pk", None)
            ).update(driver=None)
            if vehicle is not None:
                vehicle.driver_id = profile.staff_id
                vehicle.save(update_fields=["driver", "updated_at"])
        else:
            profile.assigned_vehicle = vehicle
            profile.save(update_fields=["assigned_vehicle", "updated_at"])

    @transaction.atomic
    def create(self, validated_data):
        licence_number = validated_data.pop("licence_number", None)
        vehicle_given = "vehicle" in validated_data
        vehicle = validated_data.pop("vehicle", None)
        validated_data.setdefault("school", validated_data["staff"].school)
        profile = super().create(validated_data)
        self._save_licence(profile, licence_number)
        if vehicle_given:
            self._save_vehicle(profile, vehicle)
        return profile

    @transaction.atomic
    def update(self, instance, validated_data):
        licence_number = validated_data.pop("licence_number", None)
        vehicle_given = "vehicle" in validated_data
        vehicle = validated_data.pop("vehicle", None)
        validated_data.pop("staff", None)
        profile = super().update(instance, validated_data)
        self._save_licence(profile, licence_number)
        if vehicle_given:
            self._save_vehicle(profile, vehicle)
        return profile


# Student Transport Allocation
class StudentTransportAllocationSerializer(SchoolScopedRelationsMixin, serializers.ModelSerializer):
    """
    Allocation of an existing Student. Class/section/admission no. are read from the
    Student record. Rules: the stop must belong to the route; an *allocated* student
    needs a route and a stop; vehicle defaults to the route's assigned vehicle and
    the fare to the stop/route fare.
    """

    school_scoped_relations = {
        "student": "school_id", "route": "school_id", "stop": "route.school_id", "vehicle": "school_id",
    }

    student_name = serializers.SerializerMethodField()
    admission_no = serializers.CharField(source="student.admission_no", read_only=True)
    roll_no = serializers.CharField(source="student.roll_no", read_only=True)
    class_name = serializers.SerializerMethodField()
    section_name = serializers.SerializerMethodField()
    class_id = serializers.IntegerField(source="student.current_class_id", read_only=True, allow_null=True)
    section_id = serializers.IntegerField(source="student.current_section_id", read_only=True, allow_null=True)
    guardian_name = serializers.CharField(source="student.guardian.full_name", read_only=True, default=None)
    guardian_phone = serializers.CharField(source="student.guardian.phone", read_only=True, default=None)
    route_title = serializers.CharField(source="route.title", read_only=True, allow_null=True)
    route_code = serializers.CharField(source="route.code", read_only=True, allow_null=True)
    stop_name = serializers.CharField(source="stop.stop_name", read_only=True, allow_null=True)
    vehicle_no = serializers.CharField(source="vehicle.vehicle_no", read_only=True, allow_null=True)

    class Meta:
        model = StudentTransportAllocation
        fields = [
            "id", "academic_year", "student", "student_name", "admission_no", "roll_no", "class_name", "section_name",
            "class_id", "section_id", "guardian_name", "guardian_phone",
            "route", "route_title", "route_code", "stop", "stop_name", "vehicle", "vehicle_no",
            "status", "monthly_fare", "start_date", "notes", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "academic_year", "created_at", "updated_at"]

    def get_student_name(self, obj):
        return f"{obj.student.first_name} {obj.student.last_name}".strip()

    def get_class_name(self, obj):
        return getattr(obj.student.current_class, "name", None)

    def get_section_name(self, obj):
        return getattr(obj.student.current_section, "name", None)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        route = attrs.get("route", getattr(self.instance, "route", None))
        stop = attrs.get("stop", getattr(self.instance, "stop", None))
        status = attrs.get("status", getattr(self.instance, "status", "pending"))
        if stop is not None and (route is None or stop.route_id != route.id):
            raise serializers.ValidationError({"stop": "The pickup point must belong to the selected route."})
        if status == "allocated" and (route is None or stop is None):
            raise serializers.ValidationError({"stop": "An allocated student needs a route and a pickup point."})
        if self.instance is None:
            student = attrs.get("student")
            year = academic_year_for(student) if student else None
            if student and StudentTransportAllocation.objects.filter(student=student, academic_year=year).exists():
                raise serializers.ValidationError({"student": "This student already has a transport allocation; edit it instead."})
        return attrs

    def _fill_defaults(self, validated_data, instance=None):
        status = validated_data.get("status", getattr(instance, "status", "pending"))
        route = validated_data.get("route", getattr(instance, "route", None))
        stop = validated_data.get("stop", getattr(instance, "stop", None))
        if status == "allocated":
            if validated_data.get("vehicle", getattr(instance, "vehicle", None)) is None:
                validated_data["vehicle"] = route_vehicle(route)
            if validated_data.get("monthly_fare", getattr(instance, "monthly_fare", None)) is None:
                validated_data["monthly_fare"] = default_fare(route, stop)
        else:
            validated_data["monthly_fare"] = None
        return validated_data

    @transaction.atomic
    def create(self, validated_data):
        student = validated_data["student"]
        validated_data.setdefault("school", student.school)
        validated_data["academic_year"] = academic_year_for(student)
        allocation = super().create(self._fill_defaults(validated_data))
        mirror_to_student(allocation)
        return allocation

    @transaction.atomic
    def update(self, instance, validated_data):
        validated_data.pop("student", None)  # an allocation always stays with its student
        allocation = super().update(instance, self._fill_defaults(validated_data, instance))
        mirror_to_student(allocation)
        return allocation


class BulkAllocationSerializer(serializers.Serializer):
    """Input for POST /transport-allocations/bulk-allocate/."""

    students = serializers.ListField(child=serializers.IntegerField(), allow_empty=False)
    route = serializers.PrimaryKeyRelatedField(queryset=TransportRoute.objects.all())
    stop = serializers.PrimaryKeyRelatedField(queryset=BusStop.objects.all())
    vehicle = serializers.PrimaryKeyRelatedField(queryset=Vehicle.objects.all(), required=False, allow_null=True)
    monthly_fare = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)

    def validate(self, attrs):
        from apps.students.models import Student

        request = self.context.get("request")
        school_id = getattr(getattr(request, "user", None), "school_id", None)
        route, stop, vehicle = attrs["route"], attrs["stop"], attrs.get("vehicle")
        if route.school_id != school_id:
            raise serializers.ValidationError({"route": "Invalid route."})
        if stop.route_id != route.id:
            raise serializers.ValidationError({"stop": "The pickup point must belong to the selected route."})
        if vehicle is not None and vehicle.school_id != school_id:
            raise serializers.ValidationError({"vehicle": "Invalid vehicle."})
        ids = set(attrs["students"])
        students = list(Student.objects.filter(id__in=ids, school_id=school_id, is_deleted=False))
        if len(students) != len(ids):
            raise serializers.ValidationError({"students": "One or more students were not found in your school."})
        attrs["student_objects"] = students
        return attrs


class AllocationIdsSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=False)


# Transport Attendance
class TransportAttendanceSerializer(serializers.ModelSerializer):
    """Read-only view of recorded register lines (writes go through the mark action)."""

    student_name = serializers.SerializerMethodField()
    admission_no = serializers.CharField(source="student.admission_no", read_only=True)
    stop_name = serializers.CharField(source="stop.stop_name", read_only=True, allow_null=True)
    vehicle_no = serializers.CharField(source="vehicle.vehicle_no", read_only=True, allow_null=True)

    class Meta:
        model = TransportAttendance
        fields = [
            "id", "student", "student_name", "admission_no", "allocation", "route", "stop", "stop_name",
            "vehicle", "vehicle_no", "date", "shift", "boarded", "late", "note", "scanned_at", "source",
            "marked_by", "created_at", "updated_at",
        ]
        read_only_fields = fields

    def get_student_name(self, obj):
        return f"{obj.student.first_name} {obj.student.last_name}".strip()


class AttendanceEntrySerializer(serializers.Serializer):
    student = serializers.IntegerField()
    boarded = serializers.BooleanField(required=False)
    late = serializers.BooleanField(required=False)
    note = serializers.CharField(required=False, allow_blank=True, max_length=255)


class AttendanceMarkSerializer(serializers.Serializer):
    """Input for POST /transport-attendance/mark/."""

    date = serializers.DateField()
    shift = serializers.ChoiceField(choices=[c for c, _ in TransportAttendance.SHIFT_CHOICES])
    entries = AttendanceEntrySerializer(many=True, allow_empty=False)


class AttendanceDayShiftSerializer(serializers.Serializer):
    date = serializers.DateField()
    shift = serializers.ChoiceField(choices=[c for c, _ in TransportAttendance.SHIFT_CHOICES])


# Maintenance
class VehicleServiceRecordSerializer(SchoolScopedRelationsMixin, serializers.ModelSerializer):
    """Service / repair job. `display_status` adds overdue / due soon (derived from service_date)."""

    school_scoped_relations = {"vehicle": "school_id"}

    vehicle_no = serializers.CharField(source="vehicle.vehicle_no", read_only=True)
    display_status = serializers.SerializerMethodField()

    class Meta:
        model = VehicleServiceRecord
        fields = [
            "id", "vehicle", "vehicle_no", "service_date", "service_type", "work_done", "cost", "odometer_km",
            "vendor", "status", "display_status", "completed_at", "notes", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "completed_at", "created_at", "updated_at"]
        extra_kwargs = {"cost": {"min_value": 0}}

    def get_display_status(self, obj):
        return service_display_status(obj)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        status = attrs.get("status", getattr(self.instance, "status", "scheduled"))
        service_date = attrs.get("service_date", getattr(self.instance, "service_date", None))
        if status == "completed" and service_date and service_date > timezone.localdate():
            raise serializers.ValidationError({"service_date": "A completed service can't be dated in the future."})
        return attrs

    def _stamp_completion(self, instance):
        if instance.status == "completed" and instance.completed_at is None:
            instance.completed_at = timezone.now()
            instance.save(update_fields=["completed_at"])
        elif instance.status != "completed" and instance.completed_at is not None:
            instance.completed_at = None
            instance.save(update_fields=["completed_at"])
        return instance

    def create(self, validated_data):
        validated_data.setdefault("school", validated_data["vehicle"].school)
        return self._stamp_completion(super().create(validated_data))

    def update(self, instance, validated_data):
        return self._stamp_completion(super().update(instance, validated_data))


class RecordIdsSerializer(serializers.Serializer):
    """Input for bulk actions (complete services, verify / delete fuel entries)."""

    ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=False)


# Fuel Management
class FuelEntrySerializer(SchoolScopedRelationsMixin, serializers.ModelSerializer):
    """
    Refuelling entry. amount, distance, km/L, baseline and anomaly are calculated
    (services/upkeep.py) and read-only. The odometer must sit between the
    vehicle's neighbouring entries so mileage stays meaningful.
    """

    school_scoped_relations = {"vehicle": "school_id"}

    vehicle_no = serializers.CharField(source="vehicle.vehicle_no", read_only=True)
    verified_by_name = serializers.SerializerMethodField()

    class Meta:
        model = FuelEntry
        fields = [
            "id", "vehicle", "vehicle_no", "date", "litres", "rate", "amount", "odometer_km", "station",
            "distance_km", "kml", "baseline_kml", "anomaly", "verified", "verified_by_name", "verified_at",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "amount", "distance_km", "kml", "baseline_kml", "anomaly", "verified", "verified_at",
            "created_at", "updated_at",
        ]
        extra_kwargs = {"litres": {"min_value": Decimal("0.01")}, "rate": {"min_value": Decimal("0.01")}}

    def get_verified_by_name(self, obj):
        user = obj.verified_by
        return (user.get_full_name() or user.username) if user else None

    def validate(self, attrs):
        attrs = super().validate(attrs)
        vehicle = attrs.get("vehicle") or getattr(self.instance, "vehicle", None)
        entry_date = attrs.get("date") or getattr(self.instance, "date", None)
        odometer = attrs.get("odometer_km", getattr(self.instance, "odometer_km", None))
        if entry_date and entry_date > timezone.localdate():
            raise serializers.ValidationError({"date": "Fuel can't be logged for a future date."})
        if vehicle and entry_date and odometer is not None:
            before, after = neighbouring_odometers(vehicle.id, entry_date, exclude_id=getattr(self.instance, "pk", None))
            if before is not None and odometer <= before:
                raise serializers.ValidationError({"odometer_km": f"Must be above the earlier reading ({before} km)."})
            if after is not None and odometer >= after:
                raise serializers.ValidationError({"odometer_km": f"Must be below the later reading ({after} km)."})
        return attrs

    def create(self, validated_data):
        validated_data.setdefault("school", validated_data["vehicle"].school)
        return super().create(validated_data)


# Reports
class TransportReportLogSerializer(serializers.ModelSerializer):
    generated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = TransportReportLog
        fields = ["id", "report", "period", "scope", "file_format", "generated_by_name", "created_at"]
        read_only_fields = ["id", "generated_by_name", "created_at"]

    def get_generated_by_name(self, obj):
        user = obj.generated_by
        return (user.get_full_name() or user.username) if user else None

    def validate_report(self, value):
        if value not in REPORT_KEYS:
            raise serializers.ValidationError("Unknown report.")
        return value


class ReportQuerySerializer(serializers.Serializer):
    """Query params for a report preview: ?route=&month=YYYY-MM&date=YYYY-MM-DD&shift=."""

    route = serializers.IntegerField(required=False, allow_null=True)
    month = serializers.RegexField(r"^\d{4}-(0[1-9]|1[0-2])$", required=False)
    date = serializers.DateField(required=False)
    shift = serializers.ChoiceField(choices=[c for c, _ in TransportAttendance.SHIFT_CHOICES], required=False)


# Transport Settings
def _require(condition, section, message):
    if not condition:
        raise serializers.ValidationError({section: message})


def _number(value, section, key, low, high, integer=True):
    try:
        number = int(value) if integer else float(value)
    except (TypeError, ValueError):
        raise serializers.ValidationError({section: f"{key} must be a number."})
    _require(low <= number <= high, section, f"{key} must be between {low} and {high}.")
    return number


def _hhmm(value, section, key):
    text = str(value or "")
    parts = text.split(":")
    ok = len(parts) == 2 and all(p.isdigit() for p in parts) and int(parts[0]) < 24 and int(parts[1]) < 60
    _require(ok, section, f"{key} must be a time like 06:30.")
    return f"{int(parts[0]):02d}:{int(parts[1]):02d}"


class TransportSettingsSerializer(serializers.Serializer):
    """
    GET returns the complete settings (saved values over defaults). PUT/PATCH take any
    subset of sections; each section given is validated and merged into what is saved.
    """

    SECTIONS = list(SETTINGS_DEFAULTS)

    geofence = serializers.DictField(required=False)
    shifts = serializers.DictField(required=False)
    thresholds = serializers.DictField(required=False)
    notifications = serializers.DictField(required=False)
    fees = serializers.DictField(required=False)
    fareSlabs = serializers.ListField(child=serializers.DictField(), required=False)
    reminders = serializers.DictField(required=False)

    def validate_geofence(self, value):
        lat, lng = value.get("lat"), value.get("lng")
        if (lat is None) != (lng is None):
            raise serializers.ValidationError("Set both latitude and longitude, or neither.")
        return {
            "lat": None if lat in (None, "") else _number(lat, "geofence", "lat", -90, 90, integer=False),
            "lng": None if lng in (None, "") else _number(lng, "geofence", "lng", -180, 180, integer=False),
            "radius": _number(value.get("radius", 150), "geofence", "radius", 20, 5000),
        }

    def validate_shifts(self, value):
        return {key: _hhmm(value.get(key, default), "shifts", key) for key, default in SETTINGS_DEFAULTS["shifts"].items()}

    def validate_thresholds(self, value):
        base = SETTINGS_DEFAULTS["thresholds"]
        return {
            "overspeed": _number(value.get("overspeed", base["overspeed"]), "thresholds", "overspeed", 10, 120),
            "lateMin": _number(value.get("lateMin", base["lateMin"]), "thresholds", "lateMin", 1, 120),
            "deviationM": _number(value.get("deviationM", base["deviationM"]), "thresholds", "deviationM", 50, 5000),
            "idleMin": _number(value.get("idleMin", base["idleMin"]), "thresholds", "idleMin", 1, 120),
            "sosEscalation": str(value.get("sosEscalation", base["sosEscalation"]))[:80],
        }

    def validate_notifications(self, value):
        base = SETTINGS_DEFAULTS["notifications"]
        result = {key: bool(value.get(key, default)) for key, default in base.items() if key != "language"}
        result["language"] = str(value.get("language", base["language"]))[:40]
        return result

    def validate_fees(self, value):
        base = SETTINGS_DEFAULTS["fees"]
        return {
            "billingCycle": str(value.get("billingCycle", base["billingCycle"]))[:30],
            "siblingConcession": _number(value.get("siblingConcession", base["siblingConcession"]), "fees", "siblingConcession", 0, 100),
        }

    def validate_fareSlabs(self, value):
        slabs = []
        for slab in value:
            start = _number(slab.get("from"), "fareSlabs", "from", 0, 500, integer=False)
            end = _number(slab.get("to"), "fareSlabs", "to", 0, 500, integer=False)
            fare = _number(slab.get("fare"), "fareSlabs", "fare", 0, 100000)
            _require(start < end, "fareSlabs", "Each slab's 'to' km must be greater than its 'from' km.")
            slabs.append({"from": start, "to": end, "fare": fare})
        slabs.sort(key=lambda s: s["from"])
        for previous, current in zip(slabs, slabs[1:]):
            _require(current["from"] >= previous["to"], "fareSlabs", "Fare slabs must not overlap.")
        return slabs

    def validate_reminders(self, value):
        base = SETTINGS_DEFAULTS["reminders"]
        return {
            **{key: _number(value.get(key, base[key]), "reminders", key, 1, 365)
               for key in ("vehicleDocsDays", "licenceDays", "firstAidDays")},
            "blockExpired": bool(value.get("blockExpired", base["blockExpired"])),
        }

    def save_for(self, school, user):
        row, _created = TransportSettings.objects.get_or_create(school=school)
        config = merged(row.config)
        config.update(self.validated_data)
        row.config = config
        row.updated_by = user
        row.save()
        return config
