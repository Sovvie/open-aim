# ui-stats review (1.6.0, round 3): Training history and the Stats panel

## What players get
- **Day one says what to do.** With only a few rounds, every Stats tab now explains what it will show and what to play to get there, instead of a filter wall or "not enough data" five times over: Compare says nothing was recorded the week before and that the comparison starts next week (no empty bars, each card names its own sample); Heatmap says "No deaths on <map> yet" and points to the Fights layer; Session says this is your first session; Coach, Progress, Drills and Tracking empty messages say what to play.
- **Coach cards are a fixed, compact size** (two findings no longer make two half-screen-tall cards); more findings fit on screen.
- **Coach wording:** the three "You win most fights from the -z / +x diagonal" cards now say which map each is about; the "yaw 0 looks along -z" note is plain words; "Your accuracy is flat" reads "holding steady"; the tracking card no longer says "1.2° behind" next to a detail that says you are not behind; "0% of deaths were falls" became "28 of 28 deaths to enemy shots" with a useful next step; the death-spot tip points to the Heatmap tab.
- **The coach's Numbers list is readable:** "Average offset (cm)", "Needs at least: fights" instead of raw keys, and lists as lines instead of JSON.
- **Charts are easier to read:** larger, brighter axis labels; the big Progress chart leaves room for the small ones under it; "57% ↑ 57%" shows as flat; the drill score chart has its first and last date; drill rows label their Trend and Consistency columns and say what they need ("Needs 6 finished runs").
- **Keyboard and touch:** the Progress chart, the session's round strip and the drill score chart take focus; arrow keys, Home and End step through the points and show each hover card. A tap shows a hover card on touch screens. The seven Stats tabs are real tabs: arrow keys move between them, and the page reopens on the tab you left.
- **Motion:** a tab fades in (0.2 s), and a chart draws in with a short slanted wipe (the round strip grows up, the compare bars slide in) the first time it is shown, never again on a filter or sort redraw. Off with reduced motion.
- **Fit:** session tiles stay on one row from about 800 px; a 150-round session fits the round strip at any width (it overflowed sideways at phone width); the heatmap is never taller than the view, so its legend shows; tracking bars and the drill run list no longer stretch across 2560 px.
- **Colour-blind help:** a died round is hatched as well as red; the strip's key says "Bar height = accuracy".
- Smaller fixes: the drill detail title is white like other titles (it was red); the next-medal bar no longer reads as a divider; the score-goal box suggests a score 5% beyond your best instead of your best; tracking-by-day labels read "6 Nov"; the tip modal's title is in sentence case like its card; "−0.00" changes read "no change".

## Technical
- Files: `app/analytics-ui.js` (one CSS block at the end of `CSS`, marked "Stats review (round 3, ui-stats)", plus the renderers), `app/coach.js` (wording only: angle titles, angle detail, trend title, tracking and deaths-cause summaries, death-zone detail), tests `tests/test-analytics-views.cjs` (4 new), `tests/test-analytics-ui.cjs` and `tests/test-coach-position.cjs` (expectations updated for the new wording / markup).
- New in `analytics-ui.js`: `keyLabel()`, `goalHint()`, `stepTip()` / `tipOff()` (keyboard hover cards on `[data-tipnav]` boxes), `painted()` (tab entrance once per tab switch, a chart draw once per key in `p.drawn`), view tabs `role="tab"` + `aria-selected` + roving tabindex, localStorage `aim-an-stats-view-v1` (last tab of the Training history panel). `render` also exposes `keyLabel, goalHint, timelineHtml, chartHtml`.
- The view-tab style hook moved from `aria-pressed` to `aria-selected` (two tests updated). No storage format changed; no new reads.
- Checked in the browser pane through the dev copy on port 8173 (UA proxy), seeded through the recorder's legacy-key migration: 3 rounds (day one), 300 rounds over 50 days, and about 3000 rounds over 30 days (three 1000-round migrations). With 3000 rounds every tab drew in 30-100 ms after its first read and no long task was observed; reading all 3000 rounds takes about 1.5 s (export only). Looked at 1536x864, 1024x640, 375x812 and 2560x1440; no horizontal overflow in any tab at 375 after the strip fix.

## Not verified / limits
- Reduced motion, real touch input and screen readers were not tried on a device (CSS and markup only).
- Heatmap cells have no keyboard stepping (their hover cards are mouse and tap only).
- Coach rules still fire on very small samples (two cards after 3 rounds); thresholds are coach logic, not wording, and were left alone.
- At 640 px height the Stats view is 460 px tall inside a page that scrolls; nested scrolling remains.
- The Discord support card (not this area) covers the bottom-right corner of the panel at every size.
