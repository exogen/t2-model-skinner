import { useSearchParams } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { captureActivity } from "./captureActivity";
import useWarrior from "./useWarrior";
import useViewer from "./useViewer";
import useCanvas from "./useCanvas";
import useEditorSession from "./useEditorSession";
import useEnvironment from "./useEnvironment";
import useSkin from "./useSkin";
import modelConfig, { hasMetallicMap } from "./models";
import { exportModelImage } from "./modelImage";
import { blobToDataUrl } from "./importUtils";
import type { CameraOptions } from "./Viewer";

let nextSession = 0;
const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

type ExpectedSelection = {
  revision?: number;
  model?: string;
  skin?: string;
  timeout?: number;
};
type ExportOptions = ExpectedSelection & {
  type?: "image/png" | "image/webp";
  quality?: number;
  trim?: boolean;
  camera?: CameraOptions;
  fitCurrentPose?: boolean;
};

declare global {
  interface Window {
    t2SkinnerCapture?: ReturnType<typeof createCaptureApi>;
  }
}

type LiveState = {
  warrior: ReturnType<typeof useWarrior>;
  viewer: ReturnType<typeof useViewer>["viewer"];
  canvases: ReturnType<typeof useCanvas>["canvases"];
  editor: ReturnType<typeof useEditorSession>;
  skin: ReturnType<typeof useSkin>;
  environment: ReturnType<typeof useEnvironment>;
};

export function createCaptureApi(
  revision: number,
  live: { current: LiveState | null },
  isClosed: () => boolean,
) {
  // Camera changes and exports share the viewer; keep each requested view
  // in place until its image and metadata have been collected.
  let cameraTask: Promise<void> = Promise.resolve();
  function withCamera<T>(operation: () => Promise<T>): Promise<T> {
    const result = cameraTask.then(operation);
    cameraTask = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  function getLive() {
    if (isClosed() || !live.current)
      throw new Error(
        "The capture selection changed. Retry with the current session.",
      );
    return live.current;
  }
  function getState() {
    const { warrior, viewer, canvases, editor, skin } = getLive();
    const activity = captureActivity.snapshot();
    const definitions = modelConfig.materials[warrior.actualModel];
    const expectedCanvases = definitions.reduce(
      (count, def) =>
        count + (def.frameCount ?? 1) * (hasMetallicMap(def) ? 2 : 1),
      0,
    );
    const canvasStates = Object.values(canvases);
    const errors = [...activity.errors];
    if (editor.resolutionError) errors.push(editor.resolutionError);
    if (canvasStates.some((canvas) => canvas.status === "error"))
      errors.push("A skin canvas could not be loaded.");
    const texturesConverted = definitions.every((def) => {
      if (def.hidden) return true;
      const images = skin.getSkinImages(def.file ?? def.name);
      return Array.from(
        { length: def.frameCount ?? 1 },
        (_, frame) =>
          !!images?.colorImageUrl?.[frame] &&
          (!hasMetallicMap(def) || !!images?.metallicImageUrl?.[frame]),
      ).every(Boolean);
    });
    return {
      revision,
      model: warrior.selectedModel,
      actualModel: warrior.actualModel,
      skin: warrior.selectedSkin,
      skinType: warrior.selectedSkinType,
      ready:
        !!viewer &&
        !editor.isResolvingSize &&
        activity.pending === 0 &&
        !errors.length &&
        canvasStates.length === expectedCanvases &&
        canvasStates.every((canvas) => canvas.status === "ready") &&
        texturesConverted &&
        viewer.animationSettled,
      pending: activity.pending,
      errors,
      activityRevision: activity.revision,
      camera: viewer?.getCaptureCamera() ?? null,
    };
  }
  function assertSelection(expected: ExpectedSelection) {
    const state = getState();
    if (
      (expected.revision != null && expected.revision !== state.revision) ||
      (expected.model != null && expected.model !== state.model) ||
      (expected.skin != null && expected.skin !== state.skin)
    ) {
      throw new Error(
        "The capture selection changed. Retry with the current session.",
      );
    }
    if (state.errors.length) throw new Error(state.errors.join("\n"));
    return state;
  }
  async function whenReady(expected: ExpectedSelection = {}) {
    const end = performance.now() + (expected.timeout ?? 60000);
    while (performance.now() < end) {
      const before = assertSelection(expected);
      if (before.ready) {
        const skin = getLive().skin;
        // Worker completion can schedule a React commit followed by new texture
        // loads. Observe that commit and its render before accepting readiness.
        await nextFrame();
        await nextFrame();
        const after = assertSelection(expected);
        if (
          after.ready &&
          before.activityRevision === after.activityRevision &&
          skin === getLive().skin
        )
          return after;
      } else await nextFrame();
    }
    throw new Error(
      "Timed out waiting for the model and skin to finish loading.",
    );
  }
  return {
    version: 1 as const,
    getState,
    whenReady,
    selectModel(model: string) {
      const actualModel = model === "hfemale" ? "hmale" : model;
      if (!Object.hasOwn(modelConfig.materials, actualModel))
        throw new Error(`Unknown model: ${model}`);
      const { warrior, environment } = getLive();
      environment.setHeldWeapon(null);
      warrior.setSelectedAnimation(null);
      warrior.setAnimationPaused(false);
      warrior.setSelectedSkinType("default");
      warrior.setSelectedSkin(modelConfig.modelDefaults[actualModel] ?? null);
      warrior.setSelectedModel(model);
    },
    async importFiles(files: File[]) {
      if (!files.length) throw new Error("No skin files were supplied.");
      await getLive().editor.loadSkinFiles(files);
    },
    async setCamera(
      camera: CameraOptions = {},
      fitCurrentPose = false,
      expected: ExpectedSelection = {},
    ) {
      return withCamera(async () => {
        await whenReady(expected);
        return getLive().viewer!.setCaptureCamera(camera, fitCurrentPose);
      });
    },
    async exportImage(options: ExportOptions = {}) {
      return withCamera(async () => {
        const state = await whenReady(options);
        const viewer = getLive().viewer!;
        // The mine's deployed pose extends past its original bounds. Other models
        // keep their current view unless the caller requests an override or fit.
        const fitCurrentPose =
          options.fitCurrentPose ?? state.actualModel === "mine";
        if (options.camera || fitCurrentPose)
          viewer.setCaptureCamera(options.camera, fitCurrentPose);
        const blob = await exportModelImage(viewer, {
          type: options.type ?? "image/webp",
          quality: options.quality ?? 0.75,
          trim: options.trim ?? false,
        });
        assertSelection({ ...options, revision: state.revision });
        if (!getState().ready)
          throw new Error(
            "The skin changed while its image was being captured. Retry the export.",
          );
        const dataUrl = await blobToDataUrl(blob);
        assertSelection({ ...options, revision: state.revision });
        return {
          dataUrl,
          revision: state.revision,
          model: state.model,
          camera: viewer.getCaptureCamera(),
        };
      });
    },
  };
}

/** Supported automation on the main editor page; no React or WebGL internals
 * are exposed. A new editor session invalidates the old interface immediately. */
export default function CaptureAutomation() {
  const captureMode = useSearchParams().get("capture") === "1";
  const warrior = useWarrior();
  const { viewer } = useViewer();
  const { canvases } = useCanvas();
  const editor = useEditorSession();
  const skin = useSkin();
  const environment = useEnvironment();
  const live = useRef<LiveState | null>(null);
  const [revision] = useState(() => ++nextSession);
  useLayoutEffect(() => {
    viewer?.setTextureAnimationPaused(captureMode);
    return () => viewer?.setTextureAnimationPaused(false);
  }, [viewer, captureMode]);
  useLayoutEffect(() => {
    live.current = { warrior, viewer, canvases, editor, skin, environment };
  });
  useLayoutEffect(() => {
    let closed = false;
    const api = createCaptureApi(revision, live, () => closed);
    window.t2SkinnerCapture = api;
    return () => {
      closed = true;
      if (window.t2SkinnerCapture === api) delete window.t2SkinnerCapture;
    };
  }, [revision]);
  return (
    <input
      type="file"
      multiple
      accept=".png,.vl2,.zip"
      hidden
      data-capture-files=""
    />
  );
}
