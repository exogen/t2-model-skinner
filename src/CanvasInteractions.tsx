import { ReactNode, useRef } from "react";
import useCanvas from "./useCanvas";
import useTools from "./useTools";

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
    undo,
    redo,
  } = useTools();
  const { canvas, notifyChange, setDrawingMode } = useCanvas(activeCanvas);

  const nudge = async ({ top = 0, left = 0 } = {}) => {
    const objects = canvas.getActiveObjects();
    for (const object of objects) {
      object.top = (object.top ?? 0) + top;
      object.left = (object.left ?? 0) + left;
    }
    notifyChange();
  };

  return (
    <div
      className="CanvasInteractions"
      tabIndex={0}
      ref={ref}
      onDrop={async (event) => {
        event.preventDefault();
        if (ref.current) {
          ref.current.focus();
        }
        const { items } = event.dataTransfer;
        const images = Array.from(items).filter(
          (item) => item.kind === "file" && item.type.match(/^image\//)
        );
        const imageUrls = await Promise.all(
          images
            .map(async (droppedImageFile) => {
              const file = droppedImageFile.getAsFile();
              if (!file) {
                throw new Error("Not a file.");
              }
              const reader = new FileReader();
              const imageUrl = await new Promise<string>((resolve, reject) => {
                reader.onload = async (event) => {
                  if (event.target && typeof event.target.result === "string") {
                    resolve(event.target.result);
                  } else {
                    reject(new Error("Failed to load image data."));
                  }
                };
                reader.readAsDataURL(file);
              });
              return imageUrl;
            })
            .filter(Boolean)
        );

        await addImages(imageUrls);
      }}
      onKeyDown={async (event) => {
        const target = event.target as HTMLElement;
        if (target.nodeName === "INPUT" || target.nodeName === "TEXTAREA") {
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
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
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
