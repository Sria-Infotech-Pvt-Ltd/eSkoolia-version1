'use client';

import { API_BASE_URL } from '@/lib/api';
import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import map component to avoid SSR issues
const MapComponent = dynamic(() => import('@/components/transport/LiveTrackingMap'), {
  ssr: false,
  loading: () => <div className="h-screen bg-slate-100 flex items-center justify-center">Loading map...</div>,
});

interface BusData {
  id: number;
  vehicle_no: string;
  current_latitude?: number;
  current_longitude?: number;
  current_speed: number;
  status: string;
  next_stop?: {
    id: number;
    name: string;
  };
}

interface Alert {
  id: number;
  vehicle_no: string;
  alert_type: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  created_at: string;
}

export default function LiveTrackingPage() {
  const [buses, setBuses] = useState<BusData[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selectedBusId, setSelectedBusId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch initial data
  useEffect(() => {
    const fetchBuses = async () => {
      try {
        const token = localStorage.getItem('school_erp_access_token');
        const response = await fetch(`${API_BASE_URL}/api/v1/core/vehicles/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();
        setBuses(Array.isArray(data) ? data : data.results || []);
      } catch (err) {
        console.error('Failed to fetch buses', err);
      } finally {
        setLoading(false);
      }
    };

    fetchBuses();
  }, []);

  // Fetch alerts
  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const token = localStorage.getItem('school_erp_access_token');
        const response = await fetch(`${API_BASE_URL}/api/v1/core/transport-alerts/?limit=10`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();
        setAlerts(Array.isArray(data) ? data : data.results || []);
      } catch (err) {
        console.error('Failed to fetch alerts', err);
      }
    };

    fetchAlerts();
    const alertInterval = setInterval(fetchAlerts, 5000);
    return () => clearInterval(alertInterval);
  }, []);

  // Real-time updates from the backend's transport sockets (JWT in ?token=, school-scoped).
  useEffect(() => {
    const base = new URL(API_BASE_URL);
    const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = encodeURIComponent(localStorage.getItem('school_erp_access_token') || '');
    const locationWs = new WebSocket(`${protocol}//${base.host}/ws/bus-tracking/location/?token=${token}`);
    const alertWs = new WebSocket(`${protocol}//${base.host}/ws/bus-alerts/?token=${token}`);

    locationWs.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'bus_location_update' && data.location) {
        setBuses((prev) =>
          prev.map((bus) =>
            bus.id === data.location.vehicle
              ? { ...bus, current_speed: data.location.speed, current_latitude: data.location.latitude, current_longitude: data.location.longitude }
              : bus
          )
        );
      }
    };
    alertWs.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'bus_alert' && data.alert) {
        setAlerts((prev) => [data.alert, ...prev.slice(0, 9)]);
      }
    };

    return () => { locationWs.close(); alertWs.close(); };
  }, []);

  const selectedBus = buses.find((b) => b.id === selectedBusId);

  if (loading) {
    return <div className="h-screen flex items-center justify-center bg-slate-50">Loading tracking data...</div>;
  }

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Map */}
      <div className="flex-1">
        <MapComponent buses={buses} selectedBusId={selectedBusId} />
      </div>

      {/* Sidebar */}
      <div className="w-80 border-l border-slate-200 bg-white shadow-lg flex flex-col">
        {/* Bus List */}
        <div className="flex-1 overflow-y-auto">
          <div className="border-b border-slate-200 p-4">
            <h2 className="text-lg font-bold text-slate-900">Active Buses ({buses.length})</h2>
          </div>
          <div className="space-y-2 p-3">
            {buses.map((bus) => (
              <button
                key={bus.id}
                onClick={() => setSelectedBusId(bus.id)}
                className={`w-full rounded-lg p-3 text-left transition ${
                  selectedBusId === bus.id ? 'bg-blue-50 border-l-4 border-blue-600' : 'hover:bg-slate-50'
                }`}
              >
                <p className="font-semibold text-slate-900">{bus.vehicle_no}</p>
                <p className="text-xs text-slate-500">{bus.current_speed} km/h</p>
                <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-semibold ${
                  bus.status === 'in_transit' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-800'
                }`}>
                  {bus.status.replace('_', ' ').toUpperCase()}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Selected Bus Details */}
        {selectedBus && (
          <div className="border-t border-slate-200 p-4 space-y-3 bg-slate-50">
            <h3 className="font-bold text-slate-900">Bus Details</h3>
            <div className="space-y-2 text-sm">
              <div>
                <p className="text-slate-500">Vehicle Number</p>
                <p className="font-semibold text-slate-900">{selectedBus.vehicle_no}</p>
              </div>
              <div>
                <p className="text-slate-500">Speed</p>
                <p className="font-semibold text-slate-900">{selectedBus.current_speed} km/h</p>
              </div>
              {selectedBus.next_stop && (
                <div>
                  <p className="text-slate-500">Next Stop</p>
                  <p className="font-semibold text-slate-900">{selectedBus.next_stop.name}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Alerts */}
        <div className="border-t border-slate-200 p-4 max-h-64 overflow-y-auto">
          <h3 className="font-bold text-slate-900 mb-3">Recent Alerts</h3>
          <div className="space-y-2">
            {alerts.slice(0, 5).map((alert) => (
              <div key={alert.id} className={`rounded p-2 text-xs ${
                alert.severity === 'critical' ? 'bg-red-50 text-red-800' :
                alert.severity === 'warning' ? 'bg-amber-50 text-amber-800' :
                'bg-blue-50 text-blue-800'
              }`}>
                <p className="font-semibold">{alert.vehicle_no}</p>
                <p>{alert.message}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
