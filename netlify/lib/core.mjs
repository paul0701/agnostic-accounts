import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const TOKEN_DAYS = 180;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
// Superset of every game's own name rule (the widget games enforce the stricter
// letters/numbers/underscore client-side; the custom games also allow spaces and
// hyphens and a 2-char minimum). Kept wide here so no game's valid name is rejected.
export const NAME_RE = /^[A-Za-z0-9 _-]{2,16}$/;
export const PIN_RE = /^\d{6}$/;
export const GAME_RE = /^[a-z0-9-]{1,32}$/;
export { MAX_FAILS, LOCK_MS };

// Strong consistency so a read always reflects the latest write: a player who
// registers and submits a score seconds later must not race ahead of the store
// (eventual consistency, the default, can lag a few seconds and 404 the account).
export const players = () => getStore({ name: "players", consistency: "strong" });
export const boards = () => getStore({ name: "leaderboards", consistency: "strong" });

// --- CORS: games live on their own subdomains and call this central service
// cross-origin. We reflect any agnosticsolutions.co.uk / netlify.app origin (and
// localhost for dev); identity is Bearer-token based, so no cookies are shared.
let _origin = "*";
const ALLOW_ORIGIN = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https:\/\/([a-z0-9-]+\.)*agnosticsolutions\.co\.uk|https:\/\/[a-z0-9-]+\.netlify\.app)$/i;
export function setCorsOrigin(req) {
  try { const o = req.headers.get("origin") || ""; _origin = ALLOW_ORIGIN.test(o) ? o : "*"; } catch (e) { _origin = "*"; }
}
export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": _origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
export const preflight = () => new Response(null, { status: 204, headers: corsHeaders() });

export function json(status, data) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders() } });
}
export const fail = (status, detail) => json(status, { detail });

function secret() {
  const s = process.env.SYNC_SECRET;
  if (!s) throw new Error("SYNC_SECRET env var is not set");
  return s;
}
export const setupError = () => (process.env.SYNC_SECRET ? null
  : fail(500, "Server not set up: add SYNC_SECRET in Netlify environment variables, then redeploy"));
const b64u = (buf) => Buffer.from(buf).toString("base64url");

export function makeToken(key, tv = 0) {
  const payload = b64u(JSON.stringify({ sub: key, tv, exp: Date.now() + TOKEN_DAYS * 864e5 }));
  const sig = b64u(crypto.createHmac("sha256", secret()).update(payload).digest());
  return payload + "." + sig;
}

function readToken(tok) {
  const [payload, sig] = (tok || "").split(".");
  if (!payload || !sig) return null;
  const want = b64u(crypto.createHmac("sha256", secret()).update(payload).digest());
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString());
  return data.exp > Date.now() ? data : null;
}

export function hashPin(pin, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(pin, salt, 32).toString("hex") };
}
export function pinMatches(pin, user) {
  const h = Buffer.from(hashPin(pin, user.salt).hash, "hex");
  return crypto.timingSafeEqual(h, Buffer.from(user.hash, "hex"));
}

export async function currentUser(req) {
  const h = req.headers.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? readToken(h.slice(7)) : null;
  if (!tok) return { error: "Session expired, please sign in again" };
  const user = await players().get(tok.sub, { type: "json" });
  if (!user) return { error: "Account not found" };
  if ((tok.tv || 0) !== (user.tv || 0)) return { error: "Your PIN was changed. Please sign in again" };
  return { key: tok.sub, user };
}

export const userOut = (key, u) => ({ token: makeToken(key, u.tv || 0), username: u.username, games: u.games || {}, email: maskEmail(u.email) });

// ---- optional recovery email ----
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
export const CODE_TTL_MS = 15 * 60 * 1000;   // a reset code works for 15 minutes
export const CODE_GAP_MS = 60 * 1000;        // one email a minute per account
export const CODE_DAY_MAX = 5;               // and five a day
export const CODE_TRIES = 5;                 // five wrong guesses kills the code

// "" means none, null means it does not look like an email, otherwise the cleaned address
export function cleanEmail(raw) {
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  if (e === "") return "";
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

// p***@gmail.com, so the owner can see which address is saved without it being readable over a shoulder
export function maskEmail(e) {
  if (!e) return null;
  const [u, dom] = e.split("@");
  return `${u[0]}${"*".repeat(Math.max(2, Math.min(6, u.length - 1)))}@${dom}`;
}

export const newCode = () => String(crypto.randomInt(100000, 1000000));
export const codeHash = (key, code) => crypto.createHmac("sha256", secret()).update(`reset:${key}:${code}`).digest("hex");
export const sameHex = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Recovery emails go through Resend. Without RESEND_API_KEY and RESEND_FROM set, recovery is simply switched off.
export const mailer = {
  enabled: () => !!(process.env.RESEND_API_KEY && process.env.RESEND_FROM),
  async send(msg) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.RESEND_FROM, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  },
};

// returns an error Response, or null when the PIN is right (always saves fail counters)
export async function checkPin(key, user, pin, wrongMsg) {
  if (user.lockUntil > Date.now()) return fail(429, "Too many tries. Wait 15 minutes and try again");
  const ok = pinMatches(pin, user);
  if (ok) { user.fails = 0; user.lockUntil = 0; }
  else {
    user.fails = (user.fails || 0) + 1;
    if (user.fails >= MAX_FAILS) { user.fails = 0; user.lockUntil = Date.now() + LOCK_MS; }
  }
  await players().setJSON(key, user);
  return ok ? null : fail(401, wrongMsg);
}

export function weekId(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t - y0) / 864e5 + 1) / 7);
  return t.getUTCFullYear() + "-W" + String(wk).padStart(2, "0");
}

export const clamp = (n) => Math.max(0, Math.min(Math.floor(Number(n) || 0), 1e7));

// Optional per-game state blob (achievements, skins, streaks) that richer games
// sync across devices. Treated as opaque data, size-capped, and left unchanged
// when the caller sends nothing (undefined/null) — so leaderboard-only games are
// unaffected. Send {} to clear it.
export function cleanState(incoming, prev) {
  if (incoming === undefined || incoming === null) return prev;
  try {
    const s = JSON.stringify(incoming);
    if (typeof s !== "string" || s.length > 20000) return prev;
    return JSON.parse(s);
  } catch { return prev; }
}

export async function readBody(req) {
  try { return await req.json(); } catch { return {}; }
}
