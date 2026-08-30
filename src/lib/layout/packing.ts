import dagre from "@dagrejs/dagre";
import { Edge, Node } from "reactflow";
import { NODEHEIGHT, NODEWIDTH } from "src/components/task-node";
import { BaseTask } from "src/types/base-task";
import { NodeDimensions } from "./dimensions";

export type LayoutDirection = "Horizontal" | "Vertical";
export type DagreDirection = "LR" | "TB";

function getTaskCardHorizontalOffset(node: Node, dimensions: NodeDimensions) {
  const task = node.data?.task as BaseTask | undefined;
  if (!task) return 0;
  return Math.max(0, (dimensions.width - NODEWIDTH) / 2);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizedKey(value: string): string {
  return value.trim().toLowerCase();
}

function taskNodeKey(node: Node): string {
  const task = node.data?.task as BaseTask | undefined;
  if (!task) return normalizedKey(node.id);
  return normalizedKey(task.summary || task.link || task.id || node.id);
}

/**
 * Project components sort by project name. Other components sort by their
 * root task label, with stable task ids as the final tiebreaker.
 */
export function getComponentSortKey(componentNodes: Node[]): string {
  const projectNames = componentNodes
    .filter((node) => node.type === "projectGroup")
    .map((node) => normalizedKey(String(node.data?.label ?? node.id)))
    .sort(compareText);
  const ids = componentNodes.map((node) => node.id).sort(compareText);

  if (projectNames.length > 0) {
    return `0:${projectNames.join("\u0000")}:${ids.join("\u0000")}`;
  }

  const componentIds = new Set(ids);
  const taskNodes = componentNodes.filter((node) => node.data?.task);
  const roots = taskNodes.filter((node) => {
    const task = node.data.task as BaseTask;
    return !task.incomingLinks.some((id) => componentIds.has(id));
  });
  const candidates = roots.length > 0 ? roots : taskNodes;
  const rootKey = (candidates.length > 0 ? candidates : componentNodes)
    .map(taskNodeKey)
    .sort(compareText)[0];

  return `1:${rootKey ?? ""}:${ids.join("\u0000")}`;
}

export function layoutNodesWithDagre(
  nodes: Node[],
  edges: Edge[],
  rankdir: DagreDirection,
  nodeDimensions: Map<string, NodeDimensions>
): Node[] {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir, nodesep: 30, ranksep: 50 });

  [...nodes]
    .sort((left, right) => compareText(left.id, right.id))
    .forEach((node) => {
      dagreGraph.setNode(
        node.id,
        nodeDimensions.get(node.id) ?? {
          width: NODEWIDTH,
          height: NODEHEIGHT,
        }
      );
    });
  [...edges]
    .sort((left, right) =>
      compareText(
        `${left.source}\u0000${left.target}\u0000${left.id}`,
        `${right.source}\u0000${right.target}\u0000${right.id}`
      )
    )
    .forEach((edge) => dagreGraph.setEdge(edge.source, edge.target));
  dagre.layout(dagreGraph);

  return nodes.map((node) => {
    const position = dagreGraph.node(node.id);
    const dimensions = nodeDimensions.get(node.id) ?? {
      width: NODEWIDTH,
      height: NODEHEIGHT,
    };
    if (!position) return { ...node, position: { x: 0, y: 0 } };

    return {
      ...node,
      position: {
        x:
          position.x -
          dimensions.width / 2 +
          getTaskCardHorizontalOffset(node, dimensions),
        y: position.y - dimensions.height / 2,
      },
    };
  });
}

export function getConnectedComponents(
  nodes: Node[],
  edges: Edge[]
): string[][] {
  const adjacency = new Map<string, Set<string>>();
  [...nodes]
    .sort((left, right) => compareText(left.id, right.id))
    .forEach((node) => adjacency.set(node.id, new Set()));

  [...edges]
    .sort((left, right) =>
      compareText(
        `${left.source}\u0000${left.target}\u0000${left.id}`,
        `${right.source}\u0000${right.target}\u0000${right.id}`
      )
    )
    .forEach((edge) => {
      if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) return;
      adjacency.get(edge.source)?.add(edge.target);
      adjacency.get(edge.target)?.add(edge.source);
    });

  const visited = new Set<string>();
  const components: string[][] = [];
  adjacency.forEach((_neighbors, nodeId) => {
    if (visited.has(nodeId)) return;
    const stack = [nodeId];
    const component: string[] = [];
    visited.add(nodeId);

    while (stack.length > 0) {
      const currentId = stack.pop();
      if (!currentId) continue;
      component.push(currentId);
      const neighbors = [...(adjacency.get(currentId) ?? [])].sort(compareText);
      for (let index = neighbors.length - 1; index >= 0; index -= 1) {
        const neighborId = neighbors[index];
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        stack.push(neighborId);
      }
    }

    components.push(component);
  });
  return components;
}

export function normalizeLayoutedNodes(nodes: Node[]): Node[] {
  if (nodes.length === 0) return nodes;
  const minX = Math.min(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  return nodes.map((node) => ({
    ...node,
    position: {
      x: node.position.x - minX,
      y: node.position.y - minY,
    },
  }));
}

export function spaceConnectedComponents(
  connectedComponents: Node[][],
  nodeDimensions: Map<string, NodeDimensions>,
  direction: LayoutDirection
): Node[] {
  if (connectedComponents.length === 0) return [];

  const componentGapX = Math.max(120, Math.round(NODEWIDTH * 0.6));
  const componentGapY = Math.max(100, Math.round(NODEHEIGHT * 0.85));
  const componentBounds = connectedComponents
    .map((componentNodes) => {
      const minX = Math.min(...componentNodes.map((node) => node.position.x));
      const minY = Math.min(...componentNodes.map((node) => node.position.y));
      const maxX = Math.max(
        ...componentNodes.map((node) => {
          const dimensions = nodeDimensions.get(node.id) ?? {
            width: NODEWIDTH,
            height: NODEHEIGHT,
          };
          return node.position.x + dimensions.width;
        })
      );
      const maxY = Math.max(
        ...componentNodes.map((node) => {
          const dimensions = nodeDimensions.get(node.id) ?? {
            width: NODEWIDTH,
            height: NODEHEIGHT,
          };
          return node.position.y + dimensions.height;
        })
      );
      return {
        nodes: componentNodes,
        minX,
        minY,
        width: maxX - minX,
        height: maxY - minY,
        sortKey: getComponentSortKey(componentNodes),
      };
    })
    .sort((left, right) => compareText(left.sortKey, right.sortKey));

  const totalArea = componentBounds.reduce(
    (sum, bounds) =>
      sum + (bounds.width + componentGapX) * (bounds.height + componentGapY),
    0
  );
  const wrapThreshold = Math.max(
    direction === "Horizontal"
      ? Math.max(...componentBounds.map((bounds) => bounds.width))
      : Math.max(...componentBounds.map((bounds) => bounds.height)),
    Math.ceil(Math.sqrt(totalArea) * 1.5)
  );
  const offsets = new Map<string, { x: number; y: number }>();

  if (direction === "Horizontal") {
    let cursorX = 0;
    let cursorY = 0;
    let rowHeight = 0;
    componentBounds.forEach((bounds) => {
      if (cursorX > 0 && cursorX + bounds.width > wrapThreshold) {
        cursorX = 0;
        cursorY += rowHeight + componentGapY;
        rowHeight = 0;
      }
      offsets.set(bounds.sortKey, {
        x: cursorX - bounds.minX,
        y: cursorY - bounds.minY,
      });
      cursorX += bounds.width + componentGapX;
      rowHeight = Math.max(rowHeight, bounds.height);
    });
  } else {
    let cursorX = 0;
    let cursorY = 0;
    let columnWidth = 0;
    componentBounds.forEach((bounds) => {
      if (cursorY > 0 && cursorY + bounds.height > wrapThreshold) {
        cursorY = 0;
        cursorX += columnWidth + componentGapX;
        columnWidth = 0;
      }
      offsets.set(bounds.sortKey, {
        x: cursorX - bounds.minX,
        y: cursorY - bounds.minY,
      });
      cursorY += bounds.height + componentGapY;
      columnWidth = Math.max(columnWidth, bounds.width);
    });
  }

  return componentBounds.flatMap((bounds) => {
    const offset = offsets.get(bounds.sortKey) ?? { x: 0, y: 0 };
    return bounds.nodes.map((node) => ({
      ...node,
      position: {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y,
      },
    }));
  });
}

export function layoutConnectedComponents(
  nodes: Node[],
  edges: Edge[],
  rankdir: DagreDirection,
  nodeDimensions: Map<string, NodeDimensions>,
  direction: LayoutDirection
): Node[] {
  const components = getConnectedComponents(nodes, edges);
  const layoutedComponents = components.map((componentIds) => {
    const componentIdSet = new Set(componentIds);
    const componentNodes = nodes.filter((node) => componentIdSet.has(node.id));
    const componentEdges = edges.filter(
      (edge) =>
        componentIdSet.has(edge.source) && componentIdSet.has(edge.target)
    );
    return normalizeLayoutedNodes(
      layoutNodesWithDagre(
        componentNodes,
        componentEdges,
        rankdir,
        nodeDimensions
      )
    );
  });

  if (components.length <= 1) return layoutedComponents[0] ?? [];
  return spaceConnectedComponents(
    layoutedComponents,
    nodeDimensions,
    direction
  );
}
