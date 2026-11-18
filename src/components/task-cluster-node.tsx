import React, { useCallback } from "react";
import { Handle, NodeProps, Position } from "reactflow";
import type { TaskClusterNodeData } from "src/lib/layout/branch-clusters";
import { t } from "../i18n";

function footerLabel(data: TaskClusterNodeData): string {
  if (data.expanded) return t("cluster.show_less");
  const parts: string[] = [];
  if (data.hiddenOpen > 0) {
    parts.push(t("cluster.more_open", { count: data.hiddenOpen }));
  }
  if (data.hiddenClosed > 0) {
    parts.push(t("cluster.more_done", { count: data.hiddenClosed }));
  }
  return parts.join(" · ");
}

/**
 * The frame around a cluster of sibling task rows (Branches layout, and
 * Graph layout with minimal cards):
 * the shared group value with counts on top and, when some rows are folded
 * away, a toggle at the bottom. The rows themselves are ordinary task nodes
 * placed on top of the frame.
 */
export default function TaskClusterNode({
  data,
}: NodeProps<TaskClusterNodeData>) {
  const { clusterId, counts, onToggle } = data;
  const isVertical = data.layoutDirection === "Vertical";

  const setFrameVars = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      element.style.setProperty("--tasks-map-cluster-width", `${data.width}px`);
      element.style.setProperty(
        "--tasks-map-cluster-height",
        `${data.height}px`
      );
      if (data.color) {
        element.style.setProperty("--tasks-map-cluster-color", data.color);
      } else {
        element.style.removeProperty("--tasks-map-cluster-color");
      }
    },
    [data.width, data.height, data.color]
  );

  const handleToggle = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onToggle?.(clusterId);
    },
    [onToggle, clusterId]
  );
  const stop = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);

  const countItems = [
    counts.active > 0 && {
      kind: "active",
      label: t("branch.active", { count: counts.active }),
    },
    counts.waiting > 0 && {
      kind: "waiting",
      label: t("branch.waiting", { count: counts.waiting }),
    },
    counts.open > 0 && {
      kind: "open",
      label: t("branch.open", { count: counts.open }),
    },
    counts.closed > 0 && {
      kind: "done",
      label: t("branch.done", { count: counts.closed }),
    },
  ].filter((item): item is { kind: string; label: string } => !!item);

  return (
    <div
      ref={setFrameVars}
      className={[
        "tasks-map-cluster",
        data.label ? "tasks-map-cluster--labelled" : "tasks-map-cluster--plain",
      ].join(" ")}
    >
      <Handle
        type="target"
        position={isVertical ? Position.Top : Position.Left}
        className="tasks-map-cluster-handle"
        isConnectable={false}
      />
      <div className="tasks-map-cluster-header">
        <span className="tasks-map-cluster-label">
          {data.label || t("cluster.other")}
        </span>
        <span className="tasks-map-cluster-counts">
          {countItems.map((item) => (
            <span
              key={item.kind}
              className={`tasks-map-mcard-count--${item.kind}`}
            >
              {item.label}
            </span>
          ))}
        </span>
      </div>
      {data.collapsible && (
        <button
          type="button"
          className="tasks-map-cluster-toggle nodrag nopan"
          aria-expanded={data.expanded}
          onClick={handleToggle}
          onDoubleClick={stop}
        >
          {footerLabel(data)}
        </button>
      )}
    </div>
  );
}

/**
 * The block holding one parent's clusters in the Graph layout. It draws
 * nothing: it only gives its clusters and rows a shared parent to move with.
 */
export function TaskClusterBlockNode() {
  return null;
}
