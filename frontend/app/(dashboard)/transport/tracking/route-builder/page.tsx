'use client';

import { API_BASE_URL } from '@/lib/api';
import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';

const RouteBuilderMap = dynamic(() => import('@/components/transport/RouteBuilderMap'), {
  ssr: false,
  loading: () => <div className="h-96 bg-slate-100 flex items-center justify-center">Loading map...</div>,
});

interface Stop {
  id?: number;
  name: string;
  latitude: number;
  longitude: number;
  order: number;
  type: 'start' | 'middle' | 'end';
  scheduled_time?: string;
}

export default function RouteBuilderPage() {
  const [routeName, setRouteName] = useState('');
  const [fare, setFare] = useState('100');
  const [stops, setStops] = useState<Stop[]>([]);
  const [selectedStop, setSelectedStop] = useState<number | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>([27.7172, 85.3240]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add stop from map click
  const handleMapClick = (lat: number, lng: number) => {
    const newStop: Stop = {
      name: `Stop ${stops.length + 1}`,
      latitude: lat,
      longitude: lng,
      order: stops.length + 1,
      type: stops.length === 0 ? 'start' : stops.length === 2 ? 'end' : 'middle',
    };
    setStops([...stops, newStop]);
    setSelectedStop(stops.length);
  };

  // Update stop
  const updateStop = (index: number, field: string, value: any) => {
    const updated = [...stops];
    updated[index] = { ...updated[index], [field]: value };
    setStops(updated);
  };

  // Remove stop
  const removeStop = (index: number) => {
    const updated = stops.filter((_, i) => i !== index);
    // Recalculate orders and types
    const reordered: Stop[] = updated.map((stop, i): Stop => ({
      ...stop,
      order: i + 1,
      type: i === 0 ? 'start' : i === updated.length - 1 ? 'end' : 'middle',
    }));
    setStops(reordered);
    setSelectedStop(null);
  };

  // Reorder stops
  const moveStop = (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === stops.length - 1)) return;

    const updated = [...stops];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    [updated[index], updated[targetIndex]] = [updated[targetIndex], updated[index]];

    const reordered: Stop[] = updated.map((stop, i): Stop => ({
      ...stop,
      order: i + 1,
      type: i === 0 ? 'start' : i === updated.length - 1 ? 'end' : 'middle',
    }));
    setStops(reordered);
  };

  // Save route
  const saveRoute = async () => {
    if (!routeName.trim()) {
      setMessage({ type: 'error', text: 'Route name is required' });
      return;
    }
    if (stops.length < 2) {
      setMessage({ type: 'error', text: 'Add at least 2 stops' });
      return;
    }

    setSaving(true);
    try {
      const token = localStorage.getItem('school_erp_access_token');

      // Create route
      const routeRes = await fetch(`${API_BASE_URL}/api/v1/core/transport-routes/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: routeName,
          fare: parseFloat(fare),
          active_status: true,
        }),
      });

      if (!routeRes.ok) throw new Error('Failed to create route');
      const route = await routeRes.json();

      // Add stops
      for (const stop of stops) {
        const stopRes = await fetch(`${API_BASE_URL}/api/v1/core/bus-stops/`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            route: route.id,
            stop_name: stop.name,
            latitude: stop.latitude,
            longitude: stop.longitude,
            stop_order: stop.order,
            stop_type: stop.type,
            scheduled_time: stop.scheduled_time,
            geofence_radius: 100,
            active_status: true,
          }),
        });
        if (!stopRes.ok) throw new Error(`Failed to add stop: ${stop.name}`);
      }

      setMessage({ type: 'success', text: `Route "${routeName}" created with ${stops.length} stops!` });
      setTimeout(() => window.location.href = '/transport/tracking', 2000);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Error saving route' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-3">
      {/* Left: Route Details & Stops List */}
      <div className="lg:col-span-1 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Route Builder</h1>
          <p className="text-sm text-slate-500">Click on map to add stops, then save your route</p>
        </div>

        {/* Messages */}
        {message && (
          <div className={`rounded-lg p-3 text-sm ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
            {message.text}
          </div>
        )}

        {/* Route Form */}
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Route Name</label>
            <input
              type="text"
              value={routeName}
              onChange={(e) => setRouteName(e.target.value)}
              placeholder="e.g., City Center Route"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Fare (Rs.)</label>
            <input
              type="number"
              value={fare}
              onChange={(e) => setFare(e.target.value)}
              placeholder="100"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
            />
          </div>

          <button
            onClick={saveRoute}
            disabled={saving || stops.length < 2}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : `Save Route (${stops.length} Stops)`}
          </button>
        </div>

        {/* Stops List */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900 mb-3">Stops ({stops.length})</h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {stops.map((stop, i) => (
              <div
                key={i}
                onClick={() => setSelectedStop(i)}
                className={`rounded-lg p-3 cursor-pointer transition ${
                  selectedStop === i ? 'bg-blue-50 border-l-4 border-blue-600' : 'bg-slate-50 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-slate-900">{stop.name}</p>
                    <p className="text-xs text-slate-500">{stop.latitude.toFixed(4)}, {stop.longitude.toFixed(4)}</p>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-semibold ${
                    stop.type === 'start' ? 'bg-green-100 text-green-800' :
                    stop.type === 'end' ? 'bg-red-100 text-red-800' :
                    'bg-blue-100 text-blue-800'
                  }`}>
                    {stop.type === 'start' ? '🟢' : stop.type === 'end' ? '🔴' : '🔵'} {stop.order}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Map & Stop Editor */}
      <div className="lg:col-span-2 space-y-4">
        {/* Map */}
        <div className="rounded-lg border border-slate-200 overflow-hidden shadow-sm h-96">
          <RouteBuilderMap stops={stops} onMapClick={handleMapClick} />
        </div>

        {/* Stop Editor */}
        {selectedStop !== null && (
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Edit Stop</h3>
              <button
                onClick={() => removeStop(selectedStop)}
                className="text-red-600 hover:text-red-700 font-semibold text-sm"
              >
                Delete
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Stop Name</label>
                <input
                  type="text"
                  value={stops[selectedStop].name}
                  onChange={(e) => updateStop(selectedStop, 'name', e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Scheduled Time</label>
                <input
                  type="time"
                  value={stops[selectedStop].scheduled_time || ''}
                  onChange={(e) => updateStop(selectedStop, 'scheduled_time', e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 outline-none"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => moveStop(selectedStop, 'up')}
                disabled={selectedStop === 0}
                className="flex-1 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-30"
              >
                ⬆ Move Up
              </button>
              <button
                onClick={() => moveStop(selectedStop, 'down')}
                disabled={selectedStop === stops.length - 1}
                className="flex-1 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-30"
              >
                ⬇ Move Down
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
