// A local copy of the accounts service for browser tests: the real handlers, in-memory data.
//   node --import ./test/register.mjs test/dev-server.mjs [port]
// GET /__season/N switches the season (the same switch as SCORE_SEASON on Netlify);
// GET /__reset clears all data and goes back to season 1.
import http from "node:http";
import { routes } from "./app.mjs";
import { reset } from "./stub-blobs.mjs";

const port = Number(process.argv[2]) || 8791;
http.createServer(async (inc, out) => {
  const url = new URL(inc.url, "http://localhost");
  if (url.pathname === "/__reset") { reset(); delete process.env.SCORE_SEASON; out.writeHead(200); return out.end("reset"); }
  const m = /^\/__season\/(\d+)$/.exec(url.pathname);
  if (m) { process.env.SCORE_SEASON = m[1]; out.writeHead(200, { "content-type": "text/plain" }); return out.end("season " + m[1]); }
  const handler = routes.get(url.pathname);
  if (!handler) { out.writeHead(404); return out.end("no route"); }
  const chunks = []; for await (const c of inc) chunks.push(c);
  const headers = {}; for (const [k, v] of Object.entries(inc.headers)) if (typeof v === "string") headers[k] = v;
  const req = new Request("http://svc.test" + inc.url, { method: inc.method, headers, body: ["GET", "HEAD"].includes(inc.method) ? undefined : Buffer.concat(chunks) });
  const res = await handler(req, {});
  const h = {}; res.headers.forEach((v, k) => (h[k] = v));
  out.writeHead(res.status, h); out.end(Buffer.from(await res.arrayBuffer()));
}).listen(port, () => console.log("accounts mock on " + port));
