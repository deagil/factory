import { describe, expect, it } from "vitest";

import {
  DEFAULT_SIDEBAR_REM,
  DESKTOP_MIN_PX,
  MAIN_FLOOR_REM,
  MAX_SIDEBAR_REM,
  MAX_SIDEBAR_VIEWPORT_PERCENT,
  MIN_SIDEBAR_REM,
  REM_PX,
  SIDEBAR_OPEN_KEY,
  SIDEBAR_SIDE_KEY,
  SIDEBAR_WIDTH_PERCENT_KEY,
  canResizeSidebar,
  clampSidebarWidth,
  clearSidebarWidthPercent,
  dragCountsAsResize,
  readSidebarOpen,
  readSidebarSide,
  readSidebarWidthPercent,
  resizeBounds,
  resolveSidebarWidth,
  signedDragDelta,
  toggleSidebarSide,
  writeSidebarOpen,
  writeSidebarSide,
  writeSidebarWidthPercent,
} from "./sidebar.ts";
import type { KeyValueStore } from "./sidebar.ts";

const memoryStore = (): KeyValueStore => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
};

describe("sidebar geometry", () => {
  it("grows a left sidebar and shrinks a right one when dragged right", () => {
    expect(signedDragDelta("left", 40)).toBe(40);
    expect(signedDragDelta("right", 40)).toBe(-40);
  });

  it("ignores a twitch and keeps a real drag", () => {
    expect(dragCountsAsResize(2)).toBeFalsy();
    expect(dragCountsAsResize(-2)).toBeFalsy();
    expect(dragCountsAsResize(3)).toBeTruthy();
  });

  it("clamps between the rem floor, the viewport share, and the main pane floor", () => {
    const viewportWidth = 1440;
    const { minPx, maxPx } = resizeBounds(viewportWidth);
    const expectedMax = Math.min(
      viewportWidth * (MAX_SIDEBAR_VIEWPORT_PERCENT / 100),
      MAX_SIDEBAR_REM * REM_PX,
      viewportWidth - MAIN_FLOOR_REM * REM_PX
    );

    expect(minPx).toBe(MIN_SIDEBAR_REM * REM_PX);
    expect(maxPx).toBe(expectedMax);
    expect(clampSidebarWidth(10, viewportWidth)).toBe(minPx);
    expect(clampSidebarWidth(900, viewportWidth)).toBe(expectedMax);
    expect(clampSidebarWidth(minPx + 40, viewportWidth)).toBe(minPx + 40);
  });

  it("uses the saved percentage, and the default width when nothing is saved", () => {
    expect(resolveSidebarWidth(1440, null)).toBe(DEFAULT_SIDEBAR_REM * REM_PX);
    expect(resolveSidebarWidth(1440, 20)).toBe(288);
    expect(resolveSidebarWidth(800, 80)).toBe(resizeBounds(800).maxPx);
  });

  it("allows a drag only while the desktop sidebar is open", () => {
    expect(
      canResizeSidebar({ open: true, viewportWidth: DESKTOP_MIN_PX })
    ).toBeTruthy();
    expect(
      canResizeSidebar({ open: true, viewportWidth: DESKTOP_MIN_PX - 1 })
    ).toBeFalsy();
    expect(canResizeSidebar({ open: false, viewportWidth: 1280 })).toBeFalsy();
  });
});

describe("sidebar preferences", () => {
  it("defaults to an open sidebar on the left", () => {
    const store = memoryStore();
    expect(readSidebarSide(store)).toBe("left");
    expect(readSidebarOpen(store)).toBeTruthy();
    expect(readSidebarWidthPercent(store)).toBeNull();
  });

  it("round-trips side, open, and width", () => {
    const store = memoryStore();
    writeSidebarSide(store, toggleSidebarSide("left"));
    writeSidebarOpen(store, false);
    writeSidebarWidthPercent(store, 24);

    expect(store.getItem(SIDEBAR_SIDE_KEY)).toBe("right");
    expect(store.getItem(SIDEBAR_OPEN_KEY)).toBe("false");
    expect(readSidebarSide(store)).toBe("right");
    expect(readSidebarOpen(store)).toBeFalsy();
    expect(readSidebarWidthPercent(store)).toBe(24);
  });

  it("ignores a stored side or width it does not understand", () => {
    const store = memoryStore();
    store.setItem(SIDEBAR_SIDE_KEY, "up");
    store.setItem(SIDEBAR_WIDTH_PERCENT_KEY, "nope");

    expect(readSidebarSide(store)).toBe("left");
    expect(readSidebarWidthPercent(store)).toBeNull();

    clearSidebarWidthPercent(store);
    expect(store.getItem(SIDEBAR_WIDTH_PERCENT_KEY)).toBeNull();
  });
});
