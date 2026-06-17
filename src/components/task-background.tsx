import React, { useContext } from "react";
import { TaskStatus } from "src/types/task";
import { StatusConfigContext } from "src/contexts/context";
import { getStatusById } from "src/lib/status-config";
import {
  TASKS_PLUGIN_PRIORITY_OPTIONS,
  TaskPriorityConfig,
  getPriorityByValue,
  isNoPriority,
} from "src/lib/priority-config";
import { PriorityAccentPosition } from "src/types/settings";

interface TaskBackgroundProps {
  status: TaskStatus;
  starred?: boolean;
  expanded?: boolean;
  debugVisualization?: boolean;
  selected?: boolean;
  priority?: string;
  priorityAccentPosition?: PriorityAccentPosition;
  priorityOptions?: TaskPriorityConfig[];
  children: React.ReactNode;
}

export function TaskBackground({
  status,
  starred = false,
  expanded,
  debugVisualization,
  selected = false,
  priority = "",
  priorityAccentPosition = "top",
  priorityOptions = [],
  children,
}: TaskBackgroundProps) {
  const statuses = useContext(StatusConfigContext);
  const color = getStatusById(status, statuses).color;
  const priorityConfig = getPriorityByValue(
    priority,
    priorityOptions.length > 0 ? priorityOptions : TASKS_PLUGIN_PRIORITY_OPTIONS
  );
  const hasPriorityAccent = !isNoPriority(priority);

  const className = [
    "tasks-map-task-background",
    "tasks-map-task-background--status",
    hasPriorityAccent && "tasks-map-task-background--priority",
    hasPriorityAccent &&
      `tasks-map-task-background--priority-${priorityAccentPosition}`,
    starred && "tasks-map-task-background--starred",
    expanded && "tasks-map-task-background--expanded",
    debugVisualization && "tasks-map-task-background--debug",
    selected && "tasks-map-task-background--selected",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      ref={(el) => {
        if (el) {
          el.style.setProperty("--tasks-map-status-color", color);
          el.style.setProperty(
            "--tasks-map-priority-color",
            priorityConfig.color
          );
        }
      }}
    >
      {children}
    </div>
  );
}
