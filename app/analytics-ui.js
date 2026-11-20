// Analytics screens (17 Nov 2026, marker aim-analytics-ui-v1). Shows what analytics-recorder.js stored and what coach.js
// concludes from it. Reads only (window.__aimAnalytics readers and window.__aimCoach.insights); writes nothing.
//
//   Hit zones   result screen, LEFT column (inserted after the stat strip, before the buttons), only when the round ended in
//               a death (the verdict splash has "is-died"). A front-view body silhouette (head, chest, arms, stomach, legs) with
//               the shots of the newest stored round: a filled dot per hit and a count per zone, a bold amber ring (theme tip
//               colour, dark halo, larger than the dots) for a miss that passed near an enemy, and a legend. Two tabs (buttons,
//               role "tab", aria-selected; Left / Right / Home / End move between them):
//                 Your killer   (default) the enemy of the round's last death: your hits on it by zone and your near misses
//                               of it. Shot rows keep the enemy TYPE a hit landed on (template), not its actor id, so see
//                               killerShots() for how a shot is tied to the killer (by id where the round allows, else by
//                               type, and the panel says which in plain words).
//                 All my shots  every shot of the round on the same diagram, with totals.
//               The game reports three hit parts ("head", "body", "legs"; any other name counts as body).
//               A body hit is split into chest / stomach / arms by the shot's nearestEnemy point (side and height from the
//               enemy's centre) when the row has one, otherwise it counts on the chest. Rounds store no damage, so damage is
//               shown only when a round carries a numeric "damage" field. Every marker has a title (zone and count).
//   Stats       page content under the Training history board (17 Nov 2026; it was a top-bar "Stats" button and a dialog),
//               see syncStatsHost(); open() still shows the same panel as a dialog for any other caller. Three tabs:
//     Heatmap   death cells per map (1 m cells), on the map's minimap picture when /aim-maps/<map>.minimap.json exists (its
//               transform: u = x * scaleU + offsetU, v = z * scaleV + offsetV), else on a plain grid. Filters: map, mode,
//               drill share code, weapon. With only a map picked the cells come from the day rows' grid (all days kept); a
//               mode, drill or weapon filter needs the raw rounds (last 30 days, newest RAW_ROUNDS).
//               Layer toggle Deaths / Fights / Both (17 Nov 2026): fights are counted on the same 1 m cells by where the PLAYER
//               stood when each engagement began, drawn and shaded like deaths but in the theme's green (--es-green); in Both,
//               deaths stay filled squares and fights become inset outlined squares, each layer shaded by its own maximum.
//               Fight cells: with only a map picked, the day rows' fights grid (recorded since 17 Nov 2026); with a drill or
//               weapon filter, __aimAnalytics.fightCells (raw rounds, last 30 days, newest RAW_ROUNDS; weapon = the weapon at the kill / at the end);
//               with a mode filter, engagements() counted here (fightCells has no mode filter). The note line gives the totals
//               and the fights of the newest RAW_ROUNDS stored rounds that have no position (rounds recorded before the positions existed).
//               "Brighten map" slider (0..100, default 60, kept in localStorage): brightens the minimap picture, see mapLook().
//     Progress  day rows over 7 (the default) / 30 / 90 days: accuracy, headshot rate, deaths per round, near misses, flick and strafe
//               share of kills, and the median kill time (from engagement rows, so the newest RAW_ROUNDS rounds of the last 30 days only), each with the
//               first and latest value and an arrow. With FEW_DAYS (3) days of data or fewer in the range, one point per stored
//               round (up to 30 rounds) or per session instead, see progressBuckets().
//     Coach     __aimCoach.insights() in the order returned: severity colour, sample count, and a "why" that opens the evidence.
// Every view reads once when it is first shown (the panel caches it until closed), every read is in try/catch, and an empty
// or missing store shows a plain message. Raw-round reads are bounded by RAW_ROUNDS (the "rounds" option of the readers). The
// result-screen panel is rewritten only when its html changed (the page-wide watchers wake on every DOM change), and it gives up
// on a read that has not answered after READ_TIMEOUT_MS and shows the plain "no shot record" message.
(() => {
  if (window.__aimAnalyticsUi) return;

  const RAW_ROUNDS = 500;      // newest raw rounds read for the heatmap filters, the fight layer and the kill-time chart
  const READ_TIMEOUT_MS = 3000; // the result-screen panel stops waiting for IndexedDB after this long
  const PROGRESS_DAYS = 90;    // the longest range of the progress view (read once, cut down in memory)
  const RANGES = [7, 30, 90];
  const DEFAULT_RANGE = 7;     // the progress view opens on the last 7 days
  const MARK = "aim-an-hit";   // the result-screen panel's class

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const num = (v) => typeof v === "number" && isFinite(v);
  const pad = (n) => String(n).padStart(2, "0");
  const dayOf = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  const daysAgo = (n, now) => { const d = new Date(now ?? Date.now()); d.setDate(d.getDate() - n); return dayOf(d.getTime()); };
  const analytics = () => { try { return window.__aimAnalytics || null; } catch { return null; } };
  // Calls one reader; any throw, rejection or non-array answer gives [].
  async function read(name, filter) {
    try {
      const A = analytics();
      if (!A || typeof A[name] !== "function") return [];
      const list = await A[name](filter);
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  }
  // Calls a reader that answers one object; any throw, rejection or non-object answer gives null.
  async function readObj(name, filter) {
    try {
      const A = analytics();
      if (!A || typeof A[name] !== "function") return null;
      const v = await A[name](filter);
      return v && typeof v === "object" && !Array.isArray(v) ? v : null;
    } catch { return null; }
  }

  // ---------------------------------------------------------------- styles
  // Everything below follows theme-esports.css: the --es-* palette (the amber #ffb84d is the theme's "time" verdict and
  // round-tip colour), Bahnschrift condensed (font-stretch 75%) uppercase labels, square corners, the .es-tool dialog
  // frame, lobby-style slanted tabs (.hall-tab: --es-slant, red when active), chip buttons (.es-review-chips: line-2
  // border, red wash when pressed), cards with a 3px left bar (.es-review-card / .es-tool-row: line-2, red on hover),
  // inputs like .es-sens-grid and the game's red keyboard focus ring (2px --es-red, 2px offset).
  const CSS = `
.aim-an-hit, .aim-an-panel, .aim-an-mapcard, .aim-an-tipm-shade { --an-warn: var(--es-red, #ff4655); --an-tip: #ffb84d; --an-info: var(--es-muted, #9aa1ae); --an-good: var(--es-green, #4ade80);
  --an-line: var(--es-line, #272d39); --an-line-2: var(--es-line-2, #343b4a); --an-panel: var(--es-panel, #10131a);
  --an-raised: var(--es-raised, #171b23); --an-raised-2: var(--es-raised-2, #1e232d); --an-text: var(--es-text, #f4f5f7); --an-soft: var(--es-soft, #d6d9df);
  --an-muted: var(--es-muted, #9aa1ae); --an-dim: var(--es-dim, #6b7280); --an-red: var(--es-red, #ff4655); --an-red-2: var(--es-red-2, #ff6b77);
  --an-wash: var(--es-red-wash, rgba(255, 70, 85, 0.14)); --an-head: var(--es-head, "Bahnschrift", "Segoe UI", sans-serif);
  --an-slant: var(--es-slant, polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)); --an-slant-sm: var(--es-slant-sm, polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%));
  --an-fight: var(--es-green, #4ade80); --an-fight-hi: color-mix(in srgb, var(--an-fight) 55%, #fff); --an-miss: var(--an-tip); }
.aim-an-hit { box-sizing: border-box; margin: 12px 0 0; padding: 10px 12px 12px; background: rgba(16, 19, 26, 0.88); border-left: 3px solid var(--an-red);
  box-shadow: inset 0 0 0 1px var(--an-line); color: var(--an-text); font: 600 12px/1.35 var(--an-head); }
.aim-an-hit h4 { margin: 0 0 8px; font: 800 italic 15px/1 var(--an-head); font-stretch: 75%; letter-spacing: 0.08em; text-transform: uppercase; color: #fff; }
.aim-an-hit-tabs { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 8px; }
.aim-an-hit-tabs button { flex: 1 1 auto; min-height: 30px; padding: 5px 10px; background: transparent; color: var(--an-muted); border: 0;
  border-bottom: 2px solid var(--an-line); border-radius: 0; font: 700 13px/1.2 var(--an-head); font-stretch: 75%; letter-spacing: 0.04em; text-transform: uppercase; cursor: pointer;
  transition: background-color 0.15s, color 0.15s, border-color 0.15s; }
.aim-an-hit-tabs button:hover { background: var(--an-raised); color: #fff; }
.aim-an-hit-tabs button[aria-selected="true"] { background: var(--an-raised); border-bottom-color: var(--an-red); color: #fff; }
.aim-an-hit-tabs button:focus-visible { outline: 2px solid var(--an-red); outline-offset: 2px; }
/* All tabs share one grid cell, so the panel is as tall as the tallest tab and never changes height on a tab press. */
.aim-an-hit-panes { display: grid; }
.aim-an-hit-pane { grid-area: 1 / 1; min-width: 0; }
.aim-an-hit-pane[hidden] { display: block !important; visibility: hidden; pointer-events: none; }
.aim-an-hit-who { margin: 0 0 8px; color: var(--an-muted); }
.aim-an-hit-who b { color: #fff; }
.aim-an-hit-grid { display: grid; grid-template-columns: clamp(92px, 32%, 132px) minmax(0, 1fr); gap: 10px; align-items: start; }
.aim-an-hit .aim-an-body { display: block; width: 100%; height: auto; }
.aim-an-zone { fill: var(--an-raised-2); stroke: #3b4352; stroke-width: 1; }
.aim-an-guide { fill: none; stroke: #3b4352; stroke-width: 0.8; stroke-dasharray: 2 2; }
.aim-an-zone.is-sphere { fill: var(--an-raised-2); }
.aim-an-zone.is-hit { fill: rgba(255, 70, 85, 0.30); stroke: var(--an-red); }
.aim-an-zone.is-head.is-hit { fill: rgba(255, 70, 85, 0.55); }
.aim-an-dot { fill: #fff; stroke: var(--an-red); stroke-width: 1.4; }
.aim-an-dot.is-head { fill: var(--an-red); stroke: #fff; }
.aim-an-ring-halo { fill: none; stroke: #05070a; stroke-width: 3.8; stroke-opacity: 0.85; }
.aim-an-ring-line { fill: none; stroke: var(--an-miss); stroke-width: 2; }
.aim-an-hit-key { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 8px 0 0; padding: 0; list-style: none; color: var(--an-muted); font-size: 11px; }
.aim-an-hit-key li { display: inline-flex; align-items: center; gap: 5px; }
.aim-an-hit-key svg { display: block; width: 14px; height: 14px; flex: none; }
.aim-an-hit-track { margin: 10px 0 0; padding-top: 8px; border-top: 1px solid var(--an-line-2); display: flex; flex-wrap: wrap; gap: 2px 14px; font-size: 12px; color: var(--an-soft); }
.aim-an-hit-track b { color: #fff; font-weight: 700; }
.aim-an-hit-track > span:first-child { font: 700 11px/1.4 var(--an-head); letter-spacing: 0.1em; text-transform: uppercase; color: var(--an-muted); }
.aim-an-hit-note { margin: 6px 0 0; color: var(--an-dim); font-size: 11px; line-height: 1.4; }
.aim-an-zones { display: grid; gap: 3px; margin: 0; padding: 0; list-style: none; }
.aim-an-zones li { display: flex; justify-content: space-between; gap: 8px; padding: 3px 7px; background: var(--an-raised); border-left: 3px solid var(--an-line-2);
  text-transform: uppercase; letter-spacing: 0.06em; font-size: 11px; color: var(--an-muted); }
.aim-an-zones li b { color: #fff; font: 800 italic 14px/1 var(--an-head); font-stretch: 75%; font-variant-numeric: tabular-nums; }
.aim-an-zones li.is-hit { border-left-color: var(--an-red); color: var(--an-text); }
.aim-an-zero { padding: 8px 0 0; }
.aim-an-hit-sum { margin: 8px 0 0; color: var(--an-muted); font-size: 11.5px; }
.aim-an-hit-sum b { color: #fff; }
.aim-an-none { margin: 6px 0 0; color: var(--an-red-2); font: 800 13px/1.2 var(--an-head); text-transform: uppercase; letter-spacing: 0.06em; }
@media (min-width: 1180px) and (min-height: 680px) {
  html[data-aim-local]:not(#es) body .al-result-overlay:has(> .al-pm) .aim-an-hit { align-self: end !important; margin: 0 !important; }
  /* Side placement (17 Nov 2026): a result screen without the Position map (no shots / no sighting: the game shows its
     "N left" bots card on the right, .al-bots-card.is-side) gets the panel as its own column LEFT of the result card, as
     the map screens get theirs, instead of inside the card under the stats. The panel is then a direct child of the
     overlay (class aim-an-hit-side, set by placePanel only in this media range); each :has() ends in a class. */
  html[data-aim-local]:not(#es) body .al-result-overlay:has(> .aim-an-hit-side) {
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) !important;
    gap: 18px !important; justify-content: stretch !important; align-items: center !important; }
  /* Centred card (19 Nov 2026): the result card stays in the middle of the screen (the two outer columns are equal), the hit report
     is attached to its left edge and the game's bots card, when there is one, to its right edge. */
  html[data-aim-local]:not(#es) body .al-result-overlay:has(> .aim-an-hit-side) > .al-result-modal { justify-self: center; }
  html[data-aim-local]:not(#es) body .al-result-overlay:has(> .aim-an-hit-side) > .al-bots-card { justify-self: start; }
  html[data-aim-local]:not(#es) body .al-result-overlay:has(> .aim-an-hit-side) > .aim-an-hit-side { grid-column: 1; grid-row: 1; }
  html[data-aim-local]:not(#es) body .al-result-overlay:has(> .aim-an-hit-side) > .al-result-modal { grid-column: 2; grid-row: 1; }
  html[data-aim-local]:not(#es) body .al-result-overlay:has(> .aim-an-hit-side) > .al-bots-card { grid-column: 3; grid-row: 1; }
  html[data-aim-local]:not(#es) body .al-result-overlay > .aim-an-hit.aim-an-hit-side { align-self: center; justify-self: end; width: min(100%, clamp(260px, 21vw, 340px)); max-height: 92vh;
    margin: 0; padding: 14px 16px 14px; overflow: hidden auto; scrollbar-width: thin;
    box-shadow: inset 0 0 0 1px var(--an-line), 0 30px 90px rgba(0, 0, 0, 0.5); }
}
/* Entrance (17 Nov 2026): the theme's left-column entrance of the result board (es-rx-in-left: from 16px left, 0.70s,
   cubic-bezier(0.22, 1, 0.36, 1)), timed like that column (verdict splash 1.1s, then +0.20s between the stat strip at +0.16s
   and the buttons at +0.24s; the delay is counted from when the screen appeared, set in --aim-an-hit-d). Only once per
   result screen: the class is set when the panel is first made and taken off when it has played, so a tab switch, a
   re-render or a move to the other placement never plays it again. */
.aim-an-hit.aim-an-hit-enter { animation: es-rx-in-left 0.70s cubic-bezier(0.22, 1, 0.36, 1) var(--aim-an-hit-d, 0s) both; }
@media (prefers-reduced-motion: reduce) { .aim-an-hit.aim-an-hit-enter { animation: none; } }
/* the Stats panel: the .es-tool dialog frame (red top bar, blurred dark glass), wider for the charts */
.es-tool.aim-an-panel { width: min(980px, 100%); }
.es-tool.aim-an-panel .es-tool-head h2 { color: #fff; }
.aim-an-panel :is(button, select, input, summary):focus-visible { outline: 2px solid var(--an-red); outline-offset: 2px; }
/* the view area (fix 17 Nov 2026): one fixed height for Heatmap, Progress and Coach, so switching tabs never changes the panel's
   (or the Training history page's) height and the tab bar never moves; a taller view (a long coach list) scrolls
   inside it. The small padding keeps the 2px focus rings of cards at the edge from being clipped by the scroll box. */
.es-tool.aim-an-panel .aim-an-content { --an-view-h: clamp(460px, calc(100vh - 240px), 860px); position: relative; box-sizing: border-box; height: var(--an-view-h);
  overflow-x: hidden; overflow-y: auto; scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: var(--an-line-2) transparent; padding: 4px 4px 4px 4px; }
/* view tabs: the lobby's tabs (.hall-tab): slanted, muted, raised on hover, red when active */
.aim-an-tabs { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 14px; padding-bottom: 10px; border-bottom: 1px solid var(--an-line); }
.es-tool.aim-an-panel .aim-an-tabs button { height: 36px; padding: 0 20px; background: transparent; color: var(--an-muted); border: 0; border-radius: 0;
  clip-path: var(--an-slant); font: 700 15px var(--an-head); font-stretch: 75%; letter-spacing: 0.04em; text-transform: uppercase; cursor: pointer;
  transition: background-color 0.15s, color 0.15s; }
.es-tool.aim-an-panel .aim-an-tabs button:hover { background: var(--an-raised); color: var(--an-text); }
.es-tool.aim-an-panel .aim-an-tabs button[aria-pressed="true"] { background: var(--an-red); color: #fff; }
.es-tool.aim-an-panel .aim-an-tabs button:focus-visible { clip-path: none; }
/* range picker and heatmap layers: the game's chip buttons (.es-review-chips) */
.aim-an-filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px 12px; margin: 0 0 12px; }
.es-tool.aim-an-panel .aim-an-filters button { height: 30px; padding: 0 12px; background: transparent; color: var(--an-soft); border: 1px solid var(--an-line-2); border-radius: 0;
  font: 700 13px var(--an-head); font-stretch: 75%; letter-spacing: 0.04em; text-transform: uppercase; cursor: pointer; transition: background-color 0.15s, border-color 0.15s, color 0.15s; }
.aim-an-filters[role="group"] { gap: 6px; }
.es-tool.aim-an-panel .aim-an-filters button:hover { background: var(--an-raised); border-color: #fff; color: #fff; }
.es-tool.aim-an-panel .aim-an-filters button[aria-pressed="true"] { background: var(--an-wash); border-color: var(--an-red); color: #fff; }
/* field labels and selects: like the Sens tools fields (.es-sens-grid) */
.aim-an-filters label, .aim-an-bright { font: 700 11px/1.2 var(--an-head); letter-spacing: 0.1em; text-transform: uppercase; color: var(--an-muted); }
.aim-an-filters label { display: grid; gap: 6px; }
.aim-an-filters select { height: 34px; min-width: 120px; max-width: 220px; padding: 0 10px; background: var(--an-panel); color: #fff; border: 1px solid var(--an-line-2); border-radius: 0;
  font: 700 13px var(--an-head); text-transform: none; letter-spacing: 0.02em; cursor: pointer; }
.aim-an-filters select:hover, .aim-an-filters select:focus { border-color: var(--an-red); }
.aim-an-filters select option { background: var(--an-panel); color: var(--an-text); }
/* messages: a row card (.es-tool-row) */
.aim-an-msg { margin: 12px 0; padding: 12px 14px; background: rgba(255, 255, 255, 0.03); border-left: 3px solid var(--an-line-2); color: var(--an-muted); font-size: 13px; line-height: 1.5; }
.aim-an-note { margin: 8px 0 0; color: var(--an-muted); font-size: 12px; line-height: 1.45; }
.aim-an-map { position: relative; width: min(100%, 560px); margin: 0 auto; background: var(--es-bg, #090b0f); border: 1px solid var(--an-line-2); border-top: 2px solid var(--an-red); }
.aim-an-map svg { display: block; width: 100%; height: auto; }
.aim-an-map.has-pic { background: var(--an-raised-2); }
.aim-an-cell { stroke: rgba(5, 7, 10, 0.55); stroke-width: 1; vector-effect: non-scaling-stroke; }
.aim-an-bright { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; }
.aim-an-bright input { flex: 0 1 200px; min-width: 80px; accent-color: var(--an-red); }
.aim-an-bright output { min-width: 3.2em; color: #fff; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
.aim-an-gridline { stroke: rgba(255, 255, 255, 0.06); stroke-width: 1; vector-effect: non-scaling-stroke; }
.aim-an-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 8px 0 0; color: var(--an-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.aim-an-legend i { display: inline-block; width: 120px; height: 8px; background: linear-gradient(90deg, rgba(255, 70, 85, 0.18), rgba(255, 70, 85, 1)); transform: skewX(-20deg); }
.aim-an-legend.is-fight i { background: linear-gradient(90deg, color-mix(in srgb, var(--an-fight) 18%, transparent), var(--an-fight)); }
.aim-an-legend.is-fight.is-outline i { background: none; box-shadow: inset 0 0 0 2px var(--an-fight); }
/* fight squares (A, 17 Nov 2026): a dark edge under a bright theme-green line, so they read on the brightened picture
   like the death cells' thin dark edge does; the fill keeps its count shading */
.aim-an-fight { fill: var(--an-fight); stroke: var(--an-fight-hi); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.aim-an-fight-edge { fill: none; stroke: rgba(5, 7, 10, 0.9); stroke-width: 3.5; vector-effect: non-scaling-stroke; pointer-events: none; }
.aim-an-fight.is-outline { fill: none; stroke: var(--an-fight-hi); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
/* zoom and pan (wheel, drag, double-click resets) */
.aim-an-map svg { touch-action: none; }
.aim-an-map.is-zoomed svg { cursor: grab; }
.aim-an-map.is-dragging svg { cursor: grabbing; }
.es-tool.aim-an-panel .aim-an-filters button.aim-an-zoom-reset { margin-left: auto; }
/* hover card (heatmap cells, chart nodes): the game's dark glass with a red top bar, kept inside the panel */
.aim-an-panel { position: relative; }
.aim-an-tipbox { position: absolute; z-index: 5; max-width: 260px; padding: 7px 10px 8px; background: rgba(10, 12, 17, 0.96); border-top: 2px solid var(--an-red);
  box-shadow: 0 0 0 1px var(--an-line-2), 0 10px 24px rgba(0, 0, 0, 0.5); color: var(--an-text); font: 600 12px/1.45 var(--an-head);
  white-space: pre-line; pointer-events: none; font-variant-numeric: tabular-nums; }
.aim-an-tipbox[hidden] { display: none; }
.aim-an-tipbox b { display: block; font: 800 italic 20px/1.1 var(--an-head); font-stretch: 75%; letter-spacing: 0.02em; color: #fff; text-transform: uppercase; }
.aim-an-tipbox span { display: block; }
.aim-an-tipbox .aim-an-tip-row { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; }
.aim-an-tipbox .aim-an-tip-row em { color: var(--an-soft); font: 700 12px/1 var(--an-head); font-style: normal; font-variant-numeric: tabular-nums; white-space: nowrap; }
.aim-an-tipbox small { display: block; margin-top: 3px; color: var(--an-muted); font-size: 10.5px; line-height: 1.35; }
/* progress charts: cards (.es-review-card): raised, 1px line, 3px left bar; green up, red down */
/* layout (17 Nov 2026, round 2): one large focus chart on top, the other metrics as thumbnails under it; a click on a thumbnail
   makes it the focus */
.aim-an-focus { margin: 0 0 10px; }
.aim-an-focus .aim-an-chart { padding: 14px 16px 12px; }
.aim-an-focus .aim-an-plotbox { height: clamp(220px, 46vh, 560px); }
.aim-an-thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.aim-an-thumbs .aim-an-chart { padding: 8px 10px; cursor: pointer; }
.aim-an-thumbs .aim-an-chart:focus-visible { outline: 2px solid var(--an-red); outline-offset: 2px; }
.aim-an-thumbs .aim-an-chart[aria-pressed="true"] { border-color: var(--an-red); box-shadow: inset 0 0 0 1px var(--an-red); background: var(--an-raised-2); }
.aim-an-thumbs .aim-an-chart h4 { flex-direction: column; gap: 2px; margin: 0 0 4px; font-size: 13px; }
.aim-an-thumbs .aim-an-chart h4 span { font-size: 11px; }
.aim-an-thumbs .aim-an-chart svg { height: 34px; }
.aim-an-thumbs .aim-an-empty { margin: 6px 0; font-size: 11px; }
.aim-an-chart { min-width: 0; padding: 12px; background: var(--an-raised); border: 1px solid var(--an-line); border-left: 3px solid var(--an-line-2); transition: border-color 0.15s; }
.aim-an-chart:hover { border-color: var(--an-line-2); }
.aim-an-chart:not(.is-up):not(.is-down):hover { border-left-color: var(--an-red); }
.aim-an-chart.is-up { border-left-color: var(--an-good); }
.aim-an-chart.is-down { border-left-color: var(--an-red); }
.aim-an-chart h4 { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 8px; margin: 0 0 8px; font: 800 italic 16px/1.15 var(--an-head); font-stretch: 75%; letter-spacing: 0.04em; text-transform: uppercase; color: #fff; }
.aim-an-chart h4 span { font: 700 13px/1.15 var(--an-head); font-style: normal; color: var(--an-muted); letter-spacing: 0.02em; text-transform: none; font-variant-numeric: tabular-nums; }
.aim-an-chart h4 .aim-an-arrow { color: #fff; }
.aim-an-chart.is-up h4 .aim-an-arrow { color: var(--an-good); }
.aim-an-chart.is-down h4 .aim-an-arrow { color: var(--an-red-2); }
.aim-an-chart svg { display: block; width: 100%; height: 70px; }
.aim-an-chart .aim-an-line { fill: none; stroke: var(--an-red); stroke-width: 2; vector-effect: non-scaling-stroke; }
.aim-an-chart .aim-an-pt { fill: #fff; }
/* axes: y labels on the left, subtle gridlines, x date labels under the plot, nodes as round HTML dots (no stretch) */
.aim-an-plot { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 6px; }
.aim-an-yaxis { position: relative; min-width: 34px; }
.aim-an-yaxis span { position: absolute; right: 0; transform: translateY(-50%); color: var(--an-dim); font: 600 10px/1 var(--an-head); font-variant-numeric: tabular-nums; white-space: nowrap; }
/* nodes are placed in % of the plot box, which holds only the svg (same box as its viewBox, preserveAspectRatio none), so a
   node sits exactly on the line at any card size; the x labels live outside it */
.aim-an-plotbox { position: relative; height: 70px; }
.aim-an-plotbox svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.aim-an-chart .aim-an-grid { stroke: rgba(255, 255, 255, 0.07); stroke-width: 1; vector-effect: non-scaling-stroke; }
.aim-an-node { position: absolute; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 1.5px var(--an-red); cursor: default; }
.aim-an-node:hover { background: var(--an-red); box-shadow: 0 0 0 2px #fff; }
.aim-an-xaxis { position: relative; height: 14px; margin: 4px 0 0; }
.aim-an-xaxis span { position: absolute; top: 0; transform: translateX(-50%); color: var(--an-dim); font: 600 10px/1.2 var(--an-head); font-variant-numeric: tabular-nums; white-space: nowrap; }
.aim-an-xaxis span.is-first { transform: none; }
.aim-an-xaxis span.is-last { transform: translateX(-100%); }
.aim-an-chart .aim-an-empty { margin: 18px 0; color: var(--an-dim); font-size: 12px; }
/* coach: the same cards, the left bar in the finding's severity colour, a slanted severity tag */
/* gallery (17 Nov 2026, fixed cards): every card is the same size whatever its content, and the cards fill the view box in
   both directions: equal columns of at least --an-card-min that share its width (auto-fill, so a short last row keeps the
   same card width), and equal rows of at least --an-card-h that share its height (the grid is at least as tall as the view
   box, min-height: 100%, and its rows are 1fr each); with more rows than fit, they stay at --an-card-h and the view box
   scrolls. One column on phones. Inside, each part has a fixed grid cell, so the icon, title and summary sit in the same
   place on every card: the title is clamped to two lines, the summary to one, the visual (or the text) is clipped to its
   cell. A click on the card (or Enter / Space on it) and its Numbers button open the tip modal. */
.aim-an-coach { --an-card-min: 340px; --an-card-h: 260px; box-sizing: border-box; display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--an-card-min), 1fr));
  grid-auto-rows: minmax(var(--an-card-h), 1fr); min-height: 100%; align-content: stretch; gap: 14px; margin: 0; padding: 0; list-style: none; }
.aim-an-coach li { display: grid; min-width: 0; min-height: 0; }
.aim-an-coach .aim-an-card { box-sizing: border-box; display: grid; grid-template-columns: 32px minmax(0, 1fr); grid-template-rows: 46px 20px minmax(0, 1fr) 30px;
  gap: 8px 12px; width: 100%; height: 100%; margin: 0; padding: 16px; overflow: hidden; background: var(--an-raised); border: 1px solid var(--an-line);
  border-left: 3px solid var(--sev, var(--an-info)); color: var(--an-soft); font: 600 13px/1.45 var(--an-head); cursor: pointer; transition: background-color 0.15s, border-color 0.15s; }
.aim-an-coach .aim-an-card:hover { background: var(--an-raised-2); border-color: var(--an-line-2); border-left-color: var(--sev, var(--an-info)); }
.aim-an-coach .aim-an-card:focus-visible { outline: 2px solid var(--an-red); outline-offset: 2px; }
.aim-an-card > .aim-an-icon { grid-column: 1; grid-row: 1; width: 32px; height: 32px; color: var(--an-red-2); }
.aim-an-card h4 { grid-column: 2; grid-row: 1; align-self: start; min-width: 0; margin: 0; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
  font: 800 19px/1.2 var(--an-head); font-stretch: 75%; letter-spacing: 0.01em; text-transform: none; color: #fff; overflow-wrap: anywhere; }
.aim-an-card > .aim-an-main { grid-column: 2; grid-row: 2; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-stretch: 75%; }
.aim-an-card-vis, .aim-an-card .aim-an-card-text { grid-column: 1 / -1; grid-row: 3; min-width: 0; min-height: 0; margin: 0; overflow: hidden; }
.aim-an-card-vis { box-sizing: border-box; padding: 8px 10px; background: var(--an-panel); border-left: 2px solid var(--an-line-2); }
.aim-an-card-vis svg { display: block; width: 100%; height: 100%; }
.aim-an-card-vis text { fill: var(--an-soft); font: 700 10px var(--an-head); }
.aim-an-card-vis .is-key { fill: #fff; }
.aim-an-card .aim-an-card-text { align-self: start; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 5; color: var(--an-soft); font-size: 13px; line-height: 1.45; }
.es-tool.aim-an-panel .aim-an-card .aim-an-numbers { grid-column: 1 / -1; grid-row: 4; justify-self: start; height: 30px; padding: 0 14px; background: transparent; color: var(--an-soft);
  border: 1px solid var(--an-line-2); border-radius: 0; font: 700 12px var(--an-head); font-stretch: 75%; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s, color 0.15s; }
.es-tool.aim-an-panel .aim-an-card .aim-an-numbers:hover { background: var(--an-wash); border-color: var(--an-red); color: #fff; }
/* fine print at the bottom of the tip modal (a note on what the numbers include) */
.aim-an-detail .aim-an-fine { margin: 10px 0 0; color: var(--an-dim); font-size: 11px; line-height: 1.45; }
/* references in the coach text (refHtml): map names (hover or focus shows the map's gallery picture) and drills (shown by
   title; hover or focus shows the drill's card, a click or Enter plays it) */
.aim-an-mapref { color: #fff; font-weight: 700; border-bottom: 1px dotted var(--an-red-2); cursor: help; }
.aim-an-mapref.aim-an-drillref { border-bottom-style: solid; cursor: pointer; }
.aim-an-mapref:hover, .aim-an-mapref:focus-visible { color: var(--an-red-2); outline: none; }
.aim-an-mapcard .aim-an-refmeta { display: block; padding: 4px 10px 0; color: var(--an-muted); font: 700 11px/1.3 var(--an-head); letter-spacing: 0.04em; }
.aim-an-mapcard .aim-an-refmeta:last-child { color: var(--an-dim); }
/* the tip modal (openTip): the .es-tool dialog frame on its own shade above the Stats panel, scrolling inside itself */
.es-tool-shade.aim-an-tipm-shade { z-index: 2147482300; }
.es-tool.aim-an-tipm { width: min(600px, 100%); max-height: calc(100vh - 48px); overflow: auto; overscroll-behavior: contain; border-left: 3px solid var(--sev, var(--an-info)); }
.es-tool.aim-an-tipm:focus { outline: none; }
.aim-an-tipm :is(button, input, [tabindex="0"]):focus-visible { outline: 2px solid var(--an-red); outline-offset: 2px; }
.aim-an-tipm-head > .aim-an-icon { flex: none; width: 34px; height: 34px; margin-top: 2px; color: var(--an-red-2); }
.aim-an-tipm-titles { flex: 1; display: grid; gap: 6px; min-width: 0; }
.es-tool.aim-an-tipm h3 { margin: 0; font: 800 22px/1.15 var(--an-head); font-stretch: 75%; letter-spacing: 0.01em; text-transform: none; color: #fff; overflow-wrap: anywhere; }
.es-tool.aim-an-tipm .aim-an-tipm-head .aim-an-main { margin: 0; color: var(--an-soft); font: 700 15px/1.3 var(--an-head); }
.aim-an-tipm p { margin: 6px 0 0; color: var(--an-soft); font-size: 13px; line-height: 1.5; }
@media (prefers-reduced-motion: reduce) { .es-tool-shade.aim-an-tipm-shade, .es-tool.aim-an-tipm { animation: none; } }
.aim-an-mapcard { position: fixed; z-index: 2147482600; width: 260px; padding: 0 0 8px; background: rgba(10, 12, 17, 0.97); border-top: 3px solid var(--an-red);
  box-shadow: 0 0 0 1px var(--an-line-2), 0 14px 30px rgba(0, 0, 0, 0.55); color: var(--an-text); font: 700 12px/1.3 var(--an-head); pointer-events: none; }
.aim-an-mapcard[hidden] { display: none; }
.aim-an-mapcard img { display: block; width: 260px; height: 140px; object-fit: cover; }
.aim-an-mapcard b { display: block; padding: 7px 10px 0; font: 800 italic 16px/1 var(--an-head); font-stretch: 75%; letter-spacing: 0.06em; text-transform: uppercase; }
html[data-aim-local]:not(#es) body .es-tool.aim-an-panel .aim-an-card { text-transform: none !important; }
/* the rule's icon (COACH_ICON): a self-drawn line glyph in the theme red, beside the title */
.aim-an-icon svg { display: block; width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.aim-an-main { color: var(--an-soft); font: 700 14px/1.3 var(--an-head); font-variant-numeric: tabular-nums; }
/* readable line length for running text */
.aim-an-detail p, .aim-an-note, .aim-an-msg, .aim-an-panel .es-tool-head p { max-width: 62ch; }
.aim-an-detail .aim-an-lead { margin: 2px 0 0; color: #fff; font-size: 14px; }
.aim-an-detail .aim-an-advice { margin: 10px 0 0; padding-left: 10px; border-left: 2px solid var(--sev, var(--an-info)); }
.aim-an-vis h5 { margin: 0 0 8px; font: 800 12px var(--an-head); letter-spacing: 0.1em; text-transform: uppercase; color: var(--an-red-2); }
.aim-an-dist { display: flex; align-items: center; gap: 10px; margin: 8px 0 0; font: 700 11px/1.2 var(--an-head); letter-spacing: 0.1em; text-transform: uppercase; color: var(--an-muted); }
.aim-an-dist input { flex: 0 1 180px; min-width: 80px; accent-color: var(--an-red); }
.aim-an-dist output { min-width: 3em; color: #fff; font-variant-numeric: tabular-nums; }
.aim-an-vis { margin: 10px 0 0; padding: 10px 12px; background: var(--an-panel); border-left: 2px solid var(--an-line-2); }
.aim-an-vis svg { display: block; width: 100%; max-width: 360px; height: auto; }
.aim-an-vis text { fill: var(--an-soft); font: 700 10px var(--an-head); }
.aim-an-vis .is-key { fill: #fff; }
.aim-an-bars { display: grid; gap: 5px; }
.aim-an-track-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin: 0 0 16px; }
.aim-an-track-tile { display: grid; gap: 4px; padding: 10px 12px; background: var(--an-panel); border: 1px solid var(--an-line-2); }
.aim-an-track-tile span { font: 700 11px/1.2 var(--an-head); letter-spacing: 0.1em; text-transform: uppercase; color: var(--an-muted); }
.aim-an-track-tile b { font: 700 24px/1.1 var(--an-head); color: #fff; }
.aim-an-track-tile em { font-style: normal; font-size: 12px; color: var(--an-soft); }
.aim-an-bar { display: grid; grid-template-columns: minmax(70px, 34%) minmax(0, 1fr) auto; align-items: center; gap: 8px; color: var(--an-muted); font: 700 12px/1.2 var(--an-head); }
.aim-an-bar i { display: block; height: 10px; background: rgba(255, 255, 255, 0.05); }
.aim-an-bar i b { display: block; height: 100%; background: var(--an-info); }
.aim-an-bar.is-good i b { background: var(--an-good); }
.aim-an-bar.is-bad i b, .aim-an-bar.is-key i b { background: var(--an-red); }
.aim-an-bar em { min-width: 3.5em; color: #fff; font-style: normal; text-align: right; font-variant-numeric: tabular-nums; }
.aim-an-coach li.is-warn, .aim-an-tipm.is-warn { --sev: var(--an-warn); }
.aim-an-coach li.is-tip, .aim-an-tipm.is-tip { --sev: var(--an-tip); }
.aim-an-coach li.is-info, .aim-an-tipm.is-info { --sev: var(--an-info); }
.aim-an-coach-top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.aim-an-sev { padding: 3px 9px; font: 800 10px/1.2 var(--an-head); letter-spacing: 0.08em; text-transform: uppercase; color: #0a0d10; background: var(--sev, var(--an-info)); clip-path: var(--an-slant-sm); }
.aim-an-sample { margin-left: auto; color: var(--an-dim); font: 800 11px var(--an-head); letter-spacing: 0.1em; text-transform: uppercase; font-variant-numeric: tabular-nums; }
.aim-an-why { margin: 10px 0 0; }
.aim-an-why h5 { margin: 0; color: var(--an-red-2); font: 800 12px var(--an-head); letter-spacing: 0.1em; text-transform: uppercase; }
.aim-an-why dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 12px; margin: 6px 0 0; padding: 8px 10px; background: var(--an-panel); border-left: 2px solid var(--an-line-2); font-size: 12px; }
.aim-an-why dt { color: var(--an-muted); }
.aim-an-why dd { margin: 0; color: #fff; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
@media (max-width: 420px) {
  .aim-an-hit { padding: 8px 9px 10px; }
  .aim-an-hit-grid { grid-template-columns: 88px minmax(0, 1fr); gap: 8px; }
  .aim-an-zones li { padding: 3px 5px; letter-spacing: 0.03em; }
  .aim-an-why dl { grid-template-columns: minmax(0, 1fr); }
  .aim-an-why dd { margin-bottom: 4px; }
}
@media (max-width: 620px) {
  /* 16px gutter at phone width: the shade and the panel's own padding */
  .es-tool-shade.aim-an-shade { padding: 16px; }
  .es-tool.aim-an-panel { max-height: calc(100vh - 32px); }
  .es-tool.aim-an-panel .es-tool-head { padding: 16px 16px 8px; }
  .es-tool.aim-an-panel .es-tool-body { padding: 6px 16px 16px; }
  /* seven tabs: four and three in two rows, instead of three ragged rows */
  .es-tool.aim-an-panel .aim-an-tabs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .es-tool.aim-an-panel .aim-an-tabs button { min-width: 0; height: 34px; padding: 0 4px; font-size: 12px; letter-spacing: 0.04em; }
  .aim-an-charts { grid-template-columns: minmax(0, 1fr); }
  .aim-an-filters select { min-width: 0; max-width: 100%; width: 100%; }
  .aim-an-filters label { flex: 1 1 40%; min-width: 0; }
  .aim-an-coach { grid-template-columns: minmax(0, 1fr); }
  .es-tool-shade.aim-an-tipm-shade { padding: 16px; }
  .es-tool.aim-an-tipm { max-height: calc(100vh - 32px); }
  .es-tool.aim-an-tipm .es-tool-head { padding: 16px 16px 8px; }
  .es-tool.aim-an-tipm .es-tool-body { padding: 6px 16px 16px; }
  .es-tool.aim-an-panel .aim-an-content { --an-view-h: clamp(360px, calc(100vh - 200px), 860px); }
  .es-tool.aim-an-panel.aim-an-inline .es-tool-head { padding: 16px 16px 8px; }
  .es-tool.aim-an-panel.aim-an-inline .es-tool-body { padding: 6px 16px 16px; }
}
/* inline mode (Training history page): the same panel as page content, no dialog frame or animation */
.es-tool.aim-an-panel.aim-an-inline { width: auto; max-width: none; max-height: none; overflow: visible; margin: 18px 0 0; animation: none; box-shadow: none;
  backdrop-filter: none; background: rgba(14, 17, 23, 0.72); }
.aim-an-stats-host[hidden] { display: none !important; }
/* Session, Drills, Compare and the export strip (20 Nov 2026). Same cards, same left bar, same fixed view height as the other tabs. */
.aim-an-sub { margin: 18px 0 8px; font: 700 12px/1.2 var(--an-head); letter-spacing: 0.1em; text-transform: uppercase; color: var(--an-muted); }
.aim-an-filters + .aim-an-track-tiles, .aim-an-filters + .aim-an-note { margin-top: 0; }
.aim-an-timeline { display: flex; align-items: flex-end; gap: 3px; height: 96px; padding: 6px; background: var(--an-panel); border: 1px solid var(--an-line-2); border-left: 3px solid var(--an-red); }
.aim-an-tl { flex: 1 1 0; min-width: 4px; max-width: 30px; background: var(--an-info); cursor: default; transition: filter 0.12s; }
.aim-an-tl:hover { filter: brightness(1.3); }
.aim-an-tl.is-cleared, .aim-an-tl-key i.is-cleared { background: var(--an-good); }
.aim-an-tl.is-time, .aim-an-tl-key i.is-time { background: var(--an-tip); }
.aim-an-tl.is-died, .aim-an-tl-key i.is-died { background: var(--an-red); }
.aim-an-tl-key i.is-other { background: var(--an-info); }
.aim-an-tl-key i { display: inline-block; width: 10px; height: 10px; }
.aim-an-versus { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }
.aim-an-vs { min-width: 0; padding: 10px 12px; background: var(--an-raised); border: 1px solid var(--an-line); border-left: 3px solid var(--an-line-2); }
.aim-an-vs.is-up { border-left-color: var(--an-good); }
.aim-an-vs.is-down { border-left-color: var(--an-red); }
.aim-an-vs h4 { margin: 0 0 6px; font: 800 italic 14px/1 var(--an-head); font-stretch: 75%; letter-spacing: 0.08em; text-transform: uppercase; color: #fff; }
.aim-an-vs ul { margin: 0; padding: 0 0 0 16px; color: var(--an-soft); font-size: 13px; line-height: 1.55; }
.aim-an-vs p { margin: 0; color: var(--an-dim); font-size: 12px; }
.aim-an-sess-drills { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.aim-an-sess-drills li { display: grid; grid-template-columns: minmax(0, 1fr) 96px 64px 120px; gap: 8px; align-items: center; padding: 6px 10px; background: var(--an-raised); border: 1px solid var(--an-line); border-left: 3px solid var(--an-line-2);
  color: var(--an-soft); font: 600 13px/1.3 var(--an-head); font-variant-numeric: tabular-nums; }
.aim-an-sess-drills.aim-an-sd-six li { grid-template-columns: minmax(0, 1fr) 72px 46px 96px 86px minmax(120px, 1.1fr); }
.aim-an-sd-score { text-align: right; }
.aim-an-sd-change { min-width: 0; color: var(--an-muted); font-size: 12px; }
.aim-an-sd-change b { font-weight: 700; }
.aim-an-sd-change b.is-up { color: var(--an-good); }
.aim-an-sd-change b.is-down { color: var(--an-red-2); }
.aim-an-sd-change b.is-same { color: var(--an-soft); }
.aim-an-sd-change small { color: var(--an-dim); font-size: 11px; }
.aim-an-sd-change.is-new { color: var(--an-dim); }
.aim-an-sd-name { overflow: hidden; color: #fff; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.aim-an-medal { display: inline-flex; align-items: center; gap: 5px; margin-right: 10px; color: var(--an-soft); font: 700 12px/1 var(--an-head); }
.aim-an-medal svg { display: block; width: 16px; height: 18px; flex: none; }
.aim-an-medal small { color: var(--an-dim); }
.aim-an-medal.is-none { width: 16px; height: 18px; margin: 0; }
.aim-an-sess-medals { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 0; margin: 0 0 4px; color: var(--an-muted); font: 700 11px/1.2 var(--an-head); letter-spacing: 0.1em; text-transform: uppercase; }
.aim-an-sess-medals .aim-an-medal { margin-left: 10px; margin-right: 0; letter-spacing: 0; text-transform: none; }
/* Drills */
.aim-an-drills { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.aim-an-drill { display: grid; grid-template-columns: 20px minmax(0, 1fr) 96px 72px 72px 64px 64px; gap: 10px; align-items: center; padding: 7px 10px; background: var(--an-raised); border: 1px solid var(--an-line); border-left: 3px solid var(--an-line-2);
  color: var(--an-soft); font: 700 13px/1.2 var(--an-head); cursor: pointer; transition: border-color 0.15s, background-color 0.15s; }
.aim-an-drill:hover { background: var(--an-raised-2); border-left-color: var(--an-red); }
.aim-an-drill:focus-visible { outline: 2px solid var(--an-red); outline-offset: 2px; }
.aim-an-drill.is-up { border-left-color: var(--an-good); }
.aim-an-drill.is-down { border-left-color: var(--an-red); }
.aim-an-drill-name { min-width: 0; overflow: hidden; color: #fff; text-overflow: ellipsis; white-space: nowrap; }
.aim-an-drill-name small, .aim-an-drill-num small { display: block; color: var(--an-dim); font: 600 11px/1.3 var(--an-head); }
.aim-an-drill-num { color: #fff; text-align: right; font-variant-numeric: tabular-nums; }
.aim-an-drill-trend { text-align: right; font-variant-numeric: tabular-nums; }
.aim-an-drill.is-up .aim-an-drill-trend { color: var(--an-good); }
.aim-an-drill.is-down .aim-an-drill-trend { color: var(--an-red-2); }
.aim-an-spread { text-align: right; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--an-muted); }
.aim-an-spread.is-steady { color: var(--an-good); }
.aim-an-spread.is-swingy { color: var(--an-tip); }
.aim-an-spark { display: block; width: 96px; height: 24px; }
.aim-an-spark .aim-an-line, .aim-an-score .aim-an-line { fill: none; stroke: var(--an-red); stroke-width: 1.7; stroke-linejoin: round; }
.aim-an-spark .aim-an-pt { fill: #fff; }
.aim-an-drill-title { margin: 4px 0 12px; font: 800 italic 22px/1.1 var(--an-head); font-stretch: 75%; letter-spacing: 0.04em; text-transform: uppercase; color: #fff; }
.aim-an-medals-row { display: flex; flex-wrap: wrap; gap: 6px 0; margin: 0 0 6px; }
.aim-an-prog { height: 8px; margin: 6px 0 4px; background: rgba(255, 255, 255, 0.06); }
.aim-an-prog i { display: block; height: 100%; background: var(--an-red); }
.aim-an-scorewrap { max-width: 860px; padding: 10px 12px; background: var(--an-raised); border: 1px solid var(--an-line); border-left: 3px solid var(--an-line-2); }
.aim-an-score { display: block; width: 100%; height: auto; }
.aim-an-score .aim-an-grid { stroke: rgba(255, 255, 255, 0.07); stroke-width: 1; }
.aim-an-score .aim-an-axis { fill: var(--an-muted); font: 600 10px var(--an-head); }
.aim-an-medal-tag { font: 700 9px var(--an-head); letter-spacing: 0.06em; text-transform: uppercase; }
.aim-an-medal-tag.is-bronze { fill: #e8a867; }
.aim-an-medal-tag.is-silver { fill: #c9d1da; }
.aim-an-medal-tag.is-gold { fill: #ffd24d; }
.aim-an-medal-line { stroke-width: 1; stroke-dasharray: 5 4; }
.aim-an-medal-line.is-bronze { stroke: #e8a867; }
.aim-an-medal-line.is-silver { stroke: #c9d1da; }
.aim-an-medal-line.is-gold { stroke: #ffd24d; }
.aim-an-run { fill: #fff; stroke: var(--an-red); stroke-width: 1.4; }
.aim-an-run.is-died { fill: var(--an-panel); stroke: var(--an-red-2); }
.aim-an-best-ring { fill: none; stroke: var(--an-tip); stroke-width: 1.6; }
/* Goals and the suggested warm-up (21 Nov 2026) */
.aim-an-goals { display: grid; gap: 6px; margin: 0 0 10px; padding: 0; list-style: none; }
.aim-an-goal { padding: 8px 12px; background: var(--an-raised); border: 1px solid var(--an-line); border-left: 3px solid var(--an-line-2); }
.aim-an-goal.is-done { border-left-color: var(--an-good); }
.aim-an-goal-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.aim-an-goal-head b { color: #fff; font: 700 13px/1.2 var(--an-head); letter-spacing: 0.04em; text-transform: uppercase; }
.es-tool.aim-an-panel .aim-an-goal-del { width: 26px; height: 26px; padding: 0; background: transparent; color: var(--an-muted); border: 0; border-radius: 0; font-size: 12px; cursor: pointer; }
.es-tool.aim-an-panel .aim-an-goal-del:hover { background: var(--an-raised-2); color: #fff; }
.aim-an-goal .aim-an-prog { margin: 6px 0 4px; }
.aim-an-goal.is-done .aim-an-prog i { background: var(--an-good); }
.aim-an-goal small { color: var(--an-muted); font-size: 12px; }
.aim-an-goal-add { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px 14px; margin: 0 0 6px; }
.es-tool.aim-an-panel .aim-an-goal-add > button, .es-tool.aim-an-panel .aim-an-goal-form button, .es-tool.aim-an-panel .aim-an-warm-actions button {
  display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px; background: transparent; color: var(--an-soft); border: 1px solid var(--an-line-2); border-radius: 0;
  font: 700 12px/1 var(--an-head); letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; clip-path: var(--an-slant-sm); transition: background-color 0.15s, border-color 0.15s, color 0.15s; }
.es-tool.aim-an-panel .aim-an-goal-add > button:hover, .es-tool.aim-an-panel .aim-an-goal-form button:hover, .es-tool.aim-an-panel .aim-an-warm-actions button:hover { background: var(--an-raised); border-color: #fff; color: #fff; }
.aim-an-goal-add svg { display: block; width: 16px; height: 18px; flex: none; }
.aim-an-goal-form { display: flex; align-items: flex-end; gap: 6px; }
.aim-an-goal-form label { display: grid; gap: 6px; font: 700 11px/1.2 var(--an-head); letter-spacing: 0.1em; text-transform: uppercase; color: var(--an-muted); }
.aim-an-goal-form input { box-sizing: border-box; width: 120px; height: 34px; padding: 0 10px; background: var(--an-panel); color: #fff; border: 1px solid var(--an-line-2); border-radius: 0; font: 600 13px var(--an-head); font-variant-numeric: tabular-nums; }
.aim-an-goal-form input:hover, .aim-an-goal-form input:focus { border-color: var(--an-red); }
.aim-an-warm { margin: 0 0 14px; padding: 10px 12px 12px; background: var(--an-raised); border: 1px solid var(--an-line); border-left: 3px solid var(--an-line-2); }
.aim-an-warm.is-cold { border-left-color: var(--an-tip); }
.aim-an-warm h4 { margin: 0 0 4px; font: 800 italic 14px/1 var(--an-head); font-stretch: 75%; letter-spacing: 0.08em; text-transform: uppercase; color: #fff; }
.aim-an-warm p { margin: 0 0 8px; color: var(--an-soft); font-size: 13px; line-height: 1.5; }
.aim-an-warm ol { display: grid; gap: 4px; margin: 0 0 10px; padding: 0; list-style: none; }
.aim-an-warm li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; padding: 5px 8px; background: var(--an-panel); border-left: 2px solid var(--an-line-2); color: var(--an-soft); font-size: 13px; }
.aim-an-warm li i { color: var(--an-red-2); font: 800 italic 14px/1 var(--an-head); font-style: italic; }
.aim-an-warm li b { color: #fff; font-weight: 700; }
.aim-an-warm li em { color: var(--an-muted); font-style: normal; font-size: 12px; }
.aim-an-warm-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.aim-an-warm-msg { color: var(--an-muted); font-size: 12px; }
/* Compare */
.aim-an-cmp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; }
.aim-an-cmp { display: grid; gap: 4px; min-width: 0; padding: 12px; background: var(--an-raised); border: 1px solid var(--an-line); border-left: 3px solid var(--an-line-2); }
.aim-an-cmp.is-up { border-left-color: var(--an-good); }
.aim-an-cmp.is-down { border-left-color: var(--an-red); }
.aim-an-cmp-label { font: 700 11px/1.2 var(--an-head); letter-spacing: 0.1em; text-transform: uppercase; color: var(--an-muted); }
.aim-an-cmp b { font: 700 26px/1.1 var(--an-head); color: #fff; font-variant-numeric: tabular-nums; }
.aim-an-cmp b .aim-an-arrow { font-style: normal; }
.aim-an-cmp.is-up b .aim-an-arrow { color: var(--an-good); }
.aim-an-cmp.is-down b .aim-an-arrow { color: var(--an-red-2); }
.aim-an-cmp-delta { min-height: 1.2em; color: var(--an-soft); font: 700 13px/1.2 var(--an-head); font-variant-numeric: tabular-nums; }
.aim-an-cmp-bars { display: grid; gap: 3px; margin: 2px 0; }
.aim-an-cmp-bars i { display: block; height: 6px; background: rgba(255, 255, 255, 0.05); }
.aim-an-cmp-bars i b { display: block; height: 100%; background: var(--an-red); font-size: 0; }
.aim-an-cmp-bars i.is-before b { background: var(--an-line-2); }
.aim-an-cmp small { color: var(--an-dim); font-size: 11px; line-height: 1.35; }
/* Export strip under the view: part of the panel, so the view height stays the same on every tab */
.aim-an-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 10px 0 0; padding-top: 10px; border-top: 1px solid var(--an-line); }
.aim-an-foot-label { margin-right: 4px; color: var(--an-muted); font: 700 11px/1.2 var(--an-head); letter-spacing: 0.1em; text-transform: uppercase; }
.es-tool.aim-an-panel .aim-an-foot button { height: 30px; padding: 0 12px; background: transparent; color: var(--an-soft); border: 1px solid var(--an-line-2); border-radius: 0; font: 700 12px/1 var(--an-head); letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer;
  clip-path: var(--an-slant-sm); transition: background-color 0.15s, border-color 0.15s, color 0.15s; }
.es-tool.aim-an-panel .aim-an-foot button:hover { background: var(--an-raised); border-color: #fff; color: #fff; }
.aim-an-foot-msg { color: var(--an-muted); font-size: 12px; }
/* Hit report: heat density under the dots, and how you fire */
.aim-an-heat circle { fill: rgba(255, 70, 85, 0.14); }
.aim-an-hit-sub { margin: 10px 0 5px; font: 700 11px/1.2 var(--an-head); letter-spacing: 0.1em; text-transform: uppercase; color: var(--an-muted); }
.aim-an-hit .aim-an-bars { gap: 3px; }
.aim-an-hit .aim-an-bar { grid-template-columns: minmax(70px, 44%) minmax(0, 1fr) auto; font-size: 11.5px; }
.aim-an-hit .aim-an-bar i { height: 7px; }
.aim-an-hit .aim-an-bar em { min-width: 3em; }
@media (max-width: 760px) {
  .aim-an-drill { grid-template-columns: 20px minmax(0, 1fr) 72px 64px; }
  .aim-an-drill .aim-an-spark, .aim-an-drill .aim-an-drill-num + .aim-an-drill-num, .aim-an-drill .aim-an-spread { display: none; }
  .aim-an-sess-drills li { grid-template-columns: minmax(0, 1fr) 70px 50px; }
  .aim-an-sess-drills li > :nth-child(4) { display: none; }
  .aim-an-sess-drills.aim-an-sd-six li { grid-template-columns: minmax(0, 1fr) 62px 46px; }
  .aim-an-sess-drills.aim-an-sd-six li > :nth-child(4), .aim-an-sess-drills.aim-an-sd-six li > :nth-child(5) { display: none; }
  .aim-an-sess-drills.aim-an-sd-six li > .aim-an-sd-change { grid-column: 1 / -1; }
}
@media (max-width: 480px) {
  /* the names wrap to two lines instead of being cut to three letters; the small line under them goes */
  .aim-an-drill { grid-template-columns: 20px minmax(0, 1fr) auto auto; gap: 8px; }
  .aim-an-drill-name { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; white-space: normal; line-height: 1.2; }
  .aim-an-drill-name small { display: none; }
  .aim-an-drill-trend { min-width: 52px; }
}
/* ---- Stats review (round 3, ui-stats, 20 Nov 2026): legibility, density, motion and keyboard ---- */
/* axis labels: 11px in the muted grey (the dim grey was under AA contrast on the dark cards) */
.aim-an-yaxis span, .aim-an-xaxis span { color: var(--an-muted); font-size: 11px; }
.aim-an-score .aim-an-axis { fill: var(--an-muted); font-size: 11px; }
.aim-an-xaxis { height: 16px; }
/* the large progress chart leaves room for the thumbnails under it */
.aim-an-focus .aim-an-plotbox { height: clamp(170px, 30vh, 340px); }
/* coach cards: a fixed card height, not stretched to fill the view (two findings made two half-screen-tall cards) */
.aim-an-coach { --an-card-h: 244px; grid-auto-rows: var(--an-card-h); min-height: 0; align-content: start; }
/* tiles: six fit one row from about 800px of view width */
.aim-an-track-tiles { grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); }
/* the heatmap is never taller than the view, so its legend shows without scrolling */
.aim-an-map { width: min(100%, 560px, calc(var(--an-view-h, 620px) - 200px)); min-width: min(100%, 260px); }
/* bars (tracking by weapon and by day, the coach's visuals): label, bar and value stay together on wide screens */
.es-tool.aim-an-panel .aim-an-content > .aim-an-bars { max-width: 640px; }
/* drill detail: white title like the other titles, a progress bar that does not read as a divider, a run list as wide as the chart */
.es-tool.aim-an-panel .es-tool-body .aim-an-drill-title { margin: 4px 0 12px; color: #fff; font: 800 italic 22px/1.15 var(--an-head); font-stretch: 75%; letter-spacing: 0.04em; overflow-wrap: anywhere; }
.aim-an-prog { max-width: 520px; }
.aim-an-goal .aim-an-prog { max-width: none; }
.aim-an-drill-runs { max-width: 860px; }
.aim-an-medal small { color: var(--an-muted); }
/* drill rows: the trend and consistency columns name themselves, like Last and Best */
.aim-an-drill-trend small, .aim-an-spread small { display: block; color: var(--an-dim); font: 600 11px/1.3 var(--an-head); letter-spacing: 0; text-transform: none; }
.aim-an-drill.is-up .aim-an-drill-trend small, .aim-an-drill.is-down .aim-an-drill-trend small { color: var(--an-dim); }
/* session timeline: a died round is hatched as well as red, so the result does not rest on colour alone */
.aim-an-tl.is-died, .aim-an-tl-key i.is-died { background: repeating-linear-gradient(-45deg, var(--an-red) 0 3px, #8a1c27 3px 6px); }
.aim-an-tl-key li.aim-an-tl-note { margin-left: auto; color: var(--an-dim); }
/* tip modal title: sentence case like the card it came from (a long uppercase sentence is hard to read) */
html[data-aim-local]:not(#es) body .es-tool.aim-an-tipm h3 { text-transform: none !important; }
/* keyboard: a chart, the round strip and the score chart take focus; arrows move between their points and show the hover card */
.aim-an-plotbox[tabindex], .aim-an-timeline[tabindex], .aim-an-scorewrap[tabindex] { outline: none; }
.aim-an-plotbox[tabindex]:focus-visible, .aim-an-timeline[tabindex]:focus-visible, .aim-an-scorewrap[tabindex]:focus-visible { outline: 2px solid var(--an-red); outline-offset: 3px; }
.aim-an-node.is-active { background: var(--an-red); box-shadow: 0 0 0 2px #fff; }
.aim-an-tl.is-active { filter: brightness(1.35); outline: 1px solid #fff; outline-offset: 1px; }
.aim-an-run.is-active { stroke: #fff; stroke-width: 2.4; }
/* motion: a view fades in on a tab switch; a chart wipes in left to right (the theme's slanted wipe) the first time it is drawn,
   the round strip grows up; transform / opacity / clip-path only, never on a filter or sort redraw of the same chart */
@keyframes aim-an-view-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes aim-an-wipe { from { clip-path: polygon(0 0, 0 0, -12% 100%, -12% 100%); } to { clip-path: polygon(0 0, 112% 0, 100% 100%, -12% 100%); } }
@keyframes aim-an-grow { from { transform: scaleY(0); } to { transform: none; } }
.aim-an-content.aim-an-view-in > * { animation: aim-an-view-in 0.2s cubic-bezier(0.22, 1, 0.36, 1) both; }
.aim-an-draw .aim-an-plotbox, .aim-an-scorewrap.aim-an-draw svg { animation: aim-an-wipe 0.45s cubic-bezier(0.22, 1, 0.36, 1) both; }
.aim-an-draw .aim-an-tl { transform-origin: 50% 100%; animation: aim-an-grow 0.3s cubic-bezier(0.22, 1, 0.36, 1) both; }
.aim-an-cmp-bars i b { transform-origin: 0 50%; }
.aim-an-draw .aim-an-cmp-bars i b { animation: es-mr-bar 0.35s cubic-bezier(0.22, 1, 0.36, 1) both; }
@media (prefers-reduced-motion: reduce) {
  .aim-an-content.aim-an-view-in > *, .aim-an-draw .aim-an-plotbox, .aim-an-scorewrap.aim-an-draw svg, .aim-an-draw .aim-an-tl, .aim-an-draw .aim-an-cmp-bars i b { animation: none; }
}
@media (max-width: 620px) {
  .aim-an-track-tiles { grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); }
  .aim-an-coach { --an-card-h: 252px; }
}
`;
  function injectCss() {
    try {
      if (document.getElementById("aim-analytics-ui-css")) return;
      const style = document.createElement("style");
      style.id = "aim-analytics-ui-css";
      style.textContent = CSS;
      (document.head || document.documentElement).appendChild(style);
    } catch {}
  }

  // ---------------------------------------------------------------- hit zones (pure)
  // Silhouette scale: SCALE px per metre, feet at FEET_Y, centred on CX. The recorder's humanoid box is 1.8 m tall with its
  // centre 0.9 m up, so a nearestEnemy point (side, vertical from the centre) lands at height 0.9 + vertical.
  const SCALE = 100, FEET_Y = 192, CX = 60, CENTRE_M = 0.9;
  const px = (side) => CX + side * SCALE, py = (h) => FEET_Y - h * SCALE;
  const ZONES = ["head", "chest", "arms", "stomach", "legs"];
  const ZONE_LABEL = { head: "Head", chest: "Chest", arms: "Arms", stomach: "Torso", legs: "Legs" };
  const ZONE_MID = { head: [0, 1.68], chest: [0, 1.36], arms: [0.27, 1.2], stomach: [0, 1.04], legs: [0.09, 0.5] };
  const ARM_SIDE_M = 0.2, CHEST_FROM_M = 1.2;
  const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // The zone of a hit: head and legs from the game's part, a body hit split by its point when the row has one.
  function zoneOf(shot) {
    const part = shot.part == null ? "body" : String(shot.part).toLowerCase();
    if (part === "head") return "head";
    if (part === "legs" || part === "leg") return "legs";
    const e = shot.nearestEnemy;
    if (e && num(e.side) && num(e.vertical)) {
      if (Math.abs(e.side) >= ARM_SIDE_M) return "arms";
      return CENTRE_M + e.vertical >= CHEST_FROM_M ? "chest" : "stomach";
    }
    return "chest";
  }
  const HEAD_FROM_M = 1.55, LEGS_BELOW_M = 0.86; // the silhouette's head and legs edges, for the zone a miss passed by
  const r1 = (v) => Math.round(v * 10) / 10;
  const pointOf = (s) => (s && s.nearestEnemy && num(s.nearestEnemy.side) && num(s.nearestEnemy.vertical) ? s.nearestEnemy : null);
  const isHit = (s) => s.part != null || !!(s.pellets && num(s.pellets.hit) && s.pellets.hit > 0);
  // The zone a miss's closest point (side, vertical from the centre) passed by, for its marker title.
  function zoneNear(p) {
    const h = CENTRE_M + p.vertical;
    if (h >= HEAD_FROM_M) return "head";
    if (h < LEGS_BELOW_M) return "legs";
    if (Math.abs(p.side) >= ARM_SIDE_M) return "arms";
    return h >= CHEST_FROM_M ? "chest" : "stomach";
  }
  // ---- sphere targets (18 Nov 2026): the Target Workshop's round bots. The report then draws a circle to scale instead of the body, with the
  // same kinds of marks, and its list has Centre / Top / Right / Bottom / Left. A shot row's targetShape says what a HIT landed on; a round's
  // targetShapes / targetRadii (recorder header K / KR) cover a round with only misses. A hit's nearestEnemy side / vertical are metres from the
  // sphere's centre (up and right positive), the same fields the body figure uses.
  const SPHERE_ZONES = ["centre", "top", "right", "bottom", "left"];
  const SPHERE_LABEL = { centre: "Centre", top: "Top", right: "Right", bottom: "Bottom", left: "Left" };
  const SPHERE_DEFAULT_R = 0.36, SPHERE_CENTRE_FRAC = 0.5, SPHERE_VIEW_PAD_M = 0.45, SPHERE_NEAR_M = 0.6, SPHERE_HALF_PX = 52;
  function detectShape(items, round) {
    let sphere = 0, other = 0;
    for (const { s } of items) if (s && isHit(s) && s.targetShape != null) { if (s.targetShape === "sphere") sphere++; else other++; }
    if (sphere > other) return "sphere";
    if (!sphere && !other) {
      const shapes = Object.values((round && round.targetShapes) || {});
      if (shapes.length && shapes.every((v) => v === "sphere")) return "sphere";
    }
    return "humanoid";
  }
  // The circle's radius in metres: the recorded one for the template the hits landed on, else any recorded one, else the farthest hit from the
  // centre (the circle is at least that big), else the game's default.
  function sphereRadius(items, round) {
    const radii = (round && round.targetRadii) || {}, tmpl = new Set();
    let far = 0;
    for (const { s } of items) if (s && isHit(s) && s.targetShape === "sphere") { if (s.target != null) tmpl.add(String(s.target)); const e = pointOf(s); if (e) far = Math.max(far, Math.hypot(e.side, e.vertical)); }
    for (const t of tmpl) if (num(radii[t]) && radii[t] > 0) return radii[t];
    for (const v of Object.values(radii)) if (num(v) && v > 0) return v;
    return far > 0 ? Math.max(0.15, Math.round(far * 100) / 100) : SPHERE_DEFAULT_R;
  }
  const sphereZoneOf = (dx, dy, R) => (Math.hypot(dx, dy) < SPHERE_CENTRE_FRAC * R ? "centre" : Math.abs(dy) >= Math.abs(dx) ? (dy >= 0 ? "top" : "bottom") : dx >= 0 ? "right" : "left");
  function summarizeSphere(items, round, radius) {
    const R = radius > 0 ? radius : sphereRadius(items, round), scale = SPHERE_HALF_PX / (R + SPHERE_VIEW_PAD_M), C = 60, CY = 100;
    const zones = { centre: 0, top: 0, right: 0, bottom: 0, left: 0 }, dots = [];
    let hits = 0, misses = 0, rings = 0, placed = 0;
    for (const { s, i, near } of items) {
      if (!s || typeof s !== "object") continue;
      const e = pointOf(s);
      if (!isHit(s)) {
        misses++;
        const p = near !== undefined ? near : e;
        if (p && Math.hypot(p.side, p.vertical) < R + SPHERE_NEAR_M) {
          rings++;
          dots.push({ x: r1(clampNum(C + p.side * scale, 6, 114)), y: r1(clampNum(CY - p.vertical * scale, 8, 192)), kind: "miss", zone: sphereZoneOf(p.side, p.vertical, R) });
        }
        continue;
      }
      hits++;
      let dx, dy;
      if (e) { dx = e.side; dy = e.vertical; placed++; } else { const k = (i * 7919) % 17; dx = ((k % 5) - 2) * 0.05 * R; dy = ((Math.floor(k / 5) % 4) - 1.5) * 0.05 * R; } // no point: near the middle, the same every time
      const zone = sphereZoneOf(dx, dy, R);
      zones[zone]++;
      dots.push({ x: r1(clampNum(C + dx * scale, 6, 114)), y: r1(clampNum(CY - dy * scale, 8, 192)), kind: "hit", zone });
    }
    return { shape: "sphere", radius: R, scale, shots: items.length, hits, heads: 0, misses, rings, zones, dots, placed };
  }
  // Zone counts and markers of a list of shots. items: [{ s: shot (rounds() shape), i: its index in the round, near?: point }];
  // near (a { side, vertical } point, or null) replaces the shot's own nearestEnemy point for a miss tied to an enemy that was
  // not the one the shot passed closest to. rings = misses drawn as a ring (they passed close to the enemy's body).
  // round = the expanded round (for the shape and radius of a round with no hit); shape / radius force them (the zero report keeps the shape of the report it replaces).
  function summarize(items, round, shape, radius) {
    if ((shape || detectShape(items, round)) === "sphere") return summarizeSphere(items, round, radius);
    const zones = { head: 0, chest: 0, arms: 0, stomach: 0, legs: 0 };
    const dots = [];
    let hits = 0, heads = 0, misses = 0, rings = 0, placed = 0;
    for (const { s, i, near } of items) {
      if (!s || typeof s !== "object") continue;
      const e = pointOf(s);
      if (!isHit(s)) {
        misses++;
        const p = near !== undefined ? near : e;
        if (p && Math.abs(p.side) < 0.55 && Math.abs(p.vertical) < 1.05) {
          rings++;
          dots.push({ x: r1(clampNum(px(p.side), 6, 114)), y: r1(clampNum(py(CENTRE_M + p.vertical), 6, 194)), kind: "miss", zone: zoneNear(p) });
        }
        continue;
      }
      hits++;
      const zone = zoneOf(s);
      zones[zone]++;
      if (zone === "head") heads++;
      let x, y;
      if (e && zone !== "head") { x = px(clampNum(e.side, -0.4, 0.4)); y = py(clampNum(CENTRE_M + e.vertical, 0.05, 1.82)); placed++; }
      else {
        // no point recorded (or a head hit): spread around the zone's middle, the same every time for the same row
        const [sx, h] = ZONE_MID[zone], k = (i * 7919) % 17;
        const side = zone === "arms" || zone === "legs" ? (i % 2 ? sx : -sx) : sx;
        x = px(side) + (k % 5) * 2.2 - 4.4; y = py(h) + (Math.floor(k / 5) % 4) * 2.4 - 3.6;
      }
      dots.push({ x: r1(x), y: r1(y), kind: zone === "head" ? "head" : "hit", zone });
    }
    return { shape: "humanoid", shots: items.length, hits, heads, misses, rings, zones, dots, placed };
  }
  // Hits, misses, dots and zone counts of one expanded round (rounds() shape): every shot of the round.
  function hitSummary(round) {
    const shots = Array.isArray(round && round.shots) ? round.shots : [];
    const damage = round && num(round.damage) ? round.damage : round && num(round.damageDealt) ? round.damageDealt : null;
    return { ...summarize(shots.map((s, i) => ({ s, i })), round), damage, bursts: burstSplit(shots, round && round.tickSeconds) };
  }
  // Which enemy life a hit landed on (fix 17 Nov 2026). A shot row keeps only the enemy TYPE it hit, so among the fight rows
  // (engagements) of that type in progress at the shot's tick:
  //   - a shot that killed: the one killed on that tick (exact);
  //   - one fight in progress: that one (exact);
  //   - several: the one you killed soonest after the shot (you were shooting it), else the one you had been fighting longest;
  //     byType = true, the panel says these hits are matched by enemy type only.
  // Returns { g, byType } or null (no fight of that type in progress: a round without fight records, or a cut list).
  function hitOwner(engs, s) {
    const t = String(s.target);
    const same = engs.filter((g) => g.template != null && String(g.template) === t);
    if (s.killed) { const k = same.filter((g) => g.killTick === s.tick); if (k.length === 1) return { g: k[0], byType: false }; }
    const live = same.filter((g) => g.startTick <= s.tick && (g.killTick == null || g.killTick >= s.tick));
    if (!live.length) return null;
    if (live.length === 1) return { g: live[0], byType: false };
    const next = live.filter((g) => num(g.killTick)).sort((a, b) => a.killTick - b.killTick)[0];
    return { g: next || live.slice().sort((a, b) => a.startTick - b.startTick)[0], byType: true };
  }
  // The enemy of the round's last death and your shots on it: { death, killer, method, reason, shared, sum } (sum as summarize()).
  // death null = no death row; killer null = no enemy killed you (a fall, or a death row without killer id and type).
  // What ties a shot to an enemy (see the recorder's header): a shot row keeps the enemy TYPE it hit (target = template id), not
  // the enemy's actor id; the actor id is in the death row (killerId), in the near-miss rows (enemyId per missing shot) and in
  // the engagement rows (enemyId, start tick of each enemy life you fought).
  //   Misses: by id (near-miss rows with enemyId = killerId) whenever the death row has a killer id; else by type.
  //   Hits, method "id": the round has an engagement row for the killer's id, so a hit counts when it is on the killer's type
  //     between that engagement's start and your death (a shot that killed an enemy before your death is left out: the killer
  //     was still alive). shared = those hits made while another enemy of the same type was also in a fight with you (its
  //     engagement had started and it was not killed yet): they cannot be told apart and the panel says so.
  //   Hits, method "template": no engagement row for the killer (no killer id, a round recorded before engagements, or a cut
  //     list): every hit on the killer's type since the previous death counts, so hits on another enemy of that type count too.
  //   method "none": the killer's type is unknown, so no hit can be tied to it (near misses by id only).
  // Only shots after the previous death (if any) and up to this death count.
  function killerShots(round) {
    const deaths = (Array.isArray(round && round.deaths) ? round.deaths : []).filter((d) => d && typeof d === "object");
    const death = deaths.length ? deaths[deaths.length - 1] : null;
    if (!death) return { death: null, killer: null };
    const killerId = num(death.killerId) ? death.killerId : null, template = death.killer != null ? String(death.killer) : null;
    if (death.cause === "fell" || (killerId == null && template == null)) return { death, killer: null };
    const prev = deaths.length > 1 && num(deaths[deaths.length - 2].tick) ? deaths[deaths.length - 2].tick : -Infinity;
    const until = num(death.tick) ? death.tick : Infinity;
    const shots = Array.isArray(round.shots) ? round.shots : [];
    const engs = (Array.isArray(round.engagements) ? round.engagements : []).filter((g) => g && num(g.startTick));
    const mine = killerId == null ? null : engs.filter((g) => g.enemyId === killerId && g.startTick <= until).pop() || null;
    // A round that has fight records but none for the killer's id: you never fought it (it killed you without you engaging
    // it), so no hit can be yours on it. Only rounds without fight records (older ones, or a cut list) fall back to the type.
    const hasFights = engs.length > 0 && !round.engagementsTruncated;
    const method = template == null ? "none" : mine ? "id" : killerId != null && hasFights ? "never" : "template";
    const reason = method !== "template" ? null : killerId == null ? "the death has no killer id" : "the round has no fight record for that id";
    const from = mine ? Math.max(mine.startTick, prev === -Infinity ? mine.startTick : prev + 1) : prev + 1;
    const items = [];
    let shared = 0;
    // Only YOUR shots AT the killer (17 Nov 2026 fix): the rounds hold only your own shots (shot rows, and near-miss rows that
    // point at a shot row), never enemy fire, but two kinds of your shots used to be tied to the killer wrongly:
    //   - a hit on the killer's type while another enemy of that type was also fighting you (shared): it was most likely on the
    //     other one, so it is counted in shared but not shown;
    //   - a miss whose line passed near the killer while you were shooting at another enemy: a miss counts only when the killer
    //     is the enemy the shot passed CLOSEST to (its closest near-miss row), i.e. the one you were shooting at.
    if (method === "id" || method === "template") {
      shots.forEach((s, i) => {
        if (!s || !num(s.tick) || s.tick < from || s.tick > until || !isHit(s) || s.target == null || String(s.target) !== template) return;
        if (method === "template") { if (s.killed && s.tick < until) return; items.push({ s, i }); return; }
        const o = hitOwner(engs, s);
        if (!o || o.g !== mine) return;
        if (o.byType) shared++;
        items.push({ s, i, byType: o.byType });
      });
    }
    // misses: one item per shot, from the near-miss rows of the killer (by id, else by type) that are the shot's closest row
    const near = Array.isArray(round.nearMisses) ? round.nearMisses : [];
    const closest = new Map(); // shot index -> its closest near-miss row (that enemy is the shot's nearestEnemy)
    for (const n of near) if (n && num(n.shotIndex) && (!closest.has(n.shotIndex) || n.missDistance < closest.get(n.shotIndex).missDistance)) closest.set(n.shotIndex, n);
    const seen = new Set();
    for (const n of near) {
      if (!n || !num(n.shotIndex) || seen.has(n.shotIndex) || closest.get(n.shotIndex) !== n) continue;
      const ofKiller = killerId != null ? n.enemyId === killerId : template != null && n.template != null && String(n.template) === template;
      const s = shots[n.shotIndex];
      if (!ofKiller || !s || !num(s.tick) || s.tick < from || s.tick > until || isHit(s)) continue;
      seen.add(n.shotIndex);
      const own = pointOf(s);
      items.push({ s, i: n.shotIndex, near: own || (num(n.verticalOffset) ? { side: 0, vertical: n.verticalOffset } : null) });
    }
    return { death, killer: { id: killerId, template, distance: num(death.killerDistance) ? death.killerDistance : null }, method, reason, shared, sum: summarize(items, round) };
  }
  // The body diagram of a summary. label = what it shows, for the aria-label.
  // The circle of a sphere target, to scale (sum.radius metres), with a dashed centre ring and cross, four outer sectors that light up when hit,
  // the hits as dots and the near misses as rings (outside the circle).
  // How you fire (20 Nov 2026). Shots of one weapon less than BURST_GAP_S apart are one burst. First shot = the first of a burst, follow-up = every
  // later shot of it. A burst of 1 or 2 shots is a tap, 5 or more a spray (3 and 4 are neither). Returns the shots and hits of each group.
  function burstSplit(shots, dt) {
    const gap = BURST_GAP_S / (num(dt) && dt > 0 ? dt : 1 / 128);
    const list = (Array.isArray(shots) ? shots : []).filter((s) => s && num(s.tick)).sort((a, b) => a.tick - b.tick);
    const bursts = [];
    for (const s of list) {
      const b = bursts[bursts.length - 1];
      if (b && s.tick - b.last <= gap && b.weapon === s.weapon) { b.shots.push(s); b.last = s.tick; } else bursts.push({ shots: [s], last: s.tick, weapon: s.weapon });
    }
    const out = { first: { n: 0, hits: 0 }, follow: { n: 0, hits: 0 }, tap: { bursts: 0, n: 0, hits: 0 }, spray: { bursts: 0, n: 0, hits: 0 } };
    for (const b of bursts) {
      b.shots.forEach((s, i) => { const g = i === 0 ? out.first : out.follow; g.n++; if (isHit(s)) g.hits++; });
      const g = b.shots.length <= 2 ? out.tap : b.shots.length >= 5 ? out.spray : null;
      if (g) { g.bursts++; for (const s of b.shots) { g.n++; if (isHit(s)) g.hits++; } }
    }
    return out;
  }
  const BURST_MIN_SHOTS = 8; // shots in the round before the first-shot and spray bars are shown
  // The bars under the figure: hit rate of first shots against follow-ups, and of taps against sprays. "" when the round has too few shots.
  function burstHtml(b) {
    if (!b || b.first.n + b.follow.n < BURST_MIN_SHOTS) return "";
    const row = (label, g, key) => {
      const v = g.n ? Math.round((g.hits / g.n) * 100) : null;
      return `<div class="aim-an-bar" data-burst="${key}" title="${g.hits} of ${g.n} shots hit"><span>${label} (${g.n})</span><i><b style="width:${v === null ? 0 : v}%"></b></i><em>${v === null ? "–" : v + "%"}</em></div>`;
    };
    const rows = [row("First shot", b.first, "first"), row("Follow-ups", b.follow, "follow")];
    if (b.tap.n) rows.push(row("Taps", b.tap, "tap"));
    if (b.spray.n) rows.push(row("Sprays", b.spray, "spray"));
    return `<h5 class="aim-an-hit-sub">How you fire</h5><div class="aim-an-bars" data-vis="burst">${rows.join("")}</div>`
      + `<p class="aim-an-hit-note">Hit rate by shot. A tap is 1 or 2 shots in a row, a spray 5 or more. The red glow marks where your hits cluster.</p>`;
  }
  // Heat density: a soft disc under every hit, so where hits pile up glows stronger (the discs add up). "" with fewer than 3 hits.
  function heatHtml(sum) {
    const hs = sum.dots.filter((d) => d.kind !== "miss");
    if (hs.length < 3) return "";
    return `<g class="aim-an-heat" aria-hidden="true">` + hs.slice(0, 400).map((d) => `<circle cx="${d.x}" cy="${d.y}" r="${sum.shape === "sphere" ? 12 : 10}"/>`).join("") + `</g>`;
  }
  function sphereSvg(sum, label) {
    const C = 60, CY = 100, Ro = sum.radius * sum.scale, Ri = Ro * SPHERE_CENTRE_FRAC;
    const P = (a, r) => [(C + r * Math.cos((a * Math.PI) / 180)).toFixed(1), (CY - r * Math.sin((a * Math.PI) / 180)).toFixed(1)];
    const wedge = (z, a0, a1) => {
      const [x0, y0] = P(a0, Ri), [x1, y1] = P(a0, Ro), [x2, y2] = P(a1, Ro), [x3, y3] = P(a1, Ri);
      return `<path class="aim-an-zone is-${z}${sum.zones[z] > 0 ? " is-hit" : ""}" d="M${x0} ${y0} L${x1} ${y1} A${Ro.toFixed(1)} ${Ro.toFixed(1)} 0 0 0 ${x2} ${y2} L${x3} ${y3} A${Ri.toFixed(1)} ${Ri.toFixed(1)} 0 0 1 ${x0} ${y0}Z"/>`;
    };
    const hitTitle = (z) => `${SPHERE_LABEL[z]} hit (${plural(sum.zones[z], "hit")} ${z === "centre" ? "near the centre" : "on the " + z})`;
    const ringTitle = (z) => `Near miss on the ${z === "centre" ? "edge" : z} (${nearMisses(sum.rings)} in all)`;
    const dots = sum.dots.filter((d) => d.kind !== "miss").map((d) => `<circle class="aim-an-dot" cx="${d.x}" cy="${d.y}" r="3"><title>${hitTitle(d.zone)}</title></circle>`);
    const ringEls = sum.dots.filter((d) => d.kind === "miss").map((d) => `<g class="aim-an-ring"><title>${ringTitle(d.zone)}</title>`
      + `<circle class="aim-an-ring-halo" cx="${d.x}" cy="${d.y}" r="4.8"/><circle class="aim-an-ring-line" cx="${d.x}" cy="${d.y}" r="4.8"/></g>`);
    const parts = [
      `<circle class="aim-an-zone is-sphere${sum.zones.centre > 0 ? " is-hit" : ""}" cx="${C}" cy="${CY}" r="${Ro.toFixed(1)}"/>`,
      wedge("right", -45, 45), wedge("top", 45, 135), wedge("left", 135, 225), wedge("bottom", 225, 315),
      `<circle class="aim-an-guide" cx="${C}" cy="${CY}" r="${Ri.toFixed(1)}"/>`,
      `<path class="aim-an-guide" d="M${C - Ro} ${CY}H${C + Ro}M${C} ${CY - Ro}V${CY + Ro}"/>`,
    ];
    return `<svg class="aim-an-body aim-an-sphere" viewBox="0 0 120 200" role="img" aria-label="${esc(label)}: ${SPHERE_ZONES.map((z) => SPHERE_LABEL[z] + " " + sum.zones[z]).join(", ")}, near misses ${sum.rings}">`
      + `${parts.join("")}${heatHtml(sum)}${dots.join("")}${ringEls.join("")}</svg>`;
  }
  function silhouetteSvg(sum, label = "Body hit zones") {
    if (sum.shape === "sphere") return sphereSvg(sum, label);
    const on = (z) => (sum.zones[z] > 0 ? " is-hit" : "");
    const rect = (z, s0, s1, h0, h1, extra = "") => `<rect class="aim-an-zone is-${z}${on(z)}"${extra} x="${px(s0)}" y="${py(h1)}" width="${(s1 - s0) * SCALE}" height="${(h1 - h0) * SCALE}" rx="3"/>`;
    const parts = [
      `<circle class="aim-an-zone is-head${on("head")}" cx="${CX}" cy="${py(1.68)}" r="13"/>`,
      rect("chest", -0.19, 0.19, 1.2, 1.52),
      rect("stomach", -0.17, 0.17, 0.86, 1.2),
      rect("arms", -0.33, -0.21, 0.82, 1.5), rect("arms", 0.21, 0.33, 0.82, 1.5),
      rect("legs", -0.16, -0.02, 0.04, 0.86), rect("legs", 0.02, 0.16, 0.04, 0.86),
    ];
    const rings = sum.rings ?? sum.dots.filter((d) => d.kind === "miss").length;
    const hitTitle = (z) => `${ZONE_LABEL[z]} hit (${plural(sum.zones[z], "hit")} on the ${z})`;
    const ringTitle = (z) => `Near miss by the ${z} (${nearMisses(rings)} in all)`;
    // hits first, rings on top: a ring is hollow and larger, so a hit under it stays visible
    const dots = sum.dots.filter((d) => d.kind !== "miss").map((d) => `<circle class="aim-an-dot${d.kind === "head" ? " is-head" : ""}" cx="${d.x}" cy="${d.y}" r="3"><title>${hitTitle(d.zone)}</title></circle>`);
    const ringEls = sum.dots.filter((d) => d.kind === "miss").map((d) => `<g class="aim-an-ring"><title>${ringTitle(d.zone)}</title>`
      + `<circle class="aim-an-ring-halo" cx="${d.x}" cy="${d.y}" r="4.8"/><circle class="aim-an-ring-line" cx="${d.x}" cy="${d.y}" r="4.8"/></g>`);
    return `<svg class="aim-an-body" viewBox="0 0 120 200" role="img" aria-label="${esc(label)}: ${ZONES.map((z) => ZONE_LABEL[z] + " " + sum.zones[z]).join(", ")}, near misses ${rings}">`
      + `${parts.join("")}${heatHtml(sum)}${dots.join("")}${ringEls.join("")}</svg>`;
  }
  const KEY_HTML = `<ul class="aim-an-hit-key">`
    + `<li><svg viewBox="0 0 14 14" aria-hidden="true"><circle class="aim-an-dot" cx="7" cy="7" r="3.6"/></svg>Hit</li>`
    + `<li><svg viewBox="0 0 14 14" aria-hidden="true"><circle class="aim-an-dot is-head" cx="7" cy="7" r="3.6"/></svg>Headshot</li>`
    + `<li><svg viewBox="0 0 14 14" aria-hidden="true"><circle class="aim-an-ring-halo" cx="7" cy="7" r="4.8"/><circle class="aim-an-ring-line" cx="7" cy="7" r="4.8"/></svg>Near miss (passed close, no hit)</li></ul>`;
  const KEY_SPHERE = `<ul class="aim-an-hit-key">`
    + `<li><svg viewBox="0 0 14 14" aria-hidden="true"><circle class="aim-an-dot" cx="7" cy="7" r="3.6"/></svg>Hit</li>`
    + `<li><svg viewBox="0 0 14 14" aria-hidden="true"><circle class="aim-an-ring-halo" cx="7" cy="7" r="4.8"/><circle class="aim-an-ring-line" cx="7" cy="7" r="4.8"/></svg>Near miss (passed close, no hit)</li></ul>`;
  const nearMisses = (n) => (n === 1 ? "1 near miss" : n + " near misses");
  // The hit report (fix 17 Nov 2026, one list): the figure and, beside it, ONE list with a row per zone (Head, Chest, Arms,
  // Torso, Legs) and its hit count, every row always shown, 0 included. No other stat rows (hits, head, near misses, other
  // misses, damage): near misses are only the ring markers drawn on the figure. notes = small notes under the figure.
  function diagramHtml(sum, label, notes) {
    const sphere = sum.shape === "sphere", names = sphere ? SPHERE_ZONES : ZONES, labels = sphere ? SPHERE_LABEL : ZONE_LABEL;
    const list = names.map((z) => `<li class="${sum.zones[z] > 0 ? "is-hit" : "is-zero"}" data-zone="${z}"><span>${labels[z]}</span><b>${sum.zones[z]}</b></li>`).join("");
    return `<div class="aim-an-hit-grid">${silhouetteSvg(sum, label)}<ul class="aim-an-zones">${list}</ul></div>${burstHtml(sum.bursts)}${notes || ""}${sphere ? KEY_SPHERE : KEY_HTML}`;
  }
  // A small note under the figure (one line of muted text); "" for no text.
  const hitNote = (text, attr = "") => (text ? `<p class="aim-an-hit-note"${attr}>${text}</p>` : "");
  function killerPaneHtml(k, all) {
    const elsewhere = all.hits || all.rings ? ` Your other shots are in the "All my shots" tab.` : "";
    const label = "Your shots on the enemy that killed you";
    // no death row, or no enemy killed you: the figure with no markers and the reason as its note
    if (!k.death) return zeroReportHtml("This round has no record of who killed you.", all, label, elsewhere);
    if (!k.killer) return zeroReportHtml(`No enemy killed you this round${k.death.cause === "fell" ? " (you fell)" : ""}.`, all, label, elsewhere);
    const who = k.killer.template != null ? esc(k.killer.template) : "an enemy";
    const s = k.sum;
    const head = `<p class="aim-an-hit-who">Killed by <b>${who}</b>${k.killer.distance != null ? ` from ${esc(Math.round(k.killer.distance))} m` : ""}</p>`;
    // No shot of yours at the killer this life: the figure with no markers, the zone rows at 0 and one small note.
    if (!s.shots) return head + zeroReportHtml("No hits on the enemy that killed you (0 shots landed).", all, label, elsewhere);
    const none = s.hits ? "" : hitNote("You did not hit the enemy that killed you." + (all.hits ? "" : " No hits this round."));
    // No footnote on how the shots were tied to the killer (removed 17 Nov 2026): killerShots() still works it out (method,
    // reason, shared), the panel shows only the zone counts.
    return head + diagramHtml(s, label, none + typeNote(k.shared));
  }
  function allPaneHtml(sum) {
    const note = !sum.shots ? "You fired no shots this round." : sum.hits === 0 ? "No hits this round." : "";
    return diagramHtml(sum, "All your shots this round", hitNote(note));
  }
  const HIT_TABS = [["killer", "Your killer"], ["all", "All my shots"]];
  // Your shots at ONE enemy life (17 Nov 2026, for a bot picked in the result screen's pre-aim list): { enemy, sum, shared }.
  // id = the enemy's actor id (engagement enemyId); bornTick = the start of that life when known (the list's point has it), so
  // the engagement is the first one of that id starting at or after it, else the last one of that id. The window runs from the
  // engagement's start to its kill (or to your death, or the round's end). The same rules as killerShots(): hits on the
  // enemy's type, not a hit that killed another enemy first, not a hit made while another enemy of that type was also fighting
  // you (shared, counted but not shown); misses only from near-miss rows of this id that are the shot's closest row.
  function enemyShots(round, id, bornTick) {
    const shots = Array.isArray(round && round.shots) ? round.shots : [];
    const engs = (Array.isArray(round && round.engagements) ? round.engagements : []).filter((g) => g && num(g.startTick));
    const of = engs.filter((g) => g.enemyId === id);
    const g = (num(bornTick) ? of.find((x) => x.startTick >= bornTick) : null) || of[of.length - 1] || null;
    const template = g && g.template != null ? String(g.template) : null;
    const deathAfter = (round && Array.isArray(round.deaths) ? round.deaths : []).map((d) => d && d.tick).filter((t) => num(t) && (!g || t >= g.startTick));
    const from = g ? g.startTick : num(bornTick) ? bornTick : -Infinity;
    const until = g && num(g.killTick) ? g.killTick : deathAfter.length ? Math.min(...deathAfter) : Infinity;
    const items = [];
    let shared = 0;
    if (g && template != null) {
      shots.forEach((s, i) => {
        if (!s || !num(s.tick) || s.tick < from || s.tick > until || !isHit(s) || s.target == null || String(s.target) !== template) return;
        const o = hitOwner(engs, s);
        if (!o || o.g !== g) return;
        if (o.byType) shared++;
        items.push({ s, i, byType: o.byType });
      });
    }
    const near = Array.isArray(round && round.nearMisses) ? round.nearMisses : [];
    const closest = new Map();
    for (const n of near) if (n && num(n.shotIndex) && (!closest.has(n.shotIndex) || n.missDistance < closest.get(n.shotIndex).missDistance)) closest.set(n.shotIndex, n);
    for (const [i, n] of closest) {
      const s = shots[i];
      if (n.enemyId !== id || !s || !num(s.tick) || s.tick < from || s.tick > until || isHit(s)) continue;
      items.push({ s, i, near: pointOf(s) || (num(n.verticalOffset) ? { side: 0, vertical: n.verticalOffset } : null) });
    }
    return { enemy: { id, template: template ?? (near.find((n) => n && n.enemyId === id && n.template != null) || {}).template ?? null, killed: !!(g && g.killed), fought: !!g }, sum: summarize(items, round), shared };
  }
  // The label for hits matched by enemy type only (see hitOwner).
  const typeNote = (n) => (n > 0 ? `<p class="aim-an-hit-note" data-type-only="${n}">${n === 1 ? "1 hit is" : n + " hits are"} matched by enemy type only: another bot of the same type was in a fight with you at the time.</p>` : "");
  // The zero report: no shot of yours at this enemy. It keeps the body figure (head, torso, limbs) with no markers, the zone
  // rows at 0, and under it one small note: text, plus "No hits this round" when none of your shots hit anything, plus
  // elsewhere = the pointer to the "All my shots" tab, when you did hit or nearly hit something else.
  function zeroReportHtml(text, all, label, elsewhere) {
    const note = hitNote(text + (all.hits ? "" : " No hits this round.") + (elsewhere || ""), " data-zero");
    return `<div class="aim-an-zero">${diagramHtml(summarize([], null, all.shape, all.radius), label || "No hits", note)}</div>`;
  }
  // The selected bot's pane. sel = { id, bornTick, label } (label = the list row's name, e.g. "#2 A Site").
  function selectedPaneHtml(round, sel, all) {
    const e = enemyShots(round, sel.id, sel.bornTick), s = e.sum;
    const name = (sel.label ? esc(sel.label) : `Bot ${esc(sel.id)}`) + (e.enemy.template != null ? ` (${esc(e.enemy.template)})` : "");
    const head = `<p class="aim-an-hit-who" data-selected-enemy="${esc(sel.id)}">Selected: <b>${name}</b>${e.enemy.killed ? " · you killed it" : ""}</p>`;
    const elsewhere = all.hits || all.rings ? ` Your other shots are in the "All my shots" tab.` : "";
    if (!s.shots) return head + zeroReportHtml("No hits on this bot (0 shots landed).", all, "Your shots on the selected bot", elsewhere);
    const none = s.hits ? "" : hitNote("You did not hit this bot.");
    return head + diagramHtml(s, "Your shots on the selected bot", none + typeNote(e.shared));
  }
  // The panel's inner HTML for a round (null round = no record found). tab = "killer" (default) or "all". selected = a bot picked
  // in the result screen's list ({ id, bornTick, label }), shown in the first tab instead of the killer; null = the killer.
  // The tracking readout of one round (18 Nov 2026): how well the crosshair stayed on enemies that moved, from the round's engagements
  // (recorder header, "tracking"). "" when no engagement of the round has enough moving ticks (a round with only still enemies, or recorded before).
  function trackReadoutHtml(round) {
    const rows = (round && round.sight === true && Array.isArray(round.engagements) ? round.engagements : []).filter((e) => e && e.tracking && num(e.tracking.samples) && e.tracking.samples >= TRACK_MIN_TICKS);
    if (!rows.length) return "";
    const b = trackingTotals(rows, "body"), h = trackingTotals(rows, "head");
    const fix = (v, d = 1) => String(+v.toFixed(d));
    const lag = !num(b.lagDeg) || Math.abs(b.lagDeg) < 0.1 ? "level" : fix(Math.abs(b.lagDeg)) + "° " + (b.lagDeg > 0 ? "behind" : "ahead");
    return `<p class="aim-an-hit-track" data-hit-track><span>Tracking</span><span>On body <b>${b.onPercent}%</b></span><span>On head <b>${h.onPercent}%</b></span>`
      + (b.lockSeconds !== null ? `<span>Lock <b>${fix(b.lockSeconds, 2)} s</b></span>` : "") + `<span>Lag <b>${lag}</b></span></p>`;
  }
  // died = false (a cleared or timed-out round, 18 Nov 2026): no killer, so only the "All my shots" pane, no tab bar.
  function hitPanelHtml(round, tab, selected, died = true) {
    if (!round) return `<h4>Your shots this round</h4><p class="aim-an-hit-sum">No shot record for this round (analytics recording is off or the round is still being saved).</p>`;
    const all = hitSummary(round);
    if (!died) return `<h4>Your shots this round</h4><div class="aim-an-hit-panes"><div class="aim-an-hit-pane" role="group" aria-label="All your shots this round" data-hit-pane="all">${allPaneHtml(all)}</div></div>${trackReadoutHtml(round)}`;
    const sel = tab === "all" ? "all" : "killer";
    const pick = selected && selected.id != null ? selected : null;
    const tabs = `<div class="aim-an-hit-tabs" role="tablist" aria-label="Which shots">` + HIT_TABS.map(([id, label]) => `<button type="button" role="tab" `
      + `id="aim-an-hit-tab-${id}" data-hit-tab="${id}" aria-controls="aim-an-hit-pane-${id}" aria-selected="${id === sel}" tabindex="${id === sel ? 0 : -1}">${id === "killer" && pick ? "Selected bot" : label}</button>`).join("") + `</div>`;
    const pane = (id, html) => `<div class="aim-an-hit-pane" role="tabpanel" id="aim-an-hit-pane-${id}" aria-labelledby="aim-an-hit-tab-${id}" data-hit-pane="${id}"${id === sel ? "" : " hidden"}>${html}</div>`;
    return `<h4>Your shots this round</h4>${tabs}<div class="aim-an-hit-panes">${pane("killer", pick ? selectedPaneHtml(round, pick, all) : killerPaneHtml(killerShots(round), all))}${pane("all", allPaneHtml(all))}</div>${trackReadoutHtml(round)}`;
  }

  // ---------------------------------------------------------------- hit zones (result screen)
  const overlayDone = new WeakMap(); // result overlay -> { round, tab, html } once its round was read (or "loading")
  const panelHtml = new WeakMap();   // panel element -> the html string last written to it (innerHTML never reads back equal to it)
  const RESULT_ENDS = { died: "is-died", cleared: "is-cleared", time: "is-time" };
  function newestDiedRound(list, end = "died") {
    const r = list.length ? list[list.length - 1] : null;
    return r && r.end === end && num(r.at) && Date.now() - r.at < 6 * 3600 * 1000 ? r : null;
  }
  async function loadDiedRound(end = "died") {
    // The round is queued when it ends; rounds() writes the queue first. One retry covers a round-end message that arrives
    // after the result screen.
    let r = newestDiedRound(await read("rounds", { limit: 1 }), end);
    if (!r) { await new Promise((ok) => setTimeout(ok, 900)); r = newestDiedRound(await read("rounds", { limit: 1 }), end); }
    return r;
  }
  // The promise's answer, or null when it has not answered after `ms` (a hung IndexedDB read); a late answer is ignored.
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(null), ms);
      promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
  }
  // Switches the panel's tab: the html is rebuilt for the new tab (so a later re-render keeps it) and focus goes to the new tab button.
  function pickTab(overlay, panel, tab, focus) {
    const done = overlayDone.get(overlay);
    if (!done || done === "loading" || !done.round || done.tab === tab) return;
    done.tab = tab;
    done.html = hitPanelHtml(done.round, tab, done.selected, done.died !== false);
    placePanel(overlay, done.html);
    if (focus) { try { const b = panel.querySelector(`[data-hit-tab="${tab}"]`); if (b && b.focus) b.focus(); } catch {} }
  }
  function placePanel(overlay, html) {
    let panel = overlay.querySelector("." + MARK);
    if (!html) { if (panel) panel.remove(); return; } // tracking drills: no hit report, and no column that would push the result card sideways
    if (!panel) {
      panel = document.createElement("section");
      panel.className = MARK;
      panel.setAttribute("aria-label", "Your shots this round");
      const tabOf = (event) => { const b = event.target && event.target.closest ? event.target.closest("[data-hit-tab]") : null; return b && b.dataset ? b.dataset.hitTab : null; };
      panel.addEventListener("click", (event) => { const t = tabOf(event); if (t) pickTab(overlay, panel, t, false); });
      panel.addEventListener("keydown", (event) => {
        const t = tabOf(event);
        if (!t || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const ids = HIT_TABS.map((x) => x[0]), at = ids.indexOf(t);
        const next = event.key === "Home" ? ids[0] : event.key === "End" ? ids[ids.length - 1] : ids[(at + (event.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length];
        event.preventDefault();
        pickTab(overlay, panel, next, true);
      });
      if (!entered.has(overlay)) { entered.add(overlay); playEntrance(overlay, panel); } // once per result screen
    }
    putPanel(overlay, panel);
    // Compare with the string written last, not with panel.innerHTML (the serialized DOM differs from the source, e.g. <rect/> becomes
    // <rect></rect>, so that comparison is never equal): an unchanged render does not touch the DOM and wakes no watcher.
    if (panelHtml.get(panel) !== html) { panel.innerHTML = html; panelHtml.set(panel, html); }
  }
  // Placement (17 Nov 2026). Wide windows (the theme's result-board range) on a screen WITHOUT the Position map (.al-pm): the
  // panel is a direct child of the overlay, after the result card, with class SIDE; the CSS puts it in a column left of the
  // card (the game's bots card stays on the right). Map screens keep it in the card body (the broadcast grid makes that
  // body display: contents, so it is a grid item of the left column there), and narrow windows keep it inside the card
  // under the stat strip. Moves only when it is not where it belongs, so a placed panel wakes no watcher.
  const SIDE = "aim-an-hit-side";
  const SIDE_MQ = "(min-width: 1180px) and (min-height: 680px)";
  let sideMq = null;
  function wideScreen() {
    try {
      if (!sideMq) {
        if (!window.matchMedia) return false;
        sideMq = window.matchMedia(SIDE_MQ);
        const again = () => syncResult(); // crossing the breakpoint moves the panel; nothing else changes in the DOM then
        if (sideMq.addEventListener) sideMq.addEventListener("change", again); else if (sideMq.addListener) sideMq.addListener(again);
      }
      return !!sideMq.matches;
    } catch { return false; }
  }
  const childOf = (el, cls) => { for (const c of Array.from(el.children || [])) if (c.classList && c.classList.contains(cls)) return c; return null; };
  function setClass(el, cls, on) {
    const has = String(el.className || "").split(/\s+/).includes(cls);
    if (has !== on) el.className = on ? (el.className ? el.className + " " + cls : cls) : String(el.className).split(/\s+/).filter((c) => c && c !== cls).join(" ");
  }
  function putPanel(overlay, panel) {
    const modal = childOf(overlay, "al-result-modal");
    const side = !!modal && !childOf(overlay, "al-pm") && wideScreen();
    setClass(panel, SIDE, side);
    if (side) { if (panel.parentElement !== overlay || modal.nextElementSibling !== panel) modal.after(panel); return; }
    const strip = overlay.querySelector(".al-run-strip");
    const actions = overlay.querySelector(".al-run-actions");
    if (strip && strip.parentElement) { if (strip.nextElementSibling !== panel) strip.after(panel); }
    else if (actions && actions.parentElement) { if (actions.previousElementSibling !== panel || panel.parentElement !== actions.parentElement) actions.before(panel); }
    else { const host = overlay.querySelector(".al-run-body") || modal || overlay; if (panel.parentElement !== host) host.appendChild(panel); }
  }
  // The entrance plays once: the class goes when the animation ends (or a little after it should have, for a hidden window).
  const entered = new WeakSet();   // result overlays whose panel has been made (its entrance was started)
  const shownAt = new WeakMap();   // result overlay -> when this script first saw it (the entrance delay counts from there)
  const ENTER_DELAY_MS = 1300, ENTER_MS = 700;
  function playEntrance(overlay, panel) {
    const since = shownAt.has(overlay) ? Date.now() - shownAt.get(overlay) : 0;
    const delay = Math.max(0, ENTER_DELAY_MS - since);
    try { if (panel.style && panel.style.setProperty) panel.style.setProperty("--aim-an-hit-d", delay + "ms"); } catch {}
    setClass(panel, "aim-an-hit-enter", true);
    let done = false;
    const end = () => { if (done) return; done = true; setClass(panel, "aim-an-hit-enter", false); try { panel.style.removeProperty("--aim-an-hit-d"); } catch {} };
    try { panel.addEventListener("animationend", (event) => { if (event.target === panel) end(); }); } catch {}
    setTimeout(end, delay + ENTER_MS + 400);
  }
  function syncResult() {
    try {
      const overlay = document.querySelector(".al-result-overlay");
      if (!overlay) return;
      const end = Object.keys(RESULT_ENDS).find((k) => overlay.querySelector(".al-result-verdict-splash." + RESULT_ENDS[k]));
      if (!end) return;
      const died = end === "died";
      if (!shownAt.has(overlay)) shownAt.set(overlay, Date.now());
      const done = overlayDone.get(overlay);
      if (done === "loading") return;
      if (done) { placePanel(overlay, done.html); return; } // put back after the screen re-rendered, no new read
      overlayDone.set(overlay, "loading");
      withTimeout(loadDiedRound(end), READ_TIMEOUT_MS)
        .then((round) => {
          const selected = (died && pendingPick.get(overlay)) || null; // a row clicked while the round was still being read
          const html = round && round.mode === "tracking" ? "" : hitPanelHtml(round, "killer", selected, died); // a round scored by time on target has no shots to report
          overlayDone.set(overlay, { round, tab: "killer", html, selected, died }); placePanel(overlay, html);
        })
        .catch(() => { const html = hitPanelHtml(null); overlayDone.set(overlay, { round: null, tab: "killer", html, died }); try { placePanel(overlay, html); } catch {} });
    } catch {}
  }

  // ---------------------------------------------------------------- picking a bot in the result screen's list (17 Nov 2026)
  // The Eliminated screen's pre-aim block (the game's PreaimScoreBlock) lists one tile per enemy life you saw:
  // button.al-ps-tile[data-n] ("Your killer" on the killer's). A click there selects the tile and the game plays that sighting.
  // The tile itself only carries n; the point behind it (view.points[n], built by the game with actorId and bornTick, the
  // same snapshot actor id the recorder's engagement rows keep as enemyId) is on the Vue component that rendered the tile
  // (tile.__vueParentComponent.props.view). A capture-phase click listener reads it, never stops the click (so the game's own
  // replay handler runs), and tells the hit panel: the killer's tile, or a tile it cannot map, shows the killer again.
  const pendingPick = new WeakMap(); // overlay -> selection made before its round was read
  // The production build does not put __vueParentComponent on elements, so the points are found by walking the app's component
  // tree from the container's root vnode (data-v-app element's _vnode) to the first component whose props.view.points is a list
  // of points with actor ids (the PreaimScoreBlock and the result map share that view). Bounded walk, only on a tile click.
  const isPoints = (pts) => Array.isArray(pts) && pts.length > 0 && pts.every((x) => x && num(x.n) && "actorId" in x);
  function findPoints(instance, budget = { n: 20000 }) {
    const seen = new Set();
    const visit = (v) => {
      if (!v || typeof v !== "object" || seen.has(v) || --budget.n < 0) return null;
      seen.add(v);
      const c = v.component;
      if (c) {
        const pts = c.props && c.props.view && c.props.view.points;
        if (isPoints(pts)) return pts;
        const r = visit(c.subTree);
        if (r) return r;
      }
      if (Array.isArray(v.children)) for (const ch of v.children) { const r = visit(ch); if (r) return r; }
      if (v.suspense && v.suspense.activeBranch) return visit(v.suspense.activeBranch);
      return null;
    };
    try {
      if (!instance) return null;
      if (instance.__v_isVNode) return visit(instance); // the container's root vnode
      if (instance.props && instance.props.view && isPoints(instance.props.view.points)) return instance.props.view.points;
      return visit(instance.subTree);
    } catch { return null; }
  }
  // The pre-aim point behind a tile: { n, actorId, bornTick, killer, label } or null when it cannot be mapped. root = the app's
  // root component instance (found on the page when left out).
  function tilePoint(tile, root) {
    try {
      const n = Number(tile && tile.dataset && tile.dataset.n);
      if (!Number.isFinite(n)) return null;
      let pts = null;
      for (let c = tile.__vueParentComponent, i = 0; c && i < 4 && !pts; i++, c = c.parent) if (c.props && c.props.view && isPoints(c.props.view.points)) pts = c.props.view.points;
      if (!pts) {
        // the app container (data-v-app) keeps its root vnode as _vnode in the production build (_instance is devtools-only)
        if (root !== undefined) pts = findPoints(root);
        else for (const host of document.querySelectorAll("[data-v-app]")) { pts = findPoints(host._vnode || (host.__vue_app__ && host.__vue_app__._instance) || null); if (pts) break; }
      }
      const pt = pts && pts.find((x) => x && x.n === n);
      if (!pt || pt.actorId == null) return null;
      return { n, actorId: pt.actorId, bornTick: num(pt.bornTick) ? pt.bornTick : null, killer: pt.killer === true, label: "#" + n + (pt.place ? " " + pt.place : "") };
    } catch {}
    return null;
  }
  // Shows the shots at one enemy life in the open result screen's hit panel (id = actor id; null = back to the killer). The
  // selection is kept for that screen (re-renders keep it); a new round's screen starts on the killer again.
  function selectEnemy(id, bornTick, label) {
    try {
      const overlay = document.querySelector(".al-result-overlay");
      if (!overlay) return false;
      const selected = id == null ? null : { id, bornTick: num(bornTick) ? bornTick : null, label: label || null };
      const done = overlayDone.get(overlay);
      if (done && done !== "loading" && done.died === false) return false; // a cleared or timed-out round has no enemy to pick
      if (!done || done === "loading" || !done.round) { pendingPick.set(overlay, selected); return true; }
      done.selected = selected;
      done.tab = "killer";
      done.html = hitPanelHtml(done.round, "killer", selected, true);
      placePanel(overlay, done.html);
      return true;
    } catch { return false; }
  }
  function onTileClick(event) {
    const tile = event.target && event.target.closest ? event.target.closest(".al-ps-tile") : null;
    if (!tile || !tile.closest(".al-result-overlay")) return;
    const pt = tilePoint(tile);
    if (!pt || pt.killer) selectEnemy(null);
    else selectEnemy(pt.actorId, pt.bornTick, pt.label);
  }
  try { document.addEventListener("click", onTileClick, true); } catch {}
  window.__aimHitPanel = { selectEnemy };

  // ---------------------------------------------------------------- heatmap (pure)
  const ALL = "";
  const roundHasWeapon = (r, w) => r.drillWeapon === w || (Array.isArray(r.shots) && r.shots.some((s) => s && s.weapon === w));
  // Death cells for the filter: { cells: {"cx,cz": n}, total, source: "days" | "rounds" }.
  function heatCells(days, rounds, f) {
    const cells = {};
    let total = 0;
    const add = (key, n) => { cells[key] = (cells[key] || 0) + n; total += n; };
    if (!f.mode && !f.code && !f.weapon) {
      for (const row of days) {
        const g = row && row.grid && row.grid[f.map];
        if (g && typeof g === "object") for (const key of Object.keys(g)) if (num(g[key]) && /^-?\d+,-?\d+$/.test(key)) add(key, g[key]);
      }
      return { cells, total, source: "days" };
    }
    for (const r of rounds) {
      if (!r || r.map !== f.map || (f.mode && r.mode !== f.mode) || (f.code && r.code !== f.code) || (f.weapon && !roundHasWeapon(r, f.weapon))) continue;
      for (const d of r.deaths || []) {
        const p = d && d.position;
        if (p && num(p.x) && num(p.z)) add(Math.floor(p.x) + "," + Math.floor(p.z), 1);
      }
    }
    return { cells, total, source: "rounds" };
  }
  // Filter choices from what was read: maps (most deaths first), modes, drills, weapons.
  function heatOptions(days, rounds) {
    const maps = new Map(), modes = new Set(), codes = new Set(), weapons = new Set();
    const bump = (m, n) => { if (m != null && m !== "?") maps.set(String(m), (maps.get(String(m)) || 0) + n); };
    for (const row of days) {
      if (!row) continue;
      for (const m of Object.keys(row.maps || {})) bump(m, num(row.maps[m].deaths) ? row.maps[m].deaths : 0);
      for (const m of Object.keys(row.modes || {})) if (m !== "?") modes.add(m);
      for (const w of Object.keys(row.weapons || {})) if (w !== "?") weapons.add(w);
    }
    for (const r of rounds) {
      if (!r) continue;
      bump(r.map, 0);
      if (r.mode) modes.add(String(r.mode));
      if (r.code) codes.add(String(r.code));
      if (r.drillWeapon) weapons.add(String(r.drillWeapon));
      for (const s of r.shots || []) if (s && s.weapon) weapons.add(String(s.weapon));
    }
    const sort = (set) => [...set].sort((a, b) => a.localeCompare(b));
    return { maps: [...maps].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map((e) => e[0]), modes: sort(modes), codes: sort(codes), weapons: sort(weapons) };
  }
  const select = (name, label, values, current, allLabel, text = (v) => v) => `<label>${label}<select data-filter="${name}">`
    + (allLabel ? `<option value="">${allLabel}</option>` : "")
    + values.map((v) => `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(text(v))}</option>`).join("") + `</select></label>`;
  const CELL_KEY = /^-?\d+,-?\d+$/;
  // Fight cells for the filter: { cells: {"cx,cz": n}, total, withoutPosition (null = unknown), source: "days" | "rounds" }.
  // read = the fight read for this filter (a fightCells answer, or countFights() of the engagements), null when it failed.
  // With only a map picked the cells come from the day rows' fights grid; read then only gives the count without a position.
  function fightLayer(days, read, f) {
    const cells = {};
    let total = 0;
    const add = (key, n) => { cells[key] = (cells[key] || 0) + n; total += n; };
    const withoutPosition = read && num(read.withoutPosition) ? read.withoutPosition : null;
    // fights lost per cell, only when the read carries it (no reader records it yet; the hover card shows it when present)
    const lost = read && read.lost && typeof read.lost === "object" && !Array.isArray(read.lost) ? read.lost : null;
    if (!f.mode && !f.code && !f.weapon) {
      for (const row of days) {
        const g = row && row.fights && row.fights[f.map];
        if (g && typeof g === "object") for (const key of Object.keys(g)) if (num(g[key]) && CELL_KEY.test(key)) add(key, g[key]);
      }
      return { cells, total, withoutPosition, lost, source: "days" };
    }
    const g = read && read.cells && typeof read.cells === "object" ? read.cells : {};
    for (const key of Object.keys(g)) if (num(g[key]) && CELL_KEY.test(key)) add(key, g[key]);
    return { cells, total, withoutPosition, lost, source: "rounds" };
  }
  // Engagement rows (engagements() shape) counted like fightCells, keeping one mode: fightCells has no mode filter.
  function countFights(rows, mode) {
    const cells = {};
    let total = 0, withoutPosition = 0;
    for (const e of rows) {
      if (!e || (mode && e.mode !== mode)) continue;
      const p = e.playerContact;
      if (!p || !num(p.x) || !num(p.z)) { withoutPosition++; continue; }
      const key = Math.floor(p.x) + "," + Math.floor(p.z);
      cells[key] = (cells[key] || 0) + 1; total++;
    }
    return { cells, total, withoutPosition };
  }
  const LAYERS = [["deaths", "Deaths"], ["fights", "Fights"], ["both", "Both"]];
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  // "Brighten map" (17 Nov 2026): the minimap picture sat at 55% opacity on a near-black ground, so death cells were hard to place.
  // level 0..100 (default BRIGHT_DEFAULT) -> picture opacity 0.55..1, CSS brightness 1..2.2, contrast 1..1.35, plus a white lift
  // over the picture (0..12%) so the shadows come up. At the default 40 (was 60 until 17 Nov 2026): opacity 0.73, brightness 1.48,
  // contrast 1.14, lift 4.8%.
  // Level 0 is the old look. The cells are drawn over the lift with a thin dark edge, so their colours stay as they were.
  // The level is kept per viewer in localStorage (BRIGHT_KEY); a failing localStorage gives the default.
  const BRIGHT_KEY = "aim-analytics-map-bright-v1", BRIGHT_DEFAULT = 40;
  const clampBright = (v) => (v !== null && v !== undefined && v !== "" && Number.isFinite(+v) ? Math.min(100, Math.max(0, Math.round(+v))) : BRIGHT_DEFAULT);
  function mapLook(level) {
    const k = clampBright(level) / 100;
    return { opacity: +(0.55 + 0.45 * k).toFixed(2), filter: `brightness(${(1 + 1.2 * k).toFixed(2)}) contrast(${(1 + 0.35 * k).toFixed(2)}) saturate(1.1)`, lift: +(0.12 * k).toFixed(3) };
  }
  const readBright = () => { try { return clampBright(localStorage.getItem(BRIGHT_KEY)); } catch { return BRIGHT_DEFAULT; } };
  // mini = the map's minimap info ({ image, transform }) or null for a plain grid. f.layer = "deaths" | "fights" | "both".
  // bright = the "Brighten map" level (0..100; undefined = the default).
  // fightRead = the fight read for f (see fightLayer), null when it failed, undefined while it is still loading.
  // zoom = { k, tx, ty } (see zoomAt), the map's zoom and pan in viewBox units; left out = 1x.
  function heatmapHtml(days, rounds, f, mini, fightRead, bright, zoom) {
    const opts = heatOptions(days, rounds);
    if (!opts.maps.length) return `<p class="aim-an-msg">No deaths recorded yet. Play a few rounds and your death spots show up here, per map.</p>`;
    if (!f.map || !opts.maps.includes(f.map)) f.map = opts.maps[0];
    const layer = LAYERS.some((l) => l[0] === f.layer) ? f.layer : "deaths";
    const showDeaths = layer !== "fights", showFights = layer !== "deaths";
    const filterBar = `<div class="aim-an-filters">${select("map", "Map", opts.maps, f.map, "")}${select("mode", "Mode", opts.modes, f.mode, "All modes")}`
      + `${select("code", "Drill", opts.codes.slice().sort((a, b) => drillLabel(a).localeCompare(drillLabel(b))), f.code, "All drills", drillLabel)}${select("weapon", "Weapon", opts.weapons, f.weapon, "All weapons")}</div>`
      + `<div class="aim-an-filters aim-an-layers" role="group" aria-label="Layer">`
      + LAYERS.map(([id, label]) => `<button type="button" data-layer="${id}" aria-pressed="${id === layer}">${label}</button>`).join("");
    // the Reset zoom chip only beside a drawn map (it did nothing next to an empty message)
    const filters = filterBar + `<button type="button" class="aim-an-zoom-reset" data-zoom-reset title="Wheel over the map zooms, drag pans, double-click resets">Reset zoom</button></div>`, bare = filterBar + `</div>`;
    if (showFights && fightRead === undefined) return bare + `<p class="aim-an-msg">Loading fights…</p>`;
    const deaths = heatCells(days, rounds, f);
    const fights = showFights ? fightLayer(days, fightRead, f) : null;
    const notes = [];
    if (deaths.source === "rounds") notes.push(`Mode, drill and weapon filters use the stored rounds (the last 30 days, newest ${RAW_ROUNDS}); older days keep deaths per map only.`);
    if (fights) {
      notes.push(fights.source === "rounds"
        ? `Fights with a mode, drill or weapon filter come from the stored rounds (the last 30 days, newest ${RAW_ROUNDS}); the weapon is the one held at the kill, or when the fight ended. A fight is placed where you stood when it began.`
        : "Fights per map come from the day rows (positions are recorded since 17 Nov 2026). A fight is placed where you stood when it began.");
      const totals = (showDeaths ? `${plural(deaths.total, "death")} and ` : "") + `${plural(fights.total, "fight")} in all`;
      const w = fights.withoutPosition;
      const without = w == null ? "" : `; ${plural(w, "fight")} of the newest ${RAW_ROUNDS} stored rounds ${w === 1 ? "has" : "have"} no position and ${w === 1 ? "is" : "are"} not drawn`;
      notes.push(`On ${esc(f.map)}: ${totals}${without}.`);
    }
    const noteHtml = () => notes.map((n) => `<p class="aim-an-note">${n}</p>`).join("");
    const dKeys = showDeaths ? Object.keys(deaths.cells) : [], fKeys = fights ? Object.keys(fights.cells) : [];
    if (!dKeys.length && !fKeys.length) {
      const what = layer === "deaths" ? "deaths" : layer === "fights" ? "fights with a position" : "deaths or fights with a position";
      if (!f.mode && !f.code && !f.weapon) {
        const msg = layer === "deaths" ? `No deaths on ${esc(f.map)} yet. When you die in a round, the spot shows up here, so you can see where you get caught. Pick Fights to see where your fights start.`
          : `No ${what} on ${esc(f.map)} yet. Fights against bots are placed where you stood when they began; play a drill with enemies and they show up here.`;
        return bare + `<p class="aim-an-msg">${msg}</p>` + noteHtml();
      }
      return bare + `<p class="aim-an-msg">No ${what} on ${esc(f.map)} for these filters.</p>` + noteHtml();
    }
    const dMax = dKeys.length ? Math.max(...dKeys.map((k) => deaths.cells[k])) : 0, fMax = fKeys.length ? Math.max(...fKeys.map((k) => fights.cells[k])) : 0;
    const all = [...dKeys, ...fKeys];
    const xs = all.map((k) => +k.split(",")[0]), zs = all.map((k) => +k.split(",")[1]);
    const t = mini && mini.transform, useMini = !!(t && num(t.scaleU) && num(t.scaleV) && num(t.offsetU) && num(t.offsetV) && t.scaleU && t.scaleV && mini.src);
    const shade = (n, max) => (0.18 + 0.82 * (n / max)).toFixed(2);
    // Each cell carries an aria-label (its count) and data-tip, the hover card's text (see cellTip); no <title>, so the
    // browser's own tooltip does not stack on the card.
    const label = (k, n, word) => `aria-label="${esc(k)} m: ${plural(n, word)}"`;
    const tipData = { map: f.map, layer, deaths, fights };
    const tip = (k, which) => `data-tip="${esc(cellTip(k, tipData, which))}"`;
    // A cell's box in SVG units: image space 0..1000 on the minimap (one 1 m cell is scaleU * 1000 wide), metres on the plain grid.
    const S = 1000;
    const box = (k) => {
      const [cx, cz] = k.split(",").map(Number);
      if (!useMini) return { x: cx, y: cz, w: 1, h: 1 };
      const u0 = (cx * t.scaleU + t.offsetU) * S, u1 = ((cx + 1) * t.scaleU + t.offsetU) * S, v0 = (cz * t.scaleV + t.offsetV) * S, v1 = ((cz + 1) * t.scaleV + t.offsetV) * S;
      return { x: Math.min(u0, u1), y: Math.min(v0, v1), w: Math.abs(t.scaleU) * S, h: Math.abs(t.scaleV) * S };
    };
    const n1 = (v) => (useMini ? v.toFixed(1) : String(Math.round(v * 1000) / 1000));
    const rects = [];
    for (const k of dKeys) {
      const b = box(k);
      rects.push(`<rect class="aim-an-cell" x="${n1(b.x)}" y="${n1(b.y)}" width="${n1(b.w)}" height="${n1(b.h)}" fill="#ff4655" fill-opacity="${shade(deaths.cells[k], dMax)}" ${label(k, deaths.cells[k], "death")} ${tip(k, "deaths")}/>`);
    }
    // Fights: filled like deaths when alone; in Both an outline inset by 15% of the cell, drawn over the deaths so a death fill
    // under it stays visible. Every fight square has an outline (17 Nov 2026): a dark edge (.aim-an-fight-edge, drawn first)
    // under a bright theme-green line, so it reads on the brightened picture.
    // In Both (fix 17 Nov 2026): no dark edge and no fill, only a bright fight-colour ring on the cell's own edge, at least 70%
    // opaque, drawn over the death fill; the dark edge and a dim ring used to turn a shared cell nearly black on small cells.
    // Normal alpha compositing only (no blend mode), so the death fill shows through inside the ring.
    const outline = layer === "both";
    for (const k of fKeys) {
      const b = box(k), n = fights.cells[k];
      const geo = `x="${n1(b.x)}" y="${n1(b.y)}" width="${n1(b.w)}" height="${n1(b.h)}"`;
      if (outline) {
        rects.push(`<rect class="aim-an-fight is-outline" ${geo} fill="none" stroke-opacity="${(0.7 + 0.3 * (n / fMax)).toFixed(2)}" ${label(k, n, "fight")} ${tip(k, "fights")}/>`);
        continue;
      }
      rects.push(`<rect class="aim-an-fight-edge" ${geo}/>`);
      rects.push(`<rect class="aim-an-fight" ${geo} fill-opacity="${shade(n, fMax)}" ${label(k, n, "fight")} ${tip(k, "fights")}/>`);
    }
    const mapLabel = layer === "deaths" ? "Death heatmap" : layer === "fights" ? "Fight heatmap" : "Death and fight heatmap";
    let svg;
    const z = zoom && num(zoom.k) && zoom.k > 1 ? zoom : null;
    const g = (inner) => `<g class="aim-an-zoom" transform="${z ? zoomTransform(z) : "translate(0 0) scale(1)"}">${inner}</g>`;
    if (useMini) {
      const look = mapLook(bright);
      svg = `<svg viewBox="0 0 ${S} ${S}" role="img" aria-label="${mapLabel} on ${esc(f.map)}">` + g(`<image href="${esc(mini.src)}" class="aim-an-minimap" x="0" y="0" width="${S}" height="${S}" preserveAspectRatio="none" opacity="${look.opacity}" style="filter:${look.filter}"/>`
        + `<rect class="aim-an-lift" x="0" y="0" width="${S}" height="${S}" fill="#fff" fill-opacity="${look.lift}" pointer-events="none"/>${rects.join("")}`) + `</svg>`;
    } else {
      const edge = 4, x0 = Math.min(...xs) - edge, x1 = Math.max(...xs) + 1 + edge, z0 = Math.min(...zs) - edge, z1 = Math.max(...zs) + 1 + edge;
      const lines = [];
      for (let x = Math.ceil(x0 / 5) * 5; x <= x1; x += 5) lines.push(`<line class="aim-an-gridline" x1="${x}" y1="${z0}" x2="${x}" y2="${z1}"/>`);
      for (let z = Math.ceil(z0 / 5) * 5; z <= z1; z += 5) lines.push(`<line class="aim-an-gridline" x1="${x0}" y1="${z}" x2="${x1}" y2="${z}"/>`);
      svg = `<svg viewBox="${x0} ${z0} ${x1 - x0} ${z1 - z0}" role="img" aria-label="${mapLabel} on ${esc(f.map)} (plain grid)">${g(lines.join("") + rects.join(""))}</svg>`;
      notes.unshift("No map picture for this map: plain grid, 5 m lines, seen from above.");
    }
    const legends = (dKeys.length ? `<div class="aim-an-legend"><span>1</span><i></i><span>${dMax} deaths per 1 m cell · ${deaths.total} in all</span></div>` : "")
      + (fKeys.length ? `<div class="aim-an-legend is-fight${outline ? " is-outline" : ""}"><span>1</span><i></i><span>${fMax} fights per 1 m cell · ${fights.total} in all${outline ? " (outlined)" : ""}</span></div>` : "");
    const lvl = clampBright(bright);
    const slider = useMini ? `<label class="aim-an-bright">Brighten map<input type="range" min="0" max="100" step="5" value="${lvl}" data-bright aria-label="Brighten map"><output>${lvl}%</output></label>` : "";
    return filters + slider + `<div class="aim-an-map${useMini ? " has-pic" : ""}${z ? " is-zoomed" : ""}">${svg}</div>${legends}` + noteHtml();
  }

  // The hover card's text for one cell (lines joined by "\n"). A value line is "<Name> <count>\t<share>": the hover card draws it
  // large, with the share in its top-right corner as "X% / N" (the cell's share of the layer's total for these filters, and
  // that total). One layer: one value line (the layer's). Both: a Deaths line and a Fights line, the same size. Then fights lost
  // when the read has them, and a small last line with the map, the cell, its metres and the layer.
  // d = { map, layer, deaths, fights } (deaths: heatCells(), fights: fightLayer() or null when the fight layer was not read);
  // which = the square hovered on a single layer ("deaths" | "fights"; default the layer's own).
  function cellTip(key, d, which) {
    const [cx, cz] = String(key).split(",").map(Number);
    const value = (k, name) => {
      const n = d[k] ? d[k].cells[key] || 0 : 0, total = d[k] ? d[k].total : 0;
      return `${name} ${n}\t${total > 0 ? Math.round((n / total) * 100) : 0}% / ${total}`;
    };
    const lines = [];
    if (d.layer === "both") { if (d.deaths) lines.push(value("deaths", "Deaths")); if (d.fights) lines.push(value("fights", "Fights")); }
    else lines.push(which === "fights" || d.layer === "fights" ? value("fights", "Fights") : value("deaths", "Deaths"));
    if (d.fights && d.fights.lost && num(d.fights.lost[key])) lines.push(`Fights lost ${d.fights.lost[key]} of ${d.fights.cells[key] || 0}`);
    const l = LAYERS.find((x) => x[0] === d.layer);
    lines.push(`${d.map} · cell ${cx}, ${cz} (x ${cx} to ${cx + 1} m, z ${cz} to ${cz + 1} m) · ${l ? l[1] : "Deaths"} layer`);
    return lines.join("\n");
  }
  // Zoom and pan (17 Nov 2026). z = { k: scale 1..ZOOM_MAX, tx, ty: translation in viewBox units }; a map point p is drawn at
  // tx + k * p. vb = the svg's viewBox { x, y, width, height }.
  const ZOOM_MAX = 6;
  const zoomTransform = (z) => `translate(${+z.tx.toFixed(3)} ${+z.ty.toFixed(3)}) scale(${+z.k.toFixed(4)})`;
  // Keeps the zoomed map covering the whole view (no empty edge); at 1x that is no translation.
  function clampPan(z, vb) {
    const k = z.k, lo = (a, w) => (a + w) * (1 - k), hi = (a) => a * (1 - k);
    return { k, tx: Math.min(hi(vb.x), Math.max(lo(vb.x, vb.width), z.tx)), ty: Math.min(hi(vb.y), Math.max(lo(vb.y, vb.height), z.ty)) };
  }
  // One wheel step: scale by factor around the viewBox point (X, Y) under the cursor, so that point stays under the cursor.
  function zoomAt(z, vb, X, Y, factor) {
    const k = Math.min(ZOOM_MAX, Math.max(1, z.k * factor));
    if (k === 1) return { k: 1, tx: 0, ty: 0 };
    const wx = (X - z.tx) / z.k, wy = (Y - z.ty) / z.k;
    return clampPan({ k, tx: X - k * wx, ty: Y - k * wy }, vb);
  }

  // ---------------------------------------------------------------- progress (pure)
  // better: 1 = higher is better, -1 = lower is better, 0 = neither
  const METRICS = [
    { id: "accuracy", label: "Accuracy", unit: "%", better: 1, of: (r) => (r.shots > 0 ? (r.hits / r.shots) * 100 : null) },
    { id: "headshots", label: "Headshot rate", unit: "%", better: 1, of: (r) => (r.hits > 0 ? (r.headshots / r.hits) * 100 : null) },
    { id: "killTime", label: "Kill time (median)", unit: " s", better: -1, of: null },
    { id: "nearMisses", label: "Near misses", unit: "", better: 0, of: (r) => (r.shots > 0 ? r.nearMisses || 0 : null) },
    { id: "flicks", label: "Flick share of kills", unit: "%", better: 0, of: (r) => (r.kills > 0 ? ((r.flicks || 0) / r.kills) * 100 : null) },
    { id: "strafes", label: "Strafe share of kills", unit: "%", better: 0, of: (r) => (r.kills > 0 ? ((r.strafes || 0) / r.kills) * 100 : null) },
    { id: "deaths", label: "Deaths per round", unit: "", better: -1, of: (r) => (r.rounds > 0 ? r.deaths / r.rounds : null) },
  ];
  const median = (list) => { const s = [...list].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  // Points per metric for the range: { [id]: [{ day, value }] } (days without data are left out).
  function progressSeries(days, engagements, range, now) {
    const from = daysAgo(range - 1, now);
    const out = {};
    for (const m of METRICS) out[m.id] = [];
    for (const row of days) {
      if (!row || typeof row.day !== "string" || row.day < from) continue;
      for (const m of METRICS) {
        if (!m.of) continue;
        const v = m.of(row);
        if (num(v)) out[m.id].push({ day: row.day, value: v });
      }
    }
    const ttk = new Map();
    for (const e of engagements) {
      if (!e || !e.killed || e.sight !== true || !num(e.visibleTimeToKill) || typeof e.day !== "string" || e.day < from) continue;
      if (!ttk.has(e.day)) ttk.set(e.day, []);
      ttk.get(e.day).push(e.visibleTimeToKill);
    }
    out.killTime = [...ttk.keys()].sort().map((day) => ({ day, value: median(ttk.get(day)) }));
    for (const m of METRICS) out[m.id].sort((a, b) => (a.day < b.day ? -1 : 1));
    return out;
  }
  const fmt = (m, v) => (m.unit === "%" ? Math.round(v) + "%" : m.id === "killTime" ? v.toFixed(2) + " s" : m.id === "deaths" ? v.toFixed(2) : String(Math.round(v)));
  // Few days of data (17 Nov 2026): with FEW_DAYS days or fewer with data in the range, one or two day points say little, so the
  // charts use the stored rounds of the range instead: one point per round up to ROUND_POINTS_MAX rounds, else one per session
  // (a gap of SESSION_GAP_MS or more between two rounds' starts begins a new session). They switch back to days once more days
  // have data, and stay on days when the rounds would not give more points than the days (or none are stored).
  const FEW_DAYS = 3, ROUND_POINTS_MAX = 30, SESSION_GAP_MS = 30 * 60 * 1000;
  const hhmm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  // Distinct days with data in the range (day rows and kill times).
  function daysWithData(days, engagements, range, now) {
    const from = daysAgo(range - 1, now), set = new Set();
    for (const row of days) if (row && typeof row.day === "string" && row.day >= from) set.add(row.day);
    for (const e of engagements) if (e && e.killed && e.sight === true && num(e.visibleTimeToKill) && typeof e.day === "string" && e.day >= from) set.add(e.day);
    return set.size;
  }
  // One round (rounds() shape) as day-row counts, plus its kill times.
  function roundCounts(r) {
    const c = { rounds: 1, shots: 0, hits: 0, headshots: 0, kills: 0, deaths: 0, nearMisses: 0, flicks: 0, strafes: 0, ttk: [] };
    for (const s of Array.isArray(r.shots) ? r.shots : []) {
      if (!s || typeof s !== "object") continue;
      c.shots++;
      if (isHit(s)) { c.hits++; if (s.part === "head" || (s.pellets && s.pellets.head > 0)) c.headshots++; }
      if (s.killed) c.kills++;
    }
    c.deaths = Array.isArray(r.deaths) ? r.deaths.length : 0;
    c.nearMisses = new Set((Array.isArray(r.nearMisses) ? r.nearMisses : []).filter((n) => n && num(n.shotIndex)).map((n) => n.shotIndex)).size;
    for (const e of Array.isArray(r.engagements) ? r.engagements : []) {
      if (!e || !e.killed || r.sight !== true) continue; // flick or strafe and the kill time depend on when you saw the enemy: only rounds with line-of-sight data
      if (e.kind === "flick") c.flicks++; else if (e.kind === "strafe") c.strafes++;
      if (num(e.visibleTimeToKill)) c.ttk.push(e.visibleTimeToKill);
    }
    return c;
  }
  // Points per metric from the rounds of the range: { unit: "round" | "session", count, series: { [id]: [{ day: label, at, x, value }] } },
  // or null when they give no more points than dayCount. x = 0..1 along the chart (points evenly spaced, oldest first).
  function progressBuckets(rounds, range, now, dayCount) {
    const from = daysAgo(range - 1, now);
    const list = (Array.isArray(rounds) ? rounds : []).filter((r) => r && num(r.at) && dayOf(r.at) >= from).sort((a, b) => a.at - b.at);
    if (!list.length) return null;
    const unit = list.length <= ROUND_POINTS_MAX ? "round" : "session";
    const groups = [];
    for (const r of list) {
      const g = groups[groups.length - 1];
      if (unit === "session" && g && r.at - g.last < SESSION_GAP_MS) { g.rounds.push(r); g.last = r.at; }
      else groups.push({ at: r.at, last: r.at, rounds: [r] });
    }
    if (groups.length <= dayCount) return null;
    const series = {};
    for (const m of METRICS) series[m.id] = [];
    groups.forEach((g, i) => {
      const sum = { rounds: 0, shots: 0, hits: 0, headshots: 0, kills: 0, deaths: 0, nearMisses: 0, flicks: 0, strafes: 0, ttk: [] };
      for (const r of g.rounds) { const c = roundCounts(r); for (const k of Object.keys(sum)) sum[k] = k === "ttk" ? sum.ttk.concat(c.ttk) : sum[k] + c[k]; }
      const label = dayOf(g.at) + " " + hhmm(g.at) + (unit === "session" ? ` (${plural(g.rounds.length, "round")})` : "");
      const x = groups.length > 1 ? i / (groups.length - 1) : 0.5;
      for (const m of METRICS) {
        const v = m.of ? m.of(sum) : sum.ttk.length ? median(sum.ttk) : null;
        if (num(v)) series[m.id].push({ day: label, at: g.at, x, value: v, rounds: g.rounds.length });
      }
    });
    return { unit, count: groups.length, series };
  }
  // Axis ticks (17 Nov 2026): "nice" round values (a step of 1, 2, 2.5 or 5 times a power of ten) from at or below lo to at or
  // above hi, about `target` steps apart: { ticks, step, dec } (dec = decimals the labels need).
  function niceTicks(lo, hi, target = 4) {
    if (!(hi > lo)) hi = lo + 1;
    const raw = (hi - lo) / target, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= raw * (1 - 1e-9));
    const lead = step / Math.pow(10, Math.floor(Math.log10(step) + 1e-9));
    const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) + (Math.abs(lead - 2.5) < 1e-6 ? 1 : 0);
    const first = Math.floor(lo / step + 1e-9), last = Math.ceil(hi / step - 1e-9);
    const ticks = [];
    for (let i = first; i <= last; i++) ticks.push(+(i * step).toFixed(dec));
    return { ticks, step, dec };
  }
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // "2026-11-17" or epoch ms -> "17 Nov"
  const shortDate = (d) => { const t = typeof d === "number" ? new Date(d) : new Date(String(d).slice(0, 10) + "T12:00:00"); return isNaN(t) ? String(d) : t.getDate() + " " + MONTHS[t.getMonth()]; };
  const exact = (m, v) => (m.unit === "%" ? v.toFixed(1) + "%" : m.id === "killTime" ? v.toFixed(3) + " s" : m.id === "deaths" ? v.toFixed(2) + " per round" : m.id === "nearMisses" ? Math.round(v) + " near misses" : String(+v.toFixed(2)));
  // A chart node's hover text: the metric and its exact value, then the day, or the round / session it came from.
  function nodeTip(m, p, unit) {
    const when = unit === "day" ? `Day: ${shortDate(p.day)} ${String(p.day).slice(0, 4)}`
      : unit === "round" ? `Round at ${shortDate(p.at)} ${hhmm(p.at)}`
      : `Session from ${shortDate(p.at)} ${hhmm(p.at)}${num(p.rounds) ? ` (${plural(p.rounds, "round")})` : ""}`;
    return `${m.label}: ${exact(m, p.value)}\n${when}`;
  }
  // x-axis labels: [{ at: 0..1, label, edge: "first" | "last" | "" }]. Days: the range's first and last day at the ends and three
  // evenly spaced dates between. Rounds / sessions: the first and last point at the ends and up to three points between (times of
  // day when they all fall on one day).
  function xTicks(points, range, now, unit) {
    if (unit === "day") {
      const start = new Date(daysAgo(range - 1, now) + "T12:00:00").getTime(), span = Math.max(1, range - 1) * 86400000;
      return [0, 0.25, 0.5, 0.75, 1].map((at, i) => ({ at, label: shortDate(dayOf(start + Math.round((at * span) / 86400000) * 86400000)), edge: i === 0 ? "first" : i === 4 ? "last" : "" }));
    }
    const n = points.length, sameDay = n && dayOf(points[0].at) === dayOf(points[n - 1].at);
    const name = (p) => (sameDay ? hhmm(p.at) : shortDate(p.at));
    const idx = [...new Set([0, 0.25, 0.5, 0.75, 1].map((a) => Math.round(a * (n - 1))))];
    return idx.map((i, j) => ({ at: num(points[i].x) ? points[i].x : 0.5, label: name(points[i]), edge: j === 0 ? "first" : j === idx.length - 1 && idx.length > 1 ? "last" : "" }));
  }
  // unit = "day" (points placed by date in the range) or "round" / "session" (points carry x, evenly spaced).
  // thumb = true: a thumbnail (role button, data-focus) with the summary, the arrow and the line only; else the focus chart
  // with gridlines, value labels, date labels and hoverable nodes.
  // selected = this thumbnail is the one shown large (marked, aria-pressed); the thumbnails keep their order.
  function chartHtml(m, points, range, now, unit = "day", thumb = false, selected = false) {
    const pick = thumb ? ` data-focus="${m.id}" role="button" tabindex="0" aria-pressed="${selected}" aria-label="Show ${m.label} large"` : "";
    if (!points.length) return `<div class="aim-an-chart" data-metric="${m.id}"${pick}><h4>${m.label}</h4><p class="aim-an-empty">No data in this range${m.id === "killTime" ? " (kill times come from the newest " + RAW_ROUNDS + " rounds of the last 30 days)" : ""}.</p></div>`;
    const first = points[0].value, last = points[points.length - 1].value;
    // flat also when the two numbers read the same once rounded ("57% ↑ 57%" told nothing)
    const delta = last - first, flat = Math.abs(delta) < 1e-9 || points.length < 2 || fmt(m, first) === fmt(m, last);
    const arrow = flat ? "→" : delta > 0 ? "↑" : "↓";
    const cls = flat || !m.better ? "" : delta * m.better > 0 ? " is-up" : " is-down";
    const W = 260, H = 70, P = 6;
    const start = new Date(daysAgo(range - 1, now) + "T12:00:00").getTime(), span = Math.max(1, range - 1) * 86400000;
    const fx = (p) => (num(p.x) ? p.x : clampNum((new Date(p.day + "T12:00:00").getTime() - start) / span, 0, 1));
    const xOf = (p) => P + fx(p) * (W - 2 * P);
    const vals = points.map((p) => p.value);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (m.unit === "%") { lo = Math.max(0, lo - 5); hi = Math.min(100, hi + 5); }
    if (hi - lo < 1e-9) { lo = Math.max(0, lo - 1); hi += 1; }
    const nt = niceTicks(lo, hi);
    lo = nt.ticks[0]; hi = nt.ticks[nt.ticks.length - 1];
    const yOf = (v) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
    const pct = (v, of) => ((v / of) * 100).toFixed(2) + "%";
    const tickLabel = (v) => v.toFixed(nt.dec) + (m.unit === "%" ? "%" : m.id === "killTime" ? " s" : "");
    const pts = points.map((p) => `${xOf(p).toFixed(1)},${yOf(p.value).toFixed(1)}`);
    if (thumb) {
      return `<div class="aim-an-chart${cls}" data-metric="${m.id}"${pick}><h4>${m.label}<span>${fmt(m, first)} <b class="aim-an-arrow">${arrow}</b> ${fmt(m, last)}</span></h4>`
        + `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${points.length > 1 ? `<polyline class="aim-an-line" points="${pts.join(" ")}"/>` : `<circle class="aim-an-pt" cx="${pts[0].split(",")[0]}" cy="${pts[0].split(",")[1]}" r="3"/>`}</svg></div>`;
    }
    const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${m.label}: ${fmt(m, first)} to ${fmt(m, last)}">`
      + nt.ticks.map((v) => `<line class="aim-an-grid" x1="0" x2="${W}" y1="${yOf(v).toFixed(1)}" y2="${yOf(v).toFixed(1)}"/>`).join("")
      + (points.length > 1 ? `<polyline class="aim-an-line" points="${pts.join(" ")}"/>` : "") + `</svg>`;
    const yaxis = `<div class="aim-an-yaxis" aria-hidden="true">` + nt.ticks.map((v) => `<span data-tick="${v}" style="top:${pct(yOf(v), H)}">${tickLabel(v)}</span>`).join("") + `</div>`;
    const nodes = points.map((p) => { const t = nodeTip(m, p, unit); return `<span class="aim-an-node" style="left:${pct(xOf(p), W)};top:${pct(yOf(p.value), H)}" data-tip="${esc(t)}" aria-label="${esc(t.replace("\n", ", "))}"></span>`; }).join("");
    const xaxis = `<div class="aim-an-xaxis" aria-hidden="true">` + xTicks(points, range, now, unit).map((t) => `<span class="${t.edge ? "is-" + t.edge : ""}" data-x-edge="${t.edge}" style="left:${pct(P + t.at * (W - 2 * P), W)}">${esc(t.label)}</span>`).join("") + `</div>`;
    return `<div class="aim-an-chart${cls}" data-metric="${m.id}"><h4>${m.label}<span>${fmt(m, first)} <b class="aim-an-arrow">${arrow}</b> ${fmt(m, last)}</span></h4>`
      + `<div class="aim-an-plot">${yaxis}<div class="aim-an-plotbox" tabindex="0" data-tipnav role="group" aria-label="${esc(m.label)}: ${plural(points.length, "point")}, arrow keys step through them">${svg}${nodes}</div><span></span>${xaxis}</div>`
      + `<p class="aim-an-note">${plural(points.length, unit)} with data · first ${esc(points[0].day)}, latest ${esc(points[points.length - 1].day)}</p></div>`;
  }
  // rounds = the stored rounds (rounds() shape) for the few-days view; leave it out (or []) for day points only.
  // focus = the metric drawn large (default accuracy); the others are thumbnails under it.
  // ---------------------------------------------------------------- tracking (18 Nov 2026)
  // How well your crosshair stays on a MOVING enemy, from the engagements' tracking entries (recorder header, "tracking"). target = "body"
  // or "head": which one the on-target share, the error and the lock time are about (the lag and smoothness always follow the body).
  const TRACK_MIN_TICKS = 8;     // sampled ticks before an engagement counts toward the numbers
  const TRACK_DAYS = 10;         // days shown in the by-day bars
  const medianOf = (list) => { const a = list.filter(num).sort((x, y) => x - y), m = a.length >> 1; return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : null; };
  function trackingTotals(rows, target) {
    const head = target === "head";
    let samples = 0, on = 0, err = 0, lag = 0, jit = 0, jn = 0, seconds = 0;
    const locks = [];
    for (const e of rows) {
      const t = e.tracking;
      samples += t.samples; on += head ? t.headOn : t.bodyOn; err += head ? t.headErrorSum : t.bodyErrorSum; lag += t.lagSum; jit += t.jitterSum; jn += t.jitterPairs; seconds += t.seconds || 0;
      locks.push(head ? t.lockHeadSeconds : t.lockBodySeconds);
    }
    const got = locks.filter(num);
    return { fights: rows.length, samples, seconds, onPercent: samples ? Math.round((on / samples) * 100) : null, errorDeg: samples ? err / samples : null, lagDeg: samples ? lag / samples : null,
      jitterDeg: jn ? jit / jn : null, lockSeconds: medianOf(got), neverLocked: locks.length - got.length };
  }
  function trackingHtml(engagements, target) {
    target = target === "head" ? "head" : "body";
    const toggle = `<div class="aim-an-filters" role="group" aria-label="Track against">` + [["body", "Body"], ["head", "Head"]].map(([id, label]) => `<button type="button" data-track="${id}" aria-pressed="${id === target}">${label}</button>`).join("") + `</div>`;
    const everyFight = Array.isArray(engagements) ? engagements : [], sighted = everyFight.filter((e) => e && e.sight === true).length;
    // only said when some fights lack it (a new player has it on every fight, and the line was noise)
    const sightNote = sighted < everyFight.length ? `<p class="aim-an-note" data-sight-note>Line-of-sight data on ${sighted} of ${everyFight.length} recorded fights. Fights recorded before it existed counted enemies behind walls as seen, so they are not used here.</p>` : "";
    const rows = (Array.isArray(engagements) ? engagements : []).filter((e) => e && e.sight === true && e.tracking && num(e.tracking.samples) && e.tracking.samples >= TRACK_MIN_TICKS);
    if (!rows.length) return toggle + sightNote + `<p class="aim-an-msg">No tracking recorded yet. Play a drill with moving enemies (a tracking drill, or strafing bots) and this shows how well your crosshair stays on them and how fast you lock on.</p>`;
    const T = trackingTotals(rows, target), word = target === "head" ? "head" : "body";
    const fix = (v, d = 1) => (num(v) ? String(+v.toFixed(d)) : "–");
    const lagText = !num(T.lagDeg) || Math.abs(T.lagDeg) < 0.1 ? "level" : fix(Math.abs(T.lagDeg)) + "° " + (T.lagDeg > 0 ? "behind" : "ahead");
    const tile = (label, value, hint) => `<div class="aim-an-track-tile"><span>${esc(label)}</span><b>${esc(value)}</b><em>${esc(hint)}</em></div>`;
    const tiles = `<div class="aim-an-track-tiles" data-track-tiles>`
      + tile("On the " + word, T.onPercent + "%", "of the time an enemy moved")
      + tile("Average error", fix(T.errorDeg) + "°", "from the " + word + "'s centre")
      + tile("Time to lock", T.lockSeconds === null ? "never" : fix(T.lockSeconds, 2) + " s", T.neverLocked ? T.neverLocked + " of " + T.fights + " fights never locked" : "typical fight, from first sight")
      + tile("Lag", lagText, "behind = trailing the enemy")
      + tile("Smoothness", T.jitterDeg === null ? "–" : fix(T.jitterDeg, 2) + "°", "jitter per tick, lower is steadier") + `</div>`;
    // by weapon
    const byWeapon = new Map();
    for (const e of rows) { const w = e.weapon || "?"; if (!byWeapon.has(w)) byWeapon.set(w, []); byWeapon.get(w).push(e); }
    const weaponBars = barsRowsHtml([...byWeapon].map(([w, list]) => ({ label: w + " (" + list.length + ")", value: trackingTotals(list, target).onPercent })).filter((r) => num(r.value)), "%", "track-weapon");
    // by day (newest days with data)
    const byDay = new Map();
    for (const e of rows) { if (!e.day) continue; if (!byDay.has(e.day)) byDay.set(e.day, []); byDay.get(e.day).push(e); }
    const dayBars = barsRowsHtml([...byDay].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-TRACK_DAYS).map(([d, list]) => ({ label: shortDate(d) + " (" + list.length + ")", value: trackingTotals(list, target).onPercent })), "%", "track-day");
    return toggle + sightNote + tiles
      + (weaponBars ? `<h4 class="aim-an-sub">On the ${word} by weapon</h4>` + weaponBars : "")
      + (dayBars ? `<h4 class="aim-an-sub">On the ${word} by day</h4>` + dayBars : "")
      + `<p class="aim-an-note">${T.fights} fights, ${fix(T.seconds)} s of moving enemies, from your newest ${RAW_ROUNDS} stored rounds. Only moments when the enemy crossed your view count (it turns faster than 4° per second). Time to lock = from the enemy coming into view until your crosshair stays on it for 0.15 s. Numbers in brackets are fights.</p>`;
  }
  function progressHtml(days, engagements, range, now, rounds, focus) {
    const tabs = `<div class="aim-an-filters" role="group" aria-label="Range">` + RANGES.map((r) => `<button type="button" data-range="${r}" aria-pressed="${r === range}">${r} days</button>`).join("") + `</div>`;
    rounds = Array.isArray(rounds) ? rounds : [];
    if (!days.length && !engagements.length && !rounds.length) return tabs + `<p class="aim-an-msg">No days recorded yet. Your accuracy, headshot rate and other trends show up here after you play.</p>`;
    const dayCount = daysWithData(days, engagements, range, now);
    const b = dayCount <= FEW_DAYS ? progressBuckets(rounds, range, now, dayCount) : null;
    const series = b ? b.series : progressSeries(days, engagements, range, now);
    const unit = b ? b.unit : "day";
    if (METRICS.every((m) => !series[m.id].length)) return tabs + `<p class="aim-an-msg">Nothing recorded in the last ${range} days.</p>`;
    const note = b
      ? `Only ${plural(dayCount, "day")} with data in the last ${range} days, so each point is ${unit === "round" ? "one round" : "one session (rounds less than 30 minutes apart)"}, `
        + `from the newest ${RAW_ROUNDS} stored rounds. Day-by-day points come back once more than ${FEW_DAYS} days have data. Arrows compare the first and the latest ${unit}.`
      : `Arrows compare the first and the latest day with data in the range. Near misses are a count per day, so they also rise with the number of shots. Kill times come from the newest ${RAW_ROUNDS} stored rounds (the last 30 days), counted from the moment you first saw the enemy, and only from rounds recorded with line-of-sight data (earlier rounds counted enemies behind walls).`;
    return tabs + (b ? `<p class="aim-an-note" data-unit="${unit}">Showing one point per ${unit}: ${plural(b.count, unit)}.</p>` : "")
      + `<div class="aim-an-charts">${progressCharts(series, range, now, unit, focus)}</div><p class="aim-an-note">${note}</p>`;
  }
  function progressCharts(series, range, now, unit, focus) {
    const big = METRICS.find((m) => m.id === focus) || METRICS[0];
    return `<div class="aim-an-focus" data-focused="${big.id}">${chartHtml(big, series[big.id], range, now, unit)}</div>`
      + `<div class="aim-an-thumbs" role="group" aria-label="Charts">${METRICS.map((m) => chartHtml(m, series[m.id], range, now, unit, true, m === big)).join("")}</div>`;
  }

  // ---------------------------------------------------------------- sessions, comparison, drills, export (20 Nov 2026)
  // Pure functions first (tested through __aimAnalyticsUi.render), then the HTML of the Session, Drills and Compare tabs.
  // Every number comes from what the recorder already stores: nothing here writes anything. Timing numbers (kill time, tracking) use
  // only rounds with line-of-sight data (round.sight), like the Progress and Tracking tabs. Each comparison has a minimum sample
  // and says "not enough data" instead of a number that would only be noise.
  const arr = (v) => (Array.isArray(v) ? v : []);
  const MIN_SESSION_SHOTS = 30, MIN_BASE_SHOTS = 60;  // shots in a session / in the sessions before it, before accuracy is compared
  const BASE_SESSIONS = 5;                            // earlier sessions that make up "your usual"
  const MIN_SESSION_ROUNDS_BASE = 2;                  // rounds in the earlier sessions together
  const BURST_GAP_S = 0.4, TAP_MAX = 2, SPRAY_MIN = 5; // shots closer than 0.4 s with the same weapon are one burst; a tap is 1 or 2 shots, a spray 5 or more
  const DAY_MS = 86400000;

  // How long a round lasted, in seconds: the last thing recorded in it (the rounds do not store their length).
  function roundSeconds(r) {
    const dt = num(r && r.tickSeconds) && r.tickSeconds > 0 ? r.tickSeconds : 1 / 128;
    let m = 0;
    for (const s of arr(r && r.shots)) if (s && num(s.tick)) m = Math.max(m, s.tick);
    for (const d of arr(r && r.deaths)) if (d && num(d.tick)) m = Math.max(m, d.tick);
    for (const e of arr(r && r.engagements)) if (e) m = Math.max(m, num(e.killTick) ? e.killTick : 0, num(e.startTick) ? e.startTick : 0);
    return Math.min(3600, Math.round(m * dt * 10) / 10);
  }
  // One round as plain facts: counts, the line-of-sight kill times and the tracking ticks (the last two only from rounds with sight data).
  function roundFacts(r) {
    const c = roundCounts(r || {});
    let trackOn = 0, trackN = 0;
    if (r && r.sight === true) for (const e of arr(r.engagements)) { const t = e && e.tracking; if (t && num(t.samples) && t.samples >= TRACK_MIN_TICKS) { trackOn += t.bodyOn || 0; trackN += t.samples; } }
    return { id: r && r.id != null ? r.id : null, at: r && num(r.at) ? r.at : null, code: r && r.code != null ? r.code : null, map: r && r.map != null ? r.map : null, mode: r && r.mode != null ? r.mode : null,
      end: r && r.end != null ? r.end : null, seconds: roundSeconds(r), shots: c.shots, hits: c.hits, headshots: c.headshots, kills: c.kills, deaths: c.deaths, nearMisses: c.nearMisses,
      ttk: c.ttk, trackOn, trackN, sight: !!(r && r.sight === true) };
  }
  // Rounds that ran together: a round that starts less than `gap` ms after the previous one ended is in the same session. Facts in, sessions out (oldest first).
  function groupSessions(facts, gap = SESSION_GAP_MS) {
    const out = [];
    for (const f of arr(facts).filter((x) => x && num(x.at)).sort((a, b) => a.at - b.at)) {
      const g = out[out.length - 1], end = f.at + (f.seconds || 0) * 1000;
      if (g && f.at - g.endAt < gap) { g.rounds.push(f); g.endAt = Math.max(g.endAt, end); }
      else out.push({ start: f.at, endAt: end, rounds: [f] });
    }
    return out;
  }
  function totalsOf(facts) {
    const t = { rounds: 0, seconds: 0, shots: 0, hits: 0, headshots: 0, kills: 0, deaths: 0, nearMisses: 0, ttk: [], trackOn: 0, trackN: 0, cleared: 0, died: 0 };
    for (const f of arr(facts)) {
      if (!f) continue;
      t.rounds++; t.seconds += f.seconds || 0; t.shots += f.shots || 0; t.hits += f.hits || 0; t.headshots += f.headshots || 0; t.kills += f.kills || 0; t.deaths += f.deaths || 0; t.nearMisses += f.nearMisses || 0;
      for (const v of arr(f.ttk)) if (num(v)) t.ttk.push(v);
      t.trackOn += f.trackOn || 0; t.trackN += f.trackN || 0;
      if (f.end === "cleared") t.cleared++; else if (f.end === "died") t.died++;
    }
    return t;
  }
  // The metrics a session or a period is compared on. value(t) is only read when n(t) >= min (the sample guard); eps = a change smaller than this counts as "about the same".
  const COMPARE_METRICS = [
    { id: "accuracy", label: "Accuracy", unit: "%", dec: 1, better: 1, eps: 2, min: MIN_SESSION_SHOTS, noun: "shots", n: (t) => t.shots, value: (t) => (t.shots ? (t.hits / t.shots) * 100 : null) },
    { id: "headshots", label: "Headshot rate", unit: "%", dec: 1, better: 1, eps: 3, min: 20, noun: "hits", n: (t) => t.hits, value: (t) => (t.hits ? (t.headshots / t.hits) * 100 : null) },
    { id: "killTime", label: "Kill time", unit: " s", dec: 2, better: -1, eps: 0.08, min: 5, noun: "kills with sight data", n: (t) => t.ttk.length, value: (t) => (t.ttk.length ? medianOf(t.ttk) : null) },
    { id: "tracking", label: "Tracking (on body)", unit: "%", dec: 1, better: 1, eps: 3, min: 64, noun: "tracked ticks", n: (t) => t.trackN, value: (t) => (t.trackN ? (t.trackOn / t.trackN) * 100 : null) },
    { id: "deaths", label: "Deaths per round", unit: "", dec: 2, better: -1, eps: 0.15, min: 3, noun: "rounds", n: (t) => t.rounds, value: (t) => (t.rounds ? t.deaths / t.rounds : null) },
  ];
  const fmtCmp = (m, v) => (v === null || v === undefined || !num(v) ? "–" : v.toFixed(m.dec) + (m.unit === "%" ? "%" : m.unit === " s" ? " s" : ""));
  // One metric, the current totals against the earlier ones: { cur, prev (null when the sample is too small), delta, verdict: "better" | "worse" | "same" | "unknown", nCur, nPrev }.
  function compareMetric(m, cur, prev) {
    const a = cur && m.n(cur) >= m.min ? m.value(cur) : null, b = prev && m.n(prev) >= m.min ? m.value(prev) : null;
    const row = { id: m.id, label: m.label, unit: m.unit, dec: m.dec, better: m.better, cur: num(a) ? a : null, prev: num(b) ? b : null, delta: null, verdict: "unknown", nCur: cur ? m.n(cur) : 0, nPrev: prev ? m.n(prev) : 0, min: m.min, noun: m.noun };
    if (row.cur !== null && row.prev !== null) { row.delta = row.cur - row.prev; row.verdict = Math.abs(row.delta) < m.eps ? "same" : row.delta * m.better > 0 ? "better" : "worse"; }
    return row;
  }
  const compareRows = (cur, prev) => COMPARE_METRICS.map((m) => compareMetric(m, cur, prev));
  // Session s of sessions against the (up to BASE_SESSIONS) before it put together. { cur, base, rows, improved, slipped, hasBase }
  function sessionVersus(sessions, index) {
    const cur = totalsOf(sessions[index] ? sessions[index].rounds : []);
    const before = sessions.slice(Math.max(0, index - BASE_SESSIONS), index), base = totalsOf(before.flatMap((s) => s.rounds));
    const hasBase = before.length > 0 && base.rounds >= MIN_SESSION_ROUNDS_BASE && base.shots >= MIN_BASE_SHOTS;
    const rows = hasBase ? compareRows(cur, base) : COMPARE_METRICS.map((m) => compareMetric(m, cur, null));
    const rel = (r) => Math.abs(r.delta) / Math.max(1e-9, Math.abs(r.prev));
    return { cur, base, before: before.length, hasBase, rows, improved: rows.filter((r) => r.verdict === "better").sort((a, b) => rel(b) - rel(a)), slipped: rows.filter((r) => r.verdict === "worse").sort((a, b) => rel(b) - rel(a)) };
  }
  // "Accuracy rose to 48% (was 41%)" for a row with both numbers.
  function changeText(r) {
    if (r.cur === null || r.prev === null) return r.label + ": " + fmtCmp(r, r.cur);
    const verb = r.delta > 0 ? "rose to" : "fell to";
    return `${r.label} ${verb} ${fmtCmp(r, r.cur)} (was ${fmtCmp(r, r.prev)})`;
  }
  // Which rounds of the session were which: the strip's cells, oldest first. A cell's height is the round's accuracy.
  function timelineOf(session) {
    return arr(session && session.rounds).map((f) => ({ at: f.at, code: f.code, end: f.end || "other", seconds: f.seconds, shots: f.shots, accuracy: f.shots > 0 ? (f.hits / f.shots) * 100 : null, kills: f.kills, deaths: f.deaths }));
  }
  const END_CLASS = { cleared: "is-cleared", time: "is-time", died: "is-died" };
  const END_WORD = { cleared: "Cleared", time: "Time up", died: "Died", restart: "Restarted", quit: "Quit" };
  const MEDAL_RANK = { bronze: 1, silver: 2, gold: 3 };
  // The drills of a session: { code, name, rounds, shots, hits, accuracy, bestMedal, bestScore, unit }, most played first. runsState = routines.runs() ({ code: entry }), nameOf(code).
  function sessionDrills(session, runsState, nameOf) {
    const by = new Map();
    for (const f of arr(session && session.rounds)) {
      const k = f.code == null ? "?" : String(f.code);
      if (!by.has(k)) by.set(k, { code: k, rounds: 0, shots: 0, hits: 0 });
      const d = by.get(k); d.rounds++; d.shots += f.shots || 0; d.hits += f.hits || 0;
    }
    const lo = session ? session.start - 5000 : 0, hi = session ? session.endAt + 15000 : 0;
    return [...by.values()].map((d) => {
      const entry = runsState && runsState[d.code], lower = !!(entry && entry.lower);
      let bestMedal = null, bestScore = null;
      for (const r of arr(entry && entry.runs)) {
        if (!r || !num(r.at) || r.at < lo || r.at > hi || r.died || !num(r.score)) continue;
        if (r.medal && (!bestMedal || MEDAL_RANK[r.medal] > MEDAL_RANK[bestMedal])) bestMedal = r.medal;
        if (bestScore === null || (lower ? r.score < bestScore : r.score > bestScore)) bestScore = r.score;
      }
      return { ...d, name: typeof nameOf === "function" ? nameOf(d.code) : d.code, accuracy: d.shots > 0 ? (d.hits / d.shots) * 100 : null, bestMedal, bestScore, unit: entry ? entry.unit || "" : "" };
    }).sort((a, b) => b.rounds - a.rounds || (a.name < b.name ? -1 : 1));
  }
  // Each drill of the session against the last time it was played before this session (21 Nov 2026): the nearest earlier session that had it, looking back
  // DELTA_LOOKBACK sessions. acc = accuracy change in points (needs DELTA_MIN_SHOTS shots in both), score = change of the best finished score (needs a scored run in both).
  // { ...sessionDrills row, prev: { start, rounds, accuracy, bestScore } | null, acc: { delta, verdict } | null, score: { delta, verdict } | null }; verdict "better" | "worse" | "same".
  const DELTA_LOOKBACK = 12, DELTA_MIN_SHOTS = 15, DELTA_ACC_EPS = 2, DELTA_SCORE_EPS = 0.02;
  function sessionDrillChanges(sessions, index, runsState, nameOf) {
    const now = sessionDrills(sessions[index], runsState, nameOf), want = new Set(now.map((d) => d.code)), prev = new Map();
    for (let i = index - 1; i >= Math.max(0, index - DELTA_LOOKBACK) && prev.size < want.size; i--) {
      for (const d of sessionDrills(sessions[i], runsState, nameOf)) if (want.has(d.code) && !prev.has(d.code)) prev.set(d.code, { start: sessions[i].start, rounds: d.rounds, shots: d.shots, accuracy: d.accuracy, bestScore: d.bestScore });
    }
    return now.map((d) => {
      const p = prev.get(d.code) || null, lower = !!(runsState && runsState[d.code] && runsState[d.code].lower);
      let acc = null, score = null;
      if (p && d.accuracy !== null && p.accuracy !== null && d.shots >= DELTA_MIN_SHOTS && p.shots >= DELTA_MIN_SHOTS) {
        const delta = d.accuracy - p.accuracy;
        acc = { delta, verdict: Math.abs(delta) < DELTA_ACC_EPS ? "same" : delta > 0 ? "better" : "worse" };
      }
      if (p && num(d.bestScore) && num(p.bestScore)) {
        const delta = d.bestScore - p.bestScore;
        score = { delta, verdict: Math.abs(delta) < Math.abs(p.bestScore) * DELTA_SCORE_EPS ? "same" : (lower ? -delta : delta) > 0 ? "better" : "worse" };
      }
      return { ...d, prev: p, acc, score };
    });
  }
  const signed = (v, dec = 0) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(dec).replace(/\.0+$/, "");
  // The "against last time" cell of a drill row.
  function changeCellHtml(d) {
    if (!d.prev) return `<span class="aim-an-sd-change is-new">First time in this list</span>`;
    const bit = (c, text) => `<b class="${c.verdict === "better" ? "is-up" : c.verdict === "worse" ? "is-down" : "is-same"}">${esc(text)}</b>`;
    const parts = [];
    if (d.acc) parts.push(bit(d.acc, d.acc.verdict === "same" ? "same accuracy" : signed(d.acc.delta, 1) + " pts accuracy"));
    if (d.score) parts.push(bit(d.score, d.score.verdict === "same" ? "same best score" : signed(d.score.delta, 2) + (d.unit === "%" ? " pts" : d.unit ? " " + d.unit : "") + " best score"));
    return `<span class="aim-an-sd-change" title="Against ${esc(shortDate(d.prev.start))}, the last session that had this drill">${parts.length ? parts.join(" · ") : "not enough shots to compare"}<small> vs ${esc(shortDate(d.prev.start))}</small></span>`;
  }
  // "Today 14:05", "Yesterday 21:30", "17 Nov 21:30".
  function sessionLabel(s, now = Date.now()) {
    const d = dayOf(s.start);
    return (d === dayOf(now) ? "Today" : d === daysAgo(1, now) ? "Yesterday" : shortDate(s.start)) + " " + hhmm(s.start);
  }
  const playTime = (sec) => { const m = Math.round(sec / 60); return sec < 60 ? Math.round(sec) + " s" : m < 60 ? m + " min" : Math.floor(m / 60) + " h " + pad(m % 60) + " min"; };

  // ---- the Session tab ----
  function tileHtml(label, value, hint) { return `<div class="aim-an-track-tile"><span>${esc(label)}</span><b>${esc(value)}</b><em>${esc(hint || "")}</em></div>`; }
  function timelineHtml(cells) {
    if (!cells.length) return "";
    const bars = cells.map((c, i) => {
      const h = c.accuracy === null ? 8 : Math.max(8, Math.round(c.accuracy));
      const tip = `Round ${i + 1}: ${END_WORD[c.end] || c.end}\n${hhmm(c.at)}${num(c.seconds) && c.seconds > 0 ? ", " + Math.round(c.seconds) + " s" : ""}\n${c.accuracy === null ? "No shots fired" : Math.round(c.accuracy) + "% accuracy, " + plural(c.shots, "shot")} · ${plural(c.kills, "kill")}, ${plural(c.deaths, "death")}`;
      return `<span class="aim-an-tl ${END_CLASS[c.end] || "is-other"}" style="height:${h}%" data-tip="${esc(tip)}" data-round="${i}" aria-label="${esc(tip.replace(/\n/g, ", "))}"></span>`;
    }).join("");
    return `<div class="aim-an-tl-wrap"><div class="aim-an-timeline" data-timeline tabindex="0" data-tipnav role="group" aria-label="${plural(cells.length, "round")} this session, coloured by result, as tall as the round's accuracy; arrow keys step through them">${bars}</div>`
      + `<ul class="aim-an-hit-key aim-an-tl-key"><li><i class="is-cleared"></i>Cleared</li><li><i class="is-time"></i>Time up</li><li><i class="is-died"></i>Died</li><li><i class="is-other"></i>Other</li><li class="aim-an-tl-note">Bar height = accuracy</li></ul></div>`;
  }
  const verdictList = (title, rows, cls, empty = "Nothing here.") => `<div class="aim-an-vs ${cls}"><h4>${title}</h4>${rows.length ? `<ul>${rows.map((r) => `<li data-metric="${r.id}">${esc(changeText(r))}</li>`).join("")}</ul>` : `<p>${empty}</p>`}</div>`;
  function sessionHtml(data, index, now, runsState, nameOf) {
    const sessions = groupSessions(arr(data && data.rounds).map(roundFacts));
    if (!sessions.length) return `<p class="aim-an-msg">No rounds recorded yet. Play a drill and your session shows up here: what you played, how it went, and how it compares with your earlier sessions. Rounds are kept for 30 days.</p>`;
    const idx = Number.isInteger(index) && index >= 0 && index < sessions.length ? index : sessions.length - 1, s = sessions[idx];
    const pick = sessions.slice(-8).map((x) => [sessions.indexOf(x), sessionLabel(x, now)]);
    const chips = `<div class="aim-an-filters" role="group" aria-label="Session">` + pick.map(([i, label]) => `<button type="button" data-session="${i}" aria-pressed="${i === idx}">${esc(label)}</button>`).join("") + `</div>`;
    const v = sessionVersus(sessions, idx), t = v.cur;
    const acc = t.shots ? Math.round((t.hits / t.shots) * 100) + "%" : "–", hs = t.hits ? Math.round((t.headshots / t.hits) * 100) + "%" : "–";
    const drills = sessionDrills(s, runsState, nameOf);
    const tiles = `<div class="aim-an-track-tiles" data-session-tiles>` + tileHtml("Rounds", String(t.rounds), `${t.cleared} cleared, ${t.died} died`) + tileHtml("Play time", playTime(t.seconds), "time spent in rounds")
      + tileHtml("Accuracy", acc, plural(t.shots, "shot")) + tileHtml("Headshots", hs, "of your hits") + tileHtml("Kills", String(t.kills), `${plural(t.deaths, "death")}`) + tileHtml("Drills", String(drills.length), "different drills") + `</div>`;
    const medals = drills.filter((d) => d.bestMedal);
    const medalLine = medals.length ? `<p class="aim-an-sess-medals" data-session-medals>Best medals: ` + medals.sort((a, b) => MEDAL_RANK[b.bestMedal] - MEDAL_RANK[a.bestMedal]).slice(0, 4).map((d) => `<span class="aim-an-medal is-${d.bestMedal}">${medalSvg(d.bestMedal)}${esc(d.name)}</span>`).join("") + `</p>` : "";
    let versus;
    if (!v.hasBase) versus = `<p class="aim-an-msg" data-versus-empty>${idx === 0 ? "This is your first session, so there is nothing to compare with yet." : "Not enough earlier play to compare with yet."} Come back after another session: from then on this shows what got better and what slipped against your last ${BASE_SESSIONS} sessions (it needs ${MIN_SESSION_ROUNDS_BASE} earlier rounds and ${MIN_BASE_SHOTS} shots).</p>`;
    else {
      const none = !v.improved.length && !v.slipped.length;
      versus = `<div class="aim-an-versus" data-versus>${verdictList("What improved", v.improved, "is-up", "No clear gain this session.")}${verdictList("What slipped", v.slipped, "is-down", "Nothing slipped.")}</div>`
        + (none ? `<p class="aim-an-note">Everything is within a normal range of your last ${plural(v.before, "session")}.</p>` : `<p class="aim-an-note">Against your last ${plural(v.before, "session")} put together. Small changes are ignored, and a number needs enough shots, kills or ticks behind it.</p>`);
    }
    const rows = sessionDrillChanges(sessions, idx, runsState, nameOf).map((d) => `<li><span class="aim-an-sd-name">${esc(d.name)}</span><span>${plural(d.rounds, "round")}</span><span>${d.accuracy === null ? "–" : Math.round(d.accuracy) + "%"}</span>`
      + `<span class="aim-an-sd-score">${d.bestScore === null ? "" : esc(fmtScore(d.bestScore, d.unit))}</span><span>${d.bestMedal ? `<span class="aim-an-medal is-${d.bestMedal}">${medalSvg(d.bestMedal)}${MEDAL_WORD[d.bestMedal]}</span>` : ""}</span>${changeCellHtml(d)}</li>`).join("");
    return chips + tiles + medalLine + `<h4 class="aim-an-sub">Rounds</h4>` + timelineHtml(timelineOf(s)) + `<h4 class="aim-an-sub">Against your earlier sessions</h4>` + versus
      + `<h4 class="aim-an-sub">Drills this session, against the last time you played each</h4><ul class="aim-an-sess-drills aim-an-sd-six" data-session-drills>${rows}</ul>`
      + `<p class="aim-an-note">Accuracy needs ${DELTA_MIN_SHOTS} shots in both sessions; ${DELTA_ACC_EPS} points or less (and a best score within ${Math.round(DELTA_SCORE_EPS * 100)}%) counts as the same. Best score is your best finished run of that session, a run that ended in your death is not counted.</p>`;
  }
  const MEDAL_WORD = { bronze: "Bronze", silver: "Silver", gold: "Gold" };
  const medalSvg = (tier) => { try { const R = window.__aimRoutines; return R && R.ui && typeof R.ui.medalIcon === "function" ? R.ui.medalIcon(tier) || "" : ""; } catch { return ""; } };

  // ---- the Compare tab: this period against the one before it ----
  const COMPARE_RANGES = [7, 14, 30];
  // Day rows (all days are kept for good) as totals.
  function totalsFromDays(days, fromDay, toDay) {
    const t = { rounds: 0, seconds: 0, shots: 0, hits: 0, headshots: 0, kills: 0, deaths: 0, nearMisses: 0, ttk: [], trackOn: 0, trackN: 0, cleared: 0, died: 0 };
    for (const d of arr(days)) {
      if (!d || typeof d.day !== "string" || d.day < fromDay || d.day > toDay) continue;
      t.rounds += d.rounds || 0; t.shots += d.shots || 0; t.hits += d.hits || 0; t.headshots += d.headshots || 0; t.kills += d.kills || 0; t.deaths += d.deaths || 0;
    }
    return t;
  }
  // The last `range` days against the `range` days before: accuracy, headshot rate and deaths from the day rows (they reach back for good); kill time and tracking
  // from the stored rounds with sight data, which only reach back 30 days (and RAW_ROUNDS rounds), so the earlier period's timing is left out when it would not be whole.
  // { range, cur, prev, rows, timingPrev: whether the earlier period's timing is complete }
  // The day rows with the stored rounds laid over them: a day whose row is missing, or counts fewer rounds than are stored for that day (the recorder
  // sums a day after the write, so a failed or late roll-up leaves a gap), is taken from the rounds themselves. A day row never goes down here.
  function mergeRawDays(days, facts) {
    const by = new Map();
    for (const f of arr(facts)) {
      if (!num(f.at)) continue;
      const k = dayOf(f.at), d = by.get(k) || { day: k, rounds: 0, shots: 0, hits: 0, headshots: 0, kills: 0, deaths: 0 };
      d.rounds++; d.shots += f.shots || 0; d.hits += f.hits || 0; d.headshots += f.headshots || 0; d.kills += f.kills || 0; d.deaths += f.deaths || 0;
      by.set(k, d);
    }
    const out = arr(days).filter((d) => d && typeof d.day === "string");
    const at = new Map(out.map((d, i) => [d.day, i]));
    for (const [k, d] of by) {
      if (!at.has(k)) out.push(d);
      else if ((out[at.get(k)].rounds || 0) < d.rounds) out[at.get(k)] = { ...out[at.get(k)], ...d };
    }
    return out;
  }
  function periodCompare(days, rounds, range, now = Date.now()) {
    const curFrom = daysAgo(range - 1, now), prevFrom = daysAgo(2 * range - 1, now), prevTo = daysAgo(range, now), today = dayOf(now);
    const facts = arr(rounds).map(roundFacts).filter((f) => num(f.at));
    days = mergeRawDays(days, facts);
    const cur = totalsFromDays(days, curFrom, today), prev = totalsFromDays(days, prevFrom, prevTo);
    const oldest = facts.length ? Math.min(...facts.map((f) => f.at)) : Infinity;
    const timingPrev = 2 * range <= 30 && (facts.length < RAW_ROUNDS || dayOf(oldest) <= prevFrom);
    const part = (from, to) => totalsOf(facts.filter((f) => { const d = dayOf(f.at); return d >= from && d <= to; }));
    const tc = part(curFrom, today), tp = timingPrev ? part(prevFrom, prevTo) : null;
    cur.ttk = tc.ttk; cur.trackOn = tc.trackOn; cur.trackN = tc.trackN;
    if (tp) { prev.ttk = tp.ttk; prev.trackOn = tp.trackOn; prev.trackN = tp.trackN; } else { prev.ttk = []; prev.trackOn = 0; prev.trackN = 0; }
    return { range, cur, prev, rows: compareRows(cur, prev), timingPrev };
  }
  function compareCardHtml(r, range) {
    const bar = (v, cls) => `<i class="${cls}"><b style="width:${r.cur !== null && r.prev !== null && Math.max(r.cur, r.prev) > 0 && v !== null ? Math.max(4, Math.round((v / Math.max(r.cur, r.prev)) * 100)) : 0}%"></b></i>`;
    const both = r.cur !== null && r.prev !== null;
    // an arrow only for a change that counts (the same threshold as the verdict): a small one is "about the same", so it points sideways
    const arrow = r.verdict === "unknown" ? "" : r.verdict === "same" ? "→" : r.delta > 0 ? "↑" : "↓";
    const verdict = { better: "is-up", worse: "is-down", same: "", unknown: "" }[r.verdict];
    const why = r.cur === null ? `Not enough ${r.noun} in the last ${range} days (needs ${r.min}).` : r.prev === null ? `Not enough ${r.noun} in the ${range} days before.` : "";
    const shown = r.delta === null ? 0 : +Math.abs(r.delta).toFixed(r.dec);
    const delta = r.delta === null ? "" : shown === 0 ? "no change" : (r.delta > 0 ? "+" : "−") + shown.toFixed(r.dec) + (r.unit === "%" ? " pts" : r.unit === " s" ? " s" : "");
    return `<div class="aim-an-cmp ${verdict}" data-metric="${r.id}" data-verdict="${r.verdict}"><span class="aim-an-cmp-label">${esc(r.label)}</span>`
      + `<b>${esc(fmtCmp(r, r.cur))} <em class="aim-an-arrow">${arrow}</em></b><span class="aim-an-cmp-delta">${esc(delta)}</span>`
      + (both ? `<div class="aim-an-cmp-bars" aria-hidden="true">${bar(r.cur, "is-now")}${bar(r.prev, "is-before")}</div>` : "")
      + `<small>${r.prev === null ? esc(why) : `was ${esc(fmtCmp(r, r.prev))} · ${esc(String(r.nCur))} now, ${esc(String(r.nPrev))} before`}</small></div>`;
  }
  function compareHtml(days, rounds, range, now) {
    range = COMPARE_RANGES.includes(range) ? range : 7;
    const tabs = `<div class="aim-an-filters" role="group" aria-label="Period">` + COMPARE_RANGES.map((r) => `<button type="button" data-cmp-range="${r}" aria-pressed="${r === range}">Last ${r} days</button>`).join("") + `</div>`;
    const c = periodCompare(days, rounds, range, now);
    if (!c.cur.rounds && !c.prev.rounds) return tabs + `<p class="aim-an-msg">Nothing recorded in the last ${2 * range} days. Play a few rounds and this view sets the last ${range} days against the ${range} before.</p>`;
    const imp = c.rows.filter((r) => r.verdict === "better").length, slip = c.rows.filter((r) => r.verdict === "worse").length;
    const head = !c.prev.rounds
      ? `<p class="aim-an-msg" data-cmp-sum>Last ${range} days: ${plural(c.cur.rounds, "round")}, ${plural(c.cur.shots, "shot")}. Nothing was recorded in the ${range} days before, so there is nothing to set them against yet. Keep playing: ${range === 7 ? "next week" : "in " + range + " days"} this shows what got better and what slipped.</p>`
      : !c.cur.rounds
        ? `<p class="aim-an-msg" data-cmp-sum>Nothing recorded in the last ${range} days (${plural(c.prev.rounds, "round")} in the ${range} days before). Play a few rounds to see how you compare with then.</p>`
        : `<p class="aim-an-note" data-cmp-sum>Last ${range} days: ${plural(c.cur.rounds, "round")}, ${plural(c.cur.shots, "shot")}. The ${range} days before: ${plural(c.prev.rounds, "round")}, ${plural(c.prev.shots, "shot")}. ${imp} better, ${slip} worse.</p>`;
    return tabs + head + `<div class="aim-an-cmp-grid" data-cmp-grid>${c.rows.map((r) => compareCardHtml(r, range)).join("")}</div>`
      + `<p class="aim-an-note">Accuracy, headshot rate and deaths come from your daily totals. Kill time and tracking only count rounds recorded with line-of-sight data and need enough kills or ticks in both periods.${c.timingPrev ? "" : " Rounds older than 30 days are kept only as daily totals, so the earlier period has no kill time or tracking here: pick 7 or 14 days to see them."}</p>`;
  }

  // ---- the Drills tab ----
  const DRILL_RECENT = 5;      // the newest runs the trend is taken from, against the DRILL_RECENT before them
  const DRILL_TREND_MIN = 6;   // good runs needed for a trend
  const DRILL_SPREAD_MIN = 5, DRILL_SPREAD_N = 10, STEADY_PCT = 6, SWINGY_PCT = 15;
  const SPARK_RUNS = 20;
  const meanOf = (l) => l.reduce((a, b) => a + b, 0) / l.length;
  // Everything one drill's tab row and detail need. entry = a routines.runs() entry, logic = routines.logic (thresholds, nextMedal; may be missing), plays = the drill's round facts.
  function drillModel(code, entry, logic, plays, name) {
    entry = entry || null;
    const runs = arr(entry && entry.runs).filter((r) => r && num(r.score) && num(r.at)), lower = !!(entry && entry.lower);
    const good = runs.filter((r) => !r.died), scores = good.map((r) => r.score);
    const g = (v) => (lower ? -v : v);
    const last = scores.length ? scores[scores.length - 1] : null;
    const best = entry && num(entry.best) ? entry.best : scores.length ? (lower ? Math.min(...scores) : Math.max(...scores)) : null;
    // trend: the newest DRILL_RECENT good runs against the DRILL_RECENT before them (a score where less is better counts the other way)
    let trend = null;
    if (scores.length >= DRILL_TREND_MIN) {
      const k = Math.min(DRILL_RECENT, Math.floor(scores.length / 2)), a = meanOf(scores.slice(-k)), b = meanOf(scores.slice(-2 * k, -k));
      const pct = b !== 0 ? ((a - b) / Math.abs(b)) * 100 : 0, goodPct = lower ? -pct : pct;
      trend = { pct, direction: Math.abs(goodPct) < 2 ? "flat" : goodPct > 0 ? "up" : "down", goodPct, from: b, to: a, runs: k };
    }
    // consistency: the spread of the newest scores as a share of their mean
    let spread = null;
    const win = scores.slice(-DRILL_SPREAD_N);
    if (win.length >= DRILL_SPREAD_MIN) {
      const m = meanOf(win), sd = Math.sqrt(win.reduce((s, v) => s + (v - m) * (v - m), 0) / (win.length - 1));
      spread = { pct: m !== 0 ? (sd / Math.abs(m)) * 100 : 0, runs: win.length };
      spread.label = spread.pct <= STEADY_PCT ? "steady" : spread.pct >= SWINGY_PCT ? "swingy" : "normal";
    }
    // medals: the three scores, the next one and how far the last run is along the way to it
    let th = null, next = null, progress = null;
    try { th = logic && typeof logic.thresholds === "function" ? logic.thresholds(entry) : null; } catch { th = null; }
    if (th && last !== null) {
      try { next = typeof logic.nextMedal === "function" ? logic.nextMedal(last, th, lower) : null; } catch { next = null; }
      if (next) {
        const have = typeof logic.medalFor === "function" ? logic.medalFor(last, th, lower) : null;
        const floor = have ? th[have] : scores.length ? (lower ? Math.max(...scores.slice(-20)) : Math.min(...scores.slice(-20))) : last;
        const span = g(next.score) - g(floor);
        progress = span > 0 ? clampNum((g(last) - g(floor)) / span, 0, 1) : 0;
      }
    }
    const shots = arr(plays).reduce((s, f) => s + (f.shots || 0), 0), hits = arr(plays).reduce((s, f) => s + (f.hits || 0), 0), heads = arr(plays).reduce((s, f) => s + (f.headshots || 0), 0);
    return { code, name: name || (entry && entry.name) || String(code).slice(0, 7), unit: entry ? entry.unit || "" : "", lower, runs: runs.length, goodRuns: scores.length, died: runs.length - scores.length,
      last, best, bestMedal: entry && entry.bestMedal ? entry.bestMedal : null, medals: entry && entry.medals ? entry.medals : { bronze: 0, silver: 0, gold: 0 }, lastAt: runs.length ? runs[runs.length - 1].at : (arr(plays).length ? Math.max(...plays.map((f) => f.at || 0)) : 0),
      spark: scores.slice(-SPARK_RUNS), trend, spread, thresholds: th, next, progress,
      rounds: arr(plays).length, accuracy: shots ? (hits / shots) * 100 : null, headshotPct: hits ? (heads / hits) * 100 : null, kills: arr(plays).reduce((s, f) => s + (f.kills || 0), 0), deaths: arr(plays).reduce((s, f) => s + (f.deaths || 0), 0),
      tracked: arr(plays).some((f) => f.trackN > 0), goals: [] };
  }
  // Every drill with a medal history or a recorded round, as models.
  function drillModels(runsState, logic, facts, nameOf) {
    const by = new Map();
    for (const f of arr(facts)) { if (f.code == null) continue; const k = String(f.code); if (!by.has(k)) by.set(k, []); by.get(k).push(f); }
    const codes = new Set([...Object.keys(runsState || {}), ...by.keys()]);
    return [...codes].filter((c) => /^[a-z0-9-]{1,64}$/i.test(c)).map((c) => drillModel(c, (runsState || {})[c], logic, by.get(c) || [], typeof nameOf === "function" ? nameOf(c) : ""));
  }
  const DRILL_SORTS = [["recent", "Recent"], ["runs", "Most played"], ["medal", "Medal"], ["trend", "Trend"], ["steady", "Steadiest"], ["name", "A to Z"]];
  const nullLast = (a, b, cmp) => (a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : cmp(a, b));
  function sortDrills(models, key) {
    const byName = (a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0);
    const cmp = {
      recent: (a, b) => b.lastAt - a.lastAt || byName(a, b),
      runs: (a, b) => (b.runs + b.rounds) - (a.runs + a.rounds) || byName(a, b),
      medal: (a, b) => (MEDAL_RANK[b.bestMedal] || 0) - (MEDAL_RANK[a.bestMedal] || 0) || (b.medals.gold + b.medals.silver + b.medals.bronze) - (a.medals.gold + a.medals.silver + a.medals.bronze) || byName(a, b),
      trend: (a, b) => nullLast(a.trend ? a.trend.goodPct : null, b.trend ? b.trend.goodPct : null, (x, y) => y - x) || byName(a, b),
      steady: (a, b) => nullLast(a.spread ? a.spread.pct : null, b.spread ? b.spread.pct : null, (x, y) => x - y) || byName(a, b),
      name: byName,
    }[key] || ((a, b) => b.lastAt - a.lastAt);
    return [...models].sort(cmp);
  }
  const fmtScore = (v, unit) => (v === null || v === undefined || !num(v) ? "–" : String(+v.toFixed(2)) + (unit ? (unit === "%" ? "%" : " " + unit) : ""));
  // A tiny line chart of the scores, drawn left to right; "" with fewer than two points.
  function sparkSvg(values, w = 96, h = 24, cls = "aim-an-spark") {
    const v = arr(values).filter(num);
    if (v.length < 2) return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
    const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1, P = 2;
    const pts = v.map((x, i) => `${(P + (i / (v.length - 1)) * (w - 2 * P)).toFixed(1)},${(h - P - ((x - lo) / span) * (h - 2 * P)).toFixed(1)}`);
    const [lx, ly] = pts[pts.length - 1].split(",");
    return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline class="aim-an-line" points="${pts.join(" ")}"/><circle class="aim-an-pt" cx="${lx}" cy="${ly}" r="2.2"/></svg>`;
  }
  const trendText = (m) => (m.trend ? (m.trend.direction === "flat" ? "→ flat" : (m.trend.direction === "up" ? "↑ " : "↓ ") + Math.abs(Math.round(m.trend.goodPct)) + "%") : "–");
  function drillRowHtml(m) {
    const medal = m.bestMedal ? `<span class="aim-an-medal is-${m.bestMedal}" title="${MEDAL_WORD[m.bestMedal]} is your best medal">${medalSvg(m.bestMedal)}</span>` : `<span class="aim-an-medal is-none"></span>`;
    const cls = m.trend ? (m.trend.direction === "up" ? " is-up" : m.trend.direction === "down" ? " is-down" : "") : "";
    const sp = m.spread ? `<span class="aim-an-spread is-${m.spread.label}" title="Scores vary by about ${Math.round(m.spread.pct)}% from run to run">${m.spread.label}<small>consistency</small></span>`
      : `<span class="aim-an-spread" title="Needs ${DRILL_SPREAD_MIN} finished runs">–<small>consistency</small></span>`;
    const trendTitle = m.trend ? `Your newest ${m.trend.runs} runs against the ${m.trend.runs} before` : `Needs ${DRILL_TREND_MIN} finished runs`;
    return `<li><div class="aim-an-drill${cls}" role="button" tabindex="0" data-drill-open="${esc(m.code)}" aria-label="${esc(m.name)}: open its history">`
      + `${medal}<span class="aim-an-drill-name">${esc(m.name)}<small>${m.runs ? plural(m.runs, "scored run") : "no scored runs"}${m.rounds ? ", " + plural(m.rounds, "round") + " recorded" : ""}${goalTag(m)}</small></span>`
      + `${sparkSvg(m.spark)}<span class="aim-an-drill-num">${esc(fmtScore(m.last, m.unit))}<small>last</small></span><span class="aim-an-drill-num">${esc(fmtScore(m.best, m.unit))}<small>best</small></span>`
      + `<span class="aim-an-drill-trend" title="${esc(trendTitle)}">${esc(trendText(m))}<small>trend</small></span>${sp}</div></li>`;
  }
  function drillsHtml(models, sort, top = "") {
    if (!models.length) return `<p class="aim-an-msg">No drills yet. Finish a drill and its score history, medals and trend show up here.</p>`;
    sort = DRILL_SORTS.some((s) => s[0] === sort) ? sort : "recent";
    const bar = `<div class="aim-an-filters" role="group" aria-label="Sort drills">` + DRILL_SORTS.map(([id, label]) => `<button type="button" data-sort="${id}" aria-pressed="${id === sort}">${label}</button>`).join("") + `</div>`;
    return top + bar + `<ul class="aim-an-drills" data-drill-list>` + sortDrills(models, sort).map(drillRowHtml).join("") + `</ul>`
      + `<p class="aim-an-note">Scores come from your finished runs (the newest 40 per drill, runs that ended in your death are not counted). Trend compares your newest 5 runs with the 5 before; steady means your scores vary by under ${STEADY_PCT}%, swingy by ${SWINGY_PCT}% or more. Click a drill for its history.</p>`;
  }
  // The big score chart of one drill: every run (a died run is a hollow mark), dashed lines at the three medal scores, the best run ringed.
  function scoreChartSvg(entry, m) {
    const runs = arr(entry && entry.runs).filter((r) => r && num(r.score)).slice(-40);
    if (runs.length < 2) return "";
    const W = 720, H = 200, L = 44, R = 50, T = 10, B = 18;
    const th = m.thresholds, vals = runs.map((r) => r.score).concat(th ? [th.bronze, th.silver, th.gold] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const nt = niceTicks(lo, hi, 4); lo = nt.ticks[0]; hi = nt.ticks[nt.ticks.length - 1];
    const x = (i) => L + (i / (runs.length - 1)) * (W - L - R), y = (v) => H - B - ((v - lo) / (hi - lo)) * (H - T - B);
    const grid = nt.ticks.map((v) => `<line class="aim-an-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="aim-an-axis" x="${L - 5}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${v.toFixed(nt.dec)}</text>`).join("");
    // a dashed line per medal score with its name at the right end (the names are pushed apart when the lines are close, so they stay readable)
    let lines = "";
    if (th) {
      const at = ["bronze", "silver", "gold"].map((t) => ({ t, y: y(th[t]) })).sort((a, b) => a.y - b.y), label = [];
      for (const l of at) label.push({ t: l.t, y: label.length ? Math.max(l.y, label[label.length - 1].y + 11) : l.y });
      lines = at.map((l) => `<line class="aim-an-medal-line is-${l.t}" x1="${L}" x2="${W - R}" y1="${l.y.toFixed(1)}" y2="${l.y.toFixed(1)}"/>`).join("")
        + label.map((l) => `<text class="aim-an-medal-tag is-${l.t}" x="${W - R + 5}" y="${(l.y + 3.5).toFixed(1)}">${MEDAL_WORD[l.t]}</text>`).join("");
    }
    const path = runs.map((r, i) => `${x(i).toFixed(1)},${y(r.score).toFixed(1)}`).join(" ");
    const bestI = m.best !== null ? runs.reduce((bi, r, i) => (!r.died && r.score === m.best ? i : bi), -1) : -1;
    const dots = runs.map((r, i) => `<circle class="aim-an-run${r.died ? " is-died" : ""}" cx="${x(i).toFixed(1)}" cy="${y(r.score).toFixed(1)}" r="3.2" data-tip="${esc(`${fmtScore(r.score, m.unit)}${r.died ? " (died)" : r.medal ? ", " + MEDAL_WORD[r.medal] : ""}\n${shortDate(r.at)} ${hhmm(r.at)}`)}"/>`).join("");
    const star = bestI >= 0 ? `<circle class="aim-an-best-ring" cx="${x(bestI).toFixed(1)}" cy="${y(runs[bestI].score).toFixed(1)}" r="7"/>` : "";
    const dates = `<text class="aim-an-axis" x="${L}" y="${H - 3}">${esc(shortDate(runs[0].at))}</text><text class="aim-an-axis" x="${W - R}" y="${H - 3}" text-anchor="end">${esc(shortDate(runs[runs.length - 1].at))}</text>`;
    return `<svg class="aim-an-score" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(m.name)}: your last ${runs.length} scores">${grid}${lines}${dates}<polyline class="aim-an-line" points="${path}"/>${star}${dots}</svg>`;
  }
  function drillDetailHtml(m, entry) {
    const back = `<div class="aim-an-filters"><button type="button" data-drill-back>← All drills</button></div>`;
    const th = m.thresholds;
    const medalRow = th ? ["bronze", "silver", "gold"].map((t) => `<span class="aim-an-medal is-${t}">${medalSvg(t)}${MEDAL_WORD[t]} ${esc(fmtScore(th[t], m.unit))}${m.medals && m.medals[t] ? ` <small>×${m.medals[t]}</small>` : ""}</span>`).join("") : "";
    const nextLine = m.next ? `<p class="aim-an-note" data-next>Next medal: ${MEDAL_WORD[m.next.tier]} at ${esc(fmtScore(m.next.score, m.unit))}, ${esc(fmtScore(m.next.gap, m.unit))} to go.</p><div class="aim-an-prog" role="img" aria-label="${Math.round((m.progress || 0) * 100)}% of the way to ${MEDAL_WORD[m.next.tier]}"><i style="width:${Math.round((m.progress || 0) * 100)}%"></i></div>`
      : th && m.bestMedal === "gold" ? `<p class="aim-an-note">Your last run reached gold.</p>` : !th ? `<p class="aim-an-note">Medals start after 3 finished runs of a drill.</p>` : "";
    const tiles = `<div class="aim-an-track-tiles" data-drill-tiles>` + tileHtml("Best", fmtScore(m.best, m.unit), m.bestMedal ? MEDAL_WORD[m.bestMedal] + " medal" : "no medal yet") + tileHtml("Last", fmtScore(m.last, m.unit), plural(m.runs, "scored run"))
      + tileHtml("Trend", trendText(m), m.trend ? `newest ${m.trend.runs} runs against the ${m.trend.runs} before` : "needs " + DRILL_TREND_MIN + " finished runs")
      + tileHtml("Consistency", m.spread ? m.spread.label : "–", m.spread ? "scores vary by about " + Math.round(m.spread.pct) + "%" : "needs " + DRILL_SPREAD_MIN + " finished runs")
      + (m.rounds ? tileHtml("Accuracy", m.accuracy === null ? "–" : Math.round(m.accuracy) + "%", !m.headshotPct ? plural(m.rounds, "round") : Math.round(m.headshotPct) + "% headshots, " + plural(m.rounds, "round")) : "") + `</div>`;
    const chart = scoreChartSvg(entry, m);
    const recent = arr(entry && entry.runs).filter((r) => r && num(r.score)).slice(-8).reverse();
    const table = recent.length ? `<h4 class="aim-an-sub">Latest runs</h4><ul class="aim-an-sess-drills aim-an-drill-runs">` + recent.map((r) => `<li><span class="aim-an-sd-name">${shortDate(r.at)} ${hhmm(r.at)}</span><span>${esc(fmtScore(r.score, m.unit))}</span><span>${r.died ? "Died" : ""}</span><span>${r.medal ? `<span class="aim-an-medal is-${r.medal}">${medalSvg(r.medal)}${MEDAL_WORD[r.medal]}</span>` : ""}</span></li>`).join("") + `</ul>` : "";
    return back + `<h3 class="aim-an-drill-title">${esc(m.name)}</h3>` + tiles + `<div class="aim-an-medals-row">${medalRow}</div>` + nextLine + goalsHtml(m) + (chart ? `<h4 class="aim-an-sub">Score history</h4><div class="aim-an-scorewrap" tabindex="0" data-tipnav role="group" aria-label="Score history: arrow keys step through your runs">${chart}</div>` : "") + table
      + `<p class="aim-an-note">${m.lower ? "Less is better on this drill. " : ""}Dashed lines are your medal scores. A hollow mark is a run that ended in your death. ${m.rounds ? "Accuracy and headshots come from your stored rounds of this drill (the last 30 days)." : ""}</p>`;
  }

  // ---- goals (21 Nov 2026) ----
  // A goal belongs to one drill. Kept in localStorage GOALS_KEY as { [drill code]: [goal] }; goal = { id, type, tier | target | percent, since (ms), base (the last finished score when it was set, or null), done (ms or null) }.
  //   medal  "reach silver": a finished run since the goal was set earned that medal or a better one (the drill needs medal scores, i.e. MIN_RUNS finished runs).
  //   score  "score 4000": a finished run since then reached the target (at most it, on a drill where less is better). The target must be beyond your best, or it would be done at once.
  //   body   "hold 70% on the body": over your newest BODY_GOAL_ROUNDS rounds of the drill since then that have line-of-sight tracking data, you were on the body that much of the time.
  // A run that ended in your death never counts. The bar is how far along the way you are: from `base` to the target for a score, 0 to the target for the body share.
  const GOALS_KEY = "aim-an-goals-v1", MAX_GOALS = 6, MAX_GOAL_DRILLS = 80, BODY_GOAL_ROUNDS = 3;
  const GOAL_TYPES = ["medal", "score", "body"];
  const goalId = () => "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function normalizeGoal(g) {
    if (!g || typeof g !== "object" || !GOAL_TYPES.includes(g.type)) return null;
    const out = { id: typeof g.id === "string" && /^[a-z0-9]{3,24}$/i.test(g.id) ? g.id : goalId(), type: g.type, since: num(g.since) ? g.since : Date.now(), base: num(g.base) ? g.base : null, done: num(g.done) ? g.done : null };
    if (g.type === "medal") { if (!MEDAL_RANK[g.tier]) return null; out.tier = g.tier; }
    else if (g.type === "score") { if (!num(g.target)) return null; out.target = g.target; }
    else { if (!num(g.percent) || g.percent < 1 || g.percent > 100) return null; out.percent = Math.round(g.percent * 10) / 10; }
    return out;
  }
  function normalizeGoals(v) {
    const out = {};
    if (!v || typeof v !== "object" || Array.isArray(v)) return out;
    for (const code of Object.keys(v).slice(0, MAX_GOAL_DRILLS)) {
      if (!CODE_RE.test(code) || !Array.isArray(v[code])) continue;
      const list = v[code].map(normalizeGoal).filter(Boolean).slice(0, MAX_GOALS);
      if (list.length) out[code] = list;
    }
    return out;
  }
  function loadGoals() { try { return normalizeGoals(JSON.parse(localStorage.getItem(GOALS_KEY))); } catch { return {}; } }
  function saveGoals(map) { try { localStorage.setItem(GOALS_KEY, JSON.stringify(map)); return true; } catch { return false; } }
  // Adds a goal to the goals map (changed in place). spec = { type, tier | target | percent }, entry = the drill's runs entry, thresholds = its medal scores or null.
  // -> { ok: true, goal } or { ok: false, why } with a sentence for the screen.
  function addGoal(map, code, spec, entry, thresholds, now = Date.now()) {
    if (!CODE_RE.test(String(code || ""))) return { ok: false, why: "That drill cannot have a goal." };
    const list = map[code] || (map[code] = []), lower = !!(entry && entry.lower);
    const good = arr(entry && entry.runs).filter((r) => r && num(r.score) && !r.died), last = good.length ? good[good.length - 1].score : null;
    const best = entry && num(entry.best) ? entry.best : null;
    const fail = (why) => { if (!list.length) delete map[code]; return { ok: false, why }; };
    const goal = normalizeGoal({ ...spec, since: now, base: last });
    if (!goal) return fail("That is not a goal this drill can have.");
    if (list.some((g) => !g.done && g.type === goal.type && g.tier === goal.tier && g.target === goal.target && g.percent === goal.percent)) return fail("You already have that goal.");
    if (goal.type === "medal") { if (!thresholds) return fail("Medals start after " + 3 + " finished runs of a drill."); if (MEDAL_RANK[goal.tier] <= (MEDAL_RANK[entry && entry.bestMedal] || 0)) return fail("You already earned that medal here."); }
    if (goal.type === "score" && best !== null && (lower ? goal.target >= best : goal.target <= best)) return fail("Pick a score " + (lower ? "below" : "above") + " your best (" + fmtScore(best, entry && entry.unit) + ").");
    while (list.length >= MAX_GOALS) { const at = list.findIndex((g) => g.done); if (at < 0) return fail("A drill keeps up to " + MAX_GOALS + " goals. Remove one first."); list.splice(at, 1); }
    list.push(goal);
    return { ok: true, goal };
  }
  function removeGoal(map, code, id) {
    if (!map[code]) return false;
    const n = map[code].length;
    map[code] = map[code].filter((g) => g.id !== id);
    if (!map[code].length) delete map[code];
    return !map[code] || map[code].length !== n;
  }
  const goalLabel = (goal, m) => (goal.type === "medal" ? "Reach " + MEDAL_WORD[goal.tier] : goal.type === "score" ? "Score " + fmtScore(goal.target, m.unit) + (m.lower ? " or less" : "") : "Hold " + goal.percent + "% on the body");
  // One goal against the drill's runs and rounds: { goal, label, met, progress (0..1), value (the number it is measured by now, or null), status (a sentence) }.
  // m = drillModel (thresholds, unit, lower), entry = the drill's runs entry, plays = the drill's round facts.
  function evaluateGoal(goal, m, entry, plays) {
    const label = goalLabel(goal, m), res = (met, progress, value, status) => ({ goal, label, met, progress: met ? 1 : clampNum(progress, 0, 1), value, status });
    if (goal.done) return res(true, 1, null, "Reached " + shortDate(goal.done));
    if (goal.type === "body") {
      const rounds = arr(plays).filter((f) => num(f.at) && f.at >= goal.since && f.trackN > 0).sort((a, b) => a.at - b.at).slice(-BODY_GOAL_ROUNDS);
      if (!rounds.length) return res(false, 0, null, "No tracked round since you set it (rounds need line-of-sight data).");
      const on = rounds.reduce((s, f) => s + f.trackOn, 0), n = rounds.reduce((s, f) => s + f.trackN, 0), value = n ? (on / n) * 100 : 0;
      return res(rounds.length >= BODY_GOAL_ROUNDS && value >= goal.percent, value / goal.percent, value, Math.round(value) + "% on the body over your newest " + plural(rounds.length, "tracked round") + (rounds.length < BODY_GOAL_ROUNDS ? ", it needs " + BODY_GOAL_ROUNDS : ""));
    }
    const lower = !!(entry && entry.lower), g = (v) => (lower ? -v : v);
    const since = arr(entry && entry.runs).filter((r) => r && num(r.score) && num(r.at) && !r.died && r.at >= goal.since);
    const best = since.length ? (lower ? Math.min(...since.map((r) => r.score)) : Math.max(...since.map((r) => r.score))) : null;
    const th = m.thresholds, target = goal.type === "medal" ? (th ? th[goal.tier] : null) : goal.target;
    const met = goal.type === "medal" ? since.some((r) => r.medal && MEDAL_RANK[r.medal] >= MEDAL_RANK[goal.tier]) : best !== null && g(best) >= g(target);
    let progress = 0;
    if (best !== null && num(target)) {
      const base = num(goal.base) ? goal.base : best, span = g(target) - g(base);
      progress = span > 0 ? (g(best) - g(base)) / span : 0;
    }
    const goalScore = num(target) ? fmtScore(target, m.unit) : "";
    return res(met, progress, best, best === null ? "No finished run since you set it." : "Best since: " + fmtScore(best, m.unit) + (goalScore ? ", the goal is " + goalScore : ""));
  }
  const goalBarHtml = (ev) => `<li class="aim-an-goal${ev.met ? " is-done" : ""}" data-goal="${esc(ev.goal.id)}"><div class="aim-an-goal-head"><b>${esc(ev.label)}</b><button type="button" class="aim-an-goal-del" data-goal-del="${esc(ev.goal.id)}" aria-label="Remove the goal: ${esc(ev.label)}" title="Remove this goal">✕</button></div>`
    + `<div class="aim-an-prog" role="img" aria-label="${Math.round(ev.progress * 100)}% of the way to: ${esc(ev.label)}"><i style="width:${Math.round(ev.progress * 100)}%"></i></div><small>${esc(ev.status)}</small></li>`;
  // The goals block of a drill's detail: the goals with their bars, then what can be added.
  function goalsHtml(m) {
    const evals = arr(m.goals), open = evals.filter((e) => !e.goal.done);
    const tiers = m.thresholds ? ["bronze", "silver", "gold"].filter((t) => MEDAL_RANK[t] > (MEDAL_RANK[m.bestMedal] || 0) && !open.some((e) => e.goal.type === "medal" && e.goal.tier === t)) : [];
    const list = evals.length ? `<ul class="aim-an-goals" data-goals>${evals.map(goalBarHtml).join("")}</ul>` : `<p class="aim-an-note" data-goals-empty>No goal for this drill yet.</p>`;
    const medalBtns = tiers.map((t) => `<button type="button" data-goal-medal="${t}">${medalSvg(t)}Reach ${MEDAL_WORD[t]}</button>`).join("");
    const score = `<form class="aim-an-goal-form" data-goal-form="score"><label>Score goal<input type="number" name="v" step="any" inputmode="decimal" required placeholder="${esc(goalHint(m))}"></label><button type="submit">Set</button></form>`;
    const body = m.tracked ? `<form class="aim-an-goal-form" data-goal-form="body"><label>On the body, %<input type="number" name="v" min="1" max="100" step="1" inputmode="numeric" required placeholder="70"></label><button type="submit">Set</button></form>` : "";
    return `<h4 class="aim-an-sub">Goals</h4>${list}<div class="aim-an-goal-add" data-goal-add>${medalBtns}${score}${body}</div><p class="aim-an-note" data-goal-msg role="status">A goal counts the finished runs after you set it. Reaching one shows a short message.</p>`;
  }
  // A score a little beyond your best (5%), rounded like the scores are shown: the score goal's placeholder.
  const goalHint = (m) => { if (m.best === null || !num(m.best)) return ""; const v = m.best * (m.lower ? 0.95 : 1.05), d = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2; return String(+v.toFixed(d)); };
  const goalTag = (m) => { const open = arr(m.goals).filter((e) => !e.met); return open.length ? " · goal " + Math.round(open[0].progress * 100) + "%" : arr(m.goals).length ? " · goal reached" : ""; };
  // The little "goal reached" message, in the style of the other round messages (theme .es-score-toast).
  function goalToast(text) {
    try {
      document.querySelector(".es-score-toast")?.remove();
      const t = document.createElement("div");
      t.className = "es-score-toast is-good aim-an-goal-toast"; t.setAttribute("role", "status"); t.textContent = text;
      document.body.append(t);
      setTimeout(() => { try { t.remove(); } catch {} }, 4500);
    } catch {}
  }
  // Looks at every goal that is still open and marks the ones reached (saved, then one message). Runs after each finished run (the routines' change event), at start and when the Drills tab is drawn.
  let goalCheck = null;
  function checkGoals() {
    if (goalCheck) return goalCheck;
    goalCheck = (async () => {
      try {
        const map = loadGoals(), codes = Object.keys(map).filter((c) => map[c].some((g) => !g.done));
        if (!codes.length) return [];
        const runs = runsNow(), logic = logicNow(), reached = [];
        await namesReady();
        for (const code of codes) {
          let plays = [];
          if (map[code].some((g) => !g.done && g.type === "body")) plays = (await read("rounds", { code, limit: 40 })).map(roundFacts);
          const m = drillModel(code, runs[code], logic, plays, nameFor(code, runs));
          for (const g of map[code]) if (!g.done) { const ev = evaluateGoal(g, m, runs[code], plays); if (ev.met) { g.done = Date.now(); reached.push({ name: m.name, label: ev.label }); } }
        }
        if (reached.length) {
          saveGoals(map);
          goalToast("Goal reached: " + reached[0].label + " in " + reached[0].name + (reached.length > 1 ? " (+" + (reached.length - 1) + " more)" : ""));
          if (inlinePanel && inlinePanel.tab === "drills") renderDrills(inlinePanel);
        }
        return reached;
      } catch { return []; }
    })().finally(() => { goalCheck = null; });
    return goalCheck;
  }
  let goalTimer = 0;
  const goalsSoon = () => { clearTimeout(goalTimer); goalTimer = setTimeout(checkGoals, 1500); };

  // ---- suggested warm-up (21 Nov 2026) ----
  const WARM_ROUTINE_ID = "rt-suggested-warmup", WARM_ROUTINE_NAME = "Suggested warm-up";
  // The routine the suggestion would save: steps from coach.warmupPlan's { steps: [{ code, runs }] }; type = what the gallery calls the drill (the routines page starts a Target Workshop "ball" drill from another tab).
  function warmupRoutine(plan, nameOf, typeOf) {
    return { id: WARM_ROUTINE_ID, name: WARM_ROUTINE_NAME, steps: arr(plan && plan.steps).map((s) => ({ code: s.code, name: typeof nameOf === "function" ? nameOf(s.code) : s.code, type: typeof typeOf === "function" ? typeOf(s.code) || "" : "", runs: s.runs, minScore: null, minMedal: null, rank: "" })) };
  }
  function warmupHtml(plan, nameOf, exists) {
    if (!plan) return "";
    if (plan.steps.length < 2) return `<section class="aim-an-warm" data-warmup><h4>Suggested warm-up</h4><p class="aim-an-note">Play three or more rounds of at least two drills and a warm-up shows up here: a short list of the drills you hit best, to play before the ones that count.</p></section>`;
    const why = plan.cold ? `Your first 2 rounds of a session hit ${plan.firstAccuracyPercent}% of your shots, the rounds after them ${plan.middleAccuracyPercent}% (${plan.sessions} sessions). A short warm-up on drills you are good at, before the ones that count, should close that gap.`
      : `Built from your most played drills: the ones you hit the most with, easiest first, so the first rounds of a session are not the ones that count.`;
    const steps = plan.steps.map((s, i) => `<li><i>${i + 1}</i><b>${esc(nameOf(s.code))}</b><em>${plural(s.runs, "run")}, you hit ${s.accuracyPercent}% here</em></li>`).join("");
    return `<section class="aim-an-warm${plan.cold ? " is-cold" : ""}" data-warmup><h4>Suggested warm-up</h4><p>${esc(why)}</p><ol>${steps}</ol>`
      + `<div class="aim-an-warm-actions"><button type="button" data-warmup-save>${exists ? "Update the routine" : "Add to Routines"}</button><span class="aim-an-warm-msg" data-warmup-msg role="status">${exists ? "A routine named " + WARM_ROUTINE_NAME + " is in Routines already." : ""}</span></div></section>`;
  }

  // ---- export ----
  // A CSV cell: quoted when it holds a comma, quote or line break; a text starting with = + - @ gets a leading ' so a spreadsheet does not run it as a formula.
  function csvCell(v) {
    if (v === null || v === undefined || (typeof v === "number" && !isFinite(v))) return "";
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const toCsv = (cols, rows) => [cols.map((c) => csvCell(c[0])).join(",")].concat(rows.map((r) => cols.map((c) => csvCell(c[1](r))).join(","))).join("\r\n") + "\r\n";
  const stamp = (ms) => dayOf(ms) + " " + hhmm(ms) + ":" + pad(new Date(ms).getSeconds());
  const pctOf = (a, b, d = 1) => (b > 0 ? +((a / b) * 100).toFixed(d) : null);
  // One row per stored round (the last 30 days).
  function roundsCsv(rounds, nameOf) {
    const facts = arr(rounds).map(roundFacts).filter((f) => num(f.at)).sort((a, b) => a.at - b.at);
    const cols = [["started", (f) => stamp(f.at)], ["drill", (f) => (typeof nameOf === "function" ? nameOf(f.code) : f.code)], ["drill_code", (f) => f.code], ["map", (f) => f.map], ["mode", (f) => f.mode], ["result", (f) => f.end],
      ["seconds", (f) => f.seconds], ["shots", (f) => f.shots], ["hits", (f) => f.hits], ["accuracy_pct", (f) => pctOf(f.hits, f.shots)], ["headshots", (f) => f.headshots], ["headshot_pct", (f) => pctOf(f.headshots, f.hits)],
      ["kills", (f) => f.kills], ["deaths", (f) => f.deaths], ["near_misses", (f) => f.nearMisses], ["median_kill_time_s", (f) => (f.ttk.length ? +medianOf(f.ttk).toFixed(3) : null)],
      ["tracking_on_body_pct", (f) => pctOf(f.trackOn, f.trackN)], ["line_of_sight_data", (f) => (f.sight ? 1 : 0)]];
    return toCsv(cols, facts);
  }
  // One row per day (kept for good).
  function daysCsv(days) {
    const rows = arr(days).filter((d) => d && typeof d.day === "string").sort((a, b) => (a.day < b.day ? -1 : 1));
    const cols = [["day", (d) => d.day], ["rounds", (d) => d.rounds || 0], ["shots", (d) => d.shots || 0], ["hits", (d) => d.hits || 0], ["accuracy_pct", (d) => pctOf(d.hits || 0, d.shots || 0)], ["headshots", (d) => d.headshots || 0],
      ["headshot_pct", (d) => pctOf(d.headshots || 0, d.hits || 0)], ["kills", (d) => d.kills || 0], ["deaths", (d) => d.deaths || 0], ["falls", (d) => d.falls || 0], ["near_misses", (d) => d.nearMisses || 0],
      ["flick_kills", (d) => d.flicks || 0], ["strafe_kills", (d) => d.strafes || 0]];
    return toCsv(cols, rows);
  }
  // Everything as one JSON text: round facts, day rows without their position grids, and the drill score histories.
  function exportJson(rounds, days, runsState, nameOf, now = Date.now()) {
    const slim = (d) => { const o = { ...d }; delete o.grid; delete o.fights; delete o.ids; return o; };
    return JSON.stringify({ app: "openVaim", exported: new Date(now).toISOString(), note: "Rounds are the stored rounds of the last 30 days (counts only); days are daily totals kept for good; drills are the score histories behind the medals.",
      rounds: arr(rounds).map(roundFacts).filter((f) => num(f.at)).sort((a, b) => a.at - b.at).map((f) => ({ ...f, drill: typeof nameOf === "function" ? nameOf(f.code) : f.code, startedAt: new Date(f.at).toISOString() })),
      days: arr(days).filter((d) => d && typeof d.day === "string").map(slim), drills: runsState && typeof runsState === "object" ? runsState : {} }, null, 2);
  }
  // Saves text as a file: a Blob and a link with the download attribute (the desktop app opens its own save dialog for it).
  function downloadText(name, text, type) {
    try {
      const blob = new Blob([text], { type: type || "text/plain" }), url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = name; a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 4000);
      return true;
    } catch { return false; }
  }
  const EXPORTS = { rounds: ["Rounds CSV", "rounds", "csv", "text/csv"], days: ["Daily CSV", "daily", "csv", "text/csv"], json: ["Everything JSON", "stats", "json", "application/json"] };
  const FOOT_HTML = `<span class="aim-an-foot-label">Export your stats</span>` + Object.entries(EXPORTS).map(([id, e]) => `<button type="button" data-export="${id}">${e[0]}</button>`).join("") + `<span class="aim-an-foot-msg" data-export-msg role="status"></span>`;

  // ---------------------------------------------------------------- coach (pure)
  // Gallery (17 Nov 2026, fixed cards): one card per finding, in the order returned (most important first). Every card is the
  // same size whatever its content (equal grid columns at least --an-card-min wide, one fixed row height --an-card-h), and
  // shows only the icon, the title (two lines at most), the short summary (one line) and a small copy of the visual
  // (cardVisual), or, without a visual, the detail's first sentences clamped, then a "Numbers" button. A click anywhere on
  // the card (or Enter / Space on the focused card) and the Numbers button both open the tip in a modal (coachModalHtml,
  // openTip) with the severity, sample, full detail, the visual at full size, the advice, the "Numbers" list and the fine print.
  const SEV = { warn: "Warning", tip: "Tip", info: "Info" };
  const sevOf = (f) => (SEV[f && f.severity] ? f.severity : "info");
  const isFinding = (f) => !!f && typeof f === "object";
  const evidenceText = (v) => (v == null ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v));
  // An evidence key in plain words for the Numbers list: "averageOffsetCm" -> "Average offset (cm)", "minFights" -> "Needs at least: fights".
  const KEY_UNITS = [[/Percent$/, " (%)"], [/Seconds$/, " (s)"], [/Cm$/, " (cm)"], [/Deg(rees)?$/, " (°)"], [/Metres$/, " (m)"]];
  function keyLabel(key) {
    let s = String(key), unit = "";
    for (const [re, u] of KEY_UNITS) if (re.test(s) && s.replace(re, "")) { s = s.replace(re, ""); unit = u; break; }
    s = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
    if (/^min [a-z]/.test(s)) s = "needs at least: " + s.slice(4); else if (/^max [a-z]/.test(s)) s = "at most: " + s.slice(4);
    return s.charAt(0).toUpperCase() + s.slice(1) + unit;
  }
  // "stillAccuracyPercent" -> "still accuracy"; a best / worst / weakest prefix becomes the named weapon, range or group (a
  // drill code becomes the drill's title, drillLabel).
  function words(key, e) {
    let k = String(key).replace(/(Percent|Seconds|Cm)$/, ""), lead = "";
    for (const pre of ["best", "worst", "weakest", "other"]) {
      const name = pre === "other" ? e && e.otherGroup : e && e[pre];
      if (k.startsWith(pre) && k.length > pre.length && typeof name === "string") { lead = drillBook.has(name) || /^[a-f0-9]{16}$/.test(name) ? drillLabel(name) : name.toLowerCase(); k = k.slice(pre.length); break; }
    }
    const rest = k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
    return lead ? lead + " " + rest : rest;
  }

  // ---------------------------------------------------------------- references in coach text (17 Nov 2026)
  // One component for the names the coach text mentions: refHtml() renders a focusable span, showRefCard() the hover card
  // (one element on the body, above the Stats panel and the tip modal), the panel's and the modal's click / key handlers the
  // action. A map name is hover-only (its gallery picture); a drill is hover (title, map, mode, the map's picture) plus click
  // or Enter, which starts it from the lobby (startDrill). A drill shows its TITLE, never its share code; the titles come
  // from the training gallery's own list (WORKSHOP_LIST, the list the lobby cards are drawn from, so a renamed or Studio drill
  // has the name the gallery shows); a code that list does not have shows its short code (first 7 characters).
  const WORKSHOP_LIST = "/prod-api/api/v1/public/val/aimlab/workshop";
  const MAP_RE = /^[a-z0-9_-]{1,40}$/i, CODE_RE = /^[a-z0-9-]{1,64}$/i;
  let drillBook = new Map(); // share code -> { name, map, mode }
  let drillLoad = null;
  // Reads the gallery's drill list once per page (again after a failure); resolves to the book.
  function loadDrills() {
    if (!drillLoad) {
      drillLoad = (async () => {
        try {
          if (typeof fetch !== "function") return drillBook;
          const res = await fetch(WORKSHOP_LIST, { cache: "no-store" });
          if (!res || !res.ok) throw new Error("list");
          const j = await res.json(), book = new Map();
          for (const it of (j && Array.isArray(j.data) ? j.data : [])) {
            if (!it || typeof it.shareCode !== "string" || !CODE_RE.test(it.shareCode)) continue;
            book.set(it.shareCode, { name: typeof it.name === "string" && it.name.trim() ? it.name.trim() : "", map: typeof it.mapId === "string" ? it.mapId : null,
              mode: typeof it.mode === "string" ? it.mode : typeof it.type === "string" ? it.type : null });
          }
          drillBook = book;
        } catch { drillLoad = null; }
        return drillBook;
      })();
    }
    return drillLoad;
  }
  const shortCode = (code) => String(code).slice(0, 7);
  // The gallery's title, else the name kept with the drill's runs (a drill the gallery no longer lists), else the short code.
  const drillLabel = (code) => { const d = drillBook.get(code); if (d && d.name) return d.name; const r = runsNow()[code]; return r && typeof r.name === "string" && r.name ? r.name : shortCode(code); };
  // The span for a map name or a drill code. A map keeps its short name; a drill shows its title.
  // map (drills only): the finding's map, for the card when the gallery's list has none for the drill.
  function refHtml(kind, key, map) {
    const k = esc(key);
    if (kind === "map") return `<span class="aim-an-mapref" tabindex="0" data-map="${k}" aria-label="Map ${k}: show its picture">${k}</span>`;
    const label = esc(drillLabel(key)), hint = map && MAP_RE.test(map) ? ` data-drill-map="${esc(map)}"` : "";
    return `<span class="aim-an-mapref aim-an-drillref" tabindex="0" role="link" data-drill="${k}"${hint} aria-label="Drill ${label}: show its card; click or Enter plays it">${label}</span>`;
  }
  // The names a finding's text can mention: its map(s) and drill code(s), from the evidence (map, drill, the other group of a
  // by-map / by-drill comparison) and any 16-character share code in the text.
  function refsOf(f, text) {
    const e = f && f.evidence && typeof f.evidence === "object" ? f.evidence : {}, rule = String((f && f.id) || "").split(":")[0];
    const maps = new Set(), drills = new Set();
    if (typeof e.map === "string") maps.add(e.map);
    if (typeof e.drill === "string") drills.add(e.drill);
    if (typeof e.otherGroup === "string") (rule === "strafe-map" ? maps : rule === "strafe-drill" ? drills : new Set()).add(e.otherGroup);
    for (const m of String(text || "").matchAll(/\b[a-f0-9]{16}\b/g)) drills.add(m[0]);
    return { maps: [...maps].filter((m) => MAP_RE.test(m)), drills: [...drills].filter((c) => CODE_RE.test(c)) };
  }
  // Escaped text with every whole-word mention of a map or drill as its reference span (one pass, longest first).
  function withRefs(text, refs) {
    const t = esc(text), all = [...refs.drills.map((k) => ["drill", k]), ...refs.maps.filter((m) => !refs.drills.includes(m)).map((k) => ["map", k])];
    if (!all.length) return t;
    const kinds = new Map(all.map(([kind, k]) => [esc(k), kind]));
    const alt = [...kinds.keys()].sort((a, b) => b.length - a.length).map((k) => k.replace(/[-]/g, "\\-")).join("|");
    return t.replace(new RegExp(`\\b(?:${alt})\\b`, "g"), (k) => refHtml(kinds.get(k), k, refs.maps[0]));
  }
  // Plain text (a title, a summary, a note) with drill codes replaced by their labels.
  function labelCodes(text, refs) {
    let t = String(text ?? "");
    for (const c of refs.drills) t = t.replace(new RegExp(`\\b${c.replace(/[-]/g, "\\-")}\\b`, "g"), drillLabel(c));
    return t;
  }
  // Rule icons (17 Nov 2026): one small line glyph per rule, drawn here (no icon set, no third-party art). 24 x 24, stroked in
  // currentColor (the card sets the theme red), so they stay monochrome. GLYPH holds the drawings, COACH_ICON maps every rule id
  // insights() and roundTip() can return (coach.js SUMMARY has the same ids) to one of them; an unknown id gets GLYPH.info.
  const GLYPH = {
    crosshair: '<circle cx="12" cy="12" r="7"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
    stopwatch: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.8 1.8M9.5 3h5M12 3v3M18.5 6.5l1.5-1.5"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    skull: '<path d="M12 3a7 7 0 0 0-7 7c0 2.6 1.3 4.3 3 5.3V19h8v-3.7c1.7-1 3-2.7 3-5.3a7 7 0 0 0-7-7z"/><circle cx="9.5" cy="10.5" r="1.4"/><circle cx="14.5" cy="10.5" r="1.4"/><path d="M10.5 19v2M13.5 19v2"/>',
    deathPin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><path d="M10 8l4 4M14 8l-4 4"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    fall: '<path d="M3 7h8v14"/><path d="M17 4v12M13.5 12.5L17 16l3.5-3.5"/>',
    duo: '<circle cx="8" cy="8" r="3"/><circle cx="16.5" cy="8" r="3"/><path d="M2.5 20a5.5 5.5 0 0 1 11 0M14 14.6a5.5 5.5 0 0 1 8 5.4"/>',
    swords: '<path d="M4 4l10 10M20 4L10 14"/><path d="M6.5 13.5l4 4M17.5 13.5l-4 4M8.5 15.5L5 19M15.5 15.5L19 19"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>',
    hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 4 6 5 9-1 3-5 4-5 9M17 3c0 5-4 6-5 9 1 3 5 4 5 9"/>',
    eyeOff: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 20L20 4"/>',
    eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    swing: '<path d="M4 18A10 10 0 0 1 17 6"/><path d="M13 5.5h4.5V10"/><path d="M15 15l5 5M20 15l-5 5"/>',
    bolt: '<path d="M13 2L5 13.5h6L10 22l8-11.5h-6z"/>',
    strafe: '<circle cx="12" cy="5" r="2"/><path d="M12 7v7M9 21l3-7 3 7"/><path d="M2 11h5M4.5 8.5L2 11l2.5 2.5M22 11h-5M19.5 8.5L22 11l-2.5 2.5"/>',
    bullets: '<path d="M4 20V11a2 2 0 0 1 4 0v9zM10 20V11a2 2 0 0 1 4 0v9zM16 20V11a2 2 0 0 1 4 0v9zM4 17h4M10 17h4M16 17h4"/>',
    spray: '<circle cx="12" cy="20" r="1.4" fill="currentColor"/><circle cx="11.5" cy="15.5" r="1.4" fill="currentColor"/><circle cx="12.5" cy="11.2" r="1.4" fill="currentColor"/><circle cx="15" cy="7.2" r="1.4" fill="currentColor"/><circle cx="18.5" cy="4" r="1.4" fill="currentColor"/><path d="M5 20h3"/>',
    range: '<path d="M3 5v14M21 5v14M3 12h18M6.5 8.5L3 12l3.5 3.5M17.5 8.5L21 12l-3.5 3.5"/>',
    missUp: '<circle cx="12" cy="15" r="5.5"/><path d="M12 13.5v3M10.5 15h3"/><path d="M12 2.5v6M9 5.5l3-3 3 3"/>',
    missSide: '<circle cx="9" cy="12" r="5.5"/><path d="M9 10.5v3M7.5 12h3"/><path d="M15.5 12h6M18.5 9l3 3-3 3"/>',
    headLine: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21a7 7 0 0 1 14 0"/><path d="M2 8h5M17 8h5"/>',
    stop: '<path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z"/><path d="M7.5 12h9"/>',
    steps: '<path d="M7.5 3.5c1.7 0 2.6 1.7 2.6 3.7S9.3 11 7.8 11 5 9.3 5 7.3 5.8 3.5 7.5 3.5zM5.6 13h4.2l-.4 2.6a2 2 0 0 1-3.4 0z"/><path d="M16.5 8.5c1.7 0 2.6 1.7 2.6 3.7s-.8 3.8-2.3 3.8-2.8-1.7-2.8-3.7.8-3.8 2.5-3.8zM14.6 18h4.2l-.4 2.6a2 2 0 0 1-3.4 0z"/>',
    crouch: '<circle cx="13" cy="4.5" r="2"/><path d="M13 6.5l-2 6h5l1 6M11 12.5l-4 2v4.5M3 21h18"/>',
    mouse: '<rect x="6" y="2.5" width="12" height="19" rx="6"/><path d="M12 2.5v6"/>',
    mouseFast: '<rect x="10" y="2.5" width="11" height="19" rx="5.5"/><path d="M15.5 2.5v6M2 9h5M3 13h4M2 17h5"/>',
    wave: '<path d="M2 12c2.5-6 4.5-6 7 0s4.5 6 7 0 4.5-6 6-3"/>',
    track: '<circle cx="9" cy="12" r="5"/><path d="M9 9v6M6 12h6"/><path d="M16 7h6M19 4l3 3-3 3M16 17h6M19 14l3 3-3 3"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  };
  const COACH_ICON = {
    "miss-side": GLYPH.missUp, "miss-side-sideways": GLYPH.missSide, "kill-style": GLYPH.bolt, "pre-aim": GLYPH.headLine, "pre-aim-low": GLYPH.headLine,
    "kill-time": GLYPH.stopwatch, "kill-time-trend": GLYPH.trend, "death-zone": GLYPH.deathPin, "deaths-cause": GLYPH.fall, "deaths-unanswered": GLYPH.skull,
    "multi-enemy": GLYPH.duo, "fights-lost": GLYPH.swords, "fight-spot": GLYPH.pin, "angle-lose": GLYPH.compass, "angle-win": GLYPH.compass,
    "hold-sooner": GLYPH.hourglass, "clear-deaths": GLYPH.eyeOff, "over-checked": GLYPH.eye, "wasted-swings": GLYPH.swing,
    "headshot-weapon": GLYPH.target, "accuracy-weapon": GLYPH.crosshair, "strafe-map": GLYPH.strafe, "strafe-drill": GLYPH.strafe,
    "burst-length": GLYPH.bullets, "spray-control": GLYPH.spray, "accuracy-range": GLYPH.range, "counter-strafe": GLYPH.stop,
    "walk-accuracy": GLYPH.steps, "crouch-accuracy": GLYPH.crouch, "sens-changed": GLYPH.mouse, "sens-extreme": GLYPH.mouse, "mouse-accel": GLYPH.mouseFast,
    "tracking": GLYPH.track, "tracking-lock": GLYPH.stopwatch, "consistency": GLYPH.wave, "warmup": GLYPH.hourglass, "fade": GLYPH.trend, "trend-accuracy": GLYPH.trend, "trend-headshots": GLYPH.trend,
    "round-tip-accuracy": GLYPH.crosshair, "round-tip-headshot": GLYPH.target, "round-tip-side": GLYPH.missSide, "round-tip-vertical": GLYPH.missUp,
  };
  const ruleOf = (id) => String(id ?? "").split(":")[0];
  const hasIcon = (id) => Object.prototype.hasOwnProperty.call(COACH_ICON, ruleOf(id));
  const coachIcon = (id) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-icon="${hasIcon(id) ? esc(ruleOf(id)) : "fallback"}">`
    + (hasIcon(id) ? COACH_ICON[ruleOf(id)] : GLYPH.info) + `</svg>`;
  // The card's short line: the finding's own summary (coach.js SUMMARY), else the main number read from the evidence; never a
  // copy of the title (then nothing).
  function cardSummary(f) {
    const same = (t) => String(t).trim().toLowerCase() === String(f.title ?? "").trim().toLowerCase();
    const own = typeof f.summary === "string" ? f.summary.trim() : "";
    if (own && !same(own)) return own;
    const line = mainLine(f);
    return line && !same(line) ? line : "";
  }
  // The card's one-line main number (the fallback when a finding has no summary).
  function mainLine(f) {
    const e = f.evidence && typeof f.evidence === "object" ? f.evidence : {};
    const k = Object.keys(e).find((x) => /Percent$/.test(x) && num(e[x]));
    if (k) return `${e[k]}% ${words(k, e)}`;
    const t = Object.keys(e).find((x) => /Seconds$/.test(x) && num(e[x]));
    if (t) return `${e[t]} s ${words(t, e)}`;
    return "";
  }
  // Horizontal bars with the value as a label. rows: [{ label, value, cls }]; unit "%" scales to 100, else to the largest value.
  function barsRowsHtml(rows, unit, kind) {
    rows = rows.filter((r) => num(r.value));
    if (rows.length < 2) return "";
    const max = unit === "%" ? 100 : Math.max(...rows.map((r) => r.value), 1e-9);
    return `<div class="aim-an-bars" data-vis="${kind || "bars"}">` + rows.map((r) => `<div class="aim-an-bar${r.cls ? " " + r.cls : ""}"><span>${esc(r.label)}</span>`
      + `<i><b style="width:${Math.max(0, Math.min(100, (r.value / max) * 100)).toFixed(1)}%"></b></i><em>${esc(+(+r.value).toFixed(2))}${unit === "%" ? "%" : unit ? " " + esc(unit) : ""}</em></div>`).join("") + `</div>`;
  }
  // The coach's eight world directions (coach.js SECTORS), at yaw k * 45 degrees: 0 looks along -z, it grows toward -x.
  const COACH_SECTORS = ["the -z direction", "the -z / -x diagonal", "the -x direction", "the +z / -x diagonal", "the +z direction", "the +z / +x diagonal", "the +x direction", "the -z / +x diagonal"];
  // A sector wheel: one wedge per direction with fights, shaded by its win rate, the finding's sector outlined in red.
  function wheelHtml(sectors, key) {
    const C = 70, R = 56, pt = (deg, r) => [C - Math.sin((deg * Math.PI) / 180) * r, C - Math.cos((deg * Math.PI) / 180) * r].map((v) => v.toFixed(1));
    const wedges = [];
    for (const sct of sectors) {
      const k = COACH_SECTORS.indexOf(sct && sct.sector);
      if (k < 0 || !num(sct.winPercent)) continue;
      const a0 = k * 45 - 22.5, a1 = k * 45 + 22.5, [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R), [lx, ly] = pt(k * 45, R * 0.64);
      const on = sct.sector === key;
      wedges.push(`<path d="M${C} ${C}L${x0} ${y0}A${R} ${R} 0 0 0 ${x1} ${y1}Z" fill="var(--an-good)" fill-opacity="${(0.12 + 0.6 * (sct.winPercent / 100)).toFixed(2)}" stroke="${on ? "var(--an-red)" : "rgba(5,7,10,0.8)"}" stroke-width="${on ? 2.5 : 1}"><title>${esc(sct.sector)}: won ${esc(sct.won)} of ${esc(sct.fights)}</title></path>`
        + `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle"${on ? ' class="is-key"' : ""}>${esc(sct.winPercent)}%</text>`);
    }
    if (!wedges.length) return "";
    const axis = [["-z", 0], ["-x", 90], ["+z", 180], ["+x", 270]].map(([t, d]) => { const [x, y] = pt(d, R + 9); return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle">${t}</text>`; }).join("");
    return `<svg viewBox="0 0 140 140" data-vis="wheel" role="img" aria-label="Win rate by direction"><circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="var(--an-line-2)"/>${wedges.join("")}${axis}</svg>`
      + `<p class="aim-an-note">Win rate by the direction the enemy was in (world directions on the map; red = this finding).</p>`;
  }
  // A dot plot of the average near-miss offset (cm) on one axis, with the count of misses on each side as labels.
  function dotsHtml(cm, negLabel, posLabel, negCount, posCount, vertical) {
    if (!num(cm)) return "";
    const lim = Math.max(10, Math.ceil(Math.abs(cm) * 1.5 / 5) * 5), W = 240, Hh = 60, pos = (v) => 20 + ((v + lim) / (2 * lim)) * (W - 40);
    const x = pos(cm).toFixed(1);
    const svg = `<svg viewBox="0 0 ${W} ${Hh}" data-vis="dots" role="img" aria-label="Average miss ${Math.abs(cm)} cm ${cm < 0 ? negLabel : posLabel}"${vertical ? ' style="max-width:240px"' : ""}>`
      + `<line x1="20" x2="${W - 20}" y1="30" y2="30" stroke="var(--an-line-2)"/><line x1="${pos(0)}" x2="${pos(0)}" y1="18" y2="42" stroke="var(--an-muted)"/>`
      + `<circle cx="${x}" cy="30" r="6" fill="var(--an-tip)" stroke="#05070a" stroke-width="1.5"/><text x="${x}" y="14" text-anchor="middle" class="is-key">${Math.abs(cm)} cm</text>`
      + `<text x="20" y="54">${esc(negLabel)}${num(negCount) ? " · " + negCount : ""}</text><text x="${W - 20}" y="54" text-anchor="end">${esc(posLabel)}${num(posCount) ? " · " + posCount : ""}</text></svg>`;
    return svg + `<p class="aim-an-note">Where your near misses pass on average, against the middle of the enemy (0)${vertical ? "; left = below, right = above" : ""}.</p>`;
  }
  // A short line between two values over time (the earlier window, then the recent one), each labelled.
  function lineHtml(a, b, aLabel, bLabel, unit) {
    if (!num(a) || !num(b)) return "";
    const lo = Math.min(a, b), hi = Math.max(a, b), y = (v) => (hi - lo < 1e-9 ? 30 : 46 - ((v - lo) / (hi - lo)) * 30).toFixed(1);
    return `<svg viewBox="0 0 240 70" data-vis="line" role="img" aria-label="${esc(aLabel)} ${a}${unit}, ${esc(bLabel)} ${b}${unit}">`
      + `<polyline points="40,${y(a)} 200,${y(b)}" fill="none" stroke="var(--an-red)" stroke-width="2"/>`
      + `<circle cx="40" cy="${y(a)}" r="4" fill="#fff"/><circle cx="200" cy="${y(b)}" r="4" fill="var(--an-red)"/>`
      + `<text x="40" y="${+y(a) - 9}" text-anchor="middle">${a}${unit}</text><text x="200" y="${+y(b) - 9}" text-anchor="middle" class="is-key">${b}${unit}</text>`
      + `<text x="40" y="66" text-anchor="middle">${esc(aLabel)}</text><text x="200" y="66" text-anchor="middle">${esc(bLabel)}</text></svg>`;
  }
  // The card's small copy of the visual: the drawing only (no heading, slider or notes), at most four bars (the marked ones
  // first kept), or "" when the finding has nothing to draw.
  const CARD_BARS = 4;
  function cardVisual(f) {
    return coachVisual(f, true)
      .replace(/<h5>[\s\S]*?<\/h5>/g, "")
      .replace(/<label class="aim-an-dist">[\s\S]*?<\/label>/g, "")
      .replace(/<p class="aim-an-note"[^>]*>[\s\S]*?<\/p>/g, "");
  }
  // The visual for a finding from the evidence its rule already gives, or "" when it has nothing to draw. small: the card's
  // copy, with at most CARD_BARS bars (the key / bad ones kept, then the first others, in their order).
  function coachVisual(f, small) {
    const e = f && f.evidence && typeof f.evidence === "object" ? f.evidence : {}, id = String((f && f.id) || "").split(":")[0];
    const barsHtml = (rows, unit, kind) => {
      if (small && rows.length > CARD_BARS) {
        const keep = new Set(rows.filter((r) => r && /is-(key|bad)/.test(r.cls || "")).slice(0, CARD_BARS));
        for (const r of rows) if (keep.size < CARD_BARS) keep.add(r);
        rows = rows.filter((r) => keep.has(r));
      }
      return barsRowsHtml(rows, unit, kind);
    };
    switch (id) {
      case "fights-lost": return barsHtml([{ label: "Won", value: e.fightsWon, cls: "is-good" }, { label: "Lost", value: e.fightsLost, cls: "is-bad" }], "fights");
      case "fight-spot": return barsHtml([{ label: "Lost from this spot", value: e.lostPercent, cls: "is-bad" }, { label: "Lost elsewhere", value: e.restLostPercent }], "%");
      case "angle-lose": case "angle-win": return Array.isArray(e.sectors) ? wheelHtml(e.sectors, e.sector) : "";
      case "clear-deaths": return Array.isArray(e.sectors) ? barsHtml(e.sectors.map((x) => ({ label: x && x.sector, value: x && x.deaths, cls: x && x.sector === e.sector ? "is-key" : "" })), "deaths", "sectors") : "";
      case "over-checked": return barsHtml([{ label: e.sector, value: e.roundsLookedAt, cls: "is-key" }, ...(Array.isArray(e.otherSectors) ? e.otherSectors : []).map((x) => ({ label: x && x.sector, value: x && x.rounds }))], "rounds", "sectors");
      case "miss-side": return dotsHtml(num(e.averageOffsetCm) ? (e.side === "below" ? -1 : 1) * Math.abs(e.averageOffsetCm) : null, "below", "above", e.below, e.above, true);
      case "miss-side-sideways": return dotsHtml(num(e.averageOffsetCm) ? (e.side === "left" ? -1 : 1) * Math.abs(e.averageOffsetCm) : null, "left", "right", e.left, e.right, false);
      case "kill-time-trend": return lineHtml(e.previousSeconds, e.recentSeconds, "the 7 days before", "the last 7 days", " s");
      case "deaths-cause": return barsHtml([{ label: "Shot", value: e.byShot }, { label: "Fell", value: e.falls, cls: "is-bad" }], "deaths");
      case "kill-style": return barsHtml([{ label: "Flick", value: e.flicks }, { label: "Strafe", value: e.strafes }, { label: "Mixed", value: e.mixed }], "kills");
      case "spray-control": if (num(e.bulletDriftYawDeg) && num(e.bulletDriftPitchDeg)) return angleHtml(e.bulletDriftYawDeg, e.bulletDriftPitchDeg, distOf(e), "where the later bullets of a burst land against the first ones"); break;
      case "pre-aim": if (num(e.averagePitchErrorDegrees)) return angleHtml(0, e.averagePitchErrorDegrees, distOf(e), "where the head is against your crosshair when an enemy comes into view"); break;
    }
    // compared rates (accuracy, headshot, strafe or loss share of two groups): the percentages side by side
    const pk = Object.keys(e).filter((k) => /Percent$/.test(k) && num(e[k]));
    return pk.length >= 2 ? barsHtml(pk.slice(0, 4).map((k, i) => ({ label: words(k, e), value: e[k], cls: i === 0 ? "is-key" : "" })), "%") : "";
  }
  // "What this means" for an angle (17 Nov 2026): an angle of a degrees at d metres puts the point d * tan(a) metres away on
  // the target plane. Drawn as a crosshair, a head-sized circle (0.25 m wide) and a dot at the offset, with the metres beside it;
  // a distance slider (5..30 m) moves the dot live. The coach stores no distance for these findings, so 15 m is assumed unless
  // the evidence carries one (distanceMetres / rangeMetres).
  const DIST_DEFAULT = 15, DIST_MIN = 5, DIST_MAX = 30, HEAD_M = 0.25;
  const angleOffset = (deg, d) => d * Math.tan((deg * Math.PI) / 180);
  const distOf = (e) => { const v = [e.distanceMetres, e.rangeMetres, e.medianRangeMetres].find(num); return num(v) ? { d: clampNum(Math.round(v), DIST_MIN, DIST_MAX), assumed: false } : { d: DIST_DEFAULT, assumed: true }; };
  // The dot's place and label for the distance d: { x, y, m } in the svg's units (centre 110, 100; scale px per metre).
  function anglePoint(yawDeg, pitchDeg, d, scale) {
    const ox = angleOffset(yawDeg, d), oy = angleOffset(pitchDeg, d);
    return { x: +(110 + ox * scale).toFixed(1), y: +(100 - oy * scale).toFixed(1), m: Math.hypot(ox, oy) };
  }
  function angleHtml(yawDeg, pitchDeg, dist, what) {
    const { d, assumed } = dist || { d: DIST_DEFAULT, assumed: true };
    const deg = Math.hypot(yawDeg, pitchDeg), far = angleOffset(Math.min(deg, 60), DIST_MAX);
    const scale = 88 / Math.max(0.4, far * 1.12); // px per metre, fixed for the slider's whole range so the dot moves
    const pt = anglePoint(yawDeg, pitchDeg, d, scale), r = ((HEAD_M / 2) * scale).toFixed(1);
    const svg = `<svg viewBox="0 0 220 200" data-deg data-yaw="${yawDeg}" data-pitch="${pitchDeg}" data-scale="${scale.toFixed(4)}" role="img" aria-label="${+deg.toFixed(2)} degrees is ${pt.m.toFixed(2)} m at ${d} m">`
      + `<rect x="0" y="0" width="220" height="200" fill="none"/><line x1="96" x2="124" y1="100" y2="100" stroke="#fff" stroke-width="1.5"/><line x1="110" x2="110" y1="86" y2="114" stroke="#fff" stroke-width="1.5"/>`
      + `<circle cx="110" cy="100" r="${r}" fill="none" stroke="var(--an-good)" stroke-width="1.5" stroke-dasharray="3 2"><title>A head, about ${HEAD_M} m wide</title></circle>`
      + `<line data-deg-ray x1="110" y1="100" x2="${pt.x}" y2="${pt.y}" stroke="var(--an-tip)" stroke-width="1" stroke-dasharray="2 2"/>`
      + `<circle data-deg-dot cx="${pt.x}" cy="${pt.y}" r="5" fill="var(--an-tip)" stroke="#05070a" stroke-width="1.5"/>`
      + `<text data-deg-m x="${pt.x + 9}" y="${pt.y - 8}" class="is-key">${pt.m.toFixed(2)} m</text>`
      + `<text x="6" y="194">head ≈ ${HEAD_M} m</text></svg>`;
    return `<h5>What this means</h5>${svg}`
      + `<label class="aim-an-dist">Distance<input type="range" min="${DIST_MIN}" max="${DIST_MAX}" step="1" value="${d}" data-deg-dist aria-label="Distance to the target in metres"><output>${d} m</output></label>`
      + `<p class="aim-an-note" data-deg-caption>${esc(what ? what[0].toUpperCase() + what.slice(1) : "The offset")}: ${+deg.toFixed(2)}° is <b data-deg-text>${pt.m.toFixed(2)} m at ${d} m</b> (offset = distance × tan(angle); the green circle is a head).`
      + ` For example, 2.79° at 15 m is about ${angleOffset(2.79, 15).toFixed(2)} m.${assumed ? ` The distance is not recorded, so ${DIST_DEFAULT} m is assumed: move the slider for other ranges.` : ""}</p>`;
  }
  // A text split into its lead (every sentence but the last) and its last sentence (the advice) when there is more than one.
  function sentences(text) {
    const list = String(text || "").split(/(?<=[.!?])\s+(?=[A-Z(])/).filter(Boolean);
    return list.length > 1 ? { lead: list.slice(0, -1).join(" "), advice: list[list.length - 1] } : { lead: list[0] || "", advice: "" };
  }
  // The map's picture as the training gallery shows it (17 Nov 2026): the gallery's cards use localMapById(map).cover when the
  // page has it, else /aim-maps/<map>.cover.webp, drawn object-fit: cover in a 260 x 140 frame with a crop per card
  // position; the card here uses the gallery's centre crop (50% 30%).
  const MAP_CROP = "50% 30%";
  function mapCover(map) {
    try { const m = typeof window.localMapById === "function" ? window.localMapById(map) : null; if (m && typeof m.cover === "string") return m.cover; } catch {}
    return `/aim-maps/${encodeURIComponent(map)}.cover.webp`;
  }
  const mapCardHtml = (map) => `<img src="${esc(mapCover(map))}" alt="" style="object-position:${MAP_CROP}" loading="lazy" decoding="async"><b>${esc(map)}</b>`;
  // A drill's hover card: the same picture (its map's), its title, then its map and mode; the short code when the gallery's
  // list does not have it. map: the finding's map, used when the list has none for the drill.
  function drillCardHtml(code, map) {
    const d = drillBook.get(code) || {}, m = d.map || (map && MAP_RE.test(map) ? map : null);
    const meta = [m ? `Map ${m}` : "", d.mode ? `Mode ${d.mode}` : ""].filter(Boolean).join(" · ");
    return (m ? `<img src="${esc(mapCover(m))}" alt="" style="object-position:${MAP_CROP}" loading="lazy" decoding="async">` : "")
      + `<b>${esc(drillLabel(code))}</b><span class="aim-an-refmeta">${esc(meta || "Drill " + shortCode(code))}</span><span class="aim-an-refmeta">Click or Enter: play this drill</span>`;
  }
  // A trailing parenthetical note ("(Shots you fire on purpose ...)") is fine print, not part of the finding's text.
  function splitNote(text) {
    const m = String(text || "").match(/^([\s\S]*?)\s*\(([^()]+)\)\s*$/);
    return m && m[1] ? { main: m[1], note: m[2] } : { main: String(text || ""), note: "" };
  }
  // The gallery: one equal-size card per finding (see the comment at SEV). The card (focusable) and its "Numbers" button both
  // carry data-coach = the finding's index; either opens the tip modal. Its parts, in their fixed grid cells: the icon, the
  // title (h4, two lines at most), the summary (one line), the small visual or the clamped text, and the Numbers button.
  function coachHtml(list, failed) {
    if (failed) return `<p class="aim-an-msg">The coach is not available in this window.</p>`;
    if (!list.length) return `<p class="aim-an-msg">No findings yet. The coach needs a few rounds of data for each rule before it says anything.</p>`;
    const items = list.filter(isFinding).map((f, i) => {
      const hid = `aim-an-coach-${i}`, { main: body } = splitNote(f.detail), refs = refsOf(f, f.detail);
      const main = labelCodes(cardSummary(f), refs), vis = cardVisual(f), lead = sentences(body).lead;
      const extra = vis ? `<div class="aim-an-card-vis" aria-hidden="true">${vis}</div>` : lead ? `<p class="aim-an-card-text">${withRefs(lead, refs)}</p>` : "";
      return `<li class="is-${sevOf(f)}" data-id="${esc(f.id)}"><article class="aim-an-card" tabindex="0" data-coach="${i}" aria-haspopup="dialog" aria-labelledby="${hid}">`
        + `<span class="aim-an-icon">${coachIcon(f.id)}</span><h4 id="${hid}">${esc(labelCodes(f.title, refs))}</h4><span class="aim-an-main">${esc(main)}</span>${extra}`
        + `<button type="button" class="aim-an-numbers" data-coach="${i}" aria-haspopup="dialog" aria-describedby="${hid}">Numbers</button></article></li>`;
    });
    return `<ul class="aim-an-coach">${items.join("")}</ul>`;
  }
  // The tip modal's inside for one finding: the head (icon, severity, sample, title, summary, close button), then the full
  // detail, the visual at full size, the advice, the "Numbers" list and the fine print. Map names and drills are reference
  // spans (refHtml) in the text and in the Numbers list.
  const TIPM_TITLE = "aim-an-tipm-title";
  function coachModalHtml(f) {
    const sev = sevOf(f), { main: body, note } = splitNote(f.detail), refs = refsOf(f, f.detail), main = labelCodes(cardSummary(f), refs);
    const ev = f.evidence && typeof f.evidence === "object" ? Object.keys(f.evidence) : [];
    const vis = coachVisual(f), t = sentences(body);
    const lead = t.lead ? `<p class="aim-an-lead">${withRefs(t.lead, refs)}</p>` : "";
    const advice = t.advice ? `<p class="aim-an-advice">${withRefs(t.advice, refs)}</p>` : "";
    const value = (v) => (typeof v === "string" && (refs.drills.includes(v) || refs.maps.includes(v)) ? withRefs(v, refs)
      : Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object" && !Array.isArray(x)) ? v.map((x) => esc(Object.keys(x).map((a) => keyLabel(a).toLowerCase() + " " + evidenceText(x[a])).join(", "))).join("<br>")
      : Array.isArray(v) ? esc(v.map(evidenceText).join(", ")) : esc(evidenceText(v)));
    const numbers = ev.length ? `<div class="aim-an-why"><h5>Numbers</h5><dl>${ev.map((k) => `<dt title="${esc(k)}">${esc(keyLabel(k))}</dt><dd>${value(f.evidence[k])}</dd>`).join("")}</dl></div>` : "";
    return `<header class="es-tool-head aim-an-tipm-head"><span class="aim-an-icon">${coachIcon(f.id)}</span><div class="aim-an-tipm-titles">`
      + `<span class="aim-an-coach-top"><span class="aim-an-sev">${SEV[sev]}</span><span class="aim-an-sample">sample ${num(f.sample) ? esc(f.sample) : "–"}</span></span>`
      + `<h3 id="${TIPM_TITLE}">${esc(labelCodes(f.title, refs))}</h3>${main ? `<p class="aim-an-main">${esc(main)}</p>` : ""}</div>`
      + `<button type="button" class="es-tool-x" data-tipm-close aria-label="Close">✕</button></header>`
      + `<div class="es-tool-body aim-an-detail">${lead}${vis ? `<div class="aim-an-vis">${vis}</div>` : ""}${advice}${numbers}`
      + `${note ? `<p class="aim-an-fine">${esc(labelCodes(note, refs))}</p>` : ""}</div>`;
  }

  // ---------------------------------------------------------------- the Stats panel
  // Two ways to show it, built by the same code (buildStats) with the same tabs, views, caches and handlers:
  //   open()            the modal dialog (backdrop, ✕, Esc and a click on the backdrop close it); kept for any caller.
  //   mountInline(host) page content (17 Nov 2026): no backdrop, no ✕, no Esc-close, no focus trap. The Training history
  //                     page gets one through syncStatsHost() below.
  // Each panel state p: { root, shade, tabs, content, tip, alive, inline, tab, cache, filter, range, minis, fights, bright,
  // zoom, zoomKey, focus }. Renders check p.alive and p.tab, so a closed panel or a switched tab drops a late answer.
  let panel = null;       // the open modal panel
  let inlinePanel = null; // the panel mounted in the page
  function close() { if (tipBox && tipBox.p === panel) closeTip(false); if (panel) { panel.alive = false; try { panel.shade.remove(); } catch {} } panel = null; }
  const VIEWS = [["session", "Session"], ["drills", "Drills"], ["progress", "Progress"], ["compare", "Compare"], ["heatmap", "Heatmap"], ["tracking", "Tracking"], ["coach", "Coach"]];
  const DEFAULT_VIEW = "session";
  const closestOf = (target, sel) => (target && target.closest ? target.closest(sel) : null);
  function buildStats(inline) {
    const box = document.createElement("section");
    box.className = "es-tool aim-an-panel" + (inline ? " aim-an-inline" : "");
    if (!inline) box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Stats");
    const head = document.createElement("header");
    head.className = "es-tool-head";
    head.innerHTML = `<div><h2>Stats</h2><p>Where you die, how your aim changes over time, and what the coach sees in your rounds. Recorded on this PC only.</p></div>`;
    const tabs = document.createElement("div");
    tabs.className = "aim-an-tabs";
    tabs.setAttribute("role", "tablist");
    const body = document.createElement("div");
    body.className = "es-tool-body aim-an-body";
    const content = document.createElement("div");
    content.className = "aim-an-content";
    const tip = document.createElement("div");
    tip.className = "aim-an-tipbox";
    tip.setAttribute("role", "tooltip");
    tip.hidden = true;
    const foot = document.createElement("div");
    foot.className = "aim-an-foot";
    foot.innerHTML = FOOT_HTML;
    body.append(tabs, content, foot);
    box.append(head, body, tip);
    const p = { root: box, head, foot, shade: null, tabs, content, tip, alive: true, inline, tab: null, cache: {}, filter: { map: "", mode: ALL, code: ALL, weapon: ALL, layer: "deaths" },
      range: DEFAULT_RANGE, sessionIdx: null, drawn: new Set(), enter: null, drillSort: "recent", drillOpen: null, cmpRange: 7, trackTarget: "body", minis: new Map(), fights: new Map(), bright: readBright(), zoom: { k: 1, tx: 0, ty: 0 }, zoomKey: "", focus: null };
    for (const [id, label] of VIEWS) {
      const b = document.createElement("button");
      b.type = "button"; b.dataset.view = id; b.textContent = label;
      b.addEventListener("click", () => show(id, p));
      tabs.appendChild(b);
    }
    content.addEventListener("click", (event) => {
      const b = closestOf(event.target, "[data-range]");
      if (b) { p.range = RANGES.includes(+b.dataset.range) ? +b.dataset.range : DEFAULT_RANGE; renderProgress(p); return; }
      const ss = closestOf(event.target, "[data-session]");
      if (ss) { p.sessionIdx = +ss.dataset.session; renderSession(p); return; }
      const so = closestOf(event.target, "[data-sort]");
      if (so) { p.drillSort = so.dataset.sort; renderDrills(p); return; }
      const dopen = closestOf(event.target, "[data-drill-open]");
      if (dopen) { p.drillOpen = dopen.dataset.drillOpen; try { p.content.scrollTop = 0; } catch {} renderDrills(p); return; }
      if (closestOf(event.target, "[data-drill-back]")) { p.drillOpen = null; try { p.content.scrollTop = 0; } catch {} renderDrills(p); return; }
      const gm = closestOf(event.target, "[data-goal-medal]");
      if (gm) { goalAction(p, { type: "medal", tier: gm.dataset.goalMedal }); return; }
      const gd = closestOf(event.target, "[data-goal-del]");
      if (gd) { goalRemove(p, gd.dataset.goalDel); return; }
      if (closestOf(event.target, "[data-warmup-save]")) { saveWarmup(p); return; }
      const cr = closestOf(event.target, "[data-cmp-range]");
      if (cr) { p.cmpRange = COMPARE_RANGES.includes(+cr.dataset.cmpRange) ? +cr.dataset.cmpRange : 7; renderCompare(p); return; }
      const tt = closestOf(event.target, "[data-track]");
      if (tt && (tt.dataset.track === "body" || tt.dataset.track === "head")) { p.trackTarget = tt.dataset.track; renderTracking(p); return; }
      const l = closestOf(event.target, "[data-layer]");
      if (l && LAYERS.some((x) => x[0] === l.dataset.layer)) { p.filter.layer = l.dataset.layer; renderHeatmap(p); return; }
      if (refClick(event)) return;
      const nb = closestOf(event.target, "[data-coach]");
      if (nb) { openTip(p, +nb.dataset.coach, nb); return; }
      const fo = closestOf(event.target, "[data-focus]");
      if (fo) { p.focus = fo.dataset.focus; renderProgress(p); return; }
      if (closestOf(event.target, "[data-zoom-reset]")) { setZoom(p, { k: 1, tx: 0, ty: 0 }); return; }
      // a tap (touch screens have no hover) shows the hover card of what was tapped
      const tp = closestOf(event.target, "[data-tip]");
      if (tp) showTip(p, tp, event);
    });
    // the goal forms (score, on the body)
    content.addEventListener("submit", (event) => {
      const f = closestOf(event.target, "[data-goal-form]");
      if (!f) return;
      if (event.preventDefault) event.preventDefault();
      const input = f.elements && f.elements.v ? f.elements.v : f.querySelector("input"), v = Number(input && input.value);
      if (!input || input.value === "" || !isFinite(v)) { goalAction(p, { type: "score", target: NaN }); return; }
      goalAction(p, f.dataset.goalForm === "body" ? { type: "body", percent: v } : { type: "score", target: v });
    });
    foot.addEventListener("click", (event) => { const b = closestOf(event.target, "[data-export]"); if (b) runExport(p, b.dataset.export); });
    // "Brighten map" slider: updates the picture in place (no re-render, so the slider keeps focus while dragged) and remembers the level.
    content.addEventListener("input", (event) => {
      const r = event.target;
      if (r && r.dataset && "degDist" in r.dataset) { updateAngle(r); return; }
      if (!r || !r.dataset || !("bright" in r.dataset)) return;
      p.bright = clampBright(r.value);
      try { localStorage.setItem(BRIGHT_KEY, String(p.bright)); } catch {}
      const look = mapLook(p.bright), img = content.querySelector(".aim-an-minimap"), lift = content.querySelector(".aim-an-lift");
      const out = r.parentElement && r.parentElement.querySelector ? r.parentElement.querySelector("output") : null;
      if (img) { img.setAttribute("opacity", look.opacity); img.style.filter = look.filter; }
      if (lift) lift.setAttribute("fill-opacity", look.lift);
      if (out) out.textContent = p.bright + "%";
    });
    content.addEventListener("change", (event) => {
      const s = event.target;
      if (!s || !s.dataset || !s.dataset.filter) return;
      p.filter[s.dataset.filter] = s.value;
      renderHeatmap(p);
    });
    content.addEventListener("keydown", (event) => {
      // a focused chart, round strip or score chart: arrows, Home and End step through its points and show each one's hover card; Esc hides it
      const nav = closestOf(event.target, "[data-tipnav]");
      if (nav && nav === event.target) {
        const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1, Home: -Infinity, End: Infinity }[event.key];
        if (step !== undefined) { if (event.preventDefault) event.preventDefault(); stepTip(p, nav, step); return; }
        if (event.key === "Escape") { tipOff(p, nav); return; }
      }
      if (refKey(event)) return;
      // a focused coach card: Enter and Space open its tip (its Numbers button is a real button and clicks on its own)
      const cc = (event.key === "Enter" || event.key === " ") && !event.repeat && closestOf(event.target, "[data-coach]");
      if (cc && cc === event.target && cc.tagName !== "BUTTON") { if (event.preventDefault) event.preventDefault(); openTip(p, +cc.dataset.coach, cc); return; }
      // thumbnails are role=button divs: Enter and Space pick them like a click
      const dr = (event.key === "Enter" || event.key === " ") && !event.repeat && closestOf(event.target, "[data-drill-open]");
      if (dr && dr === event.target) { event.preventDefault && event.preventDefault(); p.drillOpen = dr.dataset.drillOpen; try { p.content.scrollTop = 0; } catch {} renderDrills(p); return; }
      const fo = (event.key === "Enter" || event.key === " ") && closestOf(event.target, "[data-focus]");
      if (fo) { event.preventDefault && event.preventDefault(); p.focus = fo.dataset.focus; renderProgress(p); }
    });
    // hover cards: any element with data-tip (heatmap cells, chart nodes)
    content.addEventListener("mousemove", (event) => {
      const t = !p.drag && closestOf(event.target, "[data-tip]");
      if (t) showTip(p, t, event); else hideTip(p);
    });
    content.addEventListener("mouseleave", () => hideTip(p));
    wireRefs(content);
    // focus by keyboard on a chart shows its newest point at once; leaving it hides the card
    content.addEventListener("focusin", (event) => { const nav = event.target; if (nav && nav.matches && nav.matches("[data-tipnav]:focus-visible")) stepTip(p, nav, Infinity); });
    content.addEventListener("focusout", (event) => { const nav = event.target; if (nav && nav.dataset && "tipnav" in nav.dataset) tipOff(p, nav); });
    // map zoom: wheel around the cursor, drag to pan, double-click resets
    content.addEventListener("wheel", (event) => {
      const svg = mapSvg(event.target);
      if (!svg) return;
      event.preventDefault();
      const v = svgPoint(svg, event);
      if (v) setZoom(p, zoomAt(p.zoom, v.vb, v.x, v.y, Math.exp(-clampNum(event.deltaY, -300, 300) * 0.0015)));
    }, { passive: false });
    content.addEventListener("mousedown", (event) => {
      const svg = mapSvg(event.target);
      if (!svg || event.button !== 0 || p.zoom.k <= 1) return;
      event.preventDefault();
      const v = svgPoint(svg, event);
      if (!v) return;
      const start = { x: event.clientX, y: event.clientY, tx: p.zoom.tx, ty: p.zoom.ty, sx: v.vb.width / v.rect.width, sy: v.vb.height / v.rect.height, vb: v.vb };
      const map = closestOf(svg, ".aim-an-map");
      p.drag = true; hideTip(p);
      if (map) map.classList.add("is-dragging");
      const move = (e) => setZoom(p, clampPan({ k: p.zoom.k, tx: start.tx + (e.clientX - start.x) * start.sx, ty: start.ty + (e.clientY - start.y) * start.sy }, start.vb));
      const up = () => { p.drag = false; if (map) map.classList.remove("is-dragging"); document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
    content.addEventListener("dblclick", (event) => { if (mapSvg(event.target)) setZoom(p, { k: 1, tx: 0, ty: 0 }); });
    return p;
  }
  // The reference card (map or drill): one element on the body (fixed, above the Stats dialog and the tip modal), placed under
  // the name and kept in the viewport. dataset.ref = "map:<name>" or "drill:<code>".
  let mapCard = null;
  const refKeyOf = (ref) => { const d = (ref && ref.dataset) || {}; return d.drill ? "drill:" + d.drill : d.map ? "map:" + d.map : ""; };
  function showMapCard(ref) {
    try {
      const key = refKeyOf(ref);
      if (!key) return;
      if (!mapCard) { mapCard = document.createElement("div"); mapCard.className = "aim-an-mapcard"; mapCard.setAttribute("role", "tooltip"); document.body.appendChild(mapCard); }
      if (mapCard.dataset.ref !== key) {
        mapCard.dataset.ref = key;
        mapCard.innerHTML = ref.dataset.drill ? drillCardHtml(ref.dataset.drill, ref.dataset.drillMap) : mapCardHtml(ref.dataset.map);
      }
      mapCard.hidden = false;
      const r = ref.getBoundingClientRect(), w = mapCard.offsetWidth || 260, h = mapCard.offsetHeight || 170, vw = innerWidth, vh = innerHeight;
      let x = r.left, y = r.bottom + 8;
      if (y + h > vh - 8) y = r.top - h - 8;
      mapCard.style.left = Math.round(Math.max(8, Math.min(x, vw - w - 8))) + "px";
      mapCard.style.top = Math.round(Math.max(8, Math.min(y, vh - h - 8))) + "px";
    } catch {}
  }
  function hideMapCard() { if (mapCard && !mapCard.hidden) mapCard.hidden = true; }
  const refOf = (target) => closestOf(target, "[data-drill]") || closestOf(target, "[data-map]");
  // Hover and keyboard focus on a reference show its card (on a touch-only screen a tap does, see refClick).
  function wireRefs(el) {
    const touchOnly = () => { try { return matchMedia("(hover: none)").matches; } catch { return false; } };
    el.addEventListener("mouseover", (event) => { const m = refOf(event.target); if (m && !touchOnly()) showMapCard(m); });
    el.addEventListener("mouseout", (event) => { const m = refOf(event.target); if (m && !(event.relatedTarget && m.contains && m.contains(event.relatedTarget))) hideMapCard(); });
    el.addEventListener("focusin", (event) => { const m = refOf(event.target); if (m) showMapCard(m); });
    el.addEventListener("focusout", (event) => { if (refOf(event.target)) hideMapCard(); });
    el.addEventListener("mouseleave", () => hideMapCard());
  }
  // A click on a reference: a drill starts; a map name toggles its card (the tap on a touch screen). true when handled.
  function refClick(event) {
    const m = refOf(event.target);
    if (!m) return false;
    if (m.dataset.drill) { if (event.preventDefault) event.preventDefault(); startDrill(m.dataset.drill); return true; }
    if (mapCard && !mapCard.hidden && mapCard.dataset.ref === refKeyOf(m)) hideMapCard(); else showMapCard(m);
    return true;
  }
  // Enter on a drill reference starts it (a link); true when handled.
  function refKey(event) {
    const m = event.key === "Enter" && !event.repeat ? closestOf(event.target, "[data-drill]") : null;
    if (!m) return false;
    if (event.preventDefault) event.preventDefault();
    startDrill(m.dataset.drill);
    return true;
  }
  // Starts a drill the way the lobby does (and sibling-switch.js): the first top tab (VALORANT Training) is shown, then the
  // drill's lobby card ([data-role="workshop-card"][data-share-code]) has its Start button clicked, which runs the game's own
  // start function. The tip modal and the Stats dialog close first. Not during a round (the training layer is up). Resolves
  // to true when a Start button was clicked.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let starting = false;
  async function startDrill(code) {
    if (starting || !CODE_RE.test(String(code || ""))) return false;
    starting = true;
    try {
      closeTip(false); hideMapCard(); close();
      if (document.querySelector(".al-aimlab-root")) return false;
      const tab = document.querySelector(".hall-tab");
      if (tab && !tab.classList.contains("is-active")) tab.click();
      const until = Date.now() + 15000;
      while (Date.now() < until) {
        const card = document.querySelector(`[data-role="workshop-card"][data-share-code="${code}"]`);
        const go = card && card.querySelector(".al-wk-split-go, .al-wk-go");
        if (card && card.scrollIntoView) card.scrollIntoView({ block: "center" });
        if (go) { go.click(); return true; }
        await wait(150);
      }
      try { console.warn(`Coach: no lobby card for drill ${code} (is a search filter hiding it?)`); } catch {}
      return false;
    } catch { return false; } finally { starting = false; }
  }

  // ---------------------------------------------------------------- the tip modal (17 Nov 2026)
  // A coach card (a click, or Enter / Space when focused) or its "Numbers" button opens it: a dialog on the body above the
  // Stats panel (and the Training history page), with the finding's full content (coachModalHtml). Esc, the ✕ and a click
  // on the backdrop close it, and focus goes back to what opened it (the card or its Numbers button). Tab and Shift+Tab stay inside it; key presses do not reach the game.
  // One at a time; a tab switch, the Stats dialog closing or the history page hiding closes it too.
  let tipBox = null; // { shade, box, opener, p, i, down, onFocus }
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function openTip(p, i, opener) {
    const f = p && Array.isArray(p.coachList) ? p.coachList[i] : null;
    if (!isFinding(f)) return null;
    closeTip(false);
    injectCss();
    const shade = document.createElement("div");
    shade.className = "es-tool-shade aim-an-tipm-shade";
    const box = document.createElement("section");
    box.className = `es-tool aim-an-tipm is-${sevOf(f)}`;
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", TIPM_TITLE);
    box.setAttribute("tabindex", "-1");
    box.innerHTML = coachModalHtml(f);
    shade.appendChild(box);
    const t = { shade, box, opener, p, i, down: null, onFocus: null };
    shade.addEventListener("mousedown", (event) => { t.down = event.target; });
    shade.addEventListener("click", (event) => {
      const down = t.down; t.down = null;
      if (event.target === shade) { if (down === shade) closeTip(true); return; } // a drag that ends on the backdrop does not close it
      if (closestOf(event.target, "[data-tipm-close]")) { closeTip(true); return; }
      refClick(event);
    });
    for (const type of ["keydown", "keyup", "keypress"]) {
      shade.addEventListener(type, (event) => {
        if (type === "keydown") {
          if (event.key === "Escape") { if (event.preventDefault) event.preventDefault(); closeTip(true); }
          else if (event.key === "Tab") trapTab(event, box);
          else refKey(event);
        }
        if (event.stopPropagation) event.stopPropagation();
      });
    }
    box.addEventListener("input", (event) => { const r = event.target; if (r && r.dataset && "degDist" in r.dataset) updateAngle(r); });
    wireRefs(box);
    document.body.appendChild(shade);
    tipBox = t;
    // focus that leaves the dialog (a click elsewhere, a script) is brought back
    t.onFocus = (event) => { if (tipBox === t && !(box.contains && box.contains(event.target))) { try { box.focus(); } catch {} } };
    try { document.addEventListener("focusin", t.onFocus, true); } catch {}
    try { box.focus({ preventScroll: true }); } catch {}
    return t;
  }
  // restore: give focus back to the card or Numbers button that opened it (the card, found again by its index, after a re-render).
  function closeTip(restore) {
    const t = tipBox;
    if (!t) return;
    tipBox = null;
    hideMapCard();
    try { document.removeEventListener("focusin", t.onFocus, true); } catch {}
    try { t.shade.remove(); } catch {}
    if (!restore) return;
    let el = t.opener;
    if (!el || el.isConnected === false) { try { el = t.p.content.querySelector(`[data-coach="${t.i}"]`); } catch { el = null; } }
    try { if (el && el.focus) el.focus(); } catch {}
  }
  function trapTab(event, box) {
    try {
      const list = [...box.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      const a = document.activeElement;
      if (!list.length) { event.preventDefault(); box.focus(); return; }
      const first = list[0], last = list[list.length - 1];
      if (event.shiftKey && (a === first || a === box)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (a === last || !box.contains(a))) { event.preventDefault(); first.focus(); }
    } catch {}
  }
  const mapSvg = (target) => { const m = closestOf(target, ".aim-an-map"); return m && m.querySelector ? m.querySelector("svg") : null; };
  // The viewBox point under the mouse: { x, y, vb, rect }, or null when the svg has no size.
  function svgPoint(svg, event) {
    const vb = svg.viewBox && svg.viewBox.baseVal, rect = svg.getBoundingClientRect();
    if (!vb || !rect.width || !rect.height) return null;
    return { x: vb.x + ((event.clientX - rect.left) / rect.width) * vb.width, y: vb.y + ((event.clientY - rect.top) / rect.height) * vb.height, vb: { x: vb.x, y: vb.y, width: vb.width, height: vb.height }, rect };
  }
  // Applies a zoom to the drawn map in place (no re-render) and remembers it for the next render of the same map.
  function setZoom(p, z) {
    p.zoom = z;
    const g = p.content.querySelector && p.content.querySelector(".aim-an-zoom");
    if (g && g.setAttribute) g.setAttribute("transform", zoomTransform(z));
    const map = p.content.querySelector && p.content.querySelector(".aim-an-map");
    if (map && map.classList && map.classList.toggle) map.classList.toggle("is-zoomed", z.k > 1);
  }
  // The hover card near the cursor, kept inside the panel (flipped to the other side of the cursor at an edge).
  function showTip(p, el, event) {
    const text = el.getAttribute && el.getAttribute("data-tip");
    if (!text) return hideTip(p);
    const tip = p.tip, root = p.root;
    if (tip.dataset.text !== text) {
      tip.dataset.text = text;
      tip.textContent = "";
      // a line with a tab is a value line: large value, its share in the top-right corner; the last line (when there are
      // value lines) is the small one; a text with no value line keeps its first line large (chart nodes)
      const lines = text.split("\n"), values = lines.some((l) => l.includes("\t"));
      lines.forEach((line, i) => {
        if (line.includes("\t")) {
          const [v, share] = line.split("\t");
          const row = document.createElement("div"), b = document.createElement("b"), em = document.createElement("em");
          row.className = "aim-an-tip-row"; b.textContent = v; em.textContent = share;
          row.append(b, em); tip.appendChild(row);
          return;
        }
        const last = i === lines.length - 1 && (values ? lines.length > 1 : lines.length > 2);
        const el = document.createElement(!values && i === 0 ? "b" : last ? "small" : "span");
        el.textContent = line;
        tip.appendChild(el);
      });
    }
    tip.hidden = false;
    try {
      const r = root.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
      const cx = event.clientX - r.left + root.scrollLeft, cy = event.clientY - r.top + root.scrollTop;
      const minX = root.scrollLeft + 6, maxX = root.scrollLeft + root.clientWidth - w - 6, minY = root.scrollTop + 6, maxY = root.scrollTop + root.clientHeight - h - 6;
      let x = cx + 14, y = cy + 16;
      if (x > maxX) x = cx - w - 14;
      if (y > maxY) y = cy - h - 12;
      tip.style.left = Math.round(Math.max(minX, Math.min(x, maxX))) + "px";
      tip.style.top = Math.round(Math.max(minY, Math.min(y, maxY))) + "px";
    } catch {}
  }
  function hideTip(p) { if (p.tip && !p.tip.hidden) p.tip.hidden = true; }
  // Keyboard steps in a [data-tipnav] box: the next / previous point (step +-1) or the first / last (+-Infinity) gets is-active and its hover card.
  function stepTip(p, nav, step) {
    try {
      const items = [...nav.querySelectorAll("[data-tip]")];
      if (!items.length) return;
      const at = items.findIndex((el) => el.classList.contains("is-active"));
      const i = step === Infinity ? items.length - 1 : step === -Infinity ? 0 : at < 0 ? (step > 0 ? 0 : items.length - 1) : clampNum(at + step, 0, items.length - 1);
      items.forEach((el, k) => el.classList.toggle("is-active", k === i));
      const r = items[i].getBoundingClientRect();
      showTip(p, items[i], { clientX: r.left + r.width / 2, clientY: r.top });
    } catch {}
  }
  function tipOff(p, nav) { hideTip(p); try { for (const el of nav.querySelectorAll(".is-active")) el.classList.remove("is-active"); } catch {} }
  // After a view is drawn: the entrance on a tab switch (once), and a chart's draw the first time that chart is shown (p.drawn keys), never on a
  // redraw of the same chart. Classes only; the CSS keeps it to transform / opacity / clip-path and drops it under prefers-reduced-motion.
  const DRAWS = { progress: (p) => ["progress|" + p.range + "|" + (p.focus || ""), ".aim-an-focus"], session: (p) => ["session|" + p.sessionIdx, ".aim-an-tl-wrap"],
    drills: (p) => (p.drillOpen ? ["drill|" + p.drillOpen, ".aim-an-scorewrap"] : null), compare: (p) => ["compare|" + p.cmpRange, ".aim-an-cmp-grid"] };
  function painted(p) {
    try {
      const c = p.content;
      if (p.enter && p.enter === p.tab) {
        p.enter = null;
        c.classList.remove("aim-an-view-in"); void c.offsetWidth; c.classList.add("aim-an-view-in");
        clearTimeout(p.enterTimer); p.enterTimer = setTimeout(() => { try { c.classList.remove("aim-an-view-in"); } catch {} }, 260);
      }
      const d = DRAWS[p.tab] && DRAWS[p.tab](p);
      if (!d || p.drawn.has(d[0])) return;
      const el = c.querySelector(d[1]);
      if (el) { p.drawn.add(d[0]); el.classList.add("aim-an-draw"); }
    } catch {}
  }
  // The distance slider of a "What this means" visual: moves the dot, the ray and the metres in place.
  function updateAngle(input) {
    try {
      const vis = input.closest(".aim-an-vis"), svg = vis && vis.querySelector("svg[data-deg]");
      if (!svg) return;
      const d = clampNum(Math.round(+input.value) || DIST_DEFAULT, DIST_MIN, DIST_MAX);
      const pt = anglePoint(+svg.dataset.yaw, +svg.dataset.pitch, d, +svg.dataset.scale);
      const dot = svg.querySelector("[data-deg-dot]"), ray = svg.querySelector("[data-deg-ray]"), label = svg.querySelector("[data-deg-m]");
      if (dot) { dot.setAttribute("cx", pt.x); dot.setAttribute("cy", pt.y); }
      if (ray) { ray.setAttribute("x2", pt.x); ray.setAttribute("y2", pt.y); }
      if (label) { label.setAttribute("x", pt.x + 9); label.setAttribute("y", pt.y - 8); label.textContent = pt.m.toFixed(2) + " m"; }
      const out = input.parentElement && input.parentElement.querySelector("output"), text = vis.querySelector("[data-deg-text]");
      if (out) out.textContent = d + " m";
      if (text) text.textContent = pt.m.toFixed(2) + " m at " + d + " m";
    } catch {}
  }
  function open(view) {
    injectCss();
    close();
    const p = buildStats(false);
    const shade = document.createElement("div");
    shade.className = "es-tool-shade aim-an-shade";
    const x = document.createElement("button");
    x.type = "button"; x.className = "es-tool-x"; x.setAttribute("aria-label", "Close"); x.textContent = "✕";
    p.head.appendChild(x);
    shade.appendChild(p.root);
    p.shade = shade;
    x.addEventListener("click", close);
    shade.addEventListener("mousedown", (event) => { if (event.target === shade) close(); });
    for (const type of ["keydown", "keyup", "keypress"]) {
      shade.addEventListener(type, (event) => { if (type === "keydown" && event.key === "Escape") close(); event.stopPropagation(); });
    }
    document.body.appendChild(shade);
    panel = p;
    show(VIEWS.some((v) => v[0] === view) ? view : DEFAULT_VIEW, p);
    return p;
  }
  // Mounts the Stats panel inside host as page content. Mounting into the same host again keeps the panel (and its tab and
  // filters); another host gets a fresh one.
  function mountInline(host, view) {
    injectCss();
    if (!host || typeof host.appendChild !== "function") return null;
    if (inlinePanel && inlinePanel.root.parentElement === host) return inlinePanel;
    if (inlinePanel) { inlinePanel.alive = false; try { inlinePanel.root.remove(); } catch {} }
    const p = buildStats(true);
    host.appendChild(p.root);
    inlinePanel = p;
    show(VIEWS.some((v) => v[0] === view) ? view : DEFAULT_VIEW, p);
    return p;
  }
  // Drops the inline panel's cached reads and redraws its tab (new rounds may have been played since).
  function refreshInline() {
    const p = inlinePanel;
    if (!p) return;
    p.cache = {}; p.minis = new Map(); p.fights = new Map();
    drillLoad = null; // a drill may have been renamed or added since
    show(p.tab || DEFAULT_VIEW, p);
  }
  // Reads a view's data once per panel; later tab switches and filter changes reuse it.
  function dataFor(view, p) {
    const cache = p.cache;
    if (cache[view]) return cache[view];
    if (view === "heatmap") cache[view] = Promise.all([read("days", {}), read("rounds", { limit: RAW_ROUNDS })]).then(([days, rounds]) => ({ days, rounds }));
    else if (view === "progress") cache[view] = Promise.all([read("days", { from: daysAgo(PROGRESS_DAYS - 1) }), read("engagements", { rounds: RAW_ROUNDS })]).then(([days, engagements]) => ({ days, engagements }));
    else if (view === "session" || view === "drills") cache[view] = read("rounds", { limit: RAW_ROUNDS }).then((rounds) => ({ rounds }));
    else if (view === "compare") cache[view] = Promise.all([read("days", { from: daysAgo(2 * COMPARE_RANGES[COMPARE_RANGES.length - 1] - 1) }), read("rounds", { limit: RAW_ROUNDS })]).then(([days, rounds]) => ({ days, rounds }));
    else if (view === "tracking") cache[view] = read("engagements", { rounds: RAW_ROUNDS }).then((engagements) => ({ engagements }));
    else cache[view] = (async () => {
      try {
        const C = window.__aimCoach;
        if (!C || typeof C.insights !== "function") return { list: [], failed: true };
        const list = await C.insights({});
        return { list: Array.isArray(list) ? list : [], failed: false };
      } catch { return { list: [], failed: false }; }
    })();
    cache[view] = cache[view].catch(() => (view === "coach" ? { list: [], failed: false } : view === "session" || view === "drills" ? { rounds: [] } : view === "compare" ? { days: [], rounds: [] } : view === "heatmap" ? { days: [], rounds: [] } : { days: [], engagements: [] }));
    return cache[view];
  }
  function show(view, p = panel) {
    if (!p || !p.alive) return;
    if (p.tab !== view) { p.focus = null; p.enter = view; try { p.content.scrollTop = 0; } catch {} } // the focus chart lasts until another thumbnail or another Stats tab; a new tab starts at its top
    p.tab = view;
    hideTip(p);
    if (tipBox && tipBox.p === p) closeTip(false);
    for (const b of p.tabs.children) b.setAttribute("aria-pressed", String(b.dataset.view === view));
    p.content.innerHTML = `<p class="aim-an-msg">Loading…</p>`;
    if (view === "session") renderSession(p); else if (view === "drills") renderDrills(p); else if (view === "compare") renderCompare(p); else if (view === "heatmap") renderHeatmap(p); else if (view === "progress") renderProgress(p); else if (view === "tracking") renderTracking(p); else renderCoach(p);
  }
  const current = (p, view) => !!p && p.alive && p.tab === view;
  // The map's minimap info, fetched once per map per panel: { src, transform } or null.
  function miniFor(map, p) {
    if (!p || !/^[a-z0-9_-]{1,40}$/i.test(map || "")) return Promise.resolve(null);
    if (!p.minis.has(map)) {
      const q = (async () => {
        try {
          if (typeof fetch !== "function") return null;
          const res = await fetch(`/aim-maps/${map}.minimap.json`, { cache: "force-cache" });
          if (!res.ok) return null;
          const j = await res.json();
          return j && j.transform && typeof j.image === "string" && /^[\w.-]+\.(png|webp|jpg)$/i.test(j.image) ? { src: `/aim-maps/${j.image}`, transform: j.transform } : null;
        } catch { return null; }
      })();
      p.minis.set(map, q);
    }
    return p.minis.get(map);
  }
  // The fight read for a filter, once per filter per panel (see fightLayer): fightCells({map, code, weapon}), or with a mode
  // filter the engagements counted here; null when it failed. With only a map picked it still gives the count without a position.
  function fightsFor(f, p) {
    const key = [f.map, f.mode, f.code, f.weapon].join("|");
    if (!p.fights.has(key)) {
      const q = { map: f.map, code: f.code || undefined, weapon: f.weapon || undefined, rounds: RAW_ROUNDS };
      const r = f.mode ? read("engagements", q).then((rows) => countFights(rows, f.mode)) : readObj("fightCells", q);
      p.fights.set(key, r.catch(() => null));
    }
    return p.fights.get(key);
  }
  // The zoom to draw with: kept while the filters, layer and picture stay the same, back to 1x when they change (the
  // plain grid's viewBox depends on the cells drawn).
  function zoomFor(p, mini) {
    const key = JSON.stringify(p.filter) + "|" + (mini ? 1 : 0);
    if (key !== p.zoomKey) { p.zoomKey = key; p.zoom = { k: 1, tx: 0, ty: 0 }; }
    return p.zoom;
  }
  function renderHeatmap(p = panel) {
    if (!p) return Promise.resolve();
    hideTip(p);
    return Promise.all([dataFor("heatmap", p), namesReady()]).then(async ([data]) => {
      if (!current(p, "heatmap")) return;
      const f = p.filter, wantFights = f.layer !== "deaths";
      p.content.innerHTML = heatmapHtml(data.days, data.rounds, f, null, wantFights ? undefined : null, p.bright, zoomFor(p, null)); // also settles f.map
      painted(p);
      const state = JSON.stringify(f);
      const [mini, fights] = await Promise.all([miniFor(f.map, p), wantFights && f.map ? fightsFor(f, p) : null]);
      // a filter or layer change meanwhile started its own render
      if ((!mini && !wantFights) || !current(p, "heatmap") || JSON.stringify(p.filter) !== state) return;
      p.content.innerHTML = heatmapHtml(data.days, data.rounds, f, mini, fights, p.bright, zoomFor(p, mini));
      painted(p);
    }).catch(() => { if (current(p, "heatmap")) p.content.innerHTML = `<p class="aim-an-msg">Could not read your records.</p>`; });
  }
  function renderProgress(p = panel) {
    if (!p) return Promise.resolve();
    hideTip(p);
    // the stored rounds are read (once per panel) only when the range has few days of data
    return dataFor("progress", p).then(async (data) => {
      if (!current(p, "progress")) return;
      const range = p.range;
      let rounds = [];
      if (daysWithData(data.days, data.engagements, range) <= FEW_DAYS) {
        if (!p.cache.progressRounds) p.cache.progressRounds = read("rounds", { limit: RAW_ROUNDS });
        rounds = await p.cache.progressRounds;
      }
      if (current(p, "progress") && p.range === range) { p.content.innerHTML = progressHtml(data.days, data.engagements, range, undefined, rounds, p.focus); painted(p); }
    })
      .catch(() => { if (current(p, "progress")) p.content.innerHTML = `<p class="aim-an-msg">Could not read your records.</p>`; });
  }
  function renderTracking(p = panel) {
    if (!p) return Promise.resolve();
    hideTip(p);
    return dataFor("tracking", p).then((data) => {
      if (current(p, "tracking")) { p.content.innerHTML = trackingHtml(data.engagements, p.trackTarget); painted(p); }
    }).catch(() => { if (current(p, "tracking")) p.content.innerHTML = `<p class="aim-an-msg">Could not read your records.</p>`; });
  }
  function renderCoach(p = panel) {
    if (!p) return Promise.resolve();
    // the drill titles (loadDrills) are read before the first draw, so a share code never shows in place of a title
    return Promise.all([dataFor("coach", p), loadDrills()]).then(([data]) => {
      if (!current(p, "coach")) return;
      hideMapCard();
      p.coachList = data.list.filter(isFinding);
      p.content.innerHTML = coachHtml(data.list, data.failed);
      painted(p);
    }).catch(() => { if (current(p, "coach")) { p.coachList = []; p.content.innerHTML = coachHtml([], false); } });
  }

  // ---- the renderers of the new tabs (they read the medal history of routines.js without writing to it) ----
  function runsNow() { try { const R = window.__aimRoutines, v = R && typeof R.runs === "function" ? R.runs() : {}; return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } }
  function logicNow() { try { return (window.__aimRoutines && window.__aimRoutines.logic) || null; } catch { return null; } }
  // A drill's name: the gallery's title, else the name kept with its runs, else the short share code.
  const nameFor = (code, runs) => { const d = drillBook.get(code); return d && d.name ? d.name : runs && runs[code] && runs[code].name ? runs[code].name : code == null ? "?" : shortCode(code); };
  const namesReady = () => Promise.race([loadDrills(), wait(1500)]);
  function renderSession(p = panel) {
    if (!p) return Promise.resolve();
    hideTip(p);
    return Promise.all([dataFor("session", p), namesReady()]).then(([data]) => {
      if (!current(p, "session")) return;
      const runs = runsNow();
      p.content.innerHTML = sessionHtml(data, p.sessionIdx, Date.now(), runs, (c) => nameFor(c, runs));
      painted(p);
    }).catch(() => { if (current(p, "session")) p.content.innerHTML = `<p class="aim-an-msg">Could not read your records.</p>`; });
  }
  function renderDrills(p = panel) {
    if (!p) return Promise.resolve();
    hideTip(p);
    return Promise.all([dataFor("drills", p), namesReady()]).then(([data]) => {
      if (!current(p, "drills")) return;
      const runs = runsNow(), logic = logicNow(), facts = arr(data.rounds).map(roundFacts), goals = loadGoals();
      const models = drillModels(runs, logic, facts, (c) => nameFor(c, runs));
      for (const m of models) if (goals[m.code]) { const plays = facts.filter((f) => String(f.code) === m.code); m.goals = goals[m.code].map((g) => evaluateGoal(g, m, runs[m.code], plays)); }
      const open = p.drillOpen ? models.find((m) => m.code === p.drillOpen) : null;
      if (p.drillOpen && !open) p.drillOpen = null;
      let top = "";
      if (!open) {
        let plan = null;
        try { const C = window.__aimCoach; plan = C && typeof C.warmupPlan === "function" ? C.warmupPlan(arr(data.rounds)) : null; } catch { plan = null; }
        p.warmPlan = plan;
        let exists = false;
        try { exists = !!(window.__aimRoutines && window.__aimRoutines.routines().some((r) => r.id === WARM_ROUTINE_ID)); } catch {}
        top = warmupHtml(plan, (c) => nameFor(c, runs), exists);
      }
      p.content.innerHTML = open ? drillDetailHtml(open, runs[open.code]) : drillsHtml(models, p.drillSort, top);
      painted(p);
      checkGoals();
    }).catch(() => { if (current(p, "drills")) p.content.innerHTML = `<p class="aim-an-msg">Could not read your records.</p>`; });
  }
  const drillTypeOf = (code) => { const d = drillBook.get(code); return d && d.mode === "ball" ? "ball" : ""; };
  // A goal button or form of the open drill: add it, say so (or why not), draw the drill again.
  function goalAction(p, spec) {
    const code = p.drillOpen;
    if (!code) return Promise.resolve();
    const runs = runsNow(), logic = logicNow(), entry = runs[code] || null, map = loadGoals();
    let th = null;
    try { th = logic && entry && typeof logic.thresholds === "function" ? logic.thresholds(entry) : null; } catch { th = null; }
    const r = addGoal(map, code, spec, entry, th);
    if (r.ok) saveGoals(map);
    const text = r.ok ? "Goal set." : r.why;
    return renderDrills(p).then(() => { const el = p.content && p.content.querySelector ? p.content.querySelector("[data-goal-msg]") : null; if (el) el.textContent = text; });
  }
  function goalRemove(p, id) {
    const code = p.drillOpen, map = loadGoals();
    if (code && removeGoal(map, code, id)) saveGoals(map);
    return renderDrills(p);
  }
  // The "Add to Routines" button of the suggested warm-up.
  function saveWarmup(p) {
    const msg = p.content.querySelector ? p.content.querySelector("[data-warmup-msg]") : null, btn = p.content.querySelector ? p.content.querySelector("[data-warmup-save]") : null;
    const say = (t) => { if (msg) msg.textContent = t; };
    try {
      const R = window.__aimRoutines;
      if (!R || typeof R.saveRoutine !== "function" || !p.warmPlan || p.warmPlan.steps.length < 2) { say("Routines are not available."); return null; }
      const runs = runsNow(), saved = R.saveRoutine(warmupRoutine(p.warmPlan, (c) => nameFor(c, runs), drillTypeOf));
      say(saved ? "Saved as " + WARM_ROUTINE_NAME + ". Open Routines to start it." : "It could not be saved (Routines holds up to 30).");
      if (saved && btn) btn.textContent = "Update the routine";
      return saved;
    } catch { say("It could not be saved."); return null; }
  }
  function renderCompare(p = panel) {
    if (!p) return Promise.resolve();
    hideTip(p);
    return dataFor("compare", p).then((data) => {
      if (current(p, "compare")) { p.content.innerHTML = compareHtml(data.days, data.rounds, p.cmpRange, Date.now()); painted(p); }
    }).catch(() => { if (current(p, "compare")) p.content.innerHTML = `<p class="aim-an-msg">Could not read your records.</p>`; });
  }
  // The export buttons: read everything fresh (the panel's cached reads may be older), build the file and hand it to the browser's download.
  async function runExport(p, kind) {
    const e = EXPORTS[kind];
    if (!e || !p) return false;
    const say = (text) => { try { const m = p.foot && p.foot.querySelector ? p.foot.querySelector(".aim-an-foot-msg") : null; if (m) m.textContent = text; p.exportMsg = text; } catch {} };
    try {
      say("Preparing…");
      const [rounds, days] = await Promise.all([read("rounds", { limit: 5000 }), read("days", {}), namesReady()]);
      if (!rounds.length && !days.length) { say("Nothing recorded yet, so there is nothing to export."); return false; }
      const runs = runsNow(), nameOf = (c) => nameFor(c, runs);
      const text = kind === "rounds" ? roundsCsv(rounds, nameOf) : kind === "days" ? daysCsv(days) : exportJson(rounds, days, runs, nameOf);
      const name = `openvaim-${e[1]}-${dayOf(Date.now())}.${e[2]}`;
      const ok = downloadText(name, (e[2] === "csv" ? "﻿" : "") + text, e[3] + ";charset=utf-8");
      say(ok ? `Export started: ${name}` : "The file could not be saved.");
      return ok;
    } catch { say("The file could not be saved."); return false; }
  }

  // ---------------------------------------------------------------- Stats on the Training history page (17 Nov 2026)
  // The records view (lobby tab "Training history", the active .hall-tab) draws its board with history-board.mjs render(el),
  // which rewrites el.innerHTML each time, so the Stats host never goes inside el: it goes right AFTER the board's root (the
  // parent of .hx). With no runs yet there is no .hx; then it goes at the end of the records view's scroll box
  // (.hall-center.rov .rov-scroll). The page watcher re-inserts the host when a re-render drops it, hides it when another
  // tab is active, and refreshes the panel's reads each time the page is shown again.
  const HOST = "aim-an-stats-host";
  let statsHost = null, hostShown = false;
  const recordsActive = () => {
    const tab = document.querySelector(".hall-tabs .hall-tab.is-active") || document.querySelector(".hall-tab.is-active");
    return !!tab && /^\s*training history/i.test(tab.textContent || "");
  };
  function statsAnchor() {
    const hx = document.querySelector(".hx");
    if (hx && hx.parentElement) return { after: hx.parentElement };
    const scroll = document.querySelector(".hall-center.rov .rov-scroll") || document.querySelector(".rov-scroll");
    return scroll ? { inside: scroll } : null;
  }
  function syncStatsHost() {
    try {
      const on = recordsActive(), anchor = on ? statsAnchor() : null;
      if (!anchor) {
        if (tipBox && tipBox.p === inlinePanel) closeTip(false);
        if (statsHost && !statsHost.hidden) statsHost.hidden = true;
        hostShown = false;
        return;
      }
      if (!statsHost) {
        statsHost = document.createElement("div");
        statsHost.className = HOST;
        statsHost.hidden = false;
      }
      if (anchor.after) { if (anchor.after.nextElementSibling !== statsHost) anchor.after.after(statsHost); }
      else if (statsHost.parentElement !== anchor.inside || anchor.inside.lastElementChild !== statsHost) anchor.inside.appendChild(statsHost);
      if (statsHost.hidden) statsHost.hidden = false;
      if (!inlinePanel || inlinePanel.root.parentElement !== statsHost) mountInline(statsHost);
      else if (!hostShown) refreshInline();
      hostShown = true;
    } catch {}
  }

  // ---------------------------------------------------------------- start
  injectCss();
  let queued = false;
  const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; syncResult(); syncStatsHost(); }); };
  try { if (window.__aimWatchPage) window.__aimWatchPage(later, { childList: true, subtree: true }); } catch {}
  syncResult();
  syncStatsHost();
  // goals: look after every finished run (the routines' store announces it), and once shortly after start
  try { window.addEventListener("aim-routines-change", goalsSoon); setTimeout(checkGoals, 6000); } catch {}

  window.__aimAnalyticsUi = {
    open, close, mountInline, syncStatsHost, loadDrills, startDrill, closeTip, checkGoals, loadGoals, saveGoals, goalToast, goalAction, goalRemove, saveWarmup,
    // pure renderers, for tests
    render: { trackReadoutHtml, trackingHtml, trackingTotals, hitSummary, killerShots, enemyShots, tilePoint, hitPanelHtml, heatCells, heatOptions, fightLayer, countFights, heatmapHtml, mapLook, cellTip, zoomAt, clampPan,
      progressSeries, progressBuckets, progressHtml, niceTicks, xTicks, nodeTip, coachHtml, coachModalHtml, coachVisual, cardVisual, angleHtml, angleOffset, mapCardHtml, drillCardHtml,
      refHtml, withRefs, refsOf, splitNote, coachIcon, cardSummary,
      roundSeconds, roundFacts, groupSessions, totalsOf, compareMetric, compareRows, sessionVersus, changeText, timelineOf, sessionDrills, sessionLabel, sessionHtml, totalsFromDays, periodCompare, compareHtml,
      mergeRawDays, sessionDrillChanges, changeCellHtml, normalizeGoal, normalizeGoals, addGoal, removeGoal, evaluateGoal, goalsHtml, warmupRoutine, warmupHtml,
      drillModel, drillModels, sortDrills, sparkSvg, drillsHtml, drillDetailHtml, scoreChartSvg, csvCell, toCsv, roundsCsv, daysCsv, exportJson, burstSplit, burstHtml, heatHtml },
    runExport,
    coachIconIds: Object.keys(COACH_ICON),
    syncResult,
  };
})();
