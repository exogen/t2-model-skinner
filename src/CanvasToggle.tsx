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
    setSizeMultiplier,
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
      </div>
      <div className="CanvasToggle" style={{ display: "none" }}>
        <button
          type="button"
          data-selected={sizeMultiplier === 1 ? "" : undefined}
          onClick={() => {
            setSizeMultiplier(1);
          }}
        >
          1&times;
        </button>
        <button
          type="button"
          data-selected={sizeMultiplier === 2 ? "" : undefined}
          onClick={() => {
            setSizeMultiplier(2);
          }}
        >
          2&times;
        </button>
        <button
          type="button"
          data-selected={sizeMultiplier === 4 ? "" : undefined}
          onClick={() => {
            setSizeMultiplier(4);
          }}
        >
          4&times;
        </button>
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
