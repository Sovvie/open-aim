# analytics workstream (1.6.0)

## What players get
- **Session tab** (now the first Stats tab and the default): pick a session (rounds less than 30 minutes apart), see rounds, play time, accuracy, headshots, kills, deaths, a strip of its rounds coloured by result (cleared, time up, died; bar height = accuracy, hover for details), best medals, the drills played, and plain-language "What improved / What slipped" against your last 5 sessions. Small changes are ignored and every number needs a minimum sample.
- **Drills tab**: every drill with a medal history or a recorded round: sparkline, last and best score, medal, trend (newest 5 runs vs the 5 before), consistency (steady / normal / swingy). Sort by recent, most played, medal, trend, steadiest, A to Z. Click a drill for a score chart with dashed bronze/silver/gold lines, medal progress bar, latest runs, accuracy and headshots.
- **Compare tab**: last 7, 14 or 30 days against the period before, for accuracy, headshot rate, kill time, tracking and deaths per round. Kill time and tracking only use rounds with line-of-sight data and say why when a number is missing.
- **Export** strip under every tab: Rounds CSV, Daily CSV, Everything JSON.
- **Hit report** (result screen): a red heat glow under the hit dots (both figure and circle) and a "How you fire" block in the All-my-shots pane: hit rate of first shots vs follow-ups, taps (1-2 shots) vs sprays (5+). Placement logic and the no-report rule for tracking-scored drills are untouched.
- **Coach**: two new rules, "You start sessions cold" and "Your aim fades late in a session" (needs 3 sessions of 6+ rounds, 150 shots per group, a 6 point gap).

## Technical
- Files: `app/analytics-ui.js` (all UI and pure functions, exposed under `__aimAnalyticsUi.render.*`, plus `runExport`), `app/coach.js` (`sessionShape`, ids `warmup`, `fade`, summaries, thresholds), tests `tests/test-analytics-views.cjs` (new, 30 tests; reuses the DOM shim of test-analytics-ui.cjs), edits to `test-analytics-ui.cjs` (tab list, fixtures) and `test-coach.cjs`.
- Recorder, stored data, `routines.js`, `main.js`, `preload.js`: not changed. Medals are read through `window.__aimRoutines.runs()` / `.logic` / `.ui.medalIcon` (read only).
- Export is a Blob plus `<a download>`. `main.js` has no `will-download` handler, so Electron shows its default Save As dialog (not exercised live).
- Round length is not stored; it is estimated from the last shot, death or kill tick. Sessions come from the stored raw rounds (30 days, newest 500). Period comparison takes accuracy/headshots/deaths from the day rows; timing for the earlier period is dropped when it would reach past the 30 day raw window (so the 30 day range has none).
- Default tab changed from Heatmap to Session (`DEFAULT_VIEW`).
- Limits: not checked live in the app, nor visually in a browser pane; CSS is untested by eye. Burst gap (0.4 s) and tap/spray sizes are guesses. Drill history is capped by the medal store (40 runs per drill).
- Ideas: a per-session drill-by-drill delta, goals, warm-up routine suggestion from the `warmup` rule, aim-trace replay.
