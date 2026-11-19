// Turns an "enemyShot" game event into a tracer shot for renderer.mjs (the "enemy" style in settings.mjs).
// The event carries origin (the shooter's eye), direction and hitPoint (wall, aim point, or end of range),
// set by tools/patch-enemy-shot-tracer.cjs. Called from OkAdunfX.js (tools/patch-enemy-tracer-draw.cjs).
const finite = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const copy = p => ({ x: p.x, y: p.y, z: p.z });

// Returns null when the event has no usable path (older events, or a bad number), so nothing is drawn.
export function enemyTracerShot(event, at, weapon) {
  if (!finite(event?.origin) || !finite(event.hitPoint)) return null;
  const direction = finite(event.direction) ? copy(event.direction) : {
    x: event.hitPoint.x - event.origin.x, y: event.hitPoint.y - event.origin.y, z: event.hitPoint.z - event.origin.z,
  };
  return {
    source: 'enemy', actorId: event.actorId, at, weapon,
    origin: copy(event.origin), direction, hitPoint: copy(event.hitPoint),
    seed: event.tick * 64 + event.actorId,
  };
}
