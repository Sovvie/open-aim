# Workshops: 44 new Target Workshop drills

## For players

- **22 new round-target drills, each in an Easy and a Hard version (44 in all)** in the Target Workshop tab. Hard has smaller balls and/or faster, less predictable movement.
- Flick: Gridshot 3x3, Gridshot 5x5 wide, Wall of six, Wide flicks, Speed clicks. Switch: Close pair, Far pair. Precision: Micro ladder, Pinpoint, Long range.
- Reaction: Blink (a ball that flashes on and off), Pop-up (a ball that shrinks away, an expired ball costs points).
- Moving: Strafe at walk, run and full-sprint speed (the game's real speeds 2.97, 5.4 and 6.75 m/s), Counter-strafe stops, a Jumping ball, Zig-zag bounce, and Burst control (a slowly drifting ball that takes several Phantom hits).
- Tracking: Vertical, Depth (the ball runs toward and away from you) and Orbit.
- The Switch difficulty button on the result and pause screens now works for these pairs too (it used to look only in the VALORANT Training tab).
- Sizes in the descriptions are given in degrees of view, the same unit the Tune screen shows.

## Technical

- `tools/make-workshop-scenes.mjs` writes `scenarios/workshop-<drill>-easy|hard.json` (sort 205 to 248). Deterministic: fixed timestamp, share codes from the name like the tracking generator. Run it, then `node scripts/build-scenarios.mjs`. Sizes and spacings are written in degrees and converted to metres for the wall distance.
- Lobby filter (read from the game's drill reader in `ChJ6FlD4.js`): scoring tracking is Tracking; a blink behaviour is Reaction; strafe, sway or path is Moving; everything else is Flicking. Pop-up carries a blink that would only start after 30 s (balls respawn long before) so it lands under Reaction.
- Click drills use the same pattern as Studio's target zones: sphere template, `respawn` mode `reSpawner`, grid, area or slots spawner. Micro ladder uses `slots` without respawn so the next ball is the next place in line.
- `tests/test-workshop-scenes.cjs` reproduces the scene reader checks (D_iGclxB.js), the Tune screen rules (value inside min..max, whole numbers, ids exist), the lobby filter, uniqueness of names, codes and sorts, and view sanity (ball width, edge of view, floor, overlap). It also checks the files on disk equal the generator output.
- `app/sibling-switch.js`: small additive change. It asks the lobby list whether the sibling is a `ball` drill and, if so, opens the Target Workshop tab and clicks the `.tw-card` play button (same as `routines.js`).

## Not verified

- No round was played and the app was not launched (no live check of balance, speeds or the Tune screen). Behaviour semantics (strafe, blink, decay, jump, slots, grid respawn) were read from the game code, not observed.
- Burst control relies on the sphere `health` field and the Phantom's recoil with `perfectAccuracy` off; the hit count per kill is estimated from weapon damage, not measured.
- No decoy drill: the game has no penalty for shooting a second target, so a decoy cannot be scored.
- The Switch difficulty change for ball pairs is untested live.
- Drills with a wall higher than eye level lift the area or grid so the lowest ball clears the floor, so some walls sit above the crosshair.
