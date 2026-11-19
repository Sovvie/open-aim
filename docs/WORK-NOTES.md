# openVaim work notes: everything added on top of 1.4.0

These notes list every feature added to this fork since the upstream 1.4.0 release (commit `673db92`), what each one does, which files hold it, how the pieces fit together, how to run the tests and what is not finished.

They were written on 19 Nov 2026. The sections for the earlier work (swing triggers, menu shortcuts, enemy tracers, the analytics recorder and the Stats screens) were reconstructed from the code, the header comments of every file, `CHANGELOG.md` and `docs/architecture.md`. The later sections (tracking, circle targets, the Target Workshop tracking scenes, medals and routines, tests) describe work done in the latest sessions and were checked against the running app.

Read this together with the header comment of each file: every module documents its own data format at the top, and those comments are the authoritative reference. This file is the map.

---

## 1. At a glance

| Area | What it is | Main files |
| --- | --- | --- |
| Game patches | Small, re-runnable patches on the game's compiled bundles that expose events the page could not see (shots, kills, enemy shots, movement, sounds) | `tools/patch-*.cjs`, `app/site/next/js/*`, `app/site/_assets/r20261021-1/next/js/*` |
| Enemy tracers | Enemy bullets are drawn along the path the game actually resolved, in both appearance modes | `app/site/aim-tracers/*`, `tools/patch-enemy-*.cjs` |
| Studio swing triggers | Bots that hold an angle and swing on an event or a sound you make | `app/studio/*`, `tools/patch-swing-*.cjs` |
| Menus and shell | T = Play again, Esc closes the pause menu, Switch difficulty, a Quit tab | `app/menu-shortcuts.js`, `app/sibling-switch.js`, `app/lobby-bar.js`, `app/preload.js` |
| Analytics recorder | Every shot, death, engagement, near miss and (new) tracking sample, stored in IndexedDB | `app/analytics-recorder.js` |
| Coach | Plain-language findings and a per-round tip from those records | `app/coach.js`, `app/round-tip.js` |
| Stats screens | Hit report on the result screen; Stats panel with Heatmap, Progress, Tracking and Coach tabs | `app/analytics-ui.js` |
| Target Workshop tracking scenes | Five round-target drills for tracking | `scenarios/tracking-*.json`, `tools/make-tracking-scenes.mjs` |
| Medals and routines | Medals against your own history; routine playlists with a lobby tab, a drill picker and a result-screen strip | `app/routines.js` |
| Tests | Unit tests for the recorder, coach, screens, routines and menus | `tests/` |

---

## 2. How the pieces fit together

```
game worker (simulation + renderer)
   │  patched bundles call globalThis.__aimAnalyticsStart / Feed / End
   ▼
app/site/local/worker-game-entry.mjs      keeps only what the recorder reads, batches 32 ticks
   │  postMessage
   ▼
app/site/local/threaded-game-bridge.mjs   hands the batch to the page
   ▼
window.__aimAnalytics.receive()           app/analytics-recorder.js  (page side)
   │  rounds written asynchronously, never during play
   ▼
IndexedDB "aim-analytics"  (stores: rounds, days)
   ▲                          ▲
   │ readers                  │ readers
app/coach.js  ──────►  app/analytics-ui.js  (hit report, Stats panel)
app/round-tip.js                │
                                ▼
app/routines.js  (medals + routine playlists; its own localStorage keys; reads the result screen)
```

All UI scripts are injected into the lobby page by `app/main.js` (`UI_SCRIPTS`), the same way the existing lobby scripts are. Nothing is recorded unless the game patches are applied; with no recorder installed each hook is a no-op.

Everything the analytics features keep stays on the player's PC (IndexedDB and localStorage).

---

## 3. Game patches (`tools/patch-*.cjs`)

Each patch edits the game's compiled bundles in both copies (`app/site/next/js` and `app/site/_assets/r20261021-1/next/js`), is safe to run again (it uses markers such as `/*aim-enemy-tracer-...*/`), and can be tried on a scratch copy with `AIM_SITE_DIR=<copy of app/site>`.

| Patch | What it adds |
| --- | --- |
| `patch-analytics-hooks.cjs` | Three one-line calls out of the round code: round start (map, weapon, mode, tick length, body shapes with radius and head size), every tick with its snapshot and events, round end (`cleared`, `died`, `time`). The simulation events the page cannot otherwise see (shot, kill, enemyShot, playerDead) arrive this way. |
| `patch-shot-movement.cjs` | Player movement on every shot event: horizontal speed, forward and strafe input, walk, crouch, airborne, ticks since the last input. Feeds counter-strafe and walk/crouch findings. |
| `patch-enemy-shot-tracer.cjs` | Every `enemyShot` event carries origin, direction and the point where the ray ends (a wall, the aim point, or the end of range). |
| `patch-enemy-tracer-draw.cjs` | Enemy tracers are drawn along that resolved path instead of a guessed one. Shots stopped by a wall are drawn up to the wall. |
| `patch-enemy-tracer-original.cjs` | The same enemy tracers in the "Original" appearance mode (they used to need Custom mode). |
| `patch-sight-line.cjs` | **Line of sight to each enemy** (19 Nov 2026). Every enemy in the analytics snapshot says whether the player can see it (`los` 1 or 0: a clear line from the player's eye to its head, chest or legs, or to a sphere target's centre; walls, smokes and flash volumes block it), reusing the game's own bot "can see" test (`canSee`). The worker also forwards the player's `blindUntil` (a flash). Only computed while analytics is on. |
| `patch-swing-events.cjs` | A short list of world events kept by the simulation: you killed or hurt a bot, and sounds you make (gunshots, running footsteps). |
| `patch-swing-jump-land-chance.cjs` | A landing sound, and a per-trigger swing chance (rolled with the dispatcher's own RNG; a chance of 100 % never touches the RNG, so old drills replay exactly as before). |

The worker side (`app/site/local/worker-game-entry.mjs`) keeps only the fields the recorder reads and posts them in batches of 32 ticks, at round start and at round end, so the page is not messaged 128 times a second. `threaded-game-bridge.mjs` forwards them to `window.__aimAnalytics.receive`.

---

## 4. Enemy tracers

- `app/site/aim-tracers/enemy-shots.mjs` turns an `enemyShot` event into a tracer shot.
- `renderer.mjs` draws enemy trails (capped at 40 live at once) and, in Original mode, accepts enemy shots only (the game draws the player's own tracers there).
- `settings.mjs`: the enemy tracer is on by default with its own colour.
- `app/advanced-tracers.js`: the settings panel has separate "Your shots" and "Enemy shots" boxes.

---

## 5. Studio: swing triggers and sound areas

Studio compiler version 25 (`app/studio/drill.js`, editor in `app/studio/studio.js`).

- **Swing triggers.** A bot holds its angle and swings after an event: you kill a bot (`kill`) or hurt or kill one (`damage`) within a radius of it. With several holders in range the nearest one swings. Delay is a min and max in seconds.
- **Sound areas.** Draw a box on the map; a sound you make inside it sends the bot to a spot. Sound sources: your gunshots, running footsteps and landings. Crouch-walking and Shift-walking are silent; jumping up is silent.
- **Swing chance.** A percent (0 to 100) that a trigger or sound makes the bot swing, so it is not the same every time. Stored as a percent, passed to the game as 0 to 1.
- **Editor.** A ring shows the radius, a blue box shows the sound area with a dashed link to the spot, the box has grab handles (corners and edges resize, the centre moves), and the box and spot move with the bot when it is moved in a group.
- Not wired yet: reloads, weapon swaps, ability sounds, bot sounds.

---

## 6. Menus and shell

- **`app/menu-shortcuts.js`.** T (your own Restart key) on the Eliminated screen clicks Play again; Esc a second time in the pause menu clicks Resume. Each has an On/Off row in Settings > General > Mouse (default On). Esc is not a user gesture for the browser, so Resume asks `main.js` (`aim:gesture-run`) to run a named action with a gesture.
- **`app/sibling-switch.js`.** A "Switch difficulty" button on the result screen and in the pause menu for drills that have an `-easy` / `-hard` pair in `scenarios/`. `scripts/build-scenarios.mjs` records the pairs in `training-set.json`; `main.js` answers `/api/local/drill-sibling?code=`.
- **Quit tab.** A "Quit" tab after Settings in the lobby top bar (asks first), wired through `preload.js` and `main.js` (`aim:shell:quit`) so the performance recorder and the analytics store finish writing.

---

## 7. Analytics recorder (`app/analytics-recorder.js`)

Records, per round, tagged with the map and the drill's share code:

- **Shots:** time, weapon, hit part, hit point, distance, target, kill; then optional trailing fields: movement at the shot, crouch amount, the nearest enemy (range, distance from its centre, side and height), and the aim and bullet angles (yaw and pitch of the aim, and the error of the bullet from it).
- **Deaths:** position, tick, killer, cause (shot or fell), near misses by the killer.
- **Engagements** (one per enemy life in view): aim travel in degrees, player movement, aim error when it appeared, flick or strafe, first-contact positions of both sides, and (new) the tracking entry, see section 8.
- **Near misses:** how far a missing shot passed from an enemy's body box and whether above or below its centre.
- **Look list:** where the player was looking (16 yaw sectors, one entry per change), for the coach's "angles you never checked" rules.
- **Input settings** per round (sensitivity, ADS and scoped multipliers, inverted Y, a mouse acceleration notice).
- **Dropped shots:** shots after your death and the rest of a burst after a kill (up to 0.35 s) are not recorded, so they are not counted as misses.

Storage: IndexedDB `aim-analytics`, store `rounds` (raw rounds kept 30 days) and store `days` (one summary row per day kept for good, with counts per map, weapon and mode and a death grid and a fight grid in 1 m cells). Rounds older than 30 days are rolled up and the raw rounds deleted, with every row counted once. Rounds are queued when they end and written asynchronously, never during play; a safety copy goes to localStorage on `pagehide`. Every IndexedDB call is in try/catch.

Readers: `rounds()`, `days()`, `engagements()`, `nearMisses()`, `fightCells()`, `raw()`, `clear()`.

New in the latest sessions:

- `tracking` on each engagement (section 8).
- `KR` in the round header: the radius of each sphere-shaped template, so round targets can be drawn to scale. `rounds()` also returns `targetShapes` and `targetRadii`.

---

## 8. Tracking measurement

Added to the recorder as one trailing field (index 20) of each engagement row. It measures how well the crosshair stays on an enemy that is moving across your view.

- **Sampling.** Every tick the enemy is in play, from the snapshot's aim angles and the enemy's position. A tick is *sampled* when the enemy's direction, seen from the player's eye, turns faster than 4 degrees per second (the player's own aim does not enter this).
- **On target** is measured against the body box and against the head (a sphere of 13 cm radius, scaled with the body; a sphere-shaped enemy has body = head).
- **Stored per engagement:** sampled ticks, ticks on body, ticks on head, summed angle error to the body and to the head, summed lag (signed error along the enemy's path: positive = the crosshair is behind), summed jitter, jitter pairs, ticks to lock on the body and on the head (first run of 0.15 s on target, counted from first sight), summed enemy angular speed.
- All thresholds are guesses and are named constants at the top of the recorder (`TRACK_MOVING_DEG_S`, `LOCK_S`, `HEAD_RADIUS_M`); they have not been tuned against real play.

**Sight (19 Nov 2026).** The recorder used to start an engagement when an enemy was alive and inside the view cone, with no wall test, so an enemy behind a wall already counted as "in view" and time to kill, first-sight aim error, flick or strafe, hold time and tracking all started too early. With `patch-sight-line.cjs` the snapshot carries `los` and the player's blindness, and the recorder separates two things:

- An engagement **starts** when the enemy is seen or when it fires at the player. Enemies often see you first (off screen, behind you, through a smoke, while you are flashed), and the fight still counts for fights lost and deaths.
- The **seen tick** (row index 22) is the first tick the player could really see it: in the view cone, with a clear line, and not blinded. Everything about the player's aim starts there: the aim error at first sight, aim travel and movement (summed only while the enemy is seen), the tracking samples and the lock time (a lock run is cut while the enemy is hidden).
- **Hidden ticks** (index 21) are the ticks after first sight on which a wall, a smoke or a flash hid the enemy again (an enemy only off screen is not hidden: that is pre-aim and counts). `visibleTimeToKill` = kill - seen - hidden.
- Rounds get `sl: 1` when they carry sight data (`rounds()[].sight`). **Older rounds are kept but not used** for anything that depends on when you saw an enemy: kill time and its trend, crosshair height at first sight, flick or strafe, strafe by map or drill, hold sooner, died without firing back, and tracking (coach rules and the Stats Progress and Tracking views). Fights lost, fight spots and angles, deaths and the hit report still use every round. The Stats Tracking tab shows how many recorded fights have sight data.

Where it shows up: the Stats Tracking tab, a one-line readout on the result screen, and two coach tips (section 10).

---

## 9. Hit report (the result-screen panel)

In `app/analytics-ui.js`, shown on the result screen next to the stat strip.

- **Layout.** A body figure (head, chest, arms, torso, legs) with a dot per shot, rings for near misses, and exactly one list of zones beside it (Head, Chest, Arms, Torso, Legs, every row shown even at 0, no other stat rows).
- **Tabs.** "Your killer" (your shots at the enemy that killed you, tied by id or by type with a note when matched by type only) and "All my shots". Picking a bot in the pre-aim list switches the first tab to that bot. The tab bar does not change the report's height.
- **Where it shows.** On died, cleared and timed-out result screens. Cleared and timed-out screens show only the "All my shots" pane, because there is no killer. (Before this fork's latest work it showed only after a death.)
- **Round targets.** When the shots were at sphere targets (Target Workshop modes) the figure becomes a circle drawn to scale with the target's radius, with a dashed centre ring, four outer sectors that light up when hit, hits as dots and near misses as rings outside; the list becomes Centre, Top, Right, Bottom, Left. The shape follows the targets your hits landed on; a round with only misses uses the recorded shapes.
- **Tracking readout.** One line under the panes: on body, on head, lock time, lag.
- Placement adapts: a column left of the card on wide windows without a Position map, in the card body on map screens, under the stat strip on narrow windows. The entrance animation plays once per screen.

---

## 10. Coach (`app/coach.js`, `app/round-tip.js`)

`window.__aimCoach.insights({ code, map, weapon, since, limit })` resolves to findings `{ id, title, detail, severity, evidence, sample, summary }` in plain language; each rule needs a minimum sample and says nothing without it. Rules: where you miss (side and height, sideways drift), flick vs strafe kills, crosshair height at first sight, time to kill and its trend, death spots and repeats, deaths by cause, deaths with no shot back, fights vs several enemies, fights lost and from which spot and angle, holding too long, angles never checked and over-checked, wasted swings, headshots and accuracy by weapon, strafe kills by map or drill, burst length and spray control (from the recoil fields), accuracy by range, shooting while moving (counter-strafe), walking and crouching, sensitivity changes and extremes, mouse acceleration, consistency, trends, and two new tracking rules:

- `tracking`: trailing, overshooting, losing, or tracking well (needs 8 engagements with 32 or more sampled ticks; verdict from the share of ticks on body and the mean lag).
- `tracking-lock`: a typical lock time of half a second or more.

`roundTip()` picks one tip about the round that just finished by comparing it with the player's other rounds of the same drill. `round-tip.js` shows it above the result-screen buttons. Every finding has a one-line summary for a collapsed card, an icon, and (in the Stats Coach tab) a modal with its numbers, a hoverable drill or map reference and a visual.

---

## 11. Stats panel (`app/analytics-ui.js`)

Open from the training history page (inline) or as a dialog. Tabs:

- **Heatmap.** Deaths and fights per map on the minimap (or a plain grid), filters for map, mode, drill and weapon, layers Deaths, Fights, Both, brightness, zoom and pan.
- **Progress.** Accuracy, headshot rate, near misses, kill times and more over 7, 30 or 90 days, one point per day, or one per round or session when there are only a few days of data.
- **Tracking.** Body or Head toggle. Tiles: on target, average error, time to lock, lag, smoothness; by weapon and by day. Rounds recorded before tracking existed show nothing.
- **Coach.** The findings as cards, each with a Numbers modal.

---

## 12. Target Workshop tracking scenes

Five round-target drills in `scenarios/tracking-*.json`, generated by `tools/make-tracking-scenes.mjs` (run it, then `node scripts/build-scenarios.mjs`). They use the game's own tracking pattern: a sphere actor with a path or strafe behaviour, scoring `tracking` (time on target), hold-to-fire, invincible target, 60 seconds. `item.type = "ball"` puts them in the Target Workshop tab, where the game groups them under a Tracking filter.

| Scene | Target |
| --- | --- |
| Tracking: Slow sweep | Big ball, 3.2 m/s across 14 m |
| Tracking: Fast sweep | Medium ball, 8.5 m/s |
| Tracking: Diagonals | Zig-zag up and down while crossing |
| Tracking: Strafe reversals | Random strafe with stops and reversals |
| Tracking: Small and far | Small ball 26 m away |

Speeds and sizes are first guesses. Each scene has Target size and Round length sliders in Tune.

---

## 13. Medals and routine playlists (`app/routines.js`)

### Medals
- Every finished run is read from the result screen's big score (after it settles, 1.5 s) and kept per drill (newest 40).
- A medal compares the run with the runs *before* it: **bronze** is your median of the last 20, **silver** the 80th percentile, **gold** at least your best of those. They start after 3 runs. A unit of seconds is treated as lower-is-better. Runs that ended with your death get no medal and do not count.
- Custom numbers per drill can replace the automatic ones (Medals tab, Edit).
- Badges are generated vector art in the style of the game's rank icons (a steel shield around a faceted gem): bronze a rhombus with 1 pip, silver a hexagon with 2, gold a pentagon with 3. They appear on the Medals tab, the result strip, drill card chips, gallery cards and step rows.

### Routines
A routine is an ordered list of steps; a step is a drill plus what must be done before the next one: number of runs (1 to 99), an optional minimum score, an optional minimum medal, an optional enemy rank, and, for drills with an easy and hard pair, which of the two. A run counts when it is that drill, you did not die, and it meets the minimums. Runs of other drills are ignored. After the last step the routine is recorded as completed.

### Screens
- **Routines tab** in the lobby top bar (next to Collection): a full page with My routines and Medals.
- **Editor.** Name, an **Add a drill** drop-down panel with Bookmarked (the game's own bookmarks, `aim-offline-favorites-v1`), Recently played (from the analytics rounds and the runs kept here) and All drills, plus a search over every drill. Cards show the map picture or a drawn preview of the Target Workshop scene, the drill kind, your best medal and how often the drill is already in the routine.
- **Step rows** show the thumbnail, name, kind, description, best score, runs and best medal, and the settings. The enemy rank uses the lobby card's own control (badge, two arrows, pips, name) over the thumbnail; a step at the rank the drill was made with stores nothing (the drill's default), like the card. An Easy | Hard switch swaps the step to the other drill of the pair.
- **Drill cards** in VALORANT Training and Target Workshop get a "+" button that adds the drill to the routine being built (the draft, kept in `aim-rt-draft-v1`) and a medal chip once the drill has a medal.
- **Result screen strip.** The medal, a new personal best, how far the next medal is, the routine progress and, when a step is done, a **Next drill** button that leaves the round and starts the next drill (setting its enemy rank first).
- Starting a drill: Target Workshop drills from their tab's card, any other from the first tab's card (the game has no other API); a round in progress is left through the result screen's Exit.

### Data (localStorage)
`aim-rt-runs-v1` (per drill: name, unit, runs, best, medals earned, custom thresholds), `aim-rt-routines-v1` (routines, the active one, completed), `aim-rt-draft-v1` (the routine being built).

### Look and feel
Everything uses the theme's tokens (`--es-*`), square corners (the base site forces rounded buttons with `!important`, so the rules use the theme's `html[data-aim-local]:not(#es) body` prefix), slanted red primary buttons, raised ghost buttons, cut-corner panels with a red edge.

---

## 14. Tests (`tests/`)

Run all: `node tests/run-all.cjs`. Each file runs on its own with `node tests/<file>`.

| File | What it covers |
| --- | --- |
| `test-analytics-idb.cjs` | The recorder on an in-memory IndexedDB (`fake-idb.cjs`): shots, deaths, engagements, near misses, contact, roll-ups, dropped shots, tracking, sphere radii |
| `test-analytics-ui.cjs` | Hit report (both shapes), result-screen panel placement and entrance, Stats tabs, tracking tab, coach cards and modal, heatmap, progress |
| `test-coach.cjs`, `test-coach-position.cjs`, `test-clearing.cjs`, `test-round-tip.cjs` | Coach rules, positions and clearing, round tip |
| `test-routines.cjs` | Medals, routines, storage, result strip, the Routines page, picker, thumbnails, rank and difficulty, medal badges |
| `test-menu-shortcuts.cjs` | T and Esc shortcuts with a fake page |

At the time of writing every test passes. Run `node scripts/build-scenarios.mjs --check` for the scenario files.

---

## 15. Things to know and known limits

- **Not tuned.** The tracking thresholds, the medal percentiles (median, 80th, best) and the new scene speeds and sizes are first guesses. Tune them after real play.
- **Rank side effect (dev copy).** Setting an enemy rank from a routine uses the same endpoint as the lobby card. In this unpacked copy that rewrites the drill's default in `scenarios/`; in an installed build it is a per-player setting. A step's rank also stays set on that drill afterwards, as if picked on the card.
- **Starting a drill from a routine** clicks the lobby's own cards. If a card is hidden by a search filter it cannot be found and nothing starts.
- **Scaled targets.** Round targets scaled larger or smaller than normal may be drawn slightly off in the circle hit report, because the stored radius ignores the actor's scale.
- **Sight data is not yet verified in a live round.** The patch was checked for syntax, scope (the sight test, the template map and `snapshot()` are in the same block of the simulation), idempotence and against synthetic ticks in the recorder tests, but a real round was not played with it. The Stats Tracking tab says "Line-of-sight data on X of Y recorded fights"; if X stays 0 after playing a round, the data is not arriving and the coach's timing rules stay silent (safe, not wrong).
- **Blindness is approximate.** The player is treated as unable to see while `blindUntil` is ahead of the round time; a partial flash counts as fully blind for its duration.
- **Old rounds** have no tracking data and no stored radii; the circle report then falls back to the farthest hit from the centre.
- **Patches are order-dependent.** Run `patch-trades.cjs` before `patch-swing-events.cjs`, and `patch-swing-jump-land-chance.cjs` after it. `patch-analytics-hooks.cjs` upgrades a tree patched by its first version in place.
- **Local data.** `test-data/` (the desktop app's local user data, backups and performance runs) is ignored and never committed.
- **Installed build.** An installed openVaim keeps the old code until it is rebuilt (`npm run build` in `app/`).

---

## 16. Ideas not built yet

- An aim-trace replay of a death or a missed fight (the recorder already keeps every tick's aim and enemy positions).
- A session summary screen; warm-up vs later rounds; reaction and first-shot timing; overcorrection after a flick; counter-strafe timing in milliseconds; an accuracy-by-minute fatigue curve.
- Adaptive drills (the coach picks the next drill from the weakest metric); a daily routine with a streak; a ghost of your best run.
- A routine quick-builder from the coach's weak spots or the last session.
- Medals on Target Workshop drills' own Tune screen; goals ("70 % on body when tracking").
