import { getStatusCategory, StatusCategory } from "src/lib/branch-model";
import { getMinimalNodeTitle } from "src/lib/minimal-card";
import { TaskStatusConfig } from "src/lib/status-config";
import { BaseTask } from "src/types/task";

/**
 * The neighbourhood of one task, as shown in the strip above a note's body:
 * the chain of parents up to the project, the siblings under the direct
 * parent and the task's own subtasks.
 */
export interface NoteContext {
  task: BaseTask;
  /** Home-parent chain, project (deepest parent) first, direct parent last. */
  ancestors: BaseTask[];
  /** Parents other than the home parent the chain follows. */
  otherParents: BaseTask[];
  /** Other children of the direct parent, in display order. */
  siblings: BaseTask[];
  /** The task's own children, in display order. */
  children: BaseTask[];
}

/** A list split into what the strip shows at rest and what it folds away. */
export interface FoldedTaskList {
  shown: BaseTask[];
  /** Open tasks past the limit, behind a "+N" toggle. */
  hidden: BaseTask[];
  /** Closed tasks, behind a "✓N" toggle. */
  closed: BaseTask[];
}

/** How many open tasks a strip row shows before folding the rest. */
export const NOTE_CONTEXT_ROW_LIMIT = 4;

const CATEGORY_RANK: Record<StatusCategory, number> = {
  active: 0,
  open: 1,
  closed: 2,
};

export function getNoteContextTitle(task: BaseTask): string {
  return getMinimalNodeTitle(task) || task.text || task.id;
}

function indexChildren(tasks: BaseTask[], byId: Map<string, BaseTask>) {
  const children = new Map<string, BaseTask[]>();
  for (const task of tasks) {
    for (const parentId of new Set(task.incomingLinks)) {
      if (parentId === task.id || !byId.has(parentId)) continue;
      const list = children.get(parentId) ?? [];
      list.push(task);
      children.set(parentId, list);
    }
  }
  return children;
}

function existingParents(task: BaseTask, byId: Map<string, BaseTask>) {
  return [...new Set(task.incomingLinks)]
    .filter((id) => id !== task.id)
    .map((id) => byId.get(id))
    .filter((parent): parent is BaseTask => !!parent);
}

/**
 * Sort a row: the parent's named next step first, then active, starred or
 * today tasks, then open tasks, closed last; ties keep title order.
 */
export function sortNoteContextTasks(
  tasks: BaseTask[],
  statuses: TaskStatusConfig[],
  nextStepId: string | null = null
): BaseTask[] {
  const rank = (task: BaseTask) => {
    if (task.id === nextStepId) return -2;
    const category = getStatusCategory(task.status, statuses);
    if (category !== "closed" && (task.starred || task.today)) return -1;
    return CATEGORY_RANK[category];
  };
  return [...tasks].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      getNoteContextTitle(a).localeCompare(getNoteContextTitle(b), undefined, {
        sensitivity: "base",
      })
  );
}

/** Keep up to `limit` open tasks visible; fold the rest and the closed. */
export function foldNoteContextTasks(
  sortedTasks: BaseTask[],
  statuses: TaskStatusConfig[],
  limit = NOTE_CONTEXT_ROW_LIMIT
): FoldedTaskList {
  const folded: FoldedTaskList = { shown: [], hidden: [], closed: [] };
  for (const task of sortedTasks) {
    if (getStatusCategory(task.status, statuses) === "closed") {
      folded.closed.push(task);
    } else if (folded.shown.length < limit) {
      folded.shown.push(task);
    } else {
      folded.hidden.push(task);
    }
  }
  return folded;
}

interface BuildNoteContextOptions {
  /**
   * Return null for a task with neither parents nor children. On by
   * default: a lone task note has nothing to show. A note that only hangs
   * off the task still benefits from naming it, so callers turn it off.
   */
  requireRelations?: boolean;
}

/** Build the context of `taskId`, or null when the task is unknown. */
export function buildNoteContext(
  taskId: string,
  tasks: BaseTask[],
  statuses: TaskStatusConfig[],
  { requireRelations = true }: BuildNoteContextOptions = {}
): NoteContext | null {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const task = byId.get(taskId);
  if (!task) return null;
  const childrenOf = indexChildren(tasks, byId);

  // Follow the home (first) parent up to the root, stopping at cycles.
  const ancestors: BaseTask[] = [];
  const seen = new Set([task.id]);
  let current = existingParents(task, byId)[0];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    ancestors.unshift(current);
    current = existingParents(current, byId)[0];
  }

  const parents = existingParents(task, byId);
  const parent = parents[0];
  const siblings = parent
    ? sortNoteContextTasks(
        (childrenOf.get(parent.id) ?? []).filter(
          (sibling) => sibling.id !== task.id
        ),
        statuses,
        parent.nextStep
      )
    : [];
  const children = sortNoteContextTasks(
    childrenOf.get(task.id) ?? [],
    statuses,
    task.nextStep
  );

  if (requireRelations && ancestors.length === 0 && children.length === 0)
    return null;
  return {
    task,
    ancestors,
    otherParents: parents.slice(1),
    siblings,
    children,
  };
}

/** The local date `days` after `from`, as YYYY-MM-DD. */
export function shiftIsoDate(from: Date, days: number): string {
  const date = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate() + days
  );
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The project a context belongs to: the top of the parent chain, or the
 * task itself when it heads its own subtree. Null for a lone task.
 */
export function getNoteContextRootId(context: NoteContext): string | null {
  if (context.ancestors.length > 0) return context.ancestors[0].id;
  return context.children.length > 0 ? context.task.id : null;
}

/**
 * The tasks a note belongs to. A task note is its own anchor. Any other
 * note (a chat, a meeting log) hangs off the tasks that link to it, then
 * the tasks it links to itself.
 */
export function findNoteContextAnchors(
  notePath: string,
  taskIds: ReadonlySet<string>,
  linksToNote: readonly string[],
  linksFromNote: readonly string[]
): string[] {
  if (taskIds.has(notePath)) return [notePath];
  const anchors = [...linksToNote, ...linksFromNote].filter(
    (id) => id !== notePath && taskIds.has(id)
  );
  return [...new Set(anchors)];
}
