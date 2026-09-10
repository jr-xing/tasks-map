import type { Node, ReactFlowState } from "reactflow";
import { readGraphViewport } from "./graph-viewport-sync";

interface MeasurementStore {
  getState: () => Pick<
    ReactFlowState,
    "domNode" | "width" | "height" | "updateNodeDimensions"
  >;
  setState: (_size: { width: number; height: number }) => void;
}

/** ReactFlow 11's built-in observers/RAF belong to the plugin's main window. */
export function synchronizeReactFlowMeasurements(store: MeasurementStore) {
  const { domNode, width, height, updateNodeDimensions } = store.getState();
  const viewport = readGraphViewport(domNode);
  if (!viewport || !domNode) return false;
  const { width: nextWidth, height: nextHeight } = viewport;
  if (width !== nextWidth || height !== nextHeight) {
    store.setState({ width: nextWidth, height: nextHeight });
  }
  if (!domNode.querySelector(".react-flow__viewport")) return false;

  // Scope to this map and read data-id directly (IDs need not be CSS-safe).
  const elements = Array.from(
    domNode.querySelectorAll<HTMLDivElement>(".react-flow__node")
  );
  const updates = elements.flatMap((nodeElement) => {
    const id = nodeElement.getAttribute("data-id");
    return id && nodeElement.offsetWidth > 0 && nodeElement.offsetHeight > 0
      ? [{ id, nodeElement, forceUpdate: true }]
      : [];
  });
  // Run in the owner's frame; useUpdateNodeInternals would schedule another
  // frame on the main window and can stall when that window is hidden.
  if (updates.length > 0) updateNodeDimensions(updates);
  return updates.length === elements.length;
}

export function areGraphNodesReady(
  nodes: Node[],
  expectedIds: Set<string>,
  expectedPositions?: Map<string, Node["position"]>
): boolean {
  return (
    nodes.length === expectedIds.size &&
    nodes.every(
      (node) =>
        expectedIds.has(node.id) &&
        Number.isFinite(node.width) &&
        Number.isFinite(node.height) &&
        (node.width ?? 0) > 0 &&
        (node.height ?? 0) > 0 &&
        (expectedPositions === undefined ||
          (node.position.x === expectedPositions.get(node.id)?.x &&
            node.position.y === expectedPositions.get(node.id)?.y))
    )
  );
}
