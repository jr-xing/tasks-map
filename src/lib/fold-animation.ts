import type { Node } from "reactflow";
import type { BaseTask } from "src/types/base-task";

/** How long a fold or unfold takes to glide into place, in milliseconds. */
export const FOLD_ANIMATION_MS = 320;
/** Added to cards that appear during the glide, so they fade in. */
export const ENTERING_NODE_CLASS = "tasks-map-node--entering";

export interface NodeBox {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export function easeInOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** A node's position on the canvas, adding up its parents' positions. */
export function getAbsolutePosition(
  nodeId: string,
  nodesById: ReadonlyMap<string, Node>
): { x: number; y: number } | null {
  let node = nodesById.get(nodeId);
  if (!node) return null;
  let x = 0;
  let y = 0;
  const seen = new Set<string>();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    x += node.position.x;
    y += node.position.y;
    node = node.parentNode ? nodesById.get(node.parentNode) : undefined;
  }
  return { x, y };
}

/**
 * Where each card of the new layout starts its glide: cards already on the
 * map start where they are; new cards grow out of the nearest parent task
 * that was on the map (or appear in place when there is none).
 */
export function getStartBoxes(
  previous: Node[],
  target: Node[]
): { starts: Map<string, NodeBox>; entering: Set<string> } {
  const previousById = new Map(previous.map((node) => [node.id, node]));
  const starts = new Map<string, NodeBox>();
  const entering = new Set<string>();
  for (const node of target) {
    const before = previousById.get(node.id);
    if (before) {
      starts.set(node.id, {
        x: before.position.x,
        y: before.position.y,
        width: numeric(before.style?.width),
        height: numeric(before.style?.height),
      });
      continue;
    }
    entering.add(node.id);
    const task = node.data?.task as BaseTask | undefined;
    const originId = node.parentNode
      ? undefined
      : task?.incomingLinks.find((id) => previousById.has(id));
    const origin = originId
      ? getAbsolutePosition(originId, previousById)
      : null;
    starts.set(node.id, origin ?? { ...node.position });
  }
  return { starts, entering };
}

/**
 * One frame of the glide: every card moved `t` (0–1, already eased) of the
 * way from its start to its place in the new layout. Frames whose size is
 * set (zones, clusters) also grow or shrink.
 */
export function interpolateNodes(
  target: Node[],
  starts: ReadonlyMap<string, NodeBox>,
  entering: ReadonlySet<string>,
  t: number
): Node[] {
  return target.map((node) => {
    const start = starts.get(node.id);
    if (!start) return node;
    const next: Node = {
      ...node,
      position: {
        x: lerp(start.x, node.position.x, t),
        y: lerp(start.y, node.position.y, t),
      },
    };
    const width = numeric(node.style?.width);
    const height = numeric(node.style?.height);
    if (
      start.width !== undefined &&
      start.height !== undefined &&
      width !== undefined &&
      height !== undefined
    ) {
      const frameWidth = lerp(start.width, width, t);
      const frameHeight = lerp(start.height, height, t);
      next.style = { ...node.style, width: frameWidth, height: frameHeight };
      if (
        numeric(node.data?.width) !== undefined &&
        numeric(node.data?.height) !== undefined
      ) {
        next.data = { ...node.data, width: frameWidth, height: frameHeight };
      }
    }
    if (entering.has(node.id)) {
      next.className = [node.className, ENTERING_NODE_CLASS]
        .filter(Boolean)
        .join(" ");
    }
    return next;
  });
}

/**
 * The viewport that puts `nodeId` back at the screen point it had before
 * the layout changed, at the current zoom. Null when the card is gone.
 */
export function getAnchoredViewport(
  nodeId: string,
  screen: { x: number; y: number },
  target: Node[],
  zoom: number
): Viewport | null {
  const position = getAbsolutePosition(
    nodeId,
    new Map(target.map((node) => [node.id, node]))
  );
  if (!position) return null;
  return {
    x: screen.x - position.x * zoom,
    y: screen.y - position.y * zoom,
    zoom,
  };
}

export function interpolateViewport(
  from: Viewport,
  to: Viewport,
  t: number
): Viewport {
  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    zoom: lerp(from.zoom, to.zoom, t),
  };
}
