import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import Canvas, { CanvasProps } from "./Canvas";
import useImageWorker from "./useImageWorker";
import useSettings from "./useSettings";
import type { MaterialDefinition } from "./Material";
import useSkin from "./useSkin";
import useWarrior from "./useWarrior";
import useImageLoader from "./useImageLoader";

const defaultTextureSize = [512, 512] as [number, number];

export default function MetallicCanvas({
  materialDef,
}: {
  materialDef: MaterialDefinition;
}) {
  const { skinImageUrls, defaultSkinImageUrls } = useWarrior();
  const skinImageUrl = skinImageUrls[materialDef.name];
  const defaultSkinImageUrl = defaultSkinImageUrls[materialDef.name];
  const { setMetallicImageUrl } = useSkin();
  const { canvasPadding } = useSettings();
  const [alphaImageUrl, setAlphaImageUrl] = useState<string | null>(null);
  const runningChangeHandlers = useRef(0);
  const {
    convertGrayscaleImageUrlToMetallicRoughness,
    convertArrayBufferAlphaToGrayscale,
  } = useImageWorker();
  const { loadImage } = useImageLoader();

  const textureSize = useMemo(
    () => materialDef.size ?? defaultTextureSize,
    [materialDef]
  );

  const handleChange = useCallback<CanvasProps["onChange"]>(
    async (canvas) => {
      runningChangeHandlers.current += 1;
      const imageUrl = canvas.toDataURL({
        top: canvasPadding,
        left: canvasPadding,
        width: textureSize[0],
        height: textureSize[1],
      });
      let outputImageUrl;
      try {
        outputImageUrl = await convertGrayscaleImageUrlToMetallicRoughness(
          imageUrl
        );
      } finally {
        runningChangeHandlers.current -= 1;
      }
      if (runningChangeHandlers.current === 0) {
        setMetallicImageUrl(materialDef.name, outputImageUrl);
      }
    },
    [
      textureSize,
      canvasPadding,
      setMetallicImageUrl,
      convertGrayscaleImageUrlToMetallicRoughness,
      materialDef,
    ]
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
        const outputImageUrl = await convertArrayBufferAlphaToGrayscale(
          arrayBuffer
        );
        if (!stale) {
          setAlphaImageUrl(outputImageUrl);
        }
      };

      generateImageUrl();

      return () => {
        stale = true;
      };
    } else {
      setAlphaImageUrl(null);
    }
  }, [
    materialDef,
    skinImageUrl,
    defaultSkinImageUrl,
    textureSize,
    convertArrayBufferAlphaToGrayscale,
    loadImage,
  ]);

  const canvasId = `${materialDef.name}:metallic`;

  return textureSize ? (
    <Canvas
      key={canvasId}
      canvasId={canvasId}
      canvasType="metallic"
      onChange={handleChange}
      baseImageUrl={alphaImageUrl}
      textureSize={textureSize}
      defaultDrawingMode
    />
  ) : null;
}
