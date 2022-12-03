import useTools from "./useTools";

export default function CanvasToggle() {
  const { activeCanvasType, setActiveCanvasType, hasMetallic } = useTools();

  return (
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
  );
}
