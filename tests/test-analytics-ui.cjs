// Test for app/analytics-ui.js. Run: node test-analytics-ui.cjs
// Loads the module in a small DOM shim with stub window.__aimAnalytics / window.__aimCoach, renders each view and checks the
// HTML it produced. No jsdom in node_modules, so the shim only knows what the module uses (class selectors, created elements).
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const SRC = fs.readFileSync(path.join(__dirname, "..", "app", "analytics-ui.js"), "utf-8");

// ---- DOM shim ----
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.attrs = {}; this.dataset = {}; this.listeners = {}; this._html = ""; this.className = ""; this.textContent = ""; this.id = ""; }
  get classList() { const el = this; return { contains: (c) => el.className.split(/\s+/).includes(c), add: (c) => { if (!this.contains(c)) el.className += " " + c; } }; }
  set innerHTML(v) { this._html = String(v); this.children.forEach((c) => (c.parentElement = null)); this.children = []; }
  get innerHTML() { return this._html; }
  get outerText() { return this._html + this.children.map((c) => c.outerText).join(""); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === "id") this.id = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  appendChild(c) { if (c.parentElement) c.remove(); c.parentElement = this; this.children.push(c); return c; }
  append(...cs) { for (const c of cs) this.appendChild(c); }
  get nextElementSibling() { const p = this.parentElement; return p ? p.children[p.children.indexOf(this) + 1] || null : null; }
  get previousElementSibling() { const p = this.parentElement; return p ? p.children[p.children.indexOf(this) - 1] || null : null; }
  get style() { const el = this; return (this._style ||= { props: {}, setProperty(k, v) { this.props[k] = String(v); }, removeProperty(k) { delete this.props[k]; }, getPropertyValue(k) { return this.props[k] || ""; } }); }
  get lastElementChild() { return this.children[this.children.length - 1] || null; }
  remove() { const p = this.parentElement; if (p) { p.children = p.children.filter((c) => c !== this); this.parentElement = null; } }
  after(c) { const p = this.parentElement; if (c.parentElement) c.remove(); c.parentElement = p; p.children.splice(p.children.indexOf(this) + 1, 0, c); }
  before(c) { const p = this.parentElement; if (c.parentElement) c.remove(); c.parentElement = p; p.children.splice(p.children.indexOf(this), 0, c); }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  matches(sel) { const cls = sel.split(".").filter(Boolean); if (sel.startsWith("#")) return this.id === sel.slice(1); return cls.every((c) => this.className.split(/\s+/).includes(c)); }
  querySelector(sel) { for (const c of this.children) { if (c.matches(sel)) return c; const f = c.querySelector(sel); if (f) return f; } return null; }
  closest() { return null; }
  focus() { El.focused = this; }
  contains(x) { return x === this || this.children.some((c) => c.contains(x)); }
}
function makeDoc() {
  const html = new El("html"), head = new El("head"), body = new El("body");
  html.append(head, body);
  return {
    documentElement: html, head, body,
    createElement: (t) => new El(t),
    getElementById: (id) => html.querySelector("#" + id),
    querySelector: (sel) => html.querySelector(sel),
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(n = 6) { for (let i = 0; i < n; i++) await tick(); }

function load({ analytics, coach, fetchImpl, win } = {}) {
  const document = makeDoc();
  const window = { __aimAnalytics: analytics, __aimCoach: coach, ...win };
  const raf = (f) => setTimeout(f, 0);
  new Function("window", "document", "requestAnimationFrame", "fetch", SRC)(window, document, raf, fetchImpl || (async () => ({ ok: false })));
  return { window, document, ui: window.__aimAnalyticsUi };
}
function stub({ rounds = [], days = [], engagements = [], fail = false } = {}) {
  const calls = [];
  const go = (name, list) => async (f) => { calls.push([name, f]); if (fail) throw new Error("boom"); return list; };
  return { calls, rounds: go("rounds", rounds), days: go("days", days), engagements: go("engagements", engagements), nearMisses: go("nearMisses", []) };
}

let passed = 0, failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const count = (text, needle) => text.split(needle).length - 1;

// ---- builders ----
const pad = (n) => String(n).padStart(2, "0");
const dayN = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const shot = (o = {}) => ({ tick: 1, weapon: "vandal", part: null, killed: false, ...o });
const diedRound = (shots) => ({ id: "r1", day: dayN(0), at: Date.now() - 5000, end: "died", map: "ascent", mode: "score", code: "abc", drillWeapon: "vandal", shots, deaths: [] });
const dayRow = (n, o = {}) => ({ v: 1, day: dayN(n), rounds: 10, shots: 200, hits: 100 + n, headshots: 20, kills: 10, deaths: 5, falls: 0, nearMisses: 30, flicks: 3, strafes: 2,
  maps: { ascent: { rounds: 10, deaths: 5 }, bind: { rounds: 2, deaths: 1 } }, weapons: { vandal: { shots: 200 } }, modes: { score: { rounds: 10 } },
  grid: { ascent: { "1,2": 3, "-4,7": 1 }, bind: { "0,0": 1 } }, ...o });

// ---- hit zones ----
test("hit summary: zones from parts and nearestEnemy points, unknown parts count as body", () => {
  const { ui } = load({ analytics: stub() });
  const s = ui.render.hitSummary(diedRound([
    shot({ part: "head" }),
    shot({ part: "body", nearestEnemy: { range: 10, centreDistance: 0.3, side: 0.28, vertical: 0.2 } }),   // arms
    shot({ part: "body", nearestEnemy: { range: 10, centreDistance: 0.4, side: 0.05, vertical: 0.45 } }),  // chest
    shot({ part: "body", nearestEnemy: { range: 10, centreDistance: 0.1, side: 0.0, vertical: 0.05 } }),   // stomach
    shot({ part: "legs" }),
    shot({ part: "arm" }),                                                                                  // unknown -> body -> chest
    shot({ part: null, pellets: { fired: 8, hit: 2, head: 0 } }),                                          // shotgun hit without part -> chest
    shot({ part: null, nearestEnemy: { range: 10, centreDistance: 0.3, side: -0.2, vertical: 0.1 } }),     // near miss (dot)
    shot({ part: null }),                                                                                   // miss, no dot
  ]));
  assert.deepStrictEqual(s.zones, { head: 1, chest: 3, arms: 1, stomach: 1, legs: 1 });
  assert.strictEqual(s.hits, 7); assert.strictEqual(s.misses, 2); assert.strictEqual(s.heads, 1); assert.strictEqual(s.shots, 9);
  assert.strictEqual(s.dots.length, 8);
  assert.strictEqual(s.dots.filter((d) => d.kind === "miss").length, 1);
  assert.strictEqual(s.damage, null);
});
test("hit panel HTML: silhouette and ONE list of five zone rows, every row shown (0 included), no damage row", () => {
  const { ui } = load({ analytics: stub() });
  const html = ui.render.hitPanelHtml({ ...diedRound([shot({ part: "head" }), shot({ part: "legs" })]), damage: 190 });
  assert.ok(html.includes("<svg"));
  for (const z of ["head", "legs"]) assert.ok(html.includes(`data-zone="${z}"`), z);
  for (const z of ["chest", "arms", "stomach"]) assert.ok(html.includes('<li class="is-zero" data-zone="' + z + '">') && html.includes('data-zone="' + z + '"><span>' + ({ chest: "Chest", arms: "Arms", stomach: "Torso" })[z] + "</span><b>0</b></li>"), z + ": a row at 0");
  const ap = paneOf(html, "all"), rows = [...ap.matchAll(/data-zone="(\w+)"><span>([^<]+)<\/span>/g)].map((m) => m[2]);
  assert.deepStrictEqual(rows, ["Head", "Chest", "Arms", "Torso", "Legs"], "one list, in this order");
  assert.strictEqual(count(ap, '<ul class="aim-an-zones">'), 1, "one list");
  for (const z of ["head", "chest", "arms", "stomach", "legs"]) assert.ok(html.includes(`class="aim-an-zone is-${z}`), z + " still drawn on the figure");
  assert.ok(/data-zone="head"><span>Head<\/span><b>1<\/b>/.test(html));
  assert.ok(html.includes("is-head is-hit"));
  assert.ok(!html.includes("damage") && !html.includes("aim-an-hit-sum"), "no damage or other stat row");
  assert.ok(!html.includes("No hits this round"));
});
test("hit panel HTML: no hits and no record give plain words", () => {
  const { ui } = load({ analytics: stub() });
  assert.ok(ui.render.hitPanelHtml(diedRound([shot(), shot()])).includes("No hits this round"));
  assert.ok(ui.render.hitPanelHtml(diedRound([])).includes("No hits this round"));
  assert.ok(ui.render.hitPanelHtml(null).includes("No shot record"));
});
function resultOverlay(document, died, verdict) {
  const overlay = document.createElement("div"); overlay.className = "al-result-overlay";
  const splash = document.createElement("div"); splash.className = "al-result-verdict-splash" + (died ? " is-died" : " is-" + (verdict || "cleared"));
  const modal = document.createElement("div"); modal.className = "al-result-modal";
  const body = document.createElement("div"); body.className = "al-run-body";
  const hero = document.createElement("div"); hero.className = "al-run-hero";
  const strip = document.createElement("div"); strip.className = "al-run-strip";
  const acts = document.createElement("div"); acts.className = "al-run-actions";
  body.append(hero, strip, acts); modal.appendChild(body); overlay.append(splash, modal);
  document.body.appendChild(overlay);
  return { overlay, body };
}
test("result screen: panel goes after the stat strip, before the buttons, only after a death; one read", async () => {
  const A = stub({ rounds: [diedRound([shot({ part: "head" }), shot()])] });
  const { ui, document } = load({ analytics: A });
  const { overlay, body } = resultOverlay(document, true);
  ui.syncResult(); await settle();
  const panel = overlay.querySelector(".aim-an-hit");
  assert.ok(panel, "panel inserted");
  // first class only: the new panel also carries its one-time entrance class (aim-an-hit-enter)
  assert.deepStrictEqual(body.children.map((c) => c.className.split(" ")[0]), ["al-run-hero", "al-run-strip", "aim-an-hit", "al-run-actions"]);
  assert.ok(panel.innerHTML.includes("Your shots this round") && panel.innerHTML.includes("<svg"));
  // removed by a re-render: put back without a new read
  panel.remove(); ui.syncResult(); ui.syncResult(); await settle();
  assert.ok(overlay.querySelector(".aim-an-hit"));
  assert.strictEqual(A.calls.length, 1);
});
for (const verdict of ["cleared", "time"]) {
  test("result screen: a " + verdict + " round gets the hit report with the all-shots pane only", async () => {
    const A = stub({ rounds: [{ ...diedRound([shot({ part: "head" }), shot()]), end: verdict }] });
    const { ui, document } = load({ analytics: A });
    const { overlay } = resultOverlay(document, false, verdict);
    ui.syncResult(); await settle();
    const panel = overlay.querySelector(".aim-an-hit");
    assert.ok(panel, "panel inserted");
    assert.ok(panel.innerHTML.includes("Your shots this round") && panel.innerHTML.includes('data-zone="head"'));
    assert.ok(!panel.innerHTML.includes("data-hit-tab") && !panel.innerHTML.includes("Your killer"), "no killer tab");
    assert.strictEqual(A.calls.length, 1);
  });
}
test("result screen: a tracking drill (scored by time on target) gets no hit report, so the result card is not pushed aside", async () => {
  const A = stub({ rounds: [{ ...diedRound([shot({ part: "head" }), shot()]), end: "time", mode: "tracking" }] });
  const { ui, document } = load({ analytics: A });
  const { overlay } = resultOverlay(document, false, "time");
  ui.syncResult(); await settle();
  assert.ok(!overlay.querySelector(".aim-an-hit"), "no panel for a tracking round");
  ui.syncResult(); ui.syncResult(); await settle();
  assert.ok(!overlay.querySelector(".aim-an-hit"), "and none after a re-render");
  assert.strictEqual(A.calls.length, 1, "one read");
});
test("result screen: a cleared screen whose newest stored round is a death shows the no-record message, not that death", async () => {
  const A = stub({ rounds: [diedRound([shot()])] });
  const { ui, document } = load({ analytics: A });
  const { overlay } = resultOverlay(document, false);
  ui.syncResult(); await new Promise((r) => setTimeout(r, 1000)); await settle();
  assert.ok(overlay.querySelector(".aim-an-hit").innerHTML.includes("No shot record"));
});
test("result screen: failing reader shows the no-record message, no throw", async () => {
  const { ui, document } = load({ analytics: stub({ fail: true }) });
  const { overlay } = resultOverlay(document, true);
  ui.syncResult(); await new Promise((r) => setTimeout(r, 1000)); await settle();
  assert.ok(overlay.querySelector(".aim-an-hit").innerHTML.includes("No shot record"));
});

// ---- Stats panel ----
const content = (document) => document.body.querySelector(".aim-an-content");
test("panel: opens with seven tabs, Esc-style close removes it", async () => {
  const { ui, document } = load({ analytics: stub() });
  ui.open("heatmap"); await settle();
  const tabs = document.body.querySelector(".aim-an-tabs");
  assert.deepStrictEqual(tabs.children.map((b) => b.textContent), ["Session", "Drills", "Progress", "Compare", "Heatmap", "Tracking", "Coach"]);
  assert.strictEqual(tabs.children[4].getAttribute("aria-pressed"), "true");
  ui.close();
  assert.strictEqual(document.body.querySelector(".aim-an-shade"), null);
});
test("heatmap: day-row grid on a plain grid, map with most deaths first, Deaths layer by default", async () => {
  const A = stub({ days: [dayRow(1), dayRow(0)], rounds: [] });
  const { ui, document } = load({ analytics: A });
  ui.open("heatmap"); await settle();
  const html = content(document).innerHTML;
  assert.ok(html.includes('data-filter="map"') && html.includes('data-filter="mode"') && html.includes('data-filter="code"') && html.includes('data-filter="weapon"'));
  assert.ok(html.includes('<option value="ascent" selected>'));
  assert.strictEqual(count(html, 'fill="#ff4655"'), 2, "two cells on ascent");
  assert.ok(html.includes("6 deaths per 1 m cell") && html.includes("8 in all"));
  assert.ok(html.includes("plain grid"));
  // the fight-layer toggle exists, Deaths is on, no fight squares and no fight read
  assert.ok(html.includes('data-layer="deaths" aria-pressed="true"') && html.includes('data-layer="fights" aria-pressed="false"') && html.includes('data-layer="both" aria-pressed="false"'));
  assert.ok(!html.includes("aim-an-fight"));
  assert.ok(!A.calls.some((c) => c[0] === "fightCells" || c[0] === "engagements"));
});

// ---- fight layer ----
// Fight stubs: day rows with a fights grid and a fightCells answer for the filtered path.
const fightStub = (o = {}) => {
  const A = stub(o);
  A.fightCells = async (f) => { A.calls.push(["fightCells", f]); return o.fightCells || { cells: {}, total: 0, withoutPosition: 0 }; };
  return A;
};
const layerClick = (document, id) => content(document).listeners.click[0]({ target: { closest: (sel) => (sel === "[data-layer]" ? { dataset: { layer: id } } : null) } });
const fightDays = () => [dayRow(1, { fights: { ascent: { "1,2": 2, "5,5": 4 }, bind: { "0,0": 9 } } }), dayRow(0, { fights: { ascent: { "5,5": 1 } } })];
test("fights layer: fights only, from the day rows' fights grid, in the theme colour, totals and fights without a position", async () => {
  const A = fightStub({ days: fightDays(), fightCells: { cells: { "9,9": 1 }, total: 1, withoutPosition: 3 } });
  const { ui, document } = load({ analytics: A });
  ui.open("heatmap"); await settle();
  layerClick(document, "fights"); await settle();
  const html = content(document).innerHTML;
  assert.ok(html.includes('data-layer="fights" aria-pressed="true"'));
  assert.strictEqual(count(html, 'fill="#ff4655"'), 0, "no death squares");
  assert.strictEqual(count(html, 'class="aim-an-fight"'), 2, "two filled fight cells on ascent (not bind, not the fightCells cells)");
  assert.ok(html.includes('fill-opacity="1.00"') && html.includes("5 fights per 1 m cell") && html.includes("7 in all"));
  assert.ok(html.includes("On ascent: 7 fights in all; 3 fights of the newest 500 stored rounds have no position and are not drawn."));
  assert.ok(html.includes("Fight heatmap on ascent"));
  assert.ok(html.includes('<option value="ascent" selected>'), "filters kept");
  assert.deepStrictEqual(A.calls.filter((c) => c[0] === "fightCells").map((c) => c[1].map), ["ascent"]);
  // the colour is a theme variable, not a new hard-coded one
  const css = document.getElementById("aim-analytics-ui-css").textContent;
  assert.ok(css.includes("--an-fight: var(--es-green") && /\.aim-an-fight \{ fill: var\(--an-fight\)/.test(css));
});
test("fights layer: deaths only shows no fight squares; Both keeps deaths filled and outlines fights", async () => {
  const A = fightStub({ days: fightDays(), fightCells: { cells: {}, total: 0, withoutPosition: 1 } });
  const { ui, document } = load({ analytics: A });
  ui.open("heatmap"); await settle();
  layerClick(document, "fights"); await settle();
  layerClick(document, "deaths"); await settle();
  let html = content(document).innerHTML;
  assert.strictEqual(count(html, 'fill="#ff4655"'), 2);
  assert.ok(!html.includes("aim-an-fight") && !html.includes("is-fight"));
  layerClick(document, "both"); await settle();
  html = content(document).innerHTML;
  assert.ok(html.includes('data-layer="both" aria-pressed="true"'));
  assert.strictEqual(count(html, 'fill="#ff4655"'), 2, "deaths still filled");
  assert.strictEqual(count(html, 'class="aim-an-fight is-outline"'), 2, "fights outlined");
  assert.ok(/class="aim-an-fight is-outline" x="1" y="2" width="1" height="1" fill="none" stroke-opacity="0\.\d\d"/.test(html), "a ring on the same cell's edge (17 Nov 2026 fix: no inset)");
  assert.ok(html.includes("6 deaths per 1 m cell") && html.includes("5 fights per 1 m cell · 7 in all (outlined)"));
  assert.ok(html.includes("On ascent: 8 deaths and 7 fights in all; 1 fight of the newest 500 stored rounds has no position and is not drawn."));
  assert.ok(html.includes("Death and fight heatmap"));
  assert.strictEqual(A.calls.filter((c) => c[0] === "fightCells").length, 1, "fight read once per filter");
});
test("fights layer: drill filter uses fightCells and keeps the 30-day notes; mode filter counts engagements", async () => {
  const r = (code, x, z) => ({ map: "ascent", mode: "score", code, drillWeapon: "vandal", shots: [shot()], deaths: [{ position: { x, y: 0, z } }] });
  const A = fightStub({ days: fightDays(), rounds: [r("abc", 1.5, 2.5), r("xyz", 9, 9)], fightCells: { cells: { "3,4": 2 }, total: 2, withoutPosition: 0 },
    engagements: [{ mode: "score", playerContact: { x: 7.9, z: -0.2 } }, { mode: "other", playerContact: { x: 1, z: 1 } }, { mode: "score", playerContact: null }] });
  const { ui, document } = load({ analytics: A });
  ui.open("heatmap"); await settle();
  layerClick(document, "fights"); await settle();
  content(document).listeners.change[0]({ target: { dataset: { filter: "code" }, value: "abc" } }); await settle();
  let html = content(document).innerHTML;
  assert.ok(html.includes('<option value="abc" selected>'));
  assert.strictEqual(count(html, 'class="aim-an-fight"'), 1);
  assert.ok(html.includes("use the stored rounds") && html.includes("Fights with a mode, drill or weapon filter come from the stored rounds (the last 30 days, newest 500)"));
  assert.ok(html.includes("On ascent: 2 fights in all; 0 fights of the newest 500 stored rounds have no position"));
  assert.deepStrictEqual(A.calls.filter((c) => c[0] === "fightCells").pop()[1], { map: "ascent", code: "abc", weapon: undefined, rounds: 500 });
  content(document).listeners.change[0]({ target: { dataset: { filter: "code" }, value: "" } });
  content(document).listeners.change[0]({ target: { dataset: { filter: "mode" }, value: "score" } }); await settle();
  html = content(document).innerHTML;
  assert.strictEqual(count(html, 'class="aim-an-fight"'), 1);
  assert.ok(html.includes("7,-1 m: 1 fight") && html.includes("1 fight in all; 1 fight of the newest 500 stored rounds has no position"));
});
test("fights layer: an empty fights grid shows a plain message, a missing reader does not throw", async () => {
  for (const A of [fightStub({ days: [dayRow(0)] }), stub({ days: [dayRow(0)] })]) {
    const { ui, document } = load({ analytics: A });
    ui.open("heatmap"); await settle();
    layerClick(document, "fights"); await settle();
    const html = content(document).innerHTML;
    assert.ok(html.includes("No fights with a position on ascent for these filters."), html);
    assert.ok(!html.includes("<svg"));
    assert.ok(html.includes('data-layer="fights" aria-pressed="true"'), "toggle stays");
  }
});
test("heatmap: minimap picture when the map has one", async () => {
  const fetchImpl = async (url) => ({ ok: url === "/aim-maps/ascent.minimap.json", json: async () => ({ image: "ascent.minimap.png", transform: { scaleU: 0.007, scaleV: 0.007, offsetU: 0.81, offsetV: 0.57 } }) });
  const { ui, document } = load({ analytics: stub({ days: [dayRow(0)] }), fetchImpl });
  ui.open("heatmap"); await settle(10);
  const html = content(document).innerHTML;
  assert.ok(html.includes('<image href="/aim-maps/ascent.minimap.png"'));
  assert.ok(!html.includes("plain grid"));
  assert.strictEqual(count(html, 'fill="#ff4655"'), 2);
});
test("heatmap: drill / mode / weapon filters use the raw rounds", async () => {
  const r = (code, x, z, weapon) => ({ map: "ascent", mode: "score", code, drillWeapon: weapon, shots: [shot({ weapon })], deaths: [{ position: { x, y: 0, z } }] });
  const A = stub({ days: [dayRow(0)], rounds: [r("abc", 1.5, 2.5, "vandal"), r("xyz", 9.2, 9.9, "sheriff"), r("abc", 1.1, 2.9, "vandal")] });
  const { ui, document } = load({ analytics: A });
  const p = ui.open("heatmap"); await settle();
  p.filter.code = "abc";
  content(document).listeners.change[0]({ target: { dataset: { filter: "code" }, value: "abc" } }); await settle();
  let html = content(document).innerHTML;
  assert.ok(html.includes('<option value="abc" selected>'));
  assert.strictEqual(count(html, 'fill="#ff4655"'), 1);
  assert.ok(html.includes("2 deaths per 1 m cell"));
  assert.ok(html.includes("use the stored rounds"));
  content(document).listeners.change[0]({ target: { dataset: { filter: "weapon" }, value: "sheriff" } }); await settle();
  html = content(document).innerHTML;
  assert.ok(html.includes("No deaths on ascent for these filters"));
  assert.strictEqual(A.calls.length, 2, "days + rounds read once");
});
test("heatmap: empty store and failing readers give a plain message", async () => {
  for (const A of [stub(), stub({ fail: true }), undefined]) {
    const { ui, document } = load({ analytics: A });
    ui.open("heatmap"); await settle();
    assert.ok(content(document).innerHTML.includes("No deaths recorded yet"));
  }
});
test("progress: seven charts with first / latest values and arrows; range picker re-cuts without a new read", async () => {
  const days = [dayRow(40), dayRow(20), dayRow(5), dayRow(1, { hits: 120, headshots: 30 })];
  const sk = (day, v) => ({ day, killed: true, sight: true, timeToKill: v + 1, visibleTimeToKill: v });
  const engagements = [sk(dayN(5), 0.9), sk(dayN(1), 0.5), sk(dayN(1), 0.7), { day: dayN(1), killed: false, sight: true, timeToKill: null },
    { day: dayN(5), killed: true, sight: false, timeToKill: 9, visibleTimeToKill: null }, { day: dayN(1), killed: true, sight: false, timeToKill: 9, visibleTimeToKill: null }]; // the last two: recorded before line-of-sight data, not used
  const A = stub({ days, engagements });
  const { ui, document } = load({ analytics: A });
  ui.open("progress"); await settle();
  // opens on 7 days (17 Nov 2026 default): only the two newest rows; no stored rounds, so day points stay
  let html = content(document).innerHTML;
  assert.ok(html.includes('data-range="7" aria-pressed="true"'));
  assert.ok(html.includes("2 days with data"));
  content(document).listeners.click[0]({ target: { closest: () => ({ dataset: { range: "30" } }) } }); await settle();
  html = content(document).innerHTML;
  assert.strictEqual((html.match(/class="aim-an-chart( is-\w+)?"/g) || []).length, 8, "the focus chart and the seven thumbnails");
  for (const id of ["accuracy", "headshots", "killTime", "nearMisses", "flicks", "strafes", "deaths"]) assert.ok(html.includes(`data-metric="${id}"`), id);
  assert.ok(/data-metric="accuracy"><h4>Accuracy<span>60% <b class="aim-an-arrow">↑<\/b> 60%/.test(html) || /data-metric="accuracy"><h4>Accuracy<span>\d+% <b class="aim-an-arrow">[↑↓→]<\/b> 60%/.test(html), "accuracy latest 60%");
  assert.ok(html.includes('aim-an-chart is-up" data-metric="headshots"'), "headshot rate went up");
  assert.ok(html.includes("0.90 s") && html.includes("0.60 s") && html.includes("↓"), "kill time 0.90 -> 0.60");
  assert.ok(html.includes('aim-an-chart is-up" data-metric="killTime"'), "lower kill time is better");
  assert.ok(html.includes('data-range="30" aria-pressed="true"'));
  // 90 days: all four
  content(document).listeners.click[0]({ target: { closest: () => ({ dataset: { range: "90" } }) } }); await settle();
  assert.ok(content(document).innerHTML.includes("4 days with data"));
  assert.strictEqual(A.calls.filter((c) => c[0] === "days").length, 1);
  assert.strictEqual(A.calls.filter((c) => c[0] === "engagements").length, 1);
});
test("progress: empty and failing readers give a plain message", async () => {
  for (const A of [stub(), stub({ fail: true }), undefined]) {
    const { ui, document } = load({ analytics: A });
    ui.open("progress"); await settle();
    assert.ok(content(document).innerHTML.includes("No days recorded yet"));
  }
});
test("coach: findings in the order returned, severity class, sample, why with evidence", async () => {
  const list = [
    { id: "fights-lost", title: "Enemies shoot you first in 60% of fights", detail: "You lost 12 of 20.", severity: "warn", sample: 20, evidence: { lost: 12, won: 8 } },
    { id: "miss-side", title: "You miss <high>", detail: "Most misses pass above.", severity: "tip", sample: 44, evidence: { above: 30, below: 14 } },
    { id: "kill-time", title: "You kill in about 0.6 s", detail: "", severity: "info", sample: 31, evidence: {} },
  ];
  let calls = 0;
  const { ui, document } = load({ analytics: stub(), coach: { insights: async () => { calls++; return list; } } });
  ui.open("coach"); await settle();
  const html = content(document).innerHTML;
  assert.ok(html.indexOf("fights-lost") < html.indexOf("miss-side") && html.indexOf("miss-side") < html.indexOf("kill-time"));
  assert.ok(html.includes('<li class="is-warn"') && html.includes('<li class="is-tip"') && html.includes('<li class="is-info"'));
  // fixed cards (17 Nov 2026): the sample and the evidence list are in the tip modal, not on the card
  const modal = list.map(ui.render.coachModalHtml).join("");
  assert.ok(modal.includes("sample 20") && modal.includes("sample 44") && !html.includes("sample "), "sample in the modal only");
  assert.strictEqual(count(html, "<summary>"), 0, "no collapsible parts");
  assert.ok(!html.includes("<dt>") && modal.includes("<dt>lost</dt><dd>12</dd>") && modal.includes("<dt>above</dt><dd>30</dd>"), "evidence in the modal only");
  assert.ok(html.includes("You miss &lt;high&gt;"), "escaped");
  // switch away and back: no second read
  document.body.querySelector(".aim-an-tabs").children[1].listeners.click[0]();
  document.body.querySelector(".aim-an-tabs").children[2].listeners.click[0](); await settle();
  assert.strictEqual(calls, 1);
});
test("coach: empty, rejecting and missing coach give plain messages", async () => {
  let r = load({ analytics: stub(), coach: { insights: async () => [] } }); r.ui.open("coach"); await settle();
  assert.ok(content(r.document).innerHTML.includes("No findings yet"));
  r = load({ analytics: stub(), coach: { insights: () => Promise.reject(new Error("x")) } }); r.ui.open("coach"); await settle();
  assert.ok(content(r.document).innerHTML.includes("No findings yet"));
  r = load({ analytics: stub() }); r.ui.open("coach"); await settle();
  assert.ok(content(r.document).innerHTML.includes("not available"));
});
test("styles are injected once and reuse the theme variables", () => {
  const { document } = load({ analytics: stub() });
  const style = document.getElementById("aim-analytics-ui-css");
  assert.ok(style && style.textContent.includes("var(--es-red") && style.textContent.includes("var(--es-head"));
});

// ---- review fixes (17 Nov 2026) ----
test("result screen: an unchanged panel is never rewritten (the serialized DOM never equals the source string, so compare with the last string written)", async () => {
  const A = stub({ rounds: [diedRound([shot({ part: "head" }), shot()])] });
  const { ui, document } = load({ analytics: A });
  const { overlay } = resultOverlay(document, true);
  ui.syncResult(); await settle();
  const panel = overlay.querySelector(".aim-an-hit");
  // like a real browser: innerHTML reads back serialized differently from what was written (<circle/> becomes <circle></circle>)
  let writes = 0, written = panel.innerHTML;
  Object.defineProperty(panel, "innerHTML", { get: () => written.replace(/\/>/g, "></x>"), set: (v) => { writes++; written = v; }, configurable: true });
  const written0 = written;
  for (let i = 0; i < 5; i++) ui.syncResult();
  await settle();
  assert.strictEqual(writes, 0, "five passes, no write");
  assert.strictEqual(written, written0);
  // a new panel element (the game re-rendered the screen) is written once, then left alone
  panel.remove(); ui.syncResult(); ui.syncResult(); ui.syncResult(); await settle();
  assert.ok(overlay.querySelector(".aim-an-hit") && overlay.querySelector(".aim-an-hit") !== panel);
  assert.strictEqual(A.calls.length, 1, "no new read");
});
test("result screen: a read that never answers shows the plain no-record message after about 3 s, and a late answer changes nothing", async () => {
  let release;
  const A = { rounds: () => new Promise((ok) => { release = () => ok([diedRound([shot({ part: "head" })])]); }) };
  const { ui, document } = load({ analytics: A });
  const { overlay } = resultOverlay(document, true);
  ui.syncResult(); await new Promise((r) => setTimeout(r, 1500));
  assert.strictEqual(overlay.querySelector(".aim-an-hit"), null, "still waiting after 1.5 s");
  await new Promise((r) => setTimeout(r, 2200));
  const panel = overlay.querySelector(".aim-an-hit");
  assert.ok(panel && panel.innerHTML.includes("No shot record"), "timed out: plain message");
  const html = panel.innerHTML;
  release(); await settle(); ui.syncResult(); await settle();
  assert.strictEqual(overlay.querySelector(".aim-an-hit").innerHTML, html, "the late answer is ignored");
});
test("raw-round reads are bounded: engagements and fightCells are asked for the newest 500 rounds only, and the notes say so", async () => {
  const A = fightStub({ days: fightDays(), rounds: [], fightCells: { cells: { "3,4": 1 }, total: 1, withoutPosition: 2 }, engagements: [{ mode: "score", playerContact: { x: 1, z: 1 } }] });
  A.days = async (f) => { A.calls.push(["days", f]); return fightDays(); };
  const { ui, document } = load({ analytics: A });
  ui.open("progress"); await settle();
  assert.deepStrictEqual(A.calls.filter((c) => c[0] === "engagements").map((c) => c[1]), [{ rounds: 500 }]);
  assert.ok(content(document).innerHTML.includes("newest 500 stored rounds"), "progress note");
  ui.open("heatmap"); await settle();
  layerClick(document, "fights"); await settle();
  content(document).listeners.change[0]({ target: { dataset: { filter: "weapon" }, value: "vandal" } }); await settle();
  assert.strictEqual(A.calls.filter((c) => c[0] === "fightCells").pop()[1].rounds, 500);
  content(document).listeners.change[0]({ target: { dataset: { filter: "weapon" }, value: "" } });
  content(document).listeners.change[0]({ target: { dataset: { filter: "mode" }, value: "score" } }); await settle();
  assert.strictEqual(A.calls.filter((c) => c[0] === "engagements").pop()[1].rounds, 500);
  assert.ok(content(document).innerHTML.includes("newest 500 stored rounds"), "heatmap note");
  assert.ok(A.calls.filter((c) => c[0] === "engagements" || c[0] === "fightCells").every((c) => c[1].rounds === 500), "no unbounded call");
});

// ---- hit panel: your killer / all my shots (17 Nov 2026) ----
const ne = (side, vertical) => ({ range: 10, centreDistance: Math.hypot(side, vertical), side, vertical });
// shots: 0 arm hit on bot_a (the killer type), 1 head hit on bot_b, 2 miss near the killer (id 7), 3 miss far from everything
const killerRound = (o = {}) => ({ ...diedRound([
  shot({ tick: 50, part: "body", target: "bot_a", nearestEnemy: ne(0.3, 0.2) }),
  shot({ tick: 40, part: "head", target: "bot_b", killed: true }),
  shot({ tick: 60, nearestEnemy: ne(0.1, 0.5) }),
  shot({ tick: 70 }),
]), nearMisses: [{ shotIndex: 2, enemyId: 7, template: "bot_a", missDistance: 0.2, verticalOffset: 0.5 }],
  engagements: [{ enemyId: 7, template: "bot_a", startTick: 30, killed: false, killTick: null }, { enemyId: 3, template: "bot_b", startTick: 20, killed: true, killTick: 40 }],
  deaths: [{ tick: 100, killerId: 7, killer: "bot_a", killerDistance: 12.4, cause: "shot", nearMisses: [] }], ...o });
const paneOf = (html, id) => { const a = html.indexOf(`data-hit-pane="${id}"`); const b = html.indexOf("data-hit-pane=", a + 10); return html.slice(a, b < 0 ? undefined : b); };
test("killer tab (default): the arm hit on the enemy that killed you, its near miss as a ring, matched by id", () => {
  const { ui } = load({ analytics: stub() });
  const k = ui.render.killerShots(killerRound());
  assert.strictEqual(k.method, "id");
  assert.deepStrictEqual(k.sum.zones, { head: 0, chest: 0, arms: 1, stomach: 0, legs: 0 });
  assert.strictEqual(k.sum.hits, 1); assert.strictEqual(k.sum.rings, 1); assert.strictEqual(k.shared, 0);
  const html = ui.render.hitPanelHtml(killerRound());
  assert.ok(html.includes('data-hit-tab="killer" aria-controls="aim-an-hit-pane-killer" aria-selected="true"'));
  assert.ok(html.includes('data-hit-tab="all" aria-controls="aim-an-hit-pane-all" aria-selected="false"'));
  assert.ok(/<button type="button" role="tab"/.test(html), "tabs are buttons");
  const kp = paneOf(html, "killer");
  assert.ok(!kp.startsWith('data-hit-pane="killer" hidden') && paneOf(html, "all").startsWith('data-hit-pane="all" hidden'));
  assert.ok(kp.includes("Killed by <b>bot_a</b> from 12 m"));
  assert.ok(/data-zone="arms"><span>Arms<\/span><b>1<\/b>/.test(kp) && /data-zone="head"><span>Head<\/span><b>0<\/b>/.test(kp), "head hit on bot_b is not on the killer (Head 0)");
  assert.ok(!kp.includes("aim-an-hit-sum") && !/<span>near miss/i.test(kp), "near misses only as the ring on the figure, no list row");
  assert.ok(kp.includes("<title>Arms hit (1 hit on the arms)</title>"));
  assert.ok(kp.includes("<title>Near miss by the chest (1 near miss in all)</title>") && kp.includes('class="aim-an-ring-line"'));
  assert.ok(!kp.includes("Matched by") && !kp.includes("aim-an-hit-note"), "no matching footnote (removed 17 Nov 2026)");
  assert.ok(!kp.includes("You did not hit"));
  assert.ok(kp.includes("Near miss (passed close, no hit)"), "legend");
});
test("killer tab: no hit on the enemy that killed you says so in plain words; a same-type hit in a shared fight is flagged", () => {
  const { ui } = load({ analytics: stub() });
  const r = killerRound({ deaths: [{ tick: 100, killerId: 9, killer: "bot_c", killerDistance: 5, cause: "shot", nearMisses: [] }],
    engagements: [{ enemyId: 9, template: "bot_c", startTick: 10, killed: false, killTick: null }] });
  const kp = paneOf(ui.render.hitPanelHtml(r), "killer");
  assert.ok(kp.includes("No hits on the enemy that killed you (0 shots landed)"));
  assert.ok(!kp.includes("No hits this round"), "other shots did hit");
  assert.ok(kp.includes('Your other shots are in the "All my shots" tab.'));
  // two bot_a in a fight with you at tick 50: the hit is counted but flagged as maybe on the other one
  const shared = killerRound({ engagements: [...killerRound().engagements, { enemyId: 8, template: "bot_a", startTick: 45, killed: false, killTick: null }] });
  assert.strictEqual(ui.render.killerShots(shared).shared, 1);
  assert.ok(!ui.render.hitPanelHtml(shared).includes("of these hits"), "no matching explanation in the panel");
  // no hits at all: both messages
  const none = killerRound(); none.shots = [shot({ tick: 60 })];
  const np = paneOf(ui.render.hitPanelHtml(none), "killer");
  assert.ok(np.includes("No hits on the enemy that killed you (0 shots landed)") && np.includes("No hits this round"));
});
test("all my shots tab: every shot on the diagram, near misses as rings, totals", () => {
  const { ui } = load({ analytics: stub() });
  const html = ui.render.hitPanelHtml(killerRound(), "all");
  assert.ok(html.includes('data-hit-tab="all" aria-controls="aim-an-hit-pane-all" aria-selected="true"'));
  assert.ok(paneOf(html, "killer").startsWith('data-hit-pane="killer" hidden'));
  const ap = paneOf(html, "all");
  assert.ok(/data-zone="head"><span>Head<\/span><b>1<\/b>/.test(ap) && /data-zone="arms"><span>Arms<\/span><b>1<\/b>/.test(ap));
  assert.ok(/data-zone="chest"><span>Chest<\/span><b>0<\/b>/.test(ap) && /data-zone="stomach"><span>Torso<\/span><b>0<\/b>/.test(ap) && /data-zone="legs"><span>Legs<\/span><b>0<\/b>/.test(ap), "zones at 0 are rows too");
  assert.ok(!ap.includes("aim-an-hit-sum") && !ap.includes("other miss") && !ap.includes("shots hit"), "no Hits / Near misses / Other misses rows");
  assert.strictEqual(count(ap, '<g class="aim-an-ring">'), 1);
  assert.strictEqual(count(ap, 'class="aim-an-dot'), 2 + 2, "two hit dots and the two legend dots");
});
test("killer tab: template fallback when the shots cannot be tied to the killer's id, said in plain words", () => {
  const { ui } = load({ analytics: stub() });
  const noFight = killerRound({ engagements: [] });
  const k = ui.render.killerShots(noFight);
  assert.strictEqual(k.method, "template"); assert.strictEqual(k.reason, "the round has no fight record for that id");
  assert.strictEqual(k.sum.zones.arms, 1);
  assert.ok(!ui.render.hitPanelHtml(noFight).includes("Could not match") && !ui.render.hitPanelHtml(noFight).includes("was not recorded"), "no matching explanation");
  const noId = killerRound({ engagements: [], deaths: [{ tick: 100, killerId: null, killer: "bot_a", killerDistance: null, cause: "shot", nearMisses: [] }] });
  const k2 = ui.render.killerShots(noId);
  assert.strictEqual(k2.method, "template"); assert.strictEqual(k2.reason, "the death has no killer id");
  assert.strictEqual(k2.sum.rings, 1, "near miss matched by type");
  // a fall: no killer
  assert.ok(ui.render.hitPanelHtml(killerRound({ deaths: [{ tick: 9, killerId: null, killer: null, cause: "fell" }] })).includes("No enemy killed you this round (you fell)."));
});
test("result screen: clicking the All tab switches it, and a re-render keeps the chosen tab without a new read", async () => {
  const A = stub({ rounds: [killerRound()] });
  const { ui, document } = load({ analytics: A });
  const { overlay } = resultOverlay(document, true);
  ui.syncResult(); await settle();
  const panel = overlay.querySelector(".aim-an-hit");
  assert.ok(panel.innerHTML.includes('data-hit-tab="killer" aria-controls="aim-an-hit-pane-killer" aria-selected="true"'));
  panel.listeners.click[0]({ target: { closest: (sel) => (sel === "[data-hit-tab]" ? { dataset: { hitTab: "all" } } : null) } });
  assert.ok(panel.innerHTML.includes('data-hit-tab="all" aria-controls="aim-an-hit-pane-all" aria-selected="true"'));
  panel.listeners.keydown[0]({ key: "ArrowRight", preventDefault() {}, target: { closest: () => ({ dataset: { hitTab: "all" } }) } });
  assert.ok(panel.innerHTML.includes('data-hit-tab="killer" aria-controls="aim-an-hit-pane-killer" aria-selected="true"'), "arrow key wraps to the first tab");
  panel.listeners.click[0]({ target: { closest: () => ({ dataset: { hitTab: "all" } }) } });
  panel.remove(); ui.syncResult(); await settle();
  assert.ok(overlay.querySelector(".aim-an-hit").innerHTML.includes('data-hit-tab="all" aria-controls="aim-an-hit-pane-all" aria-selected="true"'));
  assert.strictEqual(A.calls.length, 1);
});

// ---- heatmap brightness, progress buckets (17 Nov 2026) ----
test("heatmap: the minimap is brightened (filter, opacity, lift) by default and the slider's filter reaches the minimap element", async () => {
  const fetchImpl = async (url) => ({ ok: url === "/aim-maps/ascent.minimap.json", json: async () => ({ image: "ascent.minimap.png", transform: { scaleU: 0.007, scaleV: 0.007, offsetU: 0.81, offsetV: 0.57 } }) });
  const { ui, document } = load({ analytics: stub({ days: [dayRow(0)] }), fetchImpl });
  const p = ui.open("heatmap"); await settle(10);
  let html = content(document).innerHTML;
  // default level 40 (17 Nov 2026; was 60)
  assert.ok(html.includes('class="aim-an-minimap"') && html.includes('opacity="0.73" style="filter:brightness(1.48) contrast(1.14) saturate(1.1)"'));
  assert.ok(html.includes('class="aim-an-lift"') && html.includes('fill-opacity="0.048"'));
  assert.ok(html.includes('type="range" min="0" max="100" step="5" value="40" data-bright') && html.includes("Brighten map"));
  assert.strictEqual(count(html, 'fill="#ff4655"'), 2, "death cells keep their colour");
  // drag the slider to 100: the minimap element gets the new filter in place
  const img = { attrs: {}, style: {}, setAttribute(k, v) { this.attrs[k] = String(v); } };
  content(document).querySelector = (sel) => (sel === ".aim-an-minimap" ? img : null);
  content(document).listeners.input[0]({ target: { dataset: { bright: "" }, value: "100", parentElement: null } });
  assert.strictEqual(p.bright, 100);
  assert.strictEqual(img.style.filter, "brightness(2.20) contrast(1.35) saturate(1.1)");
  assert.strictEqual(img.attrs.opacity, "1");
  assert.deepStrictEqual(ui.render.mapLook(0), { opacity: 0.55, filter: "brightness(1.00) contrast(1.00) saturate(1.1)", lift: 0 }, "level 0 = the old look");
});
const roundAt = (at, hits) => ({ at, day: null, end: "died", shots: [...Array(hits)].map(() => shot({ part: "head" })).concat([shot(), shot()]), deaths: [{ tick: 1 }] });
test("progress: with 3 days of data or fewer, one point per round (up to 30) or per session; more days give day points", () => {
  const { ui } = load({ analytics: stub() });
  const now = Date.now();
  const two = [dayRow(1), dayRow(0)];
  const five = [...Array(5)].map((_, i) => roundAt(now - (5 - i) * 60000, i));
  let html = ui.render.progressHtml(two, [], 7, now, five);
  assert.ok(html.includes('data-unit="round"') && html.includes("5 rounds with data"), "per round");
  assert.ok(html.includes("Only 2 days with data in the last 7 days, so each point is one round"));
  const b = ui.render.progressBuckets(five, 7, now, 2);
  assert.deepStrictEqual(b.series.accuracy.map((p) => Math.round(p.value)), [0, 33, 50, 60, 67]);
  // 40 rounds in three sittings two hours apart: per session
  const forty = [];
  for (let s = 0; s < 3; s++) for (let i = 0; i < (s === 2 ? 14 : 13); i++) forty.push(roundAt(now - (3 - s) * 2 * 3600000 + i * 60000, 1));
  const s = ui.render.progressBuckets(forty, 7, now, 2);
  assert.strictEqual(s.unit, "session"); assert.strictEqual(s.count, 3);
  assert.ok(ui.render.progressHtml(two, [], 7, now, forty).includes("3 sessions with data"));
  // 5 days with data: day points, the rounds are not used
  html = ui.render.progressHtml([4, 3, 2, 1, 0].map((n) => dayRow(n)), [], 7, now, five);
  assert.ok(!html.includes("data-unit=") && html.includes("5 days with data"));
  // no rounds stored: day points stay
  assert.ok(ui.render.progressHtml(two, [], 7, now, []).includes("2 days with data"));
});
test("progress: opens on the 7-day range, reads the stored rounds (bounded) only when the range has few days", async () => {
  const now = Date.now();
  const A = stub({ days: [dayRow(0)], rounds: [roundAt(now - 120000, 1), roundAt(now - 60000, 2)] });
  const { ui, document } = load({ analytics: A });
  const p = ui.open("progress"); await settle();
  assert.strictEqual(p.range, 7);
  const html = content(document).innerHTML;
  assert.ok(html.includes('data-range="7" aria-pressed="true"') && html.includes('data-range="30" aria-pressed="false"'));
  assert.ok(html.includes("2 rounds with data"));
  assert.deepStrictEqual(A.calls.filter((c) => c[0] === "rounds").map((c) => c[1]), [{ limit: 500 }]);
  const B = stub({ days: [6, 5, 4, 3, 2].map((n) => dayRow(n)) });
  const r = load({ analytics: B });
  r.ui.open("progress"); await settle();
  assert.ok(content(r.document).innerHTML.includes("5 days with data"));
  assert.strictEqual(B.calls.filter((c) => c[0] === "rounds").length, 0, "enough days: no round read");
});

// ---- fight outline, zoom, hover cards (17 Nov 2026) ----
test("fight squares carry an outline: a dark edge rect under each fight cell (same box) and a bright stroke in the CSS", async () => {
  const A = fightStub({ days: fightDays(), fightCells: { cells: {}, total: 0, withoutPosition: 0 } });
  const { ui, document } = load({ analytics: A });
  ui.open("heatmap"); await settle();
  for (const layer of ["fights"]) { // Both draws a bright ring without the dark edge (see the overlap test)
    layerClick(document, layer); await settle();
    const html = content(document).innerHTML;
    assert.strictEqual(count(html, 'class="aim-an-fight-edge"'), 2, layer + ": one edge per fight cell");
    const edges = [...html.matchAll(/class="aim-an-fight-edge" (x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+")\/><rect class="aim-an-fight[ "]/g)];
    assert.strictEqual(edges.length, 2, layer + ": each edge sits right under its fight square");
    for (const m of edges) assert.ok(html.includes(`"${m[1].split('"')[1]}"`));
  }
  const css = document.getElementById("aim-analytics-ui-css").textContent;
  assert.ok(/\.aim-an-fight \{ fill: var\(--an-fight\); stroke: var\(--an-fight-hi\); stroke-width: 1\.5/.test(css), "filled fights have a bright line");
  assert.ok(/\.aim-an-fight-edge \{ fill: none; stroke: rgba\(5, 7, 10, 0\.9\); stroke-width: 3\.5/.test(css), "and a dark edge under it");
  assert.ok(css.includes("--an-fight-hi: color-mix(in srgb, var(--an-fight)"), "the bright colour comes from the theme green");
});
test("zoom: a wheel step keeps the map point under the cursor, clamps to 1x..6x, and zoom out to 1x resets the pan", () => {
  const { ui } = load({ analytics: stub() });
  const { zoomAt } = ui.render;
  const under = (z, X, Y) => [(X - z.tx) / z.k, (Y - z.ty) / z.k];
  for (const vb of [{ x: 0, y: 0, width: 1000, height: 1000 }, { x: -12, y: -3, width: 20, height: 14 }]) {
    const X = vb.x + vb.width * 0.3, Y = vb.y + vb.height * 0.7;
    const z0 = { k: 1, tx: 0, ty: 0 };
    const before = under(z0, X, Y), z1 = zoomAt(z0, vb, X, Y, 1.25), after = under(z1, X, Y);
    assert.ok(z1.k > 1 && Math.abs(after[0] - before[0]) < 1e-9 && Math.abs(after[1] - before[1]) < 1e-9, "first step: same map point under the cursor");
    const X2 = vb.x + vb.width * 0.55, Y2 = vb.y + vb.height * 0.4, b2 = under(z1, X2, Y2), z2 = zoomAt(z1, vb, X2, Y2, 1.25), a2 = under(z2, X2, Y2);
    assert.ok(Math.abs(a2[0] - b2[0]) < 1e-9 && Math.abs(a2[1] - b2[1]) < 1e-9, "second step from a zoomed, panned view too");
    let z = z2;
    for (let i = 0; i < 30; i++) z = zoomAt(z, vb, X, Y, 1.3);
    assert.strictEqual(z.k, 6, "clamped at 6x");
    for (let i = 0; i < 30; i++) z = zoomAt(z, vb, X, Y, 0.7);
    assert.deepStrictEqual(z, { k: 1, tx: 0, ty: 0 }, "back to 1x, no pan");
  }
});
test("zoom: the map's cells and picture share one transform group, and a Reset zoom control sits with the layer chips", async () => {
  const fetchImpl = async (url) => ({ ok: url === "/aim-maps/ascent.minimap.json", json: async () => ({ image: "ascent.minimap.png", transform: { scaleU: 0.007, scaleV: 0.007, offsetU: 0.81, offsetV: 0.57 } }) });
  const { ui, document } = load({ analytics: stub({ days: [dayRow(0)] }), fetchImpl });
  ui.open("heatmap"); await settle(10);
  const html = content(document).innerHTML;
  assert.ok(/<g class="aim-an-zoom" transform="translate\(0 0\) scale\(1\)"><image [^>]*class="aim-an-minimap"[\s\S]*fill="#ff4655"[\s\S]*<\/g><\/svg>/.test(html), "picture and cells in the same group");
  assert.ok(/data-layer="both" aria-pressed="false">Both<\/button><button type="button" class="aim-an-zoom-reset" data-zoom-reset[^>]*>Reset zoom<\/button>/.test(html));
  const zoomed = ui.render.heatmapHtml([dayRow(0)], [], { map: "ascent", mode: "", code: "", weapon: "", layer: "deaths" }, null, null, 40, { k: 2, tx: -3, ty: -4.5 });
  assert.ok(zoomed.includes('<g class="aim-an-zoom" transform="translate(-3 -4.5) scale(2)">') && zoomed.includes('class="aim-an-map is-zoomed"'));
});
test("hover card: a cell's text gives the cell and its metres, deaths and fights with their share of the map, fights lost when known, and the layer", async () => {
  const A = fightStub({ days: fightDays(), fightCells: { cells: {}, total: 0, withoutPosition: 0 } });
  const { ui, document } = load({ analytics: A });
  ui.open("heatmap"); await settle();
  layerClick(document, "both"); await settle();
  const html = content(document).innerHTML;
  // round 2: the first line is the value of the square hovered, large; the small last line has the cell, share and layer
  // Both: a Deaths line and a Fights line (same size: both value lines), each with "X% / N" (share of the layer's total / total)
  const both12 = "Deaths 6\t75% / 8\nFights 2\t29% / 7\nascent · cell 1, 2 (x 1 to 2 m, z 2 to 3 m) · Both layer";
  assert.strictEqual(count(html, `data-tip="${both12}"`), 2, "the death square and the fight ring of the cell carry the same card");
  assert.ok(html.includes('data-tip="Deaths 0\t0% / 8\nFights 5\t71% / 7\nascent · cell 5, 5 (x 5 to 6 m, z 5 to 6 m) · Both layer"'));
  assert.ok(!html.includes("<title>"), "no browser tooltip on top of the card");
  // one layer: the value line first (large), share in its corner
  const deathsOnly = ui.render.cellTip("-4,7", { map: "ascent", layer: "deaths", deaths: { cells: { "-4,7": 2 }, total: 8 }, fights: null });
  assert.strictEqual(deathsOnly, "Deaths 2\t25% / 8\nascent · cell -4, 7 (x -4 to -3 m, z 7 to 8 m) · Deaths layer");
  assert.ok(deathsOnly.split("\n")[0].startsWith("Deaths 2"), "the first line is the value");
  const fl = ui.render.fightLayer([], { cells: { "3,4": 4 }, total: 4, withoutPosition: 0, lost: { "3,4": 3 } }, { map: "ascent", code: "abc" });
  assert.strictEqual(ui.render.cellTip("3,4", { map: "ascent", layer: "fights", deaths: { cells: {}, total: 0 }, fights: fl }, "fights"),
    "Fights 4\t100% / 4\nFights lost 3 of 4\nascent · cell 3, 4 (x 3 to 4 m, z 4 to 5 m) · Fights layer");
  // the card element lives in the panel (outside the re-rendered content), hidden until a hover
  const tipBox = document.body.querySelector(".aim-an-tipbox");
  assert.ok(tipBox && tipBox.hidden === true && tipBox.getAttribute("role") === "tooltip");
});

// ---- progress axes and node cards (17 Nov 2026) ----
test("progress axes: tick values are round numbers that cover the data range", () => {
  const { ui } = load({ analytics: stub() });
  for (const [lo, hi] of [[37.2, 81.9], [0.41, 0.93], [0, 100], [1.6, 2.05], [12, 13], [0.2, 3.7]]) {
    const { ticks, step } = ui.render.niceTicks(lo, hi);
    assert.ok(ticks.length >= 3 && ticks.length <= 7, `${lo}..${hi}: ${ticks.length} ticks`);
    assert.ok(ticks[0] <= lo + 1e-9 && ticks[ticks.length - 1] >= hi - 1e-9, `${lo}..${hi} covered by ${ticks}`);
    const mant = step / Math.pow(10, Math.floor(Math.log10(step) + 1e-9));
    assert.ok([1, 2, 2.5, 5].some((m) => Math.abs(m - mant) < 1e-9), "step " + step);
    for (const t of ticks) assert.ok(Math.abs(t / step - Math.round(t / step)) < 1e-6, `${t} is a multiple of ${step}`);
  }
  const html = ui.render.progressHtml([dayRow(20), dayRow(5), dayRow(1, { hits: 120, headshots: 30 })], [], 30, Date.now());
  const acc = html.slice(html.indexOf('data-metric="accuracy"'), html.indexOf('data-metric="headshots"'));
  const ticks = [...acc.matchAll(/data-tick="([\d.]+)"/g)].map((m) => +m[1]);
  assert.ok(ticks.length >= 3 && ticks[0] <= 50 && ticks[ticks.length - 1] >= 60, "accuracy 50..60% covered: " + ticks);
  assert.ok(acc.includes('class="aim-an-grid"') && /data-tick="\d+" style="top:[\d.]+%">\d+%<\/span>/.test(acc), "gridlines and % labels");
});
test("progress axes: first and last date labels at the ends, dates between, and a node's card gives its exact value and date", () => {
  const { ui } = load({ analytics: stub() });
  const now = Date.now(), short = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d.getDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]; };
  const html = ui.render.progressHtml([dayRow(20), dayRow(5), dayRow(1, { hits: 121, headshots: 30 })], [], 30, now);
  const acc = html.slice(html.indexOf('data-metric="accuracy"'), html.indexOf('data-metric="headshots"'));
  assert.ok(acc.includes(`class="is-first" data-x-edge="first" style="left:2.31%">${short(29)}</span>`), "first day of the range at the left end");
  assert.ok(acc.includes(`class="is-last" data-x-edge="last" style="left:97.69%">${short(0)}</span>`), "today at the right end");
  assert.strictEqual(count(acc, 'data-x-edge=""'), 3, "three dates between");
  assert.ok(acc.includes(`data-tip="Accuracy: 60.5%\nDay: ${short(1)} ${dayN(1).slice(0, 4)}"`), "node card: exact value and its day");
  assert.strictEqual(count(acc, 'class="aim-an-node"'), 3);
  // per session: the card names the session and its rounds
  const forty = [];
  for (let s = 0; s < 3; s++) for (let i = 0; i < (s === 2 ? 14 : 13); i++) forty.push(roundAt(now - (3 - s) * 2 * 3600000 + i * 60000, 1));
  const ses = ui.render.progressHtml([dayRow(1), dayRow(0)], [], 7, now, forty);
  assert.ok(/data-tip="Accuracy: 33\.3%\nSession from \d+ \w{3} \d\d:\d\d \(14 rounds\)"/.test(ses), "session card");
  assert.ok(ses.includes('data-x-edge="first"') && ses.includes('data-x-edge="last"'));
});

// ---- coach gallery and visuals (17 Nov 2026) ----
const coachList = () => [
  { id: "fights-lost", title: "Enemies shoot you first in 60% of fights", detail: "You lost 12 of 20. Try to shoot first.", severity: "warn", sample: 20, evidence: { fightsWon: 8, fightsLost: 12, fights: 20, lostPercent: 60 } },
  { id: "miss-side", title: "You miss high", detail: "Most misses pass above.", severity: "tip", sample: 44, evidence: { nearMisses: 44, above: 30, below: 14, sharePercent: 68, averageOffsetCm: 9, side: "above" } },
  { id: "kill-time", title: "You kill in about 0.6 s", detail: "Median of 31 kills.", severity: "info", sample: 31, evidence: { kills: 31, medianSeconds: 0.6, averageSeconds: 0.7 } },
];
// The tip modal on the body: its shade and dialog (null when none is open).
const tipShade = (document) => document.body.children.find((c) => c.className.split(/\s+/).includes("aim-an-tipm-shade")) || null;
test("coach gallery: equal larger cards in order (icon, title, summary, small visual, Numbers button; no Numbers list on the card); a click on the card, Enter / Space on the focused card and the Numbers button open the tip modal; Esc / the backdrop close it and focus goes back to what opened it", async () => {
  const { ui, document } = load({ analytics: stub(), coach: { insights: async () => coachList() } });
  ui.open("coach"); await settle();
  const html = content(document).innerHTML;
  const cards = [...html.matchAll(/<li class="is-\w+" data-id="([^"]+)"><article class="aim-an-card" tabindex="0" data-coach="(\d)" aria-haspopup="dialog" aria-labelledby="([^"]+)">/g)];
  assert.deepStrictEqual(cards.map((m) => m[1]), ["fights-lost", "miss-side", "kill-time"]);
  assert.deepStrictEqual(cards.map((m) => m[2]), ["0", "1", "2"], "each card names its finding and is focusable");
  assert.ok(cards.every((m) => html.includes('<h4 id="' + m[3] + '">')), "each card is labelled by its heading");
  assert.ok(html.includes('<span class="aim-an-main">60% lost</span>') && html.includes('<span class="aim-an-main">0.6 s median</span>'), "the summary line stays");
  // no automatic numbers: no Numbers list, no detail, advice, sample or fine print on the card
  assert.ok(!html.includes("aim-an-why") && !html.includes("<dl>") && !html.includes("<dt>") && !html.includes("aim-an-detail") && !html.includes("aim-an-advice") && !html.includes("sample "), "only icon, title, summary, small visual");
  assert.strictEqual(count(html, '<div class="aim-an-card-vis" aria-hidden="true">'), 2, "a small visual where the evidence allows one (fights, misses)");
  assert.ok(html.includes('<p class="aim-an-card-text">Median of 31 kills.</p>'), "no visual: the clamped text");
  assert.strictEqual(count(html, '<button type="button" class="aim-an-numbers" data-coach="'), 3, "a Numbers button per card");
  assert.ok(!html.includes("is-open") && !html.includes("aria-expanded") && !html.includes("<details"), "nothing expands in the card");
  // a click outside any card and Esc change nothing
  let stopped = false;
  content(document).listeners.click[0]({ target: { closest: () => null } });
  content(document).listeners.keydown[0]({ key: "Escape", target: { closest: () => null }, stopPropagation() { stopped = true; }, preventDefault() {} });
  await settle();
  assert.strictEqual(content(document).innerHTML, html, "the gallery stays the same");
  assert.strictEqual(tipShade(document), null);
  assert.ok(!stopped, "Esc is left to the panel");
  // a click anywhere on the second card opens the modal with that finding's Numbers list and full text
  const card = { tagName: "ARTICLE", dataset: { coach: "1" }, isConnected: true, focus() { El.focused = this; } };
  card.closest = (sel) => (sel === "[data-coach]" ? card : null);
  content(document).listeners.click[0]({ target: { closest: (sel) => (sel === "[data-coach]" ? card : null) } });
  const shade = tipShade(document), box = shade && shade.children[0];
  assert.ok(box && box.getAttribute("role") === "dialog" && box.getAttribute("aria-modal") === "true" && box.getAttribute("aria-labelledby") === "aim-an-tipm-title", "a modal dialog");
  assert.ok(box.className.includes("aim-an-tipm") && box.className.includes("is-tip"));
  assert.ok(box.innerHTML.includes('<h3 id="aim-an-tipm-title">You miss high</h3>') && box.innerHTML.includes("sample 44"));
  assert.ok(box.innerHTML.includes('<div class="aim-an-why"><h5>Numbers</h5><dl>') && box.innerHTML.includes("<dt>averageOffsetCm</dt><dd>9</dd>"), "the Numbers list");
  assert.ok(box.innerHTML.includes('<p class="aim-an-lead">Most misses pass above.</p>') && box.innerHTML.includes('<div class="aim-an-vis">'), "the full detail and the visual at full size");
  assert.strictEqual(El.focused, box, "focus moves into the dialog");
  // Esc closes it, is kept from the game, and gives focus back to the card
  let escStopped = false;
  shade.listeners.keydown[0]({ key: "Escape", preventDefault() {}, stopPropagation() { escStopped = true; } });
  assert.strictEqual(tipShade(document), null, "closed");
  assert.ok(escStopped, "the key does not reach the game");
  assert.strictEqual(El.focused, card, "focus back on the card");
  // keyboard: Enter and Space on the focused card open it; Enter on the Numbers button is left to the button's own click
  for (const key of ["Enter", " "]) {
    let prevented = false;
    content(document).listeners.keydown[0]({ key, target: card, preventDefault() { prevented = true; } });
    assert.ok(tipShade(document) && prevented, JSON.stringify(key) + " opens it");
    tipShade(document).listeners.keydown[0]({ key: "Escape", preventDefault() {}, stopPropagation() {} });
    assert.strictEqual(El.focused, card);
  }
  const button = { tagName: "BUTTON", dataset: { coach: "0" }, isConnected: true, focus() { El.focused = this; } };
  button.closest = (sel) => (sel === "[data-coach]" ? button : null);
  content(document).listeners.keydown[0]({ key: "Enter", target: button, preventDefault() {} });
  assert.strictEqual(tipShade(document), null, "the button's keydown is not handled twice");
  // the Numbers button opens it too (the first card's), and focus goes back to the button
  content(document).listeners.click[0]({ target: button });
  assert.ok(tipShade(document).children[0].innerHTML.includes("Enemies shoot you first"), "the button's own finding");
  tipShade(document).listeners.keydown[0]({ key: "Escape", preventDefault() {}, stopPropagation() {} });
  assert.strictEqual(El.focused, button, "focus back on the Numbers button");
  // the backdrop closes it; a press that starts inside the dialog and ends on the backdrop does not
  content(document).listeners.click[0]({ target: button });
  const s2 = tipShade(document);
  s2.listeners.mousedown[0]({ target: s2.children[0] }); s2.listeners.click[0]({ target: s2 });
  assert.ok(tipShade(document), "a drag out of the dialog keeps it");
  s2.listeners.mousedown[0]({ target: s2 }); s2.listeners.click[0]({ target: s2 });
  assert.strictEqual(tipShade(document), null, "backdrop click closes");
  // the CSS: equal columns of at least 340 px that share the width, equal rows of at least 260 px that share the view box's
  // height (the grid is at least as tall as it), a fixed cell per part, clamps, one column on phones; the modal above the panel
  const css = document.getElementById("aim-analytics-ui-css").textContent;
  const grid = (css.match(/\.aim-an-coach \{[^}]*\}/) || [""])[0];
  assert.ok(grid.includes("--an-card-min: 340px; --an-card-h: 260px") && grid.includes("grid-template-columns: repeat(auto-fill, minmax(var(--an-card-min), 1fr))"), "equal columns that fill the width: " + grid);
  assert.ok(grid.includes("grid-auto-rows: minmax(var(--an-card-h), 1fr)") && grid.includes("min-height: 100%") && grid.includes("align-content: stretch"), "equal rows that fill the height: " + grid);
  const view = (css.match(/\.es-tool\.aim-an-panel \.aim-an-content \{[^}]*\}/) || [""])[0];
  assert.ok(/height: var\(--an-view-h\)/.test(view), "the view box has a definite height for the rows to share");
  assert.ok(!/justify-content: center/.test(grid), "no gap left at the side");
  assert.ok(css.includes(".aim-an-coach { grid-template-columns: minmax(0, 1fr); }"), "one column on phones");
  const cardCss = (css.match(/\.aim-an-coach \.aim-an-card \{[^}]*\}/) || [""])[0];
  assert.ok(/height: 100%/.test(cardCss) && /width: 100%/.test(cardCss) && /overflow: hidden/.test(cardCss) && /grid-template-rows: 46px 20px minmax\(0, 1fr\) 30px/.test(cardCss) && /padding: 16px/.test(cardCss) && /cursor: pointer/.test(cardCss), "the cell size, fixed parts, clipped: " + cardCss);
  assert.ok(/\.aim-an-coach \.aim-an-card:focus-visible \{ outline: 2px solid var\(--an-red\)/.test(css), "a focus ring on the card");
  assert.ok(/\.aim-an-card h4 \{[^}]*-webkit-line-clamp: 2/.test(css) && /\.aim-an-card > \.aim-an-main \{[^}]*text-overflow: ellipsis/.test(css) && /\.aim-an-card-text \{[^}]*-webkit-line-clamp: 5/.test(css), "clamped title, summary and text");
  assert.ok(/\.es-tool-shade\.aim-an-tipm-shade \{ z-index: 2147482300; \}/.test(css) && /\.es-tool\.aim-an-tipm \{[^}]*overflow: auto/.test(css), "above the Stats panel, scrolls inside itself");
  assert.ok(/prefers-reduced-motion: reduce\) \{ \.es-tool-shade\.aim-an-tipm-shade, \.es-tool\.aim-an-tipm \{ animation: none; \} \}/.test(css), "reduced motion");
  assert.ok(css.includes(".es-tool-shade.aim-an-tipm-shade { padding: 16px; }"), "16px gutter on phones");
  assert.ok(!/is-open|is-ghost|has-open|aim-an-why summary|aim-an-card-head|@keyframes aim-an-open/.test(css), "no in-card open / close styling left");
});
test("coach visuals: drawn from the evidence a rule has; the modal shows it in full with the Numbers list below, the card a small copy (drawing only, at most 4 bars)", () => {
  const { ui } = load({ analytics: stub() });
  const { coachVisual, coachModalHtml, cardVisual } = ui.render;
  const coachHtml = (list) => coachModalHtml(list[0]); // the modal of one finding
  const [fights, miss, kill] = coachList();
  const fv = coachVisual(fights);
  assert.ok(fv.includes('data-vis="bars"') && fv.includes("<span>Won</span>") && fv.includes("<em>8 fights</em>") && fv.includes("<em>12 fights</em>"));
  assert.ok(coachVisual(miss).includes('data-vis="dots"') && coachVisual(miss).includes("9 cm") && coachVisual(miss).includes("above · 30"));
  const sectors = [{ sector: "the -z direction", fights: 6, won: 1, lost: 5, winPercent: 17 }, { sector: "the +x direction", fights: 5, won: 4, lost: 1, winPercent: 80 }];
  const wheel = coachVisual({ id: "angle-lose:ascent", evidence: { sector: "the -z direction", sectors } });
  assert.ok(wheel.includes('data-vis="wheel"') && wheel.includes(">17%</text>") && wheel.includes(">80%</text>"));
  const trend = coachVisual({ id: "kill-time-trend", evidence: { recentSeconds: 0.55, previousSeconds: 0.62 } });
  assert.ok(trend.includes('data-vis="line"') && trend.includes("0.62 s") && trend.includes("0.55 s"));
  assert.ok(coachVisual({ id: "counter-strafe", evidence: { stillAccuracyPercent: 41, movingAccuracyPercent: 22 } }).includes("<span>still accuracy</span>"), "compared rates");
  const withVis = coachHtml([fights], false);
  assert.ok(withVis.includes('<div class="aim-an-vis">') && withVis.includes('<div class="aim-an-why"><h5>Numbers</h5><dl>') && !withVis.includes("<details"), "visual, Numbers shown in full below");
  assert.ok(withVis.includes('<p class="aim-an-lead">You lost 12 of 20.</p><div class="aim-an-vis">') && /<\/div><p class="aim-an-advice">Try to shoot first\.<\/p><div class="aim-an-why">/.test(withVis), "the detail above the visual, the advice under it, then the Numbers");
  assert.ok(withVis.indexOf("<h5>Numbers</h5>") > withVis.indexOf("aim-an-vis"), "Numbers at the bottom");
  assert.strictEqual(coachVisual(kill), "", "kill-time has nothing to draw");
  const noVis = coachHtml([kill], false);
  assert.ok(!noVis.includes("aim-an-vis") && noVis.includes('<p class="aim-an-lead">Median of 31 kills.</p><div class="aim-an-why"><h5>Numbers</h5><dl><dt>kills</dt><dd>31</dd>'), "no visual: the text and the Numbers list only");
  const bare = coachHtml([{ id: "kill-time", title: "You kill in about 0.6 s", detail: "", severity: "info", sample: 3, evidence: {} }], false);
  assert.ok(bare.includes("<h3") && !bare.includes("aim-an-vis") && !bare.includes("aim-an-why") && !/<p[ >]/.test(bare), "no evidence and no text: the head only");
  assert.strictEqual(coachVisual({ id: "fights-lost", evidence: {} }), "", "missing evidence: no visual");
  // the card's copy: the drawing without notes, heading or slider; a long bar list keeps the marked bar and three others
  assert.ok(!cardVisual(miss).includes("aim-an-note") && cardVisual(miss).includes('data-vis="dots"'));
  const spray = cardVisual({ id: "spray-control", evidence: { bulletDriftYawDeg: 0, bulletDriftPitchDeg: 2.79 } });
  assert.ok(spray.startsWith("<svg") && spray.endsWith("</svg>") && !spray.includes("<input") && !spray.includes("<h5>"), "angle: the drawing only");
  const sectors8 = ["the -z direction", "the -z / -x diagonal", "the -x direction", "the +z / -x diagonal", "the +z direction", "the +z / +x diagonal", "the +x direction", "the -z / +x diagonal"].map((sector, i) => ({ sector, deaths: i + 1 }));
  const many = { id: "clear-deaths", evidence: { sector: "the -z / +x diagonal", sectors: sectors8 } };
  assert.strictEqual((coachVisual(many).match(/class="aim-an-bar[" ]/g) || []).length, 8, "the modal: every bar");
  const small = cardVisual(many);
  assert.strictEqual((small.match(/class="aim-an-bar[" ]/g) || []).length, 4, "the card: four bars");
  assert.ok(small.includes("<span>the -z / +x diagonal</span>") && small.includes("<span>the -z direction</span>"), "the marked bar is kept");
});

// ---- Stats inline on the Training history page (17 Nov 2026) ----
test("inline Stats: mountInline renders the same tabs in the host, no backdrop and no close button; open() still works", async () => {
  const { ui, document } = load({ analytics: stub({ days: [dayRow(0)] }) });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const p = ui.mountInline(host, "heatmap");
  await settle();
  assert.ok(host.children[0].className.includes("aim-an-panel") && host.children[0].className.includes("aim-an-inline"));
  assert.strictEqual(host.children[0].getAttribute("role"), null, "not a dialog");
  assert.deepStrictEqual(host.querySelector(".aim-an-tabs").children.map((b) => b.textContent), ["Session", "Drills", "Progress", "Compare", "Heatmap", "Tracking", "Coach"]);
  assert.strictEqual(host.querySelector(".es-tool-x"), null);
  assert.strictEqual(document.body.querySelector(".aim-an-shade"), null);
  assert.ok(host.querySelector(".aim-an-content").innerHTML.includes('fill="#ff4655"'), "heatmap drawn inline");
  assert.strictEqual(ui.mountInline(host), p, "same host: same panel");
  ui.open("coach"); await settle();
  assert.ok(document.body.querySelector(".aim-an-shade") && document.body.querySelector(".es-tool-x"));
  ui.close();
  assert.ok(host.querySelector(".aim-an-content").innerHTML.includes('fill="#ff4655"'), "closing the modal leaves the inline panel");
});
test("inline Stats: the host goes right after the history board's root, comes back when a re-render drops it, and hides on another tab", async () => {
  const { ui, document } = load({ analytics: stub({ days: [dayRow(0)] }) });
  const nav = document.createElement("nav"); nav.className = "hall-tabs";
  const play = document.createElement("button"); play.className = "hall-tab"; play.textContent = "VALORANT Training";
  const hist = document.createElement("button"); hist.className = "hall-tab is-active"; hist.textContent = "Training history";
  nav.append(play, hist);
  const scroll = document.createElement("div"); scroll.className = "rov-scroll";
  const root = document.createElement("div"); root.className = "board-root";
  const hx = document.createElement("div"); hx.className = "hx";
  root.appendChild(hx); scroll.appendChild(root);
  document.body.append(nav, scroll);
  ui.syncStatsHost(); await settle();
  const host = root.nextElementSibling;
  assert.ok(host && host.className === "aim-an-stats-host" && host.hidden === false, "after the board root, not inside it");
  assert.strictEqual(root.children.length, 1, "nothing inside the board element");
  assert.ok(host.querySelector(".aim-an-inline"));
  host.remove(); ui.syncStatsHost();
  assert.strictEqual(root.nextElementSibling, host, "re-inserted");
  hist.className = "hall-tab"; play.className = "hall-tab is-active";
  ui.syncStatsHost();
  assert.strictEqual(host.hidden, true, "hidden on another tab");
  play.className = "hall-tab"; hist.className = "hall-tab is-active";
  ui.syncStatsHost();
  assert.strictEqual(host.hidden, false);
});

// ---- round 2 (17 Nov 2026): node placement, focus chart, in-place cards, angle visual ----
test("progress nodes: each node's y is the value on the chart's scale, in a box that holds only the plot (the x labels sit outside it)", () => {
  const { ui } = load({ analytics: stub() });
  const html = ui.render.progressHtml([dayRow(20, { hits: 120 }), dayRow(5), dayRow(1, { hits: 121 })], [], 30, Date.now());
  const big = html.slice(html.indexOf('<div class="aim-an-focus"'), html.indexOf('<div class="aim-an-thumbs"'));
  const ticks = [...big.matchAll(/data-tick="([\d.]+)"/g)].map((m) => +m[1]), lo = ticks[0], hi = ticks[ticks.length - 1];
  const H = 70, P = 6, yOf = (v) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
  const tops = [...big.matchAll(/class="aim-an-node" style="left:([\d.]+)%;top:([\d.]+)%"/g)].map((m) => +m[2]);
  assert.deepStrictEqual(tops.length, 3);
  [60, 52.5, 60.5].forEach((v, i) => assert.ok(Math.abs(tops[i] - (yOf(v) / H) * 100) < 0.01, `node ${i}: ${tops[i]}% for ${v}%`));
  // the same y as the line's vertex, in the same box
  const line = big.match(/<polyline class="aim-an-line" points="([^"]+)"/)[1].split(" ").map((xy) => xy.split(",").map(Number));
  line.forEach(([, y], i) => assert.ok(Math.abs((y / H) * 100 - tops[i]) < 0.1, "on the line"));
  assert.ok(/<div class="aim-an-plotbox"><svg [^>]*preserveAspectRatio="none"[\s\S]*?<\/svg>(<span class="aim-an-node"[^>]*><\/span>){3}<\/div><span><\/span><div class="aim-an-xaxis"/.test(big), "nodes and svg alone in the plot box");
  const css = load({ analytics: stub() }).document.getElementById("aim-analytics-ui-css").textContent;
  assert.ok(css.includes(".aim-an-plotbox svg { position: absolute; inset: 0; width: 100%; height: 100%; }"), "the svg fills the box the nodes are placed in");
});
test("progress focus: a large chart on top and six thumbnails; the focus follows the last clicked thumbnail and resets on another Stats tab", async () => {
  const A = stub({ days: [dayRow(20), dayRow(5), dayRow(1)], engagements: [{ day: dayN(5), killed: true, sight: true, timeToKill: 1.9, visibleTimeToKill: 0.9 }, { day: dayN(1), killed: true, sight: true, timeToKill: 1.5, visibleTimeToKill: 0.5 }] });
  const { ui, document } = load({ analytics: A });
  ui.open("progress"); await settle();
  const focusClick = (id) => content(document).listeners.click[0]({ target: { closest: (sel) => (sel === "[data-focus]" ? { dataset: { focus: id } } : null) } });
  let html = content(document).innerHTML;
  assert.ok(html.includes('<div class="aim-an-focus" data-focused="accuracy">'), "accuracy by default");
  const order = (h) => [...h.slice(h.indexOf("aim-an-thumbs")).matchAll(/data-focus="(\w+)"/g)].map((m) => m[1]);
  const fixed = ["accuracy", "headshots", "killTime", "nearMisses", "flicks", "strafes", "deaths"];
  assert.deepStrictEqual(order(html), fixed, "every metric as a thumbnail, in the fixed order");
  assert.ok(html.includes('data-focus="accuracy" role="button" tabindex="0" aria-pressed="true"'), "the shown one is marked");
  focusClick("killTime"); await settle();
  html = content(document).innerHTML;
  assert.ok(html.includes('data-focused="killTime"') && html.includes('data-focus="killTime" role="button" tabindex="0" aria-pressed="true"'), "kill time large, its thumbnail marked");
  assert.deepStrictEqual(order(html), fixed, "the row did not reorder");
  assert.strictEqual(count(html, 'aria-pressed="true" aria-label="Show'), 1, "one marked thumbnail");
  // the large chart is a copy of the marked thumbnail's data: same summary
  const h4 = (h, sel) => { const at = h.indexOf("<h4>", h.indexOf(sel)); return h.slice(at, h.indexOf("</h4>", at)); };
  assert.ok(h4(html, '<div class="aim-an-focus"').includes("Kill time"));
  assert.strictEqual(h4(html, '<div class="aim-an-focus"'), h4(html, 'data-focus="killTime"'), "same data, same summary");
  focusClick("deaths"); await settle();
  assert.ok(content(document).innerHTML.includes('data-focused="deaths"'), "the last click wins");
  content(document).listeners.click[0]({ target: { closest: (sel) => (sel === "[data-range]" ? { dataset: { range: "90" } } : null) } }); await settle();
  assert.ok(content(document).innerHTML.includes('data-focused="deaths"'), "kept over a range change");
  const tabs = document.body.querySelector(".aim-an-tabs").children;
  tabs[5].listeners.click[0](); tabs[2].listeners.click[0](); await settle();
  assert.ok(content(document).innerHTML.includes('data-focused="accuracy"'), "back to the default after another Stats tab");
  assert.strictEqual(A.calls.filter((c) => c[0] === "days").length, 1, "no new read for a focus change");
});
test("coach cards keep the order returned and never span columns (no expansion)", () => {
  const { ui } = load({ analytics: stub() });
  const list = coachList();
  const html = ui.render.coachHtml(list, false, "miss-side", 1, 3); // old extra arguments are ignored
  assert.deepStrictEqual([...html.matchAll(/<li class="[^"]*" data-id="([^"]+)"/g)].map((m) => m[1]), ["fights-lost", "miss-side", "kill-time"]);
  assert.strictEqual(html, ui.render.coachHtml(list, false), "the same gallery whatever was clicked before");
  assert.ok(!html.includes("grid-column") && !html.includes("is-open"), "no inline column span, no open card");
});
test("angle visual: 2.79 degrees at 15 m is about 0.73 m; the slider moves the dot and the metres; the distance is said to be assumed", () => {
  const { ui, document } = load({ analytics: stub() });
  assert.ok(Math.abs(ui.render.angleOffset(2.79, 15) - 0.731) < 0.001);
  const v = ui.render.coachVisual({ id: "spray-control", evidence: { bulletDriftYawDeg: 0, bulletDriftPitchDeg: 2.79, bulletDriftDeg: 2.79 } });
  assert.ok(v.includes("<h5>What this means</h5>") && v.includes('<b data-deg-text>0.73 m at 15 m</b>') && v.includes(">0.73 m</text>"));
  assert.ok(v.includes('value="15" data-deg-dist') && v.includes('min="5" max="30"'), "slider 5..30 m at 15");
  assert.ok(v.includes("2.79° at 15 m is about 0.73 m") && v.includes("15 m is assumed"));
  assert.ok(v.includes("<title>A head, about 0.25 m wide</title>"), "head-sized circle");
  assert.strictEqual(ui.render.coachVisual({ id: "spray-control", evidence: { basis: "hit-rate", earlyAccuracyPercent: 40, lateAccuracyPercent: 20 } }).includes("data-deg"), false, "the hit-rate fallback has no angle");
  assert.ok(ui.render.coachVisual({ id: "pre-aim", evidence: { averagePitchErrorDegrees: -4.2 } }).includes("What this means"));
  assert.ok(!ui.render.coachVisual({ id: "spray-control", evidence: { bulletDriftYawDeg: 0, bulletDriftPitchDeg: 2.79, distanceMetres: 22 } }).includes("assumed"), "a stored distance is used");
  // the slider: 30 m doubles the offset
  ui.open("coach");
  const attrs = {}, mk = (name) => ({ setAttribute: (k, val) => { attrs[name + "." + k] = val; }, textContent: "" });
  const dot = mk("dot"), ray = mk("ray"), label = mk("label"), out = mk("out"), text = mk("text");
  const svg = { dataset: { yaw: "0", pitch: "2.79", scale: "10" }, querySelector: (sel) => ({ "[data-deg-dot]": dot, "[data-deg-ray]": ray, "[data-deg-m]": label })[sel] };
  const vis = { querySelector: (sel) => (sel === "svg[data-deg]" ? svg : sel === "[data-deg-text]" ? text : null) };
  content(document).listeners.input[0]({ target: { dataset: { degDist: "" }, value: "30", closest: () => vis, parentElement: { querySelector: () => out } } });
  assert.strictEqual(label.textContent, "1.46 m");
  assert.strictEqual(out.textContent, "30 m");
  assert.strictEqual(text.textContent, "1.46 m at 30 m");
  assert.strictEqual(attrs["dot.cy"], +(100 - 30 * Math.tan((2.79 * Math.PI) / 180) * 10).toFixed(1));
});
test("readable width: running text is limited to about 62 characters per line", () => {
  const css = load({ analytics: stub() }).document.getElementById("aim-analytics-ui-css").textContent;
  assert.ok(css.includes(".aim-an-detail p, .aim-an-note, .aim-an-msg, .aim-an-panel .es-tool-head p { max-width: 62ch; }"));
});

// ---- killer tab: only your shots AT the killer (17 Nov 2026 fix) ----
// enemy 7 (bot_a) fights you from tick 30; enemy 9 (bot_a too) shows up at tick 80 and kills you at 100.
//   shot 0 tick 50: hit on bot_a while only enemy 7 is in a fight            -> before the killer's fight: not the killer's
//   shot 1 tick 85: hit on bot_a while enemies 7 and 9 both fight you         -> shared (most likely on 7): not shown
//   shot 2 tick 86: miss, passes 0.1 m from enemy 7 and 0.4 m from enemy 9    -> aimed at 7: not the killer's
const strayRound = (o = {}) => ({ ...diedRound([
  shot({ tick: 50, part: "body", target: "bot_a", nearestEnemy: ne(0.05, 0.3) }),
  shot({ tick: 85, part: "head", target: "bot_a" }),
  shot({ tick: 86, nearestEnemy: ne(0.1, 0.2) }),
]), nearMisses: [{ shotIndex: 2, enemyId: 7, template: "bot_a", missDistance: 0.1, verticalOffset: 0.2 }, { shotIndex: 2, enemyId: 9, template: "bot_a", missDistance: 0.4, verticalOffset: 0.6 }],
  engagements: [{ enemyId: 7, template: "bot_a", startTick: 30, killed: false, killTick: null }, { enemyId: 9, template: "bot_a", startTick: 80, killed: false, killTick: null }],
  deaths: [{ tick: 100, killerId: 9, killer: "bot_a", killerDistance: 8, cause: "shot", nearMisses: [] }], ...o });
test("killer tab: a death to an enemy you never shot at shows the zero report and none of your shots at other enemies", () => {
  const { ui } = load({ analytics: stub() });
  const k = ui.render.killerShots(strayRound());
  assert.strictEqual(k.sum.shots, 0, "nothing tied to the killer");
  assert.strictEqual(k.sum.dots.length, 0);
  const html = ui.render.hitPanelHtml(strayRound());
  const kp = paneOf(html, "killer");
  // the zero report (one list fix): the figure, the five zone rows at 0, and one small note under the figure
  assert.ok(kp.includes('<div class="aim-an-zero">') && kp.includes('<p class="aim-an-hit-note" data-zero>No hits on the enemy that killed you (0 shots landed).'));
  assert.ok(!kp.includes("data-stat=") && !kp.includes("aim-an-hit-sum") && !kp.includes("aim-an-none"), "no stat rows, no big headline");
  assert.strictEqual(count(kp, "<b>0</b>"), 5, "the five zone rows at 0");
  assert.strictEqual(count(kp, "0 shots landed"), 1, "said once");
  assert.ok(kp.includes('Your other shots are in the "All my shots" tab.'), "the pointer to the other tab stays");
  const fig = kp.slice(kp.indexOf('<svg class="aim-an-body"'), kp.indexOf("</svg>", kp.indexOf('<svg class="aim-an-body"')));
  assert.ok(fig.length > 0 && fig.includes('class="aim-an-zone is-head"'), "the body figure is still drawn");
  assert.ok(!fig.includes("aim-an-dot") && !fig.includes("aim-an-ring") && !fig.includes("is-hit"), "with no hit markers");
  assert.ok(kp.indexOf("data-zero") > kp.indexOf('<ul class="aim-an-zones">'), "the note is under the figure and its list");
  // the All tab still has every shot of yours
  const ap = paneOf(html, "all");
  assert.strictEqual([...ap.matchAll(/<b>(\d+)<\/b><\/li>/g)].reduce((a, m) => a + +m[1], 0), 2, "its two hits in the zone rows");
  // a round with fight records but none for the killer: never fought, so no hit on its type is yours on it
  const never = ui.render.killerShots(strayRound({ engagements: [{ enemyId: 7, template: "bot_a", startTick: 30, killed: false, killTick: null }] }));
  assert.strictEqual(never.method, "never"); assert.strictEqual(never.sum.shots, 0);
});
test("killer tab: a shot you fired at the killer shows up (a hit while it was the only one of its type fighting you, a miss that passed closest to it)", () => {
  const { ui } = load({ analytics: stub() });
  const r = strayRound({ engagements: [{ enemyId: 7, template: "bot_a", startTick: 30, killed: true, killTick: 60 }, { enemyId: 9, template: "bot_a", startTick: 80, killed: false, killTick: null }] });
  r.shots.push(shot({ tick: 90, nearestEnemy: ne(-0.15, 0.4) }));
  r.nearMisses.push({ shotIndex: 3, enemyId: 9, template: "bot_a", missDistance: 0.15, verticalOffset: 0.4 }, { shotIndex: 3, enemyId: 7, template: "bot_a", missDistance: 0.9, verticalOffset: 0.4 });
  const k = ui.render.killerShots(r);
  assert.strictEqual(k.sum.hits, 1, "the head hit at tick 85 (enemy 7 was dead by then)");
  assert.strictEqual(k.sum.heads, 1);
  assert.strictEqual(k.sum.rings, 1, "the miss at tick 90 passed closest to the killer");
  assert.strictEqual(k.shared, 0);
  const kp = paneOf(ui.render.hitPanelHtml(r), "killer");
  assert.ok(kp.includes('class="aim-an-body"') && !kp.includes("aim-an-zero"));
  assert.ok(/data-zone="head"><span>Head<\/span><b>1<\/b>/.test(kp) && count(kp, '<g class="aim-an-ring">') === 1 && !kp.includes("aim-an-hit-sum"), "the head row, the near miss as a ring only");
});

// ---- picking a bot in the result screen's list (17 Nov 2026) ----
test("result screen: a selected row switches the first tab to that bot's report; it survives tab switches and re-renders; null goes back to the killer", async () => {
  const A = stub({ rounds: [killerRound()] });
  const { ui, document, window } = load({ analytics: A });
  const { overlay } = resultOverlay(document, true);
  ui.syncResult(); await settle();
  const html = () => overlay.querySelector(".aim-an-hit").innerHTML;
  assert.ok(html().includes("Killed by <b>bot_a</b>"));
  assert.ok(window.__aimHitPanel.selectEnemy(3, 20, "#2 Mid"));
  let kp = paneOf(html(), "killer");
  assert.ok(html().includes('aria-selected="true" tabindex="0">Selected bot</button>'), "first tab renamed");
  assert.ok(kp.includes('data-selected-enemy="3"') && kp.includes("Selected: <b>#2 Mid (bot_b)</b> · you killed it"));
  assert.ok(/data-zone="head"><span>Head<\/span><b>1<\/b>/.test(kp) && /data-zone="arms"><span>Arms<\/span><b>0<\/b>/.test(kp), "the head hit on bot_b, not the arm hit on the killer");
  assert.ok(!kp.includes("aim-an-hit-sum"), "no stat line");
  // tab switch and a re-render keep the selection, no new read
  const panel = overlay.querySelector(".aim-an-hit");
  panel.listeners.click[0]({ target: { closest: () => ({ dataset: { hitTab: "all" } }) } });
  panel.listeners.click[0]({ target: { closest: () => ({ dataset: { hitTab: "killer" } }) } });
  panel.remove(); ui.syncResult(); await settle();
  assert.ok(paneOf(html(), "killer").includes('data-selected-enemy="3"'));
  assert.strictEqual(A.calls.length, 1);
  window.__aimHitPanel.selectEnemy(null);
  assert.ok(html().includes("Killed by <b>bot_a</b>") && !html().includes("Selected bot"));
  // a new round's screen starts on the killer
  overlay.remove();
  const next = resultOverlay(document, true);
  ui.syncResult(); await settle();
  assert.ok(next.overlay.querySelector(".aim-an-hit").innerHTML.includes("Killed by <b>bot_a</b>"));
});
test("result screen: a selected row with no shots of yours shows the zero report; the tile maps to an enemy through its pre-aim point", () => {
  const { ui } = load({ analytics: stub() });
  const r = killerRound({ engagements: [...killerRound().engagements, { enemyId: 12, template: "bot_c", startTick: 55, killed: false, killTick: null }] });
  const e = ui.render.enemyShots(r, 12, 50);
  assert.strictEqual(e.sum.shots, 0);
  const kp = paneOf(ui.render.hitPanelHtml(r, "killer", { id: 12, bornTick: 50, label: "#4 B Long" }), "killer");
  assert.ok(kp.includes("Selected: <b>#4 B Long (bot_c)</b>") && kp.includes('<div class="aim-an-zero">') && kp.includes("No hits on this bot (0 shots landed)"));
  assert.ok(kp.includes('<svg class="aim-an-body"') && !kp.slice(kp.indexOf('<svg class="aim-an-body"'), kp.indexOf("</svg>", kp.indexOf('<svg class="aim-an-body"'))).includes("aim-an-dot"), "the figure, no markers");
  assert.ok(!kp.includes("data-stat=") && count(kp, "<b>0</b>") === 5 && kp.includes('<p class="aim-an-hit-note" data-zero>No hits on this bot (0 shots landed).'), "only the zone rows at 0, the line as a small note");
  // the killer selected by id gives the same shots as the killer tab
  assert.deepStrictEqual(ui.render.enemyShots(r, 7, 30).sum.zones, ui.render.killerShots(r).sum.zones);
  // tile -> point: data-n plus the game's view.points on the rendering component (actorId, bornTick)
  const tile = { dataset: { n: "2" }, __vueParentComponent: { props: { view: { points: [{ n: 1, actorId: 7, bornTick: 28, killer: true }, { n: 2, actorId: 3, bornTick: 18, place: "Mid" }] } }, parent: null } };
  assert.deepStrictEqual(ui.render.tilePoint(tile), { n: 2, actorId: 3, bornTick: 18, killer: false, label: "#2 Mid" });
  assert.strictEqual(ui.render.tilePoint({ dataset: { n: "2" } }, null), null, "nothing to map: null (the killer stays)");
  // production build: no __vueParentComponent; the points are found by walking the app's component tree
  const points = [{ n: 1, actorId: 7, bornTick: 28, killer: true }, { n: 2, actorId: 3, bornTick: 18, place: "Mid" }];
  const root = { props: {}, subTree: { children: [{ type: "div", children: "text" }, { component: { props: { other: 1 }, subTree: { children: [{ component: { props: { view: { points } }, subTree: null } }] } } }] } };
  assert.deepStrictEqual(ui.render.tilePoint({ dataset: { n: "1" } }, root), { n: 1, actorId: 7, bornTick: 28, killer: true, label: "#1" });
});

test("heatmap Both: a cell with deaths and fights is the death fill with a bright fight ring on top, no dark edge, no blend", async () => {
  const A = fightStub({ days: fightDays(), fightCells: { cells: {}, total: 0, withoutPosition: 0 } });
  const { ui, document } = load({ analytics: A });
  ui.open("heatmap"); await settle();
  layerClick(document, "both"); await settle();
  const html = content(document).innerHTML;
  // cell 1,2 has 6 deaths and 2 fights: its death fill, then its fight ring, nothing dark in between or on top
  const cell = html.slice(html.indexOf('<rect class="aim-an-cell" x="1" y="2"'));
  const death = cell.match(/^<rect class="aim-an-cell" x="1" y="2" width="1" height="1" fill="#ff4655" fill-opacity="([\d.]+)"/);
  assert.ok(death && +death[1] === 1, "the death fill is full colour");
  assert.ok(!html.includes("aim-an-fight-edge"), "no dark edge in Both");
  const ring = html.match(/<rect class="aim-an-fight is-outline" x="1" y="2" width="1" height="1" fill="none" stroke-opacity="([\d.]+)"/);
  assert.ok(ring && +ring[1] >= 0.7, "a bright, mostly opaque ring with no fill");
  const css = document.getElementById("aim-analytics-ui-css").textContent;
  assert.ok(!/mix-blend-mode|multiply/.test(css), "no blend mode");
  assert.ok(/\.aim-an-fight\.is-outline \{ fill: none; stroke: var\(--an-fight-hi\)/.test(css), "the ring is the light fight colour");
  // the single layers keep their own look
  layerClick(document, "fights"); await settle();
  assert.strictEqual(count(content(document).innerHTML, 'class="aim-an-fight-edge"'), 2);
});

test("coach text: a map name is a hoverable, focusable span with the map's gallery picture; the warning note is fine print, not the text", () => {
  const { ui } = load({ analytics: stub() });
  const f = { id: "wasted-swings:abc", title: "40% of your shots hit nothing near an enemy", severity: "tip", sample: 200,
    detail: "In ascent drill abc 80 of your 200 shots (40%) passed 20 degrees or more from any enemy. Shoot once the crosshair is on the enemy. (Shots you fire on purpose at nothing, to test recoil or to warm up, count too.)",
    evidence: { drill: "abc", map: "ascent", shots: 200, wastedShots: 80, wastedPercent: 40 } };
  const html = ui.render.coachModalHtml(f);
  const head = html.slice(html.indexOf("<header"), html.indexOf('<div class="es-tool-body aim-an-detail">'));
  assert.ok(head.length > 0 && !head.includes("Shots you fire on purpose") && !head.includes("aim-an-fine"), "the fine print is outside the summary");
  assert.ok(html.includes('In <span class="aim-an-mapref" tabindex="0" data-map="ascent" aria-label="Map ascent: show its picture">ascent</span> drill '), "map name span");
  const fine = html.match(/<p class="aim-an-fine">([^<]*)<\/p>/);
  assert.ok(fine && fine[1] === "Shots you fire on purpose at nothing, to test recoil or to warm up, count too.", "fine print line");
  assert.ok(html.lastIndexOf("aim-an-fine") > html.lastIndexOf("</dl>") && /<p class="aim-an-fine">[^<]*<\/p><\/div>$/.test(html), "the last line of the modal");
  assert.ok(!ui.render.coachHtml([f], false).includes("aim-an-fine"), "not on the card");
  assert.ok(load({ analytics: stub() }).document.getElementById("aim-analytics-ui-css").textContent.includes(".aim-an-detail .aim-an-fine { margin: 10px 0 0; color: var(--an-dim); font-size: 11px;"), "small and muted");
  assert.strictEqual(count(html, "Shots you fire on purpose"), 1, "only in the fine print");
  assert.ok(!html.includes("(Shots you fire"), "removed from the text");
  assert.deepStrictEqual(ui.render.splitNote("A. B (note here)"), { main: "A. B", note: "note here" });
  assert.strictEqual(ui.render.splitNote("No note.").note, "");
  const card = ui.render.mapCardHtml("ascent");
  assert.ok(card.includes('<img src="/aim-maps/ascent.cover.webp"') && card.includes("object-position:50% 30%") && card.includes("<b>ascent</b>"), "the gallery's picture and crop");
  const css = load({ analytics: stub() }).document.getElementById("aim-analytics-ui-css").textContent;
  assert.ok(css.includes(".aim-an-mapcard img { display: block; width: 260px; height: 140px; object-fit: cover; }"), "the gallery card's frame");
  assert.ok(!css.includes("@keyframes aim-an-open") && !css.includes("is-ghost"), "no open / close motion");
});

// ---- drill references in coach text (17 Nov 2026) ----
const CODE = "19c5ea5b0d2f4a61", CODE2 = "7a7a7a7a7a7a7a7a";
const workshopFetch = (calls = []) => async (url) => {
  calls.push(url);
  if (url === "/prod-api/api/v1/public/val/aimlab/workshop") return { ok: true, json: async () => ({ code: "00000", data: [{ shareCode: CODE, name: "Abyss — A Main, pre-aim", mapId: "infinity", type: "aim" }, { shareCode: "ffffffffffffffff", name: "Other" }] }) };
  return { ok: false };
};
const drillFinding = () => ({ id: "wasted-swings:" + CODE, title: "40% of your shots hit nothing near an enemy", severity: "tip", sample: 200,
  detail: `In ascent drill ${CODE} 80 of your 200 shots passed far from any enemy. Shoot once the crosshair is on the enemy.`, evidence: { drill: CODE, map: "ascent", shots: 200, wastedPercent: 40 } });
test("drill references: a drill code in coach text is a span with the drill's title (from the gallery's drill list), never the code; an unknown code shows its short code; map spans are unchanged", async () => {
  const calls = [];
  const { ui } = load({ analytics: stub(), fetchImpl: workshopFetch(calls) });
  await ui.loadDrills(); await ui.loadDrills();
  assert.deepStrictEqual(calls, ["/prod-api/api/v1/public/val/aimlab/workshop"], "the list is read once");
  const html = ui.render.coachModalHtml(drillFinding());
  const span = `<span class="aim-an-mapref aim-an-drillref" tabindex="0" role="link" data-drill="${CODE}" data-drill-map="ascent" aria-label="Drill Abyss — A Main, pre-aim: show its card; click or Enter plays it">Abyss — A Main, pre-aim</span>`;
  assert.ok(html.includes(`In <span class="aim-an-mapref" tabindex="0" data-map="ascent" aria-label="Map ascent: show its picture">ascent</span> drill ${span} 80 of`), "map span and drill span in the text");
  assert.ok(html.includes(`<dt>drill</dt><dd>${span}</dd>`), "the Numbers list names the drill by its title too");
  assert.strictEqual(html.split(CODE).length - 1, 2, "the code is only in data-drill attributes, never shown");
  // the card's text gets the same span; the card visual's labels and titles use the title too
  const card = ui.render.coachHtml([{ ...drillFinding(), evidence: { drill: CODE, map: "ascent", shots: 200 } }], false);
  assert.ok(card.includes(`>Abyss — A Main, pre-aim</span> 80 of`) && !card.includes(">" + CODE));
  const strafe = { id: "strafe-drill", title: "You strafe-kill much more on one drill", severity: "info", sample: 50,
    detail: `60% of your kills on drill ${CODE} (30 of 50) come while strafing, against 20% on drill ${CODE2} (4 of 20). On drill ${CODE2} you mostly stand still.`,
    evidence: { drill: CODE, strafePercent: 60, otherGroup: CODE2, otherStrafePercent: 20 } };
  const s = ui.render.coachModalHtml(strafe);
  assert.ok(s.includes(`data-drill="${CODE2}"`) && s.includes(`>7a7a7a7</span>`), "an unknown drill: its short code as the label");
  assert.ok(!s.replace(/data-drill="[^"]+"/g, "").includes(CODE2), "never the long code as text");
  assert.ok(ui.render.coachVisual(strafe).includes("<span>7a7a7a7 strafe</span>"), "bar labels too");
  // the reference spans of one component
  assert.strictEqual(ui.render.refHtml("map", "bind"), '<span class="aim-an-mapref" tabindex="0" data-map="bind" aria-label="Map bind: show its picture">bind</span>');
  assert.deepStrictEqual(ui.render.refsOf(strafe, strafe.detail), { maps: [], drills: [CODE, CODE2] });
});
test("drill references: hover or focus shows the drill card (title, map, mode, the map's gallery picture); a click or Enter starts the drill through the lobby card's Start button; a map name stays hover-only", async () => {
  const { ui, document } = load({ analytics: stub(), fetchImpl: workshopFetch(), coach: { insights: async () => [drillFinding()] } });
  ui.open("coach"); await settle(10);
  const view = content(document);
  const spanOf = (dataset) => ({ dataset, getBoundingClientRect: () => ({ left: 10, top: 10, bottom: 20 }), contains: () => false });
  const at = (el) => ({ target: { closest: (sel) => (sel === "[data-drill]" ? (el.dataset.drill ? el : null) : sel === "[data-map]" ? (el.dataset.map ? el : null) : null) }, preventDefault() {}, key: "Enter" });
  const card = () => document.body.children.find((c) => c.className === "aim-an-mapcard");
  const drill = spanOf({ drill: CODE, drillMap: "ascent" });
  view.listeners.mouseover[0](at(drill));
  assert.ok(card() && card().hidden === false, "hover shows the card");
  const ch = card().innerHTML;
  assert.ok(ch.includes("<b>Abyss — A Main, pre-aim</b>") && ch.includes("Map infinity · Mode aim") && ch.includes('<img src="/aim-maps/infinity.cover.webp" alt="" style="object-position:50% 30%"'), "title, map, mode, picture: " + ch);
  view.listeners.focusout[0](at(drill));
  assert.strictEqual(card().hidden, true);
  view.listeners.focusin[0](at(drill));
  assert.strictEqual(card().hidden, false, "keyboard focus shows it");
  // a map name: the map card, hover only (a click toggles the card, starts nothing)
  const map = spanOf({ map: "ascent" });
  view.listeners.mouseover[0](at(map));
  assert.ok(card().innerHTML.includes("<b>ascent</b>") && card().dataset.ref === "map:ascent");
  // the lobby start path, mocked: the first top tab, then the drill's lobby card and its Start button
  const log = [];
  const go = { click: () => log.push("go") };
  const lobbyCard = { querySelector: (sel) => (sel === ".al-wk-split-go, .al-wk-go" ? go : null), scrollIntoView: () => log.push("scroll") };
  const tab = { classList: { contains: () => false }, click: () => log.push("tab") };
  document.querySelector = (sel) => (sel === ".hall-tab" ? tab : sel === `[data-role="workshop-card"][data-share-code="${CODE}"]` ? lobbyCard : null);
  view.listeners.click[0](at(map)); await settle();
  assert.deepStrictEqual(log, [], "a map click starts nothing");
  view.listeners.click[0](at(drill)); await settle();
  assert.deepStrictEqual(log, ["tab", "scroll", "go"], "click: training tab, the drill's card, its Start button");
  assert.strictEqual(document.body.querySelector(".aim-an-shade"), null, "the Stats dialog closed");
  // Enter on the span in the tip modal does the same
  ui.open("coach"); await settle(10); log.length = 0;
  content(document).listeners.click[0]({ target: { closest: (sel) => (sel === "[data-coach]" ? { dataset: { coach: "0" }, focus() {} } : null) } });
  const shade = tipShade(document);
  assert.ok(shade.children[0].innerHTML.includes(`data-drill="${CODE}"`), "the span in the modal");
  shade.listeners.keydown[0]({ ...at(drill), stopPropagation() {} }); await settle();
  assert.deepStrictEqual(log, ["tab", "scroll", "go"], "Enter in the modal starts it");
  assert.strictEqual(tipShade(document), null, "the modal closed");
  assert.strictEqual(await ui.startDrill("not a code!"), false, "a bad code starts nothing");
});

test("selected bot: a bot you hit shows its hits (matched like the killer tab), and the killer's own row agrees with the killer tab", () => {
  const { ui } = load({ analytics: stub() });
  // three bot_a lives in a fight with you at once (a typical drill): 4 died at tick 70, 5 at 95, 6 killed you at 120
  const r = { ...diedRound([
    shot({ tick: 60, part: "body", target: "bot_a" }), shot({ tick: 70, part: "head", target: "bot_a", killed: true }),
    shot({ tick: 80, part: "legs", target: "bot_a" }), shot({ tick: 90, part: "body", target: "bot_a" }), shot({ tick: 95, part: "head", target: "bot_a", killed: true }),
    shot({ tick: 110, part: "body", target: "bot_a" }),
  ]), nearMisses: [], engagements: [
    { enemyId: 4, template: "bot_a", startTick: 50, killed: true, killTick: 70 },
    { enemyId: 5, template: "bot_a", startTick: 52, killed: true, killTick: 95 },
    { enemyId: 6, template: "bot_a", startTick: 54, killed: false, killTick: null },
  ], deaths: [{ tick: 120, killerId: 6, killer: "bot_a", killerDistance: 9, cause: "shot", nearMisses: [] }] };
  const five = ui.render.enemyShots(r, 5, 40);
  assert.strictEqual(five.sum.hits, 3, "the hits at 80, 90 and the kill at 95");
  assert.strictEqual(five.sum.heads, 1);
  assert.strictEqual(five.shared, 2, "two of them matched by type only");
  const kp = paneOf(ui.render.hitPanelHtml(r, "killer", { id: 5, bornTick: 40, label: "#2 Mid" }), "killer");
  assert.ok(!kp.includes("aim-an-zero") && !kp.includes("No bullets hit"), "not the zero report");
  assert.ok(/data-zone="head"><span>Head<\/span><b>1<\/b>/.test(kp) && kp.includes('data-type-only="2"') && kp.includes("2 hits are matched by enemy type only"));
  assert.strictEqual(ui.render.enemyShots(r, 4, 40).sum.hits, 2, "bot 4: the hits at 60 and its kill at 70");
  // the killer: only the hit at 110 (4 and 5 were dead by then), and its row matches the killer tab
  const k = ui.render.killerShots(r);
  assert.strictEqual(k.sum.hits, 1);
  const six = ui.render.enemyShots(r, 6, 40);
  assert.deepStrictEqual(six.sum.zones, k.sum.zones); assert.strictEqual(six.sum.hits, k.sum.hits); assert.strictEqual(six.shared, k.shared);
});

// ---- Stats panel fixes (17 Nov 2026): stable height, whole-card button, short summaries, rule icons, FLIP open / close ----
const COACH_SRC = fs.readFileSync(path.join(__dirname, "..", "app", "coach.js"), "utf-8");
const loadCoachJs = (analytics) => { const win = { __aimAnalytics: analytics }; new Function("window", COACH_SRC)(win); return win.__aimCoach; };
// Every rule id coach.js can return, read from its source: id: "x" / id: "x:" + key, strafeBy(..., "id", ...), make("id", ...),
// and the round tip's "round-tip-" + metric id.
function coachRuleIds() {
  const out = new Set();
  for (const m of COACH_SRC.matchAll(/\bid: "([a-z][a-z-]*?)(?::)?"/g)) if (!m[1].endsWith("-")) out.add(m[1]);
  for (const m of COACH_SRC.matchAll(/strafeBy\(ctx, "\w+", "([a-z-]+)"/g)) out.add(m[1]);
  for (const m of COACH_SRC.matchAll(/make\("([a-z-]+)"/g)) out.add(m[1]);
  const metrics = (COACH_SRC.match(/const ROUND_TIP_METRICS = \[[\s\S]*?\n  \];/) || [""])[0];
  for (const m of metrics.matchAll(/\bid: "([a-z]+)"/g)) { out.delete(m[1]); out.add("round-tip-" + m[1]); }
  return [...out].sort();
}
// A title and evidence per rule, shaped like the rule's own output.
const FIXTURE = {
  "miss-side": ["You miss high", { sharePercent: 72, side: "above", averageOffsetCm: 14 }],
  "kill-style": ["Almost all your kills are flicks", { sharePercent: 85, dominant: "flick" }],
  "pre-aim-low": ["Your crosshair is often far below head height", { farBelowPercent: 40 }],
  "pre-aim": ["Your crosshair is too low at first sight", { averagePitchErrorDegrees: 3.2, side: "below" }],
  "kill-time": ["You kill in about 0.82 s", { medianSeconds: 0.82, kills: 40 }],
  "kill-time-trend": ["You are getting faster at kills", { previousSeconds: 0.9, recentSeconds: 0.7 }],
  "death-zone": ["You keep dying in one spot on ascent", { deathsInCell: 9, deathsOnMap: 30, map: "ascent" }],
  "deaths-cause": ["Many of your deaths are falls", { fallPercent: 35 }],
  "deaths-unanswered": ["You often die without firing back", { sharePercent: 55 }],
  "multi-enemy": ["You die when more than one enemy shows up", { killPercent: 20, deathPercent: 60 }],
  "fights-lost": ["Enemies shoot you first in 62% of fights", { lostPercent: 62, fightsLost: 31, fights: 50 }],
  "fight-spot": ["Fights lost from one spot", { lostPercent: 80, restLostPercent: 40 }],
  "angle-lose": ["You lose most fights from the -z direction", { lostPercent: 75, fights: 12 }],
  "angle-win": ["You win most fights from the +x direction", { winPercent: 80, fights: 10 }],
  "hold-sooner": ["Hold or move sooner", { lostAverageSeconds: 2.1, wonAverageSeconds: 0.8 }],
  "clear-deaths": ["Most of your deaths came from angles you never checked", { uncheckedPercent: 70 }],
  "over-checked": ["You look at the -x direction a lot, and nothing has ever come from there", { roundsLookedAt: 12 }],
  "wasted-swings": ["35% of your shots hit nothing near an enemy", { wastedPercent: 35 }],
  "headshot-weapon": ["You get more headshots with the vandal", { bestHeadshotPercent: 38, worstHeadshotPercent: 12 }],
  "accuracy-weapon": ["Your sheriff is your weakest weapon", { worstAccuracyPercent: 18, bestAccuracyPercent: 34 }],
  "strafe-map": ["You strafe-kill much more on one map", { strafePercent: 60, otherStrafePercent: 20 }],
  "strafe-drill": ["You strafe-kill much more on one drill", { strafePercent: 55, otherStrafePercent: 15 }],
  "burst-length": ["Long bursts cost you accuracy", { longAccuracyPercent: 18, shortAccuracyPercent: 34 }],
  "spray-control": ["Your spray climbs off the target after 3 shots", { bulletDriftDeg: 2.79, lateFromShot: 4 }],
  "accuracy-range": ["Your weakest range is long range (over 25 m)", { weakestAccuracyPercent: 22, bestAccuracyPercent: 41 }],
  "miss-side-sideways": ["You miss to the left", { sharePercent: 68, side: "left", averageOffsetCm: 11 }],
  "counter-strafe": ["You shoot while moving, and it costs you", { movingAccuracyPercent: 22, stillAccuracyPercent: 41 }],
  "walk-accuracy": ["Walking is more accurate than running for you", { walkAccuracyPercent: 38, runAccuracyPercent: 24 }],
  "crouch-accuracy": ["You shoot better crouched", { crouchedAccuracyPercent: 40, standingAccuracyPercent: 30 }],
  "sens-changed": ["You changed your sensitivity", { sensitivity: 0.5, usualSensitivity: 0.4 }],
  "sens-extreme": ["Your sensitivity is very high", { medianSensitivity: 2.4 }],
  "mouse-accel": ["Your mouse may be accelerated", { sharePercent: 80 }],
  "consistency": ["Your aim is streaky", { spreadPoints: 12 }],
  "warmup": ["You start sessions cold", { firstRoundsAccuracyPercent: 28, middleAccuracyPercent: 36 }],
  "fade": ["Your aim fades late in a session", { lastRoundsAccuracyPercent: 26, middleAccuracyPercent: 35 }],
  "tracking": ["Your crosshair trails moving enemies", { bodyOnPercent: 41, lagDegrees: 2.3 }],
  "tracking-lock": ["You take a while to lock on", { medianLockSeconds: 0.62 }],
  "trend-accuracy": ["Your accuracy is dropping", { previousPercent: 34, recentPercent: 28 }],
  "trend-headshots": ["Your headshot rate is improving", { previousPercent: 15, recentPercent: 22 }],
  "round-tip-accuracy": ["Your accuracy dropped this round", { thisRound: 0.21, baselineMean: 0.33 }],
  "round-tip-headshot": ["Fewer headshots this round", { thisRound: 0.1, baselineMean: 0.25 }],
  "round-tip-side": ["Your shots drifted left this round", { thisRound: -0.12, baselineMean: -0.02 }],
  "round-tip-vertical": ["Your shots went high this round", { thisRound: 0.15, baselineMean: 0.04 }],
};
// ---- tracking (18 Nov 2026) ----
const trackRow = (o = {}) => ({ day: "2026-11-17", weapon: "vandal", sight: true, ...o, tracking: { samples: 100, seconds: 0.78, bodyOn: 60, headOn: 20, bodyErrorSum: 300, headErrorSum: 500, lagSum: 0, jitterSum: 40, jitterPairs: 90,
  lockBodySeconds: 0.2, lockHeadSeconds: null, enemySpeedSum: 4000, ...(o.tracking || {}) } });
test("tracking tab: body and head are two views of the same fights; the numbers are weighted by sampled ticks", () => {
  const { ui } = load({ analytics: stub() });
  const rows = [trackRow(), trackRow({ weapon: "sheriff", day: "2026-11-18", tracking: { samples: 300, bodyOn: 270, headOn: 30, bodyErrorSum: 600, lockBodySeconds: 0.1 } })];
  const body = ui.render.trackingTotals(rows, "body"), head = ui.render.trackingTotals(rows, "head");
  assert.strictEqual(body.onPercent, Math.round((330 / 400) * 100));
  assert.strictEqual(head.onPercent, Math.round((50 / 400) * 100));
  assert.ok(Math.abs(body.errorDeg - 900 / 400) < 1e-9);
  assert.ok(Math.abs(body.lockSeconds - 0.15) < 1e-9, "median of the two lock times");
  assert.strictEqual(head.lockSeconds, null, "never on the head");
  assert.strictEqual(head.neverLocked, 2);
  const html = ui.render.trackingHtml(rows, "body"), headHtml = ui.render.trackingHtml(rows, "head");
  assert.ok(html.includes('data-track="body" aria-pressed="true"') && headHtml.includes('data-track="head" aria-pressed="true"'));
  assert.ok(html.includes("by weapon") && html.includes("by day"));
  assert.ok(html.includes("Time to lock") && html.includes("Lag") && html.includes("Smoothness") && html.includes("On the body"));
  assert.ok(headHtml.includes("On the head"));
});
test("tracking tab: no data gives a plain message; lag says behind or ahead", () => {
  const { ui } = load({ analytics: stub() });
  assert.ok(ui.render.trackingHtml([], "body").includes("No tracking recorded yet"));
  assert.ok(ui.render.trackingHtml([{ weapon: "vandal" }], "body").includes("No tracking recorded yet"), "a row without a tracking entry is ignored");
  assert.ok(ui.render.trackingHtml([trackRow({ tracking: { lagSum: 250 } })], "body").includes("2.5° behind"));
  assert.ok(ui.render.trackingHtml([trackRow({ tracking: { lagSum: -250 } })], "body").includes("2.5° ahead"));
});
test("tracking tab: opens from the tab bar, the Head button switches the view", async () => {
  const A = stub({ engagements: Array.from({ length: 3 }, () => trackRow()) });
  const { ui, document } = load({ analytics: A });
  const host = document.createElement("div"); document.body.appendChild(host);
  ui.mountInline(host, "tracking"); await settle();
  const view = host.querySelector(".aim-an-content");
  assert.ok(view.innerHTML.includes("On the body"), view.innerHTML.slice(0, 200));
});

test("result screen: a one-line tracking readout under the hit report (both tabs, died and cleared), only when the round has moving-enemy data", () => {
  const { ui } = load({ analytics: stub() });
  const withTracking = (round, rows) => ({ ...round, sight: true, engagements: rows });
  const base = diedRound([shot({ part: "head" }), shot()]);
  assert.ok(!ui.render.hitPanelHtml(base).includes("data-hit-track"), "no engagements, no readout");
  assert.ok(!ui.render.hitPanelHtml(withTracking(base, [{ weapon: "vandal" }])).includes("data-hit-track"), "an engagement without tracking, no readout");
  const row = (o = {}) => trackRow(o);
  const round = withTracking(base, [row(), row({ tracking: { lagSum: 250 } })]);
  const died = ui.render.hitPanelHtml(round), cleared = ui.render.hitPanelHtml({ ...round, end: "cleared" }, "killer", null, false);
  for (const html of [died, cleared]) {
    assert.strictEqual(count(html, "data-hit-track"), 1, "one readout");
    assert.ok(html.includes("On body <b>60%</b>") && html.includes("On head <b>20%</b>") && html.includes("Lock <b>0.2 s</b>") && html.includes("1.3° behind"), html.slice(-400));
    assert.ok(html.indexOf("data-hit-track") > html.lastIndexOf("data-hit-pane"), "under the panes, not inside one");
  }
  assert.strictEqual(ui.render.hitPanelHtml(round, "all").includes("data-hit-track"), true, "also on the second tab");
  assert.ok(!died.includes("damage") && !died.includes("Near misses"), "still no other stat rows");
});
// ---- sphere targets (18 Nov 2026) ----
const ball = (o = {}) => shot({ part: "body", target: "orb", targetShape: "sphere", nearestEnemy: { range: 12, centreDistance: 0.1, side: 0, vertical: 0 }, ...o });
const ballMiss = (side, vertical) => shot({ nearestEnemy: { range: 12, centreDistance: Math.hypot(side, vertical), side, vertical } });
test("sphere targets: the report draws a circle with Centre / Top / Right / Bottom / Left, every row shown, near misses as rings outside", () => {
  const { ui } = load({ analytics: stub() });
  const round = { ...diedRound([ball(), ball({ nearestEnemy: { range: 12, centreDistance: 0.3, side: 0.3, vertical: 0.05 } }), ball({ nearestEnemy: { range: 12, centreDistance: 0.3, side: 0, vertical: 0.3 } }),
    ballMiss(0.5, 0.1), ballMiss(0.1, -0.5), ballMiss(3, 3)]), targetShapes: { orb: "sphere" }, targetRadii: { orb: 0.36 } };
  const sum = ui.render.hitSummary(round);
  assert.strictEqual(sum.shape, "sphere");
  assert.deepStrictEqual(sum.zones, { centre: 1, top: 1, right: 1, bottom: 0, left: 0 });
  assert.strictEqual(sum.hits, 3); assert.strictEqual(sum.rings, 2, "the far miss is not drawn"); assert.strictEqual(sum.radius, 0.36);
  const html = ui.render.hitPanelHtml(round, "all", null);
  const all = paneOf(html, "all");
  assert.ok(all.includes("aim-an-sphere") && !all.includes("is-head") && !all.includes("Headshot") && !all.includes(">Chest<"), "a circle, no body parts");
  const rows = [...all.matchAll(/data-zone="(\w+)"><span>([^<]+)<\/span><b>(\d+)/g)].map((m) => [m[1], m[2], +m[3]]);
  assert.deepStrictEqual(rows, [["centre", "Centre", 1], ["top", "Top", 1], ["right", "Right", 1], ["bottom", "Bottom", 0], ["left", "Left", 0]]);
  assert.strictEqual(count(all, "aim-an-ring-line"), 2 + 1, "two rings on the figure and the one in the key");
  assert.ok(all.includes("is-top is-hit") && all.includes("is-right is-hit") && !all.includes("is-bottom is-hit"));
});
test("sphere targets: a round with only misses still gets the circle; humanoid rounds are unchanged; the radius falls back to the farthest hit", () => {
  const { ui } = load({ analytics: stub() });
  const onlyMiss = { ...diedRound([ballMiss(0.5, 0)]), targetShapes: { orb: "sphere" }, targetRadii: { orb: 0.4 } };
  assert.strictEqual(ui.render.hitSummary(onlyMiss).shape, "sphere");
  assert.strictEqual(ui.render.hitSummary(diedRound([ballMiss(0.5, 0)])).shape, "humanoid", "no shape information: the body, as before");
  assert.strictEqual(ui.render.hitSummary({ ...onlyMiss, targetShapes: { orb: "humanoid" } }).shape, "humanoid");
  const noRadius = ui.render.hitSummary(diedRound([ball({ nearestEnemy: { range: 9, centreDistance: 0.42, side: 0.42, vertical: 0 } })]));
  assert.strictEqual(noRadius.shape, "sphere"); assert.strictEqual(noRadius.radius, 0.42);
  assert.strictEqual(ui.render.hitSummary(diedRound([ball({ nearestEnemy: undefined })])).radius, 0.36, "default radius");
  // the zero report of a sphere round keeps the circle
  const zero = ui.render.hitPanelHtml({ ...onlyMiss, shots: [] }, "all", null);
  assert.ok(zero.includes("aim-an-sphere") && zero.includes('data-zone="centre"'));
  // a mixed round shows the shape most hits were on
  const mixed = ui.render.hitSummary(diedRound([ball(), ball(), shot({ part: "body", targetShape: "humanoid", target: "bot" })]));
  assert.strictEqual(mixed.shape, "sphere");
});
test("sight: kill times, flick and strafe counts and tracking leave out rounds recorded before line-of-sight data", () => {
  const { ui } = load({ analytics: stub() });
  const oldRows = [trackRow({ sight: false })], newRows = [trackRow()];
  assert.ok(ui.render.trackingHtml(oldRows, "body").includes("No tracking recorded yet"), "an old round gives no tracking numbers");
  assert.ok(ui.render.trackingHtml(newRows, "body").includes("On the body"));
  const base = diedRound([shot({ part: "head" }), shot()]);
  const eRow = trackRow().tracking;
  assert.ok(!ui.render.hitPanelHtml({ ...base, sight: false, engagements: [{ tracking: eRow }] }).includes("data-hit-track"), "no readout for an old round");
  assert.ok(ui.render.hitPanelHtml({ ...base, sight: true, engagements: [{ tracking: eRow }] }).includes("data-hit-track"));
  const series = ui.render.progressSeries([], [{ day: dayN(1), killed: true, sight: false, timeToKill: 9, visibleTimeToKill: null }, { day: dayN(1), killed: true, sight: true, timeToKill: 3, visibleTimeToKill: 0.8 }], 7);
  assert.deepStrictEqual(series.killTime.map((p) => p.value), [0.8], "only the sighted kill, and its visible time");
});
test("every coach rule id has an icon and a short summary (ids read from coach.js insights() and roundTip())", () => {
  const ids = coachRuleIds();
  assert.ok(ids.length >= 39 && ids.includes("wasted-swings") && ids.includes("strafe-drill") && ids.includes("trend-headshots") && ids.includes("round-tip-vertical"), ids.join(","));
  const C = loadCoachJs(undefined), { ui } = load({ analytics: stub() });
  for (const id of ids) {
    assert.ok(C.summaryIds.includes(id), id + ": no summary builder in coach.js");
    assert.ok(ui.coachIconIds.includes(id), id + ": no icon");
    assert.ok(ui.render.coachIcon(id + ":ascent").includes(`data-icon="${id}"`), id + ": icon by the id with its key");
    assert.ok(FIXTURE[id], id + ": no fixture in this test");
  }
  assert.deepStrictEqual([...C.summaryIds].sort(), ids, "no builder for an id the coach never returns");
  assert.deepStrictEqual([...ui.coachIconIds].sort(), ids, "no icon for an id the coach never returns");
  const fb = ui.render.coachIcon("something-new");
  assert.ok(fb.includes('data-icon="fallback"') && fb.includes("<circle"), "fallback icon");
  // self-drawn, monochrome: stroked in currentColor (CSS), no colour, no image, no external reference
  for (const id of ids) { const svg = ui.render.coachIcon(id); assert.ok(!/#[0-9a-f]{3,6}|url\(|<image|href=|<text/i.test(svg), id + ": plain line glyph"); }
  const css = load({ analytics: stub() }).document.getElementById("aim-analytics-ui-css").textContent;
  assert.ok(css.includes(".aim-an-icon svg { display: block; width: 100%; height: 100%; fill: none; stroke: currentColor;") && css.includes("color: var(--an-red-2); }"), "theme colour");
});
test("short summaries: one per rule with the key number, never the title; the card shows it, the detail keeps the full text", () => {
  const C = loadCoachJs(undefined), { ui } = load({ analytics: stub() });
  for (const [id, [title, evidence]] of Object.entries(FIXTURE)) {
    const line = C.summaryOf({ id: id + (id === "death-zone" ? ":ascent" : ""), title, evidence });
    assert.ok(line && line.length <= 44, `${id}: "${line}" (short)`);
    assert.notStrictEqual(line.toLowerCase(), title.toLowerCase(), id + ": not the title");
    assert.ok(!title.toLowerCase().includes(line.toLowerCase()), id + ": not a piece of the title");
    assert.ok(/\d/.test(line), `${id}: "${line}" states a number`);
  }
  assert.strictEqual(C.summaryOf({ id: "wasted-swings:abc", title: "35% of your shots hit nothing near an enemy", evidence: { wastedPercent: 35 } }), "1 in 3 shots hits nothing");
  assert.strictEqual(C.summaryOf({ id: "kill-time", title: "x", evidence: {} }), "", "no number: no line");
  // the card: the summary, not the title again; a summary equal to the title is dropped
  const f = { id: "wasted-swings:abc", title: "35% of your shots hit nothing near an enemy", summary: "35% wasted", detail: "In ascent 70 of your 200 shots (35%) passed far from any enemy.", severity: "tip", sample: 200, evidence: { wastedPercent: 35, map: "ascent" } };
  const html = ui.render.coachHtml([f], false, null);
  assert.ok(html.includes('<span class="aim-an-main">35% wasted</span>') && count(html, "35% of your shots hit nothing") === 1);
  assert.ok(ui.render.coachHtml([{ ...f, summary: f.title, evidence: {} }], false, null).includes('<span class="aim-an-main"></span>'), "never a copy of the title (the empty line keeps its place)");
  assert.strictEqual(ui.render.cardSummary({ id: "kill-time", title: "You kill in about 0.6 s", evidence: { medianSeconds: 0.6 } }), "0.6 s median", "older findings: the main number");
  assert.ok(html.includes('<p class="aim-an-card-text">') && html.includes("passed far from any enemy"), "no visual: the text on the card, clamped");
  assert.ok(ui.render.coachModalHtml(f).includes('<p class="aim-an-lead">In <span class="aim-an-mapref"'), "the full detail in the modal");
});
test("coach.js attaches the summary to what insights() and roundTip() return", async () => {
  const C0 = loadCoachJs(undefined), T = C0.thresholds;
  const n = Math.max(T.CAUSE_MIN, 2 * T.FALL_MIN, 10);
  const deaths = Array.from({ length: n }, (_, i) => ({ cause: i % 2 ? "fell" : "shot", tick: i }));
  const rounds = [{ id: "r1", day: dayN(0), at: Date.now(), code: "a", map: "bind", shots: [], deaths, engagements: [], nearMisses: [] }];
  const C = loadCoachJs({ rounds: async () => rounds, days: async () => [] });
  const list = await C.insights({});
  const dc = list.find((x) => x.id === "deaths-cause");
  assert.ok(dc && dc.summary === "50% of deaths were falls" && dc.summary !== dc.title, JSON.stringify(dc && dc.summary));
  assert.ok(list.every((x) => typeof x.summary === "string"));
  const base = Array.from({ length: 8 }, (_, i) => ({ id: "b" + i, code: "a", map: "bind", at: i, shots: Array.from({ length: 20 }, (_, k) => ({ part: k < 8 + (i % 2) ? "body" : null })), nearMisses: [] }));
  const tip = await C.roundTip({ id: "now", code: "a", map: "bind", at: 99, shots: Array.from({ length: 20 }, (_, k) => ({ part: k < 1 ? "body" : null })), nearMisses: [] }, { baseline: base });
  assert.ok(tip && tip.id === "round-tip-accuracy" && /^5% vs 4\d% usual$/.test(tip.summary), JSON.stringify(tip && tip.summary));
});
test("a coach card is a focusable article with the same parts in the same order (icon, heading, summary, visual or text, Numbers button); the card and its button are its only tab stops; map spans are in the modal", () => {
  const { ui, document } = load({ analytics: stub() });
  const html = ui.render.coachHtml(coachList(), false);
  const lis = [...html.matchAll(/<li [^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.strictEqual(lis.length, 3);
  lis.forEach((inner, i) => {
    assert.ok(/^<article class="aim-an-card" tabindex="0" data-coach="(\d)" aria-haspopup="dialog" aria-labelledby="([^"]+)"><span class="aim-an-icon"><svg[\s\S]*?<\/svg><\/span><h4 id="\2">[^<]+<\/h4><span class="aim-an-main">[^<]*<\/span>(<div class="aim-an-card-vis" aria-hidden="true">[\s\S]*<\/div>|<p class="aim-an-card-text">[^]*?<\/p>)<button type="button" class="aim-an-numbers" data-coach="\1" aria-haspopup="dialog" aria-describedby="\2">Numbers<\/button><\/article>$/.test(inner), "fixed parts in a fixed order: " + i);
    assert.ok(inner.includes(`data-coach="${i}"`), "the card and its button name its finding");
    assert.strictEqual(count(inner, "<button"), 1, "one button");
    assert.strictEqual(count(inner, "tabindex"), 1, "the card is the one other tab stop");
  });
  const f = { id: "wasted-swings:abc", title: "35% of your shots hit nothing near an enemy", summary: "35% wasted", detail: "In ascent drill abc 70 of your 200 shots passed far from any enemy. Shoot once the crosshair is on the enemy.", severity: "tip", sample: 200, evidence: { wastedPercent: 35, map: "ascent" } };
  const one = ui.render.coachModalHtml(f);
  assert.ok(one.includes('<p class="aim-an-lead">In <span class="aim-an-mapref" tabindex="0" data-map="ascent"'), "map hover span in the modal text");
  assert.ok(one.includes('<p class="aim-an-advice">Shoot once the crosshair is on the enemy.</p>') && one.includes('<dt>map</dt><dd><span class="aim-an-mapref" tabindex="0" data-map="ascent"'));
  assert.ok(one.includes('<button type="button" class="es-tool-x" data-tipm-close aria-label="Close">'), "a close button");
  const css = document.getElementById("aim-analytics-ui-css").textContent;
  assert.ok(/\.aim-an-card h4 \{ grid-column: 2; grid-row: 1;/.test(css) && /\.aim-an-card > \.aim-an-icon \{ grid-column: 1; grid-row: 1;/.test(css) && /\.aim-an-card > \.aim-an-main \{ grid-column: 2; grid-row: 2;/.test(css), "icon, title and summary in fixed cells");
  assert.ok(/\.aim-an-card \.aim-an-numbers \{ grid-column: 1 \/ -1; grid-row: 4;/.test(css), "the button in the last row");
  assert.ok(!css.includes("button.aim-an-card") && /\.aim-an-coach \.aim-an-card:hover \{/.test(css), "the card is not a button element, and shows it can be clicked");
});
test("tab switch keeps the outer panel height: one fixed view area for every tab, the tab bar and the panel are not touched", async () => {
  const { ui, document } = load({ analytics: stub({ days: [dayRow(0)] }), coach: { insights: async () => coachList() } });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const p = ui.mountInline(host); await settle();
  const root = host.children[0], tabs = root.querySelector(".aim-an-tabs"), view = root.querySelector(".aim-an-content");
  const snap = () => JSON.stringify([root.className, root.attrs, root.style || null, view.className, view.attrs, view.style || null, root.children.length, tabs.parentElement === view.parentElement]);
  const first = snap();
  view.scrollTop = 300;
  for (const i of [2, 6, 0, 1, 3, 4, 6]) {
    tabs.children[i].listeners.click[0](); await settle();
    assert.strictEqual(snap(), first, "the panel and the view box are the same after each switch");
    assert.strictEqual(root.querySelector(".aim-an-content"), view, "same view box");
    assert.strictEqual(view.scrollTop, 0, "a new tab starts at its top");
  }
  assert.ok(view.innerHTML.includes("aim-an-coach"));
  const css = document.getElementById("aim-analytics-ui-css").textContent;
  const rule = (css.match(/\.es-tool\.aim-an-panel \.aim-an-content \{[^}]*\}/) || [""])[0];
  assert.ok(/height: var\(--an-view-h\)/.test(rule) && /--an-view-h: clamp\(460px, calc\(100vh - 240px\), 860px\)/.test(rule) && /overflow-y: auto/.test(rule) && /scrollbar-gutter: stable/.test(rule), "a fixed height that scrolls inside: " + rule);
  assert.ok(!/min-height/.test(rule), "a fixed height, not a minimum that a taller tab could pass");
  assert.ok(css.includes("--an-view-h: clamp(360px, calc(100vh - 200px), 860px)"), "phone width");
  assert.ok(!/\.aim-an-tabs[^{]*\{[^}]*position: (sticky|fixed|absolute)/.test(css), "the tab bar stays put in the flow above the view box");
  void p;
});
test("hit report: ONE list of the five zones, every row shown even at 0; no Hits / Head / Near misses / Other misses / Damage rows; the figure always stays", () => {
  const { ui } = load({ analytics: stub() });
  const rows = (html) => [...html.matchAll(/<li class="is-(?:hit|zero)" data-zone="\w+"><span>([^<]+)<\/span><b>(\d+)<\/b><\/li>/g)].map((m) => m[1] + " " + m[2]);
  // all shots missed, none near: five rows at 0, the figure, a small note
  const ap = paneOf(ui.render.hitPanelHtml(diedRound([shot(), shot(), shot()]), "all"), "all");
  assert.deepStrictEqual(rows(ap), ["Head 0", "Chest 0", "Arms 0", "Torso 0", "Legs 0"]);
  assert.strictEqual(count(ap, "<ul class=\"aim-an-zones\">"), 1, "one list");
  assert.ok(ap.includes('<svg class="aim-an-body"'), "the figure stays");
  assert.ok(!ap.includes("aim-an-hit-sum") && !ap.includes("shots hit") && !ap.includes("other miss") && !ap.includes("damage") && !ap.includes("to the head"), "no other stat rows");
  assert.ok(ap.includes('<p class="aim-an-hit-note">No hits this round.</p>'), "a small note under the figure");
  // a recorded damage is not a row
  const dp = paneOf(ui.render.hitPanelHtml({ ...diedRound([shot({ part: "head" })]), damage: 150 }, "all"), "all");
  assert.deepStrictEqual(rows(dp), ["Head 1", "Chest 0", "Arms 0", "Torso 0", "Legs 0"]);
  assert.ok(!dp.includes("damage") && !dp.includes("150"));
  // near misses: only the rings on the figure, never a row
  const kp = ui.render.hitPanelHtml(killerRound(), "all");
  assert.strictEqual(count(paneOf(kp, "all"), '<g class="aim-an-ring">'), 1);
  assert.ok(rows(paneOf(kp, "all")).every((r) => !/near/i.test(r)) && rows(paneOf(kp, "all")).length === 5);
  // no shots at all: the figure with no markers, the rows at 0
  const np = paneOf(ui.render.hitPanelHtml(diedRound([]), "all"), "all");
  assert.ok(np.includes("You fired no shots this round.") && np.includes('<svg class="aim-an-body"') && rows(np).length === 5 && !np.slice(0, np.indexOf("</svg>")).includes("aim-an-dot"));
  // no killer: the figure too, the reason as a note
  const fell = paneOf(ui.render.hitPanelHtml({ ...diedRound([shot()]), deaths: [{ tick: 5, cause: "fell" }] }), "killer");
  assert.ok(fell.includes('<svg class="aim-an-body"') && fell.includes("No enemy killed you this round (you fell).") && rows(fell).length === 5);
});

// ---- no-shot result screen: side placement and entrance (17 Nov 2026) ----
// A fake matchMedia for the side-column ranges (20 Nov 2026: min-width 1280px, or 1360px with a bots card; min-height 680px);
// both queries answer the same flag. flip() fires "change". asked = the queries the panel used.
function fakeMq(wide) {
  const asked = [];
  const mq = { matches: wide, listeners: [], addEventListener(t, f) { if (t === "change") this.listeners.push(f); }, flip(v) { this.matches = v; for (const f of this.listeners) f({ matches: v }); } };
  return { mq, asked, matchMedia: (q) => {
    assert.ok(["(min-width: 1280px) and (min-height: 680px)", "(min-width: 1360px) and (min-height: 680px)"].includes(q), q);
    asked.push(q); return mq; } };
}
// The Eliminated screen without the Position map: the game's "N left" card (.al-bots-card.is-side) on the right of the card.
function noMapOverlay(document) {
  const r = resultOverlay(document, true);
  const bots = document.createElement("aside"); bots.className = "al-bots-card is-side"; r.overlay.appendChild(bots);
  return { ...r, bots };
}
const hasClass = (el, c) => el.className.split(/\s+/).includes(c);
test("no-shot screen, wide window: the hit panel floats in its own column LEFT of the result card (overlay child, side class + grid rule), never inside the card", async () => {
  const { mq, asked, matchMedia } = fakeMq(true);
  const { ui, document } = load({ analytics: stub({ rounds: [diedRound([])] }), win: { matchMedia } });
  const { overlay, body, bots } = noMapOverlay(document);
  ui.syncResult(); await settle();
  assert.ok(asked.includes("(min-width: 1360px) and (min-height: 680px)"), "with a bots card the side column needs the wider range");
  const panel = overlay.querySelector(".aim-an-hit");
  assert.ok(panel && panel.parentElement === overlay, "a direct child of the overlay");
  assert.ok(hasClass(panel, "aim-an-hit-side"), "side placement class");
  assert.deepStrictEqual(overlay.children.map((c) => c.className.split(" ")[0]), ["al-result-verdict-splash", "al-result-modal", "aim-an-hit", "al-bots-card"], "after the card in reading order");
  assert.ok(!body.children.includes(panel), "not inside the card");
  const css = document.getElementById("aim-analytics-ui-css").textContent;
  const wide = css.slice(css.indexOf("@media (min-width: 1180px) and (min-height: 680px)"));
  assert.ok(/\.al-result-overlay:has\(> \.aim-an-hit-side\) > \.aim-an-hit-side \{ grid-column: 1; grid-row: 1; \}/.test(wide), "panel in the first (left) column");
  assert.ok(/\.al-result-overlay:has\(> \.aim-an-hit-side\) > \.al-result-modal \{ grid-column: 2;/.test(wide) && /> \.al-bots-card \{ grid-column: 3;/.test(wide), "card in the middle, bots card on the right");
  assert.ok(/:has\(> \.aim-an-hit-side\) \{\s*--aim-an-side: 260px;\s*grid-template-columns: minmax\(var\(--aim-an-side\), 1fr\) minmax\(0, 960px\) minmax\(var\(--aim-an-side\), 1fr\)/.test(wide), "equal outer columns with a floor: the result card stays centred and shrinks first, the report sits on its left and the bots card on its right");
  assert.ok(/:has\(> \.aim-an-hit-side\):has\(> \.al-bots-card\) \{ --aim-an-side: 300px; \}/.test(wide), "with the 300px bots card both outer columns are at least 300px, so it is never pushed off screen");
  assert.ok(/> \.al-result-modal \{ justify-self: center; \}/.test(wide) && /> \.aim-an-hit\.aim-an-hit-side \{[^}]*justify-self: end;/.test(wide), "card centred, report attached to its left edge");
  assert.ok(/> \.aim-an-hit\.aim-an-hit-side \{[^}]*max-height: 92vh;[^}]*overflow: hidden auto;/.test(wide), "never cut off: scrolls inside itself like the bots card");
  assert.ok(wide.indexOf("aim-an-hit-side") < wide.indexOf("\n}\n"), "the side rules only apply inside the wide media range");
  // a re-render that drops the panel: put back in the same place, no new read; repeated syncs do not move it
  panel.remove(); ui.syncResult(); ui.syncResult(); await settle();
  const again = overlay.querySelector(".aim-an-hit");
  assert.ok(again.parentElement === overlay && hasClass(again, "aim-an-hit-side") && bots.previousElementSibling === again);
  // narrowing the window (phone / small window) puts it back inside the card under the stats, as before
  mq.flip(false);
  assert.ok(again.parentElement === body && !hasClass(again, "aim-an-hit-side"), "narrow: inside the card");
  assert.deepStrictEqual(body.children.map((c) => c.className), ["al-run-hero", "al-run-strip", "aim-an-hit", "al-run-actions"]);
  mq.flip(true);
  assert.ok(again.parentElement === overlay && hasClass(again, "aim-an-hit-side"), "wide again: beside the card");
});
test("map screen, wide window: the panel keeps its spot in the card body (the broadcast grid's left column), no side class", async () => {
  const { matchMedia } = fakeMq(true);
  const { ui, document } = load({ analytics: stub({ rounds: [diedRound([shot({ part: "head" })])] }), win: { matchMedia } });
  const { overlay, body } = resultOverlay(document, true);
  const pm = document.createElement("aside"); pm.className = "al-pm"; overlay.appendChild(pm);
  ui.syncResult(); await settle();
  const panel = overlay.querySelector(".aim-an-hit");
  assert.ok(panel.parentElement === body && !hasClass(panel, "aim-an-hit-side"));
});
test("entrance: the theme's left-column slide (es-rx-in-left 0.70s, same easing), once per result screen, not on a tab switch or a re-made panel; reduced motion turns it off", async () => {
  const { matchMedia } = fakeMq(true);
  const { ui, document } = load({ analytics: stub({ rounds: [killerRound()] }), win: { matchMedia } });
  const css = document.getElementById("aim-analytics-ui-css").textContent;
  assert.ok(css.includes(".aim-an-hit.aim-an-hit-enter { animation: es-rx-in-left 0.70s cubic-bezier(0.22, 1, 0.36, 1) var(--aim-an-hit-d, 0s) both; }"));
  assert.ok(/@media \(prefers-reduced-motion: reduce\) \{ \.aim-an-hit\.aim-an-hit-enter \{ animation: none; \} \}/.test(css));
  const { overlay } = noMapOverlay(document);
  ui.syncResult(); await settle();
  const panel = overlay.querySelector(".aim-an-hit");
  assert.ok(hasClass(panel, "aim-an-hit-enter"), "plays when the screen is entered");
  const d = parseInt(panel.style.getPropertyValue("--aim-an-hit-d"), 10);
  assert.ok(d > 1000 && d <= 1300, "after the verdict splash, counted from when the screen appeared: " + d);
  // a tab switch rewrites the inside only: same element, the class is not set again once the entrance is over
  panel.listeners.animationend[0]({ target: panel });
  assert.ok(!hasClass(panel, "aim-an-hit-enter") && !panel.style.getPropertyValue("--aim-an-hit-d"), "taken off when it has played");
  panel.listeners.click[0]({ target: { closest: (sel) => (sel === "[data-hit-tab]" ? { dataset: { hitTab: "all" } } : null) } });
  assert.ok(overlay.querySelector(".aim-an-hit") === panel && !hasClass(panel, "aim-an-hit-enter"), "tab switch: no replay");
  // the screen re-rendered and dropped the panel: the new one is not animated again
  panel.remove(); ui.syncResult(); await settle();
  const again = overlay.querySelector(".aim-an-hit");
  assert.ok(again && again !== panel && !hasClass(again, "aim-an-hit-enter"), "re-made panel: no replay");
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log("ok   " + name); }
    catch (err) { failed++; console.log("FAIL " + name + "\n     " + (err && err.stack ? err.stack.split("\n").slice(0, 3).join("\n     ") : err)); }
  }
  console.log(`\n${passed} of ${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
})();
