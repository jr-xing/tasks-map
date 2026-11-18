import type { Edge, Node } from "reactflow";
import type { TaskNode } from "src/types/task";
import {
  ClusterOptions,
  getClusterBlockNodes,
  placeClusterBlocks,
  planBranchClusters,
} from "./branch-clusters";
import { getMinimalNodeDimensions } from "./dimensions";
import {
  DagreSpacing,
  layoutConnectedComponents,
  LayoutDirection,
  LayoutViewport,
} from "./packing";

const BRANCH_VIEW_SPACING: DagreSpacing = { nodesep: 14, ranksep: 72 };

export interface BranchViewElements {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Lay out the Branches view: every node is drawn as a minimal card (summary
 * cards for projects, groups and branches, rows for tasks), packed tighter
 * than the graph so a project's structure fits on one screen. Long lists of
 * sibling rows are grouped into clusters (see planBranchClusters).
 */
export function createBranchViewElements(
  nodes: TaskNode[],
  edges: Edge[],
  direction: LayoutDirection,
  viewport?: LayoutViewport,
  clusterOptions?: ClusterOptions
): BranchViewElements {
  const prepared: TaskNode[] = nodes.map((node) => ({
    ...node,
    data: { ...node.data, nodeDensity: "minimal" },
  }));
  const plan = planBranchClusters(prepared, edges, {
    statuses: [],
    ...clusterOptions,
  });
  const free = prepared.filter((node) => !plan.clusteredIds.has(node.id));
  const freeEdges = edges.filter((edge) => !plan.clusteredIds.has(edge.target));
  const blocks = getClusterBlockNodes(plan);
  const dimensions = new Map([
    ...free.map(
      (node) => [node.id, getMinimalNodeDimensions(node.data)] as const
    ),
    ...blocks.dimensions,
  ]);
  const layouted = layoutConnectedComponents(
    [...free, ...blocks.nodes],
    [...freeEdges, ...plan.blockEdges],
    direction === "Horizontal" ? "LR" : "TB",
    dimensions,
    direction,
    viewport,
    BRANCH_VIEW_SPACING
  );
  const { clusters, rows } = placeClusterBlocks(plan, layouted);
  const blockIds = new Set(blocks.nodes.map((node) => node.id));
  const shownIds = new Set(rows.map((row) => row.id));
  // A clustered row keeps its parent edge (for selection and deletion), but
  // hidden: the cluster's edge stands in for it.
  const rowEdges = edges
    .filter((edge) => shownIds.has(edge.target))
    .map((edge) => ({ ...edge, hidden: true }));
  return {
    // Clusters first, so their frames render beneath their rows.
    nodes: [
      ...clusters,
      ...layouted.filter((node) => !blockIds.has(node.id)),
      ...rows,
    ],
    edges: [...freeEdges, ...plan.clusterEdges, ...rowEdges],
  };
}
