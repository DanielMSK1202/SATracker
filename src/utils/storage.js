/**
 * Local persistence adapter for Scorebook.
 *
 * SATTracker.jsx talks to a small `storage.get(key)` / `storage.set(key, value)`
 * interface rather than the browser's localStorage API directly. That keeps the
 * component decoupled from *how* data is stored, and mirrors the shape of a
 * key/value store so it's easy to swap the backing implementation later
 * (e.g. IndexedDB, a remote sync service) without touching component code.
 *
 * Every value is namespaced under `scorebook:` so this app never collides
 * with other data living in the same browser's localStorage.
 *
 * Behavior intentionally matches what SATTracker.jsx expects:
 *  - get(key)  resolves to { key, value, shared } when present,
 *              and REJECTS (throws) when the key does not exist yet.
 *  - set(key, value) writes the value and resolves to { key, value, shared },
 *              or resolves to null if the write failed (e.g. storage full/blocked).
 */

const NAMESPACE = 'scorebook';

function namespacedKey(key) {
  return `${NAMESPACE}:${key}`;
}

function hasLocalStorage() {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch (e) {
    return false;
  }
}

export const storage = {
  async get(key) {
    if (!hasLocalStorage()) throw new Error('localStorage is not available in this environment');
    const raw = window.localStorage.getItem(namespacedKey(key));
    if (raw === null) throw new Error(`No stored value for key: ${key}`);
    return { key, value: raw, shared: false };
  },

  async set(key, value) {
    if (!hasLocalStorage()) return null;
    try {
      window.localStorage.setItem(namespacedKey(key), value);
      return { key, value, shared: false };
    } catch (err) {
      console.error('storage.set failed for key:', key, err);
      return null;
    }
  },

  async delete(key) {
    if (!hasLocalStorage()) return null;
    try {
      window.localStorage.removeItem(namespacedKey(key));
      return { key, deleted: true, shared: false };
    } catch (err) {
      console.error('storage.delete failed for key:', key, err);
      return null;
    }
  },

  async list(prefix = '') {
    if (!hasLocalStorage()) return null;
    try {
      const fullPrefix = namespacedKey(prefix);
      const keys = Object.keys(window.localStorage)
        .filter((k) => k.startsWith(fullPrefix))
        .map((k) => k.slice(NAMESPACE.length + 1));
      return { keys, shared: false };
    } catch (err) {
      console.error('storage.list failed', err);
      return null;
    }
  },
};
