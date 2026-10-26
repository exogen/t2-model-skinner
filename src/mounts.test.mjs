import { expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import {
  AnimationMixer, Group, LoopOnce, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Scene, Texture, Vector3,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import Viewer, { disposeObject, findOwnNode, mountPart, withMountedClips } from "./Viewer";
import modelConfig, { partMaterials } from "./models";
import { heldWeaponOptions } from "./modelOptions";
import { fileArrayToModels } from "./importUtils";
import { playerAssets } from "./mocap/playerTestUtils.mjs";

async function loadGlb(name) {
  const bytes = await readFile(new URL(`../public/${name}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  // The blaster embeds its texture, and decoding images needs a browser.
  loader.register(() => ({ name: "test-image-decoder", loadTexture: async () => new Texture() }));
  return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
}

const heldWeapons = heldWeaponOptions.map(({ value }) => value);

function worldTransform(node) {
  node.updateWorldMatrix(true, false);
  const position = new Vector3();
  const quaternion = new Quaternion();
  node.matrixWorld.decompose(position, quaternion, new Vector3());
  return { position, quaternion };
}

function expectSameTransform(actual, expected, size) {
  expect(actual.position.distanceTo(expected.position)).toBeLessThan(size * 1e-4);
  expect(Math.abs(actual.quaternion.dot(expected.quaternion))).toBeCloseTo(1, 5);
}

test.each(heldWeapons)("a held %s's Mountpoint meets every player's hand mount", async (weapon) => {
  for (const player of playerAssets) {
    const [{ scene }, gltf] = await Promise.all([loadGlb(player), loadGlb(weapon)]);
    const hand = findOwnNode(scene, "Mount0");
    expect(hand, player).not.toBeNull();
    const holder = mountPart(hand, gltf.scene);
    expect(holder.parent).toBe(hand);
    scene.updateMatrixWorld(true);
    // The blaster has no Mountpoint, so its origin is held.
    const point = findOwnNode(gltf.scene, "Mountpoint") ?? gltf.scene;
    expectSameTransform(worldTransform(point), worldTransform(hand), 0.01);
    disposeObject(scene);
  }
});

test("a node of a mounted model is never taken for the model's own", async () => {
  const [{ scene }, gltf] = await Promise.all([loadGlb("lmale"), loadGlb("missile")]);
  const hand = findOwnNode(scene, "mount0");
  expect(hand.name).toBe("Mount0");
  mountPart(hand, gltf.scene);
  expect(findOwnNode(scene, "Mountpoint")).toBeNull();
  expect(findOwnNode(gltf.scene, "Mountpoint")).not.toBeNull();
  disposeObject(scene);
});

test("the tank's turret sits on its Mount10 with its origin, like a mounted object in the game", async () => {
  const [tank, turret] = await Promise.all([loadGlb("vehicle_grav_tank"), loadGlb("turret_assaulttank_mortar")]);
  const [{ model, node }] = modelConfig.mounts.vehicle_grav_tank;
  expect(model).toBe("turret_assaulttank_mortar");
  const mount = findOwnNode(tank.scene, node);
  mountPart(mount, turret.scene);
  tank.scene.updateMatrixWorld(true);
  expectSameTransform(worldTransform(turret.scene), worldTransform(mount), 0.1);
  disposeObject(tank.scene);
});

test("the tank's activate clip raises its turret, and only the turret's nodes take the turret's tracks", async () => {
  const [tank, turret] = await Promise.all([loadGlb("vehicle_grav_tank"), loadGlb("turret_assaulttank_mortar")]);
  mountPart(findOwnNode(tank.scene, "Mount10"), turret.scene);
  // A tank node with the name of one the turret animates.
  const decoy = new Group();
  decoy.name = "dumActivate";
  tank.scene.children[0].add(decoy);
  const [activate] = withMountedClips(tank.animations, [turret]);
  expect(activate.name).toBe("activate");
  expect(activate.tracks.length).toBeGreaterThan(tank.animations[0].tracks.length);
  const lift = turret.scene.getObjectByName("dumActivate");
  const rest = lift.position.y;
  const mixer = new AnimationMixer(tank.scene);
  const action = mixer.clipAction(activate).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.update(activate.duration);
  expect(lift.position.y - rest).toBeGreaterThan(0.002);
  expect(decoy.position.y).toBe(0);
  disposeObject(tank.scene);
});

test("the tank's skin includes its turret, as a part skins made before it can leave out", () => {
  const tank = modelConfig.materials.vehicle_grav_tank;
  expect(partMaterials("vehicle_grav_tank")).toEqual(tank.filter((material) => !material.mount));
  const [turret] = partMaterials("vehicle_grav_tank", "turret_assaulttank_mortar");
  expect(turret).toMatchObject({ file: "turret_assaultTank", optional: true });
  // The turret's own definitions are bound to its file's materials in order.
  expect(partMaterials("vehicle_grav_tank", "turret_assaulttank_mortar").map(({ name }) => name))
    .toEqual(modelConfig.materials.turret_assaulttank_mortar.map(({ name }) => name));

  const files = ["Vehicle_grav_tank_bodyMain", "vehicle_grav_tank_bodyside1", "vehicle_grav_tank_bodyside2"]
    .map((name) => ({ path: `${name}.png`, name: "Old", imageUrl: `data:${name}` }));
  const old = fileArrayToModels(files).get("vehicle_grav_tank").get("Old");
  expect(old.isComplete).toBe(true);
  const full = fileArrayToModels([...files, { path: "turret_assaultTank.png", name: "Old", imageUrl: "data:turret" }])
    .get("vehicle_grav_tank").get("Old");
  expect(full.materials.get("turret_assaultTank")).toEqual(["data:turret"]);
});

function mountHarness(scene) {
  return Object.assign(Object.create(Viewer.prototype), {
    scene: new Scene(), invalidate: vi.fn(), renderMode: "random", disposed: false,
    model: { scene }, originalTextures: new Set(), randomColorGeometries: new Map(),
    randomColorMaterial: new MeshStandardMaterial({ vertexColors: true }),
    wireframeMaterial: new MeshBasicMaterial({ wireframe: true }),
  });
}

test("a weapon mounted on the shown player takes the render mode, and unmounting restores and frees it", async () => {
  const [player, weapon] = await Promise.all([loadGlb("lmale"), loadGlb("energy")]);
  const embedded = new Texture();
  let weaponMesh;
  weapon.scene.traverse((object) => { if (object.isMesh) weaponMesh ??= object; });
  weaponMesh.material.map = embedded;
  const geometry = weaponMesh.geometry;
  const viewer = mountHarness(player.scene);
  vi.spyOn(GLTFLoader.prototype, "loadAsync").mockResolvedValueOnce(weapon);
  const mounted = await viewer.mount("energy.glb", "Mount0");
  expect(mounted.scene.parent).toBe(findOwnNode(player.scene, "Mount0"));
  expect(mounted.materials.flat()).toContain(weaponMesh.material);
  expect(weaponMesh.geometry).not.toBe(geometry);
  expect(viewer.originalTextures.has(embedded)).toBe(true);

  const dispose = vi.spyOn(embedded, "dispose");
  // An editor texture replaced the embedded one, like a skin does.
  weaponMesh.material.map = new Texture();
  viewer.unmount(mounted);
  expect(mounted.scene.parent).toBeNull();
  expect(weaponMesh.geometry).toBe(geometry);
  expect(viewer.randomColorGeometries.has(weaponMesh)).toBe(false);
  expect(dispose).toHaveBeenCalledOnce();
  expect(viewer.originalTextures.has(embedded)).toBe(false);
  disposeObject(player.scene);
});

test("a weapon that loads after another model is shown, or for one without a hand, isn't mounted", async () => {
  const [player, first, second] = await Promise.all([loadGlb("lmale"), loadGlb("disc"), loadGlb("disc")]);
  const viewer = mountHarness(player.scene);
  let finish;
  vi.spyOn(GLTFLoader.prototype, "loadAsync").mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const pending = viewer.mount("disc.glb", "Mount0");
  viewer.model = { scene: new Group() };
  finish(first);
  expect(await pending).toBeNull();
  expect(first.scene.parent).toBeNull();

  vi.spyOn(GLTFLoader.prototype, "loadAsync").mockResolvedValueOnce(second);
  expect(await viewer.mount("disc.glb", "Mount0")).toBeNull();
  expect(second.scene.parent).toBeNull();
  disposeObject(player.scene);
});

test("the weapon menu offers every weapon a player can hold", () => {
  expect(heldWeapons).toContain("disc");
  expect(heldWeapons).not.toContain("mine");
  for (const weapon of heldWeapons) expect(modelConfig.modelDefaults[weapon], weapon).toBeTruthy();
});
