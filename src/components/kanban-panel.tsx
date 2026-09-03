import React, { useCallback, useMemo, useState } from "react";
import { Menu, Notice } from "obsidian";
import {
  ArrowUpRight,
  Crosshair,
  GripVertical,
  Pin,
  Settings2,
  X,
} from "lucide-react";
import { useApp } from "src/hooks/hooks";
import {
  canOpenKanbanTaskNote,
  isKanbanCardInteractiveTarget,
  openKanbanTaskNote,
  shouldOpenKanbanCardOnDoubleClick,
} from "src/lib/kanban-open-note";
import type { KanbanDisplayPreferences } from "src/lib/kanban-preferences";
import {
  TASKS_PLUGIN_PRIORITY_OPTIONS,
  type TaskPriorityConfig,
  getPriorityByValue,
} from "src/lib/priority-config";
import {
  buildKanbanColumns,
  getKanbanCardTitle,
  moveKanbanColumn,
  type KanbanColumnDropPosition,
  type KanbanFocusOption,
  type KanbanSection,
  type KanbanTaskRow,
} from "src/lib/kanban";
import type { TaskStatusConfig } from "src/lib/status-config";
import type { VaultWriteTracker } from "src/lib/vault-watcher";
import type { BaseTask, TaskStatus } from "src/types/task";
import { TaskStatusToggle } from "./task-status";
import { t } from "../i18n";

export type { KanbanDisplayPreferences } from "src/lib/kanban-preferences";

export const KANBAN_DRAG_DATA_KEY = "application/tasks-map-kanban-task-id";
export const KANBAN_COLUMN_DRAG_DATA_KEY =
  "application/tasks-map-kanban-column-id";

interface KanbanPanelProps {
  tasks: BaseTask[];
  statuses: TaskStatusConfig[];
  notePriorityOptions: TaskPriorityConfig[];
  focusOptions: Map<string, KanbanFocusOption[]>;
  preferences: KanbanDisplayPreferences;
  pinned: boolean;
  onPinnedChange: (_pinned: boolean) => void;
  onClose: () => void;
  onFocusProject: (_rootTaskId: string) => void;
  onTaskStatusChange: (_taskId: string, _status: TaskStatus) => void;
  onTaskStatusMove: (_taskId: string, _status: TaskStatus) => Promise<void>;
  onPreferencesChange: (_patch: Partial<KanbanDisplayPreferences>) => void;
  onColumnOrderChange: (_columnOrder: string[]) => void;
  trackVaultWrite?: VaultWriteTracker;
}

interface PriorityAccentProps {
  task: BaseTask;
  notePriorityOptions: TaskPriorityConfig[];
}

interface ColumnDropTarget {
  statusId: string;
  position: KanbanColumnDropPosition;
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

function getSectionLabel(section: KanbanSection): string {
  if (section.kind === "multiple_projects") {
    return t("kanban.multiple_projects");
  }
  if (section.kind === "no_project") return t("kanban.no_project");
  return section.label ?? "";
}

export default function KanbanPanel({
  tasks,
  statuses,
  notePriorityOptions,
  focusOptions,
  preferences,
  pinned,
  onPinnedChange,
  onClose,
  onFocusProject,
  onTaskStatusChange,
  onTaskStatusMove,
  onPreferencesChange,
  onColumnOrderChange,
  trackVaultWrite,
}: KanbanPanelProps) {
  const app = useApp();
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const [draggedColumnId, setDraggedColumnId] = useState<string | null>(null);
  const [columnDropTarget, setColumnDropTarget] =
    useState<ColumnDropTarget | null>(null);
  const columns = useMemo(
    () =>
      buildKanbanColumns(tasks, statuses, notePriorityOptions, {
        columnOrder: preferences.columnOrder,
        groupByProject: preferences.groupByProject,
        focusOptions,
      }),
    [
      tasks,
      statuses,
      notePriorityOptions,
      preferences.columnOrder,
      preferences.groupByProject,
      focusOptions,
    ]
  );

  const handleTaskDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>, taskId: string) => {
      if (isKanbanCardInteractiveTarget(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.dataTransfer.setData(KANBAN_DRAG_DATA_KEY, taskId);
      event.dataTransfer.effectAllowed = "move";
      setDraggedTaskId(taskId);
      setDraggedColumnId(null);
    },
    []
  );

  const handleTaskDragEnd = useCallback(() => {
    setDraggedTaskId(null);
    setDragOverStatus(null);
  }, []);

  const handleColumnDragStart = useCallback(
    (event: React.DragEvent<HTMLButtonElement>, statusId: string) => {
      event.stopPropagation();
      event.dataTransfer.setData(KANBAN_COLUMN_DRAG_DATA_KEY, statusId);
      event.dataTransfer.effectAllowed = "move";
      setDraggedColumnId(statusId);
      setDraggedTaskId(null);
    },
    []
  );

  const handleColumnDragEnd = useCallback(() => {
    setDraggedColumnId(null);
    setColumnDropTarget(null);
  }, []);

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>, statusId: string) => {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";

      if (draggedColumnId) {
        const rect = event.currentTarget.getBoundingClientRect();
        const position: KanbanColumnDropPosition =
          event.clientX < rect.left + rect.width / 2 ? "before" : "after";
        setColumnDropTarget({ statusId, position });
        setDragOverStatus(null);
        return;
      }
      setDragOverStatus(statusId);
      setColumnDropTarget(null);
    },
    [draggedColumnId]
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLElement>, statusId: string) => {
      event.preventDefault();
      event.stopPropagation();

      const columnId =
        event.dataTransfer.getData(KANBAN_COLUMN_DRAG_DATA_KEY) ||
        draggedColumnId;
      if (columnId) {
        const position =
          columnDropTarget?.statusId === statusId
            ? columnDropTarget.position
            : "before";
        onColumnOrderChange(
          moveKanbanColumn(
            statuses,
            preferences.columnOrder,
            columnId,
            statusId,
            position
          )
        );
        setDraggedColumnId(null);
        setColumnDropTarget(null);
        return;
      }

      const taskId = event.dataTransfer.getData(KANBAN_DRAG_DATA_KEY);
      setDraggedTaskId(null);
      setDragOverStatus(null);
      if (!taskId) return;
      await onTaskStatusMove(taskId, statusId);
    },
    [
      columnDropTarget,
      draggedColumnId,
      onColumnOrderChange,
      onTaskStatusMove,
      preferences.columnOrder,
      statuses,
    ]
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

  const handleOpenSettings = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const menu = new Menu();
      menu.addItem((item) => {
        item.setTitle(t("kanban.title_source_frontmatter"));
        item.setChecked(preferences.cardTitleSource === "frontmatter");
        item.onClick(() =>
          onPreferencesChange({ cardTitleSource: "frontmatter" })
        );
      });
      menu.addItem((item) => {
        item.setTitle(t("kanban.title_source_filename"));
        item.setChecked(preferences.cardTitleSource === "filename");
        item.onClick(() =>
          onPreferencesChange({ cardTitleSource: "filename" })
        );
      });
      menu.addSeparator();
      menu.addItem((item) => {
        item.setTitle(t("kanban.show_project_tasks"));
        item.setChecked(preferences.showProjectTasks);
        item.onClick(() =>
          onPreferencesChange({
            showProjectTasks: !preferences.showProjectTasks,
          })
        );
      });
      menu.addItem((item) => {
        item.setTitle(t("kanban.show_card_status"));
        item.setChecked(preferences.showCardStatus);
        item.onClick(() =>
          onPreferencesChange({
            showCardStatus: !preferences.showCardStatus,
          })
        );
      });
      menu.addItem((item) => {
        item.setTitle(t("kanban.group_by_project"));
        item.setChecked(preferences.groupByProject);
        item.onClick(() =>
          onPreferencesChange({
            groupByProject: !preferences.groupByProject,
          })
        );
      });
      menu.addItem((item) => {
        item.setTitle(t("kanban.open_note_on_double_click"));
        item.setChecked(preferences.openNoteOnDoubleClick);
        item.onClick(() =>
          onPreferencesChange({
            openNoteOnDoubleClick: !preferences.openNoteOnDoubleClick,
          })
        );
      });
      menu.showAtMouseEvent(event.nativeEvent);
    },
    [onPreferencesChange, preferences]
  );

  const handleOpenTaskNote = useCallback(
    async (task: BaseTask, openInNewTab: boolean) => {
      try {
        const opened = await openKanbanTaskNote(app, task, { openInNewTab });
        if (!opened) new Notice(t("kanban.note_unavailable"));
      } catch (error) {
        console.error("Failed to open Kanban task note:", error);
        new Notice(t("kanban.note_open_failed"));
      }
    },
    [app]
  );

  const handleOpenNoteClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, task: BaseTask) => {
      event.preventDefault();
      event.stopPropagation();
      void handleOpenTaskNote(task, event.ctrlKey || event.metaKey);
    },
    [handleOpenTaskNote]
  );

  const handleOpenNoteAuxClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, task: BaseTask) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      void handleOpenTaskNote(task, true);
    },
    [handleOpenTaskNote]
  );

  const handleCardDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, task: BaseTask) => {
      event.preventDefault();
      event.stopPropagation();
      const shouldOpen = shouldOpenKanbanCardOnDoubleClick({
        enabled: preferences.openNoteOnDoubleClick,
        isDragging: draggedTaskId !== null,
        target: event.target,
      });
      if (!shouldOpen) return;
      void handleOpenTaskNote(task, event.ctrlKey || event.metaKey);
    },
    [draggedTaskId, handleOpenTaskNote, preferences.openNoteOnDoubleClick]
  );

  const renderCard = useCallback(
    (row: KanbanTaskRow, section: KanbanSection) => {
      const { task } = row;
      const projectOptions = focusOptions.get(task.id) ?? [];
      const projectLabels =
        task.projects.length > 0
          ? task.projects
          : projectOptions.map((option) => option.label);
      const canFocus = projectOptions.length > 0;
      const canOpenNote = canOpenKanbanTaskNote(app, task);
      const cardTitle = getKanbanCardTitle(task, preferences.cardTitleSource);
      const showProjectMeta =
        !preferences.groupByProject || section.kind !== "project";

      return (
        <div
          key={task.id}
          className={`tasks-map-kanban__card${
            row.depth > 0 ? " tasks-map-kanban__card--child" : ""
          }${
            draggedTaskId === task.id ? " tasks-map-kanban__card--dragging" : ""
          }`}
          ref={(element) => {
            element?.style.setProperty(
              "--tasks-map-kanban-tree-depth",
              String(row.depth)
            );
          }}
          draggable
          onDragStart={(event) => handleTaskDragStart(event, task.id)}
          onDragEnd={handleTaskDragEnd}
          onDoubleClick={(event) => handleCardDoubleClick(event, task)}
        >
          <div className="tasks-map-kanban__card-main">
            {preferences.showCardStatus && (
              <TaskStatusToggle
                status={task.status}
                task={task}
                onStatusChange={(status) => onTaskStatusChange(task.id, status)}
                trackVaultWrite={trackVaultWrite}
              />
            )}
            <PriorityAccent
              task={task}
              notePriorityOptions={notePriorityOptions}
            />
            <span className="tasks-map-kanban__card-title" title={cardTitle}>
              {cardTitle}
            </span>
            <button
              className="tasks-map-kanban__open-button"
              type="button"
              draggable={false}
              onClick={(event) => handleOpenNoteClick(event, task)}
              onAuxClick={(event) => handleOpenNoteAuxClick(event, task)}
              onMouseDown={(event) => event.stopPropagation()}
              onDragStart={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              disabled={!canOpenNote}
              aria-label={
                canOpenNote
                  ? t("kanban.open_note")
                  : t("kanban.note_unavailable")
              }
              title={
                canOpenNote
                  ? t("kanban.open_note")
                  : t("kanban.note_unavailable")
              }
            >
              <ArrowUpRight size={15} />
            </button>
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
              <Crosshair size={15} />
            </button>
          </div>
          {((showProjectMeta && projectLabels.length > 0) || task.dueDate) && (
            <div
              className={`tasks-map-kanban__card-meta${
                preferences.showCardStatus
                  ? ""
                  : " tasks-map-kanban__card-meta--without-status"
              }`}
            >
              {showProjectMeta && projectLabels.length > 0 && (
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
    },
    [
      draggedTaskId,
      app,
      focusOptions,
      handleCardDoubleClick,
      handleFocus,
      handleOpenNoteAuxClick,
      handleOpenNoteClick,
      handleTaskDragEnd,
      handleTaskDragStart,
      notePriorityOptions,
      onTaskStatusChange,
      preferences.cardTitleSource,
      preferences.groupByProject,
      preferences.showCardStatus,
      trackVaultWrite,
    ]
  );

  return (
    <div className="tasks-map-kanban">
      <div className="tasks-map-kanban__header">
        <span className="tasks-map-kanban__title">{t("kanban.title")}</span>
        <span className="tasks-map-kanban__total">{tasks.length}</span>
        <button
          className="tasks-map-kanban__header-button"
          onClick={handleOpenSettings}
          aria-label={t("kanban.display_options")}
          title={t("kanban.display_options")}
        >
          <Settings2 size={16} />
        </button>
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
          const isColumnDragging = draggedColumnId === column.status.id;
          const dropPosition =
            columnDropTarget?.statusId === column.status.id
              ? columnDropTarget.position
              : null;
          return (
            <section
              key={column.status.id}
              className={`tasks-map-kanban__column${
                isDragOver ? " tasks-map-kanban__column--drag-over" : ""
              }${
                isColumnDragging ? " tasks-map-kanban__column--dragging" : ""
              }${
                dropPosition
                  ? ` tasks-map-kanban__column--drop-${dropPosition}`
                  : ""
              }`}
              onDragOver={(event) => handleDragOver(event, column.status.id)}
              onDrop={(event) => void handleDrop(event, column.status.id)}
            >
              <div className="tasks-map-kanban__column-header">
                <button
                  className="tasks-map-kanban__column-grip"
                  draggable
                  onDragStart={(event) =>
                    handleColumnDragStart(event, column.status.id)
                  }
                  onDragEnd={handleColumnDragEnd}
                  aria-label={t("kanban.move_column", {
                    column: column.status.label,
                  })}
                  title={t("kanban.move_column", {
                    column: column.status.label,
                  })}
                >
                  <GripVertical size={14} />
                </button>
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
                {column.sections.map((section) => (
                  <div key={section.key} className="tasks-map-kanban__section">
                    {section.kind !== "flat" && (
                      <div className="tasks-map-kanban__section-header">
                        <span className="tasks-map-kanban__section-label">
                          {getSectionLabel(section)}
                        </span>
                        <span className="tasks-map-kanban__section-count">
                          {section.rows.length}
                        </span>
                      </div>
                    )}
                    <div className="tasks-map-kanban__section-cards">
                      {section.rows.map((row) => renderCard(row, section))}
                    </div>
                  </div>
                ))}
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
