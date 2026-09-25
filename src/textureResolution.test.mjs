import { Buffer } from "node:buffer";
import { expect, test, vi } from "vitest";
import { ActiveSelection, config, getEnv } from "fabric";
import { PNG } from "pngjs";
import JSZip from "jszip";
import {
  act, archive, canvas, downloads, editor, image, input, saved,
} from "./skinProjectTestUtils.mjs";
import { readSkinProjectZip } from "./skinProjectUtils";
import { detectTextureSizeMultiplier } from "./textureResolution";

const { document, window } = getEnv();

function texture(width, height = width) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const context = element.getContext("2d");
  context.fillStyle = "#cc5533";
  context.fillRect(0, 0, width, height);
  // Adjacent single pixels expose accidental downsampling, including at edges.
  context.fillStyle = "#55ccff";
  context.fillRect(width - 1, height - 1, 1, 1);
  context.fillRect(321, 234, 1, 1);
  const url = element.toDataURL();
  const bytes = Buffer.from(url.split(",")[1], "base64");
  return { url, bytes, buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

async function ready(app) {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 5));
    });
    expect(Object.values(app.canvases).length).toBeGreaterThan(0);
    expect(Object.values(app.canvases).every(({ status }) => status === "ready")).toBe(true);
  }, { timeout: 5000 });
}

function expectDisplaySize(app, width = 512, height = width) {
  const current = app.canvases[app.tools.activeCanvas].canvas;
  const padding = parseFloat(app.host.querySelector('.CanvasContainer[data-active="true"]').style.padding);
  for (const element of [current.lowerCanvasEl, current.upperCanvasEl, current.wrapperEl]) {
    expect(parseFloat(element.style.width) + padding * 2).toBe(width + 128);
    expect(parseFloat(element.style.height) + padding * 2).toBe(height + 128);
  }
}

test.each([1, 2, 4])("selected %ix textures retain their pixels at the standard display size", async (scale) => {
  const original = texture(512 * scale);
  const app = await editor("lfemale", {
    realCanvases: true,
    initialImageUrls: { base: [original.url] },
  });
  try {
    expect(app.tools.sizeMultiplier).toBe(scale);
    expectDisplaySize(app);
    expect(app.canvases[app.tools.activeCanvas].canvas.item(0).scaleX).toBe(1);
    await act(async () => app.tools.exportSkin({ name: "Selected", format: "png" }));
    const exported = PNG.sync.read(Buffer.from(downloads.at(-1).data.split(",")[1], "base64"));
    expect([exported.width, exported.height]).toEqual([512 * scale, 512 * scale]);
    expect(exported.data.equals(PNG.sync.read(original.bytes).data)).toBe(true);
    const preview = PNG.sync.read(Buffer.from(app.skin.getColorImageUrl("base", 0).split(",")[1], "base64"));
    expect(preview.width).toBe(512 * scale);
  } finally {
    await app.close();
  }
});

test("Load a Skin detects an HD PNG, preserves project saves, and resets on an SD selection", async () => {
  const original = texture(1024);
  const app = await editor("lfemale", { realCanvases: true });
  try {
    await act(async () => app.tools.loadSkinFiles([
      new window.File([original.bytes], "Aurora.lfemale.png", { type: "image/png" }),
    ]));
    await ready(app);
    expect(app.warrior.selectedSkinType).toBe("import");
    expect(app.tools.sizeMultiplier).toBe(2);
    expectDisplaySize(app);
    await act(async () => app.tools.exportSkinProject("Aurora"));
    const bytes = await saved.at(-1).zip.generateAsync({ type: "nodebuffer" });
    const project = await readSkinProjectZip(bytes);
    expect(project.materials.base.textureSize).toEqual([1024, 1024]);
    await app.load(bytes);
    expect(app.tools.sizeMultiplier).toBe(2);
    expectDisplaySize(app);
    await act(async () => app.tools.exportSkin({ name: "Aurora", format: "vl2" }));
    const exportedZip = await JSZip.loadAsync(await new Promise((resolve) => {
      const reader = new window.FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsArrayBuffer(downloads.at(-1).data);
    }));
    const png = PNG.sync.read(await exportedZip.file("textures/skins/Aurora.lfemale.png").async("nodebuffer"));
    expect(png.data.equals(PNG.sync.read(original.bytes).data)).toBe(true);
    await act(async () => {
      app.warrior.setSelectedSkinType("custom");
      app.warrior.setSelectedSkin("Standard");
      app.warrior.setSkinImageUrls({ base: [texture(512).url] });
    });
    await ready(app);
    expect(app.tools.sizeMultiplier).toBe(1);
    expectDisplaySize(app);
  } finally {
    await app.close();
  }
});

test("HD projects keep layer coordinates and map displayed pointer positions to texture pixels", async () => {
  const source = canvas();
  source.add(image({ left: 864, top: 721 }));
  const app = await editor("lfemale", { realCanvases: true });
  try {
    await app.load(await archive([input("base", source, null, [1024, 1024])], "lfemale"));
    expect(app.tools.sizeMultiplier).toBe(2);
    expectDisplaySize(app);
    const current = app.canvases[app.tools.activeCanvas].canvas;
    expect(current.item(0).left).toBe(864);
    expect(current.item(0).top).toBe(721);
    const rect = { left: 100, top: 200, width: 576, height: 576, right: 676, bottom: 776 };
    vi.spyOn(current.upperCanvasEl, "getBoundingClientRect").mockReturnValue(rect);
    vi.spyOn(current.lowerCanvasEl, "getBoundingClientRect").mockReturnValue(rect);
    const point = current.getScenePoint(new window.MouseEvent("mousemove", {
      clientX: 100 + 32 + 100,
      clientY: 200 + 32 + 150,
    }));
    expect([point.x, point.y]).toEqual([64 + 200, 64 + 300]);
  } finally {
    await app.close();
    await source.dispose();
  }
});

test("late HD detection cannot resize a newer skin or discard its edits", async () => {
  let resolve;
  const slow = new Promise((done) => { resolve = done; });
  const standard = texture(512);
  const app = await editor("lmale", {
    realCanvases: true,
    initialImageUrls: { base: ["slow.png"] },
    imageLoad: (url) => url === "slow.png" ? slow : Promise.resolve(standard.buffer),
    waitForInitialCanvases: false,
  });
  try {
    expect(app.canvases[app.tools.activeCanvas].status).toBe("loading");
    await expect(app.tools.exportSkinProject("unfinished")).rejects.toThrow();
    await act(async () => app.warrior.setSkinImageUrls({ base: ["standard.png"] }));
    await ready(app);
    const current = app.canvases[app.tools.activeCanvas].canvas;
    await act(async () => current.add(image({ left: 444 })));
    await act(async () => resolve(texture(1024).buffer));
    expect(app.tools.sizeMultiplier).toBe(1);
    expect(app.canvases[app.tools.activeCanvas].canvas).toBe(current);
    expect(current.item(1).left).toBe(444);
  } finally {
    await app.close();
  }
});

test("resolution detection uses material dimensions, all frames, and fallback textures", async () => {
  const hd = texture(1024, 512);
  const load = vi.fn(async () => hd.buffer);
  expect(await detectTextureSizeMultiplier("vehicle_grav_scout", {
    Vehicle_grav_scout: ["body.png"],
  }, {}, load)).toBe(2);
  expect(await detectTextureSizeMultiplier("disc", {
    dcase00: ["sd.png", "hd.png"],
  }, {}, async (url) => texture(url === "hd.png" ? 512 : 256).buffer)).toBe(2);
  expect(await detectTextureSizeMultiplier("shocklance", {
    weapon_shocklance: ["Neon/weapon_shocklance.png"],
  }, {}, async () => texture(512, 512).buffer)).toBe(2);
  expect(await detectTextureSizeMultiplier("lmale", { base: ["missing.png"] }, {
    base: ["fallback.png"],
  }, async (url) => {
    if (url === "missing.png") throw new Error("404");
    return texture(1024).buffer;
  })).toBe(2);
});

test.each([[1536, 1536], [1024, 768], [4096, 4096]])(
  "oversized %i × %i textures fail visibly instead of exporting at 1×",
  async (width, height) => {
    // Detection only needs a header; an unsupported source must never decode.
    const header = texture(1).buffer.slice(0, 24);
    const view = new DataView(header);
    view.setUint32(16, width);
    view.setUint32(20, height);
    const app = await editor("lmale", {
      realCanvases: true,
      initialImageUrls: { base: ["unsupported.png"] },
      imageLoad: async () => header,
    });
    try {
      expect(app.host.textContent).toContain(`Unsupported texture size: ${width} × ${height}`);
      expect(app.canvases[app.tools.activeCanvas].status).toBe("error");
      await expect(app.tools.exportSkin({ format: "png" })).rejects.toThrow();
      expect(downloads).toHaveLength(0);
    } finally {
      await app.close();
    }
  }
);

test.each([2, 4])("%i× selection handles stay usable on Retina displays and after undo", async (scale) => {
  const originalDpr = config.devicePixelRatio;
  config.devicePixelRatio = 2;
  const app = await editor("lmale", {
    realCanvases: true,
    initialImageUrls: { base: [texture(512 * scale).url] },
  });
  try {
    const current = app.canvases[app.tools.activeCanvas].canvas;
    // HD already supplies at least two source pixels per CSS pixel.
    expect(current.lowerCanvasEl.width).toBe(512 * scale + 128);
    const first = image(), second = image({ left: 300 });
    await act(async () => {
      current.add(first, second);
      current.setActiveObject(first);
    });
    const expectControls = (object) => {
      expect(object.cornerSize / scale).toBe(9);
      expect(object.touchCornerSize / scale).toBe(24);
      expect(object.borderScaleFactor / scale).toBe(1);
      expect(object.controls.mtr.offsetY / scale).toBe(-40);
    };
    expectControls(first);
    await act(async () => {
      current.setActiveObject(new ActiveSelection([first, second], { canvas: current }));
    });
    expectControls(current.getActiveObject());
    await act(async () => app.tools.undo());
    await act(async () => app.tools.redo());
    expectControls(current.item(1));
    expectControls(current.item(2));
    expectDisplaySize(app);
  } finally {
    await app.close();
    config.devicePixelRatio = originalDpr;
  }
});
