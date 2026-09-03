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
