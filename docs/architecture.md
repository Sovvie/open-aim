# How open-aim works

## The big picture

```
┌──────────────── Electron app (app/main.js) ────────────────┐
│                                                            │
│  Local web server 127.0.0.1:8000                           │
│    ├─ serves the game from base/                           │
│    ├─ swaps in files from app/site/                        │
│    ├─ adds the extra scenarios (training-set.json)         │
│    └─ answers account and leaderboard requests locally     │
│                                                            │
│  Chromium window → http://localhost:8000/aim               │
│    └─ on every page, injects:                              │
│         theme-esports.css   ui.css   offline.css           │
│         lobby-bar.js   player-tools.js   studio-launch.js  │
│                                                            │
│  Studio → http://localhost:8000/studio/  (app/studio/)     │
│    └─ 2D map editor + 3D preview (three.js)                │
│                                                            │
│  Every request to the internet is blocked.                 │
└────────────────────────────────────────────────────────────┘
```

## Files in `app/`

| File | Job |
| --- | --- |
| `main.js` | Starts the server, opens the window, blocks the internet, injects styles and scripts |
| `preload.js` | Small bridge between the page and the app (fullscreen, backups) |
| `backups.js` | Backs up player data at every launch (last 10 kept), restore, export, import |
| `theme-esports.css` | The esports look: colors, type, motion, glass |
| `ui.css` | Compact pause and results menus |
| `offline.css` | Hides sign-in, leaderboards and other online-only parts |
| `lobby-bar.js` | Top bar (Favorites, Creator, Quick start), FPS meter, smooth scrolling |
| `interface-mode.js` | Interface setting in Video settings: Enhanced (default, full theme) or Performance (no glass blur, no looping animations in rounds) |
| `startup-screen.js` | Startup screen over the lobby until its training list has loaded (lobby page only, 20 s safety limit); main.js keeps the window hidden until it is in place |
| `page-watch.js` | One page watcher the UI scripts share; it sleeps while the mouse is locked in a round |
| `smooth-scroll.js` | Mouse-wheel steps glide (~150 ms) in the lobby and menus instead of jumping; touchpads, zoom and aiming are left alone |
| `menu-shortcuts.js` | Two keyboard shortcuts, each with an On/Off row in Settings › General › Mouse (default On): your Restart key (T) on the Eliminated screen clicks Play again; Esc a second time in the pause menu clicks Resume (main.js runs that click with a user gesture) |
| `sibling-switch.js` | A "Switch difficulty" button on the result screen and in the pause menu for drills that have an `-easy`/`-hard` pair in `scenarios/`: it clicks the screen's own Exit, then the other drill's lobby card Start (the game has no other way to start a round); the pairs come from `build-scenarios.mjs` via `training-set.json` and `/api/local/drill-sibling` |
| `analytics-recorder.js` | Records every shot (time, weapon, hit part and point, distance, target, kill) and every death (position, tick, killer) per round, with the map and drill share code, in IndexedDB database `aim-analytics` (store `rounds`: raw rounds kept 30 days; store `days`: one summary row per day with counts per map/weapon/mode and a death-position grid, kept for good; rounds from the old localStorage key `aim-analytics-rounds-v1` are migrated on start); also, per round, one row per enemy engagement (aim travel, player movement, aim error when the enemy appears, flick or strafe) and the near misses of missing shots (distance to the enemy body box, above or below its centre); read it with `window.__aimAnalytics.rounds()` / `.days()` / `.engagements()` / `.nearMisses()` (all return Promises). Needs `tools/patch-analytics-hooks.cjs`, which makes the game loop (and its worker) report round start, every tick (snapshot and events) and round end |
| `coach.js` | Pure rules over what `analytics-recorder.js` stored: `window.__aimCoach.insights({code, map, weapon, since, limit})` returns a Promise of findings `{id, title, detail, severity (info/tip/warn), evidence, sample}` in plain language (where you miss, flick or strafe kills, first-sight crosshair height, time to kill, death spots and repeats, deaths by cause, fights lost, headshot rate and accuracy per weapon, accuracy by enemy range, left/right misses, shooting while moving, walk and crouch, burst and spray accuracy, sensitivity changes, consistency, 7-day trends); every rule has a minimum sample (constants at the top, shown in `__aimCoach.thresholds`) and says nothing below it. Shown in the Stats panel (`analytics-ui.js`) |
| `analytics-ui.js` | Screens for the analytics records: on the Eliminated screen a hit-zone panel in the left column (body silhouette with head, chest, arms, stomach, legs, a dot per shot of that round and hits per zone; "No hits this round" when none hit); a **Stats** button in the lobby top bar opens a panel with a death and fight heatmap per map (minimap picture or plain grid; filters map, mode, drill code, weapon; layer toggle Deaths / Fights / Both, fights placed where you stood when each began), progress charts over 7/30/90 days (accuracy, headshot rate, kill time, near misses, flick and strafe share, deaths per round) and the coach findings with a "why" for the evidence. Reads only; its CSS is injected from the same file |
| `routines.js` | Medals and routine playlists: medals compare each finished run (the result screen's score) with your own recent runs of the drill; a routine is an ordered list of drill steps (runs, minimum score or medal, enemy rank, easy / hard). Adds a Routines lobby tab (My routines, Medals), a drop-down drill picker, a + button and medal chips on the drill cards, and a strip with a Next drill button on the result screen. Data in localStorage (`aim-rt-runs-v1`, `aim-rt-routines-v1`, `aim-rt-draft-v1`) |
| `round-tip.js` | One coach tip about the round just finished, above the result screen's buttons (`coach.js` `roundTip()`) |
| `player-tools.js` | Backups and Sens tools panels |
| `studio/` | The Studio: `studio.js` (editor UI), `drill.js` (turns a layout into a playable drill), `map-data.js` (map outlines), `view3d.js` (3D preview), `detailed-map.js` (Detailed view: the game's real map, rewrapped for the Studio's three.js), `vendor/` (three.js, MIT) |
| `studio-store.js` | Saves your Studio drills so they show up in the lobby |
| `studio-launch.js` | Starts a Studio drill in the game and brings you back to the Studio after |
| `shooting-error.js` | The shooting error graph on the results screen |
| `translations.js`, `english-fixes.js` | Proper English for the interface |
| `test-maps.mjs` | Smoke test: loads several maps in a running app and reports errors |

## Where player data lives

The game keeps history, bests, replays, scenes and settings in its own browser storage
(localStorage and IndexedDB), which Electron stores in `%APPDATA%\AimTrainer`.
Backups go to `%APPDATA%\AimTrainer-Backups`.

> **Careful:** running the app from this repository uses the same data folder as an installed
> AimTrainer, and makes a backup at every start. Close the installed app before running
> `npm start`, since only one copy can run at a time.

## Extra scenarios

`scripts/build-scenarios.mjs` reads every file in `scenarios/` and writes
`app/training-set.json`. `main.js` adds those entries to the game's training list and serves
their scenes, so they play exactly like built-in scenarios, with results and history.
