# Time Slice 4D

The 2D experiment stacked the frames of a video into a 3D block and cut it with a plane. This one goes up a dimension: a moving 3D scene, stacked through time, is a 4D object, and you walk around inside a 3D slice of it.

With no tilt the slice is the room at one instant, and playing moves it forward along time — an ordinary animation. Tilt the slice and part of what used to be a direction in space becomes time: things further along that direction are seen earlier or later, and space stretches. At 90° one direction of the room *is* time, and every moving object becomes the tube it sweeps out. Playing always moves the slice along its own normal.

## Controls

- Click the view to look around, `W A S D` or arrow keys to walk, `Q` / `E` down / up, `Shift` faster, `Esc` to release the mouse
- `Space` play / pause
- The panel on the right tilts the slice towards X, Y and Z, moves it along its normal, and sets how many metres one second is worth
- The small spacetime map drops height and draws floor plan × time; the green plane is the slice you are standing in

## How it works

- [`src/slice4d.ts`](src/slice4d.ts) — the maths: slice normal from three angles, the map from a point inside the slice to a place and a moment, collision that keeps you on the slice. `node src/slice4d.check.ts` runs its sanity checks.
- [`src/world.ts`](src/world.ts) — the room and its objects, written once and used for rendering, collision and the map. Every motion is periodic, so the 4D object loops seamlessly.
- [`src/shader.ts`](src/shader.ts) — ray-marches the slice: each ray lives in slice space, and every sample is turned into (position, time) before the world's distance field is evaluated.
- [`src/scene.ts`](src/scene.ts) — camera, playback and input. [`src/minimap.ts`](src/minimap.ts) — the spacetime map.

Built with Three.js, React and shadcn/ui.

```bash
npm install
npm run dev
```

## Course

**Canvas for Code** (ITPG-GT 3016) · NYU Tisch School of the Arts · Fall 2026 · Instructor: Joohyun Park
