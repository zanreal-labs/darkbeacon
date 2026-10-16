// Scanning down a signature: a formation of probes closes on it, their range spheres shrinking,
// while the result resolves through the probe scanner's colours: red, orange, yellow, then green
// when it can be warped to. Around it, the system's orbits and other signatures still unscanned.

import { BEACON, DEEP, ICE, SCAN_GREEN, SCAN_ORANGE, SCAN_RED, SCAN_YELLOW, WORMHOLE, dust, finish, glow, hash21, nebula, spark, star_field } from "./lib/common.wgsl";

struct Probes {
  // canvas size in device pixels, device pixel ratio, time
  frame: vec4f,
  // camera: yaw, pitch, distance, focal length
  camera: vec4f,
  // formation spread, signal strength 0..1, warpable pulse 0..1, scene presence 0..1
  scan: vec4f,
};

@group(0) @binding(0) var<uniform> cfg: Probes;

const TARGET = vec3f(0.6, 0.15, -0.4);

fn probe_dir(i: i32) -> vec3f {
  switch i {
    case 0: { return vec3f(1.0, 0.0, 0.0); }
    case 1: { return vec3f(-1.0, 0.0, 0.0); }
    case 2: { return vec3f(0.0, 0.0, 1.0); }
    case 3: { return vec3f(0.0, 0.0, -1.0); }
    case 4: { return vec3f(0.0, 1.0, 0.0); }
    default: { return vec3f(0.0, -1.0, 0.0); }
  }
}

fn scan_color(s: f32) -> vec3f {
  var c = mix(SCAN_RED, SCAN_ORANGE, smoothstep(0.2, 0.3, s));
  c = mix(c, SCAN_YELLOW, smoothstep(0.7, 0.8, s));
  c = mix(c, SCAN_GREEN, smoothstep(0.97, 1.0, s));
  return c;
}

// Screen position (pixels) and depth of a world point, for the camera basis given.
fn project(p: vec3f, eye: vec3f, right: vec3f, up: vec3f, fwd: vec3f, focal: f32, size: vec2f) -> vec3f {
  let d = p - eye;
  let z = dot(d, fwd);
  let s = vec2f(dot(d, right), dot(d, up)) * focal / z;
  return vec3f(size * 0.5 + vec2f(s.x, -s.y) * size.y * 0.5, z);
}

@fragment fn fs_main(@location(0) uv: vec2f, @builtin(position) frag: vec4f) -> @location(0) vec4f {
  let size = cfg.frame.xy;
  let px = frag.xy;
  let time = cfg.frame.w;
  let presence = cfg.scan.w;
  let unit = size.y / 900.0;

  let yaw = cfg.camera.x;
  let pitch = cfg.camera.y;
  let eye = TARGET + vec3f(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)) * cfg.camera.z;
  let fwd = normalize(TARGET - eye);
  let right = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
  let up = cross(right, fwd);
  let focal = cfg.camera.w;
  let screen = vec2f(px.x - size.x * 0.5, size.y * 0.5 - px.y) / (size.y * 0.5);
  let rd = normalize(fwd * focal + right * screen.x + up * screen.y);

  var color = DEEP + (star_field(rd, 0.02) * 0.5 + nebula(rd) * 1.4) * presence;

  // The system's plane: orbits around a star off to one side, like the solar system map.
  let sun = vec3f(-9.0, -1.2, -7.0);
  if (rd.y < -0.001) {
    let t = (-1.2 - eye.y) / rd.y;
    let hit = eye + rd * t;
    let r = length(hit.xz - sun.xz);
    var orbits = 0.0;
    for (var k = 0; k < 6; k++) {
      let radius = 4.0 + f32(k) * 2.6 + hash21(vec2f(f32(k), 1.0)) * 1.2;
      let width = 0.012 * t;
      orbits += smoothstep(width, 0.0, abs(r - radius)) * (0.55 - f32(k) * 0.06);
    }
    let fade = exp(-t * 0.045);
    color += mix(WORMHOLE, BEACON, 0.4) * orbits * fade * 0.22 * presence;
  }
  let sun_screen = project(sun, eye, right, up, fwd, focal, size);
  if (sun_screen.z > 0.0) {
    color += vec3f(1.0, 0.82, 0.6) * (spark(length(px - sun_screen.xy), 5.0 * unit) * 2.0 + glow(length(px - sun_screen.xy), 40.0 * unit) * 0.12) * presence;
  }

  let spread = cfg.scan.x;
  let strength = cfg.scan.y;
  let range = spread * 1.15;

  // Probe range spheres: a thin rim where each one turns away from the eye, and a faint shell.
  for (var i = 0; i < 6; i++) {
    let center = TARGET + probe_dir(i) * spread;
    let oc = eye - center;
    let b = dot(oc, rd);
    let c = dot(oc, oc) - range * range;
    let h = b * b - c;
    if (h > 0.0) {
      let t = -b - sqrt(h);
      let n = normalize(eye + rd * t - center);
      let facing = abs(dot(n, rd));
      let rim = pow(1.0 - facing, 5.0);
      color += mix(BEACON, ICE, 0.25) * (rim * 0.5 + 0.018) * presence;
    }
    let ps = project(center, eye, right, up, fwd, focal, size);
    if (ps.z > 0.0) {
      let d = length(px - ps.xy);
      color += ICE * (spark(d, 2.2 * unit) * 3.0 + glow(d, 9.0 * unit) * 0.25) * presence;
      // A small flare across each probe so it reads as a light, not a dot.
      let q = abs(px - ps.xy);
      color += BEACON * smoothstep(1.2 * unit, 0.0, min(q.x, q.y)) * smoothstep(26.0 * unit, 0.0, max(q.x, q.y)) * 0.6 * presence;
    }
  }

  // Other signatures in the system, still unscanned: red, and vague.
  for (var j = 0; j < 5; j++) {
    let fj = f32(j);
    let pos = vec3f(hash21(vec2f(fj, 2.0)) - 0.5, (hash21(vec2f(fj, 5.0)) - 0.5) * 0.3, hash21(vec2f(fj, 9.0)) - 0.5) * 16.0;
    let ss = project(pos, eye, right, up, fwd, focal, size);
    if (ss.z > 0.0) {
      let d = length(px - ss.xy);
      let tw = 0.6 + 0.4 * sin(time * 1.3 + fj * 2.1);
      color += SCAN_RED * (spark(d, 2.4 * unit) * 1.6 + glow(d, 16.0 * unit) * 0.1) * tw * presence;
    }
  }

  // The result: a cloud of uncertainty that tightens into a point as the signal grows.
  let ts = project(TARGET, eye, right, up, fwd, focal, size);
  let d = length(px - ts.xy);
  let sc = scan_color(strength);
  let spreadPx = mix(60.0, 4.0, smoothstep(0.0, 1.0, strength)) * unit;
  color += sc * glow(d, spreadPx) * mix(0.25, 0.7, strength) * presence;
  color += sc * spark(d, 3.0 * unit) * (1.0 + strength * 4.0) * presence;
  // Warpable: a ring breathes out from it.
  let pulse = cfg.scan.z;
  if (pulse > 0.0) {
    let ring_r = (10.0 + pulse * 70.0) * unit;
    color += SCAN_GREEN * smoothstep(2.0 * unit, 0.0, abs(d - ring_r)) * (1.0 - pulse) * 2.0 * presence;
  }

  color += mix(BEACON, WORMHOLE, 0.5) * dust(px / cfg.frame.z, time, vec2f(sin(yaw), 0.0)) * 0.18 * presence;
  return vec4f(finish(color, px, time), 1.0);
}
