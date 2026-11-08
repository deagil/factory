// Signed-in shell. The sidebar and the main pane share one canvas: drag
// the seam to resize, move the sidebar to either side, or collapse it.
// The sidebar is kept for the agent chat (decision 0033). The main pane's
// header is the navigation: sections and the account menu, then the
// breadcrumb, then the page's title and primary actions.

import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { PanelLeft, PanelRight, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";

import type { NavSection, SectionKey } from "../lib/nav.ts";
import {
  DESKTOP_MIN_PX,
  canResizeSidebar,
  clearSidebarWidthPercent,
  clampSidebarWidth,
  dragCountsAsResize,
  readSidebarOpen,
  readSidebarSide,
  readSidebarWidthPercent,
  resolveSidebarWidth,
  signedDragDelta,
  toggleSidebarSide,
  writeSidebarOpen,
  writeSidebarSide,
  writeSidebarWidthPercent,
} from "../shell/sidebar.ts";
import type { KeyValueStore, SidebarSide } from "../shell/sidebar.ts";
import { AccountMenu, SectionMenu, SectionNav } from "./main-nav.tsx";
import { PageSlotsProvider } from "./page-header.tsx";

const HIGHLIGHT_DELAY_MS = 80;
const DESKTOP_QUERY = "(min-width: 768px)";

const preferenceStore = (): KeyValueStore => {
  try {
    return window.localStorage;
  } catch {
    return {
      getItem: () => null,
      setItem: () => {
        // localStorage is unavailable.
      },
      removeItem: () => {
        // localStorage is unavailable.
      },
    };
  }
};

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.closest("input, textarea, select, [contenteditable='true']") !==
      null);

const closedShift = (side: SidebarSide) =>
  side === "left" ? "translateX(-100%)" : "translateX(100%)";

const mainInsetClass = (side: SidebarSide, open: boolean) => {
  if (side === "left") {
    return open ? "md:mr-2 md:ml-0" : "md:mx-2";
  }
  return open ? "md:ml-2 md:mr-0" : "md:mx-2";
};

const SidebarPanel = ({
  side,
  revealed,
  onClose,
  onToggleSide,
  panelRef,
}: {
  side: SidebarSide;
  revealed: boolean;
  onClose: () => void;
  onToggleSide: () => void;
  panelRef: RefObject<HTMLDivElement | null>;
}) => {
  const moveRight = side === "left";
  const sideLabel = moveRight
    ? "Move the agent to the right"
    : "Move the agent to the left";

  return (
    <div
      ref={panelRef}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1 flex-col py-2",
        // A little extra padding on the seam. The resize handle is centered
        // in that gutter, clear of the selected item.
        side === "left" ? "pr-4 pl-2" : "pr-2 pl-4"
      )}
    >
      <div
        className={cn(
          "relative z-40 flex items-center gap-1 px-1 py-1 transition-opacity duration-250 ease-in-out motion-reduce:transition-none",
          side === "right" && "flex-row-reverse",
          revealed ? "opacity-100" : "opacity-0"
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="opacity-50 hover:opacity-100"
          aria-label="Close the agent"
          title="Close the agent"
          onClick={onClose}
        >
          <X />
        </Button>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="opacity-50 hover:opacity-100"
          aria-label={sideLabel}
          title={sideLabel}
          onClick={onToggleSide}
        >
          {moveRight ? <PanelRight /> : <PanelLeft />}
        </Button>
      </div>
      <section
        aria-label="Agent"
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground"
      >
        <Sparkles className="size-5" />
        <p>The in-app agent will work here, with the same tools as MCP.</p>
      </section>
    </div>
  );
};

const MenuButton = ({
  side,
  open,
  onToggle,
}: {
  side: SidebarSide;
  open: boolean;
  onToggle: () => void;
}) => (
  <div
    inert={open ? true : undefined}
    aria-hidden={open ? true : undefined}
    className={cn(
      "grid shrink-0 transition-[grid-template-columns,margin] ease-in-out motion-reduce:transition-none motion-reduce:delay-0",
      // The label fades at full size, then the slot closes toward the nav.
      // Closing them together clips the label into the sidebar seam.
      open
        ? "grid-cols-[0fr] delay-100 duration-200"
        : "grid-cols-[1fr] delay-0 duration-250",
      open && (side === "left" ? "-mr-2" : "-ml-2")
    )}
  >
    <div className="min-w-0 overflow-hidden">
      <Button
        type="button"
        variant="ghost"
        className={cn(
          "transition-opacity ease-out motion-reduce:transition-none motion-reduce:delay-0",
          open
            ? "pointer-events-none opacity-0 delay-0 duration-150"
            : "delay-75 duration-200"
        )}
        aria-label="Open the agent"
        title="Open the agent"
        onClick={onToggle}
      >
        <Sparkles />
        <span className="hidden sm:inline">Agent</span>
      </Button>
    </div>
  </div>
);

const MainNav = ({
  sections,
  current,
  pending,
  error,
}: {
  sections: NavSection[];
  current: SectionKey | null;
  pending: boolean;
  error: string | null;
}) => (
  <div className="flex min-w-0 flex-1 items-center">
    {pending && <p className="px-2 text-sm text-muted-foreground">Loading…</p>}
    {error && (
      <p role="alert" className="truncate px-2 text-sm text-destructive">
        {`Couldn't load the system: ${error}`}
      </p>
    )}
    {sections.length > 0 && (
      <>
        <SectionMenu sections={sections} />
        <SectionNav sections={sections} current={current} />
      </>
    )}
  </div>
);

const ResizeHandle = ({
  side,
  widthPx,
  onWidth,
  onCommit,
  onReset,
  onDragging,
}: {
  side: SidebarSide;
  widthPx: number;
  onWidth: (widthPx: number) => void;
  onCommit: (widthPx: number) => void;
  onReset: () => void;
  onDragging: (dragging: boolean) => void;
}) => {
  const [highlight, setHighlight] = useState(false);
  const [dragging, setDragging] = useState(false);
  const highlightTimer = useRef<number | null>(null);
  const dragRef = useRef<{
    startX: number;
    startWidthPx: number;
    moved: boolean;
  } | null>(null);
  const widthRef = useRef(widthPx);
  const onWidthRef = useRef(onWidth);
  const onCommitRef = useRef(onCommit);
  const onDraggingRef = useRef(onDragging);

  useEffect(() => {
    widthRef.current = widthPx;
    onWidthRef.current = onWidth;
    onCommitRef.current = onCommit;
    onDraggingRef.current = onDragging;
  }, [onCommit, onDragging, onWidth, widthPx]);

  useEffect(
    () => () => {
      if (highlightTimer.current !== null) {
        window.clearTimeout(highlightTimer.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!dragging) {
      return;
    }

    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const deltaX = event.clientX - drag.startX;
      if (dragCountsAsResize(deltaX)) {
        drag.moved = true;
      }
      const next = clampSidebarWidth(
        drag.startWidthPx + signedDragDelta(side, deltaX),
        window.innerWidth
      );
      widthRef.current = next;
      onWidthRef.current(next);
    };

    const end = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      setHighlight(false);
      onDraggingRef.current(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (drag?.moved) {
        onCommitRef.current(widthRef.current);
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [dragging, side]);

  const clearHighlightTimer = () => {
    if (highlightTimer.current !== null) {
      window.clearTimeout(highlightTimer.current);
      highlightTimer.current = null;
    }
  };

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    dragRef.current = {
      startX: event.clientX,
      startWidthPx: widthPx,
      moved: false,
    };
    setDragging(true);
    setHighlight(true);
    clearHighlightTimer();
    onDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <button
      type="button"
      aria-label="Resize sidebar"
      className={cn(
        // Centered in the seam gutter, and kept inside the sidebar so it
        // cannot clip the main pane.
        "absolute inset-y-0 z-30 hidden w-4 touch-none border-0 bg-transparent p-0 md:block",
        "after:absolute after:top-2 after:bottom-2 after:left-1/2 after:ml-[-1px] after:w-0.5 after:rounded-full after:transition-colors",
        highlight || dragging
          ? "cursor-col-resize after:bg-border"
          : "cursor-default after:bg-transparent",
        side === "left" ? "right-0.5" : "left-0.5"
      )}
      onDoubleClick={onReset}
      onPointerDown={startDrag}
      onPointerEnter={() => {
        clearHighlightTimer();
        highlightTimer.current = window.setTimeout(() => {
          setHighlight(true);
          highlightTimer.current = null;
        }, HIGHLIGHT_DELAY_MS);
      }}
      onPointerLeave={() => {
        clearHighlightTimer();
        if (!dragging) {
          setHighlight(false);
        }
      }}
    />
  );
};

const ShellHeader = ({
  side,
  sidebarOpen,
  sections,
  currentSection,
  user,
  status,
  navPending,
  navError,
  onSignOut,
  onToggle,
  onNavigate,
  leadingRef,
  titleRef,
  actionsRef,
}: {
  side: SidebarSide;
  sidebarOpen: boolean;
  sections: NavSection[];
  currentSection: SectionKey | null;
  user: { name: string; email: string };
  status: ReactNode;
  navPending: boolean;
  navError: string | null;
  onSignOut: () => void;
  onToggle: () => void;
  onNavigate: () => void;
  leadingRef: (node: HTMLDivElement | null) => void;
  titleRef: (node: HTMLDivElement | null) => void;
  actionsRef: (node: HTMLDivElement | null) => void;
}) => {
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = navRef.current;
    if (!node) {
      return;
    }
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("a")) {
        return;
      }
      if (!window.matchMedia(DESKTOP_QUERY).matches) {
        onNavigate();
      }
    };
    node.addEventListener("click", onClick);
    return () => node.removeEventListener("click", onClick);
  }, [onNavigate]);

  return (
    <header className="shrink-0">
      <div
        ref={navRef}
        className="flex items-center gap-2 px-3.5 pt-3.5 pb-1.5"
      >
        {side === "left" ? (
          <MenuButton side={side} open={sidebarOpen} onToggle={onToggle} />
        ) : null}
        <MainNav
          sections={sections}
          current={currentSection}
          pending={navPending}
          error={navError}
        />
        {status}
        <AccountMenu
          name={user.name}
          email={user.email}
          onSignOut={onSignOut}
        />
        {side === "right" ? (
          <MenuButton side={side} open={sidebarOpen} onToggle={onToggle} />
        ) : null}
      </div>
      <div
        ref={leadingRef}
        data-slot="page-leading"
        className="px-6 pt-3 empty:hidden"
      />
      <div className="flex min-h-14 items-center justify-between gap-4 px-6 py-3 [[data-slot=page-leading]:not(:empty)+&]:pt-1">
        <div ref={titleRef} className="min-w-0 flex-1" />
        <div
          ref={actionsRef}
          className="flex shrink-0 flex-wrap items-center justify-end gap-2"
        />
      </div>
    </header>
  );
};

export const AppShell = ({
  user,
  sections,
  currentSection,
  status,
  navPending = false,
  navError = null,
  onSignOut,
  children,
}: {
  user: { name: string; email: string };
  sections: NavSection[];
  /** Shown before the account menu, such as the caller's draft (P2.10b). */
  status?: ReactNode;
  currentSection: SectionKey | null;
  navPending?: boolean;
  navError?: string | null;
  onSignOut: () => void;
  children: ReactNode;
}) => {
  const [side, setSide] = useState<SidebarSide>(() =>
    readSidebarSide(preferenceStore())
  );
  const [open, setOpen] = useState(() => readSidebarOpen(preferenceStore()));
  const [openMobile, setOpenMobile] = useState(false);
  const [widthPx, setWidthPx] = useState(() =>
    resolveSidebarWidth(
      typeof window === "undefined" ? 1280 : window.innerWidth,
      readSidebarWidthPercent(preferenceStore())
    )
  );
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth
  );
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === "undefined"
      ? true
      : window.matchMedia(DESKTOP_QUERY).matches
  );
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [leadingSlot, setLeadingSlot] = useState<HTMLElement | null>(null);
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const [supplementSlot, setSupplementSlot] = useState<HTMLElement | null>(
    null
  );

  const sidebarOpen = isDesktop ? open : openMobile;

  const changeOpen = useCallback(
    (next: boolean) => {
      if (isDesktop) {
        setOpen(next);
        return;
      }
      setOpenMobile(next);
    },
    [isDesktop]
  );

  useEffect(() => {
    writeSidebarSide(preferenceStore(), side);
  }, [side]);

  useEffect(() => {
    writeSidebarOpen(preferenceStore(), open);
  }, [open]);

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    draggingRef.current = dragging;
  }, [dragging]);

  useEffect(() => {
    const apply = () => {
      const viewport = window.innerWidth;
      setViewportWidth(viewport);
      // A phone-sized window must not squash the desktop width. The drawer
      // has its own width, and the saved one is restored on the way back.
      if (draggingRef.current || viewport < DESKTOP_MIN_PX) {
        return;
      }
      setWidthPx(
        resolveSidebarWidth(
          viewport,
          readSidebarWidthPercent(preferenceStore())
        )
      );
    };
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  useEffect(() => {
    const node = panelRef.current;
    if (!node) {
      return;
    }
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("a")) {
        return;
      }
      if (!window.matchMedia(DESKTOP_QUERY).matches) {
        setOpenMobile(false);
      }
    };
    node.addEventListener("click", onClick);
    return () => node.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "b" || !(event.metaKey || event.ctrlKey)) {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      event.preventDefault();
      changeOpen(!sidebarOpen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changeOpen, sidebarOpen]);

  const containerStyle: CSSProperties = isDesktop
    ? { width: open ? "var(--sidebar-width)" : 0 }
    : {
        width: "min(18rem, calc(100vw - 2rem))",
        left: side === "left" ? 0 : "auto",
        right: side === "right" ? 0 : "auto",
        transform: openMobile ? "none" : closedShift(side),
      };

  return (
    <PageSlotsProvider
      leading={leadingSlot}
      title={titleSlot}
      actions={actionsSlot}
      supplement={supplementSlot}
      section={
        sections.find((section) => section.key === currentSection)?.label ??
        null
      }
    >
      <div
        data-slot="sidebar-wrapper"
        data-side={side}
        data-state={open ? "expanded" : "collapsed"}
        data-resizing={dragging ? "true" : undefined}
        className="flex min-h-0 w-full flex-1 overflow-hidden bg-muted"
        style={{ "--sidebar-width": `${widthPx}px` } as CSSProperties}
      >
        <style>
          {`[data-resizing="true"] [data-slot="sidebar-container"] {
  transition: none !important;
}`}
        </style>
        <div
          data-slot="sidebar-container"
          inert={sidebarOpen ? undefined : true}
          aria-hidden={sidebarOpen ? undefined : true}
          className={cn(
            "fixed top-(--app-menu-height) bottom-0 z-40 flex min-h-0 min-w-0 bg-muted shadow-2xl transition-[left,right,width,transform] duration-300 ease-out motion-reduce:transition-none",
            "md:relative md:inset-auto md:z-auto md:shrink-0 md:overflow-hidden md:shadow-none",
            side === "right" && "md:order-last"
          )}
          style={containerStyle}
        >
          <SidebarPanel
            side={side}
            revealed={sidebarOpen}
            onClose={() => changeOpen(false)}
            onToggleSide={() => setSide((value) => toggleSidebarSide(value))}
            panelRef={panelRef}
          />
          {canResizeSidebar({ open, viewportWidth }) ? (
            <ResizeHandle
              side={side}
              widthPx={widthPx}
              onWidth={setWidthPx}
              onCommit={(next) => {
                if (window.innerWidth > 0) {
                  writeSidebarWidthPercent(
                    preferenceStore(),
                    (next / window.innerWidth) * 100
                  );
                }
              }}
              onReset={() => {
                clearSidebarWidthPercent(preferenceStore());
                setWidthPx(resolveSidebarWidth(window.innerWidth, null));
              }}
              onDragging={setDragging}
            />
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Close sidebar"
          tabIndex={openMobile ? 0 : -1}
          className={cn(
            "fixed inset-x-0 top-(--app-menu-height) bottom-0 z-30 bg-black/20 transition-opacity duration-300 ease-out motion-reduce:transition-none md:hidden",
            openMobile ? "opacity-100" : "pointer-events-none opacity-0"
          )}
          onClick={() => changeOpen(false)}
        />
        <main
          data-slot="sidebar-inset"
          className={cn(
            "relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background",
            "md:my-2 md:rounded-3xl md:border md:shadow-xs",
            side === "right" && "md:order-first",
            mainInsetClass(side, open)
          )}
        >
          <ShellHeader
            side={side}
            sidebarOpen={sidebarOpen}
            sections={sections}
            currentSection={currentSection}
            user={user}
            status={status}
            navPending={navPending}
            navError={navError}
            onSignOut={onSignOut}
            onToggle={() => changeOpen(!sidebarOpen)}
            onNavigate={() => setOpenMobile(false)}
            leadingRef={setLeadingSlot}
            titleRef={setTitleSlot}
            actionsRef={setActionsSlot}
          />
          <div className="min-h-0 flex-1 overflow-auto px-6 pt-4 pb-6">
            <div
              ref={setSupplementSlot}
              className="flex flex-col gap-4 pb-4 empty:hidden"
            />
            {children}
          </div>
        </main>
      </div>
    </PageSlotsProvider>
  );
};
