'use client';

import { API_BASE_URL } from '@/lib/api';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Bus {
  id: number;
  vehicle_no: string;
  vehicle_model: string;
  driver_name?: string;
  current_longitude?: number;
  current_latitude?: number;
  current_speed: number;
  status: string;
  is_tracking_active: boolean;
}

export default function BusListPage() {
  const [buses, setBuses] = useState<Bus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBuses = async () => {
      try {
        const token = localStorage.getItem('school_erp_access_token');
        const response = await fetch(`${API_BASE_URL}/api/v1/core/vehicles/`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok) throw new Error('Failed to fetch buses');
        const data = await response.json();
        setBuses(Array.isArray(data) ? data : data.results || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchBuses();
  }, []);

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'in_transit': 'bg-blue-100 text-blue-800',
      'at_stop': 'bg-green-100 text-green-800',
      'approaching_stop': 'bg-amber-100 text-amber-800',
      'idle': 'bg-slate-100 text-slate-800',
      'offline': 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-slate-100 text-slate-800';
  };

  if (loading) return <div className="p-6 text-center text-slate-600">Loading buses...</div>;
  if (error) return <div className="p-6 text-center text-red-600">Error: {error}</div>;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-slate-900">Bus Management</h1>
        <Link href="/transport/tracking/buses/add" className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700">
          + Add Bus
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {buses.map((bus) => (
          <div key={bus.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-slate-500">Vehicle Number</p>
                <p className="text-lg font-bold text-slate-900">{bus.vehicle_no}</p>
              </div>

              <div>
                <p className="text-sm font-semibold text-slate-500">Model</p>
                <p className="text-slate-700">{bus.vehicle_model}</p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-500">Speed</p>
                  <p className="text-lg font-bold text-slate-900">{bus.current_speed} km/h</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-sm font-semibold ${getStatusColor(bus.status)}`}>
                  {bus.status.replace('_', ' ').toUpperCase()}
                </span>
              </div>

              {bus.current_latitude && bus.current_longitude && (
                <div className="text-xs text-slate-500">
                  📍 {parseFloat(bus.current_latitude.toString()).toFixed(4)}, {parseFloat(bus.current_longitude.toString()).toFixed(4)}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Link href={`/transport/tracking/buses/${bus.id}`} className="flex-1 rounded-lg bg-slate-100 px-3 py-2 text-center text-sm font-semibold text-slate-700 hover:bg-slate-200">
                  View
                </Link>
                <Link href={`/transport/tracking/buses/${bus.id}/edit`} className="flex-1 rounded-lg bg-blue-50 px-3 py-2 text-center text-sm font-semibold text-blue-600 hover:bg-blue-100">
                  Edit
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      {buses.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
          <p className="text-lg font-semibold text-slate-600">No buses found</p>
          <p className="text-sm text-slate-500">Create your first bus to get started</p>
        </div>
      )}
    </div>
  );
}
