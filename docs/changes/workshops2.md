# Workshops 2: 20 more Target Workshop drills, thumbnails for light-up drills

## For players

- **10 new drills, each in Easy and Hard (20 files)** in the Target Workshop tab:
  - Reaction: **Light chain** (six points light up in turn, left to right) and **Light scatter** (nine points light up in a shuffled order). A point that goes dark first costs points. Tune lets you change how long a point stays lit.
  - Tracking: **Sway** (a pendulum ball) and **Player strafe** (runs, stops, taps like a player). Like all tracking drills they are scored by time on target and need no button.
  - Moving: **Counter-strafe: Stop and shoot** (you move with A and D, balls stand still far apart, shots fired while running go wide), **Long-range sprint peek** (a small ball 40 m away sprints and vanishes quickly), **Bounce: Wall rush** (a billiard-style ricochet) and **Precision: Under movement** (a small swaying ball).
  - Spray: **Vandal control** and **Phantom control**, a ball with a lot of health (Vandal 240 / 420, Phantom 600 / 900).
- The Routines picker and the Target Workshop cards draw the light-up drills with their points as dashed cells and the lit ones filled.
- A short guide, "which drill trains what": `docs/workshop-guide.md`.

## Technical

- `tools/make-workshop-scenes.mjs`: ten more `stem()`s appended after the 22 of round 1 (sort 249 to 268, same `workshop-<stem>-easy|hard` naming, share codes from the name). The round-1 files are unchanged (the generator rerun leaves them byte-identical; the working tree only differs in line endings).
  `docOf` got three additive switches: `built.dispatcher` (the scene has `dispatchers` and no spawner), `built.playerMovable`. Nothing else in the document changes for old drills.
- **Dispatcher drills.** Scene: `dispatchers: [{ id, name, routes, order: "sequence" | "shuffle", maxAlive, interval, faceTarget }]`, each route `{ templateId, streak: [1,1], at: {x,y,z}, point: true, stay: [s,s] }`. Read from the game's dispatcher code (`BiMsX6Xn.js` hb/hb0/K8: sequence walks the routes in order, shuffle uses a bag; `stay` makes the point leave after that time, `point` places it at `at`). The game's own lobby calls two or more point routes without a spawner "N points light up in turn" and files them under Reaction (`IP` in `ChJ6FlD4.js`). Tunables `dispatcher.stay` (needs the same fixed stay on every point) and `dispatcher.maxAlive` exist in the Tune screen reader (`Dc2Dm9E6.js`). The card preview and the Tune preview already handle dispatchers (`nD`/`Z9`).
- **Tracking.** Sway = area spawner of size 0 with a `sway` behaviour; Player strafe = `strafe` behaviour (dwell, tap, counterStrafe) on a tracking scene. A recorded `replay` behaviour was not used: it needs recorded frames from the Studio, so the strafe with random stops stands in for it.
- **Tracking needs no button:** all tracking scenes (`tracking-*` and `workshop-track-*`) are `scoring: "tracking"` with `targetsInvincible`, `fireMode: "hold"`, no shooter, no respawn. `tools/patch-tracking-no-fire.cjs` makes the game count every frame the aim ray is on the target. The test now checks every scenario of that kind and that the patch marker is in both game bundles.
- **Thumbnails.** Checked `thumbModel` in `app/routines.js` for every `type: "ball"` scenario with the real files (the test below). Only dispatcher drills were blank, so I added a small additive block to `thumbModel` (routes with a place become cells, `maxAlive` of them filled). The Target Workshop cards use the game's own projection (`api.project`), which draws dispatchers already.
- **Medals.** Read `app/routines.js`: medals use the result screen's number with its unit; every ball drill (clicking or tracking) prints "pts", which is higher-is-better, so bronze/silver/gold (median / 80th percentile / best of the last 20 runs, from run 3 on) work unchanged. Only a unit of seconds flips it. Test added.
- Tests: `tests/test-workshop-scenes.cjs` (dispatcher shape and point sanity, lobby reading, dispatcher tunables, sway/strafe tracking checks, round-2 ranges, tracking-no-button, thumbnail model for every ball scenario, medals for clicking/tracking), `tests/test-routines.cjs` (dispatcher thumbnail). `node tests/run-all.cjs`: all 12 files pass.

## Not verified

- Nothing was played and no app was launched. Behaviour (dispatcher `stay` and `point` placement of a sphere at its centre, sequence order, sway axes, strafe walk, the movement inaccuracy of Stop and shoot, health versus hits) comes from reading the game code and is untested live. If a dispatched sphere drops to the floor instead of staying at `at`, Light chain / Light scatter need a height tweak.
- The Target Workshop card preview was checked by reading the game's code, not by drawing it; the Routines thumbnails were checked as numbers (positions, sizes, lit counts), not as pixels.
- The medal strip was not seen on a live result screen; the unit "pts" for tracking runs is read from the game source (`summary.unit ?? "pts"`).
- Hard values (speeds, stay times, health) are first guesses and may need tuning after play.
