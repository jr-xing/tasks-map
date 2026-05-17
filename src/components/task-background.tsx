import React, { useContext } from "react";
import { TaskStatus } from "src/types/task";
import { StatusConfigContext } from "src/contexts/context";
import { getStatusById } from "src/lib/status-config";

interface TaskBackgroundProps {
  status: TaskStatus;
  starred?: boolean;
  expanded?: boolean;
  debugVisualization?: boolean;
  selected?: boolean;
  children: React.ReactNode;
}

export function TaskBackground({
  status,
  starred = false,
  expanded,
  debugVisualization,
  selected = false,
  children,
}: TaskBackgroundProps) {
  const statuses = useContext(StatusConfigContext);
  const color = getStatusById(status, statuses).color;

  const className = [
    "tasks-map-task-background",
    "tasks-map-task-background--status",
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
        if (el) el.style.setProperty("--tasks-map-status-color", color);
      }}
    >
      {children}
    </div>
  );
}
