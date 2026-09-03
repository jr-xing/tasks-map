import type { BaseTask } from "src/types/base-task";
import type { FilterState } from "src/types/filter-state";
import {
  getFilteredNodeIds,
  getTaskFilterReasonCodes,
  type TaskFilterReasonCode,
} from "src/lib/filter-tasks";
import {
  getUnlinkedTasks,
  type NoteTaskInspection,
  type NoteTaskInspectionReason,
} from "src/lib/utils";

export type NoteVisibilityVerdict =
  | "shown"
  | "should_show"
  | "stale"
  | "hidden"
  | "excluded"
  | "pending"
  | "not_rendered";

export type NoteVisibilityReasonCode =
  | NoteTaskInspectionReason
  | TaskFilterReasonCode
  | "recognized"
  | "parsed"
  | "status_mapped"
  | "status_fallback"
  | "no_live_map"
  | "map_loading"
  | "snapshot_current"
  | "stale_missing"
  | "stale_changed"
  | "unlinked_allowed"
  | "unlinked_hidden"
  | "filters_pass"
  | "folded_branch"
  | "rendered"
  | "render_missing";

export interface NoteVisibilityReason {
  code: NoteVisibilityReasonCode;
  state: "pass" | "fail" | "warning";
  details?: Record<string, string | string[]>;
}

export interface LiveMapVisibilityContext {
  tasks: BaseTask[];
  filter: FilterState;
  hideUnlinkedTasks: boolean;
  droppedTaskIds: string[];
  visibleNodeIds: string[];
  foldedNodeIds: string[];
  isLoading: boolean;
}

export interface NoteVisibilityReport {
  filePath: string;
  verdict: NoteVisibilityVerdict;
  context: "live" | "defaults";
  task: BaseTask | null;
  reasons: NoteVisibilityReason[];
  canReload: boolean;
}

export interface NoteVisibilityInput {
  filePath: string;
  inspection: NoteTaskInspection;
  freshTasks: BaseTask[];
  liveContext?: LiveMapVisibilityContext;
  defaultFilter: FilterState;
  defaultHideUnlinkedTasks: boolean;
}

const VISIBILITY_FIELDS = [
  "id",
  "summary",
  "tags",
  "status",
  "link",
  "incomingLinks",
  "starred",
  "projects",
  "isProject",
] as const;

function changedVisibilityFields(
  current: BaseTask,
  loaded: BaseTask
): string[] {
  return VISIBILITY_FIELDS.filter(
    (field) => JSON.stringify(current[field]) !== JSON.stringify(loaded[field])
  );
}

function filterReason(
  code: TaskFilterReasonCode,
  task: BaseTask,
  filter: FilterState
): NoteVisibilityReason {
  const details: Record<string, string | string[]> = {};
  if (code === "selected_tags") details.selected = filter.selectedTags;
  if (code === "excluded_tags") details.selected = filter.excludedTags;
  if (code === "selected_statuses") {
    details.actual = task.status;
    details.selected = filter.selectedStatuses;
  }
  if (code === "selected_files") details.selected = filter.selectedFiles;
  if (code === "selected_projects") {
    details.actual = task.projects;
    details.selected = filter.selectedProjects;
  }
  if (code === "root_scope") {
    details.root = filter.selectedRootTask ?? "";
  }
  if (code === "search_scope") details.query = filter.searchQuery;
  return { code, state: "fail", details };
}

export function buildNoteVisibilityReport({
  filePath,
  inspection,
  freshTasks,
  liveContext,
  defaultFilter,
  defaultHideUnlinkedTasks,
}: NoteVisibilityInput): NoteVisibilityReport {
  const context = liveContext ? "live" : "defaults";
  const reasons: NoteVisibilityReason[] = [];

  if (inspection.kind === "excluded") {
    reasons.push({
      code: inspection.reason,
      state: "fail",
      details: {
        property: inspection.propertyName,
        expected: inspection.expectedValues,
        actual: inspection.actualValues,
        ...(inspection.error ? { error: inspection.error } : {}),
      },
    });
    return {
      filePath,
      verdict: "excluded",
      context,
      task: null,
      reasons,
      canReload: false,
    };
  }

  const currentTask = inspection.task;
  reasons.push({
    code: "recognized",
    state: "pass",
    details: {
      property: inspection.propertyName,
      actual: inspection.actualValues,
    },
  });
  reasons.push({ code: "parsed", state: "pass" });
  reasons.push({
    code: inspection.statusResolution.matched
      ? "status_mapped"
      : "status_fallback",
    state: inspection.statusResolution.matched ? "pass" : "warning",
    details: {
      raw: inspection.rawStatus,
      resolved: inspection.statusResolution.id,
    },
  });

  if (!liveContext) {
    reasons.push({ code: "no_live_map", state: "warning" });
  } else if (liveContext.isLoading) {
    reasons.push({ code: "map_loading", state: "warning" });
    return {
      filePath,
      verdict: "pending",
      context,
      task: currentTask,
      reasons,
      canReload: false,
    };
  } else {
    const loadedTask = liveContext.tasks.find((task) => task.id === filePath);
    if (!loadedTask) {
      reasons.push({ code: "stale_missing", state: "fail" });
      return {
        filePath,
        verdict: "stale",
        context,
        task: currentTask,
        reasons,
        canReload: true,
      };
    }

    const changedFields = changedVisibilityFields(currentTask, loadedTask);
    if (changedFields.length > 0) {
      reasons.push({
        code: "stale_changed",
        state: "fail",
        details: { fields: changedFields },
      });
      return {
        filePath,
        verdict: "stale",
        context,
        task: currentTask,
        reasons,
        canReload: true,
      };
    }
    reasons.push({ code: "snapshot_current", state: "pass" });
  }

  const tasks = liveContext?.tasks ?? freshTasks;
  const filter = liveContext?.filter ?? defaultFilter;
  const hideUnlinkedTasks =
    liveContext?.hideUnlinkedTasks ?? defaultHideUnlinkedTasks;
  const droppedTaskIds = new Set(liveContext?.droppedTaskIds ?? []);
  const unlinkedIds = new Set(getUnlinkedTasks(tasks).map((task) => task.id));
  const unlinked = unlinkedIds.has(currentTask.id);

  if (hideUnlinkedTasks && unlinked && !droppedTaskIds.has(currentTask.id)) {
    reasons.push({ code: "unlinked_hidden", state: "fail" });
    return {
      filePath,
      verdict: "hidden",
      context,
      task: currentTask,
      reasons,
      canReload: false,
    };
  }
  reasons.push({ code: "unlinked_allowed", state: "pass" });

  const graphTasks = hideUnlinkedTasks
    ? tasks.filter(
        (task) => !unlinkedIds.has(task.id) || droppedTaskIds.has(task.id)
      )
    : tasks;
  const visibleIds = new Set(getFilteredNodeIds(graphTasks, filter));
  if (!visibleIds.has(currentTask.id)) {
    const filterReasons = getTaskFilterReasonCodes(
      currentTask,
      graphTasks,
      filter
    );
    reasons.push(
      ...filterReasons.map((code) => filterReason(code, currentTask, filter))
    );
    return {
      filePath,
      verdict: "hidden",
      context,
      task: currentTask,
      reasons,
      canReload: false,
    };
  }
  reasons.push({ code: "filters_pass", state: "pass" });

  if (liveContext?.foldedNodeIds.includes(currentTask.id)) {
    reasons.push({ code: "folded_branch", state: "fail" });
    return {
      filePath,
      verdict: "hidden",
      context,
      task: currentTask,
      reasons,
      canReload: false,
    };
  }

  if (liveContext && !liveContext.visibleNodeIds.includes(currentTask.id)) {
    reasons.push({ code: "render_missing", state: "fail" });
    return {
      filePath,
      verdict: "not_rendered",
      context,
      task: currentTask,
      reasons,
      canReload: true,
    };
  }

  if (liveContext) reasons.push({ code: "rendered", state: "pass" });
  return {
    filePath,
    verdict: liveContext ? "shown" : "should_show",
    context,
    task: currentTask,
    reasons,
    canReload: false,
  };
}
