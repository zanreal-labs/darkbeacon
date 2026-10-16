// The wormhole between sections: you fly through it as you scroll. A tunnel of plasma filaments
// twisting toward a bright exit, with debris streaking past. The same shader for every passage;
// each one sets its own mood (colours, turbulence, twist), so scan, fight and the way out feel
// different while staying one place.

import { DEEP, TAU, dust, fbm2, finish, glow, hash21, spark } from "./lib/common.wgsl";

struct Transit {
  // canvas size in device pixels, device pixel ratio, time
  frame: vec4f,
  // travel along the tunnel, twist, turbulence, overall intensity
  flight: vec4f,
  // the wall colour near and far (rgb), and the exit's size
  near: vec4f,
  far: vec4f,
  // the exit light (rgb), and how much the debris shows
  exit: vec4f,
  // where the exit sits (uv), pointer parallax
  view: vec4f,
};

@group(0) @binding(0) var<uniform> cfg: Transit;

@fragment fn fs_main(@location(0) uv: vec2f, @builtin(position) frag: vec4f) -> @location(0) vec4f {
  let size = cfg.frame.xy;
  let aspect = size.x / size.y;
  let time = cfg.frame.w;
  let travel = cfg.flight.x;
  let twist = cfg.flight.y;
  let turbulence = cfg.flight.z;

  // Centre on the exit, looking slightly off-axis with the pointer.
  let p = (uv - cfg.view.xy) * vec2f(aspect, 1.0) - cfg.view.zw * 0.05;
  let r = max(length(p), 1e-3);
  let angle = atan2(p.y, p.x);

  // Depth along the tunnel: the walls rush past near the frame, crawl near the exit.
  let z = 0.35 / r;
  let depth_fade = smoothstep(0.0, 0.12, r);
  let tw = angle + z * twist + time * 0.05;
  let ring = vec2f(cos(tw), sin(tw));

  // Filaments: noise stretched along the tunnel, warped by itself for turbulence.
  let along = z + travel;
  let base = fbm2(ring * 2.2 + vec2f(along * 0.55, -along * 0.35), 4);
  let warp = fbm2(ring * 4.5 + vec2f(base * 2.0 * turbulence, along * 1.3), 3);
  let strands = pow(smoothstep(0.42, 0.98, warp * 0.65 + base * 0.6), 3.2);
  let fine = pow(fbm2(ring * 9.0 + vec2f(along * 2.4, base), 2), 3.0);

  let hue = mix(cfg.near.rgb, cfg.far.rgb, smoothstep(0.6, 3.5, z));
  var color = hue * (strands * 0.75 + fine * 0.22) * depth_fade;
  // The walls darken toward the camera so the frame edge is never bright.
  color *= smoothstep(1.4, 0.25, r) * 0.9 + 0.1;
  // ...and brighten toward the exit, where the light comes from.
  color *= 0.25 + 1.4 * glow(r, 0.2);

  // The exit: a hot, small light and its long soft halo.
  let exit_size = cfg.near.w;
  color += cfg.exit.rgb * (spark(r, exit_size) * 3.0 + glow(r, exit_size * 4.0) * 0.35);

  // Debris: streaks flying outward from the exit, the faster the closer.
  var streaks = 0.0;
  for (var i = 0; i < 18; i++) {
    let fi = f32(i);
    let seed = hash21(vec2f(fi, 3.7));
    let a = seed * TAU;
    let phase = fract(hash21(vec2f(fi, 9.1)) + travel * (0.25 + seed * 0.4) + time * 0.03);
    let rr = 0.06 + phase * phase * 1.2;
    let len = 0.02 + phase * phase * 0.18;
    let dir = vec2f(cos(a), sin(a));
    let along_ray = dot(p, dir);
    let side = abs(dot(p, vec2f(-dir.y, dir.x)));
    let inside = smoothstep(rr - len, rr, along_ray) * (1.0 - smoothstep(rr, rr + 0.004, along_ray));
    streaks += inside * smoothstep(0.0016 + phase * 0.0014, 0.0, side) * phase * phase;
  }
  color += mix(cfg.exit.rgb, vec3f(1.0), 0.5) * streaks * cfg.exit.w * 0.45;

  // The shared dust, drifting in front of it all.
  let css = frag.xy / cfg.frame.z;
  color += mix(cfg.near.rgb, cfg.exit.rgb, 0.5) * dust(css, time, cfg.view.zw) * 0.25;

  color = color * cfg.flight.w + DEEP;
  return vec4f(finish(color, frag.xy, time), 1.0);
}
