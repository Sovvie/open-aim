// Map helpers for the Valorant Workshop generator (tools/make-valorant-scenes.mjs) and its test.
//   const kit = await loadMapKit("juliett");
//   kit.levelsAt(x, z)      walkable floor heights at a point (lowest first), the Studio's own answer
//   kit.floorAt(x, z, y)    the floor height nearest y (or null when there is none)
//   kit.standsOn(p)         true when p = {x,y,z} is on walkable floor or on a box top the Studio can stand a bot on
//   kit.sees(a, b)          true when no wall of the map's player collision lies between two eye/chest points
// Floors come from app/studio/map-data.js (the same code the Studio uses to put bots on the ground).
// The sight check uses the map's "projectile" collision (what bullets stop at). It is still an approximation, so the
// generator treats a "blocked" answer as a warning, never as a fact.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "app", "site");
const CELL = 2;

export const MAPS_WITH_DATA = ["ascent", "bonsai", "duality", "jam", "juliett", "pitt", "plummet", "port", "rook", "triad"];

// Same walk as map-data.js triangles(): world-space triangles of the collision sets.
function worldTriangles(collision, setNames, keep) {
  const tris = [];
  for (const setName of setNames) {
    const set = collision.sets[setName];
    if (!set) continue;
    for (let n = 0; n < set.count; n++) {
      const prim = collision.prims[set.prim[n]];
      if (!keep(prim)) continue;
      const m = set.m.slice(n * 12, n * 12 + 12);
      const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
      const p = prim.pos;
      const world = (i) => {
        const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
        return [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
      };
      const idx = prim.idx || [...Array(prim.verts).keys()];
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const a = world(idx[t]), b = world(idx[t + 1]), c = world(idx[t + 2]);
        tris.push(...a, ...b, ...c);
      }
    }
  }
  return tris;
}

function bucketOf(tris) {
  const grid = new Map();
  const count = tris.length / 9;
  for (let t = 0; t < count; t++) {
    const o = t * 9;
    const x0 = Math.floor(Math.min(tris[o], tris[o + 3], tris[o + 6]) / CELL), x1 = Math.floor(Math.max(tris[o], tris[o + 3], tris[o + 6]) / CELL);
    const z0 = Math.floor(Math.min(tris[o + 2], tris[o + 5], tris[o + 8]) / CELL), z1 = Math.floor(Math.max(tris[o + 2], tris[o + 5], tris[o + 8]) / CELL);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 400) continue; // huge sky caps and ground slabs do not block sight lines
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const key = gx * 100003 + gz;
      let list = grid.get(key);
      if (!list) grid.set(key, (list = []));
      list.push(t);
    }
  }
  return { tris, grid };
}

// Moller-Trumbore, limited to the segment (t between 0 and 1).
function segmentHits(T, o, ax, ay, az, dx, dy, dz) {
  const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2];
  const e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-9) return false;
  const inv = 1 / det;
  const sx = ax - T[o], sy = ay - T[o + 1], sz = az - T[o + 2];
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return false;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return false;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 0.02 && t < 0.98;
}

export async function loadMapKit(id) {
  const M = await import(pathToFileURL(path.join(ROOT, "app", "studio", "map-data.js")).href);
  const load = async (u) => JSON.parse(fs.readFileSync(path.join(SITE, u), "utf8"));
  const map = await M.loadMap(id, load);
  const collision = await load(`/aim-maps/${id}.collision.json`);
  const sets = (process.env.KITSETS || "projectile").split(",").filter((s) => collision.sets[s]);
  const solid = bucketOf(worldTriangles(collision, sets, () => true));

  const levelsAt = (x, z) => map.levelsAt(x, z);
  const floorAt = (x, z, near = 0) => {
    const l = levelsAt(x, z);
    if (!l.length) return null;
    return l.reduce((best, y) => (Math.abs(y - near) < Math.abs(best - near) ? y : best), l[0]);
  };
  // Is the straight line between two points free of collision? Points are {x, y, z} in world metres.
  function clear(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
    const steps = Math.max(1, Math.ceil(len / (CELL * 0.5)));
    const seen = new Set();
    for (let i = 0; i <= steps; i++) {
      const f = i / steps, x = a.x + dx * f, z = a.z + dz * f;
      for (const ox of [0, -1, 1]) for (const oz of [0, -1, 1]) {
        const key = (Math.floor(x / CELL) + ox) * 100003 + Math.floor(z / CELL) + oz;
        const list = solid.grid.get(key);
        if (!list) continue;
        for (const t of list) {
          if (seen.has(t)) continue;
          seen.add(t);
          if (segmentHits(solid.tris, t * 9, a.x, a.y, a.z, dx, dy, dz)) return false;
        }
      }
    }
    return true;
  }
  // Standing eye (1.6 m) of a to the chest or head of a standing target at b (feet positions).
  const sees = (a, b) => {
    const eye = { x: a.x, y: a.y + 1.6, z: a.z };
    return [1.0, 1.55].some((h) => clear(eye, { x: b.x, y: b.y + h, z: b.z }));
  };
  // Something to stand on at (x, z) within tol of y: walkable floor, or the top of a box or ledge the Studio lets you place a bot on.
  const standsOn = (p, tol = 0.6) => levelsAt(p.x, p.z).some((y) => Math.abs(y - p.y) < tol) || map.spotsAt(p.x, p.z).some((y) => Math.abs(y - p.y) < tol);
  return { id, levelsAt, floorAt, sees, clear, standsOn };
}

// ---------- positions ----------
const TAU = Math.PI * 2;
export const yawTo = (a, b) => Math.atan2(-(b.x - a.x), -(b.z - a.z)); // game yaw: 0 looks down -z, positive turns left
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Can someone walk from a to b without leaving the floor level they stand on? (steps of 0.4 m, each on a floor within tol of a's height)
export function walkable(kit, a, b, tol = 0.45) {
  const n = Math.max(1, Math.ceil(dist2(a, b) / 0.4));
  for (let i = 0; i <= n; i++) {
    const f = i / n, x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
    if (!kit.levelsAt(x, z).some((y) => Math.abs(y - a.y) <= tol)) return false;
  }
  return true;
}

// A hiding place for a peeker whose peek spot is `spot`, seen from `start`: a floor point 1.6 to 4 m from the spot, on its level,
// reachable by walking, that `start` cannot see. Prefers a point out to the side (a real shoulder or wide peek) and the
// shortest walk. Returns { cover: {x,y,z}, hidden: true } or null.
export function findCover(kit, start, spot, { min = 1.6, max = 4, side = 0 } = {}) {
  const base = yawTo(start, spot);
  let best = null;
  for (let r = min; r <= max + 1e-9; r += 0.4) for (let k = 0; k < 24; k++) {
    const a = (k / 24) * TAU;
    const c = { x: Math.round((spot.x + Math.cos(a) * r) * 10) / 10, z: Math.round((spot.z + Math.sin(a) * r) * 10) / 10 };
    const y = kit.floorAt(c.x, c.z, spot.y);
    if (y === null || Math.abs(y - spot.y) > 0.35) continue;
    const cover = { x: c.x, y, z: c.z };
    if (kit.sees(start, cover) || kit.sees(start, { ...cover, y: cover.y + 0.3 })) continue;
    if (!walkable(kit, cover, spot)) continue;
    // how far to the side of the line start -> spot (positive: toward the player's left)
    const lateral = (cover.x - spot.x) * Math.cos(base) * -1 + (cover.z - spot.z) * Math.sin(base) * 1;
    const score = r + (side ? (Math.sign(lateral) === Math.sign(side) ? -2 : 2) : 0) - Math.min(Math.abs(lateral), 3) * 0.5;
    if (!best || score < best.score) best = { cover, score, r, lateral };
  }
  return best ? { cover: best.cover, lateral: best.lateral, walk: best.r } : null;
}

// ---------- the game's own scene check ----------
// app/site/next/js/D_iGclxB.js holds the game's scene validator (export p, "Not a valid scene file"). It starts with an import of
// /local/map-registry.mjs, which the app serves at run time; here that import is replaced by the list of maps the app supports.
export const GAME_MAP_IDS = ["ascent", "bonsai", "duality", "foxtrot", "infinity", "jam", "juliett", "pitt", "plummet", "port", "range", "rook", "triad"];
export async function loadGameCheck() {
  const os = await import("node:os");
  const file = path.join(ROOT, "app", "site", "next", "js", "D_iGclxB.js");
  const source = fs.readFileSync(file, "utf8");
  const head = 'import {mapIds as localMapIds} from "/local/map-registry.mjs";';
  if (!source.startsWith(head)) throw new Error("D_iGclxB.js no longer starts with the map-registry import; update loadGameCheck()");
  const stub = path.join(os.tmpdir(), `openvaim-gamecheck-${process.pid}.mjs`);
  fs.writeFileSync(stub, `const localMapIds=${JSON.stringify(GAME_MAP_IDS)};` + source.slice(head.length));
  try {
    const mod = await import(pathToFileURL(stub).href);
    return mod.p; // p(jsonText) throws Error(message) for a scene the game would refuse
  } finally {
    try { fs.rmSync(stub); } catch { /* temp file, harmless */ }
  }
}
