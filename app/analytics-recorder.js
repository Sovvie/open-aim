// Analytics recorder, phase 1 (16 Nov 2026, marker aim-analytics-v1) and phase 2 (17 Nov 2026, marker aim-analytics-v2).
// Keeps, for every round you play, each shot (time, weapon, hit part, hit point, distance, target, whether it killed) and each
// death (position, tick, killer), tagged with the map and the drill's share code, so later phases can total them per weapon and
// per map. Phase 2 adds per-enemy engagements (aim travel, player movement, aim error when the enemy appears, flick or strafe)
// and near misses (how close a missing shot passed to an enemy, and above or below its centre).
//
// Where the data comes from: the game's own simulation events and snapshots. tools/patch-analytics-hooks.cjs adds three calls to
// the game loop (round start, EVERY tick with its snapshot and events (the events may be empty), round end). The game runs in a
// worker, so the patch also posts them to the page in batches (worker-game-entry.mjs -> threaded-game-bridge.mjs ->
// __aimAnalytics.receive); without the worker the loop calls window.__aimAnalyticsStart / Feed / End below directly.
// Without the patch nothing is recorded. The aim angles come from snapshot.player.yaw / .pitch (radians; the simulation's
// per-tick look state, set from the mouse in BiMsX6Xn.js y5() and copied by the snapshot in CnrSARj_.js snapshot()), enemy
// positions from snapshot.actors[].position + offset.
//
// Storage: the game keeps only per-run totals (score, hits, shots, headshots) in its training history, so rounds are
// kept here, in IndexedDB database "aim-analytics" (version 1):
//   store "rounds": raw rounds, keyPath "id", index "day" (local date YYYY-MM-DD of the round's start). The id is
//                   <13-digit epoch ms>-<shots.deaths in base 36>-<hash of map+code+mode>, so it sorts by time and is the
//                   same if the same round is written twice.
//   store "days":   one summary row per day, keyPath "day". Row fields: v, day, rounds, shots, hits, headshots, kills,
//                   deaths, falls, maps{map:{rounds,shots,hits,headshots,kills,deaths}}, weapons{weapon:{shots,hits,
//                   headshots,kills}}, modes{mode:{...as maps}}, grid{map:{"cx,cz":deaths}} (1 m cells of the death
//                   position, x and z; at most 300 cells per map and 1500 per day), fights{map:{"cx,cz":fights}} (the same 1 m
//                   cells, counting engagements by where the PLAYER stood at FIRST CONTACT of each (see the engagement row); the same
//                   caps, kept separately from grid, so a row stays well under 50 KB; absent in rows written before 17 Nov 2026 and
//                   in days with no fight that had a contact position. An engagement with no contact adds nothing to fights).
//                   ids[] = the ids of the rounds the row counts (newest 200 at most), see Retention.
//                   A shot is a trigger pull; it is a hit when it hit a target (a shotgun shot when any pellet did).
//                   Phase 2 counters are sparse (a field exists once it is above zero) on the day, in every maps[map] and in every
//                   weapons[weapon]: nearMisses, overAim, underAim (near misses whose closest point is above / below the enemy's
//                   centre by more than LEVEL_BAND_M), flicks, strafes (kills of those kinds, see ENGAGEMENTS below).
// Retention: raw rounds are kept for the most recent 30 days (RAW_DAYS). A day older than that has its row written and then
// its raw rounds are deleted, in one transaction (the row write and the deletes commit together or not at all), in batches of
// ROLLUP_BATCH raw rounds per read. A day row lists the ids of the rounds it counts (field ids, the newest IDS_PER_DAY): a raw
// round the row does not list is ADDED to the row (counts summed, grid cells added within the caps) before it is deleted, and a
// round the row lists is only deleted, so a round is counted once and never dropped uncounted, however few rounds arrive late
// and whatever the row's own round count is. A row is never reduced, also when the clock moves and a recent day is written again.
// A row without ids (written before this field existed) is instead merged with a rebuild by the larger value of every count,
// and only when the raw rounds outnumber its round count.
// The roll-up runs at app start and after every round write, and can be repeated safely: once the raw rounds are gone the
// row is left as it is.
// A round is queued when it ends (or when you quit / restart) and written to IndexedDB asynchronously, never during
// play; the roll-up for its day follows the write. At pagehide the unwritten rounds are also copied into the old
// localStorage key "aim-analytics-rounds-v1" as a safety net, because a closing page may not finish its IndexedDB
// transaction; the next start moves them (and any rounds left there by the first version of this recorder) into IndexedDB
// and removes the key only after the IndexedDB write and roll-up succeeded (it re-reads the key first and keeps any round
// that arrived meanwhile). If IndexedDB is unavailable the recorder logs once and records nothing new; rounds already
// queued stay queued (at most MAX_PENDING) so the pagehide copy can still save them, and localStorage is otherwise left
// untouched. clear() also drops a batch that was being written. Every IndexedDB call is in try/catch.
//
// A stored round is compact (dictionary lists + row arrays):
//   { id, day, v:1, at:<epoch ms round loaded>, code:<drill share code>, map, mode:<scoring>, wpn:<drill weapon>, dt:<seconds per tick>,
//     end:"died"|"cleared"|"time"|"restart"|"quit", W:[weapons], T:[target template ids], K:{templateId:body shape},
//     KR:{templateId: radius in metres} for the sphere-shaped templates (18 Nov 2026; the template's radius, or its default 0.36 m per headSize; before the
//     actor's scale; absent in older rounds and in rounds without a sphere target; the hit report draws the circle to scale with it),
//     s:[shot rows], d:[death rows], cut:1 if the shot list hit MAX_SHOTS,
//     sens, sensAds, sensScoped, sensInvY?, sensAccel? }   (the sens fields: see "Input settings" below; old rounds have none)
//   shot row  [tick, W index, hitPart|null, x, y, z, distance, T index|-1, killed 0/1, pellets|null?, speed?, inputMask?, ticksSinceInput?,
//              crouchAmount?, enemyRange?, enemyCentre?, enemySide?, enemyVertical?, yawErrDeg?, pitchErrDeg?, aimYawDeg?, aimPitchDeg?]
//             hitPart/x/y/z/distance are null on a miss that hit nothing; a miss on a wall still has its point.
//             pellets (shotguns only) = [pellets fired, pellets that hit a target, of those the head hits]; it is null in a row that
//             carries later fields but did not fire a shotgun, so the later fields always sit at the indexes below. Every later field is
//             null when it is unknown, and trailing nulls are not stored, so a row has 9 to 22 entries and a reader checks each index. Row size: a full
//             22-entry row is about 130 bytes as JSON, so a round at the MAX_SHOTS cap (1500) is about 200 KB of shot rows (about 150 KB at the
//             18 entries of rows written before 17 Nov 2026); the pagehide safety copy (NET_MAX_CHARS, 800000 characters) drops the oldest
//             queued rounds first when it would go over. Rows written before the recoil fields have 9 to 18 entries and read unchanged.
//             Movement fields 10..12 (17 Nov 2026, from the engine's shot event .move, see tools/patch-shot-movement.cjs; null / absent in
//             rows recorded before, and in rows of an engine without the patch):
//               10 speed             the player's horizontal speed in m/s at the shot tick (the sim's player velocity, after this tick's
//                                    movement and wall collisions), 2 decimals. Below STILL_MPS (0.5) the player counts as still.
//               11 inputMask         the movement input the sim was given that tick: 1 forward, 2 back, 4 left, 8 right, 16 walk held
//                                    (the game's walk flag, i.e. after "default to walk"), 32 crouch held, 64 airborne (not grounded).
//                                    Forward and back (left and right) held together cancel in the input and show as neither.
//               12 ticksSinceInput   ticks since the last tick with a forward / back / left / right input (0 while one is held; counted
//                                    from the round start if there never was one). Counter-strafing = a high speed that is below
//                                    STILL_MPS a few ticks after the keys were let go; shooting while still = speed < STILL_MPS.
//             Crouch and walk discipline: walk held is bit 16 of inputMask (11); crouch held is bit 32; crouchAmount is
//               13 crouchAmount      how far the player is crouched at the shot tick, 0 (standing) to 1 (fully crouched), 2 decimals
//                                    (snapshot.player.crouchAmount of the shot's tick; it moves over the crouch transition time).
//             Nearest enemy fields 14..17 (from the snapshot of the shot's tick; no engine patch needed), for EVERY shot, hit or miss,
//             that has a target near its line: the enemy whose body box (the same approximation and closest-approach search as the
//             near misses) the shot line passes closest to, within NEAR_MARGIN_M; the fields below are then measured at the point of
//             the line nearest that enemy's centre (so enemyVertical can differ a little from a near-miss row's, which is taken at the
//             point nearest the box); an enemy the shot hit or killed is always eligible.
//             A shot with no direction or no such enemy has null here. The line is cut at a wall for a shot that hit nothing.
//               14 enemyRange        straight distance in metres from the shot origin to that enemy's body-box centre (accuracy by distance)
//               15 enemyCentre       distance in metres from that enemy's centre to the closest point of the shot line (0 = dead centre)
//               16 enemySide         horizontal offset in metres of that closest point from the centre, across the line of fire as the
//                                    player sees it: left negative, right positive (left / right miss clustering)
//               17 enemyVertical     height in metres of that closest point above the centre (positive = above), as near-miss rows have it
//             Bullet and aim fields 18..21 (17 Nov 2026; need no engine patch: the shot event's direction and snapshot.player.yaw / .pitch of the
//             same tick, both already read here). In the engine the fired direction is the look angles (n.yaw, n.pitch, set from the mouse at
//             the start of the tick, before the shot code) PLUS that shot's recoil kick (pitch up, yaw left or right) PLUS random spread, so
//             the recoil pattern is in the shot direction and NOT in the aim angles: the aim angles are the mouse state only. Pulling the
//             mouse down against recoil moves aimPitchDeg down and leaves pitchErrDeg (the kick) unchanged. So the error alone measures the
//             weapon's pattern; what the player did about it is the change of the aim angles over the run, and where the bullets went is
//             aim + error. For a shotgun the direction is that of one pellet (its spread included); a row without a direction has 18 / 19 null.
//               18 yawErrDeg         horizontal angle from the aim to the fired direction, degrees, 2 decimals, RIGHT POSITIVE: a bullet that
//                                    goes to the right of the aim is positive (the game's own yaw grows counter-clockwise seen from above, so
//                                    this is the aim yaw minus the bullet yaw, wrapped to +-180)
//               19 pitchErrDeg       vertical angle from the aim to the fired direction, degrees, UP POSITIVE: a bullet above the aim is
//                                    positive (bullet pitch minus aim pitch); recoil kicks the bullets UP, so a spray gives positive values
//               20 aimYawDeg         the aim yaw at the shot tick, degrees, the game's own convention (0 looks along -z, grows LEFT, i.e.
//                                    counter-clockwise from above; wrapped to +-180), 2 decimals
//               21 aimPitchDeg       the aim pitch at the shot tick, degrees, positive = looking up, 2 decimals
//             Bullet direction in the same convention as the aim: yaw = aimYawDeg - yawErrDeg, pitch = aimPitchDeg + pitchErrDeg.
//             The trigger moment (the tick the fire input went down) is NOT recorded: the engine does not keep one. The fire input is a
//             boolean sampled once per tick and a semi-automatic weapon fires on that same tick; only an automatic weapon held down past its
//             fire-rate wait fires later, and the engine keeps no press tick for it. A shot's tick (field 0) is the tick the bullet was fired.
// Input settings (round header, read from the page's localStorage when the round starts; a field that is not found is left out):
//   sens        mouse sensitivity ("al-sensitivity-v1", the VALORANT-scale number the game feeds the simulation; 0.5 when never changed).
//               Degrees per mouse count = sens * 0.07 (the game's constant), so cm/360 needs the mouse DPI, which the game does not keep.
//   sensAds     ADS sensitivity multiplier ("al-display-settings-v1" adsSensitivity, 1 by default),
//   sensScoped  scoped sensitivity multiplier (same object, scopedSensitivity, 1 by default),
//   sensInvY    1 only when "Invert mouse Y" is on (same object, invertMouseY),
//   sensAccel   1 only when the game's "System mouse acceleration is on" notice (.al-raw-input-notice) is on the page at the round
//               start, i.e. the browser could not give unadjusted (raw) mouse input. The game always asks for raw input
//               (requestPointerLock unadjustedMovement) and keeps no raw-input setting, so absent means "no notice seen", not "raw".
//   death row [tick, x, y, z, killerActorId|-1, T index|-1, killer distance|null, "shot"|"fell", killerNearMisses?]
//             killerNearMisses (only when there are any, at most 10) = [[shot tick, miss metres, vertical offset metres], ...]: the
//             player's missing shots that passed within NEAR_MARGIN_M of the enemy that then eliminated them, from the start of
//             that enemy's engagement (or the round start) to the death.
//   engagement row (key "e", phase 2) one per enemy life that came into view or fired, from that moment until its kill, its
//             leaving the round (not alive or not visible any more) or the round's end:
//             [enemy actor id, T index, start tick, kill tick | -1, aim travel degrees, player movement metres,
//              aim error degrees at start, signed yaw error, signed pitch error (target minus aim; pitch positive = target above;
//              yaw positive = target to the LEFT of the aim, so a target to the right of the crosshair gives a NEGATIVE yaw error,
//              because the game's yaw grows counter-clockwise seen from above; measured in the 17 Nov 2026 review),
//              "flick"|"strafe"|"mixed"|null (null when not killed), W index (weapon at the kill / at the end),
//              player x, player z, enemy x, enemy z,
//              contact tick, player x, player z, enemy x, enemy z]
//             Indexes 15..19 (17 Nov 2026, later the same day) are the FIRST CONTACT: the first tick on which either side dealt damage or
//             the player fired at this enemy, and the player's (snapshot.player.position x, z) and the enemy's (actor position + offset,
//             x, z) position on that tick, 2 decimals. THIS is where the fight is placed (fights grid, fightCells()): the start
//             position (11..14) is often the spawn area, because the enemy can come into view long before anyone shoots. Contact is
//             the earliest of: (a) a shot of the player at that enemy: a shot whose hit target (any pellet, any "also" hit) or nearest
//             enemy (the shot row's indexes 14..17) is the enemy; (b) a hit on that enemy (covered by a: a hit is a shot with that
//             target; a kill event of the enemy counts too); (c) an enemyShot event of that enemy (actorId set) that hit or did damage (hit true or damage > 0; a miss does
//             not count, and a fall is not an enemyShot); (d) damage the player takes from that enemy (the same enemyShot rule: the
//             game reports damage to the player only there). Contact only exists for an engagement: the enemy has to be alive,
//             visible and in the view cone or firing, as for the start. An enemy killed in the tick it appeared has contact at that
//             tick (the kill is a hit). The contact tick is >= the start tick and is the tick of the position, which is the snapshot's
//             of that tick. An engagement with NO contact (the enemy never hit or damaged the player and the player never fired at it)
//             has five nulls in 15..19: it is left out of the fights grid and counted under withoutPosition by fightCells(); so
//             are rows recorded before contact existed (11 or 15 entries). Old rows keep their start position in 11..14, and
//             expand() still gives playerStart / enemyStart; the contact ones come as playerContact / enemyContact / contactTick.
//             Indexes 11..14 (17 Nov 2026) are the start position in metres (2 decimals): where the PLAYER stood on the start tick
//             (snapshot.player.position x, z) and where the ENEMY stood on that tick (actor position + offset, x, z). Rows recorded
//             before have 11 entries and no position, so a reader checks each index (expand() gives playerStart / enemyStart as
//             {x, z} or null). For a kill of an enemy that never got an engagement (appeared and died in one tick) the start tick
//             is the kill tick and so is the position. y is not kept: fights are placed on the map's x / z plane like deaths.
//             Start = the first tick the enemy is alive and visible (the game's in-play flag) and its head is within
//             VIEW_CONE_DEG of the aim direction, or it fires (an enemyShot event), whichever is first. There is no wall test here
//             (walls are not in the recorder's data), so an enemy that is in play and in the cone behind a wall already counts.
//             Aim travel = sum over ticks of the aim's angular change on the sphere, hypot(dyaw * cos(pitch), dpitch) in degrees,
//             over the ticks after the start tick (recoil is not included: it is the mouse look state). Movement = sum of the
//             player's horizontal (x, z) steps in metres, a step over MOVE_JUMP_M (a teleport) ignored.
//   near-miss row (key "m", phase 2) one per (missing shot, enemy), at most NEAR_PER_SHOT per shot, the closest enemies:
//             [shot tick, index of the shot row in "s", enemy actor id, T index, miss metres, vertical offset metres]
//             Miss metres = the distance from the shot's line to the enemy's body box (0 when the line passes through the box but
//             the game still called it a miss, which happens because the real hitbox is tighter than the box). Vertical offset =
//             the height of the closest point on the shot line above the box centre (positive = above = over-aim, negative =
//             below = under-aim). Only shots with no hit (not pellets), only enemies alive and visible in the shot tick's snapshot,
//             only the part of the line before a wall hit, only enemies within NEAR_MARGIN_M of the box.
//   Round fields cutE / cutN = 1 when the engagement / near-miss list hit MAX_ENGAGEMENTS / MAX_NEAR.
//   look list (round field "L", 17 Nov 2026, for the coach's clearing rules; a trailing field, no existing layout changed): where the
//             player was looking, as [tick, sector] pairs, one per CHANGE. The recorder samples the aim yaw (snapshot.player.yaw) every
//             LOOK_SAMPLE_MS (250 ms, rounded to whole ticks of the round's dt; a guess, untuned) and bins it into LOOK_SECTORS (16)
//             sectors of 22.5 degrees: sector j covers the yaw range [22.5 j, 22.5 (j + 1)) degrees in the game's convention (yaw 0 looks
//             along -z and grows LEFT, wrapped to 0..360), so its centre is 22.5 j + 11.25. A pair is stored only when the sector differs
//             from the previous stored one, so standing still costs nothing; the first sample of the round is always stored, and the sector
//             stays in effect until the next pair. At most MAX_LOOK (2000) pairs per round; when the cap is hit the later changes are not
//             stored and the round field cutL = 1 (the list then ends early, so a reader must not read its end as "kept looking there").
//             The list is absent (no field) when the round had no look data and in every round written before this field existed:
//             readers treat that as "no clearing data". The pitch is not kept: clearing is a horizontal question. Sectors of 22.5 degrees
//             nest exactly in the coach's 45 degree world sectors (45 k - 22.5 .. 45 k + 22.5 = bins 2k - 1 and 2k).
//   tracking (engagement row index 20, 18 Nov 2026; a trailing field, absent in rows recorded before and in an engagement that was never in view
//             long enough to sample): how well the crosshair stayed on a MOVING enemy, measured on EVERY tick the enemy is in play (no engine
//             patch: snapshot.player.yaw / .pitch and the enemy's position + offset), both against the BODY box (bodyOf) and the HEAD (a sphere
//             of HEAD_RADIUS_M around the head point, scaled like the box; a sphere-shaped enemy has body = head). A tick is SAMPLED when the
//             enemy's direction, seen from the player's eye, turns faster than TRACK_MOVING_DEG_S degrees per second (the player's own aim does
//             not enter this, only the enemy's and the player's movement). Row: [samples, bodyOn, headOn, sumBodyErrDeg, sumHeadErrDeg, sumLagDeg,
//             sumJitterDeg, jitterPairs, lockBodyTicks, lockHeadTicks, sumEnemyDegPerSec]. samples = sampled ticks; bodyOn / headOn = of those, the
//             ticks the aim ray was inside the body box / head sphere; the Err sums = the angle between the aim and the body centre / head point,
//             degrees (mean = sum / samples); sumLag = the signed error along the enemy's direction of motion (positive = the crosshair is BEHIND
//             the enemy, negative = ahead of it), degrees; sumJitter = sum of the change of the body error between two sampled ticks one tick
//             apart (jitterPairs of them); lockBodyTicks / lockHeadTicks = ticks from the engagement start (the enemy coming into view) to the
//             first run of LOCK_S seconds on the body / head, -1 when it never locked (counted over ALL ticks, moving or not); sumEnemyDegPerSec = the
//             enemy's angular speed summed over the sampled ticks. rounds()[].engagements[].tracking gives it as an object (see trackingOf()).
//   sight (19 Nov 2026, round field sl = 1; needs tools/patch-sight-line.cjs): the game now says, per enemy and tick, whether the player can SEE it
//             (actor.los 1 / 0: a clear line from the player's eye to its head, chest or legs, or to a sphere target's centre; walls, smokes and
//             flash volumes block it) and whether the player is blinded (player.blindUntil, seconds of round time). An enemy is SEEN when it is in
//             VIEW_CONE_DEG of the aim, has a line of sight and the player is not blinded. Before this the recorder had no wall data, so an enemy
//             behind a wall already counted as "in view" and the clocks below ran from there. Now:
//               - an engagement still STARTS when the enemy is seen OR fires at the player (the enemy often sees the player first: off screen, behind,
//                 through a smoke, while the player is flashed; fights lost and deaths need that row), but
//               - SEEN tick (index 22) = the first tick it is seen; -1 = never. Everything about the player's aim starts there: the aim error at first
//                 sight (indexes 6..8 are re-taken at that tick), aim travel and movement (summed only on ticks the enemy is seen), the tracking
//                 samples and the lock time (a lock run is reset while the enemy is hidden, and the lock time is counted from the seen tick without
//                 the hidden ticks);
//               - HIDDEN ticks (index 21) = ticks after the seen tick on which the enemy was not seen (a wall, a smoke or a flash hid it; an enemy that
//                 is only off screen is NOT hidden: that is the player's pre-aim and counts). expand() gives visibleTimeToKill = kill - seen - hidden.
//             Rounds recorded before this have no sl: rounds()[].sight is false and the coach and the Stats screens leave their timing out
//             (nothing is deleted; they are simply not used for what depends on sight). Row layout: index 20 tracking or null, 21 hidden ticks, 22 seen tick.
//   Shots that are NOT recorded (17 Nov 2026; they are dropped before any row is written: no shot row, no near miss, no first contact, so
//   they are neither a hit nor a miss anywhere, and every existing row layout is unchanged). Decided by feed() in event order, per round:
//     Rule 1, after death: a player shot whose tick is at or after the tick of the round's playerDead event, when that event comes BEFORE
//             the shot in the event order (the events of a tick arrive in the engine's order, so a shot listed before the playerDead
//             event of the same tick was fired before the death and is recorded; one listed after it is dropped). A playerFell without
//             a playerDead does not start this rule (a fall comes with a playerDead event, as the death row logic assumes).
//     Rule 2, post-kill grace (constant POST_KILL_S): after a kill event of an enemy (kill.actorId, tick = the event's tick, else the
//             snapshot's), a player shot with a LATER tick, at most POST_KILL_S seconds after the kill (tick difference * the round's dt,
//             inclusive), that is aimed at that same enemy is dropped: the bot was already dead, so the rest of a burst is not a miss.
//             POST_KILL_S = 0.35 s (a guess, untuned), roughly one burst gap. The killing shot itself and any shot on the kill's own tick
//             are kept. "Aimed at that enemy" is decided exactly as the shot row's nearest-enemy fields (14..17) decide it, by
//             nearestEnemy(): the enemy it hit (hit target, any pellet, any "also") wins, else the enemy whose body box the line passes
//             closest to within NEAR_MARGIN_M. The only difference is that enemies killed within the window count as alive for this one
//             question (their last snapshot entry is kept, in case the snapshot no longer lists them). A shot at another enemy or at a
//             wall, or one with no direction and no hit target, is recorded as normal. Without a numeric dt in the round start info the
//             rule is not applied.
//     Round header fields dropDead / dropKill (sparse: present only when above zero, like cutE) count the shots dropped by rule 1 /
//     rule 2; rounds()[].droppedAfterDeath / droppedAfterKill give them (0 when absent). A round whose shots were all dropped and that
//     has no death is not stored (nothing was recorded).
// Reading (all asynchronous, each returns a Promise; unwritten rounds are written first):
//   __aimAnalytics.rounds({code,map,weapon,limit})  rounds as plain objects (shots and deaths expanded), oldest first
//   __aimAnalytics.days({from,to,map,weapon})        day rows, oldest first; from/to are inclusive "YYYY-MM-DD" strings
//   __aimAnalytics.engagements({code,map,weapon,limit,rounds})  one row per enemy engagement, oldest first (limit = newest N rows;
//                                                    rounds = read only the newest N rounds, so a screen can bound what it loads)
//   __aimAnalytics.nearMisses({code,map,weapon,limit,rounds})   one row per (missing shot, enemy) pair, oldest first
//   __aimAnalytics.fightCells({code,map,weapon,limit,rounds})   { cells: {"cx,cz": fights}, total, withoutPosition }: engagements counted on
//                                                    the death grid's 1 m cells (floor of the player's x and z at FIRST CONTACT, not
//                                                    at the start), from the raw rounds only (the last 30 days); same filters as
//                                                    engagements(); rows without a contact position (no contact, or old rounds) are
//                                                    only counted in withoutPosition. Pass map: cells of
//                                                    different maps are otherwise summed. Older days: the day rows' fights field.
//   rounds()[].look = the round's look list as stored ([[tick, sector], ...], see above) or null; lookTruncated = cutL.
//   __aimAnalytics.raw()                             the stored raw rows;  __aimAnalytics.clear()  empties both stores
(() => {
  if (window.__aimAnalytics) return;
  const KEY = "aim-analytics-rounds-v1"; // the first version's localStorage key: now only a migration source / pagehide safety net
  const DB_NAME = "aim-analytics";
  const DB_VERSION = 1;
  const RAW_DAYS = 30;           // raw rounds are kept for this many days
  const ROLLUP_BATCH = 200;      // raw rounds of old days read per roll-up pass (a long absence is rolled up in several passes)
  const IDS_PER_DAY = 200;       // round ids a day row remembers as counted (the newest ones; keeps the row small)
  const MAX_SHOTS = 1500;        // per round
  const MAX_DEATHS = 100;        // per round
  const GRID_PER_MAP = 300;      // death-grid cells per map in a day row
  const GRID_PER_DAY = 1500;     // and per day
  const MAX_PENDING = 40;        // rounds kept in memory while IndexedDB keeps failing
  const NET_MAX_CHARS = 800000;  // size of the pagehide safety copy in localStorage
  const INIT_DELAY_MS = 1500;    // migration and roll-up wait until the game has started loading
  const round2 = (n) => (typeof n === "number" && isFinite(n) ? Math.round(n * 100) / 100 : null);

  // ---- ENGAGEMENTS and near misses (phase 2): every threshold lives here ----
  const MAX_ENGAGEMENTS = 500;   // per round
  const MAX_NEAR = 1500;         // near-miss rows per round
  const LOOK_SAMPLE_MS = 250;    // look list: how often the aim yaw is sampled, milliseconds (a guess, untuned)
  const LOOK_SECTORS = 16;       // look list: yaw sectors of 360 / LOOK_SECTORS = 22.5 degrees
  const MAX_LOOK = 2000;         // look list: stored changes per round
  const VIEW_CONE_DEG = 50;      // an enemy "appears" when its head is within this angle of the aim direction (about half the horizontal field of view)
  // A killed engagement is a FLICK when the aim travelled far while the player hardly moved, a STRAFE when the player moved far
  // while the aim hardly travelled, otherwise "mixed". (Movement in metres, aim travel in degrees, both summed over the engagement.)
  const FLICK_MIN_AIM_DEG = 20;  // flick: aim travel at least this ...
  const FLICK_MAX_MOVE_M = 0.5;  // ... and player movement at most this
  const STRAFE_MIN_MOVE_M = 1;   // strafe: player movement at least this ...
  const STRAFE_MAX_AIM_DEG = 20; // ... and aim travel below this
  const MOVE_JUMP_M = 2;         // a single-tick horizontal step longer than this is a teleport, not movement
  const NEAR_MARGIN_M = 0.6;     // a miss counts as near when its line passes within this distance of the enemy's body box
  const NEAR_PER_SHOT = 2;       // near-miss rows kept per shot (the closest enemies)
  const LEVEL_BAND_M = 0.05;     // day rollup: a near miss within this of the centre height is neither over-aim nor under-aim
  const MAX_RANGE_M = 200;       // length of a shot line that hit nothing
  const POST_KILL_S = 0.35;      // shots at an enemy up to this many seconds after its kill are not recorded, see "Shots that are NOT recorded" (a guess, untuned)
  const TRACK_MOVING_DEG_S = 4;  // tracking: a tick is sampled when the enemy turns faster than this (degrees per second, seen from the player's eye) (a guess, untuned)
  const LOCK_S = 0.15;           // tracking: the aim is "locked" after this many seconds in a row on the target (a guess, untuned)
  const HEAD_RADIUS_M = 0.13;    // tracking: head sphere radius of an upright humanoid (scaled with the body)
  const STILL_MPS = 0.5;         // movement: a horizontal speed below this (m/s) counts as standing still
  const SENS_KEY = "al-sensitivity-v1", DISPLAY_KEY = "al-display-settings-v1"; // where the game keeps the mouse settings (localStorage)
  const SENS_DEFAULT = 0.5, SENS_MIN = 0.001, SENS_MAX = 10, ZOOM_DEFAULT = 1, ZOOM_MIN = 0.01, ZOOM_MAX = 10; // the game's own default and limits
  const IN_FWD = 1, IN_BACK = 2, IN_LEFT = 4, IN_RIGHT = 8, IN_WALK = 16, IN_CROUCH = 32, IN_AIR = 64; // shot row inputMask bits
  // Enemy body box, an approximation of the posed skeleton hitboxes (the exact ones depend on the animation and are not in the
  // recorder's data): an upright box on the actor's position (feet), scaled by actor scale and headSize. Spheres use their radius.
  const HUMANOID_HEIGHT_M = 1.8, HUMANOID_HALF_WIDTH_M = 0.3, HUMANOID_HEAD_M = 1.68;
  const SPHERE_RADIUS_PER_HEAD = 0.36; // the game's default sphere radius per headSize when the template has none
  const EYE_STAND_M = 1.75, EYE_CROUCH_M = 1.35; // the game's player eye heights (BiMsX6Xn.js vt.eye)
  const DEG = 180 / Math.PI;

  let warned = false;
  const warn = (what, err) => {
    if (warned) return;
    warned = true;
    try { console.warn("[aim-analytics] " + what + (err && err.message ? ": " + err.message : "") + " (analytics storage is skipped)"); } catch {}
  };

  // ---- days ----
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const dayOf = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  // Raw rounds are kept for days from this one on (today minus RAW_DAYS); earlier days are rolled up and deleted.
  const cutoffDay = () => { const d = new Date(Date.now()); d.setDate(d.getDate() - RAW_DAYS); return dayOf(d.getTime()); };
  const hash = (text) => { let h = 5381; for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0; return h.toString(36); };
  // Adds the id and day a stored round carries. Deterministic, so writing the same round twice stores it once.
  function stamp(r) {
    r.day = dayOf(r.at);
    r.id = pad(Math.floor(r.at), 13) + "-" + (r.s || []).length.toString(36) + "." + (r.d || []).length.toString(36) + "-" + hash(String(r.map) + "|" + String(r.code) + "|" + String(r.mode));
    return r;
  }

  // The summary row of a day, built from that day's raw rounds.
  function buildDay(day, list) {
    const row = { v: 1, day, rounds: 0, shots: 0, hits: 0, headshots: 0, kills: 0, deaths: 0, falls: 0, maps: {}, weapons: {}, modes: {}, grid: {}, fights: {}, ids: [] };
    const slot = (group, key, fields) => {
      let e = group[key];
      if (!e) { e = group[key] = {}; for (const f of fields) e[f] = 0; }
      return e;
    };
    const ROUND_FIELDS = ["rounds", "shots", "hits", "headshots", "kills", "deaths"], WEAPON_FIELDS = ["shots", "hits", "headshots", "kills"];
    const bump = (e, key) => { e[key] = (e[key] || 0) + 1; }; // phase 2 counters are sparse: the field appears at the first count
    const weaponName = (W, i) => (W[i] == null ? "?" : String(W[i]));
    let cells = 0, fightCount = 0;
    for (const r of list) {
      const map = r.map == null ? "?" : String(r.map), mode = r.mode == null ? "?" : String(r.mode), W = r.W || [];
      const m = slot(row.maps, map, ROUND_FIELDS), o = slot(row.modes, mode, ROUND_FIELDS);
      if (r.id != null) row.ids.push(r.id);
      row.rounds++; m.rounds++; o.rounds++;
      for (const s of r.s || []) {
        const pel = s[9], hit = s[2] != null || (pel && pel[1] > 0), head = s[2] === "head" || (pel && pel[2] > 0);
        const w = slot(row.weapons, weaponName(W, s[1]), WEAPON_FIELDS);
        for (const e of [row, m, o, w]) { e.shots++; if (hit) e.hits++; if (head) e.headshots++; if (s[8] === 1) e.kills++; }
      }
      // near misses (per shot and enemy), over-aim = closest point above the enemy's centre, under-aim = below (outside LEVEL_BAND_M)
      for (const n of r.m || []) {
        const shot = (r.s || [])[n[1]], v = n[5];
        const w = slot(row.weapons, shot ? weaponName(W, shot[1]) : "?", WEAPON_FIELDS);
        for (const e of [row, m, w]) { bump(e, "nearMisses"); if (v > LEVEL_BAND_M) bump(e, "overAim"); else if (v < -LEVEL_BAND_M) bump(e, "underAim"); }
      }
      // killed engagements by kind
      for (const g of r.e || []) {
        if (typeof g[16] === "number" && typeof g[17] === "number") { // fights by where the player stood at first contact (no contact: not counted)
          const f = row.fights[map] || (row.fights[map] = {}), cell = Math.floor(g[16]) + "," + Math.floor(g[17]);
          if (cell in f) f[cell]++;
          else if (Object.keys(f).length < GRID_PER_MAP && fightCount < GRID_PER_DAY) { f[cell] = 1; fightCount++; }
        }
        if (g[9] !== "flick" && g[9] !== "strafe") continue;
        const w = slot(row.weapons, weaponName(W, g[10]), WEAPON_FIELDS);
        for (const e of [row, m, w]) bump(e, g[9] === "flick" ? "flicks" : "strafes");
      }
      for (const d of r.d || []) {
        row.deaths++; m.deaths++; o.deaths++;
        if (d[7] === "fell") row.falls++;
        if (typeof d[1] !== "number" || typeof d[3] !== "number") continue;
        const g = row.grid[map] || (row.grid[map] = {}), cell = Math.floor(d[1]) + "," + Math.floor(d[3]);
        if (cell in g) g[cell]++;
        else if (Object.keys(g).length < GRID_PER_MAP && cells < GRID_PER_DAY) { g[cell] = 1; cells++; }
      }
    }
    row.ids = row.ids.slice(-IDS_PER_DAY);
    return row;
  }

  // Two day rows' counts combined: numbers by `pick` (Math.max or a sum), objects key by key.
  function combine(a, b, pick) {
    if (typeof a === "number" && typeof b === "number") return pick(a, b);
    if (a && b && typeof a === "object" && typeof b === "object") {
      const out = { ...a };
      for (const k of Object.keys(b)) out[k] = k in a ? combine(a[k], b[k], pick) : b[k];
      return out;
    }
    return a == null ? b : a;
  }
  // Two cell grids ({map:{cell:n}}) combined by `pick`: new cells only while within the caps.
  function mergeGrids(a, b, pick = Math.max) {
    const grid = {};
    let cells = 0;
    for (const map of Object.keys(a || {})) { grid[map] = { ...a[map] }; cells += Object.keys(grid[map]).length; }
    for (const map of Object.keys(b || {})) {
      const g = grid[map] || (grid[map] = {});
      for (const cell of Object.keys(b[map])) {
        if (cell in g) g[cell] = pick(g[cell], b[map][cell]);
        else if (Object.keys(g).length < GRID_PER_MAP && cells < GRID_PER_DAY) { g[cell] = b[map][cell]; cells++; }
      }
    }
    return grid;
  }
  const unionIds = (a, b) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])].slice(-IDS_PER_DAY);
  function combineDay(row, built, pick) {
    const out = combine({ ...row, grid: {}, fights: {}, ids: [] }, { ...built, grid: {}, fights: {}, ids: [] }, pick);
    out.v = row.v || built.v;
    out.grid = mergeGrids(row.grid, built.grid, pick);
    out.fights = mergeGrids(row.fights, built.fights, pick); // a row from before the fights field simply gains it
    out.ids = unionIds(row.ids, built.ids);
    return out;
  }
  // An existing day row merged with a rebuilt one so that no count goes down: every number becomes the larger of the two, the
  // grids only gain cells (within the caps). Used for a row that has no `ids` (written before the ids existed): it cannot say which
  // rounds it counts, so a rebuild from the raw rounds is the best that can be done.
  const mergeDay = (row, built) => combineDay(row, built, Math.max);
  // An existing day row plus the counts of rounds it does not hold yet (built from those rounds only): every number is summed, the
  // grids gain the new counts (within the caps). Only for rounds whose ids the row does not list, so nothing is counted twice.
  const addDay = (row, built) => combineDay(row, built, (x, y) => x + y);

  // ---- IndexedDB ----
  let disabled = false; // set once IndexedDB proved unusable; nothing is written then
  let dbPromise = null;
  const disable = (what, err) => { disabled = true; warn(what, err); };
  const wrap = (rq) => new Promise((resolve, reject) => { rq.onsuccess = () => resolve(rq.result); rq.onerror = () => reject(rq.error || new Error("request failed")); });
  const finished = (tx) => {
    const p = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("transaction failed"));
      tx.onabort = () => reject(tx.error || new Error("transaction aborted"));
    });
    p.catch(() => {});
    return p;
  };
  const idbFactory = () => { try { return window.indexedDB || null; } catch { return null; } };
  const idbRange = () => { try { return window.IDBKeyRange || null; } catch { return null; } };

  function openDb() {
    if (disabled) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const factory = idbFactory();
        if (!factory) { disable("IndexedDB is not available"); resolve(null); return; }
        const rq = factory.open(DB_NAME, DB_VERSION);
        rq.onupgradeneeded = () => {
          try {
            const db = rq.result;
            if (!db.objectStoreNames.contains("rounds")) db.createObjectStore("rounds", { keyPath: "id" }).createIndex("day", "day");
            if (!db.objectStoreNames.contains("days")) db.createObjectStore("days", { keyPath: "day" });
          } catch (err) { disable("could not create the stores", err); }
        };
        rq.onsuccess = () => {
          const db = rq.result;
          db.onversionchange = () => { try { db.close(); } catch {} dbPromise = null; };
          resolve(db);
        };
        rq.onerror = () => { disable("could not open the database", rq.error); resolve(null); };
        rq.onblocked = () => warn("the database is blocked by another connection");
      } catch (err) { disable("could not open the database", err); resolve(null); }
    });
    return dbPromise;
  }

  // One task at a time: writes, roll-ups, migration and reads run in order, off the game loop.
  let chain = Promise.resolve();
  const enqueue = (task) => { const p = chain.then(task); chain = p.catch(() => {}); return p; };

  // The row of a day after more raw rounds of it were found. A row lists the ids of the rounds it counts (`ids`), so the rounds it
  // does not list yet are added to it (addDay) and the others are left alone: a round is counted once, and a row never goes down.
  // No row yet: built from the rounds. A row without `ids` (older format): merged with a rebuild by the larger value of each count
  // (mergeDay), and only when the rounds outnumber what it was built from. Returns the row to store, or null when it stays as it is.
  function dayRowFor(day, row, list) {
    if (!row) return buildDay(day, list);
    if (Array.isArray(row.ids)) {
      const known = new Set(row.ids), fresh = list.filter((r) => !known.has(r.id));
      return fresh.length ? addDay(row, buildDay(day, fresh)) : null;
    }
    return list.length > row.rounds ? mergeDay(row, buildDay(day, list)) : null;
  }

  // Update the rows of the days just written, then roll up and delete raw rounds older than RAW_DAYS. Safe to repeat.
  async function rollUp(db, touched) {
    const cutoff = cutoffDay(), Range = idbRange();
    for (const day of touched) {
      if (day < cutoff) continue; // an old day is handled below
      const tx = db.transaction(["rounds", "days"], "readwrite"), fin = finished(tx);
      const list = await wrap(tx.objectStore("rounds").index("day").getAll(day));
      const row = list.length ? dayRowFor(day, await wrap(tx.objectStore("days").get(day)), list) : null;
      if (row) tx.objectStore("days").put(row);
      await fin;
    }
    // Old days: at most ROLLUP_BATCH raw rounds per read (oldest first), repeated until none are left. A day can span two batches:
    // the second one only adds the rounds the row does not list yet.
    for (;;) {
      const old = await wrap(db.transaction("rounds").objectStore("rounds").index("day").getAll(Range.upperBound(cutoff, true), ROLLUP_BATCH));
      if (!old.length) break;
      const byDay = new Map();
      for (const r of old) { if (!byDay.has(r.day)) byDay.set(r.day, []); byDay.get(r.day).push(r); }
      for (const [day, list] of byDay) {
        const tx = db.transaction(["rounds", "days"], "readwrite"), fin = finished(tx);
        const days = tx.objectStore("days");
        // The row is stored first and the raw rounds go in the same transaction: a round is deleted only once its counts are in
        // the row (or the row already lists it), never because of how many rounds the row holds.
        const row = dayRowFor(day, await wrap(days.get(day)), list);
        if (row) days.put(row);
        for (const r of list) tx.objectStore("rounds").delete(r.id);
        await fin;
      }
      if (old.length < ROLLUP_BATCH) break;
    }
  }

  // ---- the write queue ----
  let pending = [];  // stamped rounds waiting for IndexedDB
  let inflight = []; // the batch being written
  let writeTimer = null;
  let epoch = 0;     // bumped by clear(): a batch started before it must not come back after it

  async function writeRounds() {
    if (!pending.length) return;
    const db = await openDb();
    if (!db) return; // IndexedDB is unusable: the rounds stay queued for the pagehide safety copy
    const gen = epoch;
    const batch = inflight = pending.splice(0);
    try {
      const tx = db.transaction(["rounds"], "readwrite"), fin = finished(tx);
      const store = tx.objectStore("rounds");
      for (const r of batch) store.put(r);
      await fin;
      await rollUp(db, new Set(batch.map((r) => r.day)));
    } catch (err) {
      warn("could not write rounds", err);
      if (gen === epoch) pending = batch.concat(pending).slice(-MAX_PENDING); // try again at the next flush
    }
    if (gen === epoch) inflight = [];
  }
  const persist = () => { clearTimeout(writeTimer); writeTimer = null; return enqueue(writeRounds); };

  function queueRound(round) {
    if (disabled || !idbFactory()) { warn("IndexedDB is not available"); return; }
    pending.push(stamp(round));
    if (pending.length > MAX_PENDING) pending.shift();
    if (writeTimer === null) writeTimer = setTimeout(persist, 0);
  }

  // At pagehide: copy what IndexedDB may not finish writing into the localStorage key; the next start moves it over.
  function safetyNet() {
    const unsaved = inflight.concat(pending);
    if (!unsaved.length) return;
    try {
      let list = [];
      try { const prior = JSON.parse(localStorage.getItem(KEY) || "[]"); if (Array.isArray(prior)) list = prior; } catch {}
      const ids = new Set(list.map((r) => r && r.id));
      for (const r of unsaved) if (!ids.has(r.id)) list.push(r);
      const parts = list.map((r) => JSON.stringify(r));
      let total = parts.reduce((sum, p) => sum + p.length + 1, 2);
      while (parts.length > 1 && total > NET_MAX_CHARS) total -= parts.shift().length + 1;
      localStorage.setItem(KEY, "[" + parts.join(",") + "]");
    } catch {}
  }

  // ---- start-up: migration from localStorage, then the roll-up ----
  async function migrate(db) {
    let list;
    try {
      const text = localStorage.getItem(KEY);
      if (!text) return;
      list = JSON.parse(text);
    } catch { return; } // unreadable: leave it alone
    if (!Array.isArray(list)) return;
    list = list.filter((r) => r && typeof r === "object" && typeof r.at === "number" && isFinite(r.at)).map((r) => (r.id && r.day ? r : stamp(r)));
    if (list.length) {
      const tx = db.transaction(["rounds"], "readwrite"), fin = finished(tx);
      const store = tx.objectStore("rounds");
      for (const r of list) store.put(r);
      await fin;
      await rollUp(db, new Set(list.map((r) => r.day)));
    }
    // Only reached when the writes above succeeded. Awaits have passed, so a pagehide copy may have been added to the key:
    // read it again and drop only the rounds that were migrated.
    try {
      const done = new Set(list.map((r) => r.id));
      const now = JSON.parse(localStorage.getItem(KEY) || "[]");
      if (!Array.isArray(now)) return;
      const left = now.filter((r) => r && typeof r === "object" && typeof r.at === "number" && isFinite(r.at) && !done.has(r.id || stamp({ ...r }).id));
      if (left.length) localStorage.setItem(KEY, JSON.stringify(left)); else localStorage.removeItem(KEY);
    } catch {}
  }
  async function init() {
    const db = await openDb();
    if (!db) return;
    try { await migrate(db); } catch (err) { warn("could not migrate the old rounds", err); }
    try { await rollUp(db, new Set()); } catch (err) { warn("could not roll up old days", err); }
  }

  // ---- the round being played ----
  let cur = null;        // null until the game reports a round start
  let sceneEvent = null; // last "aim-local-scene" announcement: { id: share code, metaId: bound at first use }
  window.addEventListener("aim-local-scene", (event) => {
    const id = event.detail && event.detail.id;
    sceneEvent = id ? { id: String(id), metaId: null } : null;
  });
  // The share code of a drill: the game announces it when a drill is loaded from a lobby card or link, and that includes a
  // Studio drill started through studio-launch.js (it clicks the card's Start button, so it takes the same path and the
  // announcement carries the drill's share code; checked in the site bundle ChJ6FlD4.js). A restart reloads the same scene
  // without announcing, so the announcement is bound to the first scene id it is used with. A scene with another id (an
  // imported scene file or a moderator's review play, which are not announced) is recorded under its own scene id.
  function codeFor(metaId) {
    if (sceneEvent) {
      if (sceneEvent.metaId === null) sceneEvent.metaId = metaId;
      if (sceneEvent.metaId === metaId) return sceneEvent.id;
    }
    return metaId == null ? null : String(metaId);
  }

  // The mouse settings in effect now, as round header fields (see "Input settings" in the header). Each read is separate, so a
  // setting that cannot be read is left out and the others are kept.
  function readSens() {
    const out = {};
    try {
      const raw = localStorage.getItem(SENS_KEY), v = raw === null ? NaN : Number(raw);
      out.sens = v >= SENS_MIN && v <= SENS_MAX ? v : SENS_DEFAULT;
    } catch {}
    try {
      const d = JSON.parse(localStorage.getItem(DISPLAY_KEY) || "{}") || {};
      const zoom = (x) => (typeof x === "number" && x >= ZOOM_MIN && x <= ZOOM_MAX ? x : ZOOM_DEFAULT);
      out.sensAds = zoom(d.adsSensitivity);
      out.sensScoped = zoom(d.scopedSensitivity);
      if (d.invertMouseY === true) out.sensInvY = 1;
    } catch {}
    try { if (typeof document !== "undefined" && document.querySelector(".al-raw-input-notice")) out.sensAccel = 1; } catch {}
    return out;
  }

  function start(info) {
    try {
      flush("restart");
      info = info || {};
      cur = {
        v: 1, at: Date.now(), code: null, map: info.map ?? null, mode: info.mode ?? null, wpn: info.weapon ?? null,
        dt: typeof info.dt === "number" ? info.dt : null, ...readSens(), end: null, W: [], T: [], K: {}, KR: {}, s: [], d: [], e: [], m: [], L: [], metaId: info.id ?? null,
        shapes: new Map(Array.isArray(info.kinds) ? info.kinds.filter((k) => Array.isArray(k)) : []),
        // phase 2 working state (not stored): body dimensions per template, live engagements by actor id, finished lives, last tick's look
        dims: new Map((Array.isArray(info.kinds) ? info.kinds.filter((k) => Array.isArray(k)) : []).map((k) => [k[0], { shape: k[1], radius: k[2], headSize: k[3] }])),
        eng: new Map(), over: new Map(), last: null, lookTick: null, lookSector: -1,
        deadTick: null, dead: new Map(), // the player's death tick, and the recently killed enemies (id -> { tick, actor }) for the shot-dropping rules
      };
    } catch { cur = null; }
  }

  const indexIn = (list, value) => { let i = list.indexOf(value); if (i < 0) i = list.push(value) - 1; return i; };
  const dist = (a, b) => (a && b ? round2(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)) : null);
  const pt = (p) => (p ? [round2(p.x), round2(p.y), round2(p.z)] : [null, null, null]);

  const tIndex = (tmpl) => {
    if (tmpl == null) return -1;
    const i = indexIn(cur.T, tmpl);
    const shape = cur.shapes.get(tmpl);
    if (shape && !cur.K[tmpl]) cur.K[tmpl] = shape;
    if (shape === "sphere" && cur.KR[tmpl] === undefined) {
      const d = cur.dims.get(tmpl) || {};
      cur.KR[tmpl] = round2(d.radius > 0 ? d.radius : SPHERE_RADIUS_PER_HEAD * (d.headSize > 0 ? d.headSize : 1));
    }
    return i;
  };
  const weaponOf = (player) => (player.knife === 1 ? "melee" : (player.weapon ?? cur.wpn ?? "?"));

  // ---- geometry (angles in radians unless named Deg; directions are unit [x, y, z]; yaw 0 / pitch 0 looks along -z) ----
  const wrapPi = (a) => { a %= 2 * Math.PI; return a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a; };
  const aimDir = (yaw, pitch) => { const c = Math.cos(pitch); return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c]; };
  // Angular change between two looks, degrees on the sphere: the yaw change shrinks with cos(pitch).
  const lookStepDeg = (yaw0, pitch0, yaw1, pitch1) => Math.hypot(wrapPi(yaw1 - yaw0) * Math.cos(pitch1), pitch1 - pitch0) * DEG;
  const pos3 = (a) => { const p = a.position || {}, o = a.offset || {}; return [(p.x || 0) + (o.x || 0), (p.y || 0) + (o.y || 0), (p.z || 0) + (o.z || 0)]; };
  // The enemy's body box and head point from its snapshot entry: { min, max, head } or null.
  function bodyOf(a) {
    if (!a || !a.position) return null;
    const d = (cur && cur.dims.get(a.templateId)) || {}, p = pos3(a);
    const sc = typeof a.scale === "number" && isFinite(a.scale) && a.scale > 0 ? a.scale : 1;
    const hs = d.headSize > 0 ? d.headSize : 1;
    if (d.shape === "sphere") {
      const r = (d.radius > 0 ? d.radius : SPHERE_RADIUS_PER_HEAD * hs) * sc;
      return { min: [p[0] - r, p[1] - r, p[2] - r], max: [p[0] + r, p[1] + r, p[2] + r], head: p };
    }
    const k = sc * hs, hw = HUMANOID_HALF_WIDTH_M * k;
    return { min: [p[0] - hw, p[1], p[2] - hw], max: [p[0] + hw, p[1] + HUMANOID_HEIGHT_M * k, p[2] + hw], head: [p[0], p[1] + HUMANOID_HEAD_M * k, p[2]] };
  }
  // Distance from a point to a box (0 inside).
  function pointBox(p, box) {
    let q = 0;
    for (let i = 0; i < 3; i++) { const e = p[i] < box.min[i] ? box.min[i] - p[i] : p[i] > box.max[i] ? p[i] - box.max[i] : 0; q += e * e; }
    return Math.sqrt(q);
  }
  // Closest approach of the segment o + t * d, t in [0, tEnd], to a box. The distance to a convex set along a line is convex in t,
  // so a ternary search finds the minimum. Returns { dist, t }; for a segment that crosses the box (dist 0) t is the point
  // nearest the box centre instead, so the vertical offset still says where in the box the line went.
  function segmentBox(o, d, tEnd, box) {
    const f = (t) => pointBox([o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], box);
    let lo = 0, hi = tEnd;
    for (let k = 0; k < 60; k++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (f(m1) <= f(m2)) hi = m2; else lo = m1; }
    let t = (lo + hi) / 2;
    const dist = f(t);
    if (dist < 1e-9) {
      const c = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
      t = Math.max(0, Math.min(tEnd, (c[0] - o[0]) * d[0] + (c[1] - o[1]) * d[1] + (c[2] - o[2]) * d[2]));
    }
    return { dist, t };
  }
  // "flick" | "strafe" | "mixed" for a killed engagement, from its aim travel (degrees) and player movement (metres).
  function classify(travelDeg, moveM) {
    if (travelDeg >= FLICK_MIN_AIM_DEG && moveM <= FLICK_MAX_MOVE_M) return "flick";
    if (moveM >= STRAFE_MIN_MOVE_M && travelDeg < STRAFE_MAX_AIM_DEG) return "strafe";
    return "mixed";
  }

  // ---- engagements ----
  // g = { id, tmpl, born, start, travel, move, err: [deg, yaw, pitch], at: [player x, player z, enemy x, enemy z], contact?: { tick, at: [same] } }; weapon = the player's weapon name at the end.
  function closeEngagement(g, endTick, killed, weapon) {
    if (cur.e.length >= MAX_ENGAGEMENTS) { cur.cutE = 1; return; }
    cur.e.push([g.id, tIndex(g.tmpl), g.start, killed ? endTick : -1, round2(g.travel), round2(g.move), round2(g.err[0]), round2(g.err[1]), round2(g.err[2]),
      killed ? classify(g.travel, g.move) : null, indexIn(cur.W, weapon),
      ...(g.at || [null, null, null, null]).map(round2),
      g.contact ? g.contact.tick : null, ...(g.contact ? g.contact.at : [null, null, null, null]).map(round2), ...tailOf(g)]);
  }
  // The end of an engagement row: tracking (20), hidden ticks (21) and the seen tick (22) in a round with sight data, else just the tracking entry.
  function tailOf(g) {
    const tk = trackingRow(g);
    return cur.sl ? [tk.length ? tk[0] : null, g.hid || 0, g.seen === null || g.seen === undefined ? -1 : g.seen] : tk;
  }
  // The enemy is hidden (a wall, a smoke, a flash): a lock run and the motion sample chain are broken.
  function trackHidden(g) { const t = g.tk; if (t) { t.runB = 0; t.runH = 0; t.prev = null; t.prevErr = null; } }
  // The engagement row's index 20 (see "tracking" in the header): [] when nothing was sampled and the aim never locked.
  function trackingRow(g) {
    const t = g.tk;
    if (!t || (t.n === 0 && t.lockB < 0 && t.lockH < 0)) return [];
    return [[t.n, t.b, t.h, round2(t.eb), round2(t.eh), round2(t.lag), round2(t.jit), t.jn, t.lockB, t.lockH, round2(t.sp)]];
  }
  // One tick of tracking for a live engagement (see the header). a = the enemy's snapshot entry.
  function trackTick(g, a, yaw, pitch, eye, tick) {
    const body = bodyOf(a);
    if (!body) return;
    const dt = cur.dt > 0 ? cur.dt : 1 / 128;
    const t = g.tk || (g.tk = { n: 0, b: 0, h: 0, eb: 0, eh: 0, lag: 0, jit: 0, jn: 0, sp: 0, lockB: -1, lockH: -1, runB: 0, runH: 0, startB: 0, startH: 0, hidB: 0, hidH: 0, prev: null, prevErr: null });
    const centre = [(body.min[0] + body.max[0]) / 2, (body.min[1] + body.max[1]) / 2, (body.min[2] + body.max[2]) / 2];
    const fw = aimDir(yaw, pitch);
    const vb = [centre[0] - eye[0], centre[1] - eye[1], centre[2] - eye[2]], dist = Math.hypot(vb[0], vb[1], vb[2]);
    if (!(dist > 1e-6)) return;
    const errB = aimError(yaw, pitch, eye, centre), errH = aimError(yaw, pitch, eye, body.head);
    const height = body.max[1] - body.min[1];
    const onB = segmentBox(eye, fw, dist + 2, body).dist < 1e-6;
    const vh = [body.head[0] - eye[0], body.head[1] - eye[1], body.head[2] - eye[2]], along = vh[0] * fw[0] + vh[1] * fw[1] + vh[2] * fw[2];
    const dims = cur.dims.get(a.templateId);
    const headR = dims && dims.shape === "sphere" ? height / 2 : HEAD_RADIUS_M * height / HUMANOID_HEIGHT_M;
    const onH = along > 0 && Math.sqrt(Math.max(0, vh[0] * vh[0] + vh[1] * vh[1] + vh[2] * vh[2] - along * along)) <= headR;
    // lock: first run of LOCK_S seconds in a row on the target, counted from the engagement start, on every tick
    const need = Math.max(1, Math.round(LOCK_S / dt));
    const from = g.seen ?? g.start;
    if (onB) { if (!t.runB) { t.startB = tick; t.hidB = g.hid || 0; } t.runB++; if (t.lockB < 0 && t.runB >= need) t.lockB = Math.max(0, t.startB - from - t.hidB); } else t.runB = 0;
    if (onH) { if (!t.runH) { t.startH = tick; t.hidH = g.hid || 0; } t.runH++; if (t.lockH < 0 && t.runH >= need) t.lockH = Math.max(0, t.startH - from - t.hidH); } else t.runH = 0;
    // the enemy's own motion across the player's view, from the world direction to its centre (the player's aim does not enter)
    const eY = Math.atan2(-vb[0], -vb[2]), eP = Math.asin(Math.max(-1, Math.min(1, vb[1] / dist)));
    const prev = t.prev;
    t.prev = { tick, y: eY, p: eP };
    if (!prev || tick <= prev.tick) return;
    const secs = (tick - prev.tick) * dt, dY = wrapPi(eY - prev.y) * Math.cos(eP), dP = eP - prev.p, mag = Math.hypot(dY, dP), speed = mag * DEG / secs;
    if (!(speed >= TRACK_MOVING_DEG_S)) { t.prevErr = null; return; }
    t.n++; if (onB) t.b++; if (onH) t.h++;
    t.eb += errB[0]; t.eh += errH[0]; t.sp += speed;
    t.lag += errB[1] * Math.cos(pitch) * (dY / mag) + errB[2] * (dP / mag); // target minus aim, along the enemy's motion: positive = the crosshair trails it
    if (t.prevErr !== null && tick - prev.tick === 1) { t.jit += Math.abs(errB[0] - t.prevErr); t.jn++; }
    t.prevErr = errB[0];
  }
  // Where an engagement started, [player x, player z, enemy x, enemy z], from the player's position and the enemy's snapshot entry.
  const startAt = (px, pz, a) => { const e = pos3(a); return [px, pz, e[0], e[2]]; };
  // The same at a contact: the enemy's position is null when its snapshot entry has none.
  const contactAt = (px, pz, a) => (a && a.position ? startAt(px, pz, a) : [px, pz, null, null]);
  // Aim error of the player's look (yaw, pitch) from an eye point to a head point: [angle, yaw error, pitch error] in degrees (target minus aim).
  function aimError(yaw, pitch, eye, head) {
    const v = [head[0] - eye[0], head[1] - eye[1], head[2] - eye[2]], len = Math.hypot(v[0], v[1], v[2]);
    if (!(len > 1e-6)) return [0, 0, 0];
    const fw = aimDir(yaw, pitch), cos = (fw[0] * v[0] + fw[1] * v[1] + fw[2] * v[2]) / len;
    return [Math.acos(Math.max(-1, Math.min(1, cos))) * DEG, wrapPi(Math.atan2(-v[0], -v[2]) - yaw) * DEG, (Math.asin(Math.max(-1, Math.min(1, v[1] / len))) - pitch) * DEG];
  }
  // Look list (header, "look list"): the yaw sector of the aim, sampled every LOOK_SAMPLE_MS, stored only when it changes.
  const lookSector = (yaw) => Math.floor(((((yaw * DEG) % 360) + 360) % 360) / (360 / LOOK_SECTORS)) % LOOK_SECTORS;
  function sampleLook(tick, yaw) {
    if (!isFinite(yaw)) return;
    const every = Math.max(1, Math.round(LOOK_SAMPLE_MS / 1000 / (cur.dt > 0 ? cur.dt : 1 / 128)));
    if (cur.lookTick !== null && tick - cur.lookTick < every) return;
    cur.lookTick = tick;
    const sector = lookSector(yaw);
    if (sector === cur.lookSector) return;
    if (cur.L.length >= MAX_LOOK) { cur.cutL = 1; return; }
    cur.lookSector = sector;
    cur.L.push([tick, sector]);
  }
  // Called for every tick (events may be empty): updates aim travel and movement of the live engagements, starts engagements for
  // enemies that come into view or fire, ends the ones that were killed or left.
  // touch = the ids of the enemies that had contact this tick (see contactIds()).
  function track(snap, events, touch) {
    const P = snap.player;
    if (!P || !P.position || typeof P.yaw !== "number" || typeof P.pitch !== "number" || typeof snap.tick !== "number") return; // no look data in this message
    const tick = snap.tick, yaw = P.yaw, pitch = P.pitch, x = P.position.x, z = P.position.z;
    const crouch = Math.max(0, Math.min(1, +P.crouchAmount || 0));
    const eye = [x, P.position.y + EYE_STAND_M - (EYE_STAND_M - EYE_CROUCH_M) * crouch, z];
    const last = cur.last;
    // sight: who the player can see this tick (see the header, "sight"). No los in the snapshot (an older worker) = every enemy counts as seen, as before.
    const dtS = cur.dt > 0 ? cur.dt : 1 / 128, blind = typeof P.blindUntil === "number" && P.blindUntil > tick * dtS, losOf = new Map();
    for (const a of snap.actors || []) if (a.los === 0 || a.los === 1) { losOf.set(a.id, a.los); cur.sl = 1; }
    const sees = (id) => !blind && losOf.get(id) !== 0;
    if (last && tick > last.tick) {
      const dAim = lookStepDeg(last.yaw, last.pitch, yaw, pitch);
      let dMove = Math.hypot(x - last.x, z - last.z);
      if (dMove > MOVE_JUMP_M) dMove = 0;
      for (const g of cur.eng.values()) {
        if (g.seen === null || g.seen === undefined) continue; // not seen yet: no aim clock
        if (sees(g.id)) { g.travel += dAim; g.move += dMove; } else g.hid = (g.hid || 0) + (tick - last.tick);
      }
    }
    cur.last = { tick, yaw, pitch, x, z };
    sampleLook(tick, yaw);

    const weapon = weaponOf(P), kills = new Map(), firing = new Set();
    for (const e of events) {
      if (e.kind === "kill") kills.set(e.actorId, e.tick ?? tick);
      else if (e.kind === "enemyShot" && e.actorId != null) firing.add(e.actorId);
    }
    const present = new Set(), actors = snap.actors || [];
    for (const a of actors) {
      if (a.alive === false || a.visible === false || kills.has(a.id)) continue; // not in play (or killed this tick)
      present.add(a.id);
      let g = cur.eng.get(a.id);
      if (g && g.born !== a.bornTick) { closeEngagement(g, tick, false, weapon); cur.eng.delete(a.id); cur.over.set(a.id, g.born); g = null; } // a new life
      if (g && (g.seen === null || g.seen === undefined)) { // started by its own fire: the aim clock starts when the player first SEES it
        const b2 = bodyOf(a);
        if (b2) { const e2 = aimError(yaw, pitch, eye, b2.head); if (e2[0] <= VIEW_CONE_DEG && sees(a.id)) { g.seen = tick; g.err = e2; g.travel = 0; g.move = 0; } }
      }
      if (g || (a.bornTick !== undefined && cur.over.get(a.id) === a.bornTick)) continue; // running, or this life already finished
      const body = bodyOf(a);
      if (!body) continue;
      const err = aimError(yaw, pitch, eye, body.head);
      const inView = err[0] <= VIEW_CONE_DEG && sees(a.id);
      if (inView || firing.has(a.id)) { cur.over.delete(a.id); cur.eng.set(a.id, { id: a.id, tmpl: a.templateId ?? null, born: a.bornTick, start: tick, seen: inView ? tick : null, hid: 0, travel: 0, move: 0, err, at: startAt(x, z, a) }); }
    }
    for (const a of actors) {
      const g = cur.eng.get(a.id);
      if (!g || !present.has(a.id) || g.seen === null || g.seen === undefined) continue;
      if (sees(a.id)) trackTick(g, a, yaw, pitch, eye, tick); else trackHidden(g);
    }
    // first contact: the player's and the enemy's position on the tick of the first shot at it, hit on it or damage from it
    if (touch) for (const id of touch) {
      const g = cur.eng.get(id);
      if (g && !g.contact) g.contact = { tick, at: contactAt(x, z, actors.find((q) => q.id === id)) };
    }
    for (const [id, g] of [...cur.eng]) {
      if (present.has(id)) continue;
      const killTick = kills.get(id);
      closeEngagement(g, killTick ?? tick, killTick !== undefined, weapon);
      cur.eng.delete(id); cur.over.set(id, g.born);
    }
    // a kill of an enemy that never got an engagement (it appeared and died inside one tick): a zero-length engagement
    for (const [id, killTick] of kills) {
      const a = actors.find((q) => q.id === id), body = bodyOf(a);
      if (!a || !body || (cur.over.has(id) && cur.over.get(id) === a.bornTick)) continue;
      closeEngagement({ id, tmpl: a.templateId ?? null, born: a.bornTick, start: killTick, seen: killTick, hid: 0, travel: 0, move: 0, err: aimError(yaw, pitch, eye, body.head), at: startAt(x, z, a), contact: { tick: killTick, at: startAt(x, z, a) } }, killTick, true, weapon);
      cur.over.set(id, a.bornTick);
    }
    // a finished life of an actor without a bornTick can start again once the actor has been gone for a tick
    for (const [id, born] of [...cur.over]) if (born === undefined && !present.has(id) && !kills.has(id)) cur.over.delete(id);
  }
  // The engagements still running when the round ends or restarts end here, not killed.
  function closeAll() {
    if (!cur || !cur.eng.size) return;
    const tick = cur.last ? cur.last.tick : 0, weapon = cur.wpn ?? "?";
    for (const g of cur.eng.values()) closeEngagement(g, tick, false, weapon);
    cur.eng.clear();
  }

  // ---- near misses ----
  // For a shot that hit nothing: the closest enemies (up to NEAR_PER_SHOT) whose body box the shot line passed within
  // NEAR_MARGIN_M of, using the enemy positions of the same tick's snapshot. shotIndex = the shot's row index in cur.s.
  function nearMissesOf(e, snap, shotIndex) {
    if (e.hitActorId != null || e.pellets || !e.origin || !e.direction) return;
    const dl = Math.hypot(e.direction.x, e.direction.y, e.direction.z);
    if (!(dl > 0)) return;
    const o = [e.origin.x, e.origin.y, e.origin.z], d = [e.direction.x / dl, e.direction.y / dl, e.direction.z / dl];
    let tEnd = MAX_RANGE_M; // a miss that hit a wall only counts up to the wall
    if (e.hitPoint) tEnd = Math.min(tEnd, Math.hypot(e.hitPoint.x - o[0], e.hitPoint.y - o[1], e.hitPoint.z - o[2]));
    const found = [];
    for (const a of snap.actors || []) {
      if (a.alive === false || a.visible === false) continue; // living enemies only
      const box = bodyOf(a);
      if (!box) continue;
      const c = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
      const t0 = Math.max(0, Math.min(tEnd, (c[0] - o[0]) * d[0] + (c[1] - o[1]) * d[1] + (c[2] - o[2]) * d[2]));
      const reach = Math.hypot(box.max[0] - c[0], box.max[1] - c[1], box.max[2] - c[2]) + NEAR_MARGIN_M;
      if (Math.hypot(o[0] + d[0] * t0 - c[0], o[1] + d[1] * t0 - c[1], o[2] + d[2] * t0 - c[2]) > reach) continue; // far from the line: skip the search
      const r = segmentBox(o, d, tEnd, box);
      if (r.dist > NEAR_MARGIN_M) continue;
      found.push([r.dist, o[1] + d[1] * r.t - c[1], a]);
    }
    found.sort((p, q) => p[0] - q[0]);
    for (const [dist, vert, a] of found.slice(0, NEAR_PER_SHOT)) {
      if (cur.m.length >= MAX_NEAR) { cur.cutN = 1; return; }
      cur.m.push([e.tick, shotIndex, a.id, tIndex(a.templateId ?? null), round2(dist), round2(vert)]);
    }
  }

  // The enemy a shot passed closest to, for every shot: [range, centre distance, side, vertical] (see the shot row, indexes 14..17) or
  // four nulls. Same body box and closest-approach search as nearMissesOf. Enemies the shot hit, or that were killed this tick, count
  // even when the snapshot no longer has them alive.
  // idOut (optional): gets .id = the actor id of that enemy.
  function nearestEnemy(e, snap, killed, idOut) {
    const none = [null, null, null, null];
    try {
      if (!e.origin || !e.direction) return none;
      const dl = Math.hypot(e.direction.x, e.direction.y, e.direction.z);
      if (!(dl > 0)) return none;
      const o = [e.origin.x, e.origin.y, e.origin.z], d = [e.direction.x / dl, e.direction.y / dl, e.direction.z / dl];
      const hitIds = new Set();
      if (e.hitActorId != null) hitIds.add(e.hitActorId);
      for (const p of e.pellets || []) if (p.hitActorId != null) hitIds.add(p.hitActorId);
      for (const a of e.also || []) if (a.actorId != null) hitIds.add(a.actorId);
      let tEnd = MAX_RANGE_M; // a shot that hit nothing only counts up to the wall it hit
      if (!hitIds.size && e.hitPoint) tEnd = Math.min(tEnd, Math.hypot(e.hitPoint.x - o[0], e.hitPoint.y - o[1], e.hitPoint.z - o[2]));
      let best = null;
      for (const a of snap.actors || []) {
        const sure = hitIds.has(a.id) || killed.has(a.id);
        if (!sure && (a.alive === false || a.visible === false)) continue;
        const box = bodyOf(a);
        if (!box) continue;
        const c = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
        const t0 = Math.max(0, Math.min(tEnd, (c[0] - o[0]) * d[0] + (c[1] - o[1]) * d[1] + (c[2] - o[2]) * d[2]));
        const reach = Math.hypot(box.max[0] - c[0], box.max[1] - c[1], box.max[2] - c[2]) + NEAR_MARGIN_M;
        if (!sure && Math.hypot(o[0] + d[0] * t0 - c[0], o[1] + d[1] * t0 - c[1], o[2] + d[2] * t0 - c[2]) > reach) continue;
        const r = segmentBox(o, d, tEnd, box);
        if (!sure && r.dist > NEAR_MARGIN_M) continue;
        const p = [o[0] + d[0] * t0, o[1] + d[1] * t0, o[2] + d[2] * t0]; // the point of the line nearest the centre (the box-nearest point r.t is arbitrary on a line parallel to a box face)
        const centre = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
        // sure enemies sort first, then the closest to the box, then the closest to the centre
        const key = [sure ? 0 : 1, r.dist, centre];
        if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && (key[1] < best.key[1] || (key[1] === best.key[1] && key[2] < best.key[2])))) best = { key, c, p, centre, id: a.id };
      }
      if (!best) return none;
      if (idOut) idOut.id = best.id;
      const hl = Math.hypot(d[0], d[2]); // the line of fire seen from above; straight up or down has no left or right
      const side = hl > 1e-6 ? ((best.p[0] - best.c[0]) * (-d[2]) + (best.p[2] - best.c[2]) * d[0]) / hl : 0; // right of the aim = (-dz, dx); yaw 0 looks along -z, right is +x
      return [round2(Math.hypot(best.c[0] - o[0], best.c[1] - o[1], best.c[2] - o[2])), round2(best.centre), round2(side), round2(best.p[1] - best.c[1])];
    } catch { return none; }
  }

  // [yawErrDeg, pitchErrDeg, aimYawDeg, aimPitchDeg] of a shot (header, fields 18..21); null for what is unknown. Yaw error is positive
  // to the RIGHT (aim yaw minus bullet yaw: the game's yaw grows to the left), pitch error positive UP (bullet minus aim).
  function recoilFields(e, player) {
    const none = [null, null, null, null];
    try {
      const yaw = player && player.yaw, pitch = player && player.pitch;
      if (typeof yaw !== "number" || typeof pitch !== "number" || !isFinite(yaw) || !isFinite(pitch)) return none;
      const z0 = (n) => { const v = round2(n); return v === 0 ? 0 : v; }; // no negative zero
      const out = [null, null, z0(wrapPi(yaw) * DEG), z0(pitch * DEG)];
      const d = e.direction;
      if (d && typeof d.x === "number" && typeof d.y === "number" && typeof d.z === "number") {
        const len = Math.hypot(d.x, d.y, d.z);
        if (len > 1e-6) {
          out[1] = z0((Math.asin(Math.max(-1, Math.min(1, d.y / len))) - pitch) * DEG);
          if (Math.hypot(d.x, d.z) > 1e-6) out[0] = z0(wrapPi(yaw - Math.atan2(-d.x, -d.z)) * DEG);
        }
      }
      return out;
    } catch { return none; }
  }

  // [speed m/s, inputMask, ticksSinceInput] of a shot event's .move (see the shot row in the header).
  function moveFields(mv) {
    const speed = typeof mv.speed === "number" && isFinite(mv.speed) ? Math.max(0, mv.speed) : 0;
    const mask = (mv.forward > 0 ? IN_FWD : 0) | (mv.forward < 0 ? IN_BACK : 0) | (mv.strafe < 0 ? IN_LEFT : 0) | (mv.strafe > 0 ? IN_RIGHT : 0) |
      (mv.walk ? IN_WALK : 0) | (mv.crouch ? IN_CROUCH : 0) | (mv.air ? IN_AIR : 0);
    const since = typeof mv.sinceInput === "number" && isFinite(mv.sinceInput) ? Math.max(0, Math.round(mv.sinceInput)) : 0;
    return [round2(speed), mask, since];
  }

  // The ids of the enemies that had contact in this tick's events (see the engagement row): the target of a player shot (a hit target
  // or the nearest enemy) and the shooter of an enemyShot that hit or did damage. Fills nearCache (shot event -> nearestEnemy result).
  function contactIds(snap, events, killed, nearCache, dropped) {
    const ids = new Set();
    for (const e of events) {
      if (e.kind === "shot") {
        if (dropped && dropped.has(e)) continue; // a shot that is not recorded makes no contact either
        if (e.hitActorId != null) ids.add(e.hitActorId);
        for (const p of e.pellets || []) if (p.hitActorId != null) ids.add(p.hitActorId);
        for (const a of e.also || []) if (a.actorId != null) ids.add(a.actorId);
        const out = {}, fields = nearestEnemy(e, snap, killed, out);
        nearCache.set(e, fields);
        if (out.id != null) ids.add(out.id);
      } else if (e.kind === "kill" && e.actorId != null) ids.add(e.actorId); // a kill is a hit, even when its shot event names no target
      else if (e.kind === "enemyShot" && e.actorId != null && (e.hit === true || e.damage > 0)) ids.add(e.actorId);
    }
    return ids;
  }

  // Decides which shot events of this tick are not recorded (see "Shots that are NOT recorded" in the header) and keeps the state the
  // two rules need (the player's death tick, the recent kills). Walks the events in order. Returns Map(shot event -> "dead" | "kill").
  function dropShots(snap, events) {
    const out = new Map(), dt = cur.dt, canGrace = typeof dt === "number" && dt > 0;
    for (const e of events) {
      if (!e) continue;
      const tick = typeof e.tick === "number" ? e.tick : snap.tick;
      if (e.kind === "playerDead") {
        if (cur.deadTick == null || tick < cur.deadTick) cur.deadTick = tick;
      } else if (e.kind === "kill" && e.actorId != null) {
        cur.dead.set(e.actorId, { tick, actor: (snap.actors || []).find((a) => a.id === e.actorId) || null });
      } else if (e.kind === "shot") {
        if (cur.deadTick != null && tick >= cur.deadTick) { out.set(e, "dead"); cur.dropDead = (cur.dropDead | 0) + 1; continue; }
        if (!canGrace || !cur.dead.size) continue;
        const ghosts = new Map(), actors = snap.actors || [];
        for (const [id, k] of [...cur.dead]) {
          const now = actors.find((a) => a.id === id);
          if ((tick - k.tick) * dt > POST_KILL_S || (now && now.alive !== false && k.actor && now.bornTick !== k.actor.bornTick)) { cur.dead.delete(id); continue; } // window over, or a new life
          if (tick > k.tick) ghosts.set(id, k);
        }
        if (!ghosts.size) continue;
        const list = actors.map((a) => (ghosts.has(a.id) ? { ...a, alive: true, visible: true } : a));
        for (const [id, k] of ghosts) if (k.actor && !actors.some((a) => a.id === id)) list.push({ ...k.actor, alive: true, visible: true });
        const who = {};
        nearestEnemy(e, { ...snap, actors: list }, new Set(), who);
        if (who.id != null && ghosts.has(who.id)) { out.set(e, "kill"); cur.dropKill = (cur.dropKill | 0) + 1; }
      }
    }
    return out;
  }

  function feed(snap, events) {
    if (!cur || !snap) return;
    events = Array.isArray(events) ? events : [];
    const nearCache = new Map();
    let touch = null, dropped = new Map();
    try { dropped = dropShots(snap, events); } catch { dropped = new Map(); }
    try {
      const dead = new Set();
      for (const e of events) if (e.kind === "kill") dead.add(e.actorId);
      touch = contactIds(snap, events, dead, nearCache, dropped);
    } catch {}
    try { track(snap, events, touch); } catch {}
    if (!events.length) return;
    try {
      const actors = snap.actors || [];
      const tmplOf = (id) => { for (const a of actors) if (a.id === id) return a.templateId ?? null; return null; };
      const player = snap.player || {};
      const weapon = weaponOf(player);
      if (!cur.code) cur.code = codeFor(cur.metaId);

      const killed = new Set();
      let fell = false, killer = null;
      for (const e of events) {
        if (e.kind === "kill") killed.add(e.actorId);
        else if (e.kind === "playerFell") fell = true;
        else if (e.kind === "enemyShot" && e.damage > 0 && e.healthAfter <= 0) killer = e; // the game's own killer rule
      }
      for (const e of events) {
        if (e.kind === "shot") {
          if (dropped.has(e)) continue; // after the player's death, or at an enemy that was just killed: not a shot of the round
          if (cur.s.length >= MAX_SHOTS) { cur.cut = 1; continue; }
          const id = e.hitActorId;
          const part = id != null ? (e.hitPart ?? "body") : null;
          let kill = id != null && killed.has(id);
          if (!kill && e.also) for (const a of e.also) if (killed.has(a.actorId)) kill = true;
          if (!kill && e.pellets) for (const p of e.pellets) if (p.hitActorId != null && killed.has(p.hitActorId)) kill = true;
          const row = [e.tick, indexIn(cur.W, weapon), part, ...pt(e.hitPoint), dist(e.origin, e.hitPoint), id != null ? tIndex(tmplOf(id)) : -1, kill ? 1 : 0];
          let pel = null;
          if (e.pellets) {
            let hit = 0, head = 0;
            for (const p of e.pellets) if (p.hitActorId != null) { hit++; if (p.hitPart === "head") head++; }
            pel = [e.pellets.length, hit, head];
          }
          const crouchAmount = typeof player.crouchAmount === "number" && isFinite(player.crouchAmount) ? round2(Math.max(0, Math.min(1, player.crouchAmount))) : null;
          // pellets, then the later fields at their fixed indexes; trailing nulls are dropped (an old-style row stays 9 or 10 long)
          const tail = [pel, ...(e.move ? moveFields(e.move) : [null, null, null]), crouchAmount, ...(nearCache.get(e) || nearestEnemy(e, snap, killed)), ...recoilFields(e, player)];
          while (tail.length && tail[tail.length - 1] == null) tail.pop();
          row.push(...tail);
          cur.s.push(row);
          nearMissesOf(e, snap, cur.s.length - 1);
        } else if (e.kind === "playerFell" || (e.kind === "playerDead" && !fell)) {
          if (cur.d.length >= MAX_DEATHS) continue;
          const p = player.position;
          const byShot = e.kind === "playerDead" && killer;
          const row = [e.tick ?? snap.tick, ...pt(p), byShot ? killer.actorId : -1, byShot ? tIndex(tmplOf(killer.actorId)) : -1,
            byShot ? round2(killer.distance) : null, byShot ? "shot" : "fell"];
          if (byShot) {
            // the player's near misses of the enemy that eliminated them, since its engagement began, newest 10
            const g = cur.eng.get(killer.actorId), since = g ? g.start : 0;
            const near = cur.m.filter((n) => n[2] === killer.actorId && n[0] >= since).slice(-10).map((n) => [n[0], n[4], n[5]]);
            if (near.length) row.push(near);
          }
          cur.d.push(row);
        }
      }
    } catch {}
  }

  // Finish the round in progress and queue it for storage, unless nothing was recorded (a scene opened and left).
  function flush(reason) {
    try { closeAll(); } catch {}
    const round = cur;
    cur = null;
    if (!round || (round.s.length === 0 && round.d.length === 0)) return;
    try {
      round.end = reason || round.end || "quit";
      delete round.shapes; delete round.metaId; delete round.dims; delete round.eng; delete round.over; delete round.last; delete round.lookTick; delete round.lookSector; delete round.deadTick; delete round.dead;
      if (!round.e.length) delete round.e;
      if (!round.KR || !Object.keys(round.KR).length) delete round.KR;
      if (!round.m.length) delete round.m;
      if (!round.L.length) delete round.L;
      if (!round.code) round.code = null;
      queueRound(round);
    } catch {}
  }
  function end(reason) { flush(typeof reason === "string" ? reason : null); }

  // The tab closes or the game window is quit in the middle of a round.
  window.addEventListener("pagehide", () => { try { flush("quit"); safetyNet(); persist(); } catch {} });

  // Posted from the worker (see tools/patch-analytics-hooks.cjs).
  // Never throws into the page: a malformed message (a list that is not iterable, a tick that is not an object) is skipped, and one
  // bad tick of a batch does not stop the ticks after it.
  function receive(message) {
    try {
      if (!message) return;
      if (message.kind === "start") start(message.info);
      else if (message.kind === "tick") feed(message.snap, message.events);
      else if (message.kind === "ticks") { // a batch of per-tick samples from the worker
        for (const t of message.list || []) { try { if (t) feed(t.snap, t.events); } catch {} }
      } else if (message.kind === "end") end(message.reason);
    } catch {}
  }

  // ---- reading ----
  // A shot row's movement fields as a plain object (the reverse of moveFields).
  const moveOf = (speed, mask, ticks, dt) => ({
    speed, still: speed < STILL_MPS, forward: (mask & IN_FWD) !== 0, back: (mask & IN_BACK) !== 0, left: (mask & IN_LEFT) !== 0, right: (mask & IN_RIGHT) !== 0,
    walk: (mask & IN_WALK) !== 0, crouch: (mask & IN_CROUCH) !== 0, airborne: (mask & IN_AIR) !== 0, ticksSinceInput: ticks, secondsSinceInput: round2(ticks * dt),
  });
  // An engagement row's tracking entry (index 20) as an object, or null (see "tracking" in the header).
  const trackingOf = (t, dt) => (Array.isArray(t) && t.length >= 10 && typeof t[0] === "number" ? {
    samples: t[0], seconds: round2(t[0] * dt), bodyOn: t[1], headOn: t[2], bodyErrorSum: t[3], headErrorSum: t[4], lagSum: t[5], jitterSum: t[6], jitterPairs: t[7],
    lockBodySeconds: t[8] >= 0 ? round2(t[8] * dt) : null, lockHeadSeconds: t[9] >= 0 ? round2(t[9] * dt) : null, enemySpeedSum: typeof t[10] === "number" ? t[10] : 0 } : null);
  // What the engagement row says about sight (indexes 21, 22): { hiddenTicks, seenTick, visibleTimeToKill } or the nulls of a round without sight data.
  const sightOf = (e, dt) => {
    const hid = typeof e[21] === "number" ? e[21] : null, seen = typeof e[22] === "number" && e[22] >= 0 ? e[22] : null;
    return { hiddenTicks: hid, seenTick: seen, hiddenSeconds: hid === null ? null : round2(hid * dt),
      visibleTimeToKill: hid !== null && seen !== null && e[3] >= 0 ? round2(Math.max(0, e[3] - seen - hid) * dt) : null };
  };
  const expand = (r) => {
    const dt = r.dt || 1 / 128, W = r.W || [], T = r.T || [], K = r.K || {};
    const target = (i) => (i >= 0 && T[i] != null ? T[i] : null);
    const point = (x, y, z) => (x == null ? null : { x, y, z });
    return {
      id: r.id ?? null, day: r.day ?? null, sight: r.sl === 1,
      at: r.at, code: r.code, map: r.map, mode: r.mode, drillWeapon: r.wpn, tickSeconds: dt, end: r.end, truncated: !!r.cut,
      ...(r.sens != null || r.sensAds != null ? { input: { sensitivity: r.sens ?? null, adsMultiplier: r.sensAds ?? null, scopedMultiplier: r.sensScoped ?? null,
        invertY: r.sensInvY === 1, accelerationNotice: r.sensAccel === 1 } } : {}),
      shots: (r.s || []).map((s) => {
        const t = target(s[7]);
        return { tick: s[0], time: round2(s[0] * dt), weapon: W[s[1]] ?? null, part: s[2], point: point(s[3], s[4], s[5]), distance: s[6],
          target: t, targetShape: t != null ? (K[t] ?? null) : null, killed: s[8] === 1, ...(s[9] ? { pellets: { fired: s[9][0], hit: s[9][1], head: s[9][2] } } : {}),
          ...(typeof s[10] === "number" ? { movement: moveOf(s[10], s[11] | 0, s[12] | 0, dt) } : {}),
          ...(typeof s[13] === "number" ? { crouchAmount: s[13] } : {}),
          ...(typeof s[14] === "number" ? { nearestEnemy: { range: s[14], centreDistance: s[15], side: s[16], vertical: s[17] } } : {}),
          ...(typeof s[18] === "number" ? { yawErrDeg: s[18] } : {}), ...(typeof s[19] === "number" ? { pitchErrDeg: s[19] } : {}),
          ...(typeof s[20] === "number" ? { aimYawDeg: s[20] } : {}), ...(typeof s[21] === "number" ? { aimPitchDeg: s[21] } : {}) };
      }),
      deaths: (r.d || []).map((d) => ({ tick: d[0], time: round2(d[0] * dt), position: point(d[1], d[2], d[3]), killerId: d[4] >= 0 ? d[4] : null,
        killer: target(d[5]), killerDistance: d[6], cause: d[7],
        nearMisses: (d[8] || []).map((n) => ({ tick: n[0], time: round2(n[0] * dt), missDistance: n[1], verticalOffset: n[2] })) })),
      engagementsTruncated: !!r.cutE, nearMissesTruncated: !!r.cutN, droppedAfterDeath: r.dropDead | 0, droppedAfterKill: r.dropKill | 0,
      look: Array.isArray(r.L) ? r.L : null, lookTruncated: !!r.cutL,
      targetShapes: { ...K }, targetRadii: { ...(r.KR || {}) },
      engagements: (r.e || []).map((e) => ({
        enemyId: e[0], template: target(e[1]), startTick: e[2], startTime: round2(e[2] * dt), killed: e[3] >= 0, killTick: e[3] >= 0 ? e[3] : null,
        timeToKill: e[3] >= 0 ? round2((e[3] - e[2]) * dt) : null, aimTravel: e[4], moveDistance: e[5],
        aimError: { degrees: e[6], yaw: e[7], pitch: e[8] }, kind: e[9] ?? null, weapon: W[e[10]] ?? null,
        playerStart: typeof e[11] === "number" && typeof e[12] === "number" ? { x: e[11], z: e[12] } : null,
        enemyStart: typeof e[13] === "number" && typeof e[14] === "number" ? { x: e[13], z: e[14] } : null,
        contactTick: typeof e[15] === "number" ? e[15] : null,
        playerContact: typeof e[16] === "number" && typeof e[17] === "number" ? { x: e[16], z: e[17] } : null,
        enemyContact: typeof e[18] === "number" && typeof e[19] === "number" ? { x: e[18], z: e[19] } : null,
        tracking: trackingOf(e[20], dt), ...sightOf(e, dt) })),
      nearMisses: (r.m || []).map((n) => {
        const shot = (r.s || [])[n[1]], v = n[5];
        return { shotTick: n[0], time: round2(n[0] * dt), shotIndex: n[1], weapon: shot ? (W[shot[1]] ?? null) : null, enemyId: n[2], template: target(n[3]),
          missDistance: n[4], verticalOffset: v, side: v > LEVEL_BAND_M ? "above" : v < -LEVEL_BAND_M ? "below" : "level" };
      }),
    };
  };

  // Rounds the first version left in localStorage, used for reading only when IndexedDB is unavailable.
  const legacy = () => {
    try { const list = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(list) ? list.filter((r) => r && typeof r === "object") : []; } catch { return []; }
  };
  // Writes what is queued, waits for the queue, and gives the database (null when there is none).
  async function settled() {
    try { if (pending.length) await persist(); else await chain; } catch {}
    return openDb();
  }
  // Newest-first scan of the raw rounds; `keep` picks rounds, `limit` stops early. Result is oldest first.
  function scanRounds(db, keep, limit) {
    return new Promise((resolve, reject) => {
      const out = [];
      const rq = db.transaction("rounds").objectStore("rounds").openCursor(null, "prev");
      rq.onsuccess = () => {
        const cursor = rq.result;
        if (!cursor) { resolve(out.reverse()); return; }
        if (keep(cursor.value)) { out.push(cursor.value); if (limit > 0 && out.length >= limit) { resolve(out.reverse()); return; } }
        cursor.continue();
      };
      rq.onerror = () => reject(rq.error);
    });
  }
  const roundFilter = (f) => (r) => {
    if (f.code && r.code !== f.code) return false;
    if (f.map && r.map !== f.map) return false;
    if (f.weapon) { const W = r.W || []; if (!(r.s || []).some((s) => (W[s[1]] ?? null) === f.weapon)) return false; }
    return true;
  };
  async function storedRounds(filter) {
    try {
      const f = filter || {}, keep = roundFilter(f), limit = f.limit > 0 ? f.limit : 0;
      const db = await settled();
      if (!db) { const list = legacy().filter(keep); return limit ? list.slice(-limit) : list; }
      return await scanRounds(db, keep, limit);
    } catch (err) { warn("could not read rounds", err); return []; }
  }
  // rounds({ code, map, weapon, limit }): Promise of plain objects, oldest first. weapon keeps rounds with at least one shot with it.
  async function rounds(filter) {
    try { return (await storedRounds(filter)).map(expand); } catch { return []; }
  }
  // days({ from, to, map, weapon }): Promise of day rows, oldest first. from / to are inclusive "YYYY-MM-DD" strings. With map or
  // weapon only the days that have it are returned and the breakdowns are cut down to it; the day totals stay whole-day.
  async function days(filter) {
    try {
      const f = filter || {}, Range = idbRange();
      const db = await settled();
      if (!db || !Range) return [];
      const range = f.from && f.to ? Range.bound(f.from, f.to) : f.from ? Range.lowerBound(f.from) : f.to ? Range.upperBound(f.to) : null;
      let list = await wrap(db.transaction("days").objectStore("days").getAll(range));
      if (f.map) list = list.filter((r) => r.maps && f.map in r.maps).map((r) => ({ ...r, maps: { [f.map]: r.maps[f.map] }, grid: r.grid && r.grid[f.map] ? { [f.map]: r.grid[f.map] } : {},
        fights: r.fights && r.fights[f.map] ? { [f.map]: r.fights[f.map] } : {} }));
      if (f.weapon) list = list.filter((r) => r.weapons && f.weapon in r.weapons).map((r) => ({ ...r, weapons: { [f.weapon]: r.weapons[f.weapon] } }));
      return list;
    } catch (err) { warn("could not read days", err); return []; }
  }
  // Rows of one list of the expanded rounds (engagements or nearMisses), oldest first, each with its round's context.
  // code / map filter the rounds; weapon filters the rows (the weapon at the kill, the weapon of the missing shot); limit keeps the newest rows;
  // rounds keeps only the newest N rounds (after the code / map filter), so the read itself stays small.
  async function flatRows(listName, filter) {
    try {
      const f = filter || {}, out = [];
      for (const r of (await storedRounds({ code: f.code, map: f.map, limit: f.rounds })).map(expand)) {
        for (const row of r[listName]) if (!f.weapon || row.weapon === f.weapon) out.push({ roundId: r.id, day: r.day, at: r.at, code: r.code, map: r.map, mode: r.mode, sight: r.sight, ...row });
      }
      return f.limit > 0 ? out.slice(-f.limit) : out;
    } catch (err) { warn("could not read " + listName, err); return []; }
  }
  const engagements = (filter) => flatRows("engagements", filter);
  const nearMisses = (filter) => flatRows("nearMisses", filter);
  // fightCells({ code, map, weapon, limit }): fights per 1 m cell of the player's position at FIRST CONTACT of each engagement (the same
  // cells as the death grid: floor of x, floor of z). { cells: {"cx,cz": n}, total: engagements counted, withoutPosition: rows with
  // no contact position (the enemy never hit or damaged the player and was never shot at, or an old round) }.
  async function fightCells(filter) {
    const cells = {};
    let total = 0, withoutPosition = 0;
    for (const e of await engagements(filter)) {
      const p = e.playerContact;
      if (!p) { withoutPosition++; continue; }
      const key = Math.floor(p.x) + "," + Math.floor(p.z);
      cells[key] = (cells[key] || 0) + 1; total++;
    }
    return { cells, total, withoutPosition };
  }
  // The stored raw rows (what rounds() expands), oldest first.
  const raw = () => storedRounds({});
  // Empties both stores (and the old localStorage key), including rounds still queued.
  function clear() {
    epoch++; pending = []; inflight = [];
    try { localStorage.removeItem(KEY); } catch {}
    return enqueue(async () => {
      try {
        const db = await openDb();
        if (!db) return;
        const tx = db.transaction(["rounds", "days"], "readwrite"), fin = finished(tx);
        tx.objectStore("rounds").clear();
        tx.objectStore("days").clear();
        await fin;
      } catch (err) { warn("could not clear the stores", err); }
    });
  }

  try { setTimeout(() => enqueue(init), INIT_DELAY_MS); } catch {}

  // The loop calls these directly when the game runs on the page; in the worker the patch defines its own.
  window.__aimAnalyticsStart = start;
  window.__aimAnalyticsFeed = feed;
  window.__aimAnalyticsEnd = end;
  window.__aimAnalytics = {
    version: DB_VERSION, // the database version (the stored data format), not the file's history
    storageKey: KEY, // the legacy localStorage key; rounds now live in IndexedDB database dbName
    dbName: DB_NAME,
    rounds,
    days,
    engagements,
    nearMisses,
    fightCells,
    raw,
    // The round being played, as stored rows (not saved yet), or null.
    current: () => (cur ? { code: cur.code, map: cur.map, weapon: cur.wpn, shots: cur.s.length, deaths: cur.d.length, engagements: cur.e.length, nearMisses: cur.m.length } : null),
    // The flick / strafe rule and every threshold of phase 2, for readers and tests.
    classify,
    thresholds: { STILL_MPS, VIEW_CONE_DEG, FLICK_MIN_AIM_DEG, FLICK_MAX_MOVE_M, STRAFE_MIN_MOVE_M, STRAFE_MAX_AIM_DEG, MOVE_JUMP_M, NEAR_MARGIN_M, NEAR_PER_SHOT, LEVEL_BAND_M, POST_KILL_S,
      HUMANOID_HEIGHT_M, HUMANOID_HALF_WIDTH_M, HUMANOID_HEAD_M, LOOK_SAMPLE_MS, LOOK_SECTORS, MAX_LOOK },
    clear,
    receive, start, feed, end,
  };
})();
