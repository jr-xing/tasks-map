import { Node } from "reactflow";
import { NODEHEIGHT, NODEWIDTH } from "src/components/task-node";
import { BaseTask, TaskAttachmentKind } from "src/types/base-task";
import { TaskEdge, TaskNode } from "src/types/task";
import {
  DEFAULT_VISIBLE_ATTACHMENT_KINDS,
  NodeDensity,
} from "src/types/settings";
import { estimateNodeDimensions, NodeDimensions } from "./dimensions";
import { layoutNodesWithDagre, LayoutDirection } from "./packing";

export const PROJECT_GROUP_PADDING = 40;
export const PROJECT_GROUP_HEADER_HEIGHT = 32;

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function taskSortKey(task: BaseTask): string {
  return `${(task.summary || task.link || task.id).trim().toLowerCase()}\u0000${task.id}`;
}

/** Partition tasks into deterministic project-grouping buckets. */
export function partitionTasksByProject(tasks: BaseTask[]): {
  singleProjectMap: Map<string, BaseTask[]>;
  multiProjectTasks: BaseTask[];
  noProjectTasks: BaseTask[];
} {
  const unsortedProjectMap = new Map<string, BaseTask[]>();
  const multiProjectTasks: BaseTask[] = [];
  const noProjectTasks: BaseTask[] = [];

  for (const task of tasks) {
    if (task.projects.length === 0) {
      noProjectTasks.push(task);
    } else if (task.projects.length > 1) {
      multiProjectTasks.push(task);
    } else {
      const projectName = task.projects[0];
      const projectTasks = unsortedProjectMap.get(projectName) ?? [];
      projectTasks.push(task);
      unsortedProjectMap.set(projectName, projectTasks);
    }
  }

  const singleProjectMap = new Map(
    [...unsortedProjectMap]
      .sort(([left], [right]) =>
        compareText(
          `${left.toLowerCase()}\u0000${left}`,
          `${right.toLowerCase()}\u0000${right}`
        )
      )
      .map(([projectName, projectTasks]) => [
        projectName,
        [...projectTasks].sort((left, right) =>
          compareText(taskSortKey(left), taskSortKey(right))
        ),
      ])
  );

  multiProjectTasks.sort((left, right) =>
    compareText(taskSortKey(left), taskSortKey(right))
  );
  noProjectTasks.sort((left, right) =>
    compareText(taskSortKey(left), taskSortKey(right))
  );
  return { singleProjectMap, multiProjectTasks, noProjectTasks };
}

/**
 * Build project group nodes and child task nodes. Kept as a public layout
 * primitive for compatibility with callers that assemble layouts manually.
 */
export function createProjectGroupNodes(
  taskNodes: TaskNode[],
  tasks: BaseTask[],
  edges: TaskEdge[],
  direction: LayoutDirection,
  showTags: boolean,
  visibleAttachmentKinds: TaskAttachmentKind[] = DEFAULT_VISIBLE_ATTACHMENT_KINDS,
  nodeDensity: NodeDensity = "comfortable"
): Node[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const { singleProjectMap, multiProjectTasks, noProjectTasks } =
    partitionTasksByProject(tasks);
  const allNodes: Node[] = [];

  for (const [projectName, memberTasks] of singleProjectMap) {
    const groupId = `project-group-${projectName}`;
    const memberIds = new Set(memberTasks.map((task) => task.id));
    const memberNodes = taskNodes.filter((node) => memberIds.has(node.id));
    const memberEdges = edges.filter(
      (edge) => memberIds.has(edge.source) && memberIds.has(edge.target)
    );
    const nodeDimensions = new Map<string, NodeDimensions>();
    memberNodes.forEach((node) => {
      const task = taskById.get(node.id);
      nodeDimensions.set(
        node.id,
        task
          ? estimateNodeDimensions(
              task,
              showTags,
              visibleAttachmentKinds,
              nodeDensity
            )
          : { width: NODEWIDTH, height: NODEHEIGHT }
      );
    });

    const rankdir = direction === "Horizontal" ? "LR" : "TB";
    const layoutedMembers = layoutNodesWithDagre(
      memberNodes,
      memberEdges,
      rankdir,
      nodeDimensions
    );
    let maxRight = 0;
    let maxBottom = 0;
    layoutedMembers.forEach((node) => {
      const dimensions = nodeDimensions.get(node.id) ?? {
        width: NODEWIDTH,
        height: NODEHEIGHT,
      };
      maxRight = Math.max(maxRight, node.position.x + dimensions.width);
      maxBottom = Math.max(maxBottom, node.position.y + dimensions.height);
    });

    allNodes.push({
      id: groupId,
      type: "projectGroup",
      position: { x: 0, y: 0 },
      data: { label: projectName },
      style: {
        width: maxRight + PROJECT_GROUP_PADDING * 2,
        height: maxBottom + PROJECT_GROUP_PADDING + PROJECT_GROUP_HEADER_HEIGHT,
      },
      zIndex: -1,
    });
    layoutedMembers.forEach((node) => {
      allNodes.push({
        ...node,
        parentNode: groupId,
        extent: "parent" as const,
        position: {
          x: node.position.x + PROJECT_GROUP_PADDING,
          y: node.position.y + PROJECT_GROUP_HEADER_HEIGHT,
        },
      });
    });
  }

  const ungroupedIds = new Set([
    ...multiProjectTasks.map((task) => task.id),
    ...noProjectTasks.map((task) => task.id),
  ]);
  taskNodes
    .filter((node) => ungroupedIds.has(node.id))
    .forEach((node) => allNodes.push(node));
  return allNodes;
}
