import { expect, test } from "vitest";
import JSZip from "jszip";
import * as fabric from "fabric";
import {
  act,
  archive,
  canvas,
  editor,
  filteredImage,
  image,
  input,
  locked,
  pixel,
  saved,
  workers,
} from "./skinProjectTestUtils.mjs";

import * as projects from "./skinProjectUtils";
import {
  serializeCanvas,
  replaceCanvasObjects,
  SERIALIZED_PROPERTIES,
} from "./fabricUtils";
import config, { isTextureSourceMaterial } from "./models";

async function roundTrip(color, metallic = null) {
  const project = await projects.readSkinProjectZip(
    await archive([input("base", color, metallic)])
  );
  const prepared = await projects.prepareSkinProject(project);
  return prepared.base;
}

function assertObjectsEqual(actual, expected) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) {
    const serialized = actual[i].toObject(SERIALIZED_PROPERTIES);
    // Image sources are restored as data URLs; compare layer properties separately.
    expect({ ...serialized, src: undefined }).toStrictEqual({
      ...expected[i],
      src: undefined,
    });
  }
}

test("multi-selection retains canvas positions, rotation, scale, skew and source objects", async () => {
  const c = canvas();
  c.add(
    image({ left: 100, top: 120, skewX: 25, skewY: 10 }),
    image({ left: 300, top: 240, flipX: true })
  );
  const selection = new fabric.ActiveSelection(c.getObjects(), { canvas: c });
  c.setActiveObject(selection);
  selection.set({ angle: 37, scaleX: 1.7, scaleY: 0.8 });
  const expected = c.toObject(SERIALIZED_PROPERTIES).objects;
  const result = await roundTrip(c);
  assertObjectsEqual(result.color, expected);
  expect(c.getActiveObject()).toBe(selection);
  expect(c.toObject(SERIALIZED_PROPERTIES).objects).toStrictEqual(expected);
  await c.dispose();
});

test("ordered filters, opacity, crop and image pixels survive repeated saves", async () => {
  const c = canvas();
  const object = filteredImage();
  object.set({
    cropX: 4,
    cropY: 3,
    width: 25,
    height: 20,
    originX: "center",
    originY: "center",
  });
  c.add(object);
  const before = pixel(object);
  for (let iteration = 0; iteration < 3; iteration++) {
    const result = await roundTrip(c);
    assertObjectsEqual(result.color, serializeCanvas(c).objects);
    expect(pixel(result.color[0])).toStrictEqual(before);
    replaceCanvasObjects(c, result.color);
  }
  await c.dispose();
});

test("metallic images and selected, locked brush strokes retain their order and transforms", async () => {
  const c = canvas(),
    m = canvas();
  const stroke = new fabric.Path("M 10 10 L 40 30", {
    stroke: "#ffffff",
    strokeWidth: 8,
    ...locked,
  });
  m.add(
    image({ selectable: false, ...locked }),
    stroke,
    image(),
    new fabric.Path("M 20 20 L 30 40", { stroke: "#777777", strokeWidth: 4 })
  );
  const selection = new fabric.ActiveSelection([stroke, m.item(2)], {
    canvas: m,
  });
  m.setActiveObject(selection);
  selection.set({ angle: 30, scaleX: 2 });
  const expected = serializeCanvas(m).objects;
  const result = await roundTrip(c, m);
  assertObjectsEqual(result.metallic, expected);
  expect(result.metallic[1].lockMovementX).toBe(true);
  await c.dispose();
  await m.dispose();
});

test("all canvas snapshots are captured before asynchronous image encoding", async () => {
  const c = canvas();
  c.add(image({ left: 100 }));
  const exporting = projects.createSkinProjectZip(
    projects.captureSkinProject([input("base", c)])
  );
  c.item(0).set({ left: 400, angle: 90 });
  const project = await projects.readSkinProjectZip(
    await (await exporting).generateAsync({ type: "nodebuffer" })
  );
  expect(project.materials.base.color.objects[0].left).toBe(100);
  expect(project.materials.base.color.objects[0].angle).toBe(0);
  await c.dispose();
});

test("version 1 archives keep available layers, filters, strokes and inferred resolution", async () => {
  const z = new JSZip();
  const original = image();
  z.file("weapon_chaingun/layer.png", original.getSrc().split(",")[1], {
    base64: true,
  });
  z.file(
    "weapon_chaingun/material.json",
    JSON.stringify({
      version: 1,
      textureSize: [1024, 1024],
      objects: [
        {
          filename: "layer.png",
          zIndex: 0,
          left: 80,
          top: 120,
          angle: 15,
          scaleX: 2,
          scaleY: 2,
          flipX: true,
          flipY: false,
          locked: true,
          filterSettings: { brightness: 0.2, contrast: 0.4, opacity: 0.6 },
        },
      ],
      metallicStrokes: [
        {
          ...new fabric.Path("M 0 0 L 10 10", {
            stroke: "#ffffff",
          }).toObject(),
          zIndex: 0,
        },
      ],
    })
  );
  const project = await projects.readSkinProjectZip(
    await z.generateAsync({ type: "nodebuffer" })
  );
  expect(projects.getProjectTarget(project, "lmale")).toStrictEqual({
    model: "chaingun",
    sizeMultiplier: 2,
  });
  const prepared = await projects.prepareSkinProject(project);
  expect(prepared.weapon_chaingun.color[0].opacity).toBe(0.6);
  expect(prepared.weapon_chaingun.color[0].lockMovementX).toBe(true);
  expect(prepared.weapon_chaingun.metallic[0].type).toBe("path");
});

for (const scenario of [
  "inactive color",
  "inactive material",
  "inactive frame",
]) {
  test(`filters remain editable after opening on ${scenario}`, async () => {
    const model =
      scenario === "inactive material"
        ? "vehicle_air_bomber"
        : scenario === "inactive frame"
          ? "disc"
          : "lmale";
    const key =
      scenario === "inactive material"
        ? "vehicle_air_bomber2"
        : scenario === "inactive frame"
          ? "dcase00-frame3"
          : "base";
    const c = canvas();
    c.add(filteredImage());
    const bytes = await archive(
      [
        input(
          key,
          c,
          null,
          scenario === "inactive frame"
            ? [256, 256]
            : scenario === "inactive material"
              ? [256, 512]
              : [512, 512]
        ),
      ],
      model
    );
    const app = await editor(model);
    await act(async () => app.tools.setActiveCanvasType("metallic"));
    await app.load(bytes);
    await act(async () => app.tools.setActiveCanvasType("color"));
    if (scenario === "inactive material")
      await act(async () => app.tools.setSelectedMaterialIndex(2));
    if (scenario === "inactive frame") {
      await act(async () => app.tools.setSelectedMaterialIndex(1));
      await act(async () => app.tools.setSelectedFrameIndex(3));
    }
    expect(app.tools.brightness).toBe(0.2);
    expect(app.tools.contrast).toBe(0.4);
    expect(app.tools.opacity).toBe(0.65);
    await act(async () => app.tools.setSaturation(0.3));
    const object = app.canvases[app.tools.activeCanvas].canvas.item(0);
    expect(object.filters.map((filter) => filter.type)).toStrictEqual([
      "Contrast",
      "Brightness",
      "Saturation",
    ]);
    expect(app.tools.brightness).toBe(0.2);
    expect(app.tools.opacity).toBe(0.65);
    await app.close();
    await c.dispose();
  });
}

test("opening a project restores the model and dimensions before installing layers", async () => {
  const c = canvas();
  c.add(image({ left: 864, top: 864 }));
  const bytes = await archive(
    [input("base", c, null, [1024, 1024])],
    "hmale"
  );
  const app = await editor("disc", { strict: true });
  await app.load(bytes);
  expect(app.warrior.selectedModel).toBe("hmale");
  expect(app.tools.sizeMultiplier).toBe(2);
  expect(app.tools.textureSize).toStrictEqual([1024, 1024]);
  expect(app.canvases[app.tools.activeCanvas].canvas.width).toBe(1152);
  expect(app.canvases[app.tools.activeCanvas].canvas.item(0).left).toBe(864);
  const lateBackground = image();
  await app.setBackground(lateBackground.getSrc());
  expect(
    app.canvases[app.tools.activeCanvas].canvas.getObjects().length
  ).toBe(1);
  expect(app.canvases[app.tools.activeCanvas].canvas.item(0).left).toBe(864);
  await app.close();
  await c.dispose();
});

test("empty project canvases replace both previous backgrounds", async () => {
  const empty = canvas();
  const app = await editor();
  for (const info of Object.values(app.canvases))
    await act(async () =>
      info.canvas.add(image({ selectable: false, ...locked }))
    );
  await app.load(await archive([input("base", empty)]));
  expect(
    Object.values(app.canvases).every(
      ({ canvas }) => canvas.getObjects().length === 0
    )
  ).toBeTruthy();
  await app.close();
  await empty.dispose();
});

test("a corrupt image in a later material leaves the model and all existing artwork intact", async () => {
  const c = canvas();
  c.add(image());
  const zip = await projects.createSkinProjectZip(
    projects.captureSkinProject(
      [input("weapon_disc", c), input("dcase00-frame0", c, null, [256, 256])],
      "disc",
      "Corrupt Skin"
    )
  );
  zip.file("dcase00-frame0/image-0", "not an image");
  const app = await editor("lmale");
  const original = image({ left: 333 });
  await act(async () => {
    app.canvases[app.tools.activeCanvas].canvas.add(original);
    app.tools.setExportName("Current Skin");
  });
  await expect(
    app.tools.loadSkinProject(await zip.generateAsync({ type: "nodebuffer" }))
  ).rejects.toThrow();
  expect(app.warrior.selectedModel).toBe("lmale");
  expect(app.tools.exportName).toBe("Current Skin");
  expect(app.canvases[app.tools.activeCanvas].canvas.item(0)).toBe(original);
  await app.close();
  await c.dispose();
});

test("Duplicate keeps copies as canvas layers through deselection and project export", async () => {
  const app = await editor();
  const c = app.canvases[app.tools.activeCanvas].canvas;
  await act(async () => {
    c.add(image(), image({ left: 300 }));
    c.setActiveObject(
      new fabric.ActiveSelection(c.getObjects(), { canvas: c })
    );
  });
  await act(async () => app.tools.duplicate());
  expect(c.getObjects().length).toBe(4);
  expect(
    c.getObjects().every((object) => object instanceof fabric.FabricImage)
  ).toBeTruthy();
  const expected = c.toObject(SERIALIZED_PROPERTIES).objects;
  await act(async () => app.tools.exportSkinProject("duplicates"));
  const project = await projects.readSkinProjectZip(
    await saved.at(-1).zip.generateAsync({ type: "nodebuffer" })
  );
  const restored = await projects.prepareSkinProject(project);
  assertObjectsEqual(restored.base.color, expected);
  restored.base.color.forEach((object) => object.dispose());
  await act(async () => c.discardActiveObject());
  expect(c.getObjects().length).toBe(4);
  await app.close();
});

test("undo and redo preserve filters, locks and their controls after a project load", async () => {
  const c = canvas();
  c.add(filteredImage());
  const app = await editor();
  await app.load(await archive([input("base", c)]));
  await act(async () => app.tools.setBrightness(0.5));
  await app.settle();
  expect(app.tools.canUndo).toBe(true);
  await act(async () => app.tools.undo());
  await app.settle();
  expect(app.tools.brightness).toBe(0.2);
  expect(app.tools.canRedo).toBe(true);
  await act(async () => app.tools.redo());
  await app.settle();
  expect(app.tools.brightness).toBe(0.5);
  expect(
    app.canvases[app.tools.activeCanvas].canvas.item(0).lockMovementX
  ).toBe(true);
  await app.close();
  await c.dispose();
});

test("all animation frames and rectangular material sizes survive a project reopen", async () => {
  const app = await editor("disc");
  for (const [index, info] of Object.values(app.canvases).entries())
    await act(async () => info.canvas.add(image({ left: 80 + index })));
  await act(async () => app.tools.exportSkinProject("disc"));
  const before = Object.fromEntries(
    Object.entries(app.canvases).map(([id, info]) => [
      id,
      info.canvas.item(0).left,
    ])
  );
  await app.load(
    await saved.at(-1).zip.generateAsync({ type: "nodebuffer" })
  );
  const after = Object.fromEntries(
    Object.entries(app.canvases).map(([id, info]) => [
      id,
      info.canvas.item(0).left,
    ])
  );
  expect(after).toStrictEqual(before);
  await app.close();
});

test("an edit made while undo is decoding images is not overwritten", async () => {
  const c = canvas();
  c.add(filteredImage());
  const app = await editor();
  await app.load(await archive([input("base", c)]));
  await act(async () => app.tools.setBrightness(0.5));
  await app.settle();
  await act(async () => {
    const undoing = app.tools.undo();
    app.tools.setContrast(0.7);
    await undoing;
  });
  expect(app.tools.brightness).toBe(0.5);
  expect(app.tools.contrast).toBe(0.7);
  expect(app.tools.canRedo).toBe(false);
  await app.close();
  await c.dispose();
});

test("old projects leave omitted fixed materials on their default canvases", async () => {
  const original = image();
  const zip = new JSZip();
  zip.file("weapon_plasma10/layer.png", original.getSrc().split(",")[1], {
    base64: true,
  });
  zip.file(
    "weapon_plasma10/material.json",
    JSON.stringify({
      version: 1,
      textureSize: [512, 512],
      objects: [
        {
          filename: "layer.png",
          zIndex: 0,
          left: 200,
          top: 200,
          angle: 0,
          scaleX: 1,
          scaleY: 1,
          flipX: false,
          flipY: false,
          locked: false,
        },
      ],
    })
  );
  const defaults = Object.fromEntries(
    config.materials.plasmathrower.map((material) => [
      material.file ?? material.name,
      [original.getSrc()],
    ])
  );
  const app = await editor("plasmathrower", {
    realCanvases: true,
    initialImageUrls: defaults,
    defaultImageUrls: defaults,
  });
  const fixedCanvas = app.canvases["weapon_plasma1:color:0:1"].canvas;
  const detail = image({ left: 444 });
  await act(async () => fixedCanvas.add(detail));
  await app.load(await zip.generateAsync({ type: "nodebuffer" }));
  const restoredFixed = app.canvases["weapon_plasma1:color:0:1"].canvas;
  expect(restoredFixed).not.toBe(fixedCanvas);
  expect(restoredFixed.getObjects()).toHaveLength(1);
  expect(restoredFixed.item(0).selectable).toBe(false);
  expect(app.canvases["weapon_plasma10:color:0:1"].canvas.item(0).left).toBe(
    200
  );
  await act(async () => app.tools.exportSkinProject("upgraded"));
  const upgraded = await projects.readSkinProjectZip(
    await saved.at(-1).zip.generateAsync({ type: "nodebuffer" })
  );
  expect(upgraded.materials.weapon_plasma1.color.objects).toHaveLength(1);
  expect(upgraded.materials.weapon_plasma1.color.objects[0].selectable).toBe(
    false
  );
  await app.close();
});

test("fixed duplicate materials cannot overwrite restored preview textures", () => {
  const plasma = config.materials.plasmathrower;
  expect(
    isTextureSourceMaterial(
      plasma.find(({ name }) => name === "weapon_plasma10"),
      "plasmathrower"
    )
  ).toBe(true);
  expect(
    isTextureSourceMaterial(
      plasma.find(({ name }) => name === "weapon_plasma1"),
      "plasmathrower"
    )
  ).toBe(false);
  const scout = config.materials.vehicle_grav_scout;
  expect(
    isTextureSourceMaterial(
      scout.find(({ name }) => name === "Vehicle_grav_scout_windshield"),
      "vehicle_grav_scout"
    )
  ).toBe(true);
});

test("late metallic processing cannot overwrite the newly opened project preview", async () => {
  const pending = [];
  const originalConvert = workers.convertGrayscaleImageUrlToMetallicRoughness;
  workers.convertGrayscaleImageUrlToMetallicRoughness = (url) =>
    new Promise((resolve) => pending.push({ url, resolve }));
  const c = canvas(),
    m = canvas();
  m.add(image());
  const app = await editor("lmale", { realCanvases: true });
  try {
    await app.load(await archive([input("base", c, m)]));
    expect(pending.length > 1).toBeTruthy();
    const latest = pending.pop();
    await act(async () => latest.resolve("new preview"));
    expect(app.skin.getSkinImages("base").metallicImageUrl[0]).toBe(
      "new preview"
    );
    await act(async () =>
      pending.forEach(({ resolve }) => resolve("old preview"))
    );
    expect(app.skin.getSkinImages("base").metallicImageUrl[0]).toBe(
      "new preview"
    );
  } finally {
    workers.convertGrayscaleImageUrlToMetallicRoughness = originalConvert;
    await app.close();
    await c.dispose();
    await m.dispose();
  }
});

test("saving and reopening a texture keeps artwork aligned with the padded atlas", async () => {
  const element = fabric.getEnv().document.createElement("canvas");
  element.width = element.height = 512;
  const context = element.getContext("2d");
  context.fillStyle = "#346789";
  context.fillRect(0, 0, 512, 512);
  context.fillStyle = "#ff0000";
  context.fillRect(0, 0, 64, 64);
  context.fillStyle = "#00ff00";
  context.fillRect(448, 448, 64, 64);
  const url = element.toDataURL();
  const app = await editor("lmale", {
    realCanvases: true,
    initialImageUrls: { base: [url] },
  });
  const crop = { left: 64, top: 64, width: 512, height: 512, multiplier: 1 };
  try {
    for (let pass = 0; pass < 3; pass++) {
      for (const type of ["color", "metallic"]) {
        const c = app.canvases[`base:${type}:0:1`].canvas;
        expect(c.item(0).left).toBe(64);
        expect(c.item(0).top).toBe(64);
        expect(c.toDataURL(crop)).toBe(url);
      }
      expect(app.skin.getColorImageUrl("base", 0)).toBe(url);
      await act(async () => app.tools.exportSkinProject("aligned"));
      await app.load(await saved.at(-1).zip.generateAsync({ type: "nodebuffer" }));
    }
  } finally {
    await app.close();
  }
});
