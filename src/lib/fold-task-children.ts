import { BaseTask } from "src/types/base-task";

export interface FoldedGraphVisibility {
  visibleNodeIds: ReadonlySet<string>;
  foldedNodeIds: ReadonlySet<string>;
  foldedDescendantCounts: ReadonlyMap<string, number>;
  taskIdsWithVisibleChildren: ReadonlySet<string>;
  visibleConnectionKeys: ReadonlySet<string>;
}

export function getTaskConnectionKey(source: string, target: string): string {
  return `${source}\u0000${target}`;
}

function getSourceComponentNodeIds(
  nodeIds: string[],
  outgoing: ReadonlyMap<string, ReadonlySet<string>>
): Set<string> {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (nodeId: string): void => {
    const index = nextIndex++;
    indices.set(nodeId, index);
    lowLinks.set(nodeId, index);
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const childId of outgoing.get(nodeId) ?? []) {
      if (!indices.has(childId)) {
        visit(childId);
        lowLinks.set(
          nodeId,
          Math.min(lowLinks.get(nodeId)!, lowLinks.get(childId)!)
        );
      } else if (onStack.has(childId)) {
        lowLinks.set(
          nodeId,
          Math.min(lowLinks.get(nodeId)!, indices.get(childId)!)
        );
      }
    }

    if (lowLinks.get(nodeId) !== indices.get(nodeId)) return;

    const component: string[] = [];
    let memberId: string;
    do {
      memberId = stack.pop()!;
      onStack.delete(memberId);
      component.push(memberId);
    } while (memberId !== nodeId);
    components.push(component);
  };

  nodeIds.forEach((nodeId) => {
    if (!indices.has(nodeId)) visit(nodeId);
  });

  const componentByNodeId = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    component.forEach((nodeId) => {
      componentByNodeId.set(nodeId, componentIndex);
    });
  });

  const componentsWithIncomingEdges = new Set<number>();
  for (const [sourceId, childIds] of outgoing) {
    const sourceComponent = componentByNodeId.get(sourceId);
    for (const childId of childIds) {
      const targetComponent = componentByNodeId.get(childId);
      if (
        sourceComponent !== undefined &&
        targetComponent !== undefined &&
        sourceComponent !== targetComponent
      ) {
        componentsWithIncomingEdges.add(targetComponent);
      }
    }
  }

  const sourceNodeIds = new Set<string>();
  components.forEach((component, componentIndex) => {
    if (componentsWithIncomingEdges.has(componentIndex)) return;
    component.forEach((nodeId) => sourceNodeIds.add(nodeId));
  });
  return sourceNodeIds;
}

/**
 * Applies view-only child folding to an already filtered graph.
 *
 * Collapsed tasks remain visible but their outgoing edges cannot be traversed.
 * A shared descendant therefore remains visible whenever another uncollapsed
 * source-to-node path still reaches it. Source strongly connected components
 * seed all of their members so malformed cyclic task data remains stable and
 * deterministic instead of disappearing arbitrarily.
 */
export function getFoldedGraphVisibility(
  tasks: BaseTask[],
  filteredNodeIds: Iterable<string>,
  collapsedTaskIds: ReadonlySet<string>
): FoldedGraphVisibility {
  const requestedNodeIds = new Set(filteredNodeIds);
  const nodeIds = tasks
    .map((task) => task.id)
    .filter((taskId) => requestedNodeIds.has(taskId));
  const allowedNodeIds = new Set(nodeIds);
  const outgoing = new Map<string, Set<string>>();

  for (const task of tasks) {
    if (!allowedNodeIds.has(task.id)) continue;
    for (const parentId of task.incomingLinks) {
      if (!allowedNodeIds.has(parentId)) continue;
      const children = outgoing.get(parentId) ?? new Set<string>();
      children.add(task.id);
      outgoing.set(parentId, children);
    }
  }

  const sourceNodeIds = getSourceComponentNodeIds(nodeIds, outgoing);
  const visibleNodeIds = new Set<string>();
  const pendingNodeIds = [...sourceNodeIds];

  for (let index = 0; index < pendingNodeIds.length; index++) {
    const nodeId = pendingNodeIds[index];
    if (visibleNodeIds.has(nodeId)) continue;
    visibleNodeIds.add(nodeId);
    if (collapsedTaskIds.has(nodeId)) continue;
    for (const childId of outgoing.get(nodeId) ?? []) {
      pendingNodeIds.push(childId);
    }
  }

  const foldedNodeIds = new Set(
    nodeIds.filter((nodeId) => !visibleNodeIds.has(nodeId))
  );
  const foldedDescendantCounts = new Map<string, number>();
  for (const collapsedTaskId of collapsedTaskIds) {
    if (!allowedNodeIds.has(collapsedTaskId)) continue;

    const visitedNodeIds = new Set([collapsedTaskId]);
    const pendingDescendantIds = [...(outgoing.get(collapsedTaskId) ?? [])];
    let foldedDescendantCount = 0;

    for (let index = 0; index < pendingDescendantIds.length; index++) {
      const descendantId = pendingDescendantIds[index];
      if (visitedNodeIds.has(descendantId)) continue;
      visitedNodeIds.add(descendantId);
      if (foldedNodeIds.has(descendantId)) foldedDescendantCount++;
      for (const childId of outgoing.get(descendantId) ?? []) {
        pendingDescendantIds.push(childId);
      }
    }

    foldedDescendantCounts.set(collapsedTaskId, foldedDescendantCount);
  }
  const visibleConnectionKeys = new Set<string>();
  for (const [sourceId, childIds] of outgoing) {
    if (!visibleNodeIds.has(sourceId) || collapsedTaskIds.has(sourceId)) {
      continue;
    }
    for (const childId of childIds) {
      if (visibleNodeIds.has(childId)) {
        visibleConnectionKeys.add(getTaskConnectionKey(sourceId, childId));
      }
    }
  }

  return {
    visibleNodeIds,
    foldedNodeIds,
    foldedDescendantCounts,
    taskIdsWithVisibleChildren: new Set(outgoing.keys()),
    visibleConnectionKeys,
  };
}
