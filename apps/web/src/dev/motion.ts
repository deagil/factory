// Playback rates for the local-development Design menu. The frame loop
// catches CSS transitions that start after the rate changes; document
// animations begin at 1×.

export const MOTION_RATES = [
  { rate: 0.25, label: "0.25×" },
  { rate: 0.5, label: "0.5×" },
  { rate: 1, label: "Normal" },
  { rate: 2, label: "2×" },
  { rate: 4, label: "4×" },
] as const;

export type MotionRate = (typeof MOTION_RATES)[number]["rate"];

export const MOTION_RATE_KEY = "factory-dev-motion";

const isMotionRate = (rate: number): rate is MotionRate =>
  MOTION_RATES.some((item) => item.rate === rate);

export const motionRateFrom = (value: string | null): MotionRate => {
  const rate = Number(value);
  return isMotionRate(rate) ? rate : 1;
};

const listeners = new Set<() => void>();

export const subscribeMotionRate = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const readMotionRate = (): MotionRate => {
  if (typeof sessionStorage === "undefined") {
    return 1;
  }
  return motionRateFrom(sessionStorage.getItem(MOTION_RATE_KEY));
};

export const writeMotionRate = (rate: MotionRate) => {
  sessionStorage.setItem(MOTION_RATE_KEY, String(rate));
  for (const listener of listeners) {
    listener();
  }
};

export const motionRateLabel = (rate: MotionRate): string => {
  const match = MOTION_RATES.find((item) => item.rate === rate);
  if (!match) {
    return "Normal";
  }
  return match.label;
};

interface Playback {
  playbackRate: number;
}

export const applyMotionRate = (
  animations: Iterable<Playback>,
  rate: number
) => {
  for (const animation of animations) {
    if (animation.playbackRate !== rate) {
      animation.playbackRate = rate;
    }
  }
};

/** Applies `rate` now, and keeps applying it to animations that start later. */
export const watchMotionRate = (
  rate: number,
  getAnimations: () => Iterable<Playback>,
  requestFrame: (callback: () => void) => number,
  cancelFrame: (id: number) => void
): (() => void) => {
  applyMotionRate(getAnimations(), rate);
  let frame = 0;
  if (rate !== 1) {
    frame = requestFrame(function tick() {
      applyMotionRate(getAnimations(), rate);
      frame = requestFrame(tick);
    });
  }
  return () => {
    if (frame !== 0) {
      cancelFrame(frame);
    }
  };
};
