import { Edge, Node } from "reactflow";
import { NODEHEIGHT, NODEWIDTH } from "src/components/task-node";
import { BaseTask, TaskAttachmentKind } from "src/types/base-task";
import { TaskEdge, TaskNode } from "src/types/task";
import {
  DEFAULT_VISIBLE_ATTACHMENT_KINDS,
  NodeDensity,
} from "src/types/settings";
import { estimateNodeDimensions, NodeDimensions } from "./dimensions";
import {
  PROJECT_GROUP_HEADER_HEIGHT,
  PROJECT_GROUP_PADDING,
  partitionTasksByProject,
} from "./project-groups";
import {
  layoutConnectedComponents,
  layoutConnectedComponentSets,
  spaceConnectedComponents,
  LayoutDirection,
  LayoutViewport,
} from "./packing";

interface GroupBounds {
  minX: number;
  minY: number;
  maxRight: number;
  maxBottom: number;
}

export interface LayoutSnapshot {
  nodes: Node[];
  topLevelComponents: Node[][];
  topLevelDimensions: Map<string, NodeDimensions>;
  topLevelNodeIds: Set<string>;
  direction: LayoutDirection;
}

function dimensionsForTask(
  task: BaseTask | undefined,
  showTags: boolean,
  visibleAttachmentKinds: TaskAttachmentKind[],
  nodeDensity: NodeDensity
): NodeDimensions {
  return task
    ? estimateNodeDimensions(
        task,
        showTags,
        visibleAttachmentKinds,
        nodeDensity
      )
    : { width: NODEWIDTH, height: NODEHEIGHT };
}

function packTopLevelComponents(
  connectedComponents: Node[][],
  nodeDimensions: Map<string, NodeDimensions>,
  direction: LayoutDirection,
  viewport?: LayoutViewport
): Node[] {
  if (connectedComponents.length <= 1) {
    return connectedComponents[0] ?? [];
  }
  return spaceConnectedComponents(
    connectedComponents,
    nodeDimensions,
    direction,
    viewport
  );
}

export function packLayoutSnapshot(
  snapshot: LayoutSnapshot,
  viewport?: LayoutViewport
): Node[] {
  const packedTopLevelNodes = packTopLevelComponents(
    snapshot.topLevelComponents,
    snapshot.topLevelDimensions,
    snapshot.direction,
    viewport
  );
  const topLevelPositions = new Map(
    packedTopLevelNodes.map((node) => [node.id, node.position])
  );

  return snapshot.nodes.map((node) => {
    const position = topLevelPositions.get(node.id);
    return position ? { ...node, position } : node;
  });
}

export function createLayoutSnapshot(
  nodes: Node[],
  edges: Edge[],
  direction: LayoutDirection = "Horizontal",
  showTags: boolean = true,
  groupByProject: boolean = true,
  tasks: BaseTask[] = [],
  visibleAttachmentKinds: TaskAttachmentKind[] = DEFAULT_VISIBLE_ATTACHMENT_KINDS,
  nodeDensity: NodeDensity = "comfortable"
): LayoutSnapshot {
  const rankdir = direction === "Horizontal" ? "LR" : "TB";
  const nodeDimensions = new Map<string, NodeDimensions>();

  if (groupByProject && tasks.length > 0) {
    const taskNodes = nodes as TaskNode[];
    const taskEdges = edges as TaskEdge[];
    const { singleProjectMap, multiProjectTasks, noProjectTasks } =
      partitionTasksByProject(tasks);
    const taskToGroup = new Map<string, string>();

    for (const [projectName, memberTasks] of singleProjectMap) {
      const groupId = `project-group-${projectName}`;
      memberTasks.forEach((task) => taskToGroup.set(task.id, groupId));
    }
    taskNodes.forEach((node) => {
      nodeDimensions.set(
        node.id,
        dimensionsForTask(
          node.data?.task,
          showTags,
          visibleAttachmentKinds,
          nodeDensity
        )
      );
    });

    const flatLayouted = layoutConnectedComponents(
      taskNodes,
      taskEdges,
      rankdir,
      nodeDimensions,
      direction
    );
    const taskRank = new Map<string, number>();
    flatLayouted.forEach((node) => {
      taskRank.set(
        node.id,
        direction === "Horizontal" ? node.position.x : node.position.y
      );
    });

    const projectLocalPositions = new Map<string, { x: number; y: number }>();
    const groupDimensions = new Map<string, NodeDimensions>();
    const groupBounds = new Map<string, GroupBounds>();

    for (const [projectName, memberTasks] of singleProjectMap) {
      const groupId = `project-group-${projectName}`;
      const memberIds = new Set(memberTasks.map((task) => task.id));
      const memberNodes = taskNodes.filter((node) => memberIds.has(node.id));
      const memberEdges = taskEdges.filter(
        (edge) => memberIds.has(edge.source) && memberIds.has(edge.target)
      );
      const projectLayouted = layoutConnectedComponents(
        memberNodes,
        memberEdges,
        rankdir,
        nodeDimensions,
        direction
      );
      projectLayouted.forEach((node) => {
        projectLocalPositions.set(node.id, node.position);
      });

      let minX = Infinity;
      let minY = Infinity;
      let maxRight = -Infinity;
      let maxBottom = -Infinity;
      projectLayouted.forEach((node) => {
        const dimensions = nodeDimensions.get(node.id) ?? {
          width: NODEWIDTH,
          height: NODEHEIGHT,
        };
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxRight = Math.max(maxRight, node.position.x + dimensions.width);
        maxBottom = Math.max(maxBottom, node.position.y + dimensions.height);
      });
      groupBounds.set(groupId, { minX, minY, maxRight, maxBottom });
      groupDimensions.set(groupId, {
        width: maxRight - minX + PROJECT_GROUP_PADDING * 2,
        height:
          maxBottom -
          minY +
          PROJECT_GROUP_PADDING +
          PROJECT_GROUP_HEADER_HEIGHT,
      });
    }

    const groupMinRank = new Map<string, number>();
    const groupMaxRank = new Map<string, number>();
    for (const [projectName, memberTasks] of singleProjectMap) {
      const groupId = `project-group-${projectName}`;
      const ranks = memberTasks.map((task) => taskRank.get(task.id) ?? 0);
      groupMinRank.set(groupId, Math.min(...ranks));
      groupMaxRank.set(groupId, Math.max(...ranks));
    }

    const ungroupedIds = new Set([
      ...multiProjectTasks.map((task) => task.id),
      ...noProjectTasks.map((task) => task.id),
    ]);
    const topLevelNodes: Node[] = [];
    const topLevelDimensions = new Map<string, NodeDimensions>();
    for (const [projectName] of singleProjectMap) {
      const groupId = `project-group-${projectName}`;
      const dimensions = groupDimensions.get(groupId);
      if (!dimensions) continue;
      topLevelNodes.push({
        id: groupId,
        type: "projectGroup",
        position: { x: 0, y: 0 },
        data: { label: projectName },
        style: { width: dimensions.width, height: dimensions.height },
        zIndex: -1,
      });
      topLevelDimensions.set(groupId, dimensions);
    }
    flatLayouted
      .filter((node) => ungroupedIds.has(node.id))
      .forEach((node) => {
        topLevelNodes.push({ ...node, position: { x: 0, y: 0 } });
        topLevelDimensions.set(
          node.id,
          nodeDimensions.get(node.id) ?? {
            width: NODEWIDTH,
            height: NODEHEIGHT,
          }
        );
      });

    const ungroupedRank = (id: string) => taskRank.get(id) ?? 0;
    const sourceMaxRank = (id: string) =>
      groupMaxRank.get(id) ?? ungroupedRank(id);
    const targetMinRank = (id: string) =>
      groupMinRank.get(id) ?? ungroupedRank(id);
    const topLevelEdgeKeys = new Set<string>();
    const topLevelEdges: Edge[] = [];
    taskEdges.forEach((edge) => {
      const source = taskToGroup.get(edge.source) ?? edge.source;
      const target = taskToGroup.get(edge.target) ?? edge.target;
      const key = `${source}\u0000${target}`;
      if (
        source === target ||
        topLevelEdgeKeys.has(key) ||
        sourceMaxRank(source) >= targetMinRank(target)
      ) {
        return;
      }
      topLevelEdgeKeys.add(key);
      topLevelEdges.push({ ...edge, source, target });
    });

    const topLevelComponents = layoutConnectedComponentSets(
      topLevelNodes,
      topLevelEdges,
      rankdir,
      topLevelDimensions
    );
    const topLevelLayouted = packTopLevelComponents(
      topLevelComponents,
      topLevelDimensions,
      direction
    );
    const topLevelPositions = new Map(
      topLevelLayouted.map((node) => [node.id, node.position])
    );
    const resultNodes: Node[] = [];

    for (const [projectName, memberTasks] of singleProjectMap) {
      const groupId = `project-group-${projectName}`;
      const dimensions = groupDimensions.get(groupId);
      const bounds = groupBounds.get(groupId);
      if (!dimensions || !bounds) continue;
      resultNodes.push({
        id: groupId,
        type: "projectGroup",
        position: topLevelPositions.get(groupId) ?? { x: 0, y: 0 },
        data: { label: projectName },
        style: { width: dimensions.width, height: dimensions.height },
        zIndex: -1,
      });

      memberTasks.forEach((task) => {
        const flatNode = flatLayouted.find((node) => node.id === task.id);
        if (!flatNode) return;
        const position = projectLocalPositions.get(task.id) ?? { x: 0, y: 0 };
        resultNodes.push({
          ...flatNode,
          parentNode: groupId,
          extent: "parent" as const,
          position: {
            x: position.x - bounds.minX + PROJECT_GROUP_PADDING,
            y: position.y - bounds.minY + PROJECT_GROUP_HEADER_HEIGHT,
          },
        });
      });
    }
    flatLayouted
      .filter((node) => ungroupedIds.has(node.id))
      .forEach((node) => {
        const position = topLevelPositions.get(node.id);
        resultNodes.push(position ? { ...node, position } : node);
      });
    return {
      nodes: resultNodes,
      topLevelComponents,
      topLevelDimensions,
      topLevelNodeIds: new Set(topLevelNodes.map((node) => node.id)),
      direction,
    };
  }

  nodes.forEach((node) => {
    nodeDimensions.set(
      node.id,
      dimensionsForTask(
        node.data?.task as BaseTask | undefined,
        showTags,
        visibleAttachmentKinds,
        nodeDensity
      )
    );
  });
  const topLevelComponents = layoutConnectedComponentSets(
    nodes,
    edges,
    rankdir,
    nodeDimensions
  );
  return {
    nodes: packTopLevelComponents(
      topLevelComponents,
      nodeDimensions,
      direction
    ),
    topLevelComponents,
    topLevelDimensions: nodeDimensions,
    topLevelNodeIds: new Set(nodes.map((node) => node.id)),
    direction,
  };
}

export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: LayoutDirection = "Horizontal",
  showTags: boolean = true,
  groupByProject: boolean = true,
  tasks: BaseTask[] = [],
  visibleAttachmentKinds: TaskAttachmentKind[] = DEFAULT_VISIBLE_ATTACHMENT_KINDS,
  nodeDensity: NodeDensity = "comfortable",
  viewport?: LayoutViewport
): Node[] {
  return packLayoutSnapshot(
    createLayoutSnapshot(
      nodes,
      edges,
      direction,
      showTags,
      groupByProject,
      tasks,
      visibleAttachmentKinds,
      nodeDensity
    ),
    viewport
  );
}
