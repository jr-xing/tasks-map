import type { BaseTask } from "src/types/task";

export type KanbanTodayChangeResult =
  | { kind: "unchanged" | "unsupported" | "updated" }
  | { kind: "rolled_back"; error: unknown };

/** Apply only the Today flag; ignore overlapping requests for each task. */
export async function changeKanbanTaskToday(
  task: BaseTask,
  today: boolean,
  pending: Set<string>,
  applyToday: (_taskId: string, _today: boolean) => void,
  persistToday: () => Promise<void>
): Promise<KanbanTodayChangeResult> {
  if (task.type !== "note") return { kind: "unsupported" };
  if (pending.has(task.id) || task.today === today) {
    return { kind: "unchanged" };
  }

  const previousToday = task.today;
  pending.add(task.id);
  try {
    applyToday(task.id, today);
    await persistToday();
    return { kind: "updated" };
  } catch (error) {
    applyToday(task.id, previousToday);
    return { kind: "rolled_back", error };
  } finally {
    pending.delete(task.id);
  }
}
