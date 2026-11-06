# @workspace/testing

Seed fixtures, test database helpers and generated contract tests.

**Status:** placeholder; built in phase 0.

- `@workspace/testing/vitest` is the shared Vitest config. Each package's `vitest.config.ts` re-exports it.
- This package must not depend on other workspace packages: they all devDepend on it, so that would be a cycle.

Design: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md), section 6. Delivery.
