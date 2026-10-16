import re
from rest_framework import serializers
from .models import (
    AcademicYear, Class, ClassPeriod, ClassRoom, ClassStream, LevelScheduleConfig, Section, Stream, Subject,
    Vehicle, TransportRoute, AssignVehicle,
    BusStop, BusLocation, TransportAlert, BusRoutePickupUpdate,
    VehicleDriverAssignment, TransportNotificationLog, RoutePerformanceLog,
    ItemCategory, ItemStore, Supplier, Item, ItemReceive, ItemReceiveChild,
    ItemIssue, ItemSell, ItemSellChild,
    Holiday,
)


class AcademicYearSerializer(serializers.ModelSerializer):
    YEAR_NAME_REGEX = re.compile(r"^\d{4}-\d{4}$")
    MIN_DURATION_DAYS = 270  # ~9 months

    # `name` is auto-generated from start/end dates inside validate(); not required from client.
    name = serializers.CharField(max_length=64, required=False, allow_blank=True)

    def _school_id(self):
        request = self.context.get("request")
        if self.instance and self.instance.school_id:
            return self.instance.school_id
        if request and getattr(request.user, "school_id", None):
            return request.user.school_id
        return None

    def _raise_validation(self, errors: dict):
        raise serializers.ValidationError(errors)

    def validate(self, attrs):
        attrs = super().validate(attrs)

        start_date = attrs.get("start_date") or getattr(self.instance, "start_date", None)
        end_date = attrs.get("end_date") or getattr(self.instance, "end_date", None)
        provided_name = (attrs.get("name") or "").strip()
        school_id = self._school_id()

        errors: dict[str, list[str]] = {}

        if not start_date:
            errors.setdefault("start_date", []).append("Start date is required.")
        if not end_date:
            errors.setdefault("end_date", []).append("End date is required.")

        generated_name = None
        if start_date and end_date:
            if start_date >= end_date:
                errors.setdefault("date", []).append("Start date must be before end date.")

            duration_days = (end_date - start_date).days
            if duration_days < self.MIN_DURATION_DAYS:
                errors.setdefault("date", []).append("Academic year must be at least 9 months long.")

            # School ERP standard: one academic year should cross into the next calendar year.
            if end_date.year != start_date.year + 1:
                errors.setdefault("date", []).append("Academic year must span across two consecutive calendar years.")

            generated_name = f"{start_date.year}-{end_date.year}"
            if not self.YEAR_NAME_REGEX.fullmatch(generated_name):
                errors.setdefault("year_name", []).append("Academic year must be in format YYYY-YYYY.")

            if provided_name and provided_name != generated_name:
                errors.setdefault("year_name", []).append(
                    f"Academic year name must match selected dates ({generated_name})."
                )

        if school_id and generated_name:
            duplicate_qs = AcademicYear.objects.filter(school_id=school_id, name=generated_name)
            if self.instance:
                duplicate_qs = duplicate_qs.exclude(pk=self.instance.pk)
            if duplicate_qs.exists():
                errors.setdefault("year_name", []).append("Academic year already exists")

            overlap_qs = AcademicYear.objects.filter(
                school_id=school_id,
                start_date__lte=end_date,
                end_date__gte=start_date,
            )
            if self.instance:
                overlap_qs = overlap_qs.exclude(pk=self.instance.pk)
            if overlap_qs.exists():
                errors.setdefault("date", []).append("Academic year date range overlaps an existing academic year.")

        if errors:
            self._raise_validation(errors)

        # Enforce ERP naming convention from date range (server-side source of truth).
        if generated_name:
            attrs["name"] = generated_name

        return attrs

    class Meta:
        model = AcademicYear
        fields = ["id", "school", "name", "board", "number_of_terms", "start_date", "end_date", "is_current", "is_active", "created_at", "updated_at"]
        read_only_fields = ["id", "school", "created_at", "updated_at"]


class SectionSerializer(serializers.ModelSerializer):
    NAME_REGEX = re.compile(r"^[A-Za-z0-9 ]+$")
    MAX_CAPACITY = 200
    MIN_CAPACITY = 1
    MAX_SECTIONS_PER_CLASS = 26

    def validate_name(self, value):
        cleaned = (value or "").strip()
        if not cleaned:
            raise serializers.ValidationError("Section name is required.")
        if not self.NAME_REGEX.fullmatch(cleaned):
            raise serializers.ValidationError("Section name can contain only alphanumeric characters.")
        return cleaned

    def validate(self, attrs):
        attrs = super().validate(attrs)

        school_class = attrs.get("school_class") or getattr(self.instance, "school_class", None)
        name = (attrs.get("name") or getattr(self.instance, "name", "") or "").strip()
        capacity = attrs.get("capacity", getattr(self.instance, "capacity", None))

        request = self.context.get("request")
        school_id = getattr(getattr(request, "user", None), "school_id", None)
        if school_class and school_id and school_class.school_id != school_id:
            raise serializers.ValidationError({"school_class": "Invalid class."})

        if capacity in (None, ""):
            raise serializers.ValidationError({"capacity": "Enter valid section capacity"})
        try:
            capacity_value = int(capacity)
        except (TypeError, ValueError):
            raise serializers.ValidationError({"capacity": "Enter valid section capacity"})

        if capacity_value < self.MIN_CAPACITY or capacity_value > self.MAX_CAPACITY:
            raise serializers.ValidationError({"capacity": "Enter valid section capacity"})
        attrs["capacity"] = capacity_value

        # Updates should always target one normalized section value.
        if self.instance is not None and "," in name:
            raise serializers.ValidationError({"name": "Update supports one section at a time. Use comma input only while adding sections."})

        if school_class and name:
            qs = Section.objects.filter(school_class=school_class, name__iexact=name)
            if self.instance is not None:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({"name": "Section name already exists"})

        if school_class and self.instance is None:
            current_count = Section.objects.filter(school_class=school_class).count()
            if current_count >= self.MAX_SECTIONS_PER_CLASS:
                raise serializers.ValidationError({"name": "Section limit reached for this class."})

        return attrs

    class Meta:
        model = Section
        fields = ["id", "school_class", "name", "capacity", "student_count", "created_at"]
        read_only_fields = ["id", "student_count", "created_at"]

    def get_student_count(self, obj):
        # Use annotation if available (avoids N+1), else fall back to query
        if hasattr(obj, '_student_count'):
            return obj._student_count
        from apps.students.models import Student
        return Student.objects.filter(current_section=obj, is_active=True).count()

    student_count = serializers.SerializerMethodField()


class ClassSerializer(serializers.ModelSerializer):
    MIN_CAPACITY = 1
    MAX_CAPACITY = 200

    sections = SectionSerializer(many=True, read_only=True)
    total_students = serializers.SerializerMethodField()
    capacity = serializers.IntegerField(required=False, write_only=True)
    streams = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=Stream.objects.all(),
        required=False,
    )
    stream_capacities = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        write_only=True,
        help_text="[{stream: <id>, capacity: <int 1-200>}, ...] — used for Senior Secondary (Grade 11/12).",
    )
    stream_details = serializers.SerializerMethodField(read_only=True)

    def get_total_students(self, obj):
        if hasattr(obj, '_total_students'):
            return obj._total_students
        from apps.students.models import Student
        return Student.objects.filter(current_class=obj, is_active=True).count()

    def get_stream_details(self, obj):
        rows = ClassStream.objects.filter(school_class=obj).select_related("stream").order_by("stream__name")
        return [
            {"id": r.stream.id, "name": r.stream.name, "is_active": r.stream.is_active, "capacity": r.capacity}
            for r in rows
        ]

    def validate_streams(self, value):
        school_id = self._school_id()
        if school_id:
            for stream in value:
                if stream.school_id != school_id:
                    raise serializers.ValidationError("Selected stream does not belong to your school.")
        return value

    def validate_stream_capacities(self, value):
        school_id = self._school_id()
        cleaned = []
        seen_ids = set()
        for idx, entry in enumerate(value or []):
            if not isinstance(entry, dict):
                raise serializers.ValidationError(f"Entry #{idx + 1} must be an object with stream and capacity.")
            try:
                stream_id = int(entry.get("stream"))
            except (TypeError, ValueError):
                raise serializers.ValidationError(f"Entry #{idx + 1} is missing a valid stream id.")
            if stream_id in seen_ids:
                raise serializers.ValidationError(f"Stream id {stream_id} is listed more than once.")
            seen_ids.add(stream_id)
            try:
                stream_obj = Stream.objects.get(pk=stream_id)
            except Stream.DoesNotExist:
                raise serializers.ValidationError(f"Stream id {stream_id} does not exist.")
            if school_id and stream_obj.school_id != school_id:
                raise serializers.ValidationError(f"Stream '{stream_obj.name}' does not belong to your school.")
            try:
                capacity_value = int(entry.get("capacity"))
            except (TypeError, ValueError):
                raise serializers.ValidationError(
                    f"Stream '{stream_obj.name}' capacity must be a whole number."
                )
            if capacity_value < self.MIN_CAPACITY or capacity_value > self.MAX_CAPACITY:
                raise serializers.ValidationError(
                    f"Stream '{stream_obj.name}' capacity must be between {self.MIN_CAPACITY} and {self.MAX_CAPACITY}."
                )
            cleaned.append({"stream": stream_obj, "capacity": capacity_value})
        return cleaned

    def validate_capacity(self, value):
        try:
            value_int = int(value)
        except (TypeError, ValueError):
            raise serializers.ValidationError("Capacity must be a whole number.")
        if value_int < self.MIN_CAPACITY or value_int > self.MAX_CAPACITY:
            raise serializers.ValidationError(
                f"Capacity must be between {self.MIN_CAPACITY} and {self.MAX_CAPACITY} students per section."
            )
        return value_int

    def validate(self, attrs):
        attrs = super().validate(attrs)
        name = attrs.get("name") or (self.instance.name if self.instance else "")
        normalized = Class.normalize_name(name) or name
        is_senior = normalized in ("Grade 11", "Grade 12")

        stream_caps = attrs.get("stream_capacities")
        streams_field = attrs.get("streams")

        if (stream_caps or streams_field) and not is_senior:
            raise serializers.ValidationError({
                "streams": "Streams can only be assigned to Grade 11 or Grade 12."
            })

        # If stream_capacities provided, ignore streams + class-level capacity for senior classes.
        if stream_caps:
            attrs["streams"] = None  # signal to skip plain ID set
        return attrs

    def _apply_stream_capacities(self, instance, stream_caps):
        # Replace existing ClassStream rows for this class.
        ClassStream.objects.filter(school_class=instance).delete()
        for entry in stream_caps:
            ClassStream.objects.create(
                school_class=instance,
                stream=entry["stream"],
                capacity=entry["capacity"],
            )

    def create(self, validated_data):
        validated_data.pop("capacity", None)
        stream_caps = validated_data.pop("stream_capacities", None)
        streams = validated_data.pop("streams", None)
        instance = super().create(validated_data)
        if stream_caps:
            self._apply_stream_capacities(instance, stream_caps)
        elif streams is not None:
            # Backward-compat: ids without capacities — use default 35.
            self._apply_stream_capacities(
                instance,
                [{"stream": s, "capacity": 35} for s in streams],
            )
        return instance

    def update(self, instance, validated_data):
        validated_data.pop("capacity", None)
        stream_caps = validated_data.pop("stream_capacities", None)
        streams = validated_data.pop("streams", None)
        instance = super().update(instance, validated_data)
        if stream_caps is not None:
            self._apply_stream_capacities(instance, stream_caps)
        elif streams is not None:
            self._apply_stream_capacities(
                instance,
                [{"stream": s, "capacity": 35} for s in streams],
            )
        return instance

    def _school_id(self):
        request = self.context.get("request")
        if self.instance and self.instance.school_id:
            return self.instance.school_id
        if request and getattr(request.user, "school_id", None):
            return request.user.school_id
        return None

    def validate_name(self, value):
        cleaned = Class.normalize_name(value)
        if not cleaned:
            raise serializers.ValidationError("Class name must be Nursery, LKG, UKG, or Grade 1 to Grade 12")

        school_id = self._school_id()
        if school_id and cleaned:
            duplicate_qs = Class.objects.filter(school_id=school_id)
            if self.instance is not None:
                duplicate_qs = duplicate_qs.exclude(pk=self.instance.pk)
            if any(Class.normalize_name(existing_name) == cleaned for existing_name in duplicate_qs.values_list("name", flat=True)):
                raise serializers.ValidationError("Class name already exists")

        return cleaned

    class Meta:
        model = Class
        fields = ["id", "school", "name", "numeric_order", "level", "is_active", "sections", "total_students", "capacity", "streams", "stream_capacities", "stream_details", "created_at"]
        read_only_fields = ["id", "school", "numeric_order", "level", "sections", "total_students", "stream_details", "created_at"]


class StreamSerializer(serializers.ModelSerializer):
    NAME_REGEX = re.compile(r"^[A-Za-z][A-Za-z0-9 /&.\-]{0,49}$")

    def _school_id(self):
        request = self.context.get("request")
        if self.instance and self.instance.school_id:
            return self.instance.school_id
        if request and getattr(request.user, "school_id", None):
            return request.user.school_id
        return None

    def validate_name(self, value):
        cleaned = " ".join((value or "").strip().split())
        if not cleaned:
            raise serializers.ValidationError("Stream name is required.")
        if not self.NAME_REGEX.fullmatch(cleaned):
            raise serializers.ValidationError(
                "Stream name must start with a letter and contain only letters, numbers, spaces, / & . -."
            )
        school_id = self._school_id()
        if school_id:
            duplicate_qs = Stream.objects.filter(school_id=school_id, name__iexact=cleaned)
            if self.instance is not None:
                duplicate_qs = duplicate_qs.exclude(pk=self.instance.pk)
            if duplicate_qs.exists():
                raise serializers.ValidationError("A stream with this name already exists.")
        return cleaned

    class Meta:
        model = Stream
        fields = ["id", "school", "name", "is_active", "created_at"]
        read_only_fields = ["id", "school", "created_at"]


class SubjectSerializer(serializers.ModelSerializer):
    SUBJECT_NAME_REGEX = re.compile(r"^[A-Za-z ]+$")
    SUBJECT_CODE_REGEX = re.compile(r"^[A-Za-z0-9]+$")

    def _school_id(self):
        request = self.context.get("request")
        if self.instance and self.instance.school_id:
            return self.instance.school_id
        if request and getattr(request.user, "school_id", None):
            return request.user.school_id
        return None

    def _raise_validation(self, errors: dict):
        raise serializers.ValidationError(errors)

    def validate(self, attrs):
        attrs = super().validate(attrs)

        school_id = self._school_id()
        raw_name = attrs.get("name", getattr(self.instance, "name", ""))
        raw_code = attrs.get("code", getattr(self.instance, "code", ""))
        raw_subject_type = attrs.get("subject_type", getattr(self.instance, "subject_type", ""))

        name = (raw_name or "").strip()
        code = (raw_code or "").strip().upper()
        subject_type = (raw_subject_type or "").strip().lower()

        errors: dict[str, list[str]] = {}

        # Name rules: required, >=2 chars, letters+spaces only, unique (case-insensitive).
        if not name:
            errors.setdefault("name", []).append("Subject name is required.")
        elif len(name) < 2:
            errors.setdefault("name", []).append("Subject name must be at least 2 characters.")
        elif not self.SUBJECT_NAME_REGEX.fullmatch(name):
            errors.setdefault("name", []).append("Subject name can contain only letters and spaces.")

        # Code rules: required, alphanumeric, 3-10 chars, unique.
        if not code:
            errors.setdefault("code", []).append("Subject code is required.")
        elif not self.SUBJECT_CODE_REGEX.fullmatch(code):
            errors.setdefault("code", []).append("Subject code must be alphanumeric.")
        elif len(code) < 3 or len(code) > 10:
            errors.setdefault("code", []).append("Subject code length must be between 3 and 10 characters.")

        # Type rules: Compulsory, Optional, or Elective.
        if subject_type not in {"compulsory", "optional", "elective"}:
            errors.setdefault("subject_type", []).append("Subject type must be Compulsory, Optional, or Elective.")

        if school_id and name:
            name_qs = Subject.objects.filter(school_id=school_id, name__iexact=name)
            if self.instance is not None:
                name_qs = name_qs.exclude(pk=self.instance.pk)
            if name_qs.exists():
                errors.setdefault("name", []).append("Subject name already exists.")

        if school_id and code:
            code_qs = Subject.objects.filter(school_id=school_id, code__iexact=code)
            if self.instance is not None:
                code_qs = code_qs.exclude(pk=self.instance.pk)
            if code_qs.exists():
                errors.setdefault("code", []).append("Subject code already exists.")

        if errors:
            self._raise_validation(errors)

        attrs["name"] = name
        attrs["code"] = code
        attrs["subject_type"] = subject_type
        return attrs

    class Meta:
        model = Subject
        fields = ["id", "school", "name", "code", "subject_type", "created_at"]
        read_only_fields = ["id", "school", "created_at"]


class ClassPeriodSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClassPeriod
        fields = ["id", "school", "period", "start_time", "end_time", "period_type", "is_break", "created_at", "updated_at"]
        read_only_fields = ["id", "school", "created_at", "updated_at"]


class LevelScheduleConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = LevelScheduleConfig
        fields = [
            "id", "school", "academic_year", "level_group",
            "start_time", "end_time", "period_duration_minutes", "periods_per_day",
            "snack_break_after_period", "snack_break_minutes",
            "lunch_break_after_period", "lunch_break_minutes",
            "bus_dispersal_time", "pickup_time", "working_days", "is_configured",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "school", "periods_per_day", "created_at", "updated_at"]

    @staticmethod
    def _to_minutes(value):
        if value is None:
            return None
        return value.hour * 60 + value.minute

    def validate(self, attrs):
        attrs = super().validate(attrs)
        get = lambda key: attrs.get(key, getattr(self.instance, key, None))

        start_time = get("start_time")
        end_time = get("end_time")
        period_duration = get("period_duration_minutes")
        bus_dispersal = get("bus_dispersal_time")
        pickup_time = get("pickup_time")
        snack_after = get("snack_break_after_period")
        snack_minutes = get("snack_break_minutes")
        lunch_after = get("lunch_break_after_period")
        lunch_minutes = get("lunch_break_minutes")

        start_m = self._to_minutes(start_time)
        end_m = self._to_minutes(end_time)
        if start_m is not None and end_m is not None and end_m <= start_m:
            raise serializers.ValidationError({"end_time": "End time must be after start time."})

        bus_m = self._to_minutes(bus_dispersal)
        if bus_m is not None and end_m is not None:
            if bus_m < end_m:
                raise serializers.ValidationError(
                    {"bus_dispersal_time": "Bus dispersal time cannot be before the school end time."}
                )
            if bus_m > end_m + 60:
                raise serializers.ValidationError(
                    {"bus_dispersal_time": "Bus dispersal time should be within an hour of the school end time."}
                )

        pickup_m = self._to_minutes(pickup_time)
        if pickup_m is not None and start_m is not None and pickup_m > start_m:
            raise serializers.ValidationError(
                {"pickup_time": "Pick-up time should be before the school start time."}
            )

        if start_m is not None and end_m is not None and period_duration:
            break_minutes = (snack_minutes or 0 if snack_after else 0) + (lunch_minutes or 0 if lunch_after else 0)
            teaching_minutes = max(0, (end_m - start_m) - break_minutes)
            max_periods = max(1, teaching_minutes // period_duration)
            attrs["periods_per_day"] = max_periods

        return attrs


class ClassRoomSerializer(serializers.ModelSerializer):
    ROOM_NO_REGEX = re.compile(r"^[A-Z0-9][A-Z0-9\- ]{0,49}$")
    section_label = serializers.SerializerMethodField()

    def get_section_label(self, obj):
        if obj.section_id and obj.section:
            cls = getattr(obj.section, "school_class", None)
            cls_name = getattr(cls, "name", "") if cls else ""
            return f"{cls_name} - {obj.section.name}".strip(" -")
        return ""

    def _school_id(self):
        request = self.context.get("request")
        if self.instance and self.instance.school_id:
            return self.instance.school_id
        if request and getattr(request.user, "school_id", None):
            return request.user.school_id
        return None

    def validate(self, attrs):
        attrs = super().validate(attrs)

        room_no_raw = attrs.get("room_no", getattr(self.instance, "room_no", ""))
        room_no = (room_no_raw or "").strip().upper()
        capacity = attrs.get("capacity", getattr(self.instance, "capacity", None))

        errors = {}

        if not room_no:
            errors.setdefault("room_no", []).append("Room no is required")
        elif not self.ROOM_NO_REGEX.fullmatch(room_no):
            errors.setdefault("room_no", []).append("Enter a valid room number.")

        if capacity in (None, ""):
            errors.setdefault("capacity", []).append("Capacity is required")
        else:
            try:
                capacity_value = int(capacity)
            except (TypeError, ValueError):
                errors.setdefault("message", []).append("Capacity must be numeric")
            else:
                if capacity_value <= 0:
                    errors.setdefault("message", []).append("Capacity must be greater than zero")
                if capacity_value > 200:
                    errors.setdefault("capacity", []).append("Capacity must not exceed 200")
                attrs["capacity"] = capacity_value

        school_id = self._school_id()
        if school_id and room_no:
            duplicate_qs = ClassRoom.objects.filter(school_id=school_id, room_no__iexact=room_no)
            if self.instance is not None:
                duplicate_qs = duplicate_qs.exclude(pk=self.instance.pk)
            if duplicate_qs.exists():
                errors.setdefault("message", []).append("Room already exists")

        if errors:
            raise serializers.ValidationError(errors)

        attrs["room_no"] = room_no
        if "floor" in attrs:
            attrs["floor"] = (attrs.get("floor") or "").strip()

        section = attrs.get("section")
        if section and school_id and section.school_class.school_id != school_id:
            raise serializers.ValidationError({"section": ["Section does not belong to this school."]})

        return attrs

    class Meta:
        model = ClassRoom
        fields = ["id", "school", "room_no", "floor", "capacity", "section", "section_label", "active_status", "created_at", "updated_at"]
        read_only_fields = ["id", "school", "section_label", "created_at", "updated_at"]


# ===== TRANSPORT MODULE SERIALIZERS =====
class VehicleSerializer(serializers.ModelSerializer):
    driver_name = serializers.SerializerMethodField()

    def get_driver_name(self, obj):
        if obj.driver:
            return f"{obj.driver.first_name} {obj.driver.last_name}".strip()
        return None

    class Meta:
        model = Vehicle
        fields = [
            "id", "school", "academic_year", "vehicle_no", "vehicle_model", "made_year", "note",
            "driver", "driver_name", "active_status", "current_latitude", "current_longitude",
            "current_speed", "status", "last_location_update", "next_stop", "is_tracking_active",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "school", "academic_year", "created_at", "updated_at"]

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is not None:
            school_id = getattr(user, "school_id", None)
            driver = attrs.get("driver") or getattr(self.instance, "driver", None)
            if driver is not None and driver.school_id != school_id:
                raise serializers.ValidationError({"driver": "Invalid driver."})
        return attrs


class TransportRouteSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransportRoute
        fields = ["id", "school", "academic_year", "title", "fare", "active_status", "created_at", "updated_at"]
        read_only_fields = ["id", "school", "academic_year", "created_at", "updated_at"]


class AssignVehicleSerializer(serializers.ModelSerializer):
    vehicle_no = serializers.CharField(source="vehicle.vehicle_no", read_only=True)
    route_title = serializers.CharField(source="route.title", read_only=True)

    class Meta:
        model = AssignVehicle
        fields = ["id", "school", "academic_year", "vehicle", "vehicle_no", "route", "route_title", "active_status", "created_at", "updated_at"]
        read_only_fields = ["id", "school", "academic_year", "created_at", "updated_at"]

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is not None:
            school_id = getattr(user, "school_id", None)
            for field_name in ("vehicle", "route"):
                related = attrs.get(field_name) or getattr(self.instance, field_name, None)
                if related is not None and related.school_id != school_id:
                    raise serializers.ValidationError({field_name: f"Invalid {field_name}."})
        return attrs


# ===== BUS TRACKING MODULE SERIALIZERS =====
class BusStopSerializer(serializers.ModelSerializer):
    route_title = serializers.CharField(source="route.title", read_only=True)

    class Meta:
        model = BusStop
        fields = [
            "id",
            "route",
            "route_title",
            "stop_name",
            "latitude",
            "longitude",
            "stop_order",
            "stop_type",
            "scheduled_time",
            "geofence_radius",
            "arrival_time_window",
            "active_status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is not None:
            school_id = getattr(user, "school_id", None)
            route = attrs.get("route") or getattr(self.instance, "route", None)
            if route is not None and route.school_id != school_id:
                raise serializers.ValidationError({"route": "Invalid route."})
        return attrs


class BusLocationSerializer(serializers.ModelSerializer):
    vehicle_no = serializers.CharField(source="vehicle.vehicle_no", read_only=True)

    class Meta:
        model = BusLocation
        fields = ["id", "vehicle", "vehicle_no", "latitude", "longitude", "speed", "heading", "accuracy", "timestamp", "is_active"]
        read_only_fields = ["id", "timestamp"]


class TransportAlertSerializer(serializers.ModelSerializer):
    vehicle_no = serializers.CharField(source="vehicle.vehicle_no", read_only=True)
    route_title = serializers.CharField(source="route.title", read_only=True, allow_null=True)

    class Meta:
        model = TransportAlert
        fields = ["id", "vehicle", "vehicle_no", "route", "route_title", "alert_type", "message", "severity", "latitude", "longitude", "is_resolved", "created_at", "resolved_at"]
        read_only_fields = ["id", "created_at"]

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is not None:
            school_id = getattr(user, "school_id", None)
            for field_name in ("vehicle", "route"):
                related = attrs.get(field_name) or getattr(self.instance, field_name, None)
                if related is not None and related.school_id != school_id:
                    raise serializers.ValidationError({field_name: f"Invalid {field_name}."})
        return attrs


class BusRoutePickupUpdateSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    stop_name = serializers.CharField(source="stop.stop_name", read_only=True)
    vehicle_no = serializers.CharField(source="vehicle.vehicle_no", read_only=True)

    class Meta:
        model = BusRoutePickupUpdate
        fields = ["id", "stop", "stop_name", "vehicle", "vehicle_no", "student", "student_name", "arrived_at", "picked_up_at", "status"]
        read_only_fields = ["id"]


class VehicleDriverAssignmentSerializer(serializers.ModelSerializer):
    vehicle_no = serializers.CharField(source="vehicle.vehicle_no", read_only=True)
    driver_name = serializers.SerializerMethodField()

    def get_driver_name(self, obj):
        driver = obj.driver
        if not driver:
            return None
        return f"{driver.first_name} {driver.last_name}".strip()

    class Meta:
        model = VehicleDriverAssignment
        fields = [
            "id", "vehicle", "vehicle_no", "driver", "driver_name", "assigned_from", "assigned_to",
            "is_primary", "active_status", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is not None:
            school_id = getattr(user, "school_id", None)
            for field_name in ("vehicle", "driver"):
                related = attrs.get(field_name) or getattr(self.instance, field_name, None)
                if related is not None and related.school_id != school_id:
                    raise serializers.ValidationError({field_name: f"Invalid {field_name}."})
        return attrs


class TransportNotificationLogSerializer(serializers.ModelSerializer):
    vehicle_no = serializers.CharField(source="vehicle.vehicle_no", read_only=True)

    class Meta:
        model = TransportNotificationLog
        fields = [
            "id", "vehicle", "vehicle_no", "student", "channel", "provider", "recipient", "message",
            "status", "error_message", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class RoutePerformanceLogSerializer(serializers.ModelSerializer):
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


# ===== INVENTORY MODULE SERIALIZERS =====
class ItemCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ItemCategory
        fields = ["id", "school", "title", "description", "is_active", "created_at", "updated_at"]
        read_only_fields = ["id", "school", "created_at", "updated_at"]


class ItemStoreSerializer(serializers.ModelSerializer):
    class Meta:
        model = ItemStore
        fields = ["id", "school", "title", "description", "location", "is_active", "created_at", "updated_at"]
        read_only_fields = ["id", "school", "created_at", "updated_at"]


class SupplierSerializer(serializers.ModelSerializer):
    def validate_phone(self, value):
        phone = str(value or "").strip()
        if not phone:
            return ""
        if not re.fullmatch(r"\d{1,12}", phone):
            raise serializers.ValidationError("Phone number must contain digits only and must not exceed 12 digits.")
        return phone

    class Meta:
        model = Supplier
        fields = ["id", "school", "name", "contact_person", "email", "phone", "address", "city", "country", "tax_id", "payment_terms", "is_active", "created_at", "updated_at"]
        read_only_fields = ["id", "school", "created_at", "updated_at"]


class ItemSerializer(serializers.ModelSerializer):
    category_title = serializers.CharField(source="category.title", read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)

    class Meta:
        model = Item
        fields = ["id", "school", "category", "category_title", "item_code", "name", "description", "unit", "quantity", "reorder_level", "unit_cost", "unit_price", "supplier", "supplier_name", "item_photo", "is_active", "created_at", "updated_at"]
        read_only_fields = ["id", "school", "created_at", "updated_at"]


class ItemReceiveChildSerializer(serializers.ModelSerializer):
    item_name = serializers.CharField(source="item.name", read_only=True)
    item_code = serializers.CharField(source="item.item_code", read_only=True)

    class Meta:
        model = ItemReceiveChild
        fields = ["id", "receive", "item", "item_name", "item_code", "quantity", "unit_cost", "total_cost"]
        read_only_fields = ["id", "total_cost"]

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is not None:
            school_id = getattr(user, "school_id", None)
            item = attrs.get("item") or getattr(self.instance, "item", None)
            if item is not None and item.school_id != school_id:
                raise serializers.ValidationError({"item": "Invalid item."})
        return attrs


class ItemReceiveSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    line_items = ItemReceiveChildSerializer(many=True, read_only=True)
    created_by_name = serializers.CharField(source="created_by.first_name", read_only=True)

    class Meta:
        model = ItemReceive
        fields = ["id", "school", "supplier", "supplier_name", "receive_date", "total_amount", "discount", "tax", "payment_status", "paid_amount", "reference_no", "notes", "line_items", "created_by", "created_by_name", "created_at", "updated_at"]
        read_only_fields = ["id", "school", "created_at", "updated_at"]

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is not None:
            school_id = getattr(user, "school_id", None)
            supplier = attrs.get("supplier") or getattr(self.instance, "supplier", None)
            if supplier is not None and supplier.school_id != school_id:
                raise serializers.ValidationError({"supplier": "Invalid supplier."})
        return attrs


class ItemIssueSerializer(serializers.ModelSerializer):
    store_title = serializers.CharField(source="store.title", read_only=True)
    issued_by_name = serializers.CharField(source="issued_by.first_name", read_only=True)

    class Meta:
        model = ItemIssue
        fields = ["id", "school", "issue_date", "store", "store_title", "subject", "notes", "issued_by", "issued_by_name", "created_at", "updated_at"]
        read_only_fields = ["id", "school", "created_at", "updated_at"]


class ItemSellChildSerializer(serializers.ModelSerializer):
    item_name = serializers.CharField(source="item.name", read_only=True)
    item_code = serializers.CharField(source="item.item_code", read_only=True)

    class Meta:
        model = ItemSellChild
        fields = ["id", "sell", "item", "item_name", "item_code", "quantity", "unit_price", "total_price"]
        read_only_fields = ["id", "total_price"]

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is not None:
            school_id = getattr(user, "school_id", None)
            item = attrs.get("item") or getattr(self.instance, "item", None)
            if item is not None and item.school_id != school_id:
                raise serializers.ValidationError({"item": "Invalid item."})
        return attrs


class ItemSellSerializer(serializers.ModelSerializer):
    line_items = ItemSellChildSerializer(many=True, read_only=True)
    created_by_name = serializers.CharField(source="created_by.first_name", read_only=True)

    class Meta:
        model = ItemSell
        fields = ["id", "school", "sell_date", "total_amount", "discount", "tax", "payment_status", "paid_amount", "reference_no", "notes", "sold_to", "line_items", "created_by", "created_by_name", "created_at", "updated_at"]
        read_only_fields = ["id", "school", "created_at", "updated_at"]


class HolidaySerializer(serializers.ModelSerializer):
    type_label = serializers.SerializerMethodField()
    duration_days = serializers.SerializerMethodField()

    def get_type_label(self, obj):
        return dict(Holiday.TYPE_CHOICES).get(obj.holiday_type, obj.holiday_type)

    def get_duration_days(self, obj):
        if obj.end_date and obj.end_date > obj.date:
            return (obj.end_date - obj.date).days + 1
        return 1

    def _school_id(self):
        request = self.context.get("request")
        if self.instance and getattr(self.instance, "school_id", None):
            return self.instance.school_id
        if request and getattr(request.user, "school_id", None):
            return request.user.school_id
        return None

    def validate_name(self, value):
        cleaned = (value or "").strip()
        if not cleaned:
            raise serializers.ValidationError("Holiday name is required.")
        if len(cleaned) < 2:
            raise serializers.ValidationError("Holiday name must be at least 2 characters.")
        if len(cleaned) > 120:
            raise serializers.ValidationError("Holiday name must be 120 characters or less.")
        if not re.fullmatch(r"[A-Za-z\s'.-]+", cleaned):
            raise serializers.ValidationError("Holiday name can only contain letters, spaces, and '.- characters.")
        if len(set(cleaned.replace(" ", "").lower())) == 1 and len(cleaned.replace(" ", "")) >= 2:
            raise serializers.ValidationError("Please enter a real holiday name.")
        return cleaned

    def validate(self, attrs):
        attrs = super().validate(attrs)
        date = attrs.get("date", getattr(self.instance, "date", None))
        end_date = attrs.get("end_date", getattr(self.instance, "end_date", None))
        name = attrs.get("name", getattr(self.instance, "name", ""))

        errors = {}
        if not date:
            errors["date"] = ["Date is required."]
        if end_date and date and end_date < date:
            errors["end_date"] = ["End date cannot be before start date."]
        if end_date and date and (end_date - date).days > 60:
            errors["end_date"] = ["Holiday span cannot exceed 60 days."]

        school_id = self._school_id()
        if school_id and date and name:
            dup_qs = Holiday.objects.filter(school_id=school_id, date=date, name__iexact=name.strip())
            if self.instance is not None:
                dup_qs = dup_qs.exclude(pk=self.instance.pk)
            if dup_qs.exists():
                errors["name"] = [f'A holiday named "{name}" already exists on {date}.']

        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    class Meta:
        model = Holiday
        fields = [
            "id", "school", "academic_year", "name", "date", "end_date",
            "holiday_type", "type_label", "description", "audience", "is_optional",
            "active_status", "duration_days",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "school", "type_label", "duration_days", "created_at", "updated_at"]

