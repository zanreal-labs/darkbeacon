// Move capitals: a stylised map of known space seen from above at an angle, every system a
// point of light in its security colour, and a capital's route jumping across it leg by leg.
// Each landing lights a cynosural beacon; the ring around the ship's current system is its jump
// range. The route is projected on the CPU; the plane, its stars and the rings are traced here.

import { BEACON, DEEP, ICE, WORMHOLE, dust, fbm2, finish, glow, hash21, hash22, nebula, spark } from "./lib/common.wgsl";

struct Jump {
  // canvas size in device pixels, device pixel ratio, time
  frame: vec4f,
  // camera eye (xyz) and focal length
  eye: vec4f,
  // basis, with presence in right.w
  right: vec4f,
  up: vec4f,
  fwd: vec4f,
  // system count, segment count, pixel unit, jump range on the plane
  counts: vec4f,
};

@group(0) @binding(0) var<uniform> cfg: Jump;
// systems: 1 vec4 each (x, z on the plane, cyno 0..1, current 0/1); then segments: 2 vec4 each.
@group(0) @binding(1) var<storage, read> data: array<vec4f>;

const MAX_SYSTEMS: u32 = 9u;

fn security_color(s: f32) -> vec3f {
  // 1.0 high-sec teal through yellow to null-sec red, after the client's scale, in linear light.
  var c = mix(vec3f(1.0, 0.03, 0.0), vec3f(0.95, 0.25, 0.0), smoothstep(0.0, 0.3, s));
  c = mix(c, vec3f(0.85, 0.85, 0.0), smoothstep(0.35, 0.55, s));
  c = mix(c, vec3f(0.0, 0.85, 0.25), smoothstep(0.55, 0.8, s));
  c = mix(c, vec3f(0.05, 0.85, 0.85), smoothstep(0.85, 1.0, s));
  return c;
}

fn seg_dist(p: vec2f, a: vec2f, b: vec2f) -> vec2f {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return vec2f(length(pa - ba * h), h);
}

@fragment fn fs_main(@location(0) uv: vec2f, @builtin(position) frag: vec4f) -> @location(0) vec4f {
  let size = cfg.frame.xy;
  let px = frag.xy;
  let time = cfg.frame.w;
  let presence = cfg.right.w;
  let unit = cfg.counts.z;

  let screen = vec2f(px.x - size.x * 0.5, size.y * 0.5 - px.y) / (size.y * 0.5);
  let rd = normalize(cfg.fwd.xyz * cfg.eye.w + cfg.right.xyz * screen.x + cfg.up.xyz * screen.y);
  var color = DEEP + nebula(rd) * 0.6 * presence;

  let system_count = min(u32(cfg.counts.x), MAX_SYSTEMS);
  let seg_count = u32(cfg.counts.y);

  // Derivatives need uniform control flow, so the plane is intersected before any branch.
  let t = -cfg.eye.y / min(rd.y, -1e-4);
  let hit = (cfg.eye.xyz + rd * t).xz;
  let footprint = max(length(dpdx(hit)) + length(dpdy(hit)), 1e-4);
  if (rd.y < -0.001) {

    // Known space: clusters of systems, thinning out at the edges of the map.
    let cell_size = 0.22;
    let cell = floor(hit / cell_size);
    let jitter = 0.2 + hash22(cell) * 0.6;
    let star = (cell + jitter) * cell_size;
    let shape = fbm2(star * 0.18 + vec2f(3.0, 7.0), 4);
    let region = smoothstep(0.38, 0.62, shape) * exp(-dot(star * vec2f(0.07, 0.11), star * vec2f(0.07, 0.11)));
    let present = step(1.0 - region * 0.6, hash21(cell + 0.5));
    let r = 0.016 + hash21(cell + 2.0) * 0.012;
    let d = length(hit - star);
    let core = smoothstep(r + footprint, r - footprint * 0.5, d);
    // Security falls off from the middle of the map toward its rim, with regional noise.
    let security = clamp(1.15 - length(star * vec2f(0.1, 0.16)) - (fbm2(star * 0.35, 3) - 0.5) * 0.7, 0.0, 1.0);
    let sc = security_color(security);
    let fade = exp(-t * 0.035);
    color += sc * (core * 0.75 + glow(d, r * 4.0) * 0.05) * present * fade * presence;

    // Cynosural fields and the jump range, drawn on the plane.
    for (var i = 0u; i < system_count; i++) {
      let s = data[i];
      let ds = length(hit - s.xy);
      let cyno = s.z;
      if (cyno > 0.0) {
        let ring = smoothstep(footprint * 2.0, 0.0, abs(ds - 0.22)) * 0.9 + glow(ds, 0.12) * 0.5;
        color += mix(BEACON, ICE, 0.4) * ring * cyno * presence;
      }
      if (s.w > 0.5) {
        let range = cfg.counts.w;
        let angle = atan2(hit.y - s.y, hit.x - s.x);
        let dashes = step(0.5, fract(angle * 10.0 + time * 0.15));
        let edge = smoothstep(footprint * 1.6, 0.0, abs(ds - range));
        color += WORMHOLE * edge * mix(0.35, 0.9, dashes) * s.w * presence;
        color += WORMHOLE * smoothstep(range, range * 0.2, ds) * 0.035 * presence;
      }
    }
  }

  // The route: arcs from system to system, a packet riding the leg in flight, cyno beacons
  // standing at every landing.
  for (var k = 0u; k < seg_count; k++) {
    let geo = data[MAX_SYSTEMS + k * 2u];
    let info = data[MAX_SYSTEMS + k * 2u + 1u];
    let reveal = info.w;
    if (reveal <= info.x) {
      continue;
    }
    let kk = clamp((reveal - info.x) / max(info.y - info.x, 1e-4), 0.0, 1.0);
    let a = geo.xy;
    let b = mix(geo.xy, geo.zw, kk);
    let hd = seg_dist(px, a, b);
    let d = hd.x;
    let kind = info.z;
    if (kind < 0.5) {
      // A jump arc.
      let w = 1.6 * unit;
      var c = BEACON * smoothstep(w, w * 0.3, d) * 1.3 + ICE * smoothstep(w * 0.45, 0.0, d) * 0.8;
      c += BEACON * glow(d, w * 4.0) * 0.18;
      color += c * presence;
    } else {
      // A cyno beam, standing up from a landing.
      let w = 2.0 * unit * (1.0 - hd.y * 0.6);
      let flicker = 0.85 + 0.15 * sin(time * 23.0 + kind * 7.0);
      color += mix(ICE, BEACON, hd.y) * (smoothstep(w, 0.0, d) * 1.8 + glow(d, w * 5.0) * 0.25) * (1.0 - hd.y) * flicker * presence;
    }
  }

  color += mix(BEACON, WORMHOLE, 0.5) * dust(px / cfg.frame.z, time, vec2f(screen.x * 0.2, 0.0)) * 0.14 * presence;
  return vec4f(finish(color, px, time), 1.0);
}
