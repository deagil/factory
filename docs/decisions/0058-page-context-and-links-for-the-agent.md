# 0058. Page context and links for the in-app agent

- **Status:** Accepted
- **Date:** 2026-11-10
- **Amends:** [0033](0033-web-navigation-and-dev-bar.md), which keeps the sidebar for the agent and says nothing yet about what the app gives it.
- **Builds on:** SYSTEM_DESIGN §7: the in-app agent is a client of the MCP server with no tools an external agent lacks.

## Context

The sidebar will hold an agent that works beside the person (phase 4). To be useful it has to know what the person is looking at, be able to point at something on the page, and have its changes show up where the person is working. The risk is doing this with channels only the in-app agent has, which would make it a different kind of client from an agent over MCP. The harness itself is not designed here.

## Decision

Two things, both for every screen and not only the workflow editor.

- **Page context: what the person is looking at, as plain data.** Each screen sets it through one hook: the route, what is open (a workflow, a record, a draft) with its key or id, the version shown, the draft id, what is selected (a step and a field, in the editor) and whether there are unsaved edits. The sidebar reads it from one place and sends it with the person's message. It is information, not access: it holds nothing the person's own API calls couldn't fetch, and no values from unsaved forms.
- **Links: how anything is pointed at.** Everything worth pointing at has a URL: a record, a run, a step (`?step=`), a field in a step, a tab, a version. The agent points by putting an app link in its reply, and the sidebar shows it as a "Show me" button. Arriving on a link scrolls to the target, opens what hides it, moves focus there and marks it. Links outside the app are never turned into buttons.

What follows for the editor:

- **The agent changes a workflow with the same operations as anyone:** `workflow_get`, `workflow_validate`, `draft_save` with a revision, `workflow_test`. It has no way to reach into the page's unsaved state.
- **Its saves go into the draft the page context names,** which decision [0055](0055-saving-config-files-with-a-revision.md) allows for a person's own agent. The page notices the draft changed, says the agent changed it, shows what changed, and offers to keep it or undo it. If the person has unsaved edits when that happens, the page keeps them and asks the person to compare; their next save would be refused as stale until they do. Nothing is overwritten silently, on either side.
- **An external agent gets the same two things by other means:** it is told a workflow's key and a draft id in words, and it can hand back the same links.

## Consequences

- "Show this" needs no special channel, and a link an agent gives works equally when a colleague sends it.
- Screens have to keep their state in the URL to be pointed at. The editor does (decision [0053](0053-workflow-editor-outline.md)); other screens gain it as they need it.
- The agent can't highlight something that has no URL. That is a prompt to give it one.
- The dev bar's Inspect menu shows the page context, so it can be built and checked before the harness exists.
- The agent sees the person's last save, not their typing. Asking it about a half-made change means saving first.
