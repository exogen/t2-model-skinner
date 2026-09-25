"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import useCanvas from "./useCanvas";
import useSettings from "./useSettings";
import useTools from "./useTools";
import {
  Canvas as FabricCanvas,
  InteractiveFabricObject,
  FabricObject,
  util,
} from "fabric";
import { createCanvasHistory, type HistoryState } from "./canvasHistory";
import {
  configureCanvasControls,
  createFabricImage,
  type CanvasSnapshot,
} from "./fabricUtils";
import useImageLoader from "./useImageLoader";
import useAsyncTask from "./useAsyncTask";
import useEditorSession from "./useEditorSession";

function updateObjectControlOptions() {
  InteractiveFabricObject.ownDefaults = {
    ...InteractiveFabricObject.ownDefaults,
    transparentCorners: false,
    borderColor: "#8afff1",
    cornerSize: 9,
    cornerStyle: "circle",
    cornerColor: "#8afff1",
    cornerStrokeColor: "#1c9f7c",
    strokeWidth: 10,
    perPixelTargetFind: true,
  };
}

export type CanvasSource =
  | { kind: "project"; snapshot: CanvasSnapshot }
  | {
      kind: "texture";
      url: string | null;
      fallbackUrl?: string;
      optional?: boolean;
      convert: (buffer: ArrayBuffer) => Promise<string>;
    };

async function prepareCanvasSource(
  source: CanvasSource,
  textureSize: [number, number],
  loadImage: (url: string) => Promise<ArrayBuffer>,
  signal: AbortSignal
): Promise<FabricObject[]> {
  if (source.kind === "project") {
    return util.enlivenObjects<FabricObject>(source.snapshot.objects, {
      signal,
    });
  }
  // Texture archives can omit fixed materials such as vehicle windshields.
  const textureUrl = source.url ?? source.fallbackUrl;
  if (!textureUrl) return [];
  let buffer;
  try {
    buffer = await loadImage(textureUrl);
  } catch (error) {
    signal.throwIfAborted();
    if (source.optional) return [];
    if (!source.fallbackUrl || source.fallbackUrl === textureUrl) throw error;
    buffer = await loadImage(source.fallbackUrl);
  }
  signal.throwIfAborted();
  const url = await source.convert(buffer);
  signal.throwIfAborted();
  const image = await createFabricImage(url, signal);
  if (!image.width || !image.height) {
    image.dispose();
    throw new Error("Zero-height image");
  }
  image.set({
    scaleX: textureSize[0] / image.width,
    scaleY: textureSize[1] / image.height,
    selectable: false,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    hoverCursor: "default",
    moveCursor: "default",
  });
  return [image];
}

export interface CanvasProps {
  canvasId: string;
  onChange: (canvas: FabricCanvas) => void;
  source: CanvasSource;
  textureSize: [number, number];
  defaultDrawingMode?: boolean;
}

export default function Canvas({
  canvasId,
  onChange,
  source,
  textureSize,
  defaultDrawingMode = false,
}: CanvasProps) {
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const [surface, setSurface] = useState<{
    canvas: FabricCanvas;
    history: ReturnType<typeof createCanvasHistory>;
  } | null>(null);
  const { canvas, history } = surface ?? {};
  const { activeCanvas } = useTools();
  const { sizeMultiplier, isResolvingSize, resolutionError } = useEditorSession();
  const { canvasPadding } = useSettings();
  const { registerCanvas, unregisterCanvas } = useCanvas();
  const [isDrawingMode, setDrawingMode] = useState(defaultDrawingMode);
  const handleChangeRef = useRef<CanvasProps["onChange"]>(null);
  const [{ canUndo, canRedo }, setHistoryState] = useState<HistoryState>({
    canUndo: false,
    canRedo: false,
  });
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const { loadImage } = useImageLoader();
  const initialize = useAsyncTask(true);
  useEffect(() => {
    handleChangeRef.current = onChange;
  }, [onChange]);

  const isActive = activeCanvas === canvasId;

  useEffect(() => {
    if (!canvasElementRef.current) {
      return;
    }

    const options = {
      preserveObjectStacking: true,
      targetFindTolerance: 2,
      // HD already has multiple image pixels per displayed pixel. Avoid
      // multiplying every HD canvas's memory usage again on Retina screens.
      enableRetinaScaling: sizeMultiplier === 1,
    };

    updateObjectControlOptions();

    const canvas = new FabricCanvas(canvasElementRef.current, options);

    const history = createCanvasHistory(
      canvas,
      () => handleChangeRef.current?.(canvas),
      (next) =>
        setHistoryState((previous) =>
          previous.canUndo === next.canUndo &&
          previous.canRedo === next.canRedo
            ? previous
            : next
        )
    );
    setSurface({ canvas, history });

    return () => {
      history.dispose();
      setSurface(null);
      void canvas.dispose();
    };
  }, [sizeMultiplier]);

  useLayoutEffect(() => {
    if (!canvas) return;
    // Keep document coordinates and exports at full resolution. Fabric maps
    // pointer positions through these CSS dimensions for editing and painting.
    canvas.setDimensions(
      {
        width: (textureSize[0] + canvasPadding * 2) / sizeMultiplier,
        height: (textureSize[1] + canvasPadding * 2) / sizeMultiplier,
      },
      { cssOnly: true }
    );
    return configureCanvasControls(canvas, sizeMultiplier);
  }, [canvas, textureSize, canvasPadding, sizeMultiplier]);

  useEffect(() => {
    if (canvas) {
      canvas.isDrawingMode = status === "ready" && isDrawingMode;
      canvas.selection = status === "ready";
      canvas.skipTargetFind = status !== "ready";
      if (canvas.isDrawingMode) {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
      }
    }
  }, [canvas, isDrawingMode, status]);

  useEffect(() => {
    if (canvas && isActive) {
      canvas.calcOffset();
    }
  }, [canvas, isActive]);

  useEffect(() => {
    if (canvas && history) {
      registerCanvas(canvasId, {
        canvas,
        status,
        notifyChange: history.notifyChange,
        undo: history.undo,
        redo: history.redo,
        canUndo,
        canRedo,
        isDrawingMode,
        setDrawingMode,
      });
      return () => {
        unregisterCanvas(canvasId);
      };
    }
  }, [
    canvas,
    registerCanvas,
    unregisterCanvas,
    canvasId,
    status,
    history,
    isDrawingMode,
    setDrawingMode,
    canUndo,
    canRedo,
  ]);

  useEffect(() => {
    if (!canvas || !history || isResolvingSize) return;
    if (resolutionError) {
      setStatus("error");
      setLoadError(resolutionError);
      return;
    }
    setStatus("loading");
    setLoadError(null);
    void initialize(
      (signal) => prepareCanvasSource(source, textureSize, loadImage, signal),
      (objects) => {
        if (source.kind === "texture")
          objects.forEach((object) => canvas.centerObject(object));
        history.reset(objects);
        setStatus("ready");
      },
      (objects) => objects.forEach((object) => object.dispose())
    ).catch((error: unknown) => {
      setStatus("error");
      setLoadError(
        error instanceof Error ? error.message : "Unable to load texture"
      );
    });
  }, [
    canvas, history, source, textureSize, loadImage, initialize, isResolvingSize,
    resolutionError,
  ]);

  return (
    <div
      className="CanvasContainer"
      data-active={isActive ? "true" : "false"}
      style={{ padding: canvasPadding * (1 - 1 / sizeMultiplier) }}
    >
      {loadError ? <p role="alert">{loadError}</p> : null}
      <div>
        <canvas
          width={textureSize[0] + canvasPadding * 2}
          height={textureSize[1] + canvasPadding * 2}
          ref={canvasElementRef}
        />
      </div>
    </div>
  );
}
