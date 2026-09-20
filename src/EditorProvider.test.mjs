import { expect, test, vi } from "vitest";
import { FabricImage, getEnv } from "fabric";
import JSZip from "jszip";
import {
  act,
  archive,
  canvas,
  editor,
  image,
  input,
  saved,
  downloads,
  workers,
} from "./skinProjectTestUtils.mjs";
import { readSkinProjectZip } from "./skinProjectUtils";

const { File, Blob } = getEnv().window;

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("a save owns its snapshots before asynchronous exporting begins", async () => {
  const app = await editor();
  try {
    const c = app.canvases[app.tools.activeCanvas].canvas;
    await act(async () => c.add(image({ left: 333 })));
    let saving;
    await act(async () => {
      saving = app.tools.exportSkinProject("original");
      // Clearing immediately also catches a yield before the snapshot is taken.
      c.clear();
      app.warrior.setSelectedModel("disc");
      await saving;
    });
    const project = await readSkinProjectZip(
      await saved.at(-1).zip.generateAsync({ type: "nodebuffer" })
    );
    expect(project.model).toBe("lmale");
    expect(project.materials.base.color.objects[0].left).toBe(333);
  } finally {
    await app.close();
  }
});

test.each([
  ["  Silver Wolf  ", "Silver Wolf"],
  ["   ", "MyCustomSkin"],
])(
  "project saves restore the name used for %j, even if the file is renamed",
  async (name, expected) => {
    const app = await editor();
    try {
      await act(async () => app.tools.exportSkinProject(name));
      const { zip, name: filename } = saved.at(-1);
      expect(filename).toBe(`${expected}.skin`);
      const bytes = await zip.generateAsync({ type: "nodebuffer" });
      expect((await readSkinProjectZip(bytes)).name).toBe(expected);
      await act(async () => app.tools.setExportName("Another Skin"));
      await app.load(new File([bytes], "Renamed.skin"));
      expect(app.tools.exportName).toBe(expected);
    } finally {
      await app.close();
    }
  }
);

test.each([
  ["version 1", null],
  ["version 2 without a name", { version: 2, model: "lmale" }],
  ["version 2 with an empty name", { version: 2, model: "lmale", name: "" }],
])(
  "%s projects restore the filename without the .skin extension",
  async (_, metadata) => {
    const zip = new JSZip();
    if (metadata) zip.file("project.json", JSON.stringify(metadata));
    zip.file(
      "base/material.json",
      JSON.stringify({
        textureSize: [512, 512],
        ...(metadata
          ? { color: { objects: [] }, metallic: { objects: [] }, images: {} }
          : { version: 1, objects: [] }),
      })
    );
    const app = await editor();
    try {
      await act(async () => app.tools.setExportName("Previous Skin"));
      const bytes = await zip.generateAsync({ type: "nodebuffer" });
      await app.load(new File([bytes], "Midnight.v2.SKIN"));
      expect(app.tools.exportName).toBe("Midnight.v2");
    } finally {
      await app.close();
    }
  }
);

for (const operation of ["duplicate", "addImages", "copyToMetallic"]) {
  test(`an unfinished ${operation} cannot edit a replacement session`, async () => {
    const source = canvas();
    source.add(image({ left: 450 }));
    const bytes = await archive([input("base", source)]);
    const app = await editor();
    const pending = deferred();
    let spy;
    try {
      const oldCanvas = app.canvases[app.tools.activeCanvas].canvas;
      const original = image();
      await act(async () => {
        oldCanvas.add(original);
        oldCanvas.setActiveObject(original);
      });
      spy =
        operation === "duplicate"
          ? vi.spyOn(original, "clone").mockReturnValueOnce(pending.promise)
          : vi
              .spyOn(FabricImage, "fromURL")
              .mockReturnValueOnce(pending.promise);
      let editing;
      await act(async () => {
        editing =
          operation === "addImages"
            ? app.tools.addImages([original.getSrc()])
            : app.tools[operation]();
      });
      await app.load(bytes);
      const lateImage = image();
      const dispose = vi.spyOn(lateImage, "dispose");
      await act(async () => {
        pending.resolve(lateImage);
        await editing;
      });
      const current = app.canvases[app.tools.activeCanvas].canvas;
      expect(current).not.toBe(oldCanvas);
      expect(app.tools.activeCanvasType).toBe("color");
      expect(current.getObjects()).toHaveLength(1);
      expect(current.item(0).left).toBe(450);
      expect(
        app.canvases["base:metallic:0:1"].canvas.getObjects()
      ).toHaveLength(0);
      expect(dispose).toHaveBeenCalled();
    } finally {
      spy?.mockRestore();
      await app.close();
      await source.dispose();
    }
  });
}

test("changing models while a project decodes cancels the old load", async () => {
  const source = canvas();
  source.add(image({ left: 321 }));
  const bytes = await archive([input("base", source)]);
  const app = await editor();
  const pending = deferred();
  const fromObject = FabricImage.fromObject.bind(FabricImage);
  const spy = vi
    .spyOn(FabricImage, "fromObject")
    .mockImplementation((object, options) =>
      object.left === 321 ? pending.promise : fromObject(object, options)
    );
  try {
    let loading;
    await act(async () => {
      app.tools.setExportName("Current Skin");
      loading = app.tools.loadSkinProject(
        new File([bytes], "Cancelled.skin")
      );
      await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    });
    await act(async () => app.warrior.setSelectedModel("disc"));
    await act(async () => {
      pending.resolve(image({ left: 321 }));
      await loading;
    });
    expect(app.warrior.selectedModel).toBe("disc");
    expect(app.warrior.selectedSkinType).not.toBe("project");
    expect(app.tools.exportName).toBe("Current Skin");
  } finally {
    spy.mockRestore();
    await app.close();
    await source.dispose();
  }
});

test("a failed texture source stays in error and cannot be saved", async () => {
  const urls = { base: ["https://example.invalid/skin.png"] };
  const app = await editor("lmale", {
    realCanvases: true,
    initialImageUrls: urls,
    defaultImageUrls: urls,
    imageLoad: async () => {
      throw new Error("offline");
    },
  });
  try {
    expect(Object.values(app.canvases).map(({ status }) => status)).toEqual([
      "error",
      "error",
    ]);
    expect(app.canvases["base:metallic:0:1"].canvas.isDrawingMode).toBe(false);
    await expect(app.tools.exportSkinProject("incomplete")).rejects.toThrow();
    expect(saved).toHaveLength(0);
  } finally {
    await app.close();
  }
});

test("project resolution is independent of the default resolution preference", async () => {
  const source = canvas();
  source.add(image({ left: 864 }));
  const app = await editor();
  try {
    await app.load(
      await archive([input("base", source, null, [1024, 1024])])
    );
    const before = app.canvases[app.tools.activeCanvas].canvas;
    await act(async () => app.tools.setSizeMultiplier(4));
    expect(app.tools.sizeMultiplier).toBe(2);
    expect(app.canvases[app.tools.activeCanvas].canvas).toBe(before);
    await act(async () => app.tools.exportSkinProject("same-size"));
    const project = await readSkinProjectZip(
      await saved.at(-1).zip.generateAsync({ type: "nodebuffer" })
    );
    expect(project.materials.base.textureSize).toEqual([1024, 1024]);
    expect(project.materials.base.color.objects[0].left).toBe(864);
  } finally {
    await app.close();
    await source.dispose();
  }
});

test("a texture request from the previous session cannot overwrite project layers", async () => {
  const source = canvas();
  const layer = image({ left: 450 });
  source.add(layer);
  const pending = deferred();
  const urls = { base: ["https://example.invalid/slow.png"] };
  const app = await editor("lmale", {
    realCanvases: true,
    initialImageUrls: urls,
    defaultImageUrls: urls,
    imageLoad: () => pending.promise,
    waitForInitialCanvases: false,
  });
  try {
    await app.load(await archive([input("base", source)]));
    const current = app.canvases[app.tools.activeCanvas].canvas;
    await act(async () =>
      pending.resolve(
        await (await globalThis.fetch(layer.getSrc())).arrayBuffer()
      )
    );
    expect(current.getObjects()).toHaveLength(1);
    expect(current.item(0).left).toBe(450);
    expect(app.canvases[app.tools.activeCanvas].status).toBe("ready");
  } finally {
    await app.close();
    await source.dispose();
  }
});

test("the latest project request wins when decoding finishes out of order", async () => {
  const first = canvas(),
    second = canvas();
  first.add(image({ left: 111 }));
  second.add(image({ left: 222 }));
  const [firstBytes, secondBytes] = await Promise.all([
    archive([input("base", first)]),
    archive([input("base", second)]),
  ]);
  const app = await editor();
  const pending = deferred();
  const fromObject = FabricImage.fromObject.bind(FabricImage);
  const spy = vi
    .spyOn(FabricImage, "fromObject")
    .mockImplementation((object, options) =>
      object.left === 111 ? pending.promise : fromObject(object, options)
    );
  try {
    let loading;
    await act(async () => {
      loading = app.tools.loadSkinProject(
        new File([firstBytes], "First.skin")
      );
      await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    });
    await app.load(new File([secondBytes], "Second.skin"));
    await act(async () => {
      pending.resolve(image({ left: 111 }));
      await loading;
    });
    expect(app.canvases[app.tools.activeCanvas].canvas.item(0).left).toBe(
      222
    );
    expect(app.tools.exportName).toBe("Second");
  } finally {
    spy.mockRestore();
    await app.close();
    await first.dispose();
    await second.dispose();
  }
});

test("recomputing identical texture URLs does not discard edits", async () => {
  const app = await editor("lmale", {
    initialImageUrls: { base: ["original.png"] },
  });
  try {
    const before = app.canvases[app.tools.activeCanvas].canvas;
    await act(async () => before.add(image({ left: 444 })));
    await act(async () =>
      app.warrior.setSkinImageUrls({ base: ["original.png"] })
    );
    const after = app.canvases[app.tools.activeCanvas].canvas;
    expect(after === before).toBe(true);
    expect(after.item(0).left).toBe(444);
    await act(async () =>
      app.warrior.setSkinImageUrls({ base: ["replacement.png"] })
    );
    expect(app.canvases[app.tools.activeCanvas].canvas).not.toBe(before);
  } finally {
    await app.close();
  }
});

test("locking is undoable and deletion respects locked layers", async () => {
  const app = await editor();
  try {
    const info = app.canvases[app.tools.activeCanvas];
    await act(async () => {
      const object = image();
      info.canvas.add(object);
      info.canvas.setActiveObject(object);
    });
    await app.settle();
    await act(async () => app.tools.lockSelection());
    await app.settle();
    await act(async () => app.tools.undo());
    expect(info.canvas.getObjects()).toHaveLength(1);
    expect(info.canvas.item(0).lockMovementX).toBe(false);
    await act(async () => app.tools.redo());
    await act(async () => info.canvas.setActiveObject(info.canvas.item(0)));
    await act(async () => app.tools.deleteSelection());
    expect(info.canvas.getObjects()).toHaveLength(1);
    expect(info.canvas.item(0).lockMovementX).toBe(true);
  } finally {
    await app.close();
  }
});

test("a texture import keeps default materials omitted from the imported files", async () => {
  const original = image();
  const defaults = {
    Vehicle_grav_scout: [original.getSrc()],
    Vehicle_grav_scout_pipes: [original.getSrc()],
    Vehicle_grav_scout_windshield: [original.getSrc()],
    Vehicle_grav_scout_windshieldInner: [original.getSrc()],
  };
  const app = await editor("vehicle_grav_scout", {
    realCanvases: true,
    initialImageUrls: {
      Vehicle_grav_scout: [original.getSrc()],
      Vehicle_grav_scout_pipes: [original.getSrc()],
    },
    defaultImageUrls: defaults,
  });
  try {
    const fixed =
      app.canvases["Vehicle_grav_scout_windshield:color:0:1"].canvas;
    expect(fixed.getObjects()).toHaveLength(1);
    await act(async () => app.tools.exportSkinProject("complete"));
    const project = await readSkinProjectZip(
      await saved.at(-1).zip.generateAsync({ type: "nodebuffer" })
    );
    expect(
      project.materials.Vehicle_grav_scout_windshield.color.objects
    ).toHaveLength(1);
  } finally {
    await app.close();
    original.dispose();
  }
});

test("undo and deletion release replaced image resources without losing redo", async () => {
  const source = canvas();
  source.add(image());
  const app = await editor();
  try {
    await app.load(await archive([input("base", source)]));
    const info = app.canvases[app.tools.activeCanvas];
    const original = info.canvas.item(0);
    const dispose = vi.spyOn(original, "dispose");
    await act(async () => {
      original.set("left", 200);
      info.notifyChange();
      await app.tools.undo();
    });
    expect(dispose).toHaveBeenCalledOnce();
    await act(async () => app.tools.redo());
    expect(info.canvas.item(0).left).toBe(200);
    const restored = info.canvas.item(0);
    const disposeRestored = vi.spyOn(restored, "dispose");
    await act(async () => info.canvas.setActiveObject(restored));
    await act(async () => app.tools.deleteSelection());
    expect(disposeRestored).toHaveBeenCalledOnce();
    await act(async () => app.tools.undo());
    expect(info.canvas.item(0).left).toBe(200);
  } finally {
    await app.close();
    await source.dispose();
  }
});

for (const [model, filenames, zipName, size] of [
  ["lmale", ["Paint.lmale.png"], "zPlayerSkin-Paint.vl2", [512, 512]],
  ["hfemale", ["Paint.hmale.png"], "zPlayerSkin-Paint.vl2", [512, 512]],
  [
    "disc",
    [
      "weapon_disc.png",
      "dcase00.png",
      "dcase01.png",
      "dcase02.png",
      "dcase03.png",
      "dcase04.png",
      "dcase05.png",
    ],
    "zWeaponDisc-Paint.vl2",
    [512, 512],
  ],
  [
    "vehicle_grav_scout",
    ["Vehicle_grav_scout.png", "Vehicle_grav_scout_pipes.png"],
    "zVehicleGravScout-Paint.vl2",
    [512, 256],
  ],
]) {
  test(`${model} PNG and VL2 exports preserve filenames, frames, dimensions and pixels`, async () => {
    const app = await editor(model);
    try {
      const current = app.canvases[app.tools.activeCanvas].canvas;
      await act(async () => current.add(image({ left: 100 })));
      const expected = current.toDataURL({
        format: "png",
        multiplier: 1,
        top: 64,
        left: 64,
        width: size[0],
        height: size[1],
      });
      await act(async () =>
        app.tools.exportSkin({ name: " Paint ", format: "png" })
      );
      expect(downloads.map(({ name }) => name)).toEqual(filenames);
      expect(downloads[0].data).toBe(expected);
      if (model === "disc") {
        const frame = await FabricImage.fromURL(downloads[1].data);
        expect([frame.width, frame.height]).toEqual([256, 256]);
        frame.dispose();
      }
      await act(async () =>
        app.tools.exportSkin({ name: "Paint", format: "vl2" })
      );
      const download = downloads.at(-1);
      expect(download.name).toBe(zipName);
      const zip = await JSZip.loadAsync(download.data);
      expect(
        Object.keys(zip.files).filter((name) => !zip.files[name].dir)
      ).toEqual(filenames.map((name) => `textures/skins/${name}`));
      expect(
        await zip.file(`textures/skins/${filenames[0]}`).async("base64")
      ).toBe(expected.split(",")[1]);
    } finally {
      await app.close();
    }
  });
}

test("texture exports capture every selected frame before an asynchronous conversion", async () => {
  const app = await editor("disc");
  const pending = deferred();
  const combine = workers.combineColorAndAlphaImageUrls;
  try {
    await act(async () =>
      Object.values(app.canvases).forEach(({ canvas }, index) =>
        canvas.add(image({ left: 100 + index }))
      )
    );
    await act(async () =>
      app.tools.setSelectedExportMaterials([false, true])
    );
    await act(async () =>
      app.tools.exportSkin({ name: "case", format: "png" })
    );
    expect(downloads.map(({ name }) => name)).toEqual(
      Array.from({ length: 6 }, (_, frame) => `dcase0${frame}.png`)
    );
    downloads.length = 0;
    await act(async () => app.tools.setSelectedExportMaterials([true, true]));
    const before = Object.fromEntries(
      Object.entries(app.canvases).map(([id, info]) => [
        id,
        info.canvas.toDataURL({
          format: "png",
          multiplier: 1,
          top: 64,
          left: 64,
          width: id.startsWith("dcase") ? 256 : 512,
          height: id.startsWith("dcase") ? 256 : 512,
        }),
      ])
    );
    combine.mockImplementationOnce(() => pending.promise);
    let saving;
    await act(async () => {
      saving = app.tools.exportSkin({ name: "snapshot", format: "png" });
      Object.values(app.canvases).forEach(({ canvas }) => canvas.clear());
      app.warrior.setSelectedModel("lmale");
    });
    await act(async () => {
      pending.resolve(before["weapon_disc:color:0:1"]);
      await saving;
    });
    expect(downloads.map(({ name }) => name)).toEqual([
      "weapon_disc.png",
      ...Array.from({ length: 6 }, (_, frame) => `dcase0${frame}.png`),
    ]);
    expect(downloads.map(({ data }) => data)).toEqual([
      before["weapon_disc:color:0:1"],
      ...Array.from(
        { length: 6 },
        (_, frame) => before[`dcase00:color:${frame}:1`]
      ),
    ]);
  } finally {
    combine.mockImplementation(async ({ colorImageUrl }) => colorImageUrl);
    await app.close();
  }
});

test("toolbar preferences survive skin, model and unnamed project changes", async () => {
  const source = canvas();
  source.add(image({ left: 320 }));
  const bytes = await archive([input("base", source)]);
  const app = await editor();
  try {
    let previousCanvas = app.canvases[app.tools.activeCanvas].canvas;
    const artwork = image();
    await act(async () => {
      previousCanvas.add(artwork);
      app.tools.setBrushSize(37);
      app.tools.setBrushColor(80);
      app.tools.setBackgroundColor("white");
      app.tools.setExportName("My Skin");
    });
    expect(app.canvases[app.tools.activeCanvas].canvas).toBe(previousCanvas);
    expect(previousCanvas.item(0)).toBe(artwork);
    for (const change of [
      () => act(async () => app.warrior.setSelectedSkin("Diamond Sword")),
      () => act(async () => app.warrior.setSelectedModel("disc")),
      () => app.load(new Blob([bytes])),
    ]) {
      await change();
      expect([
        app.tools.brushSize,
        app.tools.brushColor,
        app.tools.backgroundColor,
        app.tools.exportName,
      ]).toEqual([37, 80, "white", "My Skin"]);
      const current = app.canvases[app.tools.activeCanvas].canvas;
      expect(current).not.toBe(previousCanvas);
      expect(app.tools.canUndo).toBe(false);
      previousCanvas = current;
    }
    expect(previousCanvas.item(0).left).toBe(320);
  } finally {
    await app.close();
    await source.dispose();
  }
});


test("an older VL2 load cannot replace a newer project load", async () => {
  const source = canvas();
  source.add(image({ left: 450 }));
  const bytes = await archive([input("base", source)]);
  const zip = new JSZip();
  zip.file("textures/skins/Old.lmale.png", source.item(0).getSrc().split(",")[1], {
    base64: true,
  });
  const app = await editor();
  const pending = deferred();
  const readZip = vi
    .spyOn(JSZip, "loadAsync")
    .mockReturnValueOnce(pending.promise);
  try {
    let loading;
    await act(async () => {
      loading = app.tools.loadSkinFiles([new File(["pending"], "Old.vl2")]);
      expect(readZip).toHaveBeenCalledOnce();
    });
    await app.load(new File([bytes], "New.skin"));
    await act(async () => {
      pending.resolve(zip);
      await loading;
    });
    expect(app.warrior.selectedSkinType).toBe("project");
    expect(app.warrior.selectedSkin).toBe("New");
    expect(app.tools.exportName).toBe("New");
    expect(app.canvases[app.tools.activeCanvas].canvas.item(0).left).toBe(450);
    expect(app.warrior.importedSkins.size).toBe(0);
  } finally {
    readZip.mockRestore();
    await app.close();
    await source.dispose();
  }
});
