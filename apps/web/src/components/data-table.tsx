// The list card shared by record lists and catalogs: a toolbar, an error, a
// table whose header stays put while the rows scroll, and a footer.
import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

/** A header cell. Opaque, so rows sliding under it stay hidden. */
export const tableHeadCell =
  "sticky top-0 z-10 border-b bg-[color-mix(in_oklch,var(--muted)_50%,var(--background))] px-3 py-2 font-medium";

/** Separators for a body row. An opening row adds its own hover. */
export const tableBodyRow = "align-top [&>td]:border-b last:[&>td]:border-b-0";

export const DataTable = ({
  toolbar,
  error,
  footer,
  fill = false,
  children,
}: {
  toolbar?: ReactNode;
  /** Shown between the toolbar and the rows. */
  error?: ReactNode;
  footer?: ReactNode;
  /** Fill the pane and scroll the rows. A catalog grows with its rows. */
  fill?: boolean;
  children: ReactNode;
}) => (
  <div
    className={cn(
      "flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-background",
      fill ? "min-h-0 flex-1" : "shrink-0"
    )}
  >
    {toolbar ? (
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-3 py-2">
        {toolbar}
      </div>
    ) : null}
    {error ? (
      <div
        role="alert"
        className="shrink-0 border-b px-3 py-2 text-sm text-destructive"
      >
        {error}
      </div>
    ) : null}
    <div
      className={cn(
        "min-w-0",
        fill ? "min-h-0 flex-1 overflow-auto" : "overflow-x-auto"
      )}
    >
      <table className="w-full border-separate border-spacing-0 text-left text-sm">
        {children}
      </table>
    </div>
    {footer ? (
      <div className="flex shrink-0 justify-end gap-2 border-t px-3 py-2">
        {footer}
      </div>
    ) : null}
  </div>
);
