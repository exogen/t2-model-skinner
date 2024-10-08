import { useCallback, useEffect, useMemo, useState } from "react";
import Canvas, { CanvasProps } from "./Canvas";
import useSettings from "./useSettings";
import useSkin from "./useSkin";
import type { MaterialDefinition } from "./Material";
import useWarrior from "./useWarrior";
import useImageWorker from "./useImageWorker";
import useImageLoader from "./useImageLoader";

const defaultTextureSize = [512, 512] as [number, number];

export default function ColorCanvas({
  materialDef,
  frameIndex = 0,
}: {
  materialDef: MaterialDefinition;
  frameIndex: number;
}) {
  const { skinImageUrls, defaultSkinImageUrls } = useWarrior();
  const skinImageUrl =
    skinImageUrls[materialDef.file ?? materialDef.name]?.[frameIndex];
  const defaultSkinImageUrl =
    defaultSkinImageUrls[materialDef.file ?? materialDef.name]?.[frameIndex];
  const { setColorImageUrl } = useSkin();
  const { canvasPadding } = useSettings();
  const [noAlphaImageUrl, setNoAlphaImageUrl] = useState<string | null>(null);
  const { removeAlphaFromArrayBuffer } = useImageWorker();
  const { loadImage } = useImageLoader();

  const textureSize = useMemo(
    () => materialDef.size ?? defaultTextureSize,
    [materialDef]
  );

  const handleChange = useCallback<CanvasProps["onChange"]>(
    async (canvas) => {
      const imageUrl = canvas.toDataURL({
        top: canvasPadding,
        left: canvasPadding,
        width: textureSize[0],
        height: textureSize[1],
      });
      setColorImageUrl(
        materialDef.file ?? materialDef.name,
        imageUrl,
        frameIndex
      );
    },
    [textureSize, canvasPadding, setColorImageUrl, materialDef, frameIndex]
  );

  useEffect(() => {
    if (skinImageUrl) {
      let stale = false;

      const generateImageUrl = async () => {
        let arrayBuffer;
        try {
          arrayBuffer = await loadImage(skinImageUrl);
        } catch (err) {
          if (materialDef.hasDefault !== false) {
            arrayBuffer = await loadImage(defaultSkinImageUrl);
          } else {
            return;
          }
        }
        const outputImageUrl = await removeAlphaFromArrayBuffer(arrayBuffer);
        if (!stale) {
          setNoAlphaImageUrl(outputImageUrl);
        }
      };

      generateImageUrl();

      return () => {
        stale = true;
      };
    } else {
      setNoAlphaImageUrl(null);
    }
  }, [
    materialDef,
    skinImageUrl,
    defaultSkinImageUrl,
    removeAlphaFromArrayBuffer,
    loadImage,
  ]);

  const canvasId = `${materialDef.name}:color:${frameIndex}`;

  return textureSize ? (
    <Canvas
      key={canvasId}
      canvasId={canvasId}
      canvasType="color"
      onChange={handleChange}
      baseImageUrl={noAlphaImageUrl}
      textureSize={textureSize}
    />
  ) : null;
}
