# UI integration after the round-3 reviews (ui-integration)

Branch `ws/ui-integration`, on top of the merged `v1.6.0-dev` (all seven ui-* branches).

## For players
- Drill names read the same everywhere: the plain name with an EASY or HARD badge, instead of "Easy-Flick — …" or "… (Hard)". This now covers Routines (steps, the drill gallery, the medals table, toasts), the result screen title, the pause and Tab menu titles, Stats (Drills list and detail, session drills, warm-up, coach cards and drill links, heatmap drill filter) and the VALORANT Training cards. The long VALORANT names that needed three lines and lost "(Hard)" now fit in two.
- In the Routines gallery the badge sits on the picture, so the two-line name is not cut.
- Stats "A to Z" keeps a drill's Easy and Hard versions side by side.
- The Discord support panel tucks to its tab on any screen where it would sit on a button, card, text or chart (Stats, Target Workshop, drill lists, routines), not only while a list is scrolled. It stays out where the corner is empty, and a click on its tab still shows it until you change page.
- Result screen of a Target Workshop drill: "Back to Target Workshop" and "Target Workshop · Complete" (it said VALORANT Training). Pause menu: the line under the drill name says where the drill comes from ("VALORANT Training · Rules and duration come with the drill") instead of "Custom scene … scene file"; a real custom scene keeps the old text. The start screen's "Back to target tasks" says "Back to Target Workshop".
- Pause and Tab menus: the "Pre-aim aids" chip turns red while any aid is on, like "Pause timer".

## Technical
- `app/target-workshop.js`: `window.__aimTargetWorkshop` gains `tierBadge`, `nameHtml` (escaped name + `.es-tier` badge), `plainName` ("Name (Easy)" for titles, aria-labels, `<option>`), `paintName(el)` and `fullName(el)`. `paintName` changes only the heading's text node data and appends the badge (Vue swaps the whole text when the name changes, and the next run paints again); the full name is kept in `data-es-full`. A page-watch hook paints `.al-result-modal h2` and `.al-pause-id h1` once per frame batch. The five `#6b7280` greys use `var(--es-dim, #6b7280)`.
- `app/theme-esports.css`: one new block at the end, `.es-tier` (same colours as `.tw-tier`).
- `app/routines.js`, `app/analytics-ui.js`: local `nameHtml` / `plainName` wrappers that fall back to plain escaped text when target-workshop.js is not loaded (tests).
- `app/enemy-rank-cards.js`: `paintTier(card)` per sync; rename reads/compares the full name (`fullName`).
- `app/lobby-bar.js`: Discord dock `covers()`: 12 `elementsFromPoint` samples over the panel's resting place; tucked when any is a control (tag/role/tabindex or `cursor: pointer`, up to 8 parents) or has its own text/canvas/img/svg. Checked once at creation (no flash), then on scroll / resize / page change, at most one pending timer (180 ms) plus one trailing check; no frame loop. Skipped while collapsed or pointer-locked. The Settings page keeps hiding the dock (interface-mode.js).
- `tools/patch-drill-source-wording.cjs` (new, marker `aim-source-wording-N`, both copies): 4 edits in `Hwnlm6zD.js`, 2 in `OkAdunfX.js` (`data-on` on the Pre-aim aids chip, Vue flags TEXT|PROPS). Re-runnable; tested by `tests/test-patch-source-wording.cjs`. `app/ui.css` colours `.al-pause-timer-state[data-on="true"]`.
- Removed `app/smooth-scroll.js` and its `docs/architecture.md` row: never in `UI_SCRIPTS`; main.js deliberately keeps wheel scrolling native ("without a JavaScript frame loop"). Its only history is the initial import; CHANGELOG's 1.x line about smooth scrolling is history and left alone.
- Tests: `tests/test-target-workshop.cjs` (+3: helpers, paintName, every non-Creator easy/hard scenario reads as its tier), `tests/test-patch-source-wording.cjs` (new). All 18 files pass.

## Checked
- Dev copy on 8181, hidden (`show` stubbed) and later offscreen-rendered, browser pane through a UA proxy on 8182, seeded runs/routines/rounds. Every lobby tab at 1024x640, 1280x720, 1366x768, 1536x864, 1920x1080, 2560x1440: no horizontal page scroll, no element past the right edge, one scroller per view (Settings: rail + main by design), no fixed element other than the dock and full-page Routines/Collection layers. Studio page opens and looks right.
- Performance (offscreen Electron, CDP, 10 s idle per tab): no long tasks anywhere; rAF 16.7 ms p50/p95, max 17 ms on Settings, Target Workshop, Stats, VALORANT Training. Main-thread time per 10 s: Target Workshop 8 ms, Stats 5 ms, Community 6 ms, VALORANT Training / Routines / Collection 140-225 ms (lobby hero and card re-renders, ~6 style recalcs/s), Settings ~600 ms: the game's own live HUD/crosshair preview canvas (`ChJ6FlD4` `Rw`/`Ew`, `BiMsX6Xn` WebGL), present since the 1.4 import, not from this round.
- Not checked: a live round (result and pause screens were checked with stand-in DOM only; the patched texts were checked by anchors and `node --check`), the CSS cascade conflicts list (48 same-selector `!important` pairs, all inside media queries or intended later overrides).
