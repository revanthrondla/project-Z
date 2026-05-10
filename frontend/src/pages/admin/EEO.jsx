/**
 * EEO Compliance Center
 *
 * Three-panel admin page:
 *   1. Org EEO Configuration  — EEOC/OFCCP registration details
 *   2. Workforce Statistics   — live breakdown by race, gender, job category, veteran, disability
 *   3. EEO-1 Reports          — generate snapshots + view historical filings
 *   4. Workforce Table        — per-candidate EEO completeness with inline edit trigger
 */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';

// ─── Static lookup tables (mirrors backend labels) ────────────────────────────

const RACE_OPTIONS = [
  { value: 'hispanic_latino',                  label: 'Hispanic or Latino' },
  { value: 'white',                            label: 'White (Not Hispanic or Latino)' },
  { value: 'black_african_american',           label: 'Black or African American' },
  { value: 'native_hawaiian_pacific_islander', label: 'Native Hawaiian or Other Pacific Islander' },
  { value: 'asian',                            label: 'Asian (Not Hispanic or Latino)' },
  { value: 'american_indian_alaska_native',    label: 'American Indian or Alaska Native' },
  { value: 'two_or_more_races',                label: 'Two or More Races' },
  { value: 'prefer_not_to_say',               label: 'Prefer Not to Say / Not Disclosed' },
];

const JOB_CAT_OPTIONS = [
  { value: 'exec_senior_mgr', label: '1.1 Executive/Senior Level Officials & Managers' },
  { value: 'first_mid_mgr',   label: '1.2 First/Mid Level Officials & Managers' },
  { value: 'professional',    label: '2. Professionals' },
  { value: 'technician',      label: '3. Technicians' },
  { value: 'sales',           label: '4. Sales Workers' },
  { value: 'admin_support',   label: '5. Administrative Support Workers' },
  { value: 'craft',           label: '6. Craft Workers' },
  { value: 'operative',       label: '7. Operatives' },
  { value: 'laborer_helper',  label: '8. Laborers & Helpers' },
  { value: 'service_worker',  label: '9. Service Workers' },
  { value: 'not_assigned',    label: 'Not Assigned' },
];

const VETERAN_OPTIONS = [
  { value: 'not_veteran',                        label: 'Not a Veteran' },
  { value: 'disabled_veteran',                   label: 'Disabled Veteran' },
  { value: 'recently_separated_veteran',         label: 'Recently Separated Veteran' },
  { value: 'active_duty_wartime_badge_veteran',  label: 'Active Duty Wartime / Campaign Badge Veteran' },
  { value: 'armed_forces_service_medal_veteran', label: 'Armed Forces Service Medal Veteran' },
  { value: 'prefer_not_to_say',                 label: 'Prefer Not to Say' },
];

const DISABILITY_OPTIONS = [
  { value: 'yes_disability',    label: 'Yes, I have a disability' },
  { value: 'no_disability',     label: 'No, I do not have a disability' },
  { value: 'prefer_not_to_say', label: 'Prefer not to answer' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(n, total) {
  if (!total) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

function StatBar({ label, count, total, color = 'bg-green-500' }) {
  const width = total ? Math.round((count / total) * 100) : 0;
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs text-gray-600 mb-0.5">
        <span className="truncate max-w-[65%]">{label}</span>
        <span className="font-medium">{count} ({pct(count, total)})</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-2 ${color} rounded-full transition-all`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function CompletenessCard({ label, complete, total, color }) {
  const pctVal = total ? Math.round((complete / total) * 100) : 0;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-800">{pctVal}%</p>
      <p className="text-xs text-gray-400 mt-0.5">{complete} of {total} employees</p>
      <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-1.5 ${color} rounded-full`}
          style={{ width: `${pctVal}%` }}
        />
      </div>
    </div>
  );
}

// ─── Tab: Org Configuration ───────────────────────────────────────────────────

function OrgConfigTab() {
  const [form,    setForm]    = useState({});
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [err,     setErr]     = useState(null);

  useEffect(() => {
    api.get('/eeo/profile')
      .then(r => setForm(r.data))
      .catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, []);

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const save = async () => {
    setSaving(true); setErr(null); setSaved(false);
    try {
      const { _labels, ...body } = form;
      await api.put('/eeo/profile', body);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center">Loading…</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{err}</div>}

      {/* EEO-1 Identity */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <span className="text-lg">🏢</span> EEO-1 Organization Identity
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">EEOC Company Number</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              placeholder="e.g. 12345678"
              value={form.eeo_company_number || ''}
              onChange={e => set('eeo_company_number', e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-0.5">Assigned by EEOC after first filing</p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">EEO Officer Name</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              value={form.eeo_officer_name || ''}
              onChange={e => set('eeo_officer_name', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">EEO Officer Email</label>
            <input
              type="email"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              value={form.eeo_officer_email || ''}
              onChange={e => set('eeo_officer_email', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">EEO-1 Snapshot Date</label>
            <input
              type="date"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              value={form.eeo_snapshot_date || ''}
              onChange={e => set('eeo_snapshot_date', e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-0.5">Pay period used for the annual EEO-1 headcount</p>
          </div>
        </div>
      </div>

      {/* Industry Classification */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <span className="text-lg">🏭</span> Industry Classification (NAICS)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">NAICS Code</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              placeholder="e.g. 541512"
              maxLength={6}
              value={form.naics_code || ''}
              onChange={e => set('naics_code', e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-0.5">6-digit North American Industry Classification code</p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">NAICS Description</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              placeholder="e.g. Computer Systems Design Services"
              value={form.naics_description || ''}
              onChange={e => set('naics_description', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Establishment Type</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              value={form.establishment_type || 'single'}
              onChange={e => set('establishment_type', e.target.value)}
            >
              <option value="single">Single Establishment</option>
              <option value="multi_hq">Multi-Establishment — HQ Report</option>
              <option value="multi_establishment">Multi-Establishment — Establishment Report</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">EEO-1 Filing Required?</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              value={form.eeo1_filing_required ? 'true' : 'false'}
              onChange={e => set('eeo1_filing_required', e.target.value === 'true')}
            >
              <option value="false">No / Not Yet Applicable</option>
              <option value="true">Yes — Required (100+ employees or federal contractor)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Federal Contractor / OFCCP */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <span className="text-lg">🏛️</span> Federal Contractor Status (OFCCP / VEVRAA / Section 503)
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          Applies if you hold federal contracts of $50K+ with 50+ employees. Triggers VEVRAA veteran reporting and Section 503 disability obligations.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Federal Contractor?</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              value={form.is_federal_contractor ? 'true' : 'false'}
              onChange={e => set('is_federal_contractor', e.target.value === 'true')}
            >
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">SAM.gov UEI (Unique Entity Identifier)</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              placeholder="e.g. ABC123DEF456"
              value={form.federal_contractor_uei || ''}
              onChange={e => set('federal_contractor_uei', e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-0.5">Replaced DUNS in April 2022</p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Affirmative Action Plan (AAP) in Place?</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              value={form.aap_in_place ? 'true' : 'false'}
              onChange={e => set('aap_in_place', e.target.value === 'true')}
            >
              <option value="false">No</option>
              <option value="true">Yes — AAP is current</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">AAP Effective Date</label>
            <input
              type="date"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              value={form.aap_effective_date || ''}
              onChange={e => set('aap_effective_date', e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium px-6 py-2 rounded-lg text-sm transition-colors"
        >
          {saving ? 'Saving…' : 'Save EEO Configuration'}
        </button>
        {saved && <span className="text-green-600 text-sm font-medium">✓ Saved</span>}
      </div>
    </div>
  );
}

// ─── Tab: Workforce Statistics ────────────────────────────────────────────────

function WorkforceStatsTab() {
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState(null);

  useEffect(() => {
    api.get('/eeo/workforce-stats')
      .then(r => setStats(r.data))
      .catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-400 text-sm py-8 text-center">Loading workforce data…</div>;
  if (err)     return <div className="text-red-500 text-sm py-4">{err}</div>;
  if (!stats)  return null;

  const { completeness, by_race_ethnicity, by_gender, by_job_category, by_veteran_status, by_disability } = stats;
  const total = completeness.total;

  const COLORS = ['bg-green-500','bg-blue-500','bg-purple-500','bg-amber-500','bg-rose-500','bg-teal-500','bg-indigo-500','bg-orange-500'];

  return (
    <div className="space-y-6">
      {/* Completeness cards */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Self-ID Completeness ({total} active employees)</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <CompletenessCard label="EEO-1 Complete (Race + Gender + Job Category)" complete={completeness.eeo1_complete} total={total} color="bg-green-500" />
          <CompletenessCard label="VEVRAA Complete (Veteran Status)" complete={completeness.vevraa_complete} total={total} color="bg-blue-500" />
          <CompletenessCard label="Section 503 / ADA Complete (Disability Status)" complete={completeness.ada_complete} total={total} color="bg-purple-500" />
        </div>
        {completeness.eeo1_pct < 80 && (
          <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm">
            ⚠️ EEO-1 self-ID completeness is below 80%. EEOC recommends collecting data for all employees before filing. Use the Workforce Table tab to identify and invite missing responses.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Race / Ethnicity */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Race / Ethnicity</h3>
          {by_race_ethnicity.map((r, i) => (
            <StatBar key={r.value} label={r.label} count={r.count} total={total} color={COLORS[i % COLORS.length]} />
          ))}
        </div>

        {/* Gender */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Gender</h3>
          {by_gender.map((r, i) => (
            <StatBar key={r.value} label={r.value === 'prefer_not_to_say' ? 'Prefer Not to Say' : r.value.charAt(0).toUpperCase() + r.value.slice(1)} count={r.count} total={total} color={COLORS[i % COLORS.length]} />
          ))}
        </div>

        {/* EEO-1 Job Category */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">EEO-1 Job Category</h3>
          {by_job_category.map((r, i) => (
            <StatBar key={r.value} label={r.label} count={r.count} total={total} color={COLORS[i % COLORS.length]} />
          ))}
        </div>

        {/* Veteran Status */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Veteran Status (VEVRAA)</h3>
          {by_veteran_status.map((r, i) => (
            <StatBar key={r.value} label={r.label} count={r.count} total={total} color={COLORS[i % COLORS.length]} />
          ))}
        </div>

        {/* Disability */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Disability Status (Section 503 / ADA)</h3>
          {by_disability.map((r, i) => (
            <StatBar key={r.value} label={r.label} count={r.count} total={total} color={COLORS[i % COLORS.length]} />
          ))}
        </div>
      </div>

      <p className="text-xs text-gray-400">
        * "Not Collected" indicates the employee has not yet completed the voluntary self-identification form.
          All EEO data is collected on a voluntary, confidential basis in accordance with EEOC guidelines.
      </p>
    </div>
  );
}

// ─── Tab: EEO-1 Reports ───────────────────────────────────────────────────────

function ReportsTab() {
  const [reports,      setReports]      = useState([]);
  const [summary,      setSummary]      = useState(null);
  const [summaryYear,  setSummaryYear]  = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [generating,   setGenerating]   = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [snapDate,     setSnapDate]     = useState(new Date().toISOString().split('T')[0]);
  const [repYear,      setRepYear]      = useState(new Date().getFullYear());
  const [err,          setErr]          = useState(null);
  const [genMsg,       setGenMsg]       = useState(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/eeo/reports');
      setReports(r.data);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadReports(); }, [loadReports]);

  const generate = async () => {
    setGenerating(true); setErr(null); setGenMsg(null);
    try {
      const r = await api.post('/eeo/reports/generate', { snapshot_date: snapDate, report_year: repYear });
      setGenMsg(`✓ Generated ${r.data.rows_generated} rows for ${repYear} (snapshot: ${snapDate})`);
      await loadReports();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setGenerating(false);
    }
  };

  const viewSummary = async (year) => {
    setLoadingSummary(true); setSummary(null);
    try {
      const r = await api.get(`/eeo/reports/${year}/summary`);
      setSummary(r.data); setSummaryYear(year);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setLoadingSummary(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Generate snapshot */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="font-semibold text-gray-800 mb-1">Generate EEO-1 Snapshot</h3>
        <p className="text-xs text-gray-500 mb-4">
          Captures the current active workforce headcount by race/ethnicity, gender, and job category and stores it as a permanent record for the filing year.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Snapshot Date</label>
            <input
              type="date"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              value={snapDate}
              onChange={e => setSnapDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Report Year</label>
            <input
              type="number"
              min="2020"
              max="2040"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-green-400"
              value={repYear}
              onChange={e => setRepYear(parseInt(e.target.value, 10))}
            />
          </div>
          <button
            onClick={generate}
            disabled={generating}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg text-sm transition-colors"
          >
            {generating ? 'Generating…' : '📊 Generate Snapshot'}
          </button>
        </div>
        {genMsg && <p className="mt-3 text-green-600 text-sm font-medium">{genMsg}</p>}
        {err    && <p className="mt-3 text-red-500 text-sm">{err}</p>}
      </div>

      {/* Historical reports */}
      {loading ? (
        <p className="text-gray-400 text-sm py-4 text-center">Loading reports…</p>
      ) : reports.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 text-center text-gray-500 text-sm">
          No EEO-1 snapshots yet. Generate your first snapshot above.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-800">Historical Snapshots</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Year</th>
                <th className="px-4 py-2 text-left">Snapshot Date</th>
                <th className="px-4 py-2 text-right">Total Headcount</th>
                <th className="px-4 py-2 text-right">Job Categories</th>
                <th className="px-4 py-2 text-left">Generated</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reports.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-800">{r.report_year}</td>
                  <td className="px-4 py-3 text-gray-600">{r.snapshot_date}</td>
                  <td className="px-4 py-3 text-right font-medium">{r.total_headcount}</td>
                  <td className="px-4 py-3 text-right">{r.job_categories}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(r.generated_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => viewSummary(r.report_year)}
                      className="text-green-600 hover:text-green-800 text-xs font-medium"
                    >
                      View →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary pivot */}
      {loadingSummary && <p className="text-gray-400 text-sm py-4 text-center">Loading summary…</p>}
      {summary && (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">
              EEO-1 Summary — {summaryYear} <span className="text-gray-400 font-normal text-sm">({summary.grand_total} total)</span>
            </h3>
            <button onClick={() => setSummary(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Job Category</th>
                  <th className="px-3 py-2 text-left">Race / Ethnicity</th>
                  <th className="px-3 py-2 text-center">Male</th>
                  <th className="px-3 py-2 text-center">Female</th>
                  <th className="px-3 py-2 text-center">Nonbinary</th>
                  <th className="px-3 py-2 text-center">Prefer Not to Say</th>
                  <th className="px-3 py-2 text-center font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {summary.rows.map((r, i) => {
                  const key = `${r.job_category}|${r.race_ethnicity}`;
                  const rowMap = {};
                  summary.rows.filter(x => x.job_category === r.job_category && x.race_ethnicity === r.race_ethnicity)
                    .forEach(x => { rowMap[x.gender] = x.headcount; });
                  const rowTotal = Object.values(rowMap).reduce((a, b) => a + b, 0);
                  // Only render once per (job_category, race_ethnicity) pair
                  const seen = summary.rows.slice(0, i).find(x => x.job_category === r.job_category && x.race_ethnicity === r.race_ethnicity);
                  if (seen) return null;
                  return (
                    <tr key={key} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-700">{r.job_category_label}</td>
                      <td className="px-3 py-2 text-gray-600">{r.race_ethnicity_label}</td>
                      <td className="px-3 py-2 text-center">{rowMap.male || 0}</td>
                      <td className="px-3 py-2 text-center">{rowMap.female || 0}</td>
                      <td className="px-3 py-2 text-center">{rowMap.nonbinary || 0}</td>
                      <td className="px-3 py-2 text-center">{rowMap.prefer_not_to_say || 0}</td>
                      <td className="px-3 py-2 text-center font-semibold">{rowTotal}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Workforce Table (per-candidate EEO completeness) ───────────────────

function WorkforceTableTab() {
  const [data,        setData]        = useState([]);
  const [total,       setTotal]       = useState(0);
  const [page,        setPage]        = useState(1);
  const [missingOnly, setMissingOnly] = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [editId,      setEditId]      = useState(null);
  const [editForm,    setEditForm]    = useState({});
  const [saving,      setSaving]      = useState(false);
  const [err,         setErr]         = useState(null);
  const LIMIT = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/eeo/candidates', { params: { page, limit: LIMIT, missing_only: missingOnly } });
      setData(r.data.data);
      setTotal(r.data.total);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [page, missingOnly]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (c) => {
    setEditId(c.id);
    setEditForm({
      eeo_race_ethnicity:  c.eeo_race_ethnicity  || '',
      eeo_gender:          c.eeo_gender           || '',
      eeo_job_category:    c.eeo_job_category     || '',
      veteran_status:      c.veteran_status       || '',
      disability_status:   c.disability_status    || '',
      eeo_data_source:     c.eeo_data_source      || 'not_collected',
    });
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const body = {};
      Object.entries(editForm).forEach(([k, v]) => { if (v) body[k] = v; });
      await api.put(`/eeo/candidates/${editId}`, body);
      setEditId(null);
      await load();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={missingOnly}
              onChange={e => { setMissingOnly(e.target.checked); setPage(1); }}
              className="accent-green-600"
            />
            Show incomplete EEO records only
          </label>
        </div>
        <p className="text-xs text-gray-400">{total} employees</p>
      </div>

      {err && <div className="text-red-500 text-sm">{err}</div>}

      {loading ? (
        <p className="text-gray-400 text-sm py-8 text-center">Loading…</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Employee</th>
                  <th className="px-4 py-2 text-left">Role</th>
                  <th className="px-4 py-2 text-center">EEO-1</th>
                  <th className="px-4 py-2 text-center">VEVRAA</th>
                  <th className="px-4 py-2 text-center">ADA</th>
                  <th className="px-4 py-2 text-center">Self-ID Date</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.map(c => (
                  <React.Fragment key={c.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-800">{c.name}</p>
                        <p className="text-xs text-gray-400">{c.email}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{c.role}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${c.eeo_complete ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                          {c.eeo_complete ? '✓' : '!'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${c.vevraa_complete ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-600'}`}>
                          {c.vevraa_complete ? '✓' : '–'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${c.ada_complete ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-600'}`}>
                          {c.ada_complete ? '✓' : '–'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-gray-400">
                        {c.eeo_self_id_date || '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editId === c.id ? (
                          <button onClick={() => setEditId(null)} className="text-gray-400 hover:text-gray-600 text-xs">Cancel</button>
                        ) : (
                          <button onClick={() => startEdit(c)} className="text-green-600 hover:text-green-800 text-xs font-medium">Edit →</button>
                        )}
                      </td>
                    </tr>

                    {/* Inline edit row */}
                    {editId === c.id && (
                      <tr className="bg-green-50 border-t border-green-200">
                        <td colSpan={7} className="px-4 py-4">
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">Race / Ethnicity</label>
                              <select className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"
                                value={editForm.eeo_race_ethnicity}
                                onChange={e => setEditForm(f => ({ ...f, eeo_race_ethnicity: e.target.value }))}>
                                <option value="">— Select —</option>
                                {RACE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">Gender</label>
                              <select className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"
                                value={editForm.eeo_gender}
                                onChange={e => setEditForm(f => ({ ...f, eeo_gender: e.target.value }))}>
                                <option value="">— Select —</option>
                                <option value="male">Male</option>
                                <option value="female">Female</option>
                                <option value="nonbinary">Nonbinary</option>
                                <option value="prefer_not_to_say">Prefer Not to Say</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">EEO-1 Job Category</label>
                              <select className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"
                                value={editForm.eeo_job_category}
                                onChange={e => setEditForm(f => ({ ...f, eeo_job_category: e.target.value }))}>
                                <option value="">— Select —</option>
                                {JOB_CAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">Veteran Status</label>
                              <select className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"
                                value={editForm.veteran_status}
                                onChange={e => setEditForm(f => ({ ...f, veteran_status: e.target.value }))}>
                                <option value="">— Select —</option>
                                {VETERAN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">Disability Status</label>
                              <select className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"
                                value={editForm.disability_status}
                                onChange={e => setEditForm(f => ({ ...f, disability_status: e.target.value }))}>
                                <option value="">— Select —</option>
                                {DISABILITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">Data Source</label>
                              <select className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-400"
                                value={editForm.eeo_data_source}
                                onChange={e => setEditForm(f => ({ ...f, eeo_data_source: e.target.value }))}>
                                <option value="self_identified">Self-Identified</option>
                                <option value="visual_observation">Visual Observation</option>
                                <option value="payroll_records">Payroll Records</option>
                                <option value="not_collected">Not Collected</option>
                              </select>
                            </div>
                          </div>
                          <div className="mt-3 flex gap-2">
                            <button
                              onClick={saveEdit}
                              disabled={saving}
                              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors"
                            >
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button onClick={() => setEditId(null)} className="border border-gray-300 text-gray-600 hover:bg-gray-100 text-xs font-medium px-4 py-1.5 rounded-lg transition-colors">
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
              <span>Page {page} of {totalPages} ({total} total)</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50">← Prev</button>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next →</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'config',    label: '⚙️ Org Configuration' },
  { id: 'stats',     label: '📊 Workforce Statistics' },
  { id: 'reports',   label: '📋 EEO-1 Reports' },
  { id: 'workforce', label: '👥 Workforce Table' },
];

export default function EEO() {
  const [activeTab, setActiveTab] = useState('config');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">EEO Compliance Center</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage EEO-1 reporting obligations (EEOC), veteran status tracking (VEVRAA), and disability self-identification (Section 503 / ADA).
          All employee data is collected voluntarily and kept confidential.
        </p>
      </div>

      {/* Regulatory badges */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: 'EEO-1 / EEOC', bg: 'bg-blue-50 text-blue-700 border-blue-200' },
          { label: 'VEVRAA (Veteran)', bg: 'bg-green-50 text-green-700 border-green-200' },
          { label: 'Section 503 / ADA', bg: 'bg-purple-50 text-purple-700 border-purple-200' },
          { label: 'OFCCP', bg: 'bg-amber-50 text-amber-700 border-amber-200' },
        ].map(b => (
          <span key={b.label} className={`text-xs font-medium px-3 py-1 rounded-full border ${b.bg}`}>{b.label}</span>
        ))}
      </div>

      {/* Tab bar */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <div className="flex border-b border-gray-200 min-w-max">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                  activeTab === tab.id
                    ? 'border-green-500 text-green-700 bg-green-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="p-6">
          {activeTab === 'config'    && <OrgConfigTab />}
          {activeTab === 'stats'     && <WorkforceStatsTab />}
          {activeTab === 'reports'   && <ReportsTab />}
          {activeTab === 'workforce' && <WorkforceTableTab />}
        </div>
      </div>
    </div>
  );
}
