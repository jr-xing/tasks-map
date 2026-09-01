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
import { compareTriageTasks, type TaskTriageGroup } from "src/lib/task-triage";
import type { TaskPriorityConfig } from "src/lib/priority-config";
import type { BaseTask } from "src/types/task";
import type { FilterState } from "src/types/filter-state";

export interface KanbanFocusOption {
  rootTaskId: string;
  label: string;
}

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
  filter: FilterState
): BaseTask[] {
  const ids = new Set(
    getFilteredNodeIds(tasks, {
      ...filter,
      selectedStatuses: [],
      selectedRootTask: null,
    })
  );
  return tasks.filter((task) => ids.has(task.id));
}

/** Build every configured status column, including empty drop targets. */
export function buildKanbanColumns(
  tasks: BaseTask[],
  statuses: TaskStatusConfig[],
  notePriorityOptions: TaskPriorityConfig[] = []
): TaskTriageGroup[] {
  const configuredStatuses =
    statuses.length > 0 ? statuses : DEFAULT_TASK_STATUSES;
  const grouped = new Map<string, BaseTask[]>();

  for (const status of configuredStatuses) {
    grouped.set(status.id, []);
  }
  for (const task of tasks) {
    const status = configuredStatuses.find(
      (candidate) => candidate.id === task.status
    );
    const target = status ?? configuredStatuses[0];
    grouped.get(target.id)?.push(task);
  }

  return configuredStatuses.map((status) => ({
    status,
    tasks: [...(grouped.get(status.id) ?? [])].sort((left, right) =>
      compareTriageTasks(left, right, notePriorityOptions)
    ),
  }));
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
