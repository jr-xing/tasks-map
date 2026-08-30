import React, { useContext } from "react";
import { Menu } from "obsidian";
import { BaseTask, TaskStatus } from "src/types/task";
import { updateTaskStatusInVault } from "src/lib/utils";
import { useApp } from "src/hooks/hooks";
import { StatusConfigContext } from "src/contexts/context";
import { getStatusById } from "src/lib/status-config";
import type { VaultWriteTracker } from "src/lib/vault-watcher";

interface TaskStatusProps {
  status: TaskStatus;
  task: BaseTask;
  onStatusChange: (newStatus: TaskStatus) => void; // eslint-disable-line no-unused-vars -- prop callback parameter convention
  trackVaultWrite?: VaultWriteTracker;
}

export function TaskStatusToggle({
  status,
  task,
  onStatusChange,
  trackVaultWrite,
}: TaskStatusProps) {
  const app = useApp();
  const statuses = useContext(StatusConfigContext);
  const current = getStatusById(status, statuses);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Open a menu listing every configured status so any one can be picked.
    const menu = new Menu();
    for (const s of statuses) {
      menu.addItem((item) => {
        item.setTitle(s.label);
        item.setChecked(s.id === status);
        item.onClick(async () => {
          const update = () =>
            updateTaskStatusInVault(task, s.id, app, statuses);
          if (trackVaultWrite && task.link) {
            await trackVaultWrite(task.link, update);
          } else {
            await update();
          }
          onStatusChange(s.id);
        });
      });
    }
    menu.showAtMouseEvent(e.nativeEvent);
  };

  return (
    <div className="tasks-map-status-container">
      <div
        onClick={handleClick}
        className="tasks-map-task-status-toggle"
        aria-label={current.label}
        ref={(el) => {
          if (el) {
            el.style.setProperty("--tasks-map-status-color", current.color);
          }
        }}
      >
        <span className="tasks-map-task-status-dot" />
      </div>
    </div>
  );
}
