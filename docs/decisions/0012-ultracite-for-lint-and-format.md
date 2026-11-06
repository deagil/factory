# 0012. Ultracite for linting and formatting

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

The shadcn TanStack Start template came with ESLint (`@tanstack/eslint-config`) and Prettier, configured separately in `apps/web` and `packages/ui`. Phase 0 needs one lint and format setup across 17 packages that agents can run quickly and fix on their own, without each package owning its rules.

## Decision

- Use [Ultracite](https://www.ultracite.ai/) with its recommended provider, **Oxlint + Oxfmt**. ESLint and Prettier are removed.
- One config at the root: `oxlint.config.ts` extends Ultracite's `core`, `react`, `tanstack`, `vitest` and `drizzle` presets, and `oxfmt.config.ts` uses Ultracite's formatter preset with the Tailwind stylesheet from `packages/ui`.
- Every package's `lint` script is `ultracite check` (Oxlint plus `oxfmt --check`), run per package by Turborepo; `lint:root` checks files outside packages. `pnpm format` runs `ultracite fix` over the whole repo.
- Override Ultracite's rules only with a comment saying why. The one override so far turns off `func-style` and `react/function-component-definition` for `packages/ui/src/components`, which the shadcn CLI generates.

## Consequences

- Code style follows Ultracite's defaults (semicolons, sorted imports, sorted Tailwind classes, sorted `package.json`), not the template's Prettier settings.
- Prettier plugins can't be used. Oxfmt sorts Tailwind classes itself.
- Ultracite pins the Oxlint and Oxfmt versions it was verified with; upgrade with `pnpm dlx ultracite@latest upgrade`, then `pnpm dlx ultracite doctor`.
- Type-aware linting (`--type-aware`, which adds `oxlint-tsgolint`) is off. Turning it on is a later decision, mainly to catch floating promises.
