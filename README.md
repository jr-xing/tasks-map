<p align="center">
  <img src=".github/images/logo.png" alt="Tasks Map Logo" width="320" />
</p>
<p align="center">
<img alt="GitHub Actions Workflow Status" src="https://img.shields.io/github/actions/workflow/status/NicoKNL/tasks-map/qualify.yaml?branch=main&label=%F0%9F%92%8E%20qualify">
	<img alt="GitHub Actions Workflow Status" src="https://img.shields.io/github/actions/workflow/status/NicoKNL/tasks-map/release.yaml?event=pull_request&label=%F0%9F%93%A6%20release">
	<img alt="GitHub Release" src="https://img.shields.io/github/v/release/NicoKNL/tasks-map">
	<img alt="GitHub Downloads (all assets, all releases)" src="https://img.shields.io/github/downloads/NicoKNL/tasks-map/total">
</p>

> [!NOTE]
> **Pre-v1.0:** Tasks Map is under active development and has not yet reached v1.0. Interfaces — including the embed format, filter field names, and settings — may change between releases.

---

**Tasks Map** is a minimal Obsidian plugin that visualizes your tasks as an interactive graph. It supports both **inline checkbox tasks** (`- [ ] task text`) through Obsidian's native metadata index and **file-based tasks** (NoteTask) where an entire note becomes a task through frontmatter metadata. Each task is represented as a node, with edges showing relationships based on special emoji/link syntax.

### Highlights

- 📊 **Graph Visualization** — See all your tasks as draggable nodes in a React Flow graph
- 🌿 **Tree Layout** — A git-style view with one task per row, the project on top and subtasks on branch lanes. It can run vertically for narrow tabs or horizontally as a timeline, and each map tab keeps its own layout
- 🤖 **AI Agent CLI** — `obsidian tasks-map-jrxing:*` commands (Obsidian 1.12.2+) let AI agents list, create, update and log tasks exactly as the map sees them
- 📝 **Dual Task Sources** — Supports inline `- [ ]` checkbox tasks and file-based NoteTask notes (frontmatter with `tags: [task]`)
- 🔗 **Task Relationships** — Edges based on 🆔 / ⛔ emoji/link syntax (inline) or `blockedBy` / `dependsOn` frontmatter (NoteTask)
- 🏷️ **Tag Filtering** — Focus your view with multi-select tag filtering
- ✅ **Task Completion** — Mark tasks done/undone directly from the graph
- 🌍 **Internationalization** — English, Dutch, Simplified Chinese

![Tasks Map Example](.github/images/example.png)

### Quick Start

Tasks Map has no required plugin dependencies. The optional [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin enables its inline-task creation and editing modals.

Install through the Obsidian plugin manager: https://obsidian.md/plugins?id=tasks-map

### Tree Layout And Map Tabs

Switch a map tab between **Graph** and **Tree** with the branch icon in the tab
header, the **View** panel, or the *Toggle tree layout in current map* command.
Direction (horizontal or vertical) is also per tab, and the settings only choose
the defaults for new tabs. *Focus project or task in new map tab* (or
Ctrl/Cmd+Enter in the focus picker) opens a focus in a fresh tab instead of
retargeting the current one.

### Branches Layout

The **Branches** layout (View panel) is made for large projects. Projects,
groups and branches are summary cards with their counts and next step; maps
open folded to branch level, and each card's fold badge shows its tasks.
Branches come from the notes: a `kind: area` property marks a branch, and
without it any task with subtasks is one. A branch's `next` property names its
next step, and `waitingOn` and `related` add markers. All property names can
be changed in the settings.

When one card has many tasks, they are grouped by their first `contexts`
value (the *Group-by property* setting). Each group shows only the next step
and the active, waiting, starred or due tasks, with a "+N open" button for
the rest, and many groups are placed in two columns.

Cards use the new **Minimal** style by default: only colours and key markers
at rest, buttons on hover, details when selected. The earlier cards remain as
**Classic** and **Classic compact** (Settings → Node density).

### AI Agents (Obsidian CLI)

With Obsidian 1.12.2+ running, agents can use:

```bash
obsidian tasks-map-jrxing:skill        # the full guide for agents
obsidian tasks-map-jrxing:tree task="My Project"
obsidian tasks-map-jrxing:create title="Draft intro" parent="My Project" log="Context"
obsidian tasks-map-jrxing:log task="Draft intro" text="Finished outline"
```

Commands: `skill`, `schema`, `list`, `tree`, `show`, `resolve`, `create`
(through TaskNotes), `update`, `log`, `link`, `focus`.

### 📖 Documentation

Full documentation is available at **[nicoknl.github.io/tasks-map](https://nicoknl.github.io/tasks-map/)**.
