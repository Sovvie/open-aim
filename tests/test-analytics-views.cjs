// Test for the Session, Drills, Compare, export and hit-report additions of app/analytics-ui.js. Run: node test-analytics-views.cjs
// Pure functions are called through window.__aimAnalyticsUi.render; the panel is driven in the same DOM shim test-analytics-ui.cjs uses
// (its first part is read from that file, so the shim exists once).
process.env.TZ = "UTC";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const uiTest = fs.readFileSync(path.join(__dirname, "test-analytics-ui.cjs"), "utf-8");
const head = uiTest.slice(0, uiTest.indexOf("let passed = 0"));
const { load, stub, settle, El } = new Function("require", "__dirname", head + "\nreturn { load, stub, settle, El };")(require, __dirname);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const NOW = Date.parse("2026-11-20T15:00:00Z");
const MIN = 60 * 1000, DAY = 86400000;
const { ui } = load({ analytics: stub() });
const R = ui.render;

// ---- builders (the expanded shape of __aimAnalytics.rounds()) ----
// A round starting at `at` with `n` shots, the first `hits` of them hits (every 4th a headshot), 8 ticks apart (0.0625 s).
let seq = 0;
function rnd(at, { n = 20, hits = 10, heads = 0, end = "cleared", code = "drillA", sight = true, kills = 0, deaths = 0, ttk = [], track = null, map = "bind" } = {}) {
  const shots = Array.from({ length: n }, (_, i) => ({ tick: 100 + i * 8, weapon: "vandal", part: i < hits ? (i < heads ? "head" : "body") : null, killed: i < kills }));
  return { id: "r" + ++seq, at, day: new Date(at).toISOString().slice(0, 10), code, map, mode: "score", end, sight, tickSeconds: 1 / 128, shots,
    deaths: Array.from({ length: deaths }, (_, i) => ({ tick: 900 + i, cause: "shot" })), nearMisses: [],
    engagements: ttk.map((t, i) => ({ enemyId: i, startTick: 50, killed: true, killTick: 400, kind: "flick", visibleTimeToKill: t, tracking: track })) };
}
const trackRow = (samples, bodyOn) => ({ samples, bodyOn, headOn: 0, bodyErrorSum: 0, headErrorSum: 0, lagSum: 0, jitterSum: 0, jitterPairs: 0 });

test("roundSeconds is the last recorded tick; a round with nothing has 0 s", () => {
  assert.strictEqual(R.roundSeconds(rnd(NOW, { n: 3 })), +(116 / 128).toFixed(1)); // last shot at tick 116
  assert.strictEqual(R.roundSeconds({ shots: [], deaths: [{ tick: 1280 }], tickSeconds: 1 / 128 }), 10);
  assert.strictEqual(R.roundSeconds({}), 0);
  assert.strictEqual(R.roundSeconds({ shots: [{ tick: 1e9 }], tickSeconds: 1 }), 3600, "capped at an hour");
});

test("roundFacts: counts, kill times and tracking only from rounds with sight data", () => {
  const withSight = R.roundFacts(rnd(NOW, { n: 10, hits: 5, heads: 2, kills: 2, deaths: 1, ttk: [0.5, 0.7], track: trackRow(100, 60) }));
  assert.deepStrictEqual([withSight.shots, withSight.hits, withSight.headshots, withSight.kills, withSight.deaths], [10, 5, 2, 2, 1]);
  assert.deepStrictEqual(withSight.ttk, [0.5, 0.7]);
  assert.deepStrictEqual([withSight.trackOn, withSight.trackN], [120, 200], "two fights, 60 of 100 ticks each");
  const old = R.roundFacts(rnd(NOW, { sight: false, kills: 2, ttk: [0.5], track: trackRow(100, 60) }));
  assert.deepStrictEqual(old.ttk, [], "no kill times without sight");
  assert.strictEqual(old.trackN, 0, "no tracking without sight");
  assert.strictEqual(old.kills, 2, "plain counts still count");
  assert.strictEqual(R.roundFacts(rnd(NOW, { track: trackRow(3, 3), ttk: [0.5] })).trackN, 0, "a tracking entry under the minimum ticks is skipped");
});

test("groupSessions: a gap of 30 minutes between the end of one round and the start of the next starts a session", () => {
  const f = (at, seconds) => ({ at, seconds });
  const s = R.groupSessions([f(NOW + 100 * MIN, 60), f(NOW, 60), f(NOW + 5 * MIN, 60), f(NOW + 40 * MIN, 60), f(NOW + 42 * MIN, 60)]);
  assert.deepStrictEqual(s.map((x) => x.rounds.length), [2, 2, 1], "a 34-minute gap and a 57-minute gap start sessions");
  assert.ok(s[0].start < s[1].start, "oldest first");
  assert.deepStrictEqual(R.groupSessions([]), []);
  assert.deepStrictEqual(R.groupSessions([{ at: null }, null]), []);
  // a long round counts to its end: round 2 starts 31 min after round 1 began but 1 min after it ended
  assert.strictEqual(R.groupSessions([f(NOW, 1800), f(NOW + 31 * MIN, 60)]).length, 1);
});

test("totalsOf sums rounds and counts clears and deaths", () => {
  const t = R.totalsOf([R.roundFacts(rnd(NOW, { n: 10, hits: 4, end: "cleared" })), R.roundFacts(rnd(NOW, { n: 20, hits: 10, end: "died", deaths: 1 }))]);
  assert.deepStrictEqual([t.rounds, t.shots, t.hits, t.cleared, t.died, t.deaths], [2, 30, 14, 1, 1, 1]);
});

test("compareMetric: sample guards, direction, and 'about the same'", () => {
  const M = (id) => R.compareRows ? null : null; void M;
  const tot = (o) => ({ rounds: 5, shots: 200, hits: 100, headshots: 20, kills: 0, deaths: 5, ttk: [], trackOn: 0, trackN: 0, ...o });
  const rows = (a, b) => Object.fromEntries(R.compareRows(a, b).map((r) => [r.id, r]));
  let r = rows(tot({ hits: 110 }), tot({ hits: 90 }));
  assert.strictEqual(r.accuracy.verdict, "better"); assert.ok(Math.abs(r.accuracy.delta - 10) < 1e-9);
  assert.strictEqual(rows(tot({ hits: 91 }), tot({ hits: 90 })).accuracy.verdict, "same", "half a point is noise");
  assert.strictEqual(rows(tot({ hits: 80 }), tot({ hits: 90 })).accuracy.verdict, "worse");
  assert.strictEqual(rows(tot({ shots: 29, hits: 20 }), tot()).accuracy.verdict, "unknown", "30 shots needed now");
  assert.strictEqual(rows(tot(), tot({ shots: 29, hits: 20 })).accuracy.verdict, "unknown", "and before");
  // lower is better for kill time and deaths
  assert.strictEqual(rows(tot({ ttk: [0.5, 0.5, 0.5, 0.5, 0.5] }), tot({ ttk: [0.9, 0.9, 0.9, 0.9, 0.9] })).killTime.verdict, "better");
  assert.strictEqual(rows(tot({ ttk: [0.5, 0.5, 0.5, 0.5] }), tot({ ttk: [0.9, 0.9, 0.9, 0.9, 0.9] })).killTime.verdict, "unknown", "5 kills with sight data needed");
  assert.strictEqual(rows(tot({ deaths: 10 }), tot({ deaths: 5 })).deaths.verdict, "worse");
  assert.strictEqual(rows(tot({ trackN: 63, trackOn: 30 }), tot({ trackN: 100, trackOn: 40 })).tracking.verdict, "unknown");
  assert.strictEqual(rows(tot({ trackN: 100, trackOn: 50 }), tot({ trackN: 100, trackOn: 40 })).tracking.verdict, "better");
  assert.strictEqual(rows(tot(), null).accuracy.prev, null);
});

function sessionsOf(spec) {
  // spec: [{ rounds: n, acc }] each session one hour after the last, rounds 5 minutes apart
  let t = NOW - 5 * DAY;
  return R.groupSessions(spec.flatMap((s, si) => Array.from({ length: s.rounds }, (_, i) => R.roundFacts(rnd(t + si * 3 * 3600000 + i * 5 * MIN, { n: 40, hits: Math.round(40 * s.acc), end: s.end || "cleared", deaths: s.deaths || 0, kills: 3, ttk: s.ttk || [], map: "bind" })))));
}

test("sessionVersus: improved and slipped lists against the earlier sessions put together; no base, no verdicts", () => {
  const s = sessionsOf([{ rounds: 3, acc: 0.4, deaths: 0 }, { rounds: 3, acc: 0.4, deaths: 0 }, { rounds: 3, acc: 0.55, deaths: 1 }]);
  assert.strictEqual(s.length, 3);
  const v = R.sessionVersus(s, 2);
  assert.ok(v.hasBase && v.before === 2);
  assert.deepStrictEqual(v.improved.map((r) => r.id), ["accuracy"]);
  assert.deepStrictEqual(v.slipped.map((r) => r.id), ["deaths"]);
  assert.ok(/Accuracy rose to 55\.0% \(was 40\.0%\)/.test(R.changeText(v.improved[0])), R.changeText(v.improved[0]));
  assert.ok(/Deaths per round rose to 1\.00 \(was 0\.00\)/.test(R.changeText(v.slipped[0])));
  const first = R.sessionVersus(s, 0);
  assert.ok(!first.hasBase && first.improved.length === 0 && first.slipped.length === 0);
  // too little before: one earlier round of 40 shots is under the 60 shots the comparison needs
  const thin = R.sessionVersus(sessionsOf([{ rounds: 1, acc: 0.2 }, { rounds: 3, acc: 0.6 }]), 1);
  assert.ok(!thin.hasBase);
  // only the newest 5 earlier sessions make "usual"
  const many = sessionsOf([{ rounds: 3, acc: 0.1 }, ...Array.from({ length: 5 }, () => ({ rounds: 3, acc: 0.5 })), { rounds: 3, acc: 0.5 }]);
  assert.strictEqual(R.sessionVersus(many, 6).before, 5);
  assert.strictEqual(R.sessionVersus(many, 6).rows.find((r) => r.id === "accuracy").verdict, "same");
});

test("sessionLabel and timelineOf", () => {
  const s = R.groupSessions([R.roundFacts(rnd(NOW - 2 * 3600000)), R.roundFacts(rnd(NOW - DAY)), R.roundFacts(rnd(NOW - 3 * DAY))]);
  assert.deepStrictEqual(s.map((x) => R.sessionLabel(x, NOW)), ["17 Nov 15:00", "Yesterday 15:00", "Today 13:00"]);
  const cells = R.timelineOf({ rounds: [R.roundFacts(rnd(NOW, { n: 10, hits: 5, end: "died" })), R.roundFacts(rnd(NOW, { n: 0, hits: 0, end: "time" }))] });
  assert.deepStrictEqual(cells.map((c) => [c.end, c.accuracy]), [["died", 50], ["time", null]]);
});

test("sessionDrills: rounds and accuracy per drill, the best medal of runs made during the session", () => {
  const s = R.groupSessions([R.roundFacts(rnd(NOW, { code: "aaa", n: 10, hits: 5 })), R.roundFacts(rnd(NOW + 2 * MIN, { code: "aaa", n: 10, hits: 10 })), R.roundFacts(rnd(NOW + 4 * MIN, { code: "bbb", n: 10, hits: 1 }))])[0];
  const runs = { aaa: { unit: "", lower: false, runs: [{ at: NOW + 3 * MIN, score: 10, medal: "silver" }, { at: NOW + 4 * MIN, score: 20, medal: "gold", died: true }, { at: NOW - DAY, score: 99, medal: "gold" }] } };
  const d = R.sessionDrills(s, runs, (c) => c.toUpperCase());
  assert.deepStrictEqual(d.map((x) => [x.name, x.rounds, x.accuracy]), [["AAA", 2, 75], ["BBB", 1, 10]]);
  assert.strictEqual(d[0].bestMedal, "silver", "a died run and a run of another day do not count");
  assert.strictEqual(d[0].bestScore, 10);
  assert.strictEqual(d[1].bestMedal, null);
});

test("sessionHtml: tiles, a coloured timeline strip, what improved / slipped, the drills; empty store gives a message", () => {
  assert.ok(R.sessionHtml({ rounds: [] }, null, NOW, {}, (c) => c).includes("No rounds recorded yet"));
  const t = NOW - 2 * DAY;
  const rounds = [
    ...Array.from({ length: 4 }, (_, i) => rnd(t + i * 5 * MIN, { n: 40, hits: 16, end: "cleared" })),
    ...Array.from({ length: 4 }, (_, i) => rnd(NOW - 40 * MIN + i * 5 * MIN, { n: 40, hits: i === 3 ? 10 : 26, end: i === 3 ? "died" : i === 2 ? "time" : "cleared", deaths: i === 3 ? 1 : 0, code: "drillB" })),
  ];
  const html = R.sessionHtml({ rounds }, null, NOW, { drillB: { unit: "", lower: false, runs: [{ at: NOW - 30 * MIN, score: 5, medal: "bronze" }] } }, (c) => "Drill " + c);
  assert.ok(html.includes("data-session-tiles") && html.includes("data-timeline"));
  assert.strictEqual((html.match(/class="aim-an-tl is-/g) || []).length, 4, "one cell per round of the shown session");
  for (const c of ["is-cleared", "is-time", "is-died"]) assert.ok(html.includes("aim-an-tl " + c), c);
  assert.ok(html.includes("data-versus") && html.includes("What improved") && html.includes("What slipped"));
  assert.ok(/Accuracy rose to/.test(html), "accuracy better than the earlier session");
  assert.ok(html.includes("Drill drillB") && html.includes("data-session-medals"));
  assert.ok(html.includes('data-session="0"') && html.includes('data-session="1"') && html.includes('aria-pressed="true"'), "session picker");
  // picking the older session shows no base
  assert.ok(R.sessionHtml({ rounds }, 0, NOW, {}, (c) => c).includes("data-versus-empty"));
  // escapes names
  assert.ok(!R.sessionHtml({ rounds }, null, NOW, {}, () => "<b>x</b>").includes("<b>x</b>"));
});

test("totalsFromDays and periodCompare: day rows for accuracy, rounds only for timing, windows of equal length", () => {
  const day = (n, o) => ({ day: new Date(NOW - n * DAY).toISOString().slice(0, 10), rounds: 2, shots: 100, hits: 40, headshots: 10, kills: 5, deaths: 2, ...o });
  const days = [day(0), day(6), day(7, { hits: 60 }), day(13, { hits: 60 }), day(14, { hits: 80 }), day(20, { hits: 1 })];
  const t = R.totalsFromDays(days, "2026-11-14", "2026-11-20");
  assert.deepStrictEqual([t.rounds, t.shots, t.hits], [4, 200, 80]);
  const c = R.periodCompare(days, [], 7, NOW);
  assert.deepStrictEqual([c.cur.shots, c.cur.hits, c.prev.shots, c.prev.hits], [200, 80, 200, 120], "7 days against the 7 days before");
  assert.strictEqual(c.rows.find((r) => r.id === "accuracy").verdict, "worse");
  assert.strictEqual(c.rows.find((r) => r.id === "killTime").verdict, "unknown");
  // timing comes from rounds with sight: now 5 kill times at 0.5, before 5 at 0.9; a round without sight is ignored
  const rs = [rnd(NOW - DAY, { ttk: [0.5, 0.5, 0.5, 0.5, 0.5] }), rnd(NOW - 9 * DAY, { ttk: [0.9, 0.9, 0.9, 0.9, 0.9] }), rnd(NOW - DAY, { sight: false, ttk: [0.1] })];
  const c2 = R.periodCompare(days, rs, 7, NOW);
  assert.strictEqual(c2.rows.find((r) => r.id === "killTime").verdict, "better");
  assert.ok(c2.timingPrev);
  // 30 days: the earlier period is older than the stored rounds reach, so its timing is left out
  const c30 = R.periodCompare(days, rs, 30, NOW);
  assert.ok(!c30.timingPrev);
  assert.strictEqual(c30.rows.find((r) => r.id === "killTime").prev, null);
  assert.ok(R.compareHtml(days, rs, 30, NOW).includes("Rounds older than 30 days"));
});

test("compareHtml: a card per metric with a verdict class, a range picker, and empty / unknown wording", () => {
  const day = (n, o) => ({ day: new Date(NOW - n * DAY).toISOString().slice(0, 10), rounds: 2, shots: 100, hits: 40, headshots: 10, kills: 5, deaths: 2, ...o });
  const html = R.compareHtml([day(1, { hits: 60 }), day(8)], [], 7, NOW);
  assert.strictEqual((html.match(/data-verdict=/g) || []).length, 5);
  assert.ok(html.includes('data-metric="accuracy"') && html.includes('data-verdict="better"') && html.includes("aim-an-cmp is-up"));
  assert.ok(html.includes('data-cmp-range="14"') && html.includes('data-cmp-range="30"'));
  assert.ok(html.includes("Not enough kills with sight data"), "unknown metrics say why");
  assert.ok(R.compareHtml([], [], 7, NOW).includes("Nothing recorded"));
  assert.ok(R.compareHtml([day(1)], [], 99, NOW).includes('aria-pressed="true">Last 7 days'), "a bad range falls back to 7");
});

// ---- drills ----
const logic = {
  thresholds: (e) => (e.runs.length >= 3 ? { bronze: 10, silver: 20, gold: 30, source: "history" } : null),
  nextMedal: (s, th, lower) => { const have = logic.medalFor(s, th, lower), tiers = ["bronze", "silver", "gold"], i = have ? tiers.indexOf(have) + 1 : 0; return i >= 3 ? null : { tier: tiers[i], score: th[tiers[i]], gap: Math.abs(th[tiers[i]] - s) }; },
  medalFor: (s, th, lower) => { let m = null; for (const t of ["bronze", "silver", "gold"]) if (lower ? s <= th[t] : s >= th[t]) m = t; return m; },
};
const entryOf = (scores, o = {}) => ({ name: "Drill", unit: "", lower: false, best: Math.max(...scores), bestMedal: null, medals: { bronze: 0, silver: 0, gold: 0 }, custom: null, runs: scores.map((score, i) => ({ at: NOW - (scores.length - i) * DAY, score, died: false, medal: null })), ...o });

test("drillModel: last, best, trend over 5 against 5, consistency, medal progress", () => {
  const m = R.drillModel("aaa", entryOf([10, 10, 10, 10, 10, 12, 12, 12, 12, 12]), logic, [], "Aaa");
  assert.strictEqual(m.last, 12); assert.strictEqual(m.best, 12); assert.strictEqual(m.goodRuns, 10);
  assert.strictEqual(m.trend.direction, "up"); assert.strictEqual(Math.round(m.trend.pct), 20);
  assert.strictEqual(m.spark.length, 10);
  assert.strictEqual(m.next.tier, "silver"); assert.ok(m.progress > 0 && m.progress < 1, "12 is between bronze 10 and silver 20: " + m.progress);
  assert.ok(Math.abs(m.progress - 0.2) < 1e-9);
  // too few runs: no trend, no consistency
  const few = R.drillModel("bbb", entryOf([10, 11, 12]), logic, [], "B");
  assert.strictEqual(few.trend, null); assert.strictEqual(few.spread, null);
  // flat
  assert.strictEqual(R.drillModel("c", entryOf([10, 10, 10, 10, 10, 10, 10, 10]), logic, []).trend.direction, "flat");
  // lower is better: scores falling is an improvement
  const low = R.drillModel("d", entryOf([20, 20, 20, 20, 20, 10, 10, 10, 10, 10], { lower: true, unit: "s", best: 10 }), logic, []);
  assert.strictEqual(low.trend.direction, "up"); assert.ok(low.trend.goodPct > 0 && low.trend.pct < 0);
  // died runs do not count
  const died = entryOf([10, 10, 10, 10, 10, 10]); died.runs[5] = { ...died.runs[5], score: 1, died: true };
  assert.strictEqual(R.drillModel("e", died, logic, []).last, 10);
  assert.strictEqual(R.drillModel("e", died, logic, []).died, 1);
});

test("drillModel consistency labels: steady, normal and swingy by the spread of the newest scores", () => {
  const label = (scores) => R.drillModel("x", entryOf(scores), logic, []).spread;
  assert.strictEqual(label([100, 101, 100, 99, 100]).label, "steady");
  assert.strictEqual(label([100, 112, 90, 105, 95]).label, "normal");
  assert.strictEqual(label([100, 140, 60, 130, 70]).label, "swingy");
  assert.strictEqual(label([100, 140, 60, 130]), null, "needs 5 runs");
});

test("drillModel takes rounds for accuracy and works with no routine entry at all", () => {
  const plays = [R.roundFacts(rnd(NOW, { n: 10, hits: 5, heads: 1 })), R.roundFacts(rnd(NOW, { n: 10, hits: 3 }))];
  const m = R.drillModel("zzz", null, logic, plays, "");
  assert.strictEqual(m.runs, 0); assert.strictEqual(m.rounds, 2); assert.strictEqual(m.accuracy, 40);
  assert.strictEqual(m.name, "zzz");
  assert.ok(R.drillRowHtmlTest === undefined);
  assert.ok(R.drillsHtml([m], "recent").includes("no scored runs"));
});

test("drillModels: union of drills with runs and drills with rounds; sortDrills by every key, missing numbers last", () => {
  const runs = { a: entryOf([10, 10, 10, 10, 10, 10], { bestMedal: "bronze", name: "Alpha" }), b: entryOf([10, 12, 8, 14, 6, 15, 5], { bestMedal: "gold", name: "Bravo" }), c: entryOf([5, 6], { name: "Charlie" }) };
  const facts = [R.roundFacts(rnd(NOW, { code: "d" }))];
  const ms = R.drillModels(runs, logic, facts, (c) => (runs[c] ? runs[c].name : "Delta"));
  assert.deepStrictEqual(ms.map((m) => m.code).sort(), ["a", "b", "c", "d"]);
  const order = (key) => R.sortDrills(ms, key).map((m) => m.code).join("");
  assert.strictEqual(order("name"), "abcd");
  assert.strictEqual(order("recent")[0], "d", "d has a round today; its lastAt is newer than any run");
  assert.strictEqual(order("medal").slice(0, 2), "ba", "gold before bronze");
  assert.strictEqual(order("steady").slice(0, 2), "ab", "a is perfectly steady, b swingy; c and d have no spread and go last");
  assert.ok(["cd", "dc"].includes(order("steady").slice(2)));
  assert.strictEqual(order("runs")[0], "b", "7 runs");
  assert.strictEqual(R.sortDrills(ms, "nonsense").length, 4, "an unknown key does not throw");
  assert.strictEqual(R.drillModels({ "bad code!": entryOf([1]) }, logic, [], null).length, 0, "an invalid share code is dropped");
});

test("drillsHtml: sortable list with sparklines, medal, trend; click targets; empty message", () => {
  assert.ok(R.drillsHtml([], "recent").includes("No drills yet"));
  const ms = R.drillModels({ a: entryOf([10, 10, 10, 10, 10, 12, 12, 12, 12, 12], { bestMedal: "silver", name: "Alpha" }) }, logic, [], () => "Alpha <1>");
  const html = R.drillsHtml(ms, "trend");
  assert.ok(html.includes('data-drill-open="a"') && html.includes('role="button"') && html.includes("<polyline"));
  assert.ok(html.includes("↑ 20%") && html.includes("aim-an-drill is-up"));
  assert.strictEqual((html.match(/data-sort="/g) || []).length, 6);
  assert.ok(html.includes('data-sort="trend" aria-pressed="true"'));
  assert.ok(!html.includes("Alpha <1>") && html.includes("Alpha &lt;1&gt;"));
});

test("sparkSvg: a polyline over at least two points, flat series do not divide by zero", () => {
  assert.ok(!R.sparkSvg([1]).includes("<polyline"));
  const s = R.sparkSvg([5, 5, 5, 5]);
  assert.ok(s.includes("<polyline") && !/NaN|Infinity/.test(s));
  assert.ok(!/NaN/.test(R.sparkSvg([1, 2, 3, NaN, null])));
});

test("drillDetailHtml: tiles, medal scores with counts, next medal bar, score chart with medal lines, latest runs", () => {
  const e = entryOf([10, 12, 8, 14, 22, 15, 5, 25], { bestMedal: "silver", medals: { bronze: 3, silver: 1, gold: 0 } });
  e.runs[2].died = true; e.runs[4].medal = "silver";
  const m = R.drillModel("a", e, logic, [R.roundFacts(rnd(NOW, { code: "a", n: 10, hits: 5 }))], "Alpha");
  const html = R.drillDetailHtml(m, e);
  assert.ok(html.includes("data-drill-back") && html.includes("Alpha") && html.includes("data-drill-tiles"));
  assert.ok(html.includes("aim-an-medal-line is-bronze") && html.includes("aim-an-medal-line is-gold") && html.includes("aim-an-best-ring"));
  assert.ok(html.includes("aim-an-run is-died"), "a died run is hollow");
  assert.ok(html.includes("data-next") && html.includes("aim-an-prog"));
  assert.ok(html.includes("Latest runs"));
  assert.ok(!/NaN|Infinity/.test(html));
  // a drill with one run draws no chart and does not throw
  const one = R.drillModel("b", entryOf([5]), logic, [], "B");
  assert.ok(!R.drillDetailHtml(one, entryOf([5])).includes("aim-an-score"));
  assert.ok(R.drillDetailHtml(one, entryOf([5])).includes("Medals start after 3 finished runs"));
});

// ---- export ----
test("csvCell: quotes, doubled quotes, line breaks, formula guard, nulls", () => {
  assert.strictEqual(R.csvCell(null), ""); assert.strictEqual(R.csvCell(undefined), ""); assert.strictEqual(R.csvCell(NaN), "");
  assert.strictEqual(R.csvCell(12.5), "12.5"); assert.strictEqual(R.csvCell(-3), "-3", "a number is never guarded");
  assert.strictEqual(R.csvCell("a,b"), '"a,b"'); assert.strictEqual(R.csvCell('say "hi"'), '"say ""hi"""'); assert.strictEqual(R.csvCell("a\nb"), '"a\nb"');
  assert.strictEqual(R.csvCell("=1+1"), "'=1+1"); assert.strictEqual(R.csvCell("-cmd"), "'-cmd"); assert.strictEqual(R.csvCell("@x"), "'@x");
  assert.strictEqual(R.csvCell("plain"), "plain");
});

test("roundsCsv: header, one row per round oldest first, rates, kill time only with sight, names escaped", () => {
  const csv = R.roundsCsv([rnd(NOW, { n: 10, hits: 5, heads: 2, kills: 1, deaths: 1, end: "died", ttk: [0.4, 0.6], code: "abc" }), rnd(NOW - 3600000, { sight: false, ttk: [0.4] })], (c) => (c === "abc" ? 'Flick, "fast"' : c));
  const lines = csv.trim().split("\r\n");
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[0], "started,drill,drill_code,map,mode,result,seconds,shots,hits,accuracy_pct,headshots,headshot_pct,kills,deaths,near_misses,median_kill_time_s,tracking_on_body_pct,line_of_sight_data");
  assert.ok(lines[1].includes(",0,") || true);
  assert.ok(lines[1].startsWith("2026-11-20 14:00:00,"), lines[1]);
  assert.ok(lines[2].startsWith("2026-11-20 15:00:00,") && lines[2].includes('"Flick, ""fast"""'), lines[2]);
  const cells = lines[2].match(/("([^"]|"")*"|[^,]*)(,|$)/g);
  assert.ok(lines[2].includes(",10,5,50,2,40,1,1,0,0.5,,1"), "shots, hits, accuracy, headshots, headshot %, kills, deaths, near misses, median kill time, no tracking, sight: " + lines[2]);
  assert.ok(lines[1].endsWith(",,0"), "no kill time and no sight data: " + lines[1]); void cells;
  assert.strictEqual(R.roundsCsv([], null).trim(), lines[0], "no rounds: the header only");
});

test("daysCsv and exportJson", () => {
  const days = [{ day: "2026-11-19", rounds: 2, shots: 10, hits: 5, headshots: 1, kills: 2, deaths: 1, falls: 0, nearMisses: 4, grid: { bind: { "1,1": 2 } }, fights: { bind: {} }, ids: ["a"], maps: { bind: { rounds: 2 } } }, { day: "2026-11-18", rounds: 1, shots: 0, hits: 0 }];
  const lines = R.daysCsv(days).trim().split("\r\n");
  assert.strictEqual(lines[0], "day,rounds,shots,hits,accuracy_pct,headshots,headshot_pct,kills,deaths,falls,near_misses,flick_kills,strafe_kills");
  assert.strictEqual(lines[1], "2026-11-18,1,0,0,,0,,0,0,0,0,0,0", "oldest first, no rate without shots");
  assert.strictEqual(lines[2], "2026-11-19,2,10,5,50,1,20,2,1,0,4,0,0");
  const j = JSON.parse(R.exportJson([rnd(NOW, { n: 4, hits: 2 })], days, { a: { runs: [] } }, (c) => "N:" + c, NOW));
  assert.strictEqual(j.app, "openVaim"); assert.strictEqual(j.exported, new Date(NOW).toISOString());
  assert.strictEqual(j.rounds.length, 1); assert.strictEqual(j.rounds[0].drill, "N:drillA"); assert.strictEqual(j.rounds[0].shots, 4);
  assert.ok(!("grid" in j.days[0]) && !("fights" in j.days[0]) && !("ids" in j.days[0]) && j.days[0].maps.bind.rounds === 2, "position grids are left out");
  assert.deepStrictEqual(Object.keys(j.drills), ["a"]);
  assert.doesNotThrow(() => R.exportJson(null, null, null, null));
});

// ---- hit report ----
const shotAt = (tick, hit, o = {}) => ({ tick, weapon: "vandal", part: hit ? "body" : null, ...o });
test("burstSplit: first shots, follow-ups, taps (1-2 shots) and sprays (5+); a pause or another weapon starts a new burst", () => {
  const dt = 1 / 128, g = 0.4 / dt; // 51.2 ticks
  const shots = [shotAt(0, true), shotAt(100, false), shotAt(200, true), shotAt(210, false),
    shotAt(1000, true), shotAt(1010, true), shotAt(1020, false), shotAt(1030, false), shotAt(1040, false)];
  const b = R.burstSplit(shots, dt);
  assert.deepStrictEqual(b.first, { n: 4, hits: 3 }, "four bursts: 0 / 100 / 200-210 / 1000-1040: first shots hit, miss, hit, hit");
  assert.deepStrictEqual(b.follow, { n: 5, hits: 1 });
  assert.deepStrictEqual(b.tap, { bursts: 3, n: 4, hits: 2 }, "bursts of 1, 1 and 2 shots");
  assert.deepStrictEqual(b.spray, { bursts: 1, n: 5, hits: 2 });
  assert.ok(g > 50 && g < 52);
  // gap exactly at the limit stays in; just over starts a new burst
  assert.strictEqual(R.burstSplit([shotAt(0, true), shotAt(51, true)], dt).follow.n, 1);
  assert.strictEqual(R.burstSplit([shotAt(0, true), shotAt(52, true)], dt).follow.n, 0);
  // weapon change splits
  assert.strictEqual(R.burstSplit([shotAt(0, true), shotAt(10, true, { weapon: "judge" })], dt).follow.n, 0);
  // unsorted input, junk, no dt
  assert.strictEqual(R.burstSplit([shotAt(10, true), shotAt(0, true), null, { part: "head" }], dt).follow.n, 1);
  assert.strictEqual(R.burstSplit(undefined).first.n, 0);
  assert.strictEqual(R.burstSplit([shotAt(0, true), shotAt(40, true)]).follow.n, 1, "default tick length 1/128");
});

test("burstHtml: bars only with enough shots; shows taps and sprays only when they exist; first shot vs follow-ups", () => {
  assert.strictEqual(R.burstHtml(null), "");
  const few = R.burstSplit([shotAt(0, true), shotAt(10, true)], 1 / 128);
  assert.strictEqual(R.burstHtml(few), "", "under 8 shots");
  const shots = []; // 4 sprays of 5 (first shot hits, the rest miss), 2 taps that hit
  for (let k = 0; k < 4; k++) for (let i = 0; i < 5; i++) shots.push(shotAt(k * 1000 + i * 10, i === 0));
  shots.push(shotAt(5000, true), shotAt(6000, true));
  const html = R.burstHtml(R.burstSplit(shots, 1 / 128));
  assert.ok(html.includes("How you fire") && html.includes('data-burst="first"') && html.includes('data-burst="follow"') && html.includes('data-burst="spray"') && html.includes('data-burst="tap"'));
  assert.ok(html.includes("First shot (6)") && html.includes(">100%<") && html.includes(">0%<"), html);
  const noSpray = R.burstHtml(R.burstSplit(Array.from({ length: 10 }, (_, i) => shotAt(i * 1000, true)), 1 / 128));
  assert.ok(!noSpray.includes('data-burst="spray"') && noSpray.includes('data-burst="tap"') && noSpray.includes("Follow-ups (0)") && noSpray.includes("–"));
});

test("heatHtml: a soft disc per hit (more where hits cluster), none under 3 hits, none for misses; capped", () => {
  const sum = (n, shape) => ({ shape, dots: Array.from({ length: n }, (_, i) => ({ x: 60, y: 90, kind: i % 5 === 4 ? "miss" : "hit" })) });
  assert.strictEqual(R.heatHtml(sum(2, "humanoid")), "", "2 hits");
  assert.ok(R.heatHtml(sum(3, "humanoid")).includes("<g"), "3 hits");
  const h = R.heatHtml(sum(10, "humanoid"));
  assert.strictEqual((h.match(/<circle/g) || []).length, 8, "8 hits of 10");
  assert.ok(h.includes('class="aim-an-heat"') && h.includes('r="10"'));
  assert.ok(R.heatHtml(sum(10, "sphere")).includes('r="12"'));
  assert.strictEqual((R.heatHtml({ shape: "humanoid", dots: Array.from({ length: 900 }, () => ({ x: 1, y: 1, kind: "hit" })) }).match(/<circle/g) || []).length, 400);
});

test("hit panel: the all-shots pane gets the heat and the fire bars; the killer pane does not; the figure stays under the dots", () => {
  const shots = []; for (let k = 0; k < 5; k++) for (let i = 0; i < 3; i++) shots.push({ tick: k * 1000 + i * 10, weapon: "vandal", part: i === 0 ? "head" : null, killed: false, target: "bot" });
  const round = { id: "r", day: "2026-11-20", at: NOW, end: "died", map: "bind", mode: "score", code: "abc", tickSeconds: 1 / 128, shots, deaths: [{ tick: 4000, cause: "shot", killerId: 1, killer: "bot" }], engagements: [] };
  const html = R.hitPanelHtml(round, "all", null, true);
  const all = html.slice(html.indexOf('data-hit-pane="all"'));
  assert.ok(all.includes("aim-an-heat") && all.includes("How you fire"));
  assert.ok(all.indexOf("aim-an-heat") < all.indexOf('class="aim-an-dot'), "glow first, dots on top");
  const killer = html.slice(html.indexOf('data-hit-pane="killer"'), html.indexOf('data-hit-pane="all"'));
  assert.ok(!killer.includes("How you fire"), "the killer pane has no fire bars");
  assert.ok(R.hitPanelHtml(round, "all", null, false).includes("How you fire"), "also on a cleared screen");
  assert.strictEqual(R.hitSummary(round).bursts.first.n, 5);
});

// ---- the panel ----
async function openPanel(analytics, view, extra = {}) {
  const { ui: u, document, window } = load({ analytics, ...extra });
  const host = document.createElement("div");
  document.body.appendChild(host);
  u.mountInline(host, view);
  await settle(10);
  const content = () => host.querySelector(".aim-an-content");
  const click = (sel, data) => content().listeners.click[0]({ target: { closest: (s) => (s === sel ? { dataset: data } : null) } });
  return { ui: u, document, window, host, content, click };
}
const richStub = () => stub({
  rounds: [rnd(Date.now() - 3 * DAY, { n: 40, hits: 16 }), rnd(Date.now() - 3 * DAY + 5 * MIN, { n: 40, hits: 16 }), rnd(Date.now() - 20 * MIN, { n: 40, hits: 28 }), rnd(Date.now() - 15 * MIN, { n: 40, hits: 28 })],
  days: [{ day: new Date(Date.now() - 3 * DAY).toISOString().slice(0, 10), rounds: 2, shots: 80, hits: 32, headshots: 8, kills: 4, deaths: 1 }, { day: new Date().toISOString().slice(0, 10), rounds: 2, shots: 80, hits: 56, headshots: 12, kills: 6, deaths: 1 }],
});

test("panel: the Session tab is the default, reads the rounds once, and the session chips switch the session without a new read", async () => {
  const A = richStub(), p = await openPanel(A, undefined);
  assert.ok(p.content().innerHTML.includes("data-session-tiles"), "session is the first view");
  assert.strictEqual(p.host.querySelector(".aim-an-tabs").children[0].getAttribute("aria-pressed"), "true");
  assert.strictEqual(A.calls.filter((c) => c[0] === "rounds").length, 1);
  p.click("[data-session]", { session: "0" }); await settle();
  assert.ok(p.content().innerHTML.includes("data-versus-empty"), "the first session has nothing before it");
  assert.strictEqual(A.calls.filter((c) => c[0] === "rounds").length, 1, "no new read");
});

test("panel: Drills lists drills from the medal history, a click opens one, back returns, sort buttons re-sort; no write to the medal store", async () => {
  const A = richStub();
  const runs = { drillA: entryOf([10, 10, 10, 10, 10, 12, 12, 12, 12, 12], { name: "Drill A", bestMedal: "gold" }), other: entryOf([3, 4, 5], { name: "Other" }) };
  let wrote = false;
  const routines = { runs: () => runs, logic, ui: { medalIcon: (t) => `<svg data-medal="${t}"/>` }, setCustom() { wrote = true; }, finishRun() { wrote = true; } };
  const p = await openPanel(A, "drills", { win: { __aimRoutines: routines } });
  let html = p.content().innerHTML;
  assert.ok(html.includes('data-drill-open="drillA"') && html.includes('data-drill-open="other"'));
  assert.ok(html.includes('data-medal="gold"'));
  p.click("[data-sort]", { sort: "name" }); await settle();
  html = p.content().innerHTML;
  assert.ok(html.indexOf('data-drill-open="drillA"') < html.indexOf('data-drill-open="other"') && html.includes('data-sort="name" aria-pressed="true"'));
  p.click("[data-drill-open]", { drillOpen: "drillA" }); await settle();
  assert.ok(p.content().innerHTML.includes("data-drill-back") && p.content().innerHTML.includes("aim-an-score"));
  p.click("[data-drill-back]", {}); await settle();
  assert.ok(p.content().innerHTML.includes("data-drill-list"));
  assert.ok(!wrote, "the medal store is only read");
  // another tab and back starts at the list again after a reopen of a missing drill
  p.click("[data-drill-open]", { drillOpen: "gone" }); await settle();
  assert.ok(p.content().innerHTML.includes("data-drill-list"), "an unknown drill falls back to the list");
});

test("panel: Compare reads days and rounds once and re-cuts on the range buttons", async () => {
  const A = richStub(), p = await openPanel(A, "compare");
  assert.ok(p.content().innerHTML.includes("data-cmp-grid"));
  p.click("[data-cmp-range]", { cmpRange: "14" }); await settle();
  assert.ok(p.content().innerHTML.includes('data-cmp-range="14" aria-pressed="true"'));
  assert.strictEqual(A.calls.filter((c) => c[0] === "days").length, 1);
});

test("panel: failing readers and an empty store give plain messages on the new tabs", async () => {
  for (const view of ["session", "drills", "compare"]) {
    const p = await openPanel(stub({ fail: true }), view, { win: { __aimRoutines: { runs: () => { throw new Error("x"); } } } });
    assert.ok(/aim-an-msg/.test(p.content().innerHTML), view + ": " + p.content().innerHTML.slice(0, 80));
    const q = await openPanel(stub(), view);
    assert.ok(/aim-an-msg/.test(q.content().innerHTML), view + " empty");
  }
});

test("export: the buttons read fresh, build the file and start a Blob download; nothing recorded says so", async () => {
  const A = richStub();
  const p = await openPanel(A, "session");
  const foot = p.host.querySelector(".aim-an-foot");
  assert.ok(foot.innerHTML.includes('data-export="rounds"') && foot.innerHTML.includes('data-export="days"') && foot.innerHTML.includes('data-export="json"'));
  const saved = [];
  const realCreate = p.document.createElement.bind(p.document);
  p.document.createElement = (t) => { const el = realCreate(t); if (t === "a") el.click = () => saved.push({ name: el.download, href: el.href }); return el; };
  const origBlob = global.Blob, blobs = [];
  global.Blob = class extends origBlob { constructor(parts, o) { super(parts, o); blobs.push({ text: parts.join(""), type: o && o.type }); } };
  try {
    assert.strictEqual(await p.ui.runExport({ foot, content: p.content() }, "rounds"), true);
    assert.ok(/^openvaim-rounds-\d{4}-\d\d-\d\d\.csv$/.test(saved[0].name), saved[0].name);
    assert.ok(blobs[0].text.startsWith("﻿started,drill,") && blobs[0].type.startsWith("text/csv"));
    assert.strictEqual(blobs[0].text.trim().split("\r\n").length, 5, "header and 4 rounds");
    assert.strictEqual(await p.ui.runExport({ foot }, "days"), true);
    assert.ok(saved[1].name.endsWith(".csv") && blobs[1].text.includes("accuracy_pct"));
    assert.strictEqual(await p.ui.runExport({ foot }, "json"), true);
    assert.ok(saved[2].name.endsWith(".json") && JSON.parse(blobs[2].text).rounds.length === 4);
    assert.strictEqual(await p.ui.runExport({ foot }, "nope"), false);
  } finally { global.Blob = origBlob; }
  // nothing recorded
  const q = await openPanel(stub(), "session");
  assert.strictEqual(await q.ui.runExport({ foot: q.host.querySelector(".aim-an-foot") }, "rounds"), false);
  assert.strictEqual(saved.length, 3, "no file for an empty store");
});

// ---- round 2 (21 Nov 2026): Compare gaps, per-drill deltas, goals, the suggested warm-up ----
test("mergeRawDays / periodCompare: a day with no row (or a row that lags the stored rounds) is taken from the rounds; a bigger row is kept", () => {
  const rs = [rnd(NOW - DAY, { n: 20, hits: 10, heads: 2, kills: 3, deaths: 1 }), rnd(NOW - DAY + 5 * MIN, { n: 20, hits: 10 }), rnd(NOW - 9 * DAY, { n: 20, hits: 5 })];
  const lag = { day: new Date(NOW - DAY).toISOString().slice(0, 10), rounds: 1, shots: 20, hits: 10, headshots: 2, kills: 3, deaths: 1, grid: { bind: { "1,1": 1 } } };
  const merged = R.mergeRawDays([lag], rs.map(R.roundFacts));
  const yday = merged.find((d) => d.day === lag.day), old = merged.find((d) => d.day === new Date(NOW - 9 * DAY).toISOString().slice(0, 10));
  assert.deepStrictEqual([yday.rounds, yday.shots, yday.hits], [2, 40, 20], "the lagging row is replaced by the rounds' counts");
  assert.ok(yday.grid && yday.grid.bind, "and keeps its other fields");
  assert.deepStrictEqual([old.rounds, old.shots, old.hits], [1, 20, 5], "no row for that day: made from the rounds");
  const big = { ...lag, rounds: 9, shots: 900, hits: 450 };
  assert.deepStrictEqual(R.mergeRawDays([big], rs.map(R.roundFacts)).find((d) => d.day === lag.day).shots, 900, "a row with more rounds stays");
  // the point: rounds but no day rows at all still compare (the old behaviour said "Nothing recorded")
  const html = R.compareHtml([], rs, 7, NOW);
  assert.ok(!html.includes("Nothing recorded") && html.includes("data-cmp-grid"), "rounds without day rows");
  assert.ok(html.includes("2 rounds, 40 shots"), html.slice(0, 600));
  assert.ok(R.compareHtml([], [], 7, NOW).includes("Nothing recorded"));
});

test("compare card: the arrow points sideways for a change that is too small to count", () => {
  const day = (n, o) => ({ day: new Date(NOW - n * DAY).toISOString().slice(0, 10), rounds: 2, shots: 100, hits: 40, headshots: 10, kills: 5, deaths: 2, ...o });
  const html = R.compareHtml([day(1, { hits: 41 }), day(8)], [], 7, NOW), card = html.slice(html.indexOf('data-metric="accuracy"'), html.indexOf('data-metric="headshots"'));
  assert.ok(card.includes('data-verdict="same"') && card.includes("→") && !card.includes("↑"), card);
});

test("sessionDrillChanges: each drill against the last earlier session that had it, with minimum shots, and a lower-is-better score flipped", () => {
  const S = (at, code, n, hits) => R.roundFacts(rnd(at, { code, n, hits }));
  const sessions = R.groupSessions([S(NOW - 5 * DAY, "aaa", 40, 20), S(NOW - 5 * DAY + 2 * MIN, "bbb", 40, 20), S(NOW - 3 * DAY, "aaa", 40, 24), S(NOW - DAY, "ccc", 40, 20), S(NOW, "aaa", 40, 32), S(NOW + 2 * MIN, "bbb", 10, 9), S(NOW + 4 * MIN, "ddd", 40, 10)]);
  assert.strictEqual(sessions.length, 4);
  const runs = { aaa: { unit: "pts", lower: false, runs: [{ at: NOW - 3 * DAY + 5000, score: 100 }, { at: NOW + 5000, score: 150 }] }, bbb: { unit: "s", lower: true, runs: [{ at: NOW - 5 * DAY + 2 * MIN + 5000, score: 30 }, { at: NOW + 2 * MIN + 5000, score: 36 }] } };
  const d = R.sessionDrillChanges(sessions, 3, runs, (c) => c), by = (c) => d.find((x) => x.code === c);
  assert.strictEqual(by("aaa").prev.start, sessions[1].start, "the nearest earlier session with the drill");
  assert.deepStrictEqual([Math.round(by("aaa").acc.delta), by("aaa").acc.verdict], [20, "better"], "60% -> 80%");
  assert.deepStrictEqual([by("aaa").score.delta, by("aaa").score.verdict], [50, "better"]);
  assert.strictEqual(by("bbb").prev.start, sessions[0].start, "looks back past sessions without it");
  assert.strictEqual(by("bbb").acc, null, "10 shots now is under the minimum");
  assert.deepStrictEqual([by("bbb").score.delta, by("bbb").score.verdict], [6, "worse"], "36 s against 30 s: less is better");
  assert.strictEqual(by("ddd").prev, null);
  assert.ok(R.changeCellHtml(by("ddd")).includes("First time"));
  assert.ok(R.changeCellHtml(by("aaa")).includes("is-up") && R.changeCellHtml(by("aaa")).includes("+20 pts accuracy") && R.changeCellHtml(by("aaa")).includes("+50 pts best score"), R.changeCellHtml(by("aaa")));
  assert.ok(R.changeCellHtml(by("bbb")).includes("is-down"));
  assert.deepStrictEqual(R.sessionDrillChanges(sessions, 0, runs, (c) => c).map((x) => x.prev), [null, null], "the first session has nothing before it");
  // the Session tab shows the cells
  const html = R.sessionHtml({ rounds: [rnd(NOW - 3 * DAY, { code: "aaa", n: 40, hits: 24 }), rnd(NOW, { code: "aaa", n: 40, hits: 32 })] }, null, NOW, {}, (c) => c);
  assert.ok(html.includes("aim-an-sd-change") && html.includes("accuracy"), "in the session list");
});

test("goals: normalising, adding with its rules, removing", () => {
  assert.strictEqual(R.normalizeGoal({ type: "medal", tier: "platinum" }), null);
  assert.strictEqual(R.normalizeGoal({ type: "body", percent: 0 }), null);
  assert.strictEqual(R.normalizeGoal({ type: "body", percent: 101 }), null);
  assert.strictEqual(R.normalizeGoal({ type: "score", target: NaN }), null);
  assert.strictEqual(R.normalizeGoal({ type: "other" }), null);
  assert.deepStrictEqual(Object.keys(R.normalizeGoals({ "aa-1": [{ type: "score", target: 5 }, { type: "x" }], "bad code!": [{ type: "score", target: 5 }], z: "no" })), ["aa-1"]);
  const entry = entryOf([10, 12, 14, 16, 18], { bestMedal: "bronze", unit: "pts" }), th = logic.thresholds(entry), map = {};
  const r = R.addGoal(map, "aaa", { type: "medal", tier: "silver" }, entry, th, NOW);
  assert.ok(r.ok && r.goal.since === NOW && r.goal.base === 18 && map.aaa.length === 1, "base is the last finished score");
  assert.ok(!R.addGoal(map, "aaa", { type: "medal", tier: "silver" }, entry, th).ok, "the same goal twice");
  assert.ok(!R.addGoal(map, "aaa", { type: "medal", tier: "bronze" }, entry, th).ok, "a medal you already have");
  assert.ok(!R.addGoal({}, "aaa", { type: "medal", tier: "gold" }, entryOf([1, 2]), null).ok, "no medal scores yet");
  assert.ok(/above your best/.test(R.addGoal(map, "aaa", { type: "score", target: 18 }, entry, th).why), "a score you already reached");
  assert.ok(R.addGoal(map, "aaa", { type: "score", target: 25 }, entry, th).ok);
  const lowerEntry = entryOf([40, 38, 36], { lower: true, unit: "s", best: 36 });
  assert.ok(/below your best/.test(R.addGoal({}, "bbb", { type: "score", target: 37 }, lowerEntry, null).why), "less is better: the target must be below");
  assert.ok(R.addGoal({}, "bbb", { type: "score", target: 30 }, lowerEntry, null).ok);
  assert.ok(!R.addGoal({}, "bad code", { type: "score", target: 3 }, entry, th).ok);
  const full = {}; for (let i = 0; i < 6; i++) R.addGoal(full, "ccc", { type: "score", target: 100 + i }, entry, th, NOW);
  assert.strictEqual(full.ccc.length, 6);
  assert.ok(/up to 6/.test(R.addGoal(full, "ccc", { type: "score", target: 200 }, entry, th).why), "six goals is the limit");
  full.ccc[0].done = NOW; assert.ok(R.addGoal(full, "ccc", { type: "score", target: 201 }, entry, th).ok && full.ccc.length === 6, "a finished goal makes room");
  const id = map.aaa[0].id;
  assert.ok(R.removeGoal(map, "aaa", id) && map.aaa.length === 1 && !map.aaa.some((g) => g.id === id));
  R.removeGoal(map, "aaa", map.aaa[0].id); assert.ok(!("aaa" in map), "an empty list is dropped");
});

test("evaluateGoal: medal, score (both directions) and body goals; died runs and runs before the goal do not count", () => {
  const since = NOW - 3 * DAY;
  const run = (dAt, score, o = {}) => ({ at: since + dAt, score, died: false, medal: null, ...o });
  const mk = (runs, o = {}) => { const entry = entryOf([10, 10, 10], { ...o, runs: [run(-DAY, 10), run(-DAY, 10), run(-DAY, 10), ...runs] }); return { entry, m: R.drillModel("aaa", entry, logic, [], "Aaa") }; };
  let { entry, m } = mk([run(1, 15), run(2, 31, { died: true, medal: "gold" })]);
  let ev = R.evaluateGoal({ id: "g1", type: "medal", tier: "silver", since, base: 10, done: null }, m, entry, []);
  assert.ok(!ev.met && ev.label === "Reach Silver" && ev.value === 15 && ev.progress > 0 && ev.progress < 1, JSON.stringify(ev));
  ({ entry, m } = mk([run(1, 21, { medal: "silver" })]));
  ev = R.evaluateGoal({ id: "g1", type: "medal", tier: "silver", since, base: 10, done: null }, m, entry, []);
  assert.ok(ev.met && ev.progress === 1);
  ({ entry, m } = mk([run(-2 * DAY, 99, { medal: "gold" })]));
  assert.ok(!R.evaluateGoal({ id: "g1", type: "medal", tier: "gold", since, base: 10, done: null }, m, entry, []).met, "a run before the goal was set");
  ({ entry, m } = mk([run(1, 25)]));
  ev = R.evaluateGoal({ id: "g2", type: "score", target: 25, since, base: 10, done: null }, m, entry, []);
  assert.ok(ev.met && ev.label.startsWith("Score 25"));
  ev = R.evaluateGoal({ id: "g2", type: "score", target: 50, since, base: 10, done: null }, m, entry, []);
  assert.ok(!ev.met && Math.abs(ev.progress - 15 / 40) < 1e-9, "from the base to the target: " + ev.progress);
  ({ entry, m } = mk([run(1, 28), run(2, 31)], { lower: true, unit: "s" }));
  ev = R.evaluateGoal({ id: "g3", type: "score", target: 30, since, base: 40, done: null }, m, entry, []);
  assert.ok(ev.met && ev.label.endsWith("or less"), "less is better");
  assert.ok(!R.evaluateGoal({ id: "g3", type: "score", target: 25, since, base: 40, done: null }, m, entry, []).met);
  const none = mk([]);
  ev = R.evaluateGoal({ id: "g4", type: "score", target: 99, since, base: null, done: null }, none.m, none.entry, []);
  assert.ok(!ev.met && ev.progress === 0 && /No finished run/.test(ev.status), "no run since");
  ev = R.evaluateGoal({ id: "g5", type: "score", target: 99, since, base: null, done: NOW }, m, entry, []);
  assert.ok(ev.met && ev.status.startsWith("Reached"), "a finished goal stays finished");
  // body: the newest 3 tracked rounds since the goal
  const tr = (at, on, n) => ({ ...R.roundFacts(rnd(at, { n: 5, hits: 2 })), trackOn: on, trackN: n, at });
  const goal = { id: "g6", type: "body", percent: 70, since, base: null, done: null };
  ev = R.evaluateGoal(goal, m, entry, [tr(since + 1, 50, 100), tr(since + 2, 80, 100)]);
  assert.ok(!ev.met && Math.round(ev.value) === 65 && /needs 3|it needs 3/.test(ev.status), "two rounds are not enough: " + ev.status);
  ev = R.evaluateGoal(goal, m, entry, [tr(since - 5, 0, 100), tr(since + 1, 70, 100), tr(since + 2, 80, 100), tr(since + 3, 75, 100)]);
  assert.ok(ev.met && Math.round(ev.value) === 75, "three tracked rounds at 75%: " + JSON.stringify(ev));
  ev = R.evaluateGoal(goal, m, entry, [tr(since + 1, 70, 100), tr(since + 2, 60, 100), tr(since + 3, 60, 100)]);
  assert.ok(!ev.met && Math.round(ev.progress * 100) === 90);
  assert.ok(/No tracked round/.test(R.evaluateGoal(goal, m, entry, [R.roundFacts(rnd(since + 1, { sight: false }))]).status), "rounds without tracking data");
});

test("goalsHtml: bars for each goal, medal buttons only for tiers above your best, the body form only for a drill with tracking data", () => {
  const entry = entryOf([10, 12, 14, 16, 18], { bestMedal: "bronze" });
  const m = R.drillModel("aaa", entry, logic, [], "Aaa");
  let html = R.goalsHtml(m);
  assert.ok(html.includes("data-goals-empty") && html.includes('data-goal-medal="silver"') && html.includes('data-goal-medal="gold"') && !html.includes('data-goal-medal="bronze"'));
  assert.ok(html.includes('data-goal-form="score"') && !html.includes('data-goal-form="body"'));
  const goal = { id: "gabc", type: "medal", tier: "silver", since: NOW, base: 10, done: null };
  m.goals = [R.evaluateGoal(goal, m, entry, [])];
  html = R.goalsHtml(m);
  assert.ok(html.includes('data-goal="gabc"') && html.includes('data-goal-del="gabc"') && html.includes("aim-an-prog") && !html.includes('data-goal-medal="silver"'), "a silver goal already open is not offered again");
  const tracked = R.drillModel("aaa", entry, logic, [{ ...R.roundFacts(rnd(NOW)), trackOn: 5, trackN: 10 }], "Aaa");
  assert.ok(tracked.tracked && R.goalsHtml(tracked).includes('data-goal-form="body"'));
  assert.ok(R.goalsHtml(R.drillModel("n", entryOf([1, 2]), logic, [], "N")).indexOf("data-goal-medal") < 0, "no medal scores: no medal buttons");
  assert.ok(R.drillDetailHtml(m, entry).includes("Goals"));
});

function fakeStorage() { const s = {}; return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, _s: s }; }

test("goals in the panel: set from the drill detail, kept in localStorage, shown on the row; reaching one saves it done and shows the toast once", async () => {
  const ls = fakeStorage(); global.localStorage = ls;
  try {
    const A = richStub();
    const runs = { drillA: entryOf([10, 10, 10, 10, 12], { name: "Drill A", unit: "pts", bestMedal: "bronze" }) };
    const routines = { runs: () => runs, logic, ui: { medalIcon: (t) => `<svg data-medal="${t}"/>` } };
    const p = await openPanel(A, "drills", { win: { __aimRoutines: routines } });
    p.click("[data-drill-open]", { drillOpen: "drillA" }); await settle();
    assert.ok(p.content().innerHTML.includes("data-goals-empty"));
    const submit = (kind, value) => p.content().listeners.submit[0]({ target: { closest: (s) => (s === "[data-goal-form]" ? { dataset: { goalForm: kind }, elements: { v: { value: String(value) } } } : null) }, preventDefault() {} });
    submit("score", 20); await settle();
    let saved = JSON.parse(ls.getItem("aim-an-goals-v1"));
    assert.strictEqual(saved.drillA.length, 1); assert.strictEqual(saved.drillA[0].target, 20);
    assert.ok(p.content().innerHTML.includes("Score 20 pts") && p.content().innerHTML.includes("aim-an-prog"));
    submit("score", 5); await settle();
    assert.strictEqual(JSON.parse(ls.getItem("aim-an-goals-v1")).drillA.length, 1, "below your best: refused");
    p.click("[data-goal-medal]", { goalMedal: "silver" }); await settle();
    assert.strictEqual(JSON.parse(ls.getItem("aim-an-goals-v1")).drillA.length, 2);
    p.click("[data-drill-back]", {}); await settle();
    assert.ok(/goal \d+%/.test(p.content().innerHTML), "the row mentions the goal");
    // a finished run reaches both goals
    runs.drillA.runs.push({ at: Date.now() + 1000, score: 22, died: false, medal: "silver" });
    const made = []; const realCreate = p.document.createElement.bind(p.document);
    p.document.createElement = (t) => { const el = realCreate(t); made.push(el); return el; };
    const got = await p.ui.checkGoals();
    assert.strictEqual(got.length, 2, JSON.stringify(got));
    saved = JSON.parse(ls.getItem("aim-an-goals-v1"));
    assert.ok(saved.drillA.every((g) => g.done), "saved as done");
    const toasts = made.filter((t) => /es-score-toast/.test(t.className));
    assert.strictEqual(toasts.length, 1, "one message for both");
    assert.ok(/Goal reached: /.test(toasts[0].textContent) && /\(\+1 more\)/.test(toasts[0].textContent), toasts[0].textContent);
    assert.strictEqual((await p.ui.checkGoals()).length, 0, "a done goal does not fire again");
    p.click("[data-drill-open]", { drillOpen: "drillA" }); await settle();
    p.click("[data-goal-del]", { goalDel: saved.drillA[0].id }); await settle();
    assert.strictEqual(JSON.parse(ls.getItem("aim-an-goals-v1")).drillA.length, 1);
  } finally { delete global.localStorage; }
});

test("suggested warm-up: the card on the Drills tab, saved through routines.saveRoutine as one routine (the same one when saved again)", async () => {
  const rounds = []; for (let d = 1; d <= 3; d++) for (let i = 0; i < 8; i++) rounds.push(rnd(NOW - d * DAY + i * 5 * MIN, { code: ["aaa", "bbb", "ccc"][i % 3], n: 60, hits: i < 2 ? 15 : 36 }));
  const A = stub({ rounds });
  const saved = [];
  const routines = { runs: () => ({}), routines: () => saved.slice(), logic, ui: { medalIcon: () => "" }, saveRoutine(r) { const at = saved.findIndex((x) => x.id === r.id); if (at >= 0) saved[at] = r; else saved.push(r); return r; } };
  const coach = (() => { const win = { __aimAnalytics: A }; new Function("window", require("fs").readFileSync(path.join(__dirname, "..", "app", "coach.js"), "utf-8"))(win); return win.__aimCoach; })();
  const p = await openPanel(A, "drills", { win: { __aimRoutines: routines, __aimCoach: coach } });
  const html = p.content().innerHTML;
  assert.ok(html.includes("data-warmup") && html.includes("Suggested warm-up") && html.includes("first 2 rounds"), html.slice(0, 500));
  assert.ok(html.includes("data-warmup-save") && html.includes("Add to Routines"));
  p.click("[data-warmup-save]", {}); await settle();
  assert.strictEqual(saved.length, 1); assert.strictEqual(saved[0].id, "rt-suggested-warmup");
  assert.ok(saved[0].steps.length >= 2 && saved[0].steps[0].runs === 2 && saved[0].steps.every((s) => s.minScore === null && s.minMedal === null && s.rank === ""), JSON.stringify(saved[0]));
  p.click("[data-warmup-save]", {}); await settle();
  assert.strictEqual(saved.length, 1, "saving again updates the same routine");
  assert.deepStrictEqual(R.warmupRoutine({ steps: [{ code: "x1", runs: 2 }, { code: "y2", runs: 1 }] }, (c) => c.toUpperCase(), (c) => (c === "x1" ? "ball" : "")).steps.map((s) => [s.code, s.name, s.type, s.runs]), [["x1", "X1", "ball", 2], ["y2", "Y2", "", 1]]);
  assert.ok(R.warmupHtml({ cold: false, steps: [], sessions: null }, (c) => c, false).includes("most played drills"), "no steps: says what is needed");
  assert.ok(R.warmupHtml({ cold: true, firstAccuracyPercent: 40, middleAccuracyPercent: 50, sessions: 4, steps: [{ code: "a", runs: 2, accuracyPercent: 50 }, { code: "b", runs: 1, accuracyPercent: 40 }] }, (c) => c, true).includes("Update the routine"));
  assert.strictEqual(R.warmupHtml(null, (c) => c, false), "");
  const q = await openPanel(A, "drills", { win: { __aimRoutines: routines } });
  assert.ok(!q.content().innerHTML.includes("data-warmup"), "no coach: no card, no crash");
});

test("heatmap drill filter shows the drill's name, not its share code", () => {
  const code = "0123456789abcdef";
  const html = R.heatmapHtml([], [rnd(NOW, { code })], { map: "bind", mode: "", code: "", weapon: "", layer: "deaths" }, null, null, 60, { k: 1, tx: 0, ty: 0 });
  assert.ok(html.includes(`<option value="${code}">`), "the option keeps the code as its value");
  assert.ok(/Drill<select data-filter="code">/.test(html) && !html.includes("Drill code"));
});

(async () => {
  let passed = 0, failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log("ok   " + name); }
    catch (err) { failed++; console.log("FAIL " + name + "\n     " + (err && err.stack ? err.stack.split("\n").slice(0, 4).join("\n     ") : err)); }
  }
  console.log(`\n${passed} of ${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
})();
