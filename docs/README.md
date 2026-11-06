# Docs

| Document | What it covers |
| --- | --- |
| [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) | How the factory works: repos, database schema, components, how they fit together, delivery, agents, stack and glossary |
| [decisions/](decisions/) | One record per settled decision, with context and consequences |
| [plans/](plans/README.md) | One task list per build phase, with a resume section for whoever picks it up next |

The planning brief, with the reasoning behind these decisions and the open questions, is the "Software Factory Core — Design Brief" doc in Claude.

## Open questions

Carried over from the brief; each becomes a decision record once settled.

- Config file format: YAML (current assumption) or JSON.
- Approvals for changing roles and approval policies themselves.
- Who owns each client's repo while I host it.
- Whether personal dashboards and saved filters are data (current assumption) rather than config.
- Whether previews need an anonymised copy of real data.
- Data import from clients' existing systems.
- A fleet view across client instances.
- Where tickets live (Linear or Notion), and when a factory app is worth building.
- The in-app agent harness: Eve, Pi or plain AI SDK.
- Operations per instance: backups, error tracking, logs, target monthly cost.
- Licence terms for core packages at handover.
- Final names for the factory and the CLI.
- The secret store behind `secret://` references, per host.
- File storage for documents and attachments.
- In-app notifications for staff (approvals waiting, runs failed).
- Time zones, business calendars and working hours for schedules and waits.
- Search across records.
