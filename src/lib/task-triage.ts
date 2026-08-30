import {
  TASKNOTES_PRIORITY_OPTIONS,
  TASKS_PLUGIN_PRIORITY_OPTIONS,
  TaskPriorityConfig,
  getPriorityByValue,
} from "src/lib/priority-config";
import {
  DEFAULT_TASK_STATUSES,
  TaskStatusConfig,
  getStatusById,
} from "src/lib/status-config";
import { BaseTask } from "src/types/task";

export interface TaskTriageGroup {
  status: TaskStatusConfig;
  tasks: BaseTask[];
}

export function getTaskTriageLabel(task: BaseTask): string {
  return task.summary || task.text || task.id;
}

function getTaskPriorityWeight(
  task: BaseTask,
  notePriorityOptions: TaskPriorityConfig[]
): number {
  const options =
    task.type === "dataview"
      ? TASKS_PLUGIN_PRIORITY_OPTIONS
      : notePriorityOptions.length > 0
        ? notePriorityOptions
        : TASKNOTES_PRIORITY_OPTIONS;
  return getPriorityByValue(task.priority, options).weight;
}

function compareDueDates(left: string | null, right: string | null): number {
  if (left && right) return left.localeCompare(right);
  if (left) return -1;
  if (right) return 1;
  return 0;
}

export function compareTriageTasks(
  left: BaseTask,
  right: BaseTask,
  notePriorityOptions: TaskPriorityConfig[] = []
): number {
  if (left.starred !== right.starred) return left.starred ? -1 : 1;

  const priorityDifference =
    getTaskPriorityWeight(right, notePriorityOptions) -
    getTaskPriorityWeight(left, notePriorityOptions);
  if (priorityDifference !== 0) return priorityDifference;

  const dueDateDifference = compareDueDates(left.dueDate, right.dueDate);
  if (dueDateDifference !== 0) return dueDateDifference;

  const labelDifference = getTaskTriageLabel(left).localeCompare(
    getTaskTriageLabel(right),
    undefined,
    { sensitivity: "base" }
  );
  if (labelDifference !== 0) return labelDifference;

  return left.id.localeCompare(right.id);
}

export function buildTaskTriageGroups(
  tasks: BaseTask[],
  statuses: TaskStatusConfig[],
  notePriorityOptions: TaskPriorityConfig[] = []
): TaskTriageGroup[] {
  const configuredStatuses =
    statuses.length > 0 ? statuses : DEFAULT_TASK_STATUSES;
  const grouped = new Map<string, BaseTask[]>();

  for (const task of tasks) {
    const status = getStatusById(task.status, configuredStatuses);
    const group = grouped.get(status.id) ?? [];
    group.push(task);
    grouped.set(status.id, group);
  }

  return configuredStatuses.flatMap((status) => {
    const group = grouped.get(status.id);
    if (!group || group.length === 0) return [];
    return [
      {
        status,
        tasks: [...group].sort((left, right) =>
          compareTriageTasks(left, right, notePriorityOptions)
        ),
      },
    ];
  });
}
