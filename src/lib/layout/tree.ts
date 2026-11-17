import type { NodeDimensions } from "./dimensions";
import type { LayoutDirection } from "./packing";

/**
 * Git-graph style "tree" layout.
 *
 * Every task gets its own row, in outline order: a task is followed by its
 * subtree. Projects (roots) sit at the top of their block and their direct
 * tasks hang on the project's own line (lane 0). A task with subtasks opens a
 * branch one lane to the right, so the number of lanes grows with nesting
 * depth, never with how many siblings a task has. That keeps the gutter narrow
 * enough for a slim sidebar tab.
 *
 * A task with several parents is placed under the parent that comes last in
 * row order (so every parent is above it); the other relations are drawn as
 * dashed "link" lines on extra lanes at the right edge of the gutter.
 *
 * All geometry is computed here in plain numbers so it can be unit tested;
 * the view only turns it into ReactFlow nodes and SVG paths.
 */

export const TREE_LANE_WIDTH = 18;
export const TREE_GUTTER_PADDING = 8;
export const TREE_ROW_GAP = 10;
export const TREE_COLUMN_GAP = 24;
export const TREE_BLOCK_GAP = 24;
/** In vertical mode the dot lines up with the card title, not its middle. */
export const TREE_ANCHOR_MAX_OFFSET = 38;
export const TREE_MAX_LINK_LANES = 3;

export interface TreeEdgeInput {
  source: string;
  target: string;
}

export interface TreeLayoutInput {
  nodeIds: string[];
  /** Parent -> child relations (ReactFlow edge direction). */
  edges: TreeEdgeInput[];
  dimensions: Map<string, NodeDimensions>;
  direction: LayoutDirection;
  /** Orders roots and siblings; defaults to comparing ids. */
  compare?: (_left: string, _right: string) => number;
}

export interface TreeRow {
  id: string;
  index: number;
  lane: number;
  parentId: string | null;
  isRoot: boolean;
  /** Start of the row along the main axis (y when vertical, x when not). */
  offset: number;
  size: number;
  /** Main-axis coordinate of the row's dot. */
  anchor: number;
}

export interface TreeLink {
  source: string;
  target: string;
  lane: number;
}

export type TreeLineKind = "branch" | "tick" | "link";

export interface TreeLine {
  key: string;
  kind: TreeLineKind;
  path: string;
}

export interface TreeDot {
  id: string;
  x: number;
  y: number;
}

export interface TreeLayout {
  rows: TreeRow[];
  links: TreeLink[];
  laneCount: number;
  positions: Map<string, { x: number; y: number }>;
  gutter: {
    width: number;
    height: number;
    lines: TreeLine[];
    dots: TreeDot[];
  };
}

interface Point {
  x: number;
  y: number;
}

const defaultCompare = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

interface TreeOrder {
  order: string[];
  parentOf: Map<string, string | null>;
  links: TreeEdgeInput[];
}

/** Outline order plus each task's tree parent; other relations are links. */
export function orderTreeRows(
  nodeIds: string[],
  edges: TreeEdgeInput[],
  compare: (_left: string, _right: string) => number = defaultCompare
): TreeOrder {
  const known = new Set(nodeIds);
  const childrenOf = new Map<string, string[]>();
  const pendingParents = new Map<string, number>();
  const seenEdges = new Set<string>();
  const uniqueEdges: TreeEdgeInput[] = [];
  nodeIds.forEach((id) => pendingParents.set(id, 0));

  for (const edge of edges) {
    const { source, target } = edge;
    if (source === target || !known.has(source) || !known.has(target)) {
      continue;
    }
    const key = `${source}\u0000${target}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    uniqueEdges.push({ source, target });
    const children = childrenOf.get(source) ?? [];
    children.push(target);
    childrenOf.set(source, children);
    pendingParents.set(target, (pendingParents.get(target) ?? 0) + 1);
  }
  childrenOf.forEach((children) => children.sort(compare));

  const sortedIds = [...new Set(nodeIds)].sort(compare);
  const emitted = new Set<string>();
  const order: string[] = [];
  const parentOf = new Map<string, string | null>();

  const walk = (rootId: string) => {
    parentOf.set(rootId, null);
    const stack = [rootId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (emitted.has(id)) continue;
      emitted.add(id);
      order.push(id);
      const ready: string[] = [];
      for (const child of childrenOf.get(id) ?? []) {
        if (emitted.has(child)) continue;
        const remaining = (pendingParents.get(child) ?? 0) - 1;
        pendingParents.set(child, remaining);
        if (remaining === 0) {
          parentOf.set(child, id);
          ready.push(child);
        }
      }
      // Reverse so the first sibling is popped (and laid out) first.
      for (let index = ready.length - 1; index >= 0; index -= 1) {
        stack.push(ready[index]);
      }
    }
  };

  sortedIds
    .filter((id) => pendingParents.get(id) === 0)
    .forEach((id) => {
      if (!emitted.has(id)) walk(id);
    });
  // Whatever is left sits on a dependency cycle; break it at the first task.
  for (const id of sortedIds) {
    if (!emitted.has(id)) walk(id);
  }

  const links = uniqueEdges.filter(
    (edge) => parentOf.get(edge.target) !== edge.source
  );
  return { order, parentOf, links };
}

/** Give overlapping link spans different lanes, reusing lanes once free. */
function assignLinkLanes(
  links: TreeEdgeInput[],
  rowIndex: Map<string, number>
): TreeLink[] {
  const spans = links
    .map((link) => {
      const from = rowIndex.get(link.source) ?? 0;
      const to = rowIndex.get(link.target) ?? 0;
      return { link, start: Math.min(from, to), end: Math.max(from, to) };
    })
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const laneEnds: number[] = [];
  return spans.map(({ link, start, end }) => {
    let lane = laneEnds.findIndex((laneEnd) => laneEnd < start);
    if (lane === -1) {
      if (laneEnds.length < TREE_MAX_LINK_LANES) {
        lane = laneEnds.length;
        laneEnds.push(end);
      } else {
        lane = laneEnds.indexOf(Math.min(...laneEnds));
      }
    }
    laneEnds[lane] = Math.max(laneEnds[lane] ?? end, end);
    return { source: link.source, target: link.target, lane };
  });
}

function laneCenter(lane: number): number {
  return TREE_GUTTER_PADDING + lane * TREE_LANE_WIDTH + TREE_LANE_WIDTH / 2;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function layoutTree({
  nodeIds,
  edges,
  dimensions,
  direction,
  compare = defaultCompare,
}: TreeLayoutInput): TreeLayout {
  const vertical = direction === "Vertical";
  const { order, parentOf, links } = orderTreeRows(nodeIds, edges, compare);

  const laneOf = new Map<string, number>();
  const hasChildren = new Set<string>();
  for (const id of order) {
    const parentId = parentOf.get(id) ?? null;
    if (parentId === null) {
      laneOf.set(id, 0);
      continue;
    }
    hasChildren.add(parentId);
    const parentLane = laneOf.get(parentId) ?? 0;
    const parentIsRoot = parentOf.get(parentId) === null;
    laneOf.set(id, parentIsRoot ? parentLane : parentLane + 1);
  }

  const rowGap = vertical ? TREE_ROW_GAP : TREE_COLUMN_GAP;
  const rows: TreeRow[] = [];
  let cursor = 0;
  order.forEach((id, index) => {
    const parentId = parentOf.get(id) ?? null;
    if (index > 0) cursor += parentId === null ? TREE_BLOCK_GAP : rowGap;
    const dims = dimensions.get(id) ?? { width: 250, height: 76 };
    const size = vertical ? dims.height : dims.width;
    rows.push({
      id,
      index,
      lane: laneOf.get(id) ?? 0,
      parentId,
      isRoot: parentId === null,
      offset: cursor,
      size,
      anchor:
        cursor +
        (vertical ? Math.min(size / 2, TREE_ANCHOR_MAX_OFFSET) : size / 2),
    });
    cursor += size;
  });

  const rowById = new Map(rows.map((row) => [row.id, row]));
  const rowIndex = new Map(rows.map((row) => [row.id, row.index]));
  const laneCount = rows.reduce((max, row) => Math.max(max, row.lane + 1), 0);
  const treeLinks = assignLinkLanes(links, rowIndex);
  const linkLaneCount = treeLinks.reduce(
    (max, link) => Math.max(max, link.lane + 1),
    0
  );
  const gutterCross =
    TREE_GUTTER_PADDING * 2 + (laneCount + linkLaneCount) * TREE_LANE_WIDTH;
  const totalLength = cursor;

  // Geometry is built along (main, cross) and mapped to screen axes here.
  const point = (main: number, cross: number): Point =>
    vertical
      ? { x: round(cross), y: round(main) }
      : { x: round(main), y: round(cross) };
  const fmt = ({ x, y }: Point) => `${x} ${y}`;

  const lines: TreeLine[] = [];
  const lastChildOf = new Map<string, TreeRow>();
  const firstChildOf = new Map<string, TreeRow>();
  for (const row of rows) {
    if (!row.parentId) continue;
    if (!firstChildOf.has(row.parentId)) firstChildOf.set(row.parentId, row);
    lastChildOf.set(row.parentId, row);
  }

  for (const row of rows) {
    if (!hasChildren.has(row.id)) continue;
    const first = firstChildOf.get(row.id)!;
    const last = lastChildOf.get(row.id)!;
    const from = laneCenter(row.lane);
    const lane = laneCenter(first.lane);
    let path: string;
    if (first.lane === row.lane) {
      path = `M ${fmt(point(row.anchor, from))} L ${fmt(point(last.anchor, lane))}`;
    } else {
      const bend = (first.anchor - row.anchor) / 2;
      path =
        `M ${fmt(point(row.anchor, from))} ` +
        `C ${fmt(point(row.anchor + bend, from))} ` +
        `${fmt(point(first.anchor - bend, lane))} ` +
        `${fmt(point(first.anchor, lane))}` +
        (last.id === first.id ? "" : ` L ${fmt(point(last.anchor, lane))}`);
    }
    lines.push({ key: `branch:${row.id}`, kind: "branch", path });
  }

  for (const row of rows) {
    lines.push({
      key: `tick:${row.id}`,
      kind: "tick",
      path: `M ${fmt(point(row.anchor, laneCenter(row.lane)))} L ${fmt(
        point(row.anchor, gutterCross)
      )}`,
    });
  }

  for (const link of treeLinks) {
    const source = rowById.get(link.source);
    const target = rowById.get(link.target);
    if (!source || !target) continue;
    const linkLane = laneCenter(laneCount + link.lane);
    lines.push({
      key: `link:${link.source}:${link.target}`,
      kind: "link",
      path:
        `M ${fmt(point(source.anchor, laneCenter(source.lane)))} ` +
        `L ${fmt(point(source.anchor, linkLane))} ` +
        `L ${fmt(point(target.anchor, linkLane))} ` +
        `L ${fmt(point(target.anchor, laneCenter(target.lane)))}`,
    });
  }

  const dots: TreeDot[] = rows.map((row) => ({
    id: row.id,
    ...point(row.anchor, laneCenter(row.lane)),
  }));

  const positions = new Map<string, { x: number; y: number }>();
  for (const row of rows) {
    positions.set(row.id, point(row.offset, gutterCross));
  }

  const gutterSize = point(totalLength, gutterCross);
  return {
    rows,
    links: treeLinks,
    laneCount,
    positions,
    gutter: {
      width: rows.length === 0 ? 0 : gutterSize.x,
      height: rows.length === 0 ? 0 : gutterSize.y,
      lines,
      dots,
    },
  };
}

export const TREE_VIEWPORT_PADDING = 16;
export const TREE_MIN_ZOOM = 0.5;

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface VisibleArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Camera for tree mode: scale so the tree's cross axis fits (never above
 * 100%, never below 50%), then show its start. A vertical tree scrolls down
 * from the first project instead of shrinking to fit its whole length.
 */
export function fitTreeViewport(
  bounds: Bounds,
  visibleArea: VisibleArea,
  direction: LayoutDirection
): { x: number; y: number; zoom: number } {
  const padding = TREE_VIEWPORT_PADDING;
  const available =
    direction === "Vertical"
      ? visibleArea.width - padding * 2
      : visibleArea.height - padding * 2;
  const extent = direction === "Vertical" ? bounds.width : bounds.height;
  const fit = extent > 0 ? available / extent : 1;
  const zoom = Math.max(TREE_MIN_ZOOM, Math.min(1, fit));
  return {
    x: visibleArea.left + padding - bounds.x * zoom,
    y: visibleArea.top + padding - bounds.y * zoom,
    zoom,
  };
}
