// Pure helpers for the Studio editor (no DOM, no state), so they can be tested in node:
//   - nudging and aligning things, copy and paste (also between drills), drill files (export / import)
//   - templates for common situations (hold an angle, jiggle peek, wide swing, ...)
//   - extra warnings for the checks box (lint) and a plain-words summary of what a bot does (describeBot)
// Nothing here changes the drill format; templates only build the same items the tray builds.

import { newBot, newWall, newId, MOVES, RANKS, SOUND_SOURCES, itemName, normalize, botSpots, tradeTarget, swingRadiusOn, soundRuleOn, hasZone } from "./drill.js";
import { wallDepth } from "./transform.js";

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- view frame ----------
// The 2D view of a map can be turned in quarters (q = 0..3). These match studio.js: turn() goes world -> screen,
// and the opposite turn goes screen -> world.
export const turnQ = (a, b, q) => (q === 1 ? [-b, a] : q === 2 ? [-a, -b] : q === 3 ? [b, -a] : [a, b]);

// Arrow keys: which way a screen direction (sx right, sy down) is in the world, for `step` metres.
export function nudgeDelta(sx, sy, step, q = 0) {
  const [x, z] = turnQ(sx, sy, (4 - q) % 4);
  return [r2(x * step), r2(z * step)];
}
export const NUDGE_STEPS = { fine: 0.1, normal: 0.5, big: 1 };

// ---------- moving things ----------
// Moves one thing by (ox, oz) with everything that belongs to it: route, extra spots, trigger line, flash target,
// sound area and its spot. ground(x, z, y) -> y puts bots back on the floor (structures keep their height).
export function shiftItem(o, ox, oz, ground = null) {
  const solid = o.kind === "block" || o.kind === "wall";
  const mv = (p) => {
    p.x = r2(p.x + ox); p.z = r2(p.z + oz);
    if (!solid && ground && p.y !== undefined) { const y = ground(p.x, p.z, p.y); if (y !== null && y !== undefined) p.y = y; }
  };
  mv(o);
  if (o.route) o.route.forEach(mv);
  if (Array.isArray(o.spots)) for (const s of o.spots) { mv(s); if (s.route) s.route.forEach(mv); }
  if (o.trigger) for (const end of ["a", "b"]) if (o.trigger[end]) o.trigger[end] = { x: r2(o.trigger[end].x + ox), z: r2(o.trigger[end].z + oz) };
  if (o.flash && o.flash.target) o.flash.target = { ...o.flash.target, x: r2(o.flash.target.x + ox), z: r2(o.flash.target.z + oz) };
  const rule = o.soundRule;
  if (rule && typeof rule === "object") {
    if (rule.area) rule.area = { x0: r2(rule.area.x0 + ox), z0: r2(rule.area.z0 + oz), x1: r2(rule.area.x1 + ox), z1: r2(rule.area.z1 + oz) };
    if (rule.spot) { mv(rule.spot); if (rule.spot.route) rule.spot.route.forEach(mv); }
  }
  return o;
}

// ---------- align and spread ----------
export const ALIGN_MODES = [
  ["left", "Align left"], ["hcenter", "Centre across"], ["right", "Align right"],
  ["top", "Align top"], ["vcenter", "Centre down"], ["bottom", "Align bottom"],
];
// How far each item has to move (world metres) to line up as the player sees the map. Returns Map id -> [dx, dz].
// mode: left | right | hcenter | top | bottom | vcenter | spreadH | spreadV (even gaps between the two outermost).
export function alignDeltas(items, mode, q = 0) {
  const out = new Map();
  if (!items || items.length < 2) return out;
  const at = items.map((i) => ({ id: i.id, v: turnQ(i.x, i.z, q) }));
  const axis = /^(left|right|hcenter|spreadH)$/.test(mode) ? 0 : 1;
  const vals = at.map((p) => p.v[axis]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const move = (p, target) => {
    const d = [0, 0];
    d[axis] = target - p.v[axis];
    const [dx, dz] = turnQ(d[0], d[1], (4 - q) % 4);
    out.set(p.id, [r2(dx), r2(dz)]);
  };
  if (mode === "left" || mode === "top") for (const p of at) move(p, lo);
  else if (mode === "right" || mode === "bottom") for (const p of at) move(p, hi);
  else if (mode === "hcenter" || mode === "vcenter") for (const p of at) move(p, (lo + hi) / 2);
  else if (mode === "spreadH" || mode === "spreadV") {
    const sorted = [...at].sort((a, b) => a.v[axis] - b.v[axis]);
    sorted.forEach((p, n) => move(p, lo + ((hi - lo) * n) / (sorted.length - 1)));
  }
  return out;
}

// ---------- copy and paste ----------
export const CLIP_FORMAT = "openvaim-studio-clip";
export const clipOf = (items) => ({ format: CLIP_FORMAT, v: 1, items: clone(items) });
export function parseClip(text) {
  try {
    const c = typeof text === "string" ? JSON.parse(text) : text;
    if (!c || c.format !== CLIP_FORMAT || !Array.isArray(c.items) || !c.items.length) return null;
    const items = c.items.filter((i) => i && typeof i === "object" && typeof i.kind === "string" && Number.isFinite(i.x) && Number.isFinite(i.z));
    return items.length ? { ...c, items } : null;
  } catch { return null; }
}
const centre = (items) => ({ x: items.reduce((s, i) => s + i.x, 0) / items.length, z: items.reduce((s, i) => s + i.z, 0) / items.length });

// Fresh copies of a clip's items with new ids. Bots that trade another bot in the clip trade its copy; a trade of
// something outside the clip stays only if that bot is in `existing` (the drill's items). Placed so the clip's
// centre lands on `at`, or 1.5 m aside when there is no `at`. ground: see shiftItem.
export function pasteItems(clip, { at = null, existing = [], ground = null } = {}) {
  const ids = new Map(clip.items.map((i) => [i.id, newId(i.kind)]));
  const c = centre(clip.items);
  const ox = at ? at.x - c.x : 1.5, oz = at ? at.z - c.z : 1.5;
  return clip.items.map((src) => {
    const it = clone(src);
    it.id = ids.get(src.id);
    if (it.tradeOf) it.tradeOf = ids.get(it.tradeOf) || (existing.some((e) => e.id === it.tradeOf) ? it.tradeOf : null);
    shiftItem(it, r1(ox), r1(oz), ground);
    return it;
  });
}

// ---------- drill files ----------
export const FILE_FORMAT = "openvaim-studio-drill";
export const fileName = (drill) => `${String(drill.name || "drill").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "drill"}.openvaim-drill.json`;
export function exportDrillText(drill) {
  const d = clone(drill);
  delete d.code; delete d.compiled; // a file never carries the saved copy's identity
  return JSON.stringify({ format: FILE_FORMAT, v: 1, drill: d }, null, 1);
}
// Text -> { drill } or { error }. Accepts our file format or a bare drill object; always returns a normalised copy
// with no code, so importing never overwrites an existing drill.
export function parseDrillText(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return { error: "That file isn't a drill (not valid JSON)." }; }
  const d = raw && raw.format === FILE_FORMAT ? raw.drill : raw;
  if (!d || typeof d !== "object" || !Array.isArray(d.items) || !d.round || typeof d.round !== "object" || !d.start || !Number.isFinite(d.start.x) || !Number.isFinite(d.start.z)) {
    return { error: "That file isn't a Studio drill." };
  }
  if (!d.items.every((i) => i && typeof i === "object" && typeof i.id === "string" && typeof i.kind === "string" && Number.isFinite(i.x) && Number.isFinite(i.z))) return { error: "Some things in that drill are damaged." };
  if (d.items.some((i) => i.kind === "bot" && !MOVES[i.move])) return { error: "That drill uses a bot type this version doesn't know." };
  const drill = clone(d);
  delete drill.code; delete drill.compiled;
  const base = { v: 1, name: "Imported drill", note: "", place: "range", rangeSize: "medium", arenaTheme: "charcoal" };
  for (const k of Object.keys(base)) if (drill[k] === undefined) drill[k] = base[k];
  drill.name = String(drill.name).slice(0, 60);
  drill.round = { goal: "score", time: 60, par: 0, weapon: "vandal", auto: true, move: false, die: false, ammo: false, order: "together", atOnce: 1, gap: 1, ...drill.round };
  drill.start = { y: 0, facing: 0, ...drill.start };
  return { drill: normalize(drill) };
}

// ---------- templates ----------
// Each one drops bots and cover in front of you, around `anchor`, in your view: `r` is across (right/left) and `d` is
// depth away from you. build() returns { items, round? } where round lists settings the template needs (the Studio
// turns them on and says so).
const unit = (from, to) => { const dx = to.x - from.x, dz = to.z - from.z, l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l }; };

export function frame(anchor, start) {
  const f = unit(start, anchor); // away from you
  const a = { x: f.z, z: -f.x }; // across, the same way the editor's across() points
  const y = anchor.y || 0;
  const P = (r, d) => ({ x: r1(anchor.x + a.x * r + f.x * d), y, z: r1(anchor.z + a.z * r + f.z * d) });
  // A wall square to your view: its length runs across.
  const turn = Math.round(((Math.atan2(-a.z, a.x) * 180) / Math.PI + 360) % 180);
  const wall = (r, d, length, height = 2.5) => Object.assign(newWall(P(r, d)), { length, height, turn });
  const bot = (move, r, d, o = {}) => Object.assign(newBot(move, P(r, d)), { shoots: "silver", weapon: "vandal" }, o);
  const peeker = (cover, spot, o = {}) => {
    const b = bot("peek", cover[0], cover[1], o);
    b.route = [P(...cover), P(...spot)].map((p) => ({ ...p, wait: 0 }));
    Object.assign(b, { x: b.route[0].x, y: b.route[0].y, z: b.route[0].z });
    return b;
  };
  return { P, wall, bot, peeker };
}

export const TEMPLATES = [
  {
    id: "hold", name: "Hold an angle", text: "One bot stands behind a corner and holds the angle.",
    build: (f) => ({ items: [f.wall(-1.8, 0.4, 3), f.bot("still", 0, 0, { facing: null })] }),
  },
  {
    id: "jiggle", name: "Jiggle peek", text: "A bot shuffles out from behind a wall, strafes a little and hides again.",
    build: (f) => ({ items: [f.wall(-1.6, 0, 3.2), f.peeker([-1.3, 1], [0.3, 0.1], { peekWidth: 0.8, wait: 0.7, coverWait: 0.5, speed: "walk" })] }),
  },
  {
    id: "wide", name: "Wide swing", text: "A bot runs out wide from cover and holds the far side, then goes back.",
    build: (f) => ({ items: [f.wall(-3, 0, 4.5, 3), f.peeker([-3, 1.2], [1.6, 0.2], { speed: "run", peekStrafe: false, wait: 1.4, coverWait: 1 })] }),
  },
  {
    id: "offangle", name: "Off-angles", text: "Two holders, one crouched, from the sides of the area at different depths.",
    build: (f) => ({ items: [f.wall(3.4, 0, 3), f.bot("still", 5.6, 1.2, { facing: null }), f.bot("still", -5, 2.5, { facing: null, crouch: true })] }),
  },
  {
    id: "trade", name: "Trade fight", text: "Two bots side by side. When you kill the first, the second swings 0.3 to 0.8 s later.",
    build: (f) => {
      const first = f.bot("still", -1.6, 0, { facing: null });
      const second = f.bot("still", 2, 0.6, { facing: null, tradeOf: first.id, tradeMin: 0.3, tradeMax: 0.8 });
      return { items: [first, second] };
    },
  },
  {
    id: "retake", name: "Retake", text: "Three bots on a site: a crouched holder, a strafer and a peeker. You can walk.",
    build: (f) => ({
      items: [f.wall(3.2, 0, 3), f.bot("still", -4, 0.5, { facing: null, crouch: true }), f.bot("strafe", 0, 2.5, { width: 2 }), f.peeker([3.2, 1.2], [1, 0.2], { wait: 1.2 })],
      round: { move: true },
    }),
  },
  {
    id: "crossfire", name: "Post-plant crossfire", text: "Two holders far apart. Hurt one and the other swings 0.2 to 0.6 s later.",
    build: (f) => {
      const a = f.bot("still", -5, 0, { facing: null });
      const b = f.bot("still", 5, 0.8, { facing: null, swingRadius: 14, swingOn: "damage", swingMin: 0.2, swingMax: 0.6, swingChance: 100 });
      return { items: [a, b], round: { move: true } };
    },
  },
];

export function buildTemplate(id, anchor, start) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return null;
  const out = t.build(frame(anchor, start));
  return { items: out.items, round: out.round || null, name: t.name };
}
// Where a template goes by default: 12 m in the direction you face, but on the map's spawn side of things it just
// follows your start's facing like the editor's own heading (game yaw 0 looks down -z, positive turns left).
export function defaultAnchor(start, metres = 12) {
  const yaw = ((start.facing || 0) * Math.PI) / 180;
  return { x: r1(start.x - Math.sin(yaw) * metres), y: start.y || 0, z: r1(start.z - Math.cos(yaw) * metres) };
}

// ---------- extra warnings (soft: they never block saving) ----------
const inWall = (w, x, z) => {
  const a = ((w.turn || 0) * Math.PI) / 180, ux = Math.cos(a), uz = -Math.sin(a);
  const dx = x - w.x, dz = z - w.z;
  return Math.abs(dx * ux + dz * uz) <= (w.length || 0) / 2 && Math.abs(-dx * uz + dz * ux) <= wallDepth(w) / 2;
};
const inBlock = (b, x, z) => {
  const a = ((b.turn || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = x - b.x, dz = z - b.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
  if (b.shape === "pillar") return Math.hypot(lx, lz) <= Math.max((b.w || 0) / 2, 0.4);
  return Math.abs(lx) <= Math.max((b.w || 0) / 2, 0.3) && Math.abs(lz) <= Math.max((b.d || 0) / 2, 0.3);
};
const solidAt = (drill, x, z, y) => drill.items.find((s) => !s.invisible && ((s.kind === "wall" && inWall(s, x, z) && (s.height || 0) > 1) || (s.kind === "block" && s.shape !== "floor" && inBlock(s, x, z) && Math.abs((s.y || 0) - (y || 0)) < 0.5)));

export function lint(drill) {
  const out = [];
  const warn = (id, text) => out.push({ id, text, soft: true });
  const start = drill.start;
  if (!start || !Number.isFinite(start.x) || !Number.isFinite(start.z)) { out.push({ text: "There is no place for you to start." }); return out; }
  const s = solidAt(drill, start.x, start.z, start.y);
  if (s) warn("start", `Your start is inside ${itemName(drill, s)}. Move it out.`);
  const bots = drill.items.filter((i) => i.kind === "bot");
  const time = drill.round && drill.round.time;
  if (bots.length > 30) warn(null, `${bots.length} bots is a lot; the game may slow down. Try fewer or stagger them.`);
  bots.forEach((b, n) => {
    const name = itemName(drill, b);
    const d = Math.hypot(b.x - start.x, b.z - start.z);
    if (d < 1.5) warn(b.id, `${name} is right on top of your start.`);
    if (b.shoots !== "off" && d > 80) warn(b.id, `${name} is ${Math.round(d)} m away; bots only shoot within 80 m.`);
    const inside = solidAt(drill, b.x, b.z, b.y);
    if (inside) warn(b.id, `${name} stands inside ${itemName(drill, inside)}.`);
    for (const o of bots.slice(n + 1)) if (Math.hypot(o.x - b.x, o.z - b.z) < 0.35 && Math.abs((o.y || 0) - (b.y || 0)) < 1) warn(b.id, `${name} and ${itemName(drill, o)} are on the same spot.`);
    if (b.tradeOf && !tradeTarget(drill, b)) warn(b.id, `${name} trades a bot that isn't there any more. Pick another or turn the trade off.`);
    if (b.tradeOf && b.tradeMin > b.tradeMax) warn(b.id, `${name}: the trade delay's shortest time is longer than its longest.`);
    if (b.swingRadius > 0 && b.swingMin > b.swingMax) warn(b.id, `${name}: the swing delay's shortest time is longer than its longest.`);
    if (b.soundRule && b.soundRule.on && b.soundRule.delayMin > b.soundRule.delayMax) warn(b.id, `${name}: the sound swing delay's shortest time is longer than its longest.`);
    if (b.soundRule && b.soundRule.on && b.soundRule.area && (Math.abs(b.soundRule.area.x1 - b.soundRule.area.x0) < 0.5 || Math.abs(b.soundRule.area.z1 - b.soundRule.area.z0) < 0.5)) warn(b.id, `${name}'s sound area is too thin to stand in.`);
    if (b.soundRule && b.soundRule.on && !(b.soundRule.sources || []).length) warn(b.id, `${name} listens for a sound but none is chosen.`);
    if (Number.isFinite(time) && time > 0) {
      const late = Math.max(b.delay || 0, b.tradeStart ? b.tradeStartMin || 0 : 0);
      if (late >= time) warn(b.id, `${name} shows up after ${r1(late)} s but the round lasts ${time} s, so it never appears.`);
      if (b.tradeOf && b.tradeStart && b.tradeStartMin >= time) warn(b.id, `${name} first shows up after the round ends.`);
    }
    if (b.move === "peek" && b.route && b.route.length >= 2 && Math.hypot(b.route[0].x - b.route[1].x, b.route[0].z - b.route[1].z) < 0.3) warn(b.id, `${name}: the cover spot and the peek spot are the same place, so it doesn't peek.`);
    if (b.trigger) {
      const { a, b: e } = b.trigger;
      if (a && e && Math.hypot(a.x - e.x, a.z - e.z) < 0.5) warn(b.id, `${name}'s trigger line is too short to cross.`);
    }
  });
  for (const sm of drill.items.filter((i) => i.kind === "smoke")) if (Number.isFinite(time) && sm.at >= time) warn(sm.id, `A smoke goes off after the round ends.`);
  return out;
}

// ---------- what a bot will do, in words ----------
const rankName = (id) => (RANKS.find((r) => r[0] === id) || [id, id])[1];
const sec = (v) => `${r1(v)} s`;
const range = (a, b) => (b > a ? `${r1(a)} to ${r1(b)} s` : sec(a));
export function describeBot(bot, drill) {
  if (!bot || bot.kind !== "bot") return [];
  const lines = [];
  const sp = botSpots(bot).length;
  const m = bot.move;
  const where = hasZone(bot) ? "anywhere in its area" : sp > 1 ? `one of ${sp} spots, picked at random` : "its spot";
  const gun = bot.shoots === "off" ? "It doesn't shoot back." : `It shoots back as ${rankName(bot.shoots)}${bot.weapon ? "" : " (no gun shown)"}.`;
  // When it shows up.
  let up = "Shows up when the round starts";
  if (bot.tradeOf) {
    const t = tradeTarget(drill, bot);
    up = t ? `Shows up ${range(bot.tradeMin, bot.tradeMax)} after you kill ${itemName(drill, t)}${bot.tradeStart ? " (and is also there at the start)" : ""}` : "Waits for a bot that isn't there";
  } else if (bot.trigger) up = `Waits for you to cross its line, then shows up after ${sec(bot.delay || 0)}`;
  else if (swingRadiusOn(bot) || soundRuleOn(bot)) {
    const parts = [];
    if (swingRadiusOn(bot)) parts.push(`you ${bot.swingOn === "damage" ? "hurt or kill" : "kill"} a bot within ${r1(bot.swingRadius)} m of it`);
    if (soundRuleOn(bot)) parts.push(`you make ${bot.soundRule.sources.map((k) => (SOUND_SOURCES.find((s) => s[0] === k) || [k, k])[1].replace(/^Your /, "")).join(" or ")} in its sound area`);
    up = `Holds its angle until ${parts.join(", or ")}, then swings ${range(bot.swingMin ?? 0.3, bot.swingMax ?? 1)} later`;
    const chance = swingRadiusOn(bot) ? bot.swingChance : bot.soundRule.swingChance;
    if (Number.isFinite(chance) && chance < 100) up += `, ${Math.round(chance)}% of the time`;
  } else if ((bot.delay || 0) > 0) up = `Shows up ${sec(bot.delay)} into the round`;
  lines.push(`${up}.`);
  // What it does there.
  if (m === "still") lines.push(`Stands at ${where} and holds${bot.crouch ? " crouched" : ""}${typeof bot.facing === "number" ? `, looking at ${Math.round(bot.facing)} degrees` : ", facing you"}.`);
  else if (m === "strafe") lines.push(`Strafes ${r1(bot.width)} m side to side at ${where}${bot.unpredictable ? ", in random taps" : ""}.`);
  else if (m === "peek") lines.push(`Peeks out to ${where === "its spot" ? "its peek spot" : where} and ${bot.peekStrafe === "random" ? "either strafes or holds" : bot.peekStrafe ? `strafes ${r1(bot.peekWidth)} m` : "holds"} for ${sec(bot.wait)}, then hides for ${sec(bot.coverWait ?? 1)}${bot.randomWait > 0 ? ` plus up to ${sec(bot.randomWait)}` : ""}. Again and again.`);
  else if (m === "cross") lines.push(`Runs across from one point to the other and ${bot.back ? "comes back" : "is gone"}.`);
  else if (m === "patrol") lines.push(`Walks a route of ${(bot.route || []).length} points${bot.back ? " in a loop" : " once"}.`);
  else if (m === "copycat") lines.push(bot.track ? `Repeats your ${r1(bot.track.secs)} s recorded run (${bot.playback === "once" ? "once" : bot.playback === "pingpong" ? "back and forth" : "looping"}).` : "Has no recorded run yet.");
  if (bot.flash && bot.flash.on) lines.push("Throws a flash before it comes out.");
  if (bot.jump) lines.push("Jumps now and then.");
  if (bot.crouchRandom) lines.push("Crouches now and then.");
  lines.push(gun);
  if (bot.back !== false && m !== "still" && !bot.tradeOf) lines.push(`After you kill it, it is back after ${sec(bot.backAfter ?? 1.5)}.`);
  else if (bot.back === false) lines.push("After you kill it, it stays dead.");
  return lines;
}

// ---------- keyboard shortcuts (the help sheet) ----------
export const SHORTCUTS = [
  ["Editing", [["Ctrl+Z", "Undo"], ["Ctrl+Y or Ctrl+Shift+Z", "Redo"], ["Ctrl+S", "Save"], ["Del or Backspace", "Delete the selection"], ["Esc", "Cancel placing, clear the selection"]]],
  ["Selecting", [["Click", "Select one thing"], ["Shift+click", "Add to or take out of the selection"], ["Shift+drag on empty map", "Box-select (2D)"], ["Ctrl+A", "Select everything"]]],
  ["Copying", [["Ctrl+C", "Copy the selection (also to the clipboard as text)"], ["Ctrl+X", "Cut"], ["Ctrl+V", "Paste at the pointer, also into another drill"], ["Ctrl+D", "Duplicate next to it"]]],
  ["Moving", [["Arrow keys", "Nudge 0.5 m (2D view)"], ["Alt+arrows", "Nudge 0.1 m"], ["Shift+arrows", "Nudge 1 m"]]],
  ["Looking around", [["Scroll", "Zoom"], ["Drag empty map", "Pan"], ["Right-drag", "Pan"], ["WASD, Space, Ctrl", "Fly the camera (3D view)"]]],
  ["Help", [["?", "This sheet"]]],
];
