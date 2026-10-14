"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import { AlertTriangle, BusFront, CircleDot, Filter, MapPinned, RefreshCw, Route, Search, ShieldAlert, Smartphone, Timer, Users } from "lucide-react";

import { apiRequestWithRefresh } from "@/lib/api-auth";
import { extractListData, type ListApiResponse } from "@/lib/pagination";
import { API_BASE_URL } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";

const MapContainer = dynamic(() => import("react-leaflet").then((module) => module.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then((module) => module.TileLayer), { ssr: false });
const CircleMarker = dynamic(() => import("react-leaflet").then((module) => module.CircleMarker), { ssr: false });
const Polyline = dynamic(() => import("react-leaflet").then((module) => module.Polyline), { ssr: false });
const Popup = dynamic(() => import("react-leaflet").then((module) => module.Popup), { ssr: false });

type RouteItem = {
  id: number;
  title: string;
  fare?: string | number | null;
  active_status?: boolean;
};

type VehicleItem = {
  id: number;
  vehicle_no: string;
  vehicle_model?: string | null;
  made_year?: string | number | null;
  driver_name?: string | null;
  active_status?: boolean;
};

type AssignVehicleItem = {
  id: number;
  vehicle: number;
  vehicle_no?: string | null;
  route: number;
  route_title?: string | null;
  active_status?: boolean;
};

type BusStopItem = {
  id: number;
  route: number;
  route_title?: string | null;
  stop_name: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  stop_order?: number | null;
  stop_type?: "start" | "middle" | "end";
  scheduled_time?: string | null;
  geofence_radius?: number | null;
  arrival_time_window?: string | null;
  active_status?: boolean;
};

type BusLocationItem = {
  id: number;
  vehicle: number;
  vehicle_no?: string | null;
  latitude: string | number;
  longitude: string | number;
  speed?: string | number | null;
  heading?: string | number | null;
  accuracy?: string | number | null;
  timestamp?: string | null;
  is_active?: boolean;
};

type TransportAlertItem = {
  id: number;
  vehicle: number;
  vehicle_no?: string | null;
  route?: number | null;
  route_title?: string | null;
  alert_type: string;
  message: string;
  severity?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  is_resolved?: boolean;
  created_at?: string | null;
  resolved_at?: string | null;
};

type StudentItem = {
  id: number;
  admission_no?: string | null;
  roll_no?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  current_class?: number | string | null;
  current_section?: number | string | null;
  transport_route_title?: string | null;
  vehicle_no?: string | null;
  is_active?: boolean;
};

type BusPickupItem = {
  id: number;
  stop: number;
  stop_name?: string | null;
  vehicle: number;
  vehicle_no?: string | null;
  student: number;
  student_name?: string | null;
  arrived_at?: string | null;
  picked_up_at?: string | null;
  status?: string | null;
};

type ServerEtaStop = {
  stop_id: number;
  stop_name: string;
  stop_order: number;
  scheduled_time?: string | null;
  status: "reached" | "next" | "upcoming";
  eta_minutes?: number | null;
  reached_at?: string | null;
};

type ServerEtaResponse = {
  vehicle_id: number;
  route_id?: number | null;
  next_stop?: { id: number; name: string; order: number } | null;
  stops: ServerEtaStop[];
};

type BusStatus = "moving" | "stopped" | "idle" | "offline";

type LiveBus = {
  vehicleId: number;
  vehicleNo: string;
  model: string;
  driverName: string;
  routeId: number | null;
  routeTitle: string;
  active: boolean;
  assignmentId: number | null;
  location: BusLocationItem | null;
  status: BusStatus;
  lastSeenText: string;
  speedText: string;
  etaText: string;
  nextStop: string;
  studentCount: number;
  pickupCount: number;
  alertCount: number;
};

type BusTrackingPanelProps = {
  hideHeader?: boolean;
};

const routeColors = ["#3b82f6", "#f97316", "#10b981", "#ef4444", "#eab308", "#0ea5e9", "#8b5cf6", "#14b8a6"];
const offlineMinutes = 2;

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function formatClock(value: string | null | undefined): string {
  if (!value) {
    return "--";
  }

  const dateValue = new Date(value);
  if (Number.isNaN(dateValue.getTime())) {
    return "--";
  }

  return dateValue.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatRelativeTime(value: string | null | undefined): string {
  if (!value) {
    return "No update";
  }

  const dateValue = new Date(value);
  if (Number.isNaN(dateValue.getTime())) {
    return "No update";
  }

  const diffMs = Date.now() - dateValue.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) {
    return "just now";
  }
  if (diffMinutes === 1) {
    return "1 minute ago";
  }
  return `${diffMinutes} minutes ago`;
}

function formatScheduleTime(value: string | null | undefined): string {
  if (!value) {
    return "--";
  }

  const timePart = value.includes("T") ? value.split("T")[1] : value;
  const parts = timePart.split(":");
  if (parts.length < 2) {
    return value;
  }

  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return value;
  }

  const period = hour >= 12 ? "PM" : "AM";
  const twelveHour = hour % 12 || 12;
  return `${String(twelveHour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${period}`;
}

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthRadiusKm = 6371;
  const latitudeDelta = ((lat2 - lat1) * Math.PI) / 180;
  const longitudeDelta = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(longitudeDelta / 2) * Math.sin(longitudeDelta / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function getAlertTone(value?: string | null): { border: string; text: string; fill: string } {
  const severity = (value || "info").toLowerCase();

  if (severity === "critical" || severity === "danger") {
    return { border: "border-red-500/50", text: "text-red-100", fill: "bg-red-500/15" };
  }
  if (severity === "warning") {
    return { border: "border-amber-500/50", text: "text-amber-100", fill: "bg-amber-500/15" };
  }

  return { border: "border-sky-500/50", text: "text-sky-100", fill: "bg-sky-500/15" };
}

function getStatusTone(status: BusStatus): { label: string; className: string } {
  if (status === "moving") {
    return { label: "Moving", className: "bg-emerald-500/15 text-emerald-200 border-emerald-500/40" };
  }
  if (status === "stopped") {
    return { label: "Stopped", className: "bg-amber-500/15 text-amber-200 border-amber-500/40" };
  }
  if (status === "idle") {
    return { label: "Idle", className: "bg-sky-500/15 text-sky-200 border-sky-500/40" };
  }

  return { label: "Offline", className: "bg-slate-500/15 text-slate-200 border-slate-500/40" };
}

function getRouteColor(index: number): string {
  return routeColors[index % routeColors.length];
}

function buildWebSocketUrl(path: string): string {
  const parsedBaseUrl = new URL(API_BASE_URL);
  const protocol = parsedBaseUrl.protocol === "https:" ? "wss:" : "ws:";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  // Transport sockets require authentication (same ?token= pattern as chat).
  const token = getAccessToken();
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${protocol}//${parsedBaseUrl.host}${normalizedPath}${query}`;
}

function buildPolyline(stops: BusStopItem[]): [number, number][] {
  return stops
    .map((stop) => [toNumber(stop.latitude), toNumber(stop.longitude)] as const)
    .filter((point): point is [number, number] => point[0] !== null && point[1] !== null)
    .map(([latitude, longitude]) => [latitude, longitude]);
}

function splitStudentName(student: StudentItem): string {
  const firstName = (student.first_name || "").trim();
  const lastName = (student.last_name || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || student.admission_no || `Student #${student.id}`;
}

export default function BusTrackingPanel({ hideHeader = false }: BusTrackingPanelProps) {
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [assignments, setAssignments] = useState<AssignVehicleItem[]>([]);
  const [stops, setStops] = useState<BusStopItem[]>([]);
  const [locations, setLocations] = useState<BusLocationItem[]>([]);
  const [alerts, setAlerts] = useState<TransportAlertItem[]>([]);
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [selectedBusId, setSelectedBusId] = useState<number | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<"all" | BusStatus>("all");
  const [studentClassFilter, setStudentClassFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [pickupUpdates, setPickupUpdates] = useState<BusPickupItem[]>([]);
  const [serverEtaStops, setServerEtaStops] = useState<ServerEtaStop[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapInstance, setMapInstance] = useState<LeafletMap | null>(null);
  const locationSocketRef = useRef<WebSocket | null>(null);
  const alertSocketRef = useRef<WebSocket | null>(null);

  const routeById = useMemo(() => {
    return new Map(routes.map((route) => [route.id, route]));
  }, [routes]);

  const stopsByRoute = useMemo(() => {
    const groups = new Map<number, BusStopItem[]>();

    stops.forEach((stop) => {
      const existingStops = groups.get(stop.route) || [];
      existingStops.push(stop);
      groups.set(stop.route, existingStops);
    });

    groups.forEach((routeStops) => {
      routeStops.sort((left, right) => (Number(left.stop_order || 0) - Number(right.stop_order || 0)));
    });

    return groups;
  }, [stops]);

  const assignmentByVehicle = useMemo(() => {
    const groups = new Map<number, AssignVehicleItem>();

    assignments.forEach((assignment) => {
      if (!groups.has(assignment.vehicle)) {
        groups.set(assignment.vehicle, assignment);
      }
    });

    return groups;
  }, [assignments]);

  const locationByVehicle = useMemo(() => {
    return new Map(locations.map((location) => [location.vehicle, location]));
  }, [locations]);

  const latestAlertByVehicle = useMemo(() => {
    const groups = new Map<number, TransportAlertItem[]>();

    alerts.forEach((alert) => {
      const currentAlerts = groups.get(alert.vehicle) || [];
      currentAlerts.push(alert);
      groups.set(alert.vehicle, currentAlerts);
    });

    return groups;
  }, [alerts]);

  const classOptions = useMemo(() => {
    const classes = new Set<string>();

    students.forEach((student) => {
      const classValue = student.current_class;
      if (classValue !== null && classValue !== undefined && `${classValue}`.trim() !== "") {
        classes.add(`${classValue}`.trim());
      }
    });

    return Array.from(classes).sort((left, right) => Number(left) - Number(right));
  }, [students]);

  const liveBuses = useMemo(() => {
    const busRows = vehicles.map((vehicle) => {
      const location = locationByVehicle.get(vehicle.id) || null;
      const assignment = assignmentByVehicle.get(vehicle.id) || null;
      const routeId = assignment ? assignment.route : null;
      const routeTitle = assignment?.route_title || (routeId ? routeById.get(routeId)?.title || "Unassigned route" : "Unassigned route");
      const alertsForVehicle = latestAlertByVehicle.get(vehicle.id) || [];
      const speedValue = toNumber(location?.speed);
      const timestampValue = location?.timestamp || null;
      const timestampDate = timestampValue ? new Date(timestampValue) : null;
      const isFresh = timestampDate ? Date.now() - timestampDate.getTime() < offlineMinutes * 60 * 1000 : false;
      let status: BusStatus = "offline";

      if (location && isFresh) {
        if ((speedValue || 0) > 5) {
          status = "moving";
        } else if ((speedValue || 0) === 0) {
          status = "stopped";
        } else {
          status = "idle";
        }
      } else if (location) {
        status = "offline";
      }

      const busStops = routeId ? stopsByRoute.get(routeId) || [] : [];
      const nextStop = getNextStopLabel(location, busStops);
      const etaText = getEtaText(location, busStops);

      const studentCount = students.filter((student) => {
        const studentVehicleNo = (student.vehicle_no || "").trim().toLowerCase();
        const busVehicleNo = (vehicle.vehicle_no || "").trim().toLowerCase();
        const routeMatches = routeTitle !== "Unassigned route" && (student.transport_route_title || "").trim().toLowerCase() === routeTitle.trim().toLowerCase();
        const vehicleMatches = studentVehicleNo && busVehicleNo && studentVehicleNo === busVehicleNo;
        return routeMatches || vehicleMatches;
      }).length;

      return {
        vehicleId: vehicle.id,
        vehicleNo: vehicle.vehicle_no,
        model: vehicle.vehicle_model || "Vehicle",
        driverName: vehicle.driver_name || "Not assigned",
        routeId,
        routeTitle,
        active: Boolean(vehicle.active_status),
        assignmentId: assignment?.id || null,
        location,
        status,
        lastSeenText: location?.timestamp ? formatRelativeTime(location.timestamp) : "No update",
        speedText: location ? `${Math.round(speedValue || 0)} km/h` : "--",
        etaText,
        nextStop,
        studentCount,
        pickupCount: pickupUpdates.filter((pickup) => pickup.vehicle === vehicle.id).length,
        alertCount: alertsForVehicle.filter((alert) => !alert.is_resolved).length,
      };
    });

    const filteredRows = busRows.filter((busRow) => {
      const matchesSearch =
        !searchTerm ||
        busRow.vehicleNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        busRow.routeTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
        busRow.driverName.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesRoute = selectedRouteId === null || busRow.routeId === selectedRouteId;
      const matchesStatus = selectedStatus === "all" || busRow.status === selectedStatus;

      return matchesSearch && matchesRoute && matchesStatus;
    });

    return filteredRows.sort((left, right) => {
      const leftRoute = left.routeTitle.toLowerCase();
      const rightRoute = right.routeTitle.toLowerCase();

      if (leftRoute !== rightRoute) {
        return leftRoute.localeCompare(rightRoute);
      }

      return left.vehicleNo.localeCompare(right.vehicleNo);
    });
  }, [assignmentByVehicle, latestAlertByVehicle, locationByVehicle, pickupUpdates, routeById, searchTerm, selectedRouteId, selectedStatus, students, stopsByRoute, vehicles]);

  const selectedBus = useMemo(() => {
    return liveBuses.find((bus) => bus.vehicleId === selectedBusId) || liveBuses[0] || null;
  }, [liveBuses, selectedBusId]);

  const selectedRoute = useMemo(() => {
    if (selectedBus?.routeId) {
      return routeById.get(selectedBus.routeId) || null;
    }

    return selectedRouteId ? routeById.get(selectedRouteId) || null : null;
  }, [routeById, selectedBus, selectedRouteId]);

  const selectedRouteStops = useMemo(() => {
    if (!selectedRoute?.id) {
      return [] as BusStopItem[];
    }

    return stopsByRoute.get(selectedRoute.id) || [];
  }, [selectedRoute, stopsByRoute]);

  const selectedBusTimeline = useMemo(() => {
    if (!selectedBus) {
      return [] as Array<{
        stop: BusStopItem;
        status: "reached" | "next" | "upcoming";
        etaText: string;
        reachedAt: string | null;
      }>;
    }

    const routeStops = [...selectedRouteStops].sort((left, right) => Number(left.stop_order || 0) - Number(right.stop_order || 0));
    if (routeStops.length === 0) {
      return [];
    }

    const serverStopById = new Map(serverEtaStops.map((row) => [row.stop_id, row]));

    const updatesForBus = pickupUpdates.filter((pickup) => pickup.vehicle === selectedBus.vehicleId);
    const reachedStopIds = new Set(
      updatesForBus
        .filter((pickup) => {
          const value = (pickup.status || "").toLowerCase();
          return value === "arrived" || value === "picked_up";
        })
        .map((pickup) => pickup.stop)
    );

    const reachedTimeByStop = new Map<number, string>();
    updatesForBus.forEach((pickup) => {
      if (!pickup.stop) {
        return;
      }
      const timestamp = pickup.picked_up_at || pickup.arrived_at;
      if (!timestamp) {
        return;
      }
      const existing = reachedTimeByStop.get(pickup.stop);
      if (!existing || new Date(timestamp).getTime() > new Date(existing).getTime()) {
        reachedTimeByStop.set(pickup.stop, timestamp);
      }
    });

    const nextStop = routeStops.find((stop) => !reachedStopIds.has(stop.id)) || null;
    const busLatitude = toNumber(selectedBus.location?.latitude);
    const busLongitude = toNumber(selectedBus.location?.longitude);
    const speedKmh = Math.max(1, toNumber(selectedBus.location?.speed) || 1);

    return routeStops.map((stop) => {
      const serverRow = serverStopById.get(stop.id);
      const isReached = reachedStopIds.has(stop.id) || serverRow?.status === "reached";
      const status: "reached" | "next" | "upcoming" =
        serverRow?.status || (isReached ? "reached" : nextStop?.id === stop.id ? "next" : "upcoming");

      let etaText = "--";
      if (typeof serverRow?.eta_minutes === "number") {
        etaText = `${Math.max(1, Math.round(serverRow.eta_minutes))} min`;
      }
      if (!isReached && typeof serverRow?.eta_minutes !== "number" && busLatitude !== null && busLongitude !== null) {
        const stopLatitude = toNumber(stop.latitude);
        const stopLongitude = toNumber(stop.longitude);
        if (stopLatitude !== null && stopLongitude !== null) {
          const distance = haversineDistanceKm(busLatitude, busLongitude, stopLatitude, stopLongitude);
          etaText = `${Math.max(1, Math.round((distance / speedKmh) * 60))} min`;
        }
      }

      return {
        stop,
        status,
        etaText,
        reachedAt: serverRow?.reached_at || reachedTimeByStop.get(stop.id) || null,
      };
    });
  }, [pickupUpdates, selectedBus, selectedRouteStops, serverEtaStops]);

  const selectedStopStatusById = useMemo(() => {
    return new Map(selectedBusTimeline.map((item) => [item.stop.id, item.status]));
  }, [selectedBusTimeline]);

  const selectedBusPickupRows = useMemo(() => {
    if (!selectedBus) {
      return [] as Array<{ student: StudentItem; pickup: BusPickupItem | null }>;
    }

    const selectedVehicleId = selectedBus.vehicleId;
    const selectedVehicleNo = selectedBus.vehicleNo.trim().toLowerCase();
    const selectedRouteTitle = selectedBus.routeTitle.trim().toLowerCase();
    const pickupByStudent = new Map<number, BusPickupItem>();

    pickupUpdates
      .filter((pickup) => pickup.vehicle === selectedVehicleId)
      .forEach((pickup) => {
        pickupByStudent.set(pickup.student, pickup);
      });

    return students
      .filter((student) => {
        const studentVehicle = (student.vehicle_no || "").trim().toLowerCase();
        const studentRoute = (student.transport_route_title || "").trim().toLowerCase();
        const matchesVehicle = studentVehicle && studentVehicle === selectedVehicleNo;
        const matchesRoute = studentRoute && studentRoute === selectedRouteTitle;
        return matchesVehicle || matchesRoute;
      })
      .filter((student) => {
        if (studentClassFilter === "all") {
          return true;
        }

        return `${student.current_class || ""}`.trim() === studentClassFilter;
      })
      .map((student) => ({
        student,
        pickup: pickupByStudent.get(student.id) || null,
      }))
      .sort((left, right) => splitStudentName(left.student).localeCompare(splitStudentName(right.student)));
  }, [pickupUpdates, selectedBus, studentClassFilter, students]);

  const visibleAlerts = useMemo(() => {
    return alerts
      .filter((alert) => !alert.is_resolved)
      .filter((alert) => {
        if (selectedBusId && alert.vehicle !== selectedBusId) {
          return false;
        }

        if (selectedRouteId && alert.route && alert.route !== selectedRouteId) {
          return false;
        }

        return true;
      })
      .slice(0, 8);
  }, [alerts, selectedBusId, selectedRouteId]);

  function getBusRouteStops(bus: LiveBus): BusStopItem[] {
    if (!bus.routeId) {
      return [];
    }

    return stopsByRoute.get(bus.routeId) || [];
  }

  function getNextStopLabel(location: BusLocationItem | null, routeStops: BusStopItem[]): string {
    if (!location || routeStops.length === 0) {
      return routeStops[0]?.stop_name || "Awaiting assignment";
    }

    const latitude = toNumber(location.latitude);
    const longitude = toNumber(location.longitude);

    if (latitude === null || longitude === null) {
      return routeStops[0]?.stop_name || "Awaiting assignment";
    }

    let nearestStop = routeStops[0] || null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    routeStops.forEach((stop) => {
      const stopLatitude = toNumber(stop.latitude);
      const stopLongitude = toNumber(stop.longitude);

      if (stopLatitude === null || stopLongitude === null) {
        return;
      }

      const distance = haversineDistanceKm(latitude, longitude, stopLatitude, stopLongitude);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestStop = stop;
      }
    });

    return nearestStop?.stop_name || "Next stop unavailable";
  }

  function getEtaText(location: BusLocationItem | null, routeStops: BusStopItem[]): string {
    if (!location || routeStops.length === 0) {
      return "ETA unavailable";
    }

    const latitude = toNumber(location.latitude);
    const longitude = toNumber(location.longitude);
    const speedKmPerHour = Math.max(1, toNumber(location.speed) || 1);

    if (latitude === null || longitude === null) {
      return "ETA unavailable";
    }

    let nearestDistance = Number.POSITIVE_INFINITY;

    routeStops.forEach((stop) => {
      const stopLatitude = toNumber(stop.latitude);
      const stopLongitude = toNumber(stop.longitude);

      if (stopLatitude === null || stopLongitude === null) {
        return;
      }

      const distance = haversineDistanceKm(latitude, longitude, stopLatitude, stopLongitude);
      if (distance < nearestDistance) {
        nearestDistance = distance;
      }
    });

    if (!Number.isFinite(nearestDistance)) {
      return "ETA unavailable";
    }

    const etaMinutes = Math.max(1, Math.round((nearestDistance / speedKmPerHour) * 60));
    return `${etaMinutes} min`;
  }

  async function loadData() {
    try {
      setError(null);

      const [routeData, vehicleData, assignmentData, stopData, locationData, alertData, studentData] = await Promise.all([
        apiRequestWithRefresh<ListApiResponse<RouteItem>>("/api/v1/core/transport-routes/"),
        apiRequestWithRefresh<ListApiResponse<VehicleItem>>("/api/v1/core/vehicles/"),
        apiRequestWithRefresh<ListApiResponse<AssignVehicleItem>>("/api/v1/core/assign-vehicles/"),
        apiRequestWithRefresh<ListApiResponse<BusStopItem>>("/api/v1/core/bus-stops/"),
        apiRequestWithRefresh<ListApiResponse<BusLocationItem>>("/api/v1/core/bus-locations/"),
        apiRequestWithRefresh<ListApiResponse<TransportAlertItem>>("/api/v1/core/transport-alerts/"),
        apiRequestWithRefresh<ListApiResponse<StudentItem>>("/api/v1/students/students/?page_size=500"),
      ]);

      setRoutes(extractListData(routeData) as RouteItem[]);
      setVehicles(extractListData(vehicleData) as VehicleItem[]);
      setAssignments(extractListData(assignmentData) as AssignVehicleItem[]);
      setStops(extractListData(stopData) as BusStopItem[]);
      setLocations(extractListData(locationData) as BusLocationItem[]);
      setAlerts((extractListData(alertData) as TransportAlertItem[]).sort((left, right) => {
        const leftDate = new Date(left.created_at || 0).getTime();
        const rightDate = new Date(right.created_at || 0).getTime();
        return rightDate - leftDate;
      }));
      setStudents(extractListData(studentData) as StudentItem[]);

      if (extractListData(studentData).length > 0 && selectedBusId === null) {
        const firstVehicle = extractListData(vehicleData)[0];
        if (firstVehicle) {
          setSelectedBusId(firstVehicle.id);
        }
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load transport dashboard");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  async function loadPickupUpdates(vehicleId: number | null) {
    if (!vehicleId) {
      setPickupUpdates([]);
      return;
    }

    try {
      const payload = await apiRequestWithRefresh<ListApiResponse<BusPickupItem>>(`/api/v1/core/bus-pickups/?vehicle_id=${vehicleId}`);
      setPickupUpdates(extractListData(payload) as BusPickupItem[]);
    } catch {
      setPickupUpdates([]);
    }
  }

  async function loadServerEta(vehicleId: number | null) {
    if (!vehicleId) {
      setServerEtaStops([]);
      return;
    }

    try {
      const payload = await apiRequestWithRefresh<ServerEtaResponse>(`/api/v1/core/bus-locations/eta/?vehicle_id=${vehicleId}`);
      setServerEtaStops(Array.isArray(payload.stops) ? payload.stops : []);
    } catch {
      setServerEtaStops([]);
    }
  }

  async function refreshDashboard() {
    setIsRefreshing(true);
    await loadData();
    await loadPickupUpdates(selectedBusId);
    await loadServerEta(selectedBusId);
  }

  async function resolveAlert(alertId: number) {
    try {
      await apiRequestWithRefresh(`/api/v1/core/transport-alerts/${alertId}/`, {
        method: "PATCH",
        body: JSON.stringify({ is_resolved: true }),
      });

      setAlerts((currentAlerts) => currentAlerts.map((alert) => (alert.id === alertId ? { ...alert, is_resolved: true } : alert)));
    } catch {
      setError("Unable to resolve alert right now.");
    }
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadPickupUpdates(selectedBusId);
    void loadServerEta(selectedBusId);
  }, [selectedBusId]);

  useEffect(() => {
    if (!selectedBusId && liveBuses.length > 0) {
      setSelectedBusId(liveBuses[0].vehicleId);
    }
  }, [liveBuses, selectedBusId]);

  useEffect(() => {
    if (!selectedBus) {
      return;
    }

    setSelectedRouteId(selectedBus.routeId);
  }, [selectedBus]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const locationSocket = new WebSocket(buildWebSocketUrl("/ws/bus-tracking/location/"));
    const alertSocket = new WebSocket(buildWebSocketUrl("/ws/bus-alerts/"));

    locationSocketRef.current = locationSocket;
    alertSocketRef.current = alertSocket;

    const clearSocketError = () => {
      setError((currentError) => {
        if (!currentError) {
          return null;
        }

        return currentError.includes("socket disconnected") ? null : currentError;
      });
    };

    locationSocket.onopen = clearSocketError;
    alertSocket.onopen = clearSocketError;

    locationSocket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);

        if (payload.type === "bus_location_update" && payload.location) {
          const incomingLocation = payload.location as BusLocationItem;

          setLocations((currentLocations) => {
            const remainingLocations = currentLocations.filter((location) => location.vehicle !== incomingLocation.vehicle);
            return [incomingLocation, ...remainingLocations];
          });
        }

        if (payload.type === "bus_alert" && payload.alert) {
          const incomingAlert = payload.alert as TransportAlertItem;
          setAlerts((currentAlerts) => [incomingAlert, ...currentAlerts].slice(0, 50));
        }
      } catch {
        // Ignore invalid websocket payloads.
      }
    };

    alertSocket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);

        if (payload.type === "bus_alert" && payload.alert) {
          const incomingAlert = payload.alert as TransportAlertItem;
          setAlerts((currentAlerts) => [incomingAlert, ...currentAlerts].slice(0, 50));
        }
      } catch {
        // Ignore invalid websocket payloads.
      }
    };

    locationSocket.onerror = () => setError("Live tracking socket disconnected.");
    alertSocket.onerror = () => setError("Alert socket disconnected.");

    locationSocket.onclose = (event) => {
      if (event.code !== 1000) {
        setError("Live tracking socket disconnected.");
      }
    };

    alertSocket.onclose = (event) => {
      if (event.code !== 1000) {
        setError("Alert socket disconnected.");
      }
    };

    return () => {
      locationSocket.close();
      alertSocket.close();
    };
  }, []);

  useEffect(() => {
    if (!mapInstance || !selectedBus?.location) {
      return;
    }

    const latitude = toNumber(selectedBus.location.latitude);
    const longitude = toNumber(selectedBus.location.longitude);

    if (latitude !== null && longitude !== null) {
      mapInstance.flyTo([latitude, longitude], Math.max(mapInstance.getZoom(), 14), { duration: 0.8 });
    }
  }, [mapInstance, selectedBus]);

  const schoolCenter = useMemo(() => {
    const firstStop = selectedRouteStops.find((stop) => toNumber(stop.latitude) !== null && toNumber(stop.longitude) !== null);

    if (firstStop) {
      return [toNumber(firstStop.latitude) || 0, toNumber(firstStop.longitude) || 0] as [number, number];
    }

    const firstBusLocation = locations.find((location) => toNumber(location.latitude) !== null && toNumber(location.longitude) !== null);

    if (firstBusLocation) {
      return [toNumber(firstBusLocation.latitude) || 0, toNumber(firstBusLocation.longitude) || 0] as [number, number];
    }

    return [23.8103, 90.4125] as [number, number];
  }, [locations, selectedRouteStops]);

  const mapPolylines = useMemo(() => {
    if (selectedRouteStops.length > 1) {
      const routePoints = buildPolyline(selectedRouteStops);
      const reachedCount = selectedBusTimeline.filter((item) => item.status === "reached").length;
      const completedPoints = reachedCount >= 1 ? routePoints.slice(0, Math.max(2, reachedCount + 1)) : [];
      const remainingPoints = routePoints.slice(Math.max(0, reachedCount));

      return [
        ...(completedPoints.length > 1
          ? [
              {
                routeId: selectedRoute?.id || 0,
                title: `${selectedRoute?.title || "Route path"} (Completed)`,
                points: completedPoints,
                color: "#0ea5e9",
                dashed: false,
              },
            ]
          : []),
        {
          routeId: selectedRoute?.id || 0,
          title: selectedRoute?.title || "Route path",
          points: remainingPoints,
          color: getRouteColor(0),
          dashed: completedPoints.length > 1,
        },
      ];
    }

    return routes
      .map((route, index) => {
        const routeStops = stopsByRoute.get(route.id) || [];
        const points = buildPolyline(routeStops);
        if (points.length < 2) {
          return null;
        }

        return {
          routeId: route.id,
          title: route.title,
          points,
          color: getRouteColor(index),
          dashed: false,
        };
      })
      .filter((item): item is { routeId: number; title: string; points: [number, number][]; color: string; dashed: boolean } => item !== null);
  }, [routes, selectedBusTimeline, selectedRoute, selectedRouteStops, stopsByRoute]);

  const dashboardStats = useMemo(() => {
    const activeBuses = liveBuses.filter((bus) => bus.status !== "offline").length;
    const movingBuses = liveBuses.filter((bus) => bus.status === "moving").length;
    const unresolvedAlerts = alerts.filter((alert) => !alert.is_resolved).length;
    const trackedStudents = students.filter((student) => (student.transport_route_title || student.vehicle_no)).length;

    return [
      { label: "Active buses", value: activeBuses, note: `${liveBuses.length} tracked vehicles`, icon: BusFront },
      { label: "Moving now", value: movingBuses, note: "Live GPS updates", icon: Smartphone },
      { label: "Open alerts", value: unresolvedAlerts, note: "Needs attention", icon: ShieldAlert },
      { label: "Tracked students", value: trackedStudents, note: "Route and vehicle mapped", icon: Users },
    ];
  }, [alerts, liveBuses, students]);

  const selectedStatusTone = selectedBus ? getStatusTone(selectedBus.status) : null;

  return (
    <div className="transport-live-tracking space-y-6 pb-6">
      {!hideHeader ? (
        <div className="rounded-3xl border border-slate-200/70 bg-white/90 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-sky-600 dark:text-sky-400">
                <Route className="h-4 w-4" />
                Transport Control Center
              </div>
              <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Live bus tracking</h1>
              <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">
                Track vehicles, review alerts, and inspect route pickup activity in one view. The map updates from the existing Django websocket channel.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void refreshDashboard()}
                className="inline-flex items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700 transition hover:bg-sky-100 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                Refresh
              </button>

              <Link
                href="/transport"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <MapPinned className="h-4 w-4" />
                Transport home
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {dashboardStats.map((stat) => {
          const Icon = stat.icon;

          return (
            <div
              key={stat.label}
              className="rounded-3xl border border-slate-200/70 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/90"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{stat.label}</p>
                  <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{stat.value}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{stat.note}</p>
                </div>
                <div className="rounded-2xl bg-sky-500/10 p-3 text-sky-600 dark:text-sky-300">
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Bus map</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">Routes, stops, and vehicle markers stay in sync with websocket updates.</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search bus, route, or driver"
                    className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-sky-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 lg:w-72"
                  />
                </div>

                <select
                  value={selectedRouteId ?? "all"}
                  onChange={(event) => setSelectedRouteId(event.target.value === "all" ? null : Number(event.target.value))}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-sky-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="all">All routes</option>
                  {routes.map((route) => (
                    <option key={route.id} value={route.id}>
                      {route.title}
                    </option>
                  ))}
                </select>

                <select
                  value={selectedStatus}
                  onChange={(event) => setSelectedStatus(event.target.value as typeof selectedStatus)}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-sky-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="all">All statuses</option>
                  <option value="moving">Moving</option>
                  <option value="stopped">Stopped</option>
                  <option value="idle">Idle</option>
                  <option value="offline">Offline</option>
                </select>
              </div>
            </div>

            <div className="h-[420px] overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-800">
              <MapContainer
                center={schoolCenter}
                zoom={13}
                className="h-full w-full"
                ref={setMapInstance}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {mapPolylines.map((polyline, index) => (
                  <Polyline
                    key={`${polyline.routeId}-${index}`}
                    positions={polyline.points}
                    pathOptions={{ color: polyline.color, weight: 5, opacity: 0.8, dashArray: polyline.dashed ? "10 10" : undefined }}
                  />
                ))}

                {selectedRouteStops.map((stop) => {
                  const latitude = toNumber(stop.latitude);
                  const longitude = toNumber(stop.longitude);

                  if (latitude === null || longitude === null) {
                    return null;
                  }

                  const stopStatus = selectedStopStatusById.get(stop.id);
                  const isReached = stopStatus === "reached";
                  const isNext = stopStatus === "next";

                  return (
                    <CircleMarker
                      key={stop.id}
                      center={[latitude, longitude]}
                      radius={isNext ? 10 : 7}
                      pathOptions={{
                        color: isReached ? "#16a34a" : isNext ? "#0ea5e9" : "#64748b",
                        weight: 2,
                        fillColor: isReached ? "#22c55e" : isNext ? "#0ea5e9" : "#94a3b8",
                        fillOpacity: 0.9,
                      }}
                    >
                      <Popup>
                        <div className="space-y-1">
                          <div className="font-semibold text-slate-900">{stop.stop_name}</div>
                          <div className="text-sm text-slate-600">{stop.arrival_time_window || "No arrival window"}</div>
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}

                {liveBuses.map((bus, index) => {
                  if (!bus.location) {
                    return null;
                  }

                  const latitude = toNumber(bus.location.latitude);
                  const longitude = toNumber(bus.location.longitude);

                  if (latitude === null || longitude === null) {
                    return null;
                  }

                  const routeColor = getRouteColor(index);

                  return (
                    <CircleMarker
                      key={bus.vehicleId}
                      center={[latitude, longitude]}
                      radius={12}
                      pathOptions={{ color: routeColor, fillColor: routeColor, fillOpacity: 0.9, weight: 3 }}
                    >
                      <Popup>
                        <div className="space-y-2">
                          <div className="font-semibold text-slate-900">{bus.vehicleNo}</div>
                          <div className="text-sm text-slate-600">{bus.routeTitle}</div>
                          <div className="text-sm text-slate-600">{bus.status.toUpperCase()} · {bus.speedText}</div>
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
              </MapContainer>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Bus list</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Click a vehicle to focus the map and table.</p>
                </div>
                <div className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-300">
                  <Filter className="h-3.5 w-3.5" />
                  {liveBuses.length} shown
                </div>
              </div>

              <div className="space-y-3">
                {liveBuses.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    No buses match the current filters.
                  </div>
                ) : null}

                {liveBuses.map((bus) => {
                  const statusTone = getStatusTone(bus.status);
                  const isSelected = selectedBus?.vehicleId === bus.vehicleId;
                  const busAlerts = alerts.filter((alert) => alert.vehicle === bus.vehicleId && !alert.is_resolved);
                  const busRouteStops = getBusRouteStops(bus);

                  return (
                    <button
                      key={bus.vehicleId}
                      type="button"
                      onClick={() => setSelectedBusId(bus.vehicleId)}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        isSelected
                          ? "border-sky-400 bg-sky-50 shadow-sm dark:border-sky-400/40 dark:bg-sky-500/10"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <BusFront className="h-4 w-4 text-sky-500" />
                            <span className="font-semibold text-slate-900 dark:text-white">{bus.vehicleNo}</span>
                          </div>
                          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{bus.routeTitle}</p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{bus.driverName}</p>
                        </div>

                        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone.className}`}>
                          {statusTone.label}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-500 dark:text-slate-400">
                        <div>
                          <span className="block text-[11px] uppercase tracking-wide text-slate-400">Speed</span>
                          <span className="font-medium text-slate-700 dark:text-slate-200">{bus.speedText}</span>
                        </div>
                        <div>
                          <span className="block text-[11px] uppercase tracking-wide text-slate-400">Last seen</span>
                          <span className="font-medium text-slate-700 dark:text-slate-200">{bus.lastSeenText}</span>
                        </div>
                        <div>
                          <span className="block text-[11px] uppercase tracking-wide text-slate-400">Next stop</span>
                          <span className="font-medium text-slate-700 dark:text-slate-200">{bus.nextStop}</span>
                        </div>
                        <div>
                          <span className="block text-[11px] uppercase tracking-wide text-slate-400">ETA</span>
                          <span className="font-medium text-slate-700 dark:text-slate-200">{bus.etaText}</span>
                        </div>
                        <div>
                          <span className="block text-[11px] uppercase tracking-wide text-slate-400">Students</span>
                          <span className="font-medium text-slate-700 dark:text-slate-200">{bus.studentCount}</span>
                        </div>
                        <div>
                          <span className="block text-[11px] uppercase tracking-wide text-slate-400">Alerts</span>
                          <span className="font-medium text-slate-700 dark:text-slate-200">{busAlerts.length}</span>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        {busRouteStops.length > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 dark:border-slate-700">
                            <Route className="h-3.5 w-3.5" />
                            {busRouteStops.length} stops
                          </span>
                        ) : null}
                        {bus.pickupCount > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 dark:border-slate-700">
                            <CircleDot className="h-3.5 w-3.5" />
                            {bus.pickupCount} pickup updates
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Selected bus</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{selectedBus?.vehicleNo || "Choose a vehicle"}</p>
                </div>
                {selectedStatusTone ? (
                  <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${selectedStatusTone.className}`}>
                    {selectedStatusTone.label}
                  </span>
                ) : null}
              </div>

              {selectedBus ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Route</p>
                      <p className="mt-1 font-semibold text-slate-900 dark:text-white">{selectedBus.routeTitle}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Driver</p>
                      <p className="mt-1 font-semibold text-slate-900 dark:text-white">{selectedBus.driverName}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Speed</p>
                      <p className="mt-1 font-semibold text-slate-900 dark:text-white">{selectedBus.speedText}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Last update</p>
                      <p className="mt-1 font-semibold text-slate-900 dark:text-white">{formatClock(selectedBus.location?.timestamp || null)}</p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-400">Next stop</p>
                        <p className="mt-1 font-semibold text-slate-900 dark:text-white">{selectedBus.nextStop}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-400">ETA</p>
                        <p className="mt-1 font-semibold text-slate-900 dark:text-white">{selectedBus.etaText}</p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="font-semibold text-slate-900 dark:text-white">Stop timeline</h3>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{selectedBusTimeline.length} route stops</span>
                    </div>

                    <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/50">
                      {selectedBusTimeline.length === 0 ? (
                        <div className="px-1 py-3 text-sm text-slate-500 dark:text-slate-400">No stops available for this route.</div>
                      ) : null}

                      {selectedBusTimeline.map((item) => {
                        const statusLabel = item.status === "reached" ? "Reached" : item.status === "next" ? "Next" : "Upcoming";
                        const statusClass =
                          item.status === "reached"
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : item.status === "next"
                              ? "bg-sky-500/10 text-sky-700 dark:text-sky-300"
                              : "bg-slate-500/10 text-slate-700 dark:text-slate-300";

                        return (
                          <div key={item.stop.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
                            <div>
                              <p className="text-sm font-semibold text-slate-900 dark:text-white">{item.stop.stop_order}. {item.stop.stop_name}</p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">Scheduled {formatScheduleTime(item.stop.scheduled_time || item.stop.arrival_time_window || null)}</p>
                            </div>
                            <div className="text-right">
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClass}`}>{statusLabel}</span>
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {item.status === "reached" ? `at ${formatClock(item.reachedAt)}` : `ETA ${item.etaText}`}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="font-semibold text-slate-900 dark:text-white">Alerts</h3>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{visibleAlerts.length} unresolved</span>
                    </div>

                    <div className="space-y-3">
                      {visibleAlerts.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                          No active alerts for the current selection.
                        </div>
                      ) : null}

                      {visibleAlerts.map((alert) => {
                        const alertTone = getAlertTone(alert.severity);

                        return (
                          <div key={alert.id} className={`rounded-2xl border p-4 ${alertTone.border} ${alertTone.fill}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className={`text-sm font-semibold ${alertTone.text}`}>{alert.alert_type}</p>
                                <p className={`mt-1 text-sm ${alertTone.text}`}>{alert.message}</p>
                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">
                                  {alert.route_title || "Route alert"} · {formatRelativeTime(alert.created_at)}
                                </p>
                              </div>

                              <button
                                type="button"
                                onClick={() => void resolveAlert(alert.id)}
                                className="rounded-xl border border-white/50 bg-white/60 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white dark:bg-slate-950/60 dark:text-slate-200"
                              >
                                Resolve
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="font-semibold text-slate-900 dark:text-white">Pickup activity</h3>
                      <div className="flex items-center gap-2">
                        <select
                          value={studentClassFilter}
                          onChange={(event) => setStudentClassFilter(event.target.value)}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        >
                          <option value="all">All classes</option>
                          {classOptions.map((className) => (
                            <option key={className} value={className}>
                              Class {className}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="max-h-[420px] overflow-auto rounded-2xl border border-slate-200 dark:border-slate-800">
                      <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
                        <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                          <tr>
                            <th className="px-4 py-3">Student</th>
                            <th className="px-4 py-3">Class</th>
                            <th className="px-4 py-3">Stop</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Time</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {selectedBusPickupRows.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                                No pickup activity found for this bus.
                              </td>
                            </tr>
                          ) : null}

                          {selectedBusPickupRows.map(({ student, pickup }) => {
                            const statusValue = (pickup?.status || (pickup?.picked_up_at ? "picked_up" : pickup?.arrived_at ? "arrived" : "waiting")).toLowerCase();
                            const statusClass =
                              statusValue === "picked_up"
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                : statusValue === "arrived"
                                  ? "bg-sky-500/10 text-sky-700 dark:text-sky-300"
                                  : statusValue === "missed"
                                    ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
                                    : "bg-slate-500/10 text-slate-700 dark:text-slate-300";

                            return (
                              <tr key={student.id} className="bg-white/60 dark:bg-slate-950/60">
                                <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{splitStudentName(student)}</td>
                                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">Class {student.current_class || "--"}</td>
                                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{pickup?.stop_name || "--"}</td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass}`}>{statusValue.replace(/_/g, " ")}</span>
                                </td>
                                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                                  {pickup?.picked_up_at ? formatClock(pickup.picked_up_at) : pickup?.arrived_at ? formatClock(pickup.arrived_at) : "--"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  Select a bus to review route stops, pickup activity, and alerts.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Route summary</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">Routes and assignments already in the system.</p>
              </div>
              <Timer className="h-5 w-5 text-sky-500" />
            </div>

            <div className="space-y-3">
              {routes.map((route, index) => {
                const routeStops = stopsByRoute.get(route.id) || [];
                const assignedBuses = assignments.filter((assignment) => assignment.route === route.id).length;
                const trackedStudents = students.filter((student) => (student.transport_route_title || "").trim().toLowerCase() === route.title.trim().toLowerCase()).length;

                return (
                  <button
                    key={route.id}
                    type="button"
                    onClick={() => setSelectedRouteId(route.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      selectedRouteId === route.id
                        ? "border-sky-400 bg-sky-50 dark:border-sky-400/40 dark:bg-sky-500/10"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: getRouteColor(index) }} />
                          <span className="font-semibold text-slate-900 dark:text-white">{route.title}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <span className="rounded-full border border-slate-200 px-2.5 py-1 dark:border-slate-700">{routeStops.length} stops</span>
                          <span className="rounded-full border border-slate-200 px-2.5 py-1 dark:border-slate-700">{assignedBuses} buses</span>
                          <span className="rounded-full border border-slate-200 px-2.5 py-1 dark:border-slate-700">{trackedStudents} students</span>
                        </div>
                      </div>
                      <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
                        {route.active_status ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Recent alerts</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">Latest unresolved transport alerts across all vehicles.</p>
              </div>
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </div>

            <div className="space-y-3">
              {visibleAlerts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  No open alerts.
                </div>
              ) : null}

              {visibleAlerts.map((alert) => {
                const tone = getAlertTone(alert.severity);

                return (
                  <div key={alert.id} className={`rounded-2xl border p-4 ${tone.border} ${tone.fill}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className={`text-sm font-semibold ${tone.text}`}>{alert.vehicle_no || "Vehicle"}</div>
                        <div className={`mt-1 text-sm ${tone.text}`}>{alert.message}</div>
                        <div className="mt-2 text-xs text-slate-500 dark:text-slate-300">{alert.route_title || "Unassigned route"} · {formatRelativeTime(alert.created_at)}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void resolveAlert(alert.id)}
                        className="rounded-xl border border-white/50 bg-white/60 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white dark:bg-slate-950/60 dark:text-slate-200"
                      >
                        Resolve
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}