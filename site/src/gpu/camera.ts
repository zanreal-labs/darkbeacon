/**
 * The orbit camera the CPU-projected scenes share with their shaders. The convention matches the
 * WGSL side exactly: screen = (px - w/2, h/2 - py) / (h/2), ray = fwd * focal + right * sx + up * sy.
 */

export type Vec3 = readonly [number, number, number];

export interface Camera {
  eye: Vec3;
  right: Vec3;
  up: Vec3;
  fwd: Vec3;
  focal: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function camera(target: Vec3, yaw: number, pitch: number, distance: number, focal = 2): Camera {
  const eye: Vec3 = [
    target[0] + Math.sin(yaw) * Math.cos(pitch) * distance,
    target[1] + Math.sin(pitch) * distance,
    target[2] + Math.cos(yaw) * Math.cos(pitch) * distance,
  ];
  const fwd = norm(sub(target, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return { eye, right, up, fwd, focal };
}

export function project(cam: Camera, p: Vec3, width: number, height: number) {
  const d = sub(p, cam.eye);
  const z = Math.max(1e-3, dot(d, cam.fwd));
  const sx = (dot(d, cam.right) * cam.focal) / z;
  const sy = (dot(d, cam.up) * cam.focal) / z;
  return { x: width / 2 + (sx * height) / 2, y: height / 2 - (sy * height) / 2, z };
}

/** The focal length that fits every point inside `fillX` of the width and `fillY` of the height. */
export function fitFocal(cam: Camera, points: readonly Vec3[], aspect: number, fillX: number, fillY: number): number {
  let mx = 1e-3;
  let my = 1e-3;
  for (const p of points) {
    const d = sub(p, cam.eye);
    const z = Math.max(1e-3, dot(d, cam.fwd));
    mx = Math.max(mx, Math.abs(dot(d, cam.right) / z));
    my = Math.max(my, Math.abs(dot(d, cam.up) / z));
  }
  return Math.min((fillX * aspect) / mx, fillY / my);
}
