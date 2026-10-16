// Bloom, step one: what is bright enough to glow, with a soft knee so highlights roll in.
// Downsamples with a 4-tap box at the same time, which is free and kills shimmer.

struct Bright {
  texel: vec2f,
  threshold: f32,
  knee: f32,
};

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> bright: Bright;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let o = bright.texel * 0.5;
  var color = textureSampleLevel(src, samp, uv + vec2f(-o.x, -o.y), 0.0).rgb;
  color += textureSampleLevel(src, samp, uv + vec2f(o.x, -o.y), 0.0).rgb;
  color += textureSampleLevel(src, samp, uv + vec2f(-o.x, o.y), 0.0).rgb;
  color += textureSampleLevel(src, samp, uv + vec2f(o.x, o.y), 0.0).rgb;
  color *= 0.25;
  let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  let soft = clamp((luma - bright.threshold + bright.knee) / (2.0 * bright.knee), 0.0, 1.0);
  let contribution = max(soft * soft * bright.knee, luma - bright.threshold);
  return vec4f(color * (contribution / max(luma, 1e-4)), 1.0);
}
