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
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
