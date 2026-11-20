// Writes the Valorant Workshop scenarios (situations from real Valorant rounds, humanoid bots on the real maps) into scenarios/.
//   node tools/make-valorant-scenes.mjs          write scenarios/valorant-*.json, then run:  node scripts/build-scenarios.mjs
//   node tools/make-valorant-scenes.mjs --dry    build and check everything, write nothing, print what each scenario is
// Re-runnable and deterministic: the same files come out every time (a seeded random generator stands in for Math.random while the
// Studio compiler runs, and every coordinate is taken from a scenario that is already in scenarios/).
//
// How a scenario is made
//  1. Positions are never guessed. `readBank(file)` reads an existing scenario on the same map and hands out its player start, its
//     peek routes (hiding point -> peek spot), its holders and strafers. `pickSpread` chooses holder spots that the map data says the
//     player can see from the start. Everything is then checked against the map's walkable floor (tools/valorant-map-kit.mjs).
//  2. The situation is written as a Studio drill (app/studio/drill.js: bots with a move, a rank, trades, flashes, swing triggers,
//     sound areas) and compiled by the Studio's own compile(), so the swing / sound / trade fields are exactly what the Studio writes.
//  3. The scene must pass the game's own validator (app/site/next/js/D_iGclxB.js) or nothing is written.
// Outputs never collide with the existing files: every file is valorant-<map>-<situation>[-easy|-hard].json, sort 300-399, names start
// with the map. <stem>-easy / <stem>-hard pairs are one drill at two difficulties (app/sibling-switch.js).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadMapKit, loadGameCheck, walkable, yawTo, dist2 } from "./valorant-map-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCENARIOS = path.join(ROOT, "scenarios");
const NOW = "2026-11-20 12:00:00";
export const SORT_BASE = 300;
export const FILE_PREFIX = "valorant-";
const hex16 = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
export const shareCodeOf = (name) => hex16("aimlocal-set:" + name); // the recipe in docs/scenario-format.md
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const deg = (rad) => (rad * 180) / Math.PI;

const D = await import(pathToFileURL(path.join(ROOT, "app", "studio", "drill.js")).href);

// ---------- existing scenarios as a bank of known-good positions ----------
const bankCache = new Map();
export function readBank(file) {
  if (bankCache.has(file)) return bankCache.get(file);
  const data = JSON.parse(fs.readFileSync(path.join(SCENARIOS, file + ".json"), "utf8"));
  const doc = typeof data.scene.doc === "string" ? JSON.parse(data.scene.doc) : data.scene.doc;
  const at = new Map(); // actor id -> where it stands
  for (const s of doc.spawners) at.set(s.actorTemplateId + "#" + s.id, { id: s.actorTemplateId, x: s.position.x, y: s.kind === "area" && s.groundSnap ? s.position.y - 0.3 : s.position.y, z: s.position.z });
  for (const d of doc.dispatchers || []) for (const r of d.routes) if (r.at) at.set(r.templateId, { id: r.templateId, x: r.at.x, y: r.at.y, z: r.at.z });
  const byId = new Map(doc.actors.map((a) => [a.id, a]));
  const bank = {
    file, map: doc.environment.map,
    start: { x: doc.playerSpawn.position.x, y: doc.playerSpawn.position.y, z: doc.playerSpawn.position.z, facing: deg(doc.playerSpawn.yaw) },
    spots: [...at.values()].map((p) => ({ x: r2(p.x), y: r2(p.y), z: r2(p.z), id: p.id, crouch: !!(byId.get(p.id) && byId.get(p.id).body.motion === "crouch") })),
    peek(id) {
      const a = byId.get(id), c = a && a.behaviors.find((b) => b.kind === "cross");
      if (!c) throw new Error(`${file}: ${id} is not a peeker`);
      const w = c.waypoints, flash = c.flashStops && c.flashStops[0];
      // A flashing peeker's route is cover, the point where it throws, then the peek spot.
      const spot = flash ? w[Math.min(w.length - 1, flash.at + 1)] : w[1];
      const p = (q) => ({ x: r2(q.x), y: r2(q.y), z: r2(q.z) });
      return { cover: p(w[0]), spot: p(spot), flash: flash ? flash.agent || "phoenix" : null };
    },
    hold(id) {
      const found = [...at.values()].find((p) => p.id === id);
      if (!found) throw new Error(`${file}: ${id} has no spot`);
      return { x: r2(found.x), y: r2(found.y), z: r2(found.z) };
    },
  };
  bankCache.set(file, bank);
  return bank;
}

// ---------- choosing spots ----------
const bearing = (start, p) => { const d = deg(yawTo(start, p) - (start.facing * Math.PI) / 180); return ((d % 360) + 540) % 360 - 180; };
// Holder spots the player can see from the start, spread out in bearing. Deterministic: nearest first, each at least `minSep` degrees
// from the ones already taken, then returned left to right.
export function pickSpread(kit, start, spots, { n, minD = 8, maxD = 40, angMax = 70, minSep = 8 }) {
  const eye = { x: start.x, y: start.y, z: start.z };
  const ok = spots.filter((p) => {
    const d = dist2(start, p);
    return d >= minD && d <= maxD && Math.abs(bearing(start, p)) <= angMax && kit.standsOn(p, 0.5) && kit.sees(eye, p);
  }).sort((a, b) => dist2(start, a) - dist2(start, b) || a.x - b.x || a.z - b.z);
  const out = [];
  for (const p of ok) if (out.length < n && out.every((q) => Math.abs(bearing(start, p) - bearing(start, q)) >= minSep)) out.push(p);
  return out.sort((a, b) => bearing(start, a) - bearing(start, b));
}

// Pre-aim routes start far from most of their bots. To make a short drill from such a route, the player starts on one of the route's own
// floor spots (known walkable), turned toward the most bot spots the map data says are visible 10-40 m ahead. Deterministic.
export function bestStart(kit, bank, { minD = 10, maxD = 40, angMax = 60, minSep = 8, n = 3 } = {}) {
  let best = null;
  for (const c of bank.spots) {
    if (!kit.levelsAt(c.x, c.z).some((y) => Math.abs(y - c.y) < 0.25)) continue; // a real floor, not a box top
    for (let k = 0; k < 16; k++) {
      const start = { x: c.x, y: c.y, z: c.z, facing: k * 22.5 };
      const seen = pickSpread(kit, start, bank.spots, { n: 8, minD, maxD, angMax, minSep });
      if (seen.length < n) continue;
      const score = seen.length * 100 - Math.abs(seen.reduce((a, p) => a + bearing(start, p), 0)) / seen.length;
      if (!best || score > best.score) best = { score, start, seen };
    }
  }
  if (!best) throw new Error(bank.file + ": no start with " + n + " visible spots");
  // turn exactly toward the middle of what it sees
  const mean = best.seen.reduce((a, p) => a + bearing(best.start, p), 0) / best.seen.length;
  best.start.facing = r1(((best.start.facing - mean) % 360 + 360) % 360);
  return best.start;
}

// ---------- difficulty ----------
// Rank names are the Studio's (RANKS in drill.js): reaction time and aim error of the bots that shoot back.
const TIER = { easy: { rank: "bronze", die: false }, hard: { rank: "diamond", die: true } };

// ---------- bots ----------
let botNo = 0;
function bot(move, at, o = {}) {
  const b = D.newBot(move, at);
  b.id = "b" + ++botNo;
  Object.assign(b, { weapon: "vandal", shoots: "off", back: true, backAfter: 1.5 }, o);
  if (o.flash) b.flash = { ...D.newBot(move, at).flash, ...o.flash };
  return b;
}
const holder = (at, o = {}) => bot("still", at, o);
const strafer = (at, o = {}) => bot("strafe", at, o);
// A peeker: waits at `cover`, swings to `spot`. o.wait = seconds out in the open, o.coverWait = seconds behind cover.
function peeker(p, o = {}) {
  const route = [{ ...p.cover, wait: 0 }, { ...p.spot, wait: 1.2 }];
  const b = bot("peek", p.cover, { route, ...o });
  Object.assign(b, { x: p.cover.x, y: p.cover.y, z: p.cover.z });
  return b;
}
const spotsOf = (peeks) => peeks.map((p) => ({ x: p.cover.x, y: p.cover.y, z: p.cover.z, route: [{ ...p.cover, wait: 0 }, { ...p.spot, wait: 1.2 }] }));
// Swing radius for a partner that swings after the jiggler is hit: the radius is measured from the partner's own hiding place to the hit.
const reach = (jiggler, partner) => Math.ceil(dist2(jiggler.route ? jiggler.route[1] : jiggler, partner.cover) + 3);
const area = (start, half) => ({ x0: r1(start.x - half), z0: r1(start.z - half), x1: r1(start.x + half), z1: r1(start.z + half) });

// ---------- the scenarios ----------
// Each entry: { stem, map, title, tiers: { easy: describe(), hard: describe() } } or one `single`. `describe` gets the map kit and
// returns { desc, start, round, items, type?, shuffle? }. Items are the Studio drill's bots.
const SCENES = [];
const scene = (def) => SCENES.push(def);
const L = (s) => s; // marks plain-words text

// Sunset. Lower mid looks up at the long sightline to top mid; the creators' peek routes there are 2 to 6 m wide.
const SUNSET_LOWER_MID = "creator-sunset-lower-mid-hold-against-peekers";
const LOWER_MID_PEEKS = ["actor-1", "actor-1-spot2", "actor-1-spot3", "actor-1-spot4", "actor-1-spot5", "actor-1-spot6", "actor-1-spot7", "actor-1-spot8", "actor-1-spot9"];

scene({
  stem: "sunset-wide-swing-duel", map: "juliett", title: "Sunset — Wide-swing duel",
  tiers: {
    easy: () => {
      const b = readBank(SUNSET_LOWER_MID), peeks = LOWER_MID_PEEKS.map((id) => b.peek(id));
      const one = peeker(peeks[1], { shoots: "bronze", wait: 2.2, coverWait: 1.6, randomWait: 1, peekStrafe: false, spots: spotsOf([peeks[4], peeks[6]]) });
      return {
        start: b.start, round: { time: 60, die: false },
        desc: L("One enemy swings wide out of top mid from one of three hiding places, stops in the open and shoots. Hold your crosshair on the edge, then take the duel. 60 seconds, bots shoot slowly."),
        items: [one],
      };
    },
    hard: () => {
      const b = readBank(SUNSET_LOWER_MID), peeks = LOWER_MID_PEEKS.map((id) => b.peek(id));
      const one = peeker(peeks[5], { shoots: "diamond", wait: 1.5, coverWait: 0.7, randomWait: 1.5, peekStrafe: "random", peekWidth: 2.4, spots: spotsOf([peeks[0], peeks[2], peeks[7], peeks[8]]) });
      return {
        start: b.start, round: { time: 60, die: true },
        desc: L("One enemy swings wide from one of five hiding places in top mid and either strafes or stops, a different one each time. Fast, accurate bots, and dying ends the round."),
        items: [one],
      };
    },
  },
});

scene({
  stem: "sunset-jiggle-bait-read", map: "juliett", title: "Sunset — Jiggle bait",
  tiers: {
    easy: () => {
      const b = readBank(SUNSET_LOWER_MID), pk = (id) => b.peek(id);
      const jiggler = peeker(pk("actor-1-spot2"), { shoots: "bronze", wait: 0.45, coverWait: 1.2, randomWait: 1.5, peekStrafe: false });
      const realAt = pk("actor-1-spot4"), real = peeker(realAt, { shoots: "bronze", wait: 2, coverWait: 1, swingRadius: reach(jiggler, realAt), swingOn: "damage", swingMin: 0.6, swingMax: 1.1, swingChance: 100 });
      return { start: b.start, round: { time: 60, die: false }, items: [jiggler, real],
        desc: L("An enemy jiggles out of top mid for half a second. If you hit it, a second enemy swings out from the next hiding place a moment later. Learn to read the bait and not to over-commit.") };
    },
    hard: () => {
      const b = readBank(SUNSET_LOWER_MID), pk = (id) => b.peek(id);
      const jiggler = peeker(pk("actor-1-spot5"), { shoots: "diamond", wait: 0.3, coverWait: 0.6, randomWait: 1.2, peekStrafe: false });
      const realAt = pk("actor-1-spot4"), real = peeker(realAt, { shoots: "diamond", wait: 1.8, coverWait: 0.8, peekStrafe: true, swingRadius: reach(jiggler, realAt), swingOn: "damage", swingMin: 0.25, swingMax: 0.5, swingChance: 75 });
      return { start: b.start, round: { time: 60, die: true }, items: [jiggler, real],
        desc: L("A very short jiggle out of top mid. When you hit it, a second enemy usually (3 times in 4) swings in fast from the next hiding place, strafing. Dying ends the round.") };
    },
  },
});

scene({
  stem: "sunset-crossfire-trade", map: "juliett", title: "Sunset — Crossfire and trade",
  tiers: {
    easy: () => {
      const b = readBank(SUNSET_LOWER_MID), pk = (id) => b.peek(id);
      const first = peeker(pk("actor-1-spot2"), { shoots: "bronze", wait: 2.2, coverWait: 1.4, peekStrafe: false });
      const trade = peeker(pk("actor-1-spot4"), { shoots: "bronze", wait: 2.2, coverWait: 1, peekStrafe: false, tradeOf: first.id, tradeMin: 1.2, tradeMax: 1.8 });
      return { start: b.start, round: { time: 75, die: false }, items: [first, trade],
        desc: L("Two enemies on different sides of top mid. Kill the first and its partner swings in about a second and a half later to trade. Be ready to swing your aim to the second angle.") };
    },
    hard: () => {
      const b = readBank(SUNSET_LOWER_MID), pk = (id) => b.peek(id);
      const first = peeker(pk("actor-1-spot2"), { shoots: "diamond", wait: 1.8, coverWait: 0.8, peekStrafe: true });
      const trade = peeker(pk("actor-1-spot9"), { shoots: "diamond", wait: 1.8, coverWait: 0.8, peekStrafe: true, tradeOf: first.id, tradeMin: 0.25, tradeMax: 0.5, tradeStart: true, tradeStartMin: 2, tradeStartMax: 5 });
      return { start: b.start, round: { time: 75, die: true }, items: [first, trade],
        desc: L("A crossfire from both sides of top mid. The second enemy also swings in on its own a few seconds into the round, and when you kill the first it trades within half a second.") };
    },
  },
});

const SUNSET_A = "creator-sunset-a";
scene({
  stem: "sunset-a-clear-in-order", map: "juliett", title: "Sunset — A site, clear in order",
  tiers: {
    easy: (kit) => {
      const b = readBank(SUNSET_A), spots = pickSpread(kit, b.start, b.spots, { n: 5, minD: 10, maxD: 46, angMax: 120, minSep: 8 });
      return { start: b.start, round: { time: 75, die: false }, items: spots.map((p) => holder(p, { shoots: "bronze", back: false })),
        desc: L("Five enemies hold different angles on the way into A site, near ones and far ones. Clear one angle at a time, nearest first, and do not let a second one see you while you fight the first. They shoot slowly and do not come back.") };
    },
    hard: (kit) => {
      const b = readBank(SUNSET_A), spots = pickSpread(kit, b.start, b.spots, { n: 7, minD: 12, maxD: 48, angMax: 120, minSep: 7 });
      return { start: b.start, round: { time: 75, die: true }, items: spots.map((p, i) => (i % 3 === 1 ? strafer(p, { shoots: "diamond", back: false, width: 1.4 }) : holder(p, { shoots: "diamond", back: false, crouch: i % 3 === 2 }))),
        desc: L("Seven enemies on the A site angles, some crouching and some with a small strafe, and they hit you fast. Clear each angle and know where the next one is. They do not come back, and dying ends the round.") };
    },
  },
});

scene({
  stem: "sunset-a-sound-swing-postplant", map: "juliett", title: "Sunset — A site, they swing on sound",
  tiers: {
    easy: () => {
      const b = readBank("creator-sunset-hold-site"), pk = (id) => b.peek(id);
      const box = area(b.start, 7);
      const mk = (p, delay, chance) => {
        const x = peeker(p, { shoots: "bronze", wait: 2, peekStrafe: false, backAfter: 4 });
        x.soundRule = { on: true, area: box, spot: { x: p.cover.x, y: p.cover.y, z: p.cover.z, route: [{ ...p.cover, wait: 0 }, { ...p.spot, wait: 1.2 }] }, sources: ["shot", "footstep"], delayMin: delay[0], delayMax: delay[1], swingChance: chance };
        return x;
      };
      return { start: b.start, round: { time: 90, die: false },
        items: [mk(pk("actor-1"), [0.8, 1.6], 70), mk(pk("actor-4"), [1.2, 2.2], 70)],
        desc: L("You defend the site after the plant. Two attackers wait out of sight and swing when they hear you shoot or run within about 7 metres of where you stand, about 7 times in 10. Crouch-walk or stand still to stay quiet.") };
    },
    hard: () => {
      const b = readBank("creator-sunset-hold-site"), pk = (id) => b.peek(id);
      const box = area(b.start, 9);
      const mk = (p, delay, chance, sources) => {
        const x = peeker(p, { shoots: "diamond", wait: 1.6, peekStrafe: true, backAfter: 3 });
        x.soundRule = { on: true, area: box, spot: { x: p.cover.x, y: p.cover.y, z: p.cover.z, route: [{ ...p.cover, wait: 0 }, { ...p.spot, wait: 1.2 }] }, sources, delayMin: delay[0], delayMax: delay[1], swingChance: chance };
        return x;
      };
      return { start: b.start, round: { time: 90, die: true },
        items: [mk(pk("actor-1"), [0.25, 0.6], 100, ["shot", "footstep", "land"]), mk(pk("actor-4"), [0.4, 0.9], 85, ["shot", "footstep"]), mk(pk("actor-2"), [0.6, 1.4], 85, ["footstep"])],
        desc: L("Post-plant defence against three attackers that swing as soon as they hear you shoot, run or land within about 9 metres of your spot. Fast, accurate bots; dying ends the round. Make as little noise as you can and take the swings one at a time.") };
    },
  },
});

scene({
  stem: "sunset-a-spray-transfer", map: "juliett", title: "Sunset — A site, spray transfer",
  tiers: {
    easy: () => {
      const b = readBank(SUNSET_A);
      return { start: b.start, round: { time: 60, die: false },
        items: [holder({ x: 30.5, y: 1, z: -12 }, { shoots: "bronze" }), holder({ x: 33.5, y: 1, z: -10.5 }, { shoots: "bronze" }), holder({ x: 36.1, y: 1, z: -5.5 }, { shoots: "bronze" })],
        desc: L("Three enemies stand a few metres apart on A site, about 25 metres away. Kill one and move your crosshair to the next without stopping the spray. Bots shoot slowly and come back after a moment.") };
    },
    hard: () => {
      const b = readBank(SUNSET_A);
      return { start: b.start, round: { time: 60, die: true },
        items: [holder({ x: 30.5, y: 1, z: -12 }, { shoots: "diamond", back: true, backAfter: 1.2 }), strafer({ x: 33.5, y: 1, z: -10.5 }, { shoots: "diamond", width: 1.4, backAfter: 1.2 }), holder({ x: 36.1, y: 1, z: -5.5 }, { shoots: "diamond", crouch: true, backAfter: 1.2 })],
        desc: L("Three accurate enemies close together on A site: one standing, one strafing, one crouching. Transfer your spray between them fast. Dying ends the round.") };
    },
  },
});

// Ascent. Mid is a long sightline across the courtyard; the creators' sniper drill has a 7 m wide peek there.
const ASC_MID = "creator-ascent-mid-hold-snipers";
scene({
  stem: "ascent-mid-operator-hold", map: "ascent", title: "Ascent — Mid, Operator hold",
  tiers: {
    easy: () => {
      const b = readBank(ASC_MID);
      return { start: b.start, round: { time: 90, die: false, weapon: "operator" },
        items: [peeker(b.peek("actor-3"), { shoots: "bronze", wait: 2.4, coverWait: 2, randomWait: 2, peekStrafe: false })],
        desc: L("You hold mid with an Operator. One rifleman makes a wide swing across the open, stops and shoots. Hold the scope on the edge and take the shot as it appears. 90 seconds, bots shoot slowly.") };
    },
    hard: () => {
      const b = readBank(ASC_MID);
      const p = b.peek("actor-3");
      return { start: b.start, round: { time: 90, die: true, weapon: "operator" },
        items: [peeker(p, { shoots: "diamond", wait: 1.6, coverWait: 0.9, randomWait: 1.5, peekStrafe: true, peekWidth: 3 }),
          holder(b.hold("actor-2"), { shoots: "diamond", crouch: true, back: true, backAfter: 3 })],
        desc: L("You hold mid with an Operator against a fast, strafing wide swing, while a second enemy sits crouched at a side angle and covers it. Scope, shoot, and do not get greedy. Dying ends the round.") };
    },
  },
});
scene({
  stem: "ascent-mid-marshal-quick-scope", map: "ascent", title: "Ascent — Mid, Marshal quick-scope",
  single: () => {
    const b = readBank(ASC_MID), p = b.peek("actor-3");
    return { start: b.start, round: { time: 75, die: true, weapon: "marshal" },
      items: [peeker(p, { weapon: "marshal", shoots: "platinum", wait: 1.1, coverWait: 0.6, randomWait: 1.2, peekStrafe: true, peekWidth: 2.4 }),
        holder(b.hold("actor-2"), { shoots: "platinum", back: true, backAfter: 2.5 })],
      desc: L("A Marshal duel in mid: the enemy that swings out and strafes also has a Marshal, and a rifleman holds the side angle. Quick-scope them both. One body shot is not a kill, so aim for the head or shoot twice. Dying ends the round.") };
  },
});

// Ascent dock: flashes from four spots that the creators placed (phoenix, KAY/O, Reyna).
const ASC_DOCK = "ascent-dock-hold-vs-flashes-hard";
scene({
  stem: "ascent-dock-flash-timing", map: "ascent", title: "Ascent — Dock, flash timing", type: "flash",
  tiers: {
    easy: () => {
      const b = readBank(ASC_DOCK);
      const a = peeker(b.peek("actor-2"), { shoots: "bronze", flash: { on: true, agent: "phoenix", curve: "right", wait: 1.6, height: 2.2 }, back: true, backAfter: 3, look: "phoenix" });
      const c = peeker(b.peek("actor-3"), { shoots: "bronze", flash: { on: true, agent: "reyna", wait: 1.6, height: 2.2 }, back: true, backAfter: 3, delay: 3, look: "reyna" });
      return { start: b.start, round: { time: 90, die: false }, items: [a, c],
        desc: L("Two attackers throw flashes at the dock and wait a long moment before they swing. Turn away or look away from the pop, then come back and take the fight. The first flash comes at once, the second three seconds later.") };
    },
    hard: () => {
      const b = readBank(ASC_DOCK);
      const mk = (id, agent, wait, delay, extra = {}) => peeker(b.peek(id), { shoots: "diamond", flash: { on: true, agent, wait, height: 2.2, ...(agent === "phoenix" ? { curve: "left" } : {}) }, back: true, backAfter: 2, delay, look: agent, ...extra });
      return { start: b.start, round: { time: 90, die: true },
        items: [mk("actor-1", "kayo", 0.35, 0), mk("actor-2", "phoenix", 0.5, 2), mk("actor-3", "reyna", 0.9, 4), mk("actor-4", "reyna", 0.3, 6)],
        desc: L("Four flashers at the dock, each with a different wait before they swing (0.3 to 0.9 seconds), so you have to turn away at the right moment and not at a fixed rhythm. Fast, accurate bots; dying ends the round.") };
    },
  },
});

// Haven. A site flashers from four spots.
const HAV_A = "haven-a-site-hold-vs-flashes-easy";
scene({
  stem: "haven-a-site-flash-and-swing", map: "triad", title: "Haven — A site, flash and swing", type: "flash",
  tiers: {
    easy: () => {
      const b = readBank(HAV_A);
      const flasher = peeker(b.peek("actor-1"), { shoots: "bronze", flash: { on: true, agent: "phoenix", curve: "right", wait: 1.4, height: 2.2 }, look: "phoenix", backAfter: 3 });
      const entry = peeker(b.peek("actor-2"), { shoots: "bronze", peekStrafe: false, wait: 2, delay: 1.3, backAfter: 3 });
      return { start: b.start, round: { time: 75, die: false }, items: [flasher, entry],
        desc: L("One attacker flashes you and a second swings in about a second after the pop, straight into your blind. Look away on the flash, then clear the entry angle. Bots shoot slowly. The timing is exact in the first moments of a round and drifts as they come back.") };
    },
    hard: () => {
      const b = readBank(HAV_A);
      const f1 = peeker(b.peek("actor-1"), { shoots: "diamond", flash: { on: true, agent: "phoenix", curve: "left", wait: 0.5, height: 2.2 }, look: "phoenix", backAfter: 2 });
      const f2 = peeker(b.peek("actor-3"), { shoots: "diamond", flash: { on: true, agent: "phoenix", curve: "right", wait: 0.6, height: 2.2 }, look: "phoenix", delay: 2.5, backAfter: 2 });
      const e1 = peeker(b.peek("actor-2"), { shoots: "diamond", peekStrafe: true, wait: 1.6, delay: 0.9, backAfter: 2 });
      const e2 = peeker(b.peek("actor-4"), { shoots: "diamond", peekStrafe: true, wait: 1.6, delay: 3.4, backAfter: 2 });
      return { start: b.start, round: { time: 75, die: true }, items: [f1, e1, f2, e2],
        desc: L("Two flash-and-swing pairs from different angles, the second pair a few seconds after the first. Each swinger comes in a second or so after its pop. Fast, accurate bots; dying ends the round.") };
    },
  },
});

const HAV_C = "creator-haven-c-holding-immortal-op";
scene({
  stem: "haven-c-long-sniper-duel", map: "triad", title: "Haven — C Long, sniper duel",
  tiers: {
    easy: () => {
      const b = readBank(HAV_C);
      return { start: b.start, round: { time: 90, die: false, weapon: "operator" },
        items: [holder(b.hold("actor-1"), { weapon: "operator", shoots: "silver", back: true, backAfter: 2.5 })],
        desc: L("A long Operator-versus-Operator duel down C Long, about 43 metres. The enemy holds one angle and shoots a little slowly. Scope in, find it, shoot first.") };
    },
    hard: () => {
      const b = readBank(HAV_C);
      return { start: b.start, round: { time: 90, die: true, weapon: "operator" },
        items: [strafer(b.hold("actor-1"), { weapon: "operator", shoots: "immortal", width: 1.6, unpredictable: true, back: true, backAfter: 2.5 })],
        desc: L("The Operator at the end of C Long jiggles side to side with unpredictable stops and shoots almost at once when you scope. Time your shot on a stop. Dying ends the round.") };
    },
  },
});

// Bind. A Short, pre-aim spots from the official route.
const BIND_SHORT = "bind-a-attack-through-a-short-hard";
scene({
  stem: "bind-a-lamps-dry-peek", map: "duality", title: "Bind — A Lamps, dry peek",
  tiers: {
    easy: (kit) => {
      const b = readBank(BIND_SHORT), start = bestStart(kit, b, { n: 3 }), spots = pickSpread(kit, start, b.spots, { n: 2, minD: 10, maxD: 34, angMax: 75, minSep: 12 });
      return { start, round: { time: 75, die: false }, items: spots.map((p) => holder(p, { shoots: "bronze", back: true, backAfter: 2.5 })),
        desc: L("You dry-peek out of Lamps into two defenders on A site who are already aiming at the corner. Show just enough of yourself to see them, shoot, and step back. They shoot slowly and return after a few seconds.") };
    },
    hard: (kit) => {
      const b = readBank(BIND_SHORT), start = bestStart(kit, b, { n: 3 }), spots = pickSpread(kit, start, b.spots, { n: 3, minD: 10, maxD: 38, angMax: 80, minSep: 10 });
      const a = holder(spots[0], { shoots: "diamond", backAfter: 2 });
      const items = [a, ...spots.slice(1, 3).map((p, i) => holder(p, { shoots: "diamond", crouch: i === 0, backAfter: 2, ...(i === 1 ? { tradeOf: a.id, tradeMin: 0.3, tradeMax: 0.55 } : {}) }))];
      return { start, round: { time: 75, die: true }, items,
        desc: L("Three accurate defenders on A site as you come out of Lamps. When you kill the first, the third swings in within half a second to trade you. Dying ends the round. Peek with a plan for the trade.") };
    },
  },
});

// Corrode. A Main corner, bots that strafe like players.
const COR_A = "corrode-a-main-attack-pre-aim-hard";
scene({
  stem: "corrode-a-corner-counter-strafe", map: "rook", title: "Corrode — A Corner, counter-strafe test",
  tiers: {
    easy: (kit) => {
      const b = readBank(COR_A), start = bestStart(kit, b, { n: 3 }), spots = pickSpread(kit, start, b.spots, { n: 2, minD: 10, maxD: 32, angMax: 80, minSep: 12 });
      return { start, round: { time: 60, die: false }, items: spots.map((p) => strafer(p, { shoots: "bronze", width: 2, back: true, backAfter: 2 })),
        desc: L("Two enemies strafe side to side and stop to shoot, like real players. Shoot only when you have stopped: stop on the key press, then fire. Bots shoot slowly.") };
    },
    hard: (kit) => {
      const b = readBank(COR_A), start = bestStart(kit, b, { n: 3 }), spots = pickSpread(kit, start, b.spots, { n: 3, minD: 10, maxD: 36, angMax: 90, minSep: 10 });
      return { start, round: { time: 60, die: true }, items: spots.map((p) => strafer(p, { shoots: "ascendant", width: 3, unpredictable: true, back: true, backAfter: 1.5 })),
        desc: L("Three accurate enemies with unpredictable strafes and quick stops. Run-and-gun loses this: counter-strafe, tap, shoot. Dying ends the round.") };
    },
  },
});

// Split. B retake from CT with bots that show up one after the other.
const SPL_B = "split-b-retake-from-ct-hard";
scene({
  stem: "split-b-retake-staggered", map: "bonsai", title: "Split — B retake, staggered defenders",
  tiers: {
    easy: (kit) => {
      const b = readBank(SPL_B), start = b.start, spots = pickSpread(kit, start, b.spots, { n: 3, minD: 8, maxD: 36, angMax: 90, minSep: 12 });
      return { start, round: { time: 75, die: false }, items: spots.map((p, i) => holder(p, { shoots: "bronze", delay: i * 2.5, back: false })),
        desc: L("You retake B with three defenders that show up one after another, two and a half seconds apart. Do not wait for all of them: deal with each as it appears. They shoot slowly and do not come back.") };
    },
    hard: (kit) => {
      const b = readBank(SPL_B), spots = pickSpread(kit, b.start, b.spots, { n: 4, minD: 8, maxD: 40, angMax: 100, minSep: 10 });
      return { start: b.start, round: { time: 75, die: true }, items: spots.map((p, i) => holder(p, { shoots: "diamond", delay: i * 1.5, crouch: i === 2, back: false })),
        desc: L("Four accurate defenders show up at different angles a second and a half apart, so you are fighting one while the next appears. They do not come back, and dying ends the round.") };
    },
  },
});

// Lotus. C Long: two shooters on a crossfire from the creators' sniper spots.
const LOT_C = "creator-lotus-c-hold-long-againt-op";
scene({
  stem: "lotus-c-long-crossfire", map: "jam", title: "Lotus — C Long, two-angle crossfire",
  tiers: {
    easy: () => {
      const b = readBank(LOT_C);
      return { start: b.start, round: { time: 75, die: false },
        items: [holder(b.hold("actor-1-spot6"), { shoots: "bronze" }), holder(b.hold("actor-1-spot7"), { shoots: "bronze", crouch: true })],
        desc: L("Two defenders cover C Long from different angles, 20 and 30 metres away. Clear the near one and keep your crosshair for the far one. They shoot slowly and return after a moment.") };
    },
    hard: () => {
      const b = readBank(LOT_C);
      const a = holder(b.hold("actor-1-spot6"), { shoots: "diamond", backAfter: 1.5 });
      return { start: b.start, round: { time: 75, die: true },
        items: [a, holder(b.hold("actor-1-spot7"), { shoots: "diamond", crouch: true, backAfter: 1.5 }), holder(b.hold("actor-1-spot12"), { shoots: "diamond", backAfter: 1.5, tradeOf: a.id, tradeMin: 0.3, tradeMax: 0.6 })],
        desc: L("Three accurate defenders on C Long at 20 to 30 metres. When you kill the first, the one on the high ground swings in to trade within a second. Dying ends the round.") };
    },
  },
});

// Summit. Rotators run across B Main on a timer: pick them off from where you stand.
scene({
  stem: "summit-b-main-rotators", map: "plummet", title: "Summit — B Main, lurk timing",
  single: (kit) => {
    const b = readBank("summit-b-main-attack-bots-shoot-hard"), start = b.start, spots = pickSpread(kit, start, b.spots, { n: 6, minD: 10, maxD: 40, angMax: 90, minSep: 4 });
    // two runners: pairs of visible spots a few metres apart that are one walk apart (a short lane across your view)
    const lanes = [];
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
      const d = dist2(spots[i], spots[j]);
      if (d >= 6 && d <= 22 && Math.abs(spots[i].y - spots[j].y) < 0.3 && walkable(kit, spots[i], spots[j])) lanes.push([spots[i], spots[j], d]);
    }
    lanes.sort((a, c) => c[2] - a[2]);
    if (lanes.length < 1) throw new Error("summit-b-main-rotators: no walkable lane between visible spots");
    const runners = lanes.slice(0, 2).map(([p, q], i) => {
      const x = bot("cross", p, { shoots: "platinum", backAfter: 3, delay: i * 4, route: [{ ...p, wait: 0 }, { ...q, wait: 0 }] });
      Object.assign(x, { x: p.x, y: p.y, z: p.z });
      return x;
    });
    return { start, round: { time: 90, die: true }, items: runners,
      desc: L("You lurk and enemies rotate across the lane in front of you on a timer, every few seconds, shooting when they see you. Learn the rhythm: hold the crosshair where they will appear and shoot as they cross. Dying ends the round.") };
  },
});

// ---------- compile ----------
function withSeed(seed, fn) {
  const real = Math.random;
  let h = seed >>> 0;
  Math.random = () => { h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  try { return fn(); } finally { Math.random = real; }
}

const SNIPERS = new Set(["operator", "tourdeforce", "marshal", "outlaw"]);

export function expandScenes() {
  const out = [];
  for (const def of SCENES) {
    if (def.single) out.push({ stem: def.stem, map: def.map, title: def.title, make: def.single, type: def.type });
    else for (const tier of ["easy", "hard"]) out.push({ stem: `${def.stem}-${tier}`, map: def.map, title: `${def.title} (${tier === "easy" ? "Easy" : "Hard"})`, tier, make: def.tiers[tier], type: def.type });
  }
  return out;
}

export async function buildAll() {
  const gameCheck = await loadGameCheck();
  const kits = new Map();
  const kitOf = async (map) => { if (!kits.has(map)) kits.set(map, await loadMapKit(map)); return kits.get(map); };
  const results = [], seenNames = new Set(), seenCodes = new Set();
  let sort = SORT_BASE;
  for (const def of expandScenes()) {
    botNo = 0;
    const kit = await kitOf(def.map);
    const made = def.make(kit);
    const warnings = [];
    const drill = D.newDrill(def.map);
    drill.name = def.title;
    const s = made.start;
    drill.start = { x: s.x, y: s.y, z: s.z, facing: s.facing };
    drill.round = { ...drill.round, goal: "score", time: made.round.time, weapon: made.round.weapon || "vandal", auto: true, move: true, die: !!made.round.die, ammo: false, order: "together", atOnce: 1, gap: 1 };
    drill.items = made.items;
    // Every bot must stand on a floor of the map; a bot a long way from the player is worth a warning.
    for (const it of made.items) {
      const spots = it.route ? it.route : [it];
      for (const p of spots) if (!kit.standsOn(p)) throw new Error(`${def.stem}: (${p.x}, ${p.y}, ${p.z}) is not on the walkable floor of ${def.map}`);
      const seen = it.route ? it.route[1] : it;
      if (!kit.sees(s, seen) && !(it.soundRule && it.soundRule.on)) warnings.push(`no clear sight line from the start to (${seen.x}, ${seen.y}, ${seen.z})`);
    }
    const seed = parseInt(hex16(def.stem).slice(0, 7), 16);
    const compiled = withSeed(seed, () => D.compile(drill, (x, z, y) => kit.floorAt(x, z, y)));
    const doc = compiled.doc;
    doc.meta = { id: "studio-" + hex16("workshop:" + def.stem).slice(0, 16), name: def.title, seed, createdAt: 0 };
    const type = def.type || compiled.type;
    const text = JSON.stringify(doc);
    gameCheck(text); // throws when the game would refuse the scene
    const name = def.title;
    const shareCode = shareCodeOf(name);
    if (seenNames.has(name)) throw new Error("duplicate name " + name);
    if (seenCodes.has(shareCode)) throw new Error("duplicate shareCode for " + name);
    seenNames.add(name); seenCodes.add(shareCode);
    // What app/drill-shuffle.js changes each time the scenario starts: a fresh Jett model and a rifle for each bot; snipers and flashers keep theirs.
    const groups = made.items.map((it) => {
      const ids = doc.actors.filter((a) => a.name === D.itemName(drill, it) || (a.name || "").startsWith(D.itemName(drill, it) + " ")).map((a) => a.id);
      return { actors: ids, ...(it.flash && it.flash.on ? { keepLook: true } : {}), ...(SNIPERS.has(it.weapon) ? { keepWeapon: true } : {}) };
    }).filter((g) => g.actors.length);
    const item = {
      createTime: NOW, description: made.desc, docBytes: Buffer.byteLength(text), featured: false, mapId: def.map, name, parSeconds: null,
      playCount: 0, sceneKey: "set-" + shareCode, shareCode, sort: sort++, status: 1, type, updateTime: NOW,
    };
    const scene = {
      authorNickname: "openVaim", authorUid: "workshop", blockCount: doc.blocks.length, createTime: NOW, description: made.desc, docBytes: item.docBytes,
      name, playCount: 0, sceneHash: hex16(text), sceneKey: item.sceneKey, schemaVersion: 2, shareCode, updateTime: NOW, aimShuffle: { groups }, doc,
    };
    const where = made.items.map((it) => { const p = it.route ? it.route[1] : it; return `(${p.x}, ${p.y}, ${p.z}) ${Math.round(dist2(s, p))}m@${Math.round(bearing(s, p))}`; });
    results.push({ where, stem: def.stem, file: FILE_PREFIX + def.stem + ".json", data: { item, scene }, warnings, bots: made.items.length });
  }
  return results;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const results = await buildAll();
  fs.mkdirSync(SCENARIOS, { recursive: true });
  // Files of an earlier run whose scenario was renamed or dropped would be stale duplicates: remove them.
  const wanted = new Set(results.map((r) => r.file));
  for (const f of fs.readdirSync(SCENARIOS)) if (f.startsWith(FILE_PREFIX) && f.endsWith(".json") && !wanted.has(f)) { console.log(dry ? "would remove stale " + f : "removed stale " + f); if (!dry) fs.rmSync(path.join(SCENARIOS, f)); }
  for (const r of results) {
    const it = r.data.item;
    console.log(`${r.file.padEnd(52)} ${it.type.padEnd(5)} ${it.mapId.padEnd(8)} sort ${it.sort} ${String(r.bots).padStart(2)} bots ${it.shareCode}${r.warnings.length ? "\n    warning: " + r.warnings.join("\n    warning: ") : ""}`);
    if (process.argv.includes("--verbose")) console.log("    start " + JSON.stringify(r.data.scene.doc.playerSpawn) + "\n    bots  " + r.where.join(" | "));
    if (!dry) fs.writeFileSync(path.join(SCENARIOS, r.file), JSON.stringify(r.data, null, 1) + "\n");
  }
  console.log(dry ? `${results.length} scenarios built (dry run, nothing written)` : `${results.length} files written to scenarios/. Now run: node scripts/build-scenarios.mjs`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
