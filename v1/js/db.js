// Minimal promise wrapper over IndexedDB. Everything stays on the device.

const DB_NAME = 'kopor';
const VERSION = 1;
export const STORES = ['settings', 'contacts', 'ledger', 'cash', 'products', 'groups', 'contributions', 'invoices'];

let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const out = fn(tx);
    tx.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const db = {
  all: (store) => run(store, 'readonly', (tx) => tx.objectStore(store).getAll()),
  get: (store, id) => run(store, 'readonly', (tx) => tx.objectStore(store).get(id)),
  put: (store, obj) => run(store, 'readwrite', (tx) => { tx.objectStore(store).put(obj); return obj; }),
  del: (store, id) => run(store, 'readwrite', (tx) => { tx.objectStore(store).delete(id); }),
  // Replace the whole database in one transaction (used by restore and reset).
  replaceAll: (data) => run(STORES, 'readwrite', (tx) => {
    for (const s of STORES) {
      const os = tx.objectStore(s);
      os.clear();
      for (const row of data[s] || []) os.put(row);
    }
  }),
};
