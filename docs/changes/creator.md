# Studio (Creator) changes for 1.6.0

## What players get
- **Templates.** A "Templates" card in the tray drops ready-made setups in front of you, selected so you can drag them into place: Hold an angle, Jiggle peek, Wide swing, Off-angles, Trade fight, Retake, Post-plant crossfire. Retake and Crossfire turn on "I can walk around" and say so.
- **Arrow keys nudge** the selected thing, or the whole selection, or your start (2D view): 0.5 m, Shift 1 m, Alt 0.1 m. A run of key presses is one undo step. They follow a turned map view.
- **Copy and paste.** Ctrl+C copies the selection (as text too), Ctrl+X cuts, Ctrl+V pastes at the pointer, also into another drill, and bots that trade a bot in the copy trade its copy. Ctrl+A selects everything. Ctrl+D (duplicate) now takes a single bot's trigger line, extra spots and sound area along.
- **Line up** buttons for a multi-selection: left, centre, right, top, middle, bottom, even gaps across and down (as you see the map).
- **More warnings** in the checks box (they never block saving): a bot on top of your start, two bots on one spot, a bot or your start inside a wall or box, a trade of a bot that is gone, a "shortest time longer than longest" delay, a bot that shows up after the round ends, a peek whose cover and peek spot are the same place, a trigger line too short to cross, a thin sound area, a bot beyond shooting range (80 m), more than 30 bots. Saving says how many warnings there are; Play shows them once before you go.
- **"What it will do"** box on every bot: when it shows up, what it does, how it shoots, when it comes back, in plain words.
- **Export / Import.** An Export button in the editor downloads the drill as a `.openvaim-drill.json` file; Import on the drill list opens one as a new drill (never overwrites). Files are checked.
- **Keyboard shortcut sheet:** the "?" button or the ? key.

## Technical
- New `app/studio/layout-tools.js` (pure, no DOM): `nudgeDelta`, `shiftItem`, `alignDeltas`, `clipOf/parseClip/pasteItems`, `exportDrillText/parseDrillText`, `TEMPLATES/buildTemplate/defaultAnchor`, `lint`, `describeBot`, `SHORTCUTS`. Templates only build the same items the tray builds (`newBot`, `newWall`), so no new behaviour kinds and no compiler change (`COMPILER` stays 25, saved layouts are untouched; the drill format has no new fields).
- `studio.js`: imports it; `allProblems()` = `problems()` + `lint()` for the checks box and saving; Ctrl+V uses the `paste` event (system clipboard first, then localStorage key `studio-clip`); new buttons in the header, tray, library and group panel. `studio.css`: small additions only.
- Tests: `tests/test-studio-layout.cjs` (11 checks: nudge, shifting with routes/spots/sound area, align, paste id and trade remapping, file round trip and rejection, every template builds and compiles with no hard problems, lint, bot summary). `node tests/run-all.cjs` is green (9 files).
- Existing: undo already covered everything that goes through `edit()` (drags, sliders, panels); no gaps found.

## Not verified / limits
- Checked in the browser pane (static server with a stubbed desktop API): library and editor render, templates dialog and insertion, arrow nudge and undo, copy/paste (simulated events), select all, warnings, bot summary, shortcut sheet. NOT checked: the real Electron app, saving and playing a template drill in the game, the Export file save dialog, the Import file picker, 3D view (arrows and templates are 2D-first; templates work in 3D but nudge keys are 2D only), map drills (templates fall back to the view centre when the 12 m spot is off the floor).
- Not done: snap/alignment guides while dragging, a trigger dry-run timeline (the existing Preview moves still covers trades and trigger lines).
