import test from "node:test";
import assert from "node:assert/strict";
import { call } from "./app.mjs";
import { reset } from "./stub-blobs.mjs";

const PIN = "123456";
const sync = (token, body) => call("/api/sync", { token, body });
const board = async (game, period = "all") => (await call(`/api/leaderboard?game=${game}&period=${period}`)).body.entries;

test.beforeEach(() => { reset(); delete process.env.SCORE_SEASON; });

test("season 1 is today's behaviour: scores sync, the highest wins, the board shows it", async () => {
  const reg = await call("/api/auth/register", { body: { username: "Ninja One", pin: PIN } });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.season, 1);
  const t = reg.body.token;
  // a legacy client that never sends a season counts as season 1
  let r = await sync(t, { game: "ninja-dojo", best: 139000 });
  assert.equal(r.status, 200); assert.equal(r.body.best, 139000);
  r = await sync(t, { game: "ninja-dojo", best: 109000 });          // a lower score from another device
  assert.equal(r.body.best, 139000);
  const me = await call("/api/me", { token: t });
  assert.equal(me.body.games["ninja-dojo"].best, 139000);
  assert.deepEqual(await board("ninja-dojo"), [{ username: "Ninja One", best: 139000 }]);
});

test("the same account on a second device is given the server's best at sign-in", async () => {
  const reg = await call("/api/auth/register", { body: { username: "phone", pin: PIN } });
  await sync(reg.body.token, { game: "ninja-dojo", best: 139000 });
  const login = await call("/api/auth/login", { body: { username: "phone", pin: PIN } });   // the laptop signs in
  assert.equal(login.status, 200);
  assert.equal(login.body.games["ninja-dojo"].best, 139000);
});

test("/api/season is public and reports the season", async () => {
  assert.deepEqual((await call("/api/season")).body, { season: 1 });
  process.env.SCORE_SEASON = "3";
  assert.deepEqual((await call("/api/season")).body, { season: 3 });
});

test("a new season wipes boards and personal bests, refuses old-season devices, and is reversible", async () => {
  const reg = await call("/api/auth/register", { body: { username: "keeper", pin: PIN } });
  const t = reg.body.token;
  await sync(t, { game: "ninja-dojo", best: 139000, week: "x", week_best: 0 });
  assert.equal((await board("ninja-dojo")).length, 1);

  process.env.SCORE_SEASON = "2";                                    // the wipe
  assert.deepEqual(await board("ninja-dojo"), [], "all-time board is empty");
  assert.deepEqual(await board("ninja-dojo", "week"), [], "weekly board is empty");
  assert.deepEqual((await call("/api/me", { token: t })).body.games, {}, "personal bests read as empty");
  const login = await call("/api/auth/login", { body: { username: "keeper", pin: PIN } });
  assert.equal(login.status, 200, "the account itself survives");
  assert.deepEqual(login.body.games, {});
  assert.equal(login.body.season, 2);

  // a device that has not reset yet cannot push its old score back in
  let r = await sync(t, { game: "ninja-dojo", best: 139000 });                    // legacy client, no season
  assert.equal(r.status, 409); assert.equal(r.body.season, 2);
  r = await sync(t, { game: "ninja-dojo", best: 139000, season: 1 });             // client that knows only season 1
  assert.equal(r.status, 409);
  assert.deepEqual(await board("ninja-dojo"), [], "nothing leaked onto the new board");

  // a device on the new season starts from zero
  r = await sync(t, { game: "ninja-dojo", best: 5000, season: 2 });
  assert.equal(r.status, 200); assert.equal(r.body.best, 5000);
  assert.deepEqual(await board("ninja-dojo"), [{ username: "keeper", best: 5000 }]);

  // nothing was deleted: setting the season back brings the old scores straight back
  delete process.env.SCORE_SEASON;
  assert.equal((await call("/api/me", { token: t })).body.games["ninja-dojo"].best, 139000);
  assert.deepEqual(await board("ninja-dojo"), [{ username: "keeper", best: 139000 }]);
});
