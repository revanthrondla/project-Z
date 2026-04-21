/**
 * CustomFieldRenderer
 *
 * Renders a single custom field based on its definition.
 * Supports: text, rich_text, number, date, select, radio, checkbox, multi_checkbox
 *
 * Props:
 *   field       — field definition from employee_custom_field_defs
 *   value       — current value (raw: string for text/number/date, boolean for checkbox, array for multi_checkbox)
 *   onChange    — (fieldKey, newValue) => void
 *   errors      — object: { [fieldKey]: errorMessage }
 *   readOnly    — boolean — formula fields are always read-only
 *   allValues   — object: { [fieldKey]: value } — needed to evaluate formula fields
 */
import React, { useMemo } from 'react';

// ── Formula evaluator ─────────────────────────────────────────────────────────
// Supports simple arithmetic on other field values. Syntax: {field_key} + {other_key}
// Only numeric operations. Returns a formatted string or '' on error.
function evaluateFormula(formula, allValues) {
  if (!formula) return '';
  try {
    // Replace {field_key} tokens with numeric values from allValues
    const expr = formula.replace(/\{([a-z][a-z0-9_]*)\}/g, (_, key) => {
      const v = parseFloat(allValues[key]);
      return isNaN(v) ? '0' : String(v);
    });
    // Only allow safe arithmetic — reject anything non-numeric
    if (!/^[\d\s\+\-\*\/\.\(\)]+$/.test(expr)) return formula;
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${expr})`)();
    return isNaN(result) ? '' : String(parseFloat(result.toFixed(4)));
  } catch {
    return '';
  }
}

// ── Individual field type renderers ──────────────────────────────────────────

function TextField({ field, value, onChange, readOnly }) {
  return (
    <input
      type="text"
      className="input"
      value={value ?? ''}
      placeholder={field.placeholder || ''}
      maxLength={field.validation?.maxLength || 500}
      readOnly={readOnly}
      onChange={e => onChange(field.field_key, e.target.value)}
    />
  );
}

function RichTextField({ field, value, onChange, readOnly }) {
  // Simple rich-text area with a minimal bold/italic toolbar.
  // For production, swap the textarea with a Quill/TipTap editor component.
  const applyFormat = (tag) => {
    const ta = document.getElementById(`rich-${field.field_key}`);
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const selected = v.slice(s, e);
    if (!selected) return;
    const replacement = `<${tag}>${selected}</${tag}>`;
    const next = v.slice(0, s) + replacement + v.slice(e);
    onChange(field.field_key, next);
    // Restore cursor after state update
    setTimeout(() => {
      ta.setSelectionRange(s + tag.length + 2, s + tag.length + 2 + selected.length);
    }, 0);
  };

  return (
    <div className="space-y-1">
      {!readOnly && (
        <div className="flex gap-1 mb-1">
          {[['b','B'],['i','I'],['u','U']].map(([tag, label]) => (
            <button
              key={tag}
              type="button"
              title={`Format ${tag}`}
              onMouseDown={e => { e.preventDefault(); applyFormat(tag); }}
              className="w-7 h-7 rounded border border-gray-300 text-xs font-medium hover:bg-gray-100 flex items-center justify-center"
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <textarea
        id={`rich-${field.field_key}`}
        className="input min-h-[96px] font-mono text-sm"
        value={value ?? ''}
        placeholder={field.placeholder || 'Supports <b>bold</b>, <i>italic</i>, <u>underline</u>…'}
        readOnly={readOnly}
        onChange={e => onChange(field.field_key, e.target.value)}
      />
    </div>
  );
}

function NumberField({ field, value, onChange, readOnly }) {
  const v = field.validation || {};
  return (
    <input
      type="number"
      className="input"
      value={value ?? ''}
      placeholder={field.placeholder || ''}
      min={v.min ?? undefined}
      max={v.max ?? undefined}
      step="any"
      readOnly={readOnly}
      onChange={e => onChange(field.field_key, e.target.value)}
    />
  );
}

function DateField({ field, value, onChange, readOnly }) {
  return (
    <input
      type="date"
      className="input"
      value={value ?? ''}
      readOnly={readOnly}
      onChange={e => onChange(field.field_key, e.target.value)}
    />
  );
}

function SelectField({ field, value, onChange, readOnly }) {
  const options = Array.isArray(field.options) ? field.options : [];
  return (
    <select
      className="input"
      value={value ?? ''}
      disabled={readOnly}
      onChange={e => onChange(field.field_key, e.target.value)}
    >
      <option value="">{field.placeholder || '— select —'}</option>
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

function RadioField({ field, value, onChange, readOnly }) {
  const options = Array.isArray(field.options) ? field.options : [];
  return (
    <div className="flex flex-wrap gap-4 pt-1">
      {options.map(opt => (
        <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-700">
          <input
            type="radio"
            name={`cf_${field.field_key}`}
            value={opt.value}
            checked={value === opt.value}
            disabled={readOnly}
            onChange={() => onChange(field.field_key, opt.value)}
            className="accent-emerald-600"
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

function CheckboxField({ field, value, onChange, readOnly }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
      <input
        type="checkbox"
        checked={!!value}
        disabled={readOnly}
        onChange={e => onChange(field.field_key, e.target.checked)}
        className="w-4 h-4 accent-emerald-600"
      />
      {field.placeholder || field.label}
    </label>
  );
}

function MultiCheckboxField({ field, value, onChange, readOnly }) {
  const options = Array.isArray(field.options) ? field.options : [];
  const selected = Array.isArray(value) ? value : [];

  const toggle = (optVal) => {
    const next = selected.includes(optVal)
      ? selected.filter(v => v !== optVal)
      : [...selected, optVal];
    onChange(field.field_key, next);
  };

  return (
    <div className="flex flex-wrap gap-3 pt-1">
      {options.map(opt => (
        <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-700">
          <input
            type="checkbox"
            checked={selected.includes(opt.value)}
            disabled={readOnly}
            onChange={() => toggle(opt.value)}
            className="w-4 h-4 accent-emerald-600"
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CustomFieldRenderer({ field, value, onChange, errors = {}, allValues = {} }) {
  const isFormula = !!field.formula;
  const readOnly  = isFormula;

  // Evaluate formula fields
  const displayValue = useMemo(() => {
    if (!isFormula) return value;
    return evaluateFormula(field.formula, allValues);
  }, [isFormula, field.formula, value, allValues]);

  const errorMsg = errors[field.field_key];

  // Determine the input to render
  let input;
  switch (field.field_type) {
    case 'rich_text':      input = <RichTextField      field={field} value={displayValue} onChange={onChange} readOnly={readOnly} />; break;
    case 'number':         input = <NumberField         field={field} value={displayValue} onChange={onChange} readOnly={readOnly} />; break;
    case 'date':           input = <DateField           field={field} value={displayValue} onChange={onChange} readOnly={readOnly} />; break;
    case 'select':         input = <SelectField         field={field} value={displayValue} onChange={onChange} readOnly={readOnly} />; break;
    case 'radio':          input = <RadioField          field={field} value={displayValue} onChange={onChange} readOnly={readOnly} />; break;
    case 'checkbox':       input = <CheckboxField       field={field} value={displayValue} onChange={onChange} readOnly={readOnly} />; break;
    case 'multi_checkbox': input = <MultiCheckboxField  field={field} value={displayValue} onChange={onChange} readOnly={readOnly} />; break;
    default:               input = <TextField           field={field} value={displayValue} onChange={onChange} readOnly={readOnly} />;
  }

  return (
    <div>
      {field.field_type !== 'checkbox' && (
        <label className="label flex items-center gap-1">
          {field.label}
          {field.validation?.required && <span className="text-red-500 text-xs">*</span>}
          {isFormula && (
            <span className="text-xs text-blue-500 font-normal ml-1" title={`Formula: ${field.formula}`}>
              ƒ calculated
            </span>
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

// ── Validation helper (called before form submit) ────────────────────────────

export function validateCustomFieldValues(fieldDefs, values) {
  const errors = {};
  for (const field of fieldDefs) {
    if (!field.is_active || field.formula) continue; // Skip inactive / computed
    const v   = field.validation || {};
    const val = values[field.field_key];
    const isEmpty = val == null || val === '' || (Array.isArray(val) && val.length === 0);

    if (v.required && isEmpty) {
      errors[field.field_key] = `${field.label} is required`;
      continue;
    }
    if (isEmpty) continue; // Other rules only apply if value exists

    const str = String(val);
    if (v.minLength && str.length < v.minLength)  errors[field.field_key] = `${field.label} must be at least ${v.minLength} characters`;
    if (v.maxLength && str.length > v.maxLength)  errors[field.field_key] = `${field.label} must be at most ${v.maxLength} characters`;

    if (field.field_type === 'number') {
      const num = parseFloat(val);
      if (v.min !== undefined && num < v.min) errors[field.field_key] = `${field.label} must be ≥ ${v.min}`;
      if (v.max !== undefined && num > v.max) errors[field.field_key] = `${field.label} must be ≤ ${v.max}`;
    }
    if (v.pattern) {
      const re = new RegExp(v.pattern);
      if (!re.test(str)) errors[field.field_key] = v.patternMsg || `${field.label} format is invalid`;
    }
  }
  return errors;
}
