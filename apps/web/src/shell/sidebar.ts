// Geometry and saved preferences for the signed-in sidebar.
//
// Width is a percentage of the viewport, so a drag survives the window
// changing size. The clamp keeps the navigation readable and leaves the
// main pane a floor to work in.

export type SidebarSide = "left" | "right";

export interface KeyValueStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export const REM_PX = 16;

/** Narrowest the navigation can be dragged. */
export const MIN_SIDEBAR_REM = 12;

/** Widest the navigation can be dragged. */
export const MAX_SIDEBAR_REM = 22;

/** Cap as a share of the viewport, so a wide monitor stays a sidebar. */
export const MAX_SIDEBAR_VIEWPORT_PERCENT = 36;

/** The main pane never gives up less than this. */
export const MAIN_FLOOR_REM = 28;

/** Width before anyone has dragged. Matches the old fixed column (w-56). */
export const DEFAULT_SIDEBAR_REM = 14;

/** Resize and the push-layout start at the `md` breakpoint. */
export const DESKTOP_MIN_PX = 768;

/** Movement below this is a click, not a resize. */
export const DRAG_THRESHOLD_PX = 2;

export const SIDEBAR_SIDE_KEY = "factory-sidebar-side";
export const SIDEBAR_OPEN_KEY = "factory-sidebar-open";
export const SIDEBAR_WIDTH_PERCENT_KEY = "factory-sidebar-width-percent";

export const toggleSidebarSide = (side: SidebarSide): SidebarSide =>
  side === "left" ? "right" : "left";

/** Dragging right grows a left sidebar and shrinks a right one. */
export const signedDragDelta = (side: SidebarSide, deltaX: number): number =>
  side === "left" ? deltaX : -deltaX;

export const dragCountsAsResize = (deltaX: number): boolean =>
  Math.abs(deltaX) > DRAG_THRESHOLD_PX;

export const resizeBounds = (
  viewportWidth: number
): { minPx: number; maxPx: number } => {
  const minPx = MIN_SIDEBAR_REM * REM_PX;
  const maxPx = Math.max(
    minPx,
    Math.min(
      viewportWidth * (MAX_SIDEBAR_VIEWPORT_PERCENT / 100),
      MAX_SIDEBAR_REM * REM_PX,
      viewportWidth - MAIN_FLOOR_REM * REM_PX
    )
  );
  return { minPx, maxPx };
};

export const clampSidebarWidth = (
  widthPx: number,
  viewportWidth: number
): number => {
  const { minPx, maxPx } = resizeBounds(viewportWidth);
  return Math.min(maxPx, Math.max(minPx, widthPx));
};

export const defaultSidebarWidth = (viewportWidth: number): number =>
  clampSidebarWidth(DEFAULT_SIDEBAR_REM * REM_PX, viewportWidth);

export const resolveSidebarWidth = (
  viewportWidth: number,
  storedPercent: number | null
): number => {
  if (storedPercent === null) {
    return defaultSidebarWidth(viewportWidth);
  }
  return clampSidebarWidth(
    viewportWidth * (storedPercent / 100),
    viewportWidth
  );
};

export const canResizeSidebar = ({
  open,
  viewportWidth,
}: {
  open: boolean;
  viewportWidth: number;
}): boolean => open && viewportWidth >= DESKTOP_MIN_PX;

export const readSidebarSide = (store: KeyValueStore): SidebarSide =>
  store.getItem(SIDEBAR_SIDE_KEY) === "right" ? "right" : "left";

export const readSidebarOpen = (store: KeyValueStore): boolean =>
  store.getItem(SIDEBAR_OPEN_KEY) !== "false";

export const readSidebarWidthPercent = (
  store: KeyValueStore
): number | null => {
  const stored = store.getItem(SIDEBAR_WIDTH_PERCENT_KEY);
  if (stored === null) {
    return null;
  }
  const percent = Number(stored);
  if (!Number.isFinite(percent) || percent <= 0) {
    return null;
  }
  return percent;
};

export const writeSidebarSide = (store: KeyValueStore, side: SidebarSide) => {
  store.setItem(SIDEBAR_SIDE_KEY, side);
};

export const writeSidebarOpen = (store: KeyValueStore, open: boolean) => {
  store.setItem(SIDEBAR_OPEN_KEY, open ? "true" : "false");
};

export const writeSidebarWidthPercent = (
  store: KeyValueStore,
  percent: number
) => {
  store.setItem(SIDEBAR_WIDTH_PERCENT_KEY, String(percent));
};

export const clearSidebarWidthPercent = (store: KeyValueStore) => {
  store.removeItem(SIDEBAR_WIDTH_PERCENT_KEY);
};
