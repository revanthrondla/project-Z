/**
 * Offline-first IndexedDB helper for Field Scan.
 *
 * Stores pending scanned products when offline.
 * Clears them after successful sync.
 */

const DB_NAME    = 'agrow_offline';
const DB_VERSION = 1;
const STORE      = 'pending_scans';

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'localId', autoIncrement: true });
        store.createIndex('by_scanned_at', 'scanned_at', { unique: false });
      }
    };
    req.onsuccess  = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror    = ()  => reject(new Error('Failed to open IndexedDB'));
  });
}

export async function addPending(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add({ ...item, _pending: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function getPending() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx   = db.transaction(STORE, 'readonly');
    const req  = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}

export async function clearSynced() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

export async function getPendingCount() {
  const items = await getPending();
  return items.length;
}
