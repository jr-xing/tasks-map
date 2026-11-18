import { createContext } from "react";
import { App } from "obsidian";
import type { HoverParent } from "obsidian";
import { TaskStatusConfig, DEFAULT_TASK_STATUSES } from "../lib/status-config";

export const AppContext = createContext<App | undefined>(undefined);

interface TaskHoverPreviewContextValue {
  source: string;
  hoverParent: HoverParent;
}

export const TaskHoverPreviewContext =
  createContext<TaskHoverPreviewContextValue | null>(null);

interface TaskFocusActionsValue {
  /** Whether the task belongs to a project the map can show in full. */
  canShowProject: (_taskId: string) => boolean;
  /** Show the task's whole project, including its parents. */
  showProject: (_taskId: string) => void;
  /** Show only the task and its subtasks. */
  showSubtree: (_taskId: string) => void;
}

/** Card focus buttons; absent outside the map, which hides them. */
export const TaskFocusActionsContext =
  createContext<TaskFocusActionsValue | null>(null);

/** Provides the user-configured task statuses to the component tree. */
export const StatusConfigContext = createContext<TaskStatusConfig[]>(
  DEFAULT_TASK_STATUSES
);

interface TagsContextValue {
  allTags: string[];
  updateTaskTags: (taskId: string, newTags: string[]) => void; // eslint-disable-line no-unused-vars -- prop callback parameter convention
}

export const TagsContext = createContext<TagsContextValue>({
  allTags: [],
  updateTaskTags: () => {},
});
