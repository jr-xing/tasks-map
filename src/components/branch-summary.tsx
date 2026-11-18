import React, { useCallback } from "react";
import { BaseTask } from "src/types/base-task";
import type { BranchSummary, TaskLevel } from "src/lib/branch-model";
import { t } from "../i18n";

interface BranchSummaryViewProps {
  level: TaskLevel;
  summary: BranchSummary;
  // eslint-disable-next-line no-unused-vars -- callback parameter convention
  onOpenTask?: (taskPath: string) => void;
}

function countsLine(level: TaskLevel, summary: BranchSummary): string {
  const parts: string[] = [];
  if (level !== "branch" && summary.subBranches > 0) {
    parts.push(t("branch.branches", { count: summary.subBranches }));
  }
  if (level === "project") {
    parts.push(
      t("branch.open", {
        count: summary.active + summary.open + summary.waiting,
      })
    );
    return parts.join(" · ");
  }
  if (summary.active > 0) {
    parts.push(t("branch.active", { count: summary.active }));
  }
  parts.push(t("branch.open", { count: summary.open }));
  if (summary.waiting > 0) {
    parts.push(t("branch.waiting", { count: summary.waiting }));
  }
  if (summary.closed > 0) {
    parts.push(t("branch.done", { count: summary.closed }));
  }
  return parts.join(" · ");
}

/** Counts, next step and waiting/related chips on a branch-level card. */
export function BranchSummaryView({
  level,
  summary,
  onOpenTask,
}: BranchSummaryViewProps) {
  const target = summary.next ?? summary.suggested;
  const handleOpen = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, task: BaseTask) => {
      event.preventDefault();
      event.stopPropagation();
      if (task.link) onOpenTask?.(task.link);
    },
    [onOpenTask]
  );
  const stop = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  return (
    <div className="tasks-map-branch-summary" onDoubleClick={stop}>
      <div className="tasks-map-branch-summary-counts">
        {countsLine(level, summary)}
      </div>
      {level !== "project" &&
        (target ? (
          <button
            type="button"
            className={[
              "tasks-map-branch-summary-next nodrag",
              summary.next
                ? "tasks-map-branch-summary-next--set"
                : "tasks-map-branch-summary-next--suggested",
            ].join(" ")}
            title={
              summary.next
                ? t("branch.next_title", { task: target.summary })
                : t("branch.suggested_title", { task: target.summary })
            }
            onClick={(event) => handleOpen(event, target)}
          >
            <span className="tasks-map-branch-summary-next-label">
              {summary.next ? t("branch.next") : t("branch.suggested")}
            </span>
            <span className="tasks-map-branch-summary-next-text">
              {target.summary}
            </span>
          </button>
        ) : (
          level === "branch" &&
          summary.active + summary.open === 0 &&
          summary.waiting === 0 && (
            <div className="tasks-map-branch-summary-next tasks-map-branch-summary-next--empty">
              {t("branch.no_open_tasks")}
            </div>
          )
        ))}
      {level !== "project" &&
        (summary.waitingOn.length > 0 || summary.related.length > 0) && (
          <div className="tasks-map-branch-summary-chips">
            {summary.waitingOn.length > 0 && (
              <span className="tasks-map-branch-chip tasks-map-branch-chip--waiting">
                {t("branch.waiting_on", {
                  names: summary.waitingOn.join(", "),
                })}
              </span>
            )}
            {summary.related.length > 0 && (
              <span
                className="tasks-map-branch-chip tasks-map-branch-chip--related"
                title={summary.related.map((task) => task.summary).join("\n")}
              >
                {t("branch.related", { count: summary.related.length })}
              </span>
            )}
          </div>
        )}
    </div>
  );
}
