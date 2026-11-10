// The header's navigation (decisions 0033 and 0049): the system's sections,
// each opening a panel of its categories with a line about each, and the
// account menu. Phones get one menu with every section in it.
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@workspace/ui/components/navigation-menu";
import { cn } from "@workspace/ui/lib/utils";
import { Menu } from "lucide-react";
import { Fragment } from "react";

import type { NavLink, NavPage, NavSection, SectionKey } from "../lib/nav.ts";

/** A hover has to settle this long before a panel opens. */
const OPEN_DELAY_MS = 200;

/** Up to this many pages fit in one column. */
const ONE_COLUMN_PAGES = 4;

export const SectionNav = ({
  sections,
  current,
}: {
  sections: NavSection[];
  current: SectionKey | null;
}) => (
  <NavigationMenu
    aria-label="Main"
    delay={OPEN_DELAY_MS}
    className="hidden md:flex"
  >
    <NavigationMenuList className="gap-0.5">
      {sections.map((section) => (
        <NavigationMenuItem key={section.key}>
          <NavigationMenuTrigger
            className={cn(
              "text-muted-foreground hover:text-foreground data-popup-open:text-foreground",
              section.key === current && "bg-muted text-foreground"
            )}
          >
            {section.label}
          </NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul
              className={cn(
                "grid w-[22rem] gap-0.5",
                section.pages.length > ONE_COLUMN_PAGES &&
                  "w-[36rem] grid-cols-2"
              )}
            >
              {section.pages.map((page) => (
                <li key={page.key}>
                  <NavigationMenuLink
                    render={<Link {...page.link} />}
                    className="flex-col items-start gap-0.5"
                  >
                    <span className="font-medium">{page.label}</span>
                    <span className="line-clamp-2 text-xs/relaxed text-muted-foreground">
                      {page.description}
                    </span>
                  </NavigationMenuLink>
                </li>
              ))}
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
      ))}
    </NavigationMenuList>
  </NavigationMenu>
);

/** Every section in one menu, for narrow screens. */
export const SectionMenu = ({ sections }: { sections: NavSection[] }) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={<Button variant="ghost" className="md:hidden" />}
    >
      <Menu />
      Menu
    </DropdownMenuTrigger>
    <DropdownMenuContent className="min-w-56">
      {sections.map((section, index) => (
        <Fragment key={section.key}>
          {index > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuGroup>
            <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
            {section.pages.map((page) => (
              <DropdownMenuItem key={page.key} render={<Link {...page.link} />}>
                {page.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </Fragment>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

const initialsOf = (name: string) =>
  name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

export const AccountMenu = ({
  name,
  email,
  pages,
  onSignOut,
}: {
  name: string;
  email: string;
  /** Yours, such as approvals waiting for you. Empty until the system loads. */
  pages: NavPage[];
  onSignOut: () => void;
}) => {
  const here = useRouterState({
    select: (state) =>
      state.location.pathname.startsWith("/account") ||
      state.location.pathname.startsWith("/inbox/approvals"),
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Account"
            title={email}
            className={cn("rounded-full", here && "bg-muted")}
          />
        }
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">
          {initialsOf(name) || "?"}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="text-sm text-foreground">{name}</span>
            <span className="truncate">{email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {pages.map((page) => (
          <DropdownMenuItem key={page.key} render={<Link {...page.link} />}>
            {page.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem render={<Link to="/account/agents" />}>
          My agents
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** A step on the way to the current page. */
export interface Crumb {
  label: string;
  link: NavLink;
}

/** The pages above this one. The title is the last step. */
export const PageBreadcrumb = ({ trail }: { trail: Crumb[] }) => (
  <Breadcrumb>
    <BreadcrumbList className="gap-1.5 sm:gap-1.5">
      {trail.map((crumb, index) => (
        <Fragment key={crumb.label}>
          {index > 0 ? <BreadcrumbSeparator /> : null}
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link {...crumb.link} />}>
              {crumb.label}
            </BreadcrumbLink>
          </BreadcrumbItem>
        </Fragment>
      ))}
    </BreadcrumbList>
  </Breadcrumb>
);
