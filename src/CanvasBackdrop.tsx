import useTools from "./useTools";
import useSettings from "./useSettings";

export default function CanvasBackdrop() {
  const { backgroundColor, textureSize, sizeMultiplier } = useTools();
  const { canvasPadding } = useSettings();

  return textureSize ? (
    <div
      className="CanvasBackdrop"
      style={{
        backgroundColor,
        top: canvasPadding,
        width: textureSize[0] / sizeMultiplier,
        height: textureSize[1] / sizeMultiplier,
      }}
    />
  ) : null;
}
