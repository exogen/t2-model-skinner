import { ReactNode, useRef } from "react";
import useCanvas from "./useCanvas";
import useTools from "./useTools";
import { detectFileType, readImageFile } from "./importUtils";

export default function CanvasInteractions({
  children,
}: {
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const {
    activeCanvas,
    activeCanvasType,
    bringForward,
    sendBackward,
    duplicate,
    deleteSelection,
    addImages,
    loadSkinFiles,
    undo,
    redo,
  } = useTools();
  const { canvas, status, notifyChange, setDrawingMode } =
    useCanvas(activeCanvas);

  const nudge = ({ top = 0, left = 0 } = {}) => {
    let changed = false;
    for (const object of canvas.getActiveObjects()) {
      if (top && !object.lockMovementY) {
        object.top += top;
        changed = true;
      }
      if (left && !object.lockMovementX) {
        object.left += left;
        changed = true;
      }
      object.setCoords();
    }
    if (changed) notifyChange();
  };

  return (
    <div
      className="CanvasInteractions"
      tabIndex={0}
      ref={ref}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={async (event) => {
        event.preventDefault();
        if (ref.current) {
          ref.current.focus();
        }
        const files = Array.from(event.dataTransfer.files);
        const archives = files.filter((file) => {
          const type = detectFileType(file);
          return type === "skin" || type === "vl2" || type === "zip";
        });
        try {
          if (archives.length) {
            await loadSkinFiles(archives);
          } else {
            const images = files.filter(
              (file) =>
                file.type.startsWith("image/") ||
                detectFileType(file) === "png"
            );
            if (images.length) {
              await addImages(await Promise.all(images.map(readImageFile)));
            }
          }
        } catch (error) {
          window.alert(
            error instanceof Error
              ? error.message
              : "Unable to load these files"
          );
        }
      }}
      onKeyDown={async (event) => {
        if (!canvas || status !== "ready") return;
        const target = event.target as HTMLElement;
        if (
          event.defaultPrevented ||
          target.closest('input, textarea, select, [role="slider"]')
        ) {
          return;
        }
        if (event.ctrlKey || event.metaKey) {
          switch (event.key) {
            case "z":
              if (event.altKey) {
                return;
              } else if (event.shiftKey) {
                event.preventDefault();
                redo();
                return;
              } else {
                event.preventDefault();
                undo();
                return;
              }
            case "y":
              if (event.altKey || event.shiftKey) {
                return;
              } else {
                event.preventDefault();
                redo();
                return;
              }
          }
        }
        if (
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey
        ) {
          return;
        }
        switch (event.key) {
          case "Backspace":
          case "Delete": {
            event.preventDefault();
            await deleteSelection();
            break;
          }
          case "ArrowLeft": {
            event.preventDefault();
            await nudge({ left: -1 });
            break;
          }
          case "ArrowRight": {
            event.preventDefault();
            await nudge({ left: 1 });
            break;
          }
          case "ArrowUp": {
            event.preventDefault();
            await nudge({ top: -1 });
            break;
          }
          case "ArrowDown": {
            event.preventDefault();
            await nudge({ top: 1 });
            break;
          }
          case "d": {
            event.preventDefault();
            await duplicate();
            break;
          }
          case "f": {
            event.preventDefault();
            await bringForward();
            break;
          }
          case "b": {
            event.preventDefault();
            await sendBackward();
            break;
          }
          case "p": {
            if (activeCanvasType === "metallic") {
              event.preventDefault();
              setDrawingMode(true);
            }
            break;
          }
          case "s":
            if (activeCanvasType === "metallic") {
              event.preventDefault();
              setDrawingMode(false);
            }
            break;
        }
      }}
    >
      {children}
    </div>
  );
}
