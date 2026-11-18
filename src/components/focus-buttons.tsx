import React, { useCallback, useContext } from "react";
import { FolderTree, ListTree } from "lucide-react";
import { TaskFocusActionsContext } from "src/contexts/context";
import { t } from "../i18n";

interface FocusButtonsProps {
  taskId: string;
}

/** Card buttons that narrow the map to the task's project or subtree. */
export function FocusButtons({ taskId }: FocusButtonsProps) {
  const actions = useContext(TaskFocusActionsContext);

  const handleProject = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      actions?.showProject(taskId);
    },
    [actions, taskId]
  );

  const handleSubtree = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      actions?.showSubtree(taskId);
    },
    [actions, taskId]
  );

  const stop = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);

  if (!actions) return null;

  return (
    <>
      {actions.canShowProject(taskId) && (
        <button
          type="button"
          className="tasks-map-task-node-header-button nodrag"
          title={t("task_node.focus_project")}
          aria-label={t("task_node.focus_project")}
          onClick={handleProject}
          onDoubleClick={stop}
        >
          <FolderTree size={16} />
        </button>
      )}
      <button
        type="button"
        className="tasks-map-task-node-header-button nodrag"
        title={t("task_node.focus_subtree")}
        aria-label={t("task_node.focus_subtree")}
        onClick={handleSubtree}
        onDoubleClick={stop}
      >
        <ListTree size={16} />
      </button>
    </>
  );
}
