/**
 * Field Scan Page
 *
 * Offline-first scanning UI:
 *  - Barcode input (text entry or hardware scanner)
 *  - Camera scan (getUserMedia + canvas frame capture)
 *  - Form fields: product, quantity, crew, ranch, entity, picking speeds
 *  - Saves to IndexedDB when offline; syncs to server when online
 *  - Real-time online/offline status indicator
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { openDB, addPending, getPending, clearSynced } from '../../utils/offlineDB';

const SCAN_METHOD = { BARCODE: 'barcode', CAMERA: 'camera', MANUAL: 'manual' };

function StatusPill({ online }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full
      ${online ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
      <span className={`w-2 h-2 rounded-full ${online ? 'bg-green-500 animate-pulse' : 'bg-orange-500'}`} />
      {online ? 'Online' : 'Offline — saving locally'}
    </span>
  );
}

const EMPTY_FORM = {
  product_name: '', quantity: 1, unit: 'crates',
  crew_name: '', ranch: '', entity_name: '',
  picking_average: '', highest_picking_speed: '', lowest_picking_speed: '',
};

export default function FieldScan() {
  const { user } = useAuth();
  const [online, setOnline] = useState(navigator.onLine);
  const [scanMethod, setScanMethod] = useState(SCAN_METHOD.MANUAL);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [refData, setRefData] = useState({ commodities: [], ranches: [], entities: [], crews: [] });
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [recentScans, setRecentScans] = useState([]);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const barcodeRef = useRef(null);

  // ── Online / Offline listeners ─────────────────────────────────────────────
  useEffect(() => {
    const handleOnline  = () => { setOnline(true);  syncPending(); };
    const handleOffline = () => setOnline(false);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── Load reference data & pending count ────────────────────────────────────
  useEffect(() => {
    openDB();
    refreshPendingCount();
    if (navigator.onLine) {
      api.get('/api/agrow/reference-data')
        .then(r => setRefData(r.data))
        .catch(() => {});
      api.get('/api/agrow/scanned-products?synced=1')
        .then(r => setRecentScans(r.data.slice(0, 5)))
        .catch(() => {});
    }
  }, []);

  const refreshPendingCount = async () => {
    const items = await getPending();
    setPendingCount(items.length);
  };

  // ── Barcode submit ─────────────────────────────────────────────────────────
  const handleBarcodeSubmit = (e) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;
    // Parse barcode as product name (real app would look up a DB)
    setForm(f => ({ ...f, product_name: barcodeInput.trim() }));
    setBarcodeInput('');
    setScanMethod(SCAN_METHOD.MANUAL);
    barcodeRef.current?.focus();
  };

  // ── Camera ────────────────────────────────────────────────────────────────
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 } }
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      videoRef.current.play();
      setCameraActive(true);
    } catch {
      setError('Camera access denied. Please allow camera permissions.');
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  };

  const captureFrame = () => {
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    // In a real deployment, pass canvas to a barcode decoder (e.g. ZXing)
    // Here we simulate a capture:
    const simulatedBarcode = `SCAN-${Date.now().toString(36).toUpperCase()}`;
    setForm(f => ({ ...f, product_name: simulatedBarcode }));
    setSaved(`📸 Captured: ${simulatedBarcode}`);
    setTimeout(() => setSaved(''), 3000);
    stopCamera();
    setScanMethod(SCAN_METHOD.MANUAL);
  };

  // ── Submit scan ────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.product_name.trim()) { setError('Product name is required.'); return; }

    setSubmitting(true);
    const payload = {
      ...form,
      quantity: parseFloat(form.quantity) || 1,
      user_name: user?.name || 'Unknown',
      scanned_at: new Date().toISOString(),
    };

    if (navigator.onLine) {
      try {
        await api.post('/api/agrow/scanned-products', payload);
        setSaved('✅ Scan saved to server!');
        setForm(EMPTY_FORM);
        // Refresh recent scans
        api.get('/api/agrow/scanned-products?synced=1')
          .then(r => setRecentScans(r.data.slice(0, 5)))
          .catch(() => {});
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to save. Storing offline.');
        await addPending(payload);
        await refreshPendingCount();
      }
    } else {
      await addPending(payload);
      await refreshPendingCount();
      setSaved('📦 Saved offline — will sync when connected.');
      setForm(EMPTY_FORM);
    }

    setTimeout(() => setSaved(''), 4000);
    setSubmitting(false);
  };

  // ── Sync pending offline items ─────────────────────────────────────────────
  const syncPending = useCallback(async () => {
    const items = await getPending();
    if (!items.length) return;
    setSyncing(true);
    try {
      await api.post('/api/agrow/scanned-products/sync', { items });
      await clearSynced();
      setPendingCount(0);
      setSaved(`🔄 ${items.length} offline scan(s) synced!`);
      setTimeout(() => setSaved(''), 4000);
    } catch {
      // Will retry on next online event
    } finally {
      setSyncing(false);
    }
  }, []);

  const field = (key, val) => setForm(f => ({ ...f, [key]: val }));

  return (
    <div className="max-w-2xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Field Scan</h1>
          <p className="text-gray-500 mt-0.5 text-sm">Scan products in the field — works offline</p>
        </div>
        <StatusPill online={online} />
      </div>

      {/* Pending badge */}
      {pendingCount > 0 && (
        <div className="mb-4 flex items-center justify-between bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-orange-800">
            <span className="text-lg">📦</span>
            <span><strong>{pendingCount}</strong> scan{pendingCount !== 1 ? 's' : ''} waiting to sync</span>
          </div>
          {online && (
            <button
              onClick={syncPending}
              disabled={syncing}
              className="text-xs font-semibold text-orange-700 border border-orange-300 rounded-lg px-3 py-1 hover:bg-orange-100"
            >
              {syncing ? 'Syncing…' : '↑ Sync Now'}
            </button>
          )}
        </div>
      )}

      {/* Scan method selector */}
      <div className="flex gap-2 mb-5">
        {[
          { id: SCAN_METHOD.MANUAL,  icon: '✏️', label: 'Manual' },
          { id: SCAN_METHOD.BARCODE, icon: '📊', label: 'Barcode' },
          { id: SCAN_METHOD.CAMERA,  icon: '📷', label: 'Camera' },
        ].map(m => (
          <button
            key={m.id}
            onClick={() => {
              setScanMethod(m.id);
              if (m.id === SCAN_METHOD.CAMERA) startCamera();
              else if (cameraActive) stopCamera();
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border font-medium text-sm transition-all
              ${scanMethod === m.id
                ? 'bg-green-600 text-white border-green-600 shadow-md'
                : 'bg-white text-gray-600 border-gray-200 hover:border-green-400'}`}
          >
            <span>{m.icon}</span> {m.label}
          </button>
        ))}
      </div>

      {/* Barcode input */}
      {scanMethod === SCAN_METHOD.BARCODE && (
        <form onSubmit={handleBarcodeSubmit} className="mb-5">
          <div className="flex gap-2">
            <input
              autoFocus
              ref={barcodeRef}
              type="text"
              className="input flex-1 font-mono"
              placeholder="Scan or type barcode…"
              value={barcodeInput}
              onChange={e => setBarcodeInput(e.target.value)}
            />
            <button type="submit" className="btn-primary px-5">Use</button>
          </div>
          <p className="text-xs text-gray-400 mt-1">Hardware scanners auto-submit on Enter.</p>
        </form>
      )}

      {/* Camera view */}
      {scanMethod === SCAN_METHOD.CAMERA && (
        <div className="mb-5 rounded-2xl overflow-hidden bg-black relative">
          <video ref={videoRef} className="w-full max-h-64 object-cover" playsInline muted />
          {cameraActive && (
            <>
              {/* Viewfinder overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-48 h-32 border-2 border-green-400 rounded-lg opacity-80" />
              </div>
              <div className="absolute bottom-3 inset-x-0 flex justify-center gap-3">
                <button
                  onClick={captureFrame}
                  className="bg-green-500 hover:bg-green-600 text-white font-semibold px-6 py-2 rounded-full shadow-lg"
                >
                  📸 Capture
                </button>
                <button
                  onClick={stopCamera}
                  className="bg-gray-700 hover:bg-gray-800 text-white px-4 py-2 rounded-full"
                >
                  ✕ Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Feedback messages */}
      {error  && <div className="mb-4 p-3 bg-red-50   border border-red-200   text-red-700   rounded-lg text-sm">{error}</div>}
      {saved  && <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{saved}</div>}

      {/* Scan form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
        <h2 className="font-semibold text-gray-800">Scan Details</h2>

        {/* Product */}
        <div>
          <label className="label">Product / Commodity <span className="text-red-500">*</span></label>
          {refData.commodities.length > 0 ? (
            <select className="input" value={form.product_name} onChange={e => field('product_name', e.target.value)} required>
              <option value="">Select product…</option>
              {refData.commodities.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="__other__">Other (type below)</option>
            </select>
          ) : null}
          {(refData.commodities.length === 0 || form.product_name === '__other__') && (
            <input
              type="text"
              className={`input ${refData.commodities.length > 0 ? 'mt-2' : ''}`}
              placeholder="Product name or barcode"
              value={form.product_name === '__other__' ? '' : form.product_name}
              onChange={e => field('product_name', e.target.value)}
              required
            />
          )}
        </div>

        {/* Quantity + Unit */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Quantity</label>
            <input
              type="number" min="0" step="0.1"
              className="input"
              value={form.quantity}
              onChange={e => field('quantity', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Unit</label>
            <select className="input" value={form.unit} onChange={e => field('unit', e.target.value)}>
              <option value="crates">Crates</option>
              <option value="items">Items</option>
              <option value="kg">kg</option>
              <option value="lbs">lbs</option>
              <option value="boxes">Boxes</option>
              <option value="pallets">Pallets</option>
            </select>
          </div>
        </div>

        {/* Crew + Ranch */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Crew</label>
            <select className="input" value={form.crew_name} onChange={e => field('crew_name', e.target.value)}>
              <option value="">Select crew…</option>
              {refData.crews.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Ranch</label>
            <select className="input" value={form.ranch} onChange={e => field('ranch', e.target.value)}>
              <option value="">Select ranch…</option>
              {refData.ranches.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        {/* Entity */}
        <div>
          <label className="label">Entity</label>
          <select className="input" value={form.entity_name} onChange={e => field('entity_name', e.target.value)}>
            <option value="">Select entity…</option>
            {refData.entities.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>

        {/* Picking speeds */}
        <div>
          <p className="label mb-2">Picking Speeds</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { key: 'picking_average',       label: 'Average' },
              { key: 'highest_picking_speed', label: 'Highest' },
              { key: 'lowest_picking_speed',  label: 'Lowest'  },
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                <input
                  type="time" step="60"
                  className="input text-sm"
                  value={form[key]}
                  onChange={e => field(key, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold text-base transition-colors disabled:opacity-50"
        >
          {submitting ? 'Saving…' : online ? '✅ Save Scan' : '📦 Save Offline'}
        </button>
      </form>

      {/* Recent scans */}
      {recentScans.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent Scans</h3>
          <div className="space-y-2">
            {recentScans.map((s, i) => (
              <div key={i} className="flex items-center justify-between bg-white rounded-xl border border-gray-100 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-gray-900">{s.product_name}</p>
                  <p className="text-xs text-gray-400">{s.user_name} · {new Date(s.scanned_at).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-green-700">{s.quantity} {s.unit}</p>
                  {s.crew_name && <p className="text-xs text-gray-400">{s.crew_name}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
