// Test for app/coach.js. Run: node test-coach.cjs
// Synthetic expanded rounds / day rows feed the coach through a stub of window.__aimAnalytics; the last test runs the real recorder on the
// in-memory IndexedDB shim (fake-idb.cjs) to check that the field names the coach reads are the ones the recorder writes.
process.env.TZ = "UTC";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { makeFactory, IDBKeyRange } = require("./fake-idb.cjs");

const COACH = fs.readFileSync(path.join(__dirname, "..", "app", "coach.js"), "utf-8");
const RECORDER = fs.readFileSync(path.join(__dirname, "..", "app", "analytics-recorder.js"), "utf-8");
const REAL_NOW = Date.now.bind(Date);
const NOW = Date.parse("2026-11-17T12:00:00Z");
Date.now = () => NOW;
const at = (day) => Date.parse(day + "T12:00:00Z");

function loadCoach(analytics) {
  const win = { __aimAnalytics: analytics };
  new Function("window", COACH)(win);
  return win.__aimCoach;
}
// A stub recorder: rounds() honours code / map / limit, days() honours from / to.
function stub({ rounds = [], days = [] }) {
  const calls = [];
  return {
    calls,
    rounds: async (f) => { calls.push(f); return rounds.filter((r) => (!f.code || r.code === f.code) && (!f.map || r.map === f.map)).slice(-(f.limit || 1e9)); },
    days: async (f) => days.filter((d) => (!f.from || d.day >= f.from) && (!f.to || d.day <= f.to)),
  };
}
const run = async (data, filter) => loadCoach(stub(data)).insights(filter || {});
const find = (list, id) => list.find((f) => f.id === id);
const ids = (list) => list.map((f) => f.id);

// ---- builders (the expanded shape of __aimAnalytics.rounds()) ----
const round = (o = {}) => ({ id: "r" + Math.random(), day: "2026-11-15", at: at(o.day || "2026-11-15"), code: "drillA", map: "bind", mode: "score", tickSeconds: 1 / 128, shots: [], deaths: [], engagements: [], nearMisses: [], ...o });
const near = (n, side, off, weapon = "vandal") => Array.from({ length: n }, () => ({ weapon, side, verticalOffset: off, missDistance: 0.2 }));
const eng = (o = {}) => ({ enemyId: 1, startTick: 100, killed: true, killTick: 200, timeToKill: 0.8, aimError: { degrees: 20, yaw: 0, pitch: 0 }, kind: "mixed", weapon: "vandal", ...o });
const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const shot = (o = {}) => ({ tick: 0, time: 0, weapon: "vandal", part: null, targetShape: null, ...o });
const hit = (o = {}) => shot({ part: "body", targetShape: "humanoid", ...o });
// shots at regular spacing: a list of hit flags, `gap` seconds apart, starting at t0
const seq = (flags, { t0 = 0, gap = 0.1, weapon = "vandal" } = {}) => flags.map((h, i) => shot({ weapon, tick: Math.round((t0 + i * gap) * 128), time: t0 + i * gap, part: h ? "body" : null }));
const dayRow = (day, o = {}) => ({ v: 1, day, rounds: 1, shots: 0, hits: 0, headshots: 0, kills: 0, deaths: 0, falls: 0, maps: {}, weapons: {}, modes: {}, grid: {}, ...o });

const results = [];
async function test(name, fn) {
  try { await fn(); results.push([name, true]); console.log("ok   " + name); }
  catch (e) { results.push([name, false]); console.log("FAIL " + name + "\n     " + (e && e.stack || e)); }
}
const T = loadCoach(stub({})).thresholds;
const HEAD_CM = T.HEAD_ABOVE_CENTRE_CM;

(async () => {
  await test("no recorder, no data, a failing reader: empty arrays, never a rejection", async () => {
    assert.deepStrictEqual(await loadCoach(undefined).insights({}), []);
    assert.deepStrictEqual(await run({}), []);
    assert.deepStrictEqual(await loadCoach({ rounds: async () => { throw new Error("boom"); }, days: async () => [] }).insights({}), []);
  });

  await test("findings carry id, title, detail, severity, evidence and sample", async () => {
    const out = await run({ rounds: [round({ nearMisses: near(60, "above", 0.2).concat(near(25, "below", -0.1)) })] });
    const f = find(out, "miss-side");
    assert.ok(f);
    for (const k of ["id", "title", "detail", "severity", "evidence", "sample"]) assert.ok(k in f, k);
    assert.ok(["info", "tip", "warn"].includes(f.severity));
    assert.ok(typeof f.evidence === "object" && typeof f.sample === "number");
  });

  await test("miss-side: high, low, mixed, and below the minimum", async () => {
    let f = find(await run({ rounds: [round({ nearMisses: near(60, "above", 0.2).concat(near(25, "below", -0.1)) })] }), "miss-side");
    assert.strictEqual(f.title, "You miss high");
    assert.strictEqual(f.evidence.averageOffsetCm, 20);
    assert.strictEqual(f.evidence.sharePercent, 71);
    assert.strictEqual(f.sample, 85);
    f = find(await run({ rounds: [round({ nearMisses: near(15, "above", 0.1).concat(near(70, "below", -0.3)) })] }), "miss-side");
    assert.strictEqual(f.title, "You miss low");
    assert.strictEqual(f.evidence.averageOffsetCm, 30);
    assert.ok(!find(await run({ rounds: [round({ nearMisses: near(40, "above", 0.2).concat(near(40, "below", -0.2)) })] }), "miss-side"), "50/50 is not a side");
    assert.ok(!find(await run({ rounds: [round({ nearMisses: near(T.NEAR_MIN - 1, "above", 0.2) })] }), "miss-side"), "one under the minimum");
    assert.ok(find(await run({ rounds: [round({ nearMisses: near(T.NEAR_MIN, "above", 0.2) })] }), "miss-side"), "exactly the minimum");
    assert.ok(!find(await run({ rounds: [round({ nearMisses: near(30, "level", 0.0).concat(near(5, "above", 0.2)) })] }), "miss-side"), "level misses do not count");
    // weapon filter keeps only that weapon's misses
    const mixed = round({ nearMisses: near(90, "above", 0.2, "vandal").concat(near(90, "below", -0.2, "judge")) });
    assert.strictEqual(find(await run({ rounds: [mixed] }, { weapon: "vandal" }), "miss-side").title, "You miss high");
    assert.strictEqual(find(await run({ rounds: [mixed] }, { weapon: "judge" }), "miss-side").title, "You miss low");
  });

  await test("miss-side: needs 80 near misses and a 65% share; not shown when the average offset is about head height (the box-centre effect)", async () => {
    const side = (nAbove, nBelow, above = 0.2, below = -0.2) => [round({ nearMisses: near(nAbove, "above", above).concat(near(nBelow, "below", below)) })];
    assert.strictEqual(T.NEAR_MIN, 80); assert.strictEqual(T.NEAR_SHARE, 0.65);
    assert.ok(find(await run({ rounds: side(66, 34) }), "miss-side"), "66% of 100");
    assert.ok(!find(await run({ rounds: side(64, 36) }), "miss-side"), "64% is under the share");
    assert.ok(!find(await run({ rounds: side(79, 0) }), "miss-side"), "79 near misses");
    assert.ok(find(await run({ rounds: side(80, 0) }), "miss-side"), "80 near misses");
    // aiming at the head: the misses sit about 78 cm above the middle of the box, mostly "above"
    const head = HEAD_CM / 100;
    assert.ok(!find(await run({ rounds: side(90, 10, head, -0.05) }), "miss-side"), "average offset about 70 cm: head aim, nothing said");
    assert.ok(!find(await run({ rounds: side(90, 10, head + 0.24, -0.05) }), "miss-side"), "still inside the tolerance (about 95 cm)");
    // a high pattern well away from head height is still reported: between the chest and the head, or far above the head
    assert.strictEqual(find(await run({ rounds: side(90, 10, 0.4, -0.05) }), "miss-side").title, "You miss high");
    assert.strictEqual(find(await run({ rounds: side(90, 10, 1.3, -0.05) }), "miss-side").title, "You miss high");
    // low misses are never explained away by head aim
    assert.strictEqual(find(await run({ rounds: side(10, 90, head, -head) }), "miss-side").title, "You miss low");
  });

  await test("kill-style: one class dominates, a spread says nothing, small samples say nothing", async () => {
    const mk = (flick, strafe, mixed, err = 20) => [round({ engagements: [
      ...many(flick, () => eng({ kind: "flick", aimError: { degrees: err, yaw: 0, pitch: 0 } })), ...many(strafe, () => eng({ kind: "strafe" })), ...many(mixed, () => eng({ kind: "mixed" }))] })];
    let f = find(await run({ rounds: mk(28, 1, 1) }), "kill-style");
    assert.ok(f && /flicks/.test(f.title) && f.evidence.dominant === "flick" && f.evidence.sharePercent === 93);
    f = find(await run({ rounds: mk(1, 29, 0) }), "kill-style");
    assert.ok(f && /strafing/.test(f.title));
    assert.ok(!find(await run({ rounds: mk(15, 10, 5) }), "kill-style"));
    assert.ok(!find(await run({ rounds: mk(T.KILLS_MIN - 1, 0, 0) }), "kill-style"), "29 kills");
    // unkilled engagements and unclassified kills are ignored
    const r = round({ engagements: [...many(40, () => eng({ killed: false, killTick: -1, kind: null })), ...many(10, () => eng({ kind: "flick" }))] });
    assert.ok(!find(await run({ rounds: [r] }), "kill-style"));
  });

  await test("flick-start is dropped: the recorded error stops at the view cone, so no finding and no threshold for it", async () => {
    const out = await run({ rounds: [round({ engagements: many(60, () => eng({ kind: "flick", aimError: { degrees: 45, yaw: 0, pitch: 0 } })) })] });
    assert.ok(!find(out, "flick-start"));
    assert.ok(find(out, "kill-style"), "the flick share is still reported");
    assert.ok(!("FLICK_KILLS_MIN" in T) && !("FLICK_ERR_DEG" in T));
  });

  await test("pre-aim: crosshair too low or too high at first sight, and the minimum", async () => {
    const mk = (n, pitch) => [round({ engagements: many(n, (i) => eng({ killed: false, killTick: -1, kind: null, aimError: { degrees: 8, yaw: 0, pitch: pitch + (i % 2 ? 0.5 : -0.5) } })) })];
    let f = find(await run({ rounds: mk(40, 5) }), "pre-aim");
    assert.ok(f && /too low/.test(f.title) && f.evidence.belowHeadPercent === 100 && f.evidence.averagePitchErrorDegrees === 5);
    f = find(await run({ rounds: mk(40, -6) }), "pre-aim");
    assert.ok(f && /too high/.test(f.title));
    assert.ok(!find(await run({ rounds: mk(40, 1) }), "pre-aim"), "within 3 degrees");
    assert.ok(!find(await run({ rounds: mk(T.PREAIM_MIN - 1, 6) }), "pre-aim"), "29 engagements");
  });

  await test("pre-aim-low: a quarter of the fights start far below the head", async () => {
    const mk = (n, far) => [round({ engagements: many(n, (i) => eng({ killed: false, killTick: -1, kind: null, aimError: { degrees: 12, yaw: 0, pitch: i < far ? 14 : 0 } })) })];
    const f = find(await run({ rounds: mk(40, 12) }), "pre-aim-low");
    assert.ok(f && f.evidence.farBelowCount === 12 && f.evidence.farBelowPercent === 30);
    assert.ok(!find(await run({ rounds: mk(40, 5) }), "pre-aim-low"), "12% is not enough");
    assert.ok(!find(await run({ rounds: mk(T.PREAIM_MIN - 1, 29) }), "pre-aim-low"), "below the minimum");
  });

  await test("kill-time: the median, and faster / slower / flat against the 7 days before", async () => {
    const mk = (day, n, t) => round({ day, engagements: many(n, () => eng({ timeToKill: t })) });
    let out = await run({ rounds: [mk("2026-11-14", 25, 0.6)] });
    assert.strictEqual(find(out, "kill-time").evidence.medianSeconds, 0.6);
    assert.ok(!find(out, "kill-time-trend"), "no earlier week");
    assert.ok(!find(await run({ rounds: [mk("2026-11-14", T.TTK_MIN - 1, 0.6)] }), "kill-time"));
    out = await run({ rounds: [mk("2026-11-06", 20, 1.0), mk("2026-11-15", 20, 0.7)] });
    let f = find(out, "kill-time-trend");
    assert.ok(f && f.evidence.trend === "faster" && f.severity === "info" && f.evidence.changeSeconds === -0.3);
    f = find(await run({ rounds: [mk("2026-11-06", 20, 0.7), mk("2026-11-15", 20, 1.0)] }), "kill-time-trend");
    assert.ok(f && f.evidence.trend === "slower" && f.severity === "tip");
    f = find(await run({ rounds: [mk("2026-11-06", 20, 0.8), mk("2026-11-15", 20, 0.82)] }), "kill-time-trend");
    assert.ok(f && f.evidence.trend === "flat");
    assert.ok(!find(await run({ rounds: [mk("2026-11-06", T.TTK_WINDOW_MIN - 1, 1.0), mk("2026-11-15", 20, 0.7)] }), "kill-time-trend"), "14 kills in the earlier week");
    // a zero-length engagement (appeared and died in one tick) is not a time
    assert.ok(!find(await run({ rounds: [round({ engagements: many(40, () => eng({ timeToKill: 0 })) })] }), "kill-time"));
  });

  await test("death-zone: a hot cell from the day rows, and the minimums", async () => {
    const grid = { bind: { "3,4": 7, "5,5": 1, "6,2": 1, "7,7": 1, "8,1": 1, "9,9": 1 } };
    const out = await run({ days: [dayRow("2026-11-15", { grid })] });
    const f = find(out, "death-zone:bind");
    assert.ok(f && f.evidence.centreX === 3.5 && f.evidence.centreZ === 4.5 && f.evidence.deathsInCell === 7 && f.evidence.deathsOnMap === 12 && f.sample === 12);
    assert.ok(/x 3.5 m, z 4.5 m/.test(f.detail));
    assert.ok(!find(await run({ days: [dayRow("2026-11-15", { grid: { bind: { "3,4": 7, "5,5": 1, "6,2": 1, "7,7": 1 } } })] }), "death-zone:bind"), "11 deaths is below the minimum");
    assert.ok(!find(await run({ days: [dayRow("2026-11-15", { grid: { bind: Object.fromEntries(many(14, (i) => [i + ",0", 1])) } })] }), "death-zone:bind"), "spread evenly");
    assert.ok(!find(await run({ days: [dayRow("2026-11-15", { grid: { bind: { "3,4": 3, "5,5": 1, "6,2": 1, "7,7": 1, "8,1": 1, "9,9": 1, "1,1": 1, "2,2": 1, "0,5": 1, "4,4": 1, "5,0": 1, "7,0": 1 } } })] }), "death-zone:bind"), "3 deaths is below the cell minimum");
    // cells add up over days
    const two = await run({ days: [dayRow("2026-11-14", { grid: { bind: { "3,4": 4, "1,1": 1 } } }), dayRow("2026-11-15", { grid: { bind: { "3,4": 3, "2,2": 1, "5,5": 1, "6,6": 1, "7,7": 1, "8,8": 1, "9,9": 1 } } })] });
    assert.strictEqual(find(two, "death-zone:bind").evidence.deathsInCell, 7);
    // a map is reported on its own; a map filter narrows the day rows
    const both = await run({ days: [dayRow("2026-11-15", { grid: { bind: { "3,4": 7, "5,5": 1, "6,2": 1, "7,7": 1, "8,1": 1, "9,9": 1 }, ascent: { "1,1": 1 } } })] });
    assert.deepStrictEqual(ids(both).filter((i) => i.startsWith("death-zone")), ["death-zone:bind"]);
    // with a code filter the death positions of the rounds are used
    const rs = [round({ code: "drillA", deaths: [...many(6, () => ({ tick: 1, position: { x: 3.2, y: 0, z: 4.9 }, cause: "shot", killerId: 9 })), ...many(6, (i) => ({ tick: 1, position: { x: 20 + i * 3, y: 0, z: 0 }, cause: "shot", killerId: 9 }))] })];
    const byCode = find(await run({ rounds: rs }, { code: "drillA" }), "death-zone:bind");
    assert.ok(byCode && byCode.evidence.cellX === 3 && byCode.evidence.cellZ === 4);
  });

  await test("death-repeat rule is removed: two deaths in one square on one day give no tip", async () => {
    const rows = ["2026-11-13", "2026-11-14", "2026-11-15"].map((d) => dayRow(d, { grid: { bind: { "3,4": 2, "8,8": 1 } } }));
    assert.ok(!find(await run({ days: rows }), "death-repeat"));
  });

  await test("deaths-cause: shot against fall, and the minimum", async () => {
    const deaths = (shot, fell) => [round({ deaths: [...many(shot, () => ({ tick: 5, cause: "shot", killerId: 1 })), ...many(fell, () => ({ tick: 5, cause: "fell", killerId: null }))] })];
    let f = find(await run({ rounds: deaths(8, 4) }), "deaths-cause");
    assert.ok(f && f.severity === "tip" && f.evidence.falls === 4 && f.evidence.fallPercent === 33);
    f = find(await run({ rounds: deaths(20, 1) }), "deaths-cause");
    assert.ok(f && f.severity === "info");
    assert.ok(!find(await run({ rounds: deaths(7, 2) }), "deaths-cause"), "9 deaths");
    assert.ok(!find(await run({ rounds: deaths(20, 1) }, { weapon: "vandal" }), "deaths-cause"), "deaths have no weapon");
  });

  await test("deaths-unanswered: deaths in fights where you fired nothing", async () => {
    // each round: the enemy's fight starts at tick 100, you die at tick 300; shots either inside that window or not
    const mk = (silent, answered) => [
      ...many(silent, () => round({ engagements: [eng({ enemyId: 7, startTick: 100, killed: false, killTick: null })], deaths: [{ tick: 300, cause: "shot", killerId: 7 }], shots: [shot({ tick: 20 })] })),
      ...many(answered, () => round({ engagements: [eng({ enemyId: 7, startTick: 100, killed: false, killTick: null })], deaths: [{ tick: 300, cause: "shot", killerId: 7 }], shots: [shot({ tick: 150 })] })),
    ];
    let f = find(await run({ rounds: mk(5, 7) }), "deaths-unanswered");
    assert.ok(f && f.evidence.deathsWithoutFiring === 5 && f.evidence.deathsMatched === 12 && f.severity === "tip");
    f = find(await run({ rounds: mk(8, 4) }), "deaths-unanswered");
    assert.ok(f && f.severity === "warn");
    assert.ok(!find(await run({ rounds: mk(2, 10) }), "deaths-unanswered"), "17% is not enough");
    assert.ok(!find(await run({ rounds: mk(9, 0) }), "deaths-unanswered"), "9 deaths is below the minimum");
    // a death whose killer has no recorded fight is not counted
    assert.ok(!find(await run({ rounds: many(12, () => round({ engagements: [eng({ enemyId: 1, killed: true })], deaths: [{ tick: 300, cause: "shot", killerId: 7 }] })) }), "deaths-unanswered"));
  });

  await test("multi-enemy: a second fight that starts inside one, and the minimum", async () => {
    // a pair of overlapping fights: enemy 1 100..200, enemy 2 starts at 150 and is killed at 260
    const pair = () => [eng({ enemyId: 1, startTick: 100, killTick: 200 }), eng({ enemyId: 2, startTick: 150, killTick: 260 })];
    const solo = () => [eng({ enemyId: 1, startTick: 100, killTick: 200 })];
    const rs = [...many(10, () => round({ engagements: pair() })), ...many(10, () => round({ engagements: solo() }))]; // 30 kills, 20 in a pair
    let f = find(await run({ rounds: rs }), "multi-enemy");
    assert.ok(f && f.evidence.kills === 30 && f.evidence.killsWithSecondEnemy === 20 && f.evidence.killPercent === 67 && f.severity === "info");
    assert.ok(!("deaths" in f.evidence), "no death line below 8 deaths");
    // deaths after a second enemy appeared
    const dying = many(9, () => round({ engagements: [eng({ enemyId: 1, startTick: 100, killed: false, killTick: null }), eng({ enemyId: 2, startTick: 150, killed: false, killTick: null })], deaths: [{ tick: 300, cause: "shot", killerId: 1 }] }));
    f = find(await run({ rounds: [...many(30, () => round({ engagements: solo() })), ...dying] }), "multi-enemy");
    assert.ok(f && f.severity === "tip" && f.evidence.deaths === 9 && f.evidence.deathsWithSecondEnemy === 9 && f.evidence.deathPercent === 100);
    assert.ok(!find(await run({ rounds: rs.slice(0, 14) }), "multi-enemy"), "below the kill minimum");
    // the same enemy twice (a respawn) is not a second enemy
    const same = many(30, () => round({ engagements: [eng({ enemyId: 1, startTick: 100, killTick: 200 }), eng({ enemyId: 1, startTick: 150, killTick: 260 })] }));
    assert.strictEqual(find(await run({ rounds: same.slice(0, 15) }), "multi-enemy").evidence.killsWithSecondEnemy, 0);
  });

  await test("fights-lost: lost against won, severity by share, and the minimum", async () => {
    const mk = (won, lost) => [round({ engagements: many(won, (i) => eng({ enemyId: i + 1 })), deaths: many(lost, () => ({ tick: 9, cause: "shot", killerId: 99 })) })];
    let f = find(await run({ rounds: mk(20, 20) }), "fights-lost");
    assert.ok(f && f.severity === "warn" && f.evidence.lostPercent === 50 && f.sample === 40);
    f = find(await run({ rounds: mk(28, 12) }), "fights-lost");
    assert.ok(f && f.severity === "tip");
    f = find(await run({ rounds: mk(36, 4) }), "fights-lost");
    assert.ok(f && f.severity === "info");
    assert.ok(!find(await run({ rounds: mk(15, 14) }), "fights-lost"), "29 fights");
    // rounds without engagement rows (from before they were recorded) do not add lost fights
    const old = round({ deaths: many(40, () => ({ tick: 9, cause: "shot", killerId: 99 })) });
    assert.ok(!find(await run({ rounds: [...mk(15, 14), old] }), "fights-lost"));
    assert.ok(!find(await run({ rounds: [{ ...mk(30, 10)[0], engagementsTruncated: true }] }), "fights-lost"), "cut-short rounds are skipped");
    assert.ok(!find(await run({ rounds: mk(30, 10) }, { weapon: "vandal" }), "fights-lost"));
  });

  await test("headshot-weapon: the better weapon is named; humanoid hits only; minimums", async () => {
    const mk = (weapon, hits, heads, shape = "humanoid") => many(hits, (i) => hit({ weapon, part: i < heads ? "head" : "body", targetShape: shape }));
    let f = find(await run({ rounds: [round({ shots: [...mk("vandal", 120, 60), ...mk("phantom", 130, 13)] })] }), "headshot-weapon");
    assert.ok(f && f.evidence.best === "vandal" && f.evidence.worst === "phantom" && f.evidence.bestHeadshotPercent === 50 && f.evidence.worstHeadshotPercent === 10 && f.evidence.gapPoints === 40);
    assert.ok(!find(await run({ rounds: [round({ shots: [...mk("vandal", 120, 60), ...mk("phantom", T.HITS_MIN - 1, 0)] })] }), "headshot-weapon"), "99 hits for one weapon");
    assert.ok(!find(await run({ rounds: [round({ shots: [...mk("vandal", 120, 60), ...mk("phantom", 130, 0, "sphere")] })] }), "headshot-weapon"), "sphere hits are not humanoid hits");
    assert.ok(!find(await run({ rounds: [round({ shots: [...mk("vandal", 120, 48), ...mk("phantom", 130, 52)] })] }), "headshot-weapon"), "small gap");
    assert.ok(!find(await run({ rounds: [round({ shots: mk("vandal", 200, 100) })] }), "headshot-weapon"), "one weapon");
    assert.ok(!find(await run({ rounds: [round({ shots: [...mk("vandal", 120, 60), ...mk("phantom", 130, 13)] })] }, { weapon: "vandal" }), "headshot-weapon"), "a weapon filter leaves nothing to compare");
    // a shotgun shot counts once, as a head hit when any pellet hit the head
    const pel = [...many(100, () => shot({ weapon: "judge", part: "body", targetShape: "humanoid", pellets: { fired: 8, hit: 4, head: 1 } }))];
    f = find(await run({ rounds: [round({ shots: [...mk("vandal", 120, 12), ...pel] })] }), "headshot-weapon");
    assert.ok(f && f.evidence.best === "judge" && f.evidence.bestHeadshotPercent === 100);
    // a gap of 11 points is under the 12-point limit, 12 is enough
    assert.strictEqual(T.HEAD_GAP_POINTS, 12);
    assert.ok(!find(await run({ rounds: [round({ shots: [...mk("vandal", 200, 70), ...mk("phantom", 200, 48)] })] }), "headshot-weapon"), "11 points");
    assert.ok(find(await run({ rounds: [round({ shots: [...mk("vandal", 200, 72), ...mk("phantom", 200, 48)] })] }), "headshot-weapon"), "12 points");
  });

  await test("accuracy-weapon: the weakest weapon, and the minimums", async () => {
    const mk = (weapon, shots, hits) => many(shots, (i) => shot({ weapon, part: i < hits ? "body" : null }));
    const f = find(await run({ rounds: [round({ shots: [...mk("vandal", 120, 60), ...mk("sheriff", 100, 20)] })] }), "accuracy-weapon");
    assert.ok(f && f.evidence.best === "vandal" && f.evidence.worst === "sheriff" && f.evidence.bestAccuracyPercent === 50 && f.evidence.worstAccuracyPercent === 20 && f.evidence.gapPoints === 30);
    assert.ok(!find(await run({ rounds: [round({ shots: [...mk("vandal", 120, 60), ...mk("sheriff", T.ACC_SHOTS_MIN - 1, 0)] })] }), "accuracy-weapon"));
    assert.ok(!find(await run({ rounds: [round({ shots: [...mk("vandal", 120, 60), ...mk("sheriff", 100, 55)] })] }), "accuracy-weapon"), "small gap");
    assert.ok(!find(await run({ rounds: [round({ shots: [...mk("vandal", 120, 60), ...mk("sheriff", 100, 20)] })] }, { weapon: "vandal" }), "accuracy-weapon"));
  });

  await test("strafe-map and strafe-drill: the gap between the best and worst group, and the minimums", async () => {
    const mk = (map, code, strafes, others) => round({ map, code, engagements: [...many(strafes, () => eng({ kind: "strafe" })), ...many(others, () => eng({ kind: "flick" }))] });
    const rs = [mk("bind", "A", 12, 18), mk("ascent", "B", 3, 27)];
    let f = find(await run({ rounds: rs }), "strafe-map");
    assert.ok(f && f.evidence.map === "bind" && f.evidence.strafePercent === 40 && f.evidence.otherGroup === "ascent" && f.evidence.otherStrafePercent === 10);
    f = find(await run({ rounds: rs }), "strafe-drill");
    assert.ok(f && f.evidence.drill === "A" && f.evidence.otherGroup === "B");
    assert.ok(!find(await run({ rounds: [mk("bind", "A", 12, 18), mk("ascent", "B", 1, T.STRAFE_GROUP_MIN - 2)] }), "strafe-map"), "19 kills in one map");
    assert.ok(!find(await run({ rounds: [mk("bind", "A", 12, 18), mk("ascent", "B", 9, 21)] }), "strafe-map"), "10 point gap");
    assert.ok(!find(await run({ rounds: rs }, { map: "bind" }), "strafe-map"), "one map is already chosen");
    assert.ok(!find(await run({ rounds: rs }, { code: "A" }), "strafe-drill"));
  });

  await test("burst-length: short bursts against long runs, and the minimums", async () => {
    // short bursts: 3 shots 0.1 s apart (2 of 3 hit), long runs: 8 shots (2 of 8 hit); runs are 1 s apart
    const shortRun = (t0) => seq([true, true, false], { t0 });
    const longRun = (t0) => seq([true, false, false, false, true, false, false, false], { t0 });
    const build = (nShort, nLong) => {
      const shots = []; let t = 0;
      for (let i = 0; i < nShort; i++) { shots.push(...shortRun(t)); t += 2; }
      for (let i = 0; i < nLong; i++) { shots.push(...longRun(t)); t += 2; }
      return [round({ shots })];
    };
    const f = find(await run({ rounds: build(40, 15) }), "burst-length");
    assert.ok(f && f.severity === "tip" && f.evidence.shortAccuracyPercent === 67 && f.evidence.longAccuracyPercent === 25 && f.evidence.gapPoints === 42 && f.evidence.shortBursts === 40 && f.evidence.longRuns === 15);
    assert.ok(!find(await run({ rounds: build(40, 14) }), "burst-length"), "14 long runs");
    assert.ok(!find(await run({ rounds: build(14, 15) }), "burst-length"), "14 short bursts");
    assert.ok(!find(await run({ rounds: build(33, 15) }), "burst-length"), "33 bursts are 99 shots, under the 100 needed");
    assert.ok(find(await run({ rounds: build(34, 15) }), "burst-length"), "34 bursts are 102 shots");
    // long runs that do better: an info line
    const better = []; let t = 0;
    for (let i = 0; i < 40; i++) { better.push(...seq([true, false, false], { t0: t })); t += 2; }
    for (let i = 0; i < 20; i++) { better.push(...seq([true, true, true, true, true, true, false, false], { t0: t })); t += 2; }
    assert.strictEqual(find(await run({ rounds: [round({ shots: better })] }), "burst-length").severity, "info");
    // shotgun and melee shots are left out of runs
    const sg = round({ shots: many(200, (i) => shot({ weapon: "judge", tick: i, time: i * 0.1, part: "body", pellets: { fired: 8, hit: 4, head: 0 } })) });
    assert.ok(!find(await run({ rounds: [sg] }), "burst-length"));
    // a pause of BURST_GAP_S or more ends a run: the same 6 shots 0.5 s apart are six runs of one, not one long run
    const slow = []; let u = 0;
    for (let i = 0; i < 30; i++) { slow.push(...seq([true, false, false, false, true, false], { t0: u, gap: 0.5 })); u += 10; }
    assert.ok(!find(await run({ rounds: [round({ shots: slow })] }), "burst-length"));
  });

  await test("spray-control: accuracy of shot 4 and later, and the minimums", async () => {
    // a run of 8 shots: the first 3 hit 2, the other 5 hit 1
    const runOf = (t0) => seq([true, true, false, true, false, false, false, false], { t0 });
    const build = (n) => { const shots = []; for (let i = 0; i < n; i++) shots.push(...runOf(i * 2)); return [round({ shots })]; };
    const f = find(await run({ rounds: build(40) }), "spray-control");
    assert.ok(f && f.evidence.runs === 40 && f.evidence.earlyShots === 120 && f.evidence.lateShots === 200 && f.evidence.earlyAccuracyPercent === 67 && f.evidence.lateAccuracyPercent === 20 && f.evidence.dropPoints === 47);
    assert.ok(!find(await run({ rounds: build(14) }), "spray-control"), "14 runs");
    assert.ok(!find(await run({ rounds: build(33) }), "spray-control"), "33 runs: 99 early shots");
    assert.ok(find(await run({ rounds: build(34) }), "spray-control"), "34 runs: 102 early shots");
    // a late-shot accuracy equal to the early one is not a finding
    const flat = []; for (let i = 0; i < 40; i++) flat.push(...seq([true, false, false, true, false, false, true, false], { t0: i * 2 }));
    assert.ok(!find(await run({ rounds: [round({ shots: flat })] }), "spray-control"));
    // fewer than 60 early shots (runs of 4 only: 3 early per run, 17 runs = 51)
    const few = []; for (let i = 0; i < 17; i++) few.push(...seq([true, true, true, false], { t0: i * 2 }));
    assert.ok(!find(await run({ rounds: [round({ shots: few })] }), "spray-control"));
  });

  // ---- spray-control: bullet drift against the target + mouse pull. Shots carry yawErrDeg (right +), pitchErrDeg (up +), aimYawDeg (left +),
  // aimPitchDeg (up +) and, for the target basis, nearestEnemy {range, side (right +), vertical (up +)} in metres: the bullet line against the enemy centre ----
  const RANGE = 10, tan = (d) => Math.tan((d * Math.PI) / 180);
  // a bullet that is yawDeg right and pitchDeg above the target centre, as the recorder stores it (metres at a range of 10 m)
  const onTarget = (yawDeg, pitchDeg) => ({ range: RANGE, centreDistance: 0, side: RANGE * tan(yawDeg), vertical: RANGE * tan(pitchDeg) });
  // kick = [yawErr, pitchErr], aim = [aimYaw, aimPitch], tgt = [yaw, pitch] degrees against the target centre or null for a shot with no target near its line
  const rs = (kick, aim, i, t0, tgt = null) => shot({ tick: Math.round((t0 + i * 0.1) * 128), time: t0 + i * 0.1, part: null, yawErrDeg: kick[0], pitchErrDeg: kick[1], aimYawDeg: aim[0], aimPitchDeg: aim[1], ...(tgt ? { nearestEnemy: onTarget(tgt[0], tgt[1]) } : {}) });
  // A run of 8 shots: the first 3 have kick (0, 0.5), shots 4 to 8 the late kick. The aim starts at aim0 and moves to aim0 + lateAim from shot 4 on.
  // tgtLate = where the late bullets are against the target (the first 3 are dead centre); undefined = the shots carry no target offset (proxy basis).
  const sprayRun = (t0, late, lateAim = [0, 0], tgtLate, aim0 = [0, 0]) => Array.from({ length: 8 }, (_, i) => {
    const early = i < 3, aim = early ? aim0 : [aim0[0] + lateAim[0], aim0[1] + lateAim[1]];
    return rs(early ? [0, 0.5] : late, aim, i, t0, tgtLate ? (early ? [0, 0] : tgtLate) : null);
  });
  const sprayRounds = (n, late, lateAim, tgtLate, aim0) => { const shots = []; for (let i = 0; i < n; i++) shots.push(...sprayRun(i * 2, late, lateAim, tgtLate, aim0)); return [round({ shots })]; };
  const near2 = (a, b) => Math.abs(a - b) < 0.02;

  await test("spray-control: a CONTROLLED spray gets no warning, even with the cursor low; the evidence says the cursor is not judged", async () => {
    // recoil kicks the bullets 3 degrees up, the mouse is pulled 3 degrees down, the bullets stay on the target; the aim starts 25 degrees BELOW the horizon
    const out = await run({ rounds: sprayRounds(40, [0, 3.5], [0, -3], [0, 0], [0, -25]) });
    const f = find(out, "spray-control");
    assert.ok(f, "an info note is expected");
    assert.strictEqual(f.severity, "info"); assert.ok(f.severity !== "tip" && f.severity !== "warn");
    assert.strictEqual(f.evidence.basis, "target-offset");
    assert.strictEqual(f.evidence.pulledDownDeg, 3); assert.strictEqual(f.evidence.aimPitchChangeDeg, -3); assert.strictEqual(f.evidence.recoilKickPitchDeg, 3);
    assert.ok(near2(f.evidence.bulletDriftDeg, 0), "bullets stay put: " + f.evidence.bulletDriftDeg);
    assert.strictEqual(f.evidence.cursorPositionJudged, false);
    assert.ok(/pull cancelled it/.test(f.detail) && /cursor position is not judged/.test(f.detail) && /pulled the mouse 3 degrees down/.test(f.detail) && /recoil took the bullets 3 degrees up/.test(f.detail), f.detail);
    assert.ok(!/did not cancel/.test(f.detail));
    // the same with the cursor high or on the horizon: the absolute aim never matters
    for (const aim0 of [[0, 0], [0, 30], [0, -60]]) {
      const g = find(await run({ rounds: sprayRounds(40, [0, 3.5], [0, -3], [0, 0], aim0) }), "spray-control");
      assert.ok(g && g.severity === "info" && g.evidence.bulletDriftDeg < 0.02, "cursor at pitch " + aim0[1]);
    }
    // a low cursor and no pull at all, bullets on target (a weapon with no recoil): nothing to say, no warning
    assert.ok(!find(await run({ rounds: sprayRounds(40, [0, 0.5], [0, 0], [0, 0], [0, -40]) }), "spray-control"));
    // bullets within the drift limit while the mouse is pulled: still no warning (0.4 degree up)
    const small = find(await run({ rounds: sprayRounds(40, [0, 3.5], [0, -3], [0, 0.4], [0, -25]) }), "spray-control");
    assert.ok(small && small.severity === "info");
  });

  await test("spray-control: an UNCONTROLLED spray whose bullets drift off the target gets a warning, with the pull and the kick in the evidence", async () => {
    // the recoil kicks 3 degrees up and the player pulls only 1 down: the bullets end 2 degrees above the target
    let f = find(await run({ rounds: sprayRounds(40, [0, 3.5], [0, -1], [0, 2], [0, -25]) }), "spray-control");
    assert.ok(f && f.severity === "tip", "warning");
    assert.strictEqual(f.evidence.basis, "target-offset");
    assert.ok(near2(f.evidence.bulletDriftPitchDeg, 2) && near2(f.evidence.bulletDriftDeg, 2) && near2(f.evidence.awayFromTargetDeg, 2));
    assert.strictEqual(f.evidence.pulledDownDeg, 1); assert.strictEqual(f.evidence.recoilKickPitchDeg, 3); assert.strictEqual(f.evidence.mostly, "vertical");
    assert.ok(/climbs off the target/.test(f.title) && /pull did not cancel it/.test(f.detail) && /pulled the mouse 1 degrees down/.test(f.detail) && /recoil took the bullets 3 degrees up/.test(f.detail) && /not the problem/.test(f.detail), f.title + " / " + f.detail);
    // no pull at all
    f = find(await run({ rounds: sprayRounds(40, [0, 3.5], [0, 0], [0, 3]) }), "spray-control");
    assert.ok(f.severity === "tip" && f.evidence.pulledDownDeg === 0 && near2(f.evidence.bulletDriftDeg, 3));
    // pulling too far: the bullets end 2 degrees BELOW the target
    f = find(await run({ rounds: sprayRounds(40, [0, 3.5], [0, -5], [0, -2]) }), "spray-control");
    assert.ok(f.severity === "tip" && /too far down/.test(f.title) && /more than it needed/.test(f.detail) && near2(f.evidence.bulletDriftPitchDeg, -2), f.title);
  });

  await test("spray-control: sideways drift, direction signs, and drifting TOWARD the target is no warning", async () => {
    // yaw: the bullets end 2 degrees to the right of the target centre (side positive = right)
    let f = find(await run({ rounds: sprayRounds(40, [2, 0.5], [0, 0], [2, 0]) }), "spray-control");
    assert.strictEqual(f.evidence.mostly, "horizontal"); assert.ok(near2(f.evidence.bulletDriftYawDeg, 2)); assert.ok(/drifts right/.test(f.title) && /nudge the mouse left/.test(f.detail), f.title + f.detail);
    f = find(await run({ rounds: sprayRounds(40, [-2, 0.5], [0, 0], [-2, 0]) }), "spray-control");
    assert.ok(near2(f.evidence.bulletDriftYawDeg, -2) && /drifts left/.test(f.title));
    // diagonal
    f = find(await run({ rounds: sprayRounds(40, [2, 2.5], [0, 0], [2, 2]) }), "spray-control");
    assert.strictEqual(f.evidence.mostly, "both");
    // the first 3 bullets are 3 degrees ABOVE the target and the later ones come down onto it: drift 3 but toward the target, no warning
    const shots = []; for (let i = 0; i < 40; i++) shots.push(...Array.from({ length: 8 }, (_, k) => rs([0, 0.5], [0, 0], k, i * 2, k < 3 ? [0, 3] : [0, 0])));
    const g = find(await run({ rounds: [round({ shots })] }), "spray-control");
    assert.ok(!g || g.severity === "info", "toward the target is not a fault");
    // a drift under the limit is not a warning
    assert.ok(!find(await run({ rounds: sprayRounds(40, [0.4, 0.9], [0, 0], [0.4, 0.4]) }), "spray-control"));
  });

  await test("spray-control: without target offsets the bullet-direction PROXY runs, labelled; controlled and uncontrolled", async () => {
    // no nearestEnemy at all: kick +3, aim pulled -3 (controlled): no warning; pull -1: warning, proxy basis
    let f = find(await run({ rounds: sprayRounds(40, [0, 3.5], [0, -3]) }), "spray-control");
    assert.ok(f && f.severity === "info" && f.evidence.basis === "bullet-proxy" && /PROXY/.test(f.evidence.basisLabel), "controlled");
    f = find(await run({ rounds: sprayRounds(40, [0, 3.5], [0, -1]) }), "spray-control");
    assert.ok(f.severity === "tip" && f.evidence.basis === "bullet-proxy" && near2(f.evidence.bulletDriftPitchDeg, 2) && f.evidence.recoilKickPitchDeg === 3 && f.evidence.pulledDownDeg === 1);
    // yaw: the aim yaw grows to the LEFT. kick +2 right and the aim turned 2 degrees left (yaw +2): the bullets stay; the aim turned 2 right (yaw -2): they go 4 right
    assert.ok(!find(await run({ rounds: sprayRounds(40, [2, 0.5], [2, 0]) }), "spray-control") || find(await run({ rounds: sprayRounds(40, [2, 0.5], [2, 0]) }), "spray-control").severity === "info");
    f = find(await run({ rounds: sprayRounds(40, [2, 0.5], [-2, 0]) }), "spray-control");
    assert.ok(f.severity === "tip" && near2(f.evidence.bulletDriftYawDeg, 4));
    // pulling 5 against a climb of 3: the bullets end 2 degrees down (and 1 degree farther from the start than the first 3, which sat 0.5 up)
    f = find(await run({ rounds: sprayRounds(40, [0, 3.5], [0, -5]) }), "spray-control");
    assert.ok(f.severity === "tip" && near2(f.evidence.bulletDriftPitchDeg, -2) && /too far down/.test(f.title));
    // too few target offsets (20 of 40 runs): the proxy, not the target basis
    const mixed = sprayRounds(20, [0, 3.5], [0, -3], [0, 0])[0].shots.concat(sprayRounds(20, [0, 3.5], [0, -3])[0].shots.map((x, i) => ({ ...x, tick: x.tick + 100000 + i, time: x.time + 1000 })));
    assert.strictEqual(find(await run({ rounds: [round({ shots: mixed })] }), "spray-control").evidence.basis, "bullet-proxy");
  });

  await test("spray-control: the aim yaw wraps across 180 degrees inside a run", async () => {
    const shots = []; for (let i = 0; i < 40; i++) shots.push(...Array.from({ length: 8 }, (_, k) => rs([0, 0.5], [k < 3 ? 179.5 : -179.5, 0], k, i * 2)));
    // the aim moved 1 degree to the left (yaw grows) through the wrap, kick unchanged: the bullets go 1 degree left
    const f = find(await run({ rounds: [round({ shots })] }), "spray-control");
    assert.ok(f && f.severity === "tip" && near2(f.evidence.bulletDriftYawDeg, -1) && f.evidence.mostly === "horizontal");
  });

  await test("spray-control: minimums of 100 shots each side and 15 runs; below them the hit-rate version runs, labelled as a fallback", async () => {
    // 33 runs: 99 early shots, nothing from the recoil basis, and the shots have no hits so the hit-rate fallback has nothing either
    assert.ok(!find(await run({ rounds: sprayRounds(33, [0, 3.5], [0, 0], [0, 3]) }), "spray-control"), "99 early shots");
    assert.ok(find(await run({ rounds: sprayRounds(34, [0, 3.5], [0, 0], [0, 3]) }), "spray-control"), "102 early shots");
    assert.ok(!find(await run({ rounds: sprayRounds(14, [0, 3.5], [0, 0], [0, 3]) }), "spray-control"), "14 runs");
    // the same for the pulled, controlled case: the info note needs the minimums too
    assert.ok(!find(await run({ rounds: sprayRounds(33, [0, 3.5], [0, -3], [0, 0]) }), "spray-control"));
    assert.ok(find(await run({ rounds: sprayRounds(34, [0, 3.5], [0, -3], [0, 0]) }), "spray-control"));
    // 20 runs with recoil fields (60 early shots) and 20 without: too little recoil data, so the hit-rate version runs on all 40 runs (early shots hit, late ones miss)
    const mixed = [];
    for (let i = 0; i < 20; i++) mixed.push(...sprayRun(i * 2, [0, 3.5]).map((s, k) => ({ ...s, part: k < 3 ? "body" : null })));
    for (let i = 20; i < 40; i++) mixed.push(...seq([true, true, true, false, false, false, false, false], { t0: i * 2 }));
    const fb = find(await run({ rounds: [round({ shots: mixed })] }), "spray-control");
    assert.ok(fb && fb.evidence.basis === "hit-rate" && fb.evidence.fallback === true && /FALLBACK/.test(fb.evidence.basisLabel) && /recoil fields are missing/.test(fb.evidence.basisLabel), "fallback labelled");
    assert.ok(/Hit-rate estimate/.test(fb.detail));
    // enough recoil shots wins over hit rates, and carries no fallback label
    const rich = []; for (let i = 0; i < 40; i++) rich.push(...sprayRun(i * 2, [0, 3.5], [0, 0], [0, 3]).map((s, k) => ({ ...s, part: k < 3 ? "body" : null })));
    const r = find(await run({ rounds: [round({ shots: rich })] }), "spray-control");
    assert.strictEqual(r.evidence.basis, "target-offset"); assert.ok(!("fallback" in r.evidence));
    // a run with one shot missing its recoil fields is not used (positions in the run would be wrong); the others still count
    const holey = sprayRounds(40, [0, 3.5], [0, 0], [0, 3]); holey[0].shots[2] = { ...holey[0].shots[2], yawErrDeg: undefined };
    assert.strictEqual(find(await run({ rounds: holey }), "spray-control").evidence.runs, 39);
    // old rows without the fields never use the recoil basis
    const old = []; for (let i = 0; i < 40; i++) old.push(...seq([true, true, false, true, false, false, false, false], { t0: i * 2 }));
    const o = find(await run({ rounds: [round({ shots: old })] }), "spray-control");
    assert.ok(o.evidence.basis === "hit-rate" && o.evidence.fallback === true);
    assert.strictEqual(T.SPRAY_DRIFT_DEG, 1); assert.strictEqual(T.SPRAY_AXIS_SHARE, 0.7); assert.strictEqual(T.SPRAY_AWAY_DEG, 0.5); assert.strictEqual(T.SPRAY_PULL_DEG, 1);
    assert.strictEqual(T.SPRAY_SHOTS_MIN, 100); assert.strictEqual(T.SPRAY_FROM, 4);
  });

  await test("consistency: steady, streaky, in between, and the minimums", async () => {
    const acc = (a, shots = 40) => round({ code: "A", shots: many(shots, (i) => shot({ part: i < Math.round(a * shots) ? "body" : null })) });
    const series = (list, code = "A") => list.map((a) => ({ ...acc(a), code }));
    let f = find(await run({ rounds: series([0.5, 0.5, 0.52, 0.48, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]) }), "consistency");
    assert.ok(f && f.title === "Your aim is steady" && f.severity === "info" && f.evidence.rounds === 12);
    f = find(await run({ rounds: series([0.2, 0.8, 0.3, 0.7, 0.2, 0.8, 0.3, 0.7, 0.2, 0.8, 0.3, 0.7]) }), "consistency");
    assert.ok(f && f.title === "Your aim is streaky" && f.severity === "tip");
    assert.ok(!find(await run({ rounds: series([0.4, 0.6, 0.4, 0.6, 0.4, 0.6, 0.4, 0.6, 0.4, 0.6, 0.4, 0.6]) }), "consistency"), "10 points is neither");
    assert.ok(!find(await run({ rounds: series([0.2, 0.8, 0.3, 0.7, 0.2, 0.8, 0.3, 0.7, 0.2]) }), "consistency"), "9 rounds");
    assert.ok(!find(await run({ rounds: series([0.2, 0.8, 0.3, 0.7, 0.2, 0.8, 0.3, 0.7, 0.2, 0.8, 0.3, 0.7].map((a) => a)).map((r) => ({ ...r, shots: r.shots.slice(0, 19) })) }), "consistency"), "rounds under 20 shots do not count");
    // drills played fewer than 3 times add nothing: ten different drills played once each
    const ten = many(10, (i) => ({ ...acc(i % 2 ? 0.2 : 0.8), code: "d" + i }));
    assert.ok(!find(await run({ rounds: ten }), "consistency"));
    // the spread is within a drill: two drills at very different but steady levels are steady
    const two = [...series([0.2, 0.2, 0.2, 0.2, 0.2, 0.2], "A"), ...series([0.8, 0.8, 0.8, 0.8, 0.8, 0.8], "B")];
    assert.strictEqual(find(await run({ rounds: two }), "consistency").title, "Your aim is steady");
  });

  await test("trend: accuracy and headshot rate, last 7 days against the 7 before", async () => {
    const days = (prev, recent) => [
      dayRow("2026-11-08", { shots: prev[0], hits: prev[1], headshots: prev[2] }),
      dayRow("2026-11-15", { shots: recent[0], hits: recent[1], headshots: recent[2] }),
      dayRow("2026-11-01", { shots: 5000, hits: 5000, headshots: 5000 }), // older than both windows: ignored
    ];
    let out = await run({ days: days([600, 180, 40], [600, 270, 90]) });
    let f = find(out, "trend-accuracy");
    assert.ok(f && f.title === "Your accuracy is improving" && f.evidence.previousPercent === 30 && f.evidence.recentPercent === 45 && f.evidence.changePoints === 15);
    f = find(out, "trend-headshots");
    assert.ok(f && f.evidence.previousPercent === 22 && f.evidence.recentPercent === 33);
    f = find(await run({ days: days([600, 300, 60], [600, 180, 40]) }), "trend-accuracy");
    assert.ok(f && f.title === "Your accuracy is dropping" && f.severity === "tip" && f.evidence.changePoints === -20);
    f = find(await run({ days: days([600, 300, 60], [600, 304, 60]) }), "trend-accuracy");
    assert.ok(f && f.evidence.trend === "flat");
    assert.ok(!find(await run({ days: days([T.TREND_SHOTS_MIN - 1, 180, 40], [600, 270, 90]) }), "trend-accuracy"), "399 shots in the earlier week");
    assert.ok(!find(await run({ days: days([600, 180, 40], [T.TREND_SHOTS_MIN - 1, 270, 90]) }), "trend-accuracy"), "399 shots in the last week");
    assert.ok(!find(await run({ days: days([600, 59, 20], [600, 270, 90]) }), "trend-headshots"), "59 hits in the earlier week");
    // a dropping accuracy is a tip, a dropping headshot rate is still a warning
    assert.strictEqual(T.TREND_SHOTS_MIN, 400);
    assert.strictEqual(find(await run({ days: days([600, 300, 60], [600, 300, 30]) }), "trend-headshots").severity, "warn");
    // a weapon filter reads that weapon's counts; a code filter reads the rounds
    const w = [dayRow("2026-11-08", { weapons: { vandal: { shots: 600, hits: 180, headshots: 40, kills: 0 } } }), dayRow("2026-11-15", { weapons: { vandal: { shots: 600, hits: 270, headshots: 90, kills: 0 } } })];
    assert.ok(find(await run({ days: w }, { weapon: "vandal" }), "trend-accuracy"));
    const rs = [round({ day: "2026-11-08", code: "A", shots: many(600, (i) => shot({ part: i < 180 ? "body" : null })) }), round({ day: "2026-11-15", code: "A", shots: many(600, (i) => shot({ part: i < 270 ? "body" : null })) })];
    assert.strictEqual(find(await run({ rounds: rs }, { code: "A" }), "trend-accuracy").evidence.changePoints, 15);
    // since does not cut the windows
    assert.ok(find(await run({ days: days([600, 180, 40], [600, 270, 90]) }, { since: "2026-11-14" }), "trend-accuracy"));
  });

  // ---- shots with the movement / nearest-enemy fields (the expanded shape) ----
  // o: hit, range, side, speed, walk, crouch (crouchAmount), airborne, weapon; a missing field is left out like an old row would
  const ns = (o = {}) => shot({
    weapon: o.weapon || "vandal", part: o.hit ? "body" : null,
    nearestEnemy: o.range === null ? undefined : { range: o.range ?? 10, centreDistance: 0.3, side: o.side ?? 0, vertical: 0 },
    ...(o.speed === undefined ? {} : { movement: { speed: o.speed, still: o.speed < 0.5, walk: !!o.walk, crouch: (o.crouch || 0) >= 0.5, airborne: !!o.airborne } }),
    ...(o.crouch === undefined ? {} : { crouchAmount: o.crouch }),
  });
  // n shots of which `hits` hit
  const group = (n, hits, o = {}) => many(n, (i) => ns({ ...o, hit: i < hits }));

  await test("accuracy-range: the weakest band, minimums, and which shots count", async () => {
    const shots = [...group(150, 120, { range: 4 }), ...group(150, 75, { range: 14 }), ...group(150, 30, { range: 30 })];
    const f = find(await run({ rounds: [round({ shots })] }), "accuracy-range");
    assert.ok(f && f.evidence.weakest === "far" && f.evidence.weakestAccuracyPercent === 20 && f.evidence.best === "near" && f.evidence.bestAccuracyPercent === 80 && f.evidence.gapPoints === 60 && f.sample === 450);
    assert.strictEqual(f.title, "Your weakest range is far");
    // a band under the minimum is not compared; two bands are enough
    let g = find(await run({ rounds: [round({ shots: [...group(150, 120, { range: 4 }), ...group(T.RANGE_SHOTS_MIN - 1, 0, { range: 30 })] })] }), "accuracy-range");
    assert.ok(!g, "149 far shots");
    g = find(await run({ rounds: [round({ shots: [...group(150, 120, { range: 4 }), ...group(T.RANGE_SHOTS_MIN, 0, { range: 30 })] })] }), "accuracy-range");
    assert.ok(g && g.evidence.weakest === "far");
    assert.ok(!find(await run({ rounds: [round({ shots: [...group(150, 84, { range: 4 }), ...group(150, 75, { range: 30 })] })] }), "accuracy-range"), "5 point gap");
    assert.strictEqual(T.RANGE_GAP_POINTS, 12);
    assert.ok(!find(await run({ rounds: [round({ shots: [...group(150, 120, { range: 4 }), ...group(150, 103, { range: 30 })] })] }), "accuracy-range"), "11 points");
    assert.ok(find(await run({ rounds: [round({ shots: [...group(150, 120, { range: 4 }), ...group(150, 102, { range: 30 })] })] }), "accuracy-range"), "12 points");
    // shots without a nearby enemy (old rows, or nothing near) and shotgun shots do not count
    const sg = many(80, () => shot({ weapon: "judge", part: "body", pellets: { fired: 8, hit: 4, head: 0 }, nearestEnemy: { range: 30, centreDistance: 0, side: 0, vertical: 0 } }));
    assert.ok(!find(await run({ rounds: [round({ shots: [...group(150, 120, { range: 4 }), ...sg, ...group(80, 0, { range: null })] })] }), "accuracy-range"));
    // the mid band sits between 8 and 20 m
    const mid = find(await run({ rounds: [round({ shots: [...group(150, 120, { range: 7.9 }), ...group(150, 15, { range: 8 }), ...group(150, 15, { range: 20 })] })] }), "accuracy-range");
    assert.ok(mid && mid.evidence.weakest === "mid" && mid.evidence.weakestShots === 300, "8 m and 20 m are both mid");
  });

  await test("miss-side-sideways: left, right, mixed, and the minimum", async () => {
    const misses = (n, side) => group(n, 0, { side });
    let f = find(await run({ rounds: [round({ shots: [...misses(30, -0.2), ...misses(15, 0.1), ...group(20, 20, { side: 0.5 })] })] }), "miss-side-sideways");
    assert.ok(f && f.title === "You miss to the left" && f.evidence.left === 30 && f.evidence.right === 15 && f.evidence.sharePercent === 67 && f.evidence.averageOffsetCm === 20 && f.sample === 45);
    f = find(await run({ rounds: [round({ shots: [...misses(10, -0.2), ...misses(35, 0.3)] })] }), "miss-side-sideways");
    assert.ok(f && f.title === "You miss to the right" && f.evidence.averageOffsetCm === 30);
    assert.ok(!find(await run({ rounds: [round({ shots: [...misses(22, -0.2), ...misses(23, 0.2)] })] }), "miss-side-sideways"), "even");
    assert.ok(!find(await run({ rounds: [round({ shots: misses(T.SIDE_MIN - 1, -0.2) })] }), "miss-side-sideways"), "39 misses");
    assert.ok(find(await run({ rounds: [round({ shots: misses(T.SIDE_MIN, -0.2) })] }), "miss-side-sideways"), "40 misses");
    assert.ok(!find(await run({ rounds: [round({ shots: [...misses(60, 0.02), ...misses(60, -0.03)] })] }), "miss-side-sideways"), "inside the centre band");
  });

  await test("counter-strafe: shots while still against moving, and the minimums", async () => {
    const mk = (stillHits, movingHits, n = 150) => [round({ shots: [...group(n, stillHits, { speed: 0.1 }), ...group(n, movingHits, { speed: 4.2 })] })];
    const f = find(await run({ rounds: mk(105, 45) }), "counter-strafe");
    assert.ok(f && f.evidence.stillAccuracyPercent === 70 && f.evidence.movingAccuracyPercent === 30 && f.evidence.gapPoints === 40 && f.evidence.movingSharePercent === 50 && f.sample === 300);
    assert.ok(!find(await run({ rounds: mk(90, 84) }), "counter-strafe"), "no real gap");
    assert.ok(!find(await run({ rounds: mk(45, 105) }), "counter-strafe"), "moving shots better: nothing to flag");
    assert.ok(!find(await run({ rounds: mk(105, 45, T.MOVE_SHOTS_MIN - 1) }), "counter-strafe"), "149 shots in a group");
    assert.strictEqual(T.MOVE_GAP_POINTS, 12);
    assert.ok(!find(await run({ rounds: mk(105, 88) }), "counter-strafe"), "11 points");
    assert.ok(find(await run({ rounds: mk(105, 87) }), "counter-strafe"), "12 points");
    // exactly STILL_MPS counts as moving; airborne shots and shots without movement fields are ignored
    const edge = round({ shots: [...group(150, 120, { speed: 0.49 }), ...group(150, 30, { speed: 0.5 })] });
    assert.ok(find(await run({ rounds: [edge] }), "counter-strafe"));
    const air = round({ shots: [...group(150, 120, { speed: 0.1 }), ...group(150, 0, { speed: 4, airborne: true }), ...group(150, 0, {})] });
    assert.ok(!find(await run({ rounds: [air] }), "counter-strafe"), "airborne and old shots do not count as moving");
  });

  await test("walk-accuracy: walking against running while moving, both directions, and the minimums", async () => {
    const mk = (walkHits, runHits, n = 150) => [round({ shots: [...group(n, walkHits, { speed: 3, walk: true }), ...group(n, runHits, { speed: 5, walk: false })] })];
    let f = find(await run({ rounds: mk(105, 45) }), "walk-accuracy");
    assert.ok(f && f.severity === "tip" && /more accurate/.test(f.title) && f.evidence.walkAccuracyPercent === 70 && f.evidence.runAccuracyPercent === 30);
    f = find(await run({ rounds: mk(45, 105) }), "walk-accuracy");
    assert.ok(f && f.severity === "info" && /does not help/.test(f.title));
    assert.ok(!find(await run({ rounds: mk(90, 81) }), "walk-accuracy"), "6 points");
    assert.ok(!find(await run({ rounds: mk(105, 45, T.MOVE_SHOTS_MIN - 1) }), "walk-accuracy"));
    // standing shots do not count, whatever the walk flag says
    const still = round({ shots: [...group(150, 135, { speed: 0, walk: true }), ...group(150, 15, { speed: 0, walk: false })] });
    assert.ok(!find(await run({ rounds: [still] }), "walk-accuracy"));
  });

  await test("crouch-accuracy: crouched against standing, both directions, and the minimums", async () => {
    const mk = (cHits, sHits, n = 150) => [round({ shots: [...group(n, cHits, { speed: 0, crouch: 1 }), ...group(n, sHits, { speed: 0, crouch: 0 }), ...group(30, 0, { speed: 0, crouch: 0.3 })] })];
    let f = find(await run({ rounds: mk(120, 60) }), "crouch-accuracy");
    assert.ok(f && f.severity === "tip" && f.title === "You shoot better crouched" && f.evidence.crouchedAccuracyPercent === 80 && f.evidence.standingAccuracyPercent === 40 && f.evidence.gapPoints === 40 && f.sample === 300, "the half-crouched shots are in neither group");
    f = find(await run({ rounds: mk(60, 120) }), "crouch-accuracy");
    assert.ok(f && f.severity === "info" && /does not help/.test(f.title));
    assert.ok(!find(await run({ rounds: mk(90, 81) }), "crouch-accuracy"), "6 points");
    assert.ok(!find(await run({ rounds: mk(120, 60, T.POSTURE_SHOTS_MIN - 1) }), "crouch-accuracy"));
    // shots with no crouch amount fall back to the crouch bit; airborne shots are ignored
    const bit = round({ shots: [...many(150, (i) => ns({ hit: i < 120, speed: 0 })).map((s) => ({ ...s, crouchAmount: undefined, movement: { ...s.movement, crouch: true } })), ...group(150, 60, { speed: 0, crouch: 0 })] });
    assert.ok(find(await run({ rounds: [bit] }), "crouch-accuracy"));
    const air = round({ shots: [...group(150, 120, { speed: 0, crouch: 1, airborne: true }), ...group(150, 60, { speed: 0, crouch: 0 })] });
    assert.ok(!find(await run({ rounds: [air] }), "crouch-accuracy"));
  });

  await test("sens-changed, sens-extreme and mouse-accel", async () => {
    const withSens = (list) => list.map((v, i) => round({ day: "2026-11-1" + (i % 6), at: at("2026-11-10") + i * 1000, input: { sensitivity: v[0], adsMultiplier: v[1] ?? 1, scopedMultiplier: 1, invertY: false, accelerationNotice: !!v[2] } }));
    const steady = (n, v = [0.5, 1]) => many(n, () => v);
    // changed: the newest round differs from the 6 before it
    let out = await run({ rounds: withSens([...steady(6), [0.8, 1]]) });
    let f = find(out, "sens-changed");
    assert.ok(f && f.title === "You changed your sensitivity" && f.evidence.sensitivity === 0.8 && f.evidence.usualSensitivity === 0.5 && f.evidence.earlierRounds === 6 && f.sample === 7);
    f = find(await run({ rounds: withSens([...steady(6), [0.5, 0.6]]) }), "sens-changed");
    assert.ok(f && f.title === "You changed your ADS sensitivity" && f.evidence.usualAdsMultiplier === 1);
    assert.ok(!find(await run({ rounds: withSens([...steady(6), [0.505, 1]]) }), "sens-changed"), "a 1% difference is the same setting");
    assert.ok(!find(await run({ rounds: withSens(steady(7)) }), "sens-changed"), "unchanged");
    assert.ok(!find(await run({ rounds: withSens([...steady(T.SENS_ROUNDS_MIN - 1), [0.8, 1]]) }), "sens-changed"), "4 earlier rounds");
    assert.ok(find(await run({ rounds: withSens([...steady(T.SENS_ROUNDS_MIN), [0.8, 1]]) }), "sens-changed"), "5 earlier rounds");
    // extreme: very high, very low, normal, and the minimum
    f = find(await run({ rounds: withSens(steady(6, [2.4, 1])) }), "sens-extreme");
    assert.ok(f && f.title === "Your sensitivity is very high" && f.evidence.medianSensitivity === 2.4 && f.severity === "tip" && /guess/.test(f.detail));
    f = find(await run({ rounds: withSens(steady(6, [0.08, 1])) }), "sens-extreme");
    assert.ok(f && f.title === "Your sensitivity is very low");
    assert.ok(!find(await run({ rounds: withSens(steady(8, [0.5, 1])) }), "sens-extreme"));
    assert.ok(!find(await run({ rounds: withSens(steady(T.SENS_ROUNDS_MIN - 1, [2.4, 1])) }), "sens-extreme"), "4 rounds");
    // acceleration notice in at least half of the recent rounds
    f = find(await run({ rounds: withSens(many(8, (i) => [0.5, 1, i < 5])) }), "mouse-accel");
    assert.ok(f && f.evidence.roundsWithNotice === 5 && f.evidence.rounds === 8);
    assert.ok(!find(await run({ rounds: withSens(many(8, (i) => [0.5, 1, i < 3])) }), "mouse-accel"), "3 of 8");
    assert.ok(!find(await run({ rounds: withSens(many(T.SENS_ROUNDS_MIN - 1, () => [0.5, 1, true])) }), "mouse-accel"), "4 rounds");
    // rounds from before the input header existed are ignored
    assert.ok(!find(await run({ rounds: many(10, () => round({})) }), "sens-extreme"));
    // only the newest SENS_RECENT_ROUNDS rounds are "recent": 40 old high rounds followed by 30 normal ones
    out = await run({ rounds: withSens([...steady(40, [2.4, 1]), ...steady(30, [0.5, 1])]) });
    assert.ok(!find(out, "sens-extreme") && !find(out, "sens-changed"));
  });

  await test("since, limit, filters and ordering", async () => {
    const old = round({ day: "2026-10-01", nearMisses: near(90, "above", 0.2) });
    const fresh = round({ day: "2026-11-16", nearMisses: near(10, "above", 0.2) });
    assert.ok(find(await run({ rounds: [old, fresh] }), "miss-side"), "everything counts without since");
    assert.ok(!find(await run({ rounds: [old, fresh] }, { since: "2026-11-01" }), "miss-side"), "the old rounds are cut by a day string");
    assert.ok(!find(await run({ rounds: [old, fresh] }, { since: at("2026-11-01") }), "miss-side"), "and by epoch ms");
    assert.ok(find(await run({ rounds: [old, fresh] }, { since: new Date(at("2026-09-01")) }), "miss-side"), "and a Date keeps them");
    // limit and ordering: warnings first, then tips, then info; limit cuts from the end
    const rs = [round({ nearMisses: near(90, "above", 0.2), engagements: many(30, (i) => eng({ enemyId: i + 1 })), deaths: many(30, () => ({ tick: 9, cause: "shot", killerId: 99 })) })];
    const all = await run({ rounds: rs });
    assert.ok(all.length >= 2);
    for (let i = 1; i < all.length; i++) assert.ok({ warn: 0, tip: 1, info: 2 }[all[i - 1].severity] <= { warn: 0, tip: 1, info: 2 }[all[i].severity]);
    assert.strictEqual(all[0].id, "fights-lost");
    assert.deepStrictEqual(ids(await run({ rounds: rs }, { limit: 1 })), [all[0].id]);
    // the filter reaches the recorder, with a round limit
    const s = stub({ rounds: [fresh] });
    await loadCoach(s).insights({ code: "drillA", map: "bind", weapon: "vandal" });
    assert.deepStrictEqual(s.calls[0], { code: "drillA", map: "bind", weapon: "vandal", limit: T.ROUND_LIMIT });
  });

  await test("the real recorder's rows feed the coach (field names match)", async () => {
    const idb = makeFactory();
    const store = new Map();
    const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
    // 12 rounds written in the recorder's own compact form (as the old localStorage key, which the recorder migrates on start)
    const W = ["vandal"];
    const mkRound = (i) => ({
      v: 1, at: at("2026-11-15") + i * 1000, code: "drillA", map: "bind", mode: "score", wpn: "vandal", dt: 1 / 128, end: "died", W, T: [1], K: { 1: "humanoid" },
      s: [...many(6, (k) => [10 + k * 5, 0, k < 2 ? "head" : "body", 1, 1.5, 1, 10, 0, 0]), ...many(4, (k) => [100 + k * 5, 0, null, null, null, null, null, -1, 0])],
      d: [[300, 3.2, 0, 4.7, 5, 0, 12, "shot"]],
      e: [[5, 0, 20, 90, 30, 0.1, 40, 3, 4, "flick", 0], [6, 0, 200, 260, 5, 3, 10, 1, 1, "strafe", 0]],
      m: many(8, (k) => [100 + k * 5, 6 + k % 4, 5, 0, 0.2, 0.3]),
    });
    store.set("aim-analytics-rounds-v1", JSON.stringify(many(12, mkRound)));
    const listeners = {};
    const win = { addEventListener: (n, f) => (listeners[n] = listeners[n] || []).push(f), indexedDB: idb.factory || idb, IDBKeyRange };
    new Function("window", "localStorage", "setTimeout", "console", RECORDER)(win, ls, (fn, ms) => setTimeout(fn, ms >= 1000 ? 5 : ms), { warn() {}, log() {} });
    await new Promise((r) => setTimeout(r, 300)); // the migration runs after the shortened start-up delay
    new Function("window", COACH)(win);
    const out = await win.__aimCoach.insights({});
    const got = ids(out);
    assert.ok(got.includes("death-zone:bind"), "death-zone from the day rows: " + got);
    assert.ok(got.includes("miss-side"), "miss-side: " + got);
    assert.ok(got.includes("fights-lost"), "fights-lost: " + got);
    assert.strictEqual(find(out, "miss-side").evidence.nearMisses, 96);
    assert.strictEqual(find(out, "death-zone:bind").evidence.deathsInCell, 12);
    assert.strictEqual(find(out, "fights-lost").evidence.fightsLost, 12);
    assert.strictEqual(find(out, "fights-lost").evidence.fightsWon, 24);
  });

  await test("the real recorder's movement, nearest-enemy and input fields feed the coach", async () => {
    const idb = makeFactory();
    const store = new Map();
    const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
    // compact shot rows with the trailing fields: [tick, W, part, x, y, z, dist, T, killed, pellets, speed, mask, since, crouch, range, centre, side, vertical]
    const hitRow = (t, speed, range, mask = 0) => [t, 0, "body", 1, 1, 1, range, 0, 0, null, speed, mask, 0, 0, range, 0.1, 0, 0];
    const missRow = (t, speed, range, side, mask = 0) => [t, 0, null, null, null, null, null, -1, 0, null, speed, mask, 0, 0, range, 0.3, side, 0];
    const mkRound = (i) => {
      const s = []; let t = 10;
      for (let k = 0; k < 20; k++) s.push(k < 12 ? hitRow(t += 100, 0.1, 5) : missRow(t += 100, 0.1, 5, -0.2)); // still, near: 12 of 20
      for (let k = 0; k < 20; k++) s.push(k < 4 ? hitRow(t += 100, 4.5, 25, 17) : missRow(t += 100, 4.5, 25, -0.2, 17)); // moving with walk held, far: 4 of 20
      return { v: 1, at: at("2026-11-15") + i * 1000, code: "drillA", map: "bind", mode: "score", wpn: "vandal", dt: 1 / 128, end: "died", W: ["vandal"], T: [1], K: { 1: "humanoid" }, s, d: [],
        sens: i === 7 ? 0.9 : 0.5, sensAds: 1, sensScoped: 1, ...(i % 2 ? { sensAccel: 1 } : {}) };
    };
    store.set("aim-analytics-rounds-v1", JSON.stringify(many(8, mkRound)));
    const win = { addEventListener() {}, indexedDB: idb.factory || idb, IDBKeyRange };
    new Function("window", "localStorage", "setTimeout", "console", RECORDER)(win, ls, (fn, ms) => setTimeout(fn, ms >= 1000 ? 5 : ms), { warn() {}, log() {} });
    await new Promise((r) => setTimeout(r, 300));
    new Function("window", COACH)(win);
    const out = await win.__aimCoach.insights({});
    const got = ids(out).join(",");
    for (const id of ["accuracy-range", "miss-side-sideways", "counter-strafe", "sens-changed", "mouse-accel"]) assert.ok(find(out, id), id + " missing from " + got);
    assert.strictEqual(find(out, "counter-strafe").evidence.stillAccuracyPercent, 60);
    assert.strictEqual(find(out, "counter-strafe").evidence.movingAccuracyPercent, 20);
    assert.strictEqual(find(out, "accuracy-range").evidence.weakest, "far");
    assert.strictEqual(find(out, "miss-side-sideways").evidence.left, 8 * 24);
    assert.strictEqual(find(out, "sens-changed").evidence.sensitivity, 0.9);
    assert.strictEqual(find(out, "mouse-accel").evidence.roundsWithNotice, 4);
    assert.ok(!find(out, "walk-accuracy"), "every moving shot has the walk key, so there is nothing to compare");
  });

  await test("the real recorder's recoil fields (rows with 22 entries) feed the spray-control rule", async () => {
    const idb = makeFactory();
    const store = new Map();
    const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
    // [tick, W, part, x, y, z, dist, T, killed, pellets, speed, mask, since, crouch, range, centre, side, vertical, yawErr, pitchErr, aimYaw, aimPitch]
    const row = (t, k) => [t, 0, null, null, null, null, null, -1, 0, null, 0, 0, 0, 0, null, null, null, null, 0, k < 3 ? 0.5 : 3.5, 0, 0];
    const mkRound = (i) => {
      const s = [];
      for (let run = 0; run < 4; run++) for (let k = 0; k < 8; k++) s.push(row(1000 * run + 10 * k, k));
      return { v: 1, at: at("2026-11-15") + i * 1000, code: "drillA", map: "bind", mode: "score", wpn: "vandal", dt: 1 / 128, end: "died", W: ["vandal"], T: [1], K: { 1: "humanoid" }, s, d: [] };
    };
    store.set("aim-analytics-rounds-v1", JSON.stringify(many(10, mkRound)));
    const win = { addEventListener() {}, indexedDB: idb.factory || idb, IDBKeyRange };
    new Function("window", "localStorage", "setTimeout", "console", RECORDER)(win, ls, (fn, ms) => setTimeout(fn, ms >= 1000 ? 5 : ms), { warn() {}, log() {} });
    await new Promise((r) => setTimeout(r, 300));
    new Function("window", COACH)(win);
    const f = find(await win.__aimCoach.insights({}), "spray-control");
    assert.ok(f, "spray-control missing");
    assert.strictEqual(f.evidence.basis, "bullet-proxy"); assert.strictEqual(f.evidence.runs, 40); assert.strictEqual(f.evidence.bulletDriftPitchDeg, 3); assert.strictEqual(f.evidence.recoilKickPitchDeg, 3); assert.strictEqual(f.evidence.mostly, "vertical");
  });

  // ---- tracking (18 Nov 2026) ----
  const tk = (o = {}) => ({ samples: 100, seconds: 0.78, bodyOn: 80, headOn: 20, bodyErrorSum: 150, headErrorSum: 300, lagSum: 0, jitterSum: 20, jitterPairs: 90, lockBodySeconds: 0.2, lockHeadSeconds: null, enemySpeedSum: 4000, ...o });
  const trackRounds = (n, o) => [round({ engagements: many(n, () => eng({ tracking: tk(o) })) })];
  await test("tracking: trailing, overshooting, losing and tracking well; the minimums; lock time", async () => {
    let list = await run({ rounds: trackRounds(10, { lagSum: 300 }) });
    let f = find(list, "tracking");
    assert.ok(f && f.severity === "tip" && /trails/.test(f.title), "behind by 3 degrees: " + (f && f.title));
    assert.strictEqual(f.evidence.direction, "behind"); assert.strictEqual(f.evidence.bodyOnPercent, 80); assert.strictEqual(f.evidence.lagDegrees, 3);
    f = find(await run({ rounds: trackRounds(10, { lagSum: -300 }) }), "tracking");
    assert.ok(f && /overshoot/.test(f.title) && f.evidence.direction === "ahead");
    f = find(await run({ rounds: trackRounds(10, { bodyOn: 30 }) }), "tracking");
    assert.ok(f && /lose/.test(f.title) && f.severity === "tip", "under half on the body");
    f = find(await run({ rounds: trackRounds(10, {}) }), "tracking");
    assert.ok(f && f.severity === "info" && /well/.test(f.title), "level and mostly on the body");
    assert.ok(!find(await run({ rounds: trackRounds(7, { lagSum: 300 }) }), "tracking"), "7 fights are not enough");
    assert.ok(!find(await run({ rounds: trackRounds(10, { samples: 20, bodyOn: 5 }) }), "tracking"), "fights with under 32 sampled ticks do not count");
    assert.ok(!find(await run({ rounds: [round({ engagements: many(12, () => eng()) })] }), "tracking"), "old rounds without tracking say nothing");
    assert.ok(!find(await run({ rounds: trackRounds(10, {}) }), "tracking-lock"), "0.2 s to lock is fast");
    f = find(await run({ rounds: trackRounds(10, { lockBodySeconds: 0.7 }) }), "tracking-lock");
    assert.ok(f && f.evidence.medianLockSeconds === 0.7 && f.severity === "tip");
    f = find(await run({ rounds: trackRounds(10, { lagSum: 300 }) }, { weapon: "sheriff" }), "tracking");
    assert.ok(!f, "the weapon filter drops engagements of other weapons");
    const C = loadCoach(stub({ rounds: trackRounds(10, { lagSum: 300 }) }));
    const t = (await C.insights({})).find((x) => x.id === "tracking");
    assert.ok(/% on body/.test(t.summary) && /behind/.test(t.summary), t.summary);
  });

  const failed = results.filter(([, ok]) => !ok).length;
  console.log("\n" + (results.length - failed) + " of " + results.length + " passed");
  process.exit(failed ? 1 : 0);
})();
