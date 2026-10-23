import { vi } from "vitest";
import { getEnv, setEnv } from "fabric";

// Reuse Fabric's DOM so its native canvas objects and React share one environment.
// Browser disposal is a no-op; Node disposal destroys elements that StrictMode reuses.
setEnv({ ...getEnv(), dispose() {} });
const { document, window } = getEnv();
vi.stubGlobal("document", document);
vi.stubGlobal("window", window);
vi.stubGlobal("FileReader", window.FileReader);
vi.stubGlobal("Blob", window.Blob);
vi.stubGlobal("MutationObserver", window.MutationObserver);
vi.stubGlobal("HTMLElement", window.HTMLElement);
vi.stubGlobal("Element", window.Element);
vi.stubGlobal("Node", window.Node);
vi.stubGlobal("Event", window.Event);
vi.stubGlobal("CustomEvent", window.CustomEvent);
vi.stubGlobal("MouseEvent", window.MouseEvent);
vi.stubGlobal("KeyboardEvent", window.KeyboardEvent);
vi.stubGlobal("FocusEvent", window.FocusEvent);
vi.stubGlobal("getComputedStyle", window.getComputedStyle.bind(window));
vi.stubGlobal("requestAnimationFrame", (callback) =>
  window.setTimeout(() => callback(window.performance.now()), 16),
);
vi.stubGlobal("cancelAnimationFrame", (id) => window.clearTimeout(id));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

// JSDOM does not implement native dialog presentation or its top layer.
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };
