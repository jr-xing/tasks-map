import React, { useCallback } from "react";
import { NodeProps, NodeResizer } from "reactflow";
import { CirclePlus, FolderOpen } from "lucide-react";
import { useApp } from "src/hooks/hooks";
import {
  isTaskNotesCreationModalAvailable,
  openTaskNotesTaskCreationModalForProject,
} from "../lib/tasknotes-bridge";
import { t } from "../i18n";

export interface ProjectGroupNodeData {
  label: string;
  isDragOver?: boolean;
}

export default function ProjectGroupNode({
  data,
  selected,
}: NodeProps<ProjectGroupNodeData>) {
  const app = useApp();
  const classes = [
    "tasks-map-project-group",
    selected ? "tasks-map-project-group--selected" : "",
    data.isDragOver ? "tasks-map-project-group--drag-over" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const canCreateTask = isTaskNotesCreationModalAvailable(app);

  const handleCreateTask = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      openTaskNotesTaskCreationModalForProject(app, data.label);
    },
    [app, data.label]
  );

  return (
    <div className={classes}>
      <NodeResizer minWidth={100} minHeight={100} isVisible={selected} />
      <div className="tasks-map-project-group-label">
        <FolderOpen size={13} />
        <span className="tasks-map-project-group-label-text">
          {data.label}
        </span>
        {canCreateTask && (
          <button
            type="button"
            className="tasks-map-project-group-create nodrag"
            title={t("task_node.create_project_task")}
            aria-label={t("task_node.create_project_task")}
            onClick={handleCreateTask}
          >
            <CirclePlus size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
