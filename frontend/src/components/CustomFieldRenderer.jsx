/**
 * CustomFieldRenderer
 *
 * Renders a single custom field based on its definition.
 *
 * Supported field types:
 *   text | textarea | number | currency | select | multiselect |
 *   checkbox | date | datetime | lookup | formula
 *
 * Props:
 *   field         — field definition from custom_field_defs
 *   value         — current value (string/number/boolean/array depending on type)
 *   onChange      — (fieldKey, newValue) => void
 *   errors        — { [fieldKey]: errorMessage }
 *   readOnly      — boolean; formula fields are always read-only
 *   allValues     — { [fieldKey]: value } for formula evaluation
 *   lookupOptions — { [field_key]: [{ value, label }] } pre-fetched options for lookup fields
 */
import React, { useMemo } from 'react';

// ── Formula evaluator ─────────────────────────────────────────────────────────
function evaluateFormula(formula, allValues) {
  if (!formula) return '';
  try {
    const expr = formula.replace(/\{([a-z][a-z0-9_]*)\}/g, (_, key) => {
      const v = parseFloat(allValues?.[key]);
      return isNaN(v) ? '0' : String(v);
    });
    if (!/^[\d\s+\-*/.()\^%]+$/.test(expr)) return formula; // safety: only math chars
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${expr})`)();
    return isNaN(result) ? '' : String(parseFloat(result.toFixed(6)).toString());
  } catch {
    return '';
  }
}

// ── Field type renderers ──────────────────────────────────────────────────────

function TextField({ field, value, onChange, readOnly }) {
  return (
    <input type="text" className="input" value={value ?? ''}
      placeholder={field.placeholder || ''}
      maxLength={field.validation?.maxLength || 500}
      readOnly={readOnly}
      onChange={e => onChange(field.field_key, e.target.value)}
    />
  );
}

function TextareaField({ field, value, onChange, readOnly }) {
  return (
    <textarea className="input min-h-[80px]" value={value ?? ''}
      placeholder={field.placeholder || ''}
      maxLength={field.validation?.maxLength || 2000}
      readOnly={readOnly}
      onChange={e => onChange(field.field_key, e.target.value)}
    />
  );
}

function NumberField({ field, value, onChange, readOnly }) {
  const v = field.validation || {};
  return (
    <input type="number" className="input" value={value ?? ''}
      placeholder={field.placeholder || ''}
      min={v.min ?? undefined} max={v.max ?? undefined} step="any"
      readOnly={readOnly}
      onChange={e => onChange(field.field_key, e.target.value)}
    />
  );
}

function CurrencyField({ field, value, onChange, readOnly }) {
  return (
    <div className="flex items-center">
      <span className="px-3 py-2 bg-gray-100 border border-r-0 border-gray-300 rounded-l-lg text-gray-500 text-sm select-none">
        $
      </span>
      <input type="number" step="0.01" min="0"
        className="input rounded-l-none flex-1"
        value={value ?? ''}
        placeholder={field.placeholder || '0.00'}
        readOnly={readOnly}
        onChange={e => onChange(field.field_key, e.target.value)}
      />
    </div>
  );
}

function SelectField({ field, value, onChange, readOnly }) {
  const options = Array.isArray(field.options) ? field.options : [];
  return (
    <select className="input" value={value ?? ''} disabled={readOnly}
      onChange={e => onChange(field.field_key, e.target.value)}
    >
      <option value="">{field.placeholder || '— select —'}</option>
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

function MultiSelectField({ field, value, onChange, readOnly }) {
  const options = Array.isArray(field.options) ? field.options : [];
  const selected = Array.isArray(value) ? value : [];

  const toggle = (optVal) => {
    if (readOnly) return;
    const next = selected.includes(optVal)
      ? selected.filter(v => v !== optVal)
      : [...selected, optVal];
    onChange(field.field_key, next);
  };

  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {options.map(opt => (
        <button key={opt.value} type="button" onClick={() => toggle(opt.value)}
          disabled={readOnly}
          className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
            selected.includes(opt.value)
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-white text-gray-600 border-gray-300 hover:border-emerald-400'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function CheckboxField({ field, value, onChange, readOnly }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
      <input type="checkbox" checked={!!value} disabled={readOnly}
        onChange={e => onChange(field.field_key, e.target.checked)}
        className="w-4 h-4 accent-emerald-600"
      />
      {field.placeholder || field.label}
    </label>
  );
}

function DateField({ field, value, onChange, readOnly }) {
  return (
    <input type="date" className="input" value={value ?? ''} readOnly={readOnly}
      onChange={e => onChange(field.field_key, e.target.value)}
    />
  );
}

function DateTimeField({ field, value, onChange, readOnly }) {
  // Convert stored ISO to datetime-local format
  const localVal = value ? value.replace('Z', '').slice(0, 16) : '';
  return (
    <input type="datetime-local" className="input" value={localVal} readOnly={readOnly}
      onChange={e => onChange(field.field_key, e.target.value)}
    />
  );
}

function LookupField({ field, value, onChange, readOnly, lookupOptions }) {
  const opts = lookupOptions?.[field.field_key] || [];
  const strValue = value != null ? String(value) : '';

  return (
    <select className="input" value={strValue} disabled={readOnly}
      onChange={e => onChange(field.field_key, e.target.value ? parseInt(e.target.value, 10) : null)}
    >
      <option value="">{field.placeholder || '— select record —'}</option>
      {opts.map(opt => (
        <option key={opt.value} value={String(opt.value)}>{opt.label}</option>
      ))}
    </select>
  );
}

function FormulaField({ value, field }) {
  return (
    <div className="input bg-blue-50 border-blue-200 text-blue-900 font-mono text-sm cursor-not-allowed select-all">
      {value || <span className="text-blue-400 italic">calculating…</span>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CustomFieldRenderer({
  field,
  value,
  onChange,
  errors = {},
  allValues = {},
  lookupOptions = {},
  readOnly: readOnlyProp = false,
}) {
  const isFormula  = field.field_type === 'formula' || !!field.formula;
  const readOnly   = readOnlyProp || isFormula;

  // Evaluate formula
  const displayValue = useMemo(() => {
    if (!isFormula) return value;
    return evaluateFormula(field.formula, allValues);
  }, [isFormula, field.formula, value, allValues]);

  const errorMsg = errors[field.field_key];

  let input;
  switch (field.field_type) {
    case 'textarea':    input = <TextareaField   field={field} value={displayValue} onChange={onChange} readOnly={readOnly} />; break;
    case 'number':      input = <NumberField      field={field} value={displayValue} onChange={onChange} readOnly={readOnly} />; break;
    case 'currency':    input = <CurrencyField    field={field} value={displayValue} onChange={onChange} readOnly={readOnly} />; break;
    case 'select':
    // Legacy types mapped on migration
    case 'radio':       input = <SelectField      field={field} value={displayValue} onChange={onChange} readOnly={readOnly} />; break;
    case 'multiselect':
    case 'multi_checkbox': input = <MultiSelectField field={field} value={displayValue} onChange={onChange} readOnly={readOnly} />; break;
    case 'checkbox':    input = <CheckboxField    field={field} value={displayValue} onChange={onChange} readOnly={readOnly} />; break;
    case 'date':        input = <DateField        field={field} value={displayValue} onChange={onChange} readOnly={readOnly} />; break;
    case 'datetime':    input = <DateTimeField    field={field} value={displayValue} onChange={onChange} readOnly={readOnly} />; break;
    case 'lookup':      input = <LookupField      field={field} value={displayValue} onChange={onChange} readOnly={readOnly} lookupOptions={lookupOptions} />; break;
    case 'formula':     input = <FormulaField     field={field} value={displayValue} />; break;
    // Legacy types
    case 'rich_text':   input = <TextareaField    field={field} value={displayValue} onChange={onChange} readOnly={readOnly} />; break;
    default:            input = <TextField        field={field} value={displayValue} onChange={onChange} readOnly={readOnly} />;
  }

  return (
    <div>
      {field.field_type !== 'checkbox' && (
        <label className="label flex items-center gap-1.5">
          {field.label}
          {field.validation?.required && <span className="text-red-500 text-xs">*</span>}
          {isFormula && (
            <span className="text-xs text-blue-500 font-normal" title={`Formula: ${field.formula}`}>
              ƒ
            </span>
          )}
          {field.field_type === 'lookup' && (
            <span className="text-xs text-purple-500 font-normal">↗</span>
          )}
        </label>
      )}

      {input}

      {field.help_text && !errorMsg && (
        <p className="mt-1 text-xs text-gray-400">{field.help_text}</p>
      )}
      {errorMsg && (
        <p className="mt-1 text-xs text-red-500">{errorMsg}</p>
      )}
    </div>
  );
}

// ── Validation helper ─────────────────────────────────────────────────────────
export function validateCustomFieldValues(fieldDefs, values) {
  const errors = {};
  for (const field of fieldDefs) {
    if (!field.is_active) continue;
    if (field.field_type === 'formula' || field.formula) continue;
    const v   = field.validation || {};
    const val = values[field.field_key];
    const isEmpty = val == null || val === '' || (Array.isArray(val) && val.length === 0);

    if (v.required && isEmpty) { errors[field.field_key] = `${field.label} is required`; continue; }
    if (isEmpty) continue;

    const str = String(val);
    if (v.minLength && str.length < v.minLength)  errors[field.field_key] = `${field.label} must be at least ${v.minLength} characters`;
    if (v.maxLength && str.length > v.maxLength)  errors[field.field_key] = `${field.label} must be at most ${v.maxLength} characters`;
    if (field.field_type === 'number' || field.field_type === 'currency') {
      const num = parseFloat(val);
      if (v.min !== undefined && num < v.min) errors[field.field_key] = `${field.label} must be ≥ ${v.min}`;
      if (v.max !== undefined && num > v.max) errors[field.field_key] = `${field.label} must be ≤ ${v.max}`;
    }
    if (v.pattern) {
      try {
        if (!new RegExp(v.pattern).test(str)) errors[field.field_key] = v.patternMsg || `${field.label} format is invalid`;
      } catch {}
    }
  }
  return errors;
}
