import React, { useState, useMemo, useCallback } from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Crosshair,
  X,
} from "lucide-react";
import { BaseTask } from "src/types/task";
import { t } from "../i18n";

interface ProjectTreePanelProps {
  tasks: BaseTask[];
  selectedRootTask: string | null;
  selectedRootLabel: string | null;
  onClearFocus: () => void;
  // eslint-disable-next-line no-unused-vars -- callback parameter convention
  onTaskClick: (taskId: string, rootTaskId: string) => void;
  // eslint-disable-next-line no-unused-vars -- callback parameter convention
  onTaskFocus: (taskId: string) => void;
}

export interface TreeNode {
  task: BaseTask;
  children: TreeNode[];
}

const labelOf = (task: BaseTask): string => task.summary || task.text;

export function getTreePathRootId(pathTaskIds: string[]): string | null {
  return pathTaskIds[0] ?? null;
}

export function getProjectTreeDepth(nodes: TreeNode[]): number {
  if (nodes.length === 0) return 0;
  return Math.max(
    ...nodes.map((node) => 1 + getProjectTreeDepth(node.children))
  );
}

/**
 * Builds a project -> task -> subtask forest from a flat task list.
 *
 * A task's `incomingLinks` are the tasks it depends on (its parents), so the
 * children of X are the tasks whose `incomingLinks` include X. Roots are tasks
 * no visible task points at. A task may have several parents (a DAG): in that
 * case it appears under each parent. Roots with no descendants are dropped so
 * the panel shows only genuinely structured tasks, not every isolated node.
 */
export function buildProjectTree(tasks: BaseTask[]): TreeNode[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const childrenOf = new Map<string, BaseTask[]>();
  const hasParent = new Set<string>();

  for (const task of tasks) {
    for (const parentId of task.incomingLinks) {
      if (!byId.has(parentId)) continue;
      hasParent.add(task.id);
      const list = childrenOf.get(parentId) ?? [];
      list.push(task);
      childrenOf.set(parentId, list);
    }
  }

  const sortTasks = (arr: BaseTask[]): BaseTask[] =>
    [...arr].sort((a, b) =>
      labelOf(a).localeCompare(labelOf(b), undefined, { sensitivity: "base" })
    );

  // `path` carries the ancestors of the current node so a dependency cycle
  // cannot make the recursion loop forever.
  const build = (task: BaseTask, path: Set<string>): TreeNode => {
    const children: TreeNode[] = [];
    for (const child of sortTasks(childrenOf.get(task.id) ?? [])) {
      if (path.has(child.id)) continue;
      children.push(build(child, new Set(path).add(child.id)));
    }
    return { task, children };
  };

  return sortTasks(tasks.filter((task) => !hasParent.has(task.id)))
    .map((root) => build(root, new Set([root.id])))
    .filter((node) => node.children.length > 0);
}

/** Prunes the forest to branches that contain a node matching the query. */
export function filterProjectTree(
  nodes: TreeNode[],
  query: string
): TreeNode[] {
  const lower = query.toLowerCase();
  const matches = (task: BaseTask): boolean =>
    labelOf(task).toLowerCase().includes(lower) ||
    task.tags.some((tag) => tag.toLowerCase().includes(lower));

  const recurse = (node: TreeNode): TreeNode | null => {
    const children = node.children
      .map(recurse)
      .filter((child): child is TreeNode => child !== null);
    if (matches(node.task) || children.length > 0) {
      return { task: node.task, children };
    }
    return null;
  };

  return nodes.map(recurse).filter((node): node is TreeNode => node !== null);
}

export default function ProjectTreePanel({
  tasks,
  selectedRootTask,
  selectedRootLabel,
  onClearFocus,
  onTaskClick,
  onTaskFocus,
}: ProjectTreePanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(
    () => new Set()
  );
  const [visibleLevel, setVisibleLevel] = useState(2);

  const roots = useMemo(() => buildProjectTree(tasks), [tasks]);
  const maxVisibleLevel = useMemo(() => getProjectTreeDepth(roots), [roots]);
  const effectiveVisibleLevel = Math.min(visibleLevel, maxVisibleLevel);

  const isFiltering = filterQuery.trim().length > 0;

  const visibleRoots = useMemo(
    () => (isFiltering ? filterProjectTree(roots, filterQuery.trim()) : roots),
    [roots, filterQuery, isFiltering]
  );

  const toggleCollapsed = useCallback(() => setIsCollapsed((p) => !p), []);
  const clearFilter = useCallback(() => setFilterQuery(""), []);
  const handleVisibleLevelChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setVisibleLevel(Number(e.target.value));
    },
    []
  );

  const toggleNode = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Nothing to show when no task has a parent/child relationship on the map.
  if (roots.length === 0) return null;

  const renderRows = (
    nodes: TreeNode[],
    depth: number,
    keyPrefix: string,
    pathTaskIds: string[]
  ): React.ReactNode =>
    nodes.map((node) => {
      const key = `${keyPrefix}/${node.task.id}`;
      const hasChildren = node.children.length > 0;
      const currentPathTaskIds = [...pathTaskIds, node.task.id];
      const branchRootTaskId =
        getTreePathRootId(currentPathTaskIds) ?? node.task.id;
      const isFocused = selectedRootTask === node.task.id;
      const withinVisibleLevel = depth + 1 < effectiveVisibleLevel;
      // While filtering, every surviving branch is shown fully expanded.
      const expanded =
        isFiltering ||
        (withinVisibleLevel && !collapsedIds.has(node.task.id));
      return (
        <React.Fragment key={key}>
          <div
            className={`tasks-map-tree-panel__row${
              isFocused ? " tasks-map-tree-panel__row--focused" : ""
            }${depth === 0 ? " tasks-map-tree-panel__row--project" : ""}`}
            ref={(el) => {
              if (el) el.style.paddingLeft = `${8 + depth * 14}px`;
            }}
          >
            {hasChildren ? (
              <button
                className="tasks-map-tree-panel__caret"
                onClick={() => toggleNode(node.task.id)}
                aria-label={
                  expanded
                    ? t("project_tree.collapse_node")
                    : t("project_tree.expand_node")
                }
              >
                {expanded ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
              </button>
            ) : (
              <span className="tasks-map-tree-panel__caret-spacer" />
            )}
            <span
              className="tasks-map-tree-panel__label"
              onClick={() => onTaskClick(node.task.id, branchRootTaskId)}
              title={labelOf(node.task)}
            >
              {labelOf(node.task)}
            </span>
            <button
              className="tasks-map-tree-panel__focus"
              onClick={() => onTaskFocus(node.task.id)}
              aria-label={t("project_tree.focus_node")}
              title={t("project_tree.focus_node")}
            >
              <Crosshair size={12} />
            </button>
          </div>
          {hasChildren &&
            expanded &&
            renderRows(node.children, depth + 1, key, currentPathTaskIds)}
        </React.Fragment>
      );
    });

  return (
    <div
      className={`tasks-map-tree-panel${isCollapsed ? " tasks-map-tree-panel--collapsed" : ""}`}
    >
      <div className="tasks-map-tree-panel__header">
        <span className="tasks-map-tree-panel__title">
          {t("project_tree.title")}
          {isCollapsed && (
            <span className="tasks-map-tree-panel__count">
              {" "}
              ({roots.length})
            </span>
          )}
        </span>
        <button
          className="tasks-map-tree-panel__header-icon"
          onClick={toggleCollapsed}
          aria-label={
            isCollapsed ? t("project_tree.expand") : t("project_tree.collapse")
          }
          title={
            isCollapsed ? t("project_tree.expand") : t("project_tree.collapse")
          }
        >
          {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>

      {!isCollapsed && (
        <>
          {selectedRootTask && selectedRootLabel && (
            <div className="tasks-map-tree-panel__focus-state">
              <span className="tasks-map-tree-panel__focus-label">
                {t("project_tree.focused", { task: selectedRootLabel })}
              </span>
              <button
                className="tasks-map-tree-panel__focus-clear"
                onClick={onClearFocus}
                aria-label={t("project_tree.clear_focus")}
                title={t("project_tree.clear_focus")}
              >
                <X size={12} />
              </button>
            </div>
          )}
          {maxVisibleLevel > 1 && (
            <div className="tasks-map-tree-panel__level-row">
              <span className="tasks-map-tree-panel__level-label">
                {t("project_tree.visible_level", {
                  level: effectiveVisibleLevel,
                })}
              </span>
              <input
                type="range"
                className="tasks-map-tree-panel__level-slider"
                min={1}
                max={maxVisibleLevel}
                step={1}
                value={effectiveVisibleLevel}
                onChange={handleVisibleLevelChange}
                aria-label={t("project_tree.visible_level_aria")}
              />
            </div>
          )}
          <div className="tasks-map-tree-panel__filter-row">
            <input
              type="text"
              className="tasks-map-tree-panel__filter-input"
              placeholder={t("project_tree.filter_placeholder")}
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
            />
            {filterQuery && (
              <button
                className="tasks-map-tree-panel__filter-clear"
                onClick={clearFilter}
                aria-label={t("search.clear")}
                title={t("search.clear")}
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="tasks-map-tree-panel__list">
            {visibleRoots.length === 0 ? (
              <div className="tasks-map-tree-panel__empty">
                {t("project_tree.no_results")}
              </div>
            ) : (
              renderRows(visibleRoots, 0, "root", [])
            )}
          </div>
        </>
      )}
    </div>
  );
}
