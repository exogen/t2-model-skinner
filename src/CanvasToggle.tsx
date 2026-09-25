import { FaChevronLeft, FaChevronRight } from "react-icons/fa";
import useTools from "./useTools";

export default function CanvasToggle() {
  const {
    activeCanvasType,
    setActiveCanvasType,
    hasMetallic,
    hasAnimation,
    frameCount,
    selectedFrameIndex,
    setSelectedFrameIndex,
    sizeMultiplier,
    textureSize,
  } = useTools();

  return (
    <>
      <div className="CanvasToggle">
        <button
          type="button"
          data-selected={activeCanvasType === "color" ? "" : undefined}
          onClick={() => {
            setActiveCanvasType("color");
          }}
        >
          Color
        </button>
        {hasMetallic ? (
          <button
            type="button"
            data-selected={activeCanvasType === "metallic" ? "" : undefined}
            onClick={() => {
              setActiveCanvasType("metallic");
            }}
          >
            Metallic
          </button>
        ) : null}
        {sizeMultiplier > 1 ? (
          <span
            className="CanvasResolution"
            title={`${textureSize[0]} × ${textureSize[1]} pixels`}
            aria-label={`${sizeMultiplier}× resolution: ${textureSize[0]} × ${textureSize[1]} pixels`}
          >
            {sizeMultiplier}&times;
          </span>
        ) : null}
      </div>
      {hasAnimation ? (
        <div className="FrameSelector">
          <button
            type="button"
            onClick={() => {
              setSelectedFrameIndex(
                (index) => (frameCount + index - 1) % frameCount
              );
            }}
          >
            <FaChevronLeft />
          </button>
          <span className="FrameInfo">
            {selectedFrameIndex + 1} / {frameCount}
          </span>
          <button
            type="button"
            onClick={() => {
              setSelectedFrameIndex((index) => (index + 1) % frameCount);
            }}
          >
            <FaChevronRight />
          </button>
        </div>
      ) : null}
    </>
  );
}
