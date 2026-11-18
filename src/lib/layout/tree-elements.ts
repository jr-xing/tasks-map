import type { Edge, Node } from "reactflow";
import type { BaseTask, TaskAttachmentKind } from "src/types/base-task";
import type { NodeDensity } from "src/types/settings";
import type { TaskNodeData } from "src/types/task";
import { getStatusById, TaskStatusConfig } from "src/lib/status-config";
import { estimateTaskNodeDimensions, NodeDimensions } from "./dimensions";
import type { LayoutDirection } from "./packing";
import { layoutTree } from "./tree";

export const TREE_GUTTER_NODE_ID = "tasks-map-tree-gutter";
export const TREE_GUTTER_NODE_TYPE = "treeGutter";

/**
 * Sort key for rows. Note filenames usually start with their creation date
 * (YYYY-MM-DD-TASK ...), which gives the tree a git-like chronological order.
 */
export function treeSortKey(task: BaseTask): string {
  const label = task.noteFilename || task.summary || task.text || task.id;
  return `${label.trim().toLowerCase()}\u0000${task.id}`;
}

export interface TreeElementsInput {
  nodes: Node[];
  edges: Edge[];
  tasks: BaseTask[];
  direction: LayoutDirection;
  statuses: TaskStatusConfig[];
  showTags: boolean;
  visibleAttachmentKinds: TaskAttachmentKind[];
  nodeDensity: NodeDensity;
}

/**
 * Position task nodes for tree mode and add the gutter node that draws the
 * lanes. Graph edges stay in the edge list (for selection and deletion) but
 * are hidden, because the gutter already shows every relation.
 */
export function createTreeLayoutElements({
  nodes,
  edges,
  tasks,
  direction,
  statuses,
  showTags,
  visibleAttachmentKinds,
  nodeDensity,
}: TreeElementsInput): { nodes: Node[]; edges: Edge[] } {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const dimensions = new Map<string, NodeDimensions>();
  nodes.forEach((node) => {
    const task = taskById.get(node.id);
    if (task) {
      dimensions.set(
        node.id,
        estimateTaskNodeDimensions(
          { ...(node.data as Partial<TaskNodeData>), task },
          showTags,
          visibleAttachmentKinds,
          nodeDensity
        )
      );
    }
  });
  const sortKeys = new Map(
    nodes.map((node) => {
      const task = taskById.get(node.id);
      return [node.id, task ? treeSortKey(task) : node.id];
    })
  );
  const compare = (left: string, right: string) => {
    const leftKey = sortKeys.get(left) ?? left;
    const rightKey = sortKeys.get(right) ?? right;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  };

  const layout = layoutTree({
    nodeIds: nodes.map((node) => node.id),
    edges,
    dimensions,
    direction,
    compare,
  });

  const positionedNodes = nodes.map((node) => ({
    ...node,
    position: layout.positions.get(node.id) ?? node.position,
  }));
  if (layout.rows.length === 0) {
    return { nodes: positionedNodes, edges };
  }

  const gutterNode: Node = {
    id: TREE_GUTTER_NODE_ID,
    type: TREE_GUTTER_NODE_TYPE,
    position: { x: 0, y: 0 },
    data: {
      width: layout.gutter.width,
      height: layout.gutter.height,
      lines: layout.gutter.lines,
      dots: layout.gutter.dots.map((dot) => ({
        ...dot,
        color: getStatusById(taskById.get(dot.id)?.status ?? "", statuses)
          .color,
      })),
    },
    style: { width: layout.gutter.width, height: layout.gutter.height },
    className: "tasks-map-tree-gutter-node",
    selectable: false,
    draggable: false,
    connectable: false,
    focusable: false,
    zIndex: -1,
  };

  return {
    nodes: [gutterNode, ...positionedNodes],
    edges: edges.map((edge) => ({ ...edge, hidden: true })),
  };
}
