/**
 * ModulesContext
 *
 * Fetches the list of enabled module keys for the current tenant once after login,
 * and provides a hasModule(key) helper used throughout the app to gate nav items,
 * routes, and UI features.
 *
 * Super admins always have all modules enabled.
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api';
import { useAuth } from './AuthContext';

const ModulesContext = createContext({ modules: [], hasModule: () => true, loading: true });

export function ModulesProvider({ children }) {
  const { user } = useAuth();
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchModules = useCallback(() => {
    if (!user) { setModules([]); setLoading(false); return; }

    // Super-admins get everything
    if (user.role === 'super_admin') {
      setModules(['__all__']);
      setLoading(false);
      return;
    }

    setLoading(true);
    api.get('/api/modules/me')
      .then(r => setModules(r.data.modules || []))
      .catch(() => setModules([]))   // fail open — degrade gracefully
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => { fetchModules(); }, [fetchModules]);

  const hasModule = useCallback(
    (key) => modules.includes('__all__') || modules.includes(key),
    [modules]
  );

  return (
    <ModulesContext.Provider value={{ modules, hasModule, loading, refetch: fetchModules }}>
      {children}
    </ModulesContext.Provider>
  );
}

export function useModules() {
  return useContext(ModulesContext);
}
