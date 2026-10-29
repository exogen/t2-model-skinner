import { afterEach, expect, test, vi } from "vitest";
import { Buffer } from "node:buffer";
import { ActiveSelection, filters, getEnv, util } from "fabric";
import {
  act,
  archive,
  canvas,
  editor,
  image,
  input,
  locked,
  until,
} from "./skinProjectTestUtils.mjs";
import { findImageUrl } from "./canvasClipboard";
import { readImageFile } from "./importUtils";

const { document, window } = getEnv();

afterEach(() => {
  delete globalThis.navigator.clipboard;
  delete globalThis.ClipboardItem;
  vi.restoreAllMocks();
  document.querySelectorAll("dialog").forEach((dialog) => dialog.remove());
});

function clipboardData({ files = [], html = "", text = "" } = {}) {
  const data = { "text/html": html, "text/plain": text };
  return {
    files,
    getData: (type) => data[type] ?? "",
    setData: (type, value) => {
      data[type] = value;
    },
    written: data,
  };
}

async function dispatch(type, data, target) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: data });
  await act(async () => target.dispatchEvent(event));
  return event;
}

const editorElement = (app) => app.host.querySelector(".CanvasInteractions");
const copy = (app, data = clipboardData()) =>
  dispatch("copy", data, editorElement(app)).then((event) => ({ event, data }));
const cut = (app, data = clipboardData()) =>
  dispatch("cut", data, editorElement(app)).then((event) => ({ event, data }));
const paste = (app, data) => dispatch("paste", data, editorElement(app));

function pngFile(name = "image.png", type = "image/png", options = {}) {
  const data = image(options).getElement().toDataURL("image/png").split(",")[1];
  return new window.File([Buffer.from(data, "base64")], name, { type });
}

function readBlob(blob, method = "readAsText") {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader[method](blob);
  });
}

function active(app) {
  return app.canvases[app.tools.activeCanvas].canvas;
}

async function select(canvas, ...objects) {
  await act(async () => {
    canvas.setActiveObject(
      objects.length > 1
        ? new ActiveSelection(objects, { canvas })
        : objects[0],
    );
  });
}

function stubAsyncClipboard(write) {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: { write },
    configurable: true,
  });
  globalThis.ClipboardItem = class {
    constructor(items) {
      this.items = items;
    }
  };
}

async function closeDialog() {
  await act(async () =>
    document.querySelector("dialog[open] footer button").click(),
  );
}

const alertText = () =>
  document.querySelector("dialog[open] [role='alert']")?.textContent;

test("pasting a screenshot adds it as a layer", async () => {
  const app = await editor();
  try {
    const current = active(app);
    const event = await paste(app, clipboardData({ files: [pngFile()] }));
    expect(event.defaultPrevented).toBe(true);
    await until(() => expect(current.getObjects()).toHaveLength(1));
    const layer = current.item(0);
    expect(layer.getSrc()).toMatch(/^data:image\/png;base64,/);
    expect(layer.getCenterPoint()).toMatchObject({ x: 64 + 256, y: 64 + 256 });
    expect(current.getActiveObject()).toBe(layer);
  } finally {
    await app.close();
  }
});

test("pasting an image file without a type still adds it", async () => {
  const app = await editor();
  try {
    const current = active(app);
    await paste(app, clipboardData({ files: [pngFile("Decal.png", "")] }));
    await until(() => expect(current.getObjects()).toHaveLength(1));
    expect(current.item(0).getSrc()).toMatch(/^data:image\/png;base64,/);
  } finally {
    await app.close();
  }
});

test("an untyped file is checked for image data", async () => {
  const app = await editor();
  try {
    const current = active(app);
    await paste(app, clipboardData({ files: [pngFile("Decal", "")] }));
    await until(() => expect(current.getObjects()).toHaveLength(1));
    expect(current.item(0).getSrc()).toMatch(/^data:image\/png;base64,/);
    const read = vi.spyOn(window.FileReader.prototype, "readAsDataURL");
    for (const notes of [
      new window.File(["hello"], "notes.txt", { type: "text/plain" }),
      new window.File(["hello"], "notes", { type: "" }),
    ]) {
      const event = await paste(app, clipboardData({ files: [notes] }));
      expect(event.defaultPrevented).toBe(true);
      await until(() =>
        expect(alertText()).toBe("Only images can be pasted here."),
      );
      await closeDialog();
    }
    expect(read).not.toHaveBeenCalled();
    expect(current.getObjects()).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test("an image that can't be decoded shows a short message", async () => {
  const app = await editor();
  try {
    const file = new window.File([Buffer.from("not an image")], "scan.tiff", {
      type: "image/tiff",
    });
    await paste(app, clipboardData({ files: [file] }));
    await until(() =>
      expect(alertText()).toBe(
        "This image couldn't be opened. Try saving it as a PNG.",
      ),
    );
    expect(active(app).getObjects()).toHaveLength(0);
  } finally {
    await app.close();
  }
});

test("text fields and dialogs keep their own paste", async () => {
  const app = await editor();
  const field = document.createElement("input");
  editorElement(app).append(field);
  try {
    const current = active(app);
    const fieldPaste = await dispatch(
      "paste",
      clipboardData({ files: [pngFile()] }),
      field,
    );
    expect(fieldPaste.defaultPrevented).toBe(false);
    const dialog = document.createElement("dialog");
    dialog.open = true;
    document.body.append(dialog);
    const dialogPaste = await paste(app, clipboardData({ files: [pngFile()] }));
    expect(dialogPaste.defaultPrevented).toBe(false);
    dialog.remove();
    await app.setInteractionsDisabled(true);
    const disabledPaste = await paste(
      app,
      clipboardData({ files: [pngFile()] }),
    );
    expect(disabledPaste.defaultPrevented).toBe(false);
    await app.settle();
    expect(current.getObjects()).toHaveLength(0);
  } finally {
    field.remove();
    await app.close();
  }
});

test("copy and paste duplicates the selection with an offset, as one undo step", async () => {
  const app = await editor();
  try {
    const current = active(app);
    const layer = image({ left: 100, top: 120, angle: 15, opacity: 0.5 });
    layer.filters.push(new filters.Brightness({ brightness: 0.2 }));
    layer.applyFilters();
    await act(async () => current.add(layer));
    await select(current, layer);
    await app.settle();
    const { event, data } = await copy(app);
    expect(event.defaultPrevented).toBe(true);
    expect(data.written["text/html"]).toMatch(
      /^<img src="data:image\/png;base64,[^"]+" data-t2-skinner-clip="[0-9a-f]{32}">$/,
    );
    expect(current.getObjects()).toHaveLength(1);

    const html = data.written["text/html"];
    expect((await paste(app, clipboardData({ html }))).defaultPrevented).toBe(
      true,
    );
    await until(() => expect(current.getObjects()).toHaveLength(2));
    const first = current.item(1);
    expect(first).toMatchObject({
      left: 120,
      top: 140,
      angle: 15,
      opacity: 0.5,
    });
    expect(first.filters).toHaveLength(1);
    expect(first.filters[0]).toBeInstanceOf(filters.Brightness);
    expect(current.getActiveObject()).toBe(first);

    await app.settle();
    await paste(app, clipboardData({ html }));
    await until(() => expect(current.getObjects()).toHaveLength(3));
    expect(current.item(2)).toMatchObject({ left: 140, top: 160 });

    await app.settle();
    await act(async () => app.tools.undo());
    expect(current.getObjects()).toHaveLength(2);
  } finally {
    await app.close();
  }
});

test("a selection pastes in place on the metallic canvas, in grayscale", async () => {
  const app = await editor();
  try {
    const color = active(app);
    const first = image({ left: 100, top: 120 });
    const second = image({
      left: 300,
      top: 200,
      angle: 30,
      scaleX: 2,
      scaleY: 2,
    });
    await act(async () => color.add(first, second));
    await select(color, first, second);
    const { data } = await copy(app);
    await act(async () => app.tools.setActiveCanvasType("metallic"));
    const metallic = active(app);
    expect(metallic).not.toBe(color);
    await paste(app, clipboardData({ html: data.written["text/html"] }));
    await until(() => expect(metallic.getObjects()).toHaveLength(2));
    expect(metallic.getActiveObjects()).toHaveLength(2);
    // Released from the selection, the layers are where they were copied.
    await act(async () => metallic.discardActiveObject());
    const [a, b] = metallic.getObjects();
    expect(a.left).toBeCloseTo(100);
    expect(a.top).toBeCloseTo(120);
    expect(b.left).toBeCloseTo(300);
    expect(b.top).toBeCloseTo(200);
    expect(b.angle).toBeCloseTo(30);
    expect(b.scaleX).toBeCloseTo(2);
    for (const object of [a, b]) {
      expect(
        object.filters.some((filter) => filter instanceof filters.Grayscale),
      ).toBe(true);
    }
  } finally {
    await app.close();
  }
});

test("cut leaves locked layers and pastes back in place", async () => {
  const app = await editor();
  try {
    const current = active(app);
    const kept = image({ left: 50, top: 50, ...locked });
    const moved = image({ left: 200, top: 220 });
    await act(async () => current.add(kept, moved));
    await select(current, kept, moved);
    await app.settle();
    const { event, data } = await cut(app);
    expect(event.defaultPrevented).toBe(true);
    expect(current.getObjects()).toEqual([kept]);
    await paste(app, clipboardData({ html: data.written["text/html"] }));
    await until(() => expect(current.getObjects()).toHaveLength(2));
    expect(current.item(1)).toMatchObject({ left: 200, top: 220 });
  } finally {
    await app.close();
  }
});

test("copy with nothing selected leaves the clipboard alone", async () => {
  const app = await editor();
  try {
    const { event, data } = await copy(app);
    expect(event.defaultPrevented).toBe(false);
    expect(data.written["text/html"]).toBe("");
  } finally {
    await app.close();
  }
});

test("copy writes a PNG and HTML token with the async clipboard API", async () => {
  const write = vi.fn(async () => {});
  stubAsyncClipboard(write);
  const app = await editor();
  try {
    const current = active(app);
    const layer = image({ left: 100, top: 120 });
    await act(async () => current.add(layer));
    await select(current, layer);
    const { event, data } = await copy(app);
    expect(event.defaultPrevented).toBe(true);
    // Mixing setData() with the async write would cancel it.
    expect(data.written["text/html"]).toBe("");
    expect(write).toHaveBeenCalledTimes(1);
    const [[item]] = write.mock.calls[0];
    expect(Object.keys(item.items)).toEqual(["image/png", "text/html"]);
    const png = await item.items["image/png"];
    expect(png.type).toBe("image/png");
    const html = await readBlob(await item.items["text/html"]);
    const src = /src="([^"]+)"/.exec(html)[1];
    const element = await new Promise((resolve, reject) => {
      const img = document.createElement("img");
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
    // One image pixel per texture pixel.
    expect([element.width, element.height]).toEqual([40, 30]);
    expect(html).toMatch(/data-t2-skinner-clip="[0-9a-f]{32}"/);

    // A screenshot taken after the write finished is pasted as an image.
    await act(async () => {});
    await paste(app, clipboardData({ files: [pngFile()] }));
    await until(() => expect(current.getObjects()).toHaveLength(2));
    expect(current.item(1).getSrc()).toMatch(/^data:image\/png/);
    expect(current.item(1).getCenterPoint()).toMatchObject({ x: 320, y: 320 });
  } finally {
    await app.close();
  }
});

test("a paste before the async write finishes still pastes the layers", async () => {
  let finish;
  const write = vi.fn(() => new Promise((resolve) => (finish = resolve)));
  stubAsyncClipboard(write);
  const app = await editor();
  try {
    const current = active(app);
    const layer = image({ left: 100, top: 120 });
    await act(async () => current.add(layer));
    await select(current, layer);
    await copy(app);
    // The clipboard still holds an older image.
    await paste(app, clipboardData({ files: [pngFile()] }));
    await until(() => expect(current.getObjects()).toHaveLength(2));
    expect(current.item(1)).toMatchObject({ left: 120, top: 140 });
  } finally {
    finish?.();
    await app.close();
  }
});

test.each([
  [
    "the window loses focus",
    () => window.dispatchEvent(new window.Event("blur")),
  ],
  [
    "the page is hidden",
    () => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      document.dispatchEvent(new window.Event("visibilitychange"));
      delete document.visibilityState;
    },
  ],
  [
    "something else on the page is copied",
    (app) => {
      const field = document.createElement("input");
      editorElement(app).append(field);
      field.dispatchEvent(
        new window.Event("copy", { bubbles: true, cancelable: true }),
      );
      field.remove();
    },
  ],
])("an unfinished write stops counting once %s", async (_, replace) => {
  let finish;
  stubAsyncClipboard(vi.fn(() => new Promise((resolve) => (finish = resolve))));
  const app = await editor();
  try {
    const current = active(app);
    const layer = image({ left: 100, top: 120 });
    await act(async () => current.add(layer));
    await select(current, layer);
    await copy(app);
    await act(async () => replace(app));
    // Without our token, the clipboard holds something else, like a screenshot.
    await paste(app, clipboardData({ files: [pngFile()] }));
    await until(() => expect(current.getObjects()).toHaveLength(2));
    expect(current.item(1).getCenterPoint()).toMatchObject({ x: 320, y: 320 });
  } finally {
    finish?.();
    await app.close();
  }
});

test("after leaving the page, the token still identifies the copy", async () => {
  const app = await editor();
  try {
    const current = active(app);
    const layer = image({ left: 100, top: 120 });
    await act(async () => current.add(layer));
    await select(current, layer);
    const { data } = await copy(app);
    const html = data.written["text/html"];
    await act(async () => window.dispatchEvent(new window.Event("blur")));
    // A different copy, like one from another tab, pastes as an image.
    await paste(
      app,
      clipboardData({
        files: [pngFile()],
        html: html.replace(/clip="[0-9a-f]+"/, 'clip="0123"'),
      }),
    );
    await until(() => expect(current.getObjects()).toHaveLength(2));
    expect(current.item(1).getCenterPoint()).toMatchObject({ x: 320, y: 320 });
    await paste(app, clipboardData({ files: [pngFile()], html }));
    await until(() => expect(current.getObjects()).toHaveLength(3));
    expect(current.item(2)).toMatchObject({ left: 120, top: 140 });
  } finally {
    await app.close();
  }
});

test("clicking the editor clears an old text selection so Ctrl+C copies layers", async () => {
  const app = await editor();
  const label = document.createElement("p");
  label.textContent = "Environment";
  document.body.append(label);
  try {
    const current = active(app);
    const layer = image({ left: 100, top: 120 });
    await act(async () => current.add(layer));
    await select(current, layer);
    const range = document.createRange();
    range.selectNodeContents(label);
    document.getSelection().addRange(range);
    expect((await copy(app)).event.defaultPrevented).toBe(false);
    await act(async () =>
      editorElement(app).dispatchEvent(
        new window.Event("pointerdown", { bubbles: true }),
      ),
    );
    expect(document.getSelection().isCollapsed).toBe(true);
    expect((await copy(app)).event.defaultPrevented).toBe(true);
  } finally {
    label.remove();
    await app.close();
  }
});

test.each(["pointerdown", "pointerup"])(
  "a middle-click paste is ignored after %s",
  async (type) => {
    const app = await editor();
    try {
      const pointer = new window.Event(type, { bubbles: true });
      Object.defineProperty(pointer, "button", { value: 1 });
      await act(async () => editorElement(app).dispatchEvent(pointer));
      const event = await paste(app, clipboardData({ files: [pngFile()] }));
      expect(event.defaultPrevented).toBe(false);
    } finally {
      await app.close();
    }
  },
);

test("Safari's Edit menu is enabled for the editor only", async () => {
  const app = await editor();
  const field = document.createElement("input");
  editorElement(app).append(field);
  const before = async (type, target = editorElement(app)) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    await act(async () => target.dispatchEvent(event));
    return event.defaultPrevented;
  };
  try {
    const current = active(app);
    expect(await before("beforepaste")).toBe(true);
    expect(await before("beforecopy")).toBe(false);
    const layer = image();
    await act(async () => current.add(layer));
    await select(current, layer);
    expect(await before("beforecopy")).toBe(true);
    expect(await before("beforecut")).toBe(true);
    expect(await before("beforecopy", field)).toBe(false);
    expect(await before("beforepaste", field)).toBe(false);
  } finally {
    field.remove();
    await app.close();
  }
});

test("copied layers survive a skin switch and scale to its resolution", async () => {
  const app = await editor();
  const source = canvas();
  try {
    const current = active(app);
    const layer = image({ left: 100, top: 120 });
    await act(async () => current.add(layer));
    await select(current, layer);
    const { data } = await copy(app);
    await app.load(await archive([input("base", source, null, [1024, 1024])]));
    expect(app.tools.sizeMultiplier).toBe(2);
    const target = active(app);
    expect(target).not.toBe(current);
    await paste(app, clipboardData({ html: data.written["text/html"] }));
    await until(() => expect(target.getObjects()).toHaveLength(1));
    expect(target.item(0)).toMatchObject({
      left: 64 + 2 * 36,
      top: 64 + 2 * 56,
      scaleX: 2,
      scaleY: 2,
    });
  } finally {
    await app.close();
    await source.dispose();
  }
});

test("layers pasted into a different texture layout are centered", async () => {
  const app = await editor("disc");
  try {
    const current = active(app);
    const layer = image({ left: 400, top: 400 });
    await act(async () => current.add(layer));
    await select(current, layer);
    const { data } = await copy(app);
    await act(async () => app.tools.setSelectedMaterialIndex(1));
    expect(app.tools.textureSize).toEqual([256, 256]);
    const target = active(app);
    await paste(app, clipboardData({ html: data.written["text/html"] }));
    await until(() => expect(target.getObjects()).toHaveLength(1));
    const center = target.item(0).getCenterPoint();
    expect(center.x).toBeCloseTo(64 + 128);
    expect(center.y).toBeCloseTo(64 + 128);
  } finally {
    await app.close();
  }
});

test("layers too big for a different texture layout shrink to fit", async () => {
  const app = await editor("disc");
  try {
    const current = active(app);
    const layer = image({ left: 100, top: 100, scaleX: 10, scaleY: 10 });
    await act(async () => current.add(layer));
    await select(current, layer);
    const { data } = await copy(app);
    await act(async () => app.tools.setSelectedMaterialIndex(1));
    const target = active(app);
    await paste(app, clipboardData({ html: data.written["text/html"] }));
    await until(() => expect(target.getObjects()).toHaveLength(1));
    const pasted = target.item(0);
    expect(pasted.getScaledWidth()).toBeCloseTo(256);
    expect(pasted.getScaledHeight()).toBeCloseTo(192);
    expect(pasted.getCenterPoint().x).toBeCloseTo(64 + 128);
    expect(pasted.getCenterPoint().y).toBeCloseTo(64 + 128);
  } finally {
    await app.close();
  }
});

test("pasted web page content is left alone", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const app = await editor();
  try {
    const src = image().getElement().toDataURL("image/png");
    const html = `<p>Look</p><img src="${src}"><img src="https://example.com/a.png">`;
    const event = await paste(app, clipboardData({ html, text: "Look" }));
    expect(event.defaultPrevented).toBe(false);
    await app.settle();
    expect(active(app).getObjects()).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test("pasting a skin file doesn't open it", async () => {
  const app = await editor();
  const source = canvas();
  try {
    const skin = app.skin;
    const file = new window.File(
      [await archive([input("base", source)])],
      "Mine.skin",
      { type: "" },
    );
    const event = await paste(app, clipboardData({ files: [file] }));
    expect(event.defaultPrevented).toBe(true);
    await until(() =>
      expect(alertText()).toBe("Only images can be pasted here."),
    );
    expect(app.skin).toBe(skin);
    expect(active(app).getObjects()).toHaveLength(0);
  } finally {
    await app.close();
    await source.dispose();
  }
});

test("images over the size limit are rejected", async () => {
  const app = await editor();
  try {
    const wide = document.createElement("canvas");
    wide.width = 8193;
    wide.height = 1;
    const wideFile = new window.File(
      [Buffer.from(wide.toDataURL("image/png").split(",")[1], "base64")],
      "wide.png",
      { type: "image/png" },
    );
    const heavyFile = pngFile();
    Object.defineProperty(heavyFile, "size", { value: 50 * 1024 * 1024 + 1 });
    for (const file of [wideFile, heavyFile]) {
      await paste(app, clipboardData({ files: [file] }));
      await until(() =>
        expect(alertText()).toBe(
          "This image is too big. The limit is 8192 × 8192 pixels and 50 MB.",
        ),
      );
      await closeDialog();
    }
    expect(active(app).getObjects()).toHaveLength(0);
  } finally {
    await app.close();
  }
});

test("a pasted image link is downloaded only if it's an image", async () => {
  const { Response, ReadableStream } = globalThis;
  const bytes = Buffer.from(
    image().getElement().toDataURL("image/png").split(",")[1],
    "base64",
  );
  const chunk = new Uint8Array(1024 * 1024);
  const png = { "content-type": "image/png" };
  const responses = {
    "decal.png": () => new Response(bytes, { headers: png }),
    "missing.png": () => new Response("", { status: 404 }),
    "page.png": () =>
      new Response("<p>Hi</p>", { headers: { "content-type": "text/html" } }),
    "bucket.png": () =>
      new Response(bytes, {
        headers: { "content-type": "application/octet-stream" },
      }),
    "fake.png": () => new Response("<p>Hi</p>", { headers: png }),
    "huge.png": () =>
      new Response(bytes, {
        headers: { ...png, "content-length": String(51 * 1024 * 1024) },
      }),
    "endless.png": () =>
      new Response(
        new ReadableStream({ pull: (controller) => controller.enqueue(chunk) }),
        { headers: png },
      ),
  };
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url) =>
      responses[String(url).split("/").pop()](),
    );
  const app = await editor();
  try {
    const current = active(app);
    await paste(app, clipboardData({ text: "https://example.com/decal.png" }));
    await until(() => expect(current.getObjects()).toHaveLength(1));
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/decal.png",
      expect.objectContaining({
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }),
    );
    for (const text of [
      "https://example.com/page",
      "http://example.com/decal.png",
    ]) {
      expect((await paste(app, clipboardData({ text }))).defaultPrevented).toBe(
        false,
      );
    }
    for (const [name, message] of [
      [
        "missing.png",
        "The pasted image couldn't be downloaded. Save it, then add the file.",
      ],
      [
        "page.png",
        "The pasted image couldn't be downloaded. Save it, then add the file.",
      ],
      [
        "bucket.png",
        "The pasted image couldn't be downloaded. Save it, then add the file.",
      ],
      ["fake.png", "This image couldn't be opened. Try saving it as a PNG."],
      [
        "huge.png",
        "This image is too big. The limit is 8192 × 8192 pixels and 50 MB.",
      ],
      [
        "endless.png",
        "This image is too big. The limit is 8192 × 8192 pixels and 50 MB.",
      ],
    ]) {
      await paste(app, clipboardData({ text: `https://example.com/${name}` }));
      await until(() => expect(alertText()).toBe(message));
      await closeDialog();
    }
    expect(fetch).toHaveBeenCalledTimes(7);
    expect(current.getObjects()).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test("a pasted data URL must hold a real image", async () => {
  const app = await editor();
  try {
    const current = active(app);
    await paste(
      app,
      clipboardData({ text: image().getElement().toDataURL("image/png") }),
    );
    await until(() => expect(current.getObjects()).toHaveLength(1));
    await paste(
      app,
      clipboardData({ text: "data:image/png;base64,PHA+SGk8L3A+" }),
    );
    await until(() =>
      expect(alertText()).toBe(
        "This image couldn't be opened. Try saving it as a PNG.",
      ),
    );
    expect(current.getObjects()).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test("finds an image in pasted text", () => {
  expect(findImageUrl(" data:image/png;base64,AAAA ")).toBe(
    "data:image/png;base64,AAAA",
  );
  expect(findImageUrl("https://a.test/photo.JPG?size=large")).toBe(
    "https://a.test/photo.JPG?size=large",
  );
  expect(findImageUrl("http://a.test/photo.png")).toBe(null);
  expect(findImageUrl("https://a.test/page.html")).toBe(null);
  expect(findImageUrl("https://a.test/scan.tiff")).toBe(null);
  expect(
    findImageUrl('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  ).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  expect(findImageUrl("Just text")).toBe(null);
});

test.each([
  [
    "a viewBox only",
    '<svg viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg"></svg>',
    16,
  ],
  [
    "no namespace, as copied from a web page",
    '<svg viewBox="0 0 24 16"><use xlink:href="#a"/><text>&nbsp;</text></svg>',
    16,
  ],
  [
    "an XML declaration and comment, as saved by Inkscape",
    '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Created with Inkscape -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,24,16"><style>a > b {}</style></svg>\n',
    16,
  ],
  [
    "its own width",
    '<svg width="24" viewBox="0 0 48 16" xmlns="http://www.w3.org/2000/svg"></svg>',
    8,
  ],
  [
    "its own height in pixels",
    '<svg height="8px" viewBox="0 0 48 16" xmlns="http://www.w3.org/2000/svg"></svg>',
    8,
  ],
])(
  "pasted SVG text with %s becomes a PNG layer at its size",
  async (_, text, height) => {
    const app = await editor();
    try {
      const current = active(app);
      expect((await paste(app, clipboardData({ text }))).defaultPrevented).toBe(
        true,
      );
      await until(() => expect(current.getObjects()).toHaveLength(1));
      expect(current.item(0).getSrc()).toMatch(/^data:image\/png;base64,/);
      expect(current.item(0)).toMatchObject({ width: 24, height });
    } finally {
      await app.close();
    }
  },
);

test("image files are read by their contents, not their label", async () => {
  const jpeg = Buffer.from(
    image().getElement().toDataURL("image/jpeg").split(",")[1],
    "base64",
  );
  expect(
    await readImageFile(new window.File([jpeg], "photo", { type: "" })),
  ).toMatch(/^data:image\/jpeg;base64,/);
  expect(
    await readImageFile(
      new window.File([jpeg], "photo.png", { type: "image/png" }),
    ),
  ).toMatch(/^data:image\/jpeg;base64,/);
  await expect(
    readImageFile(
      new window.File(["II*\0"], "scan.tif", { type: "image/tiff" }),
    ),
  ).rejects.toThrow("couldn't be opened");
  const svg = new window.File(
    ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 6"/>'],
    "icon.svg",
    { type: "" },
  );
  const png = await util.loadImage(await readImageFile(svg));
  expect(png.src).toMatch(/^data:image\/png;base64,/);
  expect([png.naturalWidth, png.naturalHeight]).toEqual([8, 6]);
});
