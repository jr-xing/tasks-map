import { BaseTask } from "src/types/base-task";

/** Group of tasks that name no group and inherit none. */
export const NO_TASK_GROUP = "";

interface EdgeEnds {
  source: string;
  target: string;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function groupKey(name: string): string {
  return name.trim().toLowerCase();
}

/** A task's first parent among the given ids: the project it lives in. */
export function getHomeParentId(
  task: BaseTask,
  ids: ReadonlySet<string>
): string | null {
  return (
    task.incomingLinks.find(
      (parentId) => parentId !== task.id && ids.has(parentId)
    ) ?? null
  );
}

/**
 * Each task's group: the value it names itself, else the group of its home
 * (first) parent, and so on up to the project. Names match regardless of
 * case and keep the first spelling seen. Tasks without any group get
 * {@link NO_TASK_GROUP}.
 */
export function resolveTaskGroups(tasks: BaseTask[]): Map<string, string> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const ids = new Set(byId.keys());
  const spellings = new Map<string, string>();
  for (const task of tasks) {
    const name = task.taskGroup.trim();
    if (name && !spellings.has(groupKey(name))) {
      spellings.set(groupKey(name), name);
    }
  }

  const groups = new Map<string, string>();
  for (const task of tasks) {
    const chain: string[] = [];
    const seen = new Set<string>();
    let group = NO_TASK_GROUP;
    let current: BaseTask | undefined = task;
    while (current && !seen.has(current.id)) {
      const known = groups.get(current.id);
      if (known !== undefined) {
        group = known;
        break;
      }
      seen.add(current.id);
      chain.push(current.id);
      const own = current.taskGroup.trim();
      if (own) {
        group = spellings.get(groupKey(own)) ?? own;
        break;
      }
      const parentId = getHomeParentId(current, ids);
      current = parentId ? byId.get(parentId) : undefined;
    }
    chain.forEach((id) => groups.set(id, group));
  }
  return groups;
}

/**
 * Each task's home root: follow home parents up to a task without one. A
 * cycle ends at the task where it closes.
 */
export function getHomeRoots(tasks: BaseTask[]): Map<string, string> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const ids = new Set(byId.keys());
  const roots = new Map<string, string>();
  for (const task of tasks) {
    const chain: string[] = [];
    const seen = new Set<string>();
    let root = task.id;
    let current: BaseTask | undefined = task;
    while (current) {
      const known = roots.get(current.id);
      if (known !== undefined) {
        root = known;
        break;
      }
      if (seen.has(current.id)) {
        root = current.id;
        break;
      }
      seen.add(current.id);
      chain.push(current.id);
      root = current.id;
      const parentId = getHomeParentId(current, ids);
      current = parentId ? byId.get(parentId) : undefined;
    }
    chain.forEach((id) => roots.set(id, root));
  }
  return roots;
}

/**
 * Split parent links for a grouped map. A link shapes the layout when both
 * ends live in the same project (same home root) and the same group. The
 * rest, a shared note's extra parents in other projects, are still drawn
 * but no longer pull those projects into one tangle.
 */
export function splitTaskGroupEdges<E extends EdgeEnds>(
  edges: E[],
  tasks: BaseTask[],
  groups: ReadonlyMap<string, string>
): { layoutEdges: E[]; crossEdges: E[] } {
  const roots = getHomeRoots(tasks);
  const keyOf = (id: string) =>
    `${roots.get(id) ?? id}\u0000${groups.get(id) ?? NO_TASK_GROUP}`;
  const layoutEdges: E[] = [];
  const crossEdges: E[] = [];
  for (const edge of edges) {
    if (keyOf(edge.source) === keyOf(edge.target)) {
      layoutEdges.push(edge);
    } else {
      crossEdges.push(edge);
    }
  }
  return { layoutEdges, crossEdges };
}

/**
 * Put group names in display order: names from `order` first (matched
 * regardless of case), then the rest alphabetically, and
 * {@link NO_TASK_GROUP} last.
 */
export function orderTaskGroups(
  names: Iterable<string>,
  order: readonly string[]
): string[] {
  const unique = [...new Set(names)];
  const rank = new Map<string, number>();
  order.forEach((name, index) => {
    const key = groupKey(name);
    if (key && !rank.has(key)) rank.set(key, index);
  });
  return unique.sort((left, right) => {
    if (left === NO_TASK_GROUP || right === NO_TASK_GROUP) {
      return left === NO_TASK_GROUP ? (right === NO_TASK_GROUP ? 0 : 1) : -1;
    }
    const leftRank = rank.get(groupKey(left));
    const rightRank = rank.get(groupKey(right));
    if (leftRank !== undefined || rightRank !== undefined) {
      if (leftRank === undefined) return 1;
      if (rightRank === undefined) return -1;
      if (leftRank !== rightRank) return leftRank - rightRank;
    }
    return (
      compareText(groupKey(left), groupKey(right)) || compareText(left, right)
    );
  });
}

/** Read a group order typed as a comma- or line-separated list. */
export function parseTaskGroupOrder(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const name = part.trim();
    if (!name || seen.has(groupKey(name))) continue;
    seen.add(groupKey(name));
    names.push(name);
  }
  return names;
}
