import { describe, expect, it, vi } from "vitest";

import {
  applyMotionRate,
  motionRateFrom,
  motionRateLabel,
  readMotionRate,
  subscribeMotionRate,
  watchMotionRate,
  writeMotionRate,
} from "./motion.ts";

describe(motionRateFrom, () => {
  it("keeps a known rate", () => {
    expect(motionRateFrom("0.25")).toBe(0.25);
    expect(motionRateFrom("2")).toBe(2);
  });

  it("falls back to normal", () => {
    expect(motionRateFrom(null)).toBe(1);
    expect(motionRateFrom("3")).toBe(1);
    expect(motionRateFrom("slow")).toBe(1);
  });
});

describe(motionRateLabel, () => {
  it("names the normal rate", () => {
    expect(motionRateLabel(1)).toBe("Normal");
    expect(motionRateLabel(0.5)).toBe("0.5×");
  });
});

describe(writeMotionRate, () => {
  it("stores the rate and tells subscribers", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    });
    let calls = 0;
    const stop = subscribeMotionRate(() => {
      calls += 1;
    });
    writeMotionRate(0.5);
    expect(readMotionRate()).toBe(0.5);
    expect(calls).toBe(1);
    stop();
    vi.unstubAllGlobals();
  });
});

describe(applyMotionRate, () => {
  it("sets the playback rate on each animation", () => {
    const running = { playbackRate: 1 };
    const done = { playbackRate: 0.25 };
    applyMotionRate([running, done], 0.25);
    expect(running.playbackRate).toBe(0.25);
    expect(done.playbackRate).toBe(0.25);
  });
});

describe(watchMotionRate, () => {
  it("slows animations that start after the rate is chosen", () => {
    const first = { playbackRate: 1 };
    const later = { playbackRate: 1 };
    const animations = [first];
    const captured: { current?: () => void } = {};
    const stop = watchMotionRate(
      0.25,
      () => animations,
      (frame) => {
        captured.current = frame;
        return 1;
      },
      () => {
        captured.current = undefined;
      }
    );
    expect(first.playbackRate).toBe(0.25);
    animations.push(later);
    captured.current?.();
    expect(later.playbackRate).toBe(0.25);
    stop();
    expect(captured.current).toBeUndefined();
  });

  it("restores normal speed without watching", () => {
    const animation = { playbackRate: 0.25 };
    let scheduled = false;
    const stop = watchMotionRate(
      1,
      () => [animation],
      () => {
        scheduled = true;
        return 1;
      },
      () => {}
    );
    expect(animation.playbackRate).toBe(1);
    expect(scheduled).toBeFalsy();
    stop();
  });
});
