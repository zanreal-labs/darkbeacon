// The shared vocabulary of every Darkbeacon scene: one palette, one noise, one starfield, one
// glow falloff and one film finish. Every scene on the page imports from here, which is what
// makes four separate canvases read as one world rather than four demos.

export const PI: f32 = 3.14159265359;
export const TAU: f32 = 6.28318530718;

// --- Palette, linear ----------------------------------------------------------------------
// The beacon: the app's cyan accent. The wormhole: the blue-violet the app draws identified
// wormholes in. Ice is the white-hot end of both.
export const BEACON = vec3f(0.11, 0.62, 0.72);
export const WORMHOLE = vec3f(0.24, 0.30, 1.0);
export const VIOLET = vec3f(0.42, 0.22, 0.95);
export const ICE = vec3f(0.80, 0.94, 1.0);
export const DEEP = vec3f(0.004, 0.006, 0.016);

// The probe scanner's colours, as the client draws them (see the app's tokens).
export const SCAN_RED = vec3f(0.87, 0.07, 0.04);
export const SCAN_ORANGE = vec3f(0.87, 0.25, 0.02);
export const SCAN_YELLOW = vec3f(0.80, 0.64, 0.04);
export const SCAN_GREEN = vec3f(0.08, 0.63, 0.06);

// --- Hash and noise -----------------------------------------------------------------------
export fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += vec2f(dot(q, q + vec2f(45.32)));
  return fract(q.x * q.y);
}

export fn hash22(p: vec2f) -> vec2f {
  var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

export fn hash31(p: vec3f) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

export fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2f(1.0, 0.0)), u.x),
    mix(hash21(i + vec2f(0.0, 1.0)), hash21(i + vec2f(1.0, 1.0)), u.x),
    u.y,
  );
}

export fn fbm2(p0: vec2f, octaves: i32) -> f32 {
  var p = p0;
  var value = 0.0;
  var amplitude = 0.5;
  for (var i = 0; i < octaves; i++) {
    value += amplitude * noise2(p);
    p = mat2x2f(1.6, 1.2, -1.2, 1.6) * p;
    amplitude *= 0.5;
  }
  return value;
}

// --- Light ------------------------------------------------------------------------------
// The one glow profile every point light on the page uses: a hard core and a long soft tail,
// `radius` being where it has fallen to half.
export fn glow(d: f32, radius: f32) -> f32 {
  let x = d / max(radius, 1e-4);
  return 1.0 / (1.0 + x * x);
}

// The same profile squared: a tighter light for small things that should not wash the frame.
export fn spark(d: f32, radius: f32) -> f32 {
  let g = glow(d, radius);
  return g * g;
}

// Distance from p to the segment a-b, and how far along it (0..1) the closest point is.
export fn segment(p: vec2f, a: vec2f, b: vec2f) -> vec2f {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return vec2f(length(pa - ba * h), h);
}

// --- Space ------------------------------------------------------------------------------
// Stars on the celestial sphere, sampled by direction so a lens can bend them.
export fn star_field(direction: vec3f, density: f32) -> vec3f {
  let d = normalize(direction);
  let spherical = vec2f(atan2(d.z, d.x) / TAU, asin(clamp(d.y, -1.0, 1.0)) / PI);
  let grid = spherical * vec2f(900.0, 450.0);
  let cell = floor(grid);
  let local = fract(grid) - 0.5;
  let seed = hash21(cell);
  let offset = (hash22(cell + 7.0) - 0.5) * 0.6;
  let r = length(local - offset);
  let size = mix(0.035, 0.09, seed * seed);
  let lit = step(1.0 - density, seed);
  let point = smoothstep(size, 0.0, r) * lit;
  let temperature = hash21(cell + vec2f(17.0, 29.0));
  let tint = mix(vec3f(0.55, 0.70, 1.0), vec3f(1.0, 0.86, 0.72), temperature * temperature);
  return tint * point * (0.6 + seed * 2.4);
}

// A faint nebula behind the stars, in the two brand hues, so black is never a flat fill.
export fn nebula(direction: vec3f) -> vec3f {
  let d = normalize(direction);
  // A linear map of the direction: no pole, so no seam and no streaks converging on one.
  let p = vec2f(d.x + d.z * 0.55, d.y - d.z * 0.35) * 2.2;
  let a = fbm2(p * 1.3 + vec2f(3.1, 1.7), 4);
  let b = fbm2(p * 2.7 - vec2f(a * 1.8, 0.4), 3);
  let veil = smoothstep(0.42, 0.95, a * 0.7 + b * 0.5);
  let hue = mix(WORMHOLE, BEACON, smoothstep(0.3, 0.8, b));
  return hue * veil * 0.035;
}

// Space dust: the one particle system of the page. Three depth layers of motes in screen
// space, in CSS pixels so their size never depends on the display, drifting slowly and shifted
// by `parallax` in proportion to their depth. Returns brightness; the caller tints and lights it.
export fn dust(css: vec2f, time: f32, parallax: vec2f) -> f32 {
  var total = 0.0;
  for (var layer = 0; layer < 3; layer++) {
    let depth = 1.0 + f32(layer) * 0.9;
    let cell_size = 46.0 * depth;
    let drift = vec2f(time * (3.0 + f32(layer) * 2.0), -time * (1.6 + f32(layer)));
    let p = css + drift + parallax * (12.0 / depth) + f32(layer) * 113.0;
    let cell = floor(p / cell_size);
    let seed = hash21(cell + f32(layer) * 17.0);
    if (seed < 0.62) {
      continue;
    }
    let jitter = hash22(cell * 1.7 + f32(layer));
    let center = (cell + 0.15 + jitter * 0.7) * cell_size;
    let d = length(p - center);
    let radius = mix(0.6, 1.6, hash21(cell + 3.3)) / sqrt(depth);
    let twinkle = 0.55 + 0.45 * sin(time * (0.6 + seed * 1.6) + seed * 40.0);
    total += smoothstep(radius + 0.9, radius * 0.2, d) * twinkle / depth;
  }
  return total;
}

// --- Finish -----------------------------------------------------------------------------
export fn aces(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + vec3f(b))) / (x * (c * x + vec3f(d)) + vec3f(e)), vec3f(0.0), vec3f(1.0));
}

// Linear HDR to the display: tonemap, gamma, and a one-level dither so the long dark gradients
// every scene is made of never band.
export fn finish(hdr: vec3f, pixel: vec2f, seed: f32) -> vec3f {
  let mapped = aces(max(hdr, vec3f(0.0)));
  let display = pow(mapped, vec3f(1.0 / 2.2));
  let dither = (hash21(pixel + fract(seed) * 61.0) - 0.5) / 255.0 * 1.5;
  return display + vec3f(dither);
}
