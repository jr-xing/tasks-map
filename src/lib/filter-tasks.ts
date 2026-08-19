import { BaseTask } from "src/types/base-task";
import { traverseGraph } from "src/lib/traverse-graph";
import { FilterState } from "src/types/filter-state";

export const NO_TAGS_VALUE = "__NO_TAGS__";

export type TaskFilterReasonCode =
  | "selected_tags"
  | "excluded_tags"
  | "selected_statuses"
  | "selected_files"
  | "selected_projects"
  | "only_starred"
  | "root_scope"
  | "search_scope";

const getNonSearchReasonCodes = (
  task: BaseTask,
  filter: FilterState
): TaskFilterReasonCode[] => {
  const reasons: TaskFilterReasonCode[] = [];

  if (filter.selectedTags.length > 0) {
    const noTagsSelected = filter.selectedTags.includes(NO_TAGS_VALUE);
    const regularTagsSelected = filter.selectedTags.filter(
      (tag) => tag !== NO_TAGS_VALUE
    );
    const matchesNoTags = noTagsSelected && task.tags.length === 0;
    const matchesRegularTags = regularTagsSelected.some((tag) =>
      task.tags.includes(tag)
    );
    if (!matchesNoTags && !matchesRegularTags) reasons.push("selected_tags");
  }

  if (
    filter.excludedTags.some((excludedTag) => task.tags.includes(excludedTag))
  ) {
    reasons.push("excluded_tags");
  }
  if (
    filter.selectedStatuses.length > 0 &&
    !filter.selectedStatuses.includes(task.status)
  ) {
    reasons.push("selected_statuses");
  }
  if (
    filter.selectedFiles.length > 0 &&
    !filter.selectedFiles.some((selectedPath) =>
      selectedPath.endsWith("/")
        ? task.link.startsWith(selectedPath)
        : task.link === selectedPath
    )
  ) {
    reasons.push("selected_files");
  }
  if (
    filter.selectedProjects.length > 0 &&
    !filter.selectedProjects.some((project) => task.projects.includes(project))
  ) {
    reasons.push("selected_projects");
  }
  if (filter.onlyStarred && !task.starred) reasons.push("only_starred");

  return reasons;
};

const applyNonSearchFilters = (
  tasks: BaseTask[],
  filter: FilterState
): BaseTask[] => {
  return tasks.filter(
    (task) => getNonSearchReasonCodes(task, filter).length === 0
  );
};

const applySearchFilter = (
  tasks: BaseTask[],
  searchQuery: string
): BaseTask[] => {
  if (!searchQuery.trim()) return tasks;
  const lowerQuery = searchQuery.toLowerCase();
  return tasks.filter(
    (task) =>
      task.summary.toLowerCase().includes(lowerQuery) ||
      task.id.toLowerCase().includes(lowerQuery) ||
      task.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
  );
};

/**
 * Restricts `allowed` to the subtree rooted at `rootTaskId`: the root task plus
 * every task that transitively depends on it (its downstream dependents).
 *
 * The subtree is walked over *all* tasks so that an intermediate node hidden by
 * a status/tag filter does not sever the branch below it; the result is then
 * intersected with `allowed` so those other filters still apply.
 */
const applyRootTaskScope = (
  tasks: BaseTask[],
  allowed: BaseTask[],
  rootTaskId: string
): BaseTask[] => {
  const allIds = new Set(tasks.map((task) => task.id));
  const subtree = new Set(
    traverseGraph([rootTaskId], tasks, allIds, "downstream")
  );
  return allowed.filter((task) => subtree.has(task.id));
};

export const getFilteredNodeIds = (
  tasks: BaseTask[],
  filter: FilterState
): string[] => {
  let allowed = applyNonSearchFilters(tasks, filter);

  if (filter.selectedRootTask) {
    allowed = applyRootTaskScope(tasks, allowed, filter.selectedRootTask);
  }

  if (!filter.searchQuery.trim()) {
    return allowed.map((task) => task.id);
  }

  const searchMatched = applySearchFilter(allowed, filter.searchQuery);
  const seedIds = searchMatched.map((task) => task.id);
  const allowedIds = new Set(allowed.map((task) => task.id));

  return traverseGraph(seedIds, tasks, allowedIds, filter.traversalMode);
};

export const getVisibilityFilteredNodeIds = (
  tasks: BaseTask[],
  filter: FilterState
): string[] =>
  getFilteredNodeIds(tasks, {
    ...filter,
    searchQuery: "",
    selectedRootTask: null,
    traversalMode: "match",
  });

/** Explain the active filters that exclude one task from the final result. */
export function getTaskFilterReasonCodes(
  task: BaseTask,
  tasks: BaseTask[],
  filter: FilterState
): TaskFilterReasonCode[] {
  const reasons = getNonSearchReasonCodes(task, filter);

  if (
    filter.selectedRootTask &&
    applyRootTaskScope(tasks, [task], filter.selectedRootTask).length === 0
  ) {
    reasons.push("root_scope");
  }

  if (filter.searchQuery.trim()) {
    const searchMatched = applySearchFilter(tasks, filter.searchQuery);
    const allIds = new Set(tasks.map((candidate) => candidate.id));
    const searchScope = traverseGraph(
      searchMatched.map((candidate) => candidate.id),
      tasks,
      allIds,
      filter.traversalMode
    );
    if (!searchScope.includes(task.id)) reasons.push("search_scope");
  }

  return reasons;
}
