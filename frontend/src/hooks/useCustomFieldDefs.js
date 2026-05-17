/**
 * useCustomFieldDefs(module)
 *
 * Lightweight variant of useCustomFields — fetches only the field
 * definitions for a module. No record ID required. Use this in
 * CREATE forms where the record doesn't exist yet.
 *
 * Returns:
 *   defs          — array of active field definitions
 *   lookupOptions — { [field_key]: [{ value, label }] }
 *   loading       — boolean
 *   error         — string | null
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';

export default function useCustomFieldDefs(module) {
  const [defs,          setDefs]          = useState([]);
  const [lookupOptions, setLookupOptions] = useState({});
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(null);
  const fetchedLookups = useRef(new Set());

  const load = useCallback(async () => {
    if (!module) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/custom-fields/${module}/defs`);
      const activeDefs = res.data.filter(d => d.is_active);
      setDefs(activeDefs);

      // Fetch lookup options for relation-type fields
      const lookupDefs = activeDefs.filter(
        d => d.field_type === 'lookup' && d.lookup_config?.module
      );
      const needed = lookupDefs.filter(d => !fetchedLookups.current.has(d.field_key));
      if (needed.length) {
        const results = await Promise.all(
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
          for (const { field_key, options } of results) {
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
  }, [module]);

  useEffect(() => { load(); }, [load]);

  return { defs, lookupOptions, loading, error };
}
