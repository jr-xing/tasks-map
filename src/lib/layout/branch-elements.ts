import type { Edge, Node } from "reactflow";
import type { TaskNode } from "src/types/task";
import {
  ClusterOptions,
  getClusterBlockNodes,
  getClusteredEdges,
  placeClusterBlocks,
  planBranchClusters,
} from "./branch-clusters";
import { getMinimalNodeDimensions } from "./dimensions";
import {
  DagreSpacing,
  layoutConnectedComponentSets,
  LayoutDirection,
  LayoutViewport,
  spaceConnectedComponents,
} from "./packing";
import {
  packComponentsIntoZones,
  TaskGroupZoneOptions,
} from "./task-group-zones";

const BRANCH_VIEW_SPACING: DagreSpacing = { nodesep: 14, ranksep: 72 };

export interface BranchViewElements {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Lay out the Branches view: every node is drawn as a minimal card (summary
 * cards for projects, groups and branches, rows for tasks), packed tighter
 * than the graph so a project's structure fits on one screen. Long lists of
 * sibling rows are grouped into clusters (see planBranchClusters). With
 * `zones`, each task group's projects share one labelled zone.
 */
export function createBranchViewElements(
  nodes: TaskNode[],
  edges: Edge[],
  direction: LayoutDirection,
  viewport?: LayoutViewport,
  clusterOptions?: ClusterOptions,
  zones?: TaskGroupZoneOptions
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
  const components = layoutConnectedComponentSets(
    [...free, ...blocks.nodes],
    [...freeEdges, ...plan.blockEdges],
    direction === "Horizontal" ? "LR" : "TB",
    dimensions,
    BRANCH_VIEW_SPACING
  );
  let zoneNodes: Node[] = [];
  let layouted: Node[];
  if (zones) {
    const packed = packComponentsIntoZones(
      components,
      dimensions,
      direction,
      viewport,
      zones
    );
    zoneNodes = packed.zones;
    layouted = packed.nodes;
  } else {
    layouted =
      components.length <= 1
        ? (components[0] ?? [])
        : spaceConnectedComponents(components, dimensions, direction, viewport);
  }
  const { clusters, rows } = placeClusterBlocks(plan, layouted);
  const blockIds = new Set(blocks.nodes.map((node) => node.id));
  return {
    // Zones, then clusters, so frames render beneath what they hold.
    nodes: [
      ...zoneNodes,
      ...clusters,
      ...layouted.filter((node) => !blockIds.has(node.id)),
      ...rows,
    ],
    edges: getClusteredEdges(plan, edges, rows),
  };
}
