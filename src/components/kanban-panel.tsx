import React, { useCallback, useMemo, useState } from "react";
import { Menu } from "obsidian";
import { Crosshair, Pin, X } from "lucide-react";
import {
  TASKS_PLUGIN_PRIORITY_OPTIONS,
  type TaskPriorityConfig,
  getPriorityByValue,
} from "src/lib/priority-config";
import { buildKanbanColumns, type KanbanFocusOption } from "src/lib/kanban";
import type { TaskStatusConfig } from "src/lib/status-config";
import type { VaultWriteTracker } from "src/lib/vault-watcher";
import type { BaseTask, TaskStatus } from "src/types/task";
import { TaskStatusToggle } from "./task-status";
import { t } from "../i18n";

export const KANBAN_DRAG_DATA_KEY = "application/tasks-map-kanban-task-id";

interface KanbanPanelProps {
  tasks: BaseTask[];
  statuses: TaskStatusConfig[];
  notePriorityOptions: TaskPriorityConfig[];
  focusOptions: Map<string, KanbanFocusOption[]>;
  pinned: boolean;
  onPinnedChange: (_pinned: boolean) => void;
  onClose: () => void;
  onFocusProject: (_rootTaskId: string) => void;
  onTaskStatusChange: (_taskId: string, _status: TaskStatus) => void;
  onTaskStatusMove: (_taskId: string, _status: TaskStatus) => Promise<void>;
  trackVaultWrite?: VaultWriteTracker;
}

interface PriorityAccentProps {
  task: BaseTask;
  notePriorityOptions: TaskPriorityConfig[];
}

function PriorityAccent({ task, notePriorityOptions }: PriorityAccentProps) {
  const options =
    task.type === "dataview"
      ? TASKS_PLUGIN_PRIORITY_OPTIONS
      : notePriorityOptions;
  const priority = getPriorityByValue(task.priority, options);
  const ref = useCallback(
    (element: HTMLSpanElement | null) => {
      element?.style.setProperty("--tasks-map-priority-color", priority.color);
    },
    [priority.color]
  );

  return (
    <span
      ref={ref}
      className="tasks-map-kanban__priority"
      title={t("task_node.priority", { priority: priority.label })}
      aria-label={t("task_node.priority", { priority: priority.label })}
    />
  );
}

export default function KanbanPanel({
  tasks,
  statuses,
  notePriorityOptions,
  focusOptions,
  pinned,
  onPinnedChange,
  onClose,
  onFocusProject,
  onTaskStatusChange,
  onTaskStatusMove,
  trackVaultWrite,
}: KanbanPanelProps) {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const columns = useMemo(
    () => buildKanbanColumns(tasks, statuses, notePriorityOptions),
    [tasks, statuses, notePriorityOptions]
  );

  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>, taskId: string) => {
      event.dataTransfer.setData(KANBAN_DRAG_DATA_KEY, taskId);
      event.dataTransfer.effectAllowed = "move";
      setDraggedTaskId(taskId);
    },
    []
  );

  const handleDragEnd = useCallback(() => {
    setDraggedTaskId(null);
    setDragOverStatus(null);
  }, []);

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>, status: string) => {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setDragOverStatus(status);
    },
    []
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLElement>, status: string) => {
      event.preventDefault();
      event.stopPropagation();
      const taskId = event.dataTransfer.getData(KANBAN_DRAG_DATA_KEY);
      setDraggedTaskId(null);
      setDragOverStatus(null);
      if (!taskId) return;
      await onTaskStatusMove(taskId, status);
    },
    [onTaskStatusMove]
  );

  const handleFocus = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, taskId: string) => {
      event.stopPropagation();
      const options = focusOptions.get(taskId) ?? [];
      if (options.length === 1) {
        onFocusProject(options[0].rootTaskId);
        return;
      }
      if (options.length === 0) return;

      const menu = new Menu();
      for (const option of options) {
        menu.addItem((item) => {
          item.setTitle(option.label);
          item.onClick(() => onFocusProject(option.rootTaskId));
        });
      }
      menu.showAtMouseEvent(event.nativeEvent);
    },
    [focusOptions, onFocusProject]
  );

  return (
    <div className="tasks-map-kanban">
      <div className="tasks-map-kanban__header">
        <span className="tasks-map-kanban__title">{t("kanban.title")}</span>
        <span className="tasks-map-kanban__total">{tasks.length}</span>
        <button
          className={`tasks-map-kanban__header-button${
            pinned ? " tasks-map-kanban__header-button--active" : ""
          }`}
          onClick={() => onPinnedChange(!pinned)}
          aria-label={pinned ? t("kanban.unpin") : t("kanban.pin")}
          aria-pressed={pinned}
          title={pinned ? t("kanban.unpin") : t("kanban.pin")}
        >
          <Pin size={15} />
        </button>
        <button
          className="tasks-map-kanban__header-button"
          onClick={onClose}
          aria-label={t("kanban.close")}
          title={t("kanban.close")}
        >
          <X size={16} />
        </button>
      </div>

      <div className="tasks-map-kanban__columns">
        {columns.map((column) => {
          const isDragOver = dragOverStatus === column.status.id;
          return (
            <section
              key={column.status.id}
              className={`tasks-map-kanban__column${
                isDragOver ? " tasks-map-kanban__column--drag-over" : ""
              }`}
              onDragOver={(event) => handleDragOver(event, column.status.id)}
              onDragLeave={() => setDragOverStatus(null)}
              onDrop={(event) => void handleDrop(event, column.status.id)}
            >
              <div className="tasks-map-kanban__column-header">
                <span
                  className="tasks-map-kanban__status-dot"
                  ref={(element) => {
                    element?.style.setProperty(
                      "--tasks-map-status-color",
                      column.status.color
                    );
                  }}
                />
                <span className="tasks-map-kanban__column-label">
                  {column.status.label}
                </span>
                <span className="tasks-map-kanban__column-count">
                  {column.tasks.length}
                </span>
              </div>

              <div className="tasks-map-kanban__cards">
                {column.tasks.map((task) => {
                  const projectOptions = focusOptions.get(task.id) ?? [];
                  const projectLabels =
                    task.projects.length > 0
                      ? task.projects
                      : projectOptions.map((option) => option.label);
                  const canFocus = projectOptions.length > 0;
                  return (
                    <div
                      key={task.id}
                      className={`tasks-map-kanban__card${
                        draggedTaskId === task.id
                          ? " tasks-map-kanban__card--dragging"
                          : ""
                      }`}
                      draggable
                      onDragStart={(event) => handleDragStart(event, task.id)}
                      onDragEnd={handleDragEnd}
                    >
                      <div className="tasks-map-kanban__card-main">
                        <TaskStatusToggle
                          status={task.status}
                          task={task}
                          onStatusChange={(status) =>
                            onTaskStatusChange(task.id, status)
                          }
                          trackVaultWrite={trackVaultWrite}
                        />
                        <PriorityAccent
                          task={task}
                          notePriorityOptions={notePriorityOptions}
                        />
                        <span
                          className="tasks-map-kanban__card-title"
                          title={task.summary || task.text || task.id}
                        >
                          {task.summary || task.text || task.id}
                        </span>
                        <button
                          className="tasks-map-kanban__focus-button"
                          onClick={(event) => handleFocus(event, task.id)}
                          disabled={!canFocus}
                          aria-label={
                            canFocus
                              ? t("kanban.focus_project")
                              : t("kanban.no_project_context")
                          }
                          title={
                            canFocus
                              ? t("kanban.focus_project")
                              : t("kanban.no_project_context")
                          }
                        >
                          <Crosshair size={14} />
                        </button>
                      </div>
                      {(projectLabels.length > 0 || task.dueDate) && (
                        <div className="tasks-map-kanban__card-meta">
                          {projectLabels.length > 0 && (
                            <span
                              className="tasks-map-kanban__projects"
                              title={projectLabels.join(", ")}
                            >
                              {projectLabels.join(" · ")}
                            </span>
                          )}
                          {task.dueDate && (
                            <span
                              className="tasks-map-kanban__due"
                              title={t("kanban.due", { date: task.dueDate })}
                            >
                              {task.dueDate}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {column.tasks.length === 0 && (
                  <div className="tasks-map-kanban__column-empty">
                    {t("kanban.empty_column")}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
