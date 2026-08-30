import React, { useCallback } from "react";
import { Menu, setIcon } from "obsidian";
import { BaseTask } from "src/types/task";
import { useApp } from "src/hooks/hooks";
import { updateTaskPriorityInVault } from "src/lib/utils";
import type { VaultWriteTracker } from "src/lib/vault-watcher";
import {
  TaskPriorityConfig,
  TASKS_PLUGIN_PRIORITY_OPTIONS,
  getPriorityByValue,
  isNoPriority,
  visiblePriorityOptions,
} from "src/lib/priority-config";
import { t } from "../i18n";

interface TaskPriorityToggleProps {
  priority: string;
  task: BaseTask;
  priorityOptions?: TaskPriorityConfig[];
  onPriorityChange: (newPriority: string) => void; // eslint-disable-line no-unused-vars -- prop callback parameter convention
  trackVaultWrite?: VaultWriteTracker;
}

function optionsForTask(
  task: BaseTask,
  priorityOptions: TaskPriorityConfig[] | undefined
): TaskPriorityConfig[] {
  if (task.type === "dataview") return TASKS_PLUGIN_PRIORITY_OPTIONS;
  return priorityOptions && priorityOptions.length > 0
    ? priorityOptions
    : TASKS_PLUGIN_PRIORITY_OPTIONS;
}

export function TaskPriorityToggle({
  priority,
  task,
  priorityOptions,
  onPriorityChange,
  trackVaultWrite,
}: TaskPriorityToggleProps) {
  const app = useApp();
  const options = optionsForTask(task, priorityOptions);
  const current = getPriorityByValue(priority, options);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const menu = new Menu();
    for (const option of visiblePriorityOptions(options)) {
      menu.addItem((item) => {
        item.setTitle(option.label);
        item.setChecked(
          option.value === priority ||
            (isNoPriority(option.value) && isNoPriority(priority))
        );
        if (option.icon) item.setIcon(option.icon);
        item.onClick(async () => {
          const previousPriority = priority;
          onPriorityChange(option.value);
          try {
            const update = () =>
              updateTaskPriorityInVault(task, option.value, app);
            if (trackVaultWrite && task.link) {
              await trackVaultWrite(task.link, update);
            } else {
              await update();
            }
          } catch {
            onPriorityChange(previousPriority);
          }
        });
      });
    }
    menu.showAtMouseEvent(e.nativeEvent);
  };

  const priorityRef = useCallback(
    (el: HTMLButtonElement | null) => {
      if (!el) return;
      el.style.setProperty("--tasks-map-priority-color", current.color);
      if (current.icon) setIcon(el, current.icon);
    },
    [current.color, current.icon]
  );

  return (
    <button
      type="button"
      ref={priorityRef}
      className={
        "tasks-map-task-priority-toggle nodrag" +
        (current.icon ? " tasks-map-task-priority-toggle--icon" : "")
      }
      title={t("task_node.priority", { priority: current.label })}
      aria-label={t("task_node.priority", { priority: current.label })}
      onClick={handleClick}
    >
      {!current.icon && <span className="tasks-map-task-priority-dot" />}
    </button>
  );
}
