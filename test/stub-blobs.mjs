// An in-memory stand-in for @netlify/blobs so the real service code can be tested
// without touching any live data. One shared set of stores per process.
const stores = new Map();
export const reset = () => stores.clear();
export function getStore(opts) {
  const name = typeof opts === "string" ? opts : opts.name;
  if (!stores.has(name)) stores.set(name, new Map());
  const m = stores.get(name);
  return {
    async get(key, o = {}) {
      if (!m.has(key)) return null;
      const v = m.get(key);
      return o.type === "json" ? JSON.parse(v) : v;
    },
    async setJSON(key, value) { m.set(key, JSON.stringify(value)); },
    async set(key, value) { m.set(key, String(value)); },
    async delete(key) { m.delete(key); },
    async list() { return { blobs: [...m.keys()].map((key) => ({ key })) }; },
  };
}
