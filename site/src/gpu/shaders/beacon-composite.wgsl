// The hero's last pass, onto the canvas: the traced scene upsampled, its bloom, the dust it
// lights, and the shared film finish. The edges fade to the page's own black so the stage has
// no rectangle.

import { BEACON, ICE, WORMHOLE, dust, finish, glow } from "./lib/common.wgsl";

struct Composite {
  // canvas size in device pixels, device pixel ratio, time
  frame: vec4f,
  // where the hole sits on screen (uv), its apparent scale, dust strength
  place: vec4f,
  // pointer parallax (-1..1), bloom strength, exposure
  look: vec4f,
  // fade at the top, fade at the bottom (fractions of the height), global fade-in, spare
  edges: vec4f,
};

@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var bloom: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> cfg: Composite;

@fragment fn fs_main(@location(0) uv: vec2f, @builtin(position) frag: vec4f) -> @location(0) vec4f {
  var color = textureSampleLevel(scene, samp, uv, 0.0).rgb;
  color += textureSampleLevel(bloom, samp, uv, 0.0).rgb * cfg.look.z;

  // Dust, lit by the hole: brighter near it, tinted from ice at the core to the brand hues out.
  let css = frag.xy / cfg.frame.z;
  let aspect = cfg.frame.x / cfg.frame.y;
  let to_hole = (uv - cfg.place.xy) * vec2f(aspect, 1.0);
  let near = glow(length(to_hole), 0.32 * cfg.place.z);
  let motes = dust(css, cfg.frame.w, cfg.look.xy);
  let tint = mix(mix(WORMHOLE, BEACON, 0.5), ICE, near);
  color += tint * motes * (0.05 + near * 0.9) * cfg.place.w;

  color *= cfg.look.w;

  // No edges: the picture dissolves into the page above and below.
  let top = smoothstep(0.0, cfg.edges.x, uv.y);
  let bottom = 1.0 - smoothstep(1.0 - cfg.edges.y, 1.0, uv.y);
  let vignette = mix(0.55, 1.0, 1.0 - smoothstep(0.45, 1.25, length((uv - vec2f(0.5)) * vec2f(1.2, 1.0))));
  color *= top * bottom * vignette * cfg.edges.z;

  return vec4f(finish(color, frag.xy, cfg.frame.w), 1.0);
}
