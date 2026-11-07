// The shell owns the page row. Screens portal their title and actions into
// it, and any extra panel (an action form) into the top of the page body.
// Above the title is the breadcrumb: the current section, then the pages
// the screen says lead to it.
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { PageBreadcrumb } from "./main-nav.tsx";
import type { Crumb } from "./main-nav.tsx";

interface PageSlots {
  leading: HTMLElement | null;
  title: HTMLElement | null;
  actions: HTMLElement | null;
  supplement: HTMLElement | null;
  /** The label of the section the current route is in. */
  section: string | null;
}

const PageSlotsContext = createContext<PageSlots | null>(null);

export const PageSlotsProvider = ({
  leading,
  title,
  actions,
  supplement,
  section,
  children,
}: PageSlots & { children: ReactNode }) => {
  const value = useMemo(
    () => ({ leading, title, actions, supplement, section }),
    [actions, leading, section, supplement, title]
  );
  return (
    <PageSlotsContext.Provider value={value}>
      {children}
    </PageSlotsContext.Provider>
  );
};

const useSlots = () => useContext(PageSlotsContext);

const noTrail: Crumb[] = [];

/** Title, the breadcrumb above it, and the page's primary actions. */
export const PageHeader = ({
  title,
  trail = noTrail,
  actions,
}: {
  title: string;
  /** Pages between the section and this one, outermost first. */
  trail?: Crumb[];
  actions?: ReactNode;
}) => {
  const slots = useSlots();
  if (!slots?.title) {
    return null;
  }
  const crumbs =
    slots.section || trail.length > 0 ? (
      <PageBreadcrumb section={slots.section} trail={trail} />
    ) : null;
  return (
    <>
      {crumbs && slots.leading ? createPortal(crumbs, slots.leading) : null}
      {createPortal(
        <h1 className="min-w-0 truncate text-xl font-medium">{title}</h1>,
        slots.title
      )}
      {actions && slots.actions ? createPortal(actions, slots.actions) : null}
    </>
  );
};

/** A panel that belongs with the page, just under the header. */
export const PageSupplement = ({ children }: { children: ReactNode }) => {
  const slots = useSlots();
  if (!slots?.supplement) {
    return children;
  }
  return createPortal(children, slots.supplement);
};
