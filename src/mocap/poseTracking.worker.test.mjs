import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { URL } from "node:url";
import { DEFAULT_POSE_SETTINGS } from "./poseSettings";

const mocks = vi.hoisted(() => ({
  api: null, fileset: vi.fn(), bodyCreate: vi.fn(), handCreate: vi.fn(), faceCreate: vi.fn(),
}));
vi.mock("comlink", () => ({ expose: (api) => { mocks.api = api; } }));
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: mocks.fileset },
  PoseLandmarker: { createFromOptions: mocks.bodyCreate },
  HandLandmarker: { createFromOptions: mocks.handCreate },
  FaceDetector: { createFromOptions: mocks.faceCreate },
}));

const assets = {
  wasmUrl: "/mocap/wasm", modelUrl: "/mocap/pose.task",
  handModelUrl: "/mocap/hand.task",
};
const originalFetch = globalThis.fetch;
let body, hands, face, pose, handResult;

function bitmap() { return { width: 640, height: 480, close: vi.fn() }; }

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("self", { location: new URL("https://example.test/worker.js") });
  vi.stubGlobal("OffscreenCanvas", class {});
  globalThis.fetch = originalFetch;
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  landmarks[15] = { x: 0.7, y: 0.4, z: 0, visibility: 1 };
  landmarks[16] = { x: 0.3, y: 0.4, z: 0, visibility: 1 };
  pose = { landmarks, worldLandmarks: landmarks.map((point) => ({ ...point })), timestamp: 100 };
  handResult = {
    landmarks: [Array.from({ length: 21 }, (_, index) => ({ x: 0.7 + index * 0.001, y: 0.4, z: 0 }))],
    worldLandmarks: [Array.from({ length: 21 }, (_, index) => ({ x: index * 0.005, y: 0.01, z: 0 }))],
  };
  body = {
    detectForVideo: vi.fn(() => ({ landmarks: [pose.landmarks], worldLandmarks: [pose.worldLandmarks] })),
    close: vi.fn(),
  };
  hands = { detectForVideo: vi.fn(() => handResult), close: vi.fn() };
  face = {
    detectForVideo: vi.fn(() => ({ detections: [{
      categories: [{ score: 0.95 }],
      boundingBox: { originX: 160, originY: 90, width: 320, height: 300 },
      keypoints: [[0.4, 0.4], [0.6, 0.4], [0.5, 0.5], [0.5, 0.6], [0.3, 0.45], [0.7, 0.45]]
        .map(([x, y]) => ({ x, y })),
    }] })), close: vi.fn(),
  };
  mocks.fileset.mockResolvedValue({ wasmLoaderPath: "local.js", wasmBinaryPath: "local.wasm" });
  mocks.bodyCreate.mockResolvedValue(body);
  mocks.handCreate.mockResolvedValue(hands);
  mocks.faceCreate.mockResolvedValue(face);
  await import("./poseTracking.worker");
});

afterEach(() => {
  mocks.api.close();
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
});

test("body tracking runs detailed hands on the same bitmap and capture time", async () => {
  const initialized = await mocks.api.initialize(assets, { ...DEFAULT_POSE_SETTINGS, handTracking: true });
  expect(initialized).toEqual({ delegate: "GPU", handDelegate: "GPU", handWarning: null });
  expect(mocks.bodyCreate.mock.calls[0][1]).toMatchObject({
    baseOptions: { modelAssetPath: assets.modelUrl, delegate: "GPU" },
    runningMode: "VIDEO", numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  expect(mocks.handCreate.mock.calls[0][1]).toMatchObject({
    baseOptions: { modelAssetPath: assets.handModelUrl, delegate: "GPU" },
    runningMode: "VIDEO", numHands: 2,
  });
  const input = bitmap();
  const result = await mocks.api.detect(input, 123);
  expect(body.detectForVideo).toHaveBeenCalledExactlyOnceWith(input, 123);
  expect(hands.detectForVideo).toHaveBeenCalledExactlyOnceWith(input, 123);
  expect(body.detectForVideo.mock.invocationCallOrder[0]).toBeLessThan(hands.detectForVideo.mock.invocationCallOrder[0]);
  expect(result.hands).toEqual([{
    side: "left", confidence: 1,
    landmarks: handResult.landmarks[0], worldLandmarks: handResult.worldLandmarks[0],
  }]);
  expect(result).toMatchObject({ imageWidth: 640, imageHeight: 480 });
  expect(input.close).toHaveBeenCalledOnce();
});

test("disabled hands do not initialize or infer the extra model", async () => {
  await mocks.api.initialize(assets, { ...DEFAULT_POSE_SETTINGS, handTracking: false });
  expect(mocks.handCreate).not.toHaveBeenCalled();
  const result = await mocks.api.detect(bitmap(), 123);
  expect(result.hands).toBeUndefined();
  expect(hands.detectForVideo).not.toHaveBeenCalled();
});

test("hand GPU failure falls back to CPU independently of body tracking", async () => {
  mocks.handCreate.mockRejectedValueOnce(new Error("No GPU"));
  const result = await mocks.api.initialize(assets, { ...DEFAULT_POSE_SETTINGS, handTracking: true });
  expect(result).toEqual({ delegate: "GPU", handDelegate: "CPU", handWarning: null });
  expect(mocks.handCreate.mock.calls.map(([, options]) => options.baseOptions.delegate)).toEqual(["GPU", "CPU"]);
  expect(mocks.bodyCreate).toHaveBeenCalledOnce();
});

test("body CPU fallback does not prevent GPU hand tracking", async () => {
  mocks.bodyCreate.mockRejectedValueOnce(new Error("Body GPU unavailable"));
  const initialized = await mocks.api.initialize(assets, { ...DEFAULT_POSE_SETTINGS, handTracking: true });
  expect(initialized).toEqual({ delegate: "CPU", handDelegate: "GPU", handWarning: null });
  expect(mocks.bodyCreate.mock.calls.map(([, options]) => options.baseOptions)).toEqual([
    { modelAssetPath: assets.modelUrl, delegate: "GPU" },
    { modelAssetPath: assets.modelUrl, delegate: "CPU" },
  ]);
  expect(mocks.handCreate).toHaveBeenCalledOnce();
  expect((await mocks.api.detect(bitmap(), 123)).hands).toHaveLength(1);
});

test("hand initialization failure reports a warning and preserves body tracking", async () => {
  mocks.handCreate.mockRejectedValue(new Error("Hand model unavailable"));
  const initialized = await mocks.api.initialize(assets, { ...DEFAULT_POSE_SETTINGS, handTracking: true });
  expect(initialized.handWarning).toMatch(/Body tracking is still active/);
  expect(initialized.handDelegate).toBeNull();
  const result = await mocks.api.detect(bitmap(), 123);
  expect(result.worldLandmarks).toBe(pose.worldLandmarks);
  expect(result.hands).toBeUndefined();
  expect(body.close).not.toHaveBeenCalled();
});

test("WASM resolution failure cannot leave a partial tracker active", async () => {
  mocks.fileset.mockRejectedValue(new Error("Tasks runtime unavailable"));
  await expect(mocks.api.initialize(assets, DEFAULT_POSE_SETTINGS)).rejects.toThrow("could not be initialized");
  expect(mocks.bodyCreate).not.toHaveBeenCalled();
  expect(mocks.handCreate).not.toHaveBeenCalled();
  const input = bitmap();
  await expect(mocks.api.detect(input, 123)).rejects.toThrow("not ready");
  expect(input.close).toHaveBeenCalledOnce();
});

test("absent bodies or unobservable body wrists still run hand inference and release the bitmap", async () => {
  await mocks.api.initialize(assets, { ...DEFAULT_POSE_SETTINGS, handTracking: true });
  body.detectForVideo.mockReturnValueOnce({ landmarks: [], worldLandmarks: [] });
  const absent = bitmap();
  expect(await mocks.api.detect(absent, 123)).toBeNull();
  expect(absent.close).toHaveBeenCalledOnce();
  pose.landmarks[15].visibility = pose.landmarks[16].visibility = 0;
  const occluded = bitmap();
  expect((await mocks.api.detect(occluded, 124)).hands).toEqual([]);
  expect(occluded.close).toHaveBeenCalledOnce();
  expect(hands.detectForVideo).toHaveBeenCalledTimes(2);
});

test("hand inference errors release the bitmap before propagating to the existing restart path", async () => {
  await mocks.api.initialize(assets, { ...DEFAULT_POSE_SETTINGS, handTracking: true });
  hands.detectForVideo.mockImplementation(() => { throw new Error("Hand graph failed"); });
  const input = bitmap();
  await expect(mocks.api.detect(input, 123)).rejects.toThrow("Hand graph failed");
  expect(input.close).toHaveBeenCalledOnce();
});

test("closing during hand initialization disposes both late tasks and cannot revive the worker", async () => {
  const pending = Promise.withResolvers();
  mocks.handCreate.mockReturnValueOnce(pending.promise);
  const initializing = mocks.api.initialize(assets, { ...DEFAULT_POSE_SETTINGS, handTracking: true });
  await vi.waitFor(() => expect(mocks.handCreate).toHaveBeenCalledOnce());
  mocks.api.close();
  pending.resolve(hands);
  await expect(initializing).rejects.toThrow("could not be initialized");
  expect(body.close).toHaveBeenCalledOnce();
  expect(hands.close).toHaveBeenCalledOnce();
  const input = bitmap();
  await expect(mocks.api.detect(input, 123)).rejects.toThrow("not ready");
  expect(input.close).toHaveBeenCalledOnce();
});

test("closing during body initialization releases the late task without initializing hands", async () => {
  const pending = Promise.withResolvers();
  mocks.bodyCreate.mockReturnValueOnce(pending.promise);
  const initializing = mocks.api.initialize(assets, DEFAULT_POSE_SETTINGS);
  await vi.waitFor(() => expect(mocks.bodyCreate).toHaveBeenCalledOnce());
  mocks.api.close();
  pending.resolve(body);
  await expect(initializing).rejects.toThrow("could not be initialized");
  expect(body.close).toHaveBeenCalledOnce();
  expect(mocks.handCreate).not.toHaveBeenCalled();
  const input = bitmap();
  await expect(mocks.api.detect(input, 123)).rejects.toThrow("not ready");
  expect(input.close).toHaveBeenCalledOnce();
});

test("repeated close releases each initialized task only once", async () => {
  await mocks.api.initialize({ ...assets, faceModelUrl: "/mocap/face.tflite" }, DEFAULT_POSE_SETTINGS);
  body.detectForVideo.mockReturnValue({ landmarks: [], worldLandmarks: [] });
  await mocks.api.detect(bitmap(), 123);
  mocks.api.close();
  mocks.api.close();
  expect(body.close).toHaveBeenCalledOnce();
  expect(hands.close).toHaveBeenCalledOnce();
  expect(face.close).toHaveBeenCalledOnce();
});

test("full-body tracking never loads or runs the optional face detector", async () => {
  await mocks.api.initialize({ ...assets, faceModelUrl: "/mocap/face.tflite" }, DEFAULT_POSE_SETTINGS);
  expect((await mocks.api.detect(bitmap(), 123)).face).toBeUndefined();
  expect(mocks.faceCreate).not.toHaveBeenCalled();
  expect(face.detectForVideo).not.toHaveBeenCalled();
});

test("image-only face framing works when the body tracker cannot detect a close-up", async () => {
  await mocks.api.initialize({ ...assets, faceModelUrl: "/mocap/face.tflite" }, DEFAULT_POSE_SETTINGS);
  body.detectForVideo.mockReturnValue({ landmarks: [], worldLandmarks: [] });
  const input = bitmap();
  const result = await mocks.api.detect(input, 123);
  expect(result).toMatchObject({ landmarks: [], worldLandmarks: [], timestamp: 123,
    imageWidth: 640, imageHeight: 480, face: { confidence: 0.95 } });
  expect(result.face.landmarks).toHaveLength(6);
  expect(result.face.landmarks[0]).toEqual({ x: 0.4, y: 0.4, z: 0, visibility: 0.95, presence: 0.95 });
  expect(mocks.faceCreate.mock.calls[0][1]).toMatchObject({ baseOptions: { modelAssetPath: "/mocap/face.tflite", delegate: "GPU" }, runningMode: "VIDEO" });
  expect(face.detectForVideo).toHaveBeenCalledExactlyOnceWith(input, 123);
  expect(hands.detectForVideo).toHaveBeenCalledExactlyOnceWith(input, 123);
  expect(input.close).toHaveBeenCalledOnce();
});

test("offscreen shoulders trigger face framing even with confident body predictions", async () => {
  await mocks.api.initialize({ ...assets, faceModelUrl: "/mocap/face.tflite" }, DEFAULT_POSE_SETTINGS);
  pose.landmarks[11].y = 1.2;
  pose.landmarks[12].y = 1.2;
  const result = await mocks.api.detect(bitmap(), 123);
  expect(result.face.confidence).toBe(0.95);
  expect(result.worldLandmarks).toBe(pose.worldLandmarks);
  await mocks.api.detect(bitmap(), 124);
  expect(mocks.faceCreate).toHaveBeenCalledOnce();
  expect(face.detectForVideo).toHaveBeenCalledTimes(2);
  pose.landmarks[11].y = pose.landmarks[12].y = 0.5;
  expect((await mocks.api.detect(bitmap(), 125)).face).toBeUndefined();
  expect(face.detectForVideo).toHaveBeenCalledTimes(2);
});

test("face GPU failure falls back independently to CPU", async () => {
  await mocks.api.initialize({ ...assets, faceModelUrl: "/mocap/face.tflite" }, DEFAULT_POSE_SETTINGS);
  mocks.faceCreate.mockRejectedValueOnce(new Error("No face GPU"));
  body.detectForVideo.mockReturnValue({ landmarks: [], worldLandmarks: [] });
  expect((await mocks.api.detect(bitmap(), 123)).face.confidence).toBe(0.95);
  expect(mocks.faceCreate.mock.calls.map(([, options]) => options.baseOptions.delegate)).toEqual(["GPU", "CPU"]);
});

test("failed face initialization preserves body tracking and is not repeatedly retried", async () => {
  await mocks.api.initialize({ ...assets, faceModelUrl: "/mocap/face.tflite" }, DEFAULT_POSE_SETTINGS);
  mocks.faceCreate.mockRejectedValue(new Error("Face unavailable"));
  pose.landmarks[11].y = 1.2;
  expect((await mocks.api.detect(bitmap(), 123)).worldLandmarks).toBe(pose.worldLandmarks);
  expect((await mocks.api.detect(bitmap(), 124)).worldLandmarks).toBe(pose.worldLandmarks);
  expect(mocks.faceCreate).toHaveBeenCalledTimes(2);
  expect(body.close).not.toHaveBeenCalled();
});

test("closing during lazy face initialization closes the late result and discards its frame", async () => {
  await mocks.api.initialize({ ...assets, faceModelUrl: "/mocap/face.tflite" }, DEFAULT_POSE_SETTINGS);
  body.detectForVideo.mockReturnValue({ landmarks: [], worldLandmarks: [] });
  const pending = Promise.withResolvers();
  mocks.faceCreate.mockReturnValueOnce(pending.promise);
  const input = bitmap();
  const detecting = mocks.api.detect(input, 123);
  await vi.waitFor(() => expect(mocks.faceCreate).toHaveBeenCalledOnce());
  mocks.api.close();
  pending.resolve(face);
  expect(await detecting).toBeNull();
  expect(face.close).toHaveBeenCalledOnce();
  expect(face.detectForVideo).not.toHaveBeenCalled();
  expect(input.close).toHaveBeenCalledOnce();
});

test("face inference failure disables only the optional fallback and releases the bitmap", async () => {
  await mocks.api.initialize({ ...assets, faceModelUrl: "/mocap/face.tflite" }, DEFAULT_POSE_SETTINGS);
  pose.landmarks[11].y = 1.2;
  face.detectForVideo.mockImplementation(() => { throw new Error("Face graph failed"); });
  const input = bitmap();
  expect((await mocks.api.detect(input, 123)).worldLandmarks).toBe(pose.worldLandmarks);
  expect(input.close).toHaveBeenCalledOnce();
  expect(face.close).toHaveBeenCalledOnce();
  expect((await mocks.api.detect(bitmap(), 124)).face).toBeUndefined();
  expect(face.detectForVideo).toHaveBeenCalledOnce();
  expect(body.close).not.toHaveBeenCalled();
});

test("detailed hands work without body landmarks or a face", async () => {
  await mocks.api.initialize(assets, DEFAULT_POSE_SETTINGS);
  body.detectForVideo.mockReturnValue({ landmarks: [], worldLandmarks: [] });
  handResult.handedness = [[{ categoryName: "Left", score: 0.98 }]];
  const input = bitmap();
  const result = await mocks.api.detect(input, 123);
  expect(result).toMatchObject({ landmarks: [], worldLandmarks: [], timestamp: 123,
    imageWidth: 640, imageHeight: 480, hands: [{ side: "left", confidence: 0.98 }] });
  expect(result.hands[0].landmarks).toHaveLength(21);
  expect(result.hands[0].worldLandmarks).toHaveLength(21);
  expect(hands.detectForVideo).toHaveBeenCalledExactlyOnceWith(input, 123);
  expect(input.close).toHaveBeenCalledOnce();
});

test.each([13, 15, "both"])("a missing body joint %s does not gate a clear detailed hand", async (missing) => {
  await mocks.api.initialize(assets, DEFAULT_POSE_SETTINGS);
  for (const index of missing === "both" ? [13, 15] : [missing]) pose.landmarks[index].visibility = 0;
  handResult.handedness = [[{ categoryName: "Left", score: 0.98 }]];
  expect((await mocks.api.detect(bitmap(), 123)).hands[0].side).toBe("left");
});

test("hand association continuity is cleared when the worker is closed and initialized again", async () => {
  await mocks.api.initialize(assets, DEFAULT_POSE_SETTINGS);
  expect((await mocks.api.detect(bitmap(), 100)).hands[0].side).toBe("left");
  body.detectForVideo.mockReturnValue({ landmarks: [], worldLandmarks: [] });
  handResult.handedness = [[{ categoryName: "Right", score: 0.6 }]];
  expect((await mocks.api.detect(bitmap(), 133)).hands[0].side).toBe("left");
  mocks.api.close();
  await mocks.api.initialize(assets, DEFAULT_POSE_SETTINGS);
  expect(await mocks.api.detect(bitmap(), 166)).toBeNull();
});

test("an empty body and empty hand frame still reports tracking loss", async () => {
  await mocks.api.initialize(assets, DEFAULT_POSE_SETTINGS);
  body.detectForVideo.mockReturnValue({ landmarks: [], worldLandmarks: [] });
  hands.detectForVideo.mockReturnValue({ landmarks: [], worldLandmarks: [], handedness: [] });
  const input = bitmap();
  expect(await mocks.api.detect(input, 123)).toBeNull();
  expect(input.close).toHaveBeenCalledOnce();
});
