// Test for the positioning rules of app/coach.js (fight-spot, fight-angle, hold-sooner). Run: node test-coach-position.cjs
process.env.TZ = "UTC";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const COACH = fs.readFileSync(path.join(__dirname, "..", "app", "coach.js"), "utf-8");
const NOW = Date.parse("2026-11-17T12:00:00Z");
Date.now = () => NOW;
const at = (day) => Date.parse(day + "T12:00:00Z");

function loadCoach(analytics) {
  const win = { __aimAnalytics: analytics };
  new Function("window", COACH)(win);
  return win.__aimCoach;
}
const stub = (rounds) => ({
  rounds: async (f) => rounds.filter((r) => (!f.code || r.code === f.code) && (!f.map || r.map === f.map)).slice(-(f.limit || 1e9)),
  days: async () => [],
});
const run = async (rounds, filter) => loadCoach(stub(rounds)).insights(filter || {});
const find = (list, id) => list.find((f) => f.id === id || f.id.startsWith(id + ":"));
const T = loadCoach(stub([])).thresholds;

const round = (o = {}) => ({ id: "r" + Math.random(), day: "2026-11-15", at: at(o.day || "2026-11-15"), code: "drillA", map: "bind", mode: "score", tickSeconds: 1 / 128, sight: true, shots: [], deaths: [], engagements: [], nearMisses: [], ...o });
// One fight: result "won" (kill) or "lost" (death by that enemy's shot) at a contact position; start 100, contact after `delay` ticks.
// `bearing` (degrees, the game's yaw convention: 0 = enemy along -z, 90 = along -x) places the enemy 10 m from the player.
let nextId = 1;
function fight(result, x, z, { delay = 20, weapon = "vandal", bearing = 0 } = {}) {
  const enemyId = nextId++, b = bearing * Math.PI / 180;
  const e = { enemyId, startTick: 100, seenTick: 100, killed: result === "won", killTick: result === "won" ? 400 : null, weapon, contactTick: 100 + delay, playerContact: { x, z },
    enemyContact: { x: x - 10 * Math.sin(b), z: z - 10 * Math.cos(b) }, timeToKill: null };
  const d = result === "lost" ? { tick: 300, cause: "shot", killerId: enemyId, position: { x, y: 0, z } } : null;
  return { e, d };
}
function roundOf(fights, o = {}) {
  return round({ engagements: fights.map((f) => f.e), deaths: fights.filter((f) => f.d).map((f) => f.d), ...o });
}
const rep = (n, make) => Array.from({ length: n }, (_, i) => make(i));
// n fights at one bearing, `lost` of them lost; player positions are spread so no fight-spot cluster forms
const at_ = (bearing, n, lost) => rep(n, (i) => fight(i < lost ? "lost" : "won", 10 + (i % 40) * 3, (bearing / 45) * 3 + 100 * ((i / 40) | 0), { bearing }));

const results = [];
async function test(name, fn) {
  try { await fn(); results.push([name, true]); console.log("ok   " + name); }
  catch (e) { results.push([name, false]); console.log("FAIL " + name + "\n     " + (e && e.stack || e)); }
}

(async () => {
  await test("thresholds export has the positioning constants, and they hold the guessed values", async () => {
    const want = { CELL_FIGHTS_MIN: 6, LOST_SPOT_SHARE: 0.7, ANGLE_FIGHTS_MIN: 12, ANGLE_LOSS_SHARE: 0.65, ANGLE_WIN_GAP: 20, ANGLE_WIN_SHARE: 0.7, HOLD_LOST_S: 1.5, HOLD_WON_S: 0.8, HOLD_FIGHTS_MIN: 8 };
    for (const [k, v] of Object.entries(want)) assert.strictEqual(T[k], v, k);
    for (const k of Object.keys(want)) assert.ok(new RegExp("const " + k + " = [^\\n]*\\(a guess, untuned\\)").test(COACH), k + " not labelled");
    assert.ok(!("PEEK_REPEAT_MIN" in T) && !("PEEK_SHARE" in T), "the same-peek constants are gone");
  });

  await test("fight-spot: a clear cluster gives the tip with the cell and the share", async () => {
    const f = [...rep(6, () => fight("lost", 12.3, -3.2)), ...rep(2, () => fight("won", 12.9, -3.9)), ...rep(4, (i) => fight("lost", 30 + i, 5)), ...rep(16, (i) => fight("won", 30 + (i % 8), 5))];
    const out = find(await run([roundOf(f)]), "fight-spot");
    assert.ok(out, "no tip");
    assert.strictEqual(out.title, "Fights lost from one spot");
    assert.strictEqual(out.severity, "tip");
    assert.strictEqual(out.sample, 8);
    for (const k of ["id", "title", "detail", "severity", "evidence", "sample"]) assert.ok(k in out, k);
    assert.strictEqual(out.evidence.cellX, 12);
    assert.strictEqual(out.evidence.cellZ, -4); // floor(-3.2) = -4
    assert.strictEqual(out.evidence.lostInCell, 6);
    assert.strictEqual(out.evidence.lostPercent, 75);
    assert.strictEqual(out.evidence.restFights, 20);
    assert.strictEqual(out.evidence.restLostPercent, 20);
    assert.ok(out.detail.includes("x 12.5 m") && out.detail.includes("75%"), out.detail);
  });

  await test("fight-spot: no tip when losses are spread out, or when the rest loses as much", async () => {
    const spread = rep(40, (i) => fight(i % 10 < 7 ? "lost" : "won", i % 8, 0));
    assert.ok(!find(await run([roundOf(spread)]), "fight-spot"), "spread out");
    const allBad = [...rep(6, () => fight("lost", 5, 5)), ...rep(2, () => fight("won", 5, 5)), ...rep(16, (i) => fight("lost", 20 + i, 0)), ...rep(4, (i) => fight("won", 20 + i, 0))];
    assert.ok(!find(await run([roundOf(allBad)]), "fight-spot"), "rest loses as much");
  });

  await test("fight-spot: minimums, share edge, and the edge cases", async () => {
    const rest = rep(10, (i) => fight("won", 20 + i, 0));
    assert.ok(!find(await run([roundOf([...rep(4, () => fight("lost", 5, 5)), fight("won", 5, 5), ...rest])]), "fight-spot"), "5 fights");
    assert.ok(!find(await run([roundOf([...rep(4, () => fight("lost", 5, 5)), ...rep(2, () => fight("won", 5, 5)), ...rest])]), "fight-spot"), "67%");
    assert.ok(find(await run([roundOf([...rep(5, () => fight("lost", 5, 5)), fight("won", 5, 5), ...rest])]), "fight-spot"), "6 fights, 83%");
    assert.ok(!find(await run([roundOf(rep(8, () => fight("lost", 5, 5)))]), "fight-spot"), "no other fights");
    const cluster = [...rep(6, () => fight("lost", 5, 5)), ...rep(2, () => fight("won", 5, 5)), ...rest];
    assert.ok(find(await run([roundOf(cluster)]), "fight-spot"));
    assert.ok(!find(await run([roundOf(cluster)], { weapon: "vandal" }), "fight-spot"), "weapon filter");
    assert.ok(!find(await run([roundOf(cluster, { engagementsTruncated: true })]), "fight-spot"), "truncated");
    const noPos = cluster.map((f) => ({ ...f, e: { ...f.e, playerContact: null } }));
    assert.ok(!find(await run([roundOf(noPos)]), "fight-spot"), "no contact position");
    const drift = rep(8, () => { const f = fight("lost", 5, 5); return { e: f.e, d: null }; });
    assert.ok(!find(await run([roundOf([...drift, ...rest])]), "fight-spot"), "undecided fights");
  });

  await test("fight-spot: cells are kept per map", async () => {
    const mk = (map) => roundOf([...rep(6, () => fight("lost", 5, 5)), ...rep(2, () => fight("won", 5, 5)), ...rep(10, (i) => fight("won", 20 + i, 0))], { map });
    const out = await run([mk("bind"), mk("haven")]);
    assert.deepStrictEqual(out.filter((f) => f.id.startsWith("fight-spot")).map((f) => f.id).sort(), ["fight-spot:bind", "fight-spot:haven"]);
    const split = [roundOf([...rep(3, () => fight("lost", 5, 5)), fight("won", 5, 5), ...rep(10, (i) => fight("won", 20 + i, 0))], { map: "bind" }),
      roundOf([...rep(3, () => fight("lost", 5, 5)), fight("won", 5, 5), ...rep(10, (i) => fight("won", 20 + i, 0))], { map: "haven" })];
    assert.ok(!find(await run(split), "fight-spot"));
  });

  await test("fight-angle: a losing sector gives the tip with the sector, the share and the gap", async () => {
    // enemy along -x (bearing 90): 14 fights, 10 lost (71%); along -z (bearing 0): 14 fights, 4 lost (win 71%)
    const out = await run([roundOf([...at_(90, 14, 10), ...at_(0, 14, 4)])]);
    const f = out.find((x) => x.id === "angle-lose:bind");
    assert.ok(f, "no losing-sector tip");
    assert.strictEqual(f.title, "You lose most fights from the -x direction on " + f.evidence.map);
    assert.strictEqual(f.severity, "tip");
    assert.strictEqual(f.sample, 14);
    for (const k of ["id", "title", "detail", "severity", "evidence", "sample"]) assert.ok(k in f, k);
    assert.strictEqual(f.evidence.sectorYawDeg, 90);
    assert.strictEqual(f.evidence.lost, 10);
    assert.strictEqual(f.evidence.lostPercent, 71);
    assert.strictEqual(f.evidence.bestSector, "the -z direction");
    assert.strictEqual(f.evidence.bestWinPercent, 71);
    assert.strictEqual(f.evidence.gapPoints, 43);
    assert.strictEqual(f.evidence.bearing, "world");
    assert.ok(f.detail.includes("71%"), f.detail);
  });

  await test("fight-angle: a winning sector gives the info note", async () => {
    const out = await run([roundOf([...at_(180, 15, 3), ...at_(270, 12, 5)])]);
    const f = out.find((x) => x.id === "angle-win:bind");
    assert.ok(f, "no winning-sector note");
    assert.strictEqual(f.title, "You win most fights from the +z direction on " + f.evidence.map);
    assert.strictEqual(f.severity, "info");
    assert.strictEqual(f.sample, 15);
    assert.strictEqual(f.evidence.winPercent, 80);
    assert.strictEqual(f.evidence.sectorYawDeg, 180);
    // 70% is the edge: 14 of 20 won
    assert.ok(find(await run([roundOf(at_(180, 20, 6))]), "angle-win"), "exactly 70%");
    assert.ok(!find(await run([roundOf(at_(180, 20, 7))]), "angle-win"), "65%");
  });

  await test("fight-angle: too few fights in a sector, no gap, or a weapon filter gives nothing", async () => {
    // 11 fights per sector: one short of ANGLE_FIGHTS_MIN, even with 10 of 11 lost on one side
    const thin = await run([roundOf([...at_(90, 11, 10), ...at_(0, 11, 1)])]);
    assert.ok(!find(thin, "angle-lose") && !find(thin, "angle-win"), "11 fights per sector");
    // 12 fights is enough
    assert.ok(find(await run([roundOf([...at_(90, 12, 9), ...at_(0, 12, 2)])]), "angle-lose"), "12 fights per sector");
    // the losing sector's best comparison has fewer than 12 fights: nothing to compare with, so the gap rule fails
    assert.ok(!find(await run([roundOf([...at_(90, 14, 10), ...at_(0, 11, 1)])]), "angle-lose"), "best sector under the minimum");
    // both sectors lose a lot: the gap (10 points) is under 20
    assert.ok(!find(await run([roundOf([...at_(90, 20, 15), ...at_(0, 20, 13)])]), "angle-lose"), "no gap");
    // loss share 64% is under 65%
    assert.ok(!find(await run([roundOf([...at_(90, 25, 16), ...at_(0, 25, 2)])]), "angle-lose"), "64% lost");
    assert.ok(find(await run([roundOf([...at_(90, 20, 13), ...at_(0, 20, 2)])]), "angle-lose"), "65% lost");
    assert.ok(!find(await run([roundOf([...at_(90, 14, 10), ...at_(0, 14, 4)])], { weapon: "vandal" }), "angle-lose"), "weapon filter");
  });

  await test("fight-angle: sector edges, per-map grouping, and rows it must skip", async () => {
    // sector 0 spans -22.5..22.5 degrees, sector 1 22.5..67.5
    const f44 = await run([roundOf([...at_(30, 14, 10), ...at_(0, 14, 2)])]);
    assert.strictEqual(find(f44, "angle-lose").evidence.sector, "the -z / -x diagonal", "30 degrees is the diagonal");
    const f20 = await run([roundOf([...at_(20, 14, 10), ...at_(-20, 14, 2)])]);
    assert.ok(!find(f20, "angle-lose") && !find(f20, "angle-win"), "20 and -20 degrees are both sector 0: 12 of 28 lost, no gap, no win share");
    // negative bearings wrap: -90 is +x
    assert.strictEqual(find(await run([roundOf([...at_(-90, 14, 10), ...at_(0, 14, 2)])]), "angle-lose").evidence.sector, "the +x direction");
    // the same sectors on two maps are not summed
    const split = [roundOf([...at_(90, 7, 5), ...at_(0, 14, 2)], { map: "bind" }), roundOf([...at_(90, 7, 5), ...at_(0, 14, 2)], { map: "haven" })];
    assert.ok(!find(await run(split), "angle-lose"), "7 + 7 fights on two maps");
    // fights with no enemy contact position, undecided fights and truncated rounds are skipped
    const base = [...at_(90, 14, 10), ...at_(0, 14, 4)];
    assert.ok(find(await run([roundOf(base)]), "angle-lose"));
    assert.ok(!find(await run([roundOf(base.map((f) => ({ ...f, e: { ...f.e, enemyContact: null } })))]), "angle-lose"), "no enemy position");
    assert.ok(!find(await run([roundOf(base.map((f) => ({ e: f.e, d: null })))]), "angle-lose"), "no deaths: lost fights undecided");
    assert.ok(!find(await run([roundOf(base, { engagementsTruncated: true })]), "angle-lose"), "truncated");
  });

  await test("hold-sooner: slow first contact in lost fights, quick in won fights, gives the tip", async () => {
    const f = [...rep(10, (i) => fight("lost", i * 4, 0, { delay: 256 })), ...rep(10, (i) => fight("won", i * 4, 9, { delay: 51 }))];
    const out = find(await run([roundOf(f)]), "hold-sooner");
    assert.ok(out, "no tip");
    assert.strictEqual(out.title, "Hold or move sooner");
    assert.strictEqual(out.severity, "tip");
    assert.strictEqual(out.sample, 20);
    for (const k of ["id", "title", "detail", "severity", "evidence", "sample"]) assert.ok(k in out, k);
    assert.strictEqual(out.evidence.lostAverageSeconds, 2);
    assert.strictEqual(out.evidence.wonAverageSeconds, 0.4);
    assert.strictEqual(out.evidence.lostFights, 10);
    assert.strictEqual(out.evidence.wonFights, 10);
  });

  await test("hold-sooner: no tip when lost fights are quick, won fights are slow, or the samples are small", async () => {
    const mk = (lostDelay, wonDelay, nl = 10, nw = 10) => [roundOf([...rep(nl, (i) => fight("lost", i * 4, 0, { delay: lostDelay })), ...rep(nw, (i) => fight("won", i * 4, 9, { delay: wonDelay }))])];
    assert.ok(find(await run(mk(256, 51)), "hold-sooner"));
    assert.ok(!find(await run(mk(100, 51)), "hold-sooner"), "lost fights 0.8 s: not over 1.5 s");
    assert.ok(!find(await run(mk(192, 51)), "hold-sooner"), "lost fights exactly 1.5 s: not over");
    assert.ok(!find(await run(mk(256, 200)), "hold-sooner"), "won fights 1.6 s: not short");
    assert.ok(!find(await run(mk(256, 51, 7, 10)), "hold-sooner"), "7 lost fights");
    assert.ok(!find(await run(mk(256, 51, 10, 7)), "hold-sooner"), "7 won fights");
    assert.ok(find(await run(mk(256, 51, 8, 8)), "hold-sooner"), "exactly the minimum");
    assert.ok(!find(await run(mk(256, 51), { weapon: "vandal" }), "hold-sooner"), "weapon filter");
    const old = mk(256, 51)[0];
    old.engagements = old.engagements.map((e) => ({ ...e, contactTick: null }));
    assert.ok(!find(await run([old]), "hold-sooner"), "no contact tick");
  });

  await test("no same-peek rule any more, and the positioning rules return nothing for empty or position-less rounds", async () => {
    const out = await run([roundOf(rep(20, () => fight("won", 7.5, 3.5)))]);
    assert.ok(!out.some((f) => f.id.startsWith("peek-repeat")), "peek-repeat is dropped");
    for (const data of [[], [round()], [round({ engagements: [{ enemyId: 1, startTick: 0, killed: true, killTick: 5 }] })]]) {
      const o = await run(data);
      for (const id of ["fight-spot", "fight-angle", "angle-lose", "angle-win", "hold-sooner"]) assert.ok(!find(o, id), id);
    }
  });

  const failed = results.filter(([, ok]) => !ok).length;
  console.log("\n" + (results.length - failed) + " of " + results.length + " passed");
  process.exit(failed ? 1 : 0);
})();
