import { beforeEach, vi } from "vitest";
import { setTimeout } from "node:timers";
import { Buffer } from "node:buffer";
import React from "react";
import { createRoot } from "react-dom/client";
import * as fabric from "fabric";
import { captureSkinProject, createSkinProjectZip } from "./skinProjectUtils";
import { WarriorContext } from "./useWarrior";
import EditorProvider from "./EditorProvider";
import useEditorSession from "./useEditorSession";
import { materialArchiveKey } from "./skinProjectUtils";
import Canvas from "./Canvas";
import CanvasInteractions from "./CanvasInteractions";
import MaterialCanvases from "./MaterialCanvases";
import SkinProvider from "./SkinProvider";
import useSkin from "./useSkin";
import { ImageLoaderContext } from "./useImageLoader";
import useCanvas from "./useCanvas";
import useTools from "./useTools";
import modelConfig, { modelToModelType } from "./models";

const { saved, downloads, workers } = vi.hoisted(() => ({
  saved: [],
  downloads: [],
  workers: {
    removeAlphaFromArrayBuffer: vi.fn(
      async (buffer) =>
        `data:image/png;base64,${Buffer.from(buffer).toString("base64")}`
    ),
    convertArrayBufferAlphaToGrayscale: vi.fn(
      async (buffer) =>
        `data:image/png;base64,${Buffer.from(buffer).toString("base64")}`
    ),
    combineColorAndAlphaImageUrls: vi.fn(
      async ({ colorImageUrl }) => colorImageUrl
    ),
    convertGrayscaleImageUrlToMetallicRoughness: vi.fn(async (url) => url),
  },
}));

// Exercise real canvases and providers; substitute workers and file downloads.
vi.mock("./useImageWorker", () => ({ default: () => workers }));
vi.mock("file-saver", () => ({
  saveAs: vi.fn((data, name) => downloads.push({ data, name })),
}));
vi.mock("./exportUtils", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    saveZipFile: vi.fn(async (zip, name) => {
      saved.push({ zip, name });
      await original.saveZipFile(zip, name);
    }),
  };
});

beforeEach(() => {
  saved.length = 0;
  downloads.length = 0;
});

const { document, window } = fabric.getEnv();
export const { act } = React;
export { saved, downloads, workers };

export function canvas() {
  return new fabric.Canvas(null, {
    width: 640,
    height: 640,
    renderOnAddRemove: false,
    enableRetinaScaling: false,
  });
}
export function image(options = {}) {
  const element = document.createElement("canvas");
  element.width = 40;
  element.height = 30;
  const context = element.getContext("2d");
  const data = context.createImageData(40, 30);
  for (let i = 0; i < data.data.length; i += 4)
    data.data.set([100, 140, 180, 255], i);
  context.putImageData(data, 0, 0);
  return new fabric.FabricImage(element, { left: 100, top: 120, ...options });
}
export const locked = {
  lockMovementX: true,
  lockMovementY: true,
  lockRotation: true,
  lockScalingX: true,
  lockScalingY: true,
};
export function filteredImage() {
  const object = image({ ...locked, selectable: false, opacity: 0.65 });
  object.filters = [
    new fabric.filters.Contrast({ contrast: 0.4 }),
    new fabric.filters.Brightness({ brightness: 0.2 }),
  ];
  object.applyFilters();
  return object;
}
export function pixel(object) {
  const element = document.createElement("canvas");
  element.width = element.height = 1;
  const context = element.getContext("2d");
  context.drawImage(object.getElement(), 0, 0);
  return [...context.getImageData(0, 0, 1, 1).data];
}
export function input(
  name,
  colorCanvas,
  metallicCanvas = null,
  textureSize = [512, 512]
) {
  return { name, colorCanvas, metallicCanvas, textureSize };
}
export async function archive(inputs, model = "lmale") {
  return (
    await createSkinProjectZip(captureSkinProject(inputs, model))
  ).generateAsync({
    type: "nodebuffer",
  });
}

export async function editor(
  initialModel = "lmale",
  {
    strict = false,
    realCanvases = false,
    initialImageUrls = {},
    defaultImageUrls = {},
    imageLoad = null,
    waitForInitialCanvases = true,
  } = {}
) {
  const imageLoader = {
    loadImage:
      imageLoad ??
      (async (url) => (await globalThis.fetch(url)).arrayBuffer()),
  };
  const definitions = modelConfig.materials;
  let tools, canvases, warrior, skin;
  const changes = [];
  let setBackground;
  function Surface() {
    const currentTools = useTools();
    const session = useEditorSession();
    const currentSkin = useSkin();
    const currentCanvases = useCanvas().canvases;
    const currentWarrior = React.useContext(WarriorContext);
    const [backgroundUrl, updateBackground] = React.useState(null);
    React.useLayoutEffect(() => {
      tools = currentTools;
      canvases = currentCanvases;
      setBackground = updateBackground;
      skin = currentSkin;
    }, [currentTools, currentCanvases, currentSkin]);
    if (realCanvases) return React.createElement(MaterialCanvases);
    const actualModel = currentWarrior.actualModel;
    return React.createElement(
      React.Fragment,
      null,
      definitions[actualModel].flatMap((material) =>
        Array.from({ length: material.frameCount ?? 1 }, (_, frame) =>
          ["color", "metallic"].flatMap((type) => {
            if (
              type === "metallic" &&
              material.metallicFactor === 0 &&
              material.roughnessFactor === 1
            )
              return [];
            const id = `${material.name}:${type}:${frame}:${currentTools.sizeMultiplier}`;
            const size = material.size ?? [512, 512];
            return React.createElement(TestCanvas, {
              key: `${actualModel}:${id}`,
              id,
              type,
              size,
              snapshot:
                session.project?.materials[
                  materialArchiveKey(material, frame)
                ]?.[type],
              multiplier: currentTools.sizeMultiplier,
              backgroundUrl,
            });
          })
        ).flat()
      )
    );
  }
  function TestCanvas({
    id,
    type,
    size,
    snapshot,
    multiplier,
    backgroundUrl,
  }) {
    const [width, height] = size;
    const textureSize = React.useMemo(
      () => [width * multiplier, height * multiplier],
      [width, height, multiplier]
    );
    const source = React.useMemo(
      () =>
        snapshot
          ? { kind: "project", snapshot }
          : {
              kind: "texture",
              url: backgroundUrl,
              convert: async () => backgroundUrl,
            },
      [snapshot, backgroundUrl]
    );
    return React.createElement(Canvas, {
      canvasId: id,
      textureSize,
      source,
      onChange: (c) => changes.push({ id, count: c.getObjects().length }),
    });
  }
  function Warrior() {
    const [skinImageUrls, setSkinImageUrls] =
      React.useState(initialImageUrls);
    const [selectedModel, setSelectedModel] = React.useState(initialModel);
    const [selectedSkin, setSelectedSkin] = React.useState("Blood Eagle");
    const [selectedSkinType, setSelectedSkinType] = React.useState("default");
    const selectedModelType = modelToModelType(selectedModel);
    const [, setSelectedAnimation] = React.useState(null);
    const [importedSkins, setImportedSkins] = React.useState(new Map());
    const actualModel = selectedModel === "hfemale" ? "hmale" : selectedModel;
    const value = {
      skinImageUrls:
        selectedSkinType === "import"
          ? Object.fromEntries(
              importedSkins.get(actualModel)?.get(
                selectedSkin === "__untitled__" ? null : selectedSkin
              )?.materials ?? []
            )
          : skinImageUrls,
      importedSkins,
      addImportedSkins: setImportedSkins,
      setSkinImageUrls,
      defaultSkinImageUrls: defaultImageUrls,
      selectedModel,
      setSelectedModel,
      selectedSkin,
      setSelectedSkin,
      selectedSkinType,
      setSelectedSkinType,
      selectedModelType,
      setSelectedAnimation,
      actualModel,
    };
    React.useLayoutEffect(() => {
      warrior = value;
    });
    return React.createElement(
      WarriorContext.Provider,
      { value },
      React.createElement(
        EditorProvider,
        null,
        React.createElement(
          SkinProvider,
          null,
          React.createElement(
            CanvasInteractions,
            null,
            React.createElement(Surface)
          )
        )
      )
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      React.createElement(
        strict ? React.StrictMode : React.Fragment,
        null,
        React.createElement(
          ImageLoaderContext.Provider,
          { value: imageLoader },
          React.createElement(Warrior)
        )
      )
    )
  );
  async function waitForCanvases() {
    await vi.waitFor(
      async () => {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
        if (
          !Object.keys(canvases).length ||
          Object.values(canvases).some(({ status }) => status === "loading")
        )
          throw new Error("Canvases are still initializing");
      },
      { timeout: 5000 }
    );
  }
  if (waitForInitialCanvases) await waitForCanvases();
  return {
    host,
    get skin() {
      return skin;
    },
    get tools() {
      return tools;
    },
    get canvases() {
      return canvases;
    },
    get warrior() {
      return warrior;
    },
    changes,
    async key(key) {
      await act(async () =>
        host
          .querySelector(".CanvasInteractions")
          .dispatchEvent(
            new window.KeyboardEvent("keydown", { key, bubbles: true })
          )
      );
    },
    async load(bytes) {
      await act(async () => {
        await tools.loadSkinProject(bytes);
      });
      await waitForCanvases();
    },
    async settle() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
    },
    async setBackground(url) {
      await act(async () => setBackground(url));
    },
    async close() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
