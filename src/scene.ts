import * as THREE from 'three'
import { alongNormal, constrainToRoom, embed, makeSlice, offset, reach, wrapW } from './slice4d'
import type { Angles, Event4, Vec3, Vec4 } from './slice4d'
import { LOOP, ROOM, V_MAX, sdfObjects } from './world'
import { fragmentShader, vertexShader } from './shader'
import { createMinimap } from './minimap'

// ───────────────────────── config ─────────────────────────
const FOV = 72            // vertical, degrees
const WALK = 2.6          // m/s
const RUN = 2.5           // multiplier while Shift is held
const LOOK = 0.0022       // radians per pixel of mouse travel
const BODY = 0.3          // how close the camera may get to a wall or an object, metres
const MAX_PIXEL_RATIO = 1.5
const FADE_FROM = 85      // tilt (degrees) past which objects start turning translucent …
const FADE_MIN = 0.3      // … and how opaque they still are at 90°
const START: Event4 = { x: [-1.5, -0.4, 3.3], w: 0 }  // eye height 1.6 m, half-way through the loop
const START_YAW = -0.4                               // turned a little towards the middle of the room
export const DEFAULT_TIME_SCALE = 1                 // metres of the time axis per second

export type SliceInfo = Angles & {
  /** offset of the slice along its own normal, −1 … 1 (the 2D project's "Position") */
  pos: number
  normal: Vec4
  /** angle between the slice normal and the time axis, degrees */
  tilt: number
  /** the moment the camera itself is at, seconds into the loop */
  time: number
}
export type Handlers = {
  onSlice?: (s: SliceInfo) => void
  onPlaying?: (on: boolean) => void
  onLooking?: (on: boolean) => void
}

const MOVE_KEYS: Record<string, Vec3> = {
  KeyW: [0, 0, 1], ArrowUp: [0, 0, 1],
  KeyS: [0, 0, -1], ArrowDown: [0, 0, -1],
  KeyD: [1, 0, 0], ArrowRight: [1, 0, 0],
  KeyA: [-1, 0, 0], ArrowLeft: [-1, 0, 0],
  KeyE: [0, 1, 0], KeyQ: [0, -1, 0],
}

export function createScene(canvas: HTMLCanvasElement, stage: HTMLElement, mapCanvas: HTMLCanvasElement, handlers: Handlers = {}) {
  // ───── renderer: one full-screen quad, everything happens in the fragment shader ─────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
  renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO))

  const uniforms = {
    uCamX: { value: new THREE.Vector3() },
    uCamT: { value: 0 },
    uCamRot: { value: new THREE.Matrix3() },
    uA: { value: new THREE.Vector3(1, 0, 0) },
    uCos: { value: 1 },
    uSin: { value: 0 },
    uC: { value: DEFAULT_TIME_SCALE },
    uLip: { value: 1 },
    uTanFov: { value: Math.tan(THREE.MathUtils.degToRad(FOV) / 2) },
    uAspect: { value: 1 },
    uRoom: { value: new THREE.Vector3(...ROOM) },
    uContours: { value: 0 },
    uAlpha: { value: 1 },
    uMaxDist: { value: 90 },
    uPix: { value: 0.002 },
  }
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, depthTest: false }))
  quad.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(quad)
  const dummyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  const minimap = createMinimap(mapCanvas)
  let mapVisible = true

  // ───── state: the slice's orientation, and the event (place + moment) the camera is at ─────
  const angles: Angles = { ax: 0, ay: 0, az: 0 }
  let slice = makeSlice(angles)
  let cam: Event4 = { x: [...START.x], w: START.w }
  let yaw = START_YAW, pitch = 0
  let c = DEFAULT_TIME_SCALE
  const walkable: Vec3 = [ROOM[0] - BODY, ROOM[1] - BODY, ROOM[2] - BODY]
  const hw = () => (c * LOOP) / 2
  const play = { on: false, dir: 1, speed: 1, mode: 'loop' }
  let follow = false   // false: the camera keeps its place in the room · true: it rides the slice along its normal
  let fade = false     // objects turn translucent as the tilt approaches 90° (off unless asked for)
  const tiltDeg = () => THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, slice.cos))))
  minimap.build(c)

  /** Slide the camera out of any object it is inside of, staying within the slice. */
  function pushOutOfObjects(e: Event4): Event4 {
    const dist = (r: Vec3) => {
      const p = embed(slice, e, r)
      return sdfObjects(p.x, (p.w + hw()) / c)
    }
    const d0 = dist([0, 0, 0])
    if (d0 >= BODY) return e
    const h = 0.01
    const g: Vec3 = [
      dist([h, 0, 0]) - dist([-h, 0, 0]),
      dist([0, h, 0]) - dist([0, -h, 0]),
      dist([0, 0, h]) - dist([0, 0, -h]),
    ].map((v) => v / (2 * h)) as Vec3
    const g2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2]
    if (g2 < 1e-6) return embed(slice, e, [0, BODY - d0, 0])
    const k = Math.min((BODY - d0) / g2, 0.6 / Math.sqrt(g2))
    return embed(slice, e, [g[0] * k, g[1] * k, g[2] * k])
  }

  function settle() {
    cam = constrainToRoom(slice, cam, walkable)
    cam = constrainToRoom(slice, pushOutOfObjects(cam), walkable)
  }

  // ───── reporting back to the panel ─────
  let dirty = true, lastEmit = 0
  function emit(now: number, force = false) {
    if (!force && (!dirty || now - lastEmit < 50)) return
    dirty = false; lastEmit = now
    // following: how far the slice sits along its normal. staying put: where in the loop your own moment is.
    const pos = follow ? offset(slice, cam) / reach(slice, walkable, hw()) : wrapW(cam.w, hw()) / hw()
    handlers.onSlice?.({
      ...angles,
      pos: Math.max(-1, Math.min(1, pos)),
      normal: slice.n,
      tilt: tiltDeg(),
      time: (((wrapW(cam.w, hw()) + hw()) / c) % LOOP + LOOP) % LOOP,
    })
  }

  function setPlaying(on: boolean) {
    play.on = on
    handlers.onPlaying?.(on)
  }

  // ───── input: mouse look (pointer lock, or plain drag where lock is unavailable) + keys ─────
  const held = new Set<string>()
  let dragging = false
  const locked = () => document.pointerLockElement === canvas

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    dragging = true
    canvas.focus()
    if (!locked()) Promise.resolve(canvas.requestPointerLock?.()).catch(() => {})
  }
  const onPointerUp = () => { dragging = false }
  const onMouseMove = (e: MouseEvent) => {
    if (!locked() && !dragging) return
    yaw -= e.movementX * LOOK
    pitch = Math.max(-1.55, Math.min(1.55, pitch - e.movementY * LOOK))
  }
  const onLockChange = () => handlers.onLooking?.(locked())
  const typing = (t: EventTarget | null) => {
    const el = t as HTMLElement | null
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.getAttribute?.('role') === 'combobox')
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
    if (e.code in MOVE_KEYS) { held.add(e.code); if (e.code.startsWith('Arrow')) e.preventDefault() }
  }
  const onKeyUp = (e: KeyboardEvent) => held.delete(e.code)
  const onBlur = () => { held.clear(); dragging = false }

  canvas.addEventListener('pointerdown', onPointerDown)
  addEventListener('pointerup', onPointerUp)
  addEventListener('mousemove', onMouseMove)
  document.addEventListener('pointerlockchange', onLockChange)
  addEventListener('keydown', onKeyDown)
  addEventListener('keyup', onKeyUp)
  addEventListener('blur', onBlur)

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h, false)
    uniforms.uAspect.value = w / h
    uniforms.uPix.value = (2 * uniforms.uTanFov.value) / (h * renderer.getPixelRatio())   // angle one pixel covers
  }
  const ro = new ResizeObserver(resize)
  ro.observe(stage)
  resize()

  // ───── loop ─────
  const clock = new THREE.Clock()
  const shift = () => held.has('ShiftLeft') || held.has('ShiftRight')
  const onShift = (e: KeyboardEvent) => { if (e.shiftKey) held.add('ShiftLeft'); else { held.delete('ShiftLeft'); held.delete('ShiftRight') } }
  addEventListener('keydown', onShift)
  addEventListener('keyup', onShift)

  renderer.setAnimationLoop((now) => {
    const dt = Math.min(clock.getDelta(), 0.1)

    // walk: a step inside the slice. The slice itself stays where it is.
    let mx = 0, my = 0, mz = 0
    for (const code of held) { const m = MOVE_KEYS[code]; if (m) { mx += m[0]; my += m[1]; mz += m[2] } }
    if (mx || my || mz) {
      const len = Math.hypot(mx, my, mz), v = (WALK * (shift() ? RUN : 1) * dt) / len
      const sy = Math.sin(yaw), cy = Math.cos(yaw)
      // forward is (−sin yaw, 0, −cos yaw), right is (cos yaw, 0, −sin yaw)
      cam = embed(slice, cam, [(mx * cy - mz * sy) * v, my * v, (-mx * sy - mz * cy) * v])
      dirty = true
    }

    // play, staying put: you keep your place in the room and your own moment runs at 1×. The slice still
    // moves along its normal, by exactly as much as that takes (cos θ of it — nothing at all at 90°, where
    // time has become a direction inside the slice and this simply carries you along it).
    if (play.on && !follow) {
      const sgn = slice.cos >= 0 ? 1 : -1
      let w = cam.w + play.dir * sgn * c * play.speed * dt
      if (play.mode === 'pingpong') {
        if (Math.abs(w) > hw()) { w = Math.sign(w) * hw(); play.dir = -play.dir }
      } else w = wrapW(w, hw())
      cam = { x: cam.x, w }
      dirty = true
    }

    // play, following: the whole slice — camera included — moves along its own normal.
    if (play.on && follow) {
      const R = reach(slice, walkable, hw())
      const step = play.dir * c * play.speed * dt
      const d = offset(slice, cam) + step
      cam = alongNormal(slice, cam, step)
      if (Math.abs(d) > R) {
        const side = Math.sign(d)
        if (play.mode === 'pingpong') {
          cam = alongNormal(slice, cam, side * R - d)
          play.dir = -side
        } else if (Math.abs(slice.cos) >= 0.5) {
          // mostly time-like: step back one whole loop in time. The world is periodic, so this is invisible.
          cam = { x: cam.x, w: cam.w - side * Math.sign(slice.cos) * 2 * hw() }
        } else {
          // mostly space-like: the slice has left the room, bring it back in on the other side.
          cam = alongNormal(slice, cam, -side * 2 * R)
        }
      }
      dirty = true
    }

    settle()

    // uniforms
    const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch)
    const right: Vec3 = [cy, 0, -sy]
    const back: Vec3 = [sy * cp, -sp, cy * cp]
    const up: Vec3 = [back[1] * right[2] - back[2] * right[1], back[2] * right[0] - back[0] * right[2], back[0] * right[1] - back[1] * right[0]]
    uniforms.uCamRot.value.set(right[0], up[0], back[0], right[1], up[1], back[1], right[2], up[2], back[2])
    uniforms.uCamX.value.set(cam.x[0], cam.x[1], cam.x[2])
    uniforms.uCamT.value = (wrapW(cam.w, hw()) + hw()) / c
    uniforms.uA.value.set(slice.a[0], slice.a[1], slice.a[2])
    uniforms.uCos.value = slice.cos
    uniforms.uSin.value = slice.sin
    uniforms.uC.value = c
    uniforms.uLip.value = 1 + (slice.sin * V_MAX) / c
    uniforms.uMaxDist.value = Math.max(90, 1.6 * c * LOOP)   // always far enough to see a whole loop down the time axis
    // objects thin out over the last few degrees before the slice is fully space-like
    const fromFlat = 90 - Math.abs(90 - tiltDeg())
    uniforms.uAlpha.value = fade ? 1 - (1 - FADE_MIN) * THREE.MathUtils.smoothstep(fromFlat, FADE_FROM, 90) : 1
    renderer.render(scene, dummyCamera)

    if (mapVisible) {
      minimap.update(slice, cam, c, [-back[0], -back[1], -back[2]])
      minimap.render()
    }
    emit(now)
  })

  emit(0, true)

  return {
    /** Angles rotate the slice about the camera's own here-and-now; pos moves it along its normal. */
    setSlice(p: Partial<Angles & { pos: number }>) {
      if (p.ax !== undefined || p.ay !== undefined || p.az !== undefined) {
        if (p.ax !== undefined) angles.ax = p.ax
        if (p.ay !== undefined) angles.ay = p.ay
        if (p.az !== undefined) angles.az = p.az
        slice = makeSlice(angles)
        cam = { x: cam.x, w: wrapW(cam.w, hw()) }
      }
      if (p.pos !== undefined) {
        cam = follow
          ? alongNormal(slice, cam, p.pos * reach(slice, walkable, hw()) - offset(slice, cam))
          : { x: cam.x, w: p.pos * hw() }
      }
      settle()
      emit(performance.now(), true)
    },
    reset() {
      play.dir = 1
      setPlaying(false)
      angles.ax = angles.ay = angles.az = 0
      slice = makeSlice(angles)
      cam = { x: [...START.x], w: START.w }
      yaw = START_YAW; pitch = 0
      emit(performance.now(), true)
    },
    setPlaying,
    togglePlaying() { setPlaying(!play.on) },
    setSpeed(v: number) { play.speed = v },
    setMode(m: string) { play.mode = m },
    /** Metres of time axis per second. Keeps the camera at the same moment. */
    setTimeScale(v: number) {
      cam = { x: cam.x, w: (cam.w * v) / c }
      c = v
      minimap.build(c)
      settle()
      emit(performance.now(), true)
    },
    setContours(on: boolean) { uniforms.uContours.value = on ? 1 : 0 },
    /** Whether the camera rides the slice along its normal, or keeps its place in the room. */
    setFollow(on: boolean) {
      follow = on
      play.dir = 1
      cam = { x: cam.x, w: wrapW(cam.w, hw()) }
      emit(performance.now(), true)
    },
    setFade(on: boolean) { fade = on },
    setMapVisible(on: boolean) { mapVisible = on },
    releasePointer() { if (locked()) document.exitPointerLock() },
    dispose() {
      renderer.setAnimationLoop(null)
      ro.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      removeEventListener('pointerup', onPointerUp)
      removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('pointerlockchange', onLockChange)
      removeEventListener('keydown', onKeyDown)
      removeEventListener('keyup', onKeyUp)
      removeEventListener('keydown', onShift)
      removeEventListener('keyup', onShift)
      removeEventListener('blur', onBlur)
      minimap.dispose()
      quad.geometry.dispose()
      quad.material.dispose()
      renderer.dispose()
    },
  }
}
