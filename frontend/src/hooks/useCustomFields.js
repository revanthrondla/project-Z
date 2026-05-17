/**
 * useCustomFields(module, recordId)
 *
 * Fetches custom field definitions and values for a given module+record.
 * Handles lookup option fetching for lookup-type fields.
 *
 * Returns:
 *   defs          — array of field definitions
 *   values        — { [field_key]: rawValue }
 *   setValues     — update values locally
 *   lookupOptions — { [field_key]: [{ value, label }] }
 *   loading       — boolean
 *   error         — string | null
 *   save(vals)    — upsert values to backend; returns Promise
 *   refresh()     — reload defs + values
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';

export default function useCustomFields(module, recordId) {
  const [defs,          setDefs]          = useState([]);
  const [values,        setValues]        = useState({});
  const [lookupOptions, setLookupOptions] = useState({});
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(null);

  // Track fetched lookup modules to avoid duplicate requests
  const fetchedLookups = useRef(new Set());

  const load = useCallback(async () => {
    if (!module || !recordId) return;
    setLoading(true);
    setError(null);
    try {
      const [defsRes, valsRes] = await Promise.all([
        api.get(`/custom-fields/${module}/defs`),
        api.get(`/custom-fields/${module}/${recordId}/values`),
      ]);

      const activeDefs = defsRes.data.filter(d => d.is_active);
      setDefs(activeDefs);

      // Flatten values array → keyed object
      const flat = {};
      for (const v of valsRes.data) {
        flat[v.field_key] = v.value_json !== null && v.value_json !== undefined
          ? v.value_json
          : v.value_text;
      }
      setValues(flat);

      // Fetch lookup options for any lookup-type fields not yet fetched
      const lookupDefs = activeDefs.filter(d => d.field_type === 'lookup' && d.lookup_config?.module);
      const needed = lookupDefs.filter(d => !fetchedLookups.current.has(d.field_key));
      if (needed.length) {
        const lookupResults = await Promise.all(
          needed.map(async d => {
            try {
              const r = await api.get(`/custom-fields/lookup-options/${d.lookup_config.module}`);
              return { field_key: d.field_key, options: r.data };
            } catch {
              return { field_key: d.field_key, options: [] };
            }
          })
        );
        setLookupOptions(prev => {
          const next = { ...prev };
          for (const { field_key, options } of lookupResults) {
            next[field_key] = options;
            fetchedLookups.current.add(field_key);
          }
          return next;
        });
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [module, recordId]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (vals = values) => {
    if (!module || !recordId) return;
    const payload = Object.entries(vals).map(([field_key, value]) => ({ field_key, value }));
    await api.put(`/custom-fields/${module}/${recordId}/values`, { values: payload });
  }, [module, recordId, values]);

  return {
    defs,
    values,
    setValues,
    lookupOptions,
    loading,
    error,
    save,
    refresh: load,
  };
}
