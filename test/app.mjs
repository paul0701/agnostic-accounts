// Calls the real Netlify functions the way Netlify routes them, in-process.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = new URL("../netlify/functions/", import.meta.url);
const routes = new Map();
for (const f of readdirSync(fileURLToPath(dir)).filter((n) => n.endsWith(".mjs"))) {
  const mod = await import(new URL(f, dir).href);
  for (const p of [].concat((mod.config && mod.config.path) || [])) routes.set(p, mod.default);
}

export async function call(path, { method, body, token, origin } = {}) {
  const [pathname, qs] = path.split("?");
  const handler = routes.get(pathname);
  if (!handler) return { status: 404, body: { detail: "no route " + pathname } };
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = "Bearer " + token;
  if (origin) headers.origin = origin;
  const req = new Request("http://svc.test" + pathname + (qs ? "?" + qs : ""), {
    method: method || (body ? "POST" : "GET"), headers, body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handler(req, {});
  let json = null; try { json = await res.json(); } catch (e) {}
  return { status: res.status, body: json, headers: res.headers };
}
export { routes };
