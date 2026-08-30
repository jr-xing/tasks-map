import React, { useCallback, useMemo } from "react";
import {
  TASKS_PLUGIN_PRIORITY_OPTIONS,
  TaskPriorityConfig,
  getPriorityByValue,
} from "src/lib/priority-config";
import { buildTaskTriageGroups, getTaskTriageLabel } from "src/lib/task-triage";
import { TaskStatusConfig } from "src/lib/status-config";
import { BaseTask, TaskStatus } from "src/types/task";
import { ProjectDot } from "./project-dot";
import { TaskStatusToggle } from "./task-status";
import { t } from "../i18n";

interface TaskListPanelProps {
  tasks: BaseTask[];
  statuses: TaskStatusConfig[];
  notePriorityOptions: TaskPriorityConfig[];
  // eslint-disable-next-line no-unused-vars -- callback parameter convention
  onTaskClick: (taskId: string) => void;
  // eslint-disable-next-line no-unused-vars -- callback parameter convention
  onTaskStatusChange: (taskId: string, status: TaskStatus) => void;
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
      className="tasks-map-task-list__priority"
      title={t("task_node.priority", { priority: priority.label })}
      aria-label={t("task_node.priority", { priority: priority.label })}
    />
  );
}

export default function TaskListPanel({
  tasks,
  statuses,
  notePriorityOptions,
  onTaskClick,
  onTaskStatusChange,
}: TaskListPanelProps) {
  const groups = useMemo(
    () => buildTaskTriageGroups(tasks, statuses, notePriorityOptions),
    [tasks, statuses, notePriorityOptions]
  );

  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, taskId: string) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onTaskClick(taskId);
    },
    [onTaskClick]
  );

  return (
    <div className="tasks-map-task-list">
      <div className="tasks-map-task-list__header">
        <span className="tasks-map-task-list__title">
          {t("task_list.title")}
        </span>
        <span className="tasks-map-task-list__total">{tasks.length}</span>
      </div>

      <div className="tasks-map-task-list__groups">
        {groups.length === 0 ? (
          <div className="tasks-map-task-list__empty">
            {t("task_list.empty")}
          </div>
        ) : (
          groups.map((group) => (
            <section
              key={group.status.id}
              className="tasks-map-task-list__group"
            >
              <div className="tasks-map-task-list__group-header">
                <span
                  className="tasks-map-task-list__status-dot"
                  ref={(element) => {
                    element?.style.setProperty(
                      "--tasks-map-status-color",
                      group.status.color
                    );
                  }}
                />
                <span className="tasks-map-task-list__group-label">
                  {group.status.label}
                </span>
                <span className="tasks-map-task-list__group-count">
                  {group.tasks.length}
                </span>
              </div>

              {group.tasks.map((task) => (
                <div
                  key={task.id}
                  className="tasks-map-task-list__row"
                  role="button"
                  tabIndex={0}
                  title={getTaskTriageLabel(task)}
                  onClick={() => onTaskClick(task.id)}
                  onKeyDown={(event) => handleRowKeyDown(event, task.id)}
                >
                  <TaskStatusToggle
                    status={task.status}
                    task={task}
                    onStatusChange={(status) =>
                      onTaskStatusChange(task.id, status)
                    }
                  />
                  <PriorityAccent
                    task={task}
                    notePriorityOptions={notePriorityOptions}
                  />
                  <span className="tasks-map-task-list__label">
                    {getTaskTriageLabel(task)}
                  </span>
                  {task.projects.length > 0 && (
                    <span className="tasks-map-task-list__projects">
                      {task.projects.map((project, index) => (
                        <ProjectDot
                          key={`${task.id}-${project}`}
                          project={project}
                          index={index}
                        />
                      ))}
                    </span>
                  )}
                  {task.dueDate && (
                    <span
                      className="tasks-map-task-list__due"
                      title={t("task_list.due", { date: task.dueDate })}
                    >
                      {task.dueDate}
                    </span>
                  )}
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
