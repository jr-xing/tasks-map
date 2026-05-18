import { TaskStatus } from "./task";
import type { TraversalMode } from "src/lib/traverse-graph";

export interface FilterState {
  selectedTags: string[];
  excludedTags: string[];
  selectedStatuses: TaskStatus[];
  selectedFiles: string[];
  searchQuery: string;
  traversalMode: TraversalMode;
  onlyStarred: boolean;
  /**
   * ID of the task whose subtree the map is scoped to. When set, only this
   * task and its transitive dependents are shown. `null` shows the whole map.
   */
  selectedRootTask: string | null;
}

export const DEFAULT_FILTER_STATE: FilterState = {
  selectedTags: [],
  excludedTags: [],
  selectedStatuses: [],
  selectedFiles: [],
  searchQuery: "",
  traversalMode: "match",
  onlyStarred: false,
  selectedRootTask: null,
};
