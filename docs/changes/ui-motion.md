# ui-motion: motion, UI performance and accessibility across the app

## For players
- Settings no longer works the PC on every frame: the General page was re-drawing its layout about 40-150 times a second for as long as it was open. It now stays idle like every other screen.
- If Windows "Show animations" is off, the app no longer slides, pops or spins: everything appears straight away (the "new best" note still stays up for its few seconds).
- Performance interface: the big end-of-round word punches in without the blur effect.
- Keyboard: the red focus ring now shows on the slanted top tabs, filter chips and other cut-corner buttons (it was invisible there), and on the Discord tab. An invisible extra Tab stop at the start of the lobby is gone.
- Sensitivity tools and Backups: focus moves into the panel when it opens, Esc closes it, Tab stays inside, and focus goes back to the top-bar button after closing.
- Easier-to-read grey hint text everywhere (the dimmest grey now meets the 4.5:1 contrast guideline); clearer pause-menu task description.
- One thin dark scrollbar style everywhere; sliders, dropdowns and checkboxes show the hand cursor, disabled buttons show "not allowed".

## Technical
Files: `app/page-watch.js`, `app/interface-mode.js`, `app/player-tools.js`, `app/theme-esports.css` (one block after the "keyboard focus: red ring" rule, marked `ui-motion`), `app/ui.css` (block at the end), `tests/test-ui-motion.cjs` (new, 51 checks).

- Settings loop: `scope-zoom-setting.js` sets its hint `<small>`'s `textContent` on every sync, even when unchanged. That swaps the text node, a childList mutation that woke every `__aimWatchPage` watcher (6+ scripts), each re-ran its sync on the next frame, so the cycle never ended. `page-watch.js` now drops mutation batches made only of same-text swaps (`window.__aimWatchPageNoOp`), which breaks this whole class of loops for every script. Unlock catch-up calls (`[]` records) still run.
  Measured over 3 s on Settings > General (CDP, 165 Hz monitor): before 238 frames, 240 layouts, 1.64 s style recalc, 2.99 s main-thread task time, 161-207 DOM mutations/s, rAF 32-41 fps. After: 495 frames, 0 layouts, 0 style recalcs, 0.55 s task time, 0-5 mutations/s, 165 fps.
- Motion tokens on `:root`: `--es-dur-xs` 100 ms, `--es-dur-sm` 150 ms, `--es-dur-md` 250 ms, `--es-dur-lg` 400 ms, `--es-ease-out`; existing `--es-ease`/`--es-spring` kept. Applied to the shared button/chip/pause-action transitions (were 0.12/0.15/0.18/0.2/0.25 s). Screen-specific rules were left to their owners; they can switch to the tokens.
- Reduced motion: `@media (prefers-reduced-motion: reduce)` sets animation/transition duration 1 ms, delay 0, iterations 1 on everything (two `:not(#…)` so it beats the theme's `!important` animations; 1 ms keeps `animationend`/`transitionend` firing). `.es-score-toast` gets an opacity-only 4.5 s hold instead. Verified with CDP media emulation (computed durations).
- Performance mode: `.al-result-verdict-splash b/span` use `es-splash-lite` (same keyframes without `filter: blur`). Synthetic splash, 1.4 s: Enhanced mean 6.9-7.4 ms / p95 7.5-12.2 ms, Performance mean 6.1-6.5 ms / p95 6.2-12.1 ms.
- Focus: `interface-mode.js` adds `.es-focus-inset` on `focusin` when the element has a clip-path or a clipping parent within 4 px (`window.__aimFocusRing.needsInsetRing`, tested); CSS draws a white ring inside (offset -4 px). More roles get the red ring (textarea, summary, role=button/tab/radio/checkbox/switch/option). Game's hidden `input.hall-scene-import-file` is `visibility:hidden` (removed from Tab order; `.click()` still opens the picker).
- Contrast: `--es-dim` #6b7280 -> #848b98: 4.07/3.84/3.57/3.26 -> 5.75/5.42/5.03/4.60 on bg/panel/raised/raised-2. `.al-pause-desc` 0.42 alpha -> `--aim-muted`.
- Scrollbars/cursors: zero-specificity `:where()` rules, so any rule that hides a scrollbar or sets a cursor still wins.

## Audit notes (not changed, owners told)
- Infinite animations: only loading/busy spinners (`aim-load-spin`, `aim-load-sweep`, `es-start-spin`, `es-refresh-spin`) and the startup screen; all transform-only. Layout transitions left: Discord tab width/height .45 s, pause-action padding-left, update progress width (all tiny elements).
- No UI zoom: the app menu is removed, so Ctrl +/- does nothing. Not added on purpose: zoom changes devicePixelRatio (render cost) and can change mouse movement scaling in the game.
- White on `--es-red` is 3.36:1 (brand primary buttons/tabs); passes for large text only. Left as is (brand); a darker fill would fail red-on-dark text.
- Lobby (sent to ui-lobby): at a 1536 px window the top nav overflows by 105 px, giving page scrollbars, and tabbing to the right-hand buttons scrolls the whole document 120 px sideways; sens stepper arrows 18x13 px; Discord tab shows rounded corners; Exit is last in Tab order.
- `target-workshop.js` hard-codes `#6b7280` (5 places), so its hints stay at 3.8:1; switch to `var(--es-dim)`.

## Not verified
- No live round (no pointer lock): the in-round pause menu, real verdict splash and results were checked only with synthetic DOM or computed styles.
- Reduced motion was checked by CDP media emulation, not by turning the Windows setting off.
- Frame numbers are rAF intervals on one PC with a 165 Hz monitor; GPU-bound PCs may differ.
