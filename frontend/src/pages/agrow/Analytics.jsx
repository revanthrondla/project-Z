/**
 * Field Ops Analytics Dashboard
 * Live harvesting metrics: by-day trend, by-product, by-crew, top workers.
 */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';

// ── Tiny bar chart (pure CSS, no dependency) ─────────────────────────────────
function BarChart({ data, valueKey = 'total_quantity', labelKey, color = '#16a34a', title }) {
  if (!data || data.length === 0) return <p className="text-sm text-gray-400 py-4 text-center">No data</p>;
  const max = Math.max(...data.map(d => d[valueKey])) || 1;
  return (
    <div>
      {title && <p className="text-sm font-semibold text-gray-700 mb-3">{title}</p>}
      <div className="space-y-2">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="text-xs text-gray-500 w-28 shrink-0 truncate">{d[labelKey]}</span>
            <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${(d[valueKey] / max) * 100}%`, background: color }}
              />
            </div>
            <span className="text-xs font-semibold text-gray-700 w-12 text-right shrink-0">{Number(d[valueKey]).toFixed(1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Trend sparkline ───────────────────────────────────────────────────────────
function Sparkline({ data, valueKey = 'total_quantity' }) {
  if (!data || data.length < 2) return null;
  const values = data.map(d => d[valueKey]);
  const max = Math.max(...values) || 1;
  const min = Math.min(...values);
  const H = 48, W = 200;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / (max - min || 1)) * H * 0.8 - H * 0.1;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <polyline points={pts} fill="none" stroke="#16a34a" strokeWidth="2" strokeLinejoin="round" />
      {values.map((v, i) => {
        const x = (i / (values.length - 1)) * W;
        const y = H - ((v - min) / (max - min || 1)) * H * 0.8 - H * 0.1;
        return <circle key={i} cx={x} cy={y} r="3" fill="#16a34a" />;
      })}
    </svg>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon, color = 'text-green-600' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
          <p className={`text-3xl font-bold ${color}`}>{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
  );
}

export default function Analytics() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [filters, setFilters] = useState({ from: '', to: '', crew: '' });

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to)   params.set('to',   filters.to);
    if (filters.crew) params.set('crew', filters.crew);
    api.get(`/api/agrow/analytics?${params}`)
      .then(r => setData(r.data))
      .catch(() => setError('Failed to load analytics data.'))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const crews = data?.byCrew?.map(c => c.crew_name) || [];

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
    </div>
  );

  if (error) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <p className="text-gray-500">⚠️ {error}</p>
      <button onClick={load} className="btn-primary">Retry</button>
    </div>
  );

  const t = data?.totals || {};

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Harvesting Analytics</h1>
          <p className="text-gray-500 mt-1">Real-time product scanning metrics</p>
        </div>
        <button onClick={load} className="btn-secondary text-sm py-2">↻ Refresh</button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">From</label>
          <input type="date" className="input w-40" value={filters.from} onChange={e => setFilters(f => ({...f,from:e.target.value}))} />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" className="input w-40" value={filters.to}   onChange={e => setFilters(f => ({...f,to:e.target.value}))} />
        </div>
        <div>
          <label className="label">Crew</label>
          <select className="input w-40" value={filters.crew} onChange={e => setFilters(f => ({...f,crew:e.target.value}))}>
            <option value="">All Crews</option>
            {crews.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {(filters.from || filters.to || filters.crew) && (
          <button onClick={() => setFilters({ from:'', to:'', crew:'' })} className="text-sm text-gray-500 hover:text-red-500 self-end pb-1">
            ✕ Clear filters
          </button>
        )}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <KpiCard label="Total Scans"     value={t.total_scans    || 0}  icon="🔍" />
        <KpiCard label="Total Quantity"  value={Number(t.total_quantity || 0).toFixed(0)} sub="units/crates" icon="📦" color="text-emerald-600" />
        <KpiCard label="Products"        value={t.unique_products || 0} icon="🌾" color="text-yellow-600" />
        <KpiCard label="Active Crews"    value={t.crew_count      || 0} icon="👷" color="text-purple-600" />
        <KpiCard label="Workers"         value={t.worker_count    || 0} icon="👤" color="text-emerald-600" />
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

        {/* Daily trend */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="font-semibold text-gray-800">Daily Harvest Trend</p>
            {data?.byDay?.length > 1 && <Sparkline data={data.byDay} />}
          </div>
          {data?.byDay?.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 text-xs text-gray-500 font-semibold">Date</th>
                    <th className="text-right py-2 text-xs text-gray-500 font-semibold">Scans</th>
                    <th className="text-right py-2 text-xs text-gray-500 font-semibold">Quantity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {[...data.byDay].reverse().slice(0, 10).map((d, i) => (
                    <tr key={i}>
                      <td className="py-2 text-gray-600">{d.day}</td>
                      <td className="py-2 text-right text-gray-500">{d.scan_count}</td>
                      <td className="py-2 text-right font-semibold text-green-600">{Number(d.total_quantity).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">No data for selected period</p>
          )}
        </div>

        {/* By product */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <BarChart
            data={data?.byProduct?.slice(0, 8)}
            labelKey="product_name"
            title="Top Products by Quantity"
            color="#16a34a"
          />
        </div>

        {/* By crew */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <BarChart
            data={data?.byCrew?.slice(0, 8)}
            labelKey="crew_name"
            title="Production by Crew"
            color="#2563eb"
          />
        </div>

        {/* Top workers */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm font-semibold text-gray-700 mb-3">Top Workers</p>
          {data?.byWorker?.length > 0 ? (
            <div className="space-y-2">
              {data.byWorker.map((w, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0
                    ${i === 0 ? 'bg-yellow-100 text-yellow-700' : i === 1 ? 'bg-gray-100 text-gray-700' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-emerald-50 text-emerald-600'}`}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{w.user_name}</p>
                    <p className="text-xs text-gray-400">{w.scan_count} scans</p>
                  </div>
                  <span className="text-sm font-semibold text-green-700">{Number(w.total_quantity).toFixed(0)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">No worker data</p>
          )}
        </div>
      </div>

      {/* Products table */}
      {data?.products?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <p className="font-semibold text-gray-800">Product Speed Metrics</p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Commodity</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Crates</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Ranch</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Avg Speed</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Best</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Slowest</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.products.map((p, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{p.commodity || '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-green-700">{p.crate_count}</td>
                  <td className="px-4 py-3 text-gray-500">{p.ranch || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{p.picking_average || '—'}</td>
                  <td className="px-4 py-3 text-green-600 font-medium">{p.highest_picking_speed || '—'}</td>
                  <td className="px-4 py-3 text-red-500">{p.lowest_picking_speed || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
