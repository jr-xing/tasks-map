import { getFilteredNodeIds } from "src/lib/filter-tasks";
import {
  buildProjectTree,
  getTaskTreeLabel,
  type TreeNode,
} from "src/lib/project-tree";
import {
  DEFAULT_TASK_STATUSES,
  type TaskStatusConfig,
} from "src/lib/status-config";
import { compareTriageTasks } from "src/lib/task-triage";
import type { TaskPriorityConfig } from "src/lib/priority-config";
import type { BaseTask } from "src/types/task";
import type { FilterState } from "src/types/filter-state";
import type { NoteTaskTitleSource } from "src/types/settings";

export interface KanbanFocusOption {
  rootTaskId: string;
  label: string;
}

export type KanbanSectionKind =
  | "flat"
  | "project"
  | "multiple_projects"
  | "no_project";

export interface KanbanTaskRow {
  task: BaseTask;
  depth: number;
}

export interface KanbanSection {
  key: string;
  kind: KanbanSectionKind;
  label: string | null;
  rows: KanbanTaskRow[];
}

interface KanbanColumnContent {
  tasks: BaseTask[];
  sections: KanbanSection[];
}

export type KanbanColumn = KanbanColumnContent &
  ({ kind: "today" } | { kind: "status"; status: TaskStatusConfig });

/** Keep board identities distinct even when a user defines a "today" status. */
export function getKanbanColumnKey(column: KanbanColumn): string {
  return column.kind === "today" ? "today" : `status:${column.status.id}`;
}

/** Dispatch a card drop without ever treating Today as a task status. */
export async function dropKanbanTask(
  taskId: string,
  column: KanbanColumn,
  moveStatus: (_taskId: string, _status: string) => Promise<void>,
  changeToday: (_taskId: string, _today: boolean) => Promise<void>
): Promise<void> {
  if (column.kind === "today") {
    await changeToday(taskId, true);
    return;
  }
  await moveStatus(taskId, column.status.id);
}

export interface KanbanColumnOptions {
  columnOrder?: string[];
  groupByProject?: boolean;
  focusOptions?: Map<string, KanbanFocusOption[]>;
}

export type KanbanColumnDropPosition = "before" | "after";

export type KanbanStatusMoveResult =
  | { kind: "unchanged" }
  | { kind: "updated" }
  | { kind: "rolled_back"; error: unknown };

/**
 * The board shares the map's content filters, but status is represented by
 * columns and root focus belongs only to the background map.
 */
export function getKanbanTasks(
  tasks: BaseTask[],
  filter: FilterState,
  options: { showProjectTasks?: boolean } = {}
): BaseTask[] {
  const ids = new Set(
    getFilteredNodeIds(tasks, {
      ...filter,
      selectedStatuses: [],
      selectedRootTask: null,
    })
  );
  return tasks.filter(
    (task) =>
      ids.has(task.id) &&
      (options.showProjectTasks !== false || !task.isProject)
  );
}

/** Return the requested Kanban-only title without changing graph labels. */
export function getKanbanCardTitle(
  task: BaseTask,
  source: NoteTaskTitleSource
): string {
  const fallback = task.summary || task.text || task.id;
  if (task.type !== "note") return fallback;

  if (source === "frontmatter") {
    return (
      task.noteFrontmatterTitle?.trim() || task.noteFilename?.trim() || fallback
    );
  }
  return task.noteFilename?.trim() || fallback;
}

/**
 * Reconcile a saved board order with the live status definitions. Unknown and
 * duplicate ids are removed; newly configured statuses are appended.
 */
export function resolveKanbanColumnOrder(
  statuses: TaskStatusConfig[],
  savedOrder: string[] = []
): TaskStatusConfig[] {
  const configuredStatuses =
    statuses.length > 0 ? statuses : DEFAULT_TASK_STATUSES;
  const byId = new Map(configuredStatuses.map((status) => [status.id, status]));
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const id of savedOrder) {
    if (!byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  for (const status of configuredStatuses) {
    if (seen.has(status.id)) continue;
    seen.add(status.id);
    ids.push(status.id);
  }

  return ids.map((id) => byId.get(id)!);
}

/** Move one column before or after another in the reconciled board order. */
export function moveKanbanColumn(
  statuses: TaskStatusConfig[],
  savedOrder: string[],
  draggedId: string,
  targetId: string,
  position: KanbanColumnDropPosition
): string[] {
  const ids = resolveKanbanColumnOrder(statuses, savedOrder).map(
    (status) => status.id
  );
  if (
    draggedId === targetId ||
    !ids.includes(draggedId) ||
    !ids.includes(targetId)
  ) {
    return ids;
  }

  const next = ids.filter((id) => id !== draggedId);
  const targetIndex = next.indexOf(targetId);
  const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
  next.splice(insertIndex, 0, draggedId);
  return next;
}

function compareTasks(
  left: BaseTask,
  right: BaseTask,
  notePriorityOptions: TaskPriorityConfig[]
): number {
  return compareTriageTasks(left, right, notePriorityOptions);
}

function buildTreeRows(
  tasks: BaseTask[],
  notePriorityOptions: TaskPriorityConfig[]
): KanbanTaskRow[] {
  const orderedTasks = [...tasks].sort((left, right) =>
    compareTasks(left, right, notePriorityOptions)
  );
  const byId = new Map(orderedTasks.map((task) => [task.id, task]));
  const parentById = new Map<string, string>();

  const createsCycle = (childId: string, parentId: string): boolean => {
    const visited = new Set([childId]);
    let currentId: string | undefined = parentId;
    while (currentId) {
      if (visited.has(currentId)) return true;
      visited.add(currentId);
      currentId = parentById.get(currentId);
    }
    return false;
  };

  for (const task of orderedTasks) {
    const candidates = task.incomingLinks
      .map((id) => byId.get(id))
      .filter((parent): parent is BaseTask => parent !== undefined)
      .sort((left, right) => compareTasks(left, right, notePriorityOptions));
    for (const parent of candidates) {
      if (parent.id === task.id || createsCycle(task.id, parent.id)) continue;
      parentById.set(task.id, parent.id);
      break;
    }
  }

  const childrenById = new Map<string, BaseTask[]>();
  for (const task of orderedTasks) {
    const parentId = parentById.get(task.id);
    if (!parentId) continue;
    const children = childrenById.get(parentId) ?? [];
    children.push(task);
    childrenById.set(parentId, children);
  }
  for (const children of childrenById.values()) {
    children.sort((left, right) =>
      compareTasks(left, right, notePriorityOptions)
    );
  }

  const rows: KanbanTaskRow[] = [];
  const visited = new Set<string>();
  const visit = (task: BaseTask, depth: number): void => {
    if (visited.has(task.id)) return;
    visited.add(task.id);
    rows.push({ task, depth });
    for (const child of childrenById.get(task.id) ?? []) {
      visit(child, depth + 1);
    }
  };

  for (const task of orderedTasks) {
    if (!parentById.has(task.id)) visit(task, 0);
  }
  // Defensive fallback for malformed dependency data.
  for (const task of orderedTasks) visit(task, 0);
  return rows;
}

/** Build unique, priority-aware project sections for one status column. */
export function buildKanbanSections(
  tasks: BaseTask[],
  focusOptions: Map<string, KanbanFocusOption[]>,
  notePriorityOptions: TaskPriorityConfig[] = [],
  groupByProject = true
): KanbanSection[] {
  const sortedTasks = [...tasks].sort((left, right) =>
    compareTasks(left, right, notePriorityOptions)
  );
  if (sortedTasks.length === 0) return [];
  if (!groupByProject) {
    return [
      {
        key: "flat",
        kind: "flat",
        label: null,
        rows: sortedTasks.map((task) => ({ task, depth: 0 })),
      },
    ];
  }

  const groups = new Map<
    string,
    { kind: KanbanSectionKind; label: string | null; tasks: BaseTask[] }
  >();
  for (const task of sortedTasks) {
    const projectNames = [
      ...new Set(
        task.projects.map((project) => project.trim()).filter(Boolean)
      ),
    ];
    const roots = focusOptions.get(task.id) ?? [];
    const key =
      projectNames.length === 1
        ? `project-name:${projectNames[0]}`
        : projectNames.length > 1
          ? "multiple-projects"
          : roots.length === 1
            ? `project-root:${roots[0].rootTaskId}`
            : roots.length > 1
              ? "multiple-projects"
              : "no-project";
    const kind: KanbanSectionKind =
      projectNames.length === 1 ||
      (projectNames.length === 0 && roots.length === 1)
        ? "project"
        : projectNames.length > 1 || roots.length > 1
          ? "multiple_projects"
          : "no_project";
    const group = groups.get(key) ?? {
      kind,
      label:
        projectNames.length === 1
          ? projectNames[0]
          : roots.length === 1
            ? roots[0].label
            : null,
      tasks: [],
    };
    group.tasks.push(task);
    groups.set(key, group);
  }

  const sections = [...groups].map(([key, group]) => ({
    key,
    kind: group.kind,
    label: group.label,
    rows: buildTreeRows(group.tasks, notePriorityOptions),
    bestTask: [...group.tasks].sort((left, right) =>
      compareTasks(left, right, notePriorityOptions)
    )[0],
  }));

  sections.sort((left, right) => {
    const taskOrder = compareTasks(
      left.bestTask,
      right.bestTask,
      notePriorityOptions
    );
    if (taskOrder !== 0) return taskOrder;
    return (left.label ?? left.kind).localeCompare(
      right.label ?? right.kind,
      undefined,
      { sensitivity: "base" }
    );
  });

  return sections.map(({ bestTask: _bestTask, ...section }) => section);
}

/** Prepend Today to every configured status column, including empty targets. */
export function buildKanbanColumns(
  tasks: BaseTask[],
  statuses: TaskStatusConfig[],
  notePriorityOptions: TaskPriorityConfig[] = [],
  options: KanbanColumnOptions = {}
): KanbanColumn[] {
  const configuredStatuses =
    statuses.length > 0 ? statuses : DEFAULT_TASK_STATUSES;
  const orderedStatuses = resolveKanbanColumnOrder(
    configuredStatuses,
    options.columnOrder
  );
  const grouped = new Map<string, BaseTask[]>();

  for (const status of configuredStatuses) grouped.set(status.id, []);
  for (const task of tasks) {
    const status = configuredStatuses.find(
      (candidate) => candidate.id === task.status
    );
    const target = status ?? configuredStatuses[0];
    grouped.get(target.id)?.push(task);
  }

  const todayTasks = tasks
    .filter((task) => task.type === "note" && task.today)
    .sort((left, right) => compareTasks(left, right, notePriorityOptions));
  const todayColumn: KanbanColumn = {
    kind: "today",
    tasks: todayTasks,
    sections: buildKanbanSections(
      todayTasks,
      options.focusOptions ?? new Map(),
      notePriorityOptions,
      options.groupByProject ?? false
    ),
  };
  const statusColumns = orderedStatuses.map((status): KanbanColumn => {
    const columnTasks = [...(grouped.get(status.id) ?? [])].sort(
      (left, right) => compareTasks(left, right, notePriorityOptions)
    );
    return {
      kind: "status",
      status,
      tasks: columnTasks,
      sections: buildKanbanSections(
        columnTasks,
        options.focusOptions ?? new Map(),
        notePriorityOptions,
        options.groupByProject ?? false
      ),
    };
  });
  return [todayColumn, ...statusColumns];
}

/** Map every structured task to each project-tree root that contains it. */
export function buildKanbanFocusOptions(
  tasks: BaseTask[]
): Map<string, KanbanFocusOption[]> {
  const options = new Map<string, KanbanFocusOption[]>();

  const visit = (node: TreeNode, root: KanbanFocusOption): void => {
    const current = options.get(node.task.id) ?? [];
    if (!current.some((option) => option.rootTaskId === root.rootTaskId)) {
      current.push(root);
      current.sort((left, right) =>
        left.label.localeCompare(right.label, undefined, {
          sensitivity: "base",
        })
      );
      options.set(node.task.id, current);
    }
    node.children.forEach((child) => visit(child, root));
  };

  for (const rootNode of buildProjectTree(tasks)) {
    visit(rootNode, {
      rootTaskId: rootNode.task.id,
      label: getTaskTreeLabel(rootNode.task),
    });
  }

  return options;
}

/** Apply an optimistic status move and restore the previous value on failure. */
export async function moveKanbanTaskStatus(
  task: BaseTask,
  newStatus: string,
  applyStatus: (_taskId: string, _status: string) => void,
  persistStatus: () => Promise<void>
): Promise<KanbanStatusMoveResult> {
  if (task.status === newStatus) return { kind: "unchanged" };

  const previousStatus = task.status;
  applyStatus(task.id, newStatus);
  try {
    await persistStatus();
    return { kind: "updated" };
  } catch (error) {
    applyStatus(task.id, previousStatus);
    return { kind: "rolled_back", error };
  }
}
