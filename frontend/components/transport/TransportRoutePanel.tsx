"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import { MapPin, MoveUp, MoveDown, Plus, Route, Save, Trash2 } from "lucide-react";

import { apiRequestWithRefresh } from "@/lib/api-auth";
import { useToast } from "@/components/common/Toast";
import { extractListData, type ListApiResponse } from "@/lib/pagination";

const MapContainer = dynamic(() => import("react-leaflet").then((module) => module.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then((module) => module.TileLayer), { ssr: false });
const CircleMarker = dynamic(() => import("react-leaflet").then((module) => module.CircleMarker), { ssr: false });
const Polyline = dynamic(() => import("react-leaflet").then((module) => module.Polyline), { ssr: false });
const Popup = dynamic(() => import("react-leaflet").then((module) => module.Popup), { ssr: false });

type TransportRoute = {
  id: number;
  title: string;
  fare: string;
  active_status: boolean;
};

type StopType = "start" | "middle" | "end";

type RouteStop = {
  id: number;
  route: number;
  stop_name: string;
  latitude: string | number;
  longitude: string | number;
  stop_order: number;
  stop_type: StopType;
  scheduled_time?: string | null;
  geofence_radius?: number;
  arrival_time_window?: string | null;
};

type BuilderResponse = {
  id: number;
  title: string;
  total_stops: number;
  total_distance_km: number;
  stops: RouteStop[];
};

type StopFormData = {
  stop_name: string;
  latitude: string;
  longitude: string;
  scheduled_time: string;
  stop_type: StopType;
  geofence_radius: string;
};

const defaultCenter: [number, number] = [23.8103, 90.4125];

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatStopType(value: StopType): string {
  if (value === "start") return "Start";
  if (value === "end") return "End";
  return "Middle";
}

async function fetchRoadPath(stops: RouteStop[]): Promise<{ points: [number, number][]; dashed: boolean }> {
  if (stops.length < 2) {
    return { points: [], dashed: false };
  }

  const coordinates = stops
    .map((stop) => {
      const lat = toNumber(stop.latitude);
      const lng = toNumber(stop.longitude);
      if (lat === null || lng === null) {
        return null;
      }
      return `${lng},${lat}`;
    })
    .filter((entry): entry is string => Boolean(entry));

  if (coordinates.length < 2) {
    return { points: [], dashed: false };
  }

  const fallbackPoints = stops
    .map((stop) => [toNumber(stop.latitude), toNumber(stop.longitude)] as const)
    .filter((point): point is [number, number] => point[0] !== null && point[1] !== null)
    .map(([lat, lng]) => [lat, lng] as [number, number]);

  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates.join(";")}?overview=full&geometries=geojson`;

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return { points: fallbackPoints, dashed: true };
    }

    const data = (await response.json()) as {
      routes?: Array<{
        geometry?: {
          coordinates?: Array<[number, number]>;
        };
      }>;
    };

    const coordinatesData = data.routes?.[0]?.geometry?.coordinates;
    if (!coordinatesData || !Array.isArray(coordinatesData)) {
      return { points: fallbackPoints, dashed: true };
    }

    const points = coordinatesData.map(([lng, lat]) => [lat, lng] as [number, number]);
    return { points, dashed: false };
  } catch {
    return { points: fallbackPoints, dashed: true };
  }
}

export function TransportRoutePanel() {
  const [routes, setRoutes] = useState<TransportRoute[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [stops, setStops] = useState<RouteStop[]>([]);
  const [totalDistanceKm, setTotalDistanceKm] = useState<number>(0);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(true);
  const [isLoadingStops, setIsLoadingStops] = useState(false);
  const [isSavingStop, setIsSavingStop] = useState(false);
  const [error, setError] = useState<string>("");
  const toast = useToast();
  const [mapInstance, setMapInstance] = useState<LeafletMap | null>(null);
  const [routePath, setRoutePath] = useState<[number, number][]>([]);
  const [useDashedPath, setUseDashedPath] = useState(false);
  const [form, setForm] = useState<StopFormData>({
    stop_name: "",
    latitude: "",
    longitude: "",
    scheduled_time: "",
    stop_type: "middle",
    geofence_radius: "100",
  });

  const sortedStops = useMemo(() => {
    return [...stops].sort((left, right) => left.stop_order - right.stop_order);
  }, [stops]);

  const selectedRoute = useMemo(() => {
    return routes.find((route) => route.id === selectedRouteId) || null;
  }, [routes, selectedRouteId]);

  const mapCenter = useMemo(() => {
    const firstStop = sortedStops.find((stop) => toNumber(stop.latitude) !== null && toNumber(stop.longitude) !== null);
    if (firstStop) {
      return [toNumber(firstStop.latitude) || 0, toNumber(firstStop.longitude) || 0] as [number, number];
    }
    return defaultCenter;
  }, [sortedStops]);

  async function loadRoutes() {
    try {
      setIsLoadingRoutes(true);
      setError("");
      const payload = await apiRequestWithRefresh<ListApiResponse<TransportRoute>>("/api/v1/core/transport-routes/?page_size=10000");
      const routeList = extractListData(payload);
      setRoutes(routeList);

      if (!selectedRouteId && routeList.length > 0) {
        setSelectedRouteId(routeList[0].id);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load routes");
    } finally {
      setIsLoadingRoutes(false);
    }
  }

  async function loadBuilder(routeId: number) {
    try {
      setIsLoadingStops(true);
      setError("");
      const payload = await apiRequestWithRefresh<BuilderResponse>(`/api/v1/core/transport-routes/${routeId}/builder/`);
      const nextStops = [...(payload.stops || [])].sort((left, right) => left.stop_order - right.stop_order);
      setStops(nextStops);
      setTotalDistanceKm(Number(payload.total_distance_km || 0));

      const pathData = await fetchRoadPath(nextStops);
      setRoutePath(pathData.points);
      setUseDashedPath(pathData.dashed);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load route builder data");
    } finally {
      setIsLoadingStops(false);
    }
  }

  useEffect(() => {
    void loadRoutes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedRouteId) {
      setStops([]);
      setRoutePath([]);
      setUseDashedPath(false);
      setTotalDistanceKm(0);
      return;
    }
    void loadBuilder(selectedRouteId);
  }, [selectedRouteId]);

  useEffect(() => {
    if (!mapInstance) {
      return;
    }

    const handleMapClick = (event: { latlng: { lat: number; lng: number } }) => {
      const latitude = event.latlng.lat.toFixed(6);
      const longitude = event.latlng.lng.toFixed(6);
      setForm((currentForm) => ({ ...currentForm, latitude, longitude }));
    };

    mapInstance.on("click", handleMapClick);
    return () => {
      mapInstance.off("click", handleMapClick);
    };
  }, [mapInstance]);

  async function handleAddStop(event: React.FormEvent) {
    event.preventDefault();

    if (!selectedRouteId) {
      setError("Select a route before adding stops.");
      return;
    }

    try {
      setIsSavingStop(true);
      setError("");

      await apiRequestWithRefresh("/api/v1/core/bus-stops/", {
        method: "POST",
        body: JSON.stringify({
          route: selectedRouteId,
          stop_name: form.stop_name,
          latitude: form.latitude,
          longitude: form.longitude,
          stop_type: form.stop_type,
          scheduled_time: form.scheduled_time || null,
          geofence_radius: Number(form.geofence_radius || 100),
        }),
      });

      setForm((currentForm) => ({
        ...currentForm,
        stop_name: "",
        scheduled_time: "",
        stop_type: "middle",
      }));

      await loadBuilder(selectedRouteId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to add stop");
    } finally {
      setIsSavingStop(false);
    }
  }

  async function handleDeleteStop(stopId: number) {
    if (!selectedRouteId) {
      return;
    }

    try {
      setError("");
      await apiRequestWithRefresh(`/api/v1/core/bus-stops/${stopId}/`, { method: "DELETE" });
      await loadBuilder(selectedRouteId);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete stop");
    }
  }

  async function moveStop(stopId: number, direction: "up" | "down") {
    if (!selectedRouteId) {
      return;
    }

    const currentIndex = sortedStops.findIndex((stop) => stop.id === stopId);
    if (currentIndex < 0) {
      return;
    }

    const swapIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (swapIndex < 0 || swapIndex >= sortedStops.length) {
      return;
    }

    const reordered = [...sortedStops];
    const temp = reordered[currentIndex];
    reordered[currentIndex] = reordered[swapIndex];
    reordered[swapIndex] = temp;

    const payload = reordered.map((stop, index) => ({ id: stop.id, stop_order: index + 1 }));

    try {
      setError("");
      await apiRequestWithRefresh("/api/v1/core/bus-stops/reorder/", {
        method: "PUT",
        body: JSON.stringify({ stops: payload }),
      });
      await loadBuilder(selectedRouteId);
    } catch (reorderError) {
      setError(reorderError instanceof Error ? reorderError.message : "Failed to reorder stops");
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Route Builder</h1>
            <p className="text-sm text-slate-500">Define pickup stops with map coordinates and ordered route flow.</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-slate-600">Route</label>
            <select
              value={selectedRouteId ?? ""}
              onChange={(event) => setSelectedRouteId(event.target.value ? Number(event.target.value) : null)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
            >
              {routes.length === 0 ? <option value="">No routes</option> : null}
              {routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.title}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
              <Plus className="h-4 w-4" />
              Add Stop
            </h2>
            <form onSubmit={handleAddStop} className="space-y-3">
              <input
                required
                value={form.stop_name}
                onChange={(event) => setForm((currentForm) => ({ ...currentForm, stop_name: event.target.value }))}
                placeholder="Stop name"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              />

              <div className="grid grid-cols-2 gap-2">
                <input
                  required
                  value={form.latitude}
                  onChange={(event) => setForm((currentForm) => ({ ...currentForm, latitude: event.target.value }))}
                  placeholder="Latitude"
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                />
                <input
                  required
                  value={form.longitude}
                  onChange={(event) => setForm((currentForm) => ({ ...currentForm, longitude: event.target.value }))}
                  placeholder="Longitude"
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="time"
                  value={form.scheduled_time}
                  onChange={(event) => setForm((currentForm) => ({ ...currentForm, scheduled_time: event.target.value }))}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  min={50}
                  value={form.geofence_radius}
                  onChange={(event) => setForm((currentForm) => ({ ...currentForm, geofence_radius: event.target.value }))}
                  placeholder="Geofence (m)"
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </div>

              <select
                value={form.stop_type}
                onChange={(event) => setForm((currentForm) => ({ ...currentForm, stop_type: event.target.value as StopType }))}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="start">Start stop</option>
                <option value="middle">Middle stop</option>
                <option value="end">End stop</option>
              </select>

              <p className="text-xs text-slate-500">Tip: click on the map to auto-fill latitude and longitude.</p>

              <button
                type="submit"
                disabled={isSavingStop || !selectedRouteId}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {isSavingStop ? "Saving..." : "Add stop"}
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Route Stops</h2>
              <span className="text-xs text-slate-500">{sortedStops.length} stops</span>
            </div>

            <div className="max-h-[440px] space-y-2 overflow-auto pr-1">
              {isLoadingStops ? <div className="text-sm text-slate-500">Loading stops...</div> : null}
              {!isLoadingStops && sortedStops.length === 0 ? <div className="text-sm text-slate-500">No stops yet.</div> : null}

              {sortedStops.map((stop, index) => (
                <div key={stop.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {stop.stop_order}. {stop.stop_name}
                      </p>
                      <p className="text-xs text-slate-600">
                        {formatStopType(stop.stop_type)}
                        {stop.scheduled_time ? ` • ${stop.scheduled_time.slice(0, 5)}` : ""}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => void moveStop(stop.id, "up")}
                        disabled={index === 0}
                        className="rounded-md border border-slate-300 bg-white p-1 text-slate-600 disabled:opacity-40"
                      >
                        <MoveUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void moveStop(stop.id, "down")}
                        disabled={index === sortedStops.length - 1}
                        className="rounded-md border border-slate-300 bg-white p-1 text-slate-600 disabled:opacity-40"
                      >
                        <MoveDown className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteStop(stop.id)}
                        className="rounded-md border border-rose-200 bg-rose-50 p-1 text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">
              {selectedRoute?.title || "Route"}: {sortedStops.length} stops • {totalDistanceKm.toFixed(2)} km
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between px-2">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Route className="h-4 w-4" />
              Route Map
            </h2>
            <span className="text-xs text-slate-500">Click map to pick coordinates</span>
          </div>

          <div className="h-[640px] overflow-hidden rounded-xl border border-slate-200">
            <MapContainer center={mapCenter} zoom={13} className="h-full w-full" ref={setMapInstance}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {routePath.length > 1 ? (
                <Polyline
                  positions={routePath}
                  pathOptions={{
                    color: "#0284c7",
                    weight: 5,
                    opacity: 0.8,
                    dashArray: useDashedPath ? "10 10" : undefined,
                  }}
                />
              ) : null}

              {sortedStops.map((stop) => {
                const latitude = toNumber(stop.latitude);
                const longitude = toNumber(stop.longitude);
                if (latitude === null || longitude === null) {
                  return null;
                }

                const color = stop.stop_type === "start" ? "#16a34a" : stop.stop_type === "end" ? "#dc2626" : "#2563eb";

                return (
                  <CircleMarker
                    key={stop.id}
                    center={[latitude, longitude]}
                    radius={10}
                    pathOptions={{ color, fillColor: color, fillOpacity: 0.85, weight: 2 }}
                  >
                    <Popup>
                      <div className="space-y-1">
                        <div className="font-semibold text-slate-900">{stop.stop_name}</div>
                        <div className="text-sm text-slate-600">
                          {formatStopType(stop.stop_type)} • #{stop.stop_order}
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}

              {form.latitude && form.longitude ? (
                <CircleMarker
                  center={[Number(form.latitude), Number(form.longitude)]}
                  radius={8}
                  pathOptions={{ color: "#0ea5e9", fillColor: "#0ea5e9", fillOpacity: 0.5, weight: 2, dashArray: "4 4" }}
                >
                  <Popup>
                    <div className="text-sm text-slate-700">
                      <MapPin className="mr-1 inline h-4 w-4" />
                      Selected point
                    </div>
                  </Popup>
                </CircleMarker>
              ) : null}
            </MapContainer>
          </div>
        </div>
      </div>

      {isLoadingRoutes ? <div className="text-sm text-slate-500">Loading routes...</div> : null}
    </div>
  );
}