import { vi } from "vitest";

/** A recorder with nothing recorded or running. Create one per test and reuse
 * it across renders: components depend on its callbacks staying the same. */
export function idleRecorder(overrides = {}) {
  return {
    recordings: [],
    selected: null,
    paused: false,
    activity: null,
    attached: false,
    strip: null,
    failure: null,
    announcement: null,
    playbackRef: { current: { time: 0, paused: false } },
    record: vi.fn(async () => {}),
    startBooth: vi.fn(async () => {}),
    stop: vi.fn(),
    select: vi.fn(),
    setPaused: vi.fn(),
    seek: vi.fn(),
    dismissStrip: vi.fn(),
    dismissFailure: vi.fn(),
    attach: vi.fn(() => () => {}),
    sampleFrame: vi.fn(),
    ...overrides,
  };
}
