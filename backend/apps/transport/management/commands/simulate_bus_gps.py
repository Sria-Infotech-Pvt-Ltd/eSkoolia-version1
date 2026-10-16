"""
Development-only GPS simulator for Live Tracking.

Moves a vehicle along its assigned route's stops, feeding each position through
the same tracking service as real GPS devices (services/tracking.py) so stop
arrivals, pickups and the boarding register can be exercised without hardware.

Safety:
- refuses to run unless settings.DEBUG is on (or --allow-non-debug is passed);
- every position is stored with is_simulated=True and the live feed reports it;
- simulated positions never notify parents and never mark school attendance.

Usage: python manage.py simulate_bus_gps --vehicle 12 [--steps 6] [--interval 2]
"""
import time

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.transport.models import AssignVehicle, BusStop, Vehicle
from apps.transport.serializers import BusLocationSerializer
from apps.transport.services.realtime import broadcast_alert, broadcast_location
from apps.transport.services.tracking import process_gps_update


class Command(BaseCommand):
    help = "Simulate GPS positions for one vehicle along its route (development only; data is flagged as simulated)."

    def add_arguments(self, parser):
        parser.add_argument("--vehicle", type=int, required=True, help="Vehicle id")
        parser.add_argument("--steps", type=int, default=6, help="Positions between consecutive stops")
        parser.add_argument("--interval", type=float, default=2.0, help="Seconds between positions")
        parser.add_argument("--speed", type=int, default=28, help="Reported speed in km/h")
        parser.add_argument("--allow-non-debug", action="store_true", help="Run even when DEBUG is off")

    def handle(self, *args, **options):
        if not settings.DEBUG and not options["allow_non_debug"]:
            raise CommandError("simulate_bus_gps is development-only: DEBUG is off (pass --allow-non-debug to override).")

        vehicle = Vehicle.objects.filter(id=options["vehicle"]).first()
        if not vehicle:
            raise CommandError(f"Vehicle {options['vehicle']} not found.")
        assignment = AssignVehicle.objects.filter(vehicle=vehicle, active_status=True).select_related("route").first()
        if not assignment:
            raise CommandError(f"{vehicle.vehicle_no} has no active route assignment.")
        stops = list(BusStop.objects.filter(route=assignment.route, active_status=True).order_by("stop_order", "id"))
        if not stops:
            raise CommandError(f"Route {assignment.route.title} has no stops.")

        steps = max(1, options["steps"])
        self.stdout.write(self.style.WARNING(
            f"SIMULATED GPS for {vehicle.vehicle_no} on {assignment.route.title} ({len(stops)} stops) - not real data."
        ))
        waypoints = [(float(s.latitude), float(s.longitude)) for s in stops]
        positions = [waypoints[0]]
        for (lat1, lng1), (lat2, lng2) in zip(waypoints, waypoints[1:]):
            for i in range(1, steps + 1):
                t = i / steps
                positions.append((lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t))

        for latitude, longitude in positions:
            result = process_gps_update(vehicle, latitude, longitude, options["speed"], simulated=True)
            broadcast_location(BusLocationSerializer(result.location).data, vehicle.school_id)
            for alert in (result.alert, result.overspeed_alert):
                if alert:
                    broadcast_alert(alert)
            reached = f" -> reached {result.stop_reached['stop_name']}" if result.stop_reached else ""
            self.stdout.write(f"  {latitude:.6f}, {longitude:.6f}{reached}")
            time.sleep(max(0.0, options["interval"]))
        self.stdout.write(self.style.SUCCESS("Simulation finished."))
