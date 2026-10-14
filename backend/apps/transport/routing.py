from django.urls import re_path
from .consumers import BusLocationConsumer, BusAlertConsumer

websocket_urlpatterns = [
    # Real-time bus location updates
    re_path(
        r"^ws/bus-tracking/location/(?:(?P<route_id>\d+)/)?(?:(?P<vehicle_id>\d+)/)?$",
        BusLocationConsumer.as_asgi()
    ),
    # Real-time transport alerts
    re_path(r"^ws/bus-alerts/$", BusAlertConsumer.as_asgi()),
]
