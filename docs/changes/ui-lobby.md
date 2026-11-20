# UI review: lobby shell and list screens (ui-lobby, round 3)

## For players

- The top bar stays on one line at every window size. Under 1100 px wide every tab shows again (only the open tab used to show, so you could not switch tabs). Between 1280 and 1536 px the bar no longer runs off the right edge or pushes the whole page sideways. When the tabs don't all fit they scroll sideways: the mouse wheel works there, the open tab stays in view, and a soft edge shows there are more.
- Bar buttons show their names only on very wide screens (2200 px and up). Elsewhere they are icons, and the name is in the tooltip.
- The Exit X in the top-right corner no longer sits on top of the Sens box, and Tab reaches it right after the top bar.
- The Sens arrows are bigger (24 x 17 px).
- Map strip: the task count now sits under the map name ("CORRODE12" ran together before). Counts show at every width. In narrow windows the tiles keep their size instead of cutting names.
- The bottom search box is wide enough for its whole hint.
- The Discord panel tucks away to its tab while you scroll down the drill list, so it never covers a card's Start button, and comes back at the top. In windows under 1400 px it starts tucked until you choose otherwise.
- Empty search or filter result: a clear "Nothing here" panel with a hint, in VALORANT Training and Target Workshop.
- The dead "previous page" arrow on the first page of a map row no longer sits over the first card. Empty filter chips ("Fundamentals 0") are easier to read.
- On short windows (720-820 px tall) the header is tighter, so the first row of cards starts sooner.
- When a button inside a drill card has keyboard focus, the card lights up like it does on hover.
- Target Workshop:
  - The list scrolls inside the tab. It used to scroll the whole window, so the top bar and the search bar scrolled away.
  - Two columns from about 1200 px wide.
  - Names show without the "Easy-" / "Hard-" prefix, with an EASY or HARD badge on the preview, and there is a new Any level / Easy / Hard filter. Both filters are remembered, and their counts follow the search and the other filter.
  - Long names are held to two lines, and the buttons wrap instead of overflowing.
  - Keyboard: arrow keys move between cards, Enter plays, Space selects. Focus stays where it was when the list refreshes (for example after a favourite or a filter click).
  - Back from Tune returns to the same place in the list.
  - Clicks no longer stall for about 130 ms: only the previews on screen are drawn, and cards off screen are skipped by the browser.
- The Quit confirmation says "Quit openVaim?".

## Technical

- `app/theme-esports.css`: one block at the end, "ui-lobby-v1". It covers:
  - top nav: no-wrap, scrolling tab row, the 2200/1700/1400/1300/1100 px steps, and `body:has(.es-exit)` padding (the X's own 44 px rule lost to the theme's 20 px)
  - `overflow-x: clip` on html/body
  - map strip, search width, Discord dock `.is-tucked`, disabled paddles, `.is-zero` chips
  - short-window hero, `.al-wk-empty` panel, card `:has(:focus-visible)`, Sens stepper
- `app/lobby-bar.js`:
  - `syncTabsRow()`: wheel to sideways scroll, keeps the active tab in view, `es-tabs-more-left/right` classes for the fade
  - dock tuck on scroll of `.hall-board-body` / `.tw-root` (not saved), default collapse under 1400 px when nothing is saved
  - Quit text
- `app/exit-button.js`: the X is placed right after `.hall-topnav` (re-placed if the nav re-renders); the watcher now uses `subtree: true`.
- `app/target-workshop.js`:
  - `tierOf(name)` (exported on `window.__aimTargetWorkshop` for tests), level filter, `tw-filter-v1` localStorage key
  - IntersectionObserver-driven preview painting, `content-visibility:auto` cards, `.tw-root` as the scroller
  - focus restore after `renderList`, arrow keys, scroll restore after Tune, empty states
- `tests/test-target-workshop.cjs`: `tierOf` cases, and every `workshop-*-easy|hard` scenario reads as its tier. `node tests/run-all.cjs`: all 15 files pass.

## Checked / not checked

- Checked in the browser pane through a proxy that injects the current UI files, at 1024x640, 1280x720, 1366x768, 1522x787 (the 1536x864 monitor), 1920x1080 and 2560x1440.
  - Desktop-only parts (Quit tab, Updates and Sign-in buttons, Exit X) were simulated: a stub `__aimDesktop.quit` plus fake bar buttons.
  - Results: document `scrollWidth` equals the viewport at every size, and the Sens box clears the X. At 1280 px with every desktop button the last tab (Quit) needs the sideways scroll. At 1366 px and up everything fits.
- Target Workshop rebuild cost: layout fell from about 104 ms to about 4 ms per rebuild, and 6 previews are drawn instead of 73.
- Not checked: the real Electron window's top bar with a signed-in Discord name (a long name in the account chip takes more room); a live round; touchpad sideways scrolling on the tab row.
- `app/smooth-scroll.js` is not injected anywhere (main.js keeps wheel scrolling native). I left it alone; it can be deleted.

## For other areas

- VALORANT drill names: "Ascent — A retake, staggered defenders (Hard)" needs 3 lines on a card, so "(Hard)" is cut off by the 2-line limit. Shorter names, or no "(Easy)/(Hard)" suffix, would fix it (valorant generator).
- Workshop generator names ("Easy-Flick — …") are shown in the Routines picker and on the result screen as they are. Target Workshop now strips the prefix; other screens could use the same `tierOf`.
