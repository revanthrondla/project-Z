/**
 * CustomFieldsPanel
 *
 * Drop-in panel for any module page. Renders all active custom fields
 * for a given module+recordId, lets users edit them, and saves on submit.
 *
 * Usage:
 *   <CustomFieldsPanel module="employees" recordId={employee.id} />
 *   <CustomFieldsPanel module="invoices"  recordId={invoice.id}  readOnly />
 *
 * Props:
 *   module     — one of: employees, timesheets, absences, invoices,
 *                        clients, projects, expenses, contractors, jobs
 *   recordId   — integer ID of the record
 *   readOnly   — boolean (default false)
 *   className  — extra Tailwind classes for the outer wrapper
 *   onSaved    — callback after successful save
 */
import { useState, useMemo } from 'react';
import useCustomFields from '../hooks/useCustomFields';
import CustomFieldRenderer, { validateCustomFieldValues } from './CustomFieldRenderer';

export default function CustomFieldsPanel({
  module,
  recordId,
  readOnly = false,
  className = '',
  onSaved,
}) {
  const { defs, values, setValues, lookupOptions, loading, error, save } = useCustomFields(module, recordId);
  const [localValues, setLocalValues]   = useState(null); // null = use hook values
  const [saving,      setSaving]        = useState(false);
  const [saveError,   setSaveError]     = useState(null);
  const [saveSuccess, setSaveSuccess]   = useState(false);
  const [fieldErrors, setFieldErrors]   = useState({});

  // Prefer local edits over fetched values
  const displayValues = localValues ?? values;

  const handleChange = (key, val) => {
    setLocalValues(prev => ({ ...(prev ?? values), [key]: val }));
    // Clear field error on change
    if (fieldErrors[key]) setFieldErrors(e => { const n = {...e}; delete n[key]; return n; });
    setSaveError(null);
    setSaveSuccess(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const errs = validateCustomFieldValues(defs, displayValues);
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await save(displayValues);
      setSaveSuccess(true);
      setLocalValues(null); // reset to server values
      setTimeout(() => setSaveSuccess(false), 3000);
      onSaved?.();
    } catch (err) {
      setSaveError(err.response?.data?.error || 'Failed to save custom fields');
    } finally {
      setSaving(false);
    }
  };

  if (!module || !recordId) return null;
  if (loading) return <div className={`text-sm text-gray-400 py-4 ${className}`}>Loading custom fields…</div>;
  if (error)   return <div className={`text-sm text-red-500 py-4 ${className}`}>{error}</div>;
  if (!defs.length) return null; // No custom fields configured for this module

  // Build allValues for formula evaluation
  const allValues = useMemo(() => {
    const out = {};
    for (const d of defs) out[d.field_key] = displayValues[d.field_key] ?? '';
    return out;
  }, [defs, displayValues]);

  return (
    <div className={className}>
      <form onSubmit={handleSave} noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {defs.map(field => (
            <div key={field.field_key}
              className={field.field_type === 'textarea' ? 'sm:col-span-2' : ''}
            >
              <CustomFieldRenderer
                field={field}
                value={displayValues[field.field_key]}
                onChange={handleChange}
                errors={fieldErrors}
                allValues={allValues}
                lookupOptions={lookupOptions}
                readOnly={readOnly}
              />
            </div>
          ))}
        </div>

        {!readOnly && (
          <div className="mt-4 flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Custom Fields'}
            </button>
            {saveSuccess && (
              <span className="text-sm text-emerald-600 font-medium">✓ Saved</span>
            )}
            {saveError && (
              <span className="text-sm text-red-600">{saveError}</span>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
