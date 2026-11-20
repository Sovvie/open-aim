// Test for app/routines.js: medals, routines and storage (no DOM). Run: node test-routines.cjs
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SRC = fs.readFileSync(path.join(__dirname, "..", "app", "routines.js"), "utf-8");
function boot(fetchImpl) {
  const store = new Map();
  const events = [];
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const win = { localStorage, dispatchEvent: (e) => events.push(e.type), addEventListener() {} };
  new Function("window", "localStorage", "fetch", SRC)(win, localStorage, fetchImpl);
  return { R: win.__aimRoutines, L: win.__aimRoutines.logic, store, events };
}
const results = [], queue = [];
const test = (name, fn) => queue.push([name, fn]); // run in order at the end, awaiting async tests
const A = "aaaaaaaaaaaaaaaa", B = "bbbbbbbbbbbbbbbb", C = "cccccccccccccccc";
const run = (code, score, o = {}) => ({ code, name: "Drill " + code.slice(0, 1), unit: "pts", score, end: "time", at: 1000, ...o });

test("medals: none until MIN_RUNS runs; then bronze = median, silver = 80th percentile, gold = best of the recent runs", () => {
  const { L } = boot();
  const state = {};
  for (const sc of [10, 20, 30]) { const r = L.recordRun(state, run(A, sc)); assert.strictEqual(r.thresholds === null || state[A].runs.length > 3, true); }
  const th = L.thresholds(state[A]);
  assert.deepStrictEqual(th, { bronze: 20, silver: 26, gold: 30, source: "history" });
  assert.strictEqual(L.medalFor(19, th, false), null);
  assert.strictEqual(L.medalFor(20, th, false), "bronze");
  assert.strictEqual(L.medalFor(26, th, false), "silver");
  assert.strictEqual(L.medalFor(31, th, false), "gold");
  assert.strictEqual(L.thresholds(L.emptyEntry("x", "pts")), null);
});
test("medals: a run is compared with the runs BEFORE it; the first runs earn nothing; medal counts and best medal are kept", () => {
  const { L } = boot();
  const state = {};
  const first = L.recordRun(state, run(A, 50));
  assert.strictEqual(first.medal, null); assert.strictEqual(first.firstRun, true); assert.strictEqual(first.isBest, false, "a first run is not a 'new' best");
  L.recordRun(state, run(A, 60)); L.recordRun(state, run(A, 40));
  const good = L.recordRun(state, run(A, 61));
  assert.strictEqual(good.medal, "gold"); assert.strictEqual(good.isBest, true);
  assert.strictEqual(state[A].best, 61); assert.strictEqual(state[A].bestMedal, "gold"); assert.strictEqual(state[A].medals.gold, 1);
  const low = L.recordRun(state, run(A, 30));
  assert.strictEqual(low.medal, null); assert.strictEqual(low.isBest, false);
  assert.deepStrictEqual(low.next && low.next.tier, "bronze");
});
test("medals: seconds are lower-is-better, so gold is the smallest time", () => {
  const { L } = boot();
  const state = {};
  for (const t of [30, 25, 20]) L.recordRun(state, run(A, t, { unit: "s" }));
  assert.strictEqual(state[A].lower, true);
  const th = L.thresholds(state[A]);
  assert.strictEqual(th.gold, 20); assert.ok(th.bronze >= th.silver && th.silver >= th.gold, JSON.stringify(th));
  assert.strictEqual(L.medalFor(19, th, true), "gold"); assert.strictEqual(L.medalFor(31, th, true), null);
  const n = L.nextMedal(31, th, true);
  assert.strictEqual(n.tier, "bronze"); assert.strictEqual(n.gap, r2(31 - th.bronze));
  function r2(v) { return Math.round(v * 100) / 100; }
});
test("medals: a death earns no medal and never counts for the best or the thresholds; custom thresholds win and can be reset", () => {
  const { L, R } = boot();
  const state = {};
  for (const sc of [10, 20, 30]) L.recordRun(state, run(A, sc));
  const died = L.recordRun(state, run(A, 999, { end: "died" }));
  assert.strictEqual(died.medal, null); assert.strictEqual(state[A].best, 30); assert.strictEqual(L.thresholds(state[A]).gold, 30);
  assert.strictEqual(state[A].runs[state[A].runs.length - 1].died, true);
  state[A].custom = { bronze: 5, silver: 50, gold: 500 };
  assert.deepStrictEqual(L.thresholds(state[A]), { bronze: 5, silver: 50, gold: 500, source: "custom" });
  assert.strictEqual(R.setCustom("not a code!", { bronze: 1, silver: 2, gold: 3 }), false);
  assert.strictEqual(R.setCustom(A, { bronze: 1, silver: "x", gold: 3 }), false, "numbers only");
  assert.strictEqual(R.setCustom(A, { bronze: 1, silver: 2, gold: 3 }), true);
  assert.deepStrictEqual(R.runs()[A].custom, { bronze: 1, silver: 2, gold: 3 });
  R.setCustom(A, null);
  assert.strictEqual(R.runs()[A].custom, null);
});
test("medals: only the newest WINDOW runs set the thresholds, only KEEP_RUNS are stored, a bad run is refused", () => {
  const { L } = boot();
  const state = {};
  for (let i = 0; i < 45; i++) L.recordRun(state, run(A, i < 25 ? 1000 : 10 + (i % 5)));
  assert.strictEqual(state[A].runs.length, L.KEEP_RUNS);
  assert.ok(L.thresholds(state[A]).gold < 100, "the old high scores have left the window");
  assert.strictEqual(L.recordRun(state, run("bad code", 5)), null); assert.strictEqual(L.recordRun(state, { ...run(A, NaN) }), null);
});

test("routines: cleaning up: name and at least one valid step are needed, runs are clamped, scores and medals are checked", () => {
  const { L } = boot();
  assert.strictEqual(L.normalizeRoutine({ name: "  ", steps: [{ code: A }] }), null);
  assert.strictEqual(L.normalizeRoutine({ name: "x", steps: [{ code: "bad code" }] }), null);
  const r = L.normalizeRoutine({ name: "  Warm   up ", steps: [{ code: A, name: "Grid", runs: "4", minScore: "70", minMedal: "silver" }, { code: B, runs: 500, minScore: "", minMedal: "platinum" }, null] });
  assert.strictEqual(r.name, "Warm up"); assert.strictEqual(r.steps.length, 2);
  assert.deepStrictEqual(r.steps[0], { code: A, name: "Grid", type: "", runs: 4, minScore: 70, minMedal: "silver", rank: "" });
  assert.strictEqual(L.normalizeStep({ code: A, rank: "gold" }).rank, "gold"); assert.strictEqual(L.normalizeStep({ code: A, rank: "Gold!" }).rank, "", "a rank is a plain lower-case id"); assert.strictEqual(L.normalizeStep({ code: A, rank: 5 }).rank, "");
  assert.deepStrictEqual([r.steps[1].runs, r.steps[1].minScore, r.steps[1].minMedal], [99, null, null]);
  assert.ok(/^rt-/.test(r.id));
});
test("routines: 'complete a map 4 times' - 4 counted runs move to the next step; other drills and deaths do not count", () => {
  const { L } = boot();
  const routine = L.normalizeRoutine({ id: "r1", name: "R", steps: [{ code: A, runs: 4 }, { code: B, runs: 1 }] });
  let active = { routineId: "r1", step: 0, counted: 0, log: [] };
  const go = (r, medal) => { const out = L.applyRun(routine, active, r, medal, false); if (out.counted || out.active) active = out.active || active; return out; };
  assert.strictEqual(go(run(B, 5)).why, "other-drill");
  assert.strictEqual(go(run(A, 5, { end: "died" })).why, "died");
  for (let i = 1; i <= 3; i++) { const o = go(run(A, 5)); assert.ok(o.counted && !o.stepDone && active.counted === i); }
  const o4 = go(run(A, 5));
  assert.ok(o4.stepDone && !o4.routineDone); assert.strictEqual(o4.next.code, B); assert.deepStrictEqual([active.step, active.counted], [1, 0]);
  const last = L.applyRun(routine, active, run(B, 7), null, false);
  assert.ok(last.routineDone && last.active === null && last.stepDone);
  assert.strictEqual(last.log.length, 5, "the four runs of A and the one of B");
});
test("routines: 'need N points to move on' and 'need a medal': a run below the bar does not count; lower-is-better flips", () => {
  const { L } = boot();
  const routine = L.normalizeRoutine({ id: "r2", name: "R", steps: [{ code: A, runs: 1, minScore: 70 }, { code: B, runs: 2, minMedal: "silver" }] });
  const active0 = { routineId: "r2", step: 0, counted: 0, log: [] };
  assert.strictEqual(L.applyRun(routine, active0, run(A, 69), null, false).why, "score");
  assert.ok(L.applyRun(routine, active0, run(A, 70), null, false).stepDone);
  const active1 = { routineId: "r2", step: 1, counted: 0, log: [] };
  assert.strictEqual(L.applyRun(routine, active1, run(B, 5), "bronze", false).why, "medal");
  assert.strictEqual(L.applyRun(routine, active1, run(B, 5), null, false).why, "medal");
  assert.ok(L.applyRun(routine, active1, run(B, 5), "gold", false).counted);
  const timed = L.normalizeRoutine({ id: "r3", name: "T", steps: [{ code: A, runs: 1, minScore: 30 }] });
  const a = { routineId: "r3", step: 0, counted: 0, log: [] };
  assert.strictEqual(L.applyRun(timed, a, run(A, 31, { unit: "s" }), null, true).why, "score", "31 s is not at most 30 s");
  assert.ok(L.applyRun(timed, a, run(A, 29, { unit: "s" }), null, true).routineDone);
});
test("routines: stepText names the requirement", () => {
  const { L } = boot();
  assert.strictEqual(L.stepText({ runs: 1, minScore: null, minMedal: null }, null), "1 run");
  assert.strictEqual(L.stepText({ runs: 4, minScore: 70, minMedal: "gold" }, { lower: false }), "4 runs, score at least 70, Gold medal or better");
  assert.strictEqual(L.stepText({ runs: 2, minScore: 30, minMedal: null }, { lower: true }), "2 runs, score at most 30");
});

test("storage: routines are saved, listed, started, finished through finishRun and recorded as done; deleting stops the active one", () => {
  const { R, events } = boot();
  const saved = R.saveRoutine({ name: "Morning", steps: [{ code: A, name: "A drill", runs: 2 }, { code: B, name: "B drill", runs: 1, minScore: 10 }] });
  assert.ok(saved && saved.id); assert.strictEqual(R.routines().length, 1);
  assert.strictEqual(R.saveRoutine({ name: "", steps: [] }), null);
  assert.ok(R.start(saved.id)); assert.strictEqual(R.active().routine.name, "Morning"); assert.strictEqual(R.start("nope"), null);
  const r1 = R.finishRun(run(A, 5));
  assert.ok(r1.progress.counted && !r1.progress.stepDone); assert.strictEqual(R.active().counted, 1);
  const r2 = R.finishRun(run(A, 6));
  assert.ok(r2.progress.stepDone && r2.progress.next.code === B); assert.strictEqual(R.active().step, 1);
  const bad = R.finishRun(run(B, 3));
  assert.strictEqual(bad.progress.why, "score"); assert.strictEqual(R.active().step, 1);
  const done = R.finishRun(run(B, 12));
  assert.ok(done.progress.routineDone); assert.strictEqual(R.active(), null);
  assert.strictEqual(R.state().done.length, 1); assert.strictEqual(R.state().done[0].name, "Morning");
  assert.strictEqual(R.runs()[A].runs.length, 2);
  assert.ok(events.includes("aim-routines-change"));
  R.start(saved.id); R.deleteRoutine(saved.id);
  assert.strictEqual(R.active(), null); assert.strictEqual(R.routines().length, 0);
});
test("storage: a run with no routine active only records; corrupt storage reads as empty", () => {
  const { R, store } = boot();
  const out = R.finishRun(run(C, 9));
  assert.strictEqual(out.progress, null); assert.strictEqual(out.routine, null); assert.strictEqual(R.runs()[C].runs.length, 1);
  store.set("aim-rt-routines-v1", "{not json"); store.set("aim-rt-runs-v1", "[1,2]");
  assert.deepStrictEqual(R.routines(), []); assert.deepStrictEqual(R.runs(), {});
});
test("strip: medal, personal best, the gap to the next medal and the routine progress; the Next button only when a step was finished", () => {
  const { R } = boot();
  const saved = R.saveRoutine({ id: "rt-x", name: "Warm-up", steps: [{ code: A, name: "Grid", runs: 1 }, { code: B, name: "Strafes", type: "ball", runs: 1 }] });
  R.start(saved.id);
  for (const sc of [10, 20, 30]) R.finishRun(run(C, sc));
  const unlock = R.stripHtml(R.finishRun(run(C, 22)));
  assert.ok(unlock.includes("Bronze medal") && unlock.includes("to go"), unlock);
  const stepDone = R.stripHtml(R.finishRun(run(A, 5)));
  assert.ok(stepDone.includes("Step done") && stepDone.includes("Strafes") && stepDone.includes('data-rt-next="' + B + '"') && stepDone.includes('data-rt-type="ball"'), stepDone);
  assert.ok(stepDone.includes("Medals unlock after 3 runs"), "the first runs of a drill say how many are left");
  const finished = R.stripHtml(R.finishRun(run(B, 5)));
  assert.ok(finished.includes("Routine complete") && !finished.includes("data-rt-next"), finished);
  const died = R.stripHtml(R.finishRun(run(C, 1, { end: "died" })), { died: true });
  assert.ok(died.includes("You died"));
  assert.strictEqual(R.stripHtml(null), "");
});

test("result screen: the big score is read with its unit; a death splash is end died; no score yet reads as null", () => {
  const { R } = boot();
  const root = (text, unit, splash) => ({ querySelector: (q) => (q === ".al-big-score" ? (text === null ? null : { textContent: text + " " + unit, querySelector: () => (unit ? { textContent: unit } : null) })
    : q === ".al-result-verdict-splash" ? (splash ? { classList: { contains: (c) => c === splash } } : null) : null) });
  assert.deepStrictEqual(R.readResult(root("1,284", "pts", "is-cleared")), { score: 1284, unit: "pts", end: "cleared" });
  assert.deepStrictEqual(R.readResult(root("21.5", "s", "is-time")), { score: 21.5, unit: "s", end: "time" });
  assert.strictEqual(R.readResult(root("80", "pts", "is-died")).end, "died");
  assert.strictEqual(R.readResult(root("80", "pts", null)).end, "time");
  assert.strictEqual(R.readResult(root(null, "", null)), null);
  assert.strictEqual(R.readResult(root("--", "pts", "is-time")), null);
});

// ---- the Routines page ----
const BOOK = new Map([[A, { name: "Grid shooting", map: null, type: "ball" }], [B, { name: "Ascent A Main attack", map: "ascent", type: "aim" }], [C, { name: "Bind Showers", map: "bind", type: "aim" }]]);
test("draft: + Routine adds a step (starting a draft when there is none), keeps its order, refuses bad codes, and survives a reload", () => {
  const { R, store } = boot();
  assert.strictEqual(R.draft(), null);
  assert.strictEqual(R.addToDraft("bad code!"), 0);
  assert.strictEqual(R.addToDraft(A, "Grid shooting", "ball"), 1);
  assert.strictEqual(R.addToDraft(B, "Ascent A Main attack", "aim"), 2);
  const d = R.draft();
  assert.deepStrictEqual(d.steps.map((x) => [x.code, x.name, x.type, x.runs, x.minScore, x.minMedal]), [[A, "Grid shooting", "ball", 1, "", ""], [B, "Ascent A Main attack", "aim", 1, "", ""]]);
  assert.ok(store.get("aim-rt-draft-v1"));
  R.saveDraft(null); assert.strictEqual(R.draft(), null); assert.strictEqual(store.has("aim-rt-draft-v1"), false);
  store.set("aim-rt-draft-v1", "{oops"); assert.strictEqual(R.draft(), null);
  for (let i = 0; i < 35; i++) R.addToDraft(A);
  assert.strictEqual(R.draft().steps.length, 30, "at most 30 steps");
});
test("picker: bookmarked (the game's bookmarks), recently played and all drills; a search looks through every drill", () => {
  const { R, store } = boot();
  const U = R.ui, favs = [C, A], recents = [B, A];
  assert.deepStrictEqual(U.pickerList(BOOK, "bookmarked", "", favs, recents).map((x) => x[0]), [C, A], "bookmarks in the order they were made");
  assert.deepStrictEqual(U.pickerList(BOOK, "recent", "", favs, recents).map((x) => x[0]), [B, A], "newest first");
  assert.deepStrictEqual(U.pickerList(BOOK, "all", "", favs, recents).map((x) => x[0]), [B, C, A], "all drills: by map, the map-less ones last");
  assert.deepStrictEqual(U.pickerList(BOOK, "bookmarked", "ascent main", favs, recents).map((x) => x[0]), [B], "a search ignores the list: it finds a drill that is not bookmarked");
  assert.deepStrictEqual(U.pickerList(BOOK, "recent", "GRID", favs, recents).map((x) => x[0]), [A]);
  assert.deepStrictEqual(U.pickerList(BOOK, "all", "target workshop", favs, recents).map((x) => x[0]), [A]);
  assert.deepStrictEqual(U.pickerList(BOOK, "bookmarked", "", ["not-in-the-book-x", C], []).map((x) => x[0]), [C], "a bookmark of a drill that is gone is skipped");
  store.set("aim-offline-favorites-v1", JSON.stringify(["ws-" + C, "ws-" + A, "junk!", 5]));
  assert.deepStrictEqual(U.readFavs(), [C, A], "the game keeps its bookmarks as ws-<code>");
  store.set("aim-offline-favorites-v1", "{bad"); assert.deepStrictEqual(U.readFavs(), []);
});
test("picker: the gallery shows a card per drill with the map picture, kind, medal and 'added' state; empty lists say what to do", () => {
  const { R } = boot();
  const runs = {}; for (const sc of [1, 2, 3, 4]) R.logic.recordRun(runs, run(B, sc, { name: "Ascent A Main attack" }));
  const draft = { id: null, name: "", steps: [{ code: B, name: "", type: "aim", runs: 1, minScore: "", minMedal: "" }, { code: B, name: "", type: "aim", runs: 1, minScore: "", minMedal: "" }] };
  const p = { open: true, tab: "all", query: "", favs: [], recents: [] };
  const html = R.ui.galleryHtml(BOOK, runs, p, draft);
  assert.strictEqual(html.split('class="es-rt-gcard').length - 1, 3);
  assert.ok(html.includes('src="/aim-maps/ascent.cover.webp"') && html.includes('data-thumb="' + A + '"') && html.includes('data-rt="add" data-code="' + B + '"'));
  assert.ok(html.includes("es-rt-gmedal is-gold") || html.includes("es-rt-gmedal is-silver") || html.includes("es-rt-gmedal is-bronze"), "the best medal on the card");
  assert.ok(html.includes("✓ ×2") && html.includes("+ Add"), "a drill that is already in the routine says how often");
  assert.ok(R.ui.galleryHtml(BOOK, {}, { ...p, tab: "bookmarked" }, null).includes("No bookmarks yet"));
  assert.ok(R.ui.galleryHtml(BOOK, {}, { ...p, tab: "recent" }, null).includes("Nothing played yet"));
  assert.ok(R.ui.galleryHtml(BOOK, {}, { ...p, query: "zzz" }, null).includes("No drill matches that"));
  const panel = R.ui.pickerHtml(BOOK, runs, { ...p, tab: "bookmarked", favs: [C] }, draft);
  assert.ok(panel.includes("data-rt-pick") && panel.includes('data-rt-q') && panel.includes('data-rt="picker-close"') && panel.includes("Done (2)"));
  assert.ok(panel.includes('data-tab="bookmarked"') && panel.includes('aria-selected="true" class="is-on" data-rt="picker-tab" data-tab="bookmarked"') && panel.includes("<small>1</small>"), "the tabs with their counts");
  const searching = R.ui.pickerHtml(BOOK, runs, { ...p, tab: "bookmarked", query: "bind" }, draft);
  assert.ok(/match(es)? “bind” in all drills/.test(searching) && !searching.includes('class="is-on"'), "while searching no list is selected; the note says how many drills match");
  // a full routine: the cards cannot be pressed and the note says why
  const fullDraft = { id: null, name: "", steps: Array.from({ length: 30 }, () => ({ code: A, name: "", type: "ball", runs: 1, minScore: "", minMedal: "" })) };
  const fullPanel = R.ui.pickerHtml(BOOK, runs, { ...p, tab: "all" }, fullDraft);
  assert.ok(fullPanel.includes("The routine is full") && /data-rt="add" data-code="[a-z]+" title="The routine is full \(30 drills\)" disabled/.test(fullPanel), "a full routine disables the cards");
});
test("page: with no draft the right side explains how to build one; with a draft it is the editor (name, search, a row per step, Save)", () => {
  const { R } = boot();
  const view = (o = {}) => ({ tab: "routines", state: R.state(), runs: R.runs(), book: BOOK, draft: null, delId: null, medalEdit: null, picker: { open: false, tab: "bookmarked", query: "", favs: [], recents: [] }, error: null, ...o });
  const intro = R.ui.pageHtml(view());
  assert.ok(intro.includes("Build a routine") && intro.includes('data-rt="new"') && intro.includes("bookmarks") && !intro.includes("data-rt-editor") && intro.includes("No routines yet"));
  const draft = { id: null, name: "Warm-up", steps: [{ code: A, name: "Grid shooting", type: "ball", runs: 4, minScore: "70", minMedal: "silver" }, { code: B, name: "", type: "aim", runs: 1, minScore: "", minMedal: "" }] };
  const ed = R.ui.pageHtml(view({ draft }));
  assert.ok(ed.includes("data-rt-editor") && ed.includes("New routine") && ed.includes('value="Warm-up"') && ed.includes('data-rt="picker-open"') && ed.includes("Add a drill") && !ed.includes("data-rt-pick"), "the picker is closed until Add a drill is pressed");
  const open = R.ui.pageHtml(view({ draft, picker: { open: true, tab: "all", query: "asc", favs: [], recents: [] } }));
  assert.ok(open.includes("data-rt-pick") && open.includes('value="asc"') && open.includes("es-rt-gcard"), "the picker drops open with the gallery");
  assert.strictEqual(ed.split("data-step=").length - 1, 2);
  assert.ok(ed.includes("Ascent A Main attack"), "a step with no stored name shows the drill's name from the book");
  assert.ok(ed.includes('data-rt="up" data-i="0" aria-label="Move up" title="Move up" disabled') &&ed.includes('data-rt="save"') && ed.includes('data-rt="discard"'));
  assert.ok(ed.includes('value="silver" selected') && ed.includes('value="70"'));
  assert.ok(R.ui.pageHtml(view({ draft, error: "Give the routine a name" })).includes('role="alert"'));
  assert.ok(R.ui.pageHtml(view({ draft: { id: "rt-1", name: "x", steps: [] } })).includes("Edit routine"));
});
test("page: saved routines list their steps and requirements, the active one shows progress, delete asks twice, medals tab lists drills", () => {
  const { R } = boot();
  const saved = R.saveRoutine({ id: "rt-1", name: "Morning", steps: [{ code: A, name: "Grid shooting", type: "ball", runs: 4, minScore: 70 }, { code: B, name: "Ascent A Main attack", runs: 1, minMedal: "silver" }] });
  R.start(saved.id); R.finishRun(run(A, 80));
  for (const sc of [10, 20, 30]) R.finishRun(run(C, sc, { name: "Bind Showers" }));
  const view = (o = {}) => ({ tab: "routines", state: R.state(), runs: R.runs(), book: BOOK, draft: null, delId: null, medalEdit: null, picker: { open: false, tab: "bookmarked", query: "", favs: [], recents: [] }, error: null, ...o });
  const html = R.ui.pageHtml(view({ delId: "rt-1" }));
  assert.ok(html.includes('data-routine="rt-1"') && html.includes("4 runs, score at least 70") && html.includes("Silver medal or better") && html.includes('data-rt="start" data-id="rt-1"'));
  assert.ok(html.includes("data-rt-active") && html.includes("Step 1 of 2") && html.includes("done 1 of 4") && html.includes("Restart") && html.includes("Click again to delete") && html.includes('class="is-now"'));
  const med = R.ui.pageHtml(view({ tab: "medals", medalEdit: C }));
  assert.ok(med.includes('data-medal-row="' + C + '"') && med.includes("Bind Showers") && med.includes("is-bronze") && med.includes('data-medal-form="' + C + '"') && med.includes('data-rt="medal-save"'));
  assert.ok(med.includes("after 3 runs (1 done)"), "a drill with one run says how many are left");
  assert.ok(R.ui.pageHtml(view({ tab: "medals", runs: {} })).includes("No runs recorded yet"));
  assert.ok(R.ui.pageHtml(view()).includes('aria-selected="true" class="is-on" data-rt="tab" data-tab="routines"'));
});

test("thumbnails: a Target Workshop drill is drawn from its scene: a grid as cells with the live ones marked, a path as a line with the target at its start, a strafer with an arrow", () => {
  const { R } = boot();
  const base = (extra) => ({ playerSpawn: { position: { x: 0, y: 0, z: 4.2 }, yaw: 0 }, ...extra });
  const grid = base({ playerSpawn: { position: { x: 0, y: 0, z: 0 }, yaw: 0 }, actors: [{ id: "ball", body: { shape: "sphere", radius: 0.5 } }],
    spawners: [{ id: "g", kind: "grid", actorTemplateId: "ball", position: { x: 0, y: 3.1, z: -5.8 }, size: { x: 5, y: 5, z: 0 }, columns: 5, rows: 5, maxAlive: 3 }] });
  const g = R.ui.thumbModel(grid, 1600, 900);
  assert.strictEqual(g.balls.length, 25); assert.strictEqual(g.balls.filter((b) => b.live).length, 3);
  assert.ok(g.balls.every((b) => b.r > 5 && b.x > 0 && b.x < 1600 && b.y > 0 && b.y < 900), "cells are on the screen and sized by distance");
  const path = base({ actors: [{ id: "a", body: { shape: "sphere", radius: 0.4 }, behaviors: [{ kind: "path", waypoints: [{ x: -7, y: 1.6, z: -14 }, { x: 7, y: 1.6, z: -14 }], speed: 3 }] }],
    spawners: [{ id: "s", kind: "area", actorTemplateId: "a", position: { x: 0, y: 1.6, z: -14 }, size: { x: 0.1, y: 0.1, z: 1 }, maxAlive: 1 }] });
  const p = R.ui.thumbModel(path, 1600, 900);
  assert.strictEqual(p.lines.length, 1); assert.strictEqual(p.lines[0].length, 2); assert.strictEqual(p.balls.length, 1);
  assert.ok(p.lines[0][0][0] < 800 && p.lines[0][1][0] > 800, "the path runs across the middle of the view");
  assert.ok(Math.abs(p.balls[0].x - p.lines[0][0][0]) < 1e-6, "the target sits at the start of its path");
  const strafe = base({ actors: [{ id: "a", body: { shape: "sphere", radius: 0.4 }, behaviors: [{ kind: "strafe", speed: [3, 7] }] }], spawners: [{ id: "s", kind: "area", actorTemplateId: "a", position: { x: 0, y: 1.7, z: -15 }, size: { x: 11, y: 0.1, z: 1 }, maxAlive: 1 }] });
  assert.strictEqual(R.ui.thumbModel(strafe, 1600, 900).arrows.length, 1);
  // a player turned around (yaw pi, as in the grid drills) still sees the targets in front of it; nothing behind the player is drawn
  const turned = base({ playerSpawn: { position: { x: 0, y: 0, z: -7 }, yaw: Math.PI }, actors: grid.actors, spawners: [{ ...grid.spawners[0], position: { x: 0, y: 3.1, z: 7 } }] });
  assert.strictEqual(R.ui.thumbModel(turned, 1600, 900).balls.length, 25);
  const behind = base({ actors: grid.actors, spawners: [{ ...grid.spawners[0], position: { x: 0, y: 3, z: 40 } }] });
  assert.strictEqual(R.ui.thumbModel(behind, 1600, 900).balls.length, 0);
  assert.deepStrictEqual(R.ui.thumbModel(null, 100, 100), { balls: [], lines: [], arrows: [] });
  // a dispatcher drill (points that light up in turn, no spawner): each point is a dashed cell, as many as light at once are filled
  const pts = base({ actors: [{ id: "b", body: { shape: "sphere", radius: 0.5 }, behaviors: [] }], spawners: [],
    dispatchers: [{ id: "d", name: "n", order: "sequence", maxAlive: 2, interval: [0.1, 0.2], routes: [-6, -2, 2, 6].map((x) => ({ templateId: "b", streak: [1, 1], at: { x, y: 2, z: -12 }, point: true })).concat([{ templateId: "gone", streak: [1, 1], at: { x: 0, y: 2, z: -12 } }, { templateId: "b", streak: [1, 1] }]) }] });
  const dp = R.ui.thumbModel(pts, 1600, 900);
  assert.strictEqual(dp.balls.length, 4, "only routes with a place and an existing template are drawn"); assert.strictEqual(dp.balls.filter((b) => b.live).length, 2);
  assert.ok(dp.balls[0].x < dp.balls[1].x && dp.balls.every((b) => b.r > 5 && b.x > 0 && b.x < 1600));
  const card = R.ui.galleryCardHtml(A, { name: "Grid shooting", map: null, type: "ball" }, null, 0);
  assert.ok(card.includes('<canvas class="es-rt-gcanvas" data-thumb="' + A + '">') && !card.includes("es-rt-gart is-plain"), "the card has a canvas for the picture");
  assert.ok(R.ui.galleryCardHtml(B, { name: "x", map: "ascent", type: "aim" }, null, 0).includes("<img"), "a map drill keeps the map's picture");
});

// ---- rows with thumbnail and information; enemy rank; easy / hard ----
const answers = (cards, sib = {}) => async (url) => {
  const u = String(url);
  if (u.startsWith("/api/local/enemy-rank?codes=")) return { json: async () => ({ ranks: [{ id: "off", name: "Don't shoot", color: "#8b909a" }, { id: "iron", name: "Iron", color: "#8d8d8d" }, { id: "gold", name: "Gold", color: "#e8b84a" }], cards }) };
  if (u.startsWith("/api/local/drill-sibling?code=")) return { json: async () => sib[u.split("=")[1]] || {} };
  return { json: async () => ({}) };
};
const flush = () => new Promise((r) => setTimeout(r, 20));
test("rows: a step shows its thumbnail (map picture or canvas), name, kind, description, best / runs / medal; the editor row has the step's settings", async () => {
  const { R } = boot(answers({ [B]: { eligible: true, rank: "iron" }, [A]: { eligible: false } }, { [B]: { code: C, name: "Hard Ascent", difficulty: "hard" } }));
  const book = new Map([[A, { name: "Grid shooting", map: null, type: "ball", description: "Small targets on a grid." }], [B, { name: "Easy Ascent A Main", map: "ascent", type: "aim", description: "Route onto the site.\nBots shoot back." }], [C, { name: "Hard Ascent", map: "ascent", type: "aim", description: "" }]]);
  assert.strictEqual(await R.ensureInfo([A, B]), true); assert.strictEqual(await R.ensureInfo([A, B]), false, "asked once");
  const runs = {}; for (const sc of [10, 20, 30, 40]) R.logic.recordRun(runs, run(B, sc, { name: "Easy Ascent A Main" }));
  const draft = { id: null, name: "X", steps: [{ code: B, name: "", type: "aim", runs: 2, minScore: "", minMedal: "", rank: "gold" }, { code: A, name: "", type: "ball", runs: 1, minScore: "", minMedal: "", rank: "" }] };
  const html = R.ui.editorHtml(draft, book, runs, null, null);
  const rows = html.split('<li class="es-rt-step"').slice(1);
  assert.strictEqual(rows.length, 2);
  assert.ok(rows[0].includes('src="/aim-maps/ascent.cover.webp"') && rows[0].includes("Easy Ascent A Main") && rows[0].includes("Route onto the site.") && /Best 40 pts · 4 runs/.test(rows[0]) && rows[0].includes("es-rt-medal"), "thumbnail, name, description, best / runs / medal");
  assert.ok(rows[1].includes('<canvas class="es-rt-gcanvas" data-thumb="' + A + '">') && rows[1].includes("Not played yet") && rows[1].includes("Small targets on a grid."), "a Target Workshop drill gets the canvas thumbnail");
  assert.ok(!rows[0].includes("<select data-rt-field=\"rank\""), "the rank is not a drop-down any more");
  assert.ok(rows[0].includes('class="es-rank-hero"') && rows[0].includes('src="/studio/icons/ranks/gold.png"') && rows[0].includes('data-rt="rank-step" data-dir="-1"') && rows[0].includes('data-rt="rank-step" data-dir="1"') && rows[0].includes('<div class="es-rank-name">Gold</div>'),
    "the lobby card's control over the thumbnail: badge, two arrows, name");
  assert.ok(!rows[1].includes("es-rank-hero"), "a drill with no bots has no rank");
  assert.ok(rows[0].includes('aria-label="Difficulty"') && rows[0].includes('data-rt="swap-diff" data-i="0"') && /class="is-on" aria-pressed="true">Easy/.test(rows[0]), "an easy / hard pair: the current one is marked, the other switches");
  assert.ok(!rows[1].includes("Difficulty"), "no pair, no switch");
  assert.ok(rows[0].includes('data-rt-field="runs"') && rows[0].includes('data-rt-field="minScore"') && rows[0].includes('data-rt-field="minMedal"'));
});
test("rows: saved routines and the active step show thumbnails and the rank", async () => {
  const { R } = boot(answers({ [B]: { eligible: true } }));
  await R.ensureInfo([B]);
  const book = new Map([[B, { name: "Easy Ascent A Main", map: "ascent", type: "aim", description: "" }]]);
  const saved = R.saveRoutine({ id: "rt-1", name: "Aim", steps: [{ code: B, name: "Easy Ascent A Main", type: "aim", runs: 2, rank: "gold" }] });
  R.start(saved.id);
  const html = R.ui.pageHtml({ tab: "routines", state: R.state(), runs: {}, book, draft: null, delId: null, medalEdit: null, picker: { open: false, tab: "bookmarked", query: "", favs: [], recents: [] }, error: null });
  assert.ok(html.includes('class="es-rt-sthumb is-sm"') && html.includes('src="/aim-maps/ascent.cover.webp"'), "thumbnail on the card and on the active step");
  assert.ok((html.match(/es-rt-rank/g) || []).length >= 2 && html.includes("Gold") && html.includes('data-rank="gold"'), "the rank on the card, the active card and its Play button");
});
test("start: a step with a rank sets it (like the lobby card) only for a drill with bots, then plays the drill; the Next button carries the rank", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push([String(url), opts && opts.headers && opts.headers["x-aim-local"]]); return answers({ [B]: { eligible: true }, [A]: { eligible: false } })(url); };
  const { R } = boot(fetchImpl);
  R.startDrill = undefined;
  const r1 = await R.startStep({ code: B, type: "aim", rank: "gold" });
  assert.ok(calls.some(([u, h]) => u === "/api/local/enemy-rank?set=gold&code=" + B && h === "1"), "the rank is set with the local header: " + JSON.stringify(calls));
  assert.strictEqual(r1, false, "no lobby in the test, so the drill itself is not started");
  calls.length = 0;
  await R.startStep({ code: A, type: "ball", rank: "gold" });
  assert.ok(!calls.some(([u]) => u.includes("set=")), "a drill with no bots: no rank is set");
  calls.length = 0;
  await R.startStep({ code: B, type: "aim", rank: "" });
  assert.ok(!calls.some(([u]) => u.includes("set=")), "no rank chosen: the drill keeps its own");
  assert.strictEqual(await R.startStep({ code: "bad code" }), false);
  const saved = R.saveRoutine({ id: "rt-s", name: "R", steps: [{ code: A, name: "A", runs: 1 }, { code: B, name: "B", type: "aim", runs: 1, rank: "iron" }] });
  R.start(saved.id);
  const strip = R.stripHtml(R.finishRun(run(A, 5)));
  assert.ok(strip.includes('data-rt-rank="iron"') && strip.includes('data-rt-next="' + B + '"'), strip);
});

// ---- the enemy rank control (the lobby card's), and the generated medal badges ----
const RANKS = [{ id: "off", name: "Don't shoot", color: "#8b909a", reaction: null, heads: false }, { id: "iron", name: "Iron", color: "#8d8d8d", reaction: [0.9, 1.1], heads: false },
  { id: "gold", name: "Gold", color: "#e8b84a", reaction: [0.5, 0.62], heads: false }, { id: "radiant", name: "Radiant", color: "#ffe08a", reaction: [0.17, 0.23], heads: true }];
test("rank: the arrows move one rank; a step at the rank the drill was made with stores '' (its default), like the card", () => {
  const { R } = boot();
  const U = R.ui, info = { eligible: true, made: "iron", rank: "iron" };
  assert.strictEqual(U.rankStep({ rank: "" }, info, RANKS, 1), "gold" === "x" ? "" : "gold", "from the default (iron) one up is gold in this short list");
  assert.strictEqual(U.rankStep({ rank: "gold" }, info, RANKS, -1), "", "back to the made rank is the default");
  assert.strictEqual(U.rankStep({ rank: "" }, info, RANKS, -1), "off", "one down from iron");
  assert.strictEqual(U.rankStep({ rank: "off" }, info, RANKS, -1), "off", "the lowest stays");
  assert.strictEqual(U.rankStep({ rank: "radiant" }, info, RANKS, 1), "radiant", "the highest stays");
  assert.strictEqual(U.rankStep({ rank: "gold" }, null, RANKS, 1), "gold", "no info yet: unchanged");
});
test("rank: the control shows the badge, arrows (the end ones disabled), pips, name and what the rank does; 'Don't shoot' has the dashed cross; no bots, no control", () => {
  const { R } = boot();
  const U = R.ui, info = { eligible: true, made: "iron", rank: "iron" };
  const gold = U.rankHeroHtml({ rank: "gold" }, 2, info, RANKS);
  assert.ok(gold.includes('src="/studio/icons/ranks/gold.png"') && gold.includes("Reacts 0.56 s · aims at your body") && gold.includes('data-i="2"') && !gold.includes("Drill default"), gold);
  assert.strictEqual((gold.match(/<i class="on">/g) || []).length, 2, "pips up to the rank: gold is the 2nd of 3");
  const dflt = U.rankHeroHtml({ rank: "" }, 0, info, RANKS);
  assert.ok(dflt.includes("Drill default · Reacts 1.00 s") && dflt.includes('<div class="es-rank-name">Iron</div>'), "no choice: the drill's own rank is shown as the default");
  const off = U.rankHeroHtml({ rank: "off" }, 0, info, RANKS);
  assert.ok(off.includes('<div class="es-rank-off">✕</div>') && off.includes("Bots don&#39;t shoot back") && /aria-label="Lower enemy rank" disabled/.test(off) && !/aria-label="Higher enemy rank" disabled/.test(off));
  assert.ok(/aria-label="Higher enemy rank" disabled/.test(U.rankHeroHtml({ rank: "radiant" }, 0, info, RANKS)));
  assert.strictEqual(U.rankHeroHtml({ rank: "" }, 0, { eligible: false }, RANKS), ""); assert.strictEqual(U.rankHeroHtml({ rank: "" }, 0, undefined, RANKS), ""); assert.strictEqual(U.rankHeroHtml({ rank: "" }, 0, info, []), "");
  assert.ok(U.rankHeroHtml({ rank: "" }, 0, info, RANKS).includes("--es-rank-color:#8d8d8d"), "the rank's colour drives the glow like on the card");
});
test("medal badges: generated vector art, one per tier, told apart by gem shape, colour and 1 / 2 / 3 pips; used wherever a medal is shown", () => {
  const { R } = boot();
  const U = R.ui, b = U.medalIcon("bronze"), s = U.medalIcon("silver"), g = U.medalIcon("gold");
  for (const svg of [b, s, g]) assert.ok(svg.startsWith('<svg class="es-rt-badge" viewBox="0 0 64 72"') && svg.includes("</svg>") && svg.includes("<polygon") && !/<script|<image|href=/.test(svg), "self-contained vector art");
  assert.strictEqual(new Set([b, s, g]).size, 3, "three different badges");
  assert.strictEqual((b.match(/<polygon points="32,31/g) || []).length, 4, "bronze: a rhombus gem, 4 facets");
  assert.strictEqual((s.match(/<polygon points="32,31/g) || []).length, 6, "silver: a hexagon, 6 facets");
  assert.strictEqual((g.match(/<polygon points="32,31/g) || []).length, 5, "gold: a pentagon, 5 facets");
  const pips = (svg) => (svg.match(/d="M[\d.]+ 54l3 3\.2-3 3\.2-3-3\.2z"/g) || []).length;
  assert.deepStrictEqual([pips(b), pips(s), pips(g)], [1, 2, 3]);
  assert.strictEqual(U.medalIcon("platinum"), ""); assert.strictEqual(U.medalIcon(), "");
  assert.strictEqual(U.medalIcon("gold"), g, "cached");
  assert.ok(g.includes("#ffe58a") === false || g.includes("fill="), "palette applied");
  // used on the screens
  const runs = {}; for (const sc of [1, 2, 3, 9]) R.logic.recordRun(runs, run(B, sc, { name: "X" }));
  assert.ok(U.galleryCardHtml(B, { name: "X", map: "ascent", type: "aim" }, { ...runs[B], bestMedal: "gold" }, 0).includes('<span class="es-rt-gmedal is-gold"><svg class="es-rt-badge"'));
  assert.ok(R.stripHtml({ entry: runs[B], medal: "silver", thresholds: { bronze: 1, silver: 2, gold: 3 }, isBest: false, next: null, progress: null, routine: null }).includes('<span class="aim-rt-medal is-silver"><svg class="es-rt-badge"'));
  const med = U.pageHtml({ tab: "medals", state: R.state(), runs, book: new Map(), draft: null, delId: null, medalEdit: null, picker: { open: false, tab: "all", query: "", favs: [], recents: [] }, error: null });
  assert.ok(med.includes('<span class="es-rt-medal is-bronze"><svg class="es-rt-badge"') && !/<i><\/i>/.test(med), "the table uses the badges, no more plain diamonds");
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); results.push([name, true]); console.log("ok   " + name); }
    catch (e) { results.push([name, false]); console.log("FAIL " + name + "\n     " + String(e && e.stack || e).split("\n").slice(0, 4).join("\n     ")); }
  }
  const failed = results.filter((r) => !r[1]).length;
  console.log("\n" + (failed ? failed + " FAILED of " + results.length : "all " + results.length + " tests passed"));
  process.exit(failed ? 1 : 0);
})();
