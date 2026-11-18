import type { Edge, Node } from "reactflow";
import type { TaskNode, TaskNodeData } from "src/types/task";
import { getStatusCategory, StatusCategory } from "src/lib/branch-model";
import { getDueState, getMinimalNodeTitle } from "src/lib/minimal-card";
import type { TaskStatusConfig } from "src/lib/status-config";
import { getTagPaletteColor, TagColorPalette } from "src/lib/tag-color-manager";
import {
  getMinimalNodeDimensions,
  MINIMAL_ROW_WIDTH,
  NodeDimensions,
} from "./dimensions";

/** A parent needs at least this many task rows before they are clustered. */
export const CLUSTER_MIN_ROWS = 5;
export const CLUSTER_NODE_TYPE = "taskCluster";
export const CLUSTER_PAD_X = 8;
export const CLUSTER_HEADER_HEIGHT = 28;
export const CLUSTER_FOOTER_HEIGHT = 28;
export const CLUSTER_PAD_BOTTOM = 8;
export const CLUSTER_ROW_GAP = 4;
/** Gap between the two row columns of a long cluster. */
export const CLUSTER_ROW_COLUMN_GAP = 8;
/** Gap between clusters in a block. */
export const CLUSTER_GAP = 10;
/** A cluster showing at least this many rows puts them in two columns. */
export const CLUSTER_WRAP_ROWS = 5;
/** A parent with at least this many clusters puts them in two columns. */
export const CLUSTER_GRID_MIN = 3;

export interface TaskClusterCounts {
  active: number;
  waiting: number;
  open: number;
  closed: number;
}

export interface TaskClusterNodeData {
  clusterId: string;
  /** The shared group value; empty for tasks without one. */
  label: string;
  /** The label's tag palette colour; unset for unlabelled clusters. */
  color?: string;
  counts: TaskClusterCounts;
  /** Open tasks folded into the footer. */
  hiddenOpen: number;
  /** Finished tasks folded into the footer. */
  hiddenClosed: number;
  expanded: boolean;
  /** Whether the footer toggle is shown at all. */
  collapsible: boolean;
  width: number;
  height: number;
  layoutDirection?: "Horizontal" | "Vertical";
  // eslint-disable-next-line no-unused-vars -- callback parameter convention
  onToggle?: (clusterId: string) => void;
}

export interface ClusterOptions {
  statuses: TaskStatusConfig[];
  /** Clusters the user opened to show every task. */
  expandedClusterIds?: ReadonlySet<string>;
  // eslint-disable-next-line no-unused-vars -- callback parameter convention
  onToggleCluster?: (clusterId: string) => void;
  tagColorPalette?: TagColorPalette;
  minRows?: number;
}

interface PlacedRow {
  node: TaskNode;
  /** Offset from the cluster's top-left corner. */
  dx: number;
  dy: number;
}

interface ClusterLayout {
  node: Node<TaskClusterNodeData>;
  rows: PlacedRow[];
  /** Offset from the block's top-left corner. */
  dx: number;
  dy: number;
  leftColumn: boolean;
  hasNext: boolean;
}

interface ClusterBlock {
  id: string;
  width: number;
  height: number;
  clusters: ClusterLayout[];
}

export interface ClusterPlan {
  /** One block per parent, laid out by dagre in place of its rows. */
  blocks: ClusterBlock[];
  /** Rows that are clustered (shown or folded away). */
  clusteredIds: Set<string>;
  /** Parent-to-block edges, for dagre only. */
  blockEdges: Edge[];
  /** Parent-to-cluster edges that are drawn. */
  clusterEdges: Edge[];
}

type RowKind = "next" | "active" | "waiting" | "open" | "closed";

const ROW_ORDER: Record<RowKind, number> = {
  next: 0,
  active: 1,
  waiting: 2,
  open: 3,
  closed: 4,
};

function rowKind(data: TaskNodeData, statuses: TaskStatusConfig[]): RowKind {
  const category: StatusCategory = getStatusCategory(
    data.task.status,
    statuses
  );
  if (category === "closed") return "closed";
  if (data.isNextStep) return "next";
  if (data.task.waitingOn) return "waiting";
  return category === "active" ? "active" : "open";
}

function countKind(
  data: TaskNodeData,
  kind: RowKind,
  statuses: TaskStatusConfig[]
): keyof TaskClusterCounts {
  if (kind !== "next") return kind;
  if (data.task.waitingOn) return "waiting";
  return getStatusCategory(data.task.status, statuses) === "active"
    ? "active"
    : "open";
}

/** Rows that stay visible while their cluster is folded. */
function isKeyRow(data: TaskNodeData, kind: RowKind): boolean {
  if (kind === "closed") return false;
  if (kind !== "open") return true;
  return data.task.starred || getDueState(data.task.dueDate) !== null;
}

export function getClusterId(parentId: string, label: string): string {
  return `tasks-map-cluster:${parentId}\u0000${label}`;
}

function getBlockId(parentId: string): string {
  return `tasks-map-cluster-block:${parentId}`;
}

function columnHeight(heights: number[], gap: number): number {
  if (heights.length === 0) return 0;
  return (
    heights.reduce((sum, height) => sum + height, 0) +
    (heights.length - 1) * gap
  );
}

/**
 * How many items go in the first of two columns, keeping their order and
 * making the taller column as short as possible (ties favour the first).
 */
export function splitIntoTwoColumns(heights: number[], gap: number): number {
  let best = heights.length;
  let bestHeight = Infinity;
  for (let count = 1; count < heights.length; count++) {
    const tallest = Math.max(
      columnHeight(heights.slice(0, count), gap),
      columnHeight(heights.slice(count), gap)
    );
    if (tallest < bestHeight) {
      best = count;
      bestHeight = tallest;
    }
  }
  return best;
}

/** Row offsets inside a cluster; long lists wrap into two columns. */
function layoutClusterRows(rows: TaskNode[]) {
  const heights = rows.map((row) => getMinimalNodeDimensions(row.data).height);
  const split =
    rows.length >= CLUSTER_WRAP_ROWS
      ? splitIntoTwoColumns(heights, CLUSTER_ROW_GAP)
      : rows.length;
  const placed: PlacedRow[] = [];
  let y = 0;
  rows.forEach((node, index) => {
    if (index === split) y = 0;
    const column = index < split ? 0 : 1;
    placed.push({
      node,
      dx: CLUSTER_PAD_X + column * (MINIMAL_ROW_WIDTH + CLUSTER_ROW_COLUMN_GAP),
      dy: CLUSTER_HEADER_HEIGHT + y,
    });
    y += heights[index] + CLUSTER_ROW_GAP;
  });
  const columns = split < rows.length ? 2 : 1;
  return {
    rows: placed,
    width:
      2 * CLUSTER_PAD_X +
      columns * MINIMAL_ROW_WIDTH +
      (columns - 1) * CLUSTER_ROW_COLUMN_GAP,
    rowsHeight: Math.max(
      columnHeight(heights.slice(0, split), CLUSTER_ROW_GAP),
      columnHeight(heights.slice(split), CLUSTER_ROW_GAP)
    ),
  };
}

/**
 * Group long lists of sibling task rows by their first group value (e.g.
 * their first context). A folded cluster shows only its key rows (next step,
 * active, waiting, starred, due soon); the rest are counted in its footer.
 *
 * A parent's clusters form one block: stacked when there are one or two,
 * in two balanced columns from three on. The block is laid out as a single
 * node, which also keeps the cluster order fixed: the one holding the next
 * step first, then by label, unlabelled last.
 *
 * Only plain leaf rows are clustered: rows with children of their own or
 * with several visible parents keep their own edges.
 */
export function planBranchClusters(
  nodes: TaskNode[],
  edges: Edge[],
  options: ClusterOptions
): ClusterPlan {
  const minRows = options.minRows ?? CLUSTER_MIN_ROWS;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childIds = new Map<string, string[]>();
  const parentCount = new Map<string, number>();
  const hasChildren = new Set<string>();
  const edgeByTarget = new Map<string, Edge>();
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    const list = childIds.get(edge.source) ?? [];
    list.push(edge.target);
    childIds.set(edge.source, list);
    parentCount.set(edge.target, (parentCount.get(edge.target) ?? 0) + 1);
    hasChildren.add(edge.source);
    edgeByTarget.set(edge.target, edge);
  }

  const plan: ClusterPlan = {
    blocks: [],
    clusteredIds: new Set(),
    blockEdges: [],
    clusterEdges: [],
  };

  for (const [parentId, children] of childIds) {
    const rows = children
      .map((id) => byId.get(id))
      .filter(
        (node): node is TaskNode =>
          !!node &&
          (node.data.level ?? "task") === "task" &&
          !hasChildren.has(node.id) &&
          parentCount.get(node.id) === 1
      );
    if (rows.length < minRows) continue;

    const groups = new Map<string, TaskNode[]>();
    for (const row of rows) {
      const label = row.data.task.groupValues[0] ?? "";
      const list = groups.get(label) ?? [];
      list.push(row);
      groups.set(label, list);
    }

    const clusters: ClusterLayout[] = [];
    for (const [label, members] of groups) {
      const clusterId = getClusterId(parentId, label);
      const expanded = options.expandedClusterIds?.has(clusterId) ?? false;
      const counts: TaskClusterCounts = {
        active: 0,
        waiting: 0,
        open: 0,
        closed: 0,
      };
      const ranked = members.map((node) => {
        const kind = rowKind(node.data, options.statuses);
        counts[countKind(node.data, kind, options.statuses)]++;
        return { node, kind, key: isKeyRow(node.data, kind) };
      });
      ranked.sort(
        (left, right) =>
          ROW_ORDER[left.kind] - ROW_ORDER[right.kind] ||
          getMinimalNodeTitle(left.node.data.task).localeCompare(
            getMinimalNodeTitle(right.node.data.task)
          )
      );
      const shown = expanded ? ranked : ranked.filter((row) => row.key);
      const folded = ranked.filter((row) => !row.key);
      const hiddenClosed = expanded
        ? 0
        : folded.filter((row) => row.kind === "closed").length;
      const hiddenOpen = expanded ? 0 : folded.length - hiddenClosed;
      const collapsible = folded.length > 0;
      const inner = layoutClusterRows(shown.map((row) => row.node));
      const height =
        CLUSTER_HEADER_HEIGHT +
        inner.rowsHeight +
        (collapsible ? CLUSTER_FOOTER_HEIGHT : CLUSTER_PAD_BOTTOM);

      for (const row of ranked) plan.clusteredIds.add(row.node.id);
      clusters.push({
        hasNext: ranked.some((row) => row.kind === "next"),
        rows: inner.rows,
        dx: 0,
        dy: 0,
        leftColumn: true,
        node: {
          id: clusterId,
          type: CLUSTER_NODE_TYPE,
          position: { x: 0, y: 0 },
          data: {
            clusterId,
            label,
            color: label
              ? getTagPaletteColor(label, options.tagColorPalette)
              : undefined,
            counts,
            hiddenOpen,
            hiddenClosed,
            expanded,
            collapsible,
            width: inner.width,
            height,
            layoutDirection: rows[0].data.layoutDirection,
            onToggle: options.onToggleCluster,
          },
          style: { width: inner.width, height },
          className: "tasks-map-cluster-node",
          selectable: false,
          draggable: false,
          connectable: false,
          focusable: false,
        },
      });
    }

    clusters.sort((left, right) => {
      if (left.hasNext !== right.hasNext) return left.hasNext ? -1 : 1;
      const leftLabel = left.node.data.label;
      const rightLabel = right.node.data.label;
      if (!leftLabel !== !rightLabel) return leftLabel ? -1 : 1;
      return leftLabel.localeCompare(rightLabel);
    });

    const heights = clusters.map((cluster) => cluster.node.data.height);
    const split =
      clusters.length >= CLUSTER_GRID_MIN
        ? splitIntoTwoColumns(heights, CLUSTER_GAP)
        : clusters.length;
    const firstWidth = Math.max(
      ...clusters.slice(0, split).map((cluster) => cluster.node.data.width)
    );
    let y = 0;
    let secondWidth = 0;
    clusters.forEach((cluster, index) => {
      if (index === split) y = 0;
      cluster.leftColumn = index < split;
      cluster.dx = cluster.leftColumn ? 0 : firstWidth + CLUSTER_GAP;
      cluster.dy = y;
      y += cluster.node.data.height + CLUSTER_GAP;
      if (!cluster.leftColumn) {
        secondWidth = Math.max(secondWidth, cluster.node.data.width);
      }
    });

    const blockId = getBlockId(parentId);
    plan.blocks.push({
      id: blockId,
      width: firstWidth + (secondWidth > 0 ? CLUSTER_GAP + secondWidth : 0),
      height: Math.max(
        columnHeight(heights.slice(0, split), CLUSTER_GAP),
        columnHeight(heights.slice(split), CLUSTER_GAP)
      ),
      clusters,
    });
    const template = edgeByTarget.get(rows[0].id);
    const edgeFor = (id: string, target: string): Edge => ({
      id,
      source: parentId,
      target,
      type: template?.type,
      deletable: false,
      data: { ...(template?.data ?? {}), hash: "" },
    });
    plan.blockEdges.push(edgeFor(`tasks-map-block-edge:${blockId}`, blockId));
    // Only the first column gets edges: the second sits right beside it.
    for (const cluster of clusters) {
      if (!cluster.leftColumn) continue;
      plan.clusterEdges.push(
        edgeFor(`tasks-map-cluster-edge:${cluster.node.id}`, cluster.node.id)
      );
    }
  }
  return plan;
}

/** Stand-in nodes and sizes for dagre: one per block of clusters. */
export function getClusterBlockNodes(plan: ClusterPlan): {
  nodes: Node[];
  dimensions: Map<string, NodeDimensions>;
} {
  return {
    nodes: plan.blocks.map((block) => ({
      id: block.id,
      position: { x: 0, y: 0 },
      data: {},
    })),
    dimensions: new Map(
      plan.blocks.map((block) => [
        block.id,
        { width: block.width, height: block.height },
      ])
    ),
  };
}

/** Place each block's clusters, and their rows, where dagre put the block. */
export function placeClusterBlocks(
  plan: ClusterPlan,
  layouted: Node[]
): { clusters: Node<TaskClusterNodeData>[]; rows: TaskNode[] } {
  const positions = new Map(layouted.map((node) => [node.id, node.position]));
  const clusters: Node<TaskClusterNodeData>[] = [];
  const rows: TaskNode[] = [];
  for (const block of plan.blocks) {
    const origin = positions.get(block.id);
    if (!origin) continue;
    for (const cluster of block.clusters) {
      const x = origin.x + cluster.dx;
      const y = origin.y + cluster.dy;
      clusters.push({ ...cluster.node, position: { x, y } });
      for (const row of cluster.rows) {
        rows.push({
          ...row.node,
          position: { x: x + row.dx, y: y + row.dy },
        });
      }
    }
  }
  return { clusters, rows };
}
