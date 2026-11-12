// Sanity checks for the slice math.  Run with:  node src/slice4d.check.ts
import assert from 'node:assert/strict'
import { alongNormal, constrainToRoom, embed, makeSlice, offset, planeBoxPolygon, reach, wrapW } from './slice4d.ts'
import type { Event4, Vec3 } from './slice4d.ts'

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`)
const rnd = (s: number) => (Math.random() * 2 - 1) * s
const rv = (s: number): Vec3 => [rnd(s), rnd(s), rnd(s)]
const dist4 = (p: Event4, q: Event4) => Math.hypot(p.x[0] - q.x[0], p.x[1] - q.x[1], p.x[2] - q.x[2], p.w - q.w)

const half: Vec3 = [3.7, 1.7, 3.7]
const hw = 4

for (let i = 0; i < 2000; i++) {
  const s = makeSlice({ ax: rnd(180), ay: rnd(90), az: rnd(90) })
  near(Math.hypot(...s.n), 1)
  near(s.sin * s.sin + s.cos * s.cos, 1)

  const cam: Event4 = { x: rv(3), w: rnd(hw) }
  const d = offset(s, cam)
  const r1 = rv(20), r2 = rv(20)
  const p1 = embed(s, cam, r1), p2 = embed(s, cam, r2)

  // every point reached by walking inside the slice is still on the same hyperplane
  near(offset(s, p1), d, 1e-8)
  // the embedding is an isometry: distances inside the slice are true 4D distances
  near(dist4(p1, p2), Math.hypot(r1[0] - r2[0], r1[1] - r2[1], r1[2] - r2[2]), 1e-8)
  // moving along the normal changes the offset by exactly that much
  near(offset(s, alongNormal(s, cam, 0.37)), d + 0.37, 1e-9)

  // a camera inside the box (with w folded into one loop) is always within reach
  assert.ok(Math.abs(offset(s, { x: cam.x, w: wrapW(cam.w + rnd(100), hw) })) <= reach(s, [3, 3, 3], hw) + 1e-9)

  // collision keeps the slice where it is and brings the camera back inside
  const out: Event4 = { x: rv(12), w: rnd(hw) }
  const fixed = constrainToRoom(s, out, half)
  near(offset(s, fixed), offset(s, out), 1e-7)
  if (Math.abs(s.cos) > 0.05) for (let k = 0; k < 3; k++) assert.ok(Math.abs(fixed.x[k]) <= half[k] + 1e-6, `axis ${k} still outside`)
}

// zero tilt: the slice is ordinary space at one instant
{
  const s = makeSlice({ ax: 0, ay: 0, az: 0 })
  const p = embed(s, { x: [1, 2, 3], w: 0.5 }, [4, 5, 6])
  assert.deepEqual(p.x, [5, 7, 9]); near(p.w, 0.5)
}
// 90° towards X: walking along slice-x no longer moves you in space at all, only through time
{
  const s = makeSlice({ ax: 90, ay: 0, az: 0 })
  const p = embed(s, { x: [1, 2, 3], w: 0 }, [4, 5, 6])
  near(p.x[0], 1); near(p.x[1], 7); near(p.x[2], 9); near(p.w, -4)
}
// the third angle reduces to the 2D formula when it is zero
{
  const s = makeSlice({ ax: 35, ay: 25, az: 0 })
  const az = (35 * Math.PI) / 180, el = (25 * Math.PI) / 180
  near(s.n[0], Math.sin(az) * Math.cos(el)); near(s.n[1], Math.sin(el)); near(s.n[2], 0); near(s.n[3], Math.cos(az) * Math.cos(el))
}
// plane / box polygon: an axis-aligned cut is the box's own rectangle, a diagonal cut can be a hexagon
assert.equal(planeBoxPolygon([0, 0, 1], 0, [1, 2, 3]).length, 4)
assert.equal(planeBoxPolygon([1, 1, 1], 0, [1, 1, 1]).length, 6)
assert.equal(planeBoxPolygon([0, 0, 1], 5, [1, 2, 3]).length, 0)
near(wrapW(4, 4), -4); near(wrapW(-4.5, 4), 3.5); near(wrapW(13, 4), -3)

console.log('slice4d: all checks passed')
