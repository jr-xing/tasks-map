import React, { useCallback, useContext } from "react";
import { Handle, Position } from "reactflow";
import { Flag, Hourglass, Star } from "lucide-react";
import { TaskNodeData, TaskStatus } from "src/types/task";
import { StatusConfigContext } from "src/contexts/context";
import {
  BranchSummary,
  getStatusCategory,
  TaskLevel,
} from "src/lib/branch-model";
import { getStatusById, TaskStatusConfig } from "src/lib/status-config";
import {
  getPriorityByValue,
  TASKS_PLUGIN_PRIORITY_OPTIONS,
} from "src/lib/priority-config";
import { getMinimalNodeDimensions } from "src/lib/layout/dimensions";
import {
  formatShortDate,
  getDueState,
  hasOpenWork,
  isImportantPriority,
} from "src/lib/minimal-card";
import { t } from "../i18n";

type CountKind = "branches" | "active" | "open" | "waiting" | "done" | "none";

interface CountItem {
  kind: CountKind;
  label: string;
}

function branchCountItems(
  level: TaskLevel,
  summary: BranchSummary
): CountItem[] {
  const items: CountItem[] = [];
  if (level !== "branch" && summary.subBranches > 0) {
    items.push({
      kind: "branches",
      label: t("branch.branches", { count: summary.subBranches }),
    });
  }
  if (!hasOpenWork(summary)) {
    items.push(
      summary.closed > 0
        ? { kind: "done", label: t("branch.done", { count: summary.closed }) }
        : { kind: "none", label: t("branch.no_open_tasks") }
    );
    return items;
  }
  if (summary.active > 0) {
    items.push({
      kind: "active",
      label: t("branch.active", { count: summary.active }),
    });
  }
  items.push({
    kind: "open",
    label: t("branch.open", { count: summary.open }),
  });
  if (summary.waiting > 0) {
    items.push({
      kind: "waiting",
      label: t("branch.waiting", { count: summary.waiting }),
    });
  }
  return items;
}

/** First configured status whose category matches, for count colours. */
function categoryColor(
  statuses: TaskStatusConfig[],
  category: "active" | "closed"
): string | undefined {
  return statuses.find(
    (status) => getStatusCategory(status.id, statuses) === category
  )?.color;
}

interface FoldBadgeProps {
  data: TaskNodeData;
}

/** "+N" while folded, "−" while open; toggles the node's children. */
function FoldBadge({ data }: FoldBadgeProps) {
  const { task, childrenCollapsed, foldedChildrenCount = 0 } = data;
  const onToggle = data.onToggleChildren;
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onToggle?.(task.id);
    },
    [onToggle, task.id]
  );
  const stop = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);
  if (!data.hasVisibleChildren) return null;
  const label = t(
    childrenCollapsed
      ? "task_node.expand_children_count"
      : "task_node.collapse_children",
    { count: foldedChildrenCount }
  );
  return (
    <button
      type="button"
      className={[
        "tasks-map-mcard-fold nodrag nopan",
        data.layoutDirection === "Vertical" && "tasks-map-mcard-fold--bottom",
      ]
        .filter(Boolean)
        .join(" ")}
      title={label}
      aria-label={label}
      aria-expanded={!childrenCollapsed}
      onClick={handleClick}
      onDoubleClick={stop}
    >
      {childrenCollapsed ? `+${foldedChildrenCount}` : "−"}
    </button>
  );
}

interface IndicatorsProps {
  data: TaskNodeData;
  priority: string;
  starred: boolean;
  showDue: boolean;
}

/** The few markers a card keeps at rest: star, priority, due, waiting. */
function Indicators({ data, priority, starred, showDue }: IndicatorsProps) {
  const { task, showPriorities = true, priorityOptions = [] } = data;
  const related = data.branchSummary?.related ?? [];
  const dueState = showDue ? getDueState(task.dueDate) : null;
  const importantPriority =
    showPriorities && isImportantPriority(priority, priorityOptions);
  const priorityLabel = getPriorityByValue(
    priority,
    priorityOptions.length > 0 ? priorityOptions : TASKS_PLUGIN_PRIORITY_OPTIONS
  ).label;

  return (
    <span className="tasks-map-mcard-indicators">
      {data.isNextStep && (
        <span className="tasks-map-mcard-tag">{t("branch.next")}</span>
      )}
      {importantPriority && (
        <span
          className="tasks-map-mcard-indicator tasks-map-mcard-indicator--priority"
          title={t("minimal.priority", { priority: priorityLabel })}
        >
          <Flag size={12} fill="currentColor" />
        </span>
      )}
      {dueState && task.dueDate && (
        <span
          className={`tasks-map-mcard-due tasks-map-mcard-due--${dueState}`}
          title={t(`minimal.due_${dueState}`, { date: task.dueDate })}
        >
          {formatShortDate(task.dueDate)}
        </span>
      )}
      {task.waitingOn && (
        <span
          className="tasks-map-mcard-indicator tasks-map-mcard-indicator--waiting"
          title={t("branch.waiting_on", { names: task.waitingOn })}
        >
          <Hourglass size={12} />
        </span>
      )}
      {related.length > 0 && (
        <span
          className="tasks-map-mcard-related"
          title={related.map((item) => item.summary).join("\n")}
        >
          ↗{related.length}
        </span>
      )}
      {starred && (
        <span
          className="tasks-map-mcard-indicator tasks-map-mcard-indicator--star"
          title={t("minimal.starred")}
        >
          <Star size={12} fill="currentColor" />
        </span>
      )}
    </span>
  );
}

interface NextLineProps {
  summary: BranchSummary;
  onEditTask?: TaskNodeData["onEditTask"];
}

/** "▶ next step" on a branch card, or a quiet hint when none is set. */
function NextLine({ summary, onEditTask }: NextLineProps) {
  const next = summary.next;
  const openNext = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (next?.link) onEditTask?.(next.link);
    },
    [next, onEditTask]
  );
  if (!next) {
    return (
      <div
        className="tasks-map-mcard-next tasks-map-mcard-next--none"
        title={
          summary.suggested
            ? t("branch.suggested_title", { task: summary.suggested.summary })
            : undefined
        }
      >
        <span aria-hidden="true">▶</span>
        <span className="tasks-map-mcard-next-text">{t("branch.no_next")}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="tasks-map-mcard-controls tasks-map-mcard-next nodrag"
      title={t("branch.next_title", { task: next.summary })}
      onClick={openNext}
    >
      <span aria-hidden="true">▶</span>
      <span className="tasks-map-mcard-next-text">
        {next.noteFrontmatterTitle || next.summary}
      </span>
    </button>
  );
}

export interface MinimalTaskCardProps {
  data: TaskNodeData;
  selected: boolean;
  revealed: boolean;
  status: TaskStatus;
  priority: string;
  starred: boolean;
  summaryRef: React.RefObject<HTMLSpanElement>;
  /** The clickable status dot. */
  statusToggle: React.ReactNode;
  /** Buttons shown on hover and selection. */
  toolbar: React.ReactNode;
  /** Tags, quick update and attachments, shown while selected. */
  details: React.ReactNode;
  onMouseEnter: React.MouseEventHandler<HTMLDivElement>;
  onMouseLeave: React.MouseEventHandler<HTMLDivElement>;
  onFocus: React.FocusEventHandler<HTMLDivElement>;
  onBlur: React.FocusEventHandler<HTMLDivElement>;
}

/**
 * Flat card that keeps only colours and key indicators at rest. Projects,
 * groups and branches are summary cards; plain tasks are slim rows.
 */
export function MinimalTaskCard({
  data,
  selected,
  revealed,
  status,
  priority,
  starred,
  summaryRef,
  statusToggle,
  toolbar,
  details,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
}: MinimalTaskCardProps) {
  const statuses = useContext(StatusConfigContext);
  const { task, branchSummary, onEditTask, priorityOptions = [] } = data;
  const level = data.level ?? "task";
  const variant = level === "task" ? "row" : "card";
  const isVertical = data.layoutDirection === "Vertical";
  const dimensions = getMinimalNodeDimensions(data);
  const statusColor = getStatusById(status, statuses).color;
  const priorityColor = getPriorityByValue(
    priority,
    priorityOptions.length > 0 ? priorityOptions : TASKS_PLUGIN_PRIORITY_OPTIONS
  ).color;
  const activeColor = categoryColor(statuses, "active");
  const doneColor = categoryColor(statuses, "closed");
  const closed = getStatusCategory(status, statuses) === "closed";

  const setShellVars = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      element.style.setProperty(
        "--tasks-map-mcard-width",
        `${dimensions.width}px`
      );
      element.style.setProperty(
        "--tasks-map-mcard-height",
        `${dimensions.height}px`
      );
    },
    [dimensions.width, dimensions.height]
  );
  const setCardVars = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      element.style.setProperty("--tasks-map-status-color", statusColor);
      element.style.setProperty("--tasks-map-priority-color", priorityColor);
      if (activeColor) {
        element.style.setProperty("--tasks-map-mcard-active", activeColor);
      }
      if (doneColor) {
        element.style.setProperty("--tasks-map-mcard-done", doneColor);
      }
    },
    [statusColor, priorityColor, activeColor, doneColor]
  );

  const statusDot = (
    <span className="tasks-map-mcard-controls tasks-map-mcard-status">
      {statusToggle}
    </span>
  );
  const title = (
    <span className="tasks-map-mcard-title" title={task.summary}>
      <span ref={summaryRef} className="tasks-map-task-node-summary" />
    </span>
  );

  return (
    <div
      ref={setShellVars}
      className={[
        "tasks-map-task-node-shell",
        "tasks-map-task-node-shell--minimal",
        revealed && "tasks-map-task-node-shell--revealed",
        selected && "tasks-map-task-node-shell--selected",
      ]
        .filter(Boolean)
        .join(" ")}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div
        ref={setCardVars}
        className={[
          "tasks-map-mcard",
          `tasks-map-mcard--${variant}`,
          `tasks-map-mcard--${level}`,
          closed && "tasks-map-mcard--closed",
          data.isNextStep && "tasks-map-mcard--next",
          selected && "tasks-map-mcard--selected",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <Handle
          type="target"
          position={isVertical ? Position.Top : Position.Left}
          className="tasks-map-mcard-handle"
        />
        <Handle
          type="source"
          position={isVertical ? Position.Bottom : Position.Right}
          className="tasks-map-mcard-handle"
        />
        {variant === "row" ? (
          <>
            {statusDot}
            {title}
            <Indicators
              data={data}
              priority={priority}
              starred={starred}
              showDue
            />
          </>
        ) : (
          <>
            <div className="tasks-map-mcard-title-line">
              {statusDot}
              {title}
              <Indicators
                data={data}
                priority={priority}
                starred={starred}
                showDue={level !== "project"}
              />
            </div>
            {branchSummary && (
              <div
                className="tasks-map-mcard-counts"
                title={
                  branchSummary.waitingOn.length > 0
                    ? t("branch.waiting_on", {
                        names: branchSummary.waitingOn.join(", "),
                      })
                    : undefined
                }
              >
                {branchCountItems(level, branchSummary).map((item) => (
                  <span
                    key={item.kind}
                    className={`tasks-map-mcard-count tasks-map-mcard-count--${item.kind}`}
                  >
                    {item.label}
                  </span>
                ))}
              </div>
            )}
            {level === "project" && task.dueDate && (
              <div
                className={[
                  "tasks-map-mcard-meta",
                  getDueState(task.dueDate) &&
                    `tasks-map-mcard-meta--${getDueState(task.dueDate)}`,
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {t("branch.due", { date: task.dueDate })}
              </div>
            )}
            {level === "branch" &&
              branchSummary &&
              hasOpenWork(branchSummary) && (
                <NextLine summary={branchSummary} onEditTask={onEditTask} />
              )}
          </>
        )}
        {revealed && (
          <div className="tasks-map-mcard-controls tasks-map-mcard-toolbar nodrag nopan">
            {toolbar}
          </div>
        )}
        <FoldBadge data={data} />
      </div>
      {selected && details && (
        <div className="tasks-map-mcard-controls tasks-map-mcard-details nodrag nopan">
          {details}
        </div>
      )}
    </div>
  );
}
