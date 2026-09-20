import { expect, test, vi } from "vitest";
import { Buffer } from "node:buffer";
import JSZip from "jszip";
import React from "react";
import { createRoot } from "react-dom/client";
import { getEnv } from "fabric";
import Slider from "./Slider";
import {
  act,
  archive,
  canvas,
  editor,
  image,
  input,
} from "./skinProjectTestUtils.mjs";

const { document, window } = getEnv();

test("a burst of nudges remains a single debounced undo step", async () => {
  const source = canvas();
  source.add(image({ left: 100 }));
  const app = await editor();
  try {
    await app.load(await archive([input("base", source)]));
    const info = app.canvases[app.tools.activeCanvas];
    await act(async () => {
      for (let i = 0; i < 100; i++) {
        info.canvas.item(0).set("left", 101 + i);
        info.notifyChange();
      }
    });
    await app.settle();
    expect(app.tools.canUndo).toBe(true);
    await act(async () => app.tools.undo());
    expect(info.canvas.item(0).left).toBe(100);
    expect(app.tools.canUndo).toBe(false);
    await act(async () => app.tools.redo());
    expect(info.canvas.item(0).left).toBe(200);
  } finally {
    await app.close();
    await source.dispose();
  }
});

for (const previousEdit of [false, true]) {
  test(`undo before the debounce preserves redo (previous edit: ${previousEdit})`, async () => {
    const source = canvas();
    source.add(image({ left: 100 }));
    const app = await editor();
    try {
      await app.load(await archive([input("base", source)]));
      const info = app.canvases[app.tools.activeCanvas];
      if (previousEdit) {
        await act(async () => {
          info.canvas.item(0).set("left", 150);
          info.notifyChange();
        });
        await app.settle();
      }
      await act(async () => {
        info.canvas.item(0).set("left", 200);
        info.notifyChange();
        await app.tools.undo();
      });
      expect(info.canvas.item(0).left).toBe(previousEdit ? 150 : 100);
      await app.settle();
      await act(async () => app.tools.redo());
      expect(info.canvas.item(0).left).toBe(200);
    } finally {
      await app.close();
      await source.dispose();
    }
  });
}

test("a new edit invalidates redo before the debounce fires", async () => {
  const source = canvas();
  source.add(image({ left: 100 }));
  const app = await editor();
  try {
    await app.load(await archive([input("base", source)]));
    const info = app.canvases[app.tools.activeCanvas];
    await act(async () => {
      info.canvas.item(0).set("left", 150);
      info.notifyChange();
    });
    await app.settle();
    await act(async () => app.tools.undo());
    await act(async () => {
      info.canvas.item(0).set("left", 200);
      info.notifyChange();
      await app.tools.redo();
    });
    expect(info.canvas.item(0).left).toBe(200);
    expect(app.tools.canRedo).toBe(false);
  } finally {
    await app.close();
    await source.dispose();
  }
});

test("arrow keys and Delete respect locked layers", async () => {
  const app = await editor();
  try {
    const info = app.canvases[app.tools.activeCanvas];
    const object = image({ left: 100 });
    await act(async () => {
      info.canvas.add(object);
      info.canvas.setActiveObject(object);
    });
    await act(async () => app.tools.lockSelection());
    await app.key("ArrowRight");
    await app.key("Delete");
    expect(info.canvas.getObjects()).toHaveLength(1);
    expect(object.left).toBe(100);
    await act(async () => app.tools.unlockSelection());
    await app.key("ArrowRight");
    expect(object.left).toBe(101);
  } finally {
    await app.close();
  }
});

test("keyboard input in sliders and dropdowns does not edit selected artwork", async () => {
  const app = await editor();
  const controls = document.createElement("div");
  app.host.querySelector(".CanvasInteractions").append(controls);
  const root = createRoot(controls);
  let sliderValue = 10;
  try {
    const current = app.canvases[app.tools.activeCanvas].canvas;
    const artwork = image({ left: 100 });
    await act(async () => {
      current.add(artwork);
      current.setActiveObject(artwork);
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(Slider, {
            defaultValue: 10,
            onChange: (value) => {
              sliderValue = value;
            },
          }),
          React.createElement(
            "select",
            null,
            React.createElement("option", null, "Model")
          )
        )
      );
    });
    for (const target of [
      controls.querySelector('[role="slider"]'),
      controls.querySelector("select"),
    ]) {
      for (const [key, keyCode] of [["ArrowRight", 39], ["Delete", 46]]) {
        await act(async () =>
          target.dispatchEvent(
            new window.KeyboardEvent("keydown", {
              key,
              keyCode,
              bubbles: true,
              cancelable: true,
            })
          )
        );
        expect(artwork.left).toBe(100);
        expect(current.getObjects()).toContain(artwork);
      }
    }
    expect(sliderValue).toBe(11);
    await app.key("ArrowRight");
    expect(artwork.left).toBe(101);
  } finally {
    await act(async () => root.unmount());
    controls.remove();
    await app.close();
  }
});

async function dropFiles(app, files, assertLoaded) {
  const event = new window.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files } });
  await act(async () =>
    app.host.querySelector(".CanvasInteractions").dispatchEvent(event)
  );
  expect(event.defaultPrevented).toBe(true);
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 5));
    });
    assertLoaded();
  });
}

test.each(["image/png", "image/jpeg"])(
  "dropping %s adds a layer without replacing the skin",
  async (type) => {
    const app = await editor();
    const layer = image();
    const data = layer.getElement().toDataURL(type).split(",")[1];
    const file = new window.File([Buffer.from(data, "base64")], "Artwork", {
      type,
    });
    try {
      const current = app.canvases[app.tools.activeCanvas].canvas;
      await act(async () => current.add(image({ left: 333 })));
      await dropFiles(app, [file], () => {
        expect(current.getObjects()).toHaveLength(2);
      });
      expect(app.canvases[app.tools.activeCanvas].canvas).toBe(current);
      expect(current.item(0).left).toBe(333);
      expect(app.warrior.selectedSkinType).toBe("default");
    } finally {
      layer.dispose();
      await app.close();
    }
  }
);

test("dropping a .skin file restores the project, model and skin name", async () => {
  const source = canvas();
  source.add(image({ left: 450, angle: 25 }));
  const bytes = await archive([input("weapon_chaingun", source)], "chaingun");
  const file = new window.File([bytes], "Dropped.SKIN");
  const app = await editor();
  try {
    const previous = app.canvases[app.tools.activeCanvas].canvas;
    await act(async () => previous.add(image()));
    await dropFiles(app, [file], () => {
      expect(app.warrior.selectedModel).toBe("chaingun");
      expect(app.canvases[app.tools.activeCanvas].status).toBe("ready");
    });
    const current = app.canvases[app.tools.activeCanvas].canvas;
    expect(current).not.toBe(previous);
    expect(current.getObjects()).toHaveLength(1);
    expect(current.item(0).left).toBe(450);
    expect(current.item(0).angle).toBe(25);
    expect(app.tools.exportName).toBe("Dropped");
  } finally {
    await app.close();
    await source.dispose();
  }
});

test.each(["VL2", "zip"])(
  "dropping a .%s archive imports its skin",
  async (extension) => {
    const source = image();
    const zip = new JSZip();
    zip.file("textures/skins/Imported.lmale.png", source.getSrc().split(",")[1], {
      base64: true,
    });
    const file = new window.File(
      [await zip.generateAsync({ type: "nodebuffer" })],
      `Dropped.${extension}`
    );
    const app = await editor("lmale", { realCanvases: true });
    try {
      const previous = app.canvases[app.tools.activeCanvas].canvas;
      await act(async () => previous.add(image()));
      await dropFiles(app, [file], () => {
        expect(app.warrior.selectedSkin).toBe("Imported");
        expect(app.canvases[app.tools.activeCanvas].status).toBe("ready");
      });
      expect(app.warrior.selectedSkinType).toBe("import");
      expect(
        app.warrior.importedSkins.get("lmale").get("Imported").isComplete
      ).toBe(true);
      const current = app.canvases[app.tools.activeCanvas].canvas;
      expect(current).not.toBe(previous);
      expect(current.getObjects()).toHaveLength(1);
      expect(current.item(0).selectable).toBe(false);
    } finally {
      source.dispose();
      await app.close();
    }
  }
);

test.each(["skin", "vl2"])(
  "a failed .%s drop leaves existing artwork intact",
  async (extension) => {
    const app = await editor();
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    try {
      const current = app.canvases[app.tools.activeCanvas].canvas;
      const original = image({ left: 333 });
      await act(async () => {
        current.add(original);
        app.tools.setExportName("Current Skin");
      });
      await dropFiles(
        app,
        [new window.File(["invalid archive"], `Broken.${extension}`)],
        () => expect(alert).toHaveBeenCalledOnce()
      );
      expect(app.canvases[app.tools.activeCanvas].canvas).toBe(current);
      expect(current.item(0)).toBe(original);
      expect(app.tools.exportName).toBe("Current Skin");
    } finally {
      alert.mockRestore();
      await app.close();
    }
  }
);
