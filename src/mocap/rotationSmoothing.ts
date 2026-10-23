import { Quaternion, Vector3 } from "three";

export type RotationSmoothingMode = "none" | "classic" | "adaptive" | "stable";

const presets = {
  adaptive: { minCutoff: 1.2, beta: 0.75 },
  stable: { minCutoff: 0.6, beta: 0.35 },
};

export interface RotationSmoother {
  /** Returns an internal quaternion; copy it before modifying or retaining it. */
  filter(target: Quaternion, deltaSeconds: number): Quaternion;
  reset(rotation?: Quaternion): void;
}

const EPSILON = 1e-12;
// Rate of the fixed exponential damping, in 1/seconds (time constant ≈ 71 ms).
const DAMPING_RATE = 14;

/** Interpolation factor for exponential damping. The result is the same at
 * any render frame rate. */
export function poseSmoothingAlpha(deltaSeconds: number): number {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0;
  return -Math.expm1(-DAMPING_RATE * Math.min(deltaSeconds, 0.25));
}

function valid(rotation: Quaternion) {
  return Number.isFinite(rotation.x) && Number.isFinite(rotation.y) &&
    Number.isFinite(rotation.z) && Number.isFinite(rotation.w) &&
    Number.isFinite(rotation.lengthSq()) && rotation.lengthSq() > EPSILON;
}

/** 1€-style adaptive damping on rotations, rather than independently filtered
 * Euler angles. Angular velocity uses the shortest quaternion delta and a
 * 1 Hz derivative filter. The final exponential response is time-based so
 * rendering between camera frames does not change the damping time constant.
 * See https://gery.casiez.net/1euro/ and VRPN's quaternion 1€ filter. */
export function createRotationSmoother(mode: RotationSmoothingMode = "classic"): RotationSmoother {
  const rotation = new Quaternion();
  const desired = new Quaternion();
  const previousTarget = new Quaternion();
  const difference = new Quaternion();
  const velocity = new Vector3();
  const measuredVelocity = new Vector3();
  let initialized = false;

  return {
    filter(target, deltaSeconds) {
      if (!valid(target)) return rotation;
      desired.copy(target).normalize();
      if (!initialized) {
        initialized = true;
        rotation.copy(desired);
        previousTarget.copy(desired);
        velocity.set(0, 0, 0);
      }
      if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return rotation;
      if (deltaSeconds > 0.5) {
        velocity.set(0, 0, 0);
        previousTarget.copy(desired);
      }
      const delta = Math.min(deltaSeconds, 0.25);
      if (mode === "none") return rotation.copy(desired);
      if (mode === "classic") return rotation.slerp(desired, poseSmoothingAlpha(delta)).normalize();

      difference.copy(previousTarget).invert().premultiply(desired).normalize();
      previousTarget.copy(desired);
      // q and -q describe the same orientation. Use the shortest logarithm
      // so representation changes cannot become a spurious velocity burst.
      if (difference.w < 0) {
        difference.set(-difference.x, -difference.y, -difference.z, -difference.w);
      }
      const sine = Math.hypot(difference.x, difference.y, difference.z);
      const angle = 2 * Math.atan2(sine, Math.max(0, difference.w));
      measuredVelocity.set(difference.x, difference.y, difference.z)
        .multiplyScalar(sine > EPSILON ? angle / (sine * delta) : 0);
      velocity.lerp(measuredVelocity, -Math.expm1(-2 * Math.PI * delta));
      const preset = presets[mode];
      const cutoff = preset.minCutoff + preset.beta * velocity.length();
      return rotation.slerp(desired, -Math.expm1(-2 * Math.PI * cutoff * delta)).normalize();
    },
    reset(initial) {
      initialized = initial !== undefined && valid(initial);
      if (initialized) rotation.copy(initial!).normalize();
      else rotation.identity();
      previousTarget.copy(rotation);
      velocity.set(0, 0, 0);
    },
  };
}
