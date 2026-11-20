// Trigger dry run: what each bot will do after the round starts, in time order, worked out from the drill alone
// (pure, no DOM, testable in node). Times are the EARLIEST a thing can happen:
//   - fixed ones (a delay) are exact;
//   - ones that wait for you (a trigger line, a swing after a kill, a sound area, a trade) are "earliest": the time
//     you would need if you ran straight at it and killed at once. They can only come later, never sooner.
// Nothing here changes the drill or the compiler; it reads the same fields the compiler reads.
import { botSpots, tradeTarget, swingRadiusOn, soundRuleOn, SPEEDS, itemName } from "./drill.js";

const r1 = (n) => Math.round(n * 10) / 10;
const sec = (v) => `${r1(v)} s`;
const span = (a, b) => (b > a ? `${r1(a)} to ${r1(b)} s` : sec(a));
const num = (v, d) => (Number.isFinite(v) ? v : d);

export const segDist = (p, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
};
export const rectDist = (p, area) => {
  const x0 = Math.min(area.x0, area.x1), x1 = Math.max(area.x0, area.x1), z0 = Math.min(area.z0, area.z1), z1 = Math.max(area.z0, area.z1);
  return Math.hypot(Math.max(x0 - p.x, 0, p.x - x1), Math.max(z0 - p.z, 0, p.z - z1));
};

// -> { rows, notes, end }.
// row: { id, name, t (earliest seconds, Infinity = never), tMax (end of an exact window, else = t), exact, type, text, then: [..] }
// type: start | appear | turn | trade | trigger | swing | sound | smoke | end
export function dryRun(drill) {
  const round = drill.round || {}, start = drill.start || { x: 0, z: 0 };
  const run = SPEEDS.run;
  const canWalk = !!round.move;
  const bots = drill.items.filter((i) => i.kind === "bot");
  const notes = [];
  const rows = [];
  const oneByOne = round.order && round.order !== "together" && round.goal !== "track";
  const atOnce = Math.max(1, Math.round(num(round.atOnce, 1))), gap = Math.max(0, num(round.gap, 1));
  const reach = (dist) => (dist < 0.5 ? 0 : canWalk ? dist / run : Infinity); // seconds to get there, or never if you can't walk
  const nameOf = (b) => itemName(drill, b);

  // Earliest first appearance of every bot, with why (memo + cycle guard).
  const memo = new Map(), busy = new Set();
  function first(bot) {
    if (memo.has(bot.id)) return memo.get(bot.id);
    if (busy.has(bot.id)) return { t: Infinity, why: "cycle" };
    busy.add(bot.id);
    let res = plainOrGated(bot);
    busy.delete(bot.id);
    memo.set(bot.id, res);
    return res;
  }
  function plainOrGated(bot) {
    const cands = [];
    if (bot.tradeOf) {
      const target = tradeTarget(drill, bot);
      if (target) cands.push({ t: first(target).t + Math.max(0, num(bot.tradeMin, 0.3)), type: "trade", target });
      if (bot.tradeStart) cands.push({ t: Math.max(0, num(bot.tradeStartMin, 0)), tMax: Math.max(num(bot.tradeStartMin, 0), num(bot.tradeStartMax, 0)), exact: true, type: "appear", viaStart: true });
      if (!target && !bot.tradeStart) return { t: Infinity, type: "trade", why: "target gone" };
    } else if (bot.trigger) {
      const d = segDist(start, bot.trigger.a, bot.trigger.b);
      const w = reach(d);
      cands.push({ t: w + Math.max(0, num(bot.delay, 0)), type: "trigger", dist: d, blocked: w === Infinity });
    } else if (swingRadiusOn(bot) || soundRuleOn(bot)) {
      if (swingRadiusOn(bot)) {
        const lo = Math.max(0, num(bot.swingMin, 0.3));
        let best = Infinity, who = null, any = false;
        for (const o of bots) {
          if (o.id === bot.id) continue;
          const near = botSpots(o).some((s) => Math.hypot(s.x - bot.x, s.z - bot.z) <= bot.swingRadius);
          if (!near) continue;
          any = true;
          const t = first(o).t;
          if (t + lo < best) { best = t + lo; who = o; }
        }
        cands.push({ t: best, type: "swing", who, nobody: !any });
      }
      if (soundRuleOn(bot)) {
        const rule = bot.soundRule, d = rectDist(start, rule.area), w = reach(d);
        cands.push({ t: w + Math.max(0, num(rule.delayMin, 0.3)), type: "sound", dist: d, blocked: w === Infinity });
      }
    } else {
      const d = Math.max(0, num(bot.delay, 0));
      if (oneByOne) cands.push({ t: gap, exact: false, type: "turn" });
      else cands.push({ t: d, exact: true, type: "appear" });
    }
    cands.sort((a, b) => a.t - b.t);
    return cands[0] || { t: Infinity };
  }

  const backText = (b) => (b.back === false ? "If you kill it, it stays dead." : b.tradeOf ? "Shows up again after each kill of the bot it trades." : `If you kill it, it is back after ${sec(num(b.backAfter, 1.5))}.`);
  const moveText = (b) => {
    if (b.move === "peek") return `Peeks out and holds ${sec(num(b.wait, 1))}, hides ${sec(num(b.coverWait, 1))}${num(b.randomWait, 0) > 0 ? ` plus up to ${sec(b.randomWait)}` : ""}, again and again.`;
    if (b.move === "cross") return b.back ? "Runs across, then back." : "Runs across and is gone.";
    if (b.move === "patrol") return b.back ? "Walks its route in a loop." : "Walks its route once.";
    return null;
  };

  for (const b of bots) {
    const name = nameOf(b);
    const then = [moveText(b), b.flash && b.flash.on ? "Throws a flash before it comes out." : null, backText(b)].filter(Boolean);
    const base = { id: b.id, name, then };
    const trade = b.tradeOf ? tradeTarget(drill, b) : null;
    if (b.tradeOf) {
      if (b.tradeStart) rows.push({ ...base, t: Math.max(0, num(b.tradeStartMin, 0)), tMax: Math.max(num(b.tradeStartMin, 0), num(b.tradeStartMax, 0)), exact: true, type: "appear", text: `Shows up at the start of the round${num(b.tradeStartMax, 0) > 0 ? ` (between ${span(num(b.tradeStartMin, 0), b.tradeStartMax)})` : ""}.` });
      if (trade) {
        const t = first(trade).t + Math.max(0, num(b.tradeMin, 0.3));
        rows.push({ ...base, t, tMax: t, exact: false, type: "trade", then: b.tradeStart ? [] : then, text: `Trades ${nameOf(trade)}: shows up ${span(num(b.tradeMin, 0.3), Math.max(num(b.tradeMin, 0.3), num(b.tradeMax, 1)))} after you kill it.` });
      } else if (!b.tradeStart) rows.push({ ...base, t: Infinity, tMax: Infinity, exact: false, type: "trade", text: "Waits to trade a bot that isn't in the drill, so it never shows up." });
    } else if (b.trigger) {
      const d = segDist(start, b.trigger.a, b.trigger.b), w = reach(d), delay = Math.max(0, num(b.delay, 0));
      rows.push({ ...base, t: w + delay, tMax: w + delay, exact: false, type: "trigger",
        text: w === Infinity ? `Waits for you to cross its line, but you can't walk in this drill (the line is ${r1(d)} m away), so it never shows up.`
          : `You cross its line${d >= 0.5 ? ` (${r1(d)} m from your start, about ${sec(w)} if you run straight at it)` : ""}, then it shows up after ${sec(delay)}.` });
    } else if (swingRadiusOn(b) || soundRuleOn(b)) {
      if (swingRadiusOn(b)) {
        const lo = Math.max(0, num(b.swingMin, 0.3)), hi = Math.max(lo, num(b.swingMax, 1));
        const c = plainOrGatedSwing(b);
        rows.push({ ...base, t: c.t, tMax: c.t, exact: false, type: "swing", then: soundRuleOn(b) ? [] : then,
          text: c.nobody ? `Swings ${span(lo, hi)} after you ${b.swingOn === "damage" ? "hurt or kill" : "kill"} a bot within ${r1(b.swingRadius)} m of it, but no bot ever stands that close, so it never swings.`
            : `Swings ${span(lo, hi)} after you ${b.swingOn === "damage" ? "hurt or kill" : "kill"} a bot within ${r1(b.swingRadius)} m, the first chance being ${c.who ? nameOf(c.who) : "a bot"}${Number.isFinite(c.t) ? "" : " (which never shows up)"}.` });
      }
      if (soundRuleOn(b)) {
        const rule = b.soundRule, d = rectDist(start, rule.area), w = reach(d), lo = Math.max(0, num(rule.delayMin, 0.3)), hi = Math.max(lo, num(rule.delayMax, 1));
        rows.push({ ...base, t: w + lo, tMax: w + lo, exact: false, type: "sound", then,
          text: w === Infinity ? `Swings when you make a sound in its area, but you can't walk in this drill (the area is ${r1(d)} m away), so it never swings.`
            : `Swings ${span(lo, hi)} after you make a sound in its area${d >= 0.5 ? ` (${r1(d)} m from your start, about ${sec(w)} to get there)` : " (you start inside it)"}.` });
      }
    } else if (oneByOne) {
      const idx = bots.filter((o) => !o.tradeOf && !o.trigger && !swingRadiusOn(o) && !soundRuleOn(o)).indexOf(b);
      rows.push({ ...base, t: gap, tMax: gap + 0.5, exact: false, type: "turn",
        text: `Takes turns: up to ${atOnce} at once, ${round.order === "inOrder" ? (idx < atOnce ? "in your list order, among the first" : "in your list order, after one of the first is killed") : "in random order"}; the next comes ${span(gap, gap + 0.5)} after one is gone.` });
    } else {
      const d = Math.max(0, num(b.delay, 0));
      rows.push({ ...base, t: d, tMax: d, exact: true, type: "appear", text: d > 0 ? `Shows up ${sec(d)} into the round.` : "Is there when the round starts." });
    }
  }
  function plainOrGatedSwing(b) {
    const lo = Math.max(0, num(b.swingMin, 0.3));
    let best = Infinity, who = null, any = false;
    for (const o of bots) {
      if (o.id === b.id) continue;
      if (!botSpots(o).some((s) => Math.hypot(s.x - b.x, s.z - b.z) <= b.swingRadius)) continue;
      any = true;
      const t = first(o).t + lo;
      if (t < best) { best = t; who = o; }
    }
    return { t: best, who, nobody: !any };
  }

  for (const s of drill.items) if (s.kind === "smoke") {
    const t = Math.max(0, num(s.at, 0));
    rows.push({ id: s.id, name: itemName(drill, s), t, tMax: t, exact: true, type: "smoke", then: [], text: `Goes up${t > 0 ? ` ${sec(t)} into the round` : " when the round starts"}.` });
  }

  const timed = round.goal !== "clear" && num(round.time, 0) > 0;
  const end = timed ? num(round.time, 0) : null;

  // Problems with the order of things.
  for (const r of rows) if (r.t === Infinity) notes.push(`${r.name} never happens: ${r.text}`);
  if (end !== null) for (const r of rows) if (Number.isFinite(r.t) && r.t > end && r.type !== "smoke") notes.push(`${r.name} can't happen before the round ends (earliest ${sec(r.t)}, the round is ${sec(end)}).`);
  const live = rows.filter((r) => ["appear", "turn", "trade", "trigger", "swing", "sound"].includes(r.type) && Number.isFinite(r.t));
  const firstUp = live.length ? Math.min(...live.map((r) => r.t)) : null;
  if (bots.length && firstUp !== null && firstUp > 4) notes.push(`Nothing is there to shoot for the first ${sec(firstUp)}. That is a long wait; check the delays.`);
  if (bots.length && !live.length) notes.push("No bot can ever show up in this drill.");

  rows.sort((a, b) => (a.t === b.t ? (a.exact === b.exact ? 0 : a.exact ? -1 : 1) : a.t - b.t));
  return { rows, notes, end, canWalk };
}
