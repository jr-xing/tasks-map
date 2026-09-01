import { BaseTask } from "src/types/task";

export interface TreeNode {
  task: BaseTask;
  children: TreeNode[];
}

export const getTaskTreeLabel = (task: BaseTask): string =>
  task.summary || task.text || task.id;

export function getTreePathRootId(pathTaskIds: string[]): string | null {
  return pathTaskIds[0] ?? null;
}

export function getProjectTreeDepth(nodes: TreeNode[]): number {
  if (nodes.length === 0) return 0;
  return Math.max(
    ...nodes.map((node) => 1 + getProjectTreeDepth(node.children))
  );
}

/**
 * Builds a project -> task -> subtask forest from a flat task list.
 *
 * A task's `incomingLinks` are the tasks it depends on (its parents), so the
 * children of X are the tasks whose `incomingLinks` include X. Roots are tasks
 * no visible task points at. A task may have several parents (a DAG): in that
 * case it appears under each parent. Roots with no descendants are dropped so
 * the panel shows only genuinely structured tasks, not every isolated node —
 * except project notes, which stand alone until tasks are attached to them.
 */
export function buildProjectTree(tasks: BaseTask[]): TreeNode[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const childrenOf = new Map<string, BaseTask[]>();
  const hasParent = new Set<string>();

  for (const task of tasks) {
    for (const parentId of task.incomingLinks) {
      if (!byId.has(parentId)) continue;
      hasParent.add(task.id);
      const list = childrenOf.get(parentId) ?? [];
      list.push(task);
      childrenOf.set(parentId, list);
    }
  }

  const sortTasks = (arr: BaseTask[]): BaseTask[] =>
    [...arr].sort((a, b) =>
      getTaskTreeLabel(a).localeCompare(getTaskTreeLabel(b), undefined, {
        sensitivity: "base",
      })
    );

  const build = (task: BaseTask, path: Set<string>): TreeNode => {
    const children: TreeNode[] = [];
    for (const child of sortTasks(childrenOf.get(task.id) ?? [])) {
      if (path.has(child.id)) continue;
      children.push(build(child, new Set(path).add(child.id)));
    }
    return { task, children };
  };

  return sortTasks(tasks.filter((task) => !hasParent.has(task.id)))
    .map((root) => build(root, new Set([root.id])))
    .filter((node) => node.children.length > 0 || node.task.isProject);
}

/** Prunes the forest to branches that contain a node matching the query. */
export function filterProjectTree(
  nodes: TreeNode[],
  query: string
): TreeNode[] {
  const lower = query.toLowerCase();
  const matches = (task: BaseTask): boolean =>
    getTaskTreeLabel(task).toLowerCase().includes(lower) ||
    task.tags.some((tag) => tag.toLowerCase().includes(lower));

  const recurse = (node: TreeNode): TreeNode | null => {
    const children = node.children
      .map(recurse)
      .filter((child): child is TreeNode => child !== null);
    if (matches(node.task) || children.length > 0) {
      return { task: node.task, children };
    }
    return null;
  };

  return nodes.map(recurse).filter((node): node is TreeNode => node !== null);
}
