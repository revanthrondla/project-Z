/**
 * CustomFieldsCreateSection
 *
 * Drop-in section for CREATE forms. Renders all active custom fields
 * for a module, manages local state, and notifies the parent of value
 * changes via onValuesChange so the parent can POST them immediately
 * after the main record is created.
 *
 * Usage:
 *   const [cfValues, setCfValues] = useState({});
 *
 *   // In JSX (inside the create form, before the submit button):
 *   <CustomFieldsCreateSection module="projects" onValuesChange={setCfValues} />
 *
 *   // After creating the record and receiving newId:
 *   await saveCFValues('projects', newId, cfValues);
 *
 * Props:
 *   module          — one of: employees, timesheets, absences, invoices,
 *                             clients, projects, expenses, contractors, jobs
 *   onValuesChange  — (values: {[field_key]: any}) => void
 *   className       — extra Tailwind classes for the wrapper
 */
import { useState, useMemo } from 'react';
import useCustomFieldDefs from '../hooks/useCustomFieldDefs';
import CustomFieldRenderer from './CustomFieldRenderer';

export default function CustomFieldsCreateSection({
  module,
  onValuesChange,
  className = '',
}) {
  const { defs, lookupOptions, loading, error } = useCustomFieldDefs(module);
  const [values,      setValues]      = useState({});
  const [fieldErrors, setFieldErrors] = useState({});

  if (!module)   return null;
  if (loading)   return <div className={`text-sm text-gray-400 py-2 ${className}`}>Loading custom fields…</div>;
  if (error || !defs.length) return null; // Silently skip if nothing configured

  const handleChange = (key, val) => {
    const next = { ...values, [key]: val };
    setValues(next);
    // Clear inline error when user edits
    if (fieldErrors[key]) setFieldErrors(e => { const n = { ...e }; delete n[key]; return n; });
    onValuesChange?.(next);
  };

  // Build allValues for formula evaluation
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const allValues = useMemo(() => {
    const out = {};
    for (const d of defs) out[d.field_key] = values[d.field_key] ?? '';
    return out;
  }, [defs, values]);

  return (
    <div className={`border-t border-gray-100 pt-4 mt-2 ${className}`}>
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
        Custom Fields
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {defs.map(field => (
          <div
            key={field.field_key}
            className={field.field_type === 'textarea' ? 'sm:col-span-2' : ''}
          >
            <CustomFieldRenderer
              field={field}
              value={values[field.field_key]}
              onChange={handleChange}
              errors={fieldErrors}
              allValues={allValues}
              lookupOptions={lookupOptions}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Utility: saves custom field values after a record is created.
 * Call this in the create handler right after the API returns the new ID.
 *
 * @param {object} api       — axios instance
 * @param {string} module    — module slug
 * @param {number} recordId  — newly created record ID
 * @param {object} values    — { [field_key]: value }
 */
export async function saveCFValues(api, module, recordId, values) {
  if (!recordId || !values || Object.keys(values).length === 0) return;
  try {
    await api.put(`/custom-fields/${module}/${recordId}/values`, {
      values: Object.entries(values).map(([field_key, value]) => ({ field_key, value })),
    });
  } catch {
    // Non-fatal — values can always be filled in edit mode later
  }
}
