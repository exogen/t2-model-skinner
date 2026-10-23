# Motion-tracking assets

MediaPipe Tasks Vision **1.1.1** (Google LLC), distributed under Apache-2.0; see LICENSE.

The classic-worker SIMD and non-SIMD runtimes are copied unchanged from the pinned
`@mediapipe/tasks-vision` npm package. The app loads a runtime only when camera tracking
is started. Keep this directory and the npm dependency at the same version.

Pose Landmarker Lite and Full (float16), model version **1**:

- https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
- https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task

Hand Landmarker (float16), model version **1**, 7,819,105 bytes:

- https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task

This unmodified bundle contains the palm detector and 21-point hand landmark
model. It loads only when detailed hand tracking is enabled. Its model card
specifies Apache-2.0; see LICENSE:
https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf

BlazeFace short-range (float16), model version **1**, 229,746 bytes:

- https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite

This unmodified detector supplies six image landmarks when close camera framing
leaves body landmarks unreliable. It is loaded on demand and runs in the same
local worker. Its model card specifies Apache-2.0; see LICENSE:
https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20%28Short%20Range%29.pdf

BlazePose GHUM model card and license:
https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf

SHA-256:

- `pose_landmarker_lite_v1.task`: `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`
- `pose_landmarker_full_v1.task`: `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1`
- `hand_landmarker_v1.task`: `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`
- `blaze_face_short_range_v1.tflite`: `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f`
- `tasks-vision-1.1.1/vision_wasm_internal.js`: `6522286aa32dd93eff17c3da002b0649516f87abfec7a80b5bfe5c9625caa5f8`
- `tasks-vision-1.1.1/vision_wasm_internal.wasm`: `0e101a010e262ef8e78f22e3c95b60a9705fd06962753c9acd6356d9fb56b7bd`
- `tasks-vision-1.1.1/vision_wasm_nosimd_internal.js`: `942654dbdcebce08ea039af23d18e58bebf23c8607d74023d2df7071c8a7b638`
- `tasks-vision-1.1.1/vision_wasm_nosimd_internal.wasm`: `c9b1b69bb87baf9e529254d8559dcbcf4c5a9c0eda84f56a12f17d675335ec9c`
