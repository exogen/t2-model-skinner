import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { footFrame } from "./retarget";

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);

function points(side = 1) {
  return [
    new Vector3(side * 0.15, 0.1, 0),
    new Vector3(side * 0.15, 0, -0.08),
    new Vector3(side * 0.15, 0, 0.2),
  ];
}

function expectDirection(actual, expected) {
  assert.ok(actual.distanceTo(expected) < 1e-10, `${actual.toArray()} vs ${expected.toArray()}`);
}

function expectFrame(actual, rotation = new Quaternion()) {
  assert.ok(actual);
  assert.ok(actual.rotation.toArray().every(Number.isFinite));
  assert.ok(Math.abs(actual.rotation.length() - 1) < 1e-10);
  expectDirection(FORWARD.clone().applyQuaternion(actual.rotation), FORWARD.clone().applyQuaternion(rotation));
  expectDirection(UP.clone().applyQuaternion(actual.rotation), UP.clone().applyQuaternion(rotation));
  expectDirection(actual.up, UP.clone().applyQuaternion(rotation));
}

describe("footFrame", () => {
  for (const side of [-1, 1]) {
    it(`builds the same anatomical frame for the ${side === 1 ? "left" : "right"} foot`, () => {
      expectFrame(footFrame(...points(side)));
    });

    for (const [name, axis, angle] of [
      ["pitch", new Vector3(1, 0, 0), Math.PI / 2],
      ["yaw", UP, Math.PI / 2],
      ["roll", FORWARD, Math.PI / 2],
      ["upside-down sole", FORWARD, Math.PI],
    ]) {
      it(`preserves a real ${name} on side ${side}, even against previous up`, () => {
        const rotation = new Quaternion().setFromAxisAngle(axis, angle);
        const transformed = points(side).map((point) => point.applyQuaternion(rotation));
        expectFrame(footFrame(...transformed, UP), rotation);
      });
    }
  }

  for (const scale of [0.01, 1, 100]) {
    it(`keeps roll across collinear and noisy sole points at scale ${scale}`, () => {
      const ankle = new Vector3(0.15, 0.1, 0);
      const heel = new Vector3(0.15, 0.1, -0.08);
      const toe = new Vector3(0.15, 0.1, 0.2);
      let previousUp = UP.clone();
      for (const noise of [-0.001, 0, 0.001, -0.00001, 0.00001]) {
        const result = footFrame(
          ankle.clone().multiplyScalar(scale),
          heel.clone().add(new Vector3(0, noise, 0)).multiplyScalar(scale),
          toe.clone().add(new Vector3(0, noise, 0)).multiplyScalar(scale),
          previousUp,
        );
        expectFrame(result);
        previousUp = result.up;
      }
    });
  }

  it("rejects an extremely shallow triangle even when its ankle offset is perpendicular", () => {
    const heel = new Vector3(0, 0, -0.14);
    const toe = new Vector3(0, 0, 0.14);
    for (const height of [-0.001, 0.001]) {
      expectFrame(footFrame(new Vector3(0, height, 0), heel, toe, UP));
    }
  });

  it("still follows changing foot direction with an unmeasurable sole plane", () => {
    const rotation = new Quaternion().setFromAxisAngle(UP, Math.PI / 3);
    const ankle = new Vector3(0, 0, 0);
    const heel = new Vector3(0, 0, -0.08).applyQuaternion(rotation);
    const toe = new Vector3(0, 0, 0.2).applyQuaternion(rotation);
    expectFrame(footFrame(ankle, heel, toe, new Vector3(0, 3, 1).applyQuaternion(rotation)), rotation);
  });

  it("projects the supplied up without mutating landmarks or history", () => {
    const input = [
      new Vector3(0, 0, 0),
      new Vector3(0, 0, -0.08),
      new Vector3(0, 0, 0.2),
      new Vector3(0, 3, 1),
    ];
    const before = input.map((point) => point.clone());
    expectFrame(footFrame(...input));
    input.forEach((point, index) => assert.deepEqual(point, before[index]));
  });

  it("does not invent roll without usable measurement or history", () => {
    const ankle = new Vector3(0, 0, 0);
    const heel = new Vector3(0, 0, -0.08);
    const toe = new Vector3(0, 0, 0.2);
    for (const fallback of [undefined, new Vector3(), FORWARD, new Vector3(NaN, 1, 0), new Vector3(0, Infinity, 0)]) {
      assert.equal(footFrame(ankle, heel, toe, fallback), null);
    }
    assert.equal(footFrame(ankle, heel, heel, UP), null);
  });

  it("rejects nonfinite landmarks and overflowing geometry", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      for (let index = 0; index < 3; index += 1) {
        const input = points();
        input[index].x = value;
        assert.equal(footFrame(...input, UP), null);
      }
    }
    assert.equal(footFrame(new Vector3(), new Vector3(1e308, 0, 0), new Vector3(-1e308, 0, 0), UP), null);
    assert.equal(footFrame(new Vector3(0, 1e308, 0), new Vector3(0, 0, -1), new Vector3(0, 0, 1), UP), null);
  });
});
