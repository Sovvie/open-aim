// Test for coach.js roundTip() and app/round-tip.js. Run: node test-round-tip.cjs
// Fake expanded rounds feed roundTip (through opts.baseline, and through a stub window.__aimAnalytics); the card is mounted in a small
// DOM shim (no jsdom here), like test-analytics-ui.cjs.
process.env.TZ = "UTC";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const COACH = fs.readFileSync(path.join(__dirname, "..", "app", "coach.js"), "utf-8");
const CARD = fs.readFileSync(path.join(__dirname, "..", "app", "round-tip.js"), "utf-8");
const NOW = Date.parse("2026-11-17T12:00:00Z");
Date.now = () => NOW;

function loadCoach(analytics) {
  const win = { __aimAnalytics: analytics };
  new Function("window", COACH)(win);
  return win.__aimCoach;
}

// ---- builders (the expanded shape of __aimAnalytics.rounds()) ----
let seq = 0;
// shots: `hits` body hits and `misses` misses, each miss with an enemy near the line `side` metres to the side (left negative).
function mkRound({ code = "drillA", map = "bind", hits = 20, misses = 20, side = 0.05, heads = 0, vertical = null, nearN = 0, ageH = null } = {}) {
  seq++;
  const shots = [];
  for (let i = 0; i < hits; i++) shots.push({ tick: i, weapon: "vandal", part: i < heads ? "head" : "body" });
  for (let i = 0; i < misses; i++) shots.push({ tick: 100 + i, weapon: "vandal", part: null, nearestEnemy: { range: 10, centreDistance: 0.3, side, vertical: 0 } });
  const nearMisses = vertical == null ? [] : Array.from({ length: nearN || 10 }, () => ({ weapon: "vandal", side: vertical > 0 ? "above" : "below", verticalOffset: vertical, missDistance: 0.2 }));
  return { id: "r" + seq, at: NOW - (ageH ?? 1000 - seq) * 60000, day: "2026-11-16", code, map, mode: "score", shots, deaths: [], engagements: [], nearMisses };
}
// A baseline of n rounds whose sideways average sits near `side` (a little spread so the spread is not zero) and whose hits vary a little.
const baseline = (n, o = {}) => Array.from({ length: n }, (_, i) => mkRound({ ...o, side: (o.side ?? 0.05) + ((i % 5) - 2) * 0.015, hits: 20 + ((i % 3) - 1), misses: 20 - ((i % 3) - 1) }));

const results = [];
async function test(name, fn) {
  try { await fn(); results.push([name, true]); console.log("ok   " + name); }
  catch (e) { results.push([name, false]); console.log("FAIL " + name + "\n     " + (e && e.stack || e)); }
}
const C = loadCoach(undefined);
const T = C.thresholds;

// ---- DOM shim ----
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.attrs = {}; this.dataset = {}; this._html = ""; this.className = ""; this.textContent = ""; }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  get outerText() { return this._html + this.children.map((c) => c.outerText).join(""); }
  get lastElementChild() { return this.children[this.children.length - 1] || null; }
  get nextElementSibling() { const p = this.parentElement; return p ? p.children[p.children.indexOf(this) + 1] || null : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === "id") this.id = String(v); }
  appendChild(c) { if (c.parentElement) c.remove(); c.parentElement = this; this.children.push(c); return c; }
  append(...cs) { for (const c of cs) this.appendChild(c); }
  remove() { const p = this.parentElement; if (p) { p.children = p.children.filter((c) => c !== this); this.parentElement = null; } }
  before(c) { const p = this.parentElement; if (c.parentElement) c.remove(); c.parentElement = p; p.children.splice(p.children.indexOf(this), 0, c); }
  matches(sel) { if (sel.startsWith("#")) return this.id === sel.slice(1); return sel.split(".").filter(Boolean).every((c) => this.className.split(/\s+/).includes(c)); }
  querySelector(sel) { for (const c of this.children) { if (c.matches(sel)) return c; const f = c.querySelector(sel); if (f) return f; } return null; }
}
function makeDoc() {
  const html = new El("html"), head = new El("head"), body = new El("body");
  html.append(head, body);
  return { documentElement: html, head, body, createElement: (t) => new El(t), getElementById: (id) => html.querySelector("#" + id), querySelector: (sel) => html.querySelector(sel) };
}
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
function loadCard({ analytics, coach, wide = false } = {}) {
  const document = makeDoc();
  const window = { __aimAnalytics: analytics, __aimCoach: coach };
  if (wide) window.matchMedia = () => ({ matches: true });
  new Function("window", "document", "requestAnimationFrame", CARD)(window, document, (f) => setTimeout(f, 0));
  return { window, document, card: window.__aimRoundTip };
}
function resultOverlay(document, { died = true, wide = false } = {}) {
  const overlay = document.createElement("div"); overlay.className = "al-result-overlay";
  const splash = document.createElement("div"); splash.className = "al-result-verdict-splash" + (died ? " is-died" : " is-cleared");
  const body = document.createElement("div"); body.className = "al-run-body";
  const strip = document.createElement("div"); strip.className = "al-run-strip";
  const hit = document.createElement("section"); hit.className = "aim-an-hit";
  const acts = document.createElement("div"); acts.className = "al-run-actions";
  const play = document.createElement("button"); play.className = "al-primary-btn";
  acts.appendChild(play);
  body.append(strip, hit, acts); overlay.append(splash, body);
  if (wide) { const pm = document.createElement("div"); pm.className = "al-pm"; overlay.appendChild(pm); const q = overlay.querySelector.bind(overlay); overlay.querySelector = (s) => (s === ":scope > .al-pm" ? pm : q(s)); }
  document.body.appendChild(overlay);
  return { overlay, body, acts, hit };
}

(async () => {
  await test("(i) this round drifts left, the baseline is mostly right: no sideways tip", async () => {
    const rep = {};
    const tip = await C.roundTip(mkRound({ side: -0.12 }), { baseline: baseline(14), report: rep });
    assert.strictEqual(tip, null);
    assert.strictEqual(rep.reason, "no-tip");
    assert.deepStrictEqual(rep.outliers.map((o) => o.metric), ["side"]);
    assert.ok(rep.outliers[0].baselineSameSideShare >= T.ROUND_TIP_OUTLIER_SHARE);
  });

  await test("(i-b) the same outlier does not hide another metric: an accuracy drop still gets its tip", async () => {
    const tip = await C.roundTip(mkRound({ side: -0.12, hits: 6, misses: 34 }), { baseline: baseline(14) });
    assert.ok(tip, "tip expected");
    assert.strictEqual(tip.id, "round-tip-accuracy");
    assert.deepStrictEqual(tip.evidence.outliersSkipped, ["side"]);
  });

  await test("(i-c) opposite sign but the baseline is not one-sided (share < 0.7): not an outlier, so it can be tipped", async () => {
    const mixed = Array.from({ length: 10 }, (_, i) => mkRound({ side: i < 6 ? 0.05 + (i % 3) * 0.01 : -0.05 - (i % 3) * 0.01 }));
    const rep = {};
    const tip = await C.roundTip(mkRound({ side: -0.3 }), { baseline: mixed, report: rep });
    assert.deepStrictEqual(rep.outliers, []);
    assert.ok(tip && tip.id === "round-tip-side", "sideways tip expected");
  });

  await test("(ii) this round drifts right like the baseline, much more: a sideways tip with the numbers and one advice sentence", async () => {
    const rep = {};
    const tip = await C.roundTip(mkRound({ side: 0.2 }), { baseline: baseline(14), report: rep });
    assert.ok(tip, "tip expected");
    assert.strictEqual(tip.id, "round-tip-side"); assert.strictEqual(tip.severity, "tip");
    assert.strictEqual(tip.title, "Your shots drifted right this round");
    assert.ok(tip.detail.includes("0.20 m right"), tip.detail);
    assert.ok(/in your last 14 rounds of this drill it was 0\.05 m right/.test(tip.detail), tip.detail);
    assert.ok(tip.detail.includes("aim a little to the left"), tip.detail);
    assert.strictEqual(tip.evidence.metric, "side"); assert.ok(tip.evidence.z >= T.ROUND_TIP_Z); assert.strictEqual(tip.evidence.baselineRounds, 14);
    assert.ok(typeof tip.sample === "number" && tip.sample === 14);
    assert.strictEqual(rep.reason, "tip");
  });

  await test("(ii-b) a left drift in a baseline that also drifts left is tipped as left", async () => {
    const tip = await C.roundTip(mkRound({ side: -0.2 }), { baseline: baseline(12, { side: -0.05 }) });
    assert.ok(tip && tip.title === "Your shots drifted left this round", tip && tip.title);
    assert.ok(/0\.20 m left/.test(tip.detail) && /0\.05 m left/.test(tip.detail), tip.detail);
  });

  await test("(iii) fewer than 5 baseline rounds: null, and the report says thin data", async () => {
    const rep = {};
    assert.strictEqual(await C.roundTip(mkRound({ side: 0.4, hits: 2, misses: 38 }), { baseline: baseline(T.ROUND_TIP_BASE_MIN - 1), report: rep }), null);
    assert.strictEqual(rep.reason, "thin-data"); assert.strictEqual(rep.baselineRounds, 4); assert.ok(/Fewer than 5/.test(rep.note));
    // exactly 5 is enough
    assert.ok(await C.roundTip(mkRound({ side: 0.4 }), { baseline: baseline(5) }));
  });

  await test("(iv) an accuracy drop against the baseline gives an accuracy tip", async () => {
    const tip = await C.roundTip(mkRound({ hits: 8, misses: 32, side: 0.05 }), { baseline: baseline(14) });
    assert.ok(tip, "tip expected");
    assert.strictEqual(tip.id, "round-tip-accuracy"); assert.strictEqual(tip.title, "Your accuracy dropped this round");
    assert.ok(tip.detail.includes("You hit 20% of your shots this round") && /it was 50%\./.test(tip.detail), tip.detail);
    assert.ok(tip.detail.includes("Slow down"), tip.detail);
    // a better round is also named, with the other title
    const up = await C.roundTip(mkRound({ hits: 34, misses: 6, side: 0.05 }), { baseline: baseline(14) });
    assert.ok(up && up.title === "You were more accurate than usual this round", up && up.title);
  });

  await test("a round like the usual ones gets no tip; too few shots or no analytics gives nothing", async () => {
    assert.strictEqual(await C.roundTip(mkRound({ side: 0.05 }), { baseline: baseline(14) }), null);
    assert.strictEqual(await C.roundTip(mkRound({ hits: 2, misses: 3 }), { baseline: baseline(14) }), null);
    assert.strictEqual(await C.roundTip(undefined, {}), null);
  });

  await test("headshot share and vertical bias are tipped too; the strongest score wins", async () => {
    const base = Array.from({ length: 10 }, (_, i) => mkRound({ heads: 6 + (i % 3), vertical: 0.3 + (i % 3) * 0.01, side: 0.05 }));
    const head = await C.roundTip(mkRound({ heads: 0, vertical: 0.31, side: 0.05 }), { baseline: base });
    assert.ok(head && head.id === "round-tip-headshot" && head.title === "Fewer headshots this round", head && head.id);
    const vert = await C.roundTip(mkRound({ heads: 7, vertical: 0.7, side: 0.05 }), { baseline: base });
    assert.ok(vert && vert.id === "round-tip-vertical" && vert.title === "Your shots went high this round", vert && vert.id);
    assert.ok(/0\.70 m above/.test(vert.detail) && /lower your crosshair/.test(vert.detail), vert.detail);
    // an under-aim round against an over-aim baseline is an outlier: no vertical tip
    const rep = {};
    assert.strictEqual(await C.roundTip(mkRound({ heads: 7, vertical: -0.5, side: 0.05 }), { baseline: base, report: rep }), null);
    assert.deepStrictEqual(rep.outliers.map((o) => o.metric), ["vertical"]);
  });

  await test("baseline: same code first, the same map when the code has fewer than 5 other rounds; this round is never in it", async () => {
    const mine = mkRound({ side: 0.2 });
    const pool = [...baseline(3, { code: "drillA" }), ...baseline(10, { code: "drillB" }), mine];
    const tip = await C.roundTip(mine, { baseline: pool });
    assert.ok(tip && tip.evidence.basis === "map" && tip.evidence.baselineRounds === 13 && /on this map/.test(tip.detail), JSON.stringify(tip && tip.evidence));
    const tip2 = await C.roundTip(mine, { baseline: [...baseline(8, { code: "drillA" }), ...baseline(10, { code: "drillB" })] });
    assert.ok(tip2 && tip2.evidence.basis === "code" && tip2.evidence.baselineRounds === 8 && /of this drill/.test(tip2.detail));
  });

  await test("read through the recorder: the newest round, the baseline by code with this round left out, never rejects", async () => {
    const rounds = [...baseline(10), mkRound({ side: 0.2 })]; // the last one is the newest (a later `at`)
    rounds[rounds.length - 1].at = NOW - 1;
    const calls = [];
    const A = { rounds: async (f) => { calls.push(f); return rounds.filter((r) => !f.code || r.code === f.code).sort((a, b) => a.at - b.at).slice(-(f.limit || 1e9)); } };
    const tip = await loadCoach(A).roundTip(null, {});
    assert.ok(tip && tip.id === "round-tip-side", tip && tip.id);
    assert.deepStrictEqual(calls[0], { limit: 1 });
    assert.strictEqual(calls[1].code, "drillA"); assert.strictEqual(calls[1].limit, T.ROUND_LIMIT + 1);
    assert.strictEqual(tip.evidence.baselineRounds, 10);
    assert.strictEqual(await loadCoach({ rounds: async () => { throw new Error("boom"); } }).roundTip(null, {}), null);
  });

  await test("thresholds export the round tip constants", () => {
    for (const k of ["ROUND_TIP_BASE_MIN", "ROUND_TIP_Z", "ROUND_TIP_OUTLIER_SHARE", "ROUND_TIP_PERSIST_BASE", "ROUND_TIP_HITS_MIN", "ROUND_TIP_MISS_MIN", "ROUND_TIP_FLOOR_ACC", "ROUND_TIP_FLOOR_HEAD", "ROUND_TIP_FLOOR_SIDE_M", "ROUND_TIP_FLOOR_VERT_M"]) assert.ok(typeof T[k] === "number", k);
    assert.strictEqual(T.ROUND_TIP_BASE_MIN, 5); assert.strictEqual(T.ROUND_TIP_Z, 1.5); assert.strictEqual(T.ROUND_TIP_OUTLIER_SHARE, 0.7);
  });

  // ---- (v) the card ----
  const finding = { id: "round-tip-side", severity: "tip", title: "Your shots drifted right this round", detail: "Your sideways miss average was 0.20 m right; in your last 14 rounds of this drill it was 0.05 m right. Aim left." };
  await test("(v) the card render function puts the text in the DOM, above the buttons; nothing when there is no finding", () => {
    const { card, document } = loadCard({});
    const { overlay, body, acts } = resultOverlay(document);
    assert.strictEqual(card.render.cardHtml(null), ""); assert.strictEqual(card.render.cardHtml({}), "");
    assert.ok(card.render.cardHtml({ title: "<b>x</b>", detail: "a & b" }).includes("&lt;b&gt;x&lt;/b&gt;"), "escaped");
    const el = card.render.mount(overlay, finding);
    assert.ok(el && el.innerHTML.includes("Your shots drifted right this round") && el.innerHTML.includes("0.20 m right") && el.innerHTML.includes("Aim left."));
    assert.deepStrictEqual(body.children.map((c) => c.className), ["al-run-strip", "aim-an-hit", "aim-rt-card", "al-run-actions"]);
    assert.ok(el.nextElementSibling === acts);
    card.render.mount(overlay, finding); // again: no second card
    assert.strictEqual(body.children.filter((c) => c.className === "aim-rt-card").length, 1);
    card.render.mount(overlay, null);
    assert.strictEqual(overlay.querySelector(".aim-rt-card"), null);
  });

  await test("(v) wide layout: the card is the last child of the action column, not next to the hit panel", () => {
    const { card, document } = loadCard({ wide: true });
    const { overlay, body, acts } = resultOverlay(document, { wide: true });
    card.render.mount(overlay, finding);
    assert.deepStrictEqual(body.children.map((c) => c.className), ["al-run-strip", "aim-an-hit", "al-run-actions"]);
    assert.deepStrictEqual(acts.children.map((c) => c.className), ["al-primary-btn", "aim-rt-card"]);
  });

  await test("(v) side report column (20 Nov 2026): the card goes to the bottom of that column, not into the result card; back in the card when the column goes", () => {
    const { card, document } = loadCard({});
    const { overlay, body, hit, acts } = resultOverlay(document);
    hit.remove(); hit.className = "aim-an-hit aim-an-hit-side"; overlay.appendChild(hit); // analytics-ui.js side placement
    const inner = document.createElement("div"); inner.className = "aim-an-hit-panes"; hit.appendChild(inner);
    const el = card.render.mount(overlay, finding);
    assert.ok(el.parentElement === hit && hit.lastElementChild === el, "last child of the side column");
    assert.deepStrictEqual(body.children.map((c) => c.className), ["al-run-strip", "al-run-actions"], "the result card is untouched");
    // the report rewrote its inside (a tab switch): the next sync puts a card back at the bottom
    hit.children = []; el.parentElement = null; inner.parentElement = null; hit.appendChild(inner);
    const again = card.render.mount(overlay, finding);
    assert.ok(again.parentElement === hit && hit.lastElementChild === again);
    // narrow window: the report moved back into the card, the tip goes above the buttons again
    hit.remove(); hit.className = "aim-an-hit"; body.children.splice(1, 0, hit); hit.parentElement = body;
    card.render.mount(overlay, finding);
    assert.deepStrictEqual(body.children.map((c) => c.className), ["al-run-strip", "aim-an-hit", "aim-rt-card", "al-run-actions"]);
    assert.ok(!hit.children.some((c) => c.className === "aim-rt-card"));
    void acts;
  });

  await test("(v) with the coach missing the card renders nothing and the menu is untouched", async () => {
    const A = { rounds: async () => [mkRound({ side: 0.2 })] };
    const { card, document } = loadCard({ analytics: A, coach: undefined });
    const { overlay, body } = resultOverlay(document);
    card.syncResult(); await settle();
    assert.strictEqual(overlay.querySelector(".aim-rt-card"), null);
    assert.deepStrictEqual(body.children.map((c) => c.className), ["al-run-strip", "aim-an-hit", "al-run-actions"]);
    assert.strictEqual(await card.loadTip(), null);
    // analytics missing too
    const b = loadCard({ analytics: undefined, coach: loadCoach(undefined) });
    assert.strictEqual(await b.card.loadTip(), null);
  });

  await test("(v) end to end: a died round with a baseline gets a card after the read; a cleared round and thin data get none; one read", async () => {
    const rounds = [...baseline(10), mkRound({ side: 0.2 })]; rounds[rounds.length - 1].at = NOW - 5000;
    let reads = 0;
    const A = { rounds: async (f) => { reads++; return rounds.filter((r) => !f.code || r.code === f.code).sort((a, b) => a.at - b.at).slice(-(f.limit || 1e9)); } };
    const { card, document, window } = loadCard({ analytics: A }); window.__aimCoach = loadCoach(A);
    const { overlay } = resultOverlay(document);
    card.syncResult(); card.syncResult(); await settle(20);
    const el = overlay.querySelector(".aim-rt-card");
    assert.ok(el && el.innerHTML.includes("drifted right"), "card expected");
    const before = reads; el.remove(); card.syncResult(); await settle(); // a re-render took it away: put back without a new read
    assert.ok(overlay.querySelector(".aim-rt-card")); assert.strictEqual(reads, before);
    // cleared round: no card, no read
    const c = loadCard({ analytics: A }); c.window.__aimCoach = loadCoach(A); reads = 0;
    const o2 = resultOverlay(c.document, { died: false }).overlay; c.card.syncResult(); await settle(20);
    assert.strictEqual(o2.querySelector(".aim-rt-card"), null); assert.strictEqual(reads, 0);
    // thin data: no card
    const few = [...baseline(2), mkRound({ side: 0.4 })]; few[few.length - 1].at = NOW - 5000;
    const A2 = { rounds: async (f) => few.filter((r) => !f.code || r.code === f.code).slice(-(f.limit || 1e9)) };
    const d = loadCard({ analytics: A2 }); d.window.__aimCoach = loadCoach(A2);
    const o3 = resultOverlay(d.document).overlay; d.card.syncResult(); await settle(20);
    assert.strictEqual(o3.querySelector(".aim-rt-card"), null);
  });

  const failed = results.filter(([, ok]) => !ok).length;
  console.log("\n" + (results.length - failed) + " of " + results.length + " passed");
  process.exit(failed ? 1 : 0);
})();
