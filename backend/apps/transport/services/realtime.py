"""
Live broadcasts to WebSocket clients (apps/transport/consumers.py).

Every message goes to the school's own group only (bus_location_school_<id>,
bus_alerts_school_<id>), so live positions and alerts never cross schools.
Message shapes are unchanged from the original core implementation.
"""
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from ..consumers import school_group


def broadcast_location(location_payload, school_id):
    channel_layer = get_channel_layer()
    if not channel_layer:
        return
    async_to_sync(channel_layer.group_send)(
        school_group("bus_location", school_id),
        {"type": "bus_location_update", "location": location_payload},
    )


def broadcast_alert(alert):
    channel_layer = get_channel_layer()
    if not channel_layer:
        return
    async_to_sync(channel_layer.group_send)(
        school_group("bus_alerts", alert.vehicle.school_id),
        {
            "type": "alert_message",
            "alert": {
                "id": alert.id,
                "vehicle": alert.vehicle_id,
                "vehicle_no": alert.vehicle.vehicle_no,
                "route": alert.route_id,
                "route_title": alert.route.title if alert.route else None,
                "alert_type": alert.alert_type,
                "message": alert.message,
                "severity": alert.severity,
                "state": alert.state,
                "latitude": float(alert.latitude) if alert.latitude is not None else None,
                "longitude": float(alert.longitude) if alert.longitude is not None else None,
                "is_resolved": alert.is_resolved,
                "created_at": alert.created_at.isoformat(),
                "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
            },
        },
    )
