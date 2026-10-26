import {
  ACESFilmicToneMapping, AnimationAction, AnimationClip, AnimationMixer, Box3, BufferGeometry, CustomBlending,
  EquirectangularReflectionMapping, Group, LoopOnce, LoopRepeat, Material, MathUtils, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, MOUSE, Object3D, PerspectiveCamera, PMREMGenerator, Raycaster, Scene, ShaderMaterial,
  Skeleton, SkinnedMesh, Sphere, Spherical, SRGBColorSpace, SrcColorFactor, Texture, TOUCH, Vector2, Vector3,
  Vector4, WebGLRenderer, WebGLRenderTarget, ZeroFactor,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import NeutralEnvironment from "./NeutralEnvironment";
import type { createPlayerRig, PlayerRig } from "./mocap/rig";
import type { PoseLandmark } from "./mocap/poseTracking";
import type { createPoseFraming } from "./mocap/cameraFraming";
import { containedVideoRect, pixelBox, type VideoRect } from "./videoRect";
import { randomColorGeometry, type RenderMode } from "./renderModes";

// What's outside the camera area is drawn at this opacity and brightness while
// it's faded, and takes this long to fade in or out.
export const OUTSIDE_OPACITY = 0.3;
export const OUTSIDE_BRIGHTNESS = 0.5;
const OUTSIDE_FADE_SECONDS = 0.2;

type FrameCallback = (deltaSeconds: number) => void;
type PendingCapture = {
  background: boolean;
  cameraArea: boolean;
  resolve: (frame: HTMLCanvasElement) => void;
  reject: (error: Error) => void;
};
type PoseFrameCallback = (deltaSeconds: number, camera: PerspectiveCamera, imageAspect: number) => void;
/** A model shown mounted on a node of another: `scene` holds it there. */
export type MountedModel = { scene: Object3D; materials: Material[][] };
export type LoadedModel = {
  scene: Group; model: { materials: Material[][] }; mounts: MountedModel[]; rig: PlayerRig | null;
};
type CameraOptions = { orbit?: string; target?: string; fov?: string };
export interface PoseRuntime {
  createPlayerRig: typeof createPlayerRig;
  createPoseFraming: typeof createPoseFraming;
}

// Configuration uses original glTF indices; names and runtime clones can differ.
export function collectMaterials(gltf: GLTF): Material[][] {
  const materials: Material[][] = Array.from(
    { length: gltf.parser.json.materials?.length ?? 0 }, () => [],
  );
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const index = gltf.parser.associations.get(material)?.materials;
      if (index === undefined) continue;
      const group = materials[index] ?? (materials[index] = []);
      if (!group.includes(material)) group.push(material);
    }
  });
  return materials;
}

/** `root`'s own node called `name`, matched without case like the game's
 * node lookups, skipping models mounted on it. */
export function findOwnNode(root: Object3D, name: string): Object3D | null {
  const lowerName = name.toLowerCase();
  const search = (node: Object3D): Object3D | null => {
    if (node.name.toLowerCase() === lowerName) return node;
    for (const child of node.children) {
      const found = child.userData.mounted ? null : search(child);
      if (found) return found;
    }
    return null;
  };
  return search(root);
}

/** Mounts `part`, a model's scene that's not in another, on `node` the way
 * the game does: a model with a Mountpoint node, like a weapon, is placed so
 * that node meets `node`, and one without, like the tank's turret, so its
 * origin does. Returns what holds it there. */
export function mountPart(node: Object3D, part: Object3D) {
  const holder = new Group();
  holder.userData.mounted = true;
  const point = findOwnNode(part, "Mountpoint");
  if (point) {
    part.updateMatrixWorld(true);
    new Matrix4().copy(point.matrixWorld).invert().decompose(holder.position, holder.quaternion, holder.scale);
  }
  holder.add(part);
  node.add(holder);
  return holder;
}

/** `clips` with the tracks of the same-named clips of models mounted on
 * them, like the tank's activate clip with its turret's. Those tracks name
 * their nodes by ID, so a node of the same name elsewhere can't take them. */
export function withMountedClips(clips: AnimationClip[], mounted: { scene: Object3D; animations: AnimationClip[] }[]) {
  return clips.map((clip) => {
    const tracks = mounted.flatMap(({ scene, animations }) => animations
      .filter((other) => other.name.toLowerCase() === clip.name.toLowerCase())
      .flatMap((other) => other.tracks.flatMap((track) => {
        const dot = track.name.lastIndexOf(".");
        const node = scene.getObjectByName(track.name.slice(0, dot));
        if (!node) return [];
        const copy = track.clone();
        copy.name = `${node.uuid}${track.name.slice(dot)}`;
        return [copy];
      })));
    return tracks.length ? new AnimationClip(clip.name, -1, [...clip.tracks, ...tracks]) : clip;
  });
}

/** Multiplies the alpha of what's drawn outside `box` by `opacity`, and its
 * color by `opacity` times `brightness`. The canvas's pixels are
 * premultiplied, so that's the same as drawing them at that opacity, darkened
 * by `brightness`. `box` is left, bottom, right and top, in device pixels from
 * the drawing buffer's bottom left, like `gl_FragCoord`. */
function createOutsideFade() {
  return new FullScreenQuad(new ShaderMaterial({
    uniforms: { box: { value: new Vector4() }, opacity: { value: 1 }, brightness: { value: 1 } },
    vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `
      uniform vec4 box;
      uniform float opacity;
      uniform float brightness;
      void main() {
        if (all(greaterThan(gl_FragCoord.xy, box.xy)) && all(lessThan(gl_FragCoord.xy, box.zw))) discard;
        gl_FragColor = vec4(vec3(opacity * brightness), opacity);
      }
    `,
    // The new pixel is the old one times this color.
    blending: CustomBlending,
    blendSrc: ZeroFactor,
    blendDst: SrcColorFactor,
    depthTest: false,
    depthWrite: false,
  }));
}

/** Dispose everything a model owns, plus `extraTextures` that are no longer
 * attached to its materials (like embedded textures replaced in the editor). */
export function disposeObject(root: Object3D, extraTextures: Iterable<Texture> = []) {
  const geometries = new Set<Mesh["geometry"]>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>(extraTextures);
  const skeletons = new Set<Skeleton>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    if (object instanceof SkinnedMesh) skeletons.add(object.skeleton);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
  });
  textures.forEach((texture) => {
    texture.dispose();
    if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) texture.image.close();
  });
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  skeletons.forEach((skeleton) => skeleton.dispose());
}

// Seconds for the camera to cover about two thirds of the rest of the way to
// where the pointer put it.
const CAMERA_SMOOTHING_SECONDS = 0.05;

// As in model-viewer, the camera stays 22.5° away from straight above or below
// the model. Straight underneath, the view spins around it.
const MIN_POLAR_ANGLE = Math.PI / 8;
const MAX_POLAR_ANGLE = Math.PI * 7 / 8;

// Models are framed for this field of view, like model-viewer did. A field of
// view from the camera overrides only changes the lens afterwards, at the same
// distance: 12° and 24° zoom in, and 31° zooms out a little.
const FRAMING_FOV = 30;

// Zooming changes the camera's distance and field of view together, like
// model-viewer: from 2.2 times the model's radius at 10° to 105% of the
// framing distance at 45°, the old app's field of view limits.
const MIN_RADIUS_RATIO = 2.2;
const MIN_FOV = 10;
const MAX_FOV = 45;
// model-viewer's zoom speed: 100 pixels of scrolling change the log of the
// field of view by 0.04 * 100 / 30.
const ZOOM_SENSITIVITY = 0.04;

// Seconds of animation time for a newly chosen animation to blend in, like
// model-viewer's default crossfade.
const ANIMATION_CROSSFADE_SECONDS = 0.3;

/** OrbitControls whose damping is stepped once per drawn frame, by time.
 * During a drag, OrbitControls' handlers call update() on every pointer event,
 * and each call took a damping step; they now only ask for a frame. */
export class FrameOrbitControls extends OrbitControls {
  dragging = false;
  private readonly applyInput: () => boolean;

  constructor(camera: PerspectiveCamera, canvas: HTMLCanvasElement, requestFrame: () => void) {
    super(camera, canvas);
    // OrbitControls creates update() per instance, and its handlers call this.update().
    const update = this.update;
    this.applyInput = () => update.call(this);
    this.update = () => {
      if (!this.dragging || !this.enableDamping) return update.call(this);
      requestFrame();
      return false;
    };
    this.addEventListener("start", () => { this.dragging = true; });
    this.addEventListener("end", () => { this.dragging = false; });
  }

  /** Moves the camera `deltaSeconds` closer to where the input put it. */
  step(deltaSeconds: number) {
    this.dampingFactor = 1 - Math.exp(-deltaSeconds / CAMERA_SMOOTHING_SECONDS);
    return this.applyInput();
  }
}

export default class Viewer {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FRAMING_FOV, 1, 0.00001, 10);
  readonly renderer: WebGLRenderer;
  readonly controls: FrameOrbitControls;
  private readonly drawnPosition = new Vector3();
  private readonly drawnTarget = new Vector3();
  private readonly pmrem: PMREMGenerator;
  private defaultEnvironment: WebGLRenderTarget;
  private environment: WebGLRenderTarget | null = null;
  private background: Texture | null = null;
  private showBackground = false;
  private model: GLTF | null = null;
  private originalTextures = new Set<Texture>();
  private renderMode: RenderMode = "skin";
  // Each mesh's own geometry and its Random Colors copy, made the first time
  // that mode is shown.
  private randomColorGeometries = new Map<Mesh, { original: BufferGeometry; random: BufferGeometry }>();
  // These replace every visible material while their mode is on, so hidden
  // materials stay hidden and the skin's materials are left alone.
  private readonly randomColorMaterial = new MeshStandardMaterial({
    vertexColors: true, flatShading: true, metalness: 0, roughness: 1,
  });
  private readonly wireframeMaterial = new MeshBasicMaterial({ color: 0x63ffe2, wireframe: true, toneMapped: false });
  private mixer: AnimationMixer | null = null;
  private action: AnimationAction | null = null;
  // A held weapon's arm pose, on top of the animation.
  private armAction: AnimationAction | null = null;
  private rig: PlayerRig | null = null;
  private poseRuntime: PoseRuntime | null = null;
  private poseAnimationTime = 0;
  private readonly frames = new Set<FrameCallback>();
  private readonly poseFrames = new Set<PoseFrameCallback>();
  private captures: PendingCapture[] = [];
  private fadeOutside = false;
  // How far the outside of the camera area has faded, from 0 to 1.
  private outsideFade = 0;
  private readonly outsideFadeQuad = createOutsideFade();
  private readonly reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
  private contextLost = false;
  private frameId: number | null = null;
  private previousTime: number | null = null;
  private disposed = false;
  private modelGeneration = 0;
  private environmentGeneration = 0;
  private paused = false;
  private posing = false;
  private playbackSpeed = 1;
  private cameraOptions: CameraOptions = {};
  private bounds = new Sphere(new Vector3(), 0.01);
  private idealAspect = 1;
  private baseFov = FRAMING_FOV;
  private initialDistance = 0.1;
  private minRadius = 0;
  private maxRadius = 0;
  // Where zooming takes the camera: its distance from the orbit target, and
  // the log of its field of view. Each frame moves it closer.
  private goalRadius = 0;
  private goalLogFov = Math.log(FRAMING_FOV);
  private readonly raycaster = new Raycaster();
  // The mouse pointer that's panning, and the touches, for pinching. A pan
  // only counts once a pointer has moved further than a click or tap would:
  // the mouse from where it went down, or either finger from where it was
  // when the second one did.
  private panPointer: number | null = null;
  private readonly touches = new Map<number, Vector2>();
  private readonly panStarts = new Map<number, Vector2>();
  private panMoved = false;
  // The pinch zooms from `logFov` and `radius` by how much the fingers'
  // separation has changed from `from`, on a view `height` tall. `separation`
  // and `goals` are what it saw and set last: if something else changes the
  // goals, or the height changes, it carries on from there instead.
  private pinch: {
    from: number; height: number; logFov: number; radius: number; separation: number; goals: [number, number];
  } | null = null;
  private poseFraming: ReturnType<typeof createPoseFraming> | null = null;
  private editorCamera: { position: Vector3; target: Vector3; fov: number } | null = null;
  private readonly frameSize = new Vector2();
  private resizeObserver: ResizeObserver;
  private intersectionObserver: IntersectionObserver | null = null;
  private onScreen = true;
  private pixelRatioQuery: MediaQueryList | null = null;

  constructor(private host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.setClearColor(0, 0);
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Tribes 2 model. Drag or use arrow keys to rotate; right-drag to move; scroll or use plus and minus to zoom. Home resets the view.");
    canvas.addEventListener("keydown", this.handleKey);
    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored);
    canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointercancel", this.handlePointerUp);
    host.appendChild(canvas);
    this.controls = new FrameOrbitControls(this.camera, canvas, this.invalidate);
    this.controls.enableDamping = true;
    this.controls.minPolarAngle = MIN_POLAR_ANGLE;
    this.controls.maxPolarAngle = MAX_POLAR_ANGLE;
    // The viewer zooms itself, with the field of view. Middle-drag orbits too,
    // like model-viewer.
    this.controls.enableZoom = false;
    this.controls.mouseButtons.MIDDLE = MOUSE.ROTATE;
    this.controls.addEventListener("change", this.invalidate);
    // An open hand over the view, and a closed one while dragging.
    this.controls.addEventListener("start", () => { canvas.style.cursor = "grabbing"; });
    this.controls.addEventListener("end", () => { canvas.style.cursor = "grab"; });
    canvas.style.cursor = "grab";
    canvas.style.touchAction = "pan-y";
    this.pmrem = new PMREMGenerator(this.renderer);
    this.defaultEnvironment = this.createDefaultEnvironment();
    this.applyLighting();
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(host);
    // Off screen, nothing is drawn and animations don't advance. At a threshold
    // of 0, a view that only touches the viewport's edge counts as on screen.
    if (typeof IntersectionObserver !== "undefined") {
      this.intersectionObserver = new IntersectionObserver(this.handleIntersection, { threshold: 0.00001 });
      this.intersectionObserver.observe(host);
    }
    document.addEventListener("visibilitychange", this.handleVisibility);
    this.updatePixelRatio();
  }

  /** Whether the camera moved since the last frame. OrbitControls only reports
   * motion of 0.001 world units or more, a few percent of these models. */
  private viewMoved() {
    const epsilon = this.bounds.radius * 1e-5;
    const moved = this.camera.position.distanceToSquared(this.drawnPosition) > epsilon * epsilon
      || this.controls.target.distanceToSquared(this.drawnTarget) > epsilon * epsilon;
    this.drawnPosition.copy(this.camera.position);
    this.drawnTarget.copy(this.controls.target);
    return moved;
  }

  /** Moves the camera's distance and field of view `deltaSeconds` closer to
   * the zoom goals, at the pace of orbit damping. Returns whether they're
   * still moving. */
  private stepZoom(deltaSeconds: number) {
    const k = 1 - Math.exp(-deltaSeconds / CAMERA_SMOOTHING_SECONDS);
    const offset = this.camera.position.clone().sub(this.controls.target);
    let radius = MathUtils.lerp(offset.length(), this.goalRadius, k);
    let logFov = MathUtils.lerp(Math.log(this.camera.fov), this.goalLogFov, k);
    // The rest wouldn't show.
    const settled = Math.abs(this.goalRadius - radius) < this.bounds.radius * 1e-5
      && Math.abs(this.goalLogFov - logFov) < 1e-5;
    if (settled) [radius, logFov] = [this.goalRadius, this.goalLogFov];
    this.camera.position.copy(this.controls.target).add(offset.setLength(radius));
    const fov = Math.exp(logFov);
    if (fov !== this.camera.fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    return !settled;
  }

  invalidate = () => {
    if (this.disposed || document.hidden || this.frameId !== null) return;
    if (this.onScreen || this.drawsOffScreen()) this.frameId = requestAnimationFrame(this.renderFrame);
  };

  /** Whether to keep drawing while the view is off screen. Captures and mocap
   * still need frames while a phone shows the camera panel instead. */
  private drawsOffScreen() {
    return this.captures.length > 0 || this.poseFrames.size > 0 || (this.posing && this.frames.size > 0);
  }

  subscribeFrame = (callback: FrameCallback) => {
    this.frames.add(callback);
    this.invalidate();
    return () => { this.frames.delete(callback); };
  };

  /** Screen-space pose work must use the same final camera as the draw, after
   * orbit damping and automatic framing have updated its projection. */
  subscribePoseFrame = (callback: PoseFrameCallback) => {
    this.poseFrames.add(callback);
    this.invalidate();
    return () => { this.poseFrames.delete(callback); };
  };

  /** While `fade` is set, what's outside the camera image's area is drawn at
   * `OUTSIDE_OPACITY` and `OUTSIDE_BRIGHTNESS`, so the performer can see what
   * a photo booth shot will leave out. Captures copy the frame before it's
   * faded. */
  setFadeOutsideCameraArea(fade: boolean) {
    this.fadeOutside = fade;
    this.invalidate();
  }

  /** Resolves with a copy of the next frame this viewer draws, in device
   * pixels. Pose framing places the model as if the view were cropped to the
   * camera image; with `cameraArea`, only the image's area is copied then.
   * Pixels outside the model stay transparent, and with `background: false`
   * so does a visible environment. The drawing buffer is not preserved, so the
   * copy is made right after the draw and the promise settles in the same
   * task: code awaiting it runs before another frame can move a bone.
   * Captures of one area settled by one draw share a canvas; don't draw on it. */
  captureFrame({ background = true, cameraArea = false }: { background?: boolean; cameraArea?: boolean } = {}): Promise<HTMLCanvasElement> {
    if (this.disposed) return Promise.reject(new Error("The 3D view has closed."));
    if (this.contextLost) return Promise.reject(new Error("The 3D view lost its graphics context."));
    return new Promise((resolve, reject) => {
      this.captures.push({ background, cameraArea, resolve, reject });
      this.invalidate();
    });
  }

  /** Settles the pending captures, or with `withoutBackground` only those
   * that leave the background out, from what was just drawn. */
  private copyFrame(cameraArea: VideoRect | null, withoutBackground = false) {
    const captures = this.captures.filter((capture) => !withoutBackground || !capture.background);
    this.captures = this.captures.filter((capture) => !captures.includes(capture));
    const copies = new Map<VideoRect | null, HTMLCanvasElement | Error>();
    for (const capture of captures) {
      const area = capture.cameraArea ? cameraArea : null;
      const copy = copies.get(area) ?? this.copyArea(area);
      copies.set(area, copy);
      if (copy instanceof Error) capture.reject(copy);
      else capture.resolve(copy);
    }
  }

  /** A copy of `area`, in CSS pixels, of what was just drawn, or of all of it. */
  private copyArea(area: VideoRect | null): HTMLCanvasElement | Error {
    try {
      const source = this.renderer.domElement;
      const box = area
        ? pixelBox(area, this.renderer.getPixelRatio(), source.width, source.height)
        : { x: 0, y: 0, width: source.width, height: source.height };
      if (!box.width || !box.height) throw new Error("The 3D view has no visible area.");
      const frame = document.createElement("canvas");
      frame.width = box.width;
      frame.height = box.height;
      const context = frame.getContext("2d");
      if (!context) throw new Error("The 3D view could not be copied.");
      context.drawImage(source, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
      return frame;
    } catch (error) {
      return error instanceof Error ? error : new Error("The 3D view could not be copied.");
    }
  }

  private rejectCaptures(error: Error) {
    this.captures.splice(0).forEach(({ reject }) => reject(error));
  }

  private renderFrame = (time: number) => {
    this.frameId = null;
    if (this.disposed || document.hidden) return;
    const delta = this.previousTime === null ? 0 : Math.min((time - this.previousTime) / 1000, 0.1);
    this.previousTime = time;
    // A clip played once pauses itself on its last frame.
    const playing = !!this.action && !this.action.paused && !this.paused && !this.posing;
    if (playing) this.mixer?.update(delta * this.playbackSpeed);
    this.frames.forEach((callback) => callback(delta));
    this.controls.step(delta || 1 / 60);
    const zooming = this.stepZoom(delta || 1 / 60);
    const moving = this.viewMoved();
    const camera = this.posing ? this.poseFraming?.update(this.camera, delta) : null;
    const imageAspect = this.poseFraming?.imageAspect;
    const renderCamera = camera ?? this.camera;
    this.poseFrames.forEach((callback) => callback(delta, renderCamera, imageAspect ?? renderCamera.aspect));
    // Pose framing places the model as if the view were cropped to the camera
    // image, contained like the preview's, but the whole view is drawn.
    const { x: width, y: height } = this.renderer.getSize(this.frameSize);
    const cameraArea = camera && imageAspect ? containedVideoRect(width, height, imageAspect, 1) : null;
    const background = this.scene.background;
    if (background && this.captures.some((capture) => !capture.background)) {
      // Captures without the background need a draw of their own. Only the
      // last draw in a frame reaches the screen.
      this.scene.background = null;
      try {
        this.renderer.render(this.scene, renderCamera);
        this.copyFrame(cameraArea, true);
      } finally {
        this.scene.background = background;
      }
    }
    this.renderer.render(this.scene, renderCamera);
    // The drawing buffer is not preserved, so copy it before this task ends.
    if (this.captures.length) this.copyFrame(cameraArea);
    const fading = this.drawOutsideFade(cameraArea, delta);
    if (playing || moving || zooming || this.controls.dragging || fading || this.frames.size || this.poseFrames.size) this.invalidate();
    // Time doesn't pass while no frames are drawn, like off screen, so
    // animations continue from where they stopped.
    if (this.frameId === null) this.previousTime = null;
  };

  /** Moves the fade outside the camera area `delta` seconds closer to whether
   * it's wanted, and draws it over the frame. Returns whether it's still
   * moving. */
  private drawOutsideFade(cameraArea: VideoRect | null, delta: number) {
    const target = this.fadeOutside ? 1 : 0;
    const step = this.reducedMotion?.matches ? 1 : delta / OUTSIDE_FADE_SECONDS;
    this.outsideFade = target ? Math.min(1, this.outsideFade + step) : Math.max(0, this.outsideFade - step);
    if (this.outsideFade && cameraArea) {
      const canvas = this.renderer.domElement;
      // The same pixels a capture of the camera area copies.
      const box = pixelBox(cameraArea, this.renderer.getPixelRatio(), canvas.width, canvas.height);
      const { uniforms } = this.outsideFadeQuad.material as ShaderMaterial;
      uniforms.box.value.set(box.x, canvas.height - box.y - box.height, box.x + box.width, canvas.height - box.y);
      uniforms.opacity.value = MathUtils.lerp(1, OUTSIDE_OPACITY, this.outsideFade);
      uniforms.brightness.value = MathUtils.lerp(1, OUTSIDE_BRIGHTNESS, this.outsideFade);
      // Rendering clears the frame first unless told not to.
      const autoClear = this.renderer.autoClear;
      this.renderer.autoClear = false;
      try {
        this.outsideFadeQuad.render(this.renderer);
      } finally {
        this.renderer.autoClear = autoClear;
      }
    }
    return this.outsideFade !== target;
  }

  // ResizeObserver doesn't fire when only the device pixel ratio changes, like
  // when moving the window to another display or zooming the page.
  private updatePixelRatio = () => {
    if (this.disposed) return;
    this.pixelRatioQuery?.removeEventListener("change", this.updatePixelRatio);
    this.pixelRatioQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null;
    this.pixelRatioQuery?.addEventListener("change", this.updatePixelRatio);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.resize();
  };

  private resize = () => {
    if (this.disposed) return;
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    // The zoom stays, like model-viewer's: the field of view changes as much as
    // the one the model is framed for.
    const framed = this.adjustedFov(this.baseFov);
    this.camera.aspect = width / height;
    const scale = this.adjustedFov(this.baseFov) / framed;
    this.camera.fov = this.clampFov(this.camera.fov * scale);
    this.camera.updateProjectionMatrix();
    this.goalLogFov = Math.log(this.camera.fov);
    // So does the editor's view, restored after posing.
    if (this.editorCamera) this.editorCamera.fov = this.clampFov(this.editorCamera.fov * scale);
    this.invalidate();
  };

  /** `fov` widened as much as the view is narrower than the model needs, like
   * model-viewer's, so the model still fits from any side. */
  private adjustedFov(fov: number) {
    return 2 * Math.atan(Math.tan(fov * Math.PI / 360) * Math.max(1, this.idealAspect / this.camera.aspect)) * 180 / Math.PI;
  }

  private clampFov(fov: number) {
    return MathUtils.clamp(fov, MIN_FOV, this.adjustedFov(MAX_FOV));
  }

  /** Shows the model at `url`, with the models at `mounts` mounted on its
   * nodes, like the tank's turret. */
  async load(url: string, camera: CameraOptions, mounts: { url: string; node: string }[] = []): Promise<LoadedModel | null> {
    const generation = ++this.modelGeneration;
    const loader = new GLTFLoader();
    const results = await Promise.allSettled([url, ...mounts.map((mount) => mount.url)].map((source) => loader.loadAsync(source)));
    const failure = results.find((result) => result.status === "rejected");
    const [gltf, ...parts] = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (failure || this.disposed || generation !== this.modelGeneration) {
      [gltf, ...parts].forEach((loaded) => { if (loaded) disposeObject(loaded.scene); });
      if (failure) throw failure.reason;
      return null;
    }
    this.clearModel();
    this.model = gltf;
    // Like the game, a mount on a node the model doesn't have is at its origin.
    const mounted = parts.map((part, index) => ({
      scene: mountPart(findOwnNode(gltf.scene, mounts[index].node) ?? gltf.scene, part.scene),
      materials: collectMaterials(part),
    }));
    gltf.animations = withMountedClips(gltf.animations, parts);
    this.prepareMeshes(gltf.scene, this.originalTextures);
    this.scene.add(gltf.scene);
    this.rig = this.poseRuntime?.createPlayerRig(gltf.scene) ?? null;
    this.mixer = new AnimationMixer(gltf.scene);
    this.cameraOptions = camera;
    gltf.scene.updateMatrixWorld(true);
    this.fitModel();
    this.applyRenderMode();
    return { scene: gltf.scene, model: { materials: collectMaterials(gltf) }, mounts: mounted, rig: this.rig };
  }

  cancelLoad() { this.modelGeneration++; }

  /** Adds the textures `root`'s materials came with to `textures`, and keeps
   * its skinned meshes from being culled: both recorded and live poses can
   * leave the exported bounds behind. */
  private prepareMeshes(root: Object3D, textures: Set<Texture>) {
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      if (object instanceof SkinnedMesh) object.frustumCulled = false;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
      }
    });
  }

  /** Loads the model at `url` and mounts it on the shown model's `node`, like
   * a weapon in a player's hand. Resolves null if the shown model changes
   * first or doesn't have that node. */
  async mount(url: string, node: string): Promise<MountedModel | null> {
    const model = this.model;
    const gltf = await new GLTFLoader().loadAsync(url);
    const target = !this.disposed && model && model === this.model ? findOwnNode(model.scene, node) : null;
    if (!target) {
      disposeObject(gltf.scene);
      return null;
    }
    const textures = new Set<Texture>();
    this.prepareMeshes(gltf.scene, textures);
    const scene = mountPart(target, gltf.scene);
    // Showing another model disposes these with it.
    textures.forEach((texture) => this.originalTextures.add(texture));
    scene.userData.originalTextures = textures;
    this.applyRenderMode();
    return { scene, materials: collectMaterials(gltf) };
  }

  /** Takes off and disposes a model from mount(). */
  unmount({ scene }: MountedModel) {
    scene.removeFromParent();
    scene.traverse((object) => {
      const geometries = object instanceof Mesh && this.randomColorGeometries.get(object);
      if (!geometries) return;
      object.geometry = geometries.original;
      geometries.random.dispose();
      this.randomColorGeometries.delete(object);
    });
    const textures: Set<Texture> = scene.userData.originalTextures ?? new Set();
    textures.forEach((texture) => this.originalTextures.delete(texture));
    disposeObject(scene, textures);
    this.invalidate();
  }

  /** Supplied only after the camera feature is requested. Rest transforms must
   * be recovered before binding when an ordinary animation is already active. */
  setPoseRuntime(runtime: PoseRuntime): PlayerRig | null {
    if (this.disposed || this.poseRuntime === runtime) return this.rig;
    this.poseRuntime = runtime;
    this.poseFraming = null;
    this.rig?.dispose();
    this.rig = null;
    if (!this.model) return null;
    const action = this.action;
    const time = action?.time ?? 0;
    const scheduled = action?.isScheduled() ?? false;
    this.mixer?.stopAllAction();
    try {
      this.rig = runtime.createPlayerRig(this.model.scene);
    } finally {
      this.playArmPose();
      if (action && scheduled && !this.posing) this.resumeAction(action, time);
      else if (!this.posing) this.mixer?.update(0);
    }
    this.invalidate();
    return this.rig;
  }

  /** Plays `action` again from `time`, and poses the model for it. */
  private resumeAction(action: AnimationAction, time: number) {
    action.play();
    action.time = time;
    this.mixer?.update(0);
  }

  private clearModel() {
    this.poseFraming = null;
    this.editorCamera = null;
    if (!this.model) return;
    this.rig?.dispose();
    this.rig = null;
    this.action = null;
    this.armAction = null;
    this.mixer?.stopAllAction();
    this.mixer?.uncacheRoot(this.model.scene);
    this.mixer = null;
    this.scene.remove(this.model.scene);
    this.randomColorGeometries.forEach(({ original, random }, mesh) => {
      mesh.geometry = original;
      random.dispose();
    });
    this.randomColorGeometries.clear();
    disposeObject(this.model.scene, this.originalTextures);
    this.originalTextures.clear();
    this.model = null;
  }

  private fitModel() {
    if (!this.model) return;
    const box = new Box3().setFromObject(this.model.scene, true);
    if (box.isEmpty()) return;
    box.getBoundingSphere(this.bounds);
    this.baseFov = this.cameraOptions.fov == null ? FRAMING_FOV : Number.parseFloat(this.cameraOptions.fov);
    const target = this.cameraOptions.target?.split(/\s+/).map(Number.parseFloat);
    if (target?.length === 3 && target.every(Number.isFinite)) this.bounds.center.fromArray(target);
    let radius = 0.00001;
    this.forEachVertex((v) => { radius = Math.max(radius, v.length()); });
    this.bounds.radius = radius;
    const halfFov = FRAMING_FOV * Math.PI / 360;
    const idealDistance = radius / Math.sin(halfFov);
    let tanFov = 0;
    this.forEachVertex((v) => {
      tanFov = Math.max(tanFov, Math.hypot(v.x, v.z) / Math.max(idealDistance - Math.abs(v.y), 0.00001));
    });
    this.idealAspect = tanFov / Math.tan(halfFov);
    const distance = idealDistance * Number.parseFloat(this.cameraOptions.orbit?.split(/\s+/)[2] ?? "105%") / 100;
    // Zooming out stops at model-viewer's default maximum orbit radius, 105%
    // of the framing distance. As there, the zoom limits also limit where the
    // camera starts.
    this.minRadius = radius * MIN_RADIUS_RATIO;
    this.maxRadius = idealDistance * 1.05;
    this.initialDistance = MathUtils.clamp(distance, this.minRadius, this.maxRadius);
    this.camera.near = this.bounds.radius / 100;
    this.camera.far = this.bounds.radius * 100;
    // Panning can move the orbit target anywhere within the model's bounds.
    this.controls.cursor.copy(this.bounds.center);
    this.controls.maxTargetRadius = this.bounds.radius;
    this.resetCamera();
    this.resize();
  }

  /** Calls `callback` with each vertex position relative to the bounds center.
   * The vector is reused between calls. */
  private forEachVertex(callback: (vertex: Vector3) => void) {
    const vertex = new Vector3();
    this.model?.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const count = object.geometry.attributes.position?.count ?? 0;
      for (let i = 0; i < count; i++) {
        callback(object.getVertexPosition(i, vertex).applyMatrix4(object.matrixWorld).sub(this.bounds.center));
      }
    });
  }

  resetCamera() {
    const [theta, phi] = (this.cameraOptions.orbit ?? "0deg 75deg 105%").split(/\s+/).map(Number.parseFloat);
    const orbit = new Spherical(this.initialDistance, phi * Math.PI / 180, theta * Math.PI / 180);
    const position = new Vector3().setFromSpherical(orbit).add(this.bounds.center);
    this.placeCamera(this.bounds.center, position, this.clampFov(this.adjustedFov(this.baseFov)));
    if (this.posing) this.startPoseCamera();
    this.invalidate();
  }

  /** Replaces the view. Pending orbit damping is drained first, so an old drag
   * cannot tilt the new view, and the new view is the zoom goal, so nothing
   * eases it elsewhere. */
  private placeCamera(target: Vector3, position: Vector3, fov = this.camera.fov) {
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = damping;
    this.controls.target.copy(target);
    this.camera.position.copy(position);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    // controls.update() doesn't turn the camera during a damped drag.
    this.camera.lookAt(target);
    this.controls.update();
    this.camera.updateWorldMatrix(true, false);
    this.goalRadius = this.camera.position.distanceTo(this.controls.target);
    this.goalLogFov = Math.log(this.camera.fov);
  }

  /** Zooms out by `deltaZoom`, or in when it's negative, exactly like
   * model-viewer: the log of the field of view changes by `deltaZoom`, and the
   * distance keeps pace so that both reach their limits together. */
  private adjustZoom(deltaZoom: number) {
    [this.goalLogFov, this.goalRadius] = this.zoomed(this.goalLogFov, this.goalRadius, deltaZoom);
    this.invalidate();
  }

  /** The log field of view and distance `deltaZoom` from these, as above. */
  private zoomed(logFov: number, radius: number, deltaZoom: number): [number, number] {
    const minLogFov = Math.log(MIN_FOV);
    const maxLogFov = Math.log(this.adjustedFov(MAX_FOV));
    const out = deltaZoom > 0;
    const ratio = ((out ? this.maxRadius : this.minRadius) - radius) / ((out ? maxLogFov : minLogFov) - logFov);
    return [
      MathUtils.clamp(logFov + deltaZoom, minLogFov, maxLogFov),
      MathUtils.clamp(radius + deltaZoom * (Number.isFinite(ratio) ? ratio : (this.maxRadius - this.minRadius) * 2), this.minRadius, this.maxRadius),
    ];
  }

  private startPoseCamera() {
    if (!this.model) return;
    const target = this.controls.target.clone();
    const distance = this.camera.position.distanceTo(target);
    this.editorCamera = { position: this.camera.position.clone(), target, fov: this.camera.fov };
    // Detector coordinates describe a straight-on camera. The editor's usual
    // elevated orbit would turn head/body yaw into apparent sideways tilt.
    this.placeCamera(target, target.clone().add(new Vector3(0, 0, distance)));
  }

  private restoreEditorCamera() {
    if (!this.editorCamera) return;
    this.placeCamera(this.editorCamera.target, this.editorCamera.position, this.editorCamera.fov);
    this.editorCamera = null;
  }

  /** Receive mirrored image landmarks. Empty input holds the last reliable
   * framing while the rig independently handles tracking loss. */
  setPoseFraming(landmarks: readonly PoseLandmark[], imageWidth?: number, imageHeight?: number) {
    if (!this.posing || !this.model || !this.rig || !this.poseRuntime) return;
    this.poseFraming ??= this.poseRuntime.createPoseFraming(this.model.scene);
    this.poseFraming.setInput(landmarks, imageWidth, imageHeight);
    this.invalidate();
  }

  resetPoseFraming() {
    this.poseFraming?.reset();
    this.invalidate();
  }

  /** With no animation chosen, `playFirstClip` plays the model's first clip,
   * as model-viewer did for weapons and vehicles, but only once, holding its
   * last frame. */
  setAnimation(name: string | null, paused: boolean, speed: number, playFirstClip = false) {
    const animations = this.model?.animations ?? [];
    const once = name === null && playFirstClip;
    const clip = once ? animations[0] : animations.find((animation) => animation.name === name);
    const previous = this.action;
    // Calls for the same clip, like pausing or changing speed, don't restart it.
    if (previous?.getClip() !== clip) {
      const next = clip && this.mixer ? this.mixer.clipAction(clip) : null;
      next?.setLoop(once ? LoopOnce : LoopRepeat, Infinity);
      if (next) next.clampWhenFinished = once;
      if (next && previous && !paused && !this.posing) {
        // From its start, and enabled again if it blended out before.
        next.reset().play();
        next.crossFadeFrom(previous, ANIMATION_CROSSFADE_SECONDS, false);
      } else {
        // Paused, posing or with nothing to blend from, the new animation
        // starts at its first frame (and waits while posing).
        this.mixer?.stopAllAction();
        if (next && !this.posing) next.play();
        this.playArmPose();
      }
      this.action = next;
      this.poseAnimationTime = 0;
    }
    this.paused = paused;
    this.playbackSpeed = speed;
    if (!this.posing) this.mixer?.update(0);
    this.invalidate();
  }

  /** Poses the arms with `clip`, a held weapon's arm pose from armPoseClip,
   * on top of the animation, or stops. Posing with the camera moves the arms
   * itself, so it's left out then. */
  setArmPose(clip: AnimationClip | null) {
    if (this.armAction?.getClip() === clip) return;
    if (this.armAction) {
      this.armAction.stop();
      this.mixer?.uncacheAction(this.armAction.getClip());
    }
    this.armAction = clip && this.mixer ? this.mixer.clipAction(clip) : null;
    this.playArmPose();
    if (!this.posing) this.mixer?.update(0);
    this.invalidate();
  }

  private playArmPose() {
    if (!this.armAction || this.posing) return;
    this.armAction.play();
    this.armAction.paused = true;
  }

  setPoseMode(posing: boolean) {
    if (this.posing === posing) return;
    this.posing = posing;
    // Pose framing lines the model up with the webcam image and would undo any pan.
    this.controls.enablePan = !posing;
    // With pan and zoom both off, OrbitControls would turn the camera with two
    // fingers, toward their midpoint. The viewer's pinch zoom is all they do then.
    this.controls.touches = { ONE: TOUCH.ROTATE, TWO: posing ? null : TOUCH.DOLLY_PAN };
    this.resetPoseFraming();
    if (posing) {
      this.startPoseCamera();
      this.poseAnimationTime = this.action?.time ?? 0;
      // Also stops an animation that's still blending out.
      this.mixer?.stopAllAction();
      this.rig?.reset();
    } else {
      this.restoreEditorCamera();
      this.rig?.reset();
      this.playArmPose();
      if (this.action) this.resumeAction(this.action, this.poseAnimationTime);
      else this.mixer?.update(0);
    }
    this.controls.update();
    this.invalidate();
  }

  setRenderMode(mode: RenderMode) {
    this.renderMode = mode;
    this.applyRenderMode();
  }

  private applyRenderMode() {
    const random = this.renderMode === "random";
    let seed = 0;
    this.model?.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      // Separate meshes start at different hues.
      seed = (seed + 0.37) % 1;
      let geometries = this.randomColorGeometries.get(object);
      if (random && !geometries) {
        geometries = { original: object.geometry, random: randomColorGeometry(object.geometry, seed) };
        this.randomColorGeometries.set(object, geometries);
      }
      if (geometries) object.geometry = random ? geometries.random : geometries.original;
    });
    this.scene.overrideMaterial = random ? this.randomColorMaterial
      : this.renderMode === "wireframe" ? this.wireframeMaterial : null;
    this.invalidate();
  }

  setExposure(exposure: number) {
    this.renderer.toneMappingExposure = exposure;
    this.invalidate();
  }

  async setEnvironment(url: string | null) {
    const generation = ++this.environmentGeneration;
    let texture: Texture | null = null;
    if (url) {
      texture = await new RGBELoader().loadAsync(url);
      if (this.disposed || generation !== this.environmentGeneration) { texture.dispose(); return; }
      texture.mapping = EquirectangularReflectionMapping;
    }
    this.background?.dispose();
    this.background = texture;
    this.applyLighting();
    this.updateBackground();
  }

  /** Lights the model with the HDR background, or the default environment
   * without one. */
  private applyLighting() {
    const environment = this.background ? this.pmrem.fromEquirectangular(this.background) : null;
    this.environment?.dispose();
    this.environment = environment;
    this.scene.environment = (environment ?? this.defaultEnvironment).texture;
  }

  setBackgroundVisible(show: boolean) {
    this.showBackground = show;
    this.updateBackground();
  }

  private updateBackground() {
    this.scene.background = this.showBackground ? this.background : null;
    // Keep the camera above the ground of a visible environment.
    this.controls.maxPolarAngle = this.scene.background ? Math.PI / 2 : MAX_POLAR_ANGLE;
    this.invalidate();
  }

  private handleVisibility = () => {
    if (document.hidden && this.frameId !== null) { cancelAnimationFrame(this.frameId); this.frameId = null; }
    this.previousTime = null;
    this.invalidate();
  };

  private handleIntersection = (entries: IntersectionObserverEntry[]) => {
    // The last entry is the latest.
    for (const entry of entries) this.onScreen = entry.isIntersecting;
    this.invalidate();
  };

  private handleContextLost = (event: Event) => {
    event.preventDefault();
    // Frames drawn without a context are blank.
    this.contextLost = true;
    this.rejectCaptures(new Error("The 3D view lost its graphics context."));
  };

  private createDefaultEnvironment() {
    const neutral = new NeutralEnvironment();
    try {
      return this.pmrem.fromScene(neutral, 0.04, 0.1, 100);
    } finally {
      disposeObject(neutral);
    }
  }

  private rebuildEnvironment() {
    if (this.disposed) return;
    // Render targets lose their pixels with the GL context; source textures
    // are retained so lighting can be rebuilt without another download.
    this.defaultEnvironment.dispose();
    this.defaultEnvironment = this.createDefaultEnvironment();
    this.applyLighting();
    this.invalidate();
  }

  private handleContextRestored = () => {
    this.contextLost = false;
    this.rebuildEnvironment();
  };

  private handleKey = (event: KeyboardEvent) => {
    const orbit = new Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    switch (event.key) {
      // Each arrow turns the model the way it points, like a drag that way.
      case "ArrowLeft": orbit.theta += 0.1; break;
      case "ArrowRight": orbit.theta -= 0.1; break;
      case "ArrowUp": orbit.phi += 0.1; break;
      case "ArrowDown": orbit.phi -= 0.1; break;
      case "+": case "=": this.adjustZoom(-0.1); event.preventDefault(); return;
      case "-": this.adjustZoom(0.1); event.preventDefault(); return;
      case "Home": this.resetCamera(); event.preventDefault(); return;
      default: return;
    }
    event.preventDefault();
    orbit.phi = Math.max(this.controls.minPolarAngle, Math.min(this.controls.maxPolarAngle, orbit.phi));
    this.camera.position.setFromSpherical(orbit).add(this.controls.target);
    this.controls.update();
    this.invalidate();
  };

  private handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    // A line counts as 18 pixels, like model-viewer.
    this.adjustZoom(event.deltaY * (event.deltaMode === 1 ? 18 : 1) * ZOOM_SENSITIVITY / 30);
  };

  private handlePointerDown = (event: PointerEvent) => {
    const point = new Vector2(event.clientX, event.clientY);
    if (event.pointerType === "touch") {
      this.touches.set(event.pointerId, point);
      this.applyPinch();
      if (this.touches.size === 2) this.startPan(this.touches);
      return;
    }
    // Like OrbitControls: the right button pans, and so do the others with
    // Ctrl, Meta or Shift held, instead of rotating.
    const { LEFT, MIDDLE, RIGHT } = this.controls.mouseButtons;
    const action = [LEFT, MIDDLE, RIGHT][event.button];
    const pans = event.ctrlKey || event.metaKey || event.shiftKey ? action === MOUSE.ROTATE : action === MOUSE.PAN;
    this.panPointer = pans ? event.pointerId : null;
    this.startPan(new Map([[event.pointerId, point]]));
  };

  private handlePointerMove = (event: PointerEvent) => {
    // Like model-viewer's taps, a click or tap moves 2 pixels at most.
    const start = this.panStarts.get(event.pointerId);
    if (start && Math.max(Math.abs(event.clientX - start.x), Math.abs(event.clientY - start.y)) > 2) this.panMoved = true;
    const touch = this.touches.get(event.pointerId);
    if (!touch) return;
    touch.set(event.clientX, event.clientY);
    this.applyPinch();
  };

  private handlePointerUp = (event: PointerEvent) => {
    // Two fingers pan as well as pinch, until one of them lifts.
    const twoFingers = this.touches.size === 2;
    if (this.touches.delete(event.pointerId)) {
      // The two fingers left may not be the ones the pinch started with.
      this.pinch = null;
      this.applyPinch();
      if (twoFingers && this.panMoved) this.pivotOnSurface();
    } else if (event.pointerId === this.panPointer) {
      this.panPointer = null;
      if (this.panMoved) this.pivotOnSurface();
    }
  };

  /** model-viewer's pinch zoom, but from where the pinch started rather than
   * step by step. A step in and one back out don't cancel, and browsers send
   * each finger's move on its own, so during a two-finger pan the fingers'
   * separation dips and comes back between them: the camera crept closer. */
  private applyPinch() {
    if (this.touches.size !== 2) return;
    const separation = this.touchSeparation();
    const height = this.renderer.domElement.clientHeight;
    if (!height) return;
    const goals: [number, number] = [this.goalLogFov, this.goalRadius];
    let { pinch } = this;
    if (!pinch || pinch.height !== height || pinch.goals.some((goal, index) => goal !== goals[index])) {
      const from = pinch?.separation ?? separation;
      pinch = this.pinch = { from, height, logFov: goals[0], radius: goals[1], separation: from, goals };
    }
    if (separation === pinch.separation) return;
    const deltaZoom = ZOOM_SENSITIVITY * (pinch.from - separation) * 50 / height;
    const next = this.zoomed(pinch.logFov, pinch.radius, deltaZoom);
    [this.goalLogFov, this.goalRadius] = next;
    pinch.separation = separation;
    pinch.goals = next;
    // Past a limit, zooming back starts from it, as it would step by step.
    if (next[0] !== pinch.logFov + deltaZoom) {
      pinch.from = separation;
      [pinch.logFov, pinch.radius] = next;
    }
    this.invalidate();
  }

  private startPan(points: Map<number, Vector2>) {
    this.panStarts.clear();
    points.forEach((point, id) => this.panStarts.set(id, point.clone()));
    this.panMoved = false;
  }

  /** How far apart the first two touches are. */
  private touchSeparation() {
    const [first, second] = Array.from(this.touches.values());
    return second ? first.distanceTo(second) : 0;
  }

  /** After a pan, moves the orbit target along the line through the middle of
   * the view onto the model's surface, like model-viewer, so the next drag
   * turns around what's there. The camera stays where it is, unless that's
   * beyond the zoom limits: then it eases back within them. */
  private pivotOnSurface() {
    if (this.posing) return;
    const hit = this.surfaceAtViewCenter();
    if (!hit) return;
    const { target } = this.controls;
    const toCamera = this.camera.position.clone().sub(target).normalize();
    const shift = toCamera.dot(hit.sub(target));
    const pivot = target.clone().addScaledVector(toCamera, shift);
    // OrbitControls would pull a target outside the pan limit back in, and
    // the camera with it.
    if (pivot.distanceTo(this.controls.cursor) > this.controls.maxTargetRadius) return;
    target.copy(pivot);
    // The camera is that much closer to the target now, and goes on to where
    // zooming was taking it, within the zoom limits.
    this.goalRadius = MathUtils.clamp(this.goalRadius - shift, this.minRadius, this.maxRadius);
    this.invalidate();
  }

  /** Where the line through the middle of the view first meets the visible
   * model, if it does. */
  private surfaceAtViewCenter() {
    if (!this.model) return null;
    // three keeps the bounds a skinned mesh had on its first raycast, so it
    // would miss one that has moved since.
    this.model.scene.traverse((object) => {
      if (object instanceof SkinnedMesh) object.computeBoundingSphere();
    });
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(new Vector2(), this.camera);
    const hit = this.raycaster.intersectObject(this.model.scene).find(({ object, face }) => {
      const { material } = object as Mesh;
      if (!(Array.isArray(material) ? material[face?.materialIndex ?? 0] : material)?.visible) return false;
      for (let node: Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
      return true;
    });
    return hit?.point ?? null;
  }

  dispose() {
    this.disposed = true;
    this.rejectCaptures(new Error("The 3D view has closed."));
    this.modelGeneration++;
    this.environmentGeneration++;
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frames.clear();
    this.poseFrames.clear();
    this.resizeObserver.disconnect();
    this.intersectionObserver?.disconnect();
    this.pixelRatioQuery?.removeEventListener("change", this.updatePixelRatio);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.controls.dispose();
    this.clearModel();
    this.randomColorMaterial.dispose();
    this.wireframeMaterial.dispose();
    this.environment?.dispose();
    this.background?.dispose();
    this.defaultEnvironment.dispose();
    this.pmrem.dispose();
    this.outsideFadeQuad.material.dispose();
    this.outsideFadeQuad.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("keydown", this.handleKey);
    canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    canvas.removeEventListener("wheel", this.handleWheel);
    canvas.removeEventListener("pointerdown", this.handlePointerDown);
    canvas.removeEventListener("pointermove", this.handlePointerMove);
    canvas.removeEventListener("pointerup", this.handlePointerUp);
    canvas.removeEventListener("pointercancel", this.handlePointerUp);
    this.renderer.dispose();
    // Release the WebGL context now instead of waiting for garbage collection;
    // browsers limit how many can be active.
    this.renderer.forceContextLoss();
    canvas.remove();
  }
}
