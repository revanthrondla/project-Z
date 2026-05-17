import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../api';

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function fmtDuration(mins) {
  if (!mins && mins !== 0) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// Live elapsed-time hook
function useElapsed(startTs) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startTs) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - new Date(startTs)) / 60000));
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, [startTs]);
  return elapsed;
}

// GPS hook
function useGPS(enabled) {
  const [coords, setCoords] = useState(null);
  const [gpsError, setGpsError] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);

  const getLocation = useCallback(() => {
    if (!enabled || !navigator.geolocation) {
      if (!navigator.geolocation) setGpsError('GPS not supported');
      return Promise.resolve(null);
    }
    setGpsLoading(true);
    setGpsError('');
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const c = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy) };
          setCoords(c);
          setGpsLoading(false);
          resolve(c);
        },
        (err) => {
          setGpsError(err.code === 1 ? 'Location access denied' : 'Could not get location');
          setGpsLoading(false);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    });
  }, [enabled]);

  return { coords, gpsError, gpsLoading, getLocation };
}

// ─── Status card ──────────────────────────────────────────────────────────────
const STATUS_META = {
  clocked_in:   { label: 'Clocked In',   bg: 'bg-emerald-500', ring: 'ring-emerald-400', text: 'text-emerald-700', dot: 'bg-emerald-400' },
  on_break:     { label: 'On Break',     bg: 'bg-amber-500',   ring: 'ring-amber-400',   text: 'text-amber-700',   dot: 'bg-amber-400'   },
  clocked_out:  { label: 'Clocked Out',  bg: 'bg-gray-400',    ring: 'ring-gray-300',    text: 'text-gray-600',    dot: 'bg-gray-400'    },
  not_started:  { label: 'Not Started',  bg: 'bg-gray-400',    ring: 'ring-gray-300',    text: 'text-gray-600',    dot: 'bg-gray-300'    },
};

function ElapsedClock({ sinceTs, label }) {
  const mins = useElapsed(sinceTs);
  if (!sinceTs) return null;
  return (
    <div className="text-center mt-2">
      <p className="text-5xl font-mono font-bold text-gray-900 tracking-tight">
        {String(Math.floor(mins / 60)).padStart(2, '0')}:{String(mins % 60).padStart(2, '0')}
      </p>
      <p className="text-sm text-gray-500 mt-1">{label}</p>
    </div>
  );
}

// ─── Notes modal ──────────────────────────────────────────────────────────────
function NotesModal({ title, placeholder, onConfirm, onCancel, loading }) {
  const [notes, setNotes] = useState('');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900">{title}</h3>
        </div>
        <div className="p-6 space-y-3">
          <textarea
            className="input w-full"
            rows={3}
            placeholder={placeholder}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            autoFocus
          />
          <div className="flex gap-3">
            <button
              className="btn-primary flex-1"
              onClick={() => onConfirm(notes)}
              disabled={loading}
            >
              {loading ? 'Please wait…' : 'Confirm'}
            </button>
            <button className="btn-secondary" onClick={onCancel} disabled={loading}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Clock() {
  const [status, setStatus] = useState(null); // null = loading
  const [todayEvents, setTodayEvents] = useState([]);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [modal, setModal] = useState(null); // 'clock_out' | 'break_start' | 'break_end'
  const [useGPSPref, setUseGPSPref] = useState(true);

  const { coords, gpsError, gpsLoading, getLocation } = useGPS(useGPSPref);

  const loadStatus = useCallback(async () => {
    try {
      const r = await api.get('/api/attendance/status');
      setStatus(r.data);
    } catch {
      setError('Failed to load attendance status');
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const loadHistory = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const r = await api.get('/api/attendance/history', { params: { from: today, to: today, limit: 50 } });
      setTodayEvents(Array.isArray(r.data) ? r.data : []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // ── Action handlers ─────────────────────────────────────────────────────────
  const doAction = async (endpoint, extra = {}) => {
    setActionLoading(true);
    setError('');
    let gps = null;
    if (useGPSPref) {
      gps = await getLocation();
    }
    try {
      await api.post(`/api/attendance/${endpoint}`, {
        ...extra,
        ...(gps ? { latitude: gps.lat, longitude: gps.lng, accuracy_m: gps.acc } : {}),
      });
      await loadStatus();
      await loadHistory();
    } catch (err) {
      setError(err.response?.data?.error || `Failed to ${endpoint.replace('-', ' ')}`);
    } finally {
      setActionLoading(false);
      setModal(null);
    }
  };

  const handleClockIn = () => doAction('clock-in');
  const handleClockOut = (notes) => doAction('clock-out', notes ? { notes } : {});
  const handleBreakStart = (notes) => doAction('break-start', notes ? { notes } : {});
  const handleBreakEnd = () => doAction('break-end');

  // ── Derived state ───────────────────────────────────────────────────────────
  const live = status?.live_status || 'not_started';
  const meta = STATUS_META[live] || STATUS_META.not_started;
  const clockedInAt = status?.clocked_in_at;
  const breakStartAt = status?.break_started_at;
  const summary = status?.today_summary || {};

  // ── UI ──────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Clock In / Out</h1>
      <p className="text-gray-500 mb-6">{fmtDate(new Date())}</p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      {/* Status card */}
      <div className={`card p-8 text-center mb-6 ring-4 ${meta.ring}`}>
        {/* Status badge */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <span className={`w-3 h-3 rounded-full ${meta.dot} ${live === 'clocked_in' ? 'animate-pulse' : ''}`} />
          <span className={`text-sm font-semibold uppercase tracking-wide ${meta.text}`}>{meta.label}</span>
        </div>

        {/* Live elapsed timer */}
        {live === 'clocked_in' && (
          <ElapsedClock sinceTs={clockedInAt} label="time since clock-in" />
        )}
        {live === 'on_break' && (
          <ElapsedClock sinceTs={breakStartAt} label="break duration" />
        )}
        {(live === 'clocked_out' || live === 'not_started') && (
          <div className="text-4xl mb-2">
            {live === 'clocked_out' ? '👋' : '👋'}
          </div>
        )}

        {/* Today summary chips */}
        {(summary.clock_in_time || summary.total_minutes) && (
          <div className="flex flex-wrap justify-center gap-2 mt-4 text-xs">
            {summary.clock_in_time && (
              <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full">
                In: {fmtTime(summary.clock_in_time)}
              </span>
            )}
            {summary.clock_out_time && (
              <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full">
                Out: {fmtTime(summary.clock_out_time)}
              </span>
            )}
            {summary.break_minutes > 0 && (
              <span className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full">
                Break: {fmtDuration(summary.break_minutes)}
              </span>
            )}
            {summary.total_minutes > 0 && (
              <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full font-semibold">
                Total: {fmtDuration(summary.total_minutes)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="grid gap-3 mb-6">
        {live === 'not_started' || live === 'clocked_out' ? (
          <button
            onClick={handleClockIn}
            disabled={actionLoading || gpsLoading}
            className="btn-primary py-4 text-lg font-bold rounded-xl"
          >
            {actionLoading || gpsLoading ? '⏳ Please wait…' : '🟢 Clock In'}
          </button>
        ) : live === 'clocked_in' ? (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setModal('break_start')}
              disabled={actionLoading}
              className="btn-secondary py-4 text-base font-semibold rounded-xl"
            >
              ⏸️ Start Break
            </button>
            <button
              onClick={() => setModal('clock_out')}
              disabled={actionLoading}
              className="py-4 text-base font-semibold rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors"
            >
              🔴 Clock Out
            </button>
          </div>
        ) : live === 'on_break' ? (
          <button
            onClick={handleBreakEnd}
            disabled={actionLoading}
            className="btn-primary py-4 text-lg font-bold rounded-xl"
          >
            {actionLoading ? '⏳ Please wait…' : '▶️ End Break'}
          </button>
        ) : null}
      </div>

      {/* GPS toggle */}
      <div className="card p-4 mb-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={useGPSPref} onChange={e => setUseGPSPref(e.target.checked)}
            className="w-4 h-4 rounded accent-emerald-600" />
          <div>
            <p className="text-sm font-medium text-gray-700">📍 Attach GPS location</p>
            <p className="text-xs text-gray-400">Records your location with each clock event</p>
          </div>
        </label>
        {coords && (
          <p className="text-xs text-emerald-600 mt-2 ml-7">
            ✓ Location ready ({coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}) ±{coords.acc}m
          </p>
        )}
        {gpsError && <p className="text-xs text-red-500 mt-2 ml-7">⚠ {gpsError}</p>}
      </div>

      {/* Today's event timeline */}
      {todayEvents.length > 0 && (
        <div className="card p-5">
          <h3 className="font-semibold text-gray-800 mb-3 text-sm uppercase tracking-wide">Today's Events</h3>
          <div className="space-y-2">
            {todayEvents.map((ev, i) => {
              const evMeta = {
                clock_in:    { icon: '🟢', label: 'Clock In',    color: 'text-emerald-600' },
                clock_out:   { icon: '🔴', label: 'Clock Out',   color: 'text-red-500'     },
                break_start: { icon: '⏸️', label: 'Break Start', color: 'text-amber-600'   },
                break_end:   { icon: '▶️', label: 'Break End',   color: 'text-blue-600'    },
              }[ev.event_type] || { icon: '📌', label: ev.event_type, color: 'text-gray-600' };
              return (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <span className="text-base mt-0.5">{evMeta.icon}</span>
                  <div className="flex-1">
                    <span className={`font-medium ${evMeta.color}`}>{evMeta.label}</span>
                    {ev.notes && <span className="text-gray-400 ml-2">— {ev.notes}</span>}
                    {ev.latitude && (
                      <span className="text-gray-400 ml-2 text-xs">
                        📍 {parseFloat(ev.latitude).toFixed(4)}, {parseFloat(ev.longitude).toFixed(4)}
                      </span>
                    )}
                  </div>
                  <span className="text-gray-400 shrink-0">{fmtTime(ev.event_time)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Notes modals */}
      {modal === 'clock_out' && (
        <NotesModal
          title="Clock Out"
          placeholder="Any notes for today? (optional)"
          loading={actionLoading}
          onConfirm={handleClockOut}
          onCancel={() => setModal(null)}
        />
      )}
      {modal === 'break_start' && (
        <NotesModal
          title="Start Break"
          placeholder="Break reason (optional)"
          loading={actionLoading}
          onConfirm={handleBreakStart}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  );
}
