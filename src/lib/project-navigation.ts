import { buildProjectTree, getTaskTreeLabel, TreeNode } from "./project-tree";
import { traverseGraph } from "./traverse-graph";
import { BaseTask } from "src/types/task";
import { FilterState } from "src/types/filter-state";
import type { Viewport } from "reactflow";

export interface ProjectRootOption {
  rootTaskId: string;
  label: string;
}

export function selectProjectRoots(
  options: ProjectRootOption[],
  requestedRoots?: readonly string[]
) {
  return options.filter(
    (option) => !requestedRoots || requestedRoots.includes(option.rootTaskId)
  );
}

export function survivingProjectRoots(tasks: BaseTask[], roots: string[]) {
  const ids = new Set(tasks.map((task) => task.id));
  return roots.filter((id) => ids.has(id));
}

/** Use the same roots as Project Tree, including every path through a DAG. */
export function buildProjectRootOptions(tasks: BaseTask[]) {
  const options = new Map<string, ProjectRootOption[]>();
  const visit = (node: TreeNode, root: ProjectRootOption): void => {
    const current = options.get(node.task.id) ?? [];
    if (!current.some((option) => option.rootTaskId === root.rootTaskId)) {
      current.push(root);
      current.sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
      );
      options.set(node.task.id, current);
    }
    node.children.forEach((child) => visit(child, root));
  };
  for (const root of buildProjectTree(tasks)) {
    visit(root, {
      rootTaskId: root.task.id,
      label: getTaskTreeLabel(root.task),
    });
  }
  return options;
}

export function getProjectScopeTaskIds(
  tasks: BaseTask[],
  rootTaskIds: readonly string[]
): Set<string> {
  return new Set(
    traverseGraph(
      [...rootTaskIds],
      tasks,
      new Set(tasks.map((task) => task.id)),
      "downstream"
    )
  );
}

export interface TaskMapNavigationContext {
  selectedTaskIds: string[];
  focusedTaskId: string | null;
}

export function getNavigationTaskId(context: TaskMapNavigationContext) {
  return context.selectedTaskIds.length === 1
    ? context.selectedTaskIds[0]
    : context.focusedTaskId;
}

export function selectNavigationMap<T>(
  leaves: T[],
  active: T | null,
  recent: T | null
): T | null {
  if (active !== null && leaves.includes(active)) return active;
  if (recent !== null && leaves.includes(recent)) return recent;
  return leaves[0] ?? null;
}

export function canOpenPickerProjects(
  event: Pick<
    KeyboardEvent,
    "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "isComposing"
  >,
  input: Pick<HTMLInputElement, "value" | "selectionStart" | "selectionEnd">
): boolean {
  return (
    event.key === "ArrowRight" &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.isComposing &&
    input.selectionStart === input.value.length &&
    input.selectionEnd === input.value.length
  );
}

export interface TaskMapReturnState {
  filter: FilterState;
  collapsedTaskIds: string[];
  selectedTaskIds: string[];
  hideUnlinkedTasks: boolean;
  viewport: Viewport;
}

export function createOverviewState(
  current: TaskMapReturnState,
  existingReturnState: TaskMapReturnState | null
) {
  // Project navigation changes scope, not the user's visibility preferences.
  const filter: FilterState = {
    ...structuredClone(current.filter),
    searchQuery: "",
    traversalMode: "match",
    selectedRootTask: null,
  };
  return {
    returnState: existingReturnState ?? structuredClone(current),
    filter,
    collapsedTaskIds: new Set<string>(),
    hideUnlinkedTasks: current.hideUnlinkedTasks,
  };
}
