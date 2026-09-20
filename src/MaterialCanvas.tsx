import { useCallback, useMemo, useState } from "react";
import Canvas, { type CanvasProps, type CanvasSource } from "./Canvas";
import { isTextureSourceMaterial, type MaterialDefinition } from "./models";
import { materialArchiveKey } from "./skinProjectUtils";
import useEditorSession from "./useEditorSession";
import useSettings from "./useSettings";
import useWarrior from "./useWarrior";
import useSkin from "./useSkin";
import useImageWorker from "./useImageWorker";
import useAsyncTask from "./useAsyncTask";

export default function MaterialCanvas({
  materialDef,
  frameIndex,
  type,
}: {
  materialDef: MaterialDefinition;
  frameIndex: number;
  type: "color" | "metallic";
}) {
  const { actualModel, selectedSkin, skinImageUrls, defaultSkinImageUrls } =
    useWarrior();
  const { project, sizeMultiplier } = useEditorSession();
  const { canvasPadding } = useSettings();
  const { setColorImageUrl, setMetallicImageUrl } = useSkin();
  const {
    removeAlphaFromArrayBuffer,
    convertArrayBufferAlphaToGrayscale,
    convertGrayscaleImageUrlToMetallicRoughness,
  } = useImageWorker();
  const updatePreview = useAsyncTask(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const file = materialDef.file ?? materialDef.name;
  const ownsTexture = isTextureSourceMaterial(materialDef, actualModel);
  const snapshot =
    project?.materials[materialArchiveKey(materialDef, frameIndex)]?.[type];
  // Legacy projects may omit materials. Those canvases use the model defaults.
  const urls = project ? defaultSkinImageUrls : skinImageUrls;
  const url = urls[file]?.[frameIndex] ?? null;
  const fallbackUrl = selectedSkin
    ? defaultSkinImageUrls[file]?.[frameIndex]
    : undefined;
  const convert =
    type === "color"
      ? removeAlphaFromArrayBuffer
      : convertArrayBufferAlphaToGrayscale;
  const source = useMemo<CanvasSource>(
    () =>
      snapshot
        ? { kind: "project", snapshot }
        : {
            kind: "texture",
            url,
            fallbackUrl,
            optional: materialDef.hasDefault === false,
            convert,
          },
    [snapshot, url, fallbackUrl, materialDef.hasDefault, convert]
  );
  const textureSize = useMemo<[number, number]>(() => {
    const [width, height] = materialDef.size ?? [512, 512];
    return [width * sizeMultiplier, height * sizeMultiplier];
  }, [materialDef.size, sizeMultiplier]);

  const handleChange = useCallback<CanvasProps["onChange"]>(
    (canvas) => {
      if (!ownsTexture) return;
      const imageUrl = canvas.toDataURL({
        format: "png",
        multiplier: 1,
        top: canvasPadding,
        left: canvasPadding,
        width: textureSize[0],
        height: textureSize[1],
      });
      if (type === "color") {
        setColorImageUrl(file, imageUrl, frameIndex);
      } else {
        void updatePreview(
          () => convertGrayscaleImageUrlToMetallicRoughness(imageUrl),
          (result) => {
            setPreviewError(null);
            setMetallicImageUrl(file, result, frameIndex);
          }
        ).catch(() => setPreviewError("Unable to update metallic preview"));
      }
    },
    [
      ownsTexture,
      textureSize,
      canvasPadding,
      type,
      file,
      frameIndex,
      setColorImageUrl,
      setMetallicImageUrl,
      updatePreview,
      convertGrayscaleImageUrlToMetallicRoughness,
    ]
  );

  return (
    <>
      {previewError ? <p role="alert">{previewError}</p> : null}
      <Canvas
        canvasId={`${materialDef.name}:${type}:${frameIndex}:${sizeMultiplier}`}
        onChange={handleChange}
        source={source}
        textureSize={textureSize}
        defaultDrawingMode={type === "metallic"}
      />
    </>
  );
}
