import { Node, Edge } from "reactflow";
import { BaseTask } from "./base-task";
import type { TaskAttachment } from "./base-task";
import { TagColorPalette } from "../lib/tag-color-manager";
import { TaskPriorityConfig } from "../lib/priority-config";
import { NodeDensity, PriorityAccentPosition } from "./settings";
import type { VaultWriteTracker } from "../lib/vault-watcher";

// Status is a configured status `id` (see src/lib/status-config.ts). It is a
// plain string because the available statuses are user-configurable.
export type TaskStatus = string;
export type TaskType = "dataview" | "note";

export interface RawTask {
  status: string;
  text: string;
  link: { path: string };
}

// Re-export BaseTask for convenience
export { BaseTask };
export type { TaskAttachment };

export interface TaskNodeData {
  task: BaseTask;
  layoutDirection?: "Horizontal" | "Vertical";
  showPriorities?: boolean;
  priorityAccentPosition?: PriorityAccentPosition;
  nodeDensity?: NodeDensity;
  showTags?: boolean;
  debugVisualization?: boolean;
  groupByProject?: boolean;
  tagColorPalette?: TagColorPalette;
  priorityOptions?: TaskPriorityConfig[];
  // eslint-disable-next-line no-unused-vars -- callback parameter convention
  onDeleteTask?: (taskId: string) => void;
  /** Called after an external editor (e.g. TaskNotes modal) saves changes. */
  onTaskChanged?: () => void;
  /** Open the in-app task editor panel for the given task file path. */
  // eslint-disable-next-line no-unused-vars -- callback parameter convention
  onEditTask?: (taskPath: string) => void;
  quickCommentsPropertyName?: string;
  // eslint-disable-next-line no-unused-vars -- callback parameter convention
  onQuickCommentsChanged?: (taskId: string, value: string) => void;
  // eslint-disable-next-line no-unused-vars -- callback parameter convention
  onTaskStatusChange?: (taskId: string, status: TaskStatus) => void;
  // eslint-disable-next-line no-unused-vars -- prop callback parameter convention
  onTaskPriorityChange?: (taskId: string, priority: string) => void;
  // eslint-disable-next-line no-unused-vars -- prop callback parameter convention
  onTaskStarredChange?: (taskId: string, starred: boolean) => void;
  trackVaultWrite?: VaultWriteTracker;
}

export interface TaskEdgeData {
  hash: string;
  layoutDirection?: "Horizontal" | "Vertical";
  debugVisualization?: boolean;
  edgeStyle?: "Bezier" | "Straight" | "SmoothStep";
  smoothStepRadius?: number;
}

export type TaskNode = Node<TaskNodeData, "task">;
export type TaskEdge = Edge<TaskEdgeData>;
