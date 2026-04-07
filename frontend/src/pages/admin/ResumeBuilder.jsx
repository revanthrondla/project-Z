/**
 * Resume Builder — Admin view
 * Build and manage structured resumes for candidates.
 * Each resume section is editable inline; PDF download available.
 */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 text-lg">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ── Editable list section (experience / education / certs) ───────────────────
function ArraySection({ label, items, onUpdate, fields }) {
  const add = () => {
    const blank = Object.fromEntries(fields.map(f => [f.key, '']));
    onUpdate([...items, blank]);
  };
  const remove = (i) => onUpdate(items.filter((_, idx) => idx !== i));
  const change = (i, key, val) => {
    const next = items.map((item, idx) => idx === i ? { ...item, [key]: val } : item);
    onUpdate(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800">{label}</h3>
        <button onClick={add} className="text-xs text-green-600 hover:text-green-700 font-semibold border border-green-200 px-3 py-1 rounded-lg">
          + Add
        </button>
      </div>
      {items.length === 0 && (
        <p className="text-sm text-gray-400 py-3 text-center border-2 border-dashed border-gray-200 rounded-xl">
          No entries yet — click + Add
        </p>
      )}
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={i} className="border border-gray-200 rounded-xl p-4 bg-gray-50 relative">
            <button
              onClick={() => remove(i)}
              className="absolute top-3 right-3 text-gray-300 hover:text-red-400 text-lg leading-none"
            >×</button>
            <div className="grid grid-cols-2 gap-3">
              {fields.map(f => (
                <div key={f.key} className={f.wide ? 'col-span-2' : ''}>
                  <label className="text-xs text-gray-500 block mb-0.5">{f.label}</label>
                  {f.textarea ? (
                    <textarea
                      rows={2}
                      className="input text-sm w-full"
                      value={item[f.key] || ''}
                      onChange={e => change(i, f.key, e.target.value)}
                    />
                  ) : (
                    <input
                      type={f.type || 'text'}
                      className="input text-sm"
                      value={item[f.key] || ''}
                      onChange={e => change(i, f.key, e.target.value)}
                      placeholder={f.placeholder || ''}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Skills tag editor ────────────────────────────────────────────────────────
function SkillsEditor({ skills, onUpdate }) {
  const [input, setInput] = useState('');
  const add = () => {
    const val = input.trim();
    if (val && !skills.includes(val)) { onUpdate([...skills, val]); }
    setInput('');
  };
  return (
    <div>
      <h3 className="font-semibold text-gray-800 mb-3">Skills</h3>
      <div className="flex flex-wrap gap-2 mb-3 min-h-[40px] p-3 border border-gray-200 rounded-xl bg-gray-50">
        {skills.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1 bg-green-100 text-green-800 text-sm px-3 py-1 rounded-full font-medium">
            {s}
            <button onClick={() => onUpdate(skills.filter((_, idx) => idx !== i))} className="text-green-500 hover:text-red-500 leading-none ml-1">×</button>
          </span>
        ))}
        {skills.length === 0 && <span className="text-gray-400 text-sm">No skills yet</span>}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          className="input flex-1 text-sm"
          placeholder="Type a skill and press Add…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
        />
        <button onClick={add} className="btn-primary text-sm px-4">Add</button>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function ResumeBuilder() {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState(null);
  const [resume, setResume]         = useState(null);
  const [saving, setSaving]         = useState(false);
  const [msg, setMsg]               = useState('');
  const [search, setSearch]         = useState('');

  useEffect(() => {
    api.get('/api/candidates?status=active')
      .then(r => setCandidates(Array.isArray(r.data) ? r.data : r.data.candidates || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const openResume = useCallback((cand) => {
    setSelected(cand);
    setResume(null);
    setMsg('');
    api.get(`/api/resumes/${cand.id}`)
      .then(r => setResume(r.data))
      .catch(() => setResume({ candidate_id: cand.id, headline:'', summary:'', experience:[], education:[], skills:[], certifications:[], languages:[] }));
  }, []);

  const save = async () => {
    if (!resume) return;
    setSaving(true);
    setMsg('');
    try {
      const { data } = await api.put(`/api/resumes/${selected.id}`, resume);
      setResume(data);
      setMsg('✅ Resume saved successfully!');
      setTimeout(() => setMsg(''), 3000);
    } catch (e) {
      setMsg('❌ ' + (e.response?.data?.error || 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = () => {
    window.open(`/api/resumes/${selected.id}/pdf`, '_blank');
  };

  const field = (key, val) => setResume(r => ({ ...r, [key]: val }));

  const filtered = candidates.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex gap-6 h-full">
      {/* Employee list */}
      <div className="w-72 shrink-0">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-900">Resume Builder</h1>
          <p className="text-sm text-gray-500 mt-0.5">Select an employee to edit their resume</p>
        </div>
        <input
          type="text"
          className="input text-sm mb-3 w-full"
          placeholder="Search employees…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {loading ? (
          <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"/></div>
        ) : (
          <div className="space-y-1 max-h-[calc(100vh-200px)] overflow-y-auto">
            {filtered.map(c => (
              <button
                key={c.id}
                onClick={() => openResume(c)}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                  selected?.id === c.id
                    ? 'border-green-400 bg-green-50 text-green-800'
                    : 'border-gray-200 hover:border-gray-300 bg-white text-gray-700'
                }`}
              >
                <p className="font-medium text-sm">{c.name}</p>
                <p className="text-xs text-gray-400 truncate">{c.email}</p>
              </button>
            ))}
            {filtered.length === 0 && <p className="text-center text-sm text-gray-400 py-8">No candidates found</p>}
          </div>
        )}
      </div>

      {/* Resume editor */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <div className="text-5xl mb-4">📄</div>
            <p className="font-medium">Select a candidate to build their resume</p>
          </div>
        ) : !resume ? (
          <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600"/></div>
        ) : (
          <div className="space-y-6">
            {/* Toolbar */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{selected.name}</h2>
                <p className="text-sm text-gray-500">{selected.email}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={downloadPdf} className="btn-secondary text-sm py-2 flex items-center gap-1">⬇ PDF</button>
                <button onClick={save} disabled={saving} className="btn-primary text-sm py-2">
                  {saving ? 'Saving…' : '💾 Save Resume'}
                </button>
              </div>
            </div>

            {msg && <div className={`p-3 rounded-lg text-sm border ${msg.startsWith('✅') ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>{msg}</div>}

            {/* Headline */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <h3 className="font-semibold text-gray-800">Basic Info</h3>
              <div>
                <label className="label">Professional Headline</label>
                <input type="text" className="input" placeholder="e.g. Senior Field Manager · 8 yrs experience" value={resume.headline || ''} onChange={e => field('headline', e.target.value)} />
              </div>
              <div>
                <label className="label">Professional Summary</label>
                <textarea rows={4} className="input" placeholder="Brief overview of skills, experience, and career goals…" value={resume.summary || ''} onChange={e => field('summary', e.target.value)} />
              </div>
            </div>

            {/* Experience */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <ArraySection
                label="Work Experience"
                items={resume.experience || []}
                onUpdate={v => field('experience', v)}
                fields={[
                  { key:'title',       label:'Job Title',    placeholder:'Field Manager' },
                  { key:'company',     label:'Company',      placeholder:'Acme Farms' },
                  { key:'start',       label:'Start',        placeholder:'Jan 2020' },
                  { key:'end',         label:'End',          placeholder:'Present' },
                  { key:'description', label:'Description',  wide:true, textarea:true },
                ]}
              />
            </div>

            {/* Education */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <ArraySection
                label="Education"
                items={resume.education || []}
                onUpdate={v => field('education', v)}
                fields={[
                  { key:'degree',      label:'Degree / Programme',  placeholder:'BSc Agriculture' },
                  { key:'institution', label:'Institution',          placeholder:'University of...' },
                  { key:'year',        label:'Year',                placeholder:'2018' },
                ]}
              />
            </div>

            {/* Skills */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <SkillsEditor skills={resume.skills || []} onUpdate={v => field('skills', v)} />
            </div>

            {/* Certifications */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <ArraySection
                label="Certifications"
                items={resume.certifications || []}
                onUpdate={v => field('certifications', v)}
                fields={[
                  { key:'name', label:'Certification Name', placeholder:'Food Safety Level 2' },
                  { key:'year', label:'Year', placeholder:'2022', type:'number' },
                ]}
              />
            </div>

            {/* Languages */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <ArraySection
                label="Languages"
                items={resume.languages || []}
                onUpdate={v => field('languages', v)}
                fields={[
                  { key:'language', label:'Language',    placeholder:'Spanish' },
                  { key:'level',    label:'Proficiency', placeholder:'Fluent' },
                ]}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
