# 0053. The workflow editor is an outline of steps

- **Status:** Proposed
- **Date:** 2026-11-10
- **Builds on:** [0045](0045-object-endpoints-and-workflows.md), [0046](0046-runs-segments-and-errors.md) ("the editor shows where a cut may happen") and [0048](0048-workflow-file-format.md). Fills in SYSTEM_DESIGN §4.6 **Visibility**.

## Context

Factory has no screen that shows a workflow. Most workflows will be written by agents over the API or MCP, so the screen is mainly where a person understands one end to end, and then changes it. Three layouts were weighed: a vertical list of steps with nested branches, a free canvas of nodes, and a graph laid out automatically from the steps.

Two facts decide it. A workflow's steps are a tree: they run in order, an `if` nests `then` and `else`, `on_failure` nests steps, and there are no joins, jumps or parallel branches. And the file is the definition: it is strict, holds no positions, and is rewritten by agents who never see the screen.

|  | Outline | Free canvas | Graph laid out from the tree |
| --- | --- | --- | --- |
| UI-only state in the file | None | Positions, which the schema refuses, or a second store that drifts | None |
| A small change looks small | One row | Yes, until something is moved | No: one step can shift every node |
| Stable after an agent rewrites the file | Yes | No: new steps have no place | Mostly |
| Narrow panes and phones | Works at the main pane's 28rem floor | Pan and zoom | Pan and zoom |
| Keyboard and screen reader | Lists and buttons | A parallel structure must be built | The same |
| `on_failure`, pauses, cuts | A nested group; a divider row | New node and edge kinds | New node and edge kinds |
| Dependency | None | A canvas library | A layout library, and usually a canvas one |

A graph earns its edges when lines carry information: joins, fan-out, loops. Here every edge would say "then the next one".

## Decision

- **The editor is a vertical outline.** One row per step, in the file's order. `then`, `else` and `on_failure` are labelled groups indented under the step that owns them. The file's order is the layout, so nothing about the view is stored in it.
- **The page reads in the order a run goes:** what starts it, what it takes, the steps, what it returns, what happens on failure, what it emits and the workflows that starts. Who can call it and who it acts as sit beside that.
- **A row is a sentence** made from the step: its kind as an icon and a word, what it does, and where its main values come from. A step with no id (`fail`, `output`) is addressed by its path in the steps.
- **Selecting a step opens its detail:** beside the outline when the pane is wide, under the row when it is narrow. Width means the pane's, not the window's, since the agent sidebar shares the window.
- **A segment cut is a divider row** at the step that ends the segment, with the reason validation gives and "only if this branch runs" when it is conditional. An external step sent after its segment commits is marked on its row.
- **View state lives outside the file.** The selected step, the tab and the version are in the URL. Collapsed branches are in `localStorage`, per workflow, like the sidebar's width.
- **The same outline is used wherever a workflow is drawn:** read-only, in edit mode, for a comparison of two versions, and for a run in Activity. Run data is never drawn in the editor.
- **No new dependency.**

## Consequences

- A link to a step shows the reader exactly what the sender saw, which is also how the in-app agent points at things (decision [0058](0058-page-context-and-links-for-the-agent.md)).
- A workflow of forty steps with deep nesting is a long page. Collapsing branches and the summary of problems at the top are the answer for now.
- People used to canvas tools won't find one. What they get is a view that an agent's rewrite can't scramble.
- **What would change this:** steps gaining parallel branches or joins. That needs its own decision; if it comes, add a graph drawn from the definition as a second, read-only view. A free canvas stays out as long as the file holds no positions.
