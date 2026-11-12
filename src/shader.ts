// Ray-marches the 3D slice. Every ray lives in slice space (metres measured from the camera, inside
// the slice); `embed` turns a slice-space point into a place and a moment in the 4D world, and the
// world's distance field is evaluated there. That one function is the whole trick.

import { LOOP, objectsGLSL } from './world'

export const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

export const fragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform vec3 uCamX;      // where the camera is
uniform float uCamT;     // when the camera is (seconds)
uniform mat3 uCamRot;    // camera orientation inside the slice
uniform vec3 uA;         // spatial direction the slice normal tips towards
uniform float uCos;      // cos of the tilt
uniform float uSin;      // sin of the tilt
uniform float uC;        // metres per second: the scale of the time axis
uniform float uLip;      // step shortening needed once time is mixed into space
uniform float uTanFov;
uniform float uAspect;
uniform vec3 uRoom;
uniform float uContours;
uniform float uAlpha;    // opacity of objects (the room itself is always solid)
uniform float uMaxDist;  // how far a ray may travel
uniform float uPix;      // angle covered by one pixel

const float LOOP = ${LOOP.toFixed(1)};
const float TAU = 6.28318530718;
const int MAX_LAYERS = 4;   // translucent surfaces a ray may pass through
const vec3 FOG = vec3(0.80, 0.83, 0.88);
const vec3 KEY_DIR = normalize(vec3(0.35, 0.85, 0.40));

// slice-space offset from the camera  →  world position and time
void embed(vec3 r, out vec3 x, out float t) {
  float ra = dot(r, uA);
  x = uCamX + r + uA * ((uCos - 1.0) * ra);   // space is squeezed by cos along the tilt direction …
  t = uCamT - uSin * ra / uC;                 // … and what was squeezed out became time
}

${objectsGLSL()}

// x = distance, y = id (0 = room, 1.. = objects)
vec2 map(vec3 r) {
  vec3 x; float t;
  embed(r, x, t);
  vec3 q = abs(x) - uRoom;
  float room = -max(q.x, max(q.y, q.z));
  vec2 o = mapObjects(x, TAU * t / LOOP);
  return room < o.x ? vec2(room, 0.0) : o;
}

// objects only
float objDist(vec3 r) {
  vec3 x; float t;
  embed(r, x, t);
  return mapObjects(x, TAU * t / LOOP).x;
}

// objects only, and only while still inside the room (used for shadows)
float mapObj(vec3 r) {
  vec3 x; float t;
  embed(r, x, t);
  vec3 q = abs(x) - uRoom;
  if (max(q.x, max(q.y, q.z)) > 0.0) return 1e3;
  return mapObjects(x, TAU * t / LOOP).x;
}

vec3 calcNormal(vec3 p) {
  const vec2 e = vec2(1.0, -1.0) * 0.0015;
  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x + e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

float softShadow(vec3 p, vec3 l) {
  float res = 1.0, s = 0.06;
  for (int i = 0; i < 40; i++) {
    float h = mapObj(p + l * s);
    res = min(res, 9.0 * h / s);
    s += clamp(h / uLip, 0.03, 0.45);
    if (res < 0.004 || s > 9.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

float ambientOcclusion(vec3 p, vec3 n) {
  float occ = 0.0, sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.02 + 0.11 * float(i);
    occ += (h - map(p + n * h).x) * sca;
    sca *= 0.85;
  }
  return clamp(1.0 - 1.15 * occ, 0.0, 1.0);
}

vec3 lit(vec3 p, vec3 rd, vec3 n, vec3 alb, float isObject) {
  float ao = ambientOcclusion(p, n);
  float key = max(dot(n, KEY_DIR), 0.0);
  // Translucent objects cast correspondingly lighter shadows. On the objects themselves the shadow is
  // faded out sooner and then skipped, since every extra layer a ray passes through would pay for it again.
  float shade = isObject > 0.5 ? smoothstep(0.6, 1.0, uAlpha) : uAlpha;
  if (key > 0.0 && shade > 0.0) key *= mix(1.0, softShadow(p + n * 0.01, KEY_DIR), shade);
  float fill = max(dot(n, normalize(vec3(-0.5, 0.2, -0.6))), 0.0);
  vec3 light = vec3(0.50, 0.53, 0.58) * (0.75 + 0.25 * n.y) * ao
             + vec3(1.00, 0.96, 0.90) * 0.62 * key
             + vec3(0.20, 0.21, 0.24) * fill * ao;
  vec3 col = alb * light;
  col += 0.10 * pow(max(dot(reflect(rd, n), KEY_DIR), 0.0), 24.0) * key * isObject;
  return col;
}

// cool = earlier than the camera's moment, warm = later; one line per second
vec3 contours(vec3 col, float tau, float w) {
  vec3 tint = tau < 0.0 ? vec3(0.16, 0.42, 1.0) : vec3(1.0, 0.36, 0.10);
  col = mix(col, col * tint * 1.6, 0.4 * smoothstep(0.0, 2.5, abs(tau)));
  float band = abs(fract(tau + 0.5) - 0.5);
  float line = (1.0 - smoothstep(w * 0.8, w * 1.8 + 0.002, band)) * (1.0 - smoothstep(0.15, 0.5, w));
  return mix(col, tint * 0.55, 0.75 * line);
}

float fog(float s) { return smoothstep(0.25 * uMaxDist, uMaxDist, s); }

// Seconds ahead of (+) or behind (−) the camera's own moment, and how much of that one pixel spans:
// time changes by sin/c per metre inside the slice.
float tauAt(vec3 p) { return -uSin * dot(p, uA) / uC; }
float tauWidth(float s) { return 2.0 * uSin / uC * s * uPix; }

vec3 shadeObject(vec3 p, vec3 rd, float id, float s) {
  vec3 alb = objColor(id);
  alb *= alb;   // palette is authored in sRGB
  vec3 col = lit(p, rd, calcNormal(p), alb, 1.0);
  if (uContours > 0.5) col = contours(col, tauAt(p), tauWidth(s));
  return mix(col, FOG, fog(s));
}

void main() {
  vec3 rd = normalize(uCamRot * vec3(vUv.x * uAspect * uTanFov, vUv.y * uTanFov, -1.0));

  vec3 front = vec3(0.0);   // light gathered from translucent objects in front
  float through = 1.0;      // how much of what lies behind still shows
  int layers = 0;

  float s = 0.0, id = -1.0;
  for (int i = 0; i < 280; i++) {
    vec2 h = map(rd * s);
    if (h.x < 0.0006 * s + 0.0008) {
      if (h.y > 0.5 && uAlpha < 0.999 && layers < MAX_LAYERS) {
        front += through * uAlpha * shadeObject(rd * s, rd, h.y, s);
        through *= 1.0 - uAlpha;
        layers++;
        // tunnel through to the far side of this object, and clear of it by more than the hit
        // threshold so the same surface is not counted twice
        s += 0.02;
        for (int j = 0; j < 64; j++) {
          float d = objDist(rd * s);
          if (d > 3.0 * (0.0006 * s + 0.0008)) break;
          s += max(abs(d), 0.012) / uLip;
        }
        continue;
      }
      id = h.y;
      break;
    }
    s += h.x / uLip;
    if (s > uMaxDist) break;
  }

  vec3 p = rd * s;
  vec3 x; float t;
  embed(p, x, t);
  vec3 fwX = fwidth(x);

  vec3 col = FOG;
  if (id > 0.5) {
    col = shadeObject(p, rd, id, s);
  } else if (id > -0.5) {
    vec3 alb = vec3(0.93);
    // a 1 m grid fixed to the world, so stretching and squeezing of space is visible
    vec3 wall = abs(abs(x) - uRoom);
    vec3 mask = vec3(1.0);
    if (wall.x < wall.y && wall.x < wall.z) mask.x = 0.0; else if (wall.y < wall.z) mask.y = 0.0; else mask.z = 0.0;
    vec3 g = abs(fract(x + 0.5) - 0.5);
    vec3 ln = (1.0 - smoothstep(fwX * 0.6, fwX * 1.6 + 0.003, g)) * mask * (1.0 - smoothstep(0.12, 0.45, fwX));
    ln *= smoothstep(0.0, 0.06, uRoom - abs(x));   // no line where two walls meet
    alb = mix(alb, vec3(0.55), 0.5 * max(ln.x, max(ln.y, ln.z)));
    if (mask.y == 0.0 && x.y < 0.0) alb *= 0.86;

    col = lit(p, rd, calcNormal(p), alb, 0.0);
    if (uContours > 0.5) col = contours(col, tauAt(p), tauWidth(s));
    col = mix(col, FOG, fog(s));
  }
  col = front + through * col;

  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`
