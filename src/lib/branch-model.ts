import { BaseTask } from "src/types/base-task";
import { TaskStatusConfig } from "src/lib/status-config";

/** How a task reads on the map: an anchor, a container or a work item. */
export type TaskLevel = "project" | "group" | "branch" | "task";

export type StatusCategory = "active" | "open" | "closed";

export interface BranchSummary {
  /** Tasks in progress or otherwise active. */
  active: number;
  /** Tasks not started yet. */
  open: number;
  /** Open tasks that wait on someone. */
  waiting: number;
  /** Finished or canceled tasks. */
  closed: number;
  /** Branches directly inside this one (groups and projects only). */
  subBranches: number;
  /** The next step this branch names, when it is still open. */
  next: BaseTask | null;
  /**
   * A stand-in on leaf branches when no next step is named: the most
   * pressing open task.
   */
  suggested: BaseTask | null;
  /** Who the open tasks wait on, without duplicates. */
  waitingOn: string[];
  /** Open tasks outside this branch that list it as related. */
  related: BaseTask[];
}

export interface BranchModel {
  levels: Map<string, TaskLevel>;
  summaries: Map<string, BranchSummary>;
  /** Branches to fold for a branch-level overview. */
  foldIds: Set<string>;
}

const CLOSED_VALUES = ["done", "canceled", "cancelled", "archive", "archived"];
const ACTIVE_VALUES = ["in-progress", "in_progress", "active", "doing"];

/** Sort a status into closed / active / open by its id and note values. */
export function getStatusCategory(
  statusId: string,
  statuses: TaskStatusConfig[]
): StatusCategory {
  const config = statuses.find((status) => status.id === statusId);
  const tokens = [
    statusId,
    ...(config?.noteValues ?? "").split(","),
    config?.label ?? "",
  ]
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.some((token) => CLOSED_VALUES.includes(token))) return "closed";
  if (tokens.some((token) => ACTIVE_VALUES.includes(token))) return "active";
  return "open";
}

function buildChildren(tasks: BaseTask[]): Map<string, string[]> {
  const ids = new Set(tasks.map((task) => task.id));
  const children = new Map<string, string[]>();
  for (const task of tasks) {
    for (const parentId of task.incomingLinks) {
      if (!ids.has(parentId) || parentId === task.id) continue;
      const list = children.get(parentId) ?? [];
      list.push(task.id);
      children.set(parentId, list);
    }
  }
  return children;
}

function collectDescendants(
  rootId: string,
  children: Map<string, string[]>
): string[] {
  const seen = new Set<string>([rootId]);
  const out: string[] = [];
  const queue = [...(children.get(rootId) ?? [])];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    queue.push(...(children.get(id) ?? []));
  }
  return out;
}

/**
 * Work out each task's level and a summary for every branch.
 *
 * Branches come from the notes, never from project names:
 * - a note marked with the branch kind (`kind: area`) is a branch;
 * - under a project (or a parentless task with children) that marks no
 *   branches at all, its direct children that have children are branches.
 * A branch holding other branches is a group. Projects keep their own level.
 */
export function buildBranchModel(
  tasks: BaseTask[],
  statuses: TaskStatusConfig[]
): BranchModel {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const children = buildChildren(tasks);
  const descendants = new Map<string, string[]>();
  const descendantsOf = (id: string) => {
    let list = descendants.get(id);
    if (!list) {
      list = collectDescendants(id, children);
      descendants.set(id, list);
    }
    return list;
  };

  const anchors = tasks.filter((task) => {
    if (task.isProject) return true;
    const hasParent = task.incomingLinks.some(
      (parentId) => parentId !== task.id && byId.has(parentId)
    );
    return !hasParent && (children.get(task.id)?.length ?? 0) > 0;
  });

  const branchIds = new Set<string>();
  for (const task of tasks) {
    if (task.isBranch && !task.isProject) branchIds.add(task.id);
  }
  for (const anchor of anchors) {
    const marksBranches = descendantsOf(anchor.id).some(
      (id) => byId.get(id)?.isBranch
    );
    if (marksBranches) continue;
    for (const childId of children.get(anchor.id) ?? []) {
      const child = byId.get(childId);
      if (!child || child.isProject) continue;
      if ((children.get(childId)?.length ?? 0) > 0) branchIds.add(childId);
    }
  }

  const levels = new Map<string, TaskLevel>();
  for (const task of tasks) {
    if (task.isProject) levels.set(task.id, "project");
    else if (branchIds.has(task.id)) {
      const hasBranchChild = (children.get(task.id) ?? []).some((id) =>
        branchIds.has(id)
      );
      levels.set(task.id, hasBranchChild ? "group" : "branch");
    } else levels.set(task.id, "task");
  }

  const category = (task: BaseTask) => getStatusCategory(task.status, statuses);
  const relatedTo = new Map<string, BaseTask[]>();
  for (const task of tasks) {
    for (const target of task.relatedLinks) {
      const list = relatedTo.get(target) ?? [];
      list.push(task);
      relatedTo.set(target, list);
    }
  }

  const summaries = new Map<string, BranchSummary>();
  for (const task of tasks) {
    const level = levels.get(task.id);
    if (level === "task") continue;
    const inside = descendantsOf(task.id);
    const insideSet = new Set(inside);
    const work = inside
      .map((id) => byId.get(id))
      .filter(
        (item): item is BaseTask => !!item && levels.get(item.id) === "task"
      );
    const summary: BranchSummary = {
      active: 0,
      open: 0,
      waiting: 0,
      closed: 0,
      subBranches: (children.get(task.id) ?? []).filter((id) =>
        branchIds.has(id)
      ).length,
      next: null,
      suggested: null,
      waitingOn: [],
      related: (relatedTo.get(task.id) ?? []).filter(
        (item) => !insideSet.has(item.id) && category(item) !== "closed"
      ),
    };
    const waitingOn = new Set<string>();
    const live: BaseTask[] = [];
    for (const item of work) {
      const itemCategory = category(item);
      if (itemCategory === "closed") summary.closed++;
      else if (item.waitingOn) {
        summary.waiting++;
        waitingOn.add(item.waitingOn);
      } else {
        if (itemCategory === "active") summary.active++;
        else summary.open++;
        live.push(item);
      }
    }
    summary.waitingOn = [...waitingOn];
    const named = task.nextStep ? byId.get(task.nextStep) : undefined;
    if (named && category(named) !== "closed") summary.next = named;
    // Only leaf branches get a stand-in; a group's sub-branches carry theirs.
    if (!summary.next && level === "branch") {
      summary.suggested =
        [...live].sort((left, right) => {
          const activeOrder =
            (category(left) === "active" ? 0 : 1) -
            (category(right) === "active" ? 0 : 1);
          if (activeOrder !== 0) return activeOrder;
          const leftDue = left.dueDate ?? "9999-99-99";
          const rightDue = right.dueDate ?? "9999-99-99";
          if (leftDue !== rightDue) return leftDue.localeCompare(rightDue);
          return left.summary.localeCompare(right.summary);
        })[0] ?? null;
    }
    summaries.set(task.id, summary);
  }

  const foldIds = new Set(
    [...branchIds].filter(
      (id) => levels.get(id) === "branch" && (children.get(id)?.length ?? 0) > 0
    )
  );
  return { levels, summaries, foldIds };
}

/**
 * The branches to fold, minus any branch that contains one of `keepVisible`
 * (so a task being focused never disappears inside a folded branch).
 */
export function getBranchFoldIds(
  model: BranchModel,
  tasks: BaseTask[],
  keepVisible: string[] = []
): Set<string> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const fold = new Set(model.foldIds);
  const queue = [...keepVisible];
  const seen = new Set<string>();
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (seen.has(id)) continue;
    seen.add(id);
    fold.delete(id);
    queue.push(...(byId.get(id)?.incomingLinks ?? []));
  }
  return fold;
}

export interface DependencyConnection {
  source: string;
  target: string;
  /** "blocker → blocked" titles, for the edge tooltip. */
  label: string;
}

/**
 * Cross-branch `blockedBy` links between visible cards. When either end is
 * folded away, the link moves to its nearest visible ancestor, so a folded
 * branch still shows that it feeds another branch.
 */
export function getDependencyConnections(
  tasks: BaseTask[],
  visibleIds: ReadonlySet<string>
): DependencyConnection[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const representative = (id: string): string | null => {
    const seen = new Set<string>();
    const queue = [id];
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      if (seen.has(current)) continue;
      seen.add(current);
      if (visibleIds.has(current)) return current;
      queue.push(...(byId.get(current)?.incomingLinks ?? []));
    }
    return null;
  };
  const connections = new Map<string, DependencyConnection>();
  for (const task of tasks) {
    for (const blockerId of task.blockedByLinks) {
      const blocker = byId.get(blockerId);
      if (!blocker) continue;
      const source = representative(blockerId);
      const target = representative(task.id);
      if (!source || !target || source === target) continue;
      if (byId.get(target)?.incomingLinks.includes(source)) continue;
      const key = `${source}\u0000${target}`;
      if (!connections.has(key)) {
        connections.set(key, {
          source,
          target,
          label: `${blocker.summary} → ${task.summary}`,
        });
      }
    }
  }
  return [...connections.values()];
}
