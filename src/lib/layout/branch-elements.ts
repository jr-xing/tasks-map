import type { Edge, Node } from "reactflow";
import type { TaskNode } from "src/types/task";
import { getMinimalNodeDimensions } from "./dimensions";
import {
  DagreSpacing,
  layoutConnectedComponents,
  LayoutDirection,
  LayoutViewport,
} from "./packing";

const BRANCH_VIEW_SPACING: DagreSpacing = { nodesep: 14, ranksep: 72 };

/**
 * Lay out the Branches view: every node is drawn as a minimal card (summary
 * cards for projects, groups and branches, rows for tasks), packed tighter
 * than the graph so a project's structure fits on one screen.
 */
export function createBranchViewNodes(
  nodes: TaskNode[],
  edges: Edge[],
  direction: LayoutDirection,
  viewport?: LayoutViewport
): Node[] {
  const prepared: TaskNode[] = nodes.map((node) => ({
    ...node,
    data: { ...node.data, nodeDensity: "minimal" },
  }));
  const dimensions = new Map(
    prepared.map((node) => [node.id, getMinimalNodeDimensions(node.data)])
  );
  return layoutConnectedComponents(
    prepared,
    edges,
    direction === "Horizontal" ? "LR" : "TB",
    dimensions,
    direction,
    viewport,
    BRANCH_VIEW_SPACING
  );
}
