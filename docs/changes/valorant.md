# Valorant Workshop scenarios (workstream "valorant", 1.6.0)

## For the changelog (plain words)

- 30 new angle-holding and anti-flash drills on 8 maps (Sunset, Ascent, Haven, Bind, Corrode, Split, Lotus, Summit), 14 of them as Easy / Hard pairs the "Switch difficulty" button already understands.
- Situations: wide-swing duels, jiggle-peek bait (hit the jiggler and a partner swings), two-bot crossfire with trade timing, clearing A site angle by angle, post-plant defence where attackers swing when they hear you shoot, run or land, spray transfer between close bots, Operator holds and Marshal quick-scope duels, long sniper duel, flash timing at different delays, flash-and-swing pairs, dry-peeking a held angle, a counter-strafe test against strafing bots, a staggered retake, a two-angle crossfire, and enemies rotating across a lane on a timer (lurk timing).
- Easy bots are Bronze (slow to react, shoot slowly, dying does not end the round). Hard bots are Diamond or better and dying ends the round.

## Technical

Files (all new): `tools/make-valorant-scenes.mjs` (generator), `tools/valorant-map-kit.mjs` (map helpers), `scenarios/workshop-*.json` (30 files, sort 300-329, names start with the map, share codes by the documented sha1 recipe), `tests/test-valorant-scenes.cjs`. `app/training-set.json` is git-ignored; `node scripts/build-scenarios.mjs` writes it (139 scenarios).

How it works: the generator reads positions from existing scenarios (player starts, peek routes cover -> spot, holders), writes each situation as a Studio drill and compiles it with the Studio's own `compile()` (`app/studio/drill.js`), so swing (`swing`), sound (`hear`), trade (`afterKill`) and flash fields are exactly what the Studio writes. Each doc must pass the game's validator (`D_iGclxB.js`, loaded with its map-registry import stubbed) or nothing is written. Floors: `app/studio/map-data.js` `loadMap()` works in Node; every bot position and route point must stand on walkable floor or a placeable box top. Output is deterministic (seeded `Math.random` during compile); a second run is byte-identical, and stale `workshop-*` files are removed. `--dry` and `--verbose` print what would be written.
Pre-aim routes start far from their bots, so for Bind, Corrode the generator picks a start on one of the route's own floor spots, facing the most visible bot spots (`bestStart`). Sunset, Ascent, Haven, Split, Lotus, Summit use the original starts. `aimShuffle` groups let `drill-shuffle.js` give the bots a random rifle and Jett model per start (snipers and flashers keep theirs).

Test: `node tests/test-valorant-scenes.cjs` (also in `run-all`) checks files equal generator output, fields, unique names and codes against all scenarios, sort range, easy/hard pairs, the game validator, finite numbers, floor positions, template ids, known behaviours, swing radius reaching another bot, sound areas containing the start, trade targets existing. `run-all` is green (9 files).

## Not verified / limits

- Nothing was played live (no pointer lock). Timings are from the compiled fields, not observed.
- The sight check uses the map's "projectile" collision and is approximate; the generator only warns. Haven A-site flash spot (-85.2, 3, -68.5) gets a warning, though a creator scenario uses it.
- Flash-and-swing pairs are exact only for the first cycle: after kills each bot returns on its own timer.
- Hold drills use `type: "hold"`/`"flash"`; the brief's `basic` is the range category (no map), so it is not used.
- Easy/hard differ in bot rank, wait times, bot count and death rule, not in positions.

## Candidate engine features (not faked)

- Forcing a movement rule on the player (counter-strafe discipline): bots only punish run-and-gun through their own aim; no "shots while moving do not count" rule.
- Keeping flash-and-swing partners in sync after kills (a swing gated on another bot's flash pop).
- Sound events for reloads, weapon swaps, abilities and bot footsteps (already listed as not wired).
- A swing trigger on "player seen"/line of sight, and a player-death retake mode with a bomb timer.
- Per-bot enemy rank override inside one scene when the lobby rank picker is used.
