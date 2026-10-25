import { ReactNode, useEffect, useRef } from "react";
import useCanvas from "./useCanvas";
import useTools from "./useTools";
import useEditorSession from "./useEditorSession";
import {
  detectFileType,
  ImageError,
  imageFileType,
  readImageFile,
  unreadableImage,
} from "./importUtils";
import {
  findImageUrl,
  isTextEntry,
  loadImageUrl,
  readPaste,
  writeClip,
} from "./canvasClipboard";
import useMessageDialog from "./useMessageDialog";

export default function CanvasInteractions({
  children,
  disabled = false,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { showMessage, messageDialog } = useMessageDialog();
  const {
    activeCanvas,
    activeCanvasType,
    bringForward,
    sendBackward,
    duplicate,
    deleteSelection,
    addImages,
    loadSkinFiles,
    copySelection,
    pasteSelection,
    undo,
    redo,
  } = useTools();
  const { clipboard } = useEditorSession();
  const { canvas, status, notifyChange, setDrawingMode } =
    useCanvas(activeCanvas);

  // Adds the files that hold a supported image, judged by their contents.
  const addImageFiles = async (
    files: File[],
    title: string,
    unsupported: string,
  ) => {
    try {
      const images = await Promise.all(
        files.map(async (file) =>
          // A dropped folder can't be read.
          (await imageFileType(file).catch(() => undefined))
            ? readImageFile(file)
            : null
        )
      );
      const urls = images.filter((url): url is string => url !== null);
      if (urls.length) {
        await addImages(urls);
      } else if (files.some((file) => file.type.startsWith("image/"))) {
        showMessage(unreadableImage, title);
      } else if (files.length) {
        showMessage(unsupported, title);
      }
    } catch (error) {
      showMessage(
        error instanceof ImageError ? error.message : unreadableImage,
        title,
      );
    }
  };

  const pasteImageUrl = async (url: string) => {
    try {
      await addImages([await loadImageUrl(url)]);
    } catch (error) {
      showMessage(
        error instanceof ImageError ? error.message : unreadableImage,
        "Unable to paste image",
      );
    }
  };

  // Text fields and dialogs keep their own copy and paste.
  const isEditorEvent = (event: Event) =>
    !disabled &&
    status === "ready" &&
    !document.querySelector("dialog[open]") &&
    !isTextEntry(event.target) &&
    !isTextEntry(document.activeElement);

  const handleCopy = (event: ClipboardEvent) => {
    // Selected page text copies as usual.
    const copied =
      isEditorEvent(event) && (document.getSelection()?.isCollapsed ?? true)
        ? copySelection(event.type === "cut")
        : null;
    if (copied) {
      clipboard.track(copied.id, writeClip(event, copied.id, copied.image));
    } else {
      clipboard.markReplaced();
    }
  };

  const handlePaste = (event: ClipboardEvent) => {
    if (!isEditorEvent(event) || !event.clipboardData) return;
    const { files, html, text } = readPaste(event.clipboardData);
    if (clipboard.holds(html)) {
      event.preventDefault();
      pasteSelection().catch(() =>
        showMessage("The copied layers couldn't be pasted.", "Unable to paste")
      );
    } else if (files.length) {
      // Skin files open only by dropping them, so a stray paste can't
      // replace the skin.
      event.preventDefault();
      void addImageFiles(files, "Unable to paste", "Only images can be pasted here.");
    } else {
      const url = findImageUrl(text);
      if (url) {
        event.preventDefault();
        void pasteImageUrl(url);
      }
    }
  };

  // Safari only enables Edit > Copy and Paste on a page that cancels these.
  const handleBeforeCopy = (event: Event) => {
    if (isEditorEvent(event) && canvas?.getActiveObject()) {
      event.preventDefault();
    }
  };
  const handleBeforePaste = (event: Event) => {
    if (isEditorEvent(event)) event.preventDefault();
  };

  const handlers = useRef({
    handleCopy,
    handlePaste,
    handleBeforeCopy,
    handleBeforePaste,
  });
  useEffect(() => {
    handlers.current = {
      handleCopy,
      handlePaste,
      handleBeforeCopy,
      handleBeforePaste,
    };
  });

  // Clipboard events go to the focused element, or in some browsers to the
  // selection or body, so listen on the document.
  useEffect(() => {
    let middleClickAt = -Infinity;
    const copy = (event: ClipboardEvent) => handlers.current.handleCopy(event);
    const paste = (event: ClipboardEvent) => {
      // Linux pastes its primary selection on middle-click. Input event
      // timestamps can be much older than the paste, so use the clock.
      if (performance.now() - middleClickAt < 300) return;
      handlers.current.handlePaste(event);
    };
    const beforeCopy = (event: Event) =>
      handlers.current.handleBeforeCopy(event);
    const beforePaste = (event: Event) =>
      handlers.current.handleBeforePaste(event);
    const pointer = (event: PointerEvent) => {
      if (event.button === 1) middleClickAt = performance.now();
    };
    // Another app or tab may copy something while this page is in the
    // background.
    const replaced = () => clipboard.markReplaced();
    const visibility = () => {
      if (document.visibilityState === "hidden") clipboard.markReplaced();
    };
    document.addEventListener("copy", copy);
    document.addEventListener("cut", copy);
    document.addEventListener("paste", paste);
    document.addEventListener("beforecopy", beforeCopy);
    document.addEventListener("beforecut", beforeCopy);
    document.addEventListener("beforepaste", beforePaste);
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("pointerup", pointer, true);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", replaced);
    return () => {
      document.removeEventListener("copy", copy);
      document.removeEventListener("cut", copy);
      document.removeEventListener("paste", paste);
      document.removeEventListener("beforecopy", beforeCopy);
      document.removeEventListener("beforecut", beforeCopy);
      document.removeEventListener("beforepaste", beforePaste);
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("pointerup", pointer, true);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", replaced);
    };
  }, [clipboard]);

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
      tabIndex={disabled ? -1 : 0}
      ref={ref}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={async (event) => {
        event.preventDefault();
        if (disabled) return;
        if (ref.current) {
          ref.current.focus();
        }
        const files = Array.from(event.dataTransfer.files);
        // Skins replace the editor; images add layers.
        const archives = files.filter((file) => {
          const type = detectFileType(file);
          return type === "skin" || type === "vl2" || type === "zip";
        });
        if (!archives.length) {
          await addImageFiles(
            files,
            "Unable to load files",
            "Only images and skin files can be added here.",
          );
          return;
        }
        try {
          await loadSkinFiles(archives);
        } catch (error) {
          showMessage(
            error instanceof Error
              ? error.message
              : "Unable to load these files",
            "Unable to load files",
          );
        }
      }}
      onPointerDown={(event) => {
        // Nothing here can select text, so a click doesn't clear an old
        // selection elsewhere on the page, which would take over Ctrl+C.
        if (
          event.currentTarget.contains(event.target as Node) &&
          !isTextEntry(event.target)
        ) {
          document.getSelection()?.removeAllRanges();
        }
      }}
      onKeyDown={async (event) => {
        if (disabled || !canvas || status !== "ready") return;
        const target = event.target as HTMLElement;
        if (
          event.defaultPrevented ||
          target.closest('input, textarea, select, [role="slider"], [role="combobox"], [role="listbox"]')
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
      {messageDialog}
    </div>
  );
}
