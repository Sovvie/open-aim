// Writes the Target Workshop drill set into scenarios/ (20 Nov 2026): 22 drills, each in an Easy and a Hard version = 44 files.
//   node tools/make-workshop-scenes.mjs        then:  node scripts/build-scenarios.mjs
// Same pattern as tools/make-tracking-scenes.mjs: one sphere actor template, item.type "ball" (the lobby's Target Workshop tab), the empty
// black arena with the blue floor grid, the player standing still at z 4.2 looking along -z. The output is deterministic (fixed timestamp,
// share codes derived from the name), so running it again rewrites byte-identical files. Nothing else in scenarios/ is touched.
//
// Sizes and spacings are written in DEGREES of view angle (what the game's own Tune screen shows) and turned into metres for the wall
// distance: diameter 3° at 14 m is a ball of radius 14 * tan(1.5°) = 0.37 m. The speeds come from the game's own movement: 2.97 m/s walk,
// 5.4 m/s run, 6.75 m/s the fastest anything moves.
//
// How the lobby files a drill (copied from the game's drill reader in ChJ6FlD4.js, see tests/test-workshop-scenes.cjs):
//   scoring "tracking" -> Tracking;  blink behaviour -> Reaction;  strafe / sway / path behaviour -> Moving;  anything else -> Flicking.
// Pairs: <stem>-easy.json and <stem>-hard.json are one drill at two difficulties (the Switch difficulty button, app/sibling-switch.js).
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "scenarios");
const NOW = "2026-11-20 12:00:00";
const FIRST_SORT = 205; // 200-204 are the five tracking drills; this set uses 205 and up (at most 299)
export const codeOf = (name) => crypto.createHash("sha1").update("aimlocal-set:" + name).digest("hex").slice(0, 16);

// x = across, y = height above the floor (the player's eye is 1.75), z = depth (the player stands at z 4.2 looking along -z).
const P = (x, y, z) => ({ x, y, z });
const EYE = 1.75, PZ = 4.2, DEG = Math.PI / 180;
const r3 = (x) => Math.round(x * 1000) / 1000;
const z0 = (dist) => r3(PZ - dist);
const radiusAt = (dist, diaDeg) => r3(dist * Math.tan((diaDeg * DEG) / 2)); // ball radius for a diameter in degrees
const stepAt = (dist, deg) => r3(dist * Math.tan(deg * DEG)); // centre-to-centre spacing on a flat wall
const spanAt = (dist, deg) => r3(2 * dist * Math.tan((deg * DEG) / 2)); // wall width/height covering `deg` of view
const floorTo = (v, q) => Math.floor(v / q + 1e-9) * q, ceilTo = (v, q) => Math.ceil(v / q - 1e-9) * q;

const WALK = 2.97, RUN = 5.4, FAST = 6.75;
const respawn = (delay = [0.05, 0.12]) => ({ kind: "respawn", delay, mode: "reSpawner" });

// ---- spawner shapes -------------------------------------------------------------------------------------------------------------------
const gridSp = ({ dist, cols, rows, stepX, stepY = stepX, alive, y = EYE, delay = [0.05, 0.1] }) => ({
  kind: "grid", position: P(0, y, z0(dist)), size: P(r3(stepAt(dist, stepX) * (cols - 1)), r3(stepAt(dist, stepY) * (rows - 1)), 0),
  columns: cols, rows, maxAlive: alive, spawnDelay: delay,
});
const areaSp = ({ dist, w = 0, h = 0, y = EYE, x = 0, alive, gap, gapPrev, delay = [0.05, 0.12], wMeters, hMeters }) => ({
  kind: "area", position: P(x, y, z0(dist)), size: P(wMeters ?? (w ? spanAt(dist, w) : 0), hMeters ?? (h ? spanAt(dist, h) : 0), 0),
  maxAlive: alive, spawnDelay: delay,
  ...(gap ? { minAngularGap: gap } : {}), ...(gapPrev ? { minAngularGapFromPrevious: gapPrev } : {}),
});
// slots: targets appear one after the other at evenly spaced places, left to right, then start over.
const slotsSp = ({ dist, count, stepDeg, y = EYE, delay = [0.06, 0.1] }) => ({
  kind: "slots", position: P(0, y, z0(dist)), size: P(r3(stepAt(dist, stepDeg) * (count - 1)), 0, 0), slotCount: count, maxAlive: 1, spawnDelay: delay,
});

// ---- tunables (what the Tune screen lets the player change) --------------------------------------------------------------------------
const tRadius = (r) => ({ field: "radius", id: "actor-1", label: "Target size", min: floorTo(r * 0.4, 0.01), max: ceilTo(r * 2.2, 0.01), step: 0.01 });
const tDuration = { field: "duration", label: "Round length", min: 30, max: 180, step: 15 };
const tAlive = (cap) => ({ field: "maxAlive", id: "spawner-1", label: "Targets at once", min: 1, max: cap, step: 1 });
const tSpacing = (sp) => {
  const v = sp.size.x / (sp.columns - 1);
  return { field: sp.rows > 1 && Math.abs(sp.size.x / (sp.columns - 1) - sp.size.y / (sp.rows - 1)) < 1e-6 ? "spacing" : "spacingX", id: "spawner-1", label: "Grid spacing", min: floorTo(v * 0.5, 0.1), max: ceilTo(v * 2.2, 0.1), step: 0.1 };
};
const tWidth = (sp) => ({ field: "width", id: "spawner-1", label: "Area width", min: floorTo(sp.size.x * 0.4, 0.5), max: ceilTo(sp.size.x * 1.8, 0.5), step: 0.5 });
const tLifetime = (v) => ({ field: "decay.lifetime", id: "actor-1", label: "Target lifetime", min: 0.3, max: ceilTo(v * 2.5, 0.1), step: 0.1 });
const tJump = (v) => ({ field: "jump.height", id: "actor-1", label: "Jump height", min: 0.2, max: ceilTo(v * 1.6, 0.1), step: 0.05 });
const tStrafe = (v) => ({ field: "strafe.speed", id: "actor-1", label: "Strafe speed", min: 1, max: 8, step: 0.1 });

// A dispatcher (points that light up in turn) has its own tunables: how long a point stays lit, and how many are lit at once.
const tDispStay = (v) => ({ field: "dispatcher.stay", id: "dispatcher-1", label: "Time lit", min: 0.3, max: ceilTo(v * 2.5, 0.1), step: 0.1 });
const tDispAlive = (cap) => ({ field: "dispatcher.maxAlive", id: "dispatcher-1", label: "Points lit at once", min: 1, max: cap, step: 1 });

const degTxt = (d) => (Math.round(d * 10) / 10).toString().replace(/\.0$/, "") + "°";

// ---- the drills -----------------------------------------------------------------------------------------------------------------------
// build(tier) returns: dist (wall distance, m), dia (ball diameter, degrees), spawner, behaviors, tunables, plus optional weapon / fireMode / health /
// rules / note (the numbers added to the description). `skill` is what the lobby must file the drill under (the test checks it).
const STEMS = [];
const stem = (s) => STEMS.push(s);

// --- Flick: static walls -----------------------------------------------------------------------------------------------------------------
{
  const mk = (dist, dia, cols, rows, step, alive, stepY = step) => {
    const spawner = gridSp({ dist, cols, rows, stepX: step, stepY, alive });
    return { dist, dia, spawner, behaviors: [respawn()], tunables: [tRadius(radiusAt(dist, dia)), tAlive(cols * rows - 1), tSpacing(spawner), tDuration],
      note: `${cols}×${rows} grid, balls ${degTxt(dia)} wide, ${degTxt(step)} apart${stepY !== step ? ` across, ${degTxt(stepY)} up and down` : ""}, ${alive} up at once.` };
  };
  stem({ stem: "gridshot-3x3", title: "Flick — Gridshot 3×3", skill: "Flicking",
    about: "Three balls are up on a 3×3 wall. Hit one and a new one takes a free spot. Trains fast, clean flicks between close targets.",
    build: (t) => (t === "easy" ? mk(14, 4.2, 3, 3, 9, 3) : mk(14, 2.6, 3, 3, 10, 3)) });
  stem({ stem: "gridshot-5x5", title: "Flick — Gridshot 5×5 wide", skill: "Flicking",
    about: "A wide 5×5 wall with four balls up at a time. The next ball can be anywhere, so you flick short and long. Trains flick distance control.",
    build: (t) => (t === "easy" ? mk(14, 3.4, 5, 5, 8, 4, 4.4) : mk(14, 2.2, 5, 5, 9, 4, 3.4)) });
  stem({ stem: "speed-clicks", title: "Flick — Speed clicks", skill: "Flicking",
    about: "Big balls close by, replaced almost at once. Pure click speed and rhythm: shoot, move, shoot. Accuracy still matters, a miss costs points.",
    build: (t) => {
      const dist = 10, dia = t === "easy" ? 7 : 4.6, step = t === "easy" ? 11 : 10, alive = t === "easy" ? 3 : 4;
      const spawner = gridSp({ dist, cols: 3, rows: 2, stepX: step, alive, delay: [0.02, 0.04] });
      return { dist, dia, spawner, behaviors: [respawn([0.02, 0.04])], tunables: [tRadius(radiusAt(dist, dia)), tAlive(5), tSpacing(spawner), tDuration],
        note: `3×2 grid, balls ${degTxt(dia)} wide, ${alive} up at once, replaced in under 0.05 s.` };
    } });
}
{
  const area = (dist, wDeg, hDeg, dia, alive, gap, gapPrev, extra = {}) => {
    const spawner = areaSp({ dist, w: wDeg, h: hDeg, alive, gap, gapPrev });
    return { dist, dia, spawner, behaviors: [respawn()], tunables: [tRadius(radiusAt(dist, dia)), tAlive(Math.max(alive + 3, 4)), tWidth(spawner), tDuration], ...extra,
      note: `${alive} ball${alive > 1 ? "s" : ""} ${degTxt(dia)} wide in a ${degTxt(wDeg)} × ${degTxt(hDeg)} area.` };
  };
  stem({ stem: "wall-six", title: "Flick — Wall of six", skill: "Flicking",
    about: "Six balls hang on one wall at random spots. Hit one and it reappears elsewhere. Trains target choice, speed and the path between targets.",
    build: (t) => (t === "easy" ? area(20, 34, 12, 3.4, 6, 4.5) : area(20, 40, 12, 2.2, 6, 4.5)) });
  stem({ stem: "wide-flicks", title: "Flick — Wide flicks", skill: "Flicking",
    about: "One ball at a time, always far from the last one, across most of your screen. Trains big flicks that land on target without a correction.",
    build: (t) => (t === "easy" ? area(12, 70, 12, 6.2, 1, 0, 25) : area(12, 80, 12, 4.2, 1, 0, 35)) });
}

// --- Switching ---------------------------------------------------------------------------------------------------------------------------
{
  const row = (dist, dia, cols, step, alive) => {
    const spawner = gridSp({ dist, cols, rows: 1, stepX: step, alive });
    return { dist, dia, spawner, behaviors: [respawn()], tunables: [tRadius(radiusAt(dist, dia)), tAlive(cols - 1), tSpacing(spawner), tDuration],
      note: `${alive} balls up on a row of ${cols}, ${degTxt(dia)} wide, ${degTxt(step)} apart.` };
  };
  stem({ stem: "switch-close", title: "Switch — Close pair", skill: "Flicking",
    about: "Two (Hard: three) balls sit a few degrees apart. Hit one and go straight to the next. Trains short target switches without overshooting.",
    build: (t) => (t === "easy" ? row(16, 3.4, 4, 6.5, 2) : row(16, 3, 4, 4.6, 3)) });
  stem({ stem: "switch-far", title: "Switch — Far pair", skill: "Flicking",
    about: "Two balls on opposite sides, far apart. Hit one, swing to the other. Trains long target switches and landing on the second ball at once.",
    build: (t) => (t === "easy" ? row(14, 4.6, 3, 20, 2) : row(14, 3, 3, 26, 2)) });
}

// --- Precision ---------------------------------------------------------------------------------------------------------------------------
stem({ stem: "micro-ladder", title: "Precision — Micro ladder", skill: "Flicking",
  about: "One small ball at a time, stepping left to right in tiny steps, then back to the start. Trains micro-adjustments of a degree or two.",
  build: (t) => {
    const dist = 16, dia = t === "easy" ? 1.9 : 1.1, step = t === "easy" ? 3 : 2, count = 8;
    const spawner = slotsSp({ dist, count, stepDeg: step });
    return { dist, dia, spawner, behaviors: [], tunables: [tRadius(radiusAt(dist, dia)), tDuration],
      note: `${count} places ${degTxt(step)} apart, balls ${degTxt(dia)} wide; it jumps back after the last one.` };
  } });
stem({ stem: "pinpoint", title: "Precision — Pinpoint", skill: "Flicking",
  about: "Tiny balls in a small area, two up at once. There is no room to be sloppy: slow down your aim and place the crosshair exactly.",
  build: (t) => {
    const dist = 12, dia = t === "easy" ? 1.5 : 0.9;
    const spawner = areaSp({ dist, w: 16, h: 9, alive: 2, gap: 3, gapPrev: 4 });
    return { dist, dia, spawner, behaviors: [respawn()], tunables: [tRadius(radiusAt(dist, dia)), tAlive(4), tDuration],
      note: `2 balls ${degTxt(dia)} wide in a 16° × 9° area.` };
  } });
stem({ stem: "long-range", title: "Precision — Long range", skill: "Flicking",
  about: "Small balls far down the range, one at a time. Hard to see and easy to overshoot. Trains small, patient corrections at long distance.",
  build: (t) => {
    const dist = 48, dia = t === "easy" ? 1.3 : 0.8;
    const spawner = areaSp({ dist, w: 24, h: 4, alive: 1, gapPrev: 3 });
    return { dist, dia, spawner, behaviors: [respawn()], tunables: [tRadius(radiusAt(dist, dia)), tDuration],
      note: `1 ball ${degTxt(dia)} wide, 48 m away.` };
  } });

// --- Reaction ----------------------------------------------------------------------------------------------------------------------------
stem({ stem: "blink", title: "Reaction — Blink", skill: "Reaction",
  about: "A ball appears at a random spot, then flashes on and off. Shoot it while it is lit. Trains reacting to a target that shows up and blinks away.",
  build: (t) => {
    const dist = 18, dia = t === "easy" ? 4 : 3.2, easy = t === "easy";
    const spawner = areaSp({ dist, w: 30, h: 10, alive: easy ? 1 : 2, gap: 6, delay: [0.15, 0.4] });
    const blink = { kind: "blink", visible: easy ? [0.9, 1.3] : [0.5, 0.8], hidden: easy ? [0.35, 0.6] : [0.3, 0.5] };
    return { dist, dia, spawner, behaviors: [blink, respawn([0.15, 0.4])], tunables: [tRadius(radiusAt(dist, dia)), tAlive(4), tDuration],
      note: `${easy ? 1 : 2} ball${easy ? "" : "s"} ${degTxt(dia)} wide, lit for ${easy ? "0.9 to 1.3" : "0.5 to 0.8"} s at a time.` };
  } });
stem({ stem: "popup", title: "Reaction — Pop-up", skill: "Reaction",
  about: "A ball pops up at a random spot and shrinks away. Shoot it before it is gone: an expired ball costs points. Trains a fast, calm first shot.",
  build: (t) => {
    const dist = 18, easy = t === "easy", dia = easy ? 4.2 : 3.4, life = easy ? 1.6 : 0.85;
    const spawner = areaSp({ dist, w: 36, h: 11, alive: easy ? 1 : 2, gap: 6, delay: [0.2, 0.45] });
    // The slow blink (it would only start after 30 s, and the ball is respawned long before) is there so the lobby files the drill under Reaction.
    const behaviors = [{ kind: "decay", lifetime: life, growTime: 0.12, minScale: 0.55 }, { kind: "blink", visible: [30, 30], hidden: [0.5, 0.5] }, respawn([0.2, 0.45])];
    return { dist, dia, spawner, behaviors, tunables: [tRadius(radiusAt(dist, dia)), tLifetime(life), tAlive(4), tDuration],
      rules: { expiredPenalty: easy ? 100 : 250 },
      note: `${easy ? 1 : 2} ball${easy ? "" : "s"} ${degTxt(dia)} wide, gone after ${life} s, ${easy ? 100 : 250} points off for each one you miss.` };
  } });

// --- Moving targets ------------------------------------------------------------------------------------------------------------------------
{
  // Strafing balls: a run-and-stop strafe like a player's (the game's counter-strafe behaviour). Easy: steady stops. Hard: short, random stops and taps.
  const strafeBall = (dist, dia, speed, hard, width) => {
    const strafe = hard
      ? { kind: "strafe", speed: [speed, speed], dwell: [0.03, 0.25], travel: [r3(width * 0.45), width], tap: [0.35, r3(Math.min(0.5, width * 0.5)), r3(Math.min(1.2, width))], counterStrafe: true }
      : { kind: "strafe", speed: [speed, speed], dwell: [0.15, 0.6], travel: [r3(width * 0.6), width], counterStrafe: true };
    const spawner = areaSp({ dist, x: 0, wMeters: 6, hMeters: 1.4, alive: 1, delay: [0.1, 0.3] });
    return { dist, dia, spawner, behaviors: [strafe, respawn([0.1, 0.3])], tunables: [tRadius(radiusAt(dist, dia)), tStrafe(speed), tDuration],
      note: `Ball ${degTxt(dia)} wide at ${speed} m/s, ${hard ? "short random stops and taps" : "steady stops"}.` };
  };
  stem({ stem: "strafe-walk", title: "Strafe — Walk pace", skill: "Moving",
    about: "A ball strafes left and right at walking speed and stops now and then, like a player. Trains hitting a slow mover and shooting at the stops.",
    build: (t) => strafeBall(16, t === "easy" ? 4.2 : 3.2, WALK, t === "hard", t === "easy" ? 5 : 6) });
  stem({ stem: "strafe-run", title: "Strafe — Run pace", skill: "Moving",
    about: "A ball strafes at the game's run speed with short stops. Trains leading the target and timing the shot when it is almost still.",
    build: (t) => strafeBall(16, t === "easy" ? 3.6 : 2.6, RUN, t === "hard", t === "easy" ? 5 : 6) });
  stem({ stem: "strafe-fast", title: "Strafe — Full sprint", skill: "Moving",
    about: "The fastest strafe the game has: 6.75 m/s. The ball is hard to catch while it runs, so learn to read its stops and turn-arounds.",
    build: (t) => strafeBall(16, t === "easy" ? 3.2 : 2.2, FAST, t === "hard", t === "easy" ? 6 : 7) });
  stem({ stem: "counter-strafe", title: "Strafe — Counter-strafe stops", skill: "Moving",
    about: "The ball runs, then stops. Wait for the stop and shoot as it stands still, like shooting right after a counter-strafe. Trains patience and timing.",
    build: (t) => {
      const easy = t === "easy", dist = 16, dia = easy ? 3.4 : 2.6;
      const strafe = easy
        ? { kind: "strafe", speed: [RUN, RUN], dwell: [0.45, 0.9], travel: [3, 6], counterStrafe: true }
        : { kind: "strafe", speed: [RUN, RUN], dwell: [0.12, 0.3], travel: [2.6, 6], tap: [0.3, 0.5, 1.2], counterStrafe: true };
      const spawner = areaSp({ dist, wMeters: 6, hMeters: 1.4, alive: 1, delay: [0.1, 0.3] });
      return { dist, dia, spawner, behaviors: [strafe, respawn([0.1, 0.3])], tunables: [tRadius(radiusAt(dist, dia)), tStrafe(RUN), tDuration],
        note: `Ball ${degTxt(dia)} wide, stands still for ${easy ? "0.45 to 0.9" : "0.12 to 0.3"} s each time.` };
    } });
  stem({ stem: "jumper", title: "Jump — Jumping ball", skill: "Moving",
    about: "A ball that strafes and jumps, like a player in the air. Trains hitting a target that is moving up and down as well as sideways.",
    build: (t) => {
      const easy = t === "easy", dist = 14, dia = easy ? 4.2 : 3, height = easy ? 0.7 : 1.3;
      const jump = { kind: "jump", interval: easy ? [1.3, 2.1] : [0.7, 1.5], height };
      const speed = easy ? WALK : RUN;
      const strafe = { kind: "strafe", speed: [speed, speed], dwell: [0.15, 0.5], travel: [2, 4], counterStrafe: true };
      const spawner = areaSp({ dist, y: 1.05, wMeters: 4, hMeters: 0, alive: 1, delay: [0.15, 0.35] });
      return { dist, dia, spawner, behaviors: [jump, strafe, respawn([0.15, 0.35])], tunables: [tRadius(radiusAt(dist, dia)), tJump(height), tStrafe(speed), tDuration],
        note: `Ball ${degTxt(dia)} wide, jumps ${height} m high every ${easy ? "1.3 to 2.1" : "0.7 to 1.5"} s.` };
    } });
  stem({ stem: "bounce", title: "Bounce — Zig-zag", skill: "Moving",
    about: "A ball ricochets up and down and across the wall on a zig-zag path. Hit it as it goes. Trains following a mover in two directions at once.",
    build: (t) => {
      const easy = t === "easy", dist = 18, dia = easy ? 4.4 : 3, z = z0(dist);
      const [wx, lo, hi, speed] = easy ? [6, 1.2, 3.6, 5] : [8, 1, 4.2, 8.5];
      const way = [P(-wx, lo, z), P(wx, hi, z), P(-wx, hi, z), P(wx, lo, z), P(-wx + 0.01, lo, z)];
      const spawner = areaSp({ dist, x: -wx, y: lo, alive: 1, delay: [0.15, 0.35] });
      return { dist, dia, spawner, behaviors: [{ kind: "path", waypoints: way, loop: true, speed }, respawn([0.15, 0.35])], tunables: [tRadius(radiusAt(dist, dia)), tDuration],
        note: `Ball ${degTxt(dia)} wide at ${speed} m/s over ${2 * wx} m.` };
    } });
  stem({ stem: "burst-control", title: "Spray — Burst control", skill: "Moving",
    about: "A big ball drifts slowly and takes several hits with the Phantom. Hold the trigger in short bursts and pull the spray back down onto the ball.",
    build: (t) => {
      const easy = t === "easy", dist = easy ? 20 : 28, dia = easy ? 5 : 3, health = easy ? 300 : 450;
      const sway = { kind: "sway", amplitude: { x: easy ? 2.5 : 4, y: easy ? 0.4 : 0.6 }, frequency: easy ? 0.1 : 0.14, unit: "hz" };
      const spawner = areaSp({ dist, y: 2.2, alive: 1, delay: [0.2, 0.4] });
      return { dist, dia, spawner, behaviors: [sway, respawn([0.2, 0.4])], tunables: [tRadius(radiusAt(dist, dia)), tDuration],
        weapon: "phantom", fireMode: "hold", perfectAccuracy: false, health,
        note: `Phantom, ball ${degTxt(dia)} wide at ${dist} m, ${health} health (${easy ? "three" : "three to four"} hits).` };
    } });
}

// --- Tracking (scoring "tracking": time on target, nothing to fire) ----------------------------------------------------------------------------
{
  const tracking = (dist, dia, way, speed, note, y = EYE) => {
    const spawner = { kind: "area", position: way[0], size: P(0.1, 0.1, 1), maxAlive: 1, spawnDelay: [0.2, 0.5] };
    return { dist, dia, spawner, behaviors: [{ kind: "path", waypoints: way, loop: true, speed }], tunables: [tRadius(radiusAt(dist, dia)), tDuration], tracking: true, note };
  };
  stem({ stem: "track-vertical", title: "Tracking — Vertical", skill: "Tracking",
    about: "The ball moves straight up and down. Keep the crosshair on it for the whole round. Trains vertical mouse control, which most players track worse.",
    build: (t) => {
      const easy = t === "easy", dist = 14, z = z0(dist), dia = easy ? 3.6 : 2.4, speed = easy ? 2.4 : 5.2, hi = easy ? 4.2 : 4.8, lo = easy ? 0.8 : 0.5;
      return tracking(dist, dia, [P(-0.5, lo, z), P(0.5, hi, z), P(-0.49, lo, z)], speed, `Ball ${degTxt(dia)} wide at ${speed} m/s, ${r3(hi - lo)} m up and down.`);
    } });
  stem({ stem: "track-depth", title: "Tracking — Depth", skill: "Tracking",
    about: "The ball runs toward you and away again, so its size and speed keep changing. Trains tracking a target whose distance changes.",
    build: (t) => {
      const easy = t === "easy", dia = easy ? 3.4 : 2.4, speed = easy ? 4 : 7.5, near = easy ? -9 : -6, far = easy ? -24 : -30;
      const way = [P(-3, 1.4, near), P(5, 2.4, far), P(-2.99, 1.4, near)];
      const dist = 4.2 - (near + far) / 2; // the mean wall distance; the radius is set for this
      return { ...tracking(dist, dia, way, speed, `Ball ${degTxt(dia)} wide at the middle distance, ${speed} m/s, from ${r3(PZ - near)} m to ${r3(PZ - far)} m away.`), maxDist: PZ - far };
    } });
  stem({ stem: "track-orbit", title: "Tracking — Orbit", skill: "Tracking",
    about: "The ball runs around a wide loop in front of you. Follow it smoothly. Trains curved tracking with a constant change of direction.",
    build: (t) => {
      const easy = t === "easy", dist = 19.2, z = z0(dist), dia = easy ? 3.4 : 2.2, Rx = easy ? 3 : 5, Ry = easy ? 2 : 2.4, speed = easy ? 3.5 : 7, cx = 0, cy = easy ? 3 : 3.3, n = 16;
      const way = Array.from({ length: n }, (_, i) => P(r3(cx + Rx * Math.cos((2 * Math.PI * i) / n)), r3(cy + Ry * Math.sin((2 * Math.PI * i) / n)), z));
      way.push(P(r3(way[0].x + 0.01), way[0].y, z));
      return tracking(dist, dia, way, speed, `Ball ${degTxt(dia)} wide, loop ${2 * Rx} m wide and ${2 * Ry} m tall, ${speed} m/s.`);
    } });
}

// =============================================================================================================================================
// Round 2 (sort 249 and up). Appended after the first 22 drills, so the files above are untouched.
// =============================================================================================================================================

// --- Reaction: a dispatcher lights fixed points one after another (the lobby calls this "N points light up in turn") ---------------------------
// Each route is a point (point: true) at a place `at`; `stay` is how long it stays lit before it leaves (an expired point costs points).
{
  const lights = (name, order, dist, dia, pts, stay, penalty, tun) => {
    const routes = pts.map((at) => ({ templateId: "actor-1", streak: [1, 1], at, point: true, stay: [stay, stay] }));
    const dispatcher = { id: "dispatcher-1", name, routes, order, maxAlive: 1, interval: [0.08, 0.2], faceTarget: false };
    return { dist, dia, dispatcher, behaviors: [], tunables: [tRadius(radiusAt(dist, dia)), tDispStay(stay), ...tun, tDuration], rules: { expiredPenalty: penalty } };
  };
  stem({ stem: "lightup-chain", title: "Reaction — Light chain", skill: "Reaction",
    about: "Six points on a row light up one after the other, from left to right and then back to the start. Shoot each one before it goes dark. Trains rhythm and a fast, calm switch to the next light.",
    build: (t) => {
      const easy = t === "easy", dist = 16, dia = easy ? 4.4 : 3, step = easy ? 9 : 12, stay = easy ? 1.6 : 0.9, n = 6;
      const pts = Array.from({ length: n }, (_, i) => P(r3((i - (n - 1) / 2) * stepAt(dist, step)), 2.2, z0(dist)));
      const b = lights("Light chain", "sequence", dist, dia, pts, stay, easy ? 100 : 200, []);
      return { ...b, note: `${n} points ${degTxt(step)} apart, balls ${degTxt(dia)} wide, each lit for ${stay} s, ${easy ? 100 : 200} points off for each one you miss.` };
    } });
  stem({ stem: "lightup-scatter", title: "Reaction — Light scatter", skill: "Reaction",
    about: "Nine points in a 3×3 square light up in a shuffled order, one at a time (Hard: two at a time). Shoot each before it goes dark. Trains reacting to a light you cannot predict.",
    build: (t) => {
      const easy = t === "easy", dist = 16, dia = easy ? 4 : 2.8, sx = easy ? 10 : 13, sy = 6, stay = easy ? 1.5 : 1.0;
      const pts = [];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) pts.push(P(r3((c - 1) * stepAt(dist, sx)), r3(3 - (r - 1) * stepAt(dist, sy)), z0(dist)));
      const b = lights("Light scatter", "shuffle", dist, dia, pts, stay, easy ? 100 : 200, [tDispAlive(4)]);
      b.dispatcher.maxAlive = easy ? 1 : 2;
      return { ...b, note: `9 points in a ${2 * sx}° × ${2 * sy}° square, balls ${degTxt(dia)} wide, ${easy ? "one" : "two"} lit at a time for ${stay} s each.` };
    } });
}

// --- Tracking: a swaying target and a target that strafes like a player (scoring "tracking": time on target, no button) ---------------------
{
  const swayTrack = (dist, dia, ax, ay, hz, cy, note) => {
    const spawner = areaSp({ dist, y: cy, alive: 1, delay: [0.2, 0.5] });
    return { dist, dia, spawner, behaviors: [{ kind: "sway", amplitude: { x: ax, y: ay }, frequency: hz, unit: "hz" }], tunables: [tRadius(radiusAt(dist, dia)), tDuration], tracking: true, note };
  };
  stem({ stem: "track-sway", title: "Tracking — Sway", skill: "Tracking",
    about: "The ball swings smoothly from side to side and up and down, like a pendulum. Keep the crosshair on it all round. Trains smooth, speed-matched tracking where you must slow down at each turn.",
    build: (t) => {
      const easy = t === "easy", dia = easy ? 3.6 : 2.4, ax = easy ? 3.5 : 5, ay = easy ? 0.9 : 1.4, hz = easy ? 0.18 : 0.3;
      return swayTrack(18, dia, ax, ay, hz, 3, `Ball ${degTxt(dia)} wide, swings ${2 * ax} m across and ${2 * ay} m up and down, ${hz} cycles per second.`);
    } });
  stem({ stem: "track-strafe", title: "Tracking — Player strafe", skill: "Tracking",
    about: "A ball moves like a player: it runs left and right, stops, taps and turns around at random. Stay on it through every stop and change of direction. Trains tracking an unpredictable human-like mover.",
    build: (t) => {
      const easy = t === "easy", dist = 16, dia = easy ? 3.8 : 2.6, speed = easy ? WALK : RUN;
      const strafe = easy
        ? { kind: "strafe", speed: [speed, speed], dwell: [0.2, 0.6], travel: [2, 3.5], counterStrafe: true }
        : { kind: "strafe", speed: [speed, speed], dwell: [0.05, 0.3], travel: [1.8, 3.5], tap: [0.35, 0.4, 1], counterStrafe: true };
      const spawner = areaSp({ dist, alive: 1, delay: [0.2, 0.5] });
      return { dist, dia, spawner, behaviors: [strafe], tunables: [tRadius(radiusAt(dist, dia)), tStrafe(speed), tDuration], tracking: true,
        note: `Ball ${degTxt(dia)} wide at ${speed} m/s, ${easy ? "steady stops" : "short random stops and taps"}.` };
    } });
}

// --- Moving: stop and shoot, a long-range sprint peek, a bounce wall, precision under movement --------------------------------------------
{
  // Counter-strafe trainer: the PLAYER moves (A / D), the balls stand still far apart on a row, and the weapon is NOT perfectly accurate (perfectAccuracy false),
  // so a shot fired while you are still running goes wide. Stop first, then shoot.
  stem({ stem: "stop-shoot", title: "Counter-strafe — Stop and shoot", skill: "Flicking",
    about: "You can move in this one. The balls stand far apart on a row, so you strafe over, stop, then shoot: shots fired while you are still running go wide. Trains the counter-strafe and shooting only once you are still.",
    build: (t) => {
      const easy = t === "easy", dist = 18, dia = easy ? 4.2 : 2.8, cols = easy ? 3 : 4, step = easy ? 26 : 22;
      const spawner = gridSp({ dist, cols, rows: 1, stepX: step, alive: 1 });
      return { dist, dia, spawner, behaviors: [respawn()], tunables: [tRadius(radiusAt(dist, dia)), tAlive(cols - 1), tSpacing(spawner), tDuration], playerMovable: true, perfectAccuracy: false,
        note: `Move with A and D. ${cols} balls ${degTxt(dia)} wide, ${degTxt(step)} apart, Vandal with real movement inaccuracy.` };
    } });
  stem({ stem: "sprint-peek", title: "Peek — Long-range sprint peek", skill: "Moving",
    about: "A small ball far down the range sprints across your view, stops for a blink and runs on; it is gone after a short time. Trains timing a shot on a distant, fast peeker.",
    build: (t) => {
      const easy = t === "easy", dist = 40, dia = easy ? 2.4 : 1.7, life = easy ? 2.2 : 1.3;
      const strafe = { kind: "strafe", speed: [FAST, FAST], dwell: easy ? [0.08, 0.2] : [0.03, 0.12], travel: [4, 7], counterStrafe: true };
      const decay = { kind: "decay", lifetime: life, growTime: 0.1, minScale: 0.6 };
      const spawner = areaSp({ dist, wMeters: 10, hMeters: 0, alive: 1, delay: [0.25, 0.6] });
      return { dist, dia, spawner, behaviors: [strafe, decay, respawn([0.25, 0.6])], tunables: [tRadius(radiusAt(dist, dia)), tStrafe(FAST), tLifetime(life), tDuration],
        rules: { expiredPenalty: easy ? 100 : 150 },
        note: `Ball ${degTxt(dia)} wide, 40 m away, ${FAST} m/s, gone after ${life} s, ${easy ? 100 : 150} points off for each one that gets away.` };
    } });
  // Bounce wall: a ball ricochets off the edges of a box at an angle (a real billiard path: it reflects, it does not zig-zag).
  const ricochet = (wx, lo, hi, dx, dy, bounces, z) => {
    let x = -wx, y = lo, sx = 1, sy = 1;
    const pts = [P(x, y, z)];
    for (let i = 0; i < bounces; i++) {
      const tx = (sx > 0 ? wx - x : x + wx) / dx, ty = (sy > 0 ? hi - y : y - lo) / dy, t = Math.min(tx, ty);
      x += sx * dx * t; y += sy * dy * t;
      pts.push(P(r3(x), r3(y), z));
      if (tx <= ty + 1e-9) sx = -sx;
      if (ty <= tx + 1e-9) sy = -sy;
    }
    pts.push(P(r3(pts[0].x + 0.01), pts[0].y, z)); // closes the loop like the other path drills
    return pts;
  };
  stem({ stem: "bounce-wall", title: "Bounce — Wall rush", skill: "Moving",
    about: "A ball ricochets off the edges of a wide wall like a billiard ball and speeds on. Hit it as it goes. Trains reading a bounce, so you aim where the ball will be after it turns.",
    build: (t) => {
      const easy = t === "easy", dist = 20, dia = easy ? 4 : 2.8, z = z0(dist), wx = 8, lo = 1.3, hi = 4.4, speed = easy ? 7 : 11;
      const way = ricochet(wx, lo, hi, 1, easy ? 0.42 : 0.68, 9, z);
      const spawner = areaSp({ dist, x: -wx, y: lo, alive: 1, delay: [0.15, 0.35] });
      return { dist, dia, spawner, behaviors: [{ kind: "path", waypoints: way, loop: true, speed }, respawn([0.15, 0.35])], tunables: [tRadius(radiusAt(dist, dia)), tDuration],
        note: `Ball ${degTxt(dia)} wide at ${speed} m/s over a ${2 * wx} m × ${r3(hi - lo)} m box.` };
    } });
  stem({ stem: "move-precision", title: "Precision — Under movement", skill: "Moving",
    about: "A small ball swings slowly left and right and up and down. It is easy to follow and hard to hit exactly. Trains placing a precise shot on a target that never quite stands still.",
    build: (t) => {
      const easy = t === "easy", dist = 14, dia = easy ? 1.8 : 1.1, ax = easy ? 3 : 3.5, ay = easy ? 0.5 : 0.7, hz = easy ? 0.16 : 0.26;
      const sway = { kind: "sway", amplitude: { x: ax, y: ay }, frequency: hz, unit: "hz" };
      const spawner = areaSp({ dist, y: 2.4, alive: 1, delay: [0.15, 0.3] });
      return { dist, dia, spawner, behaviors: [sway, respawn([0.15, 0.3])], tunables: [tRadius(radiusAt(dist, dia)), tDuration],
        note: `Ball ${degTxt(dia)} wide, swings ${2 * ax} m across, ${hz} cycles per second.` };
    } });
}

// --- Spray control: hold the trigger on a ball with a lot of health (Vandal and Phantom, real recoil) --------------------------------------
{
  const spray = (weapon, dist, dia, health, ax, ay, hz, note) => {
    const sway = { kind: "sway", amplitude: { x: ax, y: ay }, frequency: hz, unit: "hz" };
    const spawner = areaSp({ dist, y: 2.2, alive: 1, delay: [0.2, 0.4] });
    return { dist, dia, spawner, behaviors: [sway, respawn([0.2, 0.4])], tunables: [tRadius(radiusAt(dist, dia)), tDuration], weapon, fireMode: "hold", perfectAccuracy: false, health, note };
  };
  stem({ stem: "spray-vandal", title: "Spray — Vandal control", skill: "Moving",
    about: "A big ball drifts slowly and has a lot of health. Hold the trigger with the Vandal and pull the recoil back down onto the ball until it falls. Trains Vandal spray control.",
    build: (t) => {
      const easy = t === "easy", dist = easy ? 18 : 26, dia = easy ? 5 : 3.2, health = easy ? 240 : 420;
      return spray("vandal", dist, dia, health, easy ? 2.5 : 4, easy ? 0.4 : 0.6, easy ? 0.1 : 0.16, `Vandal, ball ${degTxt(dia)} wide at ${dist} m, ${health} health.`);
    } });
  stem({ stem: "spray-phantom", title: "Spray — Phantom control", skill: "Moving",
    about: "A big, tough ball drifts slowly. Hold the trigger with the Phantom and keep the spray on it; the Trains long, steady Phantom sprays. See also Burst control.",
    build: (t) => {
      const easy = t === "easy", dist = easy ? 20 : 28, dia = easy ? 5 : 3.4, health = easy ? 600 : 900;
      return spray("phantom", dist, dia, health, easy ? 2.5 : 4, easy ? 0.4 : 0.6, easy ? 0.1 : 0.16, `Phantom, ball ${degTxt(dia)} wide at ${dist} m, ${health} health.`);
    } });
}

// ---- documents ----------------------------------------------------------------------------------------------------------------------------
// Balls never dip below the floor: a tall area or grid is lifted until its lowest ball (and any sway) clears it by 0.4 m.
function spawnerOf(built, radius, tracking) {
  const sp = { id: "spawner-1", actorTemplateId: "actor-1", ...built.spawner, position: { ...built.spawner.position } };
  if (!tracking) {
    const sway = built.behaviors.find((b) => b.kind === "sway");
    sp.position.y = Math.max(sp.position.y, r3(0.4 + radius + sp.size.y / 2 + (sway ? sway.amplitude.y : 0)));
  }
  return sp;
}

export function docOf(name, s, built) {
  const seed = parseInt(codeOf(name).slice(0, 7), 16);
  const radius = radiusAt(built.dist, built.dia);
  const reach = built.maxDist ?? built.dist;
  const gridSize = reach > 20 ? 2 * Math.ceil((reach + 10) / 3) * 3 : 42; // keep the 1.5 m cells; a bigger floor only when targets get far
  const tracking = built.tracking === true;
  const actor = { id: "actor-1", name: "Target", body: { shape: "sphere", headSize: 1, bodyWidth: 0.44, bodyHeight: 0, radius }, color: "#ff4655", behaviors: built.behaviors,
    ...(tracking ? { hitSlow: true } : {}), ...(built.health ? { health: built.health } : {}) };
  return {
    schemaVersion: 2,
    meta: { id: "scene-" + seed, name, seed, createdAt: 0 },
    environment: { skyColor: "#000000", fogNear: 50, fogFar: 140, ambientIntensity: 1.55, keyLightIntensity: 2.2,
      grid: { size: gridSize, divisions: Math.round(gridSize / 1.5), centerColor: "#ffffff", gridColor: "#0091ff", position: P(0, -0.02, PZ) } },
    blocks: [{ id: "ground", shape: "plane", position: P(-0.2, -13.6, -8.8), rotationY: 0, size: P(40, 0.4, 45), color: "#18222b", collidable: true, transparent: true }],
    playerSpawn: { position: P(0, 0, PZ), yaw: 0 },
    spawners: built.dispatcher ? [] : [spawnerOf(built, radius, tracking)],
    actors: [actor],
    ...(built.dispatcher ? { dispatchers: [built.dispatcher] } : {}),
    rules: {
      duration: 60, scoring: tracking ? "tracking" : "clicking", weapon: built.weapon || "vandal", playerMovable: built.playerMovable === true,
      fireMode: built.fireMode || (tracking ? "hold" : "single"), ...(tracking ? { targetsInvincible: true } : {}),
      perfectAccuracy: built.perfectAccuracy ?? true, ...(built.rules || {}), tunables: built.tunables,
    },
  };
}

// Every scene of the set: { file, name, sort, description, stem, tier, skill, doc }.
export function allScenes() {
  const out = [];
  STEMS.forEach((s, i) => {
    ["easy", "hard"].forEach((tier, k) => {
      const name = (tier === "easy" ? "Easy-" : "Hard-") + s.title;
      const built = s.build(tier);
      out.push({ file: `workshop-${s.stem}-${tier}`, name, sort: FIRST_SORT + i * 2 + k, stem: s.stem, tier, skill: s.skill, built,
        description: `${s.about} ${tier === "easy" ? "Easy" : "Hard"}: ${built.note}`, doc: docOf(name, s, built) });
    });
  });
  return out;
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const s of allScenes()) {
    const shareCode = codeOf(s.name), docText = JSON.stringify(s.doc), docBytes = Buffer.byteLength(docText, "utf-8");
    const common = { name: s.name, description: s.description, shareCode, sceneKey: "set-" + shareCode, createTime: NOW, updateTime: NOW, docBytes, playCount: 0, status: 1, featured: false, parSeconds: null };
    const data = {
      item: { ...common, mapId: null, sort: s.sort, type: "ball" },
      scene: { ...common, schemaVersion: 2, blockCount: 1, authorNickname: "openVaim", authorUid: "openvaim", sceneHash: crypto.createHash("sha1").update(docText).digest("hex").slice(0, 16), doc: s.doc },
    };
    fs.writeFileSync(path.join(OUT, s.file + ".json"), JSON.stringify(data, null, 2) + "\n");
    console.log("wrote scenarios/" + s.file + ".json  " + shareCode);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
