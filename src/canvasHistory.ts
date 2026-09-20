import { Canvas, FabricObject, util } from "fabric";
import {
  replaceCanvasObjects,
  serializeCanvas,
  type CanvasSnapshot,
} from "./fabricUtils";

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

// The timer groups continuous edits. Undo flushes the pending group so Redo
// always restores the actual canvas, including edits made in the last 250 ms.
export function createCanvasHistory(
  canvas: Canvas,
  onChange: () => void,
  onHistoryChange: (state: HistoryState) => void
) {
  let past: CanvasSnapshot[] = [];
  let future: CanvasSnapshot[] = [];
  let lastSnapshot = "";
  let pending = false;
  let replacing = false;
  let restoring = false;
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();

  const publish = () =>
    onHistoryChange({
      canUndo: !restoring && (past.length > 1 || pending),
      canRedo: !restoring && future.length > 0,
    });

  const record = () => {
    clearTimeout(timer);
    if (!pending) return;
    const snapshot = serializeCanvas(canvas);
    const json = JSON.stringify(snapshot);
    if (json !== lastSnapshot) {
      past = [...past.slice(-10), snapshot];
      lastSnapshot = json;
    }
    pending = false;
    publish();
  };

  const changed = () => {
    if (replacing || controller.signal.aborted) return;
    revision++;
    pending = true;
    future = [];
    clearTimeout(timer);
    timer = setTimeout(record, 250);
    onChange();
    publish();
  };

  const replace = (objects: FabricObject[]) => {
    replacing = true;
    try {
      replaceCanvasObjects(canvas, objects);
    } finally {
      replacing = false;
    }
    revision++;
  };

  const restore = async (direction: "undo" | "redo") => {
    if (restoring || controller.signal.aborted) return;
    record();
    const snapshot = direction === "undo" ? past.at(-2) : future[0];
    if (!snapshot) return;
    restoring = true;
    publish();
    const startedAt = revision;
    try {
      const objects = await util.enlivenObjects<FabricObject>(
        snapshot.objects,
        {
          signal: controller.signal,
        }
      );
      if (controller.signal.aborted || revision !== startedAt) {
        objects.forEach((object) => object.dispose());
        return;
      }
      replace(objects);
      if (direction === "undo") {
        future.unshift(past.pop()!);
      } else {
        past.push(future.shift()!);
      }
      lastSnapshot = JSON.stringify(snapshot);
      onChange();
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      restoring = false;
      if (!controller.signal.aborted) publish();
    }
  };

  const unsubscribe = [
    canvas.on("object:added", changed),
    canvas.on("object:removed", changed),
    canvas.on("object:modified", changed),
  ];

  return {
    undo: () => restore("undo"),
    redo: () => restore("redo"),
    notifyChange() {
      canvas.requestRenderAll();
      changed();
    },
    reset(objects: FabricObject[]) {
      clearTimeout(timer);
      replace(objects);
      const snapshot = serializeCanvas(canvas);
      past = [snapshot];
      future = [];
      lastSnapshot = JSON.stringify(snapshot);
      pending = false;
      onChange();
      publish();
    },
    dispose() {
      controller.abort();
      clearTimeout(timer);
      unsubscribe.forEach((off) => off());
    },
  };
}
