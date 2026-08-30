# Tasks Map Evolution Roadmap

**Date:** 2026-08-30
**Status:** In progress — Phases 1–3 completed
**Scope:** Multi-phase improvement plan covering task triage UI, native indexing, auto-refresh, layout stability/minimalism, project creation, and de-forking.

Each phase is designed to be implemented in its own session. Phases list their
dependencies explicitly; within a dependency chain the order matters, otherwise
phases are independent.

---

## 1. Motivation

The plugin (an Obsidian graph view of tasks, built on React Flow + dagre) is
good at answering _"what is the structure and progress of each project?"_ —
which is its core purpose. Observed problems, from daily use:

1. **No triage view.** The graph cannot answer _"what are my in-progress /
   active / urgent tasks right now?"_ Color indicates urgency, but urgency
   needs sorting and grouping, which a spatial layout cannot express.
2. **Free node positioning is useless and unstable.** Layout is discarded on
   every refresh anyway (dagre re-runs), so dragging is an illusion of control.
   Worse, connected components are placed in an effectively arbitrary order, so
   the same project lands somewhere different each session — "I often cannot
   find the project I want to check."
3. **Visual style is verbose.** Every node always renders a 6-button header
   row, summary, quick-comments, tag footer, attachments. The user prefers a
   more minimal, compact look.
4. **Layout ignores window shape.** Deep subtask chains consume vertical space
   regardless of the tab's aspect ratio. Desire: adapt packing to the viewport
   — but **hierarchy clarity is the priority; stability beats adaptivity.**
5. **Manual refresh.** After creating/editing a task the user must click
   refresh. Auto-refresh with preserved camera is wanted.
6. **No easy way to create a project.** Tasks have the TaskNotes modal;
   projects have nothing. Wanted: a modal that loads a user-assigned template
   and validates that the result is a legit project note (telling the user what
   to fix if not).
7. **The repo is still branded a fork** (of NicoKNL/tasks-map) despite 500+
   commits of divergence. Wanted: detach and rebrand (with proper attribution).
8. **(Added during design discussion) Drop the Dataview community-plugin
   dependency.** The user asked whether Obsidian's core Bases feature could
   replace Dataview. Conclusion (see Phase 2): the right replacement is the
   **native `metadataCache`**, not Bases — and this migration is what unlocks
   clean auto-refresh.

### Design principles agreed on

- **Hierarchy clarity first.** Never trade the readability of the task DAG for
  density or adaptivity.
- **Stability over adaptivity.** Same vault state ⇒ same layout, same project
  positions. Resizes must not make nodes "jump while I read."
- **Progressive disclosure over shrinking.** Minimalism means hiding chrome
  until hover/selection, not smaller fonts.
- **Map ↔ list linkage.** Any list/kanban UI must be able to jump to the node
  on the map (this is the differentiator over TaskNotes' own list views).
- **Reduce community-plugin dependencies.** Prefer native Obsidian APIs
  (`metadataCache`, `vault`) over Dataview/Tasks plugin APIs. The user's own
  workflow is TaskNotes-style note tasks; inline checkbox tasks are secondary.
- **Meta:** several recent features are gradually re-implementing TaskNotes'
  UI inside the map. This roadmap embraces that deliberately: _the map as the
  primary task workspace._

---

## 2. Verified code facts (baseline for all phases)

Verified against the codebase on 2026-08-30 (v0.39.4). Line numbers will
drift; treat them as anchors, re-verify before editing.

- **Architecture:** Obsidian plugin, React 18 + `reactflow` 11 + `@dagrejs/dagre`.
  Main view: `src/views/TaskMapGraphView.tsx` (~1557 lines). Plugin entry:
  `src/main.tsx` (~662 lines). Grab-bag: `src/lib/utils.ts` (**2302 lines** —
  mixes vault I/O, parsing, and the entire layout engine; see Phase 4 refactor).
- **Task model:** `BaseTask` with two sources —
  1. Inline checkbox tasks (`- [ ]`) enumerated natively from
     `metadataCache.listItems` + `vault.cachedRead()` and
  2. Note-based tasks (`NoteTask`, TaskNotes-compatible) enumerated **natively**
     (`vault.getMarkdownFiles()` + `metadataCache.getFileCache()` in
     `getNoteTasks` / `inspectNoteTask`, utils.ts ~1670).
- **Dataview is no longer a runtime dependency.** Native inline enumeration is
  isolated in `src/lib/inline-task-source.ts`. Everything else "dataview" in
  the code is the `[key:: value]` **text format** or the retained internal
  inline-task type name — neither requires the plugin.
- **`RawTask` is tiny:** `{ status: string; text: string; link: { path: string } }`
  (`src/types/task.ts:13`). `TaskFactory` (`src/lib/task-factory.ts`) parses it
  with the plugin's own regexes (`src/lib/task-regex.ts`).
- **Startup gate:** `TaskMapGraphView.tsx` waits for
  `app.workspace.onLayoutReady()` before the first native scan.
- **Reload path:** `reloadTasks` (TaskMapGraphView.tsx ~312) is a **full vault
  re-scan**, asynchronous inside a `setTimeout(0)`, guarded by a generation
  counter so stale scans cannot win. It fires a reload notice, then a big
  effect (~588) rebuilds nodes/edges, re-runs dagre, and calls
  `scheduleFitView` unless `skipFitViewRef.current` is set. The view exposes
  `reloadTasks` upward via `onReloadHandlerChange`.
- **Layout engine:** `getLayoutedElements` (utils.ts ~463). With
  `groupByProject`, a two-pass dagre: pass 1 flat layout for ranks; pass 2
  groups sized from member bounding boxes with cycle-safe inter-group edges.
  Disconnected components are tiled by `spaceConnectedComponents`
  (utils.ts ~950): wrap threshold = `max(largest component, sqrt(totalArea)*1.5)`
  — **no knowledge of the container/viewport**, and components are **sorted by
  their dagre-computed x/y positions** (utils.ts ~989), which is why project
  placement feels random across refreshes.
- **Node dimensions for layout** come from `estimateNodeDimensions` (must stay
  in sync with any node-rendering change).
- **Node component:** `src/components/task-node.tsx` (`NODEWIDTH=250`,
  `NODEHEIGHT=120`); always-visible header (status toggle, priority toggle,
  star, create-project-task, link, menu), summary, `QuickUpdate` row (note
  tasks), tag footer, attachments.
- **Left rail panel system:** `src/components/left-rail.tsx` with flyout panels
  (`filters`, `list`, `presets`, `view`, `unlinked`, `tree`). The Phase 1 task
  list uses this system. `focusNode` (TaskMapGraphView ~747) pans/pulses a node;
  `focusRequest` prop + `createTaskFocusFilter` handle cross-view focus.
- **Projects:** a task's `projects` frontmatter (note links). Group nodes are
  built per single-project task set (`partitionTasksByProject`, utils.ts ~2061).
  Drag-into-group assigns a task to a project (`assignDraggedNodesToProject`).
- **TaskNotes bridge:** `src/lib/tasknotes-bridge.ts` (~933 lines) —
  `isTaskNotesTaskFile`, `openTaskNotesProjectTaskCreationModal`,
  `openTaskNotesTaskCreationModalForProject`, `getTaskNotesConfig`, editor
  availability checks.
- **Tasks plugin dependency:** optional `createTaskLineModal` and
  `editTaskLineModal` integration via `getTasksApi`. Both are null-checked and
  degrade gracefully; discovery and native mutations do not require Tasks.
- **Vault event plumbing exists:** `main.tsx` ~405 registers
  `vault.on("modify"/"create"/"delete"/"rename")` — currently only to watch the
  TaskNotes type-schema file, with a 250ms debounce pattern
  (`scheduleTaskNotesTypeSchemaRefresh`) worth imitating.
- **Fork status:** GitHub reports `isFork: true`, parent `NicoKNL/tasks-map`.
  `manifest.json`: id `tasks-map-jrxing`, name "Tasks Map (jr-xing fork)".
  LICENSE is MIT, © 2025 Nico Klaassen. README badges point at **NicoKNL's**
  CI; `docs/index.md` hotlinks NicoKNL raw images. `minAppVersion: 1.8.0`.
- **Settings:** `src/types/settings.ts` — note-task detection is configurable
  (`noteTaskPropertyName/Value`, `noteDependencyProperty`, etc.);
  `taskStatuses` / `taskPriorities` are user-configurable; filter presets exist.

---

## 3. Phase overview and sequencing

| Phase | Title                                | Depends on            | Value | Effort | Progress |
| ----- | ------------------------------------ | --------------------- | ----- | ------ | -------- |
| 1     | Task list / triage panel             | —                     | ★★★★★ | M      | Complete |
| 2     | Native task indexing (drop Dataview) | —                     | ★★★★  | M      | Complete |
| 3     | Auto-refresh                         | 2                     | ★★★★  | M      | Complete |
| 4     | Layout stability & visual minimalism | — (4a refactor first) | ★★★★  | M–L    | Planned  |
| 5     | Viewport-aware component packing     | 4a                    | ★★    | S–M    | Planned  |
| 6     | New-project modal                    | —                     | ★★★   | S–M    | Planned  |
| 7     | De-fork & rebrand                    | —                     | ★★    | S      | Planned  |

Recommended order: **1 → 2 → 3 → 4 → 6 → 5 → 7**. Phase 7 is fully
independent and can be slotted anywhere. Phase 6 is independent too if a
session needs a smaller task.

---

## Phase 1 — Task list / triage panel ("what's active now?")

**Status:** Completed on 2026-08-30

**Goal:** answer "what are my in-progress / active / urgent tasks" with a
grouped, sorted list that stays linked to the map.

**Design decisions (agreed):**

- Start with a **grouped task list**, _not_ a drag-and-drop kanban. Grouping
  by status (using the configurable `taskStatuses`), sorting within groups by
  priority / starred / due date. ~15% of kanban effort, ~90% of the value.
- Clicking a row jumps to the node on the map via the existing `focusNode` /
  `focusRequest` machinery — the map↔list linkage is the differentiator over
  TaskNotes' own list views.
- Rows respect the active `FilterState` (reuse `getFilteredNodeIds`).
- Status can be toggled inline from a row (reuse the node's status-toggle
  logic / `BaseTask` mutation methods).

**Implementation steps:**

1. New component `src/components/task-list-panel.tsx`; register a new
   `RailPanelId` (e.g. `"list"`) in `left-rail.tsx` and wire it into the
   flyout switch in `TaskMapGraphView.tsx` (follow the `tree` panel as the
   template — it already receives filtered tasks and focus callbacks).
2. Grouping/sorting logic in a pure lib module `src/lib/task-triage.ts`
   (unit-testable, like `project-tree.ts`): group by status id, sort by
   (starred desc, priority rank desc, due date asc, label). Respect
   `defaultStatusFilter` semantics.
3. Row UI: status dot/toggle, priority accent, label, project dots, due badge.
   Keep it dense; reuse `Tag`/`ProjectDot` pieces where sensible.
4. Row click → `focusNode(taskId)`; if the node is filtered out of the map,
   fall back to the pending-focus pattern used by `handleTreeTaskClick`.
5. **Stretch (separate step or session):** a dockable `ItemView`
   (`src/views/TaskListItemView.tsx`) so the list can live in Obsidian's right
   sidebar next to the map, communicating via the plugin's existing
   focus-request plumbing. Do the flyout panel first; promote later.
6. i18n: all new strings in `en.json`, `nl.json`, `zh-CN.json`.

**Implementation result:**

- Added the status-grouped task-list flyout with configured-status ordering and
  sorting by starred, source-specific priority weight, due date, label, and ID.
- Added normalized due dates to the task model. TaskNotes `due` frontmatter and
  inline `📅 YYYY-MM-DD`, `[[due::YYYY-MM-DD]]`, and `due:YYYY-MM-DD` formats
  are supported.
- The list applies the complete active `FilterState` to all loaded tasks,
  including project notes and unlinked tasks hidden from the canvas.
- Clicking a visible row pans to and pulses its node. Clicking a hidden
  unlinked task reveals only that task at the current viewport center for the
  session, then focuses it.
- Status changes from either the list or map update the vault and shared task
  state without refitting the camera. The row moves groups or disappears when
  excluded by the active filter.
- The panel is available in the main view and in embeds whenever
  `showFilterPanel` is enabled. English, Dutch, and Simplified Chinese strings
  were added.

**Explicitly out of scope:** drag-between-columns status change (later kanban
iteration), new persistence.

**Acceptance (verified):** open panel → tasks grouped by status,
urgent/starred at top; click row → map pans and pulses the node; toggling
status in the list updates the vault and the node. User smoke testing confirmed
the feature works well. Automated verification: 478 Jest tests, production
build, CSS lint, changed-file ESLint/Prettier, and `git diff --check` passed.

---

## Phase 2 — Native task indexing (drop the Dataview dependency)

**Status:** Completed on 2026-08-30

**Goal:** enumerate inline checkbox tasks with native Obsidian APIs so the
Dataview plugin becomes unnecessary. Prerequisite for clean auto-refresh
(Phase 3).

**Why not Bases (decision record):** Obsidian's Bases indexes _files and
frontmatter properties_, not lines inside files — it cannot enumerate inline
`- [ ]` tasks (as of early 2026). Its plugin API (Obsidian 1.10+) registers
custom Bases _views_ fed by a Bases query; it is not a queryable index like
`dataviewApi.pages()`. For the note-task source, Bases would sit on top of the
same `metadataCache` this plugin already reads directly. Verdict: native
`metadataCache` is the replacement; Bases is a possible _future view
integration_ for note tasks only (see "Deferred ideas"). Re-verify Bases API
state if revisited — it evolves quickly.

**Implementation steps:**

1. New native enumerator (in a new module, e.g. `src/lib/inline-task-source.ts`
   — do NOT grow utils.ts): for each markdown file,
   `metadataCache.getFileCache(file)?.listItems` filtered to
   `item.task !== undefined`; `vault.cachedRead(file)`, slice each item's line
   via `item.position.start.line`; strip the leading `- [x] ` checkbox prefix
   so `text` matches what Dataview produced; build
   `RawTask { status: item.task, text, link: { path: file.path } }`.
   Feed the existing `TaskFactory` — parsing regexes are untouched.
2. `getAllTasks` becomes **async** (file reads). Update `reloadTasks` in
   `TaskMapGraphView.tsx` accordingly (it already defers via `setTimeout`;
   convert to an async call with a load-token/generation counter so a stale
   scan can't overwrite a newer one).
3. Delete the `dataview:index-ready` gate (~TaskMapGraphView 398) — the
   metadata cache is ready with the workspace (`app.workspace.onLayoutReady`).
4. Remove/neutralize the remaining Dataview plugin probes (utils.ts ~1654,
   ~2252). Keep ALL `[key:: value]` text-format parsing and the
   `linkingStyle: "dataview"` write style — those are formats, not
   dependencies.
5. Validate against the test fixtures (`test/fixture/Dataview format tasks.md`,
   `Simple tasks.md`, `Mixed format tasks.md`, `Tasks with link in title.md`) —
   add a Jest test comparing the native enumerator's `RawTask[]` output on the
   fixtures to expected snapshots. Differences from Dataview's `text` shape
   (e.g. trailing whitespace, child-line handling) surface here.
6. Update README/docs: Dataview no longer required; Tasks plugin required
   only for its optional inline-task creation and editing modals (it already
   degrades gracefully via `getTasksApi` null-checks).

**Implementation result:**

- Added native inline enumeration with the pinned Dataview text semantics for
  ordered/unordered markers, nested and multiline items, arbitrary checkbox
  characters, and CRLF files. Unreadable files are logged and skipped.
- Made `getAllTasks` asynchronous and updated graph reloads, the focus picker,
  and note-visibility diagnostics. Graph reloads reject stale generations and
  invalidate pending work on unmount.
- Removed the main-view, embed, and startup Dataview gates plus all runtime
  plugin probes. Dataview inline-field parsing and the internal
  `DataviewTask` type remain compatible.
- Preserved the existing unlinked-task display rule: disconnected inline
  tasks are indexed but remain off-canvas by default, appear in the Unlinked
  tasks panel, and can be dragged onto the map or revealed through View
  controls.
- Removed Dataview from documentation and the fixture vault. Tasks is now
  documented accurately as an optional creation/editing integration.

**Risks / pitfalls:**

- Dataview's `task.text` excludes the checkbox marker and may normalize
  whitespace — match it exactly or update `TaskFactory` expectations plus
  fixtures deliberately.
- Async conversion touches every `getAllTasks` caller (also the embed view and
  note-visibility diagnostics — grep for callers first).

**Acceptance (verified):** the fixture vault no longer enables or installs
Dataview; native fixture tests load both task sources and cover text-shape
compatibility. No runtime Dataview plugin access remains. Automated
verification: 483 Jest tests, production build, CSS lint, changed-file
ESLint/Prettier, and `git diff --check` passed. User smoke testing in the real
vault confirmed that inline tasks in a daily note are indexed correctly and
appear in the Unlinked tasks panel when they have no graph relationships.

---

## Phase 3 — Auto-refresh (depends on Phase 2)

**Status:** Completed on 2026-08-30

**Goal:** the map updates itself after task/project changes, preserving the
camera, without manual refresh.

**Design decisions (agreed):**

- Signal source: native `metadataCache.on("changed", (file, data, cache))`
  (fires after Obsidian re-parses a file) + `vault.on("delete")` +
  `vault.on("rename")`. Not raw `vault.on("modify")` (fires before re-parse),
  and no Dataview events (gone after Phase 2).
- **Debounce ~500ms–1s**, batching multiple file events into one reload.
- Automatic reloads: `skipFitViewRef`-style camera preservation (keep viewport;
  do NOT re-fit) and **no `Notice` toast**. The manual refresh button keeps its
  current full-refit + toast behavior.
- **Self-write suppression:** the plugin writes to the vault constantly
  (status toggles, tags, stars, quick comments, edge/sign writes, project
  assignment). Without suppression, every interaction triggers its own reload
  and can clobber optimistic UI state mid-interaction. Mechanism: a central
  "recent self-writes" registry (path → timestamp) consulted by the listener;
  events for a path written by us within ~2s are ignored (the in-memory
  optimistic state is already correct). Route the plugin's vault writes through
  a helper that records into this registry.
- Settings toggle `autoRefresh` (default on; large-vault users may want it
  off) in the View section of the settings tab.

**Implementation steps:**

1. `src/lib/vault-watcher.ts`: subscribe/unsubscribe, debounce, self-write
   registry, and a simple relevance filter (markdown files only; ignore the
   type-schema path which has its own watcher in main.tsx ~393).
2. Wire into the view lifecycle: the graph view registers a callback on mount
   (`registerEvent` on the plugin so cleanup is automatic), triggering
   `reloadTasks({ auto: true })`.
3. Extend `reloadTasks` with an options argument: `{ auto?: boolean }` →
   auto sets skip-fit + suppresses the Notice.
4. Also trigger after the in-app editor panel saves (already partially wired
   via `onSaved={reloadTasks}` — unify so it doesn't double-fire with the
   watcher; the self-write registry handles this naturally if editor writes
   are routed through it, otherwise debounce absorbs it).
5. **Stretch (optional, own session):** per-file incremental update instead of
   full rescan — re-run `inspectNoteTask` / inline enumeration for only the
   changed file and patch the `tasks` array. Only worth it if full-rescan
   latency is noticeable in the real vault; measure first.

**Implementation result:**

- Added a per-mounted-map watcher using native metadata-cache, delete, and
  rename events, a 750ms debounce, Markdown/type-schema filtering, and exact
  event/timer cleanup. Main views and embeds both subscribe.
- Added a per-map 2-second self-write registry. The initiating map suppresses
  its optimistic write event while other mounted maps still refresh.
- Automatic rescans run in the background, preserve the viewport and
  session-only dropped nodes, cancel pending fits, and omit the success toast.
  Manual refresh retains its prior loading, reset, refit, and toast behavior.
- Drag and focused tag/quick-update/editor interactions defer external
  refreshes. Completed editor saves use the same scheduler and may refresh
  safely while the editor remains open.
- Status, priority, star, tag, quick-comment, deletion, project, connected-task,
  and dependency mutations now use tracked writes and keep shared task state in
  sync for filtering, triage, grouping, and traversal. Non-optimistic editor and
  organizer writes continue to trigger rescans.
- Added the default-on `autoRefresh` display setting with English, Dutch, and
  Simplified Chinese text. Per-file incremental indexing remains deferred.

**Risks / pitfalls:**

- Reload during node drag or while the tag-input/quick-update is focused is
  disruptive: defer the reload while an interaction is active (simple flag set
  on drag-start/input-focus, drained on end).
- Layout jump on auto-reload: with Phase 4's stable ordering this is minor;
  before Phase 4, auto-reload may visibly reshuffle components — acceptable
  interim state, but note it in the release notes.

**Acceptance (automated):** watcher tests cover batching, relevance filtering,
delete/rename events, suppression expiry/failure, independent mounted maps,
interaction deferral, forced saves, and cleanup. Automated verification: 491
Jest tests, production build, CSS lint, changed-file ESLint/Prettier, and
`git diff --check` passed.

**Acceptance (manual):** real-vault smoke testing completed successfully on
2026-08-30. External edits refreshed the map without a loading flash or success
toast, map-owned mutations remained immediate, interaction deferral behaved as
expected, and manual-only behavior remained available when auto-refresh was
disabled.

---

## Phase 4 — Layout stability & visual minimalism

### Phase 4a (prerequisite refactor): extract the layout engine

Move the layout code out of `utils.ts` (2302 lines) into `src/lib/layout/`
(e.g. `layout.ts`, `packing.ts`, `dimensions.ts`, `project-groups.ts`) with
unit tests, keeping `getLayoutedElements`'s signature re-exported so callers
don't churn. Pure mechanical move + tests — no behavior change. This makes 4b
and Phase 5 safe.

### Phase 4b: stable ordering

- `spaceConnectedComponents` currently sorts components by dagre-computed
  x/y (utils.ts ~989) — effectively arbitrary. Change to a **deterministic
  key**: project-group components alphabetically by project name; other
  components by their "root task" label (or file path) as tiebreaker.
  Result: same vault ⇒ same placement, projects findable by muscle memory.
- Optional setting later: sort by recency (`file.mtime` max of members) —
  start with alphabetical only.

### Phase 4c: drag policy

- Default `nodesDraggable={false}` — free positioning is an illusion (dagre
  discards it on every reload).
- Preserve the two real drag uses: (a) drop-into-project-group assignment —
  keep available via the task menu (project logic exists) and/or a dedicated
  "arrange mode" toggle in the Controls panel that re-enables dragging;
  (b) sidebar drop of unlinked tasks — keep working (it's a different drag
  source, HTML5 DnD, unaffected by `nodesDraggable`; verify).

### Phase 4d: compact node mode (progressive disclosure)

- Setting `nodeDensity: "comfortable" | "compact"` (default: current look).
- Compact: status indicator + single-line title (+ priority accent + project
  dots). Header buttons, quick-update, tag footer, attachments appear only on
  hover/selection (CSS visibility on `.tasks-map-task-node-shell:hover` /
  `.selected`, so React tree stays stable).
- **Must update `estimateNodeDimensions` in lockstep** — dagre layout quality
  depends on dimension estimates matching rendering. Add/extend tests.
- Reduce chrome globally: hide connection handles until node hover; consider
  lighter edge styling. Keep Obsidian CSS variables for theming.

**Acceptance:** two consecutive refreshes of an unchanged vault produce
identical layouts; projects appear in alphabetical order; compact mode shows
one-line nodes with actions on hover; layout has no overlaps in compact mode.

---

## Phase 5 — Viewport-aware component packing (depends on 4a)

**Goal:** use the tab's aspect ratio when tiling disconnected components /
project groups, without ever touching intra-project hierarchy.

**Design decisions (agreed; the user was unsure — this is the constrained
version we settled on):**

- Intra-component dagre layout is **never** affected by viewport size.
  Only `spaceConnectedComponents`' wrap threshold becomes aspect-aware:
  currently `max(largestComponent, sqrt(totalArea)*1.5)`; instead target
  `sqrt(totalArea * aspectRatio)` (clamped by largest component) where
  `aspectRatio = containerWidth / containerHeight`.
- Recompute **packing only** (component offsets, not dagre) on a debounced
  `ResizeObserver` (~300ms after resize settles), followed by a re-fit.
  If even that feels jumpy in practice, fall back to recomputing only on
  refresh / explicit re-fit — decide by feel, keep both paths cheap to switch.
- Plumb the container size from the view into `getLayoutedElements` as an
  optional `{ width, height }` argument (the view already has
  `containerRef`).

**Acceptance:** a wide tab tiles components into more columns; a tall tab
stacks them; resizing re-tiles blocks smoothly without changing any
component's internal layout; with a single project focused, nothing moves.

---

## Phase 6 — New-project creation modal

**Goal:** create a project note as easily as a task: pick template → create →
validate → guided fixes.

**Design (matches the user's proposal):**

1. Settings: `projectTemplatePath` (single path to start; a folder of
   templates enabling a picker is a follow-up).
2. Entry points: command palette "Create project", a button near the existing
   "New task" button, and optionally the project-tree panel header.
3. Modal flow: project name → destination folder (default from settings or
   TaskNotes config) → template preview → create.
4. **Validation** reuses the exact detection path the map uses —
   `inspectNoteTask` (utils.ts ~1691) already returns structured exclusion
   reasons (`missing_frontmatter`, `criteria_mismatch` with
   expected/actual values). Run it on the template (and on the created note);
   report _which property is missing/wrong by name_, not a generic error.
   The note-visibility diagnostics modal (`src/lib/note-visibility-modal.ts`)
   is prior art for presenting this.
5. Template variables: minimal substitution (`{{title}}`, `{{date}}`) only —
   do not reimplement Templater.
6. Follow-on action in the success state: "Create first task in this project"
   via `openTaskNotesTaskCreationModalForProject` (bridge already exports it).

**Acceptance:** with a valid template, "Create project" produces a note that
appears on the map as a project after (auto-)refresh; with a broken template,
the modal names the missing/incorrect frontmatter properties before creating
anything.

---

## Phase 7 — De-fork & rebrand (independent; anytime)

Two separate layers:

**GitHub relationship:** repo Settings → General → **"Leave fork network"**
(self-serve; no support ticket). One-way: no more PRs to / syncs from
upstream. Given 543 commits of divergence, acceptable.

**Branding & attribution:**

- `manifest.json`: name → "Tasks Map" (or a new name), drop "fork" phrasing
  from description, author → jr-xing (keep an "originally by NicoKNL" credit
  in description or README). **Do NOT change `id`** (`tasks-map-jrxing`) —
  the plugin folder and settings `data.json` are keyed by it; changing it
  orphans existing installs.
- `LICENSE`: **must keep** "Copyright 2025 Nico Klaassen" (MIT requires
  retaining the notice). Add a second line: `Copyright 2026 Jiarui Xing` above
  or below it. Never replace.
- `README.md`: badges currently point at **NicoKNL's** workflows/releases
  (show their CI status, not ours) — repoint to `jr-xing/tasks-map` or drop;
  add a one-line attribution: "Originally based on
  [tasks-map](https://github.com/NicoKNL/tasks-map) by NicoKNL."
- `docs/index.md`: image URLs hotlink `raw.githubusercontent.com/NicoKNL/…` —
  copy assets into this repo and repoint. Check the docs-site config
  (`zensical.toml`) for upstream URLs.
- `package.json`: fill in `author`; check `.github/workflows/*.yaml` for
  hardcoded upstream references.
- Grep for remaining `NicoKNL` / `nicoknl.github.io` references repo-wide.

**Acceptance:** GitHub no longer shows "forked from NicoKNL/tasks-map";
README badges reflect this repo's CI; license retains original copyright plus
ours; plugin updates in-place in the vault (same id).

---

## Deferred ideas (explicitly not scheduled)

- **Kanban drag-between-columns** (status change by drag) — after Phase 1
  proves the list panel.
- **Bases view integration** — register the map (or the note-task source) as
  a custom Bases view so Bases filters/formulas drive "what appears on the
  map". Note-tasks only; requires `minAppVersion` ≥ 1.10 and a still-young
  API. Revisit after Phases 2–3; re-verify current Bases API docs first.
- **Per-file incremental indexing** (Phase 3 stretch) — only if full-rescan
  latency is measurably annoying.
- **Demote inline checkbox tasks to an opt-in "legacy" source** — the user
  barely uses them; would simplify the dual-source code. Decide after Phase 2
  (where they become dependency-free anyway).
- **Recency-based project ordering** as an alternative to alphabetical.

## Working conventions for implementation sessions

- One phase (or sub-phase) per session; re-verify the file/line anchors in
  §2 before editing — they will drift.
- New logic goes in new `src/lib/` modules with Jest tests, not into
  `utils.ts`.
- All user-facing strings through i18n (`en.json`, `nl.json`, `zh-CN.json`).
- Run `npm run build` (typecheck + bundle) and `npm test` before finishing;
  lint with `npm run lint` / `npm run lint:css`.
- Version bumps / releases follow the existing release tooling — do not bump
  manually unless asked.
