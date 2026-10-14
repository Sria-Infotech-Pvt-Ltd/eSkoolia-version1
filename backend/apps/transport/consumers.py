"""
Live tracking WebSockets.

Phase 1 security changes (message formats unchanged):
- connections must be authenticated - JWT via `?token=` (same pattern as
  apps/chat/consumers.py) or a Django session; anonymous sockets are closed;
- every socket joins only its own school's group, so positions and alerts never
  reach another school (previously "bus_location_all"/"bus_alerts_all" were global);
- route/vehicle ids in the URL must belong to the user's school;
- pushing a position over the socket needs transport.tracking.update and a vehicle
  of the user's school.
"""
import json
from datetime import timedelta
from decimal import Decimal
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.utils import timezone

from .permissions import TRACKING_UPDATE

CLOSE_UNAUTHENTICATED = 4401
CLOSE_FORBIDDEN = 4403


def school_group(prefix, school_id):
    """Channel-layer group for one school - live updates never cross schools."""
    return f"{prefix}_school_{school_id}"


@database_sync_to_async
def _user_from_token(token):
    try:
        from rest_framework_simplejwt.authentication import JWTAuthentication

        authenticator = JWTAuthentication()
        return authenticator.get_user(authenticator.get_validated_token(token))
    except Exception:  # invalid / expired token, unknown user
        return None


async def resolve_user(scope):
    """JWT from the query string first (frontend), then the session user (AuthMiddlewareStack)."""
    query = parse_qs(scope.get("query_string", b"").decode())
    token = (query.get("token") or [None])[0]
    if token:
        return await _user_from_token(token)
    user = scope.get("user")
    return user if user is not None and user.is_authenticated else None


class BusLocationConsumer(AsyncWebsocketConsumer):
    """
    Real-time bus location updates for the user's school.

    URL: ws/bus-tracking/location/[<route_id>/][<vehicle_id>/]?token=<jwt>
    Client messages: {"action": "get_active_buses"} or
    {"action": "update_location", "vehicle_id", "latitude", "longitude", ...}.
    With a route or vehicle in the URL, only that route's / vehicle's updates are sent.
    """

    async def connect(self):
        self.user = await resolve_user(self.scope)
        self.school_id = getattr(self.user, "school_id", None)
        if not self.user or not self.school_id:
            await self.close(code=CLOSE_UNAUTHENTICATED)
            return

        kwargs = self.scope["url_route"]["kwargs"]
        self.route_id = kwargs.get("route_id")
        self.vehicle_id = kwargs.get("vehicle_id")
        self.allowed_vehicle_ids = None  # None = every vehicle of the school
        if self.vehicle_id or self.route_id:
            self.allowed_vehicle_ids = await self._vehicles_in_scope(self.route_id, self.vehicle_id)
            if self.allowed_vehicle_ids is None:
                await self.close(code=CLOSE_FORBIDDEN)
                return

        self.group_name = school_group("bus_location", self.school_id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        """Handle incoming WebSocket messages"""
        try:
            data = json.loads(text_data)
            action = data.get("action")

            if action == "update_location":
                await self.handle_location_update(data)
            elif action == "get_active_buses":
                await self.send_active_buses()
        except json.JSONDecodeError:
            await self.send(text_data=json.dumps({"error": "Invalid JSON"}))
        except Exception as e:
            await self.send(text_data=json.dumps({"error": str(e)}))

    async def handle_location_update(self, data):
        """Handle an incoming GPS position pushed over the socket."""
        vehicle_id = data.get("vehicle_id")
        if not await self._can_push(vehicle_id):
            await self.send(text_data=json.dumps({"error": "Not allowed to update this vehicle's location"}))
            return

        latitude = Decimal(str(data.get("latitude", 0)))
        longitude = Decimal(str(data.get("longitude", 0)))
        speed = int(data.get("speed", 0))
        heading = int(data.get("heading", 0))
        accuracy = int(data.get("accuracy", 0))

        await self.update_bus_location(vehicle_id, latitude, longitude, speed, heading, accuracy)
        await self.check_and_create_alerts(vehicle_id, latitude, longitude, speed)

        await self.channel_layer.group_send(
            self.group_name,
            {
                "type": "bus_location_update",
                "vehicle_id": vehicle_id,
                "latitude": float(latitude),
                "longitude": float(longitude),
                "speed": speed,
                "heading": heading,
                "timestamp": timezone.now().isoformat(),
            },
        )

    async def send_active_buses(self):
        """Send the school's active buses (limited to this socket's route/vehicle if set)."""
        buses = await self.get_active_buses()
        await self.send(text_data=json.dumps({"type": "active_buses", "buses": buses}))

    # Permission and School Validation
    @database_sync_to_async
    def _vehicles_in_scope(self, route_id, vehicle_id):
        """Vehicle ids this socket may follow, or None if the route/vehicle isn't the user's school's."""
        from apps.transport.models import AssignVehicle, TransportRoute, Vehicle

        if vehicle_id:
            if not Vehicle.objects.filter(id=vehicle_id, school_id=self.school_id).exists():
                return None
            return {int(vehicle_id)}
        if not TransportRoute.objects.filter(id=route_id, school_id=self.school_id).exists():
            return None
        return set(
            AssignVehicle.objects.filter(route_id=route_id, school_id=self.school_id, active_status=True)
            .values_list("vehicle_id", flat=True)
        )

    @database_sync_to_async
    def _can_push(self, vehicle_id):
        from apps.transport.models import Vehicle

        if not vehicle_id or not hasattr(self.user, "has_permission_code"):
            return False
        if not self.user.has_permission_code(TRACKING_UPDATE):
            return False
        return Vehicle.objects.filter(id=vehicle_id, school_id=self.school_id).exists()

    @database_sync_to_async
    def update_bus_location(self, vehicle_id, latitude, longitude, speed, heading, accuracy):
        """Update or create bus location in database"""
        from apps.transport.models import BusLocation

        location, created = BusLocation.objects.update_or_create(
            vehicle_id=vehicle_id,
            defaults={
                "latitude": latitude,
                "longitude": longitude,
                "speed": speed,
                "heading": heading,
                "accuracy": accuracy,
                "is_active": True,
            },
        )
        return location

    @database_sync_to_async
    def check_and_create_alerts(self, vehicle_id, latitude, longitude, speed):
        """Check for alert conditions and create alerts if needed"""
        from apps.transport.models import Vehicle

        try:
            vehicle = Vehicle.objects.get(id=vehicle_id, school_id=self.school_id)
            # Check: Bus stopped for > 5 minutes
            self._check_stopped_alert(vehicle, latitude, longitude)
            # Check: Near school (hardcoded coordinates - Transport Settings geofence replaces this in Phase 4)
            self._check_near_school_alert(vehicle, latitude, longitude)
        except Vehicle.DoesNotExist:
            pass

    def _check_stopped_alert(self, vehicle, current_lat, current_lon):
        """Check if bus is stopped (speed=0) for > 5 minutes"""
        from apps.transport.models import BusLocation, TransportAlert

        five_min_ago = timezone.now() - timedelta(minutes=5)
        old_location = BusLocation.objects.filter(
            vehicle=vehicle,
            timestamp__lte=five_min_ago,
        ).order_by("-timestamp").first()

        if old_location and old_location.speed == 0:
            existing_alert = TransportAlert.objects.filter(
                vehicle=vehicle,
                alert_type="stopped",
                is_resolved=False,
            ).exists()

            if not existing_alert:
                TransportAlert.objects.create(
                    vehicle=vehicle,
                    alert_type="stopped",
                    message=f"{vehicle.vehicle_no} has been stopped for more than 5 minutes",
                    severity="warning",
                    latitude=current_lat,
                    longitude=current_lon,
                )

    def _check_near_school_alert(self, vehicle, latitude, longitude):
        """Check if bus is near school (1km radius from school coordinates)"""
        from apps.transport.models import TransportAlert

        # School coordinates (should be fetched from settings)
        SCHOOL_LAT = Decimal("27.1088")
        SCHOOL_LON = Decimal("85.3194")

        # Calculate distance (simplified - use Haversine for production)
        distance = abs(float(latitude) - float(SCHOOL_LAT)) + abs(float(longitude) - float(SCHOOL_LON))

        if distance < 0.01:  # Rough approximation for 1km
            existing_alert = TransportAlert.objects.filter(
                vehicle=vehicle,
                alert_type="near_school",
                is_resolved=False,
                created_at__gte=timezone.now() - timedelta(minutes=30),
            ).exists()

            if not existing_alert:
                TransportAlert.objects.create(
                    vehicle=vehicle,
                    alert_type="near_school",
                    message=f"{vehicle.vehicle_no} is approaching the school",
                    severity="info",
                    latitude=latitude,
                    longitude=longitude,
                )

    @database_sync_to_async
    def get_active_buses(self):
        """The user's school's active buses with their current locations"""
        from apps.transport.models import BusLocation

        locations = BusLocation.objects.filter(
            is_active=True,
            vehicle__active_status=True,
            vehicle__school_id=self.school_id,
        ).select_related("vehicle").order_by("-timestamp")[:100]

        return [
            {
                "id": loc.vehicle.id,
                "vehicle_no": loc.vehicle.vehicle_no,
                "latitude": float(loc.latitude),
                "longitude": float(loc.longitude),
                "speed": loc.speed,
                "heading": loc.heading,
                "timestamp": loc.timestamp.isoformat(),
            }
            for loc in locations
            if self.allowed_vehicle_ids is None or loc.vehicle.id in self.allowed_vehicle_ids
        ]

    def _wants(self, vehicle_id):
        if self.allowed_vehicle_ids is None:
            return True
        try:
            return int(vehicle_id) in self.allowed_vehicle_ids
        except (TypeError, ValueError):
            return False

    # Group message handlers
    async def bus_location_update(self, event):
        """Handle bus_location_update message from channel layer"""
        if event.get("location"):
            if not self._wants(event["location"].get("vehicle")):
                return
            await self.send(text_data=json.dumps({
                "type": "bus_location_update",
                "location": event["location"],
            }))
            return

        if not self._wants(event.get("vehicle_id")):
            return
        await self.send(text_data=json.dumps({
            "type": "bus_location_update",
            "vehicle_id": event["vehicle_id"],
            "latitude": event["latitude"],
            "longitude": event["longitude"],
            "speed": event["speed"],
            "heading": event["heading"],
            "timestamp": event["timestamp"],
        }))

    async def bus_alert_generated(self, event):
        """Handle bus_alert_generated message from channel layer"""
        await self.send(text_data=json.dumps({
            "type": "bus_alert",
            "alert": {
                "vehicle": event["vehicle_id"],
                "alert_type": event["alert_type"],
                "message": event["message"],
                "severity": event["severity"],
                "created_at": timezone.now().isoformat(),
            },
        }))


class BusAlertConsumer(AsyncWebsocketConsumer):
    """
    Real-time transport alerts for the user's school.

    URL: ws/bus-alerts/?token=<jwt>
    """

    async def connect(self):
        self.user = await resolve_user(self.scope)
        school_id = getattr(self.user, "school_id", None)
        if not self.user or not school_id:
            await self.close(code=CLOSE_UNAUTHENTICATED)
            return
        self.group_name = school_group("bus_alerts", school_id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def alert_message(self, event):
        """Handle alert message from channel layer"""
        if event.get("alert"):
            await self.send(text_data=json.dumps({
                "type": "bus_alert",
                "alert": event["alert"],
            }))
            return

        await self.send(text_data=json.dumps({
            "type": "bus_alert",
            "alert": {
                "vehicle": event.get("vehicle_id"),
                "alert_type": event["alert_type"],
                "message": event["message"],
                "severity": event["severity"],
                "created_at": event.get("timestamp") or timezone.now().isoformat(),
            },
        }))
