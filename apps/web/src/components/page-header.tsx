// The shell owns the page row. Screens portal their title and actions into
// it, and any extra panel (an action form) into the top of the page body.
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

interface PageSlots {
  leading: HTMLElement | null;
  title: HTMLElement | null;
  actions: HTMLElement | null;
  supplement: HTMLElement | null;
}

const PageSlotsContext = createContext<PageSlots | null>(null);

export const PageSlotsProvider = ({
  leading,
  title,
  actions,
  supplement,
  children,
}: PageSlots & { children: ReactNode }) => {
  const value = useMemo(
    () => ({ leading, title, actions, supplement }),
    [actions, leading, supplement, title]
  );
  return (
    <PageSlotsContext.Provider value={value}>
      {children}
    </PageSlotsContext.Provider>
  );
};

const useSlots = () => useContext(PageSlotsContext);

/** Title, an optional back link above it, and the page's primary actions. */
export const PageHeader = ({
  title,
  leading,
  actions,
}: {
  title: string;
  leading?: ReactNode;
  actions?: ReactNode;
}) => {
  const slots = useSlots();
  if (!slots?.title) {
    return null;
  }
  return (
    <>
      {leading && slots.leading ? createPortal(leading, slots.leading) : null}
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
