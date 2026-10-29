/** A symmetric, camera-facing T-pose in the detector's coordinates. The body
 * is centered at the hips, palms face down, and the head has no yaw/roll/pitch.
 * All 33 points are present so the same fixture exercises either head solver
 * and the coarse hands/feet without relying on invisible placeholder points. */
export function standardTPose() {
  const landmarks = new Array(33);
  const set = (index, x, y, z = 0) => {
    landmarks[index] = { x, y: -y, z: -z, visibility: 1, presence: 1 };
  };
  set(0, 0, 0.75, 0.12);
  for (const [side, sign] of [
    [0, 1],
    [1, -1],
  ]) {
    const eye = side === 0 ? 1 : 4;
    set(eye, sign * 0.03, 0.79, 0.095);
    set(eye + 1, sign * 0.055, 0.79, 0.08);
    set(eye + 2, sign * 0.08, 0.79, 0.06);
    set(7 + side, sign * 0.1, 0.75);
    set(9 + side, sign * 0.035, 0.7, 0.095);
    set(11 + side, sign * 0.3, 0.5);
    set(13 + side, sign * 0.6, 0.5);
    set(15 + side, sign * 0.9, 0.5);
    set(17 + side, sign * 1.1, 0.5, -0.04);
    set(19 + side, sign * 1.1, 0.5, 0.04);
    set(21 + side, sign * 1.0, 0.5, 0.08);
    set(23 + side, sign * 0.15, 0);
    set(25 + side, sign * 0.15, -0.5);
    set(27 + side, sign * 0.15, -0.9);
    set(29 + side, sign * 0.15, -1, -0.05);
    set(31 + side, sign * 0.15, -1, 0.2);
  }
  return landmarks;
}
