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
import { loadMapKit, loadPointKit, MAPS_WITHOUT_DATA, loadGameCheck, walkable, findCover, yawTo, dist2 } from "./valorant-map-kit.mjs";

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
    // every peeker of the scenario with its route, in file order
    peeks() {
      return doc.actors.filter((a) => a.behaviors.some((x) => x.kind === "cross")).map((a) => ({ id: a.id, ...this.peek(a.id) }));
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
const onFloor = (kit, p) => kit.levelsAt(p.x, p.z).some((y) => Math.abs(y - p.y) < 0.35);
const bearing = (start, p) => { const d = deg(yawTo(start, p) - (start.facing * Math.PI) / 180); return ((d % 360) + 540) % 360 - 180; };
// Holder spots the player can see from the start, spread out in bearing. Deterministic: nearest first, each at least `minSep` degrees
// from the ones already taken, then returned left to right.
// floor: true keeps only spots on real walkable floor (a spot on a box top would be dropped by the game onto the floor below it).
export function pickSpread(kit, start, spots, { n, minD = 8, maxD = 40, angMax = 70, minSep = 8, floor = false }) {
  const eye = { x: start.x, y: start.y, z: start.z };
  const ok = spots.filter((p) => {
    const d = dist2(start, p);
    return d >= minD && d <= maxD && Math.abs(bearing(start, p)) <= angMax && kit.standsOn(p, 0.5) && kit.sees(eye, p) && (!floor || onFloor(kit, p));
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
  best.start.facing = r1(((best.start.facing + mean) % 360 + 360) % 360); // bearing = direction of the bot minus facing, so add the mean to centre it
  return best.start;
}

// Turn the player so the middle of the given bots is straight ahead (a start used for a different drill may face away from them).
const faceMean = (start, ps) => {
  const m = ps.reduce((a, p) => a + bearing(start, p.route ? p.route[1] : p.spot || p), 0) / ps.length;
  return { ...start, facing: r1((((start.facing + m) % 360) + 360) % 360) % 360 };
};

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
      return { start: faceMean(b.start, spots), round: { time: 75, die: false }, items: spots.map((p) => holder(p, { shoots: "bronze", back: false })),
        desc: L("Five enemies hold different angles on the way into A site, near ones and far ones. Clear one angle at a time, nearest first, and do not let a second one see you while you fight the first. They shoot slowly and do not come back.") };
    },
    hard: (kit) => {
      const b = readBank(SUNSET_A), spots = pickSpread(kit, b.start, b.spots, { n: 7, minD: 12, maxD: 48, angMax: 120, minSep: 7 });
      const easySpots = pickSpread(kit, b.start, b.spots, { n: 5, minD: 10, maxD: 46, angMax: 120, minSep: 8 }); // both tiers face the same way
      return { start: faceMean(b.start, easySpots), round: { time: 75, die: true }, items: spots.map((p, i) => (i % 3 === 1 ? strafer(p, { shoots: "diamond", back: false, width: 1.4 }) : holder(p, { shoots: "diamond", back: false, crouch: i % 3 === 2 }))),
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
      const b = readBank(SUNSET_A), items = [holder({ x: 30.5, y: 1, z: -12 }, { shoots: "bronze" }), holder({ x: 33.5, y: 1, z: -10.5 }, { shoots: "bronze" }), holder({ x: 36.1, y: 1, z: -5.5 }, { shoots: "bronze" })];
      return { start: faceMean(b.start, items), round: { time: 60, die: false }, items,
        desc: L("Three enemies stand a few metres apart on A site, about 25 metres away. Kill one and move your crosshair to the next without stopping the spray. Bots shoot slowly and come back after a moment.") };
    },
    hard: () => {
      const b = readBank(SUNSET_A), items = [holder({ x: 30.5, y: 1, z: -12 }, { shoots: "diamond", back: true, backAfter: 1.2 }), strafer({ x: 33.5, y: 1, z: -10.5 }, { shoots: "diamond", width: 1.4, backAfter: 1.2 }), holder({ x: 36.1, y: 1, z: -5.5 }, { shoots: "diamond", crouch: true, backAfter: 1.2 })];
      return { start: faceMean(b.start, items), round: { time: 60, die: true }, items,
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
      const entry = peeker(b.peek("actor-4"), { shoots: "bronze", peekStrafe: false, wait: 2, delay: 1.3, backAfter: 3 });
      return { start: b.start, round: { time: 75, die: false }, items: [flasher, entry],
        desc: L("One attacker flashes you and a second swings in about a second after the pop, straight into your blind. Look away on the flash, then clear the entry angle. Bots shoot slowly. The timing is exact in the first moments of a round and drifts as they come back.") };
    },
    hard: () => {
      const b = readBank(HAV_A);
      const f1 = peeker(b.peek("actor-1"), { shoots: "diamond", flash: { on: true, agent: "phoenix", curve: "left", wait: 0.5, height: 2.2 }, look: "phoenix", backAfter: 2 });
      const f2 = peeker(b.peek("actor-3"), { shoots: "diamond", flash: { on: true, agent: "phoenix", curve: "right", wait: 0.6, height: 2.2 }, look: "phoenix", delay: 2.5, backAfter: 2 });
      const e1 = peeker(b.peek("actor-4"), { shoots: "diamond", peekStrafe: true, wait: 1.6, delay: 0.9, backAfter: 2 });
      return { start: b.start, round: { time: 75, die: true }, items: [f1, e1, f2],
        desc: L("A flash-and-swing pair, then a second flasher from the close angle two and a half seconds later who swings in behind their own pop. Fast, accurate bots; dying ends the round.") };
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
      const b = readBank(BIND_SHORT), start = bestStart(kit, b, { n: 3 }), spots = pickSpread(kit, start, b.spots, { n: 2, minD: 10, maxD: 34, angMax: 75, minSep: 12, floor: true });
      return { start, round: { time: 75, die: false }, items: spots.map((p) => holder(p, { shoots: "bronze", back: true, backAfter: 2.5 })),
        desc: L("You dry-peek out of Lamps into two defenders on A site who are already aiming at the corner. Show just enough of yourself to see them, shoot, and step back. They shoot slowly and return after a few seconds.") };
    },
    hard: (kit) => {
      const b = readBank(BIND_SHORT), start = bestStart(kit, b, { n: 3 }), spots = pickSpread(kit, start, b.spots, { n: 3, minD: 10, maxD: 38, angMax: 80, minSep: 10, floor: true });
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
        items: [a, holder(b.hold("actor-1-spot7"), { shoots: "diamond", crouch: true, backAfter: 1.5 }), holder(b.hold("actor-1-spot5"), { shoots: "diamond", backAfter: 1.5, tradeOf: a.id, tradeMin: 0.3, tradeMax: 0.6 })],
        desc: L("Three accurate defenders on C Long at 20 to 30 metres. When you kill the first, the one on the far right swings in to trade within a second. Dying ends the round.") };
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

// =====================================================================================================================
// Round 2 (sort 330 and up): more maps (Pearl, Icebox, Abyss, Haven, Split, Bind, Lotus, Corrode, Ascent, Sunset) and new situations.
// These use stricter picking than round 1 (`pickStrict`): a spot must be on a real floor, visible from the start (with a small margin so a
// hairline gap does not count), and next to some geometry (a bot that holds an angle stands at a corner or a box, not in the middle of a lane).
// Hiding places for peekers are found with `findCover` (a floor point the start cannot see, 1.6 to 4 m from the peek spot).
// =====================================================================================================================
const rr = (p) => ({ x: r2(p.x), y: r2(p.y), z: r2(p.z) });
// How many of 8 directions are blocked within 1.8 m at chest height: 0 is the middle of an open lane, 6 or more is a pit or a nook.
const aroundBlocked = (kit, p, r = 1.8) => {
  let n = 0;
  for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; if (!kit.clear({ x: p.x, y: p.y + 1, z: p.z }, { x: p.x + Math.cos(a) * r, y: p.y + 1, z: p.z + Math.sin(a) * r })) n++; }
  return n;
};
const visibleFrom = (kit, start, p) => kit.sees(start, p) && kit.sees({ ...start, y: start.y + 0.05 }, p);
function selectSpread(start, ok, { n, minSep }) {
  ok.sort((a, b) => dist2(start, a) - dist2(start, b) || a.x - b.x || a.z - b.z);
  const out = [];
  for (const p of ok) if (out.length < n && out.every((q) => Math.abs(bearing(start, p) - bearing(start, q)) >= minSep)) out.push(p);
  return out.sort((a, b) => bearing(start, a) - bearing(start, b));
}
export function pickStrict(kit, start, spots, { n, minD = 8, maxD = 40, angMax = 70, minSep = 8, edge = true, away = [] }) {
  const seen = new Set(), ok = [];
  for (const s of spots) {
    let p = { x: s.x, y: s.y, z: s.z };
    if (!kit.dataless) {
      const l = kit.levelsAt(p.x, p.z).find((y) => Math.abs(y - p.y) < 0.35);
      if (l === undefined) continue;
      p = { ...p, y: r2(l) };
    }
    p.edge = undefined;
    const key = p.x + "," + p.z;
    if (seen.has(key)) continue;
    seen.add(key);
    const d = dist2(start, p);
    if (d < minD || d > maxD || Math.abs(bearing(start, p)) > angMax) continue;
    if (away.some((q) => dist2(q, p) < 3)) continue;
    if (!visibleFrom(kit, start, p)) continue;
    if (edge && !kit.dataless) { const k = aroundBlocked(kit, p); if (k > 5) continue; p.edge = k >= 1; } // 6+ blocked sides is a pit or a nook
    ok.push(p);
  }
  // Spots next to some geometry first; open-floor spots only when the map has too few of those.
  const near = selectSpread(start, ok.filter((p) => p.edge !== false), { n, minSep });
  const got = near.length >= n ? near : selectSpread(start, ok, { n, minSep });
  return got.map(({ x, y, z }) => ({ x, y, z }));
}
// Floor points behind the player (a lurker's spot): same level as the start, in sight of it, near geometry, at least `minAbs` degrees off the facing.
export function behindSpots(kit, start, { n, minD = 9, maxD = 26, minAbs = 130, minSep = 30 }) {
  const ok = [];
  for (let x = Math.floor(start.x - maxD); x <= start.x + maxD; x += 1.5) for (let z = Math.floor(start.z - maxD); z <= start.z + maxD; z += 1.5) {
    const y = kit.floorAt(x, z, start.y);
    if (y === null || Math.abs(y - start.y) > 0.4) continue;
    const p = { x: r1(x), y: r2(y), z: r1(z) }, d = dist2(start, p);
    if (d < minD || d > maxD || Math.abs(bearing(start, p)) < minAbs || !visibleFrom(kit, start, p)) continue;
    const k = aroundBlocked(kit, p);
    if (k > 5) continue;
    ok.push({ ...p, edge: k >= 1 });
  }
  const near = selectSpread(start, ok.filter((p) => p.edge), { n, minSep });
  return (near.length >= n ? near : selectSpread(start, ok, { n, minSep })).map(({ x, y, z }) => ({ x, y, z }));
}
// A peeker for a peek spot of our own choosing: hides at a floor point the start cannot see.
function peekFrom(kit, start, spot, o = {}) {
  let c = null;
  for (const max of [o.max ?? 4, 6, 9, 14]) { c = findCover(kit, start, spot, { min: o.min ?? 1.6, max, side: o.side ?? 0 }); if (c) break; }
  if (!c) throw new Error(`no hiding place near (${spot.x}, ${spot.y}, ${spot.z})`);
  return { cover: rr(c.cover), spot: rr(spot) };
}
// The start of a bank, or a start picked on the bank's own floor spots, turned toward the spots `pick` finds.
// faceN: how many spots decide where the player starts and faces. Easy and hard of one drill pass the same number, so both start the same way.
function openingFor(kit, b, how, pick, faceN = pick.n) {
  const start0 = how === "best" ? bestStart(kit, b, { n: Math.min(faceN, 3), minD: pick.minD ?? 10, maxD: pick.maxD ?? 40, angMax: pick.angMax ?? 60, minSep: pick.minSep ?? 8 }) : { ...b.start };
  // If the first ask is too strict for this map, loosen the bearing spread, then the view angle, then the distance (in that order).
  const find = (from, n) => {
    const tries = [pick, { ...pick, minSep: 4 }, { ...pick, minSep: 4, angMax: (pick.angMax ?? 70) + 25 }, { ...pick, minSep: 3, angMax: (pick.angMax ?? 70) + 45, maxD: (pick.maxD ?? 40) + 15 }];
    for (const t of tries) {
      const spots = pickStrict(kit, from, b.spots, { ...t, n });
      if (spots.length >= n) return spots;
    }
    throw new Error(`${b.file}: not enough usable spots for ${n} (${how})`);
  };
  const start = faceMean(start0, find(start0, faceN));
  return { start, spots: pick.n === faceN ? find(start, faceN) : find(start, pick.n) };
}
// A peeker that swings when it hears the player: o as for peeker(), snd = { sources, delay: [min, max], chance }.
function soundPeeker(p, box, o, snd) {
  const x = peeker(p, o);
  x.soundRule = { on: true, area: box, spot: { x: p.cover.x, y: p.cover.y, z: p.cover.z, route: [{ ...p.cover, wait: 0 }, { ...p.spot, wait: 1.2 }] }, sources: snd.sources, delayMin: snd.delay[0], delayMax: snd.delay[1], swingChance: snd.chance };
  return x;
}
// Distinct peek spots of a bank (peekers that share a spot count once), nearest to the start first.
function peekClusters(kit, b, start, sep = 3) {
  const out = [];
  for (const p of b.peeks()) {
    if (!visibleFrom(kit, start, p.spot) || out.some((q) => dist2(q.spot, p.spot) < sep)) continue;
    out.push({ cover: p.cover, spot: p.spot });
  }
  return out.sort((a, c) => dist2(start, a.spot) - dist2(start, c.spot));
}

// ---------- shoulder-peek reads ----------
// One enemy shows only a shoulder for a third of a second, again and again; a partner swings when it hears you shoot (hard: or run).
// Do not spend your shots on the bait: a clean read is to let the shoulder go and take the swing.
function shoulderTiers(bankFile, shoulderId, partnerId, where) {
  const mk = (tier) => () => {
    const b = readBank(bankFile), pk = (id) => b.peek(id), hard = tier === "hard", box = area(b.start, hard ? 9 : 8);
    const shoulder = peeker(pk(shoulderId), { shoots: hard ? "diamond" : "bronze", wait: hard ? 0.35 : 0.28, coverWait: hard ? 0.7 : 1, randomWait: hard ? 1.2 : 1.8, peekStrafe: false, peekWidth: 0.6 });
    const partner = soundPeeker(pk(partnerId), box, { shoots: hard ? "diamond" : "bronze", wait: hard ? 1.6 : 2.2, coverWait: 1, peekStrafe: hard, backAfter: hard ? 3 : 4 },
      hard ? { sources: ["shot", "footstep"], delay: [0.25, 0.5], chance: 100 } : { sources: ["shot"], delay: [0.7, 1.2], chance: 80 });
    return {
      start: b.start, round: { time: hard ? 75 : 60, die: hard }, items: [shoulder, partner],
      desc: hard
        ? L(`${where}: an accurate enemy shows a shoulder for a third of a second at a time. A partner swings within half a second when it hears you shoot or run. Let the shoulder go, hold your crosshair on the swing, and keep your feet still. Dying ends the round.`)
        : L(`${where}: an enemy shows only a shoulder for a quarter of a second, again and again. When you shoot, a partner swings out about a second later. Do not chase the shoulder: hold your crosshair at the corner and wait for the swing. Bots shoot slowly.`),
    };
  };
  return { easy: mk("easy"), hard: mk("hard") };
}
scene({ stem: "pearl-a-shoulder-peek-read", map: "pitt", title: "Pearl — A site, shoulder-peek read", tiers: shoulderTiers("creator-pearl-hold-a", "actor-3", "actor-1", "Pearl A") });
scene({ stem: "icebox-site-shoulder-peek-read", map: "port", title: "Icebox — Site, shoulder-peek read", tiers: shoulderTiers("creator-icebox-hold-site", "actor-3", "actor-4-spot4", "Icebox site") });
scene({ stem: "haven-a-long-shoulder-peek-read", map: "triad", title: "Haven — A Long, shoulder-peek read", tiers: shoulderTiers("creator-haven-a-long-hold", "actor-3", "actor-4", "Haven A Long") });

// ---------- off-angle holds that change after every kill ----------
// A chain of holders: the next one shows up at a different angle (alternating left and right) a moment after you kill the one before.
const CHAIN_ORDER = { 3: [1, 0, 2], 4: [1, 3, 0, 2], 5: [2, 0, 4, 1, 3] };
function chainTiers(bankFile, how, pick, where) {
  const mk = (tier) => (kit) => {
    const hard = tier === "hard", b = readBank(bankFile);
    const { start, spots } = openingFor(kit, b, how, { ...pick, n: pick.n + (hard ? 1 : 0) }, pick.n);
    const chain = CHAIN_ORDER[spots.length].map((i) => spots[i]);
    let prev = null;
    const items = chain.map((p, i) => {
      const o = { shoots: hard ? "diamond" : "bronze", back: false, ...(prev ? { tradeOf: prev.id, tradeMin: hard ? 0.3 : 0.8, tradeMax: hard ? 0.6 : 1.4 } : {}) };
      const x = i % 3 === 2 ? strafer(p, { ...o, width: hard ? 1.6 : 1.2 }) : holder(p, { ...o, crouch: i % 3 === 1 });
      prev = x;
      return x;
    });
    return {
      start, round: { time: hard ? 60 : 75, die: hard }, items,
      desc: hard
        ? L(`${where}: ${items.length} accurate enemies, but only one at a time. Each shows up at a new angle (left, right, near, far) within half a second of the kill before. Clear your angle, then look for the next one at a place you did not check. Dying ends the round.`)
        : L(`${where}: ${items.length} enemies, one at a time. Kill one and the next shows up at a different angle about a second later, so do not stay locked on the first spot. They shoot slowly and do not come back.`),
    };
  };
  return { easy: mk("easy"), hard: mk("hard") };
}
scene({ stem: "pearl-a-off-angle-chain", map: "pitt", title: "Pearl — A site, off-angle chain", tiers: chainTiers("creator-pearl-drill-a", "bank", { n: 3, minD: 12, maxD: 44, angMax: 75, minSep: 7 }, "Pearl A") });
scene({ stem: "icebox-mid-off-angle-chain", map: "port", title: "Icebox — Mid to A, off-angle chain", tiers: chainTiers("creator-icebox-mid-to-a", "bank", { n: 3, minD: 14, maxD: 50, angMax: 80, minSep: 7 }, "Icebox mid") });
scene({ stem: "bind-b-off-angle-chain", map: "duality", title: "Bind — B site, off-angle chain", tiers: chainTiers("creator-bind-drill-b-pre-aim", "best", { n: 3, minD: 14, maxD: 40, angMax: 60, minSep: 7 }, "Bind B") });
scene({ stem: "abyss-a-off-angle-chain", map: "infinity", title: "Abyss — A site, off-angle chain", tiers: chainTiers("abyss-a-main-pre-aim-hard", "bank", { n: 3, minD: 20, maxD: 60, angMax: 90, minSep: 6 }, "Abyss A") });

// ---------- trade swing with two different delays ----------
// You kill the first enemy; one partner swings back almost at once and a second one comes later, from another side.
function tradeDelayTiers(bankFile, where) {
  const mk = (tier) => (kit) => {
    const hard = tier === "hard", b = readBank(bankFile), start = b.start, cl = peekClusters(kit, b, start);
    if (cl.length < 3) throw new Error(`${bankFile}: ${cl.length} distinct peeks, need 3`);
    const [pa, pq, pr] = cl;
    const first = peeker(pa, { shoots: hard ? "diamond" : "bronze", wait: hard ? 1.6 : 2.2, coverWait: hard ? 0.7 : 1, peekStrafe: hard });
    const fast = peeker(pq, { shoots: hard ? "diamond" : "bronze", wait: hard ? 1.4 : 2, coverWait: 1, peekStrafe: hard, tradeOf: first.id, tradeMin: hard ? 0.25 : 0.9, tradeMax: hard ? 0.4 : 1.3 });
    const late = peeker(pr, { shoots: hard ? "diamond" : "bronze", wait: hard ? 1.4 : 2, coverWait: 1, peekStrafe: hard, tradeOf: first.id, tradeMin: hard ? 0.9 : 2.3, tradeMax: hard ? 1.2 : 2.9 });
    return {
      start: faceMean(start, [pa, pq, pr]), round: { time: 75, die: hard }, items: [first, fast, late],
      desc: hard
        ? L(`${where}: kill the first enemy and two partners trade you, the first in under half a second and the second about a second later, from another side. Plan the kill so the next angle is already in your crosshair. Dying ends the round.`)
        : L(`${where}: kill the first enemy and two partners swing in: the first about a second later, the second after about two and a half. Learn the two timings and be ready for both. They shoot slowly.`),
    };
  };
  return { easy: mk("easy"), hard: mk("hard") };
}
scene({ stem: "pearl-b-trade-swing-delays", map: "pitt", title: "Pearl — B site, trade swings", tiers: tradeDelayTiers("creator-pearl-hold-b", "Pearl B") });
scene({ stem: "icebox-site-trade-swing-delays", map: "port", title: "Icebox — Site, trade swings", tiers: tradeDelayTiers("creator-icebox-hold-site", "Icebox site") });
scene({ stem: "split-a-trade-swing-delays", map: "bonsai", title: "Split — A site, trade swings", tiers: tradeDelayTiers("split-a-site-hold-hard", "Split A") });

// ---------- lurk and flank from behind (sound-triggered) ----------
// You fight forward; a lurker waits out of sight behind you and swings when it hears a shot or a step.
function lurkTiers(bankFile, how, pick, where) {
  const mk = (tier) => (kit) => {
    const hard = tier === "hard", b = readBank(bankFile);
    const { start, spots } = openingFor(kit, b, how, { ...pick, n: hard ? 2 : 1 }, 1);
    const need = hard ? 2 : 1, peeks = [];
    for (const minAbs of [130, 115]) { // squarely behind first, then over the shoulder
      for (const c of behindSpots(kit, start, { n: 60, minSep: 3, maxD: 30, minAbs })) {
        let p; try { p = peekFrom(kit, start, c); } catch { continue; }
        if (peeks.length < need && peeks.every((q) => Math.abs(bearing(start, q.spot) - bearing(start, p.spot)) >= 25)) peeks.push(p);
      }
      if (peeks.length >= need) break;
    }
    if (peeks.length < need) throw new Error(`${bankFile}: ${peeks.length} usable spots behind the start`);
    const box = area(start, hard ? 9 : 8), rank = hard ? "diamond" : "bronze";
    const front = spots.map((p) => holder(p, { shoots: rank, back: !hard, backAfter: 3 }));
    const lurkers = peeks.map((p, i) => soundPeeker(p, box, { shoots: rank, wait: hard ? 1.6 : 2.2, peekStrafe: hard, backAfter: 3, peekWidth: 1.4 },
      hard ? { sources: i ? ["footstep"] : ["shot", "footstep", "land"], delay: i ? [0.5, 1] : [0.3, 0.6], chance: i ? 85 : 100 } : { sources: ["shot"], delay: [1.4, 2.4], chance: 70 }));
    return {
      start, round: { time: 90, die: hard }, items: [...front, ...lurkers],
      desc: hard
        ? L(`${where}: you hold ${front.length > 1 ? "two angles" : "an angle"} in front while ${lurkers.length} lurkers wait behind you. One swings as soon as you shoot, run or land (the other when you walk), within a second. Know what is behind you, fight quietly, and turn on the sound. Dying ends the round.`)
        : L(`${where}: you fight an enemy in front while a lurker waits out of sight behind you. When you shoot, it may swing in from behind about two seconds later (7 times in 10). Finish the front fight fast, then check your back. Bots shoot slowly.`),
    };
  };
  return { easy: mk("easy"), hard: mk("hard") };
}
scene({ stem: "icebox-b-lurk-from-behind", map: "port", title: "Icebox — B site, lurker from behind", tiers: lurkTiers("creator-icebox-drill-b-pre-aim", "bank", { minD: 10, maxD: 50, angMax: 90, minSep: 8 }, "Icebox B") });
scene({ stem: "split-b-lurk-from-behind", map: "bonsai", title: "Split — B main, lurker from behind", tiers: lurkTiers("split-b-main-attack-pre-aim-hard", "bank", { minD: 10, maxD: 45, angMax: 90, minSep: 8 }, "Split B main") });
scene({ stem: "ascent-b-lurk-from-behind", map: "ascent", title: "Ascent — B site, lurker from behind", tiers: lurkTiers("ascent-b-retake-from-mid-pre-aim-hard", "bank", { minD: 10, maxD: 45, angMax: 90, minSep: 8 }, "Ascent B") });

// ---------- entry through a smoke-less choke with a trading partner ----------
// Two defenders cover a tight entry; when you kill the first, a partner swings out of cover to trade.
function chokeTiers(bankFile, how, pick, where) {
  const mk = (tier) => (kit) => {
    const hard = tier === "hard", b = readBank(bankFile);
    const { start: start0, spots: all } = openingFor(kit, b, how, { ...pick, n: (hard ? 4 : 3) + 2 }, 5);
    // the partner needs a hiding place; the others are the most central spots
    const hiding = all.map((p) => { try { return peekFrom(kit, start0, p); } catch { return null; } }).filter(Boolean)[0];
    if (!hiding) throw new Error(`${bankFile}: no spot with a hiding place for the partner`);
    const rest = all.filter((p) => p !== all.find((q) => q.x === hiding.spot.x && q.z === hiding.spot.z)).sort((p, q) => Math.abs(bearing(start0, p)) - Math.abs(bearing(start0, q))).slice(0, hard ? 3 : 2);
    const [s0, s1, s3] = rest;
    const start = start0, rank = hard ? "diamond" : "bronze";
    const lead = strafer(s0, { shoots: rank, width: 1.4, back: false });
    const side = holder(s1, { shoots: rank, crouch: true, back: false });
    const partner = peeker(hiding, { shoots: rank, wait: hard ? 1.6 : 2.2, coverWait: 1, peekStrafe: hard, tradeOf: lead.id, tradeMin: hard ? 0.25 : 1, tradeMax: hard ? 0.45 : 1.6 });
    const items = [lead, side, partner];
    if (hard) items.push(holder(s3, { shoots: rank, back: false, tradeOf: side.id, tradeMin: 0.3, tradeMax: 0.5 }));
    return {
      start, round: { time: 75, die: hard }, items,
      desc: hard
        ? L(`${where}: you push through a choke with no smoke. One defender strafes at the entry and another holds crouched at the side. Kill the strafer and a partner swings out within half a second; kill the crouched one and a fourth appears. Dying ends the round.`)
        : L(`${where}: you push through a choke with no smoke. One defender strafes at the entry and another holds crouched at the side. Kill the strafer and a partner swings out of cover about a second later to trade you. Bots shoot slowly.`),
    };
  };
  return { easy: mk("easy"), hard: mk("hard") };
}
scene({ stem: "bind-b-choke-entry-trade", map: "duality", title: "Bind — B site, choke entry and trade", tiers: chokeTiers("creator-bind-drill-b-pre-aim", "best", { minD: 9, maxD: 28, angMax: 55, minSep: 7 }, "Bind B") });
scene({ stem: "lotus-a-choke-entry-trade", map: "jam", title: "Lotus — A main, choke entry and trade", tiers: chokeTiers("lotus-a-main-attack-hard", "best", { minD: 9, maxD: 30, angMax: 55, minSep: 7 }, "Lotus A") });
scene({ stem: "corrode-b-choke-entry-trade", map: "rook", title: "Corrode — B main, choke entry and trade", tiers: chokeTiers("corrode-b-main-attack-pre-aim-hard", "best", { minD: 9, maxD: 28, angMax: 55, minSep: 7 }, "Corrode B") });

// ---------- long-range Operator / Marshal peeks with repeek timings ----------
// You scope in on a long lane. Enemies peek, retreat and peek again on different timers; learn the gap between peeks.
function repeekTiers(bankFile, where, weapon, spotPick) {
  const mk = (tier) => (kit) => {
    const hard = tier === "hard", b = readBank(bankFile), start = b.start;
    const picks = spotPick(kit, b, start, hard ? 2 : 1).map((p) => (p.cover ? p : peekFrom(kit, start, p)));
    const rank = hard ? "diamond" : "bronze";
    const items = picks.map((p, i) => peeker(p, hard
      ? { shoots: rank, wait: i ? 0.8 : 0.9, coverWait: i ? 1.4 : 0.9, randomWait: i ? 2.5 : 1.6, delay: i * 1.5, peekStrafe: "random", peekWidth: 2.2, backAfter: i ? 1.5 : 2 }
      : { shoots: rank, wait: 1.1, coverWait: 2.8, randomWait: 2, peekStrafe: false, backAfter: 3 }));
    return {
      start: faceMean(start, picks.slice(0, 1)), round: { time: 90, die: hard, weapon }, items,
      desc: hard
        ? L(`${where}: you hold a long lane with ${weapon === "marshal" ? "a Marshal" : "an Operator"}. Two accurate enemies peek and retreat on different timers (a short peek, then 1 to 4 seconds hidden), strafing or standing. Learn each rhythm and shoot the first frame. Dying ends the round.`)
        : L(`${where}: you hold a long lane with ${weapon === "marshal" ? "a Marshal" : "an Operator"}. One enemy peeks for about a second, hides for three to five seconds and peeks again. Count the gap, scope before it comes, and shoot as it appears. Bots shoot slowly.`),
    };
  };
  return { easy: mk("easy"), hard: mk("hard") };
}
const farSpots = (min, max, angMax = 40, minSep = 6) => (kit, b, start, n) => {
  const got = [];
  for (const p of pickStrict(kit, start, b.spots, { n: 12, minD: min, maxD: max, angMax, minSep, edge: false })) {
    let hide; try { hide = peekFrom(kit, start, p); } catch { continue; }
    if (got.length < n && got.every((q) => dist2(q.spot, hide.spot) > 3)) got.push(hide);
  }
  if (got.length < n) throw new Error(`${b.file}: only ${got.length} long spots with a hiding place`);
  return got;
};
// Sunset's lower-mid peeks are real hiding places; use their peek spots directly.
scene({
  stem: "sunset-mid-operator-repeek", map: "juliett", title: "Sunset — Mid, Operator repeek",
  tiers: repeekTiers(SUNSET_LOWER_MID, "Sunset mid", "operator", (kit, b, start, n) => {
    const out = peekClusters(kit, b, start).filter((p) => dist2(start, p.spot) > 30).slice(0, n);
    if (out.length < n) throw new Error("sunset mid: not enough distinct peek spots");
    return out;
  }),
});
scene({
  stem: "haven-a-long-operator-repeek", map: "triad", title: "Haven — A Long, Operator repeek",
  tiers: repeekTiers("creator-haven-a-long-hold", "Haven A Long", "operator", (kit, b, start, n) => {
    const out = peekClusters(kit, b, start, 2).slice(0, n);
    if (out.length < n) throw new Error("haven a long: not enough distinct peek spots");
    return out;
  }),
});
scene({
  stem: "haven-c-long-marshal-repeek", map: "triad", title: "Haven — C Long, Marshal repeek",
  single: (kit) => {
    const b = readBank(HAV_C), start = b.start, spot = b.hold("actor-1");
    const p = peekFrom(kit, start, spot, { max: 5 });
    const x = peeker(p, { shoots: "platinum", wait: 1, coverWait: 1.2, randomWait: 2.2, peekStrafe: "random", peekWidth: 2, backAfter: 2 });
    return {
      start, round: { time: 90, die: true, weapon: "marshal" }, items: [x],
      desc: L("A long Marshal lane down C Long, about 43 metres. A rifleman peeks for about a second, hides for one to three seconds and repeeks, strafing or standing. One body shot is not a kill: quick-scope for the head, or shoot twice. Dying ends the round."),
    };
  },
});

// ---------- retake with staggered arrival ----------
// Defenders reach their angles one after another; the later ones come out of cover (peekers) so you meet them as they swing.
function retakeTiers(bankFile, how, pick, where, hardN = 4) {
  const mk = (tier) => (kit) => {
    const hard = tier === "hard", b = readBank(bankFile);
    const { start, spots } = openingFor(kit, b, how, { ...pick, n: hard ? hardN : 3 }, 3);
    const rank = hard ? "diamond" : "bronze";
    const items = spots.map((p, i) => {
      let hide = null;
      if (hard && i > 0) { try { hide = peekFrom(kit, start, p); } catch { hide = null; } }
      if (!hide) return holder(p, { shoots: rank, delay: i * (hard ? 1.5 : 2.5), crouch: hard && i === 2, back: false });
      return peeker(hide, { shoots: rank, wait: 1.8, coverWait: 1, peekStrafe: true, delay: 1 + i * 1.2 });
    });
    return {
      start, round: { time: 75, die: hard }, items,
      desc: hard
        ? L(`${where}: the first defender is already holding. ${['', 'One', 'Two', 'Three'][items.length - 1]} more reach their angles one after another, every second or so (some walk in, some swing out of cover), so you are in a fight while the next one arrives. Fast, accurate bots; dying ends the round.`)
        : L(`${where}: three defenders show up one after another, two and a half seconds apart. Deal with each as it appears and do not wait for the others. They shoot slowly and do not come back.`),
    };
  };
  return { easy: mk("easy"), hard: mk("hard") };
}
scene({ stem: "ascent-a-retake-staggered", map: "ascent", title: "Ascent — A retake, staggered defenders", tiers: retakeTiers("ascent-a-retake-pre-aim-easy", "bank", { minD: 10, maxD: 45, angMax: 130, minSep: 6 }, "Ascent A retake", 3) });
scene({ stem: "split-a-retake-staggered", map: "bonsai", title: "Split — A retake, staggered defenders", tiers: retakeTiers("split-a-retake-from-ct-hard", "bank", { minD: 10, maxD: 45, angMax: 100, minSep: 8 }, "Split A retake") });

// ---------- compile ----------
function withSeed(seed, fn) {
  const real = Math.random;
  let h = seed >>> 0;
  Math.random = () => { h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  try { return fn(); } finally { Math.random = real; }
}

// Where bots stand: on a real walkable floor of the map. The game drops a bot onto whatever is under it, so a position a little off the floor
// is moved onto it (0.1 to 0.45 m), and one far from every floor (a box top the scenario does not have) is an error.
function groundAll(kit, made, stem) {
  if (kit.dataless) return;
  const fix = (p) => {
    const l = kit.levelsAt(p.x, p.z).sort((a, b) => Math.abs(a - p.y) - Math.abs(b - p.y))[0];
    if (l === undefined || Math.abs(l - p.y) >= 0.45) throw new Error(`${stem}: (${p.x}, ${p.y}, ${p.z}) is not on a floor of the map (nearest ${l})`);
    if (Math.abs(l - p.y) > 0.1) p.y = r2(l);
  };
  for (const it of made.items) {
    for (const p of [...(it.route || []), ...(it.route ? [] : [it]), ...(it.spots || []).flatMap((q) => q.route || [q])]) fix(p);
    if (it.route) Object.assign(it, { x: it.route[0].x, y: it.route[0].y, z: it.route[0].z });
  }
}

// Points that existing (non-Valorant-Workshop) scenarios put things on, for the maps that have no floor data.
export function pointsOnMap(map) {
  const pts = [];
  for (const f of fs.readdirSync(SCENARIOS)) {
    if (!f.endsWith(".json") || f.startsWith(FILE_PREFIX)) continue;
    const data = JSON.parse(fs.readFileSync(path.join(SCENARIOS, f), "utf8"));
    const doc = typeof data.scene.doc === "string" ? JSON.parse(data.scene.doc) : data.scene.doc;
    if (!doc.environment || doc.environment.map !== map) continue;
    const add = (p, dy = 0) => pts.push({ x: r2(p.x), y: r2(p.y - dy), z: r2(p.z) });
    add(doc.playerSpawn.position);
    for (const sp of doc.spawners) add(sp.position, sp.kind === "area" && sp.groundSnap ? 0.3 : 0);
    for (const d of doc.dispatchers || []) for (const r of d.routes) if (r.at) add(r.at);
    for (const a of doc.actors) for (const b of a.behaviors) for (const w of b.waypoints || []) add(w);
  }
  return pts;
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
  const kitOf = async (map) => {
    if (!kits.has(map)) kits.set(map, MAPS_WITHOUT_DATA.includes(map) ? loadPointKit(map, pointsOnMap(map)) : await loadMapKit(map));
    return kits.get(map);
  };
  const results = [], seenNames = new Set(), seenCodes = new Set();
  let sort = SORT_BASE;
  for (const def of expandScenes()) {
    botNo = 0;
    const kit = await kitOf(def.map);
    const made = def.make(kit);
    const warnings = [];
    groundAll(kit, made, def.stem);
    const drill = D.newDrill(def.map);
    drill.name = def.title;
    const s = made.start;
    drill.start = { x: s.x, y: s.y, z: s.z, facing: s.facing };
    drill.round = { ...drill.round, goal: "score", time: made.round.time, weapon: made.round.weapon || "vandal", auto: true, move: true, die: !!made.round.die, ammo: false, order: "together", atOnce: 1, gap: 1 };
    drill.items = made.items;
    // Every bot must stand on a floor of the map, and the player must be able to see where it shows up (sound-gated lurkers excepted).
    for (const it of made.items) {
      const spots = it.route ? it.route : [it];
      for (const p of spots) if (!kit.standsOn(p)) throw new Error(`${def.stem}: (${p.x}, ${p.y}, ${p.z}) is not on the walkable floor of ${def.map}`);
      const seen = it.route ? it.route[1] : it;
      if (!(it.soundRule && it.soundRule.on) && !(kit.sees(s, seen) && kit.sees({ ...s, y: s.y + 0.05 }, seen))) throw new Error(`${def.stem}: no clear sight line from the start to (${seen.x}, ${seen.y}, ${seen.z})`);
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
