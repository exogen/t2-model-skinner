import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getEnv } from "fabric";
import {
  AnimationClip,
  AnimationMixer,
  Group,
  Object3D,
  PerspectiveCamera,
  Texture,
  VectorKeyframeTrack,
} from "three";
import Viewer, { OUTSIDE_BRIGHTNESS, OUTSIDE_OPACITY } from "./Viewer";

const fixture = vi.hoisted(() => ({ events: [] }));
vi.mock("./mocap/rig", () => ({ createPlayerRig: vi.fn() }));
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    WebGLRenderer: class {
      constructor() {
        this.domElement = getEnv().document.createElement("canvas");
        this.size = new actual.Vector2();
        this.pixelRatio = 1;
        this.render = vi.fn(() => fixture.events.push("draw"));
        this.autoClear = true;
        this.setScissorTest = vi.fn();
        this.setScissor = vi.fn();
      }
      setClearColor() {}
      setPixelRatio(ratio) {
        this.pixelRatio = ratio;
      }
      getPixelRatio() {
        return this.pixelRatio;
      }
      setSize(width, height) {
        this.size.set(width, height);
        this.domElement.width = Math.floor(width * this.pixelRatio);
        this.domElement.height = Math.floor(height * this.pixelRatio);
      }
      getSize(target) {
        return target.copy(this.size);
      }
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
vi.mock("three/addons/controls/OrbitControls.js", async () => {
  const { Vector3 } = await vi.importActual("three");
  return {
    OrbitControls: class {
      constructor() {
        this.target = new Vector3();
        this.mouseButtons = {};
      }
      addEventListener() {}
      update() {
        fixture.events.push("controls");
        return false;
      }
      dispose() {}
    },
  };
});

const { document } = getEnv();
const originals = {
  request: globalThis.requestAnimationFrame,
  cancel: globalThis.cancelAnimationFrame,
  observer: globalThis.ResizeObserver,
  intersection: globalThis.IntersectionObserver,
};
let viewer;
let host;
let scheduled;
// The IntersectionObservers created, and what each one watches.
let observers;
beforeEach(() => {
  fixture.events.length = 0;
  scheduled = new Map();
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
  observers = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        this.targets = new Set();
        observers.push(this);
      }
      observe(target) {
        this.targets.add(target);
      }
      disconnect() {
        this.targets.clear();
      }
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
  frame(0);
  fixture.events.length = 0;
});
afterEach(() => {
  viewer?.dispose();
  host?.remove();
  vi.restoreAllMocks();
  vi.stubGlobal("requestAnimationFrame", originals.request);
  vi.stubGlobal("cancelAnimationFrame", originals.cancel);
  vi.stubGlobal("ResizeObserver", originals.observer);
  vi.stubGlobal("IntersectionObserver", originals.intersection);
});

function frame(time) {
  const [id, callback] = scheduled.entries().next().value;
  scheduled.delete(id);
  callback(time);
}

/** Reports the view scrolling on or off screen, oldest first. */
function scroll(...onScreen) {
  observers
    .at(-1)
    .callback(
      onScreen.map((isIntersecting) => ({ target: host, isIntersecting })),
    );
}

test("screen-space pose callbacks receive the exact final camera after body, orbit, and framing updates", () => {
  const framed = new PerspectiveCamera(30, 4 / 3);
  viewer.posing = true;
  viewer.poseFraming = {
    imageAspect: 3 / 4,
    update(base) {
      fixture.events.push("framing");
      framed.copy(base);
      framed.projectionMatrix.elements[0] *= 2;
      framed.projectionMatrixInverse.copy(framed.projectionMatrix).invert();
      return framed;
    },
  };
  const unsubscribeBase = viewer.subscribeFrame(() =>
    fixture.events.push("body"),
  );
  const callback = vi.fn((delta, camera, imageAspect) => {
    fixture.events.push("pose");
    expect(camera).toBe(framed);
    expect(imageAspect).toBe(3 / 4);
    expect(camera.projectionMatrix.elements[0]).toBe(
      viewer.camera.projectionMatrix.elements[0] * 2,
    );
  });
  const unsubscribePose = viewer.subscribePoseFrame(callback);
  frame(16);
  expect(fixture.events).toEqual([
    "body",
    "controls",
    "framing",
    "pose",
    "draw",
  ]);
  expect(viewer.renderer.render).toHaveBeenLastCalledWith(viewer.scene, framed);
  expect(callback).toHaveBeenCalledOnce();
  unsubscribeBase();
  unsubscribePose();
  frame(32);
  expect(scheduled.size).toBe(0);
});

test("a pose-only subscription keeps rendering and recomputes on a changed viewport without new body frames", () => {
  const callback = vi.fn();
  const unsubscribe = viewer.subscribePoseFrame(callback);
  frame(16);
  expect(callback).toHaveBeenLastCalledWith(0, viewer.camera, 4 / 3);
  expect(scheduled.size).toBe(1);
  viewer.camera.aspect = 0.6;
  viewer.camera.updateProjectionMatrix();
  frame(32);
  expect(callback).toHaveBeenLastCalledWith(0.016, viewer.camera, 0.6);
  expect(scheduled.size).toBe(1);
  unsubscribe();
  frame(48);
  expect(callback).toHaveBeenCalledTimes(2);
  expect(scheduled.size).toBe(0);
});

test("disposing the viewer clears both callback phases and cancels their scheduled frame", () => {
  const callback = vi.fn();
  viewer.subscribeFrame(callback);
  viewer.subscribePoseFrame(callback);
  expect(scheduled.size).toBe(1);
  viewer.dispose();
  expect(viewer.frames.size).toBe(0);
  expect(viewer.poseFrames.size).toBe(0);
  expect(scheduled.size).toBe(0);
  expect(callback).not.toHaveBeenCalled();
  viewer = null;
});

function paint(canvas, x, y, color) {
  const context = canvas.getContext("2d");
  const image = context.createImageData(1, 1);
  image.data.set(color);
  context.putImageData(image, x, y);
}

function pixel(canvas, x, y) {
  return Array.from(canvas.getContext("2d").getImageData(x, y, 1, 1).data);
}

const red = [255, 0, 0, 255];
const blue = [0, 0, 255, 255];

test("a frame capture copies the whole canvas after the next draw", async () => {
  // The marker only exists once the frame is drawn.
  viewer.renderer.render.mockImplementation(() =>
    paint(viewer.renderer.domElement, 5, 7, red),
  );
  const capture = viewer.captureFrame();
  expect(scheduled.size).toBe(1);
  frame(16);
  const copy = await capture;
  expect([copy.width, copy.height]).toEqual([640, 480]);
  expect(pixel(copy, 5, 7)).toEqual(red);
  expect(copy).not.toBe(viewer.renderer.domElement);
});

test("pose framing draws the whole view, and a capture of the camera area copies only the camera image's area", async () => {
  viewer.renderer.setPixelRatio(2);
  viewer.resize();
  const framed = new PerspectiveCamera(30, 4 / 3);
  viewer.posing = true;
  viewer.poseFraming = { imageAspect: 1, update: () => framed };
  viewer.renderer.render.mockImplementation(() => {
    const canvas = viewer.renderer.domElement;
    paint(canvas, 159, 10, blue);
    paint(canvas, 160, 10, red);
    paint(canvas, 1119, 950, red);
    paint(canvas, 1120, 10, blue);
  });
  const area = viewer.captureFrame({ cameraArea: true });
  const view = viewer.captureFrame();
  frame(16);
  expect(viewer.renderer.setScissorTest).not.toHaveBeenCalled();
  expect(viewer.renderer.render).toHaveBeenLastCalledWith(viewer.scene, framed);
  const cropped = await area;
  expect([cropped.width, cropped.height]).toEqual([960, 960]);
  expect(pixel(cropped, 0, 10)).toEqual(red);
  expect(pixel(cropped, 959, 950)).toEqual(red);
  const whole = await view;
  expect([whole.width, whole.height]).toEqual([1280, 960]);
  expect([pixel(whole, 159, 10), pixel(whole, 1120, 10)]).toEqual([blue, blue]);
});

/** Pose framing for a camera image twice as wide as it is tall. */
function frameWideImage() {
  const framed = new PerspectiveCamera(30, 4 / 3);
  viewer.posing = true;
  viewer.poseFraming = { imageAspect: 2, update: () => framed };
  return framed;
}

/** A fade drawn all the way, over everything outside `box`. */
const faded = (box) => ({
  box,
  opacity: OUTSIDE_OPACITY,
  brightness: OUTSIDE_BRIGHTNESS,
  autoClear: false,
});

/** Records each fade drawn over the frame; draws of the scene are ignored. */
function recordFades(drawScene = () => {}) {
  const fades = [];
  viewer.renderer.render.mockImplementation((object) => {
    if (object === viewer.scene) return drawScene();
    const { uniforms } = object.material;
    fades.push({
      box: uniforms.box.value.toArray(),
      opacity: uniforms.opacity.value,
      brightness: uniforms.brightness.value,
      autoClear: viewer.renderer.autoClear,
    });
    paint(viewer.renderer.domElement, 0, 0, blue);
  });
  return fades;
}

test("while faded, what's outside the camera area is drawn fainter and darker, after captures copy the frame", async () => {
  // An odd height puts the camera area half a pixel off center, so its rows
  // counted from the top and from the bottom differ.
  host.getBoundingClientRect.mockReturnValue({ width: 640, height: 481 });
  viewer.resize();
  frameWideImage();
  viewer.reducedMotion = { matches: true };
  const fades = recordFades(() => paint(viewer.renderer.domElement, 0, 0, red));
  viewer.setFadeOutsideCameraArea(true);
  const view = viewer.captureFrame();
  const area = viewer.captureFrame({ cameraArea: true });
  frame(16);
  // The capture copies rows 81 to 400 from the top, which are rows 80 to 399
  // from the bottom: edges 80 and 400.
  expect([(await area).height, fades]).toEqual([
    320,
    [faded([0, 80, 640, 400])],
  ]);
  expect(viewer.renderer.autoClear).toBe(true);
  expect(pixel(await view, 0, 0)).toEqual(red);
  // The fade is the last thing drawn.
  expect(pixel(viewer.renderer.domElement, 0, 0)).toEqual(blue);
  // It's drawn into every frame while it's on.
  viewer.invalidate();
  frame(32);
  expect(fades).toHaveLength(2);
  viewer.setFadeOutsideCameraArea(false);
  frame(48);
  expect(fades).toHaveLength(2);
  expect(scheduled.size).toBe(0);
});

test("the fade eases in and out over 200 ms", () => {
  frameWideImage();
  const fades = recordFades();
  const steps = () =>
    fades.splice(0).map(({ opacity, brightness }) => [opacity, brightness]);
  // A quarter of the way through the fade, and so on.
  const at = (progress) =>
    [OUTSIDE_OPACITY, OUTSIDE_BRIGHTNESS].map((full) =>
      expect.closeTo(1 - progress * (1 - full)),
    );
  const full = [OUTSIDE_OPACITY, OUTSIDE_BRIGHTNESS];
  viewer.setFadeOutsideCameraArea(true);
  // The first frame after the view was still has no time to measure.
  frame(100);
  frame(150);
  frame(250);
  frame(400);
  expect(steps()).toEqual([at(0.25), at(0.75), full]);
  expect(scheduled.size).toBe(0);
  viewer.setFadeOutsideCameraArea(false);
  frame(500);
  frame(600);
  frame(700);
  expect(steps()).toEqual([full, at(0.5)]);
  expect(scheduled.size).toBe(0);
});

test("without a camera area, nothing is faded", () => {
  viewer.renderer.setPixelRatio(2);
  viewer.resize();
  const fades = recordFades();
  viewer.reducedMotion = { matches: true };
  viewer.setFadeOutsideCameraArea(true);
  frame(16);
  expect(fades).toEqual([]);
  // The area appears with the framing, already faded. The box is in device
  // pixels.
  frameWideImage();
  viewer.invalidate();
  frame(32);
  expect(fades).toEqual([faded([0, 160, 1280, 800])]);
});

test("without pose framing, a capture of the camera area is the whole view", async () => {
  const capture = viewer.captureFrame({ cameraArea: true });
  frame(16);
  const copy = await capture;
  expect([copy.width, copy.height]).toEqual([640, 480]);
});

test("a frame capture settles inside the frame that drew it", async () => {
  const settled = vi.fn();
  void viewer.captureFrame().then(settled);
  frame(16);
  const pending = scheduled.size;
  await Promise.resolve();
  expect(settled).toHaveBeenCalledOnce();
  expect(scheduled.size).toBe(pending);
});

test("disposing the viewer rejects pending frame captures and later requests", async () => {
  const capture = viewer.captureFrame();
  viewer.dispose();
  await expect(capture).rejects.toThrow("The 3D view has closed.");
  await expect(viewer.captureFrame()).rejects.toThrow(
    "The 3D view has closed.",
  );
  viewer = null;
});

test("a lost graphics context rejects frame captures until it is restored", async () => {
  const canvas = viewer.renderer.domElement;
  const capture = viewer.captureFrame();
  canvas.dispatchEvent(
    new globalThis.Event("webglcontextlost", { cancelable: true }),
  );
  await expect(capture).rejects.toThrow("lost its graphics context");
  await expect(viewer.captureFrame()).rejects.toThrow(
    "lost its graphics context",
  );
  canvas.dispatchEvent(new globalThis.Event("webglcontextrestored"));
  const next = viewer.captureFrame();
  frame(16);
  expect((await next).width).toBe(640);
});

test("a capture without the background gets its own draw, before the draw the screen shows", async () => {
  const environment = new Texture();
  viewer.scene.background = environment;
  const backgrounds = [];
  viewer.renderer.render.mockImplementation(() => {
    backgrounds.push(viewer.scene.background);
    paint(
      viewer.renderer.domElement,
      0,
      0,
      viewer.scene.background ? blue : red,
    );
  });
  const transparent = viewer.captureFrame({ background: false });
  const visible = viewer.captureFrame();
  frame(16);
  expect(backgrounds).toEqual([null, environment]);
  expect(viewer.scene.background).toBe(environment);
  expect(pixel(await transparent, 0, 0)).toEqual(red);
  expect(pixel(await visible, 0, 0)).toEqual(blue);
});

test("with no environment showing, a capture without the background uses the frame's only draw", async () => {
  const draws = viewer.renderer.render.mock.calls.length;
  const transparent = viewer.captureFrame({ background: false });
  frame(16);
  expect(viewer.renderer.render).toHaveBeenCalledTimes(draws + 1);
  expect((await transparent).width).toBe(640);
});

test("the environment comes back even if the draw without it fails", () => {
  const environment = new Texture();
  viewer.scene.background = environment;
  viewer.renderer.render.mockImplementationOnce(() => {
    throw new Error("draw failed");
  });
  viewer.captureFrame({ background: false }).catch(() => {});
  expect(() => frame(16)).toThrow("draw failed");
  expect(viewer.scene.background).toBe(environment);
});

test("off screen, animations stop, and continue from where they stopped back on screen", () => {
  viewer.mixer = { update: vi.fn() };
  viewer.action = {};
  // Like an animated texture.
  const textureFrames = vi.fn();
  viewer.subscribeFrame(textureFrames);
  frame(16);
  frame(32);
  scroll(false);
  // The frame that was already requested is the last.
  frame(48);
  expect(scheduled.size).toBe(0);
  viewer.invalidate();
  expect(scheduled.size).toBe(0);
  // Out and back in since the last report.
  scroll(false, true);
  frame(5000);
  frame(5016);
  const steps = [0, 0.016, 0.016, 0, 0.016];
  expect(viewer.mixer.update.mock.calls.map(([seconds]) => seconds)).toEqual(
    steps,
  );
  expect(textureFrames.mock.calls.map(([seconds]) => seconds)).toEqual(steps);
});

test("off screen, captures and live mocap still get frames", async () => {
  scroll(false);
  const capture = viewer.captureFrame();
  expect(scheduled.size).toBe(1);
  frame(16);
  expect((await capture).width).toBe(640);
  expect(scheduled.size).toBe(0);
  // Live poses and recording.
  const unsubscribePose = viewer.subscribePoseFrame(() => {});
  frame(32);
  frame(48);
  expect(scheduled.size).toBe(1);
  unsubscribePose();
  frame(64);
  expect(scheduled.size).toBe(0);
  // A recording playing back poses the model on frame callbacks.
  viewer.posing = true;
  const playback = vi.fn();
  viewer.subscribeFrame(playback);
  frame(80);
  frame(96);
  expect(scheduled.size).toBe(1);
  // Coming back on screen doesn't disturb frames that kept going.
  scroll(true);
  frame(112);
  expect(playback.mock.calls.map(([seconds]) => seconds)).toEqual([
    0, 0.016, 0.016,
  ]);
});

test("without IntersectionObserver, the view draws as if it were always on screen", () => {
  viewer.dispose();
  vi.stubGlobal("IntersectionObserver", undefined);
  viewer = new Viewer(host);
  const callback = vi.fn();
  viewer.subscribeFrame(callback);
  frame(16);
  frame(32);
  expect(callback).toHaveBeenCalledTimes(2);
  expect(scheduled.size).toBe(1);
});

test("a view that only touches the viewport's edge counts as off screen", () => {
  // At a threshold of 0, browsers report it as intersecting.
  expect(observers[0].options.threshold).toBeGreaterThan(0);
});

test("disposing the viewer stops watching whether it's on screen", () => {
  const [observer] = observers;
  expect(observer.targets).toEqual(new Set([host]));
  viewer.dispose();
  expect(observer.targets.size).toBe(0);
  viewer = null;
});

test("a clip played once stops asking for frames when it ends, and pausing and playing again doesn't start it over", () => {
  const scene = new Group();
  const node = new Object3D();
  node.name = "node";
  scene.add(node);
  viewer.model = {
    scene,
    animations: [
      new AnimationClip("Deploy", 0.5, [
        new VectorKeyframeTrack("node.position", [0, 0.5], [0, 0, 0, 1, 0, 0]),
      ]),
    ],
  };
  viewer.mixer = new AnimationMixer(scene);
  viewer.setAnimation(null, false, 0.5, true);
  let count = 0;
  while (scheduled.size && count < 1000) frame(16 * ++count);
  // Half a second of animation at half speed takes a second.
  expect(count * 16).toBeGreaterThan(1000);
  expect(count * 16).toBeLessThan(1100);
  expect(node.position.x).toBe(1);
  viewer.setAnimation(null, true, 0.5, true);
  viewer.setAnimation(null, false, 0.5, true);
  frame(5000);
  expect(scheduled.size).toBe(0);
  expect(node.position.x).toBe(1);
});
