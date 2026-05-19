/**
 * ID Scan Hire — module: hr_id_scan
 *
 * Two capture modes:
 *   • Camera   — live WebRTC video feed with auto-capture detection
 *   • Upload   — drag-and-drop or file picker (JPEG, PNG, WEBP, PDF)
 *
 * Workflow:
 *   1. Select country + document type (guides OCR templates)
 *   2. Capture / upload ID document
 *   3. Backend runs OCR (Ollama → Claude → OpenAI → Tesseract+templates)
 *   4. Review & edit extracted fields
 *   5. Add to Scan Queue → Hire individually or "Hire All"
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import api from '../../api';

// ── Constants ─────────────────────────────────────────────────────────────────

const ID_TYPES = [
  { value: 'passport',       label: '🛂 Passport' },
  { value: 'drivers_license',label: '🚗 Driver\'s Licence' },
  { value: 'national_id',    label: '🪪 National ID Card' },
  { value: 'residence_card', label: '🏠 Residence Card' },
  { value: 'other',          label: '📄 Other' },
];

const ROLES = ['employee', 'admin', 'recruiter'];

// Supported countries for the document-type picker
// Mirrors backend/services/idTemplates.js
const SUPPORTED_COUNTRIES = [
  { code: 'AU', flag: '🇦🇺', name: 'Australia',            idTypes: ['drivers_license','passport'] },
  { code: 'GB', flag: '🇬🇧', name: 'United Kingdom',       idTypes: ['drivers_license','passport'] },
  { code: 'US', flag: '🇺🇸', name: 'United States',        idTypes: ['drivers_license','passport'] },
  { code: 'NZ', flag: '🇳🇿', name: 'New Zealand',          idTypes: ['drivers_license','passport'] },
  { code: 'IN', flag: '🇮🇳', name: 'India',                idTypes: ['national_id','drivers_license','passport'] },
  { code: 'CA', flag: '🇨🇦', name: 'Canada',               idTypes: ['drivers_license','passport'] },
  { code: 'SG', flag: '🇸🇬', name: 'Singapore',            idTypes: ['national_id','passport'] },
  { code: 'AE', flag: '🇦🇪', name: 'UAE',                  idTypes: ['national_id','passport'] },
  { code: 'PH', flag: '🇵🇭', name: 'Philippines',          idTypes: ['national_id','passport'] },
  { code: 'DE', flag: '🇩🇪', name: 'Germany',              idTypes: ['national_id','passport'] },
  { code: 'FR', flag: '🇫🇷', name: 'France',               idTypes: ['national_id','passport'] },
  { code: 'ZA', flag: '🇿🇦', name: 'South Africa',         idTypes: ['national_id','passport'] },
];

const ID_TYPE_LABELS = {
  passport:       '🛂 Passport',
  drivers_license:'🚗 Driver\'s Licence',
  national_id:    '🪪 National ID Card',
  residence_card: '🏠 Residence Card',
  other:          '📄 Other',
};

const EMPTY_FORM = {
  // From OCR
  first_name: '', middle_name: '', last_name: '', full_name: '',
  date_of_birth: '', gender: '',
  id_type: '', id_number: '', expiry_date: '', issue_date: '',
  issuing_country: '', nationality: '',
  address_line1: '', address_line2: '', city: '', state: '', postcode: '', country: '',
  // Required for hire
  email: '', phone: '', role: 'employee', hourly_rate: '', start_date: '',
  contract_type: 'full_time',
  // Internal
  scan_log_id: null,
  _confidence: null,
  _warnings: [],
};

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function ConfidenceBadge({ value }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? 'bg-green-100 text-green-700'
              : pct >= 50 ? 'bg-amber-100 text-amber-700'
              :              'bg-red-100 text-red-700';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      🎯 {pct}% confidence
    </span>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

// ── Hire Confirmation Modal ────────────────────────────────────────────────────
function HireModal({ item, clients, onConfirm, onClose, hiring }) {
  const [form, setForm] = useState({ ...item });
  const [err, setErr]   = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.email)       return setErr('Email is required');
    if (!form.hourly_rate) return setErr('Hourly rate is required');
    if (!form.start_date)  return setErr('Start date is required');
    setErr('');
    onConfirm(form);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[95vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-emerald-50 to-teal-50">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🪪</span>
            <div>
              <h3 className="font-bold text-gray-900 text-lg">Confirm Hire</h3>
              <p className="text-sm text-gray-500">Review and complete employee details before hiring</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {err && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{err}</div>}

          {/* ID info (read-only summary) */}
          <div className="bg-gray-50 rounded-xl p-4 flex items-center gap-4">
            <div className="text-3xl">
              {ID_TYPES.find(t => t.value === form.id_type)?.label?.split(' ')[0] || '🪪'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900">{form.full_name || [form.first_name, form.last_name].filter(Boolean).join(' ') || '—'}</p>
              <p className="text-sm text-gray-500">{ID_TYPES.find(t => t.value === form.id_type)?.label || 'ID Document'} · {form.id_number || '—'}</p>
              {form.date_of_birth && <p className="text-xs text-gray-400 mt-0.5">DOB {form.date_of_birth}</p>}
            </div>
            <ConfidenceBadge value={form._confidence} />
          </div>

          {/* OCR-extracted fields (editable) */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Identity Details (from OCR)</p>
            <div className="grid grid-cols-3 gap-3">
              <Field label="First Name *">
                <input className="input" value={form.first_name} onChange={e => set('first_name', e.target.value)} required />
              </Field>
              <Field label="Middle Name">
                <input className="input" value={form.middle_name} onChange={e => set('middle_name', e.target.value)} />
              </Field>
              <Field label="Last Name *">
                <input className="input" value={form.last_name} onChange={e => set('last_name', e.target.value)} required />
              </Field>
              <Field label="Date of Birth">
                <input type="date" className="input" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} />
              </Field>
              <Field label="Gender">
                <select className="input" value={form.gender} onChange={e => set('gender', e.target.value)}>
                  <option value="">— not specified —</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other / Non-binary</option>
                </select>
              </Field>
              <Field label="ID Type">
                <select className="input" value={form.id_type} onChange={e => set('id_type', e.target.value)}>
                  <option value="">—</option>
                  {ID_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="ID Number">
                <input className="input" value={form.id_number} onChange={e => set('id_number', e.target.value)} />
              </Field>
              <Field label="ID Expiry Date">
                <input type="date" className="input" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} />
              </Field>
              <Field label="ID Issue Date">
                <input type="date" className="input" value={form.issue_date} onChange={e => set('issue_date', e.target.value)} />
              </Field>
            </div>

            {/* Address */}
            <div className="grid grid-cols-2 gap-3 mt-3">
              <Field label="Address Line 1">
                <input className="input" value={form.address_line1} onChange={e => set('address_line1', e.target.value)} />
              </Field>
              <Field label="Address Line 2">
                <input className="input" value={form.address_line2} onChange={e => set('address_line2', e.target.value)} />
              </Field>
              <Field label="City">
                <input className="input" value={form.city} onChange={e => set('city', e.target.value)} />
              </Field>
              <Field label="State / Province">
                <input className="input" value={form.state} onChange={e => set('state', e.target.value)} />
              </Field>
              <Field label="Postcode">
                <input className="input" value={form.postcode} onChange={e => set('postcode', e.target.value)} />
              </Field>
              <Field label="Country">
                <input className="input" value={form.country || form.issuing_country} onChange={e => set('country', e.target.value)} />
              </Field>
            </div>
          </div>

          {/* Employment fields (required) */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Employment Details</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email *">
                <input type="email" className="input" required value={form.email} onChange={e => set('email', e.target.value)} />
              </Field>
              <Field label="Phone">
                <input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} />
              </Field>
              <Field label="Role *">
                <select className="input" required value={form.role} onChange={e => set('role', e.target.value)}>
                  {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                </select>
              </Field>
              <Field label="Hourly Rate *">
                <input type="number" step="0.01" min="0" className="input" required value={form.hourly_rate} onChange={e => set('hourly_rate', e.target.value)} />
              </Field>
              <Field label="Start Date *">
                <input type="date" className="input" required value={form.start_date} onChange={e => set('start_date', e.target.value)} />
              </Field>
              <Field label="Contract Type">
                <select className="input" value={form.contract_type} onChange={e => set('contract_type', e.target.value)}>
                  <option value="full_time">Full Time</option>
                  <option value="part_time">Part Time</option>
                  <option value="casual">Casual</option>
                  <option value="contract">Contract</option>
                </select>
              </Field>
              {clients?.length > 0 && (
                <Field label="Assign to Client">
                  <select className="input" value={form.client_id || ''} onChange={e => set('client_id', e.target.value || null)}>
                    <option value="">— No client —</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
              )}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={hiring} className="btn-primary flex-1">
              {hiring ? '⏳ Hiring…' : '✅ Hire Employee'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function IDScanHire() {
  // Document type hints (guide the OCR backend)
  const [hintCountry, setHintCountry] = useState('');   // e.g. 'AU'
  const [hintIdType,  setHintIdType]  = useState('');   // e.g. 'drivers_license'

  // capture mode
  const [mode, setMode]         = useState('camera'); // 'camera' | 'upload'
  const [cameraActive, setCameraActive]   = useState(false);
  const [cameraError, setCameraError]     = useState('');
  const [capturing, setCapturing]         = useState(false);
  const [processing, setProcessing]       = useState(false);
  const [processError, setProcessError]   = useState('');
  const [warnings, setWarnings]           = useState([]);

  // current reviewed item (before adding to queue)
  const [reviewed, setReviewed]   = useState(null);

  // Scan queue
  const [queue, setQueue] = useState([]); // array of EMPTY_FORM-shaped objects

  // Hire modal
  const [hiringItem, setHiringItem]  = useState(null);
  const [hiringIndex, setHiringIndex] = useState(null);
  const [hiring, setHiring]          = useState(false);
  const [hireError, setHireError]    = useState('');

  // Bulk hire results
  const [bulkResults, setBulkResults] = useState([]); // { name, ok, error }

  // Clients for hire modal dropdown
  const [clients, setClients] = useState([]);

  // Audit log
  const [showLogs, setShowLogs]    = useState(false);
  const [logs, setLogs]            = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // OCR provider config
  const [ocrConfig, setOcrConfig] = useState(null);

  // Upload drag-over state
  const [dragOver, setDragOver]   = useState(false);

  // Refs
  const videoRef         = useRef(null);
  const streamRef        = useRef(null);
  const fileInputRef     = useRef(null);
  const autoCapTimerRef  = useRef(null);   // holds setTimeout for auto-capture countdown
  const lastFrameDataRef = useRef(null);   // pixel hash of previous frame for stability check

  // Auto-capture state
  const [autoCapState, setAutoCapState]   = useState('idle');  // idle | stable | countdown | captured
  const [autoCapCount, setAutoCapCount]   = useState(0);       // 3…2…1
  const [capturedPreview, setCapturedPreview] = useState(null); // data-URL for preview
  const [capturedBlob,    setCapturedBlob]    = useState(null); // blob waiting for approval

  // ── Load clients + OCR config ───────────────────────────────────────────────
  useEffect(() => {
    api.get('/api/clients').then(r => setClients(r.data || [])).catch(() => {});
    api.get('/api/id-scan/config').then(r => setOcrConfig(r.data)).catch(() => {});
  }, []);

  // ── Camera management ───────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      streamRef.current = stream;
      // setCameraActive(true) causes React to render the <video> element.
      // The srcObject is attached in the useEffect below once the element exists.
      setCameraActive(true);
    } catch (err) {
      setCameraError(
        err.name === 'NotAllowedError'  ? 'Camera permission denied. Please allow camera access in your browser settings.' :
        err.name === 'NotFoundError'    ? 'No camera found on this device.' :
        err.name === 'NotReadableError' ? 'Camera is in use by another application.' :
        `Camera error: ${err.message}`
      );
    }
  }, []);

  // Attach stream to <video> after React renders it (cameraActive flip)
  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraActive]);

  const stopCamera = useCallback(() => {
    clearTimeout(autoCapTimerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraActive(false);
    setAutoCapState('idle');
    setCapturedPreview(null);
    setCapturedBlob(null);
  }, []);

  useEffect(() => {
    if (mode === 'camera') startCamera();
    else stopCamera();
    return stopCamera;
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Grab a canvas snapshot from the live video ─────────────────────────────
  const grabFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return canvas;
  }, []);

  // Compute a cheap perceptual hash (average brightness of a 16×16 downsample)
  const frameHash = useCallback((canvas) => {
    const small = document.createElement('canvas');
    small.width = small.height = 16;
    small.getContext('2d').drawImage(canvas, 0, 0, 16, 16);
    const px = small.getContext('2d').getImageData(0, 0, 16, 16).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += (px[i] + px[i+1] + px[i+2]) / 3;
    return Math.round(sum / 256);
  }, []);

  // ── Auto-capture: poll every 600ms, trigger when frame is stable ──────────
  useEffect(() => {
    if (!cameraActive || capturedPreview) return; // don't poll while previewing

    const STABLE_THRESHOLD = 4;    // max brightness delta between frames
    const COUNTDOWN_SECS   = 3;

    let stableFrames = 0;
    let counting     = false;
    let countVal     = COUNTDOWN_SECS;
    let countInterval = null;

    const poll = setInterval(() => {
      const canvas = grabFrame();
      if (!canvas) return;

      const hash = frameHash(canvas);
      const prev = lastFrameDataRef.current;
      lastFrameDataRef.current = hash;

      const isStable = prev !== null && Math.abs(hash - prev) <= STABLE_THRESHOLD;

      if (isStable) {
        stableFrames++;
      } else {
        stableFrames = 0;
        if (counting) {
          counting = false;
          clearInterval(countInterval);
          setAutoCapState('idle');
          setAutoCapCount(0);
        }
      }

      // After 2 stable frames (~1.2s) start the countdown
      if (stableFrames >= 2 && !counting) {
        counting  = true;
        countVal  = COUNTDOWN_SECS;
        setAutoCapState('countdown');
        setAutoCapCount(countVal);

        countInterval = setInterval(() => {
          countVal--;
          setAutoCapCount(countVal);
          if (countVal <= 0) {
            clearInterval(countInterval);
            counting = false;
            // Snap the frame
            const snapCanvas = grabFrame();
            if (!snapCanvas) return;
            snapCanvas.toBlob(blob => {
              if (!blob) return;
              const url = URL.createObjectURL(blob);
              setCapturedPreview(url);
              setCapturedBlob(blob);
              setAutoCapState('captured');
            }, 'image/jpeg', 0.95);
          }
        }, 1000);

        autoCapTimerRef.current = countInterval;
      }
    }, 600);

    return () => {
      clearInterval(poll);
      clearInterval(countInterval);
    };
  }, [cameraActive, capturedPreview, grabFrame, frameHash]);

  // ── Manual capture (shutter button) ────────────────────────────────────────
  const captureFrame = useCallback(() => {
    clearTimeout(autoCapTimerRef.current);
    setAutoCapState('idle');
    const canvas = grabFrame();
    if (!canvas) return;
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      setCapturedPreview(url);
      setCapturedBlob(blob);
      setAutoCapState('captured');
    }, 'image/jpeg', 0.95);
  }, [grabFrame]);

  // ── Confirm preview → send to OCR ──────────────────────────────────────────
  const confirmCapture = useCallback(async () => {
    if (!capturedBlob) return;
    setCapturedPreview(null);
    setCapturedBlob(null);
    setAutoCapState('idle');
    setCapturing(true);
    try {
      await sendForExtraction(capturedBlob, 'image/jpeg');
    } finally {
      setCapturing(false);
    }
  }, [capturedBlob]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Retake — discard preview, go back to live feed ─────────────────────────
  const retakeCapture = useCallback(() => {
    if (capturedPreview) URL.revokeObjectURL(capturedPreview);
    setCapturedPreview(null);
    setCapturedBlob(null);
    setAutoCapState('idle');
    lastFrameDataRef.current = null;
  }, [capturedPreview]);

  // ── Handle file drop / upload ───────────────────────────────────────────────
  const handleFile = useCallback(async (file) => {
    if (!file) return;
    const ALLOWED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (!ALLOWED.includes(file.type)) {
      setProcessError('Unsupported file type. Use JPEG, PNG, WEBP, GIF, or PDF.');
      return;
    }
    await sendForExtraction(file, file.type);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // ── Send image to backend for OCR extraction ────────────────────────────────
  const sendForExtraction = useCallback(async (fileOrBlob, mimeType) => {
    setProcessing(true);
    setProcessError('');
    setWarnings([]);
    setReviewed(null);

    const formData = new FormData();
    formData.append('id_image', fileOrBlob, mimeType === 'application/pdf' ? 'document.pdf' : 'capture.jpg');
    // Pass document-type hints so the backend can skip detection and go straight
    // to the correct country template
    if (hintCountry) formData.append('country_hint', hintCountry);
    if (hintIdType)  formData.append('id_type_hint', hintIdType);

    try {
      const { data } = await api.post('/api/id-scan/extract', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const ext = data.extracted || {};
      // Merge extracted fields into a hire-ready form object
      setReviewed({
        ...EMPTY_FORM,
        first_name:      ext.first_name      || '',
        middle_name:     ext.middle_name     || '',
        last_name:       ext.last_name       || '',
        full_name:       ext.full_name       || [ext.first_name, ext.last_name].filter(Boolean).join(' '),
        date_of_birth:   ext.date_of_birth   || '',
        gender:          ext.gender          || '',
        id_type:         ext.id_type         || '',
        id_number:       ext.id_number       || '',
        expiry_date:     ext.expiry_date     || '',
        issue_date:      ext.issue_date      || '',
        issuing_country: ext.issuing_country || '',
        nationality:     ext.nationality     || '',
        address_line1:   ext.address_line1   || '',
        address_line2:   ext.address_line2   || '',
        city:            ext.city            || '',
        state:           ext.state           || '',
        postcode:        ext.postcode        || '',
        country:         ext.country         || ext.issuing_country || '',
        scan_log_id:     data.scan_log_id,
        _confidence:     ext.confidence,
        _warnings:       data.warnings || [],
      });
      setWarnings(data.warnings || []);
    } catch (err) {
      setProcessError(err.response?.data?.error || 'OCR extraction failed. Please try again.');
    } finally {
      setProcessing(false);
    }
  }, [hintCountry, hintIdType]);

  // ── Add reviewed item to queue ──────────────────────────────────────────────
  const addToQueue = useCallback((item) => {
    setQueue(q => [...q, { ...item, _queueId: Date.now() }]);
    setReviewed(null);
    setWarnings([]);
  }, []);

  // ── Remove from queue ───────────────────────────────────────────────────────
  const removeFromQueue = useCallback(async (idx) => {
    const item = queue[idx];
    if (item?.scan_log_id) {
      api.put(`/api/id-scan/logs/${item.scan_log_id}/skip`).catch(() => {});
    }
    setQueue(q => q.filter((_, i) => i !== idx));
  }, [queue]);

  // ── Hire a single employee ──────────────────────────────────────────────────
  const hireEmployee = useCallback(async (formData) => {
    setHiring(true); setHireError('');
    try {
      const name = [formData.first_name, formData.middle_name, formData.last_name].filter(Boolean).join(' ')
                || formData.full_name;

      const payload = {
        name,
        email:         formData.email,
        phone:         formData.phone        || undefined,
        role:          formData.role         || 'employee',
        hourly_rate:   formData.hourly_rate,
        start_date:    formData.start_date,
        contract_type: formData.contract_type,
        date_of_birth: formData.date_of_birth || undefined,
        client_id:     formData.client_id     || undefined,
        password:      Math.random().toString(36).slice(2) + 'A1!', // temp password; user should reset
      };

      const empRes = await api.post('/api/employees', payload);
      const empId  = empRes.data?.id || empRes.data?.candidate?.id;

      // Link scan log to new employee
      if (formData.scan_log_id && empId) {
        await api.post('/api/id-scan/confirm', {
          scan_log_id: formData.scan_log_id,
          employee_id: empId,
        }).catch(() => {});
      }

      return { ok: true, employeeId: empId, name };
    } catch (err) {
      const msg = err.response?.data?.error || 'Hire failed';
      setHireError(msg);
      return { ok: false, error: msg };
    } finally {
      setHiring(false);
    }
  }, []);

  const openHireModal = (item, idx) => {
    setHiringItem({ ...item });
    setHiringIndex(idx);
    setHireError('');
  };

  const confirmHire = async (formData) => {
    const result = await hireEmployee(formData);
    if (result.ok) {
      setQueue(q => q.filter((_, i) => i !== hiringIndex));
      setHiringItem(null);
      setHiringIndex(null);
      setBulkResults(r => [...r, { name: result.name, ok: true }]);
    }
  };

  // ── Hire all in queue ───────────────────────────────────────────────────────
  const hireAll = async () => {
    const incomplete = queue.filter(i => !i.email || !i.hourly_rate || !i.start_date);
    if (incomplete.length > 0) {
      setHireError(`${incomplete.length} item(s) in the queue are missing email, hourly rate, or start date. Complete them first.`);
      return;
    }
    setHiring(true); setHireError('');
    const results = [];
    const remaining = [];
    for (const item of queue) {
      const r = await hireEmployee(item);
      results.push({ name: item.full_name || [item.first_name, item.last_name].filter(Boolean).join(' '), ...r });
      if (!r.ok) remaining.push(item);
    }
    setQueue(remaining);
    setBulkResults(prev => [...prev, ...results]);
    setHiring(false);
  };

  // ── Load audit logs ──────────────────────────────────────────────────────────
  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const { data } = await api.get('/api/id-scan/logs');
      setLogs(data.logs || []);
    } catch { /* ignore */ }
    finally { setLogsLoading(false); }
  };

  const toggleLogs = () => {
    if (!showLogs) loadLogs();
    setShowLogs(l => !l);
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            🪪 ID Scan Hiring
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            Scan government-issued IDs to instantly on-board employees. Uses open-source OCR.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={toggleLogs} className="btn-secondary text-sm">
            {showLogs ? 'Hide' : '📋 View'} Scan Log
          </button>
          {queue.length > 0 && (
            <button
              onClick={hireAll}
              disabled={hiring}
              className="btn-primary text-sm flex items-center gap-2"
            >
              {hiring ? '⏳ Hiring…' : `✅ Hire All (${queue.length})`}
            </button>
          )}
        </div>
      </div>

      {/* ── OCR provider banner ───────────────────────────────────────────────── */}
      {ocrConfig && (
        <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 text-sm text-teal-800 flex items-center gap-2">
          <span>⚡</span>
          <span>Active OCR provider: <strong>{ocrConfig.active}</strong></span>
          {ocrConfig.providers?.length > 1 && (
            <span className="text-teal-600 ml-2">
              (+{ocrConfig.providers.length - 1} fallback{ocrConfig.providers.length > 2 ? 's' : ''})
            </span>
          )}
        </div>
      )}

      {/* ── Bulk hire error ──────────────────────────────────────────────────── */}
      {hireError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
          ⚠️ {hireError}
          <button onClick={() => setHireError('')} className="ml-auto text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* ── Hire results (after bulk hire) ──────────────────────────────────── */}
      {bulkResults.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
            <h3 className="font-semibold text-gray-700 text-sm">Hire Results</h3>
            <button onClick={() => setBulkResults([])} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
          </div>
          <div className="divide-y max-h-40 overflow-y-auto">
            {bulkResults.map((r, i) => (
              <div key={i} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${r.ok ? 'bg-green-50/50' : 'bg-red-50/50'}`}>
                <span>{r.ok ? '✅' : '❌'}</span>
                <span className="font-medium">{r.name}</span>
                {!r.ok && <span className="text-red-600 text-xs">{r.error}</span>}
                {r.ok  && <span className="text-green-600 text-xs">Hired successfully</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Main grid: Capture (left) + Queue (right) ────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left: Capture panel ─────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* ── Document type picker ─────────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">🌍</span>
              <p className="font-semibold text-gray-800 text-sm">Select document type <span className="text-gray-400 font-normal">(optional — improves accuracy)</span></p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {/* Country */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Country</label>
                <select
                  className="input text-sm"
                  value={hintCountry}
                  onChange={e => { setHintCountry(e.target.value); setHintIdType(''); }}
                >
                  <option value="">— Auto detect —</option>
                  {SUPPORTED_COUNTRIES.map(c => (
                    <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                  ))}
                </select>
              </div>
              {/* ID type */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Document type</label>
                <select
                  className="input text-sm"
                  value={hintIdType}
                  onChange={e => setHintIdType(e.target.value)}
                  disabled={!hintCountry}
                >
                  <option value="">— Auto detect —</option>
                  {(SUPPORTED_COUNTRIES.find(c => c.code === hintCountry)?.idTypes || []).map(t => (
                    <option key={t} value={t}>{ID_TYPE_LABELS[t] || t}</option>
                  ))}
                </select>
              </div>
            </div>
            {hintCountry && (
              <p className="text-xs text-teal-700 bg-teal-50 rounded-lg px-3 py-1.5 flex items-center gap-1.5">
                <span>✓</span>
                <span>Using <strong>{SUPPORTED_COUNTRIES.find(c=>c.code===hintCountry)?.flag} {SUPPORTED_COUNTRIES.find(c=>c.code===hintCountry)?.name}</strong> {hintIdType ? `/ ${ID_TYPE_LABELS[hintIdType]}` : ''} template — OCR will extract fields precisely for this document type.</span>
              </p>
            )}
          </div>

          {/* Mode toggle */}
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
            {[['camera','📷 Camera'], ['upload','📁 Upload']].map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  mode === m ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── Camera view ─────────────────────────────────────────────────── */}
          {mode === 'camera' && (
            <div className="bg-black rounded-2xl overflow-hidden relative" style={{ aspectRatio: '16/9' }}>

              {/* ── Error state ──────────────────────────────────────────────── */}
              {cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white bg-gray-900 p-6 z-10">
                  <span className="text-4xl">📷</span>
                  <p className="text-center text-sm">{cameraError}</p>
                  <button onClick={startCamera} className="px-4 py-2 bg-white text-gray-900 rounded-lg text-sm font-medium">Retry</button>
                </div>
              )}

              {/* ── Preview state: captured image awaiting user confirm ───────── */}
              {capturedPreview && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black">
                  <img
                    src={capturedPreview}
                    alt="Captured ID"
                    className="max-h-full max-w-full object-contain rounded-xl"
                  />
                  {/* Overlay: Use this / Retake */}
                  <div className="absolute bottom-5 flex gap-3">
                    <button
                      onClick={retakeCapture}
                      className="px-5 py-2.5 bg-white/20 hover:bg-white/30 text-white rounded-xl text-sm font-medium backdrop-blur"
                    >
                      🔄 Retake
                    </button>
                    <button
                      onClick={confirmCapture}
                      disabled={capturing || processing}
                      className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold shadow-lg disabled:opacity-50"
                    >
                      {capturing || processing ? '⏳ Scanning…' : '✅ Use this photo'}
                    </button>
                  </div>
                  <div className="absolute top-3 left-0 right-0 text-center">
                    <span className="bg-black/60 text-white text-xs px-3 py-1 rounded-full">
                      Preview — does the ID look clear?
                    </span>
                  </div>
                </div>
              )}

              {/* ── Live video feed ───────────────────────────────────────────── */}
              {cameraActive && (
                <>
                  <video
                    ref={videoRef}
                    autoPlay playsInline muted
                    className="w-full h-full object-cover"
                  />

                  {/* ID framing guide — colour changes when stable */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className={`border-2 rounded-xl w-[75%] h-[65%] shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] transition-colors duration-300 ${
                      autoCapState === 'countdown' ? 'border-emerald-400' :
                      autoCapState === 'stable'    ? 'border-yellow-300'  :
                                                     'border-white/60'
                    }`} />
                  </div>

                  {/* Top instruction / countdown */}
                  <div className="absolute top-3 left-0 right-0 text-center pointer-events-none">
                    {autoCapState === 'countdown' ? (
                      <span className="bg-emerald-500/90 text-white text-sm px-4 py-1.5 rounded-full font-semibold">
                        📸 Auto-capturing in {autoCapCount}…
                      </span>
                    ) : (
                      <span className="bg-black/60 text-white text-xs px-3 py-1 rounded-full">
                        {autoCapState === 'stable'
                          ? '✅ ID detected — hold still'
                          : 'Centre the ID document in the frame'}
                      </span>
                    )}
                  </div>

                  {/* Manual shutter button */}
                  <div className="absolute bottom-5 left-0 right-0 flex justify-center">
                    <button
                      onClick={captureFrame}
                      disabled={capturing || processing || !!capturedPreview}
                      className="w-14 h-14 bg-white/90 hover:bg-white rounded-full shadow-lg border-4 border-gray-200 flex items-center justify-center transition-transform hover:scale-105 disabled:opacity-40"
                      title="Capture manually"
                    >
                      {capturing || processing
                        ? <span className="animate-spin text-lg">⏳</span>
                        : <span className="text-xl">📷</span>
                      }
                    </button>
                  </div>
                </>
              )}

              {/* ── Loading spinner while camera initialises ─────────────────── */}
              {!cameraActive && !cameraError && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
                </div>
              )}
            </div>
          )}

          {/* ── Upload / Drop zone ──────────────────────────────────────────── */}
          {mode === 'upload' && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-2xl border-2 border-dashed cursor-pointer transition-all flex flex-col items-center justify-center gap-4 p-12 ${
                dragOver
                  ? 'border-emerald-400 bg-emerald-50'
                  : 'border-gray-300 bg-gray-50 hover:border-emerald-300 hover:bg-emerald-50/30'
              }`}
              style={{ minHeight: '280px' }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); e.target.value = ''; }}
              />
              {processing ? (
                <>
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600" />
                  <p className="text-gray-500 font-medium">Extracting fields with OCR…</p>
                </>
              ) : (
                <>
                  <span className="text-5xl">🪪</span>
                  <div className="text-center">
                    <p className="text-gray-700 font-semibold">Drop an ID document here</p>
                    <p className="text-gray-400 text-sm mt-1">or click to browse — JPEG, PNG, WEBP, PDF</p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Processing spinner (camera mode) ───────────────────────────── */}
          {mode === 'camera' && processing && (
            <div className="flex items-center gap-3 text-gray-600 bg-blue-50 rounded-xl px-4 py-3">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
              <span className="text-sm">Extracting fields with OCR…</span>
            </div>
          )}

          {/* ── Extraction error ─────────────────────────────────────────────── */}
          {processError && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex gap-2">
              <span>⚠️</span>
              <span>{processError}</span>
              <button onClick={() => setProcessError('')} className="ml-auto text-red-400">✕</button>
            </div>
          )}

          {/* ── Review Panel ─────────────────────────────────────────────────── */}
          {reviewed && (
            <div className="bg-white border border-emerald-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 bg-gradient-to-r from-emerald-50 to-teal-50 border-b flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xl">📋</span>
                  <div>
                    <h3 className="font-semibold text-gray-900">Extracted Data — Review &amp; Edit</h3>
                    <p className="text-xs text-gray-500">All fields are editable — correct any OCR errors before adding to queue</p>
                  </div>
                </div>
                <ConfidenceBadge value={reviewed._confidence} />
              </div>

              {/* Inline OCR notices — softer than blocking warnings */}
              {warnings.length > 0 && (
                <div className="px-5 pt-3">
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm">
                    <p className="font-medium text-amber-800 mb-1">Some fields need your attention:</p>
                    {warnings.map((w, i) => (
                      <p key={i} className="text-amber-700 flex gap-1.5 items-start">
                        <span className="mt-0.5">•</span>
                        <span>{w.replace('⚠️','').trim()}</span>
                      </p>
                    ))}
                    <p className="text-amber-600 text-xs mt-2">
                      {!hintCountry
                        ? '💡 Tip: Select a country above before scanning — this significantly improves accuracy.'
                        : '💡 Tip: Check the image quality and try re-scanning, or fill in the missing fields manually below.'}
                    </p>
                  </div>
                </div>
              )}


              <div className="p-5 space-y-4">
                {/* Name row */}
                <div className="grid grid-cols-3 gap-3">
                  <Field label="First Name">
                    <input className="input" value={reviewed.first_name}
                      onChange={e => setReviewed(r => ({ ...r, first_name: e.target.value }))} />
                  </Field>
                  <Field label="Middle Name">
                    <input className="input" value={reviewed.middle_name}
                      onChange={e => setReviewed(r => ({ ...r, middle_name: e.target.value }))} />
                  </Field>
                  <Field label="Last Name">
                    <input className="input" value={reviewed.last_name}
                      onChange={e => setReviewed(r => ({ ...r, last_name: e.target.value }))} />
                  </Field>
                </div>

                {/* ID + dates */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Field label="ID Type">
                    <select className="input" value={reviewed.id_type}
                      onChange={e => setReviewed(r => ({ ...r, id_type: e.target.value }))}>
                      <option value="">—</option>
                      {ID_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </Field>
                  <Field label="ID Number">
                    <input className="input" value={reviewed.id_number}
                      onChange={e => setReviewed(r => ({ ...r, id_number: e.target.value }))} />
                  </Field>
                  <Field label="Date of Birth">
                    <input type="date" className="input" value={reviewed.date_of_birth}
                      onChange={e => setReviewed(r => ({ ...r, date_of_birth: e.target.value }))} />
                  </Field>
                  <Field label="Gender">
                    <select className="input" value={reviewed.gender}
                      onChange={e => setReviewed(r => ({ ...r, gender: e.target.value }))}>
                      <option value="">—</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </Field>
                  <Field label="Expiry Date">
                    <input type="date" className="input" value={reviewed.expiry_date}
                      onChange={e => setReviewed(r => ({ ...r, expiry_date: e.target.value }))} />
                  </Field>
                  <Field label="Issue Date">
                    <input type="date" className="input" value={reviewed.issue_date}
                      onChange={e => setReviewed(r => ({ ...r, issue_date: e.target.value }))} />
                  </Field>
                  <Field label="Nationality">
                    <input className="input" value={reviewed.nationality}
                      onChange={e => setReviewed(r => ({ ...r, nationality: e.target.value }))} />
                  </Field>
                  <Field label="Issuing Country">
                    <input className="input" value={reviewed.issuing_country}
                      onChange={e => setReviewed(r => ({ ...r, issuing_country: e.target.value }))} />
                  </Field>
                </div>

                {/* Address */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <Field label="Address">
                      <input className="input" placeholder="Street address" value={reviewed.address_line1}
                        onChange={e => setReviewed(r => ({ ...r, address_line1: e.target.value }))} />
                    </Field>
                  </div>
                  <Field label="City">
                    <input className="input" value={reviewed.city}
                      onChange={e => setReviewed(r => ({ ...r, city: e.target.value }))} />
                  </Field>
                  <Field label="State / Province">
                    <input className="input" value={reviewed.state}
                      onChange={e => setReviewed(r => ({ ...r, state: e.target.value }))} />
                  </Field>
                  <Field label="Postcode">
                    <input className="input" value={reviewed.postcode}
                      onChange={e => setReviewed(r => ({ ...r, postcode: e.target.value }))} />
                  </Field>
                  <Field label="Country">
                    <input className="input" value={reviewed.country}
                      onChange={e => setReviewed(r => ({ ...r, country: e.target.value }))} />
                  </Field>
                </div>

                {/* Action buttons */}
                <div className="flex gap-3 pt-2 border-t">
                  <button
                    onClick={() => addToQueue(reviewed)}
                    className="btn-primary flex-1 flex items-center justify-center gap-2"
                  >
                    ➕ Add to Queue
                  </button>
                  <button
                    onClick={() => openHireModal(reviewed, -1)}
                    className="btn-secondary flex items-center gap-2"
                  >
                    ✅ Hire Now
                  </button>
                  <button
                    onClick={() => { setReviewed(null); setWarnings([]); }}
                    className="px-4 py-2 text-sm text-red-500 hover:text-red-700 rounded-lg"
                  >
                    Discard
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: Scan Queue ──────────────────────────────────────────────── */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden sticky top-6">
            <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                📋 Scan Queue
                {queue.length > 0 && (
                  <span className="bg-emerald-600 text-white text-xs px-2 py-0.5 rounded-full">{queue.length}</span>
                )}
              </h3>
            </div>

            {queue.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <p className="text-3xl mb-2">📭</p>
                <p className="text-sm">No items in queue.</p>
                <p className="text-xs mt-1">Scan an ID to get started.</p>
              </div>
            ) : (
              <>
                <div className="divide-y max-h-[500px] overflow-y-auto">
                  {queue.map((item, idx) => {
                    const name = [item.first_name, item.last_name].filter(Boolean).join(' ') || item.full_name || '—';
                    const missingFields = [
                      !item.email       && 'email',
                      !item.hourly_rate && 'rate',
                      !item.start_date  && 'start date',
                    ].filter(Boolean);

                    return (
                      <div key={item._queueId} className="p-4 hover:bg-gray-50 transition-colors">
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 text-emerald-700 font-bold text-sm">
                            {name.charAt(0).toUpperCase() || '?'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate">{name}</p>
                            <p className="text-xs text-gray-500">
                              {ID_TYPES.find(t => t.value === item.id_type)?.label || 'ID Doc'}
                              {item.id_number ? ` · ${item.id_number}` : ''}
                            </p>
                            {missingFields.length > 0 && (
                              <p className="text-xs text-amber-600 mt-0.5">
                                ⚠️ Missing: {missingFields.join(', ')}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => openHireModal(item, idx)}
                            className="flex-1 text-xs py-1.5 px-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                          >
                            Complete &amp; Hire
                          </button>
                          <button
                            onClick={() => removeFromQueue(idx)}
                            className="text-xs py-1.5 px-3 border border-gray-200 text-gray-500 rounded-lg hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Hire All footer */}
                <div className="p-4 border-t bg-gray-50">
                  <button
                    onClick={hireAll}
                    disabled={hiring}
                    className="w-full btn-primary flex items-center justify-center gap-2"
                  >
                    {hiring
                      ? <><span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />Hiring…</>
                      : `✅ Hire All (${queue.length})`
                    }
                  </button>
                  <p className="text-xs text-gray-400 text-center mt-2">
                    Items missing required fields will fail — complete them first.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Audit Log ──────────────────────────────────────────────────────────── */}
      {showLogs && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 bg-gray-50 border-b flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">📋 Scan Audit Log</h2>
            <button onClick={loadLogs} className="text-sm text-indigo-600 hover:underline">Refresh</button>
          </div>
          {logsLoading ? (
            <div className="p-8 text-center text-gray-400">Loading…</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No scans recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-600 border-b">
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">ID Type</th>
                    <th className="px-4 py-3">Name Extracted</th>
                    <th className="px-4 py-3">Confidence</th>
                    <th className="px-4 py-3">Outcome</th>
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3">Scanned By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {logs.map(log => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {new Date(log.scan_time).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        {ID_TYPES.find(t => t.value === log.id_type)?.label || log.id_type || '—'}
                      </td>
                      <td className="px-4 py-3 font-medium">{log.extracted_name || '—'}</td>
                      <td className="px-4 py-3">
                        {log.confidence != null
                          ? <ConfidenceBadge value={log.confidence} />
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          log.outcome === 'hired'     ? 'bg-green-100 text-green-700'  :
                          log.outcome === 'failed'    ? 'bg-red-100 text-red-700'      :
                          log.outcome === 'skipped'   ? 'bg-gray-100 text-gray-600'    :
                                                        'bg-blue-100 text-blue-700'
                        }`}>{log.outcome}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{log.employee_name || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{log.scanned_by_email || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Hire Modal ──────────────────────────────────────────────────────────── */}
      {hiringItem && (
        <HireModal
          item={hiringItem}
          clients={clients}
          onConfirm={confirmHire}
          onClose={() => { setHiringItem(null); setHiringIndex(null); }}
          hiring={hiring}
        />
      )}
    </div>
  );
}
