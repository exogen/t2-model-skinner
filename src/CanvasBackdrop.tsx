import useTools from "./useTools";
import useSettings from "./useSettings";

export default function CanvasBackdrop() {
  const { backgroundColor, textureSize } = useTools();
  const { canvasPadding } = useSettings();

  return textureSize ? (
    <div
      className="CanvasBackdrop"
      style={{
        backgroundColor,
        top: canvasPadding,
        width: textureSize[0],
        height: textureSize[1],
      }}
    />
  ) : null;
}
