import type { Node } from "reactflow";
import { NODEHEIGHT, NODEWIDTH } from "src/components/task-node";
import { getStatusCategory } from "src/lib/branch-model";
import type { TaskStatusConfig } from "src/lib/status-config";
import { getTagPaletteColor, TagColorPalette } from "src/lib/tag-color-manager";
import {
  getHomeRoots,
  NO_TASK_GROUP,
  orderTaskGroups,
  splitTaskGroupEdges,
} from "src/lib/task-groups";
import type { BaseTask } from "src/types/base-task";
import type { TaskGroupArrangement } from "src/types/settings";
import type { NodeDimensions } from "./dimensions";
import type { LayoutDirection, LayoutViewport } from "./packing";

export const TASK_GROUP_ZONE_TYPE = "taskGroupZone";
export const TASK_GROUP_ZONE_PADDING = 24;
/** Matches the header height in global.css. */
export const TASK_GROUP_ZONE_HEADER_HEIGHT = 60;
export const TASK_GROUP_ZONE_GAP = 40;
/** Horizontal gap between two projects in a zone. */
const ITEM_GAP_X = 72;
/** Vertical gap between two projects in a zone. */
const ITEM_GAP_Y = 48;
/** How many line lengths the rows and columns arrangements try. */
const WRAP_CANDIDATES = 40;
/** How many zone widths the grid arrangement tries per zone. */
const GRID_WIDTH_CANDIDATES = 16;
/** Zone shapes the grid tries, relative to the viewport's shape. */
const GRID_ASPECT_FACTORS = [0.35, 0.5, 0.7, 1, 1.4, 2];
/** Viewport shape assumed when the map's size is unknown. */
const DEFAULT_ZONE_VIEWPORT: LayoutViewport = { width: 1600, height: 1000 };

function isUsableViewport(
  viewport: LayoutViewport | undefined
): viewport is LayoutViewport {
  return (
    viewport !== undefined &&
    Number.isFinite(viewport.width) &&
    Number.isFinite(viewport.height) &&
    viewport.width > 0 &&
    viewport.height > 0
  );
}

export interface TaskGroupZoneData {
  /** Group name; empty for the zone of tasks without a group. */
  label: string;
  color?: string;
  /** Projects whose home is in this group. */
  projects: number;
  /** Tasks in this group that are not done or canceled. */
  open: number;
  width: number;
  height: number;
  layoutDirection: LayoutDirection;
}

export interface ZoneComponentInfo {
  group: string;
  /** Orders the components inside their zone. */
  sortKey: string;
  /** Active projects 0, open 1, finished 2. */
  statusRank: number;
}

export interface TaskGroupZoneOptions {
  /** Every group in display order; only groups holding components show. */
  order: string[];
  arrangement?: TaskGroupArrangement;
  describe: (_component: Node[]) => ZoneComponentInfo;
  zoneData: (
    _group: string
  ) => Omit<TaskGroupZoneData, "width" | "height" | "layoutDirection">;
}

export interface TaskGroupZoning<E> {
  /** Parent links that shape the layout. */
  layoutEdges: E[];
  /** Links between projects or groups: drawn faint, not laid out. */
  crossEdges: E[];
  zones: TaskGroupZoneOptions;
  /** Position of a task's group in the display order. */
  groupRank: (_taskId: string) => number;
}

interface ComponentBounds {
  nodes: Node[];
  minX: number;
  minY: number;
  width: number;
  height: number;
  info: ZoneComponentInfo;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function getTaskGroupZoneId(group: string): string {
  return `task-group-zone:${group}`;
}

function measureComponent(
  nodes: Node[],
  dimensions: Map<string, NodeDimensions>,
  info: ZoneComponentInfo
): ComponentBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const size = dimensions.get(node.id) ?? {
      width: NODEWIDTH,
      height: NODEHEIGHT,
    };
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + size.width);
    maxY = Math.max(maxY, node.position.y + size.height);
  }
  return { nodes, minX, minY, width: maxX - minX, height: maxY - minY, info };
}

interface Offset {
  x: number;
  y: number;
}

interface Placement {
  offsets: Offset[];
  width: number;
  height: number;
}

interface ZoneContent {
  group: string;
  items: ComponentBounds[];
}

interface ZoneBox extends ZoneContent {
  placement: Placement;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Lay out a zone's projects along lines: rows run left to right with tops
 * aligned, columns run top to bottom with left edges aligned. A new line
 * starts once a line would pass `wrap`.
 */
function packLines(
  items: ComponentBounds[],
  alongX: boolean,
  wrap: number
): Placement {
  const gapAlong = alongX ? ITEM_GAP_X : ITEM_GAP_Y;
  const gapAcross = alongX ? ITEM_GAP_Y : ITEM_GAP_X;
  const offsets: Offset[] = [];
  let along = 0;
  let across = 0;
  let lineDepth = 0;
  let maxAlong = 0;
  for (const item of items) {
    const size = alongX ? item.width : item.height;
    const depth = alongX ? item.height : item.width;
    if (along > 0 && along + size > wrap) {
      along = 0;
      across += lineDepth + gapAcross;
      lineDepth = 0;
    }
    offsets.push(alongX ? { x: along, y: across } : { x: across, y: along });
    maxAlong = Math.max(maxAlong, along + size);
    along += size + gapAlong;
    lineDepth = Math.max(lineDepth, depth);
  }
  const totalAcross = across + lineDepth;
  return alongX
    ? { offsets, width: maxAlong, height: totalAcross }
    : { offsets, width: totalAcross, height: maxAlong };
}

interface SkylineSegment {
  x: number;
  w: number;
  y: number;
}

/**
 * Skyline packing within `width`: each project goes to the highest free
 * spot it fits (leftmost on ties), so short projects fill the space beside
 * tall ones instead of leaving a gap under a shared line.
 */
function packSkyline(items: ComponentBounds[], width: number): Placement {
  const limit = width + ITEM_GAP_X;
  let skyline: SkylineSegment[] = [{ x: 0, w: limit, y: 0 }];
  const offsets: Offset[] = [];
  let usedWidth = 0;
  let usedHeight = 0;
  for (const item of items) {
    const footprint = item.width + ITEM_GAP_X;
    let best: Offset | null = null;
    for (const start of skyline) {
      if (start.x + footprint > limit + 0.5) continue;
      let y = 0;
      for (const segment of skyline) {
        if (segment.x + segment.w <= start.x) continue;
        if (segment.x >= start.x + footprint) break;
        y = Math.max(y, segment.y);
      }
      if (!best || y < best.y - 0.5) best = { x: start.x, y };
    }
    // Wider than the zone: start a fresh line below everything.
    const spot = best ?? {
      x: 0,
      y: usedHeight > 0 ? usedHeight + ITEM_GAP_Y : 0,
    };
    offsets.push(spot);
    usedWidth = Math.max(usedWidth, spot.x + item.width);
    usedHeight = Math.max(usedHeight, spot.y + item.height);

    const end = spot.x + footprint;
    const next: SkylineSegment[] = [];
    for (const segment of skyline) {
      const segmentEnd = segment.x + segment.w;
      if (segmentEnd <= spot.x || segment.x >= end) {
        next.push(segment);
        continue;
      }
      if (segment.x < spot.x) {
        next.push({ x: segment.x, w: spot.x - segment.x, y: segment.y });
      }
      if (segmentEnd > end) {
        next.push({ x: end, w: segmentEnd - end, y: segment.y });
      }
    }
    next.push({
      x: spot.x,
      w: footprint,
      y: spot.y + item.height + ITEM_GAP_Y,
    });
    next.sort((left, right) => left.x - right.x);
    skyline = [];
    for (const segment of next) {
      const last = skyline[skyline.length - 1];
      if (last && Math.abs(last.y - segment.y) < 0.5) {
        last.w += segment.w;
      } else {
        skyline.push({ ...segment });
      }
    }
  }
  return { offsets, width: usedWidth, height: usedHeight };
}

/** Evenly spaced lengths from `shortest` to `longest`. */
function candidateLengths(
  shortest: number,
  longest: number,
  count: number
): number[] {
  const lengths = [shortest];
  for (let step = 1; step <= count; step++) {
    lengths.push(shortest + ((longest - shortest) * step) / count);
  }
  return lengths;
}

function outerSize(placement: Placement) {
  return {
    width: placement.width + TASK_GROUP_ZONE_PADDING * 2,
    height:
      placement.height +
      TASK_GROUP_ZONE_HEADER_HEIGHT +
      TASK_GROUP_ZONE_PADDING,
  };
}

/** Zones as bands (rows) or side-by-side columns, each holding lines. */
function arrangeLines(
  zones: ZoneContent[],
  alongX: boolean,
  wrap: number
): ZoneBox[] {
  const placed = zones.map((zone) => ({
    ...zone,
    placement: packLines(zone.items, alongX, wrap),
  }));
  const outers = placed.map((zone) => outerSize(zone.placement));
  const uniformWidth = Math.max(...outers.map((outer) => outer.width));
  const uniformHeight = Math.max(...outers.map((outer) => outer.height));
  let cursor = 0;
  return placed.map((zone, index) => {
    const width = alongX ? uniformWidth : outers[index].width;
    const height = alongX ? outers[index].height : uniformHeight;
    const box = {
      ...zone,
      x: alongX ? 0 : cursor,
      y: alongX ? cursor : 0,
      width,
      height,
    };
    cursor += (alongX ? height : width) + TASK_GROUP_ZONE_GAP;
    return box;
  });
}

function offsetsOf(sizes: number[]): number[] {
  let cursor = 0;
  return sizes.map((size) => {
    const start = cursor;
    cursor += size + TASK_GROUP_ZONE_GAP;
    return start;
  });
}

/**
 * Zones in a grid of `columns`, read row by row. Each zone is repacked to
 * its column's width and stretched to fill its cell, so zone edges line up.
 */
function arrangeGrid(
  zones: (ZoneContent & { placement: Placement })[],
  columns: number
): ZoneBox[] {
  const columnOf = (index: number) => index % columns;
  const rowOf = (index: number) => Math.floor(index / columns);
  const columnWidths = new Array<number>(columns).fill(0);
  zones.forEach((zone, index) => {
    const column = columnOf(index);
    columnWidths[column] = Math.max(
      columnWidths[column],
      outerSize(zone.placement).width
    );
  });
  const repacked = zones.map((zone, index) => {
    const inner = columnWidths[columnOf(index)] - TASK_GROUP_ZONE_PADDING * 2;
    const placement = packSkyline(zone.items, inner);
    return placement.height < zone.placement.height
      ? { ...zone, placement }
      : zone;
  });
  const rowHeights = new Array<number>(Math.ceil(zones.length / columns)).fill(
    0
  );
  repacked.forEach((zone, index) => {
    const row = rowOf(index);
    rowHeights[row] = Math.max(
      rowHeights[row],
      outerSize(zone.placement).height
    );
  });
  const columnX = offsetsOf(columnWidths);
  const rowY = offsetsOf(rowHeights);
  return repacked.map((zone, index) => ({
    ...zone,
    x: columnX[columnOf(index)],
    y: rowY[rowOf(index)],
    width: columnWidths[columnOf(index)],
    height: rowHeights[rowOf(index)],
  }));
}

/** Pack a zone to the width whose outer shape is closest to `aspect`. */
function packToAspect(items: ComponentBounds[], aspect: number): Placement {
  const widths = items.map((item) => item.width);
  const longest =
    widths.reduce((sum, width) => sum + width, 0) +
    ITEM_GAP_X * (widths.length - 1);
  let best = packSkyline(items, Math.max(...widths));
  let bestScore = Infinity;
  for (const width of candidateLengths(
    Math.max(...widths),
    longest,
    GRID_WIDTH_CANDIDATES
  )) {
    const placement = packSkyline(items, width);
    const outer = outerSize(placement);
    const score = Math.abs(Math.log(outer.width / outer.height / aspect));
    if (score < bestScore - 1e-9) {
      best = placement;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Place laid-out components (one per project) into one labelled zone per
 * task group in the chosen arrangement, picking line lengths or the grid
 * shape so the whole map shows as large as possible in the viewport.
 * Returns the moved component nodes and the zone frames.
 */
export function packComponentsIntoZones(
  components: Node[][],
  dimensions: Map<string, NodeDimensions>,
  direction: LayoutDirection,
  viewport: LayoutViewport | undefined,
  options: TaskGroupZoneOptions
): { nodes: Node[]; zones: Node[] } {
  if (components.length === 0) return { nodes: [], zones: [] };
  const arrangement = options.arrangement ?? "rows";
  const measured = components.map((nodes) =>
    measureComponent(nodes, dimensions, options.describe(nodes))
  );
  const byGroup = new Map<string, ComponentBounds[]>();
  for (const item of measured) {
    const list = byGroup.get(item.info.group) ?? [];
    list.push(item);
    byGroup.set(item.info.group, list);
  }
  const groups = orderTaskGroups(
    [...options.order.filter((group) => byGroup.has(group)), ...byGroup.keys()],
    options.order
  );
  const view = isUsableViewport(viewport) ? viewport : DEFAULT_ZONE_VIEWPORT;
  const fitScale = (boxes: ZoneBox[]) => {
    const width = Math.max(...boxes.map((box) => box.x + box.width));
    const height = Math.max(...boxes.map((box) => box.y + box.height));
    return Math.min(view.width / width, view.height / height);
  };

  let boxes: ZoneBox[] = [];
  let bestScale = -Infinity;
  const consider = (candidate: ZoneBox[]) => {
    const scale = fitScale(candidate);
    if (scale > bestScale + 1e-9) {
      boxes = candidate;
      bestScale = scale;
    }
  };

  if (arrangement === "grid") {
    // Tall projects first, so shorter ones fill the space beside them.
    const zones = groups.map((group) => ({
      group,
      items: [...(byGroup.get(group) ?? [])].sort(
        (left, right) =>
          left.info.statusRank - right.info.statusRank ||
          right.height - left.height ||
          compareText(left.info.sortKey, right.info.sortKey)
      ),
    }));
    const viewAspect = view.width / view.height;
    for (const factor of GRID_ASPECT_FACTORS) {
      const packed = zones.map((zone) => ({
        ...zone,
        placement: packToAspect(zone.items, viewAspect * factor),
      }));
      for (let columns = 1; columns <= packed.length; columns++) {
        consider(arrangeGrid(packed, columns));
      }
    }
  } else {
    const alongX = arrangement === "rows";
    const zones = groups.map((group) => ({
      group,
      items: [...(byGroup.get(group) ?? [])].sort((left, right) =>
        compareText(left.info.sortKey, right.info.sortKey)
      ),
    }));
    // Try line lengths from the longest project up to everything on one
    // line per zone.
    const sizes = measured.map((item) => (alongX ? item.width : item.height));
    const gap = alongX ? ITEM_GAP_X : ITEM_GAP_Y;
    const longest =
      sizes.reduce((sum, size) => sum + size, 0) + gap * (sizes.length - 1);
    for (const wrap of candidateLengths(
      Math.max(...sizes),
      longest,
      WRAP_CANDIDATES
    )) {
      consider(arrangeLines(zones, alongX, wrap));
    }
  }

  const nodes: Node[] = [];
  const zones: Node[] = [];
  for (const box of boxes) {
    zones.push({
      id: getTaskGroupZoneId(box.group),
      type: TASK_GROUP_ZONE_TYPE,
      position: { x: box.x, y: box.y },
      data: {
        ...options.zoneData(box.group),
        width: box.width,
        height: box.height,
        layoutDirection: direction,
      } satisfies TaskGroupZoneData,
      style: { width: box.width, height: box.height },
      className: "tasks-map-task-group-zone-node",
      selectable: false,
      draggable: false,
      connectable: false,
      focusable: false,
      zIndex: -2,
    });
    box.items.forEach((item, index) => {
      const offset = box.placement.offsets[index];
      const dx = box.x + TASK_GROUP_ZONE_PADDING + offset.x - item.minX;
      const dy = box.y + TASK_GROUP_ZONE_HEADER_HEIGHT + offset.y - item.minY;
      item.nodes.forEach((node) =>
        nodes.push({
          ...node,
          position: { x: node.position.x + dx, y: node.position.y + dy },
        })
      );
    });
  }
  return { nodes, zones };
}

const CATEGORY_RANK = { active: 0, open: 1, closed: 2 } as const;

function taskLabel(task: BaseTask): string {
  return (task.summary || task.link || task.id).trim().toLowerCase();
}

export interface TaskGroupZoningInput<E> {
  /** Tasks on the map. */
  tasks: BaseTask[];
  /** Parent links between them. */
  edges: E[];
  /** Every task's group, resolved over the whole vault. */
  groups: ReadonlyMap<string, string>;
  order: readonly string[];
  statuses: TaskStatusConfig[];
  tagColorPalette?: TagColorPalette;
  arrangement?: TaskGroupArrangement;
}

/**
 * Prepare a grouped map: which links shape the layout, how components are
 * sorted into zones, and what each zone shows. Returns null when the map
 * holds fewer than two groups, so it keeps its ordinary layout.
 */
export function createTaskGroupZoning<
  E extends { source: string; target: string },
>(input: TaskGroupZoningInput<E>): TaskGroupZoning<E> | null {
  const { tasks, groups, statuses } = input;
  const groupOf = (id: string) => groups.get(id) ?? NO_TASK_GROUP;
  const present = new Set(tasks.map((task) => groupOf(task.id)));
  if (present.size < 2) return null;

  const order = orderTaskGroups(present, input.order);
  const rank = new Map(order.map((group, index) => [group, index]));
  const { layoutEdges, crossEdges } = splitTaskGroupEdges(
    input.edges,
    tasks,
    groups
  );
  const roots = getHomeRoots(tasks);
  const categoryOf = (task: BaseTask) =>
    getStatusCategory(task.status, statuses);

  const counts = new Map<string, { projects: number; open: number }>();
  for (const task of tasks) {
    const group = groupOf(task.id);
    const count = counts.get(group) ?? { projects: 0, open: 0 };
    if (task.isProject && roots.get(task.id) === task.id) count.projects++;
    if (categoryOf(task) !== "closed") count.open++;
    counts.set(group, count);
  }

  // Project boxes ("group by project") hold their tasks as child nodes, so
  // a box takes the group of its first task.
  const projectBoxGroups = new Map<string, string>();
  for (const task of tasks) {
    if (task.projects.length !== 1) continue;
    const label = task.projects[0];
    if (!projectBoxGroups.has(label)) {
      projectBoxGroups.set(label, groupOf(task.id));
    }
  }

  const describe = (component: Node[]): ZoneComponentInfo => {
    const ids = new Set(component.map((node) => node.id));
    const votes = new Map<string, number>();
    const tasksHere: BaseTask[] = [];
    for (const node of component) {
      const task = node.data?.task as BaseTask | undefined;
      let group: string | undefined;
      if (task) {
        tasksHere.push(task);
        group = groupOf(task.id);
      } else if (node.type === "projectGroup") {
        group = projectBoxGroups.get(String(node.data?.label ?? ""));
      }
      if (group !== undefined) votes.set(group, (votes.get(group) ?? 0) + 1);
    }
    const group =
      [...votes].sort(
        ([leftGroup, leftVotes], [rightGroup, rightVotes]) =>
          rightVotes - leftVotes ||
          (rank.get(leftGroup) ?? 0) - (rank.get(rightGroup) ?? 0)
      )[0]?.[0] ?? NO_TASK_GROUP;

    const rootsHere = tasksHere
      .filter((task) => !task.incomingLinks.some((id) => ids.has(id)))
      .sort((left, right) => compareText(taskLabel(left), taskLabel(right)));
    const root = rootsHere[0] ?? tasksHere[0];
    const statusRank = root ? CATEGORY_RANK[categoryOf(root)] : 9;
    const sortKey = root
      ? `${statusRank}\u0000${taskLabel(root)}\u0000${root.id}`
      : `9\u0000${[...ids].sort(compareText)[0] ?? ""}`;
    return { group, sortKey, statusRank };
  };

  return {
    layoutEdges,
    crossEdges,
    groupRank: (taskId) => rank.get(groupOf(taskId)) ?? order.length,
    zones: {
      order,
      arrangement: input.arrangement ?? "rows",
      describe,
      zoneData: (group) => ({
        label: group,
        color:
          group === NO_TASK_GROUP
            ? undefined
            : getTagPaletteColor(group, input.tagColorPalette),
        projects: counts.get(group)?.projects ?? 0,
        open: counts.get(group)?.open ?? 0,
      }),
    },
  };
}
