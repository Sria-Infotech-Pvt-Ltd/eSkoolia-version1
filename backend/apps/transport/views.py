"""
Transport API views.

School scoping reuses apps.core's TenantQueryMixin / PermissionScopedViewSet.
Phase 1 changes (see apps/transport/permissions.py and serializers.py):
- separate view/add/edit/delete permission codes per action;
- GPS updates and live broadcasts are scoped to the requesting user's school;
- creates on models without a `school` column (stops, alerts, pickups, ...) no
  longer pass school= to the serializer (that raised a TypeError / HTTP 500);
- vehicle and route filters, archive, breakdown and document renewal.
"""
import math
from datetime import date as date_cls
from datetime import timedelta

from django.db.models import Avg, Count, Max, Q, Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.decorators import action
from rest_framework.exceptions import MethodNotAllowed, ValidationError
from rest_framework.response import Response

from apps.core.models import AcademicYear
from apps.core.views import PermissionScopedViewSet, TenantQueryMixin

from .models import (
    AssignVehicle, BusLocation, BusRoutePickupUpdate, BusStop, FuelEntry, RoutePerformanceLog,
    StudentTransportAllocation, TransportAlert, TransportAttendance, TransportNotificationLog, TransportReportLog,
    TransportRoute, TransportStaffProfile, Vehicle, VehicleDriverAssignment, VehicleServiceRecord,
)
from .permissions import DASHBOARD_VIEW, REPORT_VIEW, SETTINGS_EDIT, SETTINGS_VIEW, TRACKING_UPDATE, crud_codes
from .serializers import (
    AlertIdsSerializer, AllocationIdsSerializer, AssignVehicleSerializer, AttendanceDayShiftSerializer,
    AttendanceMarkSerializer, BulkAllocationSerializer, BusLocationSerializer, BusRoutePickupUpdateSerializer,
    BusStopSerializer, FuelEntrySerializer, RecordIdsSerializer, ReportQuerySerializer,
    RoutePerformanceLogSerializer, StudentTransportAllocationSerializer, TransportAlertSerializer,
    TransportAttendanceSerializer, TransportNotificationLogSerializer, TransportReportLogSerializer,
    TransportRouteDetailSerializer, TransportRouteSerializer, TransportSettingsSerializer, TransportStaffProfileSerializer,
    VehicleDocumentRenewalSerializer, VehicleDriverAssignmentSerializer, VehicleSerializer,
    VehicleServiceRecordSerializer,
)
from .services import allocations as allocation_service
from .services import attendance as attendance_service
from .services import upkeep as upkeep_service
from .services.dashboard import build_summary
from .services.reports import REPORT_KEYS, REPORTS, build_report
from .services.settings import get_settings, reminder_days
from .services.parent_notifications import notify_guardians
from .services.realtime import broadcast_alert, broadcast_location
from .services.tracking import haversine_km, process_gps_update, shift_for


# Permission and School Validation
class NoSchoolColumnCreateMixin:
    """
    For models without a `school` column (school comes via route/vehicle).

    TenantQueryMixin.perform_create calls serializer.save(school=...), which made
    every POST to these endpoints fail. Ownership is enforced instead by each
    serializer's school-scoped relation validation.
    """

    def perform_create(self, serializer):
        serializer.save()


def _truthy(value):
    return str(value).lower() in {"1", "true", "yes"}


# Transport API Views
class VehicleViewSet(TenantQueryMixin, PermissionScopedViewSet):
    """
    Vehicles. Filters: vehicle_type, operational_status, route (id), archived
    (true/false; default returns all, as before), compliance (expiring|expired),
    search (number, model, driver).
    """

    model = Vehicle
    serializer_class = VehicleSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = crud_codes("vehicle", edit_actions=("archive", "mark_breakdown", "renew_document"))

    def get_queryset(self):
        queryset = (
            super()
            .get_queryset()
            .select_related("driver", "academic_year", "school")
            .prefetch_related("assignments__route")
            .annotate(
                occupied_count=Count(
                    "students",
                    filter=Q(students__is_active=True, students__is_deleted=False),
                    distinct=True,
                )
            )
        )
        params = self.request.query_params
        if params.get("vehicle_type"):
            queryset = queryset.filter(vehicle_type=params["vehicle_type"])
        if params.get("operational_status"):
            queryset = queryset.filter(operational_status=params["operational_status"])
        if params.get("route"):
            queryset = queryset.filter(assignments__route_id=params["route"], assignments__active_status=True)
        if params.get("archived") is not None:
            queryset = queryset.filter(active_status=not _truthy(params["archived"]))
        compliance = params.get("compliance")
        if compliance in {"expiring", "expired"}:
            today = timezone.localdate()
            soon = today + timedelta(days=reminder_days(self.request.user.school_id, "vehicleDocsDays"))
            match = Q()
            for field in ("fitness_valid_till", "insurance_valid_till", "permit_valid_till", "pollution_valid_till"):
                if compliance == "expired":
                    match |= Q(**{f"{field}__lt": today})
                else:
                    match |= Q(**{f"{field}__gte": today, f"{field}__lte": soon})
            queryset = queryset.filter(match)
        search = (params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(vehicle_no__icontains=search)
                | Q(vehicle_model__icontains=search)
                | Q(driver__first_name__icontains=search)
                | Q(driver__last_name__icontains=search)
            )
        # Explicit order: annotated (GROUP BY) querysets drop Meta.ordering, which made pagination unstable.
        return queryset.distinct().order_by("vehicle_no", "id")

    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        """Archive (hide) a vehicle without deleting it: active_status=False."""
        vehicle = self.get_object()
        vehicle.active_status = False
        vehicle.save(update_fields=["active_status", "updated_at"])
        return Response(self.get_serializer(vehicle).data)

    @action(detail=True, methods=["post"], url_path="mark-breakdown")
    def mark_breakdown(self, request, pk=None):
        """Pull the vehicle from service and raise a critical breakdown alert for the transport desk."""
        vehicle = self.get_object()
        vehicle.operational_status = "breakdown"
        vehicle.save(update_fields=["operational_status", "updated_at"])
        assignment = vehicle.assignments.filter(active_status=True).first()
        alert = TransportAlert.objects.create(
            vehicle=vehicle,
            route_id=assignment.route_id if assignment else None,
            alert_type="breakdown",
            severity="critical",
            message=f"Breakdown reported - {vehicle.vehicle_no}",
            raised_by=request.user,
        )
        broadcast_alert(alert)
        return Response(self.get_serializer(vehicle).data)

    @action(detail=True, methods=["post"], url_path="renew-document")
    def renew_document(self, request, pk=None):
        """Set a new valid-till date for one compliance document (must be in the future)."""
        vehicle = self.get_object()
        payload = VehicleDocumentRenewalSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        field = payload.validated_data["document"]
        setattr(vehicle, field, payload.validated_data["valid_till"])
        vehicle.save(update_fields=[field, "updated_at"])
        # Renewing a document closes any open expiry alert raised for that document.
        for alert in TransportAlert.objects.filter(vehicle=vehicle, alert_type="document_expiry", document=field).exclude(state="resolved"):
            alert.state = "resolved"
            alert.resolved_at = timezone.now()
            alert.resolved_by = request.user
            alert.save()
        return Response(self.get_serializer(vehicle).data)

    def perform_create(self, serializer):
        from rest_framework.exceptions import ValidationError
        
        school = self.request.user.school
        if not school:
            raise ValidationError({"school": "User does not have a school assigned."})
        
        # Try to get current academic year, fallback to latest one
        academic_year = AcademicYear.objects.filter(school=school, is_current=True).first()
        if not academic_year:
            academic_year = AcademicYear.objects.filter(school=school).order_by("-start_date").first()
        
        if not academic_year:
            raise ValidationError({"academic_year": "No academic year found for your school. Please create one first."})
        
        serializer.save(school=school, academic_year=academic_year)


class TransportRouteViewSet(TenantQueryMixin, PermissionScopedViewSet):
    """
    Routes. Filters: zone, shift, active (true/false), search (title, code).
    Detail responses include the ordered stops; builder/optimize/analytics unchanged.
    """

    model = TransportRoute
    serializer_class = TransportRouteSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = crud_codes("route")

    def get_serializer_class(self):
        if self.action == "retrieve":
            return TransportRouteDetailSerializer
        return TransportRouteSerializer

    def get_queryset(self):
        queryset = (
            super()
            .get_queryset()
            .select_related("academic_year", "school")
            .prefetch_related("assignments__vehicle__driver")
            .annotate(
                stops_total=Count("stops", filter=Q(stops__active_status=True), distinct=True),
                students_total=Count(
                    "students",
                    filter=Q(students__is_active=True, students__is_deleted=False),
                    distinct=True,
                ),
            )
        )
        params = self.request.query_params
        if params.get("zone"):
            queryset = queryset.filter(zone=params["zone"])
        if params.get("shift"):
            queryset = queryset.filter(shift=params["shift"])
        if params.get("active") is not None:
            queryset = queryset.filter(active_status=_truthy(params["active"]))
        search = (params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(Q(title__icontains=search) | Q(code__icontains=search))
        return queryset.order_by("title", "id")

    def perform_create(self, serializer):
        from rest_framework.exceptions import ValidationError
        
        school = self.request.user.school
        if not school:
            raise ValidationError({"school": "User does not have a school assigned."})
        
        # Try to get current academic year, fallback to latest one
        academic_year = AcademicYear.objects.filter(school=school, is_current=True).first()
        if not academic_year:
            academic_year = AcademicYear.objects.filter(school=school).order_by("-start_date").first()
        
        if not academic_year:
            raise ValidationError({"academic_year": "No academic year found for your school. Please create one first."})
        
        serializer.save(school=school, academic_year=academic_year)

    @action(detail=True, methods=["get"], url_path="builder")
    def builder(self, request, pk=None):
        route = self.get_object()
        stops_qs = BusStop.objects.filter(route=route, active_status=True).order_by("stop_order", "id")
        stops_data = BusStopSerializer(stops_qs, many=True).data

        total_distance_km = 0.0
        previous_stop = None
        for stop in stops_qs:
            if previous_stop is not None:
                total_distance_km += self._haversine_km(
                    float(previous_stop.latitude),
                    float(previous_stop.longitude),
                    float(stop.latitude),
                    float(stop.longitude),
                )
            previous_stop = stop

        return Response(
            {
                "id": route.id,
                "title": route.title,
                "fare": route.fare,
                "active_status": route.active_status,
                "total_stops": len(stops_data),
                "total_distance_km": round(total_distance_km, 3),
                "stops": stops_data,
            }
        )

    @action(detail=True, methods=["get"], url_path="optimize")
    def optimize(self, request, pk=None):
        """Nearest-neighbor stop optimization with pickup density as tie-breaker."""
        route = self.get_object()
        stops = list(BusStop.objects.filter(route=route, active_status=True).order_by("stop_order", "id"))
        if len(stops) < 2:
            return Response({"route_id": route.id, "optimized_stops": BusStopSerializer(stops, many=True).data})

        pickup_counts = {
            row["stop_id"]: row["count"]
            for row in (
                BusRoutePickupUpdate.objects.filter(stop__route=route)
                .values("stop_id")
                .annotate(count=Count("id"))
            )
        }

        start = min(stops, key=lambda s: s.stop_order)
        unvisited = [s for s in stops if s.id != start.id]
        ordered = [start]
        cursor = start

        while unvisited:
            unvisited.sort(
                key=lambda s: (
                    self._haversine_km(float(cursor.latitude), float(cursor.longitude), float(s.latitude), float(s.longitude)),
                    -(pickup_counts.get(s.id, 0) or 0),
                )
            )
            next_stop = unvisited.pop(0)
            ordered.append(next_stop)
            cursor = next_stop

        data = []
        for idx, stop in enumerate(ordered, start=1):
            data.append(
                {
                    "id": stop.id,
                    "stop_name": stop.stop_name,
                    "latitude": stop.latitude,
                    "longitude": stop.longitude,
                    "current_order": stop.stop_order,
                    "suggested_order": idx,
                    "pickup_weight": int(pickup_counts.get(stop.id, 0) or 0),
                }
            )

        return Response({"route_id": route.id, "optimized_stops": data})

    @action(detail=True, methods=["get"], url_path="analytics")
    def analytics(self, request, pk=None):
        route = self.get_object()
        logs_qs = RoutePerformanceLog.objects.filter(route=route).order_by("-log_date", "-id")
        vehicle_id = request.query_params.get("vehicle_id")
        if vehicle_id:
            logs_qs = logs_qs.filter(vehicle_id=vehicle_id)

        serializer = RoutePerformanceLogSerializer(logs_qs[:90], many=True)
        aggregate = logs_qs.aggregate(
            avg_delay=Avg("delay_minutes"),
            avg_speed=Avg("avg_speed_kmh"),
            avg_distance=Avg("total_distance_km"),
        )
        return Response(
            {
                "route_id": route.id,
                "route_title": route.title,
                "summary": {
                    "avg_delay_minutes": round(float(aggregate.get("avg_delay") or 0), 2),
                    "avg_speed_kmh": round(float(aggregate.get("avg_speed") or 0), 2),
                    "avg_distance_km": round(float(aggregate.get("avg_distance") or 0), 3),
                    "total_logs": logs_qs.count(),
                },
                "logs": serializer.data,
            }
        )

    def _haversine_km(self, lat1, lng1, lat2, lng2):
        radius_km = 6371
        lat_delta = math.radians(lat2 - lat1)
        lng_delta = math.radians(lng2 - lng1)
        a = (
            math.sin(lat_delta / 2) ** 2
            + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(lng_delta / 2) ** 2
        )
        return radius_km * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))


class AssignVehicleViewSet(TenantQueryMixin, PermissionScopedViewSet):
    model = AssignVehicle
    serializer_class = AssignVehicleSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = crud_codes("assign_vehicle")

    def get_queryset(self):
        queryset = super().get_queryset()
        return queryset.select_related("vehicle", "route", "academic_year", "school")

    def perform_create(self, serializer):
        from rest_framework.exceptions import ValidationError
        
        school = self.request.user.school
        if not school:
            raise ValidationError({"school": "User does not have a school assigned."})
        
        # Try to get current academic year, fallback to latest one
        academic_year = AcademicYear.objects.filter(school=school, is_current=True).first()
        if not academic_year:
            academic_year = AcademicYear.objects.filter(school=school).order_by("-start_date").first()
        
        if not academic_year:
            raise ValidationError({"academic_year": "No academic year found for your school. Please create one first."})
        
        serializer.save(school=school, academic_year=academic_year)


# Route stops / pickup points
class BusStopViewSet(NoSchoolColumnCreateMixin, TenantQueryMixin, PermissionScopedViewSet):
    """Route stops (= pickup points). Filters: route_id, zone, search (name, landmark)."""

    model = BusStop
    serializer_class = BusStopSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = crud_codes("route", edit_actions=("reorder",))
    
    def get_queryset(self):
        user = self.request.user
        queryset = BusStop.objects.all()
        if user.school_id:
            queryset = queryset.filter(route__school_id=user.school_id)
        else:
            return queryset.none()
        route_id = self.request.query_params.get("route_id")
        if route_id:
            queryset = queryset.filter(route_id=route_id)
        zone = self.request.query_params.get("zone")
        if zone:
            queryset = queryset.filter(route__zone=zone)
        search = (self.request.query_params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(Q(stop_name__icontains=search) | Q(landmark__icontains=search))
        return queryset.select_related("route").order_by("stop_order")

    def create(self, request, *args, **kwargs):
        payload = request.data.copy()
        self._validate_coordinates(payload)

        route_id = payload.get("route")
        stop_order = payload.get("stop_order")
        if route_id and (stop_order is None or str(stop_order).strip() == ""):
            max_order = BusStop.objects.filter(route_id=route_id).order_by("-stop_order").values_list("stop_order", flat=True).first() or 0
            payload["stop_order"] = max_order + 1

        serializer = self.get_serializer(data=payload)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def update(self, request, *args, **kwargs):
        payload = request.data.copy()
        self._validate_coordinates(payload)
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=payload, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        route_id = instance.route_id
        response = super().destroy(request, *args, **kwargs)
        remaining_stops = BusStop.objects.filter(route_id=route_id).order_by("stop_order", "id")
        for index, stop in enumerate(remaining_stops, start=1):
            if stop.stop_order != index:
                stop.stop_order = index
                stop.save(update_fields=["stop_order"])
        return response

    @action(detail=False, methods=["put"], url_path="reorder")
    def reorder(self, request):
        items = request.data.get("stops")
        if not isinstance(items, list):
            raise ValidationError({"stops": "Expected a list of stop order updates."})

        stop_ids = [item.get("id") for item in items if item.get("id") is not None]
        requested_orders = [item.get("stop_order") for item in items]
        if len(stop_ids) != len(items):
            raise ValidationError({"stops": "Each item must include id and stop_order."})
        if any(order is None for order in requested_orders):
            raise ValidationError({"stops": "Each item must include stop_order."})

        stops = list(self.get_queryset().filter(id__in=stop_ids))
        stop_by_id = {stop.id: stop for stop in stops}
        if len(stop_by_id) != len(stop_ids):
            raise ValidationError({"stops": "One or more stops were not found."})

        route_ids = {stop.route_id for stop in stops}
        if len(route_ids) != 1:
            raise ValidationError({"stops": "Reorder supports one route at a time."})

        for item in items:
            stop = stop_by_id[item["id"]]
            stop.stop_order = int(item["stop_order"])

        BusStop.objects.bulk_update(stops, ["stop_order"])  # type: ignore[arg-type]
        ordered = BusStop.objects.filter(route_id=stops[0].route_id).order_by("stop_order", "id")
        for index, stop in enumerate(ordered, start=1):
            if stop.stop_order != index:
                stop.stop_order = index
                stop.save(update_fields=["stop_order"])

        return Response({"success": True})

    def _validate_coordinates(self, payload):
        latitude = payload.get("latitude")
        longitude = payload.get("longitude")

        if latitude is None or longitude is None:
            return

        try:
            lat_value = float(latitude)
            lng_value = float(longitude)
        except (TypeError, ValueError):
            raise ValidationError({"latitude": "Latitude/longitude must be numeric."})

        if not (-90 <= lat_value <= 90):
            raise ValidationError({"latitude": "Latitude must be between -90 and 90."})
        if not (-180 <= lng_value <= 180):
            raise ValidationError({"longitude": "Longitude must be between -180 and 180."})


# Live Tracking and GPS
class BusLocationViewSet(TenantQueryMixin, PermissionScopedViewSet):
    """
    GPS positions. POST is the GPS update entry point (devices / driver apps) and
    needs transport.tracking.update; it only accepts vehicles of the caller's school.
    """

    model = BusLocation
    serializer_class = BusLocationSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {
        "*": "transport.vehicle.view",
        "create": TRACKING_UPDATE,
        "update": TRACKING_UPDATE,
        "partial_update": TRACKING_UPDATE,
        "destroy": "transport.vehicle.delete",
    }
    
    def get_queryset(self):
        user = self.request.user
        queryset = BusLocation.objects.all()
        if user.school_id:
            queryset = queryset.filter(vehicle__school_id=user.school_id)
        else:
            return queryset.none()

        route_id = self.request.query_params.get("route_id")
        if route_id:
            queryset = queryset.filter(vehicle__assignments__route_id=route_id)

        vehicle_id = self.request.query_params.get("vehicle_id")
        if vehicle_id:
            queryset = queryset.filter(vehicle_id=vehicle_id)
        return queryset.select_related("vehicle").order_by("-timestamp").distinct()

    @action(detail=False, methods=["get"], url_path="eta")
    def eta(self, request):
        vehicle_id = request.query_params.get("vehicle_id")
        if not vehicle_id:
            return Response({"error": "vehicle_id required"}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        if not user.school_id:
            return Response({"error": "vehicle_id required"}, status=status.HTTP_400_BAD_REQUEST)

        assignment = (
            AssignVehicle.objects.filter(
                vehicle_id=vehicle_id, active_status=True, school_id=user.school_id
            )
            .select_related("route")
            .first()
        )
        if not assignment:
            return Response({"vehicle_id": int(vehicle_id), "stops": [], "next_stop": None})

        location = BusLocation.objects.filter(vehicle_id=vehicle_id).order_by("-timestamp").first()
        route_stops = list(BusStop.objects.filter(route_id=assignment.route_id, active_status=True).order_by("stop_order", "id"))
        pickup_updates = list(
            BusRoutePickupUpdate.objects.filter(vehicle_id=vehicle_id, stop__route_id=assignment.route_id)
            .select_related("stop")
            .order_by("-arrived_at")
        )

        reached_stop_ids = set()
        reached_time_by_stop = {}
        for update in pickup_updates:
            if update.status in ["arrived", "picked_up"]:
                reached_stop_ids.add(update.stop_id)
                timestamp = update.picked_up_at or update.arrived_at
                if timestamp and update.stop_id not in reached_time_by_stop:
                    reached_time_by_stop[update.stop_id] = timestamp

        next_stop = None
        for stop in route_stops:
            if stop.id not in reached_stop_ids:
                next_stop = stop
                break

        speed_kmh = 0
        current_lat = None
        current_lng = None
        if location:
            speed_kmh = max(0, int(location.speed or 0))
            current_lat = float(location.latitude)
            current_lng = float(location.longitude)

        eta_rows = []
        previous_upcoming_coords = (current_lat, current_lng)
        cumulative_eta = 0
        for stop in route_stops:
            stop_lat = float(stop.latitude)
            stop_lng = float(stop.longitude)
            if stop.id in reached_stop_ids:
                eta_rows.append(
                    {
                        "stop_id": stop.id,
                        "stop_name": stop.stop_name,
                        "stop_order": stop.stop_order,
                        "scheduled_time": stop.scheduled_time.isoformat() if stop.scheduled_time else None,
                        "status": "reached",
                        "eta_minutes": None,
                        "reached_at": reached_time_by_stop.get(stop.id).isoformat() if reached_time_by_stop.get(stop.id) else None,
                    }
                )
                continue

            status_value = "next" if next_stop and next_stop.id == stop.id else "upcoming"
            eta_minutes = None

            if previous_upcoming_coords[0] is not None and previous_upcoming_coords[1] is not None:
                leg_distance = self._haversine_km(previous_upcoming_coords[0], previous_upcoming_coords[1], stop_lat, stop_lng)
                if speed_kmh >= 5:
                    leg_eta = max(1, round((leg_distance / speed_kmh) * 60))
                    cumulative_eta += leg_eta
                    eta_minutes = cumulative_eta

            eta_rows.append(
                {
                    "stop_id": stop.id,
                    "stop_name": stop.stop_name,
                    "stop_order": stop.stop_order,
                    "scheduled_time": stop.scheduled_time.isoformat() if stop.scheduled_time else None,
                    "status": status_value,
                    "eta_minutes": eta_minutes,
                    "reached_at": None,
                }
            )

            previous_upcoming_coords = (stop_lat, stop_lng)

        return Response(
            {
                "vehicle_id": int(vehicle_id),
                "route_id": assignment.route_id,
                "next_stop":
                    {
                        "id": next_stop.id,
                        "name": next_stop.stop_name,
                        "order": next_stop.stop_order,
                    }
                    if next_stop
                    else None,
                "stops": eta_rows,
            }
        )
    
    def create(self, request, *args, **kwargs):
        """Update or create bus location and compute live route progress metadata."""
        vehicle_id = request.data.get("vehicle")
        if not vehicle_id:
            return Response({"error": "vehicle_id required"}, status=status.HTTP_400_BAD_REQUEST)

        latitude = request.data.get("latitude")
        longitude = request.data.get("longitude")
        if latitude is None or longitude is None:
            return Response({"error": "latitude and longitude required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            latitude_value = float(latitude)
            longitude_value = float(longitude)
            speed_value = int(request.data.get("speed", 0) or 0)
            heading_value = int(request.data.get("heading", 0) or 0)
            accuracy_value = int(request.data.get("accuracy", 0) or 0)
        except (TypeError, ValueError):
            return Response({"error": "Invalid numeric payload"}, status=status.HTTP_400_BAD_REQUEST)

        if not (-90 <= latitude_value <= 90):
            return Response({"error": "latitude must be between -90 and 90"}, status=status.HTTP_400_BAD_REQUEST)
        if not (-180 <= longitude_value <= 180):
            return Response({"error": "longitude must be between -180 and 180"}, status=status.HTTP_400_BAD_REQUEST)

        # Only the caller's own school's vehicles - previously any vehicle id was accepted,
        # letting one school move another school's bus and trigger its pickups/SMS.
        vehicle = Vehicle.objects.filter(id=vehicle_id, school_id=request.user.school_id).first()
        if not vehicle:
            return Response({"error": "vehicle not found"}, status=status.HTTP_404_NOT_FOUND)
        
        # Stop detection, per-stop pickups, boarding register and route progress live in
        # services/tracking.py (shared with the development simulator).
        result = process_gps_update(
            vehicle, latitude_value, longitude_value, speed_value, heading_value, accuracy_value
        )
        if result.picked_students:
            notify_guardians(
                vehicle, result.picked_students,
                message=f"{vehicle.vehicle_no} reached {result.stop_reached['stop_name']}.",
                subject=f"Bus Update: {vehicle.vehicle_no}",
            )
        for alert in (result.alert, result.overspeed_alert):
            if alert:
                broadcast_alert(alert)

        serializer = self.get_serializer(result.location)
        broadcast_location(serializer.data, vehicle.school_id)
        next_stop = result.next_stop
        return Response(
            {
                "location": serializer.data,
                "next_stop": {
                    "id": next_stop.id,
                    "name": next_stop.stop_name,
                    "order": next_stop.stop_order,
                }
                if next_stop
                else None,
                "eta_minutes": result.eta_minutes,
                "distance_to_next_km": round(result.distance_to_next_km, 3) if result.distance_to_next_km is not None else None,
                "stop_reached": result.stop_reached,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["get"], url_path="live")
    def live(self, request):
        """Parent/operations live feed with latest status per vehicle."""
        vehicles = Vehicle.objects.all()
        if request.user.school_id:
            vehicles = vehicles.filter(school_id=request.user.school_id)
        else:
            vehicles = vehicles.none()

        payload = []
        for vehicle in vehicles.order_by("vehicle_no"):
            payload.append(
                {
                    "vehicle_id": vehicle.id,
                    "vehicle_no": vehicle.vehicle_no,
                    "latitude": float(vehicle.current_latitude) if vehicle.current_latitude is not None else None,
                    "longitude": float(vehicle.current_longitude) if vehicle.current_longitude is not None else None,
                    "speed": vehicle.current_speed,
                    "status": vehicle.status,
                    "next_stop": vehicle.next_stop.stop_name if vehicle.next_stop else None,
                    "last_location_update": vehicle.last_location_update.isoformat() if vehicle.last_location_update else None,
                    # True when the latest position came from the development simulator.
                    "is_simulated": bool(vehicle.bus_locations.filter(is_simulated=True).exists()),
                }
            )
        return Response(payload)

    def _haversine_km(self, lat1, lng1, lat2, lng2):
        return haversine_km(lat1, lng1, lat2, lng2)


# Alerts and Notifications
class TransportAlertViewSet(TenantQueryMixin, PermissionScopedViewSet):
    """
    Alerts. Filters: vehicle_id, alert_type, exclude_types, is_resolved (legacy), state,
    severity, route. Actions: acknowledge / resolve (one) and bulk-acknowledge / bulk-resolve.
    """

    model = TransportAlert
    serializer_class = TransportAlertSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = crud_codes(
        "alert", edit_actions=("acknowledge", "resolve", "bulk_acknowledge", "bulk_resolve")
    )

    def get_queryset(self):
        user = self.request.user
        queryset = TransportAlert.objects.all()
        if user.school_id:
            queryset = queryset.filter(vehicle__school_id=user.school_id)
        else:
            return queryset.none()

        params = self.request.query_params
        if params.get("vehicle_id"):
            queryset = queryset.filter(vehicle_id=params["vehicle_id"])
        if params.get("alert_type"):
            queryset = queryset.filter(alert_type=params["alert_type"])
        if params.get("exclude_types"):
            # e.g. exclude_types=arrived,left,near_school hides routine trip events from the alerts desk
            queryset = queryset.exclude(alert_type__in=params["exclude_types"].split(","))
        if params.get("is_resolved") is not None:
            queryset = queryset.filter(is_resolved=(params["is_resolved"].lower() == "true"))
        if params.get("state"):
            states = params["state"].split(",")
            queryset = queryset.filter(state__in=states)
        if params.get("severity"):
            queryset = queryset.filter(severity=params["severity"])
        if params.get("route"):
            queryset = queryset.filter(route_id=params["route"])
        return queryset.select_related(
            "vehicle", "route", "raised_by", "acknowledged_by", "resolved_by"
        ).order_by("-created_at")

    def perform_create(self, serializer):
        # Alerts have no school column; the serializer validated vehicle/route against the user's school.
        alert = serializer.save(raised_by=self.request.user)
        broadcast_alert(alert)

    def perform_update(self, serializer):
        """Legacy resolve via PUT/PATCH is_resolved=true: record when and by whom.

        (The old update() set resolved_at on an instance DRF then re-fetched, so it was never saved.)
        """
        instance = serializer.instance
        extra = {}
        if serializer.validated_data.get("is_resolved") and not instance.resolved_at:
            extra = {"resolved_at": timezone.now(), "resolved_by": self.request.user}
        serializer.save(**extra)

    def _acknowledge(self, alerts):
        now = timezone.now()
        for alert in alerts:
            if alert.state == "open":
                alert.state = "acknowledged"
                alert.acknowledged_by = self.request.user
                alert.acknowledged_at = now
                alert.save()

    def _resolve(self, alerts):
        now = timezone.now()
        for alert in alerts:
            if alert.state != "resolved":
                alert.state = "resolved"
                alert.resolved_by = self.request.user
                alert.resolved_at = now
                alert.save()

    @action(detail=True, methods=["post"], url_path="acknowledge")
    def acknowledge(self, request, pk=None):
        alert = self.get_object()
        self._acknowledge([alert])
        return Response(self.get_serializer(alert).data)

    @action(detail=True, methods=["post"], url_path="resolve")
    def resolve(self, request, pk=None):
        alert = self.get_object()
        self._resolve([alert])
        return Response(self.get_serializer(alert).data)

    def _bulk(self, request, handler):
        payload = AlertIdsSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        alerts = list(self.get_queryset().filter(id__in=payload.validated_data["ids"]))
        handler(alerts)
        return Response({"updated": len(alerts)})

    @action(detail=False, methods=["post"], url_path="bulk-acknowledge")
    def bulk_acknowledge(self, request):
        return self._bulk(request, self._acknowledge)

    @action(detail=False, methods=["post"], url_path="bulk-resolve")
    def bulk_resolve(self, request):
        return self._bulk(request, self._resolve)


class BusRoutePickupUpdateViewSet(NoSchoolColumnCreateMixin, TenantQueryMixin, PermissionScopedViewSet):
    model = BusRoutePickupUpdate
    serializer_class = BusRoutePickupUpdateSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = crud_codes("vehicle")
    
    def get_queryset(self):
        user = self.request.user
        queryset = BusRoutePickupUpdate.objects.all()
        if user.school_id:
            queryset = queryset.filter(vehicle__school_id=user.school_id)
        else:
            return queryset.none()

        vehicle_id = self.request.query_params.get("vehicle_id")
        stop_id = self.request.query_params.get("stop_id")
        student_id = self.request.query_params.get("student_id")
        status_filter = self.request.query_params.get("status")
        
        if vehicle_id:
            queryset = queryset.filter(vehicle_id=vehicle_id)
        if stop_id:
            queryset = queryset.filter(stop_id=stop_id)
        if student_id:
            queryset = queryset.filter(student_id=student_id)
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        
        return queryset.select_related("stop", "vehicle", "student").order_by("-arrived_at")


class VehicleDriverAssignmentViewSet(NoSchoolColumnCreateMixin, TenantQueryMixin, PermissionScopedViewSet):
    model = VehicleDriverAssignment
    serializer_class = VehicleDriverAssignmentSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = crud_codes("vehicle")

    def get_queryset(self):
        queryset = VehicleDriverAssignment.objects.all()
        if self.request.user.school_id:
            queryset = queryset.filter(vehicle__school_id=self.request.user.school_id)
        else:
            return queryset.none()

        vehicle_id = self.request.query_params.get("vehicle_id")
        if vehicle_id:
            queryset = queryset.filter(vehicle_id=vehicle_id)
        return queryset.select_related("vehicle", "driver").order_by("-is_primary", "-created_at")


class TransportNotificationLogViewSet(NoSchoolColumnCreateMixin, TenantQueryMixin, PermissionScopedViewSet):
    model = TransportNotificationLog
    serializer_class = TransportNotificationLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = crud_codes("vehicle")

    def get_queryset(self):
        queryset = TransportNotificationLog.objects.all()
        if self.request.user.school_id:
            queryset = queryset.filter(vehicle__school_id=self.request.user.school_id)
        else:
            return queryset.none()

        vehicle_id = self.request.query_params.get("vehicle_id")
        channel = self.request.query_params.get("channel")
        if vehicle_id:
            queryset = queryset.filter(vehicle_id=vehicle_id)
        if channel:
            queryset = queryset.filter(channel=channel)
        return queryset.select_related("vehicle", "student").order_by("-created_at")


class RoutePerformanceLogViewSet(NoSchoolColumnCreateMixin, TenantQueryMixin, PermissionScopedViewSet):
    model = RoutePerformanceLog
    serializer_class = RoutePerformanceLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = crud_codes("route")

    def get_queryset(self):
        queryset = RoutePerformanceLog.objects.all()
        if self.request.user.school_id:
            queryset = queryset.filter(route__school_id=self.request.user.school_id)
        else:
            return queryset.none()

        route_id = self.request.query_params.get("route_id")
        vehicle_id = self.request.query_params.get("vehicle_id")
        if route_id:
            queryset = queryset.filter(route_id=route_id)
        if vehicle_id:
            queryset = queryset.filter(vehicle_id=vehicle_id)
        return queryset.select_related("route", "vehicle").order_by("-log_date", "-id")


# Driver and Attendant Profiles
class TransportStaffProfileViewSet(TenantQueryMixin, PermissionScopedViewSet):
    """
    Drivers and attendants: transport profiles over existing hr.Staff records.
    Filters: role (driver|attendant), shift, duty_status, search (name, staff no, licence).
    GET candidates/ lists the school's HR staff who don't have a profile yet.
    """

    model = TransportStaffProfile
    serializer_class = TransportStaffProfileSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = crud_codes("staff")

    def get_queryset(self):
        queryset = (
            super()
            .get_queryset()
            .select_related("staff", "assigned_vehicle")
            .prefetch_related("assigned_vehicle__assignments__route")
        )
        params = self.request.query_params
        for field_name in ("role", "shift", "duty_status"):
            if params.get(field_name):
                queryset = queryset.filter(**{field_name: params[field_name]})
        search = (params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(staff__first_name__icontains=search)
                | Q(staff__last_name__icontains=search)
                | Q(staff__staff_no__icontains=search)
                | Q(staff__driving_license__icontains=search)
            )
        return queryset.order_by("role", "staff__first_name", "id")

    @action(detail=False, methods=["get"], url_path="candidates")
    def candidates(self, request):
        """HR staff of this school without a transport profile (to add as driver/attendant)."""
        from apps.hr.models import Staff

        staff = Staff.objects.filter(school_id=request.user.school_id).exclude(transport_profile__isnull=False)
        search = (request.query_params.get("search") or "").strip()
        if search:
            staff = staff.filter(Q(first_name__icontains=search) | Q(last_name__icontains=search) | Q(staff_no__icontains=search))
        return Response([
            {
                "id": member.id,
                "name": f"{member.first_name} {member.last_name}".strip(),
                "staff_no": member.staff_no,
                "role": member.role.name if member.role_id else None,
                "driving_license": member.driving_license,
            }
            for member in staff.select_related("role").order_by("first_name")[:200]
        ])


# Student Transport Allocation
class StudentTransportAllocationViewSet(TenantQueryMixin, PermissionScopedViewSet):
    """
    Student allocations. Filters: status, route, stop, vehicle, class, section,
    search (name, admission no., stop). Actions: bulk-allocate, release.
    """

    model = StudentTransportAllocation
    serializer_class = StudentTransportAllocationSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = crud_codes("allocation", edit_actions=("bulk_allocate", "release"))

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            "student", "student__current_class", "student__current_section", "route", "stop", "vehicle"
        )
        params = self.request.query_params
        filters = {
            "status": "status", "route": "route_id", "stop": "stop_id", "vehicle": "vehicle_id",
            "class": "student__current_class_id", "section": "student__current_section_id",
        }
        for param, lookup in filters.items():
            if params.get(param):
                queryset = queryset.filter(**{lookup: params[param]})
        search = (params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(student__first_name__icontains=search)
                | Q(student__last_name__icontains=search)
                | Q(student__admission_no__icontains=search)
                | Q(stop__stop_name__icontains=search)
            )
        return queryset.order_by("student__first_name", "student__last_name", "id")

    def perform_destroy(self, instance):
        """Deleting an allocation also clears the mirrored Student route/vehicle."""
        instance.status = "pending"
        allocation_service.mirror_to_student(instance)
        instance.delete()

    @action(detail=False, methods=["get"], url_path="candidates")
    def candidates(self, request):
        """Active students of this school with no transport allocation yet (to allocate)."""
        from apps.students.models import Student

        students = (
            Student.objects.filter(school_id=request.user.school_id, is_active=True, is_deleted=False)
            .exclude(transport_allocations__isnull=False)
            .select_related("current_class", "current_section", "guardian")
        )
        search = (request.query_params.get("search") or "").strip()
        if search:
            students = students.filter(
                Q(first_name__icontains=search) | Q(last_name__icontains=search) | Q(admission_no__icontains=search)
            )
        return Response([
            {
                "id": student.id,
                "name": f"{student.first_name} {student.last_name}".strip(),
                "admission_no": student.admission_no,
                "roll_no": student.roll_no,
                "class_id": student.current_class_id,
                "class_name": getattr(student.current_class, "name", None),
                "section_id": student.current_section_id,
                "section_name": getattr(student.current_section, "name", None),
                "guardian_name": getattr(student.guardian, "full_name", None),
                "guardian_phone": getattr(student.guardian, "phone", None),
            }
            for student in students.order_by("first_name", "last_name", "id")[:2000]
        ])

    @action(detail=False, methods=["post"], url_path="bulk-allocate")
    def bulk_allocate(self, request):
        payload = BulkAllocationSerializer(data=request.data, context=self.get_serializer_context())
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        allocations = allocation_service.allocate_students(
            data["student_objects"], data["route"], data["stop"],
            vehicle=data.get("vehicle"), monthly_fare=data.get("monthly_fare"),
        )
        return Response(
            {"allocated": len(allocations), "results": self.get_serializer(allocations, many=True).data},
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["post"], url_path="release")
    def release(self, request):
        """Remove students from transport: allocations go back to Pending."""
        payload = AllocationIdsSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        allocations = list(self.get_queryset().filter(id__in=payload.validated_data["ids"]))
        allocation_service.release_allocations(allocations)
        return Response({"released": len(allocations)})


# Transport Attendance
class TransportAttendanceViewSet(TenantQueryMixin, PermissionScopedViewSet):
    """
    Boarding register. GET register/?date=&shift=[&route=&vehicle=] returns every
    allocated student (marked or not); POST mark/ upserts lines; POST notify-absent/
    messages guardians of students not boarded. Lines are read-only otherwise.
    """

    model = TransportAttendance
    serializer_class = TransportAttendanceSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = crud_codes("attendance", edit_actions=("mark", "notify_absent"))
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = super().get_queryset().select_related("student", "stop", "vehicle")
        params = self.request.query_params
        for param in ("date", "shift", "route", "vehicle", "student"):
            if params.get(param):
                lookup = param if param in ("date", "shift") else f"{param}_id"
                queryset = queryset.filter(**{lookup: params[param]})
        if params.get("from"):
            queryset = queryset.filter(date__gte=params["from"])
        if params.get("to"):
            queryset = queryset.filter(date__lte=params["to"])
        return queryset.order_by("-date", "shift", "student__first_name", "id")

    def create(self, request, *args, **kwargs):
        raise MethodNotAllowed("POST", detail="Use POST /transport-attendance/mark/ to record attendance.")

    def _day_shift(self, data):
        payload = AttendanceDayShiftSerializer(data={
            "date": data.get("date") or timezone.localdate().isoformat(),
            "shift": data.get("shift") or shift_for(),
        })
        payload.is_valid(raise_exception=True)
        return payload.validated_data["date"], payload.validated_data["shift"]

    @action(detail=False, methods=["get"], url_path="register")
    def register(self, request):
        date, shift = self._day_shift(request.query_params)
        rows = attendance_service.build_register(
            request.user.school_id, date, shift,
            route_id=request.query_params.get("route"), vehicle_id=request.query_params.get("vehicle"),
        )
        return Response({"date": date, "shift": shift, "count": len(rows), "results": rows})

    @action(detail=False, methods=["post"], url_path="mark")
    def mark(self, request):
        payload = AttendanceMarkSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        try:
            saved = attendance_service.mark_entries(
                request.user.school_id, data["date"], data["shift"], data["entries"], request.user
            )
        except ValueError as exc:
            raise ValidationError({"entries": str(exc)})
        return Response({"saved": len(saved), "results": TransportAttendanceSerializer(saved, many=True).data})

    @action(detail=False, methods=["get"], url_path="boarding-rates")
    def boarding_rates(self, request):
        """Per student over the last ?days= (default 30, max 120): marked lines and boarded lines."""
        try:
            days = min(120, max(1, int(request.query_params.get("days", 30))))
        except ValueError:
            raise ValidationError({"days": "Must be a whole number."})
        since = timezone.localdate() - timedelta(days=days)
        rows = (
            TransportAttendance.objects.filter(school_id=request.user.school_id, date__gt=since)
            .order_by().values("student").annotate(marked=Count("id"), boarded=Count("id", filter=Q(boarded=True)))
        )
        return Response({"days": days, "results": list(rows)})

    @action(detail=False, methods=["post"], url_path="notify-absent")
    def notify_absent(self, request):
        """SMS/email guardians of allocated students not boarded on that date and shift."""
        date, shift = self._day_shift(request.data)
        absent = attendance_service.absent_students(request.user.school_id, date, shift)
        shift_label = "morning pickup" if shift == "morning" else "afternoon drop"
        started = timezone.now()
        logged = 0
        for allocation in absent:
            logged += notify_guardians(
                allocation.vehicle, [allocation.student],
                message=f"{allocation.student.first_name} did not board the {shift_label} on {date:%d %b %Y}.",
                subject="Transport attendance",
            ) if allocation.vehicle else 0
        # Report what actually happened: "skipped" means SMS/email is not configured.
        outcome = dict(
            TransportNotificationLog.objects.filter(
                created_at__gte=started, student_id__in=[a.student_id for a in absent]
            ).order_by().values("status").annotate(n=Count("id")).values_list("status", "n")
        )
        return Response({
            "absent": len(absent), "notifications_logged": logged,
            "sent": outcome.get("sent", 0), "skipped": outcome.get("skipped", 0), "failed": outcome.get("failed", 0),
        })


# Maintenance
class VehicleServiceRecordViewSet(TenantQueryMixin, PermissionScopedViewSet):
    """
    Service / repair records. Filters: vehicle, status (scheduled | due_soon | overdue |
    in_workshop | completed - the derived display status), from, to, search.
    Actions: complete (bulk), bulk-delete.
    """

    model = VehicleServiceRecord
    serializer_class = VehicleServiceRecordSerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = crud_codes("maintenance", edit_actions=("complete",), delete_actions=("bulk_delete",))

    def get_queryset(self):
        queryset = super().get_queryset().select_related("vehicle")
        params = self.request.query_params
        if params.get("vehicle"):
            queryset = queryset.filter(vehicle_id=params["vehicle"])
        if params.get("from"):
            queryset = queryset.filter(service_date__gte=params["from"])
        if params.get("to"):
            queryset = queryset.filter(service_date__lte=params["to"])
        status_filter = params.get("status")
        if status_filter:
            today = timezone.localdate()
            soon = today + timedelta(days=upkeep_service.DUE_SOON_DAYS)
            derived = {
                "overdue": Q(status="scheduled", service_date__lt=today),
                "due_soon": Q(status="scheduled", service_date__gte=today, service_date__lte=soon),
                "scheduled": Q(status="scheduled", service_date__gt=soon),
                "in_workshop": Q(status="in_workshop"),
                "completed": Q(status="completed"),
            }
            if status_filter not in derived:
                raise ValidationError({"status": f"Use one of: {', '.join(derived)}."})
            queryset = queryset.filter(derived[status_filter])
        search = (params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(service_type__icontains=search) | Q(vendor__icontains=search)
                | Q(work_done__icontains=search) | Q(vehicle__vehicle_no__icontains=search)
            )
        return queryset.order_by("-service_date", "-id")

    def perform_create(self, serializer):
        serializer.save(school=self.request.user.school, created_by=self.request.user)

    def _selected(self, request):
        payload = RecordIdsSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return self.get_queryset().filter(id__in=payload.validated_data["ids"])

    @action(detail=False, methods=["post"], url_path="complete")
    def complete(self, request):
        done = upkeep_service.complete_services(list(self._selected(request)), request.user)
        return Response({"completed": len(done)})

    @action(detail=False, methods=["post"], url_path="bulk-delete")
    def bulk_delete(self, request):
        deleted, _ = self._selected(request).delete()
        return Response({"deleted": deleted})


# Fuel Management
class FuelEntryViewSet(TenantQueryMixin, PermissionScopedViewSet):
    """
    Fuel log. Filters: vehicle, from, to, anomaly, verified. Every create / edit /
    delete recomputes the vehicle's mileage chain. Actions: verify (bulk),
    bulk-delete, summary (month totals, per-vehicle averages, 6-month trend).
    """

    model = FuelEntry
    serializer_class = FuelEntrySerializer
    permission_classes = [permissions.IsAuthenticated]
    permission_codes = crud_codes("fuel", edit_actions=("verify",), delete_actions=("bulk_delete",))

    def get_queryset(self):
        queryset = super().get_queryset().select_related("vehicle", "verified_by")
        params = self.request.query_params
        if params.get("vehicle"):
            queryset = queryset.filter(vehicle_id=params["vehicle"])
        if params.get("from"):
            queryset = queryset.filter(date__gte=params["from"])
        if params.get("to"):
            queryset = queryset.filter(date__lte=params["to"])
        for flag in ("anomaly", "verified"):
            if params.get(flag) is not None:
                queryset = queryset.filter(**{flag: _truthy(params[flag])})
        return queryset.order_by("-date", "-odometer_km", "-id")

    def perform_create(self, serializer):
        entry = serializer.save(school=self.request.user.school, created_by=self.request.user)
        upkeep_service.recompute_vehicle_fuel(entry.vehicle_id)
        entry.refresh_from_db()  # respond with the calculated amount / km/L

    def perform_update(self, serializer):
        previous_vehicle = serializer.instance.vehicle_id
        entry = serializer.save()
        upkeep_service.recompute_vehicle_fuel(entry.vehicle_id)
        if previous_vehicle != entry.vehicle_id:
            upkeep_service.recompute_vehicle_fuel(previous_vehicle)
        entry.refresh_from_db()

    def perform_destroy(self, instance):
        vehicle_id = instance.vehicle_id
        instance.delete()
        upkeep_service.recompute_vehicle_fuel(vehicle_id)

    def _selected(self, request):
        payload = RecordIdsSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        return self.get_queryset().filter(id__in=payload.validated_data["ids"])

    @action(detail=False, methods=["post"], url_path="verify")
    def verify(self, request):
        updated = self._selected(request).filter(verified=False).update(
            verified=True, verified_by=request.user, verified_at=timezone.now()
        )
        return Response({"verified": updated})

    @action(detail=False, methods=["post"], url_path="bulk-delete")
    def bulk_delete(self, request):
        selected = self._selected(request)
        vehicle_ids = set(selected.values_list("vehicle_id", flat=True))
        deleted, _ = selected.delete()
        for vehicle_id in vehicle_ids:
            upkeep_service.recompute_vehicle_fuel(vehicle_id)
        return Response({"deleted": deleted})

    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request):
        """?month=YYYY-MM (default: this month)."""
        query = ReportQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        month = query.validated_data.get("month")
        start = date_cls.fromisoformat(f"{month}-01") if month else timezone.localdate().replace(day=1)
        end = (start + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        entries = FuelEntry.objects.filter(school_id=request.user.school_id)
        in_month = entries.filter(date__gte=start, date__lte=end)
        totals = in_month.aggregate(
            spend=Sum("amount"), litres=Sum("litres"), km=Sum("distance_km"), entries=Count("id"),
            anomalies=Count("id", filter=Q(anomaly=True)), unverified=Count("id", filter=Q(verified=False)),
        )
        per_vehicle = list(
            in_month.order_by().values("vehicle_id", "vehicle__vehicle_no").annotate(
                spend=Sum("amount"), litres=Sum("litres"), km=Sum("distance_km"), avg_kml=Avg("kml"),
                baseline_kml=Max("baseline_kml"), anomalies=Count("id", filter=Q(anomaly=True)),
            ).order_by("vehicle__vehicle_no")
        )
        trend_start = (start - timedelta(days=150)).replace(day=1)
        trend = list(
            entries.filter(date__gte=trend_start, date__lte=end).order_by()
            .annotate(month=TruncMonth("date")).values("month")
            .annotate(spend=Sum("amount"), litres=Sum("litres")).order_by("month")
        )
        km, litres = totals["km"] or 0, totals["litres"] or 0
        return Response({
            "month": f"{start:%Y-%m}",
            "spend": totals["spend"] or 0,
            "litres": litres,
            "km": km,
            "avg_kml": round(km / float(litres), 2) if km and litres else None,
            "entries": totals["entries"],
            "anomalies": totals["anomalies"],
            "unverified": totals["unverified"],
            "per_vehicle": [
                {
                    "vehicle": row["vehicle_id"], "vehicle_no": row["vehicle__vehicle_no"], "spend": row["spend"],
                    "litres": row["litres"], "km": row["km"] or 0,
                    "avg_kml": round(float(row["avg_kml"]), 2) if row["avg_kml"] is not None else None,
                    "baseline_kml": row["baseline_kml"], "anomalies": row["anomalies"],
                }
                for row in per_vehicle
            ],
            "trend": [{"month": f"{row['month']:%Y-%m}", "spend": row["spend"], "litres": row["litres"]} for row in trend],
        })


# Dashboard
class TransportDashboardViewSet(PermissionScopedViewSet):
    """GET /transport-dashboard/?date=&shift= - summary counted from stored records (services/dashboard.py)."""

    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": DASHBOARD_VIEW}
    http_method_names = ["get", "head", "options"]

    def list(self, request, *args, **kwargs):
        query = ReportQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        day = query.validated_data.get("date") or timezone.localdate()
        shift = query.validated_data.get("shift") or shift_for()
        return Response(build_summary(request.user.school_id, day, shift))


# Reports
class TransportReportViewSet(PermissionScopedViewSet):
    """
    GET /transport-reports/ - report catalogue with when each was last generated.
    GET /transport-reports/<key>/?route=&month=&date=&shift= - preview table from stored records.
    POST /transport-reports/<key>/log/ {period, scope, file_format} - record a download.
    GET /transport-reports/recent/ - recently generated reports.
    """

    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": REPORT_VIEW}
    http_method_names = ["get", "post", "head", "options"]
    lookup_value_regex = "[a-z-]+"

    def _logs(self):
        return TransportReportLog.objects.filter(school_id=self.request.user.school_id).select_related("generated_by")

    def list(self, request, *args, **kwargs):
        last = dict(self._logs().order_by().values("report").annotate(at=Max("created_at")).values_list("report", "at"))
        return Response([{**report, "last_generated": last.get(report["key"])} for report in REPORTS])

    def retrieve(self, request, pk=None, *args, **kwargs):
        if pk not in REPORT_KEYS:
            return Response({"detail": "Unknown report."}, status=status.HTTP_404_NOT_FOUND)
        query = ReportQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        data = query.validated_data
        month = date_cls.fromisoformat(f"{data['month']}-01") if data.get("month") else None
        return Response(build_report(
            pk, request.user.school_id, route_id=data.get("route"), month=month,
            day=data.get("date"), shift=data.get("shift") or "morning",
        ))

    def create(self, request, *args, **kwargs):
        raise MethodNotAllowed("POST")

    @action(detail=True, methods=["post"], url_path="log")
    def log(self, request, pk=None):
        serializer = TransportReportLogSerializer(data={**request.data, "report": pk})
        serializer.is_valid(raise_exception=True)
        serializer.save(school=request.user.school, generated_by=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="recent")
    def recent(self, request):
        return Response(TransportReportLogSerializer(self._logs()[:20], many=True).data)


# Transport Settings
class TransportSettingsViewSet(PermissionScopedViewSet):
    """GET /transport-settings/ - the school's settings; PUT/PATCH /transport-settings/ - save sections."""

    permission_classes = [permissions.IsAuthenticated]
    permission_codes = {"*": SETTINGS_VIEW, "save": SETTINGS_EDIT}
    http_method_names = ["get", "put", "patch", "head", "options"]

    def list(self, request, *args, **kwargs):
        return Response(get_settings(request.user.school_id))

    @action(detail=False, methods=["put", "patch"], url_path="save")
    def save(self, request):
        if request.user.school is None:
            raise ValidationError({"school": "Your account is not linked to a school."})
        serializer = TransportSettingsSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        return Response(serializer.save_for(request.user.school, request.user))
