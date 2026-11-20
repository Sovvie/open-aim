// Snapping and alignment guides while dragging in the 2D view (pure, no DOM, testable in node).
// A dragged thing snaps (within a few pixels) so that its centre or its edges line up with the centre or the edges
// of the other things, and with your start. The result lists the guide lines to draw.
import { dimensions } from "./transform.js";

const r2 = (n) => Math.round(n * 100) / 100;

// Half size of a thing's outline along the world axes (0 for points: bots, targets, smokes).
export function extentOf(item) {
  if (!item || (item.kind !== "wall" && item.kind !== "block")) return { rx: 0, rz: 0 };
  const d = dimensions(item), a = ((item.turn || 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  return { rx: r2((c * d.w + s * d.d) / 2), rz: r2((s * d.w + c * d.d) / 2) };
}

// Arrow keys in the 3D view: screen right (sx = 1) / up (sy = -1) as the camera is turned by `yaw` (radians, the orbit
// camera's: it looks along -(sin, cos) on the ground). The result is the nearest of the four ground axes, so steps stay on the grid.
export function cameraNudge(sx, sy, step, yaw) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const fx = -s, fz = -c, rx = c, rz = -s; // forward and right on the ground
  const vx = rx * sx + fx * -sy, vz = rz * sx + fz * -sy;
  if (Math.abs(vx) >= Math.abs(vz)) return [r2(Math.sign(vx) * step), 0];
  return [0, r2(Math.sign(vz) * step)];
}

export const GRID = 0.5; // the coarse grid used while Snap is on (the free grid is 0.1 m, Alt = none)

// Snaps a position to the grid, rounded to whole `grid` steps.
export const toGrid = (v, grid = GRID) => r2(Math.round(v / grid) * grid);

const lines = (c, r) => (r > 0 ? [c - r, c, c + r] : [c]);

// One axis: the smallest move (within `threshold`) that puts one of my lines on one of theirs, or null.
function bestShift(mine, theirs, threshold) {
  let best = null;
  for (const a of mine) for (const b of theirs) {
    const d = b - a;
    if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best;
}

// moving: { x, z, rx?, rz? } where the thing is now. others: [{ x, z, rx?, rz? }]. threshold: metres.
// Returns { x, z, guides } with the snapped centre and guides: [{ axis: "x" | "z", v, a, b }] meaning a line at
// x = v (or z = v) running from a to b along the other axis. Nothing near -> the position unchanged, no guides.
export function snapGuides(moving, others, threshold) {
  const mrx = moving.rx || 0, mrz = moving.rz || 0;
  const out = { x: moving.x, z: moving.z, guides: [] };
  if (!others || !others.length || !(threshold > 0)) return out;
  const dx = bestShift(lines(moving.x, mrx), others.flatMap((o) => lines(o.x, o.rx || 0)), threshold);
  const dz = bestShift(lines(moving.z, mrz), others.flatMap((o) => lines(o.z, o.rz || 0)), threshold);
  if (dx !== null) out.x = r2(moving.x + dx);
  if (dz !== null) out.z = r2(moving.z + dz);
  const same = (p, q) => Math.abs(p - q) < 0.006;
  // One guide per distinct line the snapped thing now sits on, running through everything on that line.
  const add = (axis, mine, flat, span) => {
    const done = [];
    for (const v of mine) for (const o of others) {
      if (!lines(axis === "x" ? o.x : o.z, axis === "x" ? o.rx || 0 : o.rz || 0).some((w) => same(w, v)) || done.some((d) => same(d, v))) continue;
      done.push(v);
      const hits = others.filter((p) => lines(axis === "x" ? p.x : p.z, axis === "x" ? p.rx || 0 : p.rz || 0).some((w) => same(w, v)));
      const along = [flat, ...hits.map((p) => (axis === "x" ? p.z : p.x))];
      const ext = [...span, ...hits.map((p) => (axis === "x" ? p.rz || 0 : p.rx || 0))];
      const lo = Math.min(...along.map((q, i) => q - ext[i])), hi = Math.max(...along.map((q, i) => q + ext[i]));
      out.guides.push({ axis, v: r2(v), a: r2(lo), b: r2(hi) });
    }
  };
  if (dx !== null) add("x", lines(out.x, mrx), out.z, [mrz]);
  if (dz !== null) add("z", lines(out.z, mrz), out.x, [mrx]);
  return out;
}
