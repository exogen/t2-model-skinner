import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getEnv } from "fabric";
import {
  AnimationClip,
  Bone,
  BoxGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Skeleton,
  SkinnedMesh,
  Spherical,
  Texture,
  Uint16BufferAttribute,
  VectorKeyframeTrack,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import Viewer, { FrameOrbitControls } from "./Viewer";

// There's no WebGL here, so nothing is drawn. OrbitControls is the real one.
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    WebGLRenderer: class {
      constructor() {
        this.domElement = getEnv().document.createElement("canvas");
      }
      setClearColor() {}
      setPixelRatio() {}
      getPixelRatio() {
        return 1;
      }
      setSize() {}
      getSize(target) {
        return target.set(640, 480);
      }
      render() {}
      dispose() {}
      forceContextLoss() {}
    },
    PMREMGenerator: class {
      fromScene() {
        return { texture: new actual.Texture(), dispose() {} };
      }
      dispose() {}
    },
  };
});

const { document, window } = getEnv();
const originals = {
  request: globalThis.requestAnimationFrame,
  cancel: globalThis.cancelAnimationFrame,
  observer: globalThis.ResizeObserver,
};
let viewer;
let host;
let scheduled;
let time;
const controllers = [];
beforeEach(() => {
  scheduled = new Map();
  time = 0;
  let nextId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    scheduled.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id) => scheduled.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  host = document.createElement("div");
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue({
    width: 640,
    height: 480,
  });
  document.body.append(host);
  viewer = new Viewer(host);
  pointerCanvas(viewer.renderer.domElement);
});
afterEach(() => {
  viewer.dispose();
  host.remove();
  controllers.splice(0).forEach((controls) => controls.dispose());
  vi.restoreAllMocks();
  vi.stubGlobal("requestAnimationFrame", originals.request);
  vi.stubGlobal("cancelAnimationFrame", originals.cancel);
  vi.stubGlobal("ResizeObserver", originals.observer);
});

/** jsdom has no pointer capture or layout. */
function pointerCanvas(canvas = document.createElement("canvas")) {
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  Object.defineProperty(canvas, "clientHeight", {
    value: 480,
    configurable: true,
  });
  return canvas;
}

/** jsdom has no PointerEvent. `init` can hold modifier keys. */
function pointer(canvas, type, x, y = 100, button = 0, init = {}) {
  const event = new window.MouseEvent(type, {
    button,
    clientX: x,
    clientY: y,
    ...init,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: "mouse" },
  });
  canvas.dispatchEvent(event);
}

/** A touch on the view. OrbitControls reads touches' page coordinates. */
function touch(type, id, x, y) {
  const event = new window.MouseEvent(type, { clientX: x, clientY: y });
  Object.defineProperties(event, {
    pointerId: { value: id },
    pointerType: { value: "touch" },
    pageX: { value: x },
    pageY: { value: y },
  });
  viewer.renderer.domElement.dispatchEvent(event);
}

function wheel(deltaY, deltaMode = 0) {
  const event = new window.WheelEvent("wheel", {
    deltaY,
    deltaMode,
    cancelable: true,
  });
  viewer.renderer.domElement.dispatchEvent(event);
  return event;
}

function key(name) {
  const event = new window.KeyboardEvent("keydown", {
    key: name,
    cancelable: true,
  });
  viewer.renderer.domElement.dispatchEvent(event);
  return event;
}

/** Runs the requested frames 16 ms apart until no more are requested, and
 * returns how far the camera moved in each. */
function runFrames() {
  const steps = [];
  while (scheduled.size && steps.length < 1000) {
    const before = viewer.camera.position.clone();
    const [id, callback] = scheduled.entries().next().value;
    scheduled.delete(id);
    callback((time += 16));
    steps.push(viewer.camera.position.distanceTo(before));
  }
  return steps;
}

/** Runs `count` requested frames, 16 ms apart. */
function frames(count) {
  for (let i = 0; i < count && scheduled.size; i++) {
    const [id, callback] = scheduled.entries().next().value;
    scheduled.delete(id);
    callback((time += 16));
  }
}

/** Loads `scene` as the model. */
async function loadScene(scene, camera = {}, animations = []) {
  vi.spyOn(GLTFLoader.prototype, "loadAsync").mockResolvedValueOnce({
    scene,
    animations,
    parser: { json: {}, associations: new Map() },
  });
  await viewer.load("/model.glb", camera);
}

/** Loads a box `width` by `height` by `depth`, named "box", as the model. */
async function loadBox([width, height, depth], camera = {}, animations = []) {
  const box = new Mesh(
    new BoxGeometry(width, height, depth),
    new MeshStandardMaterial(),
  );
  box.name = "box";
  await loadScene(new Group().add(box), camera, animations);
}

/** Where the camera is around the orbit target. */
function orbit() {
  return new Spherical().setFromVector3(
    viewer.camera.position.clone().sub(viewer.controls.target),
  );
}

/** How much of the scene the view's height spans at the orbit target. */
function viewHeight() {
  return 2 * orbit().radius * Math.tan((viewer.camera.fov * Math.PI) / 360);
}

// The 2 by 4 by 2 box most tests use: the radius of its bounds, the distance
// it's framed from at 30°, and how wide it needs the view to be.
const boxRadius = Math.sqrt(6);
const boxFraming = boxRadius / Math.sin(Math.PI / 12);
const boxAspect = Math.SQRT2 / (boxFraming - 2) / Math.tan(Math.PI / 12);
const [minRadius, maxRadius] = [2.2 * boxRadius, 1.05 * boxFraming];

/** The field of view framing `fov` widens to in a view of this aspect. */
function framedFov(fov, aspect, idealAspect = boxAspect) {
  return (
    (2 *
      Math.atan(
        Math.tan((fov * Math.PI) / 360) * Math.max(1, idealAspect / aspect),
      ) *
      180) /
    Math.PI
  );
}

test("during a drag, OrbitControls' own updates only ask for a frame, and each frame moves the camera by time", () => {
  const camera = new PerspectiveCamera();
  const canvas = pointerCanvas();
  const requestFrame = vi.fn();
  const controls = new FrameOrbitControls(camera, canvas, requestFrame);
  controllers.push(controls);
  controls.enableDamping = true;
  camera.position.set(0, 0, 5);
  controls.update();
  const theta = () => Math.atan2(camera.position.x, camera.position.z);
  pointer(canvas, "pointerdown", 100);
  expect(controls.dragging).toBe(true);
  // A tenth of the view's height turns the camera a tenth of a turn.
  const turn = -Math.PI / 5;
  pointer(canvas, "pointermove", 148);
  expect(requestFrame).toHaveBeenCalledOnce();
  expect(controls.update()).toBe(false);
  expect(requestFrame).toHaveBeenCalledTimes(2);
  expect(theta()).toBe(0);
  // Two 1/60 s frames take it as far as one 1/30 s frame would.
  expect(controls.step(1 / 60)).toBe(true);
  expect(controls.dampingFactor).toBeCloseTo(1 - Math.exp(-1 / 3), 12);
  expect(theta()).toBeCloseTo(turn * (1 - Math.exp(-1 / 3)), 9);
  controls.step(1 / 60);
  expect(theta()).toBeCloseTo(turn * (1 - Math.exp(-2 / 3)), 9);
  pointer(canvas, "pointerup", 148);
  expect(controls.dragging).toBe(false);
  // Outside a drag, update() moves the camera itself, like OrbitControls'.
  const before = theta();
  expect(controls.update()).toBe(true);
  expect(theta()).toBeLessThan(before);
  // So does a drag with damping off, all the way at once, as when the view
  // is replaced.
  controls.enableDamping = false;
  pointer(canvas, "pointerdown", 100);
  pointer(canvas, "pointermove", 148);
  expect(theta()).toBeCloseTo(2 * turn, 9);
  expect(requestFrame).toHaveBeenCalledTimes(2);
});

test("on a model as small as a player, frames continue until the camera settles", async () => {
  // lmale is 0.0228 units tall.
  await loadBox([0.008, 0.0228, 0.004]);
  runFrames();
  const canvas = viewer.renderer.domElement;
  pointer(canvas, "pointerdown", 100);
  pointer(canvas, "pointermove", 110);
  pointer(canvas, "pointerup", 110);
  const steps = runFrames();
  // Most of them move the camera less than the 0.001 units OrbitControls
  // reports as a change.
  expect(
    steps.filter((step) => step > 0 && step < 0.001).length,
  ).toBeGreaterThan(20);
  // They stop within a second, when what's left wouldn't move it a tenth of a
  // pixel.
  expect(scheduled.size).toBe(0);
  expect(steps.length * 16).toBeLessThan(1000);
  const pixel =
    (2 * orbit().radius * Math.tan((viewer.camera.fov * Math.PI) / 360)) / 480;
  const settled = viewer.camera.position.clone();
  viewer.controls.step(1);
  expect(viewer.camera.position.distanceTo(settled)).toBeLessThan(pixel / 10);
});

test("models are framed for 30°, so a narrower field of view zooms in, and orbits start no farther than 105%", async () => {
  // The corners of a 2 by 4 by 2 box are √6 from its center.
  const framing = Math.sqrt(6) / Math.sin(Math.PI / 12);
  await loadBox([2, 4, 2]);
  expect(orbit().radius).toBeCloseTo(framing * 1.05, 9);
  expect(viewer.camera.fov).toBeCloseTo(30, 9);
  await loadBox([2, 4, 2], { orbit: "0deg 75deg 90%" });
  expect(orbit().radius).toBeCloseTo(framing * 0.9, 9);
  // A narrower lens, like the chaingun's, and a farther orbit, like the vehicles'.
  await loadBox([2, 4, 2], { fov: "12deg", orbit: "290deg 60deg 130%" });
  const { radius, theta, phi } = orbit();
  expect(radius).toBeCloseTo(framing * 1.05, 9);
  expect(theta).toBeCloseTo(((290 - 360) * Math.PI) / 180, 9);
  expect(phi).toBeCloseTo(Math.PI / 3, 9);
  expect(viewer.camera.fov).toBeCloseTo(12, 9);
  // The viewer's zoom limits apply, not OrbitControls'.
  expect([viewer.controls.minDistance, viewer.controls.maxDistance]).toEqual([
    0,
    Infinity,
  ]);
  // Home goes back there.
  viewer.camera.position.multiplyScalar(2);
  viewer.controls.update();
  viewer.resetCamera();
  expect(orbit().radius).toBeCloseTo(framing * 1.05, 9);
  // A view narrower than the model widens the lens by as much as at 30°.
  host.getBoundingClientRect.mockReturnValue({ width: 240, height: 480 });
  viewer.resize();
  const idealAspect = Math.SQRT2 / (framing - 2) / Math.tan(Math.PI / 12);
  const fov =
    (2 * Math.atan((Math.tan(Math.PI / 30) * idealAspect) / 0.5) * 180) /
    Math.PI;
  expect(viewer.camera.fov).toBeCloseTo(fov, 9);
});

test("the camera stops 22.5° short of straight under the model, or at the horizon with an environment showing", async () => {
  await loadBox([2, 4, 2]);
  const fromBelow = () => {
    const { target } = viewer.controls;
    viewer.camera.position.set(target.x, target.y - 10, target.z + 1e-6);
    viewer.controls.update();
    return orbit().phi;
  };
  expect(fromBelow()).toBeCloseTo((Math.PI * 7) / 8, 9);
  viewer.background = new Texture();
  viewer.setBackgroundVisible(true);
  expect(fromBelow()).toBeCloseTo(Math.PI / 2, 9);
  viewer.setBackgroundVisible(false);
  expect(fromBelow()).toBeCloseTo((Math.PI * 7) / 8, 9);
});

test("a middle-drag orbits like a left-drag instead of zooming", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  const before = orbit();
  const canvas = viewer.renderer.domElement;
  pointer(canvas, "pointerdown", 100, 100, 1);
  pointer(canvas, "pointermove", 148, 124, 1);
  pointer(canvas, "pointerup", 148, 124, 1);
  // All the way there.
  viewer.controls.step(1);
  const after = orbit();
  expect(after.radius).toBeCloseTo(before.radius, 9);
  expect(after.theta).toBeCloseTo(before.theta - Math.PI / 5, 6);
  expect(after.phi).toBeCloseTo(before.phi - Math.PI / 10, 6);
});

test("the cursor is an open hand over the view, and a closed one while dragging", () => {
  const canvas = viewer.renderer.domElement;
  expect(canvas.style.cursor).toBe("grab");
  pointer(canvas, "pointerdown", 100);
  expect(canvas.style.cursor).toBe("grabbing");
  pointer(canvas, "pointerup", 100);
  expect(canvas.style.cursor).toBe("grab");
  // A right-drag pans.
  pointer(canvas, "pointerdown", 100, 100, 2);
  expect(canvas.style.cursor).toBe("grabbing");
  pointer(canvas, "pointercancel", 100, 100, 2);
  expect(canvas.style.cursor).toBe("grab");
});

test("a scroll changes distance and field of view together, eased over time", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  expect(orbit().radius).toBeCloseTo(maxRadius, 9);
  const height = viewHeight();
  // Scrolling up by 100 pixels zooms in.
  expect(wheel(-100).defaultPrevented).toBe(true);
  const deltaZoom = (-100 * 0.04) / 30;
  // The log of the field of view moves toward log 10° by that much, and the
  // distance keeps pace toward 2.2 radii.
  const goalRadius =
    maxRadius +
    (deltaZoom * (minRadius - maxRadius)) / (Math.log(10) - Math.log(30));
  const goalFov = 30 * Math.exp(deltaZoom);
  expect(orbit().radius).toBeCloseTo(maxRadius, 9);
  // The first frame after the view was still counts as 1/60 s.
  frames(1);
  const k = 1 - Math.exp(-1 / 3);
  expect(orbit().radius).toBeCloseTo(
    maxRadius + (goalRadius - maxRadius) * k,
    9,
  );
  expect(viewer.camera.fov).toBeCloseTo(30 * Math.exp(deltaZoom * k), 9);
  const steps = runFrames();
  expect(scheduled.size).toBe(0);
  expect(steps.length * 16).toBeLessThan(1000);
  expect(orbit().radius).toBeCloseTo(goalRadius, 12);
  expect(viewer.camera.fov).toBeCloseTo(goalFov, 12);
  // About 1.22 times as big, as the old app measured.
  expect(height / viewHeight()).toBeCloseTo(1.22, 2);
});

test("scrolling by lines counts 18 pixels a line, and frames continue while only the field of view eases", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  const position = viewer.camera.position.clone();
  // From the farthest distance, zooming out only widens the field of view.
  wheel(3, 1);
  const steps = runFrames();
  expect(steps.length).toBeGreaterThan(10);
  expect(scheduled.size).toBe(0);
  expect(viewer.camera.position.distanceTo(position)).toBeLessThan(1e-12);
  expect(viewer.camera.fov).toBeCloseTo(
    30 * Math.exp((3 * 18 * 0.04) / 30),
    12,
  );
});

test("each zoom step moves the distance so it reaches its limit with the field of view, or by twice its range with the field of view at a limit", async () => {
  await loadBox([2, 4, 2]);
  const [minLog, maxLog] = [Math.log(10), Math.log(viewer.adjustedFov(45))];
  viewer.adjustZoom(-0.3);
  let radius =
    maxRadius - (0.3 * (minRadius - maxRadius)) / (minLog - Math.log(30));
  let logFov = Math.log(30) - 0.3;
  expect(viewer.goalRadius).toBeCloseTo(radius, 12);
  expect(viewer.goalLogFov).toBeCloseTo(logFov, 12);
  viewer.adjustZoom(0.2);
  radius += (0.2 * (maxRadius - radius)) / (maxLog - logFov);
  logFov += 0.2;
  expect(viewer.goalRadius).toBeCloseTo(radius, 12);
  expect(viewer.goalLogFov).toBeCloseTo(logFov, 12);
  viewer.goalLogFov = maxLog;
  viewer.goalRadius = minRadius + 1;
  viewer.adjustZoom(0.01);
  expect(viewer.goalRadius).toBeCloseTo(
    minRadius + 1 + 0.01 * 2 * (maxRadius - minRadius),
    12,
  );
  expect(viewer.goalLogFov).toBe(maxLog);
});

test("zoom stops at 2.2 radii and 10°, and at 105% of the framing distance and 45°, widened for a narrow view", async () => {
  await loadBox([2, 4, 2]);
  for (let notch = 0; notch < 20; notch++) wheel(-100);
  runFrames();
  expect(orbit().radius).toBeCloseTo(minRadius, 12);
  expect(viewer.camera.fov).toBeCloseTo(10, 12);
  for (let notch = 0; notch < 20; notch++) wheel(100);
  runFrames();
  expect(orbit().radius).toBeCloseTo(maxRadius, 12);
  expect(viewer.camera.fov).toBeCloseTo(45, 12);
  host.getBoundingClientRect.mockReturnValue({ width: 240, height: 480 });
  viewer.resize();
  for (let notch = 0; notch < 20; notch++) wheel(100);
  runFrames();
  expect(viewer.camera.fov).toBeCloseTo(framedFov(45, 0.5), 12);
  // A view that starts closer than the zoom allows starts at the limit.
  await loadBox([2, 4, 2], { orbit: "0deg 75deg 50%" });
  expect(orbit().radius).toBeCloseTo(minRadius, 12);
});

test("pinching zooms, and two fingers still pan", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  const logFov = viewer.goalLogFov;
  touch("pointerdown", 1, 300, 200);
  touch("pointerdown", 2, 400, 200);
  // Fingers 48 pixels farther apart on a view 480 pixels tall zoom in by 0.2.
  touch("pointermove", 2, 448, 200);
  expect(viewer.goalLogFov).toBeCloseTo(logFov - (0.04 * 48 * 50) / 480, 12);
  frames(60);
  // Both fingers moving down drags the model down, and the zoom ends where it was.
  const target = viewer.controls.target.clone();
  const goal = viewer.goalLogFov;
  touch("pointermove", 1, 300, 260);
  touch("pointermove", 2, 448, 260);
  frames(60);
  expect(viewer.goalLogFov).toBeCloseTo(goal, 12);
  expect(viewer.controls.target.y - target.y).toBeGreaterThan(0.1);
});

test("a two-finger pan doesn't zoom, whichever frames the fingers' moves come in", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  const { goalRadius, goalLogFov } = viewer;
  touch("pointerdown", 1, 300, 200);
  touch("pointerdown", 2, 400, 200);
  // Browsers send each finger's move on its own, in the same frame or not.
  for (let step = 1; step <= 30; step++) {
    touch("pointermove", 1, 300 + 5 * step, 200);
    if (step % 2) frames(1);
    touch("pointermove", 2, 400 + 5 * step, 200);
    frames(1);
  }
  expect(viewer.goalRadius).toBe(goalRadius);
  expect(viewer.goalLogFov).toBe(goalLogFov);
  expect(viewer.controls.target.x).toBeLessThan(-1);
});

test("a pinch starts over when a finger lifts, so the zoom doesn't jump when the fingers change", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  const logFov = viewer.goalLogFov;
  const step = (0.04 * 48 * 50) / 480;
  touch("pointerdown", 1, 300, 200);
  touch("pointerdown", 2, 400, 200);
  touch("pointermove", 2, 448, 200);
  expect(viewer.goalLogFov).toBeCloseTo(logFov - step, 12);
  // A third finger, then the first lifts: the other two are 152 pixels apart.
  touch("pointerdown", 3, 600, 200);
  touch("pointerup", 1, 300, 200);
  expect(viewer.goalLogFov).toBeCloseTo(logFov - step, 12);
  touch("pointermove", 3, 648, 200);
  expect(viewer.goalLogFov).toBeCloseTo(logFov - 2 * step, 12);
});

test("a pinch carries on at the new scale when the view's height changes", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  const logFov = viewer.goalLogFov;
  touch("pointerdown", 1, 300, 200);
  touch("pointerdown", 2, 400, 200);
  touch("pointermove", 2, 448, 200);
  Object.defineProperty(viewer.renderer.domElement, "clientHeight", {
    value: 400,
    configurable: true,
  });
  touch("pointermove", 2, 496, 200);
  expect(viewer.goalLogFov).toBeCloseTo(
    logFov - (0.04 * 48 * 50) / 480 - (0.04 * 48 * 50) / 400,
    12,
  );
});

test("pinching back from past a zoom limit zooms at once", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  touch("pointerdown", 1, 300, 200);
  touch("pointerdown", 2, 400, 200);
  // 300 pixels at once is more than zooming all the way in takes.
  touch("pointermove", 2, 700, 200);
  expect(viewer.goalLogFov).toBeCloseTo(Math.log(10), 12);
  expect(viewer.goalRadius).toBeCloseTo(minRadius, 12);
  touch("pointermove", 2, 690, 200);
  expect(viewer.goalLogFov).toBeCloseTo(
    Math.log(10) + (0.04 * 10 * 50) / 480,
    12,
  );
  // Pinching out past the other limit, and back.
  touch("pointermove", 2, 310, 200);
  expect(viewer.goalLogFov).toBeCloseTo(Math.log(45), 12);
  expect(viewer.goalRadius).toBeCloseTo(maxRadius, 12);
  touch("pointermove", 2, 320, 200);
  expect(viewer.goalLogFov).toBeCloseTo(
    Math.log(45) - (0.04 * 10 * 50) / 480,
    12,
  );
});

test("a pinch carries on from a resize in the middle of it", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  touch("pointerdown", 1, 300, 200);
  touch("pointerdown", 2, 400, 200);
  touch("pointermove", 2, 448, 200);
  const pinched = viewer.goalLogFov;
  host.getBoundingClientRect.mockReturnValue({ width: 240, height: 480 });
  viewer.resize();
  const resized = viewer.goalLogFov;
  expect(resized).toBeGreaterThan(pinched + 0.3);
  touch("pointermove", 2, 496, 200);
  expect(viewer.goalLogFov).toBeCloseTo(resized - (0.04 * 48 * 50) / 480, 12);
});

test("while posing, two fingers only zoom, and the one left behind turns the model as one finger does", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  viewer.setPoseMode(true);
  runFrames();
  const before = orbit();
  const { goalLogFov } = viewer;
  touch("pointerdown", 1, 300, 200);
  touch("pointerdown", 2, 400, 200);
  touch("pointermove", 2, 410, 200);
  touch("pointermove", 1, 290, 200);
  frames(60);
  expect(viewer.goalLogFov).toBeCloseTo(
    goalLogFov - (0.04 * 20 * 50) / 480,
    12,
  );
  expect(orbit().theta).toBeCloseTo(before.theta, 9);
  expect(orbit().phi).toBeCloseTo(before.phi, 9);
  touch("pointerup", 2, 410, 200);
  touch("pointermove", 1, 350, 200);
  frames(60);
  touch("pointerup", 1, 350, 200);
  expect(orbit().theta).toBeCloseTo(before.theta - (2 * Math.PI * 60) / 480, 6);
  // Out of mocap, two fingers pan again.
  viewer.setPoseMode(false);
  runFrames();
  const target = viewer.controls.target.clone();
  touch("pointerdown", 1, 300, 200);
  touch("pointerdown", 2, 400, 200);
  touch("pointermove", 1, 300, 260);
  touch("pointermove", 2, 400, 260);
  frames(60);
  expect(viewer.controls.target.y - target.y).toBeGreaterThan(0.1);
});

test("closing the view stops listening for zoom and pivot input", async () => {
  await loadBox([2, 4, 2]);
  const { goalLogFov } = viewer;
  touch("pointerdown", 1, 300, 200);
  touch("pointerdown", 2, 400, 200);
  viewer.dispose();
  wheel(100);
  touch("pointermove", 2, 448, 200);
  expect(viewer.goalLogFov).toBe(goalLogFov);
  touch("pointerup", 2, 448, 200);
  expect(viewer.controls.target.length()).toBeLessThan(1e-12);
  viewer = new Viewer(host);
});

test("plus and minus zoom through the same eased zoom, and Home puts the view back at once", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  const position = viewer.camera.position.clone();
  expect(key("+").defaultPrevented).toBe(true);
  expect(viewer.goalLogFov).toBeCloseTo(Math.log(30) - 0.1, 12);
  expect(viewer.camera.position.equals(position)).toBe(true);
  key("=");
  expect(viewer.goalLogFov).toBeCloseTo(Math.log(30) - 0.2, 12);
  expect(key("-").defaultPrevented).toBe(true);
  expect(viewer.goalLogFov).toBeCloseTo(Math.log(30) - 0.1, 12);
  runFrames();
  expect(viewer.camera.fov).toBeCloseTo(30 * Math.exp(-0.1), 12);
  expect(orbit().radius).toBeLessThan(maxRadius - 0.1);
  // Home in the middle of a zoom.
  wheel(-300);
  frames(2);
  expect(key("Home").defaultPrevented).toBe(true);
  expect(orbit().radius).toBeCloseTo(maxRadius, 12);
  expect(viewer.camera.fov).toBeCloseTo(30, 12);
  const steps = runFrames();
  expect(steps.every((step) => step < 1e-12)).toBe(true);
  expect(viewer.camera.fov).toBeCloseTo(30, 12);
});

test("resizing keeps the zoom, changing the field of view as much as the framing one, within the limits", async () => {
  await loadBox([2, 4, 2]);
  wheel(-100);
  wheel(-100);
  runFrames();
  const { fov } = viewer.camera;
  const { radius } = orbit();
  host.getBoundingClientRect.mockReturnValue({ width: 240, height: 480 });
  viewer.resize();
  const narrow = (fov * framedFov(30, 0.5)) / 30;
  expect(viewer.camera.fov).toBeCloseTo(narrow, 12);
  // Nothing eases afterwards.
  runFrames();
  expect(viewer.camera.fov).toBeCloseTo(narrow, 12);
  expect(orbit().radius).toBeCloseTo(radius, 12);
  host.getBoundingClientRect.mockReturnValue({ width: 640, height: 480 });
  viewer.resize();
  expect(viewer.camera.fov).toBeCloseTo(fov, 12);
  // All the way out, the widest field of view limits it.
  for (let notch = 0; notch < 20; notch++) wheel(100);
  runFrames();
  host.getBoundingClientRect.mockReturnValue({ width: 240, height: 480 });
  viewer.resize();
  expect((45 * framedFov(30, 0.5)) / 30).toBeGreaterThan(
    framedFov(45, 0.5) + 1,
  );
  expect(viewer.camera.fov).toBeCloseTo(framedFov(45, 0.5), 12);
});

test("leaving mocap brings back the editor's view and zoom, even after zooming and resizing while posing", async () => {
  await loadBox([2, 4, 2]);
  wheel(-100);
  wheel(-100);
  runFrames();
  const before = {
    position: viewer.camera.position.clone(),
    target: viewer.controls.target.clone(),
    fov: viewer.camera.fov,
  };
  viewer.setPoseMode(true);
  expect(viewer.camera.fov).toBe(before.fov);
  // Zooming still works while posing.
  wheel(200);
  runFrames();
  expect(viewer.camera.fov).toBeGreaterThan(before.fov + 1);
  // Like the camera panel taking part of the page.
  host.getBoundingClientRect.mockReturnValue({ width: 240, height: 480 });
  viewer.resize();
  runFrames();
  viewer.setPoseMode(false);
  host.getBoundingClientRect.mockReturnValue({ width: 640, height: 480 });
  viewer.resize();
  expect(viewer.camera.position.distanceTo(before.position)).toBeLessThan(
    1e-12,
  );
  expect(viewer.controls.target.distanceTo(before.target)).toBeLessThan(1e-12);
  expect(viewer.camera.fov).toBeCloseTo(before.fov, 12);
  const steps = runFrames();
  expect(steps.every((step) => step < 1e-12)).toBe(true);
  expect(viewer.camera.fov).toBeCloseTo(before.fov, 12);
});

/** Starts a pan by dragging with the right button, and lets the view catch up. */
function pan(dx, dy = 0, init = {}) {
  const canvas = viewer.renderer.domElement;
  const button = init.button ?? 2;
  pointer(canvas, "pointerdown", 100, 100, button, init);
  pointer(canvas, "pointermove", 100 + dx, 100 + dy, button, init);
  frames(60);
  return () => pointer(canvas, "pointerup", 100 + dx, 100 + dy, button, init);
}

/** Whether `point` lies on the 2 by 4 by 2 box's surface. */
function onBox({ x, y, z }) {
  return (
    Math.abs(Math.max(Math.abs(x), Math.abs(y) / 2, Math.abs(z)) - 1) < 1e-9
  );
}

test("after a pan, the orbit target moves onto the surface in the middle of the view without moving the camera", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  const release = pan(30);
  const camera = viewer.camera.position.clone();
  const target = viewer.controls.target.clone();
  expect(target.x).toBeLessThan(-0.3);
  const toCamera = camera.clone().sub(target).normalize();
  release();
  const pivot = viewer.controls.target.clone();
  expect(viewer.camera.position.equals(camera)).toBe(true);
  // Straight ahead, on the box's front.
  expect(pivot.z).toBeCloseTo(1, 9);
  expect(onBox(pivot)).toBe(true);
  expect(pivot.clone().sub(target).cross(toCamera).length()).toBeLessThan(1e-9);
  expect(viewer.goalRadius).toBeCloseTo(camera.distanceTo(pivot), 12);
  // Nothing jumps afterwards.
  runFrames();
  expect(viewer.camera.position.distanceTo(camera)).toBeLessThan(1e-6);
  // The next drag turns around that point.
  const distance = viewer.camera.position.distanceTo(viewer.controls.target);
  const canvas = viewer.renderer.domElement;
  pointer(canvas, "pointerdown", 100);
  pointer(canvas, "pointermove", 160, 130);
  pointer(canvas, "pointerup", 160, 130);
  runFrames();
  expect(viewer.controls.target.distanceTo(pivot)).toBeLessThan(1e-6);
  expect(orbit().theta).toBeLessThan(-0.5);
  expect(viewer.camera.position.distanceTo(viewer.controls.target)).toBeCloseTo(
    distance,
    9,
  );
});

test("the pivot leaves the rest of a pan to finish, across the view", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  const canvas = viewer.renderer.domElement;
  const distance = orbit().radius;
  // Released before any of the pan is drawn.
  pointer(canvas, "pointerdown", 100, 100, 2);
  pointer(canvas, "pointermove", 130, 100, 2);
  pointer(canvas, "pointerup", 130, 100, 2);
  const pivot = viewer.controls.target.clone();
  expect(pivot.z).toBeCloseTo(1, 9);
  runFrames();
  // OrbitControls pans 2 * tan(15°) times the distance for each view height dragged.
  const panned = viewer.controls.target.clone().sub(pivot);
  expect(panned.x).toBeCloseTo(
    (-2 * 30 * distance * Math.tan(Math.PI / 12)) / 480,
    3,
  );
  expect(Math.hypot(panned.y, panned.z)).toBeLessThan(1e-3);
});

test.each([
  ["Shift", { shiftKey: true }],
  ["Ctrl", { ctrlKey: true }],
  ["Meta", { metaKey: true }],
])("a left-drag with %s held pans, and pivots", async (_, init) => {
  await loadBox([2, 4, 2]);
  runFrames();
  pan(30, 0, { button: 0, ...init })();
  expect(onBox(viewer.controls.target)).toBe(true);
});

test.each([
  ["left", 0, {}],
  ["middle", 1, {}],
  ["right, with Shift held,", 2, { shiftKey: true }],
])(
  "a %s drag rotates, and leaves the orbit target alone",
  async (_, button, init) => {
    await loadBox([2, 4, 2]);
    runFrames();
    const theta = orbit().theta;
    pan(30, 0, { button, ...init })();
    expect(orbit().theta).toBeLessThan(theta - 0.3);
    expect(viewer.controls.target.length()).toBeLessThan(1e-12);
  },
);

test("a two-finger gesture pivots when a finger lifts", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  touch("pointerdown", 1, 300, 200);
  touch("pointerdown", 2, 400, 200);
  touch("pointermove", 1, 330, 200);
  touch("pointermove", 2, 430, 200);
  frames(60);
  const camera = viewer.camera.position.clone();
  expect(viewer.controls.target.x).toBeLessThan(-0.1);
  expect(onBox(viewer.controls.target)).toBe(false);
  touch("pointerup", 2, 430, 200);
  expect(onBox(viewer.controls.target)).toBe(true);
  expect(viewer.camera.position.equals(camera)).toBe(true);
  // The finger left behind rotates; lifting it doesn't pivot again.
  const pivot = viewer.controls.target.clone();
  touch("pointerup", 1, 330, 200);
  expect(viewer.controls.target.equals(pivot)).toBe(true);
});

test("a one-finger drag rotates, and leaves the orbit target alone", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  const theta = orbit().theta;
  touch("pointerdown", 1, 300, 200);
  touch("pointermove", 1, 360, 200);
  frames(60);
  touch("pointerup", 1, 360, 200);
  expect(orbit().theta).toBeLessThan(theta - 0.5);
  expect(viewer.controls.target.length()).toBeLessThan(1e-12);
});

test("a pinch pivots too, though the fingers' midpoint stays put", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  touch("pointerdown", 1, 300, 200);
  touch("pointerdown", 2, 400, 200);
  // 2 pixels at a time, but 10 in all.
  for (let step = 2; step <= 10; step += 2) {
    touch("pointermove", 1, 300 - step, 200);
    touch("pointermove", 2, 400 + step, 200);
  }
  touch("pointerup", 2, 410, 200);
  expect(onBox(viewer.controls.target)).toBe(true);
});

test("a click or a tap isn't a pan, so it doesn't pivot", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  const canvas = viewer.renderer.domElement;
  // No frames run from here on, so only a pivot could move the target.
  const unmoved = () =>
    expect(viewer.controls.target.length()).toBeLessThan(1e-12);
  // After a drag that turns the model, a right-click and a Shift-click.
  pointer(canvas, "pointerdown", 100);
  pointer(canvas, "pointermove", 130);
  pointer(canvas, "pointerup", 130);
  runFrames();
  pointer(canvas, "pointerdown", 100, 100, 2);
  pointer(canvas, "pointerup", 100, 100, 2);
  unmoved();
  pointer(canvas, "pointerdown", 100, 100, 0, { shiftKey: true });
  pointer(canvas, "pointerup", 100, 100, 0, { shiftKey: true });
  unmoved();
  // A two-finger tap after one finger has turned the model, counted from
  // where that finger was when the second one landed.
  touch("pointerdown", 1, 300, 200);
  touch("pointermove", 1, 360, 200);
  touch("pointerdown", 2, 400, 200);
  touch("pointermove", 1, 361, 200);
  touch("pointerup", 2, 400, 200);
  touch("pointerup", 1, 361, 200);
  unmoved();
  // Fingers, and a right-drag, that move 2 pixels each way.
  touch("pointerdown", 1, 300, 200);
  touch("pointerdown", 2, 400, 200);
  touch("pointermove", 1, 302, 198);
  touch("pointermove", 2, 398, 202);
  touch("pointerup", 2, 398, 202);
  touch("pointerup", 1, 302, 198);
  unmoved();
  pointer(canvas, "pointerdown", 100, 100, 2);
  pointer(canvas, "pointermove", 102, 98, 2);
  pointer(canvas, "pointerup", 102, 98, 2);
  unmoved();
});

test("pivoting closer than the zoom allows eases the camera back to the limit", async () => {
  await loadBox([2, 4, 2]);
  for (let notch = 0; notch < 20; notch++) wheel(-100);
  runFrames();
  const release = pan(3);
  const camera = viewer.camera.position.clone();
  release();
  const pivot = viewer.controls.target.clone();
  expect(pivot.z).toBeCloseTo(1, 9);
  expect(camera.distanceTo(pivot)).toBeLessThan(minRadius - 0.5);
  expect(viewer.camera.position.equals(camera)).toBe(true);
  expect(viewer.goalRadius).toBeCloseTo(minRadius, 12);
  runFrames();
  expect(viewer.controls.target.distanceTo(pivot)).toBeLessThan(1e-9);
  expect(orbit().radius).toBeCloseTo(minRadius, 12);
});

test("a pivot in the middle of a zoom lets the zoom finish", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  wheel(-300);
  frames(2);
  const goal = viewer.goalRadius;
  const gap = goal - orbit().radius;
  const target = viewer.controls.target.clone();
  const canvas = viewer.renderer.domElement;
  pointer(canvas, "pointerdown", 100, 100, 2);
  pointer(canvas, "pointermove", 103, 100, 2);
  pointer(canvas, "pointerup", 103, 100, 2);
  const shift = viewer.controls.target.distanceTo(target);
  expect(shift).toBeGreaterThan(0.5);
  // The camera stays, and the zoom goes on as far as it was going.
  expect(viewer.goalRadius - orbit().radius).toBeCloseTo(gap, 12);
  runFrames();
  expect(orbit().radius).toBeCloseTo(goal - shift, 9);
});

test("without the model in the middle of the view, or while posing, nothing pivots", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  // As far as panning goes, the middle of the view is beside the box.
  pan(600)();
  const target = viewer.controls.target.clone();
  expect(target.length()).toBeCloseTo(boxRadius, 9);
  frames(60);
  expect(viewer.controls.target.distanceTo(target)).toBeLessThan(1e-9);
  viewer.resetCamera();
  viewer.setPoseMode(true);
  pan(30)();
  touch("pointerdown", 1, 300, 200);
  touch("pointerdown", 2, 400, 200);
  touch("pointerup", 2, 400, 200);
  touch("pointerup", 1, 300, 200);
  expect(viewer.controls.target.length()).toBeLessThan(1e-12);
});

test("a surface beyond the pan limit, like an animated one, isn't pivoted to", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  // The box moves 3 toward the camera after its bounds were measured.
  viewer.model.scene.getObjectByName("box").position.z = 3;
  viewer.model.scene.updateMatrixWorld(true);
  const release = pan(3);
  const camera = viewer.camera.position.clone();
  const target = viewer.controls.target.clone();
  release();
  expect(viewer.controls.target.equals(target)).toBe(true);
  // What's left of the pan is far too small to show.
  runFrames();
  expect(viewer.camera.position.distanceTo(camera)).toBeLessThan(1e-9);
});

/** A box made of `material` in front of the 2 by 4 by 2 box, from z = 1.6 to 1.8. */
function boxBehind(material, wrap = (object) => object) {
  const box = new Mesh(new BoxGeometry(2, 4, 2), new MeshStandardMaterial());
  const front = new Mesh(new BoxGeometry(2, 4, 0.2), material);
  front.position.z = 1.7;
  return new Group().add(box, wrap(front));
}

test.each([
  [
    "an invisible material",
    () => boxBehind(new MeshStandardMaterial({ visible: false })),
  ],
  // Only its sides are visible, from both sides.
  [
    "invisible materials on the faces hit",
    () =>
      boxBehind(
        Array.from(
          { length: 6 },
          (_, face) =>
            new MeshStandardMaterial({ visible: face < 4, side: DoubleSide }),
        ),
      ),
  ],
  [
    "an invisible parent",
    () =>
      boxBehind(new MeshStandardMaterial(), (front) => {
        const parent = new Group().add(new Group().add(front));
        parent.visible = false;
        return parent;
      }),
  ],
])("the pivot passes through %s", async (_, scene) => {
  await loadScene(scene());
  runFrames();
  pan(3)();
  expect(viewer.controls.target.z).toBeCloseTo(1, 9);
});

test("the pivot lands on a visible box in front", async () => {
  await loadScene(boxBehind(new MeshStandardMaterial()));
  runFrames();
  pan(3)();
  expect(viewer.controls.target.z).toBeCloseTo(1.8, 6);
});

test("the pivot finds a skinned mesh where it's posed now, not where it first was", async () => {
  const geometry = new BoxGeometry(2, 4, 2);
  const count = geometry.attributes.position.count;
  geometry.setAttribute(
    "skinIndex",
    new Uint16BufferAttribute(new Uint16Array(count * 4), 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new Float32BufferAttribute(
      Array.from({ length: count }, () => [1, 0, 0, 0]).flat(),
      4,
    ),
  );
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
  const bone = new Bone();
  mesh.add(bone);
  mesh.bind(new Skeleton([bone]));
  await loadScene(new Group().add(mesh));
  runFrames();
  // Moved aside, the middle of the view misses it.
  bone.position.x = 3;
  mesh.updateMatrixWorld(true);
  const release = pan(3);
  const target = viewer.controls.target.clone();
  release();
  expect(viewer.controls.target.equals(target)).toBe(true);
  bone.position.x = 0;
  mesh.updateMatrixWorld(true);
  pan(3)();
  expect(viewer.controls.target.z).toBeCloseTo(1, 9);
});

test("each arrow key turns the model the way it points, at once, like a drag that way", async () => {
  await loadBox([2, 4, 2]);
  runFrames();
  const turn = (name) => {
    const before = orbit();
    expect(key(name).defaultPrevented).toBe(true);
    const after = orbit();
    return [after.theta - before.theta, after.phi - before.phi].map(
      (angle) => Math.round(angle * 1e9) / 1e9,
    );
  };
  expect(turn("ArrowLeft")).toEqual([0.1, 0]);
  expect(turn("ArrowRight")).toEqual([-0.1, 0]);
  expect(turn("ArrowUp")).toEqual([0, 0.1]);
  expect(turn("ArrowDown")).toEqual([0, -0.1]);
  // Dragging left and up turns it the same ways.
  const before = orbit();
  const canvas = viewer.renderer.domElement;
  pointer(canvas, "pointerdown", 200, 200);
  pointer(canvas, "pointermove", 190, 190);
  pointer(canvas, "pointerup", 190, 190);
  viewer.controls.step(1);
  expect(orbit().theta).toBeGreaterThan(before.theta);
  expect(orbit().phi).toBeGreaterThan(before.phi);
});

test("a weapon's first clip plays once after each load and holds its last frame, and then frames stop", async () => {
  const deploy = new AnimationClip("Deploy", 0.5, [
    new VectorKeyframeTrack("box.position", [0, 0.5], [0, 0, 0, 0, 0.5, 0]),
  ]);
  for (let load = 0; load < 2; load++) {
    await loadBox([2, 4, 2], {}, [deploy]);
    viewer.setAnimation(null, false, 0.5, true);
    const box = viewer.model.scene.getObjectByName("box");
    expect(box.position.y).toBe(0);
    const count = runFrames().length;
    // Half a second of animation at half speed.
    expect(count * 16).toBeGreaterThan(1000);
    expect(count * 16).toBeLessThan(1100);
    expect(scheduled.size).toBe(0);
    expect(box.position.y).toBe(0.5);
    // Pausing and playing again doesn't start it over.
    viewer.setAnimation(null, true, 0.5, true);
    viewer.setAnimation(null, false, 0.05, true);
    expect(runFrames()).toHaveLength(1);
    expect(box.position.y).toBe(0.5);
  }
});
