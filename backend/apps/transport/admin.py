from django.contrib import admin

from .models import (
    AssignVehicle,
    FuelEntry,
    StudentTransportAllocation,
    TransportAlert,
    TransportAttendance,
    TransportReportLog,
    TransportSettings,
    TransportRoute,
    TransportStaffProfile,
    Vehicle,
    VehicleServiceRecord,
)

# Transport Module Admin (moved from apps.core.admin)
admin.site.register(Vehicle)
admin.site.register(TransportRoute)
admin.site.register(AssignVehicle)

# Phase 2
admin.site.register(TransportStaffProfile)
admin.site.register(StudentTransportAllocation)
admin.site.register(TransportAttendance)
admin.site.register(TransportAlert)

# Phase 3
admin.site.register(VehicleServiceRecord)
admin.site.register(FuelEntry)
admin.site.register(TransportReportLog)
admin.site.register(TransportSettings)
