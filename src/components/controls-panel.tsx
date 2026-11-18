import React, { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { MapLayoutOptions } from "src/lib/map-layout-options";
import type { TaskGroupArrangement } from "src/types/settings";
import { t } from "../i18n";

interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (_value: T) => void;
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <div className="tasks-map-filter-item tasks-map-segmented">
      <span className="tasks-map-segmented__label">{label}</span>
      <div className="tasks-map-segmented__options" role="radiogroup">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            className={`tasks-map-segmented__option${
              option.value === value
                ? " tasks-map-segmented__option--active"
                : ""
            }`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ControlsPanelProps {
  showTags: boolean;
  hideTags: boolean;
  setHideTags: () => void;
  reloadTasks: () => void;
  showUnlinkedPanel: boolean;
  hideUnlinkedTasks: boolean;
  setHideUnlinkedTasks: (_val: boolean) => void;
  showGroupByProject: boolean;
  groupByProject: boolean;
  setGroupByProject: (_val: boolean) => void;
  arrangeMode: boolean;
  setArrangeMode: (_val: boolean) => void;
  /** This tab's layout; omitted where the layout is fixed (e.g. embeds). */
  layout?: MapLayoutOptions;
  onLayoutChange?: (_patch: Partial<MapLayoutOptions>) => void;
  /** How task group zones sit; omitted when the map shows no groups. */
  groupArrangement?: TaskGroupArrangement;
  onGroupArrangementChange?: (_value: TaskGroupArrangement) => void;
  /** Fold every branch to its summary card; omitted when there are none. */
  onFoldToBranches?: () => void;
  /** Unfold every folded card; omitted when nothing is folded. */
  onUnfoldAll?: () => void;
}

export default function ControlsPanel({
  showTags,
  hideTags,
  setHideTags,
  reloadTasks,
  showUnlinkedPanel,
  hideUnlinkedTasks,
  setHideUnlinkedTasks,
  showGroupByProject,
  groupByProject,
  setGroupByProject,
  arrangeMode,
  setArrangeMode,
  layout,
  onLayoutChange,
  groupArrangement,
  onGroupArrangementChange,
  onFoldToBranches,
  onUnfoldAll,
}: ControlsPanelProps) {
  const [isMinimized, setIsMinimized] = useState(false);

  const toggleMinimized = () => {
    setIsMinimized((prev) => !prev);
  };

  return (
    <div
      className={`tasks-map-filter-panel ${isMinimized ? "tasks-map-filter-panel--minimized" : ""}`}
    >
      <div className="tasks-map-filter-panel__header">
        <span className="tasks-map-filter-panel__title">
          {t("controls.title")}
        </span>
        <button
          className="tasks-map-filter-panel__header-icon"
          onClick={toggleMinimized}
          aria-label={
            isMinimized ? t("controls.expand") : t("controls.minimize")
          }
          title={isMinimized ? t("controls.expand") : t("controls.minimize")}
        >
          {isMinimized ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>

      {!isMinimized && (
        <div className="tasks-map-filter-panel__content">
          {layout && onLayoutChange && (
            <div className="tasks-map-filter-section">
              <SegmentedControl
                label={t("controls.layout")}
                value={layout.layoutMode}
                options={[
                  { value: "graph", label: t("controls.layout_graph") },
                  { value: "tree", label: t("controls.layout_tree") },
                  {
                    value: "branches",
                    label: t("controls.layout_branches"),
                  },
                ]}
                onChange={(layoutMode) => onLayoutChange({ layoutMode })}
              />
              <SegmentedControl
                label={t("controls.direction")}
                value={layout.layoutDirection}
                options={[
                  {
                    value: "Horizontal",
                    label: t("settings.layout_horizontal"),
                  },
                  { value: "Vertical", label: t("settings.layout_vertical") },
                ]}
                onChange={(layoutDirection) =>
                  onLayoutChange({ layoutDirection })
                }
              />
              {groupArrangement && onGroupArrangementChange && (
                <SegmentedControl
                  label={t("controls.task_groups")}
                  value={groupArrangement}
                  options={[
                    { value: "rows", label: t("controls.groups_rows") },
                    { value: "columns", label: t("controls.groups_columns") },
                    { value: "grid", label: t("controls.groups_grid") },
                  ]}
                  onChange={onGroupArrangementChange}
                />
              )}
            </div>
          )}
          <div className="tasks-map-filter-section">
            {showUnlinkedPanel && (
              <div className="tasks-map-filter-item">
                <label className="tasks-map-gui-overlay-checkbox-label">
                  <input
                    type="checkbox"
                    checked={hideUnlinkedTasks}
                    onChange={(e) => setHideUnlinkedTasks(e.target.checked)}
                    className="tasks-map-gui-overlay-checkbox-input"
                  />
                  <span className="tasks-map-gui-overlay-checkbox-text">
                    {t("filters.hide_unlinked_tasks")}
                  </span>
                </label>
              </div>
            )}

            {showTags && (
              <div className="tasks-map-filter-item">
                <label className="tasks-map-gui-overlay-checkbox-label">
                  <input
                    type="checkbox"
                    checked={hideTags}
                    onChange={setHideTags}
                    className="tasks-map-gui-overlay-checkbox-input"
                  />
                  <span className="tasks-map-gui-overlay-checkbox-text">
                    {t("filters.hide_tags_on_nodes")}
                  </span>
                </label>
              </div>
            )}

            {showGroupByProject && (
              <div className="tasks-map-filter-item">
                <label className="tasks-map-gui-overlay-checkbox-label">
                  <input
                    type="checkbox"
                    checked={groupByProject}
                    onChange={(e) => setGroupByProject(e.target.checked)}
                    className="tasks-map-gui-overlay-checkbox-input"
                  />
                  <span className="tasks-map-gui-overlay-checkbox-text">
                    {t("controls.group_by_project")}
                  </span>
                </label>
              </div>
            )}

            <div className="tasks-map-filter-item">
              <label className="tasks-map-gui-overlay-checkbox-label">
                <input
                  type="checkbox"
                  checked={arrangeMode}
                  onChange={(e) => setArrangeMode(e.target.checked)}
                  className="tasks-map-gui-overlay-checkbox-input"
                />
                <span className="tasks-map-gui-overlay-checkbox-text">
                  {t("controls.arrange_mode")}
                </span>
              </label>
            </div>
          </div>

          {(onFoldToBranches || onUnfoldAll) && (
            <div className="tasks-map-filter-actions tasks-map-fold-actions">
              {onFoldToBranches && (
                <button
                  type="button"
                  onClick={onFoldToBranches}
                  className="tasks-map-gui-overlay-reload-button"
                  title={t("controls.fold_to_branches_desc")}
                >
                  {t("controls.fold_to_branches")}
                </button>
              )}
              {onUnfoldAll && (
                <button
                  type="button"
                  onClick={onUnfoldAll}
                  className="tasks-map-gui-overlay-reload-button"
                >
                  {t("controls.unfold_all")}
                </button>
              )}
            </div>
          )}

          <div className="tasks-map-filter-actions">
            <button
              onClick={reloadTasks}
              className="tasks-map-gui-overlay-reload-button"
            >
              {t("filters.reload_tasks")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
