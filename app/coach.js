// Coach rules (17 Nov 2026, marker aim-coach-v1). Turns what analytics-recorder.js stored into short, plain findings; it
// shows nothing itself (a later screen does) and writes nothing. Pure rules: no timers, no storage, no DOM.
//
//   window.__aimCoach.insights({ code, map, weapon, since, limit }) -> Promise of an array of findings, most important first:
//     { id, title, detail, severity: "info" | "tip" | "warn", evidence: {numbers the sentence used}, sample: rounds or shots it rests on,
//       summary: a few words with the key number for a collapsed card, never the title ("35% wasted"; "" when there is no number; see SUMMARY) }
//   code / map / weapon narrow the data like the readers of window.__aimAnalytics do; since = epoch ms, a Date or "YYYY-MM-DD"
//   (the trend rules ignore it: they always compare the last 7 days with the 7 before); limit = most findings to return.
//   It resolves to [] when the recorder is missing or has nothing, and never rejects. Each rule needs the minimum sample set in the
//   constants below, otherwise it adds nothing.
//
// Rules and the recorded fields they read (rounds = __aimAnalytics.rounds(), days = __aimAnalytics.days()):
//   miss-side          rounds[].nearMisses[]: side, verticalOffset (metres, from the middle of the enemy's body box), weapon
// SIGHT (19 Nov 2026). Rules about WHEN the player saw an enemy (time to kill, the crosshair at first sight, flick or strafe, the hold time
// before a fight, "died without firing back", tracking) use only rounds recorded with line-of-sight data (rounds()[].sight, recorder header
// "sight"). Earlier rounds counted an enemy behind a wall as seen, so their times were far too long; they are not deleted, just not used for these
// rules (the rules that only need who won and where, like fights lost, fight spots and angles, still use every round). An enemy that fires
// at you before you can see it still makes a fight, but the clock starts when you first see it (engagement.seenTick); time to kill leaves out the
// ticks the enemy was hidden again behind a wall or a smoke (engagement.visibleTimeToKill).
//   kill-style         rounds[].engagements[]: killed, kind ("flick" | "strafe" | "mixed"), aimError.degrees, weapon
//   pre-aim            engagements[]: aimError.pitch (positive = the head is above the crosshair when the enemy comes into view)
//   pre-aim-low        the same pitch values: the share of engagements that begin with the crosshair far below head height
//   burst-length / spray-control  rounds[].shots[]: time, weapon, part, pellets (a fire run = shots of one weapon less than BURST_GAP_S apart;
//                      accuracy by run length, and by the position of the shot in the run; shotgun and melee shots are left out)
//   spray-control (bullet drift + mouse pull, 17 Nov 2026)  the same runs; shots[].nearestEnemy {range, side, vertical} (metres, bullet line against
//                      the enemy centre: right / up positive) for where the bullets go relative to the TARGET, and yawErrDeg (right +), pitchErrDeg
//                      (up +), aimYawDeg (grows LEFT), aimPitchDeg (up +) for the recoil kick and the mouse pull. Used when the recoil fields are
//                      in enough shots; otherwise the hit-rate version below runs, and its evidence says basis: "hit-rate" with a fallback label.
//   kill-time          engagements[]: killed, timeToKill (seconds); kill-time-trend adds day (last 7 days against the 7 before)
//   death-zone         days[].grid{map:{"cx,cz":deaths}} (1 m cells); with a code or weapon filter, rounds[].deaths[].position (x, z) instead
//   death-repeat       the same cells, per day (days[].day, or rounds[].day)
//   deaths-cause       rounds[].deaths[].cause ("shot" | "fell")
//   deaths-unanswered  deaths[]: cause, killerId, tick; engagements[]: enemyId, startTick; shots[].tick (shots fired between the enemy's
//                      first sight and your death; none = you died without firing in that fight)
//   multi-enemy        engagements[]: enemyId, startTick, killed, killTick; deaths[]: killerId, tick (two fights overlapping in time)
//   fights-lost        engagements[].killed (fights you won) and deaths[]: cause "shot", killerId (fights you lost)
//   fight-spot         engagements[]: killed (won), startTick, enemyId, playerContact {x, z} (the FIRST-CONTACT position, recorder indexes 15..19);
//                      deaths[]: cause "shot", killerId, tick (a fight lost). Won and lost fights grouped by the 1 m cell of playerContact, per map.
//   fight-angle        engagements[]: playerContact {x, z}, enemyContact {x, z} (the first-contact positions), killed; deaths[] as in fight-spot.
//                      The WORLD bearing from you to the enemy at first contact, in 8 sectors of 45 degrees, per map (win rate by sector).
//   hold-sooner        engagements[]: startTick, contactTick, killed; deaths[] as in fight-spot; rounds[].tickSeconds. Time from the enemy coming
//                      into play (start) to the first contact, won against lost fights. See the note below on what contact is.
//   headshot-weapon    rounds[].shots[]: weapon, part, pellets{hit, head}, targetShape ("humanoid" only)
//   accuracy-weapon    rounds[].shots[]: weapon, part, pellets{hit} (every trigger pull, not only humanoid hits)
//   strafe-map / strafe-drill  engagements[]: killed, kind; rounds[].map / .code
//   consistency        rounds[].shots[] per round (hits / shots), grouped by .code
//   tracking / tracking-lock (18 Nov 2026)  rounds[].engagements[].tracking {samples, bodyOn, headOn, bodyErrorSum, headErrorSum, lagSum,
//                      lockBodySeconds, lockHeadSeconds} (recorder header, "tracking"): how well the crosshair stays on a MOVING enemy (share of
//                      sampled ticks on the body / head, mean lag along the enemy's path) and how long it takes to lock on after the enemy appears.
//   trend-*            days[]: shots, hits, headshots (and maps{} / weapons{} for a map or weapon filter); rounds[] instead with a code filter
//   accuracy-range     shots[].nearestEnemy.range, weapon, part, pellets (shots with an enemy near the line; shotguns and melee left out)
//   miss-side-sideways shots[].nearestEnemy.side (metres, left negative), part, pellets (misses only)
//   counter-strafe     shots[].movement.speed, .airborne; nearestEnemy (shots with an enemy near the line)
//   walk-accuracy / crouch-accuracy  shots[].movement.walk, .speed, .airborne, crouchAmount (or movement.crouch); nearestEnemy
//   sens-changed / sens-extreme / mouse-accel  rounds[].input: sensitivity, adsMultiplier, accelerationNotice (the newest rounds)
// Positioning rules (fight-spot, fight-angle, hold-sooner; 17 Nov 2026). The reasoning behind them: positioning often decides the fight before
// the peek starts (Metabot, https://metabot.gg/en/valorant/guides/valorant-peeking-guide-jiggle-wide-shoulder); predictable peeks and holding one
// angle for too long get punished (Dignitas, https://dignitas.gg/articles/youre-holding-the-wrong-angle-a-valorant-guide); and standing too close
// to a wall puts you at a disadvantage (AimLabs, https://aimlabs.com/articles/aimlabs-academy/improve-your-wall-peeking-on-valorants-split/).
// Every number in them is a guess (see the constants). Not built: the wall-distance rule, because the recorder stores no wall distance (walls
// are not in its data). Dropped: a "same peek every time" rule (many training maps always start from the same spot, so a same-cell count is noise).
// fight-angle uses the WORLD bearing, not an angle relative to where you were facing: the engagement row stores no yaw (the aim yaw is only
// in the shot rows, aimYawDeg, and not for every fight), so "from your left" cannot be told. The bearing follows the game's yaw convention
// (0 looks along -z, grows toward -x), so sector names are world directions of the enemy as seen from you. Fight result: a fight is WON when the engagement has a kill tick, LOST when a death of yours by an enemy's shot has that
// enemy's id and falls after the engagement's start (the same match as deaths-unanswered); a fight that ended some other way (the enemy left
// view, the round ended) is neither and is left out. hold-sooner: the recorder keeps no separate "first shot" or "first damage taken" time. Its
// engagement CONTACT tick already IS the earliest of your shot at the enemy and the damage taken from it, so the rule measures the delay
// from the enemy coming into play (engagement start: alive, visible, in the 50 degree view cone or firing) to that contact, which is the
// closest thing the stored fields give to "how long you held before the fight began". A long delay in lost fights is also what an enemy that
// outranges you or fires from far away looks like, so the advice is worded as something to check, not a fact.
// Not built: sensitivity in cm per 360 (the game keeps no mouse DPI) and the timing of a counter-strafe (ticksSinceInput is stored, not used).
// Dropped: "flick-start" (how far the crosshair was from the head when a flick began). An engagement starts when the enemy's head enters
// the 50 degree view cone (or it fires), so the stored aim error is capped near 50 degrees and is not the angle at first sight; the
// recorder does not keep the angle at the first tick the enemy was visible, so the rule could not be measured honestly. Bringing it
// back needs the recorder to store that first-sight angle.
// Rows recorded before the movement, nearest-enemy and input fields existed have none of them, so those rules only see newer rounds.
// Clearing rules (17 Nov 2026; clear-deaths, over-checked, wasted-swings). Clearing = looking at an area on purpose to make sure nobody is
// there, or killing whoever is. They read the round's LOOK LIST (rounds[].look = [[tick, sector], ...], one pair per change of the aim yaw
// sector, 16 sectors of 22.5 degrees, sector j = yaw [22.5 j, 22.5 (j + 1)), yaw 0 looks along -z and grows LEFT; recorder header "look list"),
// rounds[].lookTruncated, and per rule:
//   clear-deaths   deaths[]: cause "shot", killerId, tick, and the killer's engagement (engagements[]: enemyId, startTick, playerContact / enemyContact,
//                  falling back to playerStart / enemyStart). A death is UNCHECKED when no look in the CLEAR_WINDOW_S seconds before it (the sector
//                  in effect at the window start counts, because the list only stores changes) was within CLEAR_ARC_DEG of the killer's bearing.
//                  The death row stores NO killer position (only the player's), so the bearing is taken from the killer's engagement: the player
//                  and the enemy positions of the SAME tick (first contact, else the engagement start), which can be some seconds before the death
//                  and the enemy may have moved: the 22.5 degree look sectors and the 45 degree arc absorb part of that error. A death whose
//                  killer has no engagement with positions, a round with no look list, or a death after the end of a truncated list is left out
//                  (not counted as checked or unchecked). The sector is named relative to the way you faced at the death tick (the look sector in
//                  effect then; it always exists for a death that can be tested), so it is coarse (the facing is only known to 22.5 degrees).
//   over-checked   per drill (share code, else map): rounds[].look time per 45 degree WORLD sector against engagements[] positions as bearings from the
//                  player (contact, else start). Rounds with a truncated look list or engagement list are left out.
//   wasted-swings  shots[]: part, pellets, weapon, nearestEnemy {range, centreDistance} (a shot with no enemy within NEAR_MARGIN_M of its line, or
//                  whose closest enemy is farther than WASTE_ARC_DEG from it, and that hit nothing). Only rounds whose shots carry the recoil
//                  fields count (aimYawDeg is the era marker): in older rows a missing nearestEnemy only means the field did not exist yet. It does not
//                  repeat accuracy-weapon / accuracy-range (those compare hit rates of shots with an enemy near the line), nor miss-side*.
//
//   window.__aimCoach.roundTip(round, { baseline, report }) -> Promise of ONE finding (same shape) about the round that just finished, or null.
//     round = the finished round (an expanded row); omitted = the newest stored round. The baseline is the user's other rounds with the same
//     code (fewer than ROUND_TIP_BASE_MIN of them: the same map), newest ROUND_LIMIT, this round left out; opts.baseline passes them in instead
//     of reading (tests). opts.report, an object, is filled with { reason, basis, baselineRounds, outliers, candidates } so a caller can see why
//     there was no tip ("thin-data": fewer than ROUND_TIP_BASE_MIN baseline rounds). Four metrics, this round against the baseline:
//       accuracy        hits / shots (round needs ROUND_SHOTS_MIN shots)
//       headshot        headshots / hits (ROUND_TIP_HITS_MIN hits)
//       sideways miss   mean shots[].nearestEnemy.side of the shots that missed (left negative, right positive). The near-miss rows carry no sideways
//                       offset (only verticalOffset), so the missed shots with an enemy near their line stand in for them (ROUND_TIP_MISS_MIN of them)
//       vertical miss   mean nearMisses[].verticalOffset (over positive, under negative; ROUND_TIP_MISS_MIN of them)
//     Outlier rule (the two miss metrics only, they have a direction): if this round's sign is opposite to the baseline mean and at least
//     ROUND_TIP_OUTLIER_SHARE of the baseline rounds have the baseline mean's sign, the round is an outlier and the metric is not tipped on.
//     Score = |z| * (ROUND_TIP_PERSIST_BASE + persistence), z = (this round - baseline mean) / max(baseline sd, floor); persistence = share of baseline
//     rounds with the same sign as this round (miss metrics) or on the same side of the baseline mean (accuracy, headshot). The top score wins when
//     |z| >= ROUND_TIP_Z and the metric has ROUND_TIP_BASE_MIN baseline rounds; otherwise null.
(() => {
  if (window.__aimCoach) return;

  // ---- every threshold lives here ----
  // ALL of these numbers are UNTUNED: they are starting guesses, not measured on real play. The comparison rules (accuracy or
  // headshot-rate gaps between two groups) aim at a gap of roughly 2.5 standard errors: for two groups of n shots at about 50% the
  // standard error of the gap is about 0.71 / sqrt(n) (5.8 points at n = 150, 7.1 at n = 100), so 2.5 standard errors is about 14 points
  // at 150 shots and 18 at 100. The 12-point gaps at 150 shots are about 2.1 standard errors, and burst-length and spray-control keep
  // their 10-point gap at 100 shots (about 1.4): they are the weakest rules here and the first to retune.
  const ROUND_LIMIT = 500;        // newest rounds read for the round-based rules
  const NEAR_MIN = 80;            // miss-side: near misses above + below the centre needed
  const NEAR_SHARE = 0.65;        // miss-side: share of one side that counts as "clearly" one side
  const HEAD_AIM_TOL_CM = 25;     // miss-side: an average offset within this of the head's height (HEAD_ABOVE_CENTRE_CM) is what aiming at the head gives
  const SIDE_SHARE = 0.6;         // miss-side-sideways: share of one side that counts as "clearly" one side
  const KILLS_MIN = 30;           // kill-style: classified kills needed (flick + strafe + mixed)
  const CLASS_SHARE = 0.85;       // kill-style: share of one class that counts as "almost all"
  const PREAIM_MIN = 30;          // pre-aim: engagements needed
  const PREAIM_SHARE = 0.6;       // pre-aim: share on one side of head height ...
  const PREAIM_DEG = 3;           // ... and average error (degrees) that count
  const PREAIM_LOW_DEG = 10;      // pre-aim-low: "well below head height" = the head this many degrees above the crosshair
  const PREAIM_LOW_SHARE = 0.25;  // pre-aim-low: share of engagements like that that gets a tip
  const BURST_GAP_S = 0.4;        // burst-length / spray-control: shots of one weapon less than this far apart are one fire run
  const BURST_REF = [2, 3];       // burst-length: the reference run lengths (a short burst)
  const BURST_LONG = 6;           // burst-length: runs of this many shots or more are "long"
  const BURST_RUNS_MIN = 15;      // burst-length: runs needed in each group compared
  const BURST_SHOTS_MIN = 100;    // burst-length: shots needed in each group compared
  const BURST_GAP_POINTS = 10;    // burst-length: accuracy gap (percentage points) that counts
  const SPRAY_FROM = 4;           // spray-control: shots from this number of the run on are "late" (the first ones are the reference)
  const SPRAY_RUNS_MIN = 15;      // spray-control: runs that reach the late shots needed
  const SPRAY_SHOTS_MIN = 100;    // spray-control: early and late shots needed
  const SPRAY_GAP_POINTS = 10;    // spray-control (hit-rate fallback): accuracy drop (percentage points) that counts
  const SPRAY_DRIFT_DEG = 1;      // spray-control (recoil basis): drift, in degrees, of the bullets of shots 4 and later from the first 3 that counts (a guess)
  const SPRAY_AWAY_DEG = 0.5;     // spray-control (recoil basis): and the later bullets must also sit this much farther from the target than the first 3 (a guess)
  const SPRAY_PULL_DEG = 1;       // spray-control (recoil basis): a mouse pull down of at least this (degrees) with on-target bullets earns the "your pull works" note (a guess)
  const SPRAY_AXIS_SHARE = 0.7;   // spray-control (recoil basis): share of the drift on one axis that makes it "mostly vertical" (or horizontal) (a guess)
  const RANGE_NEAR_M = 8;         // accuracy-range: an enemy closer than this is "near" (a guess) ...
  const RANGE_FAR_M = 20;         // ... and one farther than this is "far" (a guess); in between is "mid"
  const RANGE_SHOTS_MIN = 150;    // accuracy-range: shots needed in each band compared
  const RANGE_GAP_POINTS = 12;    // accuracy-range: accuracy gap (percentage points) between the best and weakest band that counts
  const SIDE_BAND_M = 0.05;       // miss-side-sideways: a miss this close to the enemy's centre line is neither left nor right
  const SIDE_MIN = 40;            // miss-side-sideways: misses left + right needed (the share is SIDE_SHARE)
  const STILL_MPS = 0.5;          // counter-strafe: a speed below this (m/s) is standing still (the recorder's own limit)
  const MOVE_SHOTS_MIN = 150;     // counter-strafe, walk-accuracy: shots needed in each group compared
  const MOVE_GAP_POINTS = 12;     // counter-strafe, walk-accuracy: accuracy gap (percentage points) that counts
  const CROUCH_ON = 0.5;          // crouch-accuracy: crouchAmount from this on is crouched ...
  const CROUCH_OFF = 0.05;        // ... and up to this is standing
  const POSTURE_SHOTS_MIN = 150;  // crouch-accuracy: shots needed in each posture
  const POSTURE_GAP_POINTS = 12;  // crouch-accuracy: accuracy gap (percentage points) that counts
  const SENS_RECENT_ROUNDS = 30;  // sens-*: the newest rounds with a recorded input header that count as "recent"
  const SENS_ROUNDS_MIN = 5;      // sens-*: rounds needed (before the newest one, for sens-changed)
  const SENS_SAME = 0.02;         // sens-changed: relative difference below which two sensitivities are the same
  const SENS_LOW = 0.15;          // sens-extreme: a GUESS (the game keeps no mouse DPI): below this the sensitivity is very low ...
  const SENS_HIGH = 1.2;          // ... and above this (a GUESS) very high, on the game's VALORANT-scale number (default 0.5)
  const ACCEL_SHARE = 0.5;        // mouse-accel: share of recent rounds with the acceleration notice that gets a tip
  const TTK_MIN = 20;             // kill-time: kills with a time needed
  const TTK_WINDOW_MIN = 15;      // kill-time-trend: kills needed in each 7-day window
  const TTK_CHANGE = 0.1;         // kill-time-trend: relative change that counts ...
  const TTK_CHANGE_S = 0.05;      // ... and the change in seconds that counts
  const DEATHS_MIN = 12;          // death-zone: deaths with a position on one map needed
  const CELL_MIN = 4;             // death-zone: deaths in one cell needed
  const CELL_FACTOR = 3;          // death-zone: the cell needs this many times the average deaths of the other used cells
  const CAUSE_MIN = 10;           // deaths-cause: deaths needed
  const FALL_SHARE = 0.15;        // deaths-cause: share of falls that gets a tip ...
  const FALL_MIN = 3;             // ... and the falls needed for it
  const UNANSWERED_MIN = 10;      // deaths-unanswered: deaths by a shot that match a recorded fight
  const UNANSWERED_SHARE = 0.3;   // deaths-unanswered: share that gets a tip (a warning from 0.5)
  const MULTI_MIN = 30;           // multi-enemy: fights ended with a kill needed
  const MULTI_DEATHS_MIN = 8;     // multi-enemy: matched deaths needed to talk about them
  const FIGHTS_MIN = 30;          // fights-lost: fights that ended in a kill, either way
  const LOST_TIP = 0.3;           // fights-lost: share lost for a tip ...
  const LOST_WARN = 0.5;          // ... and for a warning
  const HITS_MIN = 100;           // headshot-weapon: humanoid hits needed for each weapon compared
  const HEAD_GAP_POINTS = 12;     // headshot-weapon: headshot-rate gap (percentage points) that counts
  const ACC_SHOTS_MIN = 100;      // accuracy-weapon: shots needed for each weapon compared
  const ACC_GAP_POINTS = 10;      // accuracy-weapon: accuracy gap (percentage points) that counts
  const STRAFE_GROUP_MIN = 20;    // strafe-map / strafe-drill: classified kills needed for each map or drill compared
  const STRAFE_GAP_POINTS = 20;   // ... and the strafe-kill-rate gap (percentage points) that counts
  const SESSION_GAP_MS = 30 * 60 * 1000, SHAPE_ROUNDS_MIN = 6, SHAPE_SESSIONS_MIN = 3, WARM_ROUNDS = 2, FADE_ROUNDS = 2, SHAPE_SHOTS_MIN = 150, SHAPE_GAP_POINTS = 6; // session shape (warmup, fade)
  const WARMUP_STEPS = 3, WARMUP_POOL = 5, WARMUP_DRILL_ROUNDS_MIN = 3, WARMUP_SHOTS_MIN = 60, WARMUP_DIED_SHARE = 0.3; // the suggested warm-up (warmupPlan)
  const ROUND_SHOTS_MIN = 20;     // consistency: shots a round needs to count
  const CONSIST_MIN = 10;         // consistency: rounds (from drills played 3 times or more) needed
  const DRILL_ROUNDS_MIN = 3;     // consistency: rounds of one drill needed to measure its spread
  const STEADY_SD = 0.07;         // consistency: spread (share of shots, one standard deviation) up to which you are steady ...
  const STREAKY_SD = 0.12;        // ... and from which you are streaky
  const TREND_SHOTS_MIN = 400;    // trend-accuracy: shots needed in each 7-day window
  const TREND_HITS_MIN = 60;      // trend-headshots: hits needed in each 7-day window
  const TREND_FLAT_POINTS = 3;    // trend: a change of less than this many percentage points is "flat"
  const CELL_FIGHTS_MIN = 6;      // fight-spot: decided fights (won or lost) started from one 1 m contact cell needed (a guess, untuned)
  const LOST_SPOT_SHARE = 0.7;    // fight-spot: share of that cell's fights lost that counts; the other fights on the map must lose less than this (a guess, untuned)
  const ANGLE_FIGHTS_MIN = 12;    // fight-angle: decided fights (won or lost) in one 45 degree sector of one map needed (a guess, untuned)
  const ANGLE_LOSS_SHARE = 0.65;  // fight-angle: share of a sector's fights lost that counts as "you lose most fights from here" (a guess, untuned)
  const ANGLE_WIN_GAP = 20;       // fight-angle: the best sector's win rate must be this many percentage points above the losing sector's (a guess, untuned)
  const ANGLE_WIN_SHARE = 0.7;    // fight-angle: share of a sector's fights won that gets the "you win most fights from here" note (a guess, untuned)
  const HOLD_LOST_S = 1.5;        // hold-sooner: average seconds from the enemy coming into play to first contact in LOST fights, above which it counts (a guess, untuned)
  const HOLD_WON_S = 0.8;         // hold-sooner: the same average in WON fights must be at most this (a guess, untuned)
  const HOLD_FIGHTS_MIN = 8;      // hold-sooner: lost fights and won fights needed, each, with a contact time (a guess, untuned)
  const CLEAR_WINDOW_S = 8;       // clear-deaths: seconds before a death in which a look at the killer's direction counts as having checked it (a guess, untuned)
  const CLEAR_ARC_DEG = 45;       // clear-deaths: a look within this many degrees of the killer's bearing is a look at it (a guess, untuned)
  const CLEAR_DEATHS_MIN = 10;    // clear-deaths: testable deaths (by a shot, killer's bearing known, round with a look list) needed (a guess, untuned)
  const CLEAR_DEATH_SHARE = 0.5;  // clear-deaths: share of those deaths that were unchecked that gets the tip (a guess, untuned)
  const CLEAR_SECTOR_SHARE = 0.4; // clear-deaths: share of the unchecked deaths from one 45 degree sector that names the sector (a guess, untuned)
  const CHECK_MIN_S = 4;          // over-checked: seconds looked at one 45 degree world sector in a round for the round to count as "looked a lot" (a guess, untuned)
  const CHECK_ROUNDS_MIN = 10;    // over-checked: rounds of one drill with that much looking at the sector needed (a guess, untuned)
  const CHECK_ENEMIES_MIN = 20;   // over-checked: enemies with a known bearing in the drill needed before "nothing ever came" means anything (a guess, untuned)
  const WASTE_ARC_DEG = 3;        // wasted-swings: a shot whose closest enemy is farther than this angle from the line (atan of centreDistance over range) hit nothing near an enemy (a guess, untuned)
  const WASTE_SHARE = 0.25;       // wasted-swings: share of a drill's shots that hit nothing near an enemy that gets the tip (a guess, untuned)
  const WASTE_SHOTS_MIN = 100;    // wasted-swings: shots in a drill needed (a guess, untuned)
  const HEAD_ABOVE_CENTRE_CM = 78; // the head is about this far above the middle of a humanoid body box (recorder: 1.68 m head, 1.8 m body)

  const ROUND_TIP_BASE_MIN = 5;        // roundTip: baseline rounds needed (overall, and for each metric): fewer gives no tip (a guess, untuned)
  const ROUND_TIP_Z = 1.5;             // roundTip: |z| a metric needs against the baseline to be tipped on (a guess, untuned)
  const ROUND_TIP_OUTLIER_SHARE = 0.7; // roundTip: share of baseline rounds on the baseline mean's side that makes an opposite-side round an outlier (a guess, untuned)
  const ROUND_TIP_PERSIST_BASE = 0.5;  // roundTip: score = |z| * (this + persistence) (a guess, untuned)
  const ROUND_TIP_HITS_MIN = 10;       // roundTip: hits a round needs for its headshot rate (a guess, untuned)
  const ROUND_TIP_MISS_MIN = 8;        // roundTip: near misses (or missed shots near an enemy) a round needs for its miss bias (a guess, untuned)
  const ROUND_TIP_FLOOR_ACC = 0.03;    // roundTip: smallest baseline spread used for accuracy, as a share of shots (a guess, untuned)
  const ROUND_TIP_FLOOR_HEAD = 0.05;   // roundTip: smallest baseline spread used for the headshot share of hits (a guess, untuned)
  const ROUND_TIP_FLOOR_SIDE_M = 0.03; // roundTip: smallest baseline spread used for the sideways miss offset, metres (a guess, untuned)
  const ROUND_TIP_FLOOR_VERT_M = 0.03; // roundTip: smallest baseline spread used for the vertical miss offset, metres (a guess, untuned)

  const SEVERITY = { warn: 0, tip: 1, info: 2 };
  const pct = (x) => Math.round(x * 100);
  const rate = (a, b) => (b > 0 ? a / b : 0);
  const avg = (list) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0);
  const median = (list) => { const a = [...list].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const num = (v) => typeof v === "number" && isFinite(v);
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const r1 = (n) => Math.round(n * 10) / 10;
  const r2 = (n) => Math.round(n * 100) / 100;
  const pad = (n) => String(n).padStart(2, "0");
  const dayOf = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  const dayBack = (n) => { const d = new Date(Date.now()); d.setDate(d.getDate() - n); return dayOf(d.getTime()); };
  const isHit = (s) => s.part != null || !!(s.pellets && s.pellets.hit > 0);
  const isHead = (s) => s.part === "head" || !!(s.pellets && s.pellets.head > 0);
  const countable = (w) => w != null && w !== "melee" && w !== "?";

  // since: epoch ms, a Date, or "YYYY-MM-DD" (local midnight) -> epoch ms, or 0 for none / unreadable.
  function sinceMs(since) {
    if (since == null || since === "") return 0;
    if (since instanceof Date) return since.getTime() || 0;
    if (num(since)) return since;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(since));
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    return Date.parse(String(since)) || 0;
  }

  // ---- rules: each takes ctx = { f: filter, rounds (limited to f.since), allRounds(), days(), fromDay } and returns findings ----

  // The killed engagements of the filtered rounds (weapon = the weapon at the kill).
  // Rounds recorded with line-of-sight data: the ones the rules about when you SAW an enemy can use (see the header, SIGHT).
  const sightRounds = (ctx) => ctx.rounds.filter((r) => r.sight);
  // The tick the player first saw the enemy of an engagement (null: never seen, e.g. it killed you from out of sight).
  const seenAt = (e) => (num(e.seenTick) ? e.seenTick : null);
  const killsOf = (ctx) => { const out = []; for (const r of sightRounds(ctx)) for (const e of r.engagements) if (e.killed && (!ctx.f.weapon || e.weapon === ctx.f.weapon)) out.push(e); return out; };
  const engagementsOf = (ctx) => { const out = []; for (const r of sightRounds(ctx)) for (const e of r.engagements) if (!ctx.f.weapon || e.weapon === ctx.f.weapon) out.push(e); return out; };

  // 1. Over-aim or under-aim, from the near misses.
  function missSide(ctx) {
    const rows = [];
    for (const r of ctx.rounds) for (const n of r.nearMisses) if (!ctx.f.weapon || n.weapon === ctx.f.weapon) rows.push(n);
    const above = rows.filter((n) => n.side === "above" && num(n.verticalOffset)), below = rows.filter((n) => n.side === "below" && num(n.verticalOffset));
    const total = above.length + below.length;
    if (total < NEAR_MIN) return [];
    const aboveShare = above.length / total, belowShare = below.length / total;
    const high = aboveShare >= NEAR_SHARE, low = belowShare >= NEAR_SHARE;
    if (!high && !low) return [];
    // The offset is measured from the middle of the enemy's body box, and the head is HEAD_ABOVE_CENTRE_CM above that point, so a
    // player who aims at the head misses "high" by about that much. When the average offset of all these misses is around head height
    // the pattern is the box-centre effect, not over-aim: say nothing.
    const meanCm = avg([...above, ...below].map((n) => n.verticalOffset)) * 100;
    if (high && Math.abs(meanCm - HEAD_ABOVE_CENTRE_CM) <= HEAD_AIM_TOL_CM) return [];
    const side = high ? above : below, share = high ? aboveShare : belowShare;
    const cm = Math.round(avg(side.map((n) => Math.abs(n.verticalOffset))) * 100);
    const advice = high
      ? " The head is about " + HEAD_ABOVE_CENTRE_CM + " cm above that point, so misses at head height are normal if you aim for the head; if you aim for the chest, lower your crosshair a little."
      : " Raise your crosshair a little: aim at the head or upper chest instead of the middle of the body.";
    return [{
      id: "miss-side", severity: "tip", sample: total,
      title: high ? "You miss high" : "You miss low",
      detail: pct(share) + "% of the shots that just missed an enemy (" + side.length + " of " + total + ") passed " + (high ? "above" : "below") + " the middle of its body, on average " + cm + " cm " + (high ? "above" : "below") + " it." + advice,
      evidence: { nearMisses: total, above: above.length, below: below.length, sharePercent: pct(share), averageOffsetCm: cm, side: high ? "above" : "below" },
    }];
  }

  // 2. Flick versus strafe kills.
  function killStyle(ctx) {
    const kills = killsOf(ctx), out = [];
    const by = { flick: [], strafe: [], mixed: [] };
    for (const e of kills) if (e.kind in by) by[e.kind].push(e);
    const total = by.flick.length + by.strafe.length + by.mixed.length;
    if (total >= KILLS_MIN) {
      const kind = Object.keys(by).sort((a, b) => by[b].length - by[a].length)[0], share = by[kind].length / total;
      if (share >= CLASS_SHARE) {
        const text = {
          flick: ["Almost all your kills are flicks", "were flicks: you swing the crosshair a long way while standing nearly still. Practise shooting while strafing too, so you can win fights where you have to keep moving."],
          strafe: ["Almost all your kills come while strafing", "came while you moved sideways with the crosshair nearly still. Practise flicks too, so you can hit enemies who appear far from your crosshair."],
          mixed: ["Your kills are neither clean flicks nor clean strafes", "mixed a turn and a move in the same fight. Try one thing at a time: stop to flick, or hold your aim while you strafe."],
        }[kind];
        out.push({
          id: "kill-style", severity: "info", sample: total, title: text[0],
          detail: pct(share) + "% of your " + total + " kills (" + by[kind].length + ") " + text[1],
          evidence: { kills: total, flicks: by.flick.length, strafes: by.strafe.length, mixed: by.mixed.length, dominant: kind, sharePercent: pct(share) },
        });
      }
    }
    return out;
  }

  // 3. Pre-aim height: is the crosshair above or below head height when an enemy comes into view?
  function preAim(ctx) {
    const pitches = engagementsOf(ctx).map((e) => e.aimError && e.aimError.pitch).filter(num);
    if (pitches.length < PREAIM_MIN) return [];
    const mean = avg(pitches), low = pitches.filter((p) => p > 0).length, high = pitches.filter((p) => p < 0).length;
    const lowShare = low / pitches.length, highShare = high / pitches.length;
    const tooLow = lowShare >= PREAIM_SHARE && mean >= PREAIM_DEG, tooHigh = highShare >= PREAIM_SHARE && -mean >= PREAIM_DEG;
    const out = [], well = pitches.filter((p) => p >= PREAIM_LOW_DEG).length, wellShare = well / pitches.length;
    if (wellShare >= PREAIM_LOW_SHARE) {
      out.push({
        id: "pre-aim-low", severity: "tip", sample: pitches.length, title: "Your crosshair is often far below head height",
        detail: "In " + well + " of " + pitches.length + " fights (" + pct(wellShare) + "%) your crosshair was more than " + PREAIM_LOW_DEG + " degrees below the enemy's head when it came into view, so you had to lift it before you could shoot. Rest your crosshair at head height, also while you walk and while you turn corners.",
        evidence: { engagements: pitches.length, farBelowCount: well, farBelowPercent: pct(wellShare), limitDegrees: PREAIM_LOW_DEG },
      });
    }
    if (!tooLow && !tooHigh) return out;
    const share = tooLow ? lowShare : highShare;
    return [...out, {
      id: "pre-aim", severity: "tip", sample: pitches.length, title: tooLow ? "Your crosshair is too low at first sight" : "Your crosshair is too high at first sight",
      detail: "When an enemy came into view (" + pitches.length + " times) your crosshair was " + (tooLow ? "below" : "above") + " head height " + pct(share) + "% of the time, by " + r1(Math.abs(mean)) + " degrees on average. " + (tooLow ? "Keep your crosshair at head height while you move and hold angles, so the first shot needs no lift." : "Lower your crosshair to head height while you move and hold angles; aiming above the head wastes the first shot."),
      evidence: { engagements: pitches.length, belowHeadPercent: pct(lowShare), aboveHeadPercent: pct(highShare), averagePitchErrorDegrees: r1(mean), side: tooLow ? "below" : "above" },
    }];
  }

  // 4. Time to kill, and whether it is getting faster (last 7 days against the 7 before).
  async function killTime(ctx) {
    const times = (list) => list.filter((e) => e.killed && num(e.visibleTimeToKill) && e.visibleTimeToKill > 0).map((e) => e.visibleTimeToKill);
    const out = [], now = times(killsOf(ctx));
    if (now.length >= TTK_MIN) {
      out.push({
        id: "kill-time", severity: "info", sample: now.length, title: "You kill in about " + r2(median(now)) + " s",
        detail: "From the moment you first saw an enemy to its kill (time hidden behind walls left out), your typical time was " + r2(median(now)) + " seconds over " + now.length + " kills (average " + r2(avg(now)) + " s). Lower is better: shoot as soon as your crosshair is on the enemy.",
        evidence: { kills: now.length, medianSeconds: r2(median(now)), averageSeconds: r2(avg(now)) },
      });
    }
    const recentFrom = dayBack(6), prevFrom = dayBack(13), prevTo = dayBack(7), recent = [], prev = [];
    for (const r of await ctx.allRounds()) {
      if (r.day == null || (r.day < prevFrom) || !r.sight) continue;
      const list = r.day >= recentFrom ? recent : r.day <= prevTo ? prev : null;
      if (list) for (const e of r.engagements) if (!ctx.f.weapon || e.weapon === ctx.f.weapon) list.push(e);
    }
    const a = times(prev), b = times(recent);
    if (a.length >= TTK_WINDOW_MIN && b.length >= TTK_WINDOW_MIN) {
      const before = median(a), after = median(b), diff = after - before;
      const verdict = diff <= -TTK_CHANGE_S && -diff >= before * TTK_CHANGE ? "faster" : diff >= TTK_CHANGE_S && diff >= before * TTK_CHANGE ? "slower" : "flat";
      out.push({
        id: "kill-time-trend", severity: verdict === "slower" ? "tip" : "info", sample: a.length + b.length,
        title: verdict === "flat" ? "Your kill speed is steady" : "You are getting " + verdict + " at kills",
        detail: "Your typical time to kill was " + r2(after) + " s in the last 7 days and " + r2(before) + " s in the 7 days before" + (verdict === "flat" ? ": no real change." : ", " + r2(Math.abs(diff)) + " s " + (verdict === "faster" ? "quicker." : "slower. Slow down your first shot only if you are missing; otherwise shoot as soon as the crosshair is on the enemy.")),
        evidence: { recentSeconds: r2(after), previousSeconds: r2(before), changeSeconds: r2(diff), recentKills: b.length, previousKills: a.length, trend: verdict },
      });
    }
    return out;
  }

  // The deaths of the filtered data as { day, map, cell, n } (a 1 m cell, "cx,cz"): from the day rows, or from the rounds' death
  // positions when a code or weapon filter is set (the day rows know neither).
  async function deathCells(ctx) {
    const out = [];
    if (ctx.f.code || ctx.f.weapon) {
      const seen = new Map();
      for (const r of ctx.rounds) for (const d of r.deaths) {
        if (!d.position || !num(d.position.x) || !num(d.position.z)) continue;
        const key = r.day + "|" + r.map + "|" + Math.floor(d.position.x) + "," + Math.floor(d.position.z);
        seen.set(key, (seen.get(key) || 0) + 1);
      }
      for (const [key, n] of seen) { const [day, map, cell] = key.split("|"); out.push({ day, map, cell, n }); }
    } else {
      for (const row of await ctx.days({ map: ctx.f.map, from: ctx.fromDay })) for (const map of Object.keys(row.grid || {})) for (const cell of Object.keys(row.grid[map])) out.push({ day: row.day, map, cell, n: row.grid[map][cell] });
    }
    return out;
  }
  const spot = (cell) => { const [cx, cz] = cell.split(",").map(Number); return { cx, cz, x: cx + 0.5, z: cz + 0.5 }; };

  // 5. Death location: the 1 m cell with far more deaths than the average of the other used cells, per map.
  async function deathZone(ctx) {
    const maps = new Map(); // map -> Map(cell -> deaths)
    for (const c of await deathCells(ctx)) { let g = maps.get(c.map); if (!g) maps.set(c.map, (g = new Map())); g.set(c.cell, (g.get(c.cell) || 0) + c.n); }
    const out = [];
    for (const [map, cells] of maps) {
      let total = 0;
      for (const n of cells.values()) total += n;
      if (total < DEATHS_MIN) continue;
      let best = null;
      for (const [cell, n] of cells) if (!best || n > best[1]) best = [cell, n];
      // "well above the average": against the average of the other used cells (a map with one used cell passes)
      const mean = cells.size > 1 ? (total - best[1]) / (cells.size - 1) : 0;
      if (best[1] < CELL_MIN || best[1] < CELL_FACTOR * mean) continue;
      const { cx, cz, x, z } = spot(best[0]);
      out.push({
        id: "death-zone:" + map, severity: "tip", sample: total, title: "You keep dying in one spot on " + map,
        detail: "On " + map + " you died or fell " + plural(best[1], "time", "times") + " within a metre of x " + x + " m, z " + z + " m (measured from the map's origin), " + pct(best[1] / total) + "% of your " + total + " deaths there" + (mean > 0 ? " and about " + Math.round(best[1] / mean) + " times a typical other spot" : "") + ". Next time you pass there, check the corners first or take another route.",
        evidence: { map, cellX: cx, cellZ: cz, centreX: x, centreZ: z, deathsInCell: best[1], deathsOnMap: total, usedCells: cells.size, timesAverage: mean > 0 ? r1(best[1] / mean) : null },
      });
    }
    return out;
  }

  // 6. Death-spot repeats (removed): dying twice in one 1 m square on one day is normal with little data.
  // deathZone (rule 5) already reports a spot that is well above the map's other spots.

  // 7. Deaths by cause: shot against fall.
  function deathsCause(ctx) {
    if (ctx.f.weapon) return []; // a death does not record which weapon you held
    let shot = 0, fell = 0;
    for (const r of ctx.rounds) for (const d of r.deaths) { if (d.cause === "fell") fell++; else if (d.cause === "shot") shot++; }
    const total = shot + fell;
    if (total < CAUSE_MIN) return [];
    const tip = fell >= FALL_MIN && fell / total >= FALL_SHARE;
    return [{
      id: "deaths-cause", severity: tip ? "tip" : "info", sample: total, title: tip ? "Many of your deaths are falls" : "Most of your deaths come from enemy shots",
      detail: "Of your " + total + " deaths, " + shot + " (" + pct(shot / total) + "%) were enemy shots and " + fell + " (" + pct(fell / total) + "%) were falls." + (tip ? " Falls are free deaths: slow down near edges and drops, and check the ground before you jump." : " Work on the fights themselves."),
      evidence: { deaths: total, byShot: shot, falls: fell, fallPercent: pct(fell / total) },
    }];
  }

  // The engagement that killed you: the latest of that enemy's engagements that began before the death.
  function killerFight(r, d) {
    let best = null;
    for (const e of r.engagements) if (e.enemyId === d.killerId && e.startTick <= d.tick && (!best || e.startTick >= best.startTick)) best = e;
    return best;
  }
  const shotDeaths = (r) => r.deaths.filter((d) => d.cause === "shot" && d.killerId != null);

  // 8. Deaths where you had not fired a shot in the fight.
  function deathsUnanswered(ctx) {
    if (ctx.f.weapon) return [];
    let matched = 0, silent = 0;
    for (const r of sightRounds(ctx)) {
      if (!r.engagements.length) continue;
      for (const d of shotDeaths(r)) {
        const e = killerFight(r, d);
        if (!e || seenAt(e) === null || seenAt(e) > d.tick) continue; // killed from out of sight: nothing you could have answered
        matched++;
        if (!r.shots.some((s) => s.tick >= seenAt(e) && s.tick <= d.tick)) silent++;
      }
    }
    if (matched < UNANSWERED_MIN) return [];
    const share = silent / matched;
    if (share < UNANSWERED_SHARE) return [];
    return [{
      id: "deaths-unanswered", severity: share >= 0.5 ? "warn" : "tip", sample: matched, title: "You often die without firing back",
      detail: "In " + silent + " of your " + matched + " deaths to an enemy's shot (" + pct(share) + "%) you had not fired a single shot in that fight. The enemy saw you first or you were looking the wrong way: check the angles you cannot see before you step out, and shoot as soon as an enemy appears.",
      evidence: { deathsMatched: matched, deathsWithoutFiring: silent, sharePercent: pct(share) },
    }];
  }

  // 9. Two enemies at once: a second fight that begins while one is still running.
  function multiEnemy(ctx) {
    const overlaps = (a, endA, b) => b.enemyId !== a.enemyId && ((b.startTick >= a.startTick && b.startTick <= endA) || (b.killed && b.startTick <= endA && b.killTick >= a.startTick));
    let kills = 0, killsMulti = 0, deaths = 0, deathsMulti = 0;
    for (const r of ctx.rounds) {
      for (const e of r.engagements) if (e.killed) { kills++; if (r.engagements.some((b) => b !== e && overlaps(e, e.killTick, b))) killsMulti++; }
      for (const d of shotDeaths(r)) {
        const e = killerFight(r, d);
        if (!e) continue;
        deaths++;
        if (r.engagements.some((b) => b !== e && overlaps(e, d.tick, b))) deathsMulti++;
      }
    }
    if (kills < MULTI_MIN) return [];
    const killShare = killsMulti / kills, talk = deaths >= MULTI_DEATHS_MIN, deathShare = talk ? deathsMulti / deaths : 0;
    const tip = talk && deathShare >= 0.5 && deathShare > killShare;
    return [{
      id: "multi-enemy", severity: tip ? "tip" : "info", sample: kills + (talk ? deaths : 0),
      title: tip ? "You die when more than one enemy shows up" : "A second enemy shows up in " + pct(killShare) + "% of your fights",
      detail: "In " + killsMulti + " of your " + kills + " kills (" + pct(killShare) + "%) a second enemy came into view before you finished the first." + (talk ? " Of your " + deaths + " deaths to an enemy's shot, " + deathsMulti + " (" + pct(deathShare) + "%) came after a second enemy appeared." : "") + (tip ? " Fall back to cover when a second enemy appears and take them one at a time." : ""),
      evidence: { kills, killsWithSecondEnemy: killsMulti, killPercent: pct(killShare), ...(talk ? { deaths, deathsWithSecondEnemy: deathsMulti, deathPercent: pct(deathShare) } : {}) },
    }];
  }

  // 10. Fights lost: your deaths to an enemy's shot against the engagements you ended with a kill.
  function fightsLost(ctx) {
    if (ctx.f.weapon) return []; // a death does not record which weapon you held
    let won = 0, lost = 0, used = 0;
    for (const r of ctx.rounds) {
      if (!r.engagements.length || r.engagementsTruncated) continue; // rounds from before engagements were recorded, or cut short
      used++;
      for (const e of r.engagements) if (e.killed) won++;
      lost += shotDeaths(r).length;
    }
    const total = won + lost;
    if (total < FIGHTS_MIN) return [];
    const share = lost / total;
    const sev = share >= LOST_WARN ? "warn" : share >= LOST_TIP ? "tip" : "info";
    const advice = sev === "info" ? "That is a good record; keep taking fights the same way." : "Try to shoot first: stop moving before you fire, peek from cover and pull back after a kill, and do not take fights where the enemy already has you in sight.";
    return [{
      id: "fights-lost", severity: sev, sample: total, title: sev === "info" ? "You win most of your fights" : "Enemies shoot you first in " + pct(share) + "% of fights",
      detail: "Of " + total + " fights that ended with someone down, you lost " + lost + " (" + pct(share) + "%) and won " + won + ". " + advice,
      evidence: { fightsWon: won, fightsLost: lost, fights: total, lostPercent: pct(share), rounds: used },
    }];
  }

  // 10b. Fight spot: the 1 m cell of first contact where you lose most of your fights, per map.
  function fightSpot(ctx) {
    if (ctx.f.weapon) return []; // a death does not record which weapon you held
    const maps = new Map(); // map -> { won, lost, cells: Map(cell -> {won, lost}) }
    for (const r of ctx.rounds) {
      if (r.engagementsTruncated) continue;
      const lostFights = new Set();
      for (const d of shotDeaths(r)) { const e = killerFight(r, d); if (e) lostFights.add(e); }
      for (const e of r.engagements) {
        const won = !!e.killed, lost = !won && lostFights.has(e);
        if ((!won && !lost) || !e.playerContact || !num(e.playerContact.x) || !num(e.playerContact.z)) continue;
        let m = maps.get(r.map);
        if (!m) maps.set(r.map, (m = { won: 0, lost: 0, cells: new Map() }));
        const key = Math.floor(e.playerContact.x) + "," + Math.floor(e.playerContact.z);
        let c = m.cells.get(key);
        if (!c) m.cells.set(key, (c = { won: 0, lost: 0 }));
        if (won) { m.won++; c.won++; } else { m.lost++; c.lost++; }
      }
    }
    const out = [];
    for (const [map, m] of maps) {
      let best = null;
      for (const [cell, c] of m.cells) {
        const n = c.won + c.lost;
        if (n < CELL_FIGHTS_MIN || c.lost / n < LOST_SPOT_SHARE) continue;
        const restLost = m.lost - c.lost, rest = m.won - c.won + restLost;
        if (rest === 0 || restLost / rest >= LOST_SPOT_SHARE) continue; // the rest must lose less, so the spot is the difference
        if (!best || c.lost > best.c.lost || (c.lost === best.c.lost && c.lost / n > best.c.lost / best.n)) best = { cell, c, n, restLost, rest };
      }
      if (!best) continue;
      const z = spot(best.cell), share = best.c.lost / best.n;
      out.push({
        id: "fight-spot:" + map, severity: "tip", sample: best.n, title: "Fights lost from one spot",
        detail: "On " + map + " you lost " + best.c.lost + " of the " + best.n + " fights that began with you standing within a metre of x " + z.x + " m, z " + z.z + " m (" + pct(share) + "%), while your other " + plural(best.rest, "fight", "fights") + " on that map lost " + pct(best.restLost / best.rest) + "%. The spot, not your aim, may be the problem: peek from a different position, clear the angle from further back, or stop taking the fight there.",
        evidence: { map, cellX: z.cx, cellZ: z.cz, centreX: z.x, centreZ: z.z, fightsInCell: best.n, lostInCell: best.c.lost, wonInCell: best.c.won, lostPercent: pct(share), restFights: best.rest, restLostPercent: pct(best.restLost / best.rest), minFights: CELL_FIGHTS_MIN, minShare: LOST_SPOT_SHARE },
      });
    }
    return out;
  }

  // 10c. Win rate by the direction of the enemy at first contact: 8 sectors of 45 degrees of the world bearing, per map.
  const SECTORS = ["the -z direction", "the -z / -x diagonal", "the -x direction", "the +z / -x diagonal", "the +z direction", "the +z / +x diagonal", "the +x direction", "the -z / +x diagonal"];
  // The game's yaw convention: 0 looks along -z and grows toward -x (counter-clockwise from above), so sector k is centred on yaw 45 * k.
  const sectorOf = (px, pz, ex, ez) => {
    const dx = ex - px, dz = ez - pz;
    if (Math.hypot(dx, dz) < 0.01) return -1;
    const deg = Math.atan2(-dx, -dz) * 180 / Math.PI; // -180..180
    return ((Math.round(deg / 45) % 8) + 8) % 8;
  };
  function fightAngle(ctx) {
    if (ctx.f.weapon) return []; // a death does not record which weapon you held
    const maps = new Map(); // map -> array of 8 { won, lost }
    for (const r of ctx.rounds) {
      if (r.engagementsTruncated) continue;
      const lostFights = new Set();
      for (const d of shotDeaths(r)) { const e = killerFight(r, d); if (e) lostFights.add(e); }
      for (const e of r.engagements) {
        const won = !!e.killed, lost = !won && lostFights.has(e), p = e.playerContact, q = e.enemyContact;
        if ((!won && !lost) || !p || !q || !num(p.x) || !num(p.z) || !num(q.x) || !num(q.z)) continue;
        const k = sectorOf(p.x, p.z, q.x, q.z);
        if (k < 0) continue;
        let m = maps.get(r.map);
        if (!m) maps.set(r.map, (m = Array.from({ length: 8 }, () => ({ won: 0, lost: 0 }))));
        if (won) m[k].won++; else m[k].lost++;
      }
    }
    const out = [];
    for (const [map, m] of maps) {
      const used = m.map((c, k) => ({ k, won: c.won, lost: c.lost, n: c.won + c.lost })).filter((c) => c.n >= ANGLE_FIGHTS_MIN);
      if (!used.length) continue;
      const sectors = used.map((c) => ({ sector: SECTORS[c.k], fights: c.n, won: c.won, lost: c.lost, winPercent: pct(c.won / c.n) }));
      const bestWin = used.reduce((a, c) => (c.won / c.n > a.won / a.n ? c : a), used[0]);
      const worst = used.reduce((a, c) => (c.lost / c.n > a.lost / a.n ? c : a), used[0]);
      const gapPoints = (bestWin.won / bestWin.n - worst.won / worst.n) * 100;
      if (worst.k !== bestWin.k && worst.lost / worst.n >= ANGLE_LOSS_SHARE && gapPoints >= ANGLE_WIN_GAP) {
        out.push({
          id: "angle-lose:" + map, severity: "tip", sample: worst.n, title: "You lose most fights from " + SECTORS[worst.k] + " on " + map,
          detail: "On " + map + " you lost " + worst.lost + " of the " + worst.n + " fights where the enemy was first in " + SECTORS[worst.k] + " of you (" + pct(worst.lost / worst.n) + "%), against a win rate of " + pct(bestWin.won / bestWin.n) + "% when the enemy was in " + SECTORS[bestWin.k] + ". Directions are fixed directions on the map, the same in every round (like north on a compass), not left or right of where you were looking. Think about what you do differently on that side: how you hold it, where you stand, whether you clear it first.",
          evidence: { map, sector: SECTORS[worst.k], sectorYawDeg: worst.k * 45, fights: worst.n, lost: worst.lost, won: worst.won, lostPercent: pct(worst.lost / worst.n), bestSector: SECTORS[bestWin.k], bestWinPercent: pct(bestWin.won / bestWin.n), gapPoints: Math.round(gapPoints), bearing: "world", sectors, minFights: ANGLE_FIGHTS_MIN, minLossShare: ANGLE_LOSS_SHARE, minGapPoints: ANGLE_WIN_GAP },
        });
      }
      if (bestWin.won / bestWin.n >= ANGLE_WIN_SHARE) {
        out.push({
          id: "angle-win:" + map, severity: "info", sample: bestWin.n, title: "You win most fights from " + SECTORS[bestWin.k] + " on " + map,
          detail: "On " + map + " you won " + bestWin.won + " of the " + bestWin.n + " fights where the enemy was first in " + SECTORS[bestWin.k] + " of you (" + pct(bestWin.won / bestWin.n) + "%). Whatever you do on that side works: try to bring the same habits to the other directions. Directions are fixed directions on the map, the same in every round (like north on a compass), not left or right of where you were looking.",
          evidence: { map, sector: SECTORS[bestWin.k], sectorYawDeg: bestWin.k * 45, fights: bestWin.n, won: bestWin.won, lost: bestWin.lost, winPercent: pct(bestWin.won / bestWin.n), bearing: "world", sectors, minFights: ANGLE_FIGHTS_MIN, minWinShare: ANGLE_WIN_SHARE },
        });
      }
    }
    return out;
  }

  // 10d. Hold or move sooner: the delay from first sight of the enemy to first contact, in lost fights against won fights.
  function holdSooner(ctx) {
    if (ctx.f.weapon) return []; // a death does not record which weapon you held
    const won = [], lost = [];
    for (const r of sightRounds(ctx)) {
      if (r.engagementsTruncated) continue;
      const dt = num(r.tickSeconds) && r.tickSeconds > 0 ? r.tickSeconds : 1 / 128, lostFights = new Set();
      for (const d of shotDeaths(r)) { const e = killerFight(r, d); if (e) lostFights.add(e); }
      for (const e of r.engagements) {
        if (!num(e.contactTick) || seenAt(e) === null || e.contactTick < seenAt(e)) continue; // never seen, or it shot you before you saw it
        const delay = (e.contactTick - seenAt(e)) * dt;
        if (e.killed) won.push(delay); else if (lostFights.has(e)) lost.push(delay);
      }
    }
    if (won.length < HOLD_FIGHTS_MIN || lost.length < HOLD_FIGHTS_MIN) return [];
    const lostAvg = avg(lost), wonAvg = avg(won);
    if (lostAvg <= HOLD_LOST_S || wonAvg > HOLD_WON_S) return [];
    return [{
      id: "hold-sooner", severity: "tip", sample: won.length + lost.length, title: "Hold or move sooner",
      detail: "In the " + plural(lost.length, "fight", "fights") + " you lost, " + r1(lostAvg) + " seconds passed on average between you first seeing the enemy and the first shot or hit, against " + r1(wonAvg) + " seconds in the " + plural(won.length, "fight", "fights") + " you won. Either commit and shoot sooner, or step back behind cover instead of holding the angle in the open. (Check the lost fights for enemies who simply shot you from far away.)",
      evidence: { lostFights: lost.length, wonFights: won.length, lostAverageSeconds: r2(lostAvg), wonAverageSeconds: r2(wonAvg), lostThresholdSeconds: HOLD_LOST_S, wonThresholdSeconds: HOLD_WON_S },
    }];
  }

  // ---- clearing (see the header: clear-deaths, over-checked, wasted-swings) ----
  const LOOK_BIN_DEG = 22.5; // the recorder's look sector width
  const normDeg = (d) => ((d % 360) + 360) % 360;
  const angDiff = (a, b) => { const d = normDeg(a - b); return d > 180 ? 360 - d : d; };
  const lookCentre = (sector) => sector * LOOK_BIN_DEG + LOOK_BIN_DEG / 2; // yaw of a look sector's middle, degrees 0..360 (grows LEFT)
  // Bearing from the player to a point in the game's yaw convention (0 = along -z, grows toward -x), degrees 0..360, or null when they coincide.
  const bearingDeg = (px, pz, ex, ez) => (Math.hypot(ex - px, ez - pz) < 0.01 ? null : normDeg(Math.atan2(-(ex - px), -(ez - pz)) * 180 / Math.PI));
  const worldSector = (bearing) => Math.round(normDeg(bearing) / 45) % 8; // index into SECTORS
  const goodLook = (r) => Array.isArray(r.look) && r.look.length > 0 && r.look.every((l) => Array.isArray(l) && num(l[0]) && num(l[1]));
  // Bearing from the player to the enemy of an engagement, from the positions of one tick (first contact, else the start); null when unknown.
  function engagementBearing(e) {
    for (const [p, q] of [[e.playerContact, e.enemyContact], [e.playerStart, e.enemyStart]]) {
      if (p && q && num(p.x) && num(p.z) && num(q.x) && num(q.z)) { const b = bearingDeg(p.x, p.z, q.x, q.z); if (b != null) return b; }
    }
    return null;
  }
  // The look sector in effect at a tick: the last change at or before it (index into r.look), or -1.
  function lookIndexAt(look, tick) { let i = -1; for (let k = 0; k < look.length; k++) { if (look[k][0] <= tick) i = k; else break; } return i; }
  // { unchecked, facing } for a death and the killer's bearing: unchecked when no look in the window was within CLEAR_ARC_DEG of the bearing;
  // facing = the yaw (degrees) of the look sector at the death tick. null when it cannot be told (no look at or before the death, or the death
  // is past the end of a truncated list).
  function checkedBefore(r, tick, bearing) {
    const look = r.look, dt = num(r.tickSeconds) && r.tickSeconds > 0 ? r.tickSeconds : 1 / 128;
    const last = lookIndexAt(look, tick);
    if (last < 0 || (r.lookTruncated && tick > look[look.length - 1][0])) return null;
    const from = tick - CLEAR_WINDOW_S / dt;
    let seen = false;
    for (let i = last; i >= 0; i--) {
      if (angDiff(lookCentre(look[i][1]), bearing) <= CLEAR_ARC_DEG) { seen = true; break; }
      if (look[i][0] <= from) break; // this one was in effect at the window start: nothing earlier counts
    }
    return { unchecked: !seen, facing: lookCentre(look[last][1]) };
  }
  // The direction of a bearing relative to the way you faced (yaw grows LEFT, so a positive difference is to your left).
  const RELATIVE = ["the front", "your front-left", "your left", "your back-left", "behind you", "your back-right", "your right", "your front-right"];
  const relativeSector = (bearing, facing) => Math.round(normDeg(bearing - facing) / 45) % 8;

  // 10e. Deaths from angles you never looked at in the seconds before.
  function clearDeaths(ctx) {
    if (ctx.f.weapon) return []; // a death does not record which weapon you held
    let tested = 0, unchecked = 0, rounds = 0, skipped = 0;
    const by = new Map(); // relative sector -> unchecked deaths
    for (const r of ctx.rounds) {
      if (!goodLook(r) || r.engagementsTruncated) continue;
      rounds++;
      for (const d of shotDeaths(r)) {
        const e = killerFight(r, d), b = e ? engagementBearing(e) : null, c = b == null || !num(d.tick) ? null : checkedBefore(r, d.tick, b);
        if (!c) { skipped++; continue; }
        tested++;
        if (!c.unchecked) continue;
        unchecked++;
        const k = relativeSector(b, c.facing);
        by.set(k, (by.get(k) || 0) + 1);
      }
    }
    if (tested < CLEAR_DEATHS_MIN) return [];
    const share = unchecked / tested;
    if (share < CLEAR_DEATH_SHARE) return [];
    let top = null;
    for (const [k, n] of by) if (!top || n > top.n) top = { k, n };
    const named = top && top.n / unchecked >= CLEAR_SECTOR_SHARE;
    const sectors = [...by].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ sector: RELATIVE[k], deaths: n }));
    return [{
      id: "clear-deaths", severity: "tip", sample: tested, title: "Most of your deaths came from angles you never checked",
      detail: unchecked + " of your " + tested + " deaths to an enemy's shot (" + pct(share) + "%) came from a direction you had not looked at in the " + CLEAR_WINDOW_S + " seconds before (within " + CLEAR_ARC_DEG + " degrees of it)." +
        (named ? " You keep dying to " + RELATIVE[top.k] + " without checking it (" + top.n + " of those " + unchecked + "): look there on purpose before you commit, or clear it as you pass." : " Look at the corners and doors around you on purpose before you commit, or clear them as you pass.") +
        " The killer's direction is worked out from where it first met you, so it is approximate.",
      evidence: { deathsTested: tested, uncheckedDeaths: unchecked, uncheckedPercent: pct(share), roundsWithLookData: rounds, deathsSkipped: skipped, windowSeconds: CLEAR_WINDOW_S, arcDegrees: CLEAR_ARC_DEG,
        sector: named ? RELATIVE[top.k] : null, sectorDeaths: named ? top.n : 0, sectorBearing: "relative to the way you faced at the death", sectors, minDeaths: CLEAR_DEATHS_MIN, minShare: CLEAR_DEATH_SHARE, minSectorShare: CLEAR_SECTOR_SHARE },
    }];
  }

  // Seconds of a round spent looking at each of the 8 world sectors (45 degrees, same indexes as SECTORS). The last look runs to the round's
  // last recorded shot or death (the list does not say when the round ended).
  function lookSeconds(r) {
    const dt = num(r.tickSeconds) && r.tickSeconds > 0 ? r.tickSeconds : 1 / 128, look = r.look, out = new Array(8).fill(0);
    let end = look[look.length - 1][0];
    for (const s of r.shots) if (num(s.tick) && s.tick > end) end = s.tick;
    for (const d of r.deaths) if (num(d.tick) && d.tick > end) end = d.tick;
    for (let i = 0; i < look.length; i++) {
      const to = i + 1 < look.length ? look[i + 1][0] : end;
      out[Math.floor(((look[i][1] + 1) % 16) / 2)] += Math.max(0, to - look[i][0]) * dt; // bins 2k - 1 and 2k are world sector k
    }
    return out;
  }

  // 10f. Directions you look at a lot where no enemy ever showed up (a note only: some drills place enemies at random).
  function overChecked(ctx) {
    if (ctx.f.weapon) return [];
    const groups = new Map(); // drill -> { rounds, enemies[8], located, looked[8] (rounds with enough looking), map }
    for (const r of ctx.rounds) {
      if (!goodLook(r) || r.lookTruncated || r.engagementsTruncated) continue;
      const key = r.code != null ? String(r.code) : String(r.map ?? "?");
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { rounds: 0, enemies: new Array(8).fill(0), located: 0, looked: new Array(8).fill(0), map: r.map }));
      g.rounds++;
      for (const e of r.engagements) { const b = engagementBearing(e); if (b != null) { g.enemies[worldSector(b)]++; g.located++; } }
      lookSeconds(r).forEach((s, k) => { if (s >= CHECK_MIN_S) g.looked[k]++; });
    }
    const out = [];
    for (const [key, g] of groups) {
      if (g.located < CHECK_ENEMIES_MIN) continue;
      // no enemy in the sector or in either neighbour: an enemy 45 degrees to one side is still in view while you look at the sector
      const list = [];
      for (let k = 0; k < 8; k++) if (g.looked[k] >= CHECK_ROUNDS_MIN && g.enemies[k] + g.enemies[(k + 1) % 8] + g.enemies[(k + 7) % 8] === 0) list.push({ k, rounds: g.looked[k] });
      if (!list.length) continue;
      const top = list.reduce((a, c) => (c.rounds > a.rounds ? c : a), list[0]);
      out.push({
        id: "over-checked:" + key, severity: "info", sample: g.rounds, title: "You look at " + SECTORS[top.k] + " a lot, and nothing has ever come from there",
        detail: "In " + (g.map != null ? g.map + " drill " : "drill ") + key + " you spent at least " + CHECK_MIN_S + " seconds looking at " + SECTORS[top.k] + " in " + top.rounds + " of your " + g.rounds + " rounds, and none of the " + g.located + " enemies we could place came from there or from either side of it. If this drill always places enemies in the same spots, that time is better spent on the sides they come from. (A note, not a fact: some drills place enemies at random, and enemies we could not place are not counted. Directions are world directions on the map.)",
        evidence: { drill: key, map: g.map ?? null, sector: SECTORS[top.k], sectorYawDeg: top.k * 45, roundsLookedAt: top.rounds, rounds: g.rounds, enemiesPlaced: g.located, otherSectors: list.filter((x) => x.k !== top.k).map((x) => ({ sector: SECTORS[x.k], rounds: x.rounds })), minSeconds: CHECK_MIN_S, minRounds: CHECK_ROUNDS_MIN, minEnemies: CHECK_ENEMIES_MIN, bearing: "world" },
      });
    }
    return out;
  }

  // 10g. Shots that hit nothing near an enemy, per drill (the worst drill with enough shots).
  function wastedSwings(ctx) {
    const by = new Map(); // drill -> { shots, wasted }
    for (const r of ctx.rounds) {
      if (!r.shots.some((s) => num(s.aimYawDeg))) continue; // older rows: no nearestEnemy to judge by
      const key = r.code != null ? String(r.code) : String(r.map ?? "?");
      for (const s of r.shots) {
        if (!countable(s.weapon) || s.pellets || (ctx.f.weapon && s.weapon !== ctx.f.weapon)) continue; // a shotgun's spread is not a swing at nothing
        let g = by.get(key);
        if (!g) by.set(key, (g = { drill: key, map: r.map, shots: 0, wasted: 0 }));
        g.shots++;
        const n = s.nearestEnemy, near = n && num(n.range) && num(n.centreDistance) && n.range > 0.01 && Math.atan2(n.centreDistance, n.range) * 180 / Math.PI <= WASTE_ARC_DEG;
        if (!isHit(s) && !near) g.wasted++;
      }
    }
    const list = [...by.values()].filter((g) => g.shots >= WASTE_SHOTS_MIN && g.wasted / g.shots >= WASTE_SHARE).sort((a, b) => b.wasted / b.shots - a.wasted / a.shots || b.shots - a.shots);
    if (!list.length) return [];
    const top = list[0], share = top.wasted / top.shots, p = pct(share);
    const words = p >= 23 && p <= 28 ? "A quarter" : p >= 47 && p <= 53 ? "Half" : p + "%";
    return [{
      id: "wasted-swings:" + top.drill, severity: "tip", sample: top.shots, title: words + " of your shots hit nothing near an enemy",
      detail: "In " + (top.map != null ? top.map + " drill " : "drill ") + top.drill + " " + top.wasted + " of your " + top.shots + " shots (" + p + "%) passed " + WASTE_ARC_DEG + " degrees or more from any enemy, or no enemy was near the line at all. Those are swings you did not need: shoot once the crosshair is on the enemy instead of firing while you look for it. (Shots you fire on purpose at nothing, to test recoil or to warm up, count too.)",
      evidence: { drill: top.drill, map: top.map ?? null, shots: top.shots, wastedShots: top.wasted, wastedPercent: p, otherDrillsOverThreshold: list.length - 1, arcDegrees: WASTE_ARC_DEG, minShare: WASTE_SHARE, minShots: WASTE_SHOTS_MIN },
    }];
  }

  // 11. Headshot rate per weapon, on humanoid targets only.
  function headshotWeapon(ctx) {
    if (ctx.f.weapon) return []; // a comparison needs more than one weapon
    const by = new Map();
    for (const r of ctx.rounds) for (const s of r.shots) {
      if (s.targetShape !== "humanoid" || !countable(s.weapon) || !isHit(s)) continue;
      let e = by.get(s.weapon);
      if (!e) by.set(s.weapon, (e = { weapon: s.weapon, hits: 0, heads: 0 }));
      e.hits++;
      if (isHead(s)) e.heads++;
    }
    const list = [...by.values()].filter((e) => e.hits >= HITS_MIN).map((e) => ({ ...e, rate: e.heads / e.hits })).sort((a, b) => b.rate - a.rate);
    if (list.length < 2) return [];
    const top = list[0], low = list[list.length - 1], gap = Math.round((top.rate - low.rate) * 100);
    if (gap < HEAD_GAP_POINTS) return [];
    return [{
      id: "headshot-weapon", severity: "info", sample: top.hits + low.hits, title: "You get more headshots with the " + top.weapon,
      detail: "With the " + top.weapon + " " + pct(top.rate) + "% of your hits on people are headshots (" + top.heads + " of " + top.hits + "), with the " + low.weapon + " only " + pct(low.rate) + "% (" + low.heads + " of " + low.hits + "). When you use the " + low.weapon + ", slow down a little and aim for the head.",
      evidence: { best: top.weapon, bestHeadshotPercent: pct(top.rate), bestHits: top.hits, worst: low.weapon, worstHeadshotPercent: pct(low.rate), worstHits: low.hits, gapPoints: gap, weaponsCompared: list.length },
    }];
  }

  // 12. Accuracy per weapon: the share of trigger pulls that hit (a shotgun shot hits when any pellet does).
  function accuracyWeapon(ctx) {
    if (ctx.f.weapon) return [];
    const by = new Map();
    for (const r of ctx.rounds) for (const s of r.shots) {
      if (!countable(s.weapon)) continue;
      let e = by.get(s.weapon);
      if (!e) by.set(s.weapon, (e = { weapon: s.weapon, shots: 0, hits: 0 }));
      e.shots++;
      if (isHit(s)) e.hits++;
    }
    const list = [...by.values()].filter((e) => e.shots >= ACC_SHOTS_MIN).map((e) => ({ ...e, rate: e.hits / e.shots })).sort((a, b) => b.rate - a.rate);
    if (list.length < 2) return [];
    const top = list[0], low = list[list.length - 1], gap = Math.round((top.rate - low.rate) * 100);
    if (gap < ACC_GAP_POINTS) return [];
    return [{
      id: "accuracy-weapon", severity: "info", sample: top.shots + low.shots, title: "Your " + low.weapon + " is your weakest weapon",
      detail: "You hit " + pct(top.rate) + "% of your " + top.shots + " shots with the " + top.weapon + " but only " + pct(low.rate) + "% of your " + low.shots + " with the " + low.weapon + " (" + gap + " points less). Spend a warm-up round on the " + low.weapon + ", and fire it in shorter, calmer bursts.",
      evidence: { best: top.weapon, bestAccuracyPercent: pct(top.rate), bestShots: top.shots, worst: low.weapon, worstAccuracyPercent: pct(low.rate), worstShots: low.shots, gapPoints: gap, weaponsCompared: list.length },
    }];
  }

  // 13 and 14. Strafe-kill rate by map and by drill (a drill = its share code): the best and the worst group with enough kills.
  function strafeBy(ctx, field, id, noun) {
    if (ctx.f[field === "map" ? "map" : "code"]) return []; // already narrowed to one
    const by = new Map();
    for (const r of sightRounds(ctx)) {
      const key = r[field];
      if (key == null) continue;
      for (const e of r.engagements) {
        if (!e.killed || !(e.kind === "flick" || e.kind === "strafe" || e.kind === "mixed") || (ctx.f.weapon && e.weapon !== ctx.f.weapon)) continue;
        let g = by.get(key);
        if (!g) by.set(key, (g = { key, kills: 0, strafes: 0 }));
        g.kills++;
        if (e.kind === "strafe") g.strafes++;
      }
    }
    const list = [...by.values()].filter((g) => g.kills >= STRAFE_GROUP_MIN).map((g) => ({ ...g, rate: g.strafes / g.kills })).sort((a, b) => b.rate - a.rate);
    if (list.length < 2) return [];
    const top = list[0], low = list[list.length - 1], gap = Math.round((top.rate - low.rate) * 100);
    if (gap < STRAFE_GAP_POINTS) return [];
    return [{
      id, severity: "info", sample: top.kills + low.kills, title: "You strafe-kill much more on one " + noun,
      detail: pct(top.rate) + "% of your kills on " + noun + " " + top.key + " (" + top.strafes + " of " + top.kills + ") come while strafing, against " + pct(low.rate) + "% on " + noun + " " + low.key + " (" + low.strafes + " of " + low.kills + "). On " + noun + " " + low.key + " you mostly stand still or flick: try moving while you shoot there.",
      evidence: { [noun]: top.key, strafePercent: pct(top.rate), kills: top.kills, otherGroup: low.key, otherStrafePercent: pct(low.rate), otherKills: low.kills, gapPoints: gap, groupsCompared: list.length },
    }];
  }
  const strafeMap = (ctx) => strafeBy(ctx, "map", "strafe-map", "map");
  const strafeDrill = (ctx) => strafeBy(ctx, "code", "strafe-drill", "drill");

  // Fire runs: the shots of one weapon that follow each other less than BURST_GAP_S apart, as arrays of the shots (shotguns and melee left out).
  function fireRunShots(ctx) {
    const runs = [];
    for (const r of ctx.rounds) {
      let run = null, last = null, weapon = null;
      for (const s of r.shots) {
        if (!countable(s.weapon) || s.pellets || (ctx.f.weapon && s.weapon !== ctx.f.weapon)) { run = null; continue; }
        const t = num(s.time) ? s.time : (s.tick || 0) * (r.tickSeconds || 1 / 128);
        if (!run || s.weapon !== weapon || t - last >= BURST_GAP_S) { run = []; runs.push(run); weapon = s.weapon; }
        run.push(s);
        last = t;
      }
    }
    return runs;
  }
  // The same runs as arrays of hit flags.
  const fireRuns = (ctx) => fireRunShots(ctx).map((run) => run.map(isHit));
  const accOf = (flags) => rate(flags.filter(Boolean).length, flags.length);

  // 15. Burst discipline: accuracy of short bursts (the reference) against long runs of shots.
  function burstLength(ctx) {
    const runs = fireRuns(ctx), ref = runs.filter((r) => r.length >= BURST_REF[0] && r.length <= BURST_REF[1]), long = runs.filter((r) => r.length >= BURST_LONG);
    const refShots = ref.flat(), longShots = long.flat();
    if (ref.length < BURST_RUNS_MIN || long.length < BURST_RUNS_MIN || refShots.length < BURST_SHOTS_MIN || longShots.length < BURST_SHOTS_MIN) return [];
    const a = accOf(refShots), b = accOf(longShots), gap = Math.round((a - b) * 100);
    if (Math.abs(gap) < BURST_GAP_POINTS) return [];
    const worse = gap > 0, label = BURST_REF[0] + " to " + BURST_REF[1];
    return [{
      id: "burst-length", severity: worse ? "tip" : "info", sample: refShots.length + longShots.length,
      title: worse ? "Long bursts cost you accuracy" : "Long bursts work for you",
      detail: "Shots in bursts of " + label + " hit " + pct(a) + "% of the time (" + ref.length + " bursts), shots in runs of " + BURST_LONG + " or more hit " + pct(b) + "% (" + long.length + " runs)." + (worse ? " Stop after " + BURST_REF[1] + " shots, let your aim settle, then fire again." : " Keep doing what works, and still stop when your crosshair leaves the target."),
      evidence: { shortBursts: ref.length, shortAccuracyPercent: pct(a), longRuns: long.length, longAccuracyPercent: pct(b), gapPoints: gap, longRunMinShots: BURST_LONG },
    }];
  }

  // 16. Spray control: do the BULLETS stay on the target through a run, and how much did the mouse pull?
  // Why it is built this way: a controlled spray pulls the mouse DOWN to cancel the recoil, so the cursor can sit low on screen while every
  // bullet still lands on the target. A low cursor is therefore never a fault and the rule never looks at the cursor position alone. It asks:
  //  1. Bullet drift. For each run of SPRAY_FROM shots or more, where do the bullets go relative to the TARGET, shots 4 and later against the
  //     first 3? A controlled player's bullets stay near the same spot on the target, so the drift is about 0 however far the mouse moved. The
  //     recorder stores, for every shot with an enemy near the line (hit or miss), the offset of the bullet line from that enemy's centre in
  //     metres and the range (nearestEnemy.side right +, .vertical up +); atan2(offset, range) turns it into degrees. That is the hit point
  //     against the target centre. It also follows a moving target. Only shots near a target have it, so a bullet that flew far off the
  //     target has no offset and drops out: the rule can under-report a big drift, never invent one.
  //     If too few shots have it, a PROXY is used: the direction of the bullet in the world (aim + recoil kick) relative to where the first
  //     shot of the run was aimed. That is right when the target stands still, and the evidence says basis: "bullet-proxy".
  //  2. Mouse pull. The average change of aimPitchDeg over the run (shots 4 and later against the first 3, in the same way as the drift)
  //     is how far the aim was pulled down. The recoil kick is the change of pitchErrDeg (the bullet's angle from the aim, which the mouse does
  //     not change). The finding then says "you pulled X degrees down and the recoil took Y up; the pull cancelled it" or "...did not cancel it".
  // A finding is a warning (a "tip") only when the bullets drift AWAY from the target: the drift is at least SPRAY_DRIFT_DEG and the later
  // bullets are at least SPRAY_AWAY_DEG farther from the target than the first 3 (moving toward the target is not a fault). On-target bullets
  // with a pull of at least SPRAY_PULL_DEG give an "info" note saying the cursor position is not judged. Signs: yaw right +, pitch up +;
  // the mouse pull is positive DOWN in the evidence (pulledDownDeg) because that is what a player does.
  const hasRecoil = (s) => num(s.yawErrDeg) && num(s.pitchErrDeg) && num(s.aimYawDeg) && num(s.aimPitchDeg);
  const wrapDeg = (d) => { d %= 360; return d > 180 ? d - 360 : d < -180 ? d + 360 : d; };
  const DEG_PER_RAD = 180 / Math.PI;
  // The bullet against the target's centre in degrees, { yaw right +, pitch up + }, or null for a shot with no target near its line.
  const targetOffset = (s) => {
    const n = s.nearestEnemy;
    if (!n || !num(n.range) || !(n.range > 0) || !num(n.side) || !num(n.vertical)) return null;
    return { yaw: Math.atan2(n.side, n.range) * DEG_PER_RAD, pitch: Math.atan2(n.vertical, n.range) * DEG_PER_RAD };
  };
  const meanPoint = (pts) => ({ yaw: avg(pts.map((p) => p.yaw)), pitch: avg(pts.map((p) => p.pitch)) });
  function sprayRecoil(ctx) {
    const runs = fireRunShots(ctx).filter((r) => r.length >= SPRAY_FROM && r.every(hasRecoil));
    const kickE = [], kickL = [], pullE = [], pullL = [], projE = [], projL = [], tgtE = [], tgtL = [], perRunPull = [];
    let tgtRuns = 0;
    for (const run of runs) {
      const a0 = run[0], n = SPRAY_FROM - 1;
      let tE = 0, tL = 0;
      run.forEach((s, i) => {
        const early = i < n, aimYaw = -wrapDeg(s.aimYawDeg - a0.aimYawDeg), aimPitch = s.aimPitchDeg - a0.aimPitchDeg;
        (early ? kickE : kickL).push({ yaw: s.yawErrDeg, pitch: s.pitchErrDeg });
        (early ? pullE : pullL).push({ yaw: aimYaw, pitch: aimPitch });
        (early ? projE : projL).push({ yaw: s.yawErrDeg + aimYaw, pitch: s.pitchErrDeg + aimPitch }); // proxy: bullet direction against the first shot's aim
        const t = targetOffset(s);
        if (t) { (early ? tgtE : tgtL).push(t); if (early) tE++; else tL++; }
      });
      if (tE && tL) tgtRuns++;
      perRunPull.push(run[run.length - 1].aimPitchDeg - a0.aimPitchDeg);
    }
    if (runs.length < SPRAY_RUNS_MIN || kickE.length < SPRAY_SHOTS_MIN || kickL.length < SPRAY_SHOTS_MIN) return null; // not enough recoil data: fall back
    const useTarget = tgtRuns >= SPRAY_RUNS_MIN && tgtE.length >= SPRAY_SHOTS_MIN && tgtL.length >= SPRAY_SHOTS_MIN;
    const early = useTarget ? tgtE : projE, late = useTarget ? tgtL : projL;
    const mE = meanPoint(early), mL = meanPoint(late);
    const dYaw = mL.yaw - mE.yaw, dPitch = mL.pitch - mE.pitch, drift = Math.hypot(dYaw, dPitch);
    const away = Math.hypot(mL.yaw, mL.pitch) - Math.hypot(mE.yaw, mE.pitch); // > 0: the later bullets are farther from the target (or the start) than the first 3
    const kick = { yaw: meanPoint(kickL).yaw - meanPoint(kickE).yaw, pitch: meanPoint(kickL).pitch - meanPoint(kickE).pitch };
    const aimPitchChange = meanPoint(pullL).pitch - meanPoint(pullE).pitch, aimYawChange = meanPoint(pullL).yaw - meanPoint(pullE).yaw;
    const pulledDown = -aimPitchChange;
    const n = SPRAY_FROM - 1, deg = (v) => r2(Math.abs(v)), upDown = (v) => (v >= 0 ? "up" : "down"), leftRight = (v) => (v >= 0 ? "right" : "left");
    const basis = useTarget ? "target-offset" : "bullet-proxy";
    const basisLabel = useTarget ? "bullet offset from the target centre (hit point against the enemy centre)"
      : "PROXY: too few shots carry a target offset, so the bullet direction relative to the first shot's aim is used (right only for a target that stands still)";
    const reference = useTarget ? "the target" : "where the first shot was aimed";
    const evidence = {
      basis, basisLabel, runs: runs.length, earlyShots: early.length, lateShots: late.length, lateFromShot: SPRAY_FROM,
      bulletDriftPitchDeg: r2(dPitch), bulletDriftYawDeg: r2(dYaw), bulletDriftDeg: r2(drift), awayFromTargetDeg: r2(away),
      aimPitchChangeDeg: r2(aimPitchChange), pulledDownDeg: r2(pulledDown), meanRunPitchChangeDeg: r2(avg(perRunPull)),
      recoilKickPitchDeg: r2(kick.pitch), recoilKickYawDeg: r2(kick.yaw), aimYawChangeDeg: r2(aimYawChange),
      driftLimitDeg: SPRAY_DRIFT_DEG, awayLimitDeg: SPRAY_AWAY_DEG, cursorPositionJudged: false,
      convention: "yaw right positive, pitch up positive; pulledDownDeg positive = mouse pulled down",
    };
    const pullText = "You pulled the mouse " + deg(aimPitchChange) + " degrees " + upDown(aimPitchChange) + " while the recoil took the bullets " + deg(kick.pitch) + " degrees " + upDown(kick.pitch);
    if (drift >= SPRAY_DRIFT_DEG && away >= SPRAY_AWAY_DEG) {
      const vShare = Math.abs(dPitch) / (Math.abs(dPitch) + Math.abs(dYaw));
      const mostly = vShare >= SPRAY_AXIS_SHARE ? "vertical" : vShare <= 1 - SPRAY_AXIS_SHARE ? "horizontal" : "both";
      const title = mostly === "vertical" ? (dPitch > 0 ? "Your spray climbs off the target after " + n + " shots" : "You pull your spray too far down")
        : mostly === "horizontal" ? "Your spray drifts " + leftRight(dYaw) + " off the target after " + n + " shots" : "Your spray drifts off the target after " + n + " shots";
      const advice = mostly === "vertical" ? (dPitch > 0 ? " Pull the mouse down harder against the recoil, or stop after " + n + " shots and reset." : " Ease off the downward pull: you counter more recoil than there is.")
        : mostly === "horizontal" ? " The sideways part of the pattern is not being countered: nudge the mouse " + (dYaw > 0 ? "left" : "right") + " as you spray."
        : " Counter the pattern in both directions, or stop after " + n + " shots and reset.";
      const where = mostly === "both" ? "in both directions" : mostly === "vertical" ? upDown(dPitch) : leftRight(dYaw);
      return [{
        id: "spray-control", severity: "tip", sample: early.length + late.length, title,
        detail: pullText + "; the " + (mostly === "vertical" && dPitch < 0 ? "pull was more than it needed" : "pull did not cancel it") + ". From shot " + SPRAY_FROM + " of a burst on, your bullets land "
          + r2(drift) + " degrees from where the first " + n + " landed, mostly " + where + ", " + r2(away) + " degrees farther from " + reference + " (" + runs.length + " bursts)."
          + advice + " Where the cursor sits on screen is not the problem; where the bullets go is.",
        evidence: { ...evidence, mostly },
      }];
    }
    // The bullets stayed with the target (or moved toward it). Say so when the mouse did pull down: that is a controlled spray, however low the cursor ends up.
    if (pulledDown >= SPRAY_PULL_DEG) {
      return [{
        id: "spray-control", severity: "info", sample: early.length + late.length, title: "Your pull holds the spray on target",
        detail: pullText + "; the pull cancelled it: from shot " + SPRAY_FROM + " of a burst on, your bullets land only " + r2(drift) + " degrees from where the first " + n + " landed (" + runs.length
          + " bursts). A low cursor is fine while the bullets stay on the target, so the cursor position is not judged.",
        evidence: { ...evidence, mostly: null },
      }];
    }
    return [];
  }
  // The hit-rate version, kept as the fallback for rounds without the recoil fields: accuracy of the shots from number SPRAY_FROM of a run on, against the first shots before them.
  function sprayHitRate(ctx) {
    const runs = fireRuns(ctx).filter((r) => r.length >= SPRAY_FROM), early = [], late = [];
    for (const run of runs) { early.push(...run.slice(0, SPRAY_FROM - 1)); late.push(...run.slice(SPRAY_FROM - 1)); }
    if (runs.length < SPRAY_RUNS_MIN || early.length < SPRAY_SHOTS_MIN || late.length < SPRAY_SHOTS_MIN) return [];
    const a = accOf(early), b = accOf(late), drop = Math.round((a - b) * 100);
    if (drop < SPRAY_GAP_POINTS) return [];
    return [{
      id: "spray-control", severity: "tip", sample: early.length + late.length, title: "You lose control after " + (SPRAY_FROM - 1) + " shots",
      detail: "(Hit-rate estimate, the recoil fields are missing.) The first " + (SPRAY_FROM - 1) + " shots of a burst hit " + pct(a) + "% of the time, shot " + SPRAY_FROM + " and later only " + pct(b) + "% (" + runs.length + " bursts that long). Stop shooting after " + (SPRAY_FROM - 1) + " shots, or pull the mouse down against the recoil, and reset.",
      evidence: { basis: "hit-rate", basisLabel: "FALLBACK: the recoil fields are missing from too many shots (the bullet error and aim angles), so only the hit rate of shot " + SPRAY_FROM + " and later is compared; it cannot tell a controlled low-cursor spray from a lost one", fallback: true, runs: runs.length, earlyShots: early.length, earlyAccuracyPercent: pct(a), lateShots: late.length, lateAccuracyPercent: pct(b), dropPoints: drop, lateFromShot: SPRAY_FROM },
    }];
  }
  function sprayControl(ctx) {
    const recoil = sprayRecoil(ctx);
    return recoil !== null ? recoil : sprayHitRate(ctx);
  }

  // Shots with an enemy near the line (melee always left out, shotguns too when noPellets), as { s, hit }.
  function nearShots(ctx, noPellets) {
    const out = [];
    for (const r of ctx.rounds) for (const s of r.shots) {
      if (!s.nearestEnemy || !num(s.nearestEnemy.range) || !countable(s.weapon) || (ctx.f.weapon && s.weapon !== ctx.f.weapon) || (noPellets && s.pellets)) continue;
      out.push({ s, hit: isHit(s) });
    }
    return out;
  }
  const accuracy = (list) => rate(list.filter((x) => x.hit).length, list.length);
  // Accuracy of two groups of shots when both have at least min shots: { ra, rb, gap } (gap = rate a - rate b, in points), or null.
  function compare(a, b, min) {
    if (a.length < min || b.length < min) return null;
    return { ra: accuracy(a), rb: accuracy(b), gap: Math.round((accuracy(a) - accuracy(b)) * 100) };
  }

  // 17. Accuracy by enemy range: near, mid and far, with the weakest band called out.
  function accuracyRange(ctx) {
    const shots = nearShots(ctx, true), bands = { near: [], mid: [], far: [] };
    for (const x of shots) { const d = x.s.nearestEnemy.range; bands[d < RANGE_NEAR_M ? "near" : d > RANGE_FAR_M ? "far" : "mid"].push(x); }
    const list = Object.keys(bands).filter((k) => bands[k].length >= RANGE_SHOTS_MIN).map((k) => ({ band: k, shots: bands[k].length, rate: accuracy(bands[k]) })).sort((a, b) => b.rate - a.rate);
    if (list.length < 2) return [];
    const top = list[0], low = list[list.length - 1], gap = Math.round((top.rate - low.rate) * 100);
    if (gap < RANGE_GAP_POINTS) return [];
    const name = { near: "close range (under " + RANGE_NEAR_M + " m)", mid: "medium range (" + RANGE_NEAR_M + " to " + RANGE_FAR_M + " m)", far: "long range (over " + RANGE_FAR_M + " m)" };
    const advice = {
      near: "At close range move less and get the crosshair on the head quickly; do not over-correct small errors.",
      mid: "At medium range stop for the shot and put the crosshair on the head before you fire.",
      far: "At long range stop completely, fire single shots and let the crosshair settle between them.",
    }[low.band];
    return [{
      id: "accuracy-range", severity: "tip", sample: shots.length, title: "Your weakest range is " + low.band,
      detail: "Of the shots you aimed at an enemy, you hit " + pct(low.rate) + "% at " + name[low.band] + " (" + low.shots + " shots) against " + pct(top.rate) + "% at " + name[top.band] + " (" + top.shots + " shots). " + advice,
      evidence: { weakest: low.band, weakestAccuracyPercent: pct(low.rate), weakestShots: low.shots, best: top.band, bestAccuracyPercent: pct(top.rate), bestShots: top.shots, gapPoints: gap, nearBelowMetres: RANGE_NEAR_M, farAboveMetres: RANGE_FAR_M },
    }];
  }

  // 18. Left versus right: do your misses pass to one side of the enemy?
  function missSideways(ctx) {
    const misses = nearShots(ctx, true).filter((x) => !x.hit && num(x.s.nearestEnemy.side));
    const left = misses.filter((x) => x.s.nearestEnemy.side < -SIDE_BAND_M), right = misses.filter((x) => x.s.nearestEnemy.side > SIDE_BAND_M), total = left.length + right.length;
    if (total < SIDE_MIN) return [];
    const isLeft = left.length >= right.length, list = isLeft ? left : right, share = list.length / total;
    if (share < SIDE_SHARE) return [];
    const cm = Math.round(avg(list.map((x) => Math.abs(x.s.nearestEnemy.side))) * 100), side = isLeft ? "left" : "right";
    return [{
      id: "miss-side-sideways", severity: "tip", sample: total, title: "You miss to the " + side,
      detail: pct(share) + "% of the shots that missed an enemy (" + list.length + " of " + total + ") passed to its " + side + ", on average " + cm + " cm from the middle of its body. Your crosshair tends to stop or drift " + side + " of the target: aim a little to the " + (isLeft ? "right" : "left") + " of where you want to hit, and check that you stop the mouse on the target instead of swinging past it.",
      evidence: { misses: total, left: left.length, right: right.length, sharePercent: pct(share), averageOffsetCm: cm, side },
    }];
  }

  // 19. Counter-strafe: shots fired while still against while moving (on the ground).
  function counterStrafe(ctx) {
    const shots = nearShots(ctx, false).filter((x) => x.s.movement && num(x.s.movement.speed) && !x.s.movement.airborne);
    const still = shots.filter((x) => x.s.movement.speed < STILL_MPS), moving = shots.filter((x) => x.s.movement.speed >= STILL_MPS);
    const c = compare(still, moving, MOVE_SHOTS_MIN);
    if (!c || c.gap < MOVE_GAP_POINTS) return [];
    return [{
      id: "counter-strafe", severity: "tip", sample: shots.length, title: "You shoot while moving, and it costs you",
      detail: "Of the shots you aimed at an enemy, you hit " + pct(c.ra) + "% while standing still (" + still.length + " shots) but only " + pct(c.rb) + "% while moving (" + moving.length + " shots, " + pct(moving.length / shots.length) + "% of the total). Stop before you fire: tap the opposite movement key to stop at once (a counter-strafe), then shoot.",
      evidence: { stillShots: still.length, stillAccuracyPercent: pct(c.ra), movingShots: moving.length, movingAccuracyPercent: pct(c.rb), movingSharePercent: pct(moving.length / shots.length), gapPoints: c.gap, stillBelowMetresPerSecond: STILL_MPS },
    }];
  }

  // 20. Walk discipline: while moving on the ground, shots with the walk key held against without it.
  function walkAccuracy(ctx) {
    const shots = nearShots(ctx, false).filter((x) => x.s.movement && num(x.s.movement.speed) && x.s.movement.speed >= STILL_MPS && !x.s.movement.airborne);
    const walk = shots.filter((x) => x.s.movement.walk), run = shots.filter((x) => !x.s.movement.walk);
    const c = compare(walk, run, MOVE_SHOTS_MIN);
    if (!c || Math.abs(c.gap) < MOVE_GAP_POINTS) return [];
    const better = c.gap > 0;
    return [{
      id: "walk-accuracy", severity: better ? "tip" : "info", sample: walk.length + run.length, title: better ? "Walking is more accurate than running for you" : "Walking does not help your accuracy",
      detail: "When you were moving, you hit " + pct(c.ra) + "% of your shots with the walk key held (" + walk.length + " shots) and " + pct(c.rb) + "% without it (" + run.length + " shots)." + (better ? " Hold the walk key when you need to shoot on the move or when you peek, and release it only to run." : " Do not slow down to walk just for accuracy; stop for the shot instead."),
      evidence: { walkShots: walk.length, walkAccuracyPercent: pct(c.ra), runShots: run.length, runAccuracyPercent: pct(c.rb), gapPoints: c.gap },
    }];
  }

  // 21. Crouch discipline: crouched against standing shots (on the ground).
  function crouchAccuracy(ctx) {
    const level = (x) => (num(x.s.crouchAmount) ? x.s.crouchAmount : x.s.movement ? (x.s.movement.crouch ? 1 : 0) : null);
    const shots = nearShots(ctx, false).filter((x) => level(x) !== null && !(x.s.movement && x.s.movement.airborne));
    const crouched = shots.filter((x) => level(x) >= CROUCH_ON), standing = shots.filter((x) => level(x) <= CROUCH_OFF);
    const c = compare(crouched, standing, POSTURE_SHOTS_MIN);
    if (!c || Math.abs(c.gap) < POSTURE_GAP_POINTS) return [];
    const better = c.gap > 0;
    return [{
      id: "crouch-accuracy", severity: better ? "tip" : "info", sample: crouched.length + standing.length, title: better ? "You shoot better crouched" : "Crouching does not help your accuracy",
      detail: "You hit " + pct(c.ra) + "% of your shots while crouched (" + crouched.length + " shots) and " + pct(c.rb) + "% standing (" + standing.length + " shots)." + (better ? " When you hold an angle at range, crouch before the enemy appears." : " Stay standing in fights: crouching does not make you hit more."),
      evidence: { crouchedShots: crouched.length, crouchedAccuracyPercent: pct(c.ra), standingShots: standing.length, standingAccuracyPercent: pct(c.rb), gapPoints: c.gap },
    }];
  }

  // 22. Sensitivity: a change against your recent rounds, a very high or very low value (guesses), and mouse acceleration.
  function sensitivity(ctx) {
    const recent = ctx.rounds.filter((r) => r.input && num(r.input.sensitivity)).slice(-SENS_RECENT_ROUNDS);
    const same = (a, b) => Math.abs(a - b) <= SENS_SAME * Math.max(Math.abs(b), 1e-9);
    const mode = (list) => { const groups = []; for (const v of list) { const g = groups.find((x) => same(x.v, v)); if (g) g.n++; else groups.push({ v, n: 1 }); } return groups.sort((a, b) => b.n - a.n)[0] || null; };
    const out = [];
    if (recent.length > SENS_ROUNDS_MIN) {
      const now = recent[recent.length - 1].input, before = recent.slice(0, -1), usual = mode(before.map((r) => r.input.sensitivity));
      const usualAds = mode(before.filter((r) => num(r.input.adsMultiplier)).map((r) => r.input.adsMultiplier));
      const sensChanged = !same(now.sensitivity, usual.v), adsChanged = num(now.adsMultiplier) && !!usualAds && !same(now.adsMultiplier, usualAds.v);
      if (sensChanged || adsChanged) {
        const parts = [];
        if (sensChanged) parts.push("sensitivity " + r2(now.sensitivity) + " (it was " + r2(usual.v) + " in " + usual.n + " of your " + before.length + " earlier rounds)");
        if (adsChanged) parts.push("ADS sensitivity " + r2(now.adsMultiplier) + " (it was " + r2(usualAds.v) + " in " + usualAds.n + " earlier rounds)");
        out.push({
          id: "sens-changed", severity: "info", sample: recent.length, title: sensChanged ? "You changed your sensitivity" : "You changed your ADS sensitivity",
          detail: "Your last round used " + parts.join(" and ") + ". Accuracy numbers from before the change are not directly comparable, so give the new setting a few dozen rounds before judging it, and change one setting at a time.",
          evidence: { sensitivity: now.sensitivity, usualSensitivity: usual.v, adsMultiplier: num(now.adsMultiplier) ? now.adsMultiplier : null, usualAdsMultiplier: usualAds ? usualAds.v : null, earlierRounds: before.length },
        });
      }
    }
    if (recent.length >= SENS_ROUNDS_MIN) {
      const med = median(recent.map((r) => r.input.sensitivity));
      if (med > SENS_HIGH || med < SENS_LOW) {
        const high = med > SENS_HIGH;
        out.push({
          id: "sens-extreme", severity: "tip", sample: recent.length, title: high ? "Your sensitivity is very high" : "Your sensitivity is very low",
          detail: "Your sensitivity over the last " + recent.length + " rounds is " + r2(med) + " (the game's default is 0.5). " + (high ? "That is higher than most players use: if your crosshair overshoots targets or small corrections are hard, try about a quarter lower for a week." : "That is lower than most players use: if you run out of mouse pad on big turns or your flicks are slow, try about a quarter higher for a week.") + " This is a rough guess, because the game does not know your mouse DPI, so only you can tell how far one turn really is.",
          evidence: { medianSensitivity: med, rounds: recent.length, lowBelow: SENS_LOW, highAbove: SENS_HIGH, side: high ? "high" : "low" },
        });
      }
      const accel = recent.filter((r) => r.input.accelerationNotice).length;
      if (accel / recent.length >= ACCEL_SHARE) {
        out.push({
          id: "mouse-accel", severity: "tip", sample: recent.length, title: "Your mouse may be accelerated",
          detail: "The game showed its mouse acceleration notice in " + accel + " of your last " + recent.length + " rounds. With acceleration the same hand movement turns the crosshair by a different amount depending on how fast you move, which spoils muscle memory. Turn off \"Enhance pointer precision\" in the Windows mouse settings.",
          evidence: { roundsWithNotice: accel, rounds: recent.length, sharePercent: pct(accel / recent.length) },
        });
      }
    }
    return out;
  }

  // 23. Consistency: how much your accuracy swings from round to round on the same drill.
  function consistency(ctx) {
    const groups = new Map();
    for (const r of ctx.rounds) {
      const shots = r.shots.filter((s) => !ctx.f.weapon || s.weapon === ctx.f.weapon);
      if (shots.length < ROUND_SHOTS_MIN) continue;
      const key = String(r.code ?? r.map ?? "?");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(shots.filter(isHit).length / shots.length);
    }
    let sum = 0, n = 0, drills = 0;
    for (const list of groups.values()) {
      if (list.length < DRILL_ROUNDS_MIN) continue;
      const m = avg(list);
      for (const a of list) sum += (a - m) * (a - m);
      n += list.length; drills++;
    }
    if (n < CONSIST_MIN || n - drills < 1) return [];
    const sd = Math.sqrt(sum / (n - drills)), points = Math.round(sd * 100);
    const steady = sd <= STEADY_SD, streaky = sd >= STREAKY_SD;
    if (!steady && !streaky) return [];
    return [{
      id: "consistency", severity: streaky ? "tip" : "info", sample: n, title: streaky ? "Your aim is streaky" : "Your aim is steady",
      detail: "Your accuracy on the same drill moves up or down by about " + points + " points from round to round (" + n + " rounds). " + (streaky ? "Good rounds are followed by bad ones: take a short break after a bad round, and keep the same grip and sensitivity." : "That is a steady aim: you can trust the numbers to track real progress."),
      evidence: { rounds: n, drills, spreadPoints: points, result: streaky ? "streaky" : "steady" },
    }];
  }

  // 24. Trend: the last 7 days against the 7 days before, accuracy and headshot rate.
  async function trend(ctx) {
    const f = ctx.f, recentFrom = dayBack(6), prevFrom = dayBack(13), prevTo = dayBack(7);
    const recent = { shots: 0, hits: 0, heads: 0 }, prev = { shots: 0, hits: 0, heads: 0 };
    const put = (t, shots, hits, heads) => { t.shots += shots || 0; t.hits += hits || 0; t.heads += heads || 0; };
    const place = (day) => (day >= recentFrom ? recent : day >= prevFrom && day <= prevTo ? prev : null);
    if (f.code || (f.map && f.weapon)) {
      for (const r of await ctx.allRounds()) {
        const t = place(r.day);
        if (!t || (f.map && r.map !== f.map)) continue;
        for (const s of r.shots) if (!f.weapon || s.weapon === f.weapon) put(t, 1, isHit(s) ? 1 : 0, isHead(s) ? 1 : 0);
      }
    } else {
      for (const row of await ctx.days({ map: f.map, weapon: f.weapon, from: prevFrom })) {
        const t = place(row.day), c = f.weapon ? row.weapons && row.weapons[f.weapon] : f.map ? row.maps && row.maps[f.map] : row;
        if (t && c) put(t, c.shots, c.hits, c.headshots);
      }
    }
    const out = [];
    const make = (id, name, top, bottom, need, advice, dropSeverity) => {
      const a = prev, b = recent;
      if (a[bottom] < need || b[bottom] < need) return;
      const before = rate(a[top], a[bottom]), now = rate(b[top], b[bottom]), change = Math.round((now - before) * 100);
      const v = change >= TREND_FLAT_POINTS ? "improving" : change <= -TREND_FLAT_POINTS ? "dropping" : "flat";
      out.push({
        id, severity: v === "dropping" ? dropSeverity : "info", sample: a[bottom] + b[bottom], title: "Your " + name + (v === "flat" ? " is holding steady" : " is " + v),
        detail: "Your " + name + " was " + pct(now) + "% in the last 7 days and " + pct(before) + "% in the 7 days before" + (v === "flat" ? ": no real change." : ", " + (v === "improving" ? "up " : "down ") + Math.abs(change) + " points.") + (v === "dropping" ? " " + advice : ""),
        evidence: { recentPercent: pct(now), previousPercent: pct(before), changePoints: change, recentCount: b[bottom], previousCount: a[bottom], trend: v },
      });
    };
    make("trend-accuracy", "accuracy", "hits", "shots", TREND_SHOTS_MIN, "Play a short warm-up before you start and slow down until your hits come back.", "tip");
    make("trend-headshots", "headshot rate", "heads", "hits", TREND_HITS_MIN, "Aim for head height before you fire instead of chasing the body.", "warn");
    return out;
  }

  // 25. Tracking (18 Nov 2026): on-target share, lag and lock time on moving enemies, from the engagements' tracking entries.
  const TRACK_ENG_MIN = 8;         // engagements with tracking data before the rule says anything
  const TRACK_SAMPLES_MIN = 32;    // sampled ticks (about a quarter of a second) for an engagement to count
  const TRACK_BODY_LOW = 0.5;      // below this share of sampled ticks on the body: "you lose moving enemies"
  const TRACK_LAG_DEG = 1.5;       // mean lag (or lead, negative) of at least this many degrees along the enemy's path
  const TRACK_LOCK_SLOW_S = 0.5;   // a median time to lock on the body at or above this is slow
  const TRACK_LOCK_MIN = 6;        // engagements that locked before the lock time is judged
  function tracking(ctx) {
    const rows = [];
    for (const r of sightRounds(ctx)) for (const e of r.engagements) {
      const t = e && e.tracking;
      if (t && num(t.samples) && t.samples >= TRACK_SAMPLES_MIN && (!ctx.f.weapon || e.weapon === ctx.f.weapon)) rows.push(t);
    }
    if (rows.length < TRACK_ENG_MIN) return [];
    const sum = (k) => rows.reduce((s, t) => s + (num(t[k]) ? t[k] : 0), 0), samples = sum("samples");
    const bodyShare = sum("bodyOn") / samples, headShare = sum("headOn") / samples, lag = sum("lagSum") / samples, err = sum("bodyErrorSum") / samples;
    const out = [], base = { engagements: rows.length, seconds: r1(rows.reduce((s, t) => s + (num(t.seconds) ? t.seconds : 0), 0)), bodyOnPercent: pct(bodyShare), headOnPercent: pct(headShare), averageErrorDegrees: r1(err), lagDegrees: r1(lag) };
    const behind = lag >= TRACK_LAG_DEG, ahead = lag <= -TRACK_LAG_DEG, loses = bodyShare < TRACK_BODY_LOW;
    const common = "Over " + rows.length + " fights your crosshair was on the enemy's body " + pct(bodyShare) + "% of the time it was moving (on the head " + pct(headShare) + "%), " + r1(err) + " degrees off on average. ";
    if (behind || ahead || loses) {
      const title = behind ? "Your crosshair trails moving enemies" : ahead ? "You overshoot moving enemies" : "You lose moving enemies";
      const advice = behind ? "Aim a little in front of where the enemy is going and move the mouse with it, not after it (you are " + r1(Math.abs(lag)) + " degrees behind on average)."
        : ahead ? "You get ahead of the enemy (" + r1(Math.abs(lag)) + " degrees on average): match its speed and let it come to the crosshair instead of leading it too far."
        : "Follow the enemy with smooth, steady mouse movement and keep the crosshair on the body before you try for the head.";
      out.push({ id: "tracking", severity: "tip", sample: rows.length, title, detail: common + advice, evidence: { ...base, direction: behind ? "behind" : ahead ? "ahead" : "off" } });
    } else {
      out.push({ id: "tracking", severity: "info", sample: rows.length, title: "You track moving enemies well", detail: common + "Your crosshair is neither trailing nor leading the enemy. Keep the body locked, then try holding the head.", evidence: { ...base, direction: "level" } });
    }
    const locks = rows.map((t) => t.lockBodySeconds).filter(num);
    if (locks.length >= TRACK_LOCK_MIN && median(locks) >= TRACK_LOCK_SLOW_S) {
      out.push({ id: "tracking-lock", severity: "tip", sample: locks.length, title: "You take a while to lock on",
        detail: "From an enemy coming into view to your crosshair staying on its body took " + r2(median(locks)) + " seconds in the typical fight (" + locks.length + " fights"
          + (locks.length < rows.length ? ", " + (rows.length - locks.length) + " more never locked" : "") + "). Pre-aim where enemies appear and make one decisive move onto the body instead of several small corrections.",
        evidence: { fights: locks.length, medianLockSeconds: r2(median(locks)), neverLocked: rows.length - locks.length } });
    }
    return out;
  }

  // 26. Session shape (20 Nov 2026): do the first rounds of a session go worse than the middle (a slow start), or the last ones (fading)?
  // A session = rounds that start less than SESSION_GAP_MS after the previous one ended. Only sessions of SHAPE_ROUNDS_MIN rounds or more count,
  // and at least SHAPE_SESSIONS_MIN of them; the first WARM_ROUNDS rounds, the last FADE_ROUNDS and the rounds between are each pooled.
  // A group needs SHAPE_SHOTS_MIN shots, and the gap to the middle must be SHAPE_GAP_POINTS or more.
  function roundEndMs(r) {
    const dt = num(r.tickSeconds) && r.tickSeconds > 0 ? r.tickSeconds : 1 / 128;
    let m = 0;
    for (const s of r.shots) if (num(s.tick)) m = Math.max(m, s.tick);
    for (const d of r.deaths) if (num(d.tick)) m = Math.max(m, d.tick);
    return r.at + Math.min(3600, m * dt) * 1000;
  }
  // The pooled accuracy of the first, middle and last rounds of the long sessions of a list of expanded rounds, or null when there are not enough of them.
  function shapeOf(rounds, weapon) {
    const list = rounds.filter((r) => num(r.at)).sort((a, b) => a.at - b.at), groups = [];
    for (const r of list) {
      const g = groups[groups.length - 1];
      if (g && r.at - g.end < SESSION_GAP_MS) { g.rounds.push(r); g.end = Math.max(g.end, roundEndMs(r)); } else groups.push({ rounds: [r], end: roundEndMs(r) });
    }
    const sessions = groups.filter((g) => g.rounds.length >= SHAPE_ROUNDS_MIN);
    if (sessions.length < SHAPE_SESSIONS_MIN) return null;
    const early = { shots: 0, hits: 0 }, mid = { shots: 0, hits: 0 }, late = { shots: 0, hits: 0 };
    for (const g of sessions) g.rounds.forEach((r, i) => {
      const shots = r.shots.filter((s) => !weapon || s.weapon === weapon), t = i < WARM_ROUNDS ? early : i >= g.rounds.length - FADE_ROUNDS ? late : mid;
      t.shots += shots.length; t.hits += shots.filter(isHit).length;
    });
    if (early.shots < SHAPE_SHOTS_MIN || mid.shots < SHAPE_SHOTS_MIN || late.shots < SHAPE_SHOTS_MIN) return null;
    return { sessions: sessions.length, early, mid, late, eA: rate(early.hits, early.shots), mA: rate(mid.hits, mid.shots), lA: rate(late.hits, late.shots) };
  }
  // A warm-up to play before the drills you want to score on (21 Nov 2026), from the "warmup" rule's numbers and your most played drills.
  // { cold: the first rounds of your sessions are SHAPE_GAP_POINTS or more below the rest, gapPoints, firstAccuracyPercent, middleAccuracyPercent, sessions (null without enough sessions),
  //   steps: [{ code, runs, rounds, accuracyPercent }] (at most WARMUP_STEPS drills; the ones you hit the most with come first), reason: "" | "few-rounds" }
  // A drill is a candidate with WARMUP_DRILL_ROUNDS_MIN or more rounds, WARMUP_SHOTS_MIN shots, and fewer than WARMUP_DIED_SHARE of them ending in a death (a drill that kills you is no warm-up).
  // Of the WARMUP_POOL most played candidates, the ones with the highest accuracy are taken and played in that order. The first step is played twice (the rule's WARM_ROUNDS), the others once.
  function warmupPlan(rounds, opts = {}) {
    const list = (Array.isArray(rounds) ? rounds : []).filter((r) => r && num(r.at) && Array.isArray(r.shots));
    const sh = shapeOf(list.map((r) => ({ ...r, deaths: Array.isArray(r.deaths) ? r.deaths : [] })), opts.weapon || "");
    const gap = sh ? Math.round((sh.mA - sh.eA) * 100) : null;
    const by = new Map();
    for (const r of list) {
      if (r.code == null) continue;
      const k = String(r.code);
      if (!by.has(k)) by.set(k, { code: k, rounds: 0, shots: 0, hits: 0, died: 0 });
      const d = by.get(k);
      d.rounds++; d.shots += r.shots.length; d.hits += r.shots.filter(isHit).length; if (r.end === "died") d.died++;
    }
    const pool = [...by.values()].filter((d) => d.rounds >= WARMUP_DRILL_ROUNDS_MIN && d.shots >= WARMUP_SHOTS_MIN && d.died / d.rounds < WARMUP_DIED_SHARE)
      .sort((a, b) => b.rounds - a.rounds || (a.code < b.code ? -1 : 1)).slice(0, WARMUP_POOL);
    const steps = pool.sort((a, b) => rate(b.hits, b.shots) - rate(a.hits, a.shots) || b.rounds - a.rounds).slice(0, WARMUP_STEPS)
      .map((d, i) => ({ code: d.code, runs: i === 0 ? WARM_ROUNDS : 1, rounds: d.rounds, accuracyPercent: pct(rate(d.hits, d.shots)) }));
    return { cold: gap !== null && gap >= SHAPE_GAP_POINTS, gapPoints: gap, firstAccuracyPercent: sh ? pct(sh.eA) : null, middleAccuracyPercent: sh ? pct(sh.mA) : null, sessions: sh ? sh.sessions : null,
      steps: steps.length >= 2 ? steps : [], reason: steps.length >= 2 ? "" : "few-rounds" };
  }
  function sessionShape(ctx) {
    const sh = shapeOf(ctx.rounds, ctx.f.weapon);
    if (!sh) return [];
    const { sessions, early, mid, late, eA, mA, lA } = sh;
    const base = { sessions, firstRounds: WARM_ROUNDS, lastRounds: FADE_ROUNDS, middleAccuracyPercent: pct(mA) };
    const out = [], warmGap = Math.round((mA - eA) * 100), fadeGap = Math.round((mA - lA) * 100);
    if (warmGap >= SHAPE_GAP_POINTS) out.push({
      id: "warmup", severity: "tip", sample: early.shots + mid.shots, title: "You start sessions cold",
      detail: "Across " + sessions + " sessions, the first " + WARM_ROUNDS + " rounds hit " + pct(eA) + "% of your shots and the rounds after them " + pct(mA) + "%. Play one or two easy drills before the ones you want to score on, so the early rounds are not the ones that count.",
      evidence: { ...base, firstRoundsAccuracyPercent: pct(eA), gapPoints: warmGap },
    });
    if (fadeGap >= SHAPE_GAP_POINTS) out.push({
      id: "fade", severity: "tip", sample: late.shots + mid.shots, title: "Your aim fades late in a session",
      detail: "Across " + sessions + " sessions, the last " + FADE_ROUNDS + " rounds hit " + pct(lA) + "% of your shots against " + pct(mA) + "% in the rounds before them. Take a short break, or stop, when your accuracy has fallen for a few rounds in a row.",
      evidence: { ...base, lastRoundsAccuracyPercent: pct(lA), gapPoints: fadeGap },
    });
    return out;
  }

  // ---- short summaries (17 Nov 2026): the one line a collapsed coach card shows under the title ----
  // One builder per rule id (the part before ":"), from the evidence the rule above already gives. The line states the key
  // number in a few words and never repeats the title; the full sentence stays in detail. A builder that has no number to show
  // gives "" (the card then shows the title alone). Every id insights() or roundTip() can return must have a builder here.
  const has = (...v) => v.every(num);
  const cmOf = (m) => Math.round(Math.abs(m) * 100);
  const SUMMARY = {
    "miss-side": (e) => (has(e.sharePercent) ? e.sharePercent + "% " + (e.side || "off") + (has(e.averageOffsetCm) ? ", " + e.averageOffsetCm + " cm" : "") : ""),
    "kill-style": (e) => (has(e.sharePercent) ? e.sharePercent + "% " + ({ flick: "flicks", strafe: "strafe kills", mixed: "mixed kills" }[e.dominant] || "of kills") : ""),
    "pre-aim-low": (e) => (has(e.farBelowPercent) ? e.farBelowPercent + "% start far below the head" : ""),
    "pre-aim": (e) => (has(e.averagePitchErrorDegrees) ? Math.abs(e.averagePitchErrorDegrees) + "° " + (e.side === "above" ? "above" : "below") + " the head" : ""),
    "kill-time": (e) => (has(e.medianSeconds) ? e.medianSeconds + " s median" + (has(e.kills) ? ", " + e.kills + " kills" : "") : ""),
    "kill-time-trend": (e) => (has(e.previousSeconds, e.recentSeconds) ? e.previousSeconds + " s → " + e.recentSeconds + " s" : ""),
    "death-zone": (e) => (has(e.deathsInCell, e.deathsOnMap) ? e.deathsInCell + " of " + e.deathsOnMap + " deaths in one spot" : ""),
    "deaths-cause": (e) => (has(e.fallPercent) ? e.fallPercent + "% of deaths were falls" : ""),
    "deaths-unanswered": (e) => (has(e.sharePercent) ? e.sharePercent + "% with no shot back" : ""),
    "multi-enemy": (e) => (has(e.deathPercent) ? e.deathPercent + "% of deaths vs 2+ enemies" : has(e.killPercent) ? e.killPercent + "% of kills vs 2+ enemies" : ""),
    "fights-lost": (e) => (has(e.lostPercent) ? e.lostPercent + "% lost" + (has(e.fightsLost, e.fights) ? " (" + e.fightsLost + " of " + e.fights + ")" : "") : ""),
    "fight-spot": (e) => (has(e.lostPercent, e.restLostPercent) ? e.lostPercent + "% lost here, " + e.restLostPercent + "% elsewhere" : ""),
    "angle-lose": (e) => (has(e.lostPercent) ? e.lostPercent + "% lost" + (has(e.fights) ? " of " + e.fights + " fights" : "") : ""),
    "angle-win": (e) => (has(e.winPercent) ? e.winPercent + "% won" + (has(e.fights) ? " of " + e.fights + " fights" : "") : ""),
    "hold-sooner": (e) => (has(e.lostAverageSeconds, e.wonAverageSeconds) ? e.lostAverageSeconds + " s held when lost, " + e.wonAverageSeconds + " s when won" : ""),
    "clear-deaths": (e) => (has(e.uncheckedPercent) ? e.uncheckedPercent + "% from angles you never checked" : ""),
    "over-checked": (e) => (has(e.roundsLookedAt) ? "Checked in " + e.roundsLookedAt + " rounds, 0 enemies" : ""),
    "wasted-swings": (e) => (has(e.wastedShots, e.shots) && e.wastedShots > 0 ? "1 in " + Math.round(e.shots / e.wastedShots) + " shots hits nothing"
      : has(e.wastedPercent) && e.wastedPercent > 0 ? "1 in " + Math.round(100 / e.wastedPercent) + " shots hits nothing" : ""),
    "headshot-weapon": (e) => (has(e.bestHeadshotPercent, e.worstHeadshotPercent) ? e.bestHeadshotPercent + "% vs " + e.worstHeadshotPercent + "% headshots" : ""),
    "accuracy-weapon": (e) => (has(e.worstAccuracyPercent, e.bestAccuracyPercent) ? e.worstAccuracyPercent + "% vs " + e.bestAccuracyPercent + "% accuracy" : ""),
    "strafe-map": (e) => (has(e.strafePercent, e.otherStrafePercent) ? e.strafePercent + "% vs " + e.otherStrafePercent + "% strafe kills" : ""),
    "strafe-drill": (e) => (has(e.strafePercent, e.otherStrafePercent) ? e.strafePercent + "% vs " + e.otherStrafePercent + "% strafe kills" : ""),
    "burst-length": (e) => (has(e.longAccuracyPercent, e.shortAccuracyPercent) ? e.longAccuracyPercent + "% long vs " + e.shortAccuracyPercent + "% short" : ""),
    "spray-control": (e) => (e.basis === "hit-rate" ? (has(e.earlyAccuracyPercent, e.lateAccuracyPercent) ? e.earlyAccuracyPercent + "% → " + e.lateAccuracyPercent + "% hits" : "")
      : has(e.bulletDriftDeg) ? e.bulletDriftDeg + "° drift" + (has(e.lateFromShot) ? " from shot " + e.lateFromShot : "") : ""),
    "accuracy-range": (e) => (has(e.weakestAccuracyPercent, e.bestAccuracyPercent) ? e.weakestAccuracyPercent + "% vs " + e.bestAccuracyPercent + "% at best range" : ""),
    "miss-side-sideways": (e) => (has(e.sharePercent) ? e.sharePercent + "% " + (e.side || "off") + (has(e.averageOffsetCm) ? ", " + e.averageOffsetCm + " cm" : "") : ""),
    "counter-strafe": (e) => (has(e.movingAccuracyPercent, e.stillAccuracyPercent) ? e.movingAccuracyPercent + "% moving vs " + e.stillAccuracyPercent + "% still" : ""),
    "walk-accuracy": (e) => (has(e.walkAccuracyPercent, e.runAccuracyPercent) ? e.walkAccuracyPercent + "% walking vs " + e.runAccuracyPercent + "% running" : ""),
    "crouch-accuracy": (e) => (has(e.crouchedAccuracyPercent, e.standingAccuracyPercent) ? e.crouchedAccuracyPercent + "% crouched vs " + e.standingAccuracyPercent + "% standing" : ""),
    "sens-changed": (e) => (has(e.sensitivity, e.usualSensitivity) && r2(e.sensitivity) !== r2(e.usualSensitivity) ? r2(e.usualSensitivity) + " → " + r2(e.sensitivity)
      : has(e.adsMultiplier, e.usualAdsMultiplier) ? "ADS " + r2(e.usualAdsMultiplier) + " → " + r2(e.adsMultiplier) : ""),
    "sens-extreme": (e) => (has(e.medianSensitivity) ? "Median " + r2(e.medianSensitivity) : ""),
    "mouse-accel": (e) => (has(e.sharePercent) ? e.sharePercent + "% of rounds flagged" : ""),
    "tracking": (e) => (has(e.bodyOnPercent) ? e.bodyOnPercent + "% on body" + (has(e.lagDegrees) && Math.abs(e.lagDegrees) >= 0.1 ? ", " + Math.abs(e.lagDegrees) + "° " + (e.lagDegrees > 0 ? "behind" : "ahead") : "") : ""),
    "tracking-lock": (e) => (has(e.medianLockSeconds) ? e.medianLockSeconds + " s to lock on" : ""),
    "warmup": (e) => (has(e.firstRoundsAccuracyPercent, e.middleAccuracyPercent) ? e.firstRoundsAccuracyPercent + "% first rounds vs " + e.middleAccuracyPercent + "% after" : ""),
    "fade": (e) => (has(e.lastRoundsAccuracyPercent, e.middleAccuracyPercent) ? e.lastRoundsAccuracyPercent + "% last rounds vs " + e.middleAccuracyPercent + "% before" : ""),
    "consistency": (e) => (has(e.spreadPoints) ? "±" + e.spreadPoints + " points a round" : ""),
    "trend-accuracy": (e) => (has(e.previousPercent, e.recentPercent) ? e.previousPercent + "% → " + e.recentPercent + "%" : ""),
    "trend-headshots": (e) => (has(e.previousPercent, e.recentPercent) ? e.previousPercent + "% → " + e.recentPercent + "%" : ""),
    "round-tip-accuracy": (e) => (has(e.thisRound, e.baselineMean) ? pct(e.thisRound) + "% vs " + pct(e.baselineMean) + "% usual" : ""),
    "round-tip-headshot": (e) => (has(e.thisRound, e.baselineMean) ? pct(e.thisRound) + "% vs " + pct(e.baselineMean) + "% usual" : ""),
    "round-tip-side": (e) => (has(e.thisRound, e.baselineMean) ? cmOf(e.thisRound) + " cm " + (e.thisRound < 0 ? "left" : "right") + " vs " + cmOf(e.baselineMean) + " cm usual" : ""),
    "round-tip-vertical": (e) => (has(e.thisRound, e.baselineMean) ? cmOf(e.thisRound) + " cm " + (e.thisRound < 0 ? "low" : "high") + " vs " + cmOf(e.baselineMean) + " cm usual" : ""),
  };
  // The short line of a finding: its rule's builder, "" when there is none or it would only repeat the title.
  function summaryOf(f) {
    try {
      const build = f && SUMMARY[String(f.id || "").split(":")[0]];
      const line = build ? String(build(f.evidence && typeof f.evidence === "object" ? f.evidence : {}) || "") : "";
      return line && line.trim().toLowerCase() !== String(f.title || "").trim().toLowerCase() ? line : "";
    } catch { return ""; }
  }
  const withSummary = (f) => (f && typeof f === "object" ? Object.assign(f, { summary: summaryOf(f) }) : f);

  // ---- round tip: one tip about the round that just finished (read the header comment) ----
  // The advice for each metric and direction, one sentence each.
  const ROUND_TIP_ADVICE = {
    accuracy: { down: "Slow down for a few shots, put the crosshair on the target before you click, and play a short warm-up if you are tired.", up: "Whatever you did differently this round worked." },
    headshot: { down: "Aim for head height before you fire instead of chasing the body.", up: "Your head-height aim was good this round: keep the crosshair up there between targets." },
    side: { neg: "Your crosshair stopped or drifted left of the target: aim a little to the right of where you want to hit, and stop the mouse on the target instead of swinging past it.",
            pos: "Your crosshair stopped or drifted right of the target: aim a little to the left of where you want to hit, and stop the mouse on the target instead of swinging past it." },
    vertical: { pos: "Your shots passed over the target: lower your crosshair a little (the head is about " + HEAD_ABOVE_CENTRE_CM + " cm above the middle of the body, so some height is normal if you aim for the head).",
                neg: "Your shots passed under the target: raise your crosshair a little and aim at the head or upper chest." },
  };
  const tipValues = (list) => { const m = avg(list), sd = list.length > 1 ? Math.sqrt(list.reduce((s, v) => s + (v - m) * (v - m), 0) / (list.length - 1)) : 0; return { mean: m, sd }; };
  const roundShots = (r) => (Array.isArray(r.shots) ? r.shots : []);
  const roundAccuracy = (r) => { const s = roundShots(r); return s.length >= ROUND_SHOTS_MIN ? s.filter(isHit).length / s.length : null; };
  const roundHeadShare = (r) => { const hits = roundShots(r).filter(isHit); return hits.length >= ROUND_TIP_HITS_MIN ? hits.filter(isHead).length / hits.length : null; };
  const roundSide = (r) => { const v = roundShots(r).filter((s) => !isHit(s) && !s.pellets && countable(s.weapon) && s.nearestEnemy && num(s.nearestEnemy.side)).map((s) => s.nearestEnemy.side); return v.length >= ROUND_TIP_MISS_MIN ? avg(v) : null; };
  const roundVertical = (r) => { const v = (Array.isArray(r.nearMisses) ? r.nearMisses : []).map((n) => n && n.verticalOffset).filter(num); return v.length >= ROUND_TIP_MISS_MIN ? avg(v) : null; };
  const sgn = (v, neg, pos) => { const a = Math.abs(v).toFixed(2); return a === "0.00" ? "0.00 m (centred)" : a + " m " + (v < 0 ? neg : pos); };
  const ROUND_TIP_METRICS = [
    { id: "accuracy", directional: false, floor: ROUND_TIP_FLOOR_ACC, of: roundAccuracy,
      title: (up) => (up ? "You were more accurate than usual this round" : "Your accuracy dropped this round"), advice: (up) => ROUND_TIP_ADVICE.accuracy[up ? "up" : "down"],
      line: (now, usual, where, n) => "You hit " + pct(now) + "% of your shots this round; in your last " + plural(n, "round", "rounds") + where + " it was " + pct(usual) + "%." },
    { id: "headshot", directional: false, floor: ROUND_TIP_FLOOR_HEAD, of: roundHeadShare,
      title: (up) => (up ? "More headshots than usual this round" : "Fewer headshots this round"), advice: (up) => ROUND_TIP_ADVICE.headshot[up ? "up" : "down"],
      line: (now, usual, where, n) => "Headshots were " + pct(now) + "% of your hits this round; in your last " + plural(n, "round", "rounds") + where + " they were " + pct(usual) + "%." },
    { id: "side", directional: true, floor: ROUND_TIP_FLOOR_SIDE_M, of: roundSide,
      title: (neg) => "Your shots drifted " + (neg ? "left" : "right") + " this round", advice: (neg) => ROUND_TIP_ADVICE.side[neg ? "neg" : "pos"],
      line: (now, usual, where, n) => "Your sideways miss average was " + sgn(now, "left", "right") + "; in your last " + plural(n, "round", "rounds") + where + " it was " + sgn(usual, "left", "right") + "." },
    { id: "vertical", directional: true, floor: ROUND_TIP_FLOOR_VERT_M, of: roundVertical,
      title: (neg) => "Your shots went " + (neg ? "low" : "high") + " this round", advice: (neg) => ROUND_TIP_ADVICE.vertical[neg ? "neg" : "pos"],
      line: (now, usual, where, n) => "Your near misses passed " + sgn(now, "below", "above") + " the middle of the enemy on average; in your last " + plural(n, "round", "rounds") + where + " it was " + sgn(usual, "below", "above") + "." },
  ];
  async function roundTip(round, opts) {
    const o = opts || {}, rep = o.report && typeof o.report === "object" ? o.report : {};
    const done = (reason, extra) => { rep.reason = reason; Object.assign(rep, extra || {}); return null; };
    try {
      const A = window.__aimAnalytics, hasA = !!A && typeof A.rounds === "function";
      const full = (r) => ({ ...r, sight: r.sight === true, shots: r.shots || [], nearMisses: r.nearMisses || [] });
      const byAt = (a, b) => (b.at || 0) - (a.at || 0);
      if (!round) {
        if (!hasA) return done("no-round");
        const newest = ((await A.rounds({ limit: 1 })) || []).map(full).sort(byAt)[0];
        if (!newest) return done("no-round");
        round = newest;
      } else round = full(round);
      const other = (r) => r.id != null && round.id != null ? r.id !== round.id : r.at !== round.at;
      const sameCode = (list) => (round.code != null ? list.filter((r) => r.code === round.code) : []);
      const sameMap = (list) => (round.map != null ? list.filter((r) => r.map === round.map) : []);
      const pool = async (f) => (hasA ? ((await A.rounds({ ...f, limit: ROUND_LIMIT + 1 })) || []) : []).map(full).filter(other);
      let basis = "code", base;
      if (Array.isArray(o.baseline)) {
        const all = o.baseline.map(full).filter(other);
        base = sameCode(all);
        if (base.length < ROUND_TIP_BASE_MIN) { base = sameMap(all); basis = "map"; }
      } else {
        base = round.code != null ? sameCode(await pool({ code: round.code })) : [];
        if (base.length < ROUND_TIP_BASE_MIN && round.map != null) { base = sameMap(await pool({ map: round.map })); basis = "map"; }
      }
      base = base.sort(byAt).slice(0, ROUND_LIMIT);
      if (base.length < ROUND_TIP_BASE_MIN) return done("thin-data", { basis, baselineRounds: base.length, note: "Fewer than " + ROUND_TIP_BASE_MIN + " other rounds of this drill or map to compare with: no tip." });
      const where = basis === "code" ? " of this drill" : " on this map";
      const outliers = [], candidates = [];
      for (const m of ROUND_TIP_METRICS) {
        const x = m.of(round);
        if (x === null) continue;
        const vals = base.map(m.of).filter(num);
        if (vals.length < ROUND_TIP_BASE_MIN) continue;
        const { mean, sd } = tipValues(vals);
        let persistence, side;
        if (m.directional) {
          side = Math.sign(x);
          if (side === 0) continue;
          const usual = Math.sign(mean), share = usual === 0 ? 0 : vals.filter((v) => Math.sign(v) === usual).length / vals.length;
          if (usual !== 0 && side !== usual && share >= ROUND_TIP_OUTLIER_SHARE) { outliers.push({ metric: m.id, value: x, baselineMean: mean, baselineSameSideShare: share }); continue; }
          persistence = vals.filter((v) => Math.sign(v) === side).length / vals.length;
        } else {
          side = x >= mean ? 1 : -1;
          persistence = vals.filter((v) => (side > 0 ? v >= mean : v < mean)).length / vals.length;
        }
        const z = (x - mean) / Math.max(sd, m.floor), score = Math.abs(z) * (ROUND_TIP_PERSIST_BASE + persistence);
        candidates.push({ m, x, mean, sd, z, persistence, score, side, n: vals.length });
      }
      rep.outliers = outliers; rep.basis = basis; rep.baselineRounds = base.length;
      rep.candidates = candidates.map((c) => ({ metric: c.m.id, z: c.z, persistence: c.persistence, score: c.score }));
      const top = candidates.filter((c) => Math.abs(c.z) >= ROUND_TIP_Z).sort((a, b) => b.score - a.score)[0];
      if (!top) return done("no-tip");
      const m = top.m, flag = m.directional ? top.side < 0 : top.side > 0; // directional: left / under; otherwise: higher than usual
      rep.reason = "tip";
      return withSummary({
        id: "round-tip-" + m.id, severity: "tip", sample: base.length, title: m.title(flag),
        detail: m.line(top.x, top.mean, where, top.n) + " " + m.advice(flag),
        evidence: { metric: m.id, thisRound: top.x, baselineMean: top.mean, baselineSd: top.sd, z: top.z, persistence: top.persistence, score: top.score, baselineRounds: top.n, basis,
          roundId: round.id ?? null, outliersSkipped: outliers.map((x) => x.metric) },
      });
    } catch { return null; }
  }

  // ---- the entry point ----
  async function insights(filter) {
    try {
      const A = window.__aimAnalytics;
      if (!A || typeof A.rounds !== "function") return [];
      const f = filter || {}, from = sinceMs(f.since);
      const base = { code: f.code || undefined, map: f.map || undefined, weapon: f.weapon || undefined };
      const full = (r) => ({ ...r, shots: r.shots || [], deaths: r.deaths || [], engagements: r.engagements || [], nearMisses: r.nearMisses || [] });
      let all = null; // the newest rounds, read once
      const allRounds = async () => (all || (all = ((await A.rounds({ ...base, limit: ROUND_LIMIT })) || []).map(full)));
      const ctx = {
        f: base, rounds: (await allRounds()).filter((r) => !from || r.at >= from), allRounds,
        fromDay: from ? dayOf(from) : undefined,
        days: async (q) => { const list = typeof A.days === "function" ? await A.days(q) : []; return Array.isArray(list) ? list : []; },
      };
      const out = [];
      for (const rule of [missSide, killStyle, preAim, killTime, deathZone, deathsCause, deathsUnanswered, multiEnemy, fightsLost, fightSpot, fightAngle, holdSooner, clearDeaths, overChecked, wastedSwings, headshotWeapon, accuracyWeapon, strafeMap, strafeDrill, burstLength, sprayControl, accuracyRange, missSideways, counterStrafe, walkAccuracy, crouchAccuracy, sensitivity, consistency, tracking, sessionShape, trend]) {
        try { out.push(...(await rule(ctx))); } catch {}
      }
      out.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity] || b.sample - a.sample);
      out.forEach(withSummary); // the short line each card shows (see SUMMARY)
      return f.limit > 0 ? out.slice(0, f.limit) : out;
    } catch { return []; }
  }

  window.__aimCoach = {
    insights, roundTip, warmupPlan,
    // The short card line of a finding, and the rule ids that have one (every id insights() and roundTip() return).
    summaryOf, summaryIds: Object.keys(SUMMARY),
    // Every minimum sample and cut-off, for screens and tests.
    thresholds: { ROUND_LIMIT, NEAR_MIN, NEAR_SHARE, HEAD_AIM_TOL_CM, HEAD_ABOVE_CENTRE_CM, SIDE_SHARE, KILLS_MIN, CLASS_SHARE, PREAIM_MIN, PREAIM_SHARE, PREAIM_DEG, PREAIM_LOW_DEG, PREAIM_LOW_SHARE, BURST_GAP_S, BURST_REF, BURST_LONG, BURST_RUNS_MIN, BURST_SHOTS_MIN, BURST_GAP_POINTS, SPRAY_FROM, SPRAY_RUNS_MIN, SPRAY_SHOTS_MIN, SPRAY_GAP_POINTS, SPRAY_DRIFT_DEG, SPRAY_AWAY_DEG, SPRAY_PULL_DEG, SPRAY_AXIS_SHARE, TTK_MIN, TTK_WINDOW_MIN,
      TTK_CHANGE, TTK_CHANGE_S, DEATHS_MIN, CELL_MIN, CELL_FACTOR, CAUSE_MIN, FALL_SHARE, FALL_MIN, UNANSWERED_MIN, UNANSWERED_SHARE, MULTI_MIN, MULTI_DEATHS_MIN,
      FIGHTS_MIN, LOST_TIP, LOST_WARN, CELL_FIGHTS_MIN, LOST_SPOT_SHARE, ANGLE_FIGHTS_MIN, ANGLE_LOSS_SHARE, ANGLE_WIN_GAP, ANGLE_WIN_SHARE, HOLD_LOST_S, HOLD_WON_S, HOLD_FIGHTS_MIN, CLEAR_WINDOW_S, CLEAR_ARC_DEG, CLEAR_DEATHS_MIN, CLEAR_DEATH_SHARE, CLEAR_SECTOR_SHARE, CHECK_MIN_S, CHECK_ROUNDS_MIN, CHECK_ENEMIES_MIN, WASTE_ARC_DEG, WASTE_SHARE, WASTE_SHOTS_MIN, HITS_MIN, HEAD_GAP_POINTS, ACC_SHOTS_MIN, ACC_GAP_POINTS, STRAFE_GROUP_MIN, STRAFE_GAP_POINTS, ROUND_SHOTS_MIN, CONSIST_MIN,
      TRACK_ENG_MIN, TRACK_SAMPLES_MIN, TRACK_BODY_LOW, TRACK_LAG_DEG, TRACK_LOCK_SLOW_S, TRACK_LOCK_MIN, DRILL_ROUNDS_MIN, STEADY_SD, STREAKY_SD, TREND_SHOTS_MIN, TREND_HITS_MIN, TREND_FLAT_POINTS,
      RANGE_NEAR_M, RANGE_FAR_M, RANGE_SHOTS_MIN, RANGE_GAP_POINTS, SIDE_BAND_M, SIDE_MIN, STILL_MPS, MOVE_SHOTS_MIN, MOVE_GAP_POINTS, CROUCH_ON, CROUCH_OFF,
      POSTURE_SHOTS_MIN, POSTURE_GAP_POINTS, SENS_RECENT_ROUNDS, SENS_ROUNDS_MIN, SENS_SAME, SENS_LOW, SENS_HIGH, ACCEL_SHARE,
      SESSION_GAP_MS, SHAPE_ROUNDS_MIN, SHAPE_SESSIONS_MIN, WARM_ROUNDS, FADE_ROUNDS, SHAPE_SHOTS_MIN, SHAPE_GAP_POINTS, WARMUP_STEPS, WARMUP_POOL, WARMUP_DRILL_ROUNDS_MIN, WARMUP_SHOTS_MIN, WARMUP_DIED_SHARE,
      ROUND_TIP_BASE_MIN, ROUND_TIP_Z, ROUND_TIP_OUTLIER_SHARE, ROUND_TIP_PERSIST_BASE, ROUND_TIP_HITS_MIN, ROUND_TIP_MISS_MIN, ROUND_TIP_FLOOR_ACC, ROUND_TIP_FLOOR_HEAD, ROUND_TIP_FLOOR_SIDE_M, ROUND_TIP_FLOOR_VERT_M },
  };
})();
