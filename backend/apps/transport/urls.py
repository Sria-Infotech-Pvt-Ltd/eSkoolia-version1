"""
Transport API routes (moved from apps.core.urls).

Mounted at /api/v1/core/ in config/urls.py and config/urls_tenant.py so every
existing endpoint keeps its URL (/api/v1/core/vehicles/, /bus-stops/, ...) and
basename (vehicle-list, bus-stop-detail, ...).
"""
from rest_framework.routers import DefaultRouter

from .views import (
    AssignVehicleViewSet,
    BusLocationViewSet,
    BusRoutePickupUpdateViewSet,
    BusStopViewSet,
    FuelEntryViewSet,
    RoutePerformanceLogViewSet,
    StudentTransportAllocationViewSet,
    TransportAlertViewSet,
    TransportAttendanceViewSet,
    TransportDashboardViewSet,
    TransportNotificationLogViewSet,
    TransportReportViewSet,
    TransportSettingsViewSet,
    TransportRouteViewSet,
    TransportStaffProfileViewSet,
    VehicleDriverAssignmentViewSet,
    VehicleServiceRecordViewSet,
    VehicleViewSet,
)

router = DefaultRouter()

# Transport Module Routes
router.register("vehicles", VehicleViewSet, basename="vehicle")
router.register("transport-routes", TransportRouteViewSet, basename="transport-route")
router.register("assign-vehicles", AssignVehicleViewSet, basename="assign-vehicle")

# Bus Tracking Module Routes
router.register("bus-stops", BusStopViewSet, basename="bus-stop")
router.register("bus-locations", BusLocationViewSet, basename="bus-location")
router.register("transport-alerts", TransportAlertViewSet, basename="transport-alert")
router.register("bus-pickups", BusRoutePickupUpdateViewSet, basename="bus-pickup")
router.register("vehicle-driver-assignments", VehicleDriverAssignmentViewSet, basename="vehicle-driver-assignment")
router.register("transport-notification-logs", TransportNotificationLogViewSet, basename="transport-notification-log")
router.register("route-performance-logs", RoutePerformanceLogViewSet, basename="route-performance-log")

# Phase 2: drivers/attendants, student allocation, boarding register
router.register("transport-staff", TransportStaffProfileViewSet, basename="transport-staff")
router.register("transport-allocations", StudentTransportAllocationViewSet, basename="transport-allocation")
router.register("transport-attendance", TransportAttendanceViewSet, basename="transport-attendance")

# Phase 3: maintenance, fuel, dashboard summary, reports
router.register("transport-maintenance", VehicleServiceRecordViewSet, basename="transport-maintenance")
router.register("transport-fuel", FuelEntryViewSet, basename="transport-fuel")
router.register("transport-dashboard", TransportDashboardViewSet, basename="transport-dashboard")
router.register("transport-reports", TransportReportViewSet, basename="transport-report")

# Phase 4: settings
router.register("transport-settings", TransportSettingsViewSet, basename="transport-settings")

urlpatterns = router.urls
