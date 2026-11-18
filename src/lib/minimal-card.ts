import type { BaseTask } from "src/types/base-task";
import type { BranchSummary } from "src/lib/branch-model";
import {
  getPriorityByValue,
  isNoPriority,
  TASKS_PLUGIN_PRIORITY_OPTIONS,
  TaskPriorityConfig,
} from "src/lib/priority-config";

/** A due date worth showing on a card at rest. */
export type DueState = "overdue" | "soon";

/** Days ahead within which a due date counts as "soon". */
export const DUE_SOON_DAYS = 3;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The title a minimal card shows: the note title, never a date prefix. */
export function getMinimalNodeTitle(task: BaseTask): string {
  return (task.noteFrontmatterTitle || task.summary).trim();
}

/** "overdue" or "soon" when the due date needs attention, else null. */
export function getDueState(
  dueDate: string | null | undefined,
  today: Date = new Date()
): DueState | null {
  const match = DATE_PATTERN.exec(dueDate ?? "");
  if (!match) return null;
  const due = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const days = Math.round((due.getTime() - start.getTime()) / DAY_MS);
  if (days < 0) return "overdue";
  if (days <= DUE_SOON_DAYS) return "soon";
  return null;
}

/**
 * Whether a priority is one of the top two levels of its scale (high and
 * urgent, or high and highest), the only ones a card shows at rest.
 */
export function isImportantPriority(
  priority: string,
  options: TaskPriorityConfig[] = []
): boolean {
  if (isNoPriority(priority)) return false;
  const scale = options.length > 0 ? options : TASKS_PLUGIN_PRIORITY_OPTIONS;
  const config = getPriorityByValue(priority, scale);
  const maxWeight = Math.max(...scale.map((option) => option.weight));
  return config.weight > 0 && config.weight >= maxWeight - 1;
}

/** The branch still has active, open or waiting tasks. */
export function hasOpenWork(summary: BranchSummary | undefined): boolean {
  return !!summary && summary.active + summary.open + summary.waiting > 0;
}
