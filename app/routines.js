// Medals and routine playlists (18 Nov 2026, marker aim-routines-v1).
//
// MEDALS. Every finished run of a drill (the result screen's big score, read when the screen has settled) is kept per drill, and a medal
// is given by comparing it with YOUR OWN recent runs of that drill, so every drill gets goals with no par needed:
//   bronze = your typical run (the median of your last WINDOW runs of the drill), silver = a good one (the 80th percentile),
//   gold = at least your best of those runs. They exist after MIN_RUNS runs (before that the screen says how many are left). A run is
//   compared with the runs BEFORE it, so a medal means "better than what you usually do". A score where less is better (a unit of
//   seconds, see LOWER_UNITS) is turned around. The three numbers of a drill can be set by hand (Medals tab) and then stay fixed.
//   A run that ended with your death does not count for medals, bests or routines (it is kept in the history, marked as died).
//
// ROUTINES. A routine is an ordered list of steps; a step is a drill plus what must be done before the next one starts:
//   { code, name, type, runs (completed runs needed, 1..99), minScore (a run only counts with at least this score, or null),
//     minMedal ("bronze" | "silver" | "gold", a run only counts with at least this medal, or null),
//     rank (the enemy rank the drill is played at, "iron" .. "radiant" or "off" = bots do not shoot; "" = the drill's own setting. Only drills with
//     bots have one, see /api/local/enemy-rank; it is set the same way the lobby card sets it, just before the step starts) }.
//     A drill that has an easy / hard pair (/api/local/drill-sibling) can be switched between the two in the editor: the step then holds the code of the one chosen.
//   A run counts for the step when it is of that drill, did not end with a death, and meets minScore and minMedal. When enough runs
//   have counted the routine moves on to the next step, and after the last one it is complete. Runs of other drills are ignored.
//   Storage: localStorage "aim-rt-runs-v1" ({ [code]: drill entry }) and "aim-rt-routines-v1" ({ routines, active, done }).
//
// SCREENS (all in this file). A "Routines" tab in the lobby's top bar (next to Collection) opens a full page with two tabs: My routines
// (build, edit, start, delete; a search box adds drills; the active routine with its progress) and Medals (every played drill with its
// medal scores, editable). Every drill card in the lobby (VALORANT Training and Target Workshop) gets a "+ Routine" button that adds the
// drill to the routine being built (the DRAFT, kept in localStorage "aim-rt-draft-v1" until saved or discarded) and a medal chip once the
// drill has a medal. The game's result screen (.al-result-overlay) gets a strip with the medal and the routine progress and a "Next drill"
// button that leaves the round and starts the routine's next drill.
(() => {
  if (window.__aimRoutines) return;

  const RUNS_KEY = "aim-rt-runs-v1", ROUTINES_KEY = "aim-rt-routines-v1";
  const MEDALS = ["bronze", "silver", "gold"];
  const MEDAL_LABEL = { bronze: "Bronze", silver: "Silver", gold: "Gold" };
// (the generated medal badges follow the constants below)
  const MIN_RUNS = 3;          // runs of a drill before medals exist
  const WINDOW = 20;           // the newest runs the thresholds are taken from
  const KEEP_RUNS = 40;        // runs kept per drill
  const SILVER_Q = 0.8;        // silver = this quantile of your recent runs (bronze = the median, gold = the best)
  const MAX_ROUTINES = 30, MAX_STEPS = 30, MAX_RUNS_PER_STEP = 99, MAX_DONE = 30, MAX_LOG = 200;
  const SETTLE_MS = 1500;      // the result screen counts its score up; it is read this long after the screen was first seen
  const LOWER_UNITS = /^(s|sec|secs|second|seconds|ms|min|mins)$/i; // a score in time: less is better
  const CODE_RE = /^[a-z0-9-]{1,64}$/i;
  // ---- medal badges: generated vector art in the style of the game's rank icons (an angular steel shield around a faceted gem) ----
  // Bronze = a rhombus gem, Silver = a hexagon, Gold = a pentagon, with 1 / 2 / 3 pips under it, so the three read apart without colour.
  // The facets are shaded by where they face (light from the top left), so one palette per tier gives all of them.
  const BADGE_TONES = { bronze: ["#7a4a1e", "#e8a867"], silver: ["#7d8794", "#f4f7fa"], gold: ["#b07a0a", "#ffe58a"] };
  const BADGE_GEM = { bronze: [[32, 14], [47, 31], [32, 48], [17, 31]], silver: [[32, 14], [44, 21], [44, 41], [32, 48], [20, 41], [20, 21]], gold: [[32, 14], [47, 26], [41, 47], [23, 47], [17, 26]] };
  const mixHex = (a, b, t) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) + (parseInt(b.slice(i, i + 2), 16) - parseInt(a.slice(i, i + 2), 16)) * t).toString(16).padStart(2, "0")).join("");
  const badgeCache = {};
  // The badge of a medal tier as an inline SVG string (viewBox 0 0 64 72); "" for an unknown tier. Pure and cached.
  function medalIcon(tier) {
    if (!BADGE_GEM[tier]) return "";
    if (badgeCache[tier]) return badgeCache[tier];
    const [dark, light] = BADGE_TONES[tier], c = [32, 31], n = MEDALS.indexOf(tier) + 1, pts = BADGE_GEM[tier].map(([x, y]) => [Math.round((c[0] + (x - c[0]) * 1.18) * 10) / 10, Math.round((c[1] + (y - c[1]) * 1.18) * 10) / 10]);
    const facets = pts.map((p, i) => {
      const q = pts[(i + 1) % pts.length], mx = (p[0] + q[0]) / 2 - c[0], my = (p[1] + q[1]) / 2 - c[1], lit = (1 + Math.cos(Math.atan2(my, mx) - Math.atan2(-1, -1))) / 2; // 1 = facing the light
      return '<polygon points="' + c.join(",") + " " + p.join(",") + " " + q.join(",") + '" fill="' + mixHex(dark, light, 0.12 + 0.88 * lit) + '"/>';
    }).join("");
    const pips = Array.from({ length: n }, (_, i) => { const x = 32 + (i - (n - 1) / 2) * 8; return '<path d="M' + x + " 54l3 3.2-3 3.2-3-3.2z" + '" fill="' + light + '"/>'; }).join("");
    const id = "rtb-" + tier;
    return (badgeCache[tier] = '<svg class="es-rt-badge" viewBox="0 0 64 72" aria-hidden="true" focusable="false">'
      + '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6a7482"/><stop offset=".55" stop-color="#3a414d"/><stop offset="1" stop-color="#232832"/></linearGradient></defs>'
      + '<path d="M32 2 60 12v28L32 70 4 40V12z" fill="url(#' + id + ')"/><path d="M32 7 55 15.5V38.5L32 64.5 9 38.5V15.5z" fill="#151a21"/><path d="M32 2 60 12 55 15.5 32 7 9 15.5 4 12z" fill="#7b8696" opacity=".75"/>'
      + facets + '<polygon points="' + pts.map((p) => p.join(",")).join(" ") + '" fill="none" stroke="' + light + '" stroke-opacity=".55" stroke-width="1"/>' + pips + "</svg>");
  }
  // One badge plus its name or number, for the screens: <span class="CLS is-TIER">badge text</span>.
  const medalSpan = (cls, tier, text, extra) => '<span class="' + cls + " is-" + tier + (extra || "") + '">' + medalIcon(tier) + text + "</span>";

  const num = (v) => typeof v === "number" && isFinite(v);
  const r2 = (n) => Math.round(n * 100) / 100;

  // ================================================================ pure logic
  const lowerBetter = (unit) => LOWER_UNITS.test(String(unit || "").trim());
  // Quantile q (0..1) of an ascending list, by linear interpolation.
  function quantile(sorted, q) {
    if (!sorted.length) return null;
    const at = (sorted.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
  }
  // The three medal scores of a drill entry: { bronze, silver, gold, source: "custom" | "history" } or null (not enough runs yet).
  // In the entry's own units: for a lower-is-better drill gold is the smallest number.
  function thresholds(entry) {
    if (!entry) return null;
    const c = entry.custom;
    if (c && num(c.bronze) && num(c.silver) && num(c.gold)) return { bronze: c.bronze, silver: c.silver, gold: c.gold, source: "custom" };
    const good = (entry.runs || []).filter((r) => r && !r.died && num(r.score)).slice(-WINDOW).map((r) => (entry.lower ? -r.score : r.score)).sort((a, b) => a - b);
    if (good.length < MIN_RUNS) return null;
    const b = quantile(good, 0.5), s = Math.max(b, quantile(good, SILVER_Q)), g = Math.max(s, good[good.length - 1]), back = (v) => r2(entry.lower ? -v : v);
    return { bronze: back(b), silver: back(s), gold: back(g), source: "history" };
  }
  const goodness = (score, lower) => (lower ? -score : score);
  // The best medal a score reaches with those thresholds, or null.
  function medalFor(score, th, lower) {
    if (!th || !num(score)) return null;
    let medal = null;
    for (const t of MEDALS) if (goodness(score, lower) >= goodness(th[t], lower) - 1e-9) medal = t;
    return medal;
  }
  // The medal above the one a score has (null at gold), the score it needs, and how far away that is (always positive).
  function nextMedal(score, th, lower) {
    if (!th || !num(score)) return null;
    const have = medalFor(score, th, lower), at = have ? MEDALS.indexOf(have) + 1 : 0;
    if (at >= MEDALS.length) return null;
    const tier = MEDALS[at];
    return { tier, score: th[tier], gap: r2(Math.abs(th[tier] - score)) };
  }
  const emptyEntry = (name, unit) => ({ name: name || "", unit: unit || "", lower: lowerBetter(unit), runs: [], best: null, bestMedal: null, medals: { bronze: 0, silver: 0, gold: 0 }, custom: null });
  // Adds a finished run to the runs state (a plain object { [code]: entry }, changed in place) and returns what the run earned:
  // { entry, medal, thresholds (the ones the run was compared with), isBest, next (the medal above) }.
  // run = { code, name, unit, score, end ("died" | "cleared" | "time" | ...), at }.
  function recordRun(state, run) {
    if (!state || !run || !CODE_RE.test(String(run.code || "")) || !num(run.score)) return null;
    const entry = state[run.code] || (state[run.code] = emptyEntry(run.name, run.unit));
    if (run.name) entry.name = run.name;
    if (run.unit != null) { entry.unit = String(run.unit); entry.lower = lowerBetter(run.unit); }
    const died = run.end === "died";
    const th = thresholds(entry); // compared with the runs BEFORE this one
    const medal = died ? null : medalFor(run.score, th, entry.lower);
    const prevBest = entry.best;
    const isBest = !died && (prevBest === null || goodness(run.score, entry.lower) > goodness(prevBest, entry.lower));
    entry.runs.push({ at: run.at ?? Date.now(), score: run.score, died, medal });
    if (entry.runs.length > KEEP_RUNS) entry.runs.splice(0, entry.runs.length - KEEP_RUNS);
    if (isBest) entry.best = run.score;
    if (medal) { entry.medals[medal] = (entry.medals[medal] || 0) + 1; if (!entry.bestMedal || MEDALS.indexOf(medal) > MEDALS.indexOf(entry.bestMedal)) entry.bestMedal = medal; }
    return { entry, medal, thresholds: th, isBest: isBest && prevBest !== null, firstRun: prevBest === null && !died, next: died ? null : nextMedal(run.score, th, entry.lower) };
  }

  // ---- routines ----
  const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  function normalizeStep(s) {
    if (!s || typeof s !== "object" || !CODE_RE.test(String(s.code || ""))) return null;
    return { code: String(s.code), name: String(s.name || "").trim().slice(0, 80), type: typeof s.type === "string" ? s.type.slice(0, 20) : "",
      runs: clampInt(s.runs, 1, MAX_RUNS_PER_STEP, 1), minScore: num(s.minScore) ? s.minScore : s.minScore !== "" && s.minScore != null && isFinite(Number(s.minScore)) ? Number(s.minScore) : null,
      minMedal: MEDALS.includes(s.minMedal) ? s.minMedal : null, rank: typeof s.rank === "string" && /^[a-z]{2,16}$/.test(s.rank) ? s.rank : "" };
  }
  // A routine with its steps cleaned up, or null when it has no name or no valid step.
  function normalizeRoutine(r) {
    if (!r || typeof r !== "object") return null;
    const name = String(r.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const steps = (Array.isArray(r.steps) ? r.steps : []).map(normalizeStep).filter(Boolean).slice(0, MAX_STEPS);
    if (!name || !steps.length) return null;
    return { id: typeof r.id === "string" && /^[a-z0-9-]{1,40}$/i.test(r.id) ? r.id : "rt-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, steps };
  }
  // Does a run count for a step? -> { counted, why } (why: "other-drill" | "died" | "score" | "medal" | null).
  function counts(step, run, medal, lower) {
    if (!step || run.code !== step.code) return { counted: false, why: "other-drill" };
    if (run.end === "died") return { counted: false, why: "died" };
    if (num(step.minScore) && goodness(run.score, lower) < goodness(step.minScore, lower) - 1e-9) return { counted: false, why: "score" };
    if (step.minMedal && (!medal || MEDALS.indexOf(medal) < MEDALS.indexOf(step.minMedal))) return { counted: false, why: "medal" };
    return { counted: true, why: null };
  }
  // The active routine after a run: { active (new object or null when the routine is complete), counted, why, stepDone, routineDone, next (the next step or null) }.
  function applyRun(routine, active, run, medal, lower) {
    if (!routine || !active) return { active, counted: false, why: "no-routine", stepDone: false, routineDone: false, next: null };
    const step = routine.steps[active.step];
    const c = counts(step, run, medal, lower);
    if (!c.counted) return { active, counted: false, why: c.why, stepDone: false, routineDone: false, next: null };
    const log = (active.log || []).concat([{ step: active.step, code: run.code, score: run.score, at: run.at ?? Date.now() }]).slice(-MAX_LOG);
    let counted = active.counted + 1, stepIndex = active.step, stepDone = false;
    if (counted >= step.runs) { stepDone = true; stepIndex++; counted = 0; }
    if (stepIndex >= routine.steps.length) return { active: null, counted: true, why: null, stepDone: true, routineDone: true, next: null, log };
    return { active: { ...active, step: stepIndex, counted, log }, counted: true, why: null, stepDone, routineDone: false, next: stepDone ? routine.steps[stepIndex] : null };
  }
  const whyText = { "other-drill": "", died: "You died, so this run did not count.", score: "Below the score this step needs.", medal: "Below the medal this step needs.", "no-routine": "" };
  // A short sentence for a step's requirement, for the screens.
  function stepText(step, entry) {
    const bits = [step.runs === 1 ? "1 run" : step.runs + " runs"];
    if (num(step.minScore)) bits.push("score " + (entry && entry.lower ? "at most " : "at least ") + step.minScore);
    if (step.minMedal) bits.push(MEDAL_LABEL[step.minMedal] + " medal or better");
    return bits.join(", ");
  }

  const logic = { MEDALS, MEDAL_LABEL, MIN_RUNS, WINDOW, KEEP_RUNS, lowerBetter, quantile, thresholds, medalFor, nextMedal, emptyEntry, recordRun, normalizeStep, normalizeRoutine, counts, applyRun, stepText, whyText };

  // ================================================================ storage
  const read = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === "object" ? v : fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  const loadRuns = () => { const v = read(RUNS_KEY, {}); return Array.isArray(v) ? {} : v; };
  const loadRoutines = () => {
    const v = read(ROUTINES_KEY, {});
    return { routines: (Array.isArray(v.routines) ? v.routines : []).map(normalizeRoutine).filter(Boolean).slice(0, MAX_ROUTINES), active: v.active && typeof v.active === "object" ? v.active : null,
      done: Array.isArray(v.done) ? v.done.slice(-MAX_DONE) : [] };
  };
  const changed = () => { try { window.dispatchEvent(new CustomEvent("aim-routines-change")); } catch {} };
  const saveRoutines = (s) => { const ok = write(ROUTINES_KEY, s); changed(); return ok; };
  const saveRuns = (s) => { const ok = write(RUNS_KEY, s); changed(); return ok; };

  const api = {
    logic,
    runs: loadRuns,
    routines: () => loadRoutines().routines,
    state: loadRoutines,
    active() {
      const s = loadRoutines(), a = s.active, r = a && s.routines.find((x) => x.id === a.routineId);
      return r ? { routine: r, ...a } : null;
    },
    saveRoutine(r) {
      const clean = normalizeRoutine(r);
      if (!clean) return null;
      const s = loadRoutines(), at = s.routines.findIndex((x) => x.id === clean.id);
      if (at >= 0) s.routines[at] = clean; else if (s.routines.length < MAX_ROUTINES) s.routines.push(clean); else return null;
      saveRoutines(s);
      return clean;
    },
    deleteRoutine(id) {
      const s = loadRoutines();
      s.routines = s.routines.filter((x) => x.id !== id);
      if (s.active && s.active.routineId === id) s.active = null;
      saveRoutines(s);
    },
    start(id) {
      const s = loadRoutines();
      if (!s.routines.some((x) => x.id === id)) return null;
      s.active = { routineId: id, step: 0, counted: 0, startedAt: Date.now(), log: [] };
      saveRoutines(s);
      return s.active;
    },
    stop() { const s = loadRoutines(); s.active = null; saveRoutines(s); },
    // Sets the medal scores of a drill by hand (th = { bronze, silver, gold }), or back to the automatic ones (null).
    setCustom(code, th) {
      if (!CODE_RE.test(String(code || ""))) return false;
      const runs = loadRuns(), entry = runs[code] || (runs[code] = emptyEntry("", ""));
      if (th === null) entry.custom = null;
      else {
        const t = { bronze: Number(th.bronze), silver: Number(th.silver), gold: Number(th.gold) };
        if (![th.bronze, th.silver, th.gold].every((v) => v !== "" && v != null && isFinite(Number(v))) || ![t.bronze, t.silver, t.gold].every(isFinite)) return false;
        entry.custom = t;
      }
      return saveRuns(runs);
    },
    forgetDrill(code) { const runs = loadRuns(); delete runs[code]; saveRuns(runs); },
    // A finished run: medal, personal best, and the active routine. Returns { medal, isBest, ..., routine: applyRun's answer, routineName } or null.
    finishRun(run) {
      const runs = loadRuns(), got = recordRun(runs, run);
      if (!got) return null;
      saveRuns(runs);
      const s = loadRoutines(), routine = s.active && s.routines.find((x) => x.id === s.active.routineId);
      let progress = null;
      if (routine) {
        progress = applyRun(routine, s.active, run, got.medal, got.entry.lower);
        if (progress.counted) {
          s.active = progress.active;
          if (progress.routineDone) s.done = s.done.concat([{ id: routine.id, name: routine.name, at: Date.now(), startedAt: (progress.log && progress.log[0] && progress.log[0].at) || Date.now(), runs: (progress.log || []).length }]).slice(-MAX_DONE);
          saveRoutines(s);
        }
      }
      return { ...got, progress, routine: routine || null };
    },
  };

  // ================================================================ the game's screens
  const doc = typeof document === "undefined" ? null : document;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let current = null;           // share code of the drill being played (the game announces every scene it loads)
  const names = new Map();      // share code -> { name, type }
  async function loadNames() {
    if (names.size || typeof fetch !== "function") return names;
    try {
      const res = await fetch("/prod-api/api/v1/public/val/aimlab/workshop", { cache: "no-store" });
      const j = await res.json();
      for (const it of Array.isArray(j && j.data) ? j.data : []) if (it && CODE_RE.test(String(it.shareCode || ""))) names.set(it.shareCode, { name: String(it.name || ""), type: String(it.type || ""), map: it.mapId || null, description: String(it.description || "") });
    } catch {}
    return names;
  }
  api.drills = async () => new Map(await loadNames());

  // Starts a drill from the lobby: a Target Workshop drill ("ball") from its tab's card, any other from the first (VALORANT Training) tab.
  // Leaves a round first when one is up (the result screen's Exit button). Resolves to true when a Start / Play button was clicked.
  let starting = false;
  async function startDrill(code, type) {
    if (!doc || starting || !CODE_RE.test(String(code || ""))) return false;
    starting = true;
    try {
      if (!type) type = ((await loadNames()).get(code) || {}).type || "";
      const exit = resultExit();
      if (exit) exit.click();
      const until = Date.now() + 20000;
      while (Date.now() < until && doc.querySelector(".al-aimlab-root")) await wait(100);
      if (doc.querySelector(".al-aimlab-root")) return false;
      if (type === "ball") {
        const tab = [...doc.querySelectorAll("button.hall-tab, [data-action='tab-ball']")].find((b) => /target workshop/i.test(b.textContent) || b.dataset.action === "tab-ball");
        if (tab && !tab.classList.contains("is-active")) tab.click();
        while (Date.now() < until) {
          const card = doc.querySelector(`.tw-card[data-code="${code}"]`), go = card && card.querySelector('[data-act="play"]');
          if (card && card.scrollIntoView) card.scrollIntoView({ block: "center" });
          if (go) { go.click(); return true; }
          await wait(150);
        }
        return false;
      }
      const tab = doc.querySelector(".hall-tab");
      if (tab && !tab.classList.contains("is-active")) tab.click();
      while (Date.now() < until) {
        const card = doc.querySelector(`[data-role="workshop-card"][data-share-code="${code}"]`), go = card && card.querySelector(".al-wk-split-go, .al-wk-go");
        if (card && card.scrollIntoView) card.scrollIntoView({ block: "center" });
        if (go) { go.click(); return true; }
        await wait(150);
      }
      return false;
    } catch { return false; } finally { starting = false; }
  }
  api.startDrill = startDrill;

  // ---- enemy rank and easy / hard of a step ----
  // The game's own endpoints (enemy-rank-cards.js, sibling-switch.js): /api/local/enemy-rank?codes=a,b -> { ranks: [{ id, name, color }], cards: { code: { eligible, rank } } }
  // and /api/local/drill-sibling?code= -> { code, name, difficulty } (the OTHER difficulty) or {}.
  const rankInfo = { ranks: [], cards: {} };
  const siblings = new Map(); // code -> { code, name, difficulty } | null
  const infoAsked = new Set();
  // Reads the rank and sibling answers of drills not asked about yet. Resolves to true when something new arrived (the page then redraws).
  async function ensureInfo(codes) {
    const need = [...new Set(codes || [])].filter((c) => CODE_RE.test(String(c || "")) && !infoAsked.has(c));
    if (!need.length || typeof fetch !== "function") return false;
    need.forEach((c) => infoAsked.add(c));
    let changed = false;
    try {
      const r = await fetch("/api/local/enemy-rank?codes=" + need.join(","), { cache: "no-store" }), j = await r.json();
      if (j && Array.isArray(j.ranks) && j.ranks.length) rankInfo.ranks = j.ranks;
      if (j && j.cards && typeof j.cards === "object") { Object.assign(rankInfo.cards, j.cards); changed = true; }
    } catch { need.forEach((c) => infoAsked.delete(c)); return false; }
    await Promise.all(need.map(async (c) => {
      try { const r = await fetch("/api/local/drill-sibling?code=" + c, { cache: "no-store" }), j = await r.json(); siblings.set(c, j && CODE_RE.test(String(j.code || "")) ? j : null); changed = true; } catch {}
    }));
    return changed;
  }
  const rankEligible = (code) => !!(rankInfo.cards[code] && rankInfo.cards[code].eligible);
  const rankOf = (id) => rankInfo.ranks.find((r) => r.id === id) || (id ? { id, name: id[0].toUpperCase() + id.slice(1), color: "#9aa1ae" } : null);
  // Starts a step: sets its enemy rank first (the way a lobby card does, only for a drill that has bots), then plays the drill.
  async function startStep(step) {
    const code = step && step.code;
    if (!CODE_RE.test(String(code || ""))) return false;
    if (step.rank && /^[a-z]{2,16}$/.test(step.rank)) {
      await ensureInfo([code]);
      if (rankEligible(code)) {
        try { await fetch("/api/local/enemy-rank?set=" + step.rank + "&code=" + code, { headers: { "x-aim-local": "1" }, cache: "no-store" }); rankInfo.cards[code].rank = step.rank; } catch {}
      }
    }
    return startDrill(code, step.type || "");
  }
  api.startStep = startStep; api.ensureInfo = ensureInfo;

  const resultRoot = () => (doc ? doc.querySelector(".al-result-overlay") : null);
  function resultExit() {
    const root = resultRoot();
    if (!root) return null;
    const play = [...root.querySelectorAll("button")].find((b) => /^play again$/i.test(b.textContent.trim()));
    if (!play) return null;
    return [...play.parentElement.children].find((el) => el !== play && el.tagName === "BUTTON" && !el.classList.contains("aim-rt-btn") && (el.dataset.action === "exit" || el.classList.contains("al-secondary-btn"))) || null;
  }
  // What the result screen shows: { score, unit, end } or null while it has no score. end = "died" | "cleared" | "time".
  function readResult(root) {
    const big = root.querySelector(".al-big-score");
    if (!big) return null;
    const small = big.querySelector("small"), unit = small ? small.textContent.trim() : "";
    const text = String(big.textContent || "").replace(unit, "").replace(/,/g, "").trim(), m = /^-?\d+(?:\.\d+)?/.exec(text);
    if (!m) return null;
    const splash = root.querySelector(".al-result-verdict-splash");
    const end = !splash ? "time" : splash.classList.contains("is-died") ? "died" : splash.classList.contains("is-cleared") ? "cleared" : "time";
    return { score: parseFloat(m[0]), unit, end };
  }

  // ---- the strip on the result screen ----
  const CSS = `
.aim-rt-strip { margin: 10px 0; padding: 12px 14px; background: var(--es-panel, #10131a); border: 1px solid var(--es-line, #272d39); border-left: 4px solid var(--es-red, #ff4655); clip-path: var(--es-cut); color: #d7dde6; font: 13px/1.45 inherit; display: grid; gap: 6px; }
.aim-rt-strip b { color: #fff; }
.aim-rt-medal { display: inline-flex; align-items: center; gap: 6px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.aim-rt-medal .es-rt-badge { width: 28px; height: 31px; flex: none; filter: drop-shadow(0 2px 4px rgba(0,0,0,.6)); }

.aim-rt-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; }
.aim-rt-muted { color: #8b94a3; font-size: 12px; }
.aim-rt-bar { height: 6px; background: var(--es-raised, #171b23); position: relative; flex: 1 1 140px; min-width: 120px; } .aim-rt-bar i { position: absolute; inset: 0 auto 0 0; background: var(--es-red, #ff4655); }
html[data-aim-local]:not(#es) body .aim-rt-btn { height: 34px; padding: 0 24px !important; background: var(--es-red, #ff4655) !important; color: #fff !important; border: 0 !important; border-radius: 0 !important; clip-path: var(--es-slant) !important; box-shadow: none !important;
  font: 800 13px/1 var(--es-head, "Bahnschrift", sans-serif) !important; font-stretch: 75% !important; letter-spacing: .06em; text-transform: uppercase !important; cursor: pointer; }
html[data-aim-local]:not(#es) body .aim-rt-btn:hover { background: var(--es-red-2, #ff6b77) !important; }
/* ui-result (20 Nov 2026). Inside the result card the strip is a full-width band like the stat strip under it: no cut corner
   and no right border against the card's edge. The medal name uses the theme's condensed italic heading type. */
html[data-aim-local]:not(#es) body .al-result-modal .aim-rt-strip { clip-path: none; border-width: 1px 0 1px 4px; }
.aim-rt-medal { font: 800 italic 16px/1.1 var(--es-head, "Bahnschrift", sans-serif); font-stretch: 75%; color: #fff; }
/* The run is read once the score has counted up (SETTLE_MS), well after the card appeared: a hidden one-row strip holds its
   place from the start, so the card does not jump when the medal line arrives; the line then slides in once. */
.aim-rt-strip.is-pending { visibility: hidden; min-height: 44px; box-sizing: border-box; }
.aim-rt-strip.is-in { animation: es-rx-in-left 0.25s cubic-bezier(0.22, 1, 0.36, 1) both; }
@media (prefers-reduced-motion: reduce) { .aim-rt-strip.is-in { animation: none; } }
`;
  function injectCss() {
    try {
      if (!doc || doc.getElementById("aim-routines-css")) return;
      const style = doc.createElement("style");
      style.id = "aim-routines-css";
      style.textContent = CSS;
      (doc.head || doc.documentElement).appendChild(style);
    } catch {}
  }
  const medalBadge = (m) => (m ? medalSpan("aim-rt-medal", m, MEDAL_LABEL[m] + " medal") : "");
  // The strip's HTML for a finished run (the answer of finishRun) - pure, for the screen and for tests.
  function stripHtml(res, ctx = {}) {
    if (!res) return "";
    const e = res.entry, unit = e.unit ? " " + esc(e.unit) : "", parts = [];
    const head = [];
    if (res.medal) head.push(medalBadge(res.medal));
    else if (ctx.died) head.push(`<span class="aim-rt-muted">You died: no medal for this run.</span>`);
    else if (!res.thresholds) head.push(`<span class="aim-rt-muted">Medals unlock after ${MIN_RUNS} runs of this drill (${Math.min(MIN_RUNS, e.runs.filter((r) => !r.died).length)} of ${MIN_RUNS} done).</span>`);
    else head.push(`<span class="aim-rt-muted">No medal this time.</span>`);
    if (res.isBest) head.push(`<b>New personal best</b>`);
    if (res.next) head.push(`<span class="aim-rt-muted">${esc(MEDAL_LABEL[res.next.tier])} at ${esc(res.next.score)}${unit}: ${esc(res.next.gap)}${unit} to go</span>`);
    parts.push(`<div class="aim-rt-row">${head.join("")}</div>`);
    const p = res.progress, r = res.routine;
    if (r && p) {
      const step = r.steps[p.routineDone ? r.steps.length - 1 : p.stepDone ? p.active.step - 1 : p.active.step];
      let line;
      if (p.routineDone) line = `<b>Routine complete:</b> ${esc(r.name)}`;
      else if (p.counted) line = p.stepDone ? `Step done. <b>Next:</b> ${esc(p.next.name || p.next.code)}` : `Counted for <b>${esc(r.name)}</b>: run ${p.active.counted} of ${step.runs}`;
      else if (p.why && whyText[p.why]) line = `<b>${esc(r.name)}</b>: ${esc(whyText[p.why])}`;
      else line = `<b>${esc(r.name)}</b>`;
      let bar = "";
      if (!p.routineDone && p.active) bar = `<span class="aim-rt-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${r.steps.length}" aria-valuenow="${p.active.step}"><i style="width:${Math.round(((p.active.step + (p.active.counted / (r.steps[p.active.step].runs || 1))) / r.steps.length) * 100)}%"></i></span>`;
      parts.push(`<div class="aim-rt-row"><span>${line}</span>${bar}${!p.routineDone && p.active ? `<span class="aim-rt-muted">Step ${p.active.step + 1} of ${r.steps.length}</span>` : ""}</div>`);
      if (!p.routineDone && p.stepDone && p.next) parts.push(`<div class="aim-rt-row"><button type="button" class="aim-rt-btn" data-rt-next="${esc(p.next.code)}" data-rt-type="${esc(p.next.type || "")}" data-rt-rank="${esc(p.next.rank || "")}">Next drill</button></div>`);
    }
    return parts.join("");
  }

  const handled = new WeakSet(), seen = new WeakMap(), results = new WeakMap();
  function place(root, html) {
    let strip = root.querySelector(".aim-rt-strip");
    if (!strip) {
      strip = doc.createElement("div");
      strip.className = "aim-rt-strip";
      strip.addEventListener("click", (event) => {
        const b = event.target && event.target.closest ? event.target.closest("[data-rt-next]") : null;
        if (b) { event.preventDefault(); startStep({ code: b.dataset.rtNext, type: b.dataset.rtType || "", rank: b.dataset.rtRank || "" }); }
      });
    }
    const hero = root.querySelector(".al-run-hero"), body = root.querySelector(".al-run-body");
    if (hero && hero.parentElement) { if (hero.nextElementSibling !== strip) hero.after(strip); }
    else if (body) { if (strip.parentElement !== body) body.prepend(strip); }
    else if (strip.parentElement !== root) root.appendChild(strip);
    if (strip.dataset.html !== html) { strip.innerHTML = html; strip.dataset.html = html; }
  }
  function sync() {
    try {
      const root = resultRoot();
      if (!root) return;
      if (results.has(root)) { place(root, results.get(root)); return; } // put back after a re-render
      if (handled.has(root) || !current) return;
      if (!seen.has(root)) {
        seen.set(root, Date.now());
        injectCss();
        place(root, ""); setStripClass(root, "is-pending", true); // holds the line's place until the run is read
        setTimeout(() => { try { finish(root); } catch {} }, SETTLE_MS);
      }
    } catch {}
  }
  function setStripClass(root, cls, on) { const s = root.querySelector(".aim-rt-strip"); if (s && s.classList) s.classList.toggle(cls, on); return s; }
  const dropPending = (root) => { const s = root.querySelector(".aim-rt-strip.is-pending"); if (s) s.remove(); };
  async function finish(root) {
    if (handled.has(root) || !root.isConnected) return;
    const read1 = readResult(root);
    if (!read1) { dropPending(root); return; }
    handled.add(root);
    await loadNames();
    const info = names.get(current) || {};
    const res = api.finishRun({ code: current, name: info.name || "", unit: read1.unit, score: read1.score, end: read1.end, at: Date.now() });
    if (!res) { dropPending(root); return; }
    injectCss();
    const html = stripHtml(res, { died: read1.end === "died" });
    results.set(root, html);
    place(root, html);
    setStripClass(root, "is-pending", false); setStripClass(root, "is-in", true);
    setTimeout(() => { try { setStripClass(root, "is-in", false); } catch {} }, 600); // once: a later move of the strip does not replay it
  }
  if (doc) {
    window.addEventListener("aim-local-scene", (event) => { current = event.detail && event.detail.id ? String(event.detail.id) : null; });
    if (window.__aimWatchPage) window.__aimWatchPage(() => requestAnimationFrame(sync), { childList: true, subtree: true });
    injectCss();
  }


  // ================================================================ the Routines page (a lobby tab)
  const DRAFT_KEY = "aim-rt-draft-v1";
  const blankStep = (code, name, type) => ({ code: code || "", name: name || "", type: type || "", runs: 1, minScore: "", minMedal: "", rank: "" });
  const rawStep = (st) => ({ code: String((st && st.code) || ""), name: String((st && st.name) || ""), type: String((st && st.type) || ""), runs: st && st.runs != null ? st.runs : 1,
    minScore: st && st.minScore != null ? st.minScore : "", minMedal: st && MEDALS.includes(st.minMedal) ? st.minMedal : "", rank: st && typeof st.rank === "string" ? st.rank : "" });
  const loadDraft = () => {
    const v = read(DRAFT_KEY, null);
    return v && Array.isArray(v.steps) ? { id: typeof v.id === "string" ? v.id : null, name: String(v.name || ""), steps: v.steps.map(rawStep).slice(0, MAX_STEPS) } : null;
  };
  const saveDraft = (d) => { try { if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); else localStorage.removeItem(DRAFT_KEY); } catch {} changed(); };
  // Adds a drill to the routine being built (starting a new draft when there is none). Returns the number of steps in the draft.
  function addToDraft(code, name, type) {
    if (!CODE_RE.test(String(code || ""))) return 0;
    const d = loadDraft() || { id: null, name: "", steps: [] };
    if (d.steps.length >= MAX_STEPS) return d.steps.length;
    const info = names.get(code) || {};
    d.steps.push(blankStep(code, name || info.name || "", type || info.type || ""));
    saveDraft(d);
    return d.steps.length;
  }
  api.draft = loadDraft; api.saveDraft = saveDraft; api.addToDraft = addToDraft;

  const MEDAL_ORDER = MEDALS;
  const LINES_FOLDED = 8; // a saved routine longer than this (plus 2) lists its first drills and a "Show all" button
  const fmtNum = (v) => (num(v) ? String(+(+v).toFixed(2)) : "–");
  const label = (code, entry, book) => (entry && entry.name) || (book && book.get(code) && book.get(code).name) || String(code).slice(0, 7);
  const kindOf = (d) => (d && d.map ? d.map : d && d.type === "ball" ? "Target Workshop" : "Training");
  const medalDot = (m, n) => '<span class="es-rt-medal is-' + m + (n ? "" : " is-none") + '" title="' + MEDAL_LABEL[m] + ' medals earned">' + medalIcon(m) + (n || 0) + "</span>";

  // ---- thumbnails of Target Workshop drills (they have no map picture) ----
  // The scene's own file (the same one the game loads) is turned into a small picture of what you see at the start: the player's view with a
  // 103-degree field of view (the game's), the targets where the spawners put them (a grid as its dashed cells with the live ones filled,
  // an area as a few targets, a path as a dashed line with the target at its start, a strafer as an arrow), and the crosshair.
  const FOV_H_DEG = 103, EYE_M = 1.75;
  const sceneCache = new Map();
  function sceneFor(code) {
    if (!sceneCache.has(code)) {
      sceneCache.set(code, (async () => {
        try {
          const res = await fetch("/prod-api/api/v1/public/val/aimlab/scenes/" + code, { cache: "no-store" });
          const j = await res.json(), x = (j && j.data) || j, doc = typeof x.doc === "string" ? JSON.parse(x.doc) : x.doc;
          return doc && typeof doc === "object" ? doc : null;
        } catch { sceneCache.delete(code); return null; }
      })());
    }
    return sceneCache.get(code);
  }
  // The picture as plain numbers on a w x h canvas: { balls: [{ x, y, r, live }], lines: [[x, y], ...][], arrows: [{ x, y, len }] } (a ball with live false is a dashed cell).
  function thumbModel(doc, w, h) {
    const out = { balls: [], lines: [], arrows: [] };
    if (!doc || !doc.playerSpawn || !doc.playerSpawn.position) return out;
    const ps = doc.playerSpawn.position, yaw = doc.playerSpawn.yaw || 0, eye = (ps.y || 0) + EYE_M;
    const fwd = [-Math.sin(yaw), -Math.cos(yaw)], right = [Math.cos(yaw), -Math.sin(yaw)];
    const focal = w / 2 / Math.tan((FOV_H_DEG / 2) * Math.PI / 180);
    const at = (p) => {
      const rx = (p.x || 0) - ps.x, rz = (p.z || 0) - ps.z, depth = rx * fwd[0] + rz * fwd[1];
      if (!(depth > 0.5)) return null;
      return { x: w / 2 + ((rx * right[0] + rz * right[1]) / depth) * focal, y: h / 2 - (((p.y || 0) - eye) / depth) * focal, k: focal / depth };
    };
    const actors = new Map((doc.actors || []).map((a) => [a.id, a]));
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const radiusOf = (a) => (a && a.body && a.body.radius > 0 ? a.body.radius : 0.36 * ((a && a.body && a.body.headSize) || 1));
    for (const sp of doc.spawners || []) {
      const a = actors.get(sp.actorTemplateId), r = radiusOf(a), pos = sp.position || {}, size = sp.size || {};
      const path = a && (a.behaviors || []).find((b) => b.kind === "path" && Array.isArray(b.waypoints) && b.waypoints.length);
      const strafe = a && (a.behaviors || []).find((b) => b.kind === "strafe" || b.kind === "sway"); // side-to-side movers get the arrow
      if (path) {
        const pts = path.waypoints.map(at).filter(Boolean);
        if (pts.length > 1) out.lines.push(pts.map((p) => [p.x, p.y]));
        const first = at(path.waypoints[0]);
        if (first) out.balls.push({ x: first.x, y: first.y, r: r * first.k, live: true });
        continue;
      }
      if (sp.kind === "grid" && sp.columns > 0 && sp.rows > 0) {
        const cells = [];
        for (let rr = 0; rr < sp.rows; rr++) for (let cc = 0; cc < sp.columns; cc++) cells.push({ x: (pos.x || 0) + (cc + 0.5 - sp.columns / 2) * ((size.x || 0) / sp.columns), y: (pos.y || 0) + (sp.rows / 2 - rr - 0.5) * ((size.y || 0) / sp.rows), z: pos.z || 0 });
        const live = new Set();
        while (live.size < Math.min(sp.maxAlive || 1, cells.length)) live.add(Math.floor(rand() * cells.length));
        cells.forEach((c, i) => { const p = at(c); if (p) out.balls.push({ x: p.x, y: p.y, r: r * p.k, live: live.has(i) }); });
        continue;
      }
      const n = Math.max(1, Math.min(sp.maxAlive || 1, 6));
      for (let i = 0; i < n; i++) {
        const p = at({ x: (pos.x || 0) + (rand() - 0.5) * (size.x || 0), y: (pos.y || 0) + (rand() - 0.5) * (size.y || 0), z: (pos.z || 0) + (rand() - 0.5) * (size.z || 0) });
        if (!p) continue;
        out.balls.push({ x: p.x, y: p.y, r: r * p.k, live: true });
        if (strafe && i === 0) out.arrows.push({ x: p.x, y: p.y, len: 2.5 * p.k });
      }
    }
    // A dispatcher drill ("points light up in turn", 1.6.0): every route with a fixed place is a dashed cell, as many as the dispatcher lights at once are filled.
    for (const d of doc.dispatchers || []) {
      const spots = (d.routes || []).filter((rt) => rt && rt.at && actors.get(rt.templateId)), live = Math.max(1, Math.min(8, Math.round(d.maxAlive || 1)));
      spots.forEach((rt, i) => { const p = at(rt.at); if (p) out.balls.push({ x: p.x, y: p.y, r: radiusOf(actors.get(rt.templateId)) * p.k, live: i < live }); });
    }
    return out;
  }
  function drawThumb(canvas, doc) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const dark = (() => { try { return localStorage.getItem("aim-target-workshop-backdrop-v1") === "black"; } catch { return false; } })();
    const sh = Math.max(h, w * 9 / 16), sw = sh * 16 / 9, m = thumbModel(doc, sw, sh);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = dark ? "#0c0f14" : "#e9ecf0"; ctx.fillRect(0, 0, w, h);
    // the crosshair first: a target straight ahead (many drills start with one there) is drawn over it, not hidden by it
    const arm = Math.max(3, Math.min(6, w / 18)); // a small thumbnail gets a small crosshair
    ctx.strokeStyle = dark ? "#fff" : "#111"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(w / 2 - arm, h / 2); ctx.lineTo(w / 2 + arm, h / 2); ctx.moveTo(w / 2, h / 2 - arm); ctx.lineTo(w / 2, h / 2 + arm); ctx.stroke();
    ctx.save(); ctx.translate(-(sw - w) / 2, -(sh - h) / 2);
    const ink = dark ? "#8b94a3" : "#6b7280";
    ctx.lineWidth = 1.2; ctx.strokeStyle = ink; ctx.setLineDash([3, 3]);
    for (const line of m.lines) { ctx.beginPath(); line.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
    for (const b of m.balls) if (!b.live) { ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(2, b.r), 0, 7); ctx.stroke(); }
    ctx.setLineDash([]); ctx.lineWidth = 1.6;
    for (const a of m.arrows) { ctx.beginPath(); ctx.moveTo(a.x - a.len, a.y); ctx.lineTo(a.x + a.len, a.y); ctx.stroke(); }
    ctx.fillStyle = "#ff4655";
    for (const b of m.balls) if (b.live) { ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(3, b.r), 0, 7); ctx.fill(); }
    ctx.restore();
    return true;
  }
  // Paints every unpainted thumbnail canvas inside root (the gallery cards of Target Workshop drills).
  function paintThumbs(root) {
    if (!root || !root.querySelectorAll) return;
    for (const cv of root.querySelectorAll("canvas[data-thumb]")) {
      if (cv.dataset.done) continue;
      const code = cv.dataset.thumb;
      sceneFor(code).then((doc) => { if (doc && cv.isConnected && !cv.dataset.done && drawThumb(cv, doc)) cv.dataset.done = "1"; });
    }
  }

  // ---- the drill picker (a drop-down panel with a gallery of cards) ----
  // Three lists: BOOKMARKED (the game's own bookmarks, localStorage "aim-offline-favorites-v1": ["ws-<code>", ...]), RECENTLY PLAYED (newest first,
  // from the analytics rounds and the runs kept here) and ALL drills. A search looks through ALL of them whichever list is showing.
  const FAV_KEY = "aim-offline-favorites-v1";
  const readFavs = () => { try { const v = JSON.parse(localStorage.getItem(FAV_KEY)); return (Array.isArray(v) ? v : []).map((x) => String(x).replace(/^ws-/, "")).filter((c) => /^[a-f0-9]{16}$/.test(c)); } catch { return []; } };
  const PICK_ALL_MAX = 600, PICK_SEARCH_MAX = 600; // every drill (the tab's count is the whole library); images load lazily
  // The drills of the picker as [code, drill][] for a list ("bookmarked" | "recent" | "all") and a search (every word in the name, the map or the kind).
  function pickerList(book, tab, query, favs, recents) {
    const q = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    const known = (c) => book.has(c);
    if (q.length) {
      const out = [];
      for (const [code, d] of book) {
        const hay = (d.name + " " + (d.map || "") + " " + (d.type === "ball" ? "target workshop tracking flick" : d.type || "")).toLowerCase();
        if (q.every((w) => hay.includes(w))) out.push([code, d]);
        if (out.length >= PICK_SEARCH_MAX) break;
      }
      return out;
    }
    if (tab === "bookmarked") return (favs || []).filter(known).map((c) => [c, book.get(c)]);
    if (tab === "recent") return (recents || []).filter(known).map((c) => [c, book.get(c)]);
    return [...book].sort((x, y) => (!x[1].map - !y[1].map) || (x[1].map || "").localeCompare(y[1].map || "") || (x[1].name || "").localeCompare(y[1].name || "")).slice(0, PICK_ALL_MAX);
  }
  const MAP_ART = (map) => (map && /^[a-z0-9_-]{1,40}$/i.test(map) ? "/aim-maps/" + map + ".cover.webp" : "");
  // One gallery card: art (the map's picture, or a plain tile for map-less Target Workshop drills), name, kind, medal and how often it is in the routine.
  function galleryCardHtml(code, d, entry, inCount, full) {
    const art = MAP_ART(d.map), chip = entry && entry.bestMedal ? '<span class="es-rt-gmedal is-' + entry.bestMedal + '">' + medalIcon(entry.bestMedal) + MEDAL_LABEL[entry.bestMedal] + "</span>" : "";
    return '<button type="button" class="es-rt-gcard' + (inCount ? " is-in" : "") + '" data-rt="add" data-code="' + esc(code) + '" title="' + (full ? "The routine is full (" + MAX_STEPS + " drills)" : "Add " + esc(d.name)) + '"' + (full ? " disabled" : "") + ">"
      + '<span class="es-rt-gart' + (art || d.type === "ball" ? "" : " is-plain") + '">' + (art ? '<img src="' + esc(art) + '" alt="" loading="lazy" decoding="async">' : d.type === "ball" ? '<canvas class="es-rt-gcanvas" data-thumb="' + esc(code) + '"></canvas>' : "<em>Drill</em>") + chip
      + (inCount ? '<span class="es-rt-gin">✓ ' + (inCount > 1 ? "×" + inCount : "Added") + "</span>" : '<span class="es-rt-gadd">+ Add</span>') + "</span>"
      + "<b>" + esc(d.name || String(code).slice(0, 7)) + "</b><small>" + esc(kindOf(d)) + "</small></button>";
  }
  const PICK_TABS = [["bookmarked", "Bookmarked"], ["recent", "Recently played"], ["all", "All drills"]];
  function galleryHtml(book, runs, p, draft) {
    const list = pickerList(book, p.tab, p.query, p.favs, p.recents), counts = {};
    for (const st of (draft && draft.steps) || []) counts[st.code] = (counts[st.code] || 0) + 1;
    if (!list.length) {
      const q = String(p.query || "").trim();
      return '<p class="es-rt-empty">' + (q ? "No drill matches that." : p.tab === "bookmarked" ? "No bookmarks yet. Press the bookmark on any drill card in the lobby and it shows up here." : p.tab === "recent" ? "Nothing played yet. Finish a drill and it shows up here." : "No drills found.") + "</p>";
    }
    const full = ((draft && draft.steps) || []).length >= MAX_STEPS;
    return list.map(([code, d]) => galleryCardHtml(code, d, (runs || {})[code], counts[code] || 0, full)).join("");
  }
  // The line over the gallery: how many drills a search found, or that the routine is full.
  function pickNoteHtml(book, p, draft) {
    const q = String(p.query || "").trim(), n = (draft && draft.steps.length) || 0;
    if (n >= MAX_STEPS) return "The routine is full: a routine holds up to " + MAX_STEPS + " drills. Remove one to add another.";
    if (!q) return "";
    const found = pickerList(book, p.tab, q, p.favs, p.recents).length;
    return (found === 1 ? "1 drill matches" : found + " drills match") + " “" + esc(q) + "” in all drills";
  }
  function pickerHtml(book, runs, p, draft) {
    const n = (draft && draft.steps.length) || 0, q = String(p.query || "").trim();
    const count = (id) => (id === "bookmarked" ? pickerList(book, "bookmarked", "", p.favs, p.recents).length : id === "recent" ? pickerList(book, "recent", "", p.favs, p.recents).length : book.size);
    return '<div class="es-rt-pick' + (p.anim ? " is-enter" : "") + '" data-rt-pick role="dialog" aria-label="Add a drill"><div class="es-rt-pick-bar">'
      + '<input type="search" data-rt-q placeholder="Search every drill by name or map…" aria-label="Search drills" title="Type to search · ↓ to the cards · Esc closes" value="' + esc(p.query || "") + '" autocomplete="off">'
      + '<div class="es-rt-chips" role="tablist">' + PICK_TABS.map(([id, t]) => '<button type="button" role="tab" aria-selected="' + (!q && p.tab === id) + '" class="' + (!q && p.tab === id ? "is-on" : "") + '" data-rt="picker-tab" data-tab="' + id + '">' + t + " <small>" + count(id) + "</small></button>").join("") + "</div>"
      + '<button type="button" class="es-rt-primary" data-rt="picker-close">Done' + (n ? " (" + n + ")" : "") + "</button></div>"
      + '<p class="es-rt-note es-rt-picknote" data-rt-picknote aria-live="polite">' + pickNoteHtml(book, p, draft) + "</p>"
      + '<div class="es-rt-gal" data-rt-gal>' + galleryHtml(book, runs, p, draft) + "</div></div>";
  }
  // ---- the enemy rank of a step: the lobby card's own control (big badge, two arrows, pips, name) over the thumbnail ----
  // The classes are enemy-rank-cards.js's (es-rank-hero / -row / -pips / -name / -sub), so it looks like the gallery card. The arrows are our own class (es-rt-rarrow,
  // styled the same): enemy-rank-cards.js swallows every click on .es-rank-arrow at the document, for the lobby cards.
  // The step keeps "" while it is at the rank the drill was made with (the drill's default), exactly like the card.
  const rankSub = (r) => (r.reaction ? "Reacts " + ((r.reaction[0] + r.reaction[1]) / 2).toFixed(2) + " s · " + (r.heads ? "goes for your head" : "aims at your body") : "Bots don't shoot back");
  // The rank a step gets when an arrow is pressed (dir -1 lower, +1 higher), as the value to store ("" = the drill's default). info = { made, rank }.
  function rankStep(st, info, ranks, dir) {
    if (!info || !ranks || !ranks.length) return st.rank || "";
    const made = info.made || info.rank, eff = st.rank || made, at = Math.max(0, ranks.findIndex((r) => r.id === eff));
    const next = ranks[Math.max(0, Math.min(ranks.length - 1, at + (dir < 0 ? -1 : 1)))].id;
    return next === made ? "" : next;
  }
  function rankHeroHtml(st, i, info, ranks) {
    if (!info || !info.eligible || !ranks || !ranks.length) return "";
    const made = info.made || info.rank, eff = st.rank || made, at = Math.max(0, ranks.findIndex((r) => r.id === eff)), r = ranks[at];
    const face = r.id === "off" ? '<div class="es-rank-off">✕</div>' : '<img class="es-rank-badge" src="/studio/icons/ranks/' + esc(r.id) + '.png" alt="" draggable="false">';
    const pips = ranks.slice(1).map((x, k) => "<i" + (k + 1 <= at ? ' class="on"' : "") + "></i>").join("");
    return '<div class="es-rank-hero" data-rank-hero style="--es-rank-color:' + esc(r.color) + ";--es-rank-glow:" + esc(r.color) + '8c" title="Enemy rank: ' + esc(r.name) + (st.rank ? "" : " (the drill's own)") + '">'
      + '<div class="es-rank-row"><button type="button" class="es-rt-rarrow" data-rt="rank-step" data-dir="-1" data-i="' + i + '" aria-label="Lower enemy rank"' + (at === 0 ? " disabled" : "") + ">‹</button>" + face
      + '<button type="button" class="es-rt-rarrow" data-rt="rank-step" data-dir="1" data-i="' + i + '" aria-label="Higher enemy rank"' + (at === ranks.length - 1 ? " disabled" : "") + ">›</button></div>"
      + '<div class="es-rank-pips">' + pips + '</div><div class="es-rank-name">' + esc(r.name) + '</div><div class="es-rank-sub">' + esc(st.rank ? rankSub(r) : "Drill default · " + rankSub(r)) + "</div></div>";
  }
  // ---- a step as a row: thumbnail, information, the step's settings ----
  const artHtml = (code, d) => { const art = MAP_ART(d && d.map); return '<span class="es-rt-gart' + (art || (d && d.type === "ball") ? "" : " is-plain") + '">' + (art ? '<img src="' + esc(art) + '" alt="" loading="lazy" decoding="async">' : d && d.type === "ball" ? '<canvas class="es-rt-gcanvas" data-thumb="' + esc(code) + '"></canvas>' : "<em>Drill</em>") + "</span>"; };
  const rankChip = (id) => { const r = id ? rankOf(id) : null; return r ? '<span class="es-rt-rank" style="--c:' + esc(r.color) + '"><img src="/studio/icons/ranks/' + esc(r.id) + '.png" alt="" onerror="this.remove()">' + esc(r.name) + "</span>" : ""; };
  const statLine = (code, runs) => {
    const e = runs && runs[code];
    if (!e || !e.runs || !e.runs.length) return "Not played yet";
    return "Best " + fmtNum(e.best) + (e.unit ? " " + esc(e.unit) : "") + " · " + e.runs.length + (e.runs.length === 1 ? " run" : " runs") + (e.bestMedal ? " · " + medalSpan("es-rt-medal", e.bestMedal, MEDAL_LABEL[e.bestMedal]) : "");
  };
  function stepInfoHtml(st, book, runs) {
    const d = (book && book.get(st.code)) || { name: st.name, map: null, type: st.type, description: "" };
    return '<div class="es-rt-sinfo"><b class="es-rt-sname">' + esc(label(st.code, { name: st.name }, book)) + "</b><small>" + esc(kindOf(d)) + "</small>"
      + (d.description ? '<p class="es-rt-sdesc">' + esc(d.description) + "</p>" : "") + '<span class="es-rt-sstat">' + statLine(st.code, runs) + "</span></div>";
  }
  // The settings of a step in the editor: runs, minimum score and medal, and, when the drill has them, the enemy rank and the easy / hard switch.
  function stepControlsHtml(st, i) {
    const sib = siblings.get(st.code), own = sib ? (sib.difficulty === "easy" ? "hard" : "easy") : null;
    return '<div class="es-rt-sctl"><label>Runs<input type="number" min="1" max="99" step="1" data-rt-field="runs" data-i="' + i + '" value="' + esc(st.runs) + '"></label>'
      + '<label>Min score<input type="number" step="any" placeholder="any" data-rt-field="minScore" data-i="' + i + '" value="' + esc(st.minScore) + '"></label>'
      + '<label>Min medal<select data-rt-field="minMedal" data-i="' + i + '"><option value="">any</option>' + MEDAL_ORDER.map((m) => '<option value="' + m + '"' + (st.minMedal === m ? " selected" : "") + ">" + MEDAL_LABEL[m] + "</option>").join("") + "</select></label>"
      + (sib ? '<div class="es-rt-seg" role="group" aria-label="Difficulty"><span>Difficulty</span>' + ["easy", "hard"].map((x) => '<button type="button" class="' + (x === own ? "is-on" : "") + '" ' + (x === own ? 'aria-pressed="true"' : 'data-rt="swap-diff" data-i="' + i + '" aria-pressed="false"') + ">" + (x === "easy" ? "Easy" : "Hard") + "</button>").join("") + "</div>" : "") + "</div>";
  }
  // The routine editor. p = the picker state { open, tab, query, favs, recents }.
  function editorHtml(draft, book, runs, p, error) {
    p = p || { open: false, tab: "bookmarked", query: "", favs: [], recents: [] };
    const steps = draft.steps.map((st, i) => '<li class="es-rt-step" data-step="' + i + '"><span class="es-rt-n">' + (i + 1) + '</span><span class="es-rt-sthumb">' + artHtml(st.code, book && book.get(st.code) || { type: st.type }) + rankHeroHtml(st, i, rankInfo.cards[st.code], rankInfo.ranks) + "</span>"
      + stepInfoHtml(st, book, runs) + stepControlsHtml(st, i)
      + '<span class="es-rt-mv"><button type="button" data-rt="up" data-i="' + i + '" aria-label="Move up" title="Move up"' + (i === 0 ? " disabled" : "") + '>↑</button><button type="button" data-rt="down" data-i="' + i + '" aria-label="Move down" title="Move down"' + (i === draft.steps.length - 1 ? " disabled" : "") + '>↓</button><button type="button" class="es-rt-x" data-rt="remove-step" data-i="' + i + '" aria-label="Remove" title="Remove this drill from the routine">✕</button></span></li>').join("");
    const n = draft.steps.length, full = n >= MAX_STEPS;
    return '<section class="es-rt-editor" data-rt-editor><h2>' + (draft.id ? "Edit routine" : "New routine") + (n ? ' <small class="es-rt-count">' + n + (n === 1 ? " drill" : " drills") + (full ? " · full" : "") + "</small>" : "") + "</h2>"
      + (error ? '<p class="es-rt-err" role="alert">' + esc(error) + "</p>" : "")
      + '<label class="es-rt-name">Name<input type="text" maxlength="60" data-rt-field="name" value="' + esc(draft.name) + '" placeholder="Morning warm-up"></label>'
      + '<div class="es-rt-find"><button type="button" class="' + (n ? "" : "es-rt-primary ") + 'es-rt-pickbtn" data-rt="picker-open" aria-expanded="' + !!p.open + '" aria-haspopup="dialog">' + (p.open ? "Close the gallery ▴" : "+ Add a drill ▾") + "</button>" + (p.open ? pickerHtml(book, runs, p, draft) : "") + "</div>"
      + (n ? '<ol class="es-rt-steps">' + steps + "</ol>" : '<p class="es-rt-empty es-rt-empty-box">No drills yet. Press <b>Add a drill</b>, or the <b>+</b> on any drill card in the lobby.</p>')
      + '<p class="es-rt-note">A run counts for a step when it is that drill, you did not die, and it reaches the minimum score and medal if you set one. When the runs are done the next drill starts.</p>'
      + '<div class="es-rt-row es-rt-savebar"><button type="button" class="' + (n ? "es-rt-primary" : "") + '" data-rt="save">Save routine</button><button type="button" data-rt="discard">' + (draft.id ? "Cancel" : "Discard") + "</button></div></section>";
  }
  function routinesTabHtml(v) {
    const st = v.state, act = st.active && st.routines.find((r) => r.id === st.active.routineId), parts = [], unitOf = (c) => (v.runs && v.runs[c]) || null;
    if (act) {
      const step = act.steps[st.active.step], total = act.steps.length, pct = Math.round(((st.active.step + st.active.counted / (step.runs || 1)) / total) * 100);
      parts.push('<section class="es-rt-card is-active" data-rt-active><h3>Active: ' + esc(act.name) + '</h3><div class="es-rt-now"><span class="es-rt-sthumb is-sm">' + artHtml(step.code, v.book && v.book.get(step.code) || { type: step.type }) + '</span><p>Step ' + (st.active.step + 1) + " of " + total + ": <b>" + esc(label(step.code, { name: step.name }, v.book)) + "</b> (" + esc(stepText(step, unitOf(step.code))) + "), done " + st.active.counted + " of " + step.runs + " " + rankChip(step.rank) + "</p></div>"
        + '<span class="es-rt-bar" role="progressbar" aria-label="Routine progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><i style="width:' + pct + '%"></i></span><div class="es-rt-row"><button type="button" class="es-rt-primary" data-rt="play" data-code="' + esc(step.code) + '" data-type="' + esc(step.type || "") + '" data-rank="' + esc(step.rank || "") + '">Play this step</button><button type="button" data-rt="stop">Stop routine</button></div></section>');
    }
    const cards = st.routines.map((r) => {
      const isAct = act && act.id === r.id, at = isAct ? st.active.step : -1, total = r.steps.length;
      const fold = !isAct && total > LINES_FOLDED + 2 && !(v.expanded && v.expanded.has(r.id)), shown = fold ? r.steps.slice(0, LINES_FOLDED) : r.steps;
      return '<section class="es-rt-card' + (isAct ? " is-active" : "") + (v.flashId === r.id ? " is-flash" : "") + '" data-routine="' + esc(r.id) + '"><h3>' + esc(r.name) + ' <small class="es-rt-count">' + total + (total === 1 ? " drill" : " drills") + "</small></h3><ol class=\"es-rt-lines\">"
        + shown.map((step, i) => '<li class="' + (i < at ? "is-done" : i === at ? "is-now" : "") + '"><span class="es-rt-sthumb is-sm">' + artHtml(step.code, v.book && v.book.get(step.code) || { type: step.type }) + '</span><span class="es-rt-line"><b>' + esc(label(step.code, { name: step.name }, v.book)) + "</b> " + rankChip(step.rank) + "<small>" + esc(stepText(step, unitOf(step.code))) + "</small></span></li>").join("") + "</ol>"
        + (fold ? '<button type="button" class="es-rt-more" data-rt="expand" data-id="' + esc(r.id) + '" aria-expanded="false">Show all ' + total + " drills (" + (total - LINES_FOLDED) + " more)</button>" : "")
        + '<div class="es-rt-row"><button type="button" class="es-rt-primary" data-rt="start" data-id="' + esc(r.id) + '"' + (isAct ? ' title="Start this routine again from its first drill"' : "") + ">" + (isAct ? "Restart" : "Start") + '</button><button type="button" data-rt="edit" data-id="' + esc(r.id) + '">Edit</button>'
        + '<button type="button"' + (v.delId === r.id ? ' class="is-armed"' : "") + ' data-rt="delete" data-id="' + esc(r.id) + '">' + (v.delId === r.id ? "Click again to delete" : "Delete") + "</button></div></section>";
    }).join("");
    const notice = v.notice ? '<div class="es-rt-notice' + (v.notice.bad ? " is-bad" : "") + '" role="status"><span>' + esc(v.notice.text) + "</span>" + (v.notice.undo ? '<button type="button" data-rt="undo">Undo</button>' : "") + "</div>" : "";
    const left = notice + parts.join("") + (cards || (v.draft ? "" : '<section class="es-rt-card es-rt-none"><h3>No routines yet</h3><p>Your saved routines show up here, with a <b>Start</b> button.</p></section>'))
      + (st.done.length ? "<h3>Completed</h3><ul class=\"es-rt-done\">" + st.done.slice(-6).reverse().map((d) => "<li>" + esc(d.name) + "<small>" + esc(new Date(d.at).toLocaleDateString()) + "</small></li>").join("") + "</ul>" : "");
    const right = v.draft ? editorHtml(v.draft, v.book, v.runs, v.picker, v.error)
      : '<section class="es-rt-intro"><h2>Build a routine</h2><p>A routine plays drills one after another and moves on by itself.</p><ol><li>Add drills: pick them from your bookmarks, recently played or the gallery, or press <b>+</b> on any drill card in the lobby.</li><li>Say how many runs each needs, or a score or medal to reach.</li><li>Press <b>Start</b>. After each run you get a <b>Next drill</b> button.</li></ol><div class="es-rt-row"><button type="button" class="es-rt-primary" data-rt="new">New routine</button></div></section>';
    return '<div class="es-rt-grid"><div class="es-rt-col">' + left + '</div><div class="es-rt-col">' + right + "</div></div>";
  }
  function medalsTabHtml(v) {
    const runs = v.runs || {}, book = v.book;
    const codes = Object.keys(runs).filter((c) => runs[c] && Array.isArray(runs[c].runs) && runs[c].runs.length).sort((a, b) => runs[b].runs[runs[b].runs.length - 1].at - runs[a].runs[runs[a].runs.length - 1].at);
    const intro = '<p class="es-rt-note">Medals compare each run with your own recent runs of the same drill: <b>bronze</b> is your typical run, <b>silver</b> a good one, <b>gold</b> at least your best of the last ' + WINDOW + ". They start after " + MIN_RUNS + " runs of a drill. Set your own numbers with Edit.</p>";
    if (!codes.length) return intro + '<section class="es-rt-card es-rt-none"><h3>No medals yet</h3><p class="es-rt-empty">No runs recorded yet. Finish a drill and its medals show up here.</p></section>';
    const rows = codes.map((code) => {
      const e = runs[code], th = thresholds(e), unit = e.unit ? " " + esc(e.unit) : "", ok = e.runs.filter((r) => !r.died), next = th && ok.length ? nextMedal(ok[ok.length - 1].score, th, e.lower) : null;
      const ths = th ? MEDAL_ORDER.map((m) => '<span class="es-rt-medal is-' + m + '">' + medalIcon(m) + fmtNum(th[m]) + "</span>").join("") + (th.source === "custom" ? " <small>(yours)</small>" : "") : "<small>after " + MIN_RUNS + " runs (" + ok.length + " done)</small>";
      const editing = v.medalEdit === code;
      const form = editing ? '<tr class="es-rt-medalform"><td colspan="6"><div class="es-rt-row" data-medal-form="' + esc(code) + '">' + MEDAL_ORDER.map((m) => '<label class="is-' + m + '"><span>' + medalIcon(m) + MEDAL_LABEL[m] + '</span><input type="number" step="any" data-rt-field="medal-' + m + '" value="' + (v.medalDraft && v.medalDraft[m] != null ? esc(v.medalDraft[m]) : th ? esc(th[m]) : "") + '"></label>').join("")
        + '<button type="button" class="es-rt-primary" data-rt="medal-save" data-code="' + esc(code) + '">Save</button>' + (th && th.source === "custom" ? '<button type="button" data-rt="medal-auto" data-code="' + esc(code) + '">Back to automatic</button>' : "") + '<button type="button" data-rt="medal-cancel">Cancel</button></div>'
        + (v.medalError ? '<p class="es-rt-err" role="alert">' + esc(v.medalError) + "</p>" : '<p class="es-rt-note">' + (e.lower ? "Less is better here: gold is the smallest number. " : "") + "Enter performs Save, Esc cancels.</p>") + "</td></tr>" : "";
      return '<tr data-medal-row="' + esc(code) + '"' + (editing ? ' class="is-editing"' : "") + '><td class="es-rt-tdname">' + esc(label(code, e, book)) + "</td><td>" + e.runs.length + "</td><td>" + (e.best === null ? "–" : fmtNum(e.best) + unit) + "</td><td>" + MEDAL_ORDER.map((m) => medalDot(m, e.medals && e.medals[m])).join("") + "</td>"
        + "<td>" + ths + (next ? '<small class="es-rt-next">' + esc(MEDAL_LABEL[next.tier]) + " is " + fmtNum(next.gap) + unit + " away</small>" : "") + '</td><td class="es-rt-tdact"><button type="button" data-rt="medal-edit" data-code="' + esc(code) + '" aria-expanded="' + editing + '">Edit</button><button type="button" data-rt="play" data-code="' + esc(code) + '" data-type="' + esc(book && book.get(code) ? book.get(code).type || "" : "") + '">Play</button></td></tr>' + form;
    }).join("");
    return intro + '<div class="es-rt-tablewrap"><table class="es-rt-table"><thead><tr><th>Drill</th><th>Runs</th><th>Best</th><th>Earned</th><th>Medal scores</th><th><span class="es-rt-sr">Actions</span></th></tr></thead><tbody>' + rows + "</tbody></table></div>";
  }
  // The whole page. v = { tab, state, runs, book, draft, delId, medalEdit, query, error }.
  function pageHtml(v) {
    return '<div class="es-rt-head"><span class="es-rt-kicker">Training</span><h1>Routines</h1><p>Chain drills into a playlist, and earn medals against your own best.</p>'
      + '<div class="es-rt-tabs" role="tablist">' + [["routines", "My routines"], ["medals", "Medals"]].map(([id, t]) => '<button type="button" role="tab" aria-selected="' + (v.tab === id) + '" class="' + (v.tab === id ? "is-on" : "") + '" data-rt="tab" data-tab="' + id + '">' + t + "</button>").join("") + "</div></div>"
      + '<div class="es-rt-body' + (v.animBody ? " is-enter" : "") + '" role="tabpanel">' + (v.tab === "medals" ? medalsTabHtml(v) : routinesTabHtml(v)) + "</div>";
  }
  api.ui = { medalIcon, rankStep, rankHeroHtml, thumbModel, pageHtml, routinesTabHtml, medalsTabHtml, editorHtml, pickerHtml, galleryHtml, galleryCardHtml, pickerList, readFavs };

  // ---- page glue ----
  const TAB_KEY = "aim-rt-tab-v1"; // the page's last tab (My routines / Medals)
  const view = { tab: (() => { try { return localStorage.getItem(TAB_KEY) === "medals" ? "medals" : "routines"; } catch { return "routines"; } })(),
    delId: null, medalEdit: null, medalError: null, error: null, notice: null, flashId: null, animBody: false, focusAfter: null, expanded: new Set(),
    picker: { open: false, tab: "bookmarked", query: "", recents: [], anim: false } };
  let page = null, tabButton = null, deactivated = null, armTimer = 0, noticeTimer = 0, undoFn = null;
  const currentView = () => ({ ...view, state: loadRoutines(), runs: loadRuns(), book: names, draft: loadDraft(), picker: { ...view.picker, favs: readFavs() } });
  // Rank and difficulty answers for every drill on screen; when new ones arrive the page is drawn again once.
  function wantInfo() {
    const st = loadRoutines(), d = loadDraft(), codes = [];
    for (const r of st.routines) for (const x of r.steps) codes.push(x.code);
    for (const x of (d && d.steps) || []) codes.push(x.code);
    ensureInfo(codes).then((changed) => { if (changed && page) render(); });
  }
  // The played drills, newest first: the analytics rounds (every round, with its drill code) and the runs kept here.
  async function loadRecents() {
    const last = new Map();
    try { for (const r of (await window.__aimAnalytics.rounds({ limit: 300 })) || []) if (r && CODE_RE.test(String(r.code || "")) && typeof r.at === "number") last.set(r.code, Math.max(last.get(r.code) || 0, r.at)); } catch {}
    const runs = loadRuns();
    for (const c of Object.keys(runs)) { const e = runs[c]; if (e && e.runs && e.runs.length) last.set(c, Math.max(last.get(c) || 0, e.runs[e.runs.length - 1].at || 0)); }
    return [...last].sort((x, y) => y[1] - x[1]).map((x) => x[0]);
  }
  // A selector that finds "the same control" again after the page is drawn anew (the page is plain HTML, redrawn on every change).
  function focusKey(el) {
    if (!el || !page || !page.contains(el) || !el.dataset) return null;
    const d = el.dataset;
    if ("rtQ" in d) return "[data-rt-q]";
    if (d.rtField) return '[data-rt-field="' + d.rtField + '"]' + (d.i != null ? '[data-i="' + d.i + '"]' : "");
    if (!d.rt) return null;
    let s = '[data-rt="' + d.rt + '"]';
    for (const k of ["i", "code", "id", "tab", "dir"]) if (d[k] != null && /^[\w-]{1,64}$/.test(d[k])) s += "[data-" + k + '="' + d[k] + '"]';
    return s;
  }
  // The page's band between the lobby's top bar and its bottom bar (they grow on narrow windows, so they are measured).
  function fit() {
    if (!page) return;
    const nav = doc.querySelector(".hall-topnav"), bar = doc.querySelector(".hall-bottombar");
    const nr = nav && nav.getBoundingClientRect(), br = bar && bar.getBoundingClientRect();
    // only trusted while the bars sit at the window's edges (the lobby lays itself out again a moment after a resize)
    const top = nr && nr.height && Math.abs(nr.top) < 2 ? Math.round(nr.bottom) : 64;
    const barTop = br && br.height && Math.abs(br.bottom - innerHeight) < 2 ? br.top : innerHeight - 48;
    const t = top + "px", b = Math.max(0, Math.round(innerHeight - barTop)) + "px";
    if (page.style.top !== t) page.style.top = t; // only written when it changed: fit() also runs on every lobby change (check)
    if (page.style.bottom !== b) page.style.bottom = b;
  }
  function render() {
    if (!page) return;
    const focus = doc.activeElement, want = view.focusAfter || focusKey(focus), fallback = view.focusFallback;
    const gal = page.querySelector("[data-rt-gal]"), galTop = gal ? gal.scrollTop : 0, pageTop = page.scrollTop;
    const opening = view.picker.anim;
    page.innerHTML = pageHtml(currentView());
    // one-shot entrance flags: drawn once, never replayed by the next redraw
    view.animBody = false; view.picker.anim = false; view.flashId = null; view.focusAfter = null; view.focusFallback = null;
    page.scrollTop = pageTop;
    const gal2 = page.querySelector("[data-rt-gal]");
    if (gal2) gal2.scrollTop = galTop;
    fit();
    paintThumbs(page);
    wantInfo();
    if (want) {
      let el = page.querySelector(want);
      if ((!el || el.disabled) && fallback) el = page.querySelector(fallback);
      if (el && !el.disabled) {
        try { el.focus({ preventScroll: true }); } catch {}
        if ("rtQ" in el.dataset) try { el.setSelectionRange(el.value.length, el.value.length); } catch {}
      }
    }
    const flash = page.querySelector(".es-rt-card.is-flash"); // a routine just saved: bring its card into view
    if (flash && flash.scrollIntoView) try { flash.scrollIntoView({ block: "nearest" }); } catch {}
    if (opening) { const pick = page.querySelector("[data-rt-pick]"); if (pick && pick.scrollIntoView) try { pick.scrollIntoView({ block: "nearest" }); } catch {} }
  }
  // A line at the top of the page after an action (saved, deleted...), with Undo when the action can be taken back. It goes away by itself.
  function notify(text, opts = {}) {
    clearTimeout(noticeTimer);
    undoFn = opts.undo || null;
    view.notice = { text, undo: !!opts.undo, bad: !!opts.bad };
    noticeTimer = setTimeout(() => { view.notice = null; undoFn = null; if (page) render(); }, opts.undo ? 8000 : 4000);
  }
  // The game's own toast (theme .es-score-toast), for what happens after the page has closed (a drill starting).
  function toast(text, good) {
    try {
      doc.querySelector(".es-score-toast.es-rt-toast")?.remove();
      const t = doc.createElement("div");
      t.className = "es-score-toast es-rt-toast" + (good ? " is-good" : ""); t.setAttribute("role", "status"); t.textContent = text;
      doc.body.append(t); setTimeout(() => t.remove(), 4500);
      return t;
    } catch { return null; }
  }
  // Starts a step from the page: closes it, says what is starting (gone soon after the drill has started, so it does not sit over the
  // round), and says so when the drill could not be found.
  function playStep(step) {
    const nm = label(step.code, { name: step.name }, names);
    closePage();
    const t = toast("Starting " + nm + "…", true);
    startStep(step).then((ok) => { if (!ok) toast("Could not start " + nm + ". Open it from the lobby.", false); else if (t) setTimeout(() => t.remove(), 1200); });
  }
  const disarm = () => { clearTimeout(armTimer); view.delId = null; };
  function onField(el) {
    const field = el.dataset.rtField, d = loadDraft();
    if (field.startsWith("medal-") || !d) return;
    if (field === "name") d.name = el.value;
    else { const st = d.steps[+el.dataset.i]; if (!st) return; st[field] = el.value; }
    saveDraft(d);
  }
  function action(el) {
    const a = el.dataset.rt, i = +el.dataset.i, d = loadDraft();
    if (a !== "delete") disarm();
    if (a === "tab") {
      const t = el.dataset.tab === "medals" ? "medals" : "routines";
      if (t !== view.tab) { view.tab = t; view.medalEdit = null; view.medalError = null; view.medalDraft = null; view.animBody = true; try { localStorage.setItem(TAB_KEY, t); } catch {} render(); page.scrollTop = 0; }
      return;
    }
    if (a === "play") { playStep({ code: el.dataset.code, name: "", type: el.dataset.type || "", rank: el.dataset.rank || "" }); return; }
    if (a === "rank-step" && d) { const st = d.steps[i]; if (st) { st.rank = rankStep(st, rankInfo.cards[st.code], rankInfo.ranks, +el.dataset.dir); saveDraft(d); view.focusFallback = '[data-rt="rank-step"][data-i="' + i + '"][data-dir="' + -el.dataset.dir + '"]'; render(); } return; }
    if (a === "swap-diff" && d) { const st = d.steps[i], sib = st && siblings.get(st.code); if (sib) { st.code = sib.code; st.name = sib.name || st.name; saveDraft(d); view.focusAfter = '[data-rt-field="runs"][data-i="' + i + '"]'; ensureInfo([sib.code]).then(() => render()); render(); } return; }
    if (a === "new") { saveDraft({ id: null, name: "", steps: [] }); view.picker.query = ""; view.picker.open = false; view.error = null; view.animBody = true; view.focusAfter = '[data-rt-field="name"]'; render(); return; }
    if (a === "discard" && d) {
      const old = d; saveDraft(null); view.picker.open = false; view.error = null;
      if (old.steps.length || old.name) notify(old.id ? "Changes dropped." : "Draft discarded.", { undo: () => saveDraft(old) });
      view.focusAfter = '[data-rt="new"]'; render(); return;
    }
    if (a === "undo") { const fn = undoFn; clearTimeout(noticeTimer); view.notice = null; undoFn = null; if (fn) fn(); render(); return; }
    if (a === "expand") { view.expanded.add(el.dataset.id); view.focusAfter = '[data-rt="start"][data-id="' + el.dataset.id + '"]'; render(); return; }
    if (a === "picker-open") {
      if (view.picker.open) { view.picker.open = false; render(); return; }
      loadRecents().then((recents) => {
        const favs = readFavs();
        view.picker = { open: true, query: "", recents, anim: true, tab: favs.length ? "bookmarked" : recents.length ? "recent" : "all" };
        view.focusAfter = "[data-rt-q]";
        render();
      });
      return;
    }
    if (a === "picker-close") { view.picker.open = false; view.focusAfter = '[data-rt="picker-open"]'; render(); return; }
    if (a === "picker-tab") { view.picker.tab = ["bookmarked", "recent", "all"].includes(el.dataset.tab) ? el.dataset.tab : "all"; view.picker.query = ""; const g = page.querySelector("[data-rt-gal]"); if (g) g.scrollTop = 0; render(); return; }
    if (a === "edit") {
      const r = loadRoutines().routines.find((x) => x.id === el.dataset.id);
      if (r) {
        const old = d && (d.steps.length || d.name) && d.id !== r.id ? d : null;
        saveDraft({ id: r.id, name: r.name, steps: r.steps.map(rawStep) }); view.error = null; view.picker.open = false; view.animBody = true;
        if (old) notify("Editing " + r.name + ". The routine you were building was put aside.", { undo: () => saveDraft(old) });
        view.focusAfter = '[data-rt-field="name"]'; render();
      }
      return;
    }
    if (a === "add") {
      const before = d ? d.steps.length : 0;
      if (addToDraft(el.dataset.code) === before) { notify("The routine is full: a routine holds up to " + MAX_STEPS + " drills.", { bad: true }); }
      view.error = null; view.focusFallback = '[data-rt="picker-close"]'; render(); return;
    }
    if (a === "remove-step" && d) {
      const gone = d.steps.splice(i, 1)[0]; saveDraft(d);
      if (gone) notify("Removed " + label(gone.code, { name: gone.name }, names) + ".", { undo: () => { const x = loadDraft(); if (x) { x.steps.splice(Math.min(i, x.steps.length), 0, gone); saveDraft(x); } } });
      view.focusAfter = '[data-rt="remove-step"][data-i="' + Math.min(i, d.steps.length - 1) + '"]'; view.focusFallback = '[data-rt="picker-open"]'; render(); return;
    }
    if ((a === "up" || a === "down") && d) {
      const j = a === "up" ? i - 1 : i + 1;
      if (j >= 0 && j < d.steps.length) {
        [d.steps[i], d.steps[j]] = [d.steps[j], d.steps[i]]; saveDraft(d);
        view.focusAfter = '[data-rt="' + a + '"][data-i="' + j + '"]'; view.focusFallback = '[data-rt="' + (a === "up" ? "down" : "up") + '"][data-i="' + j + '"]';
        render();
        const row = page.querySelector('[data-step="' + j + '"]'); if (row && row.scrollIntoView) try { row.scrollIntoView({ block: "nearest" }); } catch {}
      }
      return;
    }
    if (a === "save" && d) {
      const saved = api.saveRoutine({ ...d, steps: d.steps.map((x) => ({ ...x, minScore: x.minScore === "" ? null : x.minScore, minMedal: x.minMedal || null })) });
      if (saved) { saveDraft(null); view.error = null; view.picker.open = false; view.flashId = saved.id; notify("Saved " + saved.name + "."); view.focusAfter = '[data-rt="start"][data-id="' + saved.id + '"]'; }
      else { view.error = !String(d.name || "").trim() ? "Give the routine a name." : !d.steps.length ? "Add at least one drill." : loadRoutines().routines.length >= MAX_ROUTINES ? "You have " + MAX_ROUTINES + " routines, the most there can be. Delete one first." : "Give the routine a name and add at least one drill."; view.focusAfter = !String(d.name || "").trim() ? '[data-rt-field="name"]' : null; }
      render();
      return;
    }
    if (a === "start") { const r = loadRoutines().routines.find((x) => x.id === el.dataset.id); if (r && api.start(r.id)) playStep(r.steps[0]); return; }
    if (a === "stop") {
      const s = loadRoutines(), prev = s.active, r = prev && s.routines.find((x) => x.id === prev.routineId);
      api.stop();
      if (prev) notify("Stopped " + (r ? r.name : "the routine") + ".", { undo: () => { const x = loadRoutines(); if (x.routines.some((y) => y.id === prev.routineId)) { x.active = prev; saveRoutines(x); } } });
      render(); return;
    }
    if (a === "delete") {
      const id = el.dataset.id;
      if (view.delId !== id) { disarm(); view.delId = id; armTimer = setTimeout(() => { view.delId = null; if (page) render(); }, 4000); render(); return; }
      disarm();
      const s = loadRoutines(), at = s.routines.findIndex((x) => x.id === id), r = s.routines[at], wasActive = s.active && s.active.routineId === id ? s.active : null;
      api.deleteRoutine(id);
      if (r) notify("Deleted " + r.name + ".", { undo: () => { const x = loadRoutines(); if (!x.routines.some((y) => y.id === r.id) && x.routines.length < MAX_ROUTINES) { x.routines.splice(Math.min(at, x.routines.length), 0, r); if (wasActive && !x.active) x.active = wasActive; saveRoutines(x); } } });
      view.focusAfter = '[data-rt="undo"]'; render(); return;
    }
    if (a === "medal-edit") { view.medalEdit = view.medalEdit === el.dataset.code ? null : el.dataset.code; view.medalError = null; view.medalDraft = null; view.focusAfter = '[data-rt-field="medal-bronze"]'; render(); return; }
    if (a === "medal-cancel") { const c = view.medalEdit; view.medalEdit = null; view.medalError = null; view.medalDraft = null; view.focusAfter = '[data-rt="medal-edit"][data-code="' + c + '"]'; render(); return; }
    if (a === "medal-auto") { api.setCustom(el.dataset.code, null); view.medalEdit = null; view.medalError = null; view.medalDraft = null; notify("Medal scores are automatic again."); view.focusAfter = '[data-rt="medal-edit"][data-code="' + el.dataset.code + '"]'; render(); return; }
    if (a === "medal-save") {
      const code = el.dataset.code, form = page.querySelector('[data-medal-form="' + code + '"]'), val = (m) => { const x = form && form.querySelector('[data-rt-field="medal-' + m + '"]'); return x ? x.value : ""; };
      const th = { bronze: val("bronze"), silver: val("silver"), gold: val("gold") }, e = loadRuns()[code], sign = e && e.lower ? -1 : 1;
      if (![th.bronze, th.silver, th.gold].every((x) => x !== "" && isFinite(Number(x)))) view.medalError = "Enter a number for each medal.";
      else if (!(sign * th.bronze <= sign * th.silver && sign * th.silver <= sign * th.gold)) view.medalError = e && e.lower ? "Less is better here: gold needs the smallest number, bronze the largest." : "Bronze needs the lowest score, gold the highest.";
      else if (api.setCustom(code, th)) { view.medalEdit = null; view.medalError = null; view.medalDraft = null; notify("Medal scores saved."); view.focusAfter = '[data-rt="medal-edit"][data-code="' + code + '"]'; }
      else view.medalError = "Could not save. Check the numbers.";
      if (view.medalError) { view.medalDraft = th; view.focusAfter = '[data-rt-field="medal-bronze"]'; } // keep what was typed
      render();
    }
  }
  // Keyboard in the drill gallery: arrows move between cards (by rows and columns as laid out), ↓ from the search goes to the first card,
  // ↑ from the first row goes back to the search; Enter / Space add the card (it is a button).
  function onKey(e) {
    const t = e.target;
    if (!t || !t.dataset) return;
    if (e.key === "Enter" && t.dataset.rtField === "name") { e.preventDefault(); const b = page.querySelector('[data-rt="save"]'); if (b) action(b); return; }
    if (e.key === "Enter" && /^medal-/.test(t.dataset.rtField || "")) { e.preventDefault(); const b = page.querySelector('[data-rt="medal-save"]'); if (b) action(b); return; }
    if (!/^Arrow(Up|Down|Left|Right)$|^Home$|^End$/.test(e.key)) return;
    const gal = page.querySelector("[data-rt-gal]");
    if (!gal) return;
    const cards = [...gal.querySelectorAll(".es-rt-gcard:not(:disabled)")];
    if ("rtQ" in t.dataset) { if (e.key === "ArrowDown" && cards.length) { e.preventDefault(); cards[0].focus(); } return; }
    const at = cards.indexOf(t);
    if (at < 0) return;
    e.preventDefault();
    const top0 = cards[0].offsetTop, cols = Math.max(1, cards.findIndex((c) => c.offsetTop !== top0) === -1 ? cards.length : cards.findIndex((c) => c.offsetTop !== top0));
    let to = at;
    if (e.key === "ArrowLeft") to = at - 1; else if (e.key === "ArrowRight") to = at + 1;
    else if (e.key === "ArrowUp") to = at - cols; else if (e.key === "ArrowDown") to = Math.min(cards.length - 1, at + cols);
    else if (e.key === "Home") to = 0; else if (e.key === "End") to = cards.length - 1;
    if (to < 0) { const q = page.querySelector("[data-rt-q]"); if (q) q.focus(); return; }
    const c = cards[Math.min(cards.length - 1, to)];
    c.focus(); if (c.scrollIntoView) try { c.scrollIntoView({ block: "nearest" }); } catch {}
  }
  async function openPage() {
    if (!doc) return;
    if (page) { render(); return; }
    await loadNames();
    if (page) return;
    injectCss(); injectPageCss();
    page = doc.createElement("section");
    page.className = "es-rt";
    page.setAttribute("aria-label", "Routines");
    page.addEventListener("click", (e) => { const t = e.target && e.target.closest ? e.target.closest("[data-rt]") : null; if (t && page.contains(t) && !t.disabled) action(t); });
    page.addEventListener("keydown", onKey);
    page.addEventListener("input", (e) => {
      const t = e.target;
      if (t && t.dataset && "rtQ" in t.dataset) {
        view.picker.query = t.value;
        const gal = page.querySelector("[data-rt-gal]"), cv = currentView();
        if (gal) { gal.innerHTML = galleryHtml(names, cv.runs, cv.picker, cv.draft); gal.scrollTop = 0; paintThumbs(gal); }
        const note = page.querySelector("[data-rt-picknote]");
        if (note) note.innerHTML = pickNoteHtml(names, cv.picker, cv.draft);
        // the list tabs show no selection while searching
        for (const b of page.querySelectorAll('[data-rt="picker-tab"]')) { const on = !String(t.value).trim() && b.dataset.tab === view.picker.tab; b.classList.toggle("is-on", on); b.setAttribute("aria-selected", String(on)); }
        return;
      }
      if (t && t.dataset && "rtField" in t.dataset) onField(t);
    });
    page.addEventListener("error", (e) => { if (e.target && e.target.tagName === "IMG" && e.target.closest(".es-rt-gart")) e.target.remove(); }, true);
    page.addEventListener("mousedown", (e) => { if (view.picker.open && e.target.closest && !e.target.closest("[data-rt-pick]") && !e.target.closest(".es-rt-pickbtn")) { view.picker.open = false; render(); } });
    page.addEventListener("change", (e) => { const t = e.target; if (t && t.dataset && "rtField" in t.dataset) onField(t); });
    doc.body.append(page);
    deactivated = [...doc.querySelectorAll(".hall-tabs .hall-tab.is-active")].filter((b) => b !== tabButton);
    for (const b of deactivated) b.classList.remove("is-active");
    tabButton?.classList.add("is-active");
    render();
  }
  function closePage() {
    if (!page) return;
    page.remove(); page = null;
    view.picker.open = false; view.notice = null; view.medalEdit = null; view.medalError = null; view.medalDraft = null; view.error = null; undoFn = null; disarm(); clearTimeout(noticeTimer);
    tabButton?.classList.remove("is-active");
    for (const b of deactivated || []) if (b.isConnected) b.classList.add("is-active");
    deactivated = null;
  }
  api.openPage = openPage; api.closePage = closePage;

  const PAGE_CSS = `
/* Routines page and the lobby card buttons: the site's theme (theme-esports.css) - square corners, slanted buttons, cut-corner panels, red accents. */
html[data-aim-local]:not(#es) body .es-rt { position: fixed; left: 0; right: 0; top: 64px; bottom: 48px; z-index: 40; overflow: auto; padding: 24px 36px 36px; box-sizing: border-box;
  background: radial-gradient(ellipse at 45% 30%, #1d232e, var(--es-bg, #090b0f) 68%); color: var(--es-text, #f4f5f7); font-family: var(--es-head, "Bahnschrift", "Segoe UI", sans-serif); }
body:has(.al-trainer-shell.al-session-active) .es-rt { display: none !important; }
html[data-aim-local]:not(#es) body .es-rt :is(button, input, select, textarea) { border-radius: 0 !important; font-family: var(--es-head, "Bahnschrift", "Segoe UI", sans-serif) !important; }
html[data-aim-local]:not(#es) body .es-rt button { cursor: pointer; box-shadow: none !important; }
.es-rt-kicker { display: inline-flex; align-items: center; gap: 8px; font: 600 12px/1 var(--es-head); letter-spacing: .12em; text-transform: uppercase; color: var(--es-muted, #9aa1ae); }
.es-rt-kicker::before { content: ""; width: 4px; height: 12px; background: var(--es-red, #ff4655); transform: skewX(-14deg); }
html[data-aim-local]:not(#es) body .es-rt h1 { margin: 12px 0 0; font-size: 34px; line-height: 1; letter-spacing: .02em; }
html[data-aim-local]:not(#es) body .es-rt :is(h2, h3) { margin: 0; font-size: 18px; line-height: 1.2; letter-spacing: .04em; }
.es-rt-head > p { margin: 8px 0 14px; font-size: 12.5px; color: var(--es-dim, #6b7280); }
.es-rt p { margin: 0; font-size: 13px; color: var(--es-soft, #d6d9df); }
/* the page's tabs: the top bar's slanted tabs */
.es-rt-tabs { display: flex; gap: 2px; margin: 0 0 18px; }
html[data-aim-local]:not(#es) body .es-rt-tabs button { height: 36px; padding: 0 22px !important; border: 0 !important; background: transparent !important; color: var(--es-muted, #9aa1ae) !important; clip-path: var(--es-slant) !important;
  font-size: 15px !important; font-weight: 700 !important; font-stretch: 75% !important; text-transform: uppercase !important; letter-spacing: .02em; }
html[data-aim-local]:not(#es) body .es-rt-tabs button:hover { background: var(--es-raised, #171b23) !important; color: var(--es-text, #f4f5f7) !important; }
html[data-aim-local]:not(#es) body .es-rt-tabs button.is-on { background: var(--es-red, #ff4655) !important; color: #fff !important; }
.es-rt-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); gap: 20px; align-items: start; }
.es-rt-grid:has(> .es-rt-col:first-child:empty) { grid-template-columns: 1fr; } .es-rt-col:empty { display: none; }
@media (max-width: 900px) { .es-rt-grid { grid-template-columns: 1fr; } }
.es-rt-col { display: grid; gap: 10px; align-content: start; }
/* panels: the site's cut-corner panels with the red edge */
html[data-aim-local]:not(#es) body :is(.es-rt-card, .es-rt-editor, .es-rt-intro) { display: grid; gap: 10px; padding: 16px 18px; background: var(--es-panel, #10131a); border: 1px solid var(--es-line, #272d39); border-left: 4px solid var(--es-line-2, #343b4a); clip-path: var(--es-cut); }
html[data-aim-local]:not(#es) body :is(.es-rt-card.is-active, .es-rt-editor, .es-rt-intro) { border-left-color: var(--es-red, #ff4655); }
html[data-aim-local]:not(#es) body .es-rt-editor { clip-path: none !important; overflow: visible; position: relative; z-index: 5; }
.es-rt-card ol, .es-rt-intro ol { margin: 0; padding-left: 20px; font-size: 13px; color: var(--es-muted, #9aa1ae); display: grid; gap: 4px; }
.es-rt-card ol li.is-now { color: #fff; font-weight: 700; } .es-rt-card ol li.is-done { color: var(--es-dim, #6b7280); text-decoration: line-through; }
.es-rt small { color: var(--es-dim, #6b7280); font-size: 12px; margin-left: 6px; }
.es-rt-row { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; }
/* buttons: primary = the red slanted action (START TRAINING), the others = the raised slanted ghost (Records / Tune) */
html[data-aim-local]:not(#es) body :is(.es-rt-row button, .es-rt-mv button, .es-rt-table button) { height: 34px; padding: 0 20px !important; border: 0 !important; background: var(--es-raised-2, #1e232d) !important; color: var(--es-soft, #d6d9df) !important; clip-path: var(--es-slant) !important;
  font-size: 13px !important; font-weight: 800 !important; font-stretch: 75% !important; text-transform: uppercase !important; letter-spacing: .08em; }
html[data-aim-local]:not(#es) body :is(.es-rt-row button, .es-rt-mv button, .es-rt-table button):hover:not(:disabled) { background: #2a303c !important; color: #fff !important; }
html[data-aim-local]:not(#es) body .es-rt button.es-rt-primary { height: 34px; background: var(--es-red, #ff4655) !important; color: #fff !important; padding: 0 24px !important; letter-spacing: .04em; border: 0 !important; clip-path: var(--es-slant) !important; font-size: 13px !important; font-weight: 800 !important; font-stretch: 75% !important; text-transform: uppercase !important; }
html[data-aim-local]:not(#es) body .es-rt button.es-rt-primary:hover:not(:disabled) { background: var(--es-red-2, #ff6b77) !important; }
html[data-aim-local]:not(#es) body .es-rt-mv button { padding: 0 12px !important; }
html[data-aim-local]:not(#es) body .es-rt button:disabled { opacity: .35; cursor: default; }
.es-rt-bar { display: block; height: 6px; background: var(--es-raised, #171b23); position: relative; } .es-rt-bar i { position: absolute; inset: 0 auto 0 0; background: var(--es-red, #ff4655); }
.es-rt label { display: grid; gap: 4px; font: 700 11px/1.2 var(--es-head); letter-spacing: .1em; text-transform: uppercase; color: var(--es-muted, #9aa1ae); }
html[data-aim-local]:not(#es) body .es-rt :is(input, select) { height: 34px; min-width: 0; padding: 0 10px; background: var(--es-raised, #171b23) !important; color: #fff !important; border: 1px solid var(--es-line-2, #343b4a) !important; font-size: 13px; text-transform: none; letter-spacing: normal; }
html[data-aim-local]:not(#es) body .es-rt :is(input, select):focus, html[data-aim-local]:not(#es) body .es-rt :is(input, select):focus-visible { outline: none !important; box-shadow: none !important; border-color: var(--es-red, #ff4655) !important; }
html[data-aim-local]:not(#es) body .es-rt button:focus-visible { outline: 2px solid var(--es-red-2, #ff6b77) !important; outline-offset: 2px; }
html[data-aim-local]:not(#es) body .es-rt select option { background: var(--es-panel, #10131a); color: var(--es-text, #f4f5f7); }
.es-rt-find { display: grid; gap: 6px; }
.es-rt-results { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; max-height: 260px; overflow: auto; }
html[data-aim-local]:not(#es) body .es-rt-results li button { display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 9px 12px; background: var(--es-raised, #171b23) !important; border: 0 !important; border-left: 3px solid transparent !important; color: var(--es-text, #f4f5f7) !important; text-align: left; font-size: 13px; }
html[data-aim-local]:not(#es) body .es-rt-results li button:hover { background: var(--es-raised-2, #1e232d) !important; border-left-color: var(--es-red, #ff4655) !important; }
.es-rt-results li button b { color: var(--es-red, #ff4655); font-size: 12px; font-stretch: 75%; letter-spacing: .08em; text-transform: uppercase; }
.es-rt-hint { padding: 6px 2px; font-size: 12px; color: var(--es-dim, #6b7280); }
.es-rt-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.es-rt-step { display: grid; grid-template-columns: 24px minmax(120px, 1fr) 70px 90px 100px auto; gap: 8px; align-items: end; padding: 8px 10px; background: var(--es-raised, #171b23); border-left: 3px solid var(--es-line-2, #343b4a); }
.es-rt-n { align-self: center; color: var(--es-red, #ff4655); font: 800 16px var(--es-head); } .es-rt-sname { align-self: center; font-size: 13px; }
@media (max-width: 900px) { .es-rt-step { grid-template-columns: 24px 1fr 1fr; } }
.es-rt-mv { display: flex; gap: 4px; }
.es-rt-note, .es-rt-empty { font-size: 12px; color: var(--es-dim, #6b7280); }
html[data-aim-local]:not(#es) body .es-rt p.es-rt-err { padding: 8px 12px; background: var(--es-red-wash, rgba(255,70,85,.14)); border-left: 3px solid var(--es-red, #ff4655); color: #fff; }
.es-rt-done { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 13px; }
.es-rt-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.es-rt-table th { text-align: left; padding: 6px 8px; font: 700 11px/1.2 var(--es-head); letter-spacing: .1em; text-transform: uppercase; color: var(--es-muted, #9aa1ae); }
.es-rt-table td { padding: 8px; border-top: 1px solid var(--es-line, #272d39); vertical-align: top; }
.es-rt-medal { display: inline-flex; align-items: center; gap: 5px; margin-right: 10px; font: 700 12px/1 var(--es-head); color: var(--es-soft, #d6d9df); }
.es-rt-medal .es-rt-badge { width: 18px; height: 20px; flex: none; } .es-rt-medal.is-none { opacity: .45; filter: grayscale(.8); }
.es-rt-chip .es-rt-badge { width: 16px; height: 18px; flex: none; } .es-rt-gmedal .es-rt-badge { width: 14px; height: 16px; flex: none; }
/* on the lobby's drill cards: the medal chip (slanted tag, like the cards' other tags) and the add button */
html[data-aim-local]:not(#es) body .es-rt-chip { position: absolute; z-index: 3; top: 10px; left: 36px; padding: 4px 12px 4px 10px; display: inline-flex; align-items: center; gap: 6px; background: rgba(9,11,15,.85); color: #fff; clip-path: var(--es-slant-sm);
  font: 800 11px/1 var(--es-head); font-stretch: 75%; letter-spacing: .08em; text-transform: uppercase; }

html[data-aim-local]:not(#es) body .es-rt-addcard:not(.tw-btn) { position: absolute; z-index: 4; top: 12px; right: 46px; width: 28px; height: 26px; padding: 0 !important; display: grid; place-items: center; border: 0 !important; background: var(--es-raised-2, #1e232d) !important; color: var(--es-soft, #d6d9df) !important;
  clip-path: var(--es-slant-sm) !important; border-radius: 0 !important; font: 800 16px/1 var(--es-head) !important; cursor: pointer; }
html[data-aim-local]:not(#es) body .es-rt-addcard:not(.tw-btn):hover { background: var(--es-red, #ff4655) !important; color: #fff !important; }
html[data-aim-local]:not(#es) body .es-rt-addcard.is-added { background: var(--es-red, #ff4655) !important; color: #fff !important; }
html[data-aim-local]:not(#es) body .tw-actions .es-rt-addcard { align-self: stretch; }

/* the drill picker: a drop-down panel with a gallery of cards */
.es-rt-find { position: relative; }
.es-rt-find { align-content: start; } /* the open picker floats over what is below it: nothing is reserved for it */
html[data-aim-local]:not(#es) body .es-rt-pickbtn { justify-self: start; }
html[data-aim-local]:not(#es) body .es-rt-pick { position: absolute; z-index: 20; left: 0; width: min(100%, 1040px); top: 42px; display: grid; gap: 10px; padding: 14px; background: var(--es-panel, #10131a); border: 1px solid var(--es-line-2, #343b4a); border-top: 3px solid var(--es-red, #ff4655); clip-path: var(--es-cut); box-shadow: 0 24px 60px #000b; }
.es-rt-pick-bar { display: grid; grid-template-columns: minmax(160px, 1fr) auto auto; gap: 10px; align-items: center; }
@media (max-width: 900px) { .es-rt-pick-bar { grid-template-columns: 1fr; } }
.es-rt-chips { display: flex; gap: 2px; }
html[data-aim-local]:not(#es) body .es-rt-chips button { height: 34px; padding: 0 16px !important; border: 0 !important; background: transparent !important; color: var(--es-muted, #9aa1ae) !important; clip-path: var(--es-slant) !important; font-size: 13px !important; font-weight: 700 !important; font-stretch: 75% !important; text-transform: uppercase !important; letter-spacing: .04em; }
html[data-aim-local]:not(#es) body .es-rt-chips button:hover { background: var(--es-raised, #171b23) !important; color: #fff !important; }
html[data-aim-local]:not(#es) body .es-rt-chips button.is-on { background: var(--es-red, #ff4655) !important; color: #fff !important; }
.es-rt-chips small { margin-left: 4px; color: inherit; opacity: .7; }
.es-rt-gal { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 8px; max-height: min(56vh, 520px); overflow: auto; padding-right: 4px; }
.es-rt-gal > .es-rt-empty { grid-column: 1 / -1; padding: 18px 4px; }
html[data-aim-local]:not(#es) body .es-rt-gcard { display: grid; gap: 4px; align-content: start; padding: 0 0 10px !important; text-align: left; background: var(--es-raised, #171b23) !important; border: 0 !important; border-bottom: 2px solid var(--es-line, #272d39) !important; color: var(--es-text, #f4f5f7) !important; clip-path: var(--es-cut); }
html[data-aim-local]:not(#es) body .es-rt-gcard:hover { background: var(--es-raised-2, #1e232d) !important; border-bottom-color: var(--es-red, #ff4655) !important; }
html[data-aim-local]:not(#es) body .es-rt-gcard.is-in { border-bottom-color: var(--es-red, #ff4655) !important; }
.es-rt-gcard b { padding: 0 10px; font: 800 13px/1.2 var(--es-head); font-stretch: 75%; text-transform: uppercase; letter-spacing: .02em; }
.es-rt-gcard small { padding: 0 10px; margin: 0; font-size: 11px; color: var(--es-dim, #6b7280); text-transform: uppercase; letter-spacing: .06em; }
.es-rt-gart { position: relative; display: block; aspect-ratio: 16 / 9; background: linear-gradient(135deg, #1d232e, #0d1016); overflow: hidden; }
.es-rt-gcanvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.es-rt-gart img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .85; }
.es-rt-gart.is-plain { display: grid; place-items: center; } .es-rt-gart em { font: 800 12px var(--es-head); font-style: normal; font-stretch: 75%; letter-spacing: .12em; text-transform: uppercase; color: var(--es-muted, #9aa1ae); }
.es-rt-gadd, .es-rt-gin { position: absolute; right: 0; bottom: 0; padding: 4px 12px 4px 14px; clip-path: var(--es-slant-sm); background: rgba(9,11,15,.88); color: #fff; font: 800 11px/1 var(--es-head); font-stretch: 75%; letter-spacing: .08em; text-transform: uppercase; }
.es-rt-gcard:hover .es-rt-gadd { background: var(--es-red, #ff4655); } .es-rt-gin { background: var(--es-red, #ff4655); }
.es-rt-gmedal { position: absolute; left: 0; top: 0; padding: 4px 12px 4px 8px; display: inline-flex; align-items: center; gap: 5px; clip-path: var(--es-slant-sm); background: rgba(9,11,15,.88); color: #fff; font: 800 10px/1 var(--es-head); font-stretch: 75%; letter-spacing: .08em; text-transform: uppercase; }


/* a step as a row: thumbnail + information + settings */
html[data-aim-local]:not(#es) body .es-rt-step { grid-template-columns: 24px 240px minmax(0, 1fr) auto; align-items: start; padding: 10px 12px; row-gap: 10px; }
.es-rt-step > .es-rt-n { grid-row: 1; align-self: center; } .es-rt-step > .es-rt-sthumb { grid-row: 1; } .es-rt-step > .es-rt-sinfo { grid-row: 1; } .es-rt-step > .es-rt-mv { grid-row: 1; }
.es-rt-step > .es-rt-sctl { grid-row: 2; grid-column: 2 / -1; }
.es-rt-sthumb { display: block; width: 240px; position: relative; } .es-rt-sthumb.is-sm { width: 76px; flex: none; }
.es-rt-sthumb .es-rt-gart { aspect-ratio: 16 / 9; }
.es-rt-sthumb .es-rank-hero { --es-rank-top: 8px; z-index: 6; }
.es-rt-sthumb .es-rank-badge { width: 54px !important; height: 54px !important; object-fit: contain; filter: drop-shadow(0 0 12px var(--es-rank-glow, transparent)) drop-shadow(0 3px 6px rgba(0,0,0,.9)); }
.es-rt-sthumb .es-rank-off { width: 46px; height: 46px; margin: 4px; }
.es-rt-sthumb .es-rank-sub { font-size: 9.5px; }
html[data-aim-local]:not(#es) body .es-rt-rarrow { pointer-events: auto; width: 26px; height: 26px; padding: 0 !important; border: 1px solid #4a4f5a !important; background: rgba(10,12,16,.82) !important; color: #e6e6e6 !important; font: 700 15px/1 Arial, sans-serif !important; cursor: pointer; display: grid; place-items: center; clip-path: none !important; }
html[data-aim-local]:not(#es) body .es-rt-rarrow:hover:not(:disabled) { border-color: var(--es-rank-color, #ff4655) !important; color: #fff !important; }
html[data-aim-local]:not(#es) body .es-rt-rarrow:disabled { opacity: .25; cursor: default; }
.es-rt-sinfo { display: grid; gap: 3px; align-content: start; min-width: 0; }
.es-rt-sinfo .es-rt-sname { font: 800 14px/1.2 var(--es-head); font-stretch: 75%; text-transform: uppercase; letter-spacing: .02em; }
.es-rt-sinfo small { margin: 0; text-transform: uppercase; letter-spacing: .06em; }
.es-rt-sdesc { margin: 0; font-size: 12px !important; color: var(--es-muted, #9aa1ae) !important; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.es-rt-sstat { font-size: 12px; color: var(--es-soft, #d6d9df); display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.es-rt-sctl { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
.es-rt-sctl label { width: 84px; } .es-rt-sctl label:has(select) { width: 112px; }
.es-rt-seg { display: grid; gap: 4px; } .es-rt-seg > span { font: 700 11px/1.2 var(--es-head); letter-spacing: .1em; text-transform: uppercase; color: var(--es-muted, #9aa1ae); }
.es-rt-seg { grid-template-columns: auto auto; } .es-rt-seg > span { grid-column: 1 / -1; }
html[data-aim-local]:not(#es) body .es-rt-seg button { height: 34px; padding: 0 14px !important; border: 0 !important; background: var(--es-raised-2, #1e232d) !important; color: var(--es-muted, #9aa1ae) !important; clip-path: var(--es-slant-sm) !important; font-size: 12px !important; font-weight: 800 !important; font-stretch: 75% !important; text-transform: uppercase !important; letter-spacing: .08em; }
html[data-aim-local]:not(#es) body .es-rt-seg button.is-on { background: var(--es-red, #ff4655) !important; color: #fff !important; cursor: default; }
html[data-aim-local]:not(#es) body .es-rt-seg button:not(.is-on):hover { background: #2a303c !important; color: #fff !important; }
.es-rt-rank { display: inline-flex; align-items: center; gap: 4px; margin: 0 6px 0 2px; font: 800 11px/1 var(--es-head); font-stretch: 75%; letter-spacing: .08em; text-transform: uppercase; color: var(--c, #9aa1ae); vertical-align: middle; }
.es-rt-rank img { width: 16px; height: 16px; object-fit: contain; }
@media (max-width: 900px) { html[data-aim-local]:not(#es) body .es-rt-step { grid-template-columns: 24px 200px minmax(0, 1fr); } .es-rt-sthumb { width: 200px; } .es-rt-step > .es-rt-mv { grid-row: 3; grid-column: 2 / -1; } }
.es-rt-lines { list-style: none !important; padding-left: 0 !important; gap: 6px !important; }
.es-rt-lines li { display: flex; gap: 10px; align-items: center; } .es-rt-line { display: grid; gap: 2px; min-width: 0; } .es-rt-line b { font-size: 13px; color: var(--es-text, #f4f5f7); font-weight: 700; } .es-rt-line small { margin: 0; }
.es-rt-card ol li.is-done .es-rt-line b { color: var(--es-dim, #6b7280); }
.es-rt-now { display: flex; gap: 12px; align-items: center; }

/* ---- UI review, round 3 (ui-routines): focus you can see, motion that plays once, feedback, long lists, fit ---- */
/* motion: the page rises in once when it opens; a tab's content and the gallery drop in once (one-shot classes, never replayed by a redraw) */
html[data-aim-local]:not(#es) body .es-rt { animation: es-rt-in .2s ease-out; }
@keyframes es-rt-in { from { opacity: 0; transform: translateY(8px); } }
@keyframes es-rt-drop { from { opacity: 0; transform: translateY(-6px); } }
@keyframes es-rt-flash { from { opacity: .2; } to { opacity: 0; } }
.es-rt-body.is-enter { animation: es-rt-in .18s ease-out; }
html[data-aim-local]:not(#es) body .es-rt-pick.is-enter { animation: es-rt-drop .16s ease-out; }
html[data-aim-local]:not(#es) body .es-rt-card { position: relative; }
.es-rt-card.is-flash::after { content: ""; position: absolute; inset: 0; background: var(--es-red, #ff4655); opacity: 0; pointer-events: none; animation: es-rt-flash .8s ease-out; }
@media (prefers-reduced-motion: reduce) { html[data-aim-local]:not(#es) body :is(.es-rt, .es-rt-body.is-enter, .es-rt-pick.is-enter, .es-rt-card.is-flash::after) { animation: none !important; } }
/* focus: the slanted / cut buttons clip an outside outline away, so the ring sits inside them */
html[data-aim-local]:not(#es) body .es-rt :is(button, a):focus-visible { outline: 2px solid #fff !important; outline-offset: -4px !important; }
html[data-aim-local]:not(#es) body .es-rt .es-rt-gcard:focus-visible { outline-offset: -3px !important; background: var(--es-raised-2, #1e232d) !important; border-bottom-color: var(--es-red, #ff4655) !important; }
html[data-aim-local]:not(#es) body .es-rt .es-rt-gcard:focus-visible .es-rt-gadd { background: var(--es-red, #ff4655); }
html[data-aim-local]:not(#es) body .es-rt .es-rt-gcard:disabled { opacity: .45; }
/* press feedback on every button of the page */
html[data-aim-local]:not(#es) body .es-rt button:not(:disabled):active { transform: translateY(1px); }
/* secondary buttons outside .es-rt-row: Add a drill (once there are drills), Show all, Undo */
html[data-aim-local]:not(#es) body .es-rt :is(.es-rt-pickbtn:not(.es-rt-primary), .es-rt-notice button) { height: 34px; padding: 0 20px !important; border: 0 !important; background: var(--es-raised-2, #1e232d) !important; color: var(--es-soft, #d6d9df) !important; clip-path: var(--es-slant) !important;
  font-size: 13px !important; font-weight: 800 !important; font-stretch: 75% !important; text-transform: uppercase !important; letter-spacing: .08em; }
html[data-aim-local]:not(#es) body .es-rt :is(.es-rt-pickbtn:not(.es-rt-primary), .es-rt-notice button):hover { background: #2a303c !important; color: #fff !important; }
html[data-aim-local]:not(#es) body .es-rt .es-rt-more { justify-self: start; height: 30px; padding: 0 12px !important; border: 0 !important; background: transparent !important; color: var(--es-muted, #9aa1ae) !important; font-size: 12px !important; font-weight: 700 !important; letter-spacing: .08em; text-transform: uppercase !important; }
html[data-aim-local]:not(#es) body .es-rt .es-rt-more:hover { color: #fff !important; background: var(--es-raised, #171b23) !important; }
/* a destructive button waiting for its second click */
html[data-aim-local]:not(#es) body .es-rt .es-rt-row button.is-armed { background: var(--es-red-wash, rgba(255,70,85,.18)) !important; color: #ffb3b9 !important; }
html[data-aim-local]:not(#es) body .es-rt .es-rt-mv button.es-rt-x:hover:not(:disabled) { background: var(--es-red, #ff4655) !important; color: #fff !important; }
/* the line after an action (saved / deleted / removed), with Undo */
.es-rt-notice { display: flex; align-items: center; gap: 12px; min-height: 46px; padding: 6px 8px 6px 14px; box-sizing: border-box; background: var(--es-panel, #10131a); border: 1px solid var(--es-line, #272d39); border-left: 4px solid var(--es-red, #ff4655); font: 700 13px/1.3 var(--es-head); color: var(--es-text, #f4f5f7); }
.es-rt-notice > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.es-rt-notice.is-bad { border-left-color: #ffb020; }
/* empty states as panels, the name field a readable width, counts next to titles */
.es-rt-none p { color: var(--es-muted, #9aa1ae) !important; }
.es-rt-empty-box { padding: 18px 14px; border: 1px dashed var(--es-line-2, #343b4a); text-align: center; }
.es-rt-name { max-width: 520px; }
html[data-aim-local]:not(#es) body .es-rt :is(h2, h3) small.es-rt-count { font: 700 11px/1 var(--es-head); letter-spacing: .1em; text-transform: uppercase; color: var(--es-muted, #9aa1ae); vertical-align: middle; }
.es-rt-card h3 { overflow-wrap: anywhere; }
.es-rt-head > p { margin-bottom: 16px; }
/* the editor's Save / Discard stay in reach while a long routine scrolls */
html[data-aim-local]:not(#es) body .es-rt-savebar { position: sticky; bottom: -36px; /* the page's bottom padding: flush with the visible edge */ z-index: 4; margin: 0 -18px -16px; padding: 12px 18px 16px; background: var(--es-panel, #10131a); border-top: 1px solid var(--es-line, #272d39); }
/* the gallery: fits the window, names at most two lines, the search note hides when empty */
html[data-aim-local]:not(#es) body .es-rt-gal { max-height: clamp(200px, calc(100vh - 400px), 560px); }
.es-rt-gcard b { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.es-rt-picknote:empty { display: none; }
/* medals table: in a panel, scrolls sideways on a narrow window instead of squeezing, the buttons in their own column */
.es-rt-tablewrap { overflow-x: auto; padding: 4px 14px 8px; background: var(--es-panel, #10131a); border: 1px solid var(--es-line, #272d39); clip-path: var(--es-cut); }
.es-rt-tablewrap .es-rt-table { min-width: 760px; }
.es-rt-table td:first-child { font-weight: 700; color: var(--es-text, #f4f5f7); }
.es-rt-table tbody tr:not(.es-rt-medalform):hover td { background: rgba(255,255,255,.02); }
.es-rt-table tr.is-editing td, .es-rt-table tr.es-rt-medalform td { background: var(--es-raised, #171b23); }
.es-rt-table tr.es-rt-medalform td { border-top: 0; padding: 4px 8px 12px; }
.es-rt-table .es-rt-tdact { white-space: nowrap; text-align: right; }
html[data-aim-local]:not(#es) body .es-rt-table .es-rt-tdact button { margin-left: 6px; }
.es-rt-table small.es-rt-next { display: block; margin: 6px 0 0; }
.es-rt-medalform label { width: 120px; } .es-rt-medalform label > span { display: inline-flex; align-items: center; gap: 5px; }
.es-rt-medalform .es-rt-badge { width: 16px; height: 18px; flex: none; }
.es-rt-medalform .es-rt-note, .es-rt-medalform .es-rt-err { margin-top: 8px !important; }
.es-rt-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
/* medal badges large enough to tell the three apart (gem shape and pips) */
.es-rt-medal .es-rt-badge { width: 22px; height: 25px; } .es-rt-chip .es-rt-badge { width: 20px; height: 22px; } .es-rt-gmedal .es-rt-badge { width: 18px; height: 20px; }
/* lobby cards: the + sits in the right-hand column under the bookmark and rename buttons (it covered the rank arrow); the medal chip
   goes in the card's footer line (VALORANT Training) or the picture's free bottom-left corner (Target Workshop) instead of over the tags */
html[data-aim-local]:not(#es) body .es-rt-addcard:not(.tw-btn) { top: 74px; right: 20px; width: 26px; height: 26px; }
html[data-aim-local]:not(#es) body .es-rt-addcard:not(.tw-btn):focus-visible { outline: 2px solid #fff !important; outline-offset: -4px !important; }
html[data-aim-local]:not(#es) body .es-rt-chip.is-inline { position: static; margin: -2px 0 -2px auto; padding: 2px 12px 2px 8px; flex: none; }
html[data-aim-local]:not(#es) body .es-rt-chip.is-inline .es-rt-badge { width: 16px; height: 18px; }
html[data-aim-local]:not(#es) body .tw-pv > .es-rt-chip { top: auto; left: 12px; bottom: 12px; }
.es-rt-tabn { display: inline-grid; place-items: center; min-width: 18px; height: 18px; margin-left: 7px; padding: 0 5px; box-sizing: border-box; background: #fff; color: var(--es-red, #ff4655); font: 800 11px/1 var(--es-head); clip-path: var(--es-slant-sm); vertical-align: 1px; }
.hall-tab:not(.is-active) .es-rt-tabn { background: var(--es-red, #ff4655); color: #fff; }
@media (max-width: 900px) { html[data-aim-local]:not(#es) body .es-rt { padding: 18px 16px 36px; } }
`;
  function injectPageCss() {
    try {
      if (!doc || doc.getElementById("aim-routines-page-css")) return;
      const style = doc.createElement("style");
      style.id = "aim-routines-page-css";
      style.textContent = PAGE_CSS;
      (doc.head || doc.documentElement).appendChild(style);
    } catch {}
  }

  // ---- the tab, and the buttons and chips on the lobby's drill cards ----
  function mountTab() {
    const nav = doc.querySelector(".hall-topnav .hall-tabs");
    if (!nav || (tabButton && tabButton.isConnected)) return;
    const col = [...nav.querySelectorAll(".hall-tab")].find((b) => /^\s*collection/i.test(b.textContent));
    tabButton = doc.createElement("button");
    tabButton.type = "button";
    tabButton.className = "hall-tab es-rt-tab";
    tabButton.textContent = "Routines";
    tabButton.addEventListener("click", (e) => { e.stopPropagation(); page ? closePage() : openPage(); });
    nav.insertBefore(tabButton, col || null);
    nav.addEventListener("click", (e) => { if (e.target.closest && e.target.closest(".hall-tab") && !e.target.closest(".es-rt-tab")) closePage(); }, true);
    tabCount = -1; markTab();
  }
  // The top-bar tab shows how many drills the routine being built holds, so a drill added from a lobby card visibly went somewhere.
  let tabCount = -1;
  function markTab() {
    if (!tabButton) return;
    const d = loadDraft(), n = d ? d.steps.length : 0;
    if (n === tabCount) return;
    tabCount = n;
    tabButton.innerHTML = "Routines" + (n ? '<span class="es-rt-tabn" aria-label="' + n + ' drills in the routine being built">' + n + "</span>" : "");
    tabButton.title = n ? "Routines: " + n + (n === 1 ? " drill" : " drills") + " in the routine you are building (not saved yet)" : "Routines";
  }
  const chipFor = (entry) => (entry && entry.bestMedal ? '<span class="es-rt-chip is-' + entry.bestMedal + '" title="Best medal on this drill">' + medalIcon(entry.bestMedal) + MEDAL_LABEL[entry.bestMedal] + "</span>" : "");
  function decorateCards() {
    const runs = loadRuns();
    const mark = (card, code, host, before) => {
      if (!CODE_RE.test(code || "")) return;
      let btn = card.querySelector(".es-rt-addcard");
      if (!btn) {
        btn = doc.createElement("button");
        const small = host === card; btn.type = "button"; btn.className = "es-rt-addcard" + (small ? "" : " tw-btn is-ghost"); btn.textContent = small ? "+" : "+ Routine"; btn.setAttribute("aria-label", "Add to routine"); btn.title = "Add this drill to the routine you are building";
        btn.addEventListener("click", async (e) => {
          e.preventDefault(); e.stopPropagation();
          await loadNames();
          const before = (loadDraft() || { steps: [] }).steps.length, n = addToDraft(code), full = n === before;
          btn.textContent = full ? (small ? "!" : "Routine full") : small ? "✓" : "Added (" + n + ")"; btn.classList.add("is-added");
          btn.title = full ? "The routine you are building is full (" + MAX_STEPS + " drills). Open Routines to save it or remove a drill." : "Added: " + n + (n === 1 ? " drill" : " drills") + " in the routine you are building. Open Routines to save it.";
          clearTimeout(btn._rtReset);
          btn._rtReset = setTimeout(() => { btn.textContent = small ? "+" : "+ Routine"; btn.classList.remove("is-added"); btn.title = "Add this drill to the routine you are building"; }, 1600);
        });
        if (before && before.parentElement === host) host.insertBefore(btn, before); else host.appendChild(btn);
      }
      // the chip's place: the footer line of a VALORANT Training card, the picture of a Target Workshop card, else the card's corner
      const foot = card.querySelector(".al-wk-foot"), pv = card.querySelector(".tw-pv"), spot = foot || pv || card;
      const chip = card.querySelector(".es-rt-chip"), html = chipFor(runs[code]);
      const put = () => { const wrap = doc.createElement("div"); wrap.innerHTML = html; const el = wrap.firstChild; if (foot) el.classList.add("is-inline"); else if (spot === card) card.style.position = card.style.position || "relative"; spot.appendChild(el); };
      if (!html) { if (chip) chip.remove(); } else if (!chip) put();
      else if (!chip.classList.contains("is-" + runs[code].bestMedal) || chip.parentElement !== spot) { chip.remove(); put(); }
    };
    for (const card of doc.querySelectorAll(".tw-card[data-code]")) { const actions = card.querySelector(".tw-actions"); if (actions) mark(card, card.dataset.code, actions, actions.querySelector('[data-act="play"]')); }
    for (const card of doc.querySelectorAll('[data-role="workshop-card"][data-share-code]')) mark(card, card.dataset.shareCode, card, null);
  }
  function check() {
    try {
      injectCss(); injectPageCss();
      mountTab();
      decorateCards();
      if (page && (!doc.querySelector(".hall-root") || doc.querySelector(".al-trainer-shell.al-session-active"))) closePage();
      if (page) fit(); // the lobby's bars settle after the page opened
    } catch {}
  }
  if (doc) {
    addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !page) return;
      if (view.picker.open) { view.picker.open = false; view.focusAfter = '[data-rt="picker-open"]'; render(); return; }
      if (view.medalEdit) { const c = view.medalEdit; view.medalEdit = null; view.medalError = null; view.medalDraft = null; view.focusAfter = '[data-rt="medal-edit"][data-code="' + c + '"]'; render(); return; }
      if (!(e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))) closePage();
    });
    window.addEventListener("aim-routines-change", () => { try { markTab(); } catch {} });
    let fitTimer = 0;
    window.addEventListener("resize", () => { if (!page) return; fit(); clearTimeout(fitTimer); fitTimer = setTimeout(fit, 200); });
    let queuedCheck = false;
    window.__aimWatchPage?.(() => { if (queuedCheck) return; queuedCheck = true; requestAnimationFrame(() => { queuedCheck = false; check(); }); }, { subtree: true, childList: true });
    loadNames().then(check);
    check();
  }

  api.stripHtml = stripHtml; api.readResult = readResult; api.syncResult = sync; api.current = () => current;
  window.__aimRoutines = api;
})();
