// The default world: a white room with a few moving primitives. One description drives everything —
// the GLSL distance field that is ray-marched, the JS distance field used for camera collision,
// and the world-tubes drawn in the spacetime map.
//
// Every motion is a sum of sines whose frequencies are whole multiples of the loop, so the world is
// exactly periodic in time and the 4D object closes on itself.

import type { Vec3 } from './slice4d'

/** Half-extents of the room in metres (floor is at y = -ROOM[1]). */
export const ROOM: Vec3 = [4, 2, 4]
/** Length of one loop of the animation, seconds. */
export const LOOP = 8

const TAU = Math.PI * 2
const ROUND = 0.04 // corner radius of boxes

export type Obj = {
  kind: 'sphere' | 'box'
  /** sphere: [radius, 0, 0] · box: half-extents */
  size: Vec3
  center: Vec3
  /** position = center + amp · sin(freq · phase + phase0), per axis; freq in whole cycles per loop */
  amp: Vec3
  freq: Vec3
  phase: Vec3
  /** fold the vertical sine so the object bounces off its lowest point */
  bounce?: boolean
  /** whole turns about the vertical axis per loop (boxes) */
  spin?: number
  color: number
}

export const OBJECTS: Obj[] = [
  // orbits the pillar: a helix in spacetime
  { kind: 'sphere', size: [0.45, 0, 0], center: [0, -1.55, 0], amp: [2.2, 0, 2.2], freq: [1, 0, 1], phase: [Math.PI / 2, 0, 0], color: 0xf59e42 },
  // bounces on the spot
  { kind: 'sphere', size: [0.35, 0, 0], center: [-2.8, -1.65, 1.6], amp: [0, 1.6, 0], freq: [0, 2, 0], phase: [0, 0, 0], bounce: true, color: 0x4f8ef7 },
  // slides along the far wall
  { kind: 'box', size: [0.5, 0.5, 0.5], center: [0, -1.5, -2.9], amp: [2.4, 0, 0], freq: [1, 0, 0], phase: [0, 0, 0], color: 0x4ade80 },
  // spins without going anywhere: a twisted column in spacetime
  { kind: 'box', size: [0.75, 0.5, 0.22], center: [2.9, -1.5, 2.2], amp: [0, 0, 0], freq: [0, 0, 0], phase: [0, 0, 0], spin: 1, color: 0xa78bfa },
  // does not move at all
  { kind: 'box', size: [0.25, 1, 0.25], center: [0, -1, 0], amp: [0, 0, 0], freq: [0, 0, 0], phase: [0, 0, 0], color: 0xfacc15 },
  // figure-eight overhead
  { kind: 'sphere', size: [0.3, 0, 0], center: [0, 0.9, 0], amp: [2.4, 0, 1.0], freq: [1, 0, 2], phase: [0, 0, 0], color: 0xf2617a },
]

const boundR = (o: Obj) => Math.hypot(o.size[0], o.size[1], o.size[2])

/** Where an object's centre is at time t (seconds). */
export function position(o: Obj, t: number): Vec3 {
  const ph = (TAU * t) / LOOP
  const s: Vec3 = [
    Math.sin(o.freq[0] * ph + o.phase[0]),
    Math.sin(o.freq[1] * ph + o.phase[1]),
    Math.sin(o.freq[2] * ph + o.phase[2]),
  ]
  if (o.bounce) s[1] = Math.abs(s[1])
  return [o.center[0] + o.amp[0] * s[0], o.center[1] + o.amp[1] * s[1], o.center[2] + o.amp[2] * s[2]]
}

/** Radius of an object's footprint seen from above (for the spacetime map). */
export const footprint = (o: Obj) => (o.kind === 'sphere' ? o.size[0] : (o.size[0] + o.size[2]) / 2)

/** Signed distance from a point to the nearest object at time t. Mirrors the GLSL below. */
export function sdfObjects(x: Vec3, t: number): number {
  const ph = (TAU * t) / LOOP
  let best = Infinity
  for (const o of OBJECTS) {
    const c = position(o, t)
    const p: Vec3 = [x[0] - c[0], x[1] - c[1], x[2] - c[2]]
    let d: number
    if (o.kind === 'sphere') d = Math.hypot(p[0], p[1], p[2]) - o.size[0]
    else {
      const rho = Math.hypot(p[0], p[1], p[2]), R = boundR(o)
      if (o.spin && rho > 2 * R) d = rho - R
      else {
        let lx = p[0], lz = p[2]
        if (o.spin) {
          const cs = Math.cos(o.spin * ph), sn = Math.sin(o.spin * ph)
          lx = cs * p[0] - sn * p[2]; lz = sn * p[0] + cs * p[2]
        }
        const qx = Math.abs(lx) - o.size[0] + ROUND, qy = Math.abs(p[1]) - o.size[1] + ROUND, qz = Math.abs(lz) - o.size[2] + ROUND
        d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - ROUND
      }
    }
    if (d < best) best = d
  }
  return best
}

/**
 * Upper bound on how fast the distance field can change per second. Tilting the slice mixes time into
 * space, so the ray-marcher has to shorten its steps by this much to stay safe.
 */
export const V_MAX = Math.max(...OBJECTS.map((o) => {
  const w = TAU / LOOP
  const lin = Math.hypot(o.amp[0] * o.freq[0] * w, o.amp[1] * o.freq[1] * w, o.amp[2] * o.freq[2] * w)
  return lin + (o.spin ? Math.abs(o.spin) * w * 2 * boundR(o) : 0)
}))

// ───────────────────────── GLSL generation ─────────────────────────
const f = (n: number) => n.toFixed(5)
const v3 = (v: Vec3) => `vec3(${f(v[0])}, ${f(v[1])}, ${f(v[2])})`
const rgb = (hex: number) => `vec3(${f(((hex >> 16) & 255) / 255)}, ${f(((hex >> 8) & 255) / 255)}, ${f((hex & 255) / 255)})`

/** `vec2 mapObjects(vec3 x, float ph)` → (distance, object id starting at 1) and `vec3 objColor(float id)`. */
export function objectsGLSL(): string {
  const body = OBJECTS.map((o, i) => {
    const lines = [`vec3 s = sin(${v3(o.freq)} * ph + ${v3(o.phase)});`]
    if (o.bounce) lines.push('s.y = abs(s.y);')
    lines.push(`vec3 p = x - (${v3(o.center)} + ${v3(o.amp)} * s);`)
    if (o.kind === 'sphere') lines.push(`float d = length(p) - ${f(o.size[0])};`)
    else {
      const box = `sdRoundBox(p, ${v3(o.size)})`
      if (o.spin) {
        const R = boundR(o)
        lines.push(
          'float rho = length(p); float d;',
          // far away, fall back to the bounding sphere: it does not change as the box turns
          `if (rho > ${f(2 * R)}) d = rho - ${f(R)};`,
          `else { float cs = cos(${f(o.spin)} * ph), sn = sin(${f(o.spin)} * ph); p.xz = vec2(cs * p.x - sn * p.z, sn * p.x + cs * p.z); d = ${box}; }`,
        )
      } else lines.push(`float d = ${box};`)
    }
    lines.push(`if (d < res.x) res = vec2(d, ${f(i + 1)});`)
    return `  {\n    ${lines.join('\n    ')}\n  }`
  }).join('\n')

  const colors = OBJECTS.map((o, i) => `  if (id < ${f(i + 1.5)}) return ${rgb(o.color)};`).join('\n')

  return /* glsl */ `
float sdRoundBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b + ${f(ROUND)};
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - ${f(ROUND)};
}
vec2 mapObjects(vec3 x, float ph) {
  vec2 res = vec2(1e9, 0.0);
${body}
  return res;
}
vec3 objColor(float id) {
${colors}
  return vec3(0.8);
}`
}
