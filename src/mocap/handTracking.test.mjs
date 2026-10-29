import { expect, test } from "vitest";
import { associateHands, createHandAssociator } from "./handTracking";

function pose(left = 0.7, right = 0.3) {
  const points = [];
  for (const [wrist, elbow, x] of [
    [15, 13, left],
    [16, 14, right],
  ]) {
    points[wrist] = { x, y: 0.4, z: 0, visibility: 0.95, presence: 0.9 };
    points[elbow] = { x, y: 0.6, z: 0, visibility: 1 };
  }
  return points;
}

function hand(x, y = 0.4) {
  return {
    landmarks: Array.from({ length: 21 }, (_, index) => ({
      x: x + index * 0.001,
      y,
      z: 0,
    })),
    worldLandmarks: Array.from({ length: 21 }, (_, index) => ({
      x: index * 0.005,
      y: 0.02,
      z: 0.01,
    })),
  };
}

function result(...hands) {
  return {
    landmarks: hands.map((hand) => hand.landmarks),
    worldLandmarks: hands.map((hand) => hand.worldLandmarks),
    // Intentionally incorrect labels: side must follow the active body's
    // anatomical wrist, not output order or the hand classifier.
    handedness: hands.map(() => [{ categoryName: "Right", score: 0.99 }]),
  };
}

test("associates both hands with anatomical pose wrists despite detector order or handedness labels", () => {
  const right = hand(0.3),
    left = hand(0.7);
  const found = associateHands(result(right, left), pose(), 640, 480);
  expect(found.map(({ side }) => side)).toEqual(["left", "right"]);
  expect(found[0].landmarks).toEqual(left.landmarks);
  expect(found[1].worldLandmarks).toEqual(right.worldLandmarks);
  expect(found.map(({ confidence }) => confidence)).toEqual([0.9, 0.9]);
  expect(found[0].worldLandmarks[0]).toEqual({ x: 0, y: 0.02, z: 0.01 });
});

test("crossing arms preserves anatomical sides rather than assigning by screen-left and screen-right", () => {
  const found = associateHands(
    result(hand(0.7), hand(0.3)),
    pose(0.3, 0.7),
    640,
    480,
  );
  expect(found.map(({ side, landmarks }) => [side, landmarks[0].x])).toEqual([
    ["left", 0.3],
    ["right", 0.7],
  ]);
});

test("hand output uses task-level presence rather than unused per-landmark score fields", () => {
  const detected = hand(0.7);
  detected.landmarks.forEach((point) => {
    point.visibility = 0;
    point.presence = 0;
  });
  detected.worldLandmarks.forEach((point) => {
    point.visibility = 0;
    point.presence = 0;
  });
  const found = associateHands(result(detected), pose(), 640, 480);
  expect(found.map(({ side }) => side)).toEqual(["left"]);
  for (const point of [...found[0].landmarks, ...found[0].worldLandmarks]) {
    expect(point).not.toHaveProperty("visibility");
    expect(point).not.toHaveProperty("presence");
  }
  expect(detected.landmarks[0].visibility).toBe(0);
});

test("unrelated hands outside both active wrist regions are ignored", () => {
  expect(associateHands(result(hand(0.98, 0.9)), pose(), 640, 480)).toEqual([]);
});

test("one detected hand cannot drive both wrists and ambiguous overlap yields no invented side", () => {
  const found = associateHands(result(hand(0.7)), pose(), 640, 480);
  expect(found.map(({ side }) => side)).toEqual(["left"]);
  const overlap = pose(0.49, 0.51);
  expect(associateHands(result(hand(0.5)), overlap, 640, 480)).toEqual([]);
  expect(
    associateHands(result(hand(0.5), hand(0.5)), overlap, 640, 480),
  ).toEqual([]);
});

test("association measures actual pixel distance in portrait images", () => {
  const points = pose(0.2, 0.4);
  points[15].y = 0.5;
  points[13].y = 0.6;
  points[16].y = 0.4;
  points[14].y = 0.3;
  // It is closer to the right wrist in normalized coordinates, but much
  // closer to the left wrist in this tall image's actual pixels.
  const found = associateHands(result(hand(0.39, 0.5)), points, 200, 1000);
  expect(found.map(({ side }) => side)).toEqual(["left"]);
});

test.each([
  { visibility: 0.49 },
  { presence: 0.49 },
  { visibility: NaN },
  { x: Infinity },
  { x: 1.1 },
  { y: -0.1 },
])(
  "unreliable or off-frame pose wrists cannot authorize a hand: %j",
  (invalid) => {
    const points = pose();
    Object.assign(points[15], invalid);
    Object.assign(points[16], invalid);
    expect(
      associateHands(result(hand(0.7), hand(0.3)), points, 640, 480),
    ).toEqual([]);
  },
);

test("missing elbows permit wrist matching and an absent wrist permits independent handedness", () => {
  const points = pose();
  delete points[13];
  points[16].visibility = 0;
  expect(
    associateHands(result(hand(0.71), hand(0.3)), points, 640, 480).map(
      ({ side }) => side,
    ),
  ).toEqual(["left", "right"]);
});

test("incomplete and nonfinite hand geometry and invalid image sizes are rejected", () => {
  for (const mutate of [
    (value) => value.landmarks.pop(),
    (value) => value.worldLandmarks.pop(),
    (value) => {
      value.landmarks[4].x = NaN;
    },
    (value) => {
      value.worldLandmarks[9].z = Infinity;
    },
  ]) {
    const value = hand(0.7);
    mutate(value);
    expect(associateHands(result(value), pose(), 640, 480)).toEqual([]);
  }
  for (const [width, height] of [
    [0, 480],
    [640, NaN],
    [Infinity, 480],
  ]) {
    expect(associateHands(result(hand(0.7)), pose(), width, height)).toEqual(
      [],
    );
  }
});

function classified(...entries) {
  const value = result(...entries.map(([detected]) => detected));
  value.handedness = entries.map(([, categoryName, score = 0.99]) => [
    { categoryName, score },
  ]);
  return value;
}

test("high-confidence anatomical handedness supports two hands without any body landmarks", () => {
  const value = classified([hand(0.3), "Right"], [hand(0.7), "Left"]);
  const found = associateHands(value, [], 640, 480);
  expect(found.map(({ side, landmarks }) => [side, landmarks[0].x])).toEqual([
    ["left", 0.7],
    ["right", 0.3],
  ]);
  expect(found.map(({ confidence }) => confidence)).toEqual([0.99, 0.99]);
});

test("isolated hands can cross the screen without changing anatomical sides", () => {
  const found = associateHands(
    classified([hand(0.7), "Right"], [hand(0.3), "Left"]),
    [],
    640,
    480,
  );
  expect(found.map(({ side, landmarks }) => [side, landmarks[0].x])).toEqual([
    ["left", 0.3],
    ["right", 0.7],
  ]);
});

test.each([0.89, NaN, Infinity, 1.1])(
  "unconfident or invalid handedness %s cannot invent an isolated side",
  (score) => {
    expect(
      associateHands(classified([hand(0.7), "Left", score]), [], 640, 480),
    ).toEqual([]);
  },
);

test("a visible contradicting wrist rejects unrelated hands despite confident handedness or history", () => {
  const value = classified([hand(0.95, 0.9), "Left"]);
  const previous = associateHands(value, [], 640, 480);
  expect(previous).toHaveLength(1);
  expect(associateHands(value, pose(), 640, 480, previous)).toEqual([]);
});

test("a fallback cannot steal a hand from an ambiguous visible wrist", () => {
  const points = pose(0.5);
  points[16].visibility = 0;
  const value = classified([hand(0.49), "Left"], [hand(0.51), "Right"]);
  expect(associateHands(value, points, 640, 480)).toEqual([]);
});

test("duplicate confident labels remain ambiguous without a body or previous hand", () => {
  expect(
    associateHands(
      classified([hand(0.3), "Left"], [hand(0.7), "Left"]),
      [],
      640,
      480,
    ),
  ).toEqual([]);
});

test("recent hand continuity bridges a missing wrist and uncertain classifier, then body matching takes priority", () => {
  const association = createHandAssociator();
  const initial = result(hand(0.7));
  expect(association.associate(initial, pose(), 640, 480, 100)[0].side).toBe(
    "left",
  );
  const weak = classified([hand(0.71), "Right", 0.6]);
  expect(association.associate(weak, [], 640, 480, 133)[0].side).toBe("left");
  const crossed = pose(0.2, 0.71);
  expect(association.associate(weak, crossed, 640, 480, 166)[0].side).toBe(
    "right",
  );
});

test("hand continuity follows detector reorder and does not merge two sides", () => {
  const association = createHandAssociator();
  association.associate(result(hand(0.7), hand(0.3)), pose(), 640, 480, 100);
  const weak = classified(
    [hand(0.31), "Left", 0.6],
    [hand(0.71), "Right", 0.6],
  );
  expect(
    association
      .associate(weak, [], 640, 480, 133)
      .map(({ side, landmarks }) => [side, landmarks[0].x]),
  ).toEqual([
    ["left", 0.71],
    ["right", 0.31],
  ]);
});

test("ambiguous overlapping continuity cannot choose a side, while a confident classifier can", () => {
  const association = createHandAssociator();
  association.associate(
    result(hand(0.49), hand(0.51)),
    pose(0.49, 0.51),
    640,
    480,
    100,
  );
  const previous = [
    { side: "left", ...hand(0.49), confidence: 0.95 },
    { side: "right", ...hand(0.51), confidence: 0.95 },
  ];
  expect(
    associateHands(
      classified([hand(0.5), "Left", 0.6]),
      [],
      640,
      480,
      previous,
    ),
  ).toEqual([]);
  expect(
    associateHands(classified([hand(0.5), "Right"]), [], 640, 480, previous)[0]
      .side,
  ).toBe("right");
});

test.each(["reset", "gap", "backwards", "resize", "lost"])(
  "%s clears hand association continuity",
  (reason) => {
    const association = createHandAssociator();
    association.associate(result(hand(0.7)), pose(), 640, 480, 100);
    if (reason === "reset") association.reset();
    if (reason === "lost") association.associate(result(), [], 640, 480, 120);
    const timestamp =
      reason === "gap" ? 601 : reason === "backwards" ? 50 : 133;
    const width = reason === "resize" ? 800 : 640;
    expect(
      association.associate(
        classified([hand(0.7), "Right", 0.6]),
        [],
        width,
        480,
        timestamp,
      ),
    ).toEqual([]);
  },
);

test("pinned Tasks handedness agrees with anatomical sides on the unmirrored official full-body fixture", () => {
  // Actual Tasks Vision 1.1.1 / hand_landmarker_v1.task output on MediaPipe's
  // male_full_height_hands.jpg: left hand across torso, right palm extended.
  // Independently verified against Pose Landmarker wrist association. Legacy
  // MediaPipe Hands' selfie-label inversion must not be applied to this API.
  const value = classified(
    [hand(0.6022799015, 0.4005593657), "Left", 0.9624327421],
    [hand(0.2432521284, 0.4994149506), "Right", 0.9223632812],
  );
  expect(
    associateHands(value, [], 638, 1000).map(({ side, landmarks }) => [
      side,
      landmarks[0].x,
    ]),
  ).toEqual([
    ["left", 0.6022799015],
    ["right", 0.2432521284],
  ]);
});
