"""
Transport models (moved from apps.core; tables and data unchanged via db_table).

Relationships reuse existing Eskoolia records instead of copying them: schools
(tenancy.School), academic years (core.AcademicYear), drivers (hr.Staff) and
students (students.Student) are all foreign keys.
"""
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Q


# Vehicle Models
VEHICLE_TYPE_CHOICES = [
    ("bus", "Bus"),
    ("mini_bus", "Mini-bus"),
    ("van", "Van"),
]

# Default seats per vehicle type, used when a vehicle has no explicit seating_capacity.
DEFAULT_CAPACITY_BY_TYPE = {"bus": 42, "mini_bus": 26, "van": 12}

OPERATIONAL_STATUS_CHOICES = [
    ("on_route", "On route"),
    ("active", "Active"),
    ("idle", "Idle"),
    ("under_maintenance", "Under maintenance"),
    ("breakdown", "Breakdown"),
]


class Vehicle(models.Model):
    """
    A school vehicle. Two independent status fields exist on purpose:
    `operational_status` is set by the transport desk (in service, breakdown, ...),
    while the GPS block (`status`, current_* fields) is written only by GPS updates.
    Archiving uses the existing `active_status` flag (False = archived).
    """
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="vehicles")
    academic_year = models.ForeignKey("core.AcademicYear", on_delete=models.CASCADE, related_name="vehicles")
    vehicle_no = models.CharField(max_length=255)
    vehicle_model = models.CharField(max_length=255)
    made_year = models.IntegerField(null=True, blank=True)
    note = models.TextField(blank=True)
    driver = models.ForeignKey("hr.Staff", on_delete=models.SET_NULL, null=True, blank=True, related_name="vehicles")
    active_status = models.BooleanField(default=True)
    # Fleet & compliance (Transport module). All optional so existing rows are untouched.
    vehicle_type = models.CharField(max_length=20, choices=VEHICLE_TYPE_CHOICES, default="bus")
    seating_capacity = models.PositiveIntegerField(
        null=True, blank=True, help_text="Seats; when blank the default for the vehicle type is used"
    )
    operational_status = models.CharField(max_length=20, choices=OPERATIONAL_STATUS_CHOICES, default="active")
    fitness_valid_till = models.DateField(null=True, blank=True)
    insurance_valid_till = models.DateField(null=True, blank=True)
    permit_valid_till = models.DateField(null=True, blank=True)
    pollution_valid_till = models.DateField(null=True, blank=True, help_text="Pollution under control (PUC) certificate")
    odometer_km = models.PositiveIntegerField(null=True, blank=True)
    # GPS & Tracking Fields
    current_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True, help_text="Current GPS latitude")
    current_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True, help_text="Current GPS longitude")
    current_speed = models.IntegerField(default=0, help_text="Current speed in km/h")
    status = models.CharField(
        max_length=20,
        choices=[
            ("idle", "Idle"),
            ("approaching_stop", "Approaching Stop"),
            ("at_stop", "At Stop"),
            ("in_transit", "In Transit"),
            ("offline", "Offline"),
        ],
        default="idle",
        help_text="Current vehicle status"
    )
    last_location_update = models.DateTimeField(null=True, blank=True, help_text="Last GPS update timestamp")
    next_stop = models.ForeignKey("BusStop", on_delete=models.SET_NULL, null=True, blank=True, related_name="buses_heading_to")
    is_tracking_active = models.BooleanField(default=False, help_text="Whether live GPS tracking is active")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "vehicles"
        ordering = ["vehicle_no"]
        constraints = [
            models.UniqueConstraint(fields=["school", "vehicle_no"], name="uq_vehicle_school_no"),
        ]

    def __str__(self):
        return self.vehicle_no


# Route and Stop Models
ROUTE_SHIFT_CHOICES = [
    ("both", "Morning + afternoon"),
    ("morning", "Morning only"),
    ("afternoon", "Afternoon only"),
]


class TransportRoute(models.Model):
    """A pickup/drop route. Its stops are BusStop rows; its bus comes from AssignVehicle."""

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="transport_routes")
    academic_year = models.ForeignKey("core.AcademicYear", on_delete=models.CASCADE, related_name="transport_routes")
    title = models.CharField(max_length=200)
    # Route-level default fare; a stop's monthly_fare overrides it when set.
    fare = models.DecimalField(max_digits=10, decimal_places=2)
    active_status = models.BooleanField(default=True)
    code = models.CharField(max_length=20, blank=True, default="", help_text="Short route code, e.g. R3")
    zone = models.CharField(max_length=40, blank=True, default="")
    shift = models.CharField(max_length=20, choices=ROUTE_SHIFT_CHOICES, default="both")
    first_pickup_time = models.TimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "transport_routes"
        ordering = ["title"]
        constraints = [
            models.UniqueConstraint(fields=["school", "title"], name="uq_transport_route_school_title"),
            # Codes are optional (existing routes have none) but must be unique per school when set.
            models.UniqueConstraint(
                fields=["school", "code"], condition=~Q(code=""), name="uq_transport_route_school_code"
            ),
        ]

    def __str__(self):
        return self.title


class AssignVehicle(models.Model):
    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="assign_vehicles")
    academic_year = models.ForeignKey("core.AcademicYear", on_delete=models.CASCADE, related_name="assign_vehicles")
    vehicle = models.ForeignKey("Vehicle", on_delete=models.CASCADE, related_name="assignments")
    route = models.ForeignKey("TransportRoute", on_delete=models.CASCADE, related_name="assignments")
    active_status = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "assign_vehicles"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["school", "vehicle", "route"], name="uq_assign_vehicle_school_vehicle_route"),
        ]

    def __str__(self):
        return f"{self.vehicle.vehicle_no} - {self.route.title}"


class BusStop(models.Model):
    """
    A stop on a route. This is also the "pickup point" of the Transport screens -
    the same record, so route stops and pickup points can never drift apart.
    """
    STOP_TYPE_CHOICES = [
        ("start", "Start"),
        ("middle", "Middle"),
        ("end", "End"),
    ]

    route = models.ForeignKey("TransportRoute", on_delete=models.CASCADE, related_name="stops")
    stop_name = models.CharField(max_length=200)  # e.g., "Madhya Pur", "School"
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    stop_order = models.IntegerField()  # 1, 2, 3... (sequence on route)
    stop_type = models.CharField(max_length=10, choices=STOP_TYPE_CHOICES, default="middle")
    scheduled_time = models.TimeField(null=True, blank=True)
    geofence_radius = models.IntegerField(default=100, help_text="Geofence radius in meters")
    arrival_time_window = models.CharField(max_length=50, blank=True, help_text="Expected arrival time e.g., '09:30-09:45'")
    landmark = models.CharField(max_length=200, blank=True, default="")
    # Per-stop monthly fare; null falls back to the route's fare.
    monthly_fare = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    drop_time = models.TimeField(null=True, blank=True, help_text="Afternoon drop time at this stop")
    active_status = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "bus_stops"
        ordering = ["route_id", "stop_order"]
        constraints = [
            models.UniqueConstraint(fields=["route", "stop_name"], name="uq_bus_stop_route_name"),
        ]

    def __str__(self):
        return f"{self.route.title} - {self.stop_name}"


# Live Tracking and GPS
class BusLocation(models.Model):
    """Real-time GPS location data for a vehicle"""
    vehicle = models.ForeignKey("Vehicle", on_delete=models.CASCADE, related_name="bus_locations")
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    speed = models.IntegerField(default=0, help_text="Speed in km/h")
    heading = models.IntegerField(default=0, help_text="Direction in degrees (0-360)")
    accuracy = models.IntegerField(default=0, help_text="GPS accuracy in meters")
    timestamp = models.DateTimeField(auto_now=True)  # Updated every location push
    is_active = models.BooleanField(default=True)  # False if vehicle is offline
    # True only for positions from the development simulator (manage.py simulate_bus_gps);
    # real device positions are always False, so simulated data can't pass as real GPS.
    is_simulated = models.BooleanField(default=False)

    class Meta:
        db_table = "bus_locations"
        ordering = ["-timestamp"]

    def __str__(self):
        return f"{self.vehicle.vehicle_no} @ {self.latitude},{self.longitude}"


class TransportAlert(models.Model):
    """
    Transport alerts (GPS-generated, raised by staff, or document expiries).

    Workflow: open -> acknowledged (owner claims it) -> resolved. The legacy
    `is_resolved` flag is kept in sync by save() so older clients keep working.
    """
    ALERT_TYPE_CHOICES = [
        ("stopped", "Bus Stopped >5 min"),
        ("running_late", "Running Late"),
        ("near_school", "Near School (<1km)"),
        ("arrived", "Arrived at Destination"),
        ("left", "Left Departure Point"),
        ("mechanical", "Mechanical Issue"),
        ("traffic", "Heavy Traffic Detected"),
        ("sos", "SOS"),
        ("overspeed", "Overspeed"),
        ("route_deviation", "Route Deviation"),
        ("breakdown", "Breakdown"),
        ("document_expiry", "Document Expiry"),
    ]
    STATE_CHOICES = [("open", "Open"), ("acknowledged", "Acknowledged"), ("resolved", "Resolved")]

    vehicle = models.ForeignKey("Vehicle", on_delete=models.CASCADE, related_name="bus_alerts")
    route = models.ForeignKey("TransportRoute", on_delete=models.SET_NULL, null=True, blank=True, related_name="bus_alerts")
    alert_type = models.CharField(max_length=20, choices=ALERT_TYPE_CHOICES)
    message = models.TextField()
    severity = models.CharField(max_length=10, choices=[("info", "Info"), ("warning", "Warning"), ("critical", "Critical")], default="info")
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    is_resolved = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    state = models.CharField(max_length=20, choices=STATE_CHOICES, default="open", db_index=True)
    # For document_expiry alerts: which Vehicle compliance field it is about
    # (e.g. "insurance_valid_till"), so renewing that document can resolve it.
    document = models.CharField(max_length=40, blank=True, default="")
    raised_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    acknowledged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        db_table = "transport_alerts"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.vehicle.vehicle_no} - {self.alert_type} ({self.severity})"

    def save(self, *args, **kwargs):
        # `is_resolved` (legacy API) and `state` (new API) always agree.
        if self.is_resolved:
            self.state = "resolved"
        elif self.state == "resolved":
            self.is_resolved = True
        super().save(*args, **kwargs)


class BusRoutePickupUpdate(models.Model):
    """Tracks pickup updates: when bus reaches a stop, marks students as picked up"""
    stop = models.ForeignKey("BusStop", on_delete=models.CASCADE, related_name="pickups")
    vehicle = models.ForeignKey("Vehicle", on_delete=models.CASCADE, related_name="stop_pickups")
    student = models.ForeignKey("students.Student", on_delete=models.CASCADE, related_name="bus_pickups")
    arrived_at = models.DateTimeField()
    picked_up_at = models.DateTimeField(null=True, blank=True)  # When student actually boarded
    status_choices = [
        ("waiting", "Waiting for Bus"),
        ("arrived", "Bus Arrived at Stop"),
        ("picked_up", "Student Picked Up"),
        ("missed", "Student Missed Bus"),
    ]
    status = models.CharField(max_length=20, choices=status_choices, default="waiting")

    class Meta:
        db_table = "bus_route_pickup_updates"
        ordering = ["-arrived_at"]

    def __str__(self):
        return f"{self.student} - {self.stop.stop_name} ({self.status})"


class VehicleDriverAssignment(models.Model):
    """Supports multiple drivers per vehicle with primary assignment."""

    vehicle = models.ForeignKey("Vehicle", on_delete=models.CASCADE, related_name="driver_assignments")
    driver = models.ForeignKey("hr.Staff", on_delete=models.CASCADE, related_name="vehicle_assignments")
    assigned_from = models.DateField(null=True, blank=True)
    assigned_to = models.DateField(null=True, blank=True)
    is_primary = models.BooleanField(default=False)
    active_status = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "vehicle_driver_assignments"
        ordering = ["-is_primary", "-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["vehicle", "driver"], name="uq_vehicle_driver_pair"),
        ]

    def __str__(self):
        return f"{self.vehicle.vehicle_no} -> {self.driver_id}"


class TransportNotificationLog(models.Model):
    """Stores SMS/Email notification attempts for transport events."""

    CHANNEL_CHOICES = [("sms", "SMS"), ("email", "Email")]
    STATUS_CHOICES = [("sent", "Sent"), ("failed", "Failed"), ("skipped", "Skipped")]

    vehicle = models.ForeignKey("Vehicle", on_delete=models.CASCADE, related_name="notification_logs")
    student = models.ForeignKey("students.Student", on_delete=models.SET_NULL, null=True, blank=True, related_name="transport_notifications")
    channel = models.CharField(max_length=10, choices=CHANNEL_CHOICES)
    provider = models.CharField(max_length=30, blank=True)
    recipient = models.CharField(max_length=120)
    message = models.TextField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="skipped")
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "transport_notification_logs"
        ordering = ["-created_at"]


class RoutePerformanceLog(models.Model):
    """Daily route analytics (distance, delay, speed, stop completion)."""

    route = models.ForeignKey("TransportRoute", on_delete=models.CASCADE, related_name="performance_logs")
    vehicle = models.ForeignKey("Vehicle", on_delete=models.CASCADE, related_name="performance_logs")
    log_date = models.DateField()
    total_distance_km = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal("0.000"))
    avg_speed_kmh = models.DecimalField(max_digits=7, decimal_places=2, default=Decimal("0.00"))
    delay_minutes = models.IntegerField(default=0)
    completed_stops = models.PositiveIntegerField(default=0)
    total_stops = models.PositiveIntegerField(default=0)
    completed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "route_performance_logs"
        ordering = ["-log_date", "-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["route", "vehicle", "log_date"], name="uq_route_vehicle_date_log"),
        ]



# Driver and Attendant Profiles
class TransportStaffProfile(models.Model):
    """
    Transport details for an existing HR staff member who works as a driver or
    attendant. Personal details (name, phone, licence number) stay on hr.Staff -
    this only adds what HR doesn't track, so no second staff record is created.

    Drivers drive the vehicle whose Vehicle.driver points at them (existing link);
    attendants ride `assigned_vehicle`.
    """

    ROLE_CHOICES = [("driver", "Driver"), ("attendant", "Attendant")]
    SHIFT_CHOICES = [
        ("full_day", "Full day - morning + afternoon"),
        ("morning", "Morning shift only"),
        ("relief", "Relief & reserve"),
    ]
    DUTY_STATUS_CHOICES = [
        ("on_duty", "On duty"),
        ("on_route", "On route"),
        ("off_duty", "Off duty"),
        ("on_leave", "On leave"),
        ("inactive", "Inactive"),
    ]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="transport_staff_profiles")
    staff = models.OneToOneField("hr.Staff", on_delete=models.CASCADE, related_name="transport_profile")
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    shift = models.CharField(max_length=20, choices=SHIFT_CHOICES, default="full_day")
    duty_status = models.CharField(max_length=20, choices=DUTY_STATUS_CHOICES, default="off_duty")
    experience_years = models.PositiveSmallIntegerField(null=True, blank=True)
    # Drivers: the licence number itself lives on hr.Staff.driving_license.
    licence_valid_till = models.DateField(null=True, blank=True)
    badge_number = models.CharField(max_length=40, blank=True, default="")
    # Attendants
    first_aid_certificate_no = models.CharField(max_length=60, blank=True, default="")
    first_aid_valid_till = models.DateField(null=True, blank=True)
    assigned_vehicle = models.ForeignKey(
        "Vehicle", on_delete=models.SET_NULL, null=True, blank=True, related_name="attendant_profiles"
    )
    rating = models.DecimalField(max_digits=2, decimal_places=1, null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "transport_staff_profiles"
        ordering = ["role", "staff__first_name"]

    def __str__(self):
        return f"{self.staff} ({self.role})"


# Student Transport Allocation
class StudentTransportAllocation(models.Model):
    """
    Links an existing Student to a route, pickup point (BusStop) and vehicle for an
    academic year. Class/section come from the Student record - nothing is copied.

    Status: allocated (has a seat), pending (requested, awaiting a stop),
    waitlisted (route full). Student.transport_route / Student.vehicle are kept
    as a mirror of the allocated route/vehicle for existing reports and portals.
    """

    STATUS_CHOICES = [("allocated", "Allocated"), ("pending", "Pending"), ("waitlisted", "Waitlisted")]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="transport_allocations")
    academic_year = models.ForeignKey(
        "core.AcademicYear", on_delete=models.CASCADE, null=True, blank=True, related_name="transport_allocations"
    )
    student = models.ForeignKey("students.Student", on_delete=models.CASCADE, related_name="transport_allocations")
    route = models.ForeignKey(
        "TransportRoute", on_delete=models.SET_NULL, null=True, blank=True, related_name="allocations"
    )
    stop = models.ForeignKey("BusStop", on_delete=models.SET_NULL, null=True, blank=True, related_name="allocations")
    vehicle = models.ForeignKey("Vehicle", on_delete=models.SET_NULL, null=True, blank=True, related_name="allocations")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending", db_index=True)
    # Monthly fare for this student; defaults to the stop's (or route's) fare when allocated.
    monthly_fare = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    start_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "transport_allocations"
        ordering = ["student__first_name", "student__last_name"]
        constraints = [
            # One allocation per student per academic year.
            models.UniqueConstraint(fields=["student", "academic_year"], name="uq_transport_allocation_student_year"),
        ]

    def __str__(self):
        return f"{self.student} - {self.status}"


# Transport Attendance
class TransportAttendance(models.Model):
    """
    One boarding-register line: an allocated student on a date and shift.
    Afternoon "boarded" means dropped. Unique per (student, date, shift).
    """

    SHIFT_CHOICES = [("morning", "Morning pickup"), ("afternoon", "Afternoon drop")]
    SOURCE_CHOICES = [("manual", "Manual"), ("gps", "GPS geofence"), ("rfid", "RFID scan")]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="transport_attendance")
    student = models.ForeignKey("students.Student", on_delete=models.CASCADE, related_name="transport_attendance")
    allocation = models.ForeignKey(
        "StudentTransportAllocation", on_delete=models.SET_NULL, null=True, blank=True, related_name="attendance"
    )
    # Snapshot of where the student rode that day (allocations can change later).
    route = models.ForeignKey("TransportRoute", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    stop = models.ForeignKey("BusStop", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    vehicle = models.ForeignKey("Vehicle", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    date = models.DateField(db_index=True)
    shift = models.CharField(max_length=20, choices=SHIFT_CHOICES)
    boarded = models.BooleanField(default=False)
    late = models.BooleanField(default=False)
    note = models.CharField(max_length=255, blank=True, default="")
    scanned_at = models.DateTimeField(null=True, blank=True)
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES, default="manual")
    marked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "transport_attendance"
        ordering = ["-date", "shift", "student__first_name"]
        constraints = [
            models.UniqueConstraint(fields=["student", "date", "shift"], name="uq_transport_attendance_student_date_shift"),
        ]

    def __str__(self):
        return f"{self.student} {self.date} {self.shift}: {'boarded' if self.boarded else 'not boarded'}"


class StopArrival(models.Model):
    """
    A vehicle reaching a stop on a given day (from its GPS geofence). This is what
    marks a stop as "reached" for route progress - independent of whether any
    student boards there, so a stop with no allocated students can't stall a route.
    """

    vehicle = models.ForeignKey("Vehicle", on_delete=models.CASCADE, related_name="stop_arrivals")
    stop = models.ForeignKey("BusStop", on_delete=models.CASCADE, related_name="arrivals")
    date = models.DateField()
    arrived_at = models.DateTimeField()
    is_simulated = models.BooleanField(default=False)

    class Meta:
        db_table = "transport_stop_arrivals"
        ordering = ["-arrived_at"]
        constraints = [
            models.UniqueConstraint(fields=["vehicle", "stop", "date"], name="uq_stop_arrival_vehicle_stop_date"),
        ]


# Maintenance
class VehicleServiceRecord(models.Model):
    """
    A service / repair job on a vehicle. `status` stores what the transport desk
    set (scheduled, in workshop, completed); "overdue" and "due soon" are derived
    from service_date for jobs not yet done (see services/upkeep.py).
    """

    STATUS_CHOICES = [("scheduled", "Scheduled"), ("in_workshop", "In workshop"), ("completed", "Completed")]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="transport_service_records")
    vehicle = models.ForeignKey("Vehicle", on_delete=models.CASCADE, related_name="service_records")
    service_date = models.DateField(db_index=True)
    service_type = models.CharField(max_length=80)
    work_done = models.TextField(blank=True, default="")
    cost = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    odometer_km = models.PositiveIntegerField(null=True, blank=True)
    vendor = models.CharField(max_length=150, blank=True, default="")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="scheduled", db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "transport_service_records"
        ordering = ["-service_date", "-id"]

    def __str__(self):
        return f"{self.vehicle} {self.service_type} {self.service_date}"


# Fuel Management
class FuelEntry(models.Model):
    """
    One refuelling. `amount` = litres x rate. Mileage uses the full-tank method:
    km/L = (this odometer - previous entry's odometer) / litres, so the first entry
    of a vehicle has no km/L. `baseline_kml` is the vehicle's average km/L over its
    earlier entries; an entry is an anomaly when km/L < 80% of that baseline.
    Derived fields are recomputed per vehicle on every change (services/upkeep.py).
    """

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="transport_fuel_entries")
    vehicle = models.ForeignKey("Vehicle", on_delete=models.CASCADE, related_name="fuel_entries")
    date = models.DateField(db_index=True)
    litres = models.DecimalField(max_digits=8, decimal_places=2)
    rate = models.DecimalField(max_digits=8, decimal_places=2)
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    odometer_km = models.PositiveIntegerField()
    station = models.CharField(max_length=150, blank=True, default="")
    # Derived (recomputed): see class docstring.
    distance_km = models.PositiveIntegerField(null=True, blank=True)
    kml = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    baseline_kml = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    anomaly = models.BooleanField(default=False)
    verified = models.BooleanField(default=False)
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "transport_fuel_entries"
        ordering = ["-date", "-odometer_km", "-id"]

    def __str__(self):
        return f"{self.vehicle} {self.date} {self.litres} L"


# Reports
class TransportReportLog(models.Model):
    """A report someone generated / downloaded (the Reports screen's "Recent reports")."""

    FORMAT_CHOICES = [("pdf", "PDF"), ("excel", "Excel"), ("csv", "CSV")]

    school = models.ForeignKey("tenancy.School", on_delete=models.CASCADE, related_name="transport_report_logs")
    report = models.CharField(max_length=40)
    period = models.CharField(max_length=80, blank=True, default="")
    scope = models.CharField(max_length=120, blank=True, default="")
    file_format = models.CharField(max_length=10, choices=FORMAT_CHOICES, default="pdf")
    generated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "transport_report_logs"
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.report} ({self.file_format}) {self.created_at:%Y-%m-%d}"


# Transport Settings
class TransportSettings(models.Model):
    """
    One settings record per school (geofence, shift timings, alert thresholds,
    notifications, fees, fare slabs, document reminders). Stored as JSON in the
    shape the Settings screen edits; services/settings.py merges it over defaults.
    """

    school = models.OneToOneField("tenancy.School", on_delete=models.CASCADE, related_name="transport_settings")
    config = models.JSONField(default=dict, blank=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "transport_settings"

    def __str__(self):
        return f"Transport settings - {self.school}"
