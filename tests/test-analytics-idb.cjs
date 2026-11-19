// Test for app/analytics-recorder.js (IndexedDB storage). Run: node test-analytics-idb.cjs
// Uses the in-memory IndexedDB shim in fake-idb.cjs (fake-indexeddb is not installed and nothing is installed here).
process.env.TZ = "UTC";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { makeFactory, IDBKeyRange } = require("./fake-idb.cjs");

const SRC = fs.readFileSync(path.join(__dirname, "..", "app", "analytics-recorder.js"), "utf-8");
const REAL_NOW = Date.now.bind(Date);
let fakeNow = null;
Date.now = () => (fakeNow == null ? REAL_NOW() : fakeNow);
const at = (iso) => Date.parse(iso);
const TODAY = at("2026-11-17T12:00:00Z");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Timer resolution makes the shim slow, so wait for a condition instead of a fixed time.
async function until(cond, what, ms = 4000) {
  const t0 = REAL_NOW();
  while (!cond()) { if (REAL_NOW() - t0 > ms) throw new Error("timed out waiting for " + what); await sleep(10); }
  await sleep(30); // let anything that was about to follow finish
}

function makeLocalStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
// A fresh page: loads the recorder script with a fake window. opts.idb: factory or null (IndexedDB missing).
function boot({ idb, ls }) {
  const listeners = {};
  const win = { addEventListener: (n, f) => (listeners[n] = listeners[n] || []).push(f) };
  if (idb) { win.indexedDB = idb; win.IDBKeyRange = IDBKeyRange; }
  const warns = [];
  const fakeConsole = { warn: (...a) => warns.push(a.join(" ")), log() {} };
  const shortTimeout = (fn, ms) => setTimeout(fn, ms >= 1000 ? 5 : ms); // the 1.5 s start-up delay shrinks to 5 ms
  new Function("window", "localStorage", "setTimeout", "console", SRC)(win, ls, shortTimeout, fakeConsole);
  return { api: win.__aimAnalytics, win, warns, fire: (n) => (listeners[n] || []).forEach((f) => f({})) };
}

// ---- building rounds through the recorder's own entry points ----
function play(api, { map, weapon, mode = "score", shots = [], death = null, code = null, when }) {
  fakeNow = when;
  api.start({ id: code || "scene-" + map, map, weapon, mode, dt: 1 / 128, kinds: [[1, "humanoid"]] });
  const events = [], snap = { tick: 100, actors: [{ id: 1, templateId: 1 }, { id: 2, templateId: 1 }, { id: 3, templateId: 1 }], player: { weapon, position: { x: 0, y: 0, z: 0 } } };
  let tick = 10;
  for (const s of shots) {
    if (s.kill) events.push({ kind: "kill", actorId: s.hitActorId });
    events.push({ kind: "shot", tick: tick++, hitActorId: s.hitActorId ?? null, hitPart: s.hitPart, hitPoint: s.hitPoint ?? null, origin: { x: 0, y: 0, z: 0 }, pellets: s.pellets });
  }
  if (death) {
    snap.player.position = death.pos;
    if (death.fell) events.push({ kind: "playerFell", tick: tick++ });
    else { events.push({ kind: "enemyShot", damage: 5, healthAfter: 0, actorId: 3, distance: 12 }); events.push({ kind: "playerDead", tick: tick++ }); }
  }
  api.feed(snap, events);
  api.end("died");
}
const roundA = (when) => ({ map: "bind", weapon: "vandal", when, shots: [
  { hitActorId: 1, hitPart: "head", hitPoint: { x: 1, y: 2, z: 3 }, kill: true },
  { hitActorId: 2, hitPart: "body", hitPoint: { x: 2, y: 2, z: 3 } },
  { hitActorId: null, hitPoint: { x: 9, y: 1, z: 9 } },
], death: { pos: { x: 10.5, y: 0, z: -3.2 } } });
const roundB = (when) => ({ map: "ascent", weapon: "judge", when, shots: [
  { hitActorId: 1, hitPart: "body", hitPoint: { x: 1, y: 1, z: 1 }, pellets: [{ hitActorId: 1, hitPart: "head" }, { hitActorId: 1, hitPart: "body" }, { hitActorId: null }] },
  { hitActorId: null },
], death: { fell: true, pos: { x: 10.9, y: 0, z: -3.5 } } });

const legacyRound = (iso, map = "bind", extra = {}) => ({
  v: 1, at: at(iso), code: "c1", map, mode: "score", wpn: "vandal", dt: 1 / 128, end: "died", W: ["vandal"], T: [1], K: {},
  s: [[10, 0, "head", 1, 2, 3, 10, 0, 1], [12, 0, "body", 1, 2, 3, 10, 0, 0], [14, 0, null, null, null, null, null, -1, 0]],
  d: [[20, 5.5, 0, 6.5, -1, -1, null, "fell"]], ...extra,
});

const pad2 = (n) => String(n).padStart(2, "0");
const results = [];
async function test(name, fn) {
  try { await fn(); results.push([name, true]); console.log("ok   " + name); }
  catch (e) { results.push([name, false]); console.log("FAIL " + name + "\n     " + (e && e.stack || e)); }
}

(async () => {
  await test("rounds are stored and read back (async), with filters", async () => {
    const idb = makeFactory(), ls = makeLocalStorage();
    const { api } = boot({ idb, ls });
    play(api, roundA(TODAY)); play(api, roundB(TODAY + 1000));
    assert.strictEqual(idb.control.stats.puts, 0, "end() must not touch IndexedDB synchronously");
    const all = await api.rounds();
    assert.ok(all.length === 2 && all instanceof Array);
    assert.deepStrictEqual(all.map((r) => r.map), ["bind", "ascent"]);
    assert.strictEqual(all[0].shots.length, 3);
    assert.strictEqual(all[0].shots[0].killed, true);
    assert.strictEqual(all[0].shots[0].part, "head");
    assert.deepStrictEqual(all[0].deaths[0].position, { x: 10.5, y: 0, z: -3.2 });
    assert.deepStrictEqual(all[1].shots[0].pellets, { fired: 3, hit: 2, head: 1 });
    assert.strictEqual(all[1].deaths[0].cause, "fell");
    assert.strictEqual((await api.rounds({ map: "bind" })).length, 1);
    assert.strictEqual((await api.rounds({ weapon: "judge" })).length, 1);
    assert.strictEqual((await api.rounds({ weapon: "nothing" })).length, 0);
    assert.strictEqual((await api.rounds({ code: "scene-ascent" })).length, 1);
    const last = await api.rounds({ limit: 1 });
    assert.strictEqual(last.length, 1); assert.strictEqual(last[0].map, "ascent");
    assert.strictEqual(idb.peek("aim-analytics", "rounds").length, 2);
    assert.strictEqual(ls.getItem("aim-analytics-rounds-v1"), null, "nothing goes to localStorage");
    assert.strictEqual(typeof api.raw().then, "function");
    assert.strictEqual((await api.raw()).length, 2);
  });

  await test("day rows have correct counts, breakdowns and death grid", async () => {
    const idb = makeFactory(), ls = makeLocalStorage();
    const { api } = boot({ idb, ls });
    play(api, roundA(TODAY)); play(api, roundB(TODAY + 1000));
    const rows = await api.days();
    assert.strictEqual(rows.length, 1);
    const d = rows[0];
    assert.strictEqual(d.day, "2026-11-17");
    assert.deepStrictEqual([d.rounds, d.shots, d.hits, d.headshots, d.kills, d.deaths, d.falls], [2, 5, 3, 2, 1, 2, 1]);
    assert.deepStrictEqual(d.maps.bind, { rounds: 1, shots: 3, hits: 2, headshots: 1, kills: 1, deaths: 1 });
    assert.deepStrictEqual(d.maps.ascent, { rounds: 1, shots: 2, hits: 1, headshots: 1, kills: 0, deaths: 1 });
    assert.deepStrictEqual(d.weapons.vandal, { shots: 3, hits: 2, headshots: 1, kills: 1 });
    assert.deepStrictEqual(d.weapons.judge, { shots: 2, hits: 1, headshots: 1, kills: 0 });
    assert.deepStrictEqual(d.modes.score, { rounds: 2, shots: 5, hits: 3, headshots: 2, kills: 1, deaths: 2 });
    assert.deepStrictEqual(d.grid, { bind: { "10,-4": 1 }, ascent: { "10,-4": 1 } });
    // filters
    assert.strictEqual((await api.days({ from: "2026-11-18" })).length, 0);
    assert.strictEqual((await api.days({ from: "2026-11-17", to: "2026-11-17" })).length, 1);
    assert.strictEqual((await api.days({ to: "2026-11-16" })).length, 0);
    const byMap = await api.days({ map: "bind" });
    assert.deepStrictEqual(Object.keys(byMap[0].maps), ["bind"]); assert.deepStrictEqual(Object.keys(byMap[0].grid), ["bind"]);
    assert.strictEqual((await api.days({ map: "nowhere" })).length, 0);
    const byWpn = await api.days({ weapon: "judge" });
    assert.deepStrictEqual(Object.keys(byWpn[0].weapons), ["judge"]);
    // a third round the same day rebuilds the row from raw (not double counting)
    play(api, roundA(TODAY + 2000));
    const again = (await api.days())[0];
    assert.deepStrictEqual([again.rounds, again.shots, again.deaths], [3, 8, 3]);
  });

  await test("raw rounds older than 30 days are removed, their day rows stay; roll-up is idempotent", async () => {
    const idb = makeFactory(), ls = makeLocalStorage();
    const { api } = boot({ idb, ls });
    // recorded "back then", so each day is a recent day when it is written
    play(api, roundA(at("2026-09-01T10:00:00Z")));
    play(api, roundB(at("2026-09-01T11:00:00Z")));
    await api.rounds(); // flush
    play(api, roundA(at("2026-10-17T10:00:00Z"))); // 31 days before 2026-11-17: goes
    await api.rounds();
    play(api, roundA(at("2026-10-18T10:00:00Z"))); // 30 days before: stays
    await api.rounds();
    assert.deepStrictEqual(idb.peek("aim-analytics", "rounds").map((r) => r.day).sort(), ["2026-10-17", "2026-10-18"], "09-01 is 47 days old by now: rolled up already");
    assert.strictEqual((await api.days({ to: "2026-09-30" })).length, 1);
    const before = JSON.stringify((await api.days()).filter((r) => r.day < "2026-10-18"));
    // now it is 2026-11-17: the next write rolls up
    play(api, roundB(TODAY));
    await api.rounds();
    const raw = idb.peek("aim-analytics", "rounds").map((r) => r.day).sort();
    assert.deepStrictEqual(raw, ["2026-10-18", "2026-11-17"]);
    const rows = await api.days();
    assert.deepStrictEqual(rows.map((r) => r.day), ["2026-09-01", "2026-10-17", "2026-10-18", "2026-11-17"]);
    assert.strictEqual(JSON.stringify(rows.filter((r) => r.day < "2026-10-18")), before, "old day rows unchanged");
    const sep = rows[0];
    assert.deepStrictEqual([sep.rounds, sep.shots, sep.deaths], [2, 5, 2]);
    assert.strictEqual((await api.rounds()).length, 2);
    // roll up again: nothing changes, nothing deleted, rows untouched
    const deletes = idb.control.stats.deletes;
    play(api, roundA(TODAY + 5000));
    await api.rounds();
    assert.strictEqual(idb.control.stats.deletes, deletes, "no further deletes");
    assert.strictEqual(JSON.stringify((await api.days()).filter((r) => r.day < "2026-10-18")), before);
    // a stale duplicate of an already-rolled-up old round (e.g. a left-over safety copy, the same round id) is not counted twice and must not shrink the row
    const dup = legacyRound("2026-09-01T10:00:00Z", "bind", { code: "scene-bind" }); // same id as roundA played at that time: already counted
    ls.setItem("aim-analytics-rounds-v1", JSON.stringify([dup]));
    const b2 = boot({ idb, ls });
    await until(() => ls.getItem("aim-analytics-rounds-v1") === null, "migration of the duplicate");
    assert.strictEqual(ls.getItem("aim-analytics-rounds-v1"), null, "migrated, key removed");
    const sep2 = (await b2.api.days({ to: "2026-09-30" }))[0];
    assert.deepStrictEqual([sep2.rounds, sep2.shots], [2, 5], "row of the old day kept as it was");
    assert.strictEqual(idb.peek("aim-analytics", "rounds").filter((r) => r.day === "2026-09-01").length, 0, "duplicate's raw copy deleted again");
    fakeNow = null;
  });

  await test("start-up roll-up cleans old raw rounds even with no new write", async () => {
    const idb = makeFactory(), ls = makeLocalStorage();
    const a = boot({ idb, ls });
    play(a.api, roundA(at("2026-08-01T10:00:00Z")));
    await a.api.rounds();
    assert.strictEqual(idb.peek("aim-analytics", "rounds").length, 1);
    fakeNow = TODAY;
    boot({ idb, ls });
    await until(() => idb.peek("aim-analytics", "rounds").length === 0, "start-up roll-up");
    assert.strictEqual(idb.peek("aim-analytics", "rounds").length, 0);
    assert.strictEqual(idb.peek("aim-analytics", "days").length, 1);
    fakeNow = null;
  });

  await test("migration moves localStorage rounds, rolls them into day rows, removes the key afterwards", async () => {
    fakeNow = TODAY;
    const idb = makeFactory();
    const old = legacyRound("2026-09-01T09:00:00Z"), recent = legacyRound("2026-11-16T09:00:00Z", "ascent"), recent2 = legacyRound("2026-11-16T10:00:00Z");
    const ls = makeLocalStorage({ "aim-analytics-rounds-v1": JSON.stringify([old, recent, recent2]) });
    const { api, warns } = boot({ idb, ls });
    assert.ok(ls.getItem("aim-analytics-rounds-v1"), "key still there before the start-up task has run");
    await until(() => ls.getItem("aim-analytics-rounds-v1") === null, "migration");
    assert.strictEqual(ls.getItem("aim-analytics-rounds-v1"), null, "key removed after success");
    const raw = await api.raw();
    assert.strictEqual(raw.length, 2, "the old day's raw round is rolled up and deleted, the others are kept");
    assert.ok(raw.every((r) => r.id && r.day));
    const rows = await api.days();
    assert.deepStrictEqual(rows.map((r) => [r.day, r.rounds, r.shots, r.hits, r.headshots, r.kills, r.deaths]),
      [["2026-09-01", 1, 3, 2, 1, 1, 1], ["2026-11-16", 2, 6, 4, 2, 2, 2]]);
    assert.deepStrictEqual(rows[1].grid, { ascent: { "5,6": 1 }, bind: { "5,6": 1 } });
    assert.strictEqual(warns.length, 0);
    fakeNow = null;
  });

  await test("migration leaves localStorage untouched when the IndexedDB write fails, and succeeds on the next start", async () => {
    fakeNow = TODAY;
    const idb = makeFactory();
    const payload = JSON.stringify([legacyRound("2026-11-15T09:00:00Z"), legacyRound("2026-11-16T09:00:00Z")]);
    const ls = makeLocalStorage({ "aim-analytics-rounds-v1": payload });
    idb.control.failPuts = true;
    const first = boot({ idb, ls });
    await until(() => first.warns.length > 0, "the failed migration");
    assert.strictEqual(ls.getItem("aim-analytics-rounds-v1"), payload, "key kept after the failed write");
    assert.strictEqual(idb.peek("aim-analytics", "rounds").length, 0, "the failed transaction rolled back");
    assert.strictEqual(first.warns.length, 1, "logged once");
    idb.control.failPuts = false;
    const second = boot({ idb, ls });
    await until(() => ls.getItem("aim-analytics-rounds-v1") === null, "second migration");
    assert.strictEqual(ls.getItem("aim-analytics-rounds-v1"), null);
    assert.strictEqual((await second.api.rounds()).length, 2);
    assert.strictEqual((await second.api.days()).length, 2);
    fakeNow = null;
  });

  await test("migration is left alone when IndexedDB cannot be opened", async () => {
    const idb = makeFactory();
    idb.control.failOpen = true;
    const payload = JSON.stringify([legacyRound("2026-11-15T09:00:00Z")]);
    const ls = makeLocalStorage({ "aim-analytics-rounds-v1": payload });
    const { api, warns } = boot({ idb, ls });
    await until(() => warns.length > 0, "the failed open");
    assert.strictEqual(ls.getItem("aim-analytics-rounds-v1"), payload);
    assert.strictEqual(warns.length, 1);
    assert.strictEqual((await api.rounds()).length, 1, "still readable from localStorage");
  });

  await test("game keeps working with IndexedDB missing (log once, skip, localStorage untouched)", async () => {
    const payload = JSON.stringify([legacyRound("2026-11-15T09:00:00Z")]);
    const ls = makeLocalStorage({ "aim-analytics-rounds-v1": payload });
    const { api, warns, fire } = boot({ idb: null, ls });
    fakeNow = TODAY;
    play(api, roundA(TODAY)); play(api, roundB(TODAY + 1000)); play(api, roundA(TODAY + 2000));
    api.start({ map: "x" });
    fire("pagehide");
    await sleep(50);
    assert.strictEqual(warns.length, 1, "warned exactly once: " + JSON.stringify(warns));
    assert.strictEqual(ls.getItem("aim-analytics-rounds-v1"), payload, "localStorage untouched");
    assert.deepStrictEqual(await api.days(), []);
    assert.strictEqual((await api.rounds()).length, 1);
    await api.clear();
    assert.strictEqual(api.current(), null);
    fakeNow = null;
  });

  await test("a failing IndexedDB never throws into the game and keeps the rounds for the next flush", async () => {
    fakeNow = TODAY;
    const idb = makeFactory(), ls = makeLocalStorage();
    const { api, warns } = boot({ idb, ls });
    idb.control.failPuts = true;
    play(api, roundA(TODAY));
    await api.rounds();
    assert.strictEqual(idb.peek("aim-analytics", "rounds").length, 0);
    idb.control.failPuts = false;
    play(api, roundB(TODAY + 1000));
    assert.strictEqual((await api.rounds()).length, 2, "the first round was kept and written with the next flush");
    assert.strictEqual(warns.length, 1);
    fakeNow = null;
  });

  await test("pagehide: a round in progress is flushed, and a safety copy in localStorage is migrated once (no duplicate)", async () => {
    fakeNow = TODAY;
    const idb = makeFactory(), ls = makeLocalStorage();
    const a = boot({ idb, ls });
    a.api.start({ map: "bind", weapon: "vandal", mode: "score", dt: 1 / 128 });
    a.api.feed({ tick: 1, actors: [], player: { weapon: "vandal", position: { x: 1, y: 1, z: 1 } } },
      [{ kind: "shot", tick: 1, hitActorId: null, hitPoint: { x: 1, y: 1, z: 1 }, origin: { x: 0, y: 0, z: 0 } }]);
    a.fire("pagehide");
    assert.strictEqual(JSON.parse(ls.getItem("aim-analytics-rounds-v1")).length, 1, "safety copy written synchronously");
    await until(() => idb.peek("aim-analytics", "rounds").length === 1, "the pagehide write");
    assert.strictEqual(idb.peek("aim-analytics", "rounds").length, 1, "the IndexedDB write also went through");
    boot({ idb, ls }); // next start
    await until(() => ls.getItem("aim-analytics-rounds-v1") === null, "migration of the safety copy");
    assert.strictEqual(ls.getItem("aim-analytics-rounds-v1"), null);
    assert.strictEqual(idb.peek("aim-analytics", "rounds").length, 1, "same id: stored once");
    assert.strictEqual(idb.peek("aim-analytics", "days")[0].rounds, 1);
    fakeNow = null;
  });

  await test("clear() empties rounds, days and the old key", async () => {
    const idb = makeFactory(), ls = makeLocalStorage();
    const { api } = boot({ idb, ls });
    play(api, roundA(TODAY));
    await api.rounds();
    ls.setItem("aim-analytics-rounds-v1", "[]");
    await api.clear();
    assert.strictEqual(idb.peek("aim-analytics", "rounds").length, 0);
    assert.strictEqual(idb.peek("aim-analytics", "days").length, 0);
    assert.strictEqual(ls.getItem("aim-analytics-rounds-v1"), null);
    assert.deepStrictEqual(await api.days(), []);
    fakeNow = null;
  });

  await test("a day row stays small: death grid is capped (well under 50 KB)", async () => {
    const idb = makeFactory(), ls = makeLocalStorage();
    const { api } = boot({ idb, ls });
    for (let m = 0; m < 12; m++) {
      for (let r = 0; r < (m === 0 ? 4 : 2); r++) {
        fakeNow = TODAY + m * 100000 + r * 1000;
        api.start({ map: "map" + m, weapon: "vandal", mode: "score", dt: 1 / 128 });
        const events = [];
        for (let k = 0; k < 100; k++) events.push({ kind: "playerFell", tick: k });
        // the recorder reads one position per feed, so feed once per death with a distinct cell
        for (let k = 0; k < 100; k++) api.feed({ tick: k, actors: [], player: { weapon: "vandal", position: { x: k + r * 100, y: 0, z: m * 7 + (k % 5) } } }, [{ kind: "playerFell", tick: k }]);
        api.end("died");
        await api.rounds(); // flush each round, as real play does
      }
    }
    const row = (await api.days())[0];
    const cells = Object.values(row.grid).reduce((n, g) => n + Object.keys(g).length, 0);
    assert.ok(cells <= 1500, "cells " + cells);
    assert.ok(Object.values(row.grid).every((g) => Object.keys(g).length <= 300));
    assert.strictEqual(Object.keys(row.grid.map0).length, 300, "per-map cap reached");
    assert.strictEqual(cells, 1500, "per-day cap reached");
    const size = JSON.stringify(row).length;
    assert.ok(size < 50000, "row size " + size);
    assert.strictEqual(row.deaths, (4 + 11 * 2) * 100);
    console.log("     (day row with 12 maps, 2600 deaths: " + size + " bytes, " + cells + " grid cells)");
    fakeNow = null;
  });

  await test("an old day's row is never reduced when more raw rounds for it show up later (late migration)", async () => {
    fakeNow = TODAY;
    const idb = makeFactory(), ls = makeLocalStorage();
    const a = boot({ idb, ls });
    // two rounds on 2026-09-01 are rolled up and their raw copies deleted
    ls.setItem("aim-analytics-rounds-v1", JSON.stringify([legacyRound("2026-09-01T09:00:00Z"), legacyRound("2026-09-01T10:00:00Z", "ascent")]));
    await until(() => ls.getItem("aim-analytics-rounds-v1") === null, "first migration");
    const before = (await a.api.days({ to: "2026-09-30" }))[0];
    assert.deepStrictEqual([before.rounds, before.shots, before.deaths], [2, 6, 2]);
    assert.strictEqual(idb.peek("aim-analytics", "rounds").length, 0);
    // three newer-id rounds with no shots arrive for the same day: the row must not lose the earlier counts
    const bare = (h) => legacyRound("2026-09-01T" + h + ":00:00Z", "bind", { s: [], d: [] });
    ls.setItem("aim-analytics-rounds-v1", JSON.stringify([bare("11"), bare("12"), bare("13")]));
    boot({ idb, ls });
    await until(() => ls.getItem("aim-analytics-rounds-v1") === null, "late migration");
    const after = (await a.api.days({ to: "2026-09-30" }))[0];
    assert.ok(after.rounds >= 3 && after.shots >= before.shots && after.deaths >= before.deaths && after.hits >= before.hits && after.kills >= before.kills, JSON.stringify(after));
    assert.deepStrictEqual(after.maps.ascent, before.maps.ascent, "per-map counts kept");
    assert.deepStrictEqual(after.weapons.vandal, before.weapons.vandal, "per-weapon counts kept");
    assert.deepStrictEqual(after.grid, before.grid, "death grid kept");
    assert.strictEqual(idb.peek("aim-analytics", "rounds").length, 0, "raw rounds deleted only after the row was stored");
    fakeNow = null;
  });

  await test("IndexedDB cannot be opened: queued rounds stay queued and pagehide copies them to localStorage", async () => {
    fakeNow = TODAY;
    const idb = makeFactory(), ls = makeLocalStorage();
    idb.control.failOpen = true;
    const { api, warns, fire } = boot({ idb, ls });
    play(api, roundA(TODAY));
    await until(() => warns.length > 0, "the failed open");
    fire("pagehide");
    const saved = JSON.parse(ls.getItem("aim-analytics-rounds-v1") || "[]");
    assert.strictEqual(saved.length, 1, "the queued round was not dropped");
    assert.strictEqual(saved[0].map, "bind");
    assert.strictEqual(warns.length, 1);
    fakeNow = null;
  });

  await test("migration keeps a pagehide copy written while it was running; clear() drops a batch being written", async () => {
    fakeNow = TODAY;
    const idb = makeFactory();
    const mine = legacyRound("2026-11-15T09:00:00Z"), late = legacyRound("2026-11-16T09:00:00Z", "ascent");
    const ls = makeLocalStorage({ "aim-analytics-rounds-v1": JSON.stringify([mine]) });
    boot({ idb, ls });
    await until(() => idb.control.stats.puts > 0, "the migration write");
    ls.setItem("aim-analytics-rounds-v1", JSON.stringify([mine, late])); // what a pagehide safety copy does mid-migration
    await until(() => JSON.parse(ls.getItem("aim-analytics-rounds-v1") || "[]").length <= 1, "the migration to finish");
    const left = JSON.parse(ls.getItem("aim-analytics-rounds-v1") || "[]");
    assert.strictEqual(left.length, 1, "only the migrated round was removed");
    assert.strictEqual(left[0].map, "ascent");
    // clear() while a failing batch is in flight: the batch must not come back afterwards
    const idb2 = makeFactory(), ls2 = makeLocalStorage();
    const b = boot({ idb: idb2, ls: ls2 });
    idb2.control.failPuts = true;
    play(b.api, roundA(TODAY));
    const txs = idb2.control.stats.txs;
    await until(() => idb2.control.stats.txs > txs, "the batch write to start");
    const cleared = b.api.clear();
    idb2.control.failPuts = false;
    await cleared;
    assert.strictEqual((await b.api.rounds()).length, 0, "the cleared batch did not reappear");
    assert.strictEqual(idb2.peek("aim-analytics", "rounds").length, 0);
    fakeNow = null;
  });

  // ================= phase 2: engagements and near misses, with synthetic per-tick snapshots =================
  // Geometry used below: the player stands at the origin, eye 1.75 m, yaw 0 / pitch 0 looks along -z, forward = (-sin yaw, 0, -cos yaw).
  // A humanoid enemy is an upright box on its position (feet): half width 0.3, height 1.8 (centre 0.9), head at 1.68.
  const DEGS = 180 / Math.PI, RAD = Math.PI / 180;
  const enemy = (id, x, z, extra = {}) => ({ id, templateId: 1, bornTick: 0, position: { x, y: 0, z }, scale: 1, alive: true, visible: true, ...extra });
  const tickSnap = (tick, { yaw = 0, pitch = 0, pos = { x: 0, y: 0, z: 0 }, weapon = "vandal", actors = [], crouch = 0 } = {}) =>
    ({ tick, player: { position: { ...pos }, yaw, pitch, crouchAmount: crouch, weapon, knife: 0 }, actors });
  const miss = (tick, origin, direction, hitPoint = null, extra = {}) => ({ kind: "shot", tick, hitActorId: null, hitPart: null, hitPoint, origin, direction, ...extra });
  function begin(api, when, map = "bind", weapon = "vandal") {
    fakeNow = when;
    api.start({ id: "scene-p2", map, weapon, mode: "score", dt: 1 / 128, kinds: [[1, "humanoid", null, 1]] });
  }
  // plays a list of [snap, events] and closes the round; returns the stored, expanded round
  async function roundOf(api, list, reason = "cleared") {
    for (const [snap, events] of list) api.feed(snap, events);
    api.end(reason);
    const all = await api.rounds();
    return all[all.length - 1];
  }
  const near = (x, y, z) => ({ x, y, z });
  const ahead = { x: 0, y: 0, z: -1 };
  const closeTo = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, what + ": " + a + " vs " + b);

  await test("classification thresholds: flick (far aim, little movement), strafe (far movement, little aim), mixed", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    const th = api.thresholds;
    assert.deepStrictEqual([th.FLICK_MIN_AIM_DEG, th.FLICK_MAX_MOVE_M, th.STRAFE_MIN_MOVE_M, th.STRAFE_MAX_AIM_DEG], [20, 0.5, 1, 20]);
    assert.strictEqual(api.classify(20, 0.5), "flick");
    assert.strictEqual(api.classify(90, 0), "flick");
    assert.strictEqual(api.classify(19.9, 0.5), "mixed", "aim travel just under the flick threshold");
    assert.strictEqual(api.classify(20, 0.51), "mixed", "moved just over the flick limit");
    assert.strictEqual(api.classify(19.9, 1), "strafe");
    assert.strictEqual(api.classify(0, 4), "strafe");
    assert.strictEqual(api.classify(20, 1), "mixed", "aim travel at the strafe limit is not small");
    assert.strictEqual(api.classify(5, 0.7), "mixed", "neither far aim nor far movement");
  });

  await test("a flick kill: aim sweeps to an enemy 26.6 degrees away while the player stands still", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY);
    const target = Math.atan2(5, 10); // enemy at x=-5, z=-10: forward x = -sin(yaw), so the yaw to it is +26.57 degrees
    const list = [];
    for (let k = 0; k <= 10; k++) {
      const actors = [enemy(7, -5, -10)];
      const events = k === 10 ? [miss(10, near(0, 1.75, 0), ahead), { kind: "kill", tick: 10, actorId: 7 }] : [];
      if (k === 10) actors[0].alive = false;
      list.push([tickSnap(k, { yaw: target * k / 10, actors }), events]);
    }
    const r = await roundOf(api, list);
    assert.strictEqual(r.engagements.length, 1);
    const e = r.engagements[0];
    assert.strictEqual(e.enemyId, 7); assert.strictEqual(e.template, 1);
    assert.strictEqual(e.startTick, 0); assert.strictEqual(e.killTick, 10); assert.strictEqual(e.killed, true);
    closeTo(e.timeToKill, 0.08, 0.005, "time to kill (10 ticks of 1/128 s)");
    closeTo(e.aimTravel, target * DEGS, 0.05, "aim travel");
    assert.strictEqual(e.moveDistance, 0);
    closeTo(e.aimError.degrees, 26.57, 0.05, "aim error when it appeared (yaw 0 against a head 26.57 degrees away)");
    closeTo(e.aimError.yaw, 26.57, 0.05, "yaw part"); closeTo(e.aimError.pitch, -0.36, 0.05, "pitch part: head 1.68 m against eye 1.75 m, 11.2 m away");
    assert.strictEqual(e.kind, "flick"); assert.strictEqual(e.weapon, "vandal");
  });

  await test("a strafe kill: the player moves 2.4 m, the aim only follows (11 degrees)", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY);
    const list = [];
    for (let k = 0; k <= 20; k++) {
      const px = 0.12 * k, yaw = Math.atan2(px, 12); // enemy straight ahead at z=-12; keeping it on the crosshair needs yaw = atan(px / 12)
      const dead = k === 20;
      list.push([tickSnap(k, { yaw, pos: { x: px, y: 0, z: 0 }, actors: [enemy(3, 0, -12, dead ? { alive: false } : {})] }), dead ? [{ kind: "kill", tick: 20, actorId: 3 }, miss(20, near(px, 1.75, 0), ahead)] : []]);
    }
    const r = await roundOf(api, list);
    const e = r.engagements[0];
    closeTo(e.moveDistance, 2.4, 0.02, "movement"); closeTo(e.aimTravel, Math.atan2(2.4, 12) * DEGS, 0.1, "aim travel");
    assert.strictEqual(e.kind, "strafe");
    assert.ok(e.aimError.degrees < 0.5, "enemy was on the crosshair when it appeared");
  });

  await test("engagement starts: in view cone or firing; ends: kill, leaving, new life, round end; no kind unless killed", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY);
    const A = (extra = {}) => enemy(1, 0, -10, extra);              // ahead: in view from tick 0, gone (not alive) at tick 5 without a kill
    const B = (extra = {}) => enemy(2, 60, -5, extra);              // 85 degrees to the side: out of the cone until it fires
    const C = (extra = {}) => enemy(3, 0, -10, { bornTick: 40, ...extra }); // appears ahead at tick 7 and is still alive when the round ends
    const list = [
      [tickSnap(0, { actors: [A(), B()] }), []],
      [tickSnap(1, { actors: [A(), B()] }), []],
      [tickSnap(2, { actors: [A(), B()] }), [{ kind: "enemyShot", tick: 2, actorId: 2, hit: false, damage: 0, distance: 60 }]], // ... until it fires
      [tickSnap(5, { actors: [A({ alive: false }), B()] }), [miss(5, near(0, 1.75, 0), ahead)]],
      [tickSnap(6, { actors: [A({ alive: false }), B({ bornTick: 6 })] }), []],   // enemy 2 respawned: a new life, out of the cone and not firing: no engagement
      [tickSnap(7, { actors: [C()] }), []],
    ];
    const r = await roundOf(api, list, "time");
    const byId = (id) => r.engagements.filter((e) => e.enemyId === id);
    assert.strictEqual(byId(1).length, 1);
    assert.deepStrictEqual([byId(1)[0].startTick, byId(1)[0].killed, byId(1)[0].kind, byId(1)[0].timeToKill, byId(1)[0].killTick], [0, false, null, null, null], "left without a kill");
    assert.strictEqual(byId(2).length, 1, "out of the cone until it fired; the respawned life (out of the cone, not firing) did not start");
    assert.strictEqual(byId(2)[0].startTick, 2, "started by its own shot");
    assert.strictEqual(byId(2)[0].killed, false);
    assert.strictEqual(byId(3).length, 1); assert.strictEqual(byId(3)[0].startTick, 7); assert.strictEqual(byId(3)[0].killed, false, "closed at the round's end");
  });

  await test("near miss: the vertical offset is positive above the enemy's centre and negative below (box: centre 0.9 m, top 1.8, bottom 0)", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY);
    const actors = [enemy(1, 0, -10)];
    const list = [
      [tickSnap(1, { actors }), [miss(1, near(0, 2.3, 0), ahead)]],      // 0.5 m above the top
      [tickSnap(2, { actors }), [miss(2, near(0, -0.4, 0), ahead)]],     // 0.4 m below the bottom
      [tickSnap(3, { actors }), [miss(3, near(0.5, 0.9, 0), ahead)]],    // 0.2 m outside the side, at centre height
      [tickSnap(4, { actors }), [miss(4, near(0, 1.0, 0), ahead)]],      // straight through the box (the game's hitbox is tighter): distance 0
    ];
    const r = await roundOf(api, list);
    assert.strictEqual(r.nearMisses.length, 4);
    const [above, below, side, through] = r.nearMisses;
    closeTo(above.missDistance, 0.5, 0.005, "above distance"); closeTo(above.verticalOffset, 1.4, 0.01, "above offset"); assert.strictEqual(above.side, "above");
    closeTo(below.missDistance, 0.4, 0.005, "below distance"); closeTo(below.verticalOffset, -1.3, 0.01, "below offset"); assert.strictEqual(below.side, "below");
    closeTo(side.missDistance, 0.2, 0.005, "side distance"); closeTo(side.verticalOffset, 0, 0.01, "side offset"); assert.strictEqual(side.side, "level");
    assert.strictEqual(through.missDistance, 0); closeTo(through.verticalOffset, 0.1, 0.01, "through offset (height of the line at the box centre minus the centre)");
    assert.deepStrictEqual(r.nearMisses.map((n) => [n.shotTick, n.enemyId, n.template, n.weapon, n.shotIndex]), [[1, 1, 1, "vandal", 0], [2, 1, 1, "vandal", 1], [3, 1, 1, "vandal", 2], [4, 1, 1, "vandal", 3]]);
  });

  await test("near miss margin: kept within 0.6 m of the box, dropped beyond; wall, dead enemies, hits and shotguns are skipped", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    assert.strictEqual(api.thresholds.NEAR_MARGIN_M, 0.6);
    begin(api, TODAY);
    const actors = [enemy(1, 0, -10)];
    const list = [
      [tickSnap(1, { actors }), [miss(1, near(0.85, 1.75, 0), ahead)]],          // 0.55 m beyond the right edge: kept
      [tickSnap(2, { actors }), [miss(2, near(0.95, 1.75, 0), ahead)]],          // 0.65 m: dropped
      [tickSnap(3, { actors }), [miss(3, near(0, 2.5, 0), ahead)]],              // 0.7 m above the top: dropped
      [tickSnap(4, { actors: [enemy(1, 0, -10, { alive: false })] }), [miss(4, near(0.5, 0.9, 0), ahead)]],   // dead enemy: skipped
      [tickSnap(5, { actors }), [miss(5, near(0.5, 0.9, 0), ahead, near(0.5, 0.9, -5))]],                    // wall at z=-5 in front of the enemy (it is 4.7 m behind the wall): skipped
      [tickSnap(6, { actors: [enemy(1, 0, -4)] }), [miss(6, near(0.5, 0.9, 0), ahead, near(0.5, 0.9, -5))]], // enemy in front of the wall: kept
      [tickSnap(7, { actors }), [{ kind: "shot", tick: 7, hitActorId: 1, hitPart: "body", hitPoint: near(0, 1, -9.7), origin: near(0.5, 0.9, 0), direction: ahead }]], // a hit: no near miss
      [tickSnap(8, { actors }), [miss(8, near(0.5, 0.9, 0), ahead, null, { pellets: [{ hitActorId: null }, { hitActorId: null }] })]],       // shotgun: skipped
      [tickSnap(9, { actors }), [{ kind: "shot", tick: 9, hitActorId: null, hitPoint: null, origin: near(0.5, 0.9, 0) }]],                    // no direction: skipped
    ];
    const r = await roundOf(api, list);
    assert.deepStrictEqual(r.nearMisses.map((n) => n.shotTick), [1, 6]);
    closeTo(r.nearMisses[0].missDistance, 0.55, 0.005, "kept at 0.55");
    closeTo(r.nearMisses[1].missDistance, 0.2, 0.005, "in front of the wall");
    assert.strictEqual(r.shots.length, 9, "every shot is still recorded");
  });

  await test("near misses are limited to the 2 closest enemies per shot", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    assert.strictEqual(api.thresholds.NEAR_PER_SHOT, 2);
    begin(api, TODAY);
    const actors = [enemy(1, 0, -10), enemy(2, -0.1, -14), enemy(3, -0.3, -18)]; // a shot at x=0.4 passes 0.1, 0.2 and 0.4 m from their sides
    const r = await roundOf(api, [[tickSnap(1, { actors }), [miss(1, near(0.4, 0.9, 0), ahead)]]]);
    assert.deepStrictEqual(r.nearMisses.map((n) => n.enemyId), [1, 2]);
    closeTo(r.nearMisses[0].missDistance, 0.1, 0.005, "closest"); closeTo(r.nearMisses[1].missDistance, 0.2, 0.005, "second");
  });

  await test("the eliminating enemy's near misses are kept on the death row", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY);
    const actors = [enemy(1, 0, -10), enemy(2, 3, -10)];
    const list = [
      [tickSnap(1, { actors }), [miss(1, near(0, 2.3, 0), ahead)]],                 // near miss of enemy 1 only (enemy 2 is 2.7 m to the side)
      [tickSnap(2, { actors }), [miss(2, near(2.5, 1.75, 0), ahead)]],              // 0.2 m outside enemy 2's side, head height (above its centre by 0.85)
      [tickSnap(3, { actors }), [miss(3, near(0, -0.4, 0), ahead)]],                // enemy 1 again
      [tickSnap(4, { actors }), [{ kind: "enemyShot", tick: 4, actorId: 2, hit: true, zone: "body", damage: 100, distance: 10, healthAfter: 0 }, { kind: "playerDead", tick: 4 }]],
    ];
    const r = await roundOf(api, list, "died");
    assert.strictEqual(r.deaths.length, 1);
    assert.strictEqual(r.deaths[0].killerId, 2);
    assert.strictEqual(r.deaths[0].nearMisses.length, 1, "only the near miss of the killer");
    const n = r.deaths[0].nearMisses[0];
    assert.strictEqual(n.tick, 2); closeTo(n.missDistance, 0.2, 0.005, "distance"); closeTo(n.verticalOffset, 0.85, 0.01, "offset");
    assert.strictEqual(r.nearMisses.length, 3, "enemy 1 twice, enemy 2 once");
  });

  await test("day rollup: near misses, over-aim / under-aim, flicks and strafes per day, map and weapon (sparse; old rows untouched)", async () => {
    const idb = makeFactory(), ls = makeLocalStorage();
    const { api } = boot({ idb, ls });
    fakeNow = TODAY;
    // round 1, map bind, vandal: over-aim x2, under-aim x1, level x1, one flick kill
    begin(api, TODAY, "bind", "vandal");
    const target = Math.atan2(5, 10), actors = [enemy(1, 0, -10), enemy(9, -5, -10)];
    const list = [
      [tickSnap(1, { actors }), [miss(1, near(0, 2.3, 0), ahead)]],
      [tickSnap(2, { actors }), [miss(2, near(0.85, 1.75, 0), ahead)]],
      [tickSnap(3, { actors }), [miss(3, near(0, -0.4, 0), ahead)]],
      [tickSnap(4, { actors }), [miss(4, near(0.5, 0.9, 0), ahead)]],
    ];
    for (let k = 5; k <= 15; k++) {
      const last = k === 15;
      list.push([tickSnap(k, { yaw: target * (k - 5) / 10, actors: [enemy(1, 0, -10, { alive: true }), enemy(9, -5, -10, last ? { alive: false } : {})] }), last ? [{ kind: "kill", tick: 15, actorId: 9 }, miss(15, near(0, 20, 0), ahead)] : []]);
    }
    await roundOf(api, list);
    // round 2, map ascent, judge: nothing near, a strafe kill (enemy 3 straight ahead, 2.4 m of strafing)
    begin(api, TODAY + 1000, "ascent", "judge");
    const list2 = [];
    for (let k = 0; k <= 20; k++) {
      const px = 0.12 * k, dead = k === 20;
      list2.push([tickSnap(k, { yaw: Math.atan2(px, 12), pos: { x: px, y: 0, z: 0 }, weapon: "judge", actors: [enemy(3, 0, -12, dead ? { alive: false } : {})] }), dead ? [{ kind: "kill", tick: 20, actorId: 3 }, { kind: "shot", tick: 20, hitActorId: 3, hitPart: "body", hitPoint: near(px, 1, -12), origin: near(px, 1.75, 0), direction: ahead }] : []]);
    }
    await roundOf(api, list2);
    const day = (await api.days())[0];
    assert.deepStrictEqual([day.nearMisses, day.overAim, day.underAim], [4, 2, 1], "4 near misses: 2 over, 1 under, 1 level (the 20 m shot is not near)");
    assert.strictEqual(day.flicks, 1); assert.strictEqual(day.strafes, 1);
    assert.deepStrictEqual([day.maps.bind.nearMisses, day.maps.bind.overAim, day.maps.bind.underAim, day.maps.bind.flicks, day.maps.bind.strafes], [4, 2, 1, 1, undefined]);
    assert.deepStrictEqual([day.maps.ascent.nearMisses, day.maps.ascent.flicks, day.maps.ascent.strafes], [undefined, undefined, 1], "sparse: no field without a count");
    assert.deepStrictEqual([day.weapons.vandal.nearMisses, day.weapons.vandal.flicks, day.weapons.vandal.strafes], [4, 1, undefined]);
    assert.deepStrictEqual([day.weapons.judge.nearMisses, day.weapons.judge.strafes], [undefined, 1]);
    // the existing counters are unchanged by phase 2
    assert.deepStrictEqual(day.maps.bind, { rounds: 1, shots: 5, hits: 0, headshots: 0, kills: 0, deaths: 0, nearMisses: 4, overAim: 2, underAim: 1, flicks: 1 });
    // raw storage keeps the compact rows "e" and "m"
    const raw = idb.peek("aim-analytics", "rounds").sort((a, b) => a.at - b.at);
    assert.strictEqual(raw[0].m.length, 4); assert.strictEqual(raw[0].e.length, 2, "enemy 9 killed, enemy 1 still alive at the end"); assert.deepStrictEqual(raw[0].e[0].slice(0, 4), [9, 0, 1, 15]);
    assert.ok(!("eng" in raw[0]) && !("dims" in raw[0]) && !("last" in raw[0]) && !("over" in raw[0]), "working state is not stored");
    // rebuilding the day from raw (a third round the same day) does not double count
    begin(api, TODAY + 2000, "ascent", "judge");
    await roundOf(api, [[tickSnap(1, { weapon: "judge", actors: [enemy(1, 0, -10)] }), [miss(1, near(0, 2.3, 0), ahead)]]]);
    const again = (await api.days())[0];
    assert.deepStrictEqual([again.nearMisses, again.overAim, again.flicks, again.strafes, again.maps.ascent.nearMisses, again.weapons.judge.nearMisses], [5, 3, 1, 1, 1, 1]);
    fakeNow = null;
  });

  await test("read helpers: engagements() and nearMisses() return plain rows with the round's context, filtered", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY, "bind", "vandal");
    await roundOf(api, [[tickSnap(1, { actors: [enemy(1, 0, -10)] }), [miss(1, near(0, 2.3, 0), ahead)]], [tickSnap(2, { actors: [enemy(1, 0, -10, { alive: false })] }), [{ kind: "kill", tick: 2, actorId: 1 }]]]);
    begin(api, TODAY + 1000, "ascent", "judge");
    await roundOf(api, [[tickSnap(1, { weapon: "judge", actors: [enemy(1, 0, -10)] }), [miss(1, near(0, -0.4, 0), ahead)]], [tickSnap(2, { weapon: "judge", actors: [enemy(1, 0, -10)] }), [miss(2, near(0.85, 1.75, 0), ahead)]]]);
    const eng = await api.engagements();
    assert.ok(eng instanceof Array && eng.length === 2);
    assert.deepStrictEqual(eng.map((e) => [e.map, e.weapon, e.killed]), [["bind", "vandal", true], ["ascent", "judge", false]]);
    assert.ok(eng[0].roundId && eng[0].code === "scene-p2" && eng[0].day === "2026-11-17" && eng[0].enemyId === 1);
    assert.strictEqual((await api.engagements({ map: "ascent" })).length, 1);
    assert.strictEqual((await api.engagements({ weapon: "vandal" })).length, 1);
    assert.strictEqual((await api.engagements({ code: "nothing" })).length, 0);
    assert.strictEqual((await api.engagements({ limit: 1 }))[0].map, "ascent", "limit keeps the newest rows");
    const nm = await api.nearMisses();
    assert.deepStrictEqual(nm.map((n) => [n.map, n.weapon, n.side]), [["bind", "vandal", "above"], ["ascent", "judge", "below"], ["ascent", "judge", "above"]]);
    assert.strictEqual((await api.nearMisses({ weapon: "judge" })).length, 2);
    assert.strictEqual((await api.nearMisses({ weapon: "judge", limit: 1 }))[0].side, "above");
    assert.strictEqual((await api.nearMisses({ map: "bind" })).length, 1);
    assert.strictEqual(typeof api.engagements().then, "function"); assert.strictEqual(typeof api.nearMisses().then, "function");
    fakeNow = null;
  });

  await test("the worker's batched messages (kind \"ticks\") give the same result as direct feeds; a message without look angles records no engagement", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    const info = { id: "scene-w", map: "bind", weapon: "vandal", mode: "score", dt: 1 / 128, kinds: [[1, "humanoid", null, 1]] };
    fakeNow = TODAY;
    api.receive({ kind: "start", info });
    api.receive({ kind: "ticks", list: [
      { snap: tickSnap(0, { actors: [enemy(1, 0, -10)] }) },
      { snap: tickSnap(1, { actors: [enemy(1, 0, -10)] }), events: [miss(1, near(0, 2.3, 0), ahead)] },
      { snap: tickSnap(2, { actors: [enemy(1, 0, -10, { alive: false })] }), events: [{ kind: "kill", tick: 2, actorId: 1 }] },
    ] });
    api.receive({ kind: "tick", snap: { tick: 3, player: { position: { x: 0, y: 0, z: 0 }, weapon: "vandal", knife: 0 }, actors: [] }, events: [miss(3, near(0, 2.3, 0), { x: 0, y: 0, z: 1 })] }); // the first version's message (aimed away from enemy 1, which died a tick earlier: a shot at it would be dropped by POST_KILL_S)
    api.receive({ kind: "end", reason: "cleared" });
    const r = (await api.rounds())[0];
    assert.strictEqual(r.engagements.length, 1); assert.strictEqual(r.engagements[0].killed, true); assert.strictEqual(r.engagements[0].startTick, 0);
    assert.strictEqual(r.shots.length, 2); assert.strictEqual(r.nearMisses.length, 1);
    fakeNow = null;
  });

  await test("engagement and near-miss lists are capped per round (MAX_ENGAGEMENTS 500, MAX_NEAR 1500) and flagged", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY);
    const list = [];
    for (let k = 0; k < 520; k++) { // 520 enemies, each appears and is killed one tick later
      list.push([tickSnap(2 * k, { actors: [enemy(k, 0, -10)] }), [miss(2 * k, near(0, 2.3, 0), ahead)]]);
      list.push([tickSnap(2 * k + 1, { actors: [enemy(k, 0, -10, { alive: false })] }), [{ kind: "kill", tick: 2 * k + 1, actorId: k }]]);
    }
    const r = await roundOf(api, list);
    assert.strictEqual(r.engagements.length, 500); assert.strictEqual(r.engagementsTruncated, true);
    assert.strictEqual(r.nearMisses.length, 520); assert.strictEqual(r.nearMissesTruncated, false);
    fakeNow = null;
  });

  // ---- shot movement fields and the sens header (17 Nov 2026) ----
  const mvShot = (tick, move, extra = {}) => ({ kind: "shot", tick, hitActorId: null, hitPart: null, hitPoint: null, origin: { x: 0, y: 1.7, z: 0 }, ...(move ? { move } : {}), ...extra });
  async function playMove(ls, shots, win) {
    const { api } = boot({ idb: makeFactory(), ls });
    fakeNow = TODAY;
    api.start({ id: "scene-move", map: "bind", weapon: "vandal", mode: "score", dt: 1 / 128, kinds: [[1, "humanoid"]] });
    api.feed({ tick: 10, actors: [], player: { weapon: "vandal", position: { x: 0, y: 0, z: 0 } } }, shots);
    api.end("died");
    return (await api.raw())[0];
  }

  await test("shot rows carry speed, input mask and ticks since input as trailing fields; expand names them", async () => {
    const raw = await playMove(makeLocalStorage(), [
      mvShot(10, { speed: 5.1234, forward: 1, strafe: -1, walk: 0, crouch: 1, air: 0, sinceInput: 0 }),
      mvShot(14, { speed: 0.2, forward: 0, strafe: 0, walk: 1, crouch: 0, air: 1, sinceInput: 9.6 }),
      mvShot(20, { speed: 0.5, forward: -1, strafe: 1, walk: 0, crouch: 0, air: 0, sinceInput: 0 }),
      mvShot(30, null),
      mvShot(40, { speed: 2, forward: 0, strafe: 1, sinceInput: 0 }, { pellets: [{ hitActorId: null }, { hitActorId: null }] }),
    ]);
    assert.strictEqual(raw.s.length, 5);
    assert.deepStrictEqual(raw.s[0].slice(9), [null, 5.12, 1 | 4 | 32, 0], "pellets slot is null, then speed, mask (forward + left + crouch), ticks");
    assert.deepStrictEqual(raw.s[1].slice(10), [0.2, 16 | 64, 10], "walk + airborne, ticks rounded");
    assert.deepStrictEqual(raw.s[2].slice(10), [0.5, 2 | 8, 0], "back + right");
    assert.strictEqual(raw.s[3].length, 9, "a shot without .move keeps the old 9-entry row");
    assert.deepStrictEqual(raw.s[4].slice(9), [[2, 0, 0], 2, 8, 0], "a shotgun row keeps pellets at 9");
    const idb = makeFactory(), ls = makeLocalStorage(), { api } = boot({ idb, ls });
    fakeNow = TODAY; api.start({ id: "scene-move", map: "bind", weapon: "vandal", mode: "score", dt: 1 / 128, kinds: [] });
    api.feed({ tick: 10, actors: [], player: { weapon: "vandal", position: { x: 0, y: 0, z: 0 } } }, [mvShot(10, { speed: 0.3, forward: 0, strafe: 0, walk: 0, crouch: 0, air: 0, sinceInput: 64 }), mvShot(11, { speed: 4, forward: 1, strafe: 0, walk: 0, crouch: 0, air: 0, sinceInput: 0 }), mvShot(12, null)]);
    api.end("died");
    const shots = (await api.rounds())[0].shots;
    assert.deepStrictEqual(shots[0].movement, { speed: 0.3, still: true, forward: false, back: false, left: false, right: false, walk: false, crouch: false, airborne: false, ticksSinceInput: 64, secondsSinceInput: 0.5 });
    assert.strictEqual(shots[1].movement.still, false); assert.strictEqual(shots[1].movement.forward, true);
    assert.ok(!("movement" in shots[2]), "no movement object for a shot recorded without it");
    assert.strictEqual(api.thresholds.STILL_MPS, 0.5);
  });

  await test("old shot rows (9 or 10 entries) still read, and day rows count them as before", async () => {
    const idb = makeFactory(), ls = makeLocalStorage(), { api } = boot({ idb, ls });
    fakeNow = TODAY;
    const old = legacyRound("2026-11-17T09:00:00Z");
    old.s.push([16, 0, "body", 1, 2, 3, 10, 0, 0, [8, 3, 1]]);
    ls.setItem("aim-analytics-rounds-v1", JSON.stringify([old]));
    await sleep(60); await api.rounds();
    const r = (await api.rounds())[0];
    assert.strictEqual(r.shots.length, 4);
    assert.ok(r.shots.every((s) => !("movement" in s)));
    assert.deepStrictEqual(r.shots[3].pellets, { fired: 8, hit: 3, head: 1 });
    assert.ok(!("input" in r), "an old round has no input object");
    assert.deepStrictEqual((await api.days())[0].weapons.vandal, { shots: 4, hits: 3, headshots: 2, kills: 1 });
  });

  await test("round header keeps the sens fields read from localStorage at round start", async () => {
    const ls = makeLocalStorage({ "al-sensitivity-v1": "0.42", "al-display-settings-v1": JSON.stringify({ adsSensitivity: 1.1, scopedSensitivity: 0.9, invertMouseY: true, shadows: false }) });
    const raw = await playMove(ls, [mvShot(10, null)]);
    assert.strictEqual(raw.sens, 0.42); assert.strictEqual(raw.sensAds, 1.1); assert.strictEqual(raw.sensScoped, 0.9); assert.strictEqual(raw.sensInvY, 1);
    assert.ok(!("sensAccel" in raw));
    const { api } = boot({ idb: makeFactory(), ls }); // the settings are read at start(): a later change does not touch a round in progress
    fakeNow = TODAY; api.start({ map: "bind", weapon: "vandal", dt: 1 / 128 });
    ls.setItem("al-sensitivity-v1", "3");
    api.feed({ tick: 1, actors: [], player: { position: { x: 0, y: 0, z: 0 } } }, [mvShot(1, null)]); api.end("died");
    const r = (await api.rounds())[0];
    assert.deepStrictEqual(r.input, { sensitivity: 0.42, adsMultiplier: 1.1, scopedMultiplier: 0.9, invertY: true, accelerationNotice: false });
  });

  await test("sens fields: game defaults when nothing is stored, bad values ignored, unreadable storage leaves them out, notice flag", async () => {
    const dflt = await playMove(makeLocalStorage(), [mvShot(10, null)]);
    assert.deepStrictEqual([dflt.sens, dflt.sensAds, dflt.sensScoped], [0.5, 1, 1]); assert.ok(!("sensInvY" in dflt) && !("sensAccel" in dflt));
    const bad = await playMove(makeLocalStorage({ "al-sensitivity-v1": "abc", "al-display-settings-v1": "{not json" }), [mvShot(10, null)]);
    assert.strictEqual(bad.sens, 0.5); assert.ok(!("sensAds" in bad) && !("sensScoped" in bad), "an unreadable display object leaves its fields out");
    const range = await playMove(makeLocalStorage({ "al-sensitivity-v1": "50", "al-display-settings-v1": JSON.stringify({ adsSensitivity: 0, scopedSensitivity: "x" }) }), [mvShot(10, null)]);
    assert.deepStrictEqual([range.sens, range.sensAds, range.sensScoped], [0.5, 1, 1]);
    const broken = await playMove({ getItem() { throw new Error("denied"); }, setItem() {}, removeItem() {} }, [mvShot(10, null)]);
    assert.ok(!("sens" in broken) && !("sensAds" in broken), "no localStorage: fields left out, round still recorded");
    assert.strictEqual(broken.s.length, 1);
    const prev = globalThis.document;
    globalThis.document = { querySelector: (q) => (q === ".al-raw-input-notice" ? {} : null) };
    try { const acc = await playMove(makeLocalStorage(), [mvShot(10, null)]); assert.strictEqual(acc.sensAccel, 1); } finally { if (prev === undefined) delete globalThis.document; else globalThis.document = prev; }
  });

  // ---- nearest-enemy fields, crouch amount and walk per shot ----
  const foe = (id, x, z, extra = {}) => ({ id, templateId: 1, bornTick: 0, position: { x, y: 0, z }, scale: 1, alive: true, visible: true, ...extra });
  async function playAim(actors, shots, player = {}) {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    fakeNow = TODAY;
    api.start({ id: "scene-near", map: "bind", weapon: "vandal", mode: "score", dt: 1 / 128, kinds: [[1, "humanoid"]] });
    api.feed({ tick: 10, actors, player: { weapon: "vandal", position: { x: 0, y: 0, z: 0 }, ...player } }, shots);
    api.end("died");
    return { raw: (await api.raw())[0], shots: (await api.rounds())[0].shots };
  }
  const aimShot = (tick, dir, extra = {}) => ({ kind: "shot", tick, hitActorId: null, hitPart: null, hitPoint: null, origin: { x: 0, y: 1.7, z: 0 }, direction: dir, ...extra });
  const FWD = { x: 0, y: 0, z: -1 };

  await test("every shot with an enemy nearby stores range, distance to the centre, horizontal side and vertical offset (hits too)", async () => {
    // enemy box centre (0.2, 0.9, -10); the shot runs straight ahead at eye height 1.7 m: left of the centre by 0.2, above it by 0.8
    const hit = await playAim([foe(1, 0.2, -10)], [aimShot(10, FWD, { hitActorId: 1, hitPart: "body", hitPoint: { x: 0, y: 1.7, z: -9.7 } })]);
    assert.deepStrictEqual(hit.raw.s[0].slice(14), [10.03, 0.82, -0.2, 0.8]);
    assert.deepStrictEqual(hit.shots[0].nearestEnemy, { range: 10.03, centreDistance: 0.82, side: -0.2, vertical: 0.8 });
    assert.strictEqual(hit.raw.s[0].length, 18);
    // the same enemy on the other side: the shot is right of its centre (positive)
    const miss = await playAim([foe(1, -0.5, -10)], [aimShot(10, FWD)]);
    assert.deepStrictEqual(miss.shots[0].nearestEnemy, { range: 10.04, centreDistance: 0.94, side: 0.5, vertical: 0.8 });
  });

  await test("side is left / right of the aim whatever way the player faces; the nearest of several enemies is taken; far enemies are ignored", async () => {
    // facing +x, the player's right is +z: the shot at z = 0 passes 0.3 m to the right of an enemy standing at z = -0.3
    const east = await playAim([foe(1, 10, -0.3)], [aimShot(10, { x: 1, y: 0, z: 0 })]);
    assert.strictEqual(east.shots[0].nearestEnemy.side, 0.3);
    // two enemies: the one the line passes closer to (box 0.2 m away) wins over the one 0.5 m away
    const two = await playAim([foe(1, 0.8, -10), foe(2, -0.5, -10)], [aimShot(10, FWD)]);
    assert.strictEqual(two.shots[0].nearestEnemy.side, 0.5); // enemy 2: its box is 0.2 from the line, enemy 1's is 0.5 away
    // nobody within NEAR_MARGIN_M of the line (0.6 m): nothing stored, the row stays an old-style 9-entry row
    const far = await playAim([foe(1, 5, -10)], [aimShot(10, FWD)]);
    assert.strictEqual(far.raw.s[0].length, 9); assert.ok(!("nearestEnemy" in far.shots[0]));
    // no direction on the event: nothing stored; a dead enemy that was not hit is ignored
    assert.strictEqual((await playAim([foe(1, 0.2, -10)], [aimShot(10, undefined)])).raw.s[0].length, 9);
    assert.strictEqual((await playAim([foe(1, 0.2, -10, { alive: false })], [aimShot(10, FWD)])).raw.s[0].length, 9);
    // but an enemy this shot killed counts although the snapshot has it dead
    const kill = await playAim([foe(1, 0.2, -10, { alive: false })], [{ kind: "kill", actorId: 1 }, aimShot(10, FWD, { hitActorId: 1, hitPart: "head", hitPoint: { x: 0, y: 1.7, z: -9.7 } })]);
    assert.strictEqual(kill.shots[0].nearestEnemy.side, -0.2); assert.strictEqual(kill.shots[0].killed, true);
  });

  await test("crouch amount and walk are stored per shot (walk is bit 16 of the input mask), alone or with the movement fields", async () => {
    // snapshot crouch amount only (an engine without the movement patch): movement fields are null, the row still reads
    const a = await playAim([], [aimShot(10, FWD)], { crouchAmount: 0.456 });
    assert.deepStrictEqual(a.raw.s[0].slice(9), [null, null, null, null, 0.46]);
    assert.strictEqual(a.shots[0].crouchAmount, 0.46); assert.ok(!("movement" in a.shots[0]));
    // clamped to 0..1; a standing player is 0, not missing
    assert.strictEqual((await playAim([], [aimShot(10, FWD)], { crouchAmount: 3 })).shots[0].crouchAmount, 1);
    assert.strictEqual((await playAim([], [aimShot(10, FWD)], { crouchAmount: 0 })).shots[0].crouchAmount, 0);
    assert.strictEqual((await playAim([], [aimShot(10, FWD)], {})).raw.s[0].length, 9, "no crouch data: the old 9-entry row");
    // with movement: walk held and crouch held in the mask, crouch amount beside it
    const b = await playAim([], [aimShot(10, FWD, { move: { speed: 1.2, forward: 1, strafe: 0, walk: 1, crouch: 1, air: 0, sinceInput: 0 } })], { crouchAmount: 0.5 });
    assert.deepStrictEqual(b.raw.s[0].slice(10, 14), [1.2, 1 | 16 | 32, 0, 0.5]);
    assert.strictEqual(b.shots[0].movement.walk, true); assert.strictEqual(b.shots[0].movement.crouch, true); assert.strictEqual(b.shots[0].crouchAmount, 0.5);
    // a shotgun row keeps pellets at 9 with the later fields after it
    const c = await playAim([foe(1, 0.2, -10)], [aimShot(10, FWD, { pellets: [{ hitActorId: null }, { hitActorId: null }] })], { crouchAmount: 0.2 });
    assert.deepStrictEqual(c.raw.s[0].slice(9, 14), [[2, 0, 0], null, null, null, 0.2]); assert.strictEqual(c.raw.s[0][15], 0.82);
  });

  // ---- bullet offset from the aim, and the aim, per shot (17 Nov 2026) ----
  // a unit direction from a signed angle to the RIGHT of straight ahead (-z; +x is to the right) and an angle up
  const dirRU = (rightDeg, upDeg) => ({ x: Math.sin(rightDeg * RAD) * Math.cos(upDeg * RAD), y: Math.sin(upDeg * RAD), z: -Math.cos(rightDeg * RAD) * Math.cos(upDeg * RAD) });
  await test("bullet offset: yaw error is positive to the RIGHT of the aim, pitch error positive UP, a dead-on tap is zero", async () => {
    const at0 = { yaw: 0, pitch: 0 };
    const right = (await playAim([], [aimShot(10, dirRU(2, 0))], at0)).raw.s[0];
    assert.deepStrictEqual(right.slice(18), [2, 0, 0, 0], "2 degrees right of the aim: +2 yaw error, aim 0, 0");
    assert.deepStrictEqual((await playAim([], [aimShot(10, dirRU(-2, 0))], at0)).raw.s[0].slice(18, 20), [-2, 0], "left is negative");
    assert.deepStrictEqual((await playAim([], [aimShot(10, dirRU(0, 1.5))], at0)).raw.s[0].slice(18, 20), [0, 1.5], "above the aim is positive");
    assert.deepStrictEqual((await playAim([], [aimShot(10, dirRU(0, -1.5))], at0)).raw.s[0].slice(18, 20), [0, -1.5], "below is negative");
    // a well-aimed single tap: the bullet along the aim gives exactly 0 (no negative zero), with the aim stored beside it
    const tap = (await playAim([], [aimShot(10, dirRU(0, 0))], at0)).raw.s[0];
    assert.deepStrictEqual(tap.slice(18), [0, 0, 0, 0]); assert.ok(tap.slice(18).every((v) => !Object.is(v, -0)));
    // the game's yaw grows to the LEFT: yaw 90 degrees looks along -x. A bullet 1 degree to the right of that is yaw 89 and gives +1.
    const yaw90 = Math.PI / 2, d = { x: -Math.sin(89 * RAD), y: 0, z: -Math.cos(89 * RAD) };
    const turned = (await playAim([], [aimShot(10, d)], { yaw: yaw90, pitch: 0.2 })).raw.s[0];
    assert.deepStrictEqual(turned.slice(18, 22), [1, -11.46, 90, 11.46], "level bullet, aim 0.2 rad (11.46 degrees) up: pitch error -11.46, aim pitch +11.46");
    assert.ok(!("yawErrDeg" in (await playAim([], [aimShot(10, FWD)], {})).shots[0]), "no aim in the snapshot: no fields");
    // expand() names them
    const by = 0.5 - 2 * RAD, bp = 0.1 + 1.5 * RAD; // 2 degrees right of and 1.5 degrees above an aim of yaw 0.5, pitch 0.1 radians
    const e = (await playAim([], [aimShot(10, { x: -Math.sin(by) * Math.cos(bp), y: Math.sin(bp), z: -Math.cos(by) * Math.cos(bp) })], { yaw: 0.5, pitch: 0.1 })).shots[0];
    assert.deepStrictEqual([e.yawErrDeg, e.pitchErrDeg, e.aimYawDeg, e.aimPitchDeg], [2, 1.5, 28.65, 5.73]);
  });
  await test("bullet offset: the yaw error wraps across 180 degrees, a missing direction keeps the aim, a shotgun row keeps its fixed indexes", async () => {
    // aim yaw 179.5 degrees; the bullet is at yaw -179.5 (1 degree further LEFT through the wrap): error -1
    const dl = { x: -Math.sin(-179.5 * RAD), y: 0, z: -Math.cos(-179.5 * RAD) };
    assert.deepStrictEqual((await playAim([], [aimShot(10, dl)], { yaw: 179.5 * RAD, pitch: 0 })).raw.s[0].slice(18, 21), [-1, 0, 179.5]);
    // an aim yaw past a full turn is stored wrapped
    assert.strictEqual((await playAim([], [aimShot(10, FWD)], { yaw: 370 * RAD, pitch: 0 })).raw.s[0][20], 10);
    // no direction: yaw and pitch error null, aim still stored
    const nodir = (await playAim([], [aimShot(10, undefined)], { yaw: 0.1, pitch: 0.05 })).raw.s[0];
    assert.deepStrictEqual(nodir.slice(18), [null, null, 5.73, 2.86]);
    // a shotgun: pellets at 9, the later fields after them (the nine nulls up to the recoil fields stay null)
    const sg = (await playAim([], [aimShot(10, dirRU(1, 0), { pellets: [{ hitActorId: null }, { hitActorId: null }] })], { yaw: 0, pitch: 0 })).raw.s[0];
    assert.deepStrictEqual(sg[9], [2, 0, 0]); assert.strictEqual(sg[18], 1); assert.strictEqual(sg.length, 22);
    // the longest row is 22 entries
    assert.ok(sg.length <= 22);
  });
  await test("old shot rows with 18 entries (no recoil fields) still read", async () => {
    const idb = makeFactory(), ls = makeLocalStorage(), { api } = boot({ idb, ls });
    fakeNow = TODAY;
    const old = legacyRound("2026-11-17T09:00:00Z");
    old.s.push([16, 0, "body", 1, 2, 3, 10, 0, 0, null, 1.5, 1, 0, 0, 10, 0.1, 0, 0]);
    ls.setItem("aim-analytics-rounds-v1", JSON.stringify([old]));
    await sleep(60); await api.rounds();
    const s = (await api.rounds())[0].shots[3];
    assert.strictEqual(s.movement.speed, 1.5); assert.ok(s.nearestEnemy);
    assert.ok(!("yawErrDeg" in s) && !("aimPitchDeg" in s));
  });

  // ---- engagement start position, fightCells() and the fights rollup (17 Nov 2026) ----
  await test("an engagement row ends with the player and enemy x, z at its start tick; expand names them; old 11-entry rows read as no position", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY);
    // the player walks from (2, 0, 3) to (2.5, 0, 3) while enemy 7 (feet at x -5, z -10, with a 0.1 / 0.2 offset on top) is in view from tick 0 and dies at tick 5
    const actor = (extra = {}) => ({ ...enemy(7, -5, -10, extra), offset: { x: 0.1, y: 0, z: 0.2 } });
    const list = [];
    for (let k = 0; k <= 5; k++) list.push([tickSnap(k, { pos: { x: 2 + k * 0.1, y: 0, z: 3 }, actors: [actor(k === 5 ? { alive: false } : {})] }), k === 5 ? [{ kind: "kill", tick: 5, actorId: 7 }, { kind: "shot", tick: 5, hitActorId: null, origin: near(2.5, 1.75, 3) }] : []]);
    const r = await roundOf(api, list);
    const raw = (await api.raw())[0].e[0].slice(0, 20); // index 20 = tracking, tested apart
    assert.strictEqual(raw.length, 20);
    assert.deepStrictEqual(raw.slice(11, 15), [2, 3, -4.9, -9.8], "player x, player z, enemy x, enemy z of the start tick (tick 0, not the kill tick)");
    assert.deepStrictEqual(raw.slice(15), [5, 2.5, 3, -4.9, -9.8], "contact: the kill at tick 5 is a hit, so the contact tick and the positions are that tick's (the player has walked 0.5 m)");
    assert.deepStrictEqual([r.engagements[0].contactTick, r.engagements[0].playerContact, r.engagements[0].enemyContact], [5, { x: 2.5, z: 3 }, { x: -4.9, z: -9.8 }]);
    assert.deepStrictEqual(r.engagements[0].playerStart, { x: 2, z: 3 });
    assert.deepStrictEqual(r.engagements[0].enemyStart, { x: -4.9, z: -9.8 });
    // an enemy that appeared and died inside one tick: start = kill tick, so the position is that tick's
    begin(api, TODAY + 1000);
    const r2 = await roundOf(api, [[tickSnap(4, { pos: { x: 7.25, y: 0, z: -1.5 }, actors: [enemy(2, 8, -4, { alive: false })] }), [{ kind: "kill", tick: 4, actorId: 2 }, { kind: "shot", tick: 4, hitActorId: null, origin: near(7.25, 1.75, -1.5) }]]]);
    assert.deepStrictEqual([r2.engagements[0].playerStart, r2.engagements[0].enemyStart], [{ x: 7.25, z: -1.5 }, { x: 8, z: -4 }]);
    assert.deepStrictEqual([r2.engagements[0].contactTick, r2.engagements[0].playerContact, r2.engagements[0].enemyContact], [4, { x: 7.25, z: -1.5 }, { x: 8, z: -4 }], "killed in the tick it appeared: contact = start");
    // old rows: 11 entries, no position, and the other fields read as before
    const ls = makeLocalStorage({ "aim-analytics-rounds-v1": JSON.stringify([legacyRound("2026-11-17T08:00:00Z", "bind", { e: [[1, 0, 3, 9, 25, 0.1, 12, 12, 0, "flick", 0]] })]) });
    const b = boot({ idb: makeFactory(), ls });
    await until(() => ls.getItem("aim-analytics-rounds-v1") === null, "migration");
    const e = (await b.api.engagements())[0];
    assert.ok(e && e.playerStart === null && e.enemyStart === null && e.playerContact === null && e.enemyContact === null && e.contactTick === null && e.kind === "flick" && e.killed === true && e.weapon === "vandal", JSON.stringify(e));
    fakeNow = null;
  });

  // one killed enemy per spot, each a zero-length engagement that starts at the player's position there
  const fightRound = async (api, when, map, weapon, spots) => {
    fakeNow = when;
    api.start({ id: "scene-fights", map, weapon, mode: "score", dt: 1 / 128, kinds: [[1, "humanoid", null, 1]] });
    spots.forEach(([x, z], i) => api.feed(tickSnap(i + 1, { pos: { x, y: 0, z }, weapon, actors: [enemy(10 + i, x, z - 10, { alive: false })] }), [{ kind: "kill", tick: i + 1, actorId: 10 + i }, { kind: "shot", tick: i + 1, hitActorId: null, origin: near(x, 1.75, z) }])); // a round with no shot or death is not stored
    api.end("cleared");
    await api.rounds();
  };

  await test("fightCells(): fight counts on the 1 m death grid by the player contact position (a kill at once = the start), with the engagements() filters; old rows are counted apart", async () => {
    const idb = makeFactory(), ls = makeLocalStorage();
    const { api } = boot({ idb, ls });
    await fightRound(api, TODAY, "bind", "vandal", [[3.5, 4.5], [3.9, 4.1], [-0.5, -2.2]]);
    await fightRound(api, TODAY + 1000, "ascent", "judge", [[3.2, 4.8], [10, 10]]);
    const all = await api.fightCells({ map: "bind" });
    assert.deepStrictEqual(all, { cells: { "3,4": 2, "-1,-3": 1 }, total: 3, withoutPosition: 0 }, "floor of x and z, negative cells like the death grid");
    assert.deepStrictEqual((await api.fightCells({ map: "ascent" })).cells, { "3,4": 1, "10,10": 1 });
    assert.strictEqual((await api.fightCells({})).cells["3,4"], 3, "without a map the maps are summed");
    assert.strictEqual((await api.fightCells({ weapon: "judge" })).total, 2);
    assert.strictEqual((await api.fightCells({ code: "nothing" })).total, 0);
    assert.deepStrictEqual((await api.fightCells({ map: "bind", limit: 1 })).cells, { "-1,-3": 1 }, "limit keeps the newest engagements");
    assert.deepStrictEqual(await api.fightCells(), { cells: { "3,4": 3, "-1,-3": 1, "10,10": 1 }, total: 5, withoutPosition: 0 });
    // the day row carries the same cells, and days({map}) cuts them down like grid
    const day = (await api.days({ from: "2026-11-17", to: "2026-11-17" }))[0];
    assert.deepStrictEqual(day.fights, { bind: { "3,4": 2, "-1,-3": 1 }, ascent: { "3,4": 1, "10,10": 1 } });
    assert.deepStrictEqual((await api.days({ map: "bind", from: "2026-11-17", to: "2026-11-17" }))[0].fights, { bind: { "3,4": 2, "-1,-3": 1 } });
    // an old-style round (no position) is counted in withoutPosition only
    ls.setItem("aim-analytics-rounds-v1", JSON.stringify([legacyRound("2026-11-16T08:00:00Z", "bind", { e: [[1, 0, 3, 9, 25, 0.1, 12, 12, 0, "flick", 0]] })]));
    const b = boot({ idb, ls });
    await until(() => ls.getItem("aim-analytics-rounds-v1") === null, "migration");
    const mixed = await b.api.fightCells({ map: "bind" });
    assert.deepStrictEqual([mixed.total, mixed.withoutPosition, mixed.cells["3,4"]], [3, 1, 2]);
    fakeNow = null;
  });

  await test("day row fights: capped like the death grid (300 per map, 1500 per day), row still well under 50 KB", async () => {
    const idb = makeFactory(), ls = makeLocalStorage();
    const { api } = boot({ idb, ls });
    for (let m = 0; m < 12; m++) {
      for (let r = 0; r < (m === 0 ? 4 : 2); r++) {
        const spots = [];
        for (let k = 0; k < 100; k++) spots.push([k + r * 100 + 0.5, m * 7 + (k % 5) + 0.5]);
        await fightRound(api, TODAY + m * 100000 + r * 1000, "map" + m, "vandal", spots);
      }
    }
    const row = (await api.days())[0];
    const cells = Object.values(row.fights).reduce((n, g) => n + Object.keys(g).length, 0);
    assert.strictEqual(Object.keys(row.fights.map0).length, 300, "per-map cap reached");
    assert.ok(Object.values(row.fights).every((g) => Object.keys(g).length <= 300));
    assert.strictEqual(cells, 1500, "per-day cap reached");
    assert.deepStrictEqual(row.grid, {}, "the death grid is separate: no deaths, no cells");
    assert.ok(JSON.stringify(row).length < 50000, "row size " + JSON.stringify(row).length);
    fakeNow = null;
  });

  await test("fights rollup: late rounds add to the counts and cells, never shrink them; an old row without fights gains the field", async () => {
    fakeNow = TODAY;
    const idb = makeFactory(), ls = makeLocalStorage();
    const a = boot({ idb, ls });
    const e = (x, z) => [1, 0, 3, 9, 25, 0.1, 12, 12, 0, "flick", 0, 0, 0, 0, 0, 5, x, z, 0, 0]; // the START is (0, 0) in every row: only the contact (x, z) may place the fight
    ls.setItem("aim-analytics-rounds-v1", JSON.stringify([
      legacyRound("2026-09-01T09:00:00Z", "bind", { e: [e(3.5, 4.5), e(3.6, 4.6), [1, 0, 3, 9, 25, 0.1, 12, 12, 0, "flick", 0], [1, 0, 3, 9, 25, 0.1, 12, 12, 0, "flick", 0, 3.5, 4.5, 0, 0], [1, 0, 3, 9, 25, 0.1, 12, 12, 0, "flick", 0, 3.5, 4.5, 0, 0, null, null, null, null, null]] }),
      legacyRound("2026-09-01T10:00:00Z", "ascent", { e: [e(10.2, -1.5)] })]));
    await until(() => ls.getItem("aim-analytics-rounds-v1") === null, "first migration");
    const before = (await a.api.days({ to: "2026-09-30" }))[0];
    assert.deepStrictEqual(before.fights, { bind: { "3,4": 2 }, ascent: { "10,-2": 1 } }, "rows without a contact (11 entries, start only, five nulls) add nothing");
    assert.strictEqual(idb.peek("aim-analytics", "rounds").length, 0);
    // three later rounds for the same day (ids the row does not list): their fights are added to the row: "3,4": +1 and a new cell "8,8": 1
    const late = (h, ex) => legacyRound("2026-09-01T" + h + ":00:00Z", "bind", { s: [], d: [], e: ex });
    ls.setItem("aim-analytics-rounds-v1", JSON.stringify([late("11", [e(3.1, 4.9)]), late("12", [e(8.5, 8.5)]), late("13", [])]));
    boot({ idb, ls });
    await until(() => ls.getItem("aim-analytics-rounds-v1") === null, "late migration");
    const after = (await a.api.days({ to: "2026-09-30" }))[0];
    assert.deepStrictEqual(after.fights, { bind: { "3,4": 3, "8,8": 1 }, ascent: { "10,-2": 1 } }, "3,4 gets the late fight on top of the 2 it had (3); ascent kept; 8,8 added");
    // a row stored before the field existed (here: the field removed) is not shrunk and gains fights from a rebuild
    const stored = idb.peek("aim-analytics", "days").find((d) => d.day === "2026-09-01");
    delete stored.fights;
    const kept = { rounds: stored.rounds, shots: stored.shots, deaths: stored.deaths };
    ls.setItem("aim-analytics-rounds-v1", JSON.stringify([late("14", [e(1.5, 1.5)]), late("15", []), late("16", []), late("17", []), late("18", [])]));
    boot({ idb, ls });
    await until(() => ls.getItem("aim-analytics-rounds-v1") === null, "third migration");
    const third = (await a.api.days({ to: "2026-09-30" }))[0];
    assert.deepStrictEqual(third.fights, { bind: { "1,1": 1 } }, "the old row had no fights: it gains the rebuilt ones");
    assert.ok(third.rounds >= kept.rounds && third.shots >= kept.shots && third.deaths >= kept.deaths, "other counts not reduced");
    fakeNow = null;
  });

  // ---- first contact (17 Nov 2026) ----
  // The enemy stands dead ahead at z = -20 (x 0), in the view cone from tick 0. The player stands at the origin and walks along -z, 2 m a tick.
  const walk = (k) => ({ x: 0, y: 0, z: k ? -2 * k : 0 });
  const away = { x: 0, y: 0, z: 1 }; // a shot straight back: near no enemy

  await test("contact: the player walks in and fires first: the fight is placed at the first shot, not at the start", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY);
    const list = [];
    for (let k = 0; k <= 7; k++) {
      const ev = [];
      if (k === 3) ev.push(miss(3, near(0, 1.75, -6), away));                                     // a shot that goes nowhere near the enemy: no contact
      if (k === 5) ev.push(miss(5, near(0, 1.75, -10), { x: 0, y: 0, z: -1 }));                    // first shot at it: the line passes through its body, a miss by the game's call
      if (k === 7) ev.push({ kind: "kill", tick: 7, actorId: 4 }, { kind: "shot", tick: 7, hitActorId: 4, hitPart: "head", origin: near(0, 1.75, -14), direction: { x: 0, y: 0, z: -1 } });
      list.push([tickSnap(k, { pos: walk(k), actors: [enemy(4, 0, -20, k === 7 ? { alive: false } : {})] }), ev]);
    }
    const r = await roundOf(api, list);
    const g = (await api.raw())[0].e[0].slice(0, 20); // index 20 = tracking, tested apart
    assert.strictEqual(g.length, 20);
    assert.deepStrictEqual(g.slice(11, 15), [0, 0, 0, -20], "start: the player at the origin");
    assert.deepStrictEqual(g.slice(15), [5, 0, -10, 0, -20], "contact: the first shot at the enemy (tick 5), the player 10 m in");
    const e = r.engagements[0];
    assert.deepStrictEqual([e.startTick, e.contactTick, e.playerStart, e.playerContact, e.enemyContact], [0, 5, { x: 0, z: 0 }, { x: 0, z: -10 }, { x: 0, z: -20 }]);
    assert.deepStrictEqual((await api.fightCells({})), { cells: { "0,-10": 1 }, total: 1, withoutPosition: 0 }, "the fight is on the cell of the first shot, not the start cell 0,0");
    fakeNow = null;
  });

  await test("contact: the enemy shoots first: the contact is its first hit on the player (a miss of the enemy is not contact)", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY);
    const list = [];
    for (let k = 0; k <= 8; k++) {
      const ev = [];
      if (k === 2) ev.push({ kind: "enemyShot", tick: 2, actorId: 5, hit: false, damage: 0, distance: 20 });                                   // fired and missed: no contact yet
      if (k === 4) ev.push({ kind: "enemyShot", tick: 4, actorId: 5, hit: true, zone: "body", damage: 20, healthAfter: 80, distance: 12 });    // first damage to the player: contact
      if (k === 6) ev.push(miss(6, near(0, 1.75, -12), away));                                                                                 // the player answers, but not at the enemy
      if (k === 8) ev.push({ kind: "kill", tick: 8, actorId: 5 }, { kind: "shot", tick: 8, hitActorId: 5, hitPart: "body", origin: near(0, 1.75, -16), direction: { x: 0, y: 0, z: -1 } });
      list.push([tickSnap(k, { pos: walk(k), actors: [enemy(5, 0, -20, k === 8 ? { alive: false } : {})] }), ev]);
    }
    const r = await roundOf(api, list);
    const g = (await api.raw())[0].e[0];
    assert.deepStrictEqual(g.slice(11, 20), [0, 0, 0, -20, 4, 0, -8, 0, -20], "start at the origin; contact at tick 4, the enemy's hit, with the player 8 m in");
    assert.strictEqual(r.engagements[0].contactTick, 4);
    assert.deepStrictEqual((await api.fightCells({})).cells, { "0,-8": 1 });
    fakeNow = null;
  });

  await test("contact: an enemy that never hurt the player and was never shot at has no contact: left out of the fights, counted as withoutPosition", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY);
    // enemy 6 is in view for 4 ticks, fires one miss, and goes away; the one shot of the round goes backwards (a round with no shot is not stored)
    const list = [];
    for (let k = 0; k <= 4; k++) {
      const ev = [];
      if (k === 1) ev.push({ kind: "enemyShot", tick: 1, actorId: 6, hit: false, damage: 0, distance: 20 }, miss(1, near(0, 1.75, -2), away));
      list.push([tickSnap(k, { pos: walk(k), actors: [enemy(6, 0, -20, k === 4 ? { visible: false } : {})] }), ev]);
    }
    const r = await roundOf(api, list);
    assert.strictEqual(r.engagements.length, 1);
    const g = (await api.raw())[0].e[0];
    assert.deepStrictEqual(g.slice(15, 20), [null, null, null, null, null], "five nulls: no contact");
    assert.deepStrictEqual(g.slice(11, 15), [0, 0, 0, -20], "the start position is still kept");
    assert.deepStrictEqual([r.engagements[0].contactTick, r.engagements[0].playerContact, r.engagements[0].enemyContact], [null, null, null]);
    assert.deepStrictEqual(r.engagements[0].playerStart, { x: 0, z: 0 });
    assert.deepStrictEqual(await api.fightCells({}), { cells: {}, total: 0, withoutPosition: 1 });
    assert.deepStrictEqual((await api.days())[0].fights, {}, "the day row has no fight cell for it");
    fakeNow = null;
  });

  await test("contact: a shot whose nearest enemy, pellet or also hit is the enemy counts as a shot at it", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY);
    const A = (id, x) => enemy(id, x, -10);
    const all = () => [A(7, 0), A(8, 3), A(9, -3)];
    const list = [
      [tickSnap(0, { actors: all() }), []],
      [tickSnap(1, { pos: { x: 1, y: 0, z: 0 }, actors: all() }), [miss(1, near(1, 1.75, 0), { x: -0.1, y: 0, z: -1 })]],  // misses nearest enemy 7 (line passes x 0.0 at z -10)
      [tickSnap(2, { pos: { x: 2, y: 0, z: 0 }, actors: all() }), [{ kind: "shot", tick: 2, hitActorId: null, origin: near(2, 1.75, 0), direction: { x: 0.1, y: 0, z: -1 }, pellets: [{ hitActorId: 8, hitPart: "body" }, { hitActorId: null }] }]],
      [tickSnap(3, { pos: { x: 3, y: 0, z: 0 }, actors: all() }), [{ kind: "shot", tick: 3, hitActorId: 7, hitPart: "body", origin: near(3, 1.75, 0), direction: { x: -0.3, y: 0, z: -1 }, also: [{ actorId: 9 }] }]],
    ];
    await roundOf(api, list);
    const rows = (await api.raw())[0].e, by = (id) => rows.find((g) => g[0] === id);
    assert.deepStrictEqual(by(7).slice(15, 18), [1, 1, 0], "enemy 7: the tick 1 shot passed through its body (the nearest enemy): contact at tick 1, the player at (1, 0)");
    assert.deepStrictEqual(by(8).slice(15, 18), [2, 2, 0], "enemy 8: a pellet hit it at tick 2");
    assert.deepStrictEqual(by(9).slice(15, 18), [3, 3, 0], "enemy 9: named by the also list at tick 3");
    fakeNow = null;
  });

  await test("fights rollup: the grid, fightCells() and the day row use the contact cell, never the start cell", async () => {
    const idb = makeFactory(), ls = makeLocalStorage();
    const { api } = boot({ idb, ls });
    // in each round the enemies are in view from the origin; contact is far from it: enemy 1 is shot at from (0, -6), enemy 2 hurts the player at (0, -8), enemy 3 only misses
    for (const [when, map] of [[TODAY, "bind"], [TODAY + 1000, "ascent"]]) {
      begin(api, when, map);
      const list = [];
      for (let k = 0; k <= 6; k++) {
        const ev = [];
        if (k === 2) ev.push({ kind: "enemyShot", tick: 2, actorId: 3, hit: false, damage: 0, distance: 10 });
        if (k === 3) ev.push(miss(3, near(0, 1.75, -6), { x: 0, y: 0, z: -1 }));
        if (k === 4) ev.push({ kind: "enemyShot", tick: 4, actorId: 2, hit: true, damage: 10, healthAfter: 90, distance: 10 });
        list.push([tickSnap(k, { pos: walk(k), actors: [enemy(1, 0, -30), enemy(2, 6, -30), enemy(3, -6, -30)] }), ev]);
      }
      await roundOf(api, list);
    }
    const bind = await api.fightCells({ map: "bind" });
    assert.deepStrictEqual(bind, { cells: { "0,-6": 1, "0,-8": 1 }, total: 2, withoutPosition: 1 }, "contact cells; the start cell 0,0 is not used; the contactless enemy is withoutPosition");
    assert.deepStrictEqual(await api.fightCells({}), { cells: { "0,-6": 2, "0,-8": 2 }, total: 4, withoutPosition: 2 });
    const day = (await api.days({ from: "2026-11-17", to: "2026-11-17" }))[0];
    assert.deepStrictEqual(day.fights, { bind: { "0,-6": 1, "0,-8": 1 }, ascent: { "0,-6": 1, "0,-8": 1 } });
    fakeNow = null;
  });

  // ---- review fixes (17 Nov 2026) ----
  await test("a single late round for an old day with a bigger row is counted before it is deleted, and only once", async () => {
    fakeNow = TODAY;
    const idb = makeFactory(), ls = makeLocalStorage();
    const a = boot({ idb, ls });
    // four rounds rolled up at once
    ls.setItem("aim-analytics-rounds-v1", JSON.stringify([0, 1, 2, 3].map((h) => legacyRound("2026-09-01T0" + h + ":00:00Z"))));
    await until(() => ls.getItem("aim-analytics-rounds-v1") === null, "first migration");
    const before = (await a.api.days({ to: "2026-09-30" }))[0];
    assert.deepStrictEqual([before.rounds, before.shots, before.deaths, before.ids.length], [4, 12, 4, 4]);
    // one late round (1 < 4): the old rule deleted it without counting it
    const late = legacyRound("2026-09-01T09:00:00Z", "bind");
    ls.setItem("aim-analytics-rounds-v1", JSON.stringify([late]));
    boot({ idb, ls });
    await until(() => ls.getItem("aim-analytics-rounds-v1") === null, "late migration");
    const after = (await a.api.days({ to: "2026-09-30" }))[0];
    assert.deepStrictEqual([after.rounds, after.shots, after.hits, after.deaths, after.ids.length], [5, 15, before.hits + 2, 5, 5], JSON.stringify(after));
    assert.deepStrictEqual(after.maps.bind, { rounds: 5, shots: 15, hits: before.maps.bind.hits + 2, headshots: before.maps.bind.headshots + 1, kills: before.maps.bind.kills + 1, deaths: 5 });
    assert.strictEqual(idb.peek("aim-analytics", "rounds").length, 0, "raw round deleted after it was counted");
    // the same round again (a left-over safety copy): listed already, so deleted without a second count
    ls.setItem("aim-analytics-rounds-v1", JSON.stringify([late]));
    boot({ idb, ls });
    await until(() => ls.getItem("aim-analytics-rounds-v1") === null, "duplicate migration");
    const again = (await a.api.days({ to: "2026-09-30" }))[0];
    assert.deepStrictEqual([again.rounds, again.shots, again.deaths], [5, 15, 5]);
    assert.strictEqual(idb.peek("aim-analytics", "rounds").length, 0);
    fakeNow = null;
  });
  await test("a recent day written again after a clock change is merged into its row, never rebuilt smaller", async () => {
    const idb = makeFactory(), ls = makeLocalStorage();
    const a = boot({ idb, ls });
    // two rounds of 2026-09-01 are counted and rolled up (the clock is at 17 Nov)
    fakeNow = TODAY;
    ls.setItem("aim-analytics-rounds-v1", JSON.stringify([legacyRound("2026-09-01T09:00:00Z"), legacyRound("2026-09-01T10:00:00Z", "ascent")]));
    await until(() => ls.getItem("aim-analytics-rounds-v1") === null, "first migration");
    const before = (await a.api.days({ to: "2026-09-30" }))[0];
    assert.strictEqual(before.rounds, 2);
    assert.strictEqual(idb.peek("aim-analytics", "rounds").length, 0);
    // the clock goes back: 2026-09-01 is a recent day again and a new round is written for it
    play(a.api, roundA(at("2026-09-01T15:00:00Z")));
    await a.api.rounds();
    const mid = (await a.api.days({ to: "2026-09-30" }))[0];
    assert.ok(mid.rounds >= before.rounds && mid.shots >= before.shots && mid.deaths >= before.deaths, "never smaller: " + JSON.stringify(mid));
    assert.deepStrictEqual([mid.rounds, mid.shots, mid.deaths], [3, 9, 3], "the new round is added to what the row already counted");
    assert.deepStrictEqual(mid.grid.ascent, before.grid.ascent, "earlier death cells kept");
    // another write the same day does not count the first one again
    play(a.api, roundB(at("2026-09-01T16:00:00Z")));
    await a.api.rounds();
    const last = (await a.api.days({ to: "2026-09-30" }))[0];
    assert.deepStrictEqual([last.rounds, last.ids.length], [4, 4]);
    // a row from before the ids existed is merged with the rebuild by the larger value (never smaller)
    const stored = idb.peek("aim-analytics", "days").find((d) => d.day === "2026-09-01");
    delete stored.ids;
    play(a.api, roundA(at("2026-09-01T17:00:00Z")));
    await a.api.rounds();
    const legacy = (await a.api.days({ to: "2026-09-30" }))[0];
    assert.ok(legacy.rounds >= last.rounds && legacy.shots >= last.shots && legacy.deaths >= last.deaths, JSON.stringify(legacy));
    fakeNow = null;
  });
  await test("old raw rounds are read in batches of 200 at the roll-up, and all of them are rolled up", async () => {
    fakeNow = TODAY;
    const idb = makeFactory(), ls = makeLocalStorage();
    const a = boot({ idb, ls });
    // 450 raw rounds over three old days
    const list = [];
    for (let i = 0; i < 450; i++) list.push(legacyRound("2026-08-0" + (1 + (i % 3)) + "T" + pad2(Math.floor(i / 60) % 24) + ":" + pad2(i % 60) + ":00Z"));
    ls.setItem("aim-analytics-rounds-v1", JSON.stringify(list));
    await until(() => ls.getItem("aim-analytics-rounds-v1") === null, "migration of 450 rounds", 20000);
    assert.ok(idb.control.stats.maxIndexGetAll <= 200, "largest read " + idb.control.stats.maxIndexGetAll);
    assert.strictEqual(idb.peek("aim-analytics", "rounds").length, 0, "all raw rounds rolled up and deleted");
    const rows = await a.api.days({ to: "2026-08-31" });
    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows.reduce((n, r) => n + r.rounds, 0), 450, "every round counted exactly once across the batches");
    assert.strictEqual(rows.reduce((n, r) => n + r.shots, 0), 450 * 3);
    assert.ok(rows.every((r) => r.ids.length === 150), "150 ids per day");
    fakeNow = null;
  });
  await test("receive() never throws: bad lists, bad ticks and unknown messages are skipped, good ticks after a bad one still count", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    fakeNow = TODAY;
    const bad = [undefined, null, 7, "x", {}, { kind: "ticks" }, { kind: "ticks", list: 5 }, { kind: "ticks", list: { a: 1 } }, { kind: "ticks", list: [null, 3, { snap: null, events: 5 }] },
      { kind: "tick" }, { kind: "tick", snap: 1, events: 1 }, { kind: "start" }, { kind: "start", info: 7 }, { kind: "end" }, { kind: "nope" }];
    for (const m of bad) assert.doesNotThrow(() => api.receive(m), JSON.stringify(m));
    api.receive({ kind: "start", info: { id: "scene-rx", map: "bind", weapon: "vandal", mode: "score", dt: 1 / 128, kinds: [[1, "humanoid"]] } });
    const hit = { kind: "shot", tick: 3, hitActorId: 1, hitPart: "head", hitPoint: { x: 1, y: 2, z: 3 }, origin: { x: 0, y: 0, z: 0 } };
    const good = { snap: { tick: 3, actors: [{ id: 1, templateId: 1 }], player: { weapon: "vandal", position: { x: 0, y: 0, z: 0 } } }, events: [hit] };
    assert.doesNotThrow(() => api.receive({ kind: "ticks", list: [{ snap: { get tick() { throw new Error("bad tick"); } }, events: [] }, good] }));
    api.receive({ kind: "end", reason: "died" });
    const r = (await api.rounds())[0];
    assert.ok(r && r.shots.length === 1 && r.shots[0].part === "head", "the tick after the bad one was still recorded");
    fakeNow = null;
  });
  await test("engagements(), nearMisses() and fightCells() with rounds: N read only the newest N rounds", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    for (let i = 0; i < 3; i++) {
      begin(api, TODAY + i * 1000, "bind", "vandal");
      await roundOf(api, [[tickSnap(1, { actors: [enemy(1, 0, -10)] }), [miss(1, near(0, 2.3, 0), ahead)]], [tickSnap(2, { actors: [enemy(1, 0, -10, { alive: false })] }), [{ kind: "kill", tick: 2, actorId: 1 }]]]);
    }
    assert.strictEqual((await api.engagements()).length, 3);
    const two = await api.engagements({ rounds: 2 });
    assert.deepStrictEqual(two.map((e) => e.at), [TODAY + 1000, TODAY + 2000], "the newest two rounds, oldest first");
    assert.strictEqual((await api.nearMisses({ rounds: 1 })).length, 1);
    assert.strictEqual((await api.fightCells({ rounds: 2 })).total + (await api.fightCells({ rounds: 2 })).withoutPosition, 2);
    assert.strictEqual((await api.engagements({ rounds: 500 })).length, 3);
    assert.strictEqual((await api.engagements({ rounds: 2, limit: 1 })).length, 1, "rounds and limit work together");
    fakeNow = null;
  });
  await test("signed yaw error: a target to the right of the crosshair gives a negative yaw error, to the left a positive one", async () => {
    const run = async (x) => {
      const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
      begin(api, TODAY);
      const r = await roundOf(api, [[tickSnap(0, { yaw: 0, actors: [enemy(7, x, -10)] }), []], [tickSnap(1, { yaw: 0, actors: [enemy(7, x, -10)] }), [miss(1, near(0, 1.75, 0), ahead)]]]);
      return r.engagements[0].aimError.yaw;
    };
    closeTo(await run(5), -26.57, 0.05, "enemy at x=+5 (right)");
    closeTo(await run(-5), 26.57, 0.05, "enemy at x=-5 (left)");
    fakeNow = null;
  });

  // ---- shots that do not count: after the player's death, and at an enemy just killed (POST_KILL_S) ----
  // Player at the origin looking along -z; enemy 1 at z=-10 (straight ahead), enemy 2 at x=6, z=-10 (far off the line). dt = 1/128 s, so
  // POST_KILL_S = 0.35 s is 44.8 ticks: a shot 44 ticks after the kill is inside the window, 45 is outside.
  const burst = (tick, extra = {}) => miss(tick, near(0, 1.75, 0), ahead, null, extra);
  const killScene = (shotTick, shotEvent) => [
    [tickSnap(1, { actors: [enemy(1, 0, -10), enemy(2, 6, -10)] }), [burst(1)]],
    [tickSnap(10, { actors: [enemy(1, 0, -10, { alive: false }), enemy(2, 6, -10)] }), [{ kind: "kill", tick: 10, actorId: 1 }]],
    [tickSnap(shotTick, { actors: [enemy(1, 0, -10, { alive: false }), enemy(2, 6, -10)] }), [shotEvent]],
  ];

  await test("POST_KILL_S is 0.35 and exposed in thresholds", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    assert.strictEqual(api.thresholds.POST_KILL_S, 0.35);
  });

  await test("a shot after the player's death is not a shot row; one before the death event in the same tick is", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY);
    const r = await roundOf(api, [
      [tickSnap(1, { actors: [enemy(2, 6, -10)] }), [burst(1)]],
      [tickSnap(5, { actors: [enemy(2, 6, -10)] }), [burst(5), { kind: "playerDead", tick: 5 }, burst(5)]], // the second one is after the death event
      [tickSnap(6, { actors: [enemy(2, 6, -10)] }), [burst(6)]],
      [tickSnap(7, { actors: [enemy(2, 6, -10)] }), [burst(7)]],
    ], "died");
    assert.deepStrictEqual(r.shots.map((s) => s.tick), [1, 5], "the shots at ticks 1 and 5 (before the death event) only");
    assert.strictEqual(r.deaths.length, 1);
    assert.strictEqual(r.droppedAfterDeath, 3); assert.strictEqual(r.droppedAfterKill, 0);
    fakeNow = null;
  });

  await test("a shot after a kill of the same enemy within the window is not a row, and is neither a miss nor a near miss", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY);
    const r = await roundOf(api, killScene(14, burst(14)));
    assert.deepStrictEqual(r.shots.map((s) => s.tick), [1], "only the shot before the kill");
    assert.strictEqual(r.nearMisses.length, 1, "only the near miss of the tick 1 shot");
    assert.strictEqual(r.droppedAfterKill, 1); assert.strictEqual(r.droppedAfterDeath, 0);
    // also a shot that names the dead enemy as its hit target, and the last tick of the window (44 ticks = 0.344 s)
    const { api: api2 } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api2, TODAY);
    const r2 = await roundOf(api2, killScene(54, burst(54)));
    assert.deepStrictEqual(r2.shots.map((s) => s.tick), [1], "tick 54 is 44 ticks = 0.344 s after the kill: inside the window");
    const { api: api3 } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api3, TODAY);
    const r3 = await roundOf(api3, killScene(12, burst(12, { hitActorId: 1, hitPart: "body", hitPoint: near(0, 1, -10) })));
    assert.deepStrictEqual(r3.shots.map((s) => s.tick), [1], "a shot whose hit target is the dead enemy is dropped too");
    fakeNow = null;
  });

  await test("a shot at a different enemy after a kill is a row (also at a wall); the killing shot and a shot on the kill tick are kept", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY);
    // aimed at enemy 2 (x=6): direction toward its centre
    const toTwo = { x: 6, y: 0, z: -10 };
    const r = await roundOf(api, [
      ...killScene(14, burst(14, { direction: toTwo })).slice(0, 2),
      [tickSnap(12, { actors: [enemy(1, 0, -10, { alive: false }), enemy(2, 6, -10)] }), [burst(12, { direction: toTwo }), miss(12, near(0, 1.75, 0), { x: -1, y: 0, z: 0 }, near(-5, 1.75, 0))]],
    ]);
    assert.deepStrictEqual(r.shots.map((s) => s.tick), [1, 12, 12], "a shot at enemy 2 and a shot at a wall are recorded");
    assert.strictEqual(r.droppedAfterKill, 0);
    // the shot on the kill's own tick (listed before the kill event, as the killing shot is) is kept
    const { api: api2 } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api2, TODAY);
    const r2 = await roundOf(api2, [[tickSnap(10, { actors: [enemy(1, 0, -10, { alive: false })] }), [burst(10, { hitActorId: 1, hitPart: "head", hitPoint: near(0, 1.7, -10) }), { kind: "kill", tick: 10, actorId: 1 }, burst(10)]]]);
    assert.strictEqual(r2.shots.length, 2, "both shots on the kill tick are kept");
    assert.strictEqual(r2.shots[0].killed, true);
    fakeNow = null;
  });

  await test("a shot just outside the window (45 ticks = 0.352 s after the kill) at the same enemy is a row", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY);
    const r = await roundOf(api, killScene(55, burst(55)));
    assert.deepStrictEqual(r.shots.map((s) => s.tick), [1, 55]);
    assert.strictEqual(r.droppedAfterKill, 0);
    fakeNow = null;
  });

  await test("a shot at an enemy that is no longer in the snapshot after its kill is still dropped (its last position is remembered)", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY);
    const r = await roundOf(api, [
      [tickSnap(1, { actors: [enemy(1, 0, -10)] }), [burst(1)]],
      [tickSnap(10, { actors: [enemy(1, 0, -10, { alive: false })] }), [{ kind: "kill", tick: 10, actorId: 1 }]],
      [tickSnap(13, { actors: [] }), [burst(13)]],
    ]);
    assert.deepStrictEqual(r.shots.map((s) => s.tick), [1]);
    fakeNow = null;
  });

  // ---- tracking (18 Nov 2026): a strafing enemy 10 m away, 6 m sideways in one second ----
  // lagDeg = how far the crosshair trails the enemy along its path (0 = dead on the centre).
  async function strafeRound(lagDeg) {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY);
    const list = [], N = 128, x = (k) => -3 + (6 * k) / N;
    for (let k = 0; k <= N; k++) {
      // the enemy moves to the right (x grows), so the yaw to it falls; trailing it means a yaw that is still a little larger
      const yaw = Math.atan2(-x(k), 10) + lagDeg * RAD;
      const pitch = Math.atan2(0.9 - 1.75, 10);
      list.push([tickSnap(k, { yaw, pitch, actors: [enemy(5, x(k), -10)] }), k === N ? [miss(N, near(0, 1.75, 0), ahead)] : []]);
    }
    const r = await roundOf(api, list, "time");
    return { r, raw: (await api.raw())[0].e[0] };
  }
  await test("tracking: a crosshair dead on a strafing enemy is on the body every sampled tick, locks fast, no lag", async () => {
    const { r, raw } = await strafeRound(0);
    const t = r.engagements[0].tracking;
    assert.ok(t, "tracking object");
    assert.strictEqual(raw[20].length, 11);
    assert.ok(t.samples > 100, "most ticks of a 1 s strafe are sampled: " + t.samples);
    assert.strictEqual(t.bodyOn, t.samples);
    assert.ok(t.headOn < t.samples, "the aim is at the body centre, not the head");
    assert.ok(t.bodyErrorSum / t.samples < 0.3, "mean body error is tiny");
    assert.ok(Math.abs(t.lagSum / t.samples) < 0.3, "no lag");
    assert.ok(t.lockBodySeconds !== null && t.lockBodySeconds <= 0.01, "locked from the first tick");
    assert.strictEqual(t.lockHeadSeconds, null, "never on the head");
  });
  await test("tracking: a crosshair 5 degrees behind the enemy is off the body, lags by about 5 degrees, never locks", async () => {
    const { r } = await strafeRound(5);
    const t = r.engagements[0].tracking;
    assert.ok(t && t.samples > 100);
    assert.strictEqual(t.bodyOn, 0);
    closeTo(t.lagSum / t.samples, 5, 0.6, "mean lag (positive = behind)");
    closeTo(t.bodyErrorSum / t.samples, 5, 0.6, "mean body error");
    assert.strictEqual(t.lockBodySeconds, null);
  });
  await test("tracking: a crosshair 5 degrees AHEAD of the enemy has a negative lag", async () => {
    const { r } = await strafeRound(-5);
    const t = r.engagements[0].tracking;
    closeTo(t.lagSum / t.samples, -5, 0.6, "mean lag (negative = ahead)");
  });
  await test("tracking: a standing enemy is not sampled (it only gets a lock time)", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY);
    const list = [];
    for (let k = 0; k <= 40; k++) list.push([tickSnap(k, { yaw: 0, pitch: Math.atan2(0.9 - 1.75, 10), actors: [enemy(5, 0, -10)] }), k === 40 ? [miss(40, near(0, 1.75, 0), ahead)] : []]);
    const r = await roundOf(api, list, "time");
    const t = r.engagements[0].tracking;
    assert.ok(t && t.samples === 0 && t.lockBodySeconds !== null, "no moving samples, but a lock time");
  });

  await test("sphere targets: the round header keeps each sphere template's radius (recorded, else 0.36 per headSize); expand gives targetShapes / targetRadii", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    fakeNow = TODAY;
    api.start({ id: "scene-sph", map: "range", weapon: "vandal", mode: "score", dt: 1 / 128, kinds: [[1, "sphere", 0.5, 1], [2, "sphere", null, 2], [3, "humanoid", null, 1]] });
    const hitOn = (tick, id) => ({ kind: "shot", tick, hitActorId: id, hitPart: "body", hitPoint: near(0, 1, -10), origin: near(0, 1.75, 0), direction: { x: 0, y: -0.075, z: -1 } });
    const sphere = (id, tmpl) => ({ id, templateId: tmpl, bornTick: 0, position: { x: 0, y: 1, z: -10 }, scale: 1, alive: true, visible: true });
    const list = [[tickSnap(0, { actors: [sphere(1, 1), sphere(2, 2), enemy(3, 4, -10, { templateId: 3 })] }), [hitOn(0, 1), hitOn(0, 2), hitOn(0, 3)]]];
    const r = await roundOf(api, list);
    assert.deepStrictEqual(r.targetShapes, { 1: "sphere", 2: "sphere", 3: "humanoid" });
    assert.deepStrictEqual(r.targetRadii, { 1: 0.5, 2: 0.72 });
    const rawRound = (await api.raw())[0];
    assert.deepStrictEqual(rawRound.KR, { 1: 0.5, 2: 0.72 });
    fakeNow = null;
  });
  await test("sphere targets: a round with no sphere has no KR and empty targetRadii", async () => {
    const { api } = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    begin(api, TODAY);
    const r = await roundOf(api, [[tickSnap(0, { actors: [enemy(1, 0, -10)] }), [miss(0, near(0, 1.75, 0), ahead)]]]);
    assert.deepStrictEqual(r.targetRadii, {});
    assert.strictEqual((await api.raw())[0].KR, undefined);
  });

  const failed = results.filter((r) => !r[1]).length;
  console.log(failed ? failed + " FAILED of " + results.length : "all " + results.length + " tests passed");
  process.exit(failed ? 1 : 0);
})();
