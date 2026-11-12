// Pure math for slicing a 4D object (3D space × time) with a 3D hyperplane.
//
// A 4D point is (x, y, z, w) with w = c·t, centred so one loop of the animation spans w ∈ [-hw, hw).
// The slice is the hyperplane through the camera's event with unit normal n. Its 3D basis is R(n)·(x̂, ŷ, ẑ),
// where R(n) is the smallest rotation that takes the time axis onto n, so at zero tilt the slice is plain space.

export type Vec3 = [number, number, number]
export type Vec4 = [number, number, number, number]

/** Degrees. Direct extension of the 2D azimuth / elevation pair by one more angle. */
export type Angles = { ax: number; ay: number; az: number }

/** A point in space-time: where the camera is and when. */
export type Event4 = { x: Vec3; w: number }

export type Slice = {
  n: Vec4
  /** cos θ = n·t̂ : how much of the normal still points along time. */
  cos: number
  /** sin θ = |n.xyz| : how much of it has tipped into space. */
  sin: number
  /** Unit spatial direction the normal tips towards. */
  a: Vec3
}

const RAD = Math.PI / 180

export const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2]

export function makeSlice({ ax, ay, az }: Angles): Slice {
  const a = ax * RAD, b = ay * RAD, g = az * RAD
  const n: Vec4 = [
    Math.sin(a) * Math.cos(b) * Math.cos(g),
    Math.sin(b) * Math.cos(g),
    Math.sin(g),
    Math.cos(a) * Math.cos(b) * Math.cos(g),
  ]
  const sin = Math.hypot(n[0], n[1], n[2])
  const dir: Vec3 = sin > 1e-9 ? [n[0] / sin, n[1] / sin, n[2] / sin] : [1, 0, 0]
  return { n, cos: n[3], sin, a: dir }
}

/** Slice-space offset r (metres inside the slice, measured from `from`) → the 4D event it lands on. */
export function embed(s: Slice, from: Event4, r: Vec3): Event4 {
  const ra = dot(r, s.a)
  const k = (s.cos - 1) * ra
  return {
    x: [from.x[0] + r[0] + s.a[0] * k, from.x[1] + r[1] + s.a[1] * k, from.x[2] + r[2] + s.a[2] * k],
    w: from.w - s.sin * ra,
  }
}

/** Move an event by `delta` along the slice's own normal. */
export function alongNormal(s: Slice, from: Event4, delta: number): Event4 {
  return {
    x: [from.x[0] + s.n[0] * delta, from.x[1] + s.n[1] * delta, from.x[2] + s.n[2] * delta],
    w: from.w + s.n[3] * delta,
  }
}

/** Signed offset of the slice from the centre of the 4D box, along its normal. */
export function offset(s: Slice, e: Event4): number {
  return s.n[0] * e.x[0] + s.n[1] * e.x[1] + s.n[2] * e.x[2] + s.n[3] * e.w
}

/** Largest |offset| at which the slice still touches the 4D box with half-extents (half, hw). */
export function reach(s: Slice, half: Vec3, hw: number): number {
  return Math.abs(s.n[0]) * half[0] + Math.abs(s.n[1]) * half[1] + Math.abs(s.n[2]) * half[2] + Math.abs(s.n[3]) * hw
}

/** Fold w back into one loop, [-hw, hw). The world is periodic in time, so nothing visible changes. */
export function wrapW(w: number, hw: number): number {
  const p = 2 * hw
  return ((((w + hw) % p) + p) % p) - hw
}

/**
 * Keep the camera inside the room (|x_i| ≤ half_i) by sliding it *within the slice*, so the slice itself
 * does not move. Walls the slice runs parallel to cannot be resolved this way and are left alone.
 */
export function constrainToRoom(s: Slice, e: Event4, half: Vec3): Event4 {
  let cur = e
  for (let pass = 0; pass < 8; pass++) {
    // the spatial correction we would like
    const want: Vec3 = [0, 0, 0]
    let any = false
    for (let i = 0; i < 3; i++) {
      want[i] = Math.max(-half[i], Math.min(half[i], cur.x[i])) - cur.x[i]
      if (want[i] !== 0) any = true
    }
    if (!any) break
    // A slice-space step r moves space by  r + a (cos − 1)(r·a):  1:1 across the tilt direction and
    // scaled by cos along it. Invert that; at 90° the along-a part cannot be reached from inside the slice.
    const wa = dot(want, s.a)
    const along = Math.abs(s.cos) > 1e-3 ? wa / s.cos : 0
    cur = embed(s, cur, [
      want[0] + s.a[0] * (along - wa),
      want[1] + s.a[1] * (along - wa),
      want[2] + s.a[2] * (along - wa),
    ])
    if (along !== 0) break // reached the clamped point exactly
  }
  return cur
}

/**
 * Intersection polygon of the plane  normal·p = d  with an axis-aligned box centred on the origin.
 * Returns the corners in order around the polygon (empty if the plane misses the box).
 */
export function planeBoxPolygon(normal: Vec3, d: number, half: Vec3): Vec3[] {
  const pts: Vec3[] = []
  for (let a = 0; a < 3; a++) {
    if (Math.abs(normal[a]) < 1e-6) continue
    const b = (a + 1) % 3, c = (a + 2) % 3
    for (const sb of [-1, 1]) for (const sc of [-1, 1]) {
      const v = (d - normal[b] * sb * half[b] - normal[c] * sc * half[c]) / normal[a]
      if (Math.abs(v) > half[a] + 1e-6) continue
      const p: Vec3 = [0, 0, 0]
      p[a] = v; p[b] = sb * half[b]; p[c] = sc * half[c]
      if (!pts.some((q) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2 < 1e-8)) pts.push(p)
    }
  }
  if (pts.length < 3) return []

  // any two axes spanning the plane, then sort by angle around the centroid
  const len = Math.hypot(normal[0], normal[1], normal[2])
  const n: Vec3 = [normal[0] / len, normal[1] / len, normal[2] / len]
  const seed: Vec3 = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
  const sd = dot(seed, n)
  let v: Vec3 = [seed[0] - n[0] * sd, seed[1] - n[1] * sd, seed[2] - n[2] * sd]
  const vl = Math.hypot(v[0], v[1], v[2])
  v = [v[0] / vl, v[1] / vl, v[2] / vl]
  const u: Vec3 = [v[1] * n[2] - v[2] * n[1], v[2] * n[0] - v[0] * n[2], v[0] * n[1] - v[1] * n[0]]
  const c: Vec3 = [0, 0, 0]
  for (const p of pts) for (let i = 0; i < 3; i++) c[i] += p[i] / pts.length
  const ang = (p: Vec3) => {
    const r: Vec3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]
    return Math.atan2(dot(r, v), dot(r, u))
  }
  return pts.sort((p, q) => ang(p) - ang(q))
}
