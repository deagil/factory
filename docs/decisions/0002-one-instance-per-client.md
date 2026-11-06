# 0002. One instance per client

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Systems are built for individual clients and may be handed over with their code. Multi-tenancy (as in the Niovant and splx designs) adds tenant scoping, row-level security and shared upgrades that a per-client system does not need.

## Decision

Each client gets their own deployment: one API service, one static web front end and one Postgres database, from their own client repo that pins a version of the core packages. Hosting starts on a simple PaaS with managed Postgres.

## Consequences

- No `tenant_id` columns, no tenancy row-level security, no cells.
- Upgrades are per client, done deliberately by an agent and approved by me.
- Handover is a repo and a database, nothing shared.
