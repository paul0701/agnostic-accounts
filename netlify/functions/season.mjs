import { setCorsOrigin, preflight, json, season } from "../lib/core.mjs";

// Public: which season scores are in right now. Every game asks this on load so a device
// can clear its own saved score when a new season starts, even if nobody is signed in.
export default async (req) => {
  setCorsOrigin(req);
  if (req.method === "OPTIONS") return preflight();
  return json(200, { season: season() });
};

export const config = { path: "/api/season" };
