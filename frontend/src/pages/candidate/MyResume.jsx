/**
 * My Resume — Candidate view
 * Candidates can build and manage their own professional resume.
 */
import React, { useState, useEffect } from 'react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';

// ── Editable list section ────────────────────────────────────────────────────
function ArraySection({ label, items, onUpdate, fields }) {
  const add = () => {
    const blank = Object.fromEntries(fields.map(f => [f.key, '']));
    onUpdate([...items, blank]);
  };
  const remove = (i) => onUpdate(items.filter((_, idx) => idx !== i));
  const change = (i, key, val) => {
    onUpdate(items.map((item, idx) => idx === i ? { ...item, [key]: val } : item));
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
            <button onClick={() => remove(i)} className="absolute top-3 right-3 text-gray-300 hover:text-red-400 text-lg leading-none">×</button>
            <div className="grid grid-cols-2 gap-3">
              {fields.map(f => (
                <div key={f.key} className={f.wide ? 'col-span-2' : ''}>
                  <label className="text-xs text-gray-500 block mb-0.5">{f.label}</label>
                  {f.textarea ? (
                    <textarea rows={2} className="input text-sm w-full" value={item[f.key] || ''}
                      onChange={e => change(i, f.key, e.target.value)} />
                  ) : (
                    <input type={f.type || 'text'} className="input text-sm" value={item[f.key] || ''}
                      onChange={e => change(i, f.key, e.target.value)} placeholder={f.placeholder || ''} />
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
            <button onClick={() => onUpdate(skills.filter((_, idx) => idx !== i))} className="text-green-500 hover:text-red-500 ml-1">×</button>
          </span>
        ))}
        {skills.length === 0 && <span className="text-gray-400 text-sm">No skills yet</span>}
      </div>
      <div className="flex gap-2">
        <input type="text" className="input flex-1 text-sm" placeholder="Type a skill and press Add…"
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())} />
        <button onClick={add} className="btn-primary text-sm px-4">Add</button>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function MyResume() {
  const { user } = useAuth();
  const [resume, setResume]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState('');

  // Determine candidate ID — the API uses the auth token's candidateId
  useEffect(() => {
    api.get('/api/resumes/me')
      .then(r => setResume(r.data))
      .catch(() => setResume({
        headline: '', summary: '',
        experience: [], education: [], skills: [],
        certifications: [], languages: [],
      }))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!resume) return;
    setSaving(true);
    setMsg('');
    try {
      const { data } = await api.put('/api/resumes/me', resume);
      setResume(data);
      setMsg('✅ Resume saved!');
      setTimeout(() => setMsg(''), 3000);
    } catch (e) {
      setMsg('❌ ' + (e.response?.data?.error || 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = () => {
    window.open('/api/resumes/me/pdf', '_blank');
  };

  const field = (key, val) => setResume(r => ({ ...r, [key]: val }));

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Resume</h1>
          <p className="text-sm text-gray-500 mt-0.5">Build your professional profile — downloadable as a PDF</p>
        </div>
        <div className="flex gap-2">
          <button onClick={downloadPdf} className="btn-secondary text-sm py-2 flex items-center gap-1">⬇ PDF</button>
          <button onClick={save} disabled={saving} className="btn-primary text-sm py-2">
            {saving ? 'Saving…' : '💾 Save'}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`mb-4 p-3 rounded-lg text-sm border ${
          msg.startsWith('✅') ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'
        }`}>{msg}</div>
      )}

      <div className="space-y-5">
        {/* Basic info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center gap-3 pb-2 border-b border-gray-100">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center font-bold text-green-700 text-lg">
              {user?.name?.[0]?.toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-gray-800">{user?.name}</p>
              <p className="text-xs text-gray-400">{user?.email}</p>
            </div>
          </div>
          <h3 className="font-semibold text-gray-800">Basic Info</h3>
          <div>
            <label className="label">Professional Headline</label>
            <input type="text" className="input" placeholder="e.g. Senior Field Manager · 8 yrs experience"
              value={resume.headline || ''} onChange={e => field('headline', e.target.value)} />
          </div>
          <div>
            <label className="label">Professional Summary</label>
            <textarea rows={4} className="input" placeholder="Brief overview of skills, experience, and career goals…"
              value={resume.summary || ''} onChange={e => field('summary', e.target.value)} />
          </div>
        </div>

        {/* Work Experience */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <ArraySection
            label="Work Experience"
            items={resume.experience || []}
            onUpdate={v => field('experience', v)}
            fields={[
              { key: 'title',       label: 'Job Title',   placeholder: 'Field Manager' },
              { key: 'company',     label: 'Company',     placeholder: 'Acme Farms' },
              { key: 'start',       label: 'Start',       placeholder: 'Jan 2020' },
              { key: 'end',         label: 'End',         placeholder: 'Present' },
              { key: 'description', label: 'Description', wide: true, textarea: true },
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
              { key: 'degree',      label: 'Degree / Programme', placeholder: 'BSc Agriculture' },
              { key: 'institution', label: 'Institution',         placeholder: 'University of...' },
              { key: 'year',        label: 'Year',               placeholder: '2018' },
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
              { key: 'name', label: 'Certification Name', placeholder: 'Food Safety Level 2' },
              { key: 'year', label: 'Year', placeholder: '2022', type: 'number' },
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
              { key: 'language', label: 'Language',    placeholder: 'Spanish' },
              { key: 'level',    label: 'Proficiency', placeholder: 'Fluent' },
            ]}
          />
        </div>

        {/* Save footer */}
        <div className="flex justify-end gap-2 pb-6">
          <button onClick={downloadPdf} className="btn-secondary text-sm py-2">⬇ Download PDF</button>
          <button onClick={save} disabled={saving} className="btn-primary text-sm py-2 px-6">
            {saving ? 'Saving…' : '💾 Save Resume'}
          </button>
        </div>
      </div>
    </div>
  );
}
