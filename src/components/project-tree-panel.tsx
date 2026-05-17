import React, { useState, useMemo, useCallback } from "react";
import { ChevronDown, ChevronUp, ChevronRight, X } from "lucide-react";
import { BaseTask } from "src/types/task";
import { t } from "../i18n";

interface ProjectTreePanelProps {
  tasks: BaseTask[];
  // eslint-disable-next-line no-unused-vars -- callback parameter convention
  onTaskClick: (taskId: string) => void;
}

interface TreeNode {
  task: BaseTask;
  children: TreeNode[];
}

const labelOf = (task: BaseTask): string => task.summary || task.text;

/**
 * Builds a project -> task -> subtask forest from a flat task list.
 *
 * A task's `incomingLinks` are the tasks it depends on (its parents), so the
 * children of X are the tasks whose `incomingLinks` include X. Roots are tasks
 * no visible task points at. A task may have several parents (a DAG): in that
 * case it appears under each parent. Roots with no descendants are dropped so
 * the panel shows only genuinely structured tasks, not every isolated node.
 */
function buildTree(tasks: BaseTask[]): TreeNode[] {
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
function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
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

  return nodes
    .map(recurse)
    .filter((node): node is TreeNode => node !== null);
}

export default function ProjectTreePanel({
  tasks,
  onTaskClick,
}: ProjectTreePanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const roots = useMemo(() => buildTree(tasks), [tasks]);

  const isFiltering = filterQuery.trim().length > 0;

  const visibleRoots = useMemo(
    () => (isFiltering ? filterTree(roots, filterQuery.trim()) : roots),
    [roots, filterQuery, isFiltering]
  );

  const toggleCollapsed = useCallback(() => setIsCollapsed((p) => !p), []);
  const clearFilter = useCallback(() => setFilterQuery(""), []);

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
    keyPrefix: string
  ): React.ReactNode =>
    nodes.map((node) => {
      const key = `${keyPrefix}/${node.task.id}`;
      const hasChildren = node.children.length > 0;
      // While filtering, every surviving branch is shown fully expanded.
      const expanded = isFiltering || !collapsedIds.has(node.task.id);
      return (
        <React.Fragment key={key}>
          <div
            className="tasks-map-tree-panel__row"
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
              onClick={() => onTaskClick(node.task.id)}
              title={labelOf(node.task)}
            >
              {labelOf(node.task)}
            </span>
          </div>
          {hasChildren &&
            expanded &&
            renderRows(node.children, depth + 1, key)}
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
            isCollapsed
              ? t("project_tree.expand")
              : t("project_tree.collapse")
          }
          title={
            isCollapsed
              ? t("project_tree.expand")
              : t("project_tree.collapse")
          }
        >
          {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>

      {!isCollapsed && (
        <>
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
              renderRows(visibleRoots, 0, "root")
            )}
          </div>
        </>
      )}
    </div>
  );
}
