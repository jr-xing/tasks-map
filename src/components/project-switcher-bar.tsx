import React, { useMemo, useState } from "react";
import Select, { SingleValue } from "react-select";
import { Layers } from "lucide-react";
import { obsidianSelectStyles } from "src/lib/select-styles";
import { t } from "../i18n";

export interface RootTaskOption {
  /** Task ID of the candidate root node. */
  id: string;
  /** Human-readable label (the task's summary). */
  label: string;
  /** Descendants in this node's subtree whose status is not finished. */
  notFinishedCount: number;
  /** Descendants in this node's subtree whose status is finished (done/canceled). */
  finishedCount: number;
}

interface ProjectSwitcherBarProps {
  /** Root nodes with no parent of their own — the projects. Pre-sorted. */
  projects: RootTaskOption[];
  /** Internal nodes that have both a parent and dependents. Pre-sorted. */
  subtasks: RootTaskOption[];
  /** Total number of loaded tasks (shown next to the "All projects" option). */
  totalCount: number;
  /** ID of the currently scoped root task, or `null` for the whole map. */
  selectedRootTask: string | null;
  /**
   * Option for the currently selected root when an active filter would
   * otherwise hide it from `projects`/`subtasks`. Kept reachable in the
   * dropdown so the selection remains visible.
   */
  selectedRootFallback?: RootTaskOption | null;
  // eslint-disable-next-line no-unused-vars -- prop callback parameter convention
  onSelectRootTask: (id: string | null) => void;
}

type OptionType = { value: string; label: string };

// Sentinel value for the "All projects" option; never a real task ID.
const ALL_VALUE = "__ALL_PROJECTS__";

/**
 * A slim toolbar at the top-left of the map for scoping the graph to a single
 * project. Single-select: picking a project node restricts the map to that
 * node and its subtree (everything that transitively depends on it).
 *
 * By default the dropdown lists only projects (root nodes). The checkbox opts
 * in tasks that themselves sit under a parent but still have sub-tasks.
 */
export default function ProjectSwitcherBar({
  projects,
  subtasks,
  totalCount,
  selectedRootTask,
  selectedRootFallback,
  onSelectRootTask,
}: ProjectSwitcherBarProps) {
  const [includeSubtasks, setIncludeSubtasks] = useState(false);

  const options = useMemo<OptionType[]>(() => {
    const allOption: OptionType = {
      value: ALL_VALUE,
      label: t("project_switcher.all_projects", { count: totalCount }),
    };
    const shown = includeSubtasks ? [...projects, ...subtasks] : [...projects];
    // Keep the active selection reachable even when it is a hidden subtask or
    // a project that the current status/tag/file filter would otherwise hide.
    if (
      selectedRootTask &&
      !shown.some((root) => root.id === selectedRootTask)
    ) {
      const hidden =
        subtasks.find((root) => root.id === selectedRootTask) ??
        (selectedRootFallback &&
        selectedRootFallback.id === selectedRootTask
          ? selectedRootFallback
          : null);
      if (hidden) shown.push(hidden);
    }
    const sorted = [...shown].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
    );
    return [
      allOption,
      ...sorted.map((root) => ({
        value: root.id,
        label: `${root.label} (${root.notFinishedCount} / ${root.finishedCount})`,
      })),
    ];
  }, [
    projects,
    subtasks,
    includeSubtasks,
    selectedRootTask,
    selectedRootFallback,
    totalCount,
  ]);

  const value = useMemo<OptionType>(() => {
    if (selectedRootTask === null) return options[0];
    return options.find((o) => o.value === selectedRootTask) ?? options[0];
  }, [selectedRootTask, options]);

  return (
    <div className="tasks-map-project-bar">
      <Layers
        size={14}
        className="tasks-map-project-bar__icon"
        aria-hidden="true"
      />
      <span className="tasks-map-project-bar__label">
        {t("project_switcher.label")}
      </span>
      <div className="tasks-map-project-bar__select">
        <Select<OptionType>
          options={options}
          value={value}
          onChange={(opt: SingleValue<OptionType>) =>
            onSelectRootTask(
              !opt || opt.value === ALL_VALUE ? null : opt.value
            )
          }
          isSearchable
          aria-label={t("project_switcher.label")}
          styles={obsidianSelectStyles<OptionType, false>()}
        />
      </div>
      {subtasks.length > 0 && (
        <label className="tasks-map-project-bar__checkbox">
          <input
            type="checkbox"
            checked={includeSubtasks}
            onChange={(e) => setIncludeSubtasks(e.target.checked)}
          />
          <span>{t("project_switcher.include_subtasks")}</span>
        </label>
      )}
    </div>
  );
}
