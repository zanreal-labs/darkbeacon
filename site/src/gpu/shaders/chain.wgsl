// The chain as a lit 3D scene: systems are glowing spheres, connections are filaments that carry
// the map's own colours (outer colour for time, core colour for mass, a red halo for danger),
// with energy travelling along them. Geometry is projected on the CPU each frame; this pass
// shades it in screen space, over a dot grid on the plane the chain stands on.

import { BEACON, DEEP, ICE, WORMHOLE, dust, finish, glow, nebula, spark } from "./lib/common.wgsl";

struct Chain {
  // canvas size in device pixels, device pixel ratio, time
  frame: vec4f,
  // camera eye (xyz) and focal length
  eye: vec4f,
  // camera basis: right (xyz) and presence 0..1; up; forward
  right: vec4f,
  up: vec4f,
  fwd: vec4f,
  // node count, segment count, pixel unit, grid height
  counts: vec4f,
};

@group(0) @binding(0) var<uniform> cfg: Chain;
// nodes: 3 x vec4 each; then edge styles: 2 x vec4 each; then segments: 2 x vec4 each.
@group(0) @binding(1) var<storage, read> data: array<vec4f>;

const MAX_NODES: u32 = 8u;
const MAX_EDGES: u32 = 7u;

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
  var color = DEEP + nebula(rd) * 0.8 * presence;

  // The plane: a fine dot grid, lit from under the chain and fading into the distance.
  if (rd.y < -0.001) {
    let t = (cfg.counts.w - cfg.eye.y) / rd.y;
    let hit = cfg.eye.xyz + rd * t;
    let cell = fract(hit.xz * 1.6) - 0.5;
    let dotmask = smoothstep(0.035 + t * 0.002, 0.0, length(cell));
    let pool = exp(-length(hit.xz * vec2f(0.12, 0.35)));
    color += mix(WORMHOLE, BEACON, 0.5) * dotmask * pool * 0.35 * presence * exp(-t * 0.03);
  }

  let node_count = min(u32(cfg.counts.x), MAX_NODES);
  let seg_count = u32(cfg.counts.y);
  let edge_base = MAX_NODES * 3u;
  let seg_base = edge_base + MAX_EDGES * 2u;

  // Filaments.
  for (var s = 0u; s < seg_count; s++) {
    let geo = data[seg_base + s * 2u];
    let info = data[seg_base + s * 2u + 1u];
    let reveal = info.w;
    if (reveal <= info.x) {
      continue;
    }
    // Clip the segment to how far the connection has drawn itself.
    let k = clamp((reveal - info.x) / max(info.y - info.x, 1e-4), 0.0, 1.0);
    let a = geo.xy;
    let b = mix(geo.xy, geo.zw, k);
    let hd = seg_dist(px, a, b);
    let edge = u32(info.z);
    let style_a = data[edge_base + edge * 2u];
    let style_b = data[edge_base + edge * 2u + 1u];
    let flags = u32(style_b.w);
    let width = style_a.w * unit;
    let d = hd.x;
    if (d > width * 14.0) {
      continue;
    }
    let outer = style_a.rgb;
    let core = style_b.rgb;
    var c = outer * smoothstep(width, width * 0.55, d) * 0.9;
    c = mix(c, core * 1.15, smoothstep(width * 0.38, width * 0.1, d));
    c += outer * glow(d, width * 2.0) * 0.16;
    // Danger: a red halo around the line.
    if ((flags & 1u) != 0u) {
      c += vec3f(0.9, 0.06, 0.05) * smoothstep(width * 2.6, width * 0.8, d) * 0.45;
    }
    // Energy riding the connection, toward the newer system.
    let t = mix(info.x, info.y, hd.y * k);
    let phase = fract(t - time * 0.22 + f32(edge) * 0.37);
    let packet = smoothstep(0.06, 0.0, abs(phase - 0.5)) * select(1.0, 0.0, (flags & 4u) != 0u);
    c += mix(core, ICE, 0.5) * packet * glow(d, width * 1.2) * 1.2;
    color += c * presence;
  }

  // Systems: shaded spheres with a rim and a halo, lit from above and to the left.
  let light = normalize(vec3f(-0.5, 0.7, 0.6));
  for (var i = 0u; i < node_count; i++) {
    let n0 = data[i * 3u];
    let n1 = data[i * 3u + 1u];
    let n2 = data[i * 3u + 2u];
    let appear = n0.w;
    if (appear <= 0.0) {
      continue;
    }
    let center = n0.xy;
    let radius = n0.z * mix(0.4, 1.0, appear);
    let d = length(px - center);
    let tint = n1.rgb;
    var c = tint * glow(d, radius * 1.6) * 0.45;
    if (d < radius) {
      let q = (px - center) / radius;
      let normal = vec3f(q.x, -q.y, sqrt(max(0.0, 1.0 - dot(q, q))));
      let diffuse = max(dot(normal, light), 0.0);
      let rim = pow(1.0 - normal.z, 3.0);
      let spec = pow(max(dot(reflect(-light, normal), vec3f(0.0, 0.0, 1.0)), 0.0), 24.0);
      let body = tint * (0.18 + diffuse * 0.9) + tint * rim * 1.4 + ICE * spec * 0.9;
      let edge_aa = smoothstep(radius, radius - 1.2 * unit, d);
      c = mix(c, body, edge_aa);
    }
    // Home: a beacon ring. Hostile: a red one.
    let ring = n1.w;
    if (ring > 0.0) {
      let rr = radius * 1.9;
      let ring_color = select(BEACON * 1.4, vec3f(1.0, 0.12, 0.1), ring > 1.5);
      c += ring_color * smoothstep(1.4 * unit, 0.0, abs(d - rr)) * 0.9;
      let breathe = fract(time * 0.35 + f32(i) * 0.2);
      c += ring_color * smoothstep(1.2 * unit, 0.0, abs(d - rr * (1.0 + breathe * 1.4))) * (1.0 - breathe) * 0.6;
    }
    // Bubbled: an amber bubble at the system's side of the connection.
    if (n2.y > 0.0) {
      let bc = center + vec2f(n2.z, n2.w);
      c += vec3f(1.0, 0.55, 0.12) * smoothstep(1.5 * unit, 0.0, abs(length(px - bc) - 7.0 * unit)) * 0.9;
    }
    color += c * appear * presence * n2.x;
  }

  color += mix(BEACON, WORMHOLE, 0.5) * dust(px / cfg.frame.z, time, vec2f(screen.x * 0.2, 0.0)) * 0.15 * presence;
  return vec4f(finish(color, px, time), 1.0);
}
