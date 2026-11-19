// Test for the clearing rules: the look list of app/analytics-recorder.js and clear-deaths / over-checked / wasted-swings of app/coach.js.
// Run: node test-clearing.cjs
process.env.TZ = "UTC";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { makeFactory, IDBKeyRange } = require("./fake-idb.cjs");

const COACH = fs.readFileSync(path.join(__dirname, "..", "app", "coach.js"), "utf-8");
const SRC = fs.readFileSync(path.join(__dirname, "..", "app", "analytics-recorder.js"), "utf-8");
const NOW = Date.parse("2026-11-17T12:00:00Z");
const REAL_NOW = Date.now.bind(Date);
let fakeNow = null;
Date.now = () => (fakeNow == null ? NOW : fakeNow);
const at = (day) => Date.parse(day + "T12:00:00Z");

// ---------- coach ----------
function loadCoach(analytics) {
  const win = { __aimAnalytics: analytics };
  new Function("window", COACH)(win);
  return win.__aimCoach;
}
const stub = (rounds) => ({ rounds: async (f) => rounds.filter((r) => (!f.code || r.code === f.code) && (!f.map || r.map === f.map)).slice(-(f.limit || 1e9)), days: async () => [] });
const run = async (rounds, filter) => loadCoach(stub(rounds)).insights(filter || {});
const find = (list, id) => list.find((f) => f.id === id || f.id.startsWith(id + ":"));
const T = loadCoach(stub([])).thresholds;
const round = (o = {}) => ({ id: "r" + Math.random(), day: "2026-11-15", at: at("2026-11-15"), code: "drillA", map: "bind", mode: "score", tickSeconds: 1 / 128, sight: true, shots: [], deaths: [], engagements: [], nearMisses: [], ...o });
const rep = (n, make) => Array.from({ length: n }, (_, i) => make(i));
let nextId = 1;
// One lost fight: the player at the origin, the enemy `bearing` degrees away (the game's yaw convention: 0 = along -z, 90 = along -x), 10 m off;
// the death at deathTick. `withPos: false` = an engagement with no positions.
function lostFight(bearing, deathTick, withPos = true) {
  const id = nextId++, b = bearing * Math.PI / 180;
  const e = { enemyId: id, startTick: 10, killed: false, killTick: null, contactTick: 20, playerContact: withPos ? { x: 0, z: 0 } : null, enemyContact: withPos ? { x: -10 * Math.sin(b), z: -10 * Math.cos(b) } : null };
  return { e, d: { tick: deathTick, cause: "shot", killerId: id, position: { x: 0, y: 0, z: 0 } } };
}
const withLook = (fights, look, o = {}) => round({ engagements: fights.map((f) => f.e), deaths: fights.map((f) => f.d), look, lookTruncated: false, ...o });

const results = [];
async function test(name, fn) {
  try { await fn(); results.push([name, true]); console.log("ok   " + name); }
  catch (e) { results.push([name, false]); console.log("FAIL " + name + "\n     " + (e && e.stack || e)); }
}

// ---------- recorder ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function makeLocalStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
function boot({ idb, ls }) {
  const listeners = {};
  const win = { addEventListener: (n, f) => (listeners[n] = listeners[n] || []).push(f), indexedDB: idb, IDBKeyRange };
  const shortTimeout = (fn, ms) => setTimeout(fn, ms >= 1000 ? 5 : ms);
  new Function("window", "localStorage", "setTimeout", "console", SRC)(win, ls, shortTimeout, { warn() {}, log() {} });
  return win.__aimAnalytics;
}
const DEG = Math.PI / 180;
// A round whose yaw (degrees) comes from yawAt(tick), one snapshot per tick 0..ticks-1, with one shot at tick 5 so the round is stored.
function playLook(api, yawAt, ticks, extra = {}) {
  fakeNow = NOW;
  api.start({ id: "scene-look", map: "bind", weapon: "vandal", mode: "score", dt: 1 / 128, kinds: [[1, "humanoid"]], ...extra });
  for (let t = 0; t < ticks; t++) {
    const events = t === 5 ? [{ kind: "shot", tick: 5, hitActorId: null, origin: { x: 0, y: 1.75, z: 0 } }] : [];
    api.feed({ tick: t, actors: [], player: { weapon: "vandal", position: { x: 0, y: 0, z: 0 }, yaw: yawAt(t) * DEG, pitch: 0 } }, events);
  }
  api.end("died");
}

(async () => {
  // ----- constants -----
  await test("thresholds export the clearing constants with the guessed values, all labelled (a guess, untuned)", async () => {
    const want = { CLEAR_WINDOW_S: 8, CLEAR_ARC_DEG: 45, CLEAR_DEATHS_MIN: 10, CLEAR_DEATH_SHARE: 0.5, CLEAR_SECTOR_SHARE: 0.4, CHECK_MIN_S: 4, CHECK_ROUNDS_MIN: 10, CHECK_ENEMIES_MIN: 20, WASTE_ARC_DEG: 3, WASTE_SHARE: 0.25, WASTE_SHOTS_MIN: 100 };
    for (const [k, v] of Object.entries(want)) {
      assert.strictEqual(T[k], v, k);
      assert.ok(new RegExp("const " + k + " = [^\\n]*\\(a guess, untuned\\)").test(COACH), k + " not labelled");
    }
  });

  // ----- clear-deaths -----
  const LEFT = 90; // an enemy along -x: bearing 90, i.e. 78.75 degrees from the sector 0 centre (11.25)
  await test("clear-deaths: an unchecked death is flagged, and the sector is named (relative to the facing)", async () => {
    const fights = rep(12, (i) => lostFight(LEFT, 1000 + i));
    const out = find(await run([withLook(fights, [[0, 0]])]), "clear-deaths");
    assert.ok(out, "no tip");
    assert.strictEqual(out.title, "Most of your deaths came from angles you never checked");
    assert.strictEqual(out.severity, "tip");
    for (const k of ["id", "title", "detail", "severity", "evidence", "sample"]) assert.ok(k in out, k);
    assert.strictEqual(out.sample, 12);
    assert.strictEqual(out.evidence.uncheckedDeaths, 12);
    assert.strictEqual(out.evidence.sector, "your left");
    assert.ok(out.detail.includes("You keep dying to your left without checking it"), out.detail);
  });

  await test("clear-deaths: a death with a recent look in the arc is not flagged; a look older than the window does not count", async () => {
    // 12 deaths at tick 1000 (7.8 s): looking at yaw 101 (sector 4) from tick 900, bearing 90 is 11 degrees off: all checked
    assert.ok(!find(await run([withLook(rep(12, () => lostFight(LEFT, 1000)), [[0, 0], [900, 4]])]), "clear-deaths"));
    // the look at sector 4 is held from tick 0 and a later change away from it at tick 200: deaths at 1000 (7.8 s) still see it in the window ...
    assert.ok(!find(await run([withLook(rep(12, () => lostFight(LEFT, 1000)), [[0, 4], [200, 0]])]), "clear-deaths"), "inside the window");
    // ... but at tick 2000 (15.6 s) it is out of the window (the sector in effect at the window start, 976, is sector 0)
    const late = find(await run([withLook(rep(12, () => lostFight(LEFT, 2000)), [[0, 4], [200, 0]])]), "clear-deaths");
    assert.ok(late, "older than the window");
    assert.strictEqual(late.evidence.uncheckedDeaths, 12);
    // a look held since before the window start counts (the list stores changes only)
    assert.ok(!find(await run([withLook(rep(12, () => lostFight(LEFT, 5000)), [[0, 4]])]), "clear-deaths"), "held look");
    // a look in the 45 degree arc: sector 2 centre is 56.25, 33.75 from the bearing 90: counts; sector 0 (centre 11.25, 78.75 off) does not
    assert.ok(!find(await run([withLook(rep(12, () => lostFight(LEFT, 1000)), [[0, 2]])]), "clear-deaths"), "inside the arc");
  });

  await test("clear-deaths: the share and the minimum", async () => {
    const r = withLook([...rep(6, () => lostFight(LEFT, 1000)), ...rep(6, () => lostFight(LEFT, 300))], [[0, 0], [500, 0]]);
    assert.strictEqual(find(await run([r]), "clear-deaths").evidence.uncheckedPercent, 100);
    const half = withLook([...rep(6, () => lostFight(LEFT, 1000)), ...rep(6, () => lostFight(LEFT, 3000))], [[0, 0], [200, 4], [400, 0]]); // 1000: sector 4 is in the window (checked); 3000: out of it (unchecked)
    const out = find(await run([half]), "clear-deaths");
    assert.ok(out, "exactly 6 of 12 unchecked is 50%: enough");
    assert.strictEqual(out.evidence.uncheckedDeaths, 6);
    const under = withLook([...rep(5, () => lostFight(LEFT, 3000)), ...rep(7, () => lostFight(LEFT, 1000))], [[0, 0], [200, 4], [400, 0]]);
    assert.ok(!find(await run([under]), "clear-deaths"), "5 of 12");
    assert.ok(!find(await run([withLook(rep(9, () => lostFight(LEFT, 1000)), [[0, 0]])]), "clear-deaths"), "9 deaths is under the minimum");
    assert.ok(find(await run([withLook(rep(10, () => lostFight(LEFT, 1000)), [[0, 0]])]), "clear-deaths"), "10 deaths is enough");
    assert.ok(!find(await run([withLook(rep(12, () => lostFight(LEFT, 1000)), [[0, 0]])], { weapon: "vandal" }), "clear-deaths"), "weapon filter");
  });

  await test("clear-deaths: the tip stands without a named sector when the unchecked deaths are spread out", async () => {
    // facing sector 0 (centre 11.25): bearing 90 = left, 270 = right, 180 = behind; 3 + 3 + 2 unchecked, top share 3/8 = 37.5% < 40%
    const f = [...rep(3, () => lostFight(90, 1000)), ...rep(3, () => lostFight(270, 1000)), ...rep(2, () => lostFight(180, 1000)), ...rep(2, () => lostFight(10, 1000))]; // the last two are checked (bearing 10 is in front)
    const out = find(await run([withLook(f, [[0, 0]])]), "clear-deaths");
    assert.ok(out, "no tip");
    assert.strictEqual(out.evidence.uncheckedDeaths, 8);
    assert.strictEqual(out.evidence.sector, null);
    assert.ok(!out.detail.includes("You keep dying to"));
    assert.deepStrictEqual(out.evidence.sectors.map((s) => s.sector).sort(), ["behind you", "your left", "your right"]);
    // the other relative names: behind, right
    const right = find(await run([withLook(rep(12, () => lostFight(270, 1000)), [[0, 0]])]), "clear-deaths");
    assert.strictEqual(right.evidence.sector, "your right");
    const behind = find(await run([withLook(rep(12, () => lostFight(180, 1000)), [[0, 0]])]), "clear-deaths");
    assert.strictEqual(behind.evidence.sector, "behind you");
    // the facing changes the relative name: facing sector 8 (centre 191.25, looking toward +z) puts a bearing-270 enemy to the... 270 - 191 = 79 = left
    const turned = find(await run([withLook(rep(12, () => lostFight(270, 1000)), [[0, 8]])]), "clear-deaths");
    assert.strictEqual(turned.evidence.sector, "your left");
  });

  await test("clear-deaths: a round with no look field (an old row) is skipped, and so are deaths that cannot be placed or that are falls", async () => {
    const f = rep(12, () => lostFight(LEFT, 1000));
    assert.deepStrictEqual((await run([round({ engagements: f.map((x) => x.e), deaths: f.map((x) => x.d) })])).filter((x) => x.id === "clear-deaths"), [], "no look field");
    assert.ok(!find(await run([round({ engagements: f.map((x) => x.e), deaths: f.map((x) => x.d), look: null })]), "clear-deaths"), "look null");
    assert.ok(!find(await run([round({ engagements: f.map((x) => x.e), deaths: f.map((x) => x.d), look: [] })]), "clear-deaths"), "empty look list");
    // old-row rounds do not count toward the minimum or the share, new rows still work next to them
    const mixed = await run([round({ engagements: f.map((x) => x.e), deaths: f.map((x) => x.d) }), withLook(rep(10, () => lostFight(LEFT, 1000)), [[0, 0]])]);
    assert.strictEqual(find(mixed, "clear-deaths").evidence.deathsTested, 10);
    // a killer whose engagement has no positions, falls, and a death before the first look sample are left out
    const nopos = rep(12, () => lostFight(LEFT, 1000, false));
    assert.ok(!find(await run([withLook(nopos, [[0, 0]])]), "clear-deaths"), "no position");
    const fell = f.map((x) => ({ ...x.d, cause: "fell", killerId: null }));
    assert.ok(!find(await run([round({ engagements: f.map((x) => x.e), deaths: fell, look: [[0, 0]] })]), "clear-deaths"), "falls");
    assert.ok(!find(await run([withLook(rep(12, () => lostFight(LEFT, 50)), [[100, 0]])]), "clear-deaths"), "death before the first sample");
    // start positions are the fallback when there is no contact position
    const startOnly = rep(12, () => { const x = lostFight(LEFT, 1000); x.e.playerStart = { x: 0, z: 0 }; x.e.enemyStart = x.e.enemyContact; x.e.playerContact = null; x.e.enemyContact = null; return x; });
    assert.ok(find(await run([withLook(startOnly, [[0, 0]])]), "clear-deaths"), "start positions");
    // a truncated look list does not say anything about deaths after its last change
    assert.ok(!find(await run([withLook(rep(12, () => lostFight(LEFT, 1000)), [[0, 0]], { lookTruncated: true })]), "clear-deaths"), "truncated");
  });

  // ----- over-checked -----
  // 10 rounds of one drill: 5 s looking along -x (sector 4 = yaw 90 = world sector 2), enemies only from +z (bearing 180 = world sector 4)
  const watcher = (n, bearing = 180, o = {}) => round({ code: "drillOC", look: [[0, 4]], lookTruncated: false, shots: [{ tick: 640, weapon: "vandal" }], engagements: rep(n, () => lostFight(bearing, 700).e), ...o });
  await test("over-checked: a note appears with enough rounds, naming the world sector, and stays at info severity", async () => {
    const out = find(await run(rep(10, () => watcher(3))), "over-checked");
    assert.ok(out, "no note");
    assert.strictEqual(out.severity, "info");
    assert.strictEqual(out.title, "You look at the -x direction a lot, and nothing has ever come from there");
    assert.strictEqual(out.evidence.roundsLookedAt, 10);
    assert.strictEqual(out.evidence.enemiesPlaced, 30);
    assert.ok(/a note, not a fact/i.test(out.detail));
  });

  await test("over-checked: needs enough rounds, enough looking, enough placed enemies, and no enemy in or next to the sector", async () => {
    assert.ok(!find(await run(rep(9, () => watcher(3))), "over-checked"), "9 rounds");
    assert.ok(find(await run(rep(10, () => watcher(2))), "over-checked"), "exactly 20 enemies placed is enough");
    assert.ok(!find(await run(rep(10, () => watcher(1))), "over-checked"), "10 enemies placed is not");
    const short = rep(10, () => watcher(3, 180, { shots: [{ tick: 400, weapon: "vandal" }] })); // 3.1 s
    assert.ok(!find(await run(short), "over-checked"), "under 4 s");
    const exactly = rep(10, () => watcher(3, 180, { shots: [{ tick: 512, weapon: "vandal" }] })); // exactly 4 s
    assert.ok(find(await run(exactly), "over-checked"), "exactly 4 s");
    const one = [...rep(9, () => watcher(3)), watcher(3, 90)]; // one round with an enemy from the sector
    assert.ok(!find(await run(one), "over-checked"), "an enemy once in the sector");
    const beside = [...rep(9, () => watcher(3)), watcher(3, 45)]; // from the neighbour sector
    assert.ok(!find(await run(beside), "over-checked"), "an enemy in the next sector");
    const elsewhere = [...rep(9, () => watcher(3)), watcher(3, 270)]; // 270 is world sector 6, two away from sector 2 (neighbours 1 and 3): the note stays
    assert.ok(find(await run(elsewhere), "over-checked"), "an enemy two sectors away");
    assert.ok(!find(await run(rep(10, () => watcher(3)), { weapon: "vandal" }), "over-checked"), "weapon filter");
  });

  await test("over-checked: rounds without look data or with truncated lists add nothing", async () => {
    const old = rep(10, () => watcher(3, 180, { look: undefined }));
    assert.ok(!find(await run(old), "over-checked"), "no look field");
    assert.ok(!find(await run(rep(10, () => watcher(3, 180, { lookTruncated: true }))), "over-checked"), "truncated");
    assert.ok(!find(await run(rep(10, () => watcher(3, 180, { engagementsTruncated: true }))), "over-checked"), "engagement list truncated");
    // the rule groups by drill: 5 + 5 rounds of two drills is not 10
    assert.ok(!find(await run([...rep(5, () => watcher(3)), ...rep(5, () => watcher(3, 180, { code: "other" }))]), "over-checked"), "split drills");
  });

  // ----- wasted-swings -----
  const shot = (o = {}) => ({ tick: 1, weapon: "vandal", part: null, aimYawDeg: 10, ...o });
  const hit = () => shot({ part: "body", nearestEnemy: { range: 10, centreDistance: 0.1, side: 0, vertical: 0 } });
  const nowhere = () => shot();
  const wasteRound = (hits, empties, extra = []) => round({ code: "drillW", shots: [...rep(hits, hit), ...rep(empties, nowhere), ...extra] });
  await test("wasted-swings: a quarter of the shots at nothing gives the tip; below the share or the minimum it does not", async () => {
    const out = find(await run([wasteRound(75, 25)]), "wasted-swings");
    assert.ok(out, "no tip");
    assert.strictEqual(out.title, "A quarter of your shots hit nothing near an enemy");
    assert.strictEqual(out.severity, "tip");
    assert.strictEqual(out.evidence.wastedShots, 25);
    assert.strictEqual(out.evidence.shots, 100);
    assert.ok(!find(await run([wasteRound(76, 24)]), "wasted-swings"), "24%");
    assert.ok(!find(await run([wasteRound(70, 24)]), "wasted-swings"), "94 shots is under the minimum");
    assert.strictEqual(find(await run([wasteRound(60, 40)]), "wasted-swings").title, "40% of your shots hit nothing near an enemy");
  });

  await test("wasted-swings: a miss close to an enemy is not wasted; a far one is; melee, shotguns and old rows do not count", async () => {
    const closeMiss = shot({ nearestEnemy: { range: 10, centreDistance: 0.5, side: 0.5, vertical: 0 } }); // 2.9 degrees
    const farMiss = shot({ nearestEnemy: { range: 10, centreDistance: 0.6, side: 0.6, vertical: 0 } }); // 3.4 degrees
    assert.ok(!find(await run([round({ shots: [...rep(100, hit), ...rep(40, () => closeMiss)] })]), "wasted-swings"), "close misses are near an enemy");
    assert.ok(find(await run([round({ shots: [...rep(60, hit), ...rep(40, () => farMiss)] })]), "wasted-swings"), "far misses are wasted");
    const guns = await run([wasteRound(75, 25, [...rep(50, () => shot({ weapon: "melee" })), ...rep(50, () => shot({ weapon: "judge", pellets: { fired: 8, hit: 0, head: 0 } }))])]);
    assert.strictEqual(find(guns, "wasted-swings").evidence.shots, 100, "melee and shotgun shots are not counted");
    const oldRows = round({ code: "drillW", shots: [...rep(75, () => ({ tick: 1, weapon: "vandal", part: "body" })), ...rep(25, () => ({ tick: 1, weapon: "vandal", part: null }))] }); // no aimYawDeg: no nearestEnemy yet
    assert.ok(!find(await run([oldRows]), "wasted-swings"), "old rows");
    // per drill: 60 + 60 shots of two drills do not add up
    assert.ok(!find(await run([round({ code: "a", shots: [...rep(30, hit), ...rep(30, nowhere)] }), round({ code: "b", shots: [...rep(30, hit), ...rep(30, nowhere)] })]), "wasted-swings"), "split drills");
    assert.ok(!find(await run([wasteRound(75, 25)], { weapon: "judge" }), "wasted-swings"), "weapon filter");
  });

  await test("the clearing rules return nothing for no data, and never reject on odd rows", async () => {
    for (const data of [[], [round()], [round({ look: "x", deaths: [{ tick: 1, cause: "shot", killerId: 1 }] })], [round({ look: [[1]], deaths: [{ cause: "shot", killerId: 1 }] })], [round({ look: [[0, 0]], shots: [{ tick: 1 }] })]]) {
      const o = await run(data);
      for (const id of ["clear-deaths", "over-checked", "wasted-swings"]) assert.ok(!find(o, id), id);
    }
  });

  // ----- recorder -----
  await test("recorder: the look list stores only changes of the 22.5 degree yaw sector, sampled every 250 ms", async () => {
    const a = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    assert.strictEqual(a.thresholds.LOOK_SAMPLE_MS, 250); assert.strictEqual(a.thresholds.LOOK_SECTORS, 16); assert.strictEqual(a.thresholds.MAX_LOOK, 2000);
    // yaw 0 .. tick 99; yaw 90 from tick 100; yaw 5 (same sector as 0) never; yaw -10 (= 350, sector 15) from tick 160; wiggle inside sector 15 for the rest
    const yawAt = (t) => (t < 100 ? 0 : t < 160 ? 90 : 350 + (t % 3));
    playLook(a, yawAt, 260);
    const raw = await a.raw();
    assert.strictEqual(raw.length, 1);
    // samples at ticks 0, 32, 64, 96, 128 (yaw 90 -> sector 4), 160 (yaw 350 -> sector 15), then 192, 224, 256: still sector 15 (350..352)
    assert.deepStrictEqual(raw[0].L, [[0, 0], [128, 4], [160, 15]]);
    assert.ok(!("cutL" in raw[0]), "no cut flag");
    assert.ok(!("lookTick" in raw[0]) && !("lookSector" in raw[0]), "working state is not stored");
    const rounds = await a.rounds();
    assert.deepStrictEqual(rounds[0].look, [[0, 0], [128, 4], [160, 15]]);
    assert.strictEqual(rounds[0].lookTruncated, false);
    // existing row layouts are untouched
    assert.strictEqual(raw[0].s.length, 1); assert.strictEqual(raw[0].s[0][0], 5);
    assert.strictEqual(rounds[0].shots[0].aimYawDeg, 0);
  });

  await test("recorder: a stand-still round stores one pair; the sector edges follow the game's yaw convention; a different dt changes the interval", async () => {
    const a = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    playLook(a, () => 12, 300);
    assert.deepStrictEqual((await a.raw())[0].L, [[0, 0]], "yaw 12 is sector 0 (0..22.5): one pair for the whole round");
    const b = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    playLook(b, (t) => (t < 40 ? 22.4 : 22.5), 200);
    assert.deepStrictEqual((await b.raw())[0].L, [[0, 0], [64, 1]], "22.5 starts sector 1; sampled every 32 ticks");
    const c = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    playLook(c, (t) => (t < 40 ? 0 : 180), 200, { dt: 1 / 64 }); // 250 ms = 16 ticks at 64 Hz
    assert.deepStrictEqual((await c.raw())[0].L, [[0, 0], [48, 8]]);
  });

  await test("recorder: the list is capped at 2000 changes and the round says so (cutL)", async () => {
    const a = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    playLook(a, (t) => (Math.floor(t / 32) % 2) * 90, 32 * 2100);
    const r = (await a.raw())[0];
    assert.strictEqual(r.L.length, 2000);
    assert.strictEqual(r.cutL, 1);
    assert.strictEqual((await a.rounds())[0].lookTruncated, true);
  });

  await test("recorder: a round with no yaw in its snapshots has no look field, and an old stored row without it still reads", async () => {
    const a = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    fakeNow = NOW;
    a.start({ id: "scene-x", map: "bind", weapon: "vandal", mode: "score", dt: 1 / 128, kinds: [] });
    a.feed({ tick: 1, actors: [], player: { weapon: "vandal", position: { x: 0, y: 0, z: 0 } } }, [{ kind: "shot", tick: 1, hitActorId: null, origin: { x: 0, y: 1.75, z: 0 } }]);
    a.end("died");
    const r = (await a.raw())[0];
    assert.ok(!("L" in r), "no field");
    assert.strictEqual((await a.rounds())[0].look, null);
    // a legacy row (written before the field existed), migrated from the old localStorage key
    const legacy = { v: 1, at: at("2026-11-15"), code: "c1", map: "bind", mode: "score", wpn: "vandal", dt: 1 / 128, end: "died", W: ["vandal"], T: [1], K: {},
      s: [[10, 0, "head", 1, 2, 3, 10, 0, 1]], d: [[20, 5.5, 0, 6.5, -1, -1, null, "fell"]] };
    const b = boot({ idb: makeFactory(), ls: makeLocalStorage({ "aim-analytics-rounds-v1": JSON.stringify([legacy]) }) });
    let list = [];
    for (let i = 0; i < 100 && !list.length; i++) { await sleep(20); list = await b.rounds(); }
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].look, null);
    assert.strictEqual(list[0].lookTruncated, false);
    assert.strictEqual(list[0].shots.length, 1); assert.strictEqual(list[0].deaths[0].cause, "fell");
    // and the coach skips it
    assert.ok(!find(await run(list), "clear-deaths"));
  });

  await test("recorder to coach: look lists written by the recorder are read by clear-deaths (round trip)", async () => {
    const a = boot({ idb: makeFactory(), ls: makeLocalStorage() });
    // 12 rounds: the player looks along +z (yaw 180, sector 8) for the whole round while an enemy at -x (bearing 90) kills them
    for (let i = 0; i < 12; i++) {
      fakeNow = NOW + i * 1000;
      a.start({ id: "scene-rt", map: "bind", weapon: "vandal", mode: "score", dt: 1 / 128, kinds: [[1, "humanoid", null, 1]] });
      const enemy = (x) => ({ id: 7, templateId: 1, position: { x, y: 0, z: 0 }, alive: true, visible: true, bornTick: 0 });
      for (let t = 0; t < 400; t++) {
        const player = { weapon: "vandal", position: { x: 0, y: 0, z: 0 }, yaw: Math.PI, pitch: 0 };
        const ev = t === 300 ? [{ kind: "enemyShot", tick: 300, actorId: 7, damage: 50, healthAfter: 0, distance: 10, hit: true }, { kind: "playerDead", tick: 300 }] : [];
        a.feed({ tick: t, actors: [enemy(-10)], player }, ev);
      }
      a.end("died");
    }
    const rounds = await a.rounds({ code: "scene-rt" });
    assert.strictEqual(rounds.length, 12);
    assert.deepStrictEqual(rounds[0].look, [[0, 8]]);
    const win = { __aimAnalytics: { rounds: async () => rounds, days: async () => [] } };
    new Function("window", COACH)(win);
    const out = find(await win.__aimCoach.insights({}), "clear-deaths");
    assert.ok(out, "the coach found no clear-deaths tip: engagements " + JSON.stringify(rounds[0].engagements) + " deaths " + JSON.stringify(rounds[0].deaths));
    assert.strictEqual(out.evidence.uncheckedDeaths, 12);
    assert.strictEqual(out.evidence.sector, "your right"); // facing sector 8 (centre 191.25): bearing 90 is 101 degrees clockwise of it, i.e. to the right
  });

  const failed = results.filter(([, ok]) => !ok).length;
  console.log("\n" + (results.length - failed) + " of " + results.length + " passed");
  process.exit(failed ? 1 : 0);
})();
void REAL_NOW;
