# 0059. The workflow editor draws the steps on a canvas

- **Status:** Accepted
- **Date:** 2026-11-10
- **Supersedes:** [0053](0053-workflow-editor-outline.md). Its rules on view state, the order of the page, and "run data is never drawn in the editor" carry over and are restated here.
- **Builds on:** [0045](0045-object-endpoints-and-workflows.md), [0046](0046-runs-segments-and-errors.md), [0048](0048-workflow-file-format.md).

## Context

Decision 0053 made the editor a vertical outline with no dragging and no new dependency. The read-only outline was built (plan tasks WE.06 to WE.10) and Dylan looked at it with three layouts mocked on one workflow: lanes in a column, a flowchart, and a focused column with a map.

Two things came out of that.

- **A flowchart is understood at a glance.** A person turning a business process into steps thinks in boxes and arrows. Branches side by side that join again say "one of these happens, then this" without reading indents. The outline says the same thing, but has to be read.
- **Moving steps by commands alone is tedious.** People expect to pick a step up and put it somewhere.

What 0053 got right still holds. The file is the definition, it holds no positions, and agents rewrite it without seeing the screen. Steps are a tree: they run in order, an `if` nests `then` and `else`, `on_failure` nests steps, and there are no joins, jumps or parallel branches. So a step's place in the tree is its connection, and there is nothing to wire by hand.

Three kinds of freedom were weighed.

|  | Move around and drop into place | Nodes stay where they are dropped | Draw any connection |
| --- | --- | --- | --- |
| Stored state | None | Positions, in the file or a second store | A new file format |
| After an agent rewrites the file | Laid out again, the same way every time | New steps have no place | Depends on the format |
| What it changes | The screen | The screen and a store | What a workflow is: validation, segments, runs |

## Decision

- **The steps are drawn as a flowchart on a canvas** that pans and zooms. A step is a node, a condition splits into one path per outcome, and the paths join again below it. Every node and every line out of a condition is labelled in words ("Then", "Otherwise", "If it fails").
- **The layout is computed from the steps, every time.** Nothing about the view goes in the file, and no positions are stored anywhere. The same file always draws the same chart.
- **A step is arranged by dragging it to a drop zone.** Every place a step can go is a drop zone: between two steps, at the end of each path, in an empty path, and in a step's failure steps. A condition shows one drop zone per outcome. Dropping a step there puts it at that place in the tree, so it is connected by where it lands. New steps are dragged in, or added from a drop zone's button.
- **No free connections and no free placement.** A line can't be drawn from one step to another, and a node can't be left somewhere the layout wouldn't put it. Either would need its own decision: free connections change the file format (decision 0048) and how runs commit (0046).
- **Selecting a step, or a path of a condition, opens it beside the canvas** as a column: the step's detail (its form, in edit mode), or the path's steps in order. That is where a branch is reviewed closely. The canvas marks what is open.
- **The outline stays.** It is the same steps as nested lists, built already. It is the view on a pane too narrow for the canvas, a view anyone can switch to, and what a screen reader is given. Selection, problems and cuts are the same in both, since both are drawn from the same tree (`lib/workflow-tree.ts`).
- **Everything a drag does, a command does too.** Move up, move down, move into a path and out of one stay as menu items and keys, in both views.
- **A segment cut is marked on the line** into the step that ends the segment, with the reason validation gives. Failure steps hang off their step on a labelled line, apart from the main path.
- **View state lives outside the file.** The selected step, the tab, the version and the view (canvas or outline) are in the URL. Pan and zoom are not kept: a workflow opens fitted to the pane, with the selected step in view.
- **The canvas is `@xyflow/react`** (React Flow, MIT). **The layout is our own function** over the step tree, `lib/workflow-layout.ts`, with tests. A tree with paths that join needs no general graph layout, so no layout library is added. If the layout outgrows that, `@dagrejs/dagre` is the one to add.
- **The page still reads in the order a run goes,** and the editor still draws no run data. A run in Activity keeps the outline for now.

## Consequences

- The web app gains a dependency, and the canvas is the one part of the app that isn't lists and buttons. The outline is what keeps it usable by keyboard and screen reader, so the two must not drift: a thing shown in one is shown in the other.
- One new step can shift every node below it. Changes are shown by marking the steps that changed, not by where things moved.
- A wide workflow needs panning. The column beside the canvas and the outline are the answer for reading one path closely.
- People used to tools where nodes stay put will find that these don't. What they get is a chart an agent's rewrite can't scramble.
- **What would change this:** steps gaining parallel paths, joins or loops (a change to decision 0048, and then lines would be drawn by hand), or people needing to arrange a large workflow their own way (positions kept outside the workflow file, with this layout for anything unplaced).
