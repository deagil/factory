import type { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";

import { DevMenuBar } from "../dev/dev-menu-bar.tsx";

import appCss from "@workspace/ui/globals.css?url";

const RootDocument = ({ children }: { children: React.ReactNode }) => (
  <html lang="en">
    <head>
      <HeadContent />
    </head>
    <body
      className="flex h-svh flex-col overflow-hidden"
      style={
        import.meta.env.DEV
          ? ({ "--app-menu-height": "2rem" } as React.CSSProperties)
          : undefined
      }
    >
      {import.meta.env.DEV ? <DevMenuBar /> : null}
      {import.meta.env.DEV ? (
        <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col shadow-[0_-1px_1px_rgb(4_12_24/0.4),0_-10px_16px_-10px_rgb(4_12_24/0.75)]">
          {children}
        </div>
      ) : (
        children
      )}
      <Scripts />
    </body>
  </html>
);

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        {
          charSet: "utf-8",
        },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1",
        },
        {
          title: "Factory",
        },
      ],
      links: [
        {
          rel: "stylesheet",
          href: appCss,
        },
      ],
    }),
    notFoundComponent: () => (
      <main className="container mx-auto p-4 pt-16">
        <h1>404</h1>
        <p>The requested page could not be found.</p>
      </main>
    ),
    shellComponent: RootDocument,
  }
);
