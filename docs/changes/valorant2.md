# Valorant Workshop, round 2 (workstream "valorant2", 1.6.0)

## For the changelog (plain words)

- 41 more VALORANT Workshop drills (71 in all), now also on Pearl, Icebox and Abyss, plus more on Haven, Split, Bind, Lotus, Corrode, Ascent and Sunset. Most come as Easy / Hard pairs for "Switch difficulty".
- New situations: shoulder-peek reads (an enemy shows only a shoulder; a partner swings when it hears you shoot), off-angle chains (each kill brings the next enemy at a different angle), trade swings with two different delays (one partner right away, one later), lurkers that come from behind you when they hear a shot or a step, choke entry with a trading partner, long Operator and Marshal lanes with enemies that peek and repeek on different timers, and staggered retakes on Ascent A and Split A.
- Fixes to round-1 drills (names and share codes unchanged): enemies that stood on a ledge the drill does not have are now on real floor, Haven A flash-and-swing no longer uses an angle you cannot see from the start, and drills where you started turned away from the enemies (Bind, Corrode, Sunset A) now start facing them.

## What changed in round 1 (11 of the 30 files)

All of these were found by new checks in the generator, and the same checks are in the test now.

| Problem | Where | Fix |
| --- | --- | --- |
| `bestStart` turned the player the wrong way (it subtracted the mean bearing instead of adding it), so the enemies ended up twice as far off to the side | Bind A Lamps, Corrode A Corner (both tiers) | sign fixed; the enemies are centred |
| A holder was placed on a box top that the scenario does not contain; the game drops a bot onto the floor under it, in a pit (Bind) or a floor the player cannot see | Bind A Lamps (the 14.7, -106.7 bot), Lotus C Long hard (the "high ground" bot, whose description is now "far right") | spots must be on real floor (`floor: true`); Lotus uses a floor spot |
| Start used for another drill faced 70 to 115 degrees away from the enemies | Sunset A clear in order, Sunset A spray transfer | start is turned to the middle of the enemies (`faceMean`); both tiers still share one start |
| Entry angle of a flash-and-swing pair not visible from the start (the generator only warned) | Haven A flash and swing | uses the angle that is visible; hard is now one pair plus a second flasher |

The generator now throws (instead of warning) when a bot's first position cannot be seen from the start (small margin for a hairline gap), and snaps a bot 0.1 to 0.45 m off the floor onto it. The other 19 round-1 files are byte-identical; names, share codes and sort numbers of all 30 are asserted in the test.

## Technical

Files: `tools/make-valorant-scenes.mjs` (round-2 scenes after the round-1 ones, sort 330 to 370, helper functions `pickStrict`, `behindSpots`, `peekFrom`, `openingFor`, `faceMean`, `groundAll`), `tools/valorant-map-kit.mjs` (`loadPointKit`, `MAPS_WITHOUT_DATA`), `tests/test-valorant-scenes.cjs`, `scenarios/valorant-*.json` (41 new, 11 changed), this note.

How the new drills are made (all positions come from existing scenarios, all hiding places are found on the map's real floor):
- `pickStrict` takes bank spots that are on real walkable floor, visible from the start (also from 5 cm higher), 8 to 60 m away, and prefers spots next to some geometry (1 to 5 of 8 sides blocked within 1.8 m: not the middle of an open lane, not a pit). On open maps (Pearl) it falls back to open-floor spots. `openingFor` loosens spread, view angle and distance in that order if a map has too few spots.
- `peekFrom` uses `findCover` to give any visible spot a hiding place the start cannot see (1.6 to 14 m away).
- Shoulder reads: shoulder bot out 0.28 to 0.35 s (shorter than a Bronze reaction), partner is a sound-gated peeker (`hear`: shot, hard also footstep).
- Off-angle chain: holders linked by `tradeOf` (left/right zigzag order), one at a time.
- Trade swings: two partners with `tradeOf` the same kill, windows 0.9-1.3 / 2.3-2.9 s (easy) and 0.25-0.4 / 0.9-1.2 s (hard).
- Lurkers: `behindSpots` finds floor points 130 (then 115) degrees or more off the facing, in sight of the start, then a sound-gated peeker (`hear`, 8 to 9 m box around the start) swings from there; a holder in front keeps the player busy.
- Choke: lead strafer, crouched side holder, and a peeking partner that trades the lead (`tradeOf`); hard adds a fourth that trades the side holder.
- Repeek: peekers with `randomWait`, different `coverWait` and an offset `delay` per bot; the round weapon is Operator or Marshal.
- Retake: arrival `delay`s staggered; on hard the late arrivals are peekers where a hiding place exists, else holders.
- Abyss has no floor data in the app: the Abyss drill stands only on points other scenarios already use (`loadPointKit`), sight lines are not checked there.

Test (`node tests/test-valorant-scenes.cjs`, also in `run-all`, 12 files green): files equal generator output; round-1 names, codes and sorts fixed; sort 300 upward without gaps; the game validator; every spawner / dispatcher spot on a real floor (0.2 m); the player can see where every non-gated bot shows up; the middle of the enemies is within 70 degrees of the facing; per family structure checks (shoulder under 0.4 s with one sound-gated partner, chain of one-at-a-time kills, two partners on one kill, lurkers 110 degrees or more behind plus a bot in front, a trading partner at chokes, three or more distinct arrival delays at retakes, Abyss bots only on known points); at least 11 maps including Pearl, Icebox and Abyss.

## Not verified / limits

- Nothing was played live (no pointer lock). Timings come from the compiled fields: for example a flash pair's "about a second after the pop" is computed from route lengths and the 0.7 s fuse, not observed. Sound-gated lurkers need the sound events the game already has (shot, footstep, land), which I did not hear fire.
- Sight and "next to cover" use the map's projectile collision, which is approximate (it may differ from what the real player model can see through gaps). Open maps (Pearl, parts of Bind) keep some bots in open floor because the creators' pre-aim spots there are open.
- Fracture and Breeze are not maps of the app (no map ids), so nothing could be made there. Abyss has no floor data, so only one Abyss drill exists. Haven B has no scenario in the repo to derive positions from.
- Chains and trades: after a kill the next bot appears at its own fixed spot; positions do not adapt to where the player stands.
- Easy/hard still differ in bot rank, waits, trade windows, bot count and the death rule, not in the map positions (except where the hard version adds bots).

## Candidate engine features

- A trade that depends on where the player stands (appear at the angle the player is NOT looking at).
- A lurker trigger by line of sight / "player has not turned around for N seconds".
- Per-bot flash-pop to swing gating for flash-and-swing pairs after the first cycle (still open from round 1).
