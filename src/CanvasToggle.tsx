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
      {hasAnimation ? (
        <div className="FrameSelector">
          <button
            type="button"
            onClick={() => {
              setSelectedFrameIndex((index) => (index - 1) % frameCount);
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
