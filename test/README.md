# Tests

- `npm test` runs the real service handlers against an in-memory store (`test/*.test.mjs`).
  It covers season 1 behaving exactly as before, a new season wiping everything, devices on an
  old season being refused, and switching the season back restoring the old scores.
- `test/dev-server.mjs` serves the same handlers over HTTP for browser tests:
  `SYNC_SECRET=x node --import ./test/register.mjs test/dev-server.mjs 8793`
  (`/__reset` clears data, `/__season/N` switches the season).
- `test/e2e/ninja-dojo-two-devices.cjs` drives two browsers ("phone" and "laptop") through a
  game: sign in on a second device, scores carry over (highest wins), a wipe clears both devices
  and nothing comes back. Needs Playwright, the dev server above (port 8793) and the game served
  locally (port 8792, e.g. `python3 -m http.server 8792` in the game's folder). The game's
  account calls are redirected to the dev server, so no live data is touched.

## Wiping all scores

Set `SCORE_SEASON` to the next number in the Netlify environment and redeploy. Nothing is deleted:
set it back and the old scores return. Every game must already be running the version of
`account.js` that understands seasons, otherwise an old copy can still show its own saved best.
