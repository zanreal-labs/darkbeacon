// The Darkbeacon mark, built as the thing it draws: a black hole (the core) inside its
// accretion ring, with the beacon leaving it as a relativistic jet, standing over a dark
// glossy floor that catches its light.
//
// Rays are integrated along bent (Schwarzschild) paths, so the far side of the ring is lifted
// over the core into the halo that makes the silhouette read as the logo's circle from any
// angle. The jet is one-sided on purpose: a real counter-jet is Doppler-dimmed, and the mark
// has one beam. The floor is a plane the same integration bounces off, so its reflection is
// the scene itself, bent the same way, never a mirrored copy.
//
// Output is linear HDR; the composite pass blooms, tonemaps and grades it.

import { BEACON, DEEP, ICE, VIOLET, WORMHOLE, fbm2, glow, nebula, noise2, star_field } from "./lib/common.wgsl";

struct Params {
  // render target size in pixels, then time in seconds and the device's quality (0.5..1)
  frame: vec4f,
  // camera: yaw, pitch, distance from the hole, focal length
  camera: vec4f,
  // where the hole sits on screen (uv), and its apparent scale
  place: vec4f,
  // the entrance, each 0..1: photon ring, disk, jet, floor and sky
  entrance: vec4f,
  // the jet axis (unit) and the brightness of its knots
  jet: vec4f,
  // the disk normal (unit) and its spin
  disk: vec4f,
};

@group(0) @binding(0) var<uniform> params: Params;

const HORIZON: f32 = 1.0;
const ISCO: f32 = 2.7;
const DISK_OUTER: f32 = 8.5;
const FLOOR_Y: f32 = -5.2;
const JET_LENGTH: f32 = 15.0;

fn geodesic_acceleration(p: vec3f, v: vec3f) -> vec3f {
  let r2 = dot(p, p);
  let l = cross(p, v);
  return -1.5 * dot(l, l) * p / (r2 * r2 * sqrt(r2));
}

// An orthonormal frame around the disk normal, so the disk can be tilted toward the camera
// the way the mark's ring faces the viewer.
fn disk_frame(n: vec3f) -> mat3x3f {
  let helper = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.9);
  let t = normalize(cross(helper, n));
  let b = cross(n, t);
  return mat3x3f(t, n, b);
}

// Emission and density of the accretion ring at a point in the disk's own frame (y = normal).
fn disk_sample(q: vec3f, ray: vec3f, frame: mat3x3f) -> vec4f {
  let radius = length(q.xz);
  let height = abs(q.y);
  if (radius <= ISCO * 0.92 || radius >= DISK_OUTER || height > 0.5) {
    return vec4f(0.0);
  }
  let time = params.frame.z;
  // Differential rotation in rotated Cartesian space: no polar seam.
  let omega = params.disk.w / pow(radius, 1.5);
  let swirl = 2.4 * log(radius);
  let angle = time * omega + swirl;
  let c = cos(angle);
  let s = sin(angle);
  let rc = vec2f(c * q.x - s * q.z, s * q.x + c * q.z);
  let broad = fbm2(rc * 0.85, 4);
  let detail = fbm2(rc * 2.9 + broad * 1.6, 3);
  let lanes = 0.5 + 0.5 * sin(radius * 9.0 + broad * 5.0);
  let clumps = smoothstep(0.24, 0.86, broad * 0.7 + detail * 0.48 + lanes * 0.2);

  let thickness = mix(0.03, 0.16, smoothstep(ISCO, DISK_OUTER, radius));
  let vertical = exp(-pow(height / thickness, 2.0) * 3.2);
  let inner = smoothstep(ISCO * 0.92, ISCO + 0.5, radius);
  let outer = 1.0 - smoothstep(DISK_OUTER - 2.8, DISK_OUTER, radius);
  // The entrance spins the ring up from its inner edge outward.
  let reveal_radius = mix(ISCO, DISK_OUTER + 1.0, params.entrance.y);
  let revealed = 1.0 - smoothstep(reveal_radius - 1.6, reveal_radius, radius);
  let heat = pow(1.0 - (radius - ISCO) / (DISK_OUTER - ISCO), 1.5);
  let density = vertical * inner * outer * clumps * revealed;

  // Brand-hot plasma: violet at the rim, beacon cyan through the body, ice at the inner edge.
  var color = mix(VIOLET * 0.32, WORMHOLE * 0.75, smoothstep(0.0, 0.4, heat));
  color = mix(color, BEACON * 1.7, smoothstep(0.35, 0.75, heat));
  color = mix(color, ICE * 2.2, smoothstep(0.7, 1.0, heat));

  // Doppler beaming: the approaching side brighter and whiter, the receding side dimmer.
  let tangent_local = normalize(vec3f(-q.z, 0.0, q.x));
  let tangent = frame * tangent_local;
  let speed = min(0.6, 0.9 / sqrt(max(radius - HORIZON, 0.3)));
  let toward = dot(tangent, -ray);
  let doppler = pow(clamp(1.0 / (1.0 - speed * toward), 0.6, 1.6), 1.6);
  color = mix(color, ICE, clamp((doppler - 1.0) * 0.35, 0.0, 0.5));
  let redshift = sqrt(1.0 - HORIZON / radius);
  let emission = color * density * doppler * redshift * 7.5;
  return vec4f(emission, density * 2.4);
}

// The beacon: emission per unit length of a cone along the jet axis.
fn jet_sample(p: vec3f) -> vec3f {
  let axis = params.jet.xyz;
  let along = dot(p, axis);
  let side = length(p - axis * along);
  let time = params.frame.z;
  let length_now = JET_LENGTH * params.entrance.z;
  let forward = step(0.0, along);
  let s = abs(along);
  let width = 0.07 + s * 0.06;
  let profile = exp(-(side * side) / (width * width));
  let core = exp(-(side * side) / (width * width * 0.08));
  let start = smoothstep(1.2, 2.2, s);
  // The front of the beam as it shoots out during the entrance, then a long fade.
  let front = 1.0 - smoothstep(length_now - 2.0, length_now, s);
  let fade = exp(-s / 9.0);
  // Knots riding outward along the beam.
  let knots = 0.55 + 0.45 * sin(s * 1.7 - time * 5.0) * fbm2(vec2f(s * 0.8 - time * 2.6, side * 4.0), 2);
  let strength = start * front * fade * mix(0.035, 1.0, forward) * mix(1.0, knots, params.jet.w);
  let color = mix(BEACON * 1.4, ICE * 1.2, core);
  return color * (profile * 2.4 + core * 9.0) * strength;
}

fn floor_shade(p: vec3f, frame: mat3x3f) -> vec3f {
  // The ring lights the floor as an annulus of emitters; four taps around it are enough for a
  // soft, directional pool. The jet adds a cyan wash along the side it points to.
  var light = vec3f(0.0);
  for (var i = 0; i < 4; i++) {
    let a = f32(i) * 1.5707963 + 0.4;
    let emitter = frame * vec3f(cos(a) * 4.2, 0.0, sin(a) * 4.2);
    let to_light = emitter - p;
    let d2 = dot(to_light, to_light);
    let lambert = max(normalize(to_light).y, 0.0);
    light += mix(WORMHOLE, BEACON, 0.45) * lambert / (1.0 + d2 * 0.09);
  }
  light *= params.entrance.y * 0.55;

  let axis = params.jet.xyz;
  let along = clamp(dot(p, axis), 1.5, JET_LENGTH * params.entrance.z);
  let to_jet = axis * along - p;
  let jet_d2 = dot(to_jet, to_jet);
  light += BEACON * max(normalize(to_jet).y, 0.0) * 1.6 / (1.0 + jet_d2 * 0.05) * params.entrance.z;

  // The floor's own surface: near-black, a whisper of brushed grain.
  let grain = fbm2(p.xz * vec2f(2.4, 0.35), 3);
  let albedo = 0.05 + grain * 0.04;
  let fog = exp(-length(p.xz) * 0.055);
  return light * albedo * fog * params.entrance.w;
}

fn sky(direction: vec3f) -> vec3f {
  return (star_field(direction, 0.016) * 0.7 + nebula(direction) + DEEP) * params.entrance.w;
}

@fragment fn fs_main(@location(0) uv: vec2f, @builtin(position) frag: vec4f) -> @location(0) vec4f {
  let size = params.frame.xy;
  let aspect = size.x / size.y;
  // Screen coordinates centred on the hole, so the layout can place it anywhere in the frame.
  let screen = vec2f((uv.x - params.place.x) * aspect, params.place.y - uv.y) * 2.0 / params.place.z;

  let yaw = params.camera.x;
  let pitch = params.camera.y;
  let distance = params.camera.z;
  let eye = vec3f(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)) * distance;
  let forward = normalize(-eye);
  let right = normalize(cross(forward, vec3f(0.0, 1.0, 0.0)));
  let up = cross(right, forward);

  var position = eye;
  var velocity = normalize(forward * params.camera.w + right * screen.x + up * screen.y);
  let frame = disk_frame(params.disk.xyz);
  let to_disk = transpose(frame);

  var color = vec3f(0.0);
  var throughput = 1.0;
  var escaped = false;
  var bounced = false;
  let max_steps = i32(mix(90.0, 150.0, params.frame.w));

  for (var i = 0; i < max_steps; i++) {
    let r = length(position);
    if (r < HORIZON * 1.02) {
      break;
    }
    if (r > distance + 6.0 && dot(position, velocity) > 0.0) {
      escaped = true;
      break;
    }

    // Coarse in empty space, fine near the horizon, the disk and the beam.
    var step_size = clamp((r - HORIZON) * 0.11, 0.02, 1.4);
    let q = to_disk * position;
    let rq = length(q.xz);
    if (rq > ISCO - 0.8 && rq < DISK_OUTER + 0.8) {
      let slab = mix(0.03, 0.16, smoothstep(ISCO, DISK_OUTER, rq));
      let vq = to_disk * velocity;
      let vy = max(abs(vq.y), 0.001);
      let band = slab * 3.0;
      let ay = abs(q.y);
      if (ay < band) {
        step_size = min(step_size, slab * 0.45 / vy);
      } else if (q.y * vq.y < 0.0) {
        step_size = min(step_size, (ay - band) / vy + 0.01);
      }
    }
    let axis = params.jet.xyz;
    let along = dot(position, axis);
    let side = length(position - axis * along);
    let jet_width = 0.07 + abs(along) * 0.06;
    step_size = min(step_size, max(side - jet_width * 2.5, jet_width * 0.7));
    step_size = max(step_size, 0.012);

    // The floor: land exactly on it, then bounce.
    if (!bounced && velocity.y < 0.0) {
      let to_floor = (position.y - FLOOR_Y) / -velocity.y;
      if (to_floor < step_size) {
        position += velocity * to_floor;
        color += floor_shade(position, frame) * throughput;
        // A dark dielectric: a little reflection head-on, much more at grazing angles,
        // and a gentle ripple so the reflection reads as a surface, not a mirror.
        let cos_theta = -velocity.y;
        let fresnel = 0.04 + 0.96 * pow(1.0 - cos_theta, 5.0);
        let ripple = vec2f(noise2(position.xz * 0.9), noise2(position.zx * 0.9 + 5.2)) - 0.5;
        let normal = normalize(vec3f(ripple.x * 0.025, 1.0, ripple.y * 0.025));
        velocity = reflect(velocity, normal);
        throughput *= mix(0.04, 0.85, fresnel);
        bounced = true;
        position.y = FLOOR_Y + 0.001;
        continue;
      }
    }

    let previous = position;
    let a0 = geodesic_acceleration(position, velocity);
    velocity += a0 * (0.5 * step_size);
    position += velocity * step_size;
    let a1 = geodesic_acceleration(position, velocity);
    velocity = normalize(velocity + a1 * (0.5 * step_size));

    let mid = mix(previous, position, 0.5);
    let volume = disk_sample(to_disk * mid, velocity, frame);
    if (volume.a > 0.0001 && throughput > 0.01) {
      let depth = volume.a * step_size;
      let absorbed = 1.0 - exp(-depth);
      color += volume.rgb * throughput * absorbed / max(volume.a, 0.001);
      throughput *= exp(-depth);
    }
    color += jet_sample(mid) * step_size * throughput;
  }

  if (escaped) {
    if (!bounced && velocity.y < 0.0) {
      // Far from the hole the path is straight: meet the floor analytically, so the horizon is
      // a clean line however far away it lies, and reflect the sky in it.
      let to_floor = (position.y - FLOOR_Y) / -velocity.y;
      let hit = position + velocity * to_floor;
      color += floor_shade(hit, frame) * throughput;
      let fresnel = 0.04 + 0.96 * pow(1.0 + velocity.y, 5.0);
      color += sky(reflect(velocity, vec3f(0.0, 1.0, 0.0))) * throughput * mix(0.04, 0.85, fresnel);
    } else {
      color += sky(velocity) * throughput;
    }
  }

  // The photon ring, drawn as a thin rim of light at the shadow's edge. It is what the
  // entrance ignites first, before any plasma arrives.
  let center_dir = normalize(-eye);
  let view_dir = normalize(forward * params.camera.w + right * screen.x + up * screen.y);
  let shadow_angle = 2.6 * HORIZON / distance;
  let angle = acos(clamp(dot(view_dir, center_dir), -1.0, 1.0));
  let rim = glow(abs(angle - shadow_angle), shadow_angle * 0.025) * params.entrance.x;
  color += ICE * rim * 1.4 * (1.0 - params.entrance.y * 0.85);

  return vec4f(color, 1.0);
}
