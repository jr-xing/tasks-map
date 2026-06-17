import { getVisibilityFilteredNodeIds } from "src/lib/filter-tasks";
import {
  buildProjectTree,
  getTaskTreeLabel,
  getTreePathRootId,
  TreeNode,
} from "src/lib/project-tree";
import { BaseTask } from "src/types/task";
import { FilterState } from "src/types/filter-state";

export interface TaskFocusCandidate {
  id: string;
  label: string;
  searchText: string;
  taskId: string;
  rootTaskId: string;
  depth: number;
  path: string[];
  link: string;
  tags: string[];
  projects: string[];
}

function visibleTasksForFilter(
  tasks: BaseTask[],
  filter: FilterState
): BaseTask[] {
  const visibleIds = new Set(getVisibilityFilteredNodeIds(tasks, filter));
  return tasks.filter((task) => visibleIds.has(task.id));
}

function flattenTree(
  nodes: TreeNode[],
  depth: number,
  pathLabels: string[],
  pathTaskIds: string[]
): TaskFocusCandidate[] {
  return nodes.flatMap((node) => {
    const label = getTaskTreeLabel(node.task);
    const currentPathLabels = [...pathLabels, label];
    const currentPathTaskIds = [...pathTaskIds, node.task.id];
    const rootTaskId = getTreePathRootId(currentPathTaskIds) ?? node.task.id;
    const candidate: TaskFocusCandidate = {
      id: `task:${node.task.id}`,
      label,
      searchText: [
        label,
        node.task.id,
        node.task.link,
        ...currentPathLabels,
        ...node.task.tags,
        ...node.task.projects,
      ].join(" "),
      taskId: node.task.id,
      rootTaskId,
      depth,
      path: currentPathLabels,
      link: node.task.link,
      tags: node.task.tags,
      projects: node.task.projects,
    };

    return [
      candidate,
      ...flattenTree(
        node.children,
        depth + 1,
        currentPathLabels,
        currentPathTaskIds
      ),
    ];
  });
}

export function buildTaskFocusCandidates(
  tasks: BaseTask[],
  filter: FilterState
): TaskFocusCandidate[] {
  return flattenTree(
    buildProjectTree(visibleTasksForFilter(tasks, filter)),
    0,
    [],
    []
  );
}

export function createTaskFocusFilter(
  baseFilter: FilterState,
  taskId: string
): FilterState {
  return {
    ...baseFilter,
    searchQuery: "",
    traversalMode: "match",
    selectedRootTask: taskId,
  };
}
