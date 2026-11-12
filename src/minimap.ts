// Spacetime map: the 4D world with height dropped, so it can be drawn. What is left is the floor plan
// (X, Z) stacked through time (T, drawn upwards) — the same picture as the 2D project's volume. Each
// object is the tube it sweeps out over one loop, and the slice the camera lives in is a plane.

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { embed, planeBoxPolygon, wrapW } from './slice4d'
import type { Event4, Slice, Vec3 } from './slice4d'
import { LOOP, OBJECTS, ROOM, footprint, position } from './world'

const ACCENT = 0x4ade80
const COPIES = 4 // the world repeats in time, so the slice re-enters the box; draw this many repeats each way

function label(text: string) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 64
  const ctx = cv.getContext('2d')!
  ctx.font = '600 40px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#e4e4e7'
  ctx.fillText(text, 32, 34)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }))
  sprite.renderOrder = 5
  return sprite
}

export function createMinimap(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false

  scene.add(new THREE.HemisphereLight(0xffffff, 0x30303a, 1.6))
  const sun = new THREE.DirectionalLight(0xffffff, 1.4)
  sun.position.set(3, 5, 4)
  scene.add(sun)

  // ───── the box and the tubes (rebuilt when the time scale changes) ─────
  const world = new THREE.Group()
  scene.add(world)
  let half: Vec3 = [ROOM[0], 1, ROOM[2]]

  function build(c: number) {
    world.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose?.()
      if (m.material) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) { (mat as THREE.SpriteMaterial).map?.dispose?.(); mat.dispose() }
    })
    world.clear()
    const hw = (c * LOOP) / 2
    half = [ROOM[0], hw, ROOM[2]]
    const [hx, hy, hz] = half

    world.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2)),
      new THREE.LineBasicMaterial({ color: 0x8a8a94, transparent: true, opacity: 0.55 }),
    ))

    // axes from the near bottom corner, like the 2D volume
    const o = new THREE.Vector3(-hx, -hy, hz)
    const axisMat = new THREE.LineBasicMaterial({ color: 0xe4e4e7 })
    const ends: [string, THREE.Vector3][] = [
      ['X', new THREE.Vector3(hx, -hy, hz)],
      ['T', new THREE.Vector3(-hx, hy, hz)],
      ['Z', new THREE.Vector3(-hx, -hy, -hz)],
    ]
    const size = Math.hypot(hx, hy, hz)
    for (const [name, end] of ends) {
      world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([o, end]), axisMat))
      const s = label(name)
      s.position.copy(end).addScaledVector(end.clone().sub(o).normalize(), size * 0.07)
      s.scale.setScalar(size * 0.13)
      world.add(s)
    }

    // one tube per object: where its footprint is at every moment of the loop
    for (const obj of OBJECTS) {
      const pts: THREE.Vector3[] = []
      const N = 160
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * LOOP
        const p = position(obj, t)
        pts.push(new THREE.Vector3(p[0], c * t - hw, p[2]))
      }
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), N, footprint(obj), 12, false)
      world.add(new THREE.Mesh(tube, new THREE.MeshLambertMaterial({ color: obj.color })))
    }

    const dist = size * 3.1
    camera.position.set(0.62, 0.42, 0.66).normalize().multiplyScalar(dist)
    controls.target.set(0, 0, 0)
    controls.minDistance = size * 1.2
    controls.maxDistance = size * 8
    controls.update()
  }

  // ───── the slice (and its repeats through time) ─────
  const fillMat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false })
  const ghostMat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false })
  const edgeMat = new THREE.LineBasicMaterial({ color: ACCENT })
  const ghostEdgeMat = new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.35 })
  const planes: { mesh: THREE.Mesh; loop: THREE.LineLoop }[] = []
  for (let k = -COPIES; k <= COPIES; k++) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(7 * 3), 3))
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array(6 * 3), 1))
    const mesh = new THREE.Mesh(geo, k === 0 ? fillMat : ghostMat)
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 3), 3))
    const loop = new THREE.LineLoop(lg, k === 0 ? edgeMat : ghostEdgeMat)
    mesh.frustumCulled = loop.frustumCulled = false
    mesh.renderOrder = 2; loop.renderOrder = 3
    scene.add(mesh, loop)
    planes.push({ mesh, loop })
  }

  // ───── the camera ─────
  const marker = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }))
  marker.renderOrder = 6
  const headingGeo = new THREE.BufferGeometry()
  headingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
  const heading = new THREE.Line(headingGeo, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }))
  heading.renderOrder = 6
  heading.frustumCulled = false
  scene.add(marker, heading)

  function update(slice: Slice, cam: Event4, c: number, forward: Vec3) {
    const hw = (c * LOOP) / 2
    const size = Math.hypot(half[0], half[1], half[2])
    // drop height: (x, y, z, w) → map coordinates (x, w, z)
    const normal: Vec3 = [slice.n[0], slice.n[3], slice.n[2]]
    const at: Vec3 = [cam.x[0], wrapW(cam.w, hw), cam.x[2]]
    const flat = Math.hypot(normal[0], normal[1], normal[2]) < 1e-4 // slice tipped fully into height: nothing to draw

    planes.forEach(({ mesh, loop }, i) => {
      const k = i - COPIES
      const d = normal[0] * at[0] + normal[1] * (at[1] + 2 * hw * k) + normal[2] * at[2]
      const poly = flat ? [] : planeBoxPolygon(normal, d, half)
      mesh.visible = loop.visible = poly.length >= 3
      if (!mesh.visible) return
      const pos = mesh.geometry.attributes.position as THREE.BufferAttribute
      const c0: Vec3 = [0, 0, 0]
      for (const p of poly) for (let j = 0; j < 3; j++) c0[j] += p[j] / poly.length
      pos.setXYZ(0, c0[0], c0[1], c0[2])
      poly.forEach((p, j) => pos.setXYZ(j + 1, p[0], p[1], p[2]))
      pos.needsUpdate = true
      const idx = mesh.geometry.index!
      for (let j = 0; j < poly.length; j++) {
        idx.array[j * 3] = 0; idx.array[j * 3 + 1] = j + 1; idx.array[j * 3 + 2] = ((j + 1) % poly.length) + 1
      }
      idx.needsUpdate = true
      mesh.geometry.setDrawRange(0, poly.length * 3)
      const lp = loop.geometry.attributes.position as THREE.BufferAttribute
      poly.forEach((p, j) => lp.setXYZ(j, p[0], p[1], p[2]))
      lp.needsUpdate = true
      loop.geometry.setDrawRange(0, poly.length)
    })

    marker.position.set(at[0], at[1], at[2])
    marker.scale.setScalar(size * 0.022)
    // where "straight ahead" points in spacetime
    const f = embed(slice, { x: [0, 0, 0], w: 0 }, forward)
    const fl = Math.hypot(f.x[0], f.w, f.x[2]) || 1
    const len = size * 0.2
    const hp = headingGeo.attributes.position as THREE.BufferAttribute
    hp.setXYZ(0, at[0], at[1], at[2])
    hp.setXYZ(1, at[0] + (f.x[0] / fl) * len, at[1] + (f.w / fl) * len, at[2] + (f.x[2] / fl) * len)
    hp.needsUpdate = true
  }

  function render() {
    const w = canvas.clientWidth, h = canvas.clientHeight
    if (!w || !h) return
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    controls.update()
    renderer.render(scene, camera)
  }

  return {
    build,
    update,
    render,
    dispose() {
      controls.dispose()
      renderer.dispose()
    },
  }
}
