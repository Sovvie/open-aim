# UI review: in-round end screens and the pause menu (workstream "ui-result")

Branch `ws/ui-result`. Area: the result overlay (Eliminated / Cleared / Time's up), the hit report and its placement, the coach tip, the medal / routine strip, Switch difficulty, menu shortcuts, the pause menus, the shooting error graph.

## For players
- The result screen no longer pushes the "N left" bots card off the right edge on 1280 to 1440 px wide windows, and the hit report beside the card is never squeezed so narrow that its numbers are cut off. The result card stays centred. Below 1280 px (1360 px when the bots card is shown) the report sits inside the card, under the buttons.
- The coach tip for the round now sits at the bottom of the hit report column when that column is shown, so it is always visible instead of hiding under the result card's buttons on 1366x768.
- The result card fits 1280x720 without scrolling more often: the drill name has a tighter line height and short windows get slightly tighter padding.
- The medal and routine line on the result screen no longer makes the card jump when it appears: its space is held from the start, and it slides in once. Inside the card it is a clean full-width band (no cut corner against the card's edge), and the medal name uses the game's condensed heading type.
- Play again shows your Restart key (T by default) on the Eliminated screen, and Resume shows "Esc" in the pause menu, while those shortcuts are on (Settings > General > Mouse > Menu shortcuts).
- Pause menu: a long drill name wraps to two lines instead of being cut after a few words; "Pause timer" turns its chip red when it is on; the Sensitivity row lines up with the other rows and uses the same lettering; Switch difficulty sits right under Restart instead of after the Sensitivity field.
- The hit report's "Your killer / All my shots" tabs are square like every other tab (the base site rounded them).
- The shooting error graph is hidden on the result screen (it covered the top of the bots card on 768 px tall windows) and starts empty for the next round after Play again.

## Technical
Files: `app/analytics-ui.js` (side-column grid, breakpoints, tab radius, side entrance pace; all in the existing side-placement rules or a commented "ui-result review" block), `app/round-tip.js`, `app/routines.js` (result-strip CSS and placeholder only), `app/menu-shortcuts.js`, `app/sibling-switch.js`, `app/shooting-error.js`, `app/ui.css` (two commented blocks at the end), tests `test-analytics-ui.cjs`, `test-round-tip.cjs`, `test-menu-shortcuts.cjs`.

- Side column: `grid-template-columns: minmax(var(--aim-an-side), 1fr) minmax(0, 960px) minmax(var(--aim-an-side), 1fr)`, `--aim-an-side` 260px, 300px when the overlay has `.al-bots-card`. The two outer columns stay equal (card centred), the card shrinks first and never past the game's own 960px width (no reflow when the report arrives). `placePanel` uses two media queries: `(min-width: 1280px) and (min-height: 680px)`, or 1360px with a bots card (card stays >= ~680px). Previously 1180px with `minmax(0, 1fr) auto minmax(0, 1fr)`, which overflowed with a 300px bots card.
- Coach tip: `mount()` appends the card to the overlay's `.aim-an-hit-side` child when there is one; analytics-ui rewrites that panel's innerHTML only on a tab switch / bot pick, and the page watcher re-mounts the tip on the next change.
- Medal strip: `sync()` places an empty `.aim-rt-strip.is-pending` (hidden, min-height 44px) when the screen is first seen; `finish()` fills it, or removes it when nothing is read. A strip with a routine row is ~30px taller than the placeholder, so that case still shifts the card a little.
- Key chips: `menu-shortcuts.js` sets `html[data-aim-esc-resume]`, `html[data-aim-restart-chip]` and `--aim-restart-key` (`keyLabel("KeyT") = "T"`); the chips are CSS pseudo-elements (`::after` on Resume in ui.css, `::before` on Play again because the theme uses its `::after` for the shine), so nothing is added inside Vue-managed buttons.
- Result-card spacing (ui.css): only for overlays without `.al-pm` (the map broadcast board keeps the theme's layout).

## How it was checked, and what was not
- Rendered the real game page offscreen (an `offscreen: true` Electron BrowserWindow, never shown) through a proxy that injects the worktree's UI files; started a real drill, found the round's context in the Vue tree and set `lastOutcome` / `lastResult` / `lastLayout` (and stubbed `__aimAnalytics.rounds`, `__aimCoach.roundTip`, seeded routines) to get the game's own result overlay and pause menus with the real CSS. Checked died / cleared / time's up, with and without shots, bots card, coach tip, medal and routine strip, Switch difficulty, a 63-character drill name, at 1024x640, 1280x720, 1366x768, 1440x900, 1536x864 and 1920x1080. 2560x1440 was seen only before the changes (the offscreen renderer hung at that size later).
- Not checked: the Position-map (broadcast board) screen, which needs a real pre-aim round (the hit report keeps its old in-card spot there, unchanged); any live round; the entrance animations themselves (this PC reports prefers-reduced-motion, so they are off here; timing checked in CSS and by tests only).
- `node tests/run-all.cjs`: all 14 files pass.

## Notes for other areas
- The game's result card text ("Back to VALORANT Training" on a Target Workshop drill, "Custom scene · Rules and duration come from the scene file" in the pause menu of VALORANT drills) is the compiled game's.
- Pre-aim aids in the pause menu shows "On" in a grey chip (it opens a sheet, it is not a switch), next to Pause timer's red "On".
