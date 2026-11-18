import { NODEHEIGHT, NODEWIDTH } from "src/components/task-node";
import { BaseTask, TaskAttachmentKind } from "src/types/base-task";
import type { TaskNodeData } from "src/types/task";
import type { BranchSummary, TaskLevel } from "src/lib/branch-model";
import { getMinimalNodeTitle, hasOpenWork } from "src/lib/minimal-card";
import {
  DEFAULT_VISIBLE_ATTACHMENT_KINDS,
  NodeDensity,
} from "src/types/settings";

const ATTACHMENT_LIST_WIDTH = 420;
const ATTACHMENT_ROW_HEIGHT = 20;
const ATTACHMENT_LIST_TOP_MARGIN = 6;

export const COMPACT_NODE_HEIGHT = 76;

/** Rough character width of a summary line at the card's text size. */
const SUMMARY_CHARS_PER_LINE = 30;
const SUMMARY_LINE_HEIGHT = 20;

/** Height the branch summary adds to a card (counts, next step, chips). */
export function estimateBranchSummaryHeight(
  summary: BranchSummary | undefined,
  level: TaskLevel | undefined
): number {
  if (!summary || !level || level === "task") return 0;
  let height = 14 + SUMMARY_LINE_HEIGHT; // padding + counts line
  if (level === "project") return height;
  const nextTitle = (summary.next ?? summary.suggested)?.summary ?? "";
  const nextLines = Math.min(
    2,
    Math.max(1, Math.ceil((nextTitle.length + 4) / SUMMARY_CHARS_PER_LINE))
  );
  height += nextLines * SUMMARY_LINE_HEIGHT + 4;
  if (summary.waitingOn.length > 0 || summary.related.length > 0) {
    height += 26;
  }
  return height;
}

/** Extra card height implied by a node's data (its branch summary). */
export function getNodeExtraHeight(
  data: Partial<TaskNodeData> | undefined
): number {
  return estimateBranchSummaryHeight(data?.branchSummary, data?.level);
}

export interface NodeDimensions {
  width: number;
  height: number;
}

/* Minimal cards: fixed sizes the card also applies to itself, so the layout
   and the rendered card always agree. */
export const MINIMAL_CARD_WIDTH = 260;
export const MINIMAL_ROW_WIDTH = 280;
export const MINIMAL_ROW_HEIGHT = 32;
const MINIMAL_ROW_TWO_LINE_HEIGHT = 50;
const MINIMAL_ROW_CHARS_PER_LINE = 30;
const MINIMAL_CARD_CHARS_PER_LINE = 24;
const MINIMAL_CARD_FRAME = 26; // padding and border
const MINIMAL_PROJECT_BORDER_EXTRA = 2;
const MINIMAL_CARD_TITLE_LINE = 20;
const MINIMAL_CARD_COUNTS_LINE = 20;
const MINIMAL_CARD_DUE_LINE = 20;
const MINIMAL_CARD_NEXT_LINE = 26;

/** Size of a minimal card: a summary card for branches, a row for tasks. */
export function getMinimalNodeDimensions(
  data: Pick<TaskNodeData, "task" | "level" | "branchSummary">
): NodeDimensions {
  const title = getMinimalNodeTitle(data.task);
  const level = data.level ?? "task";
  if (level === "task") {
    return {
      width: MINIMAL_ROW_WIDTH,
      height:
        title.length > MINIMAL_ROW_CHARS_PER_LINE
          ? MINIMAL_ROW_TWO_LINE_HEIGHT
          : MINIMAL_ROW_HEIGHT,
    };
  }
  const titleLines = title.length > MINIMAL_CARD_CHARS_PER_LINE ? 2 : 1;
  let height = MINIMAL_CARD_FRAME + titleLines * MINIMAL_CARD_TITLE_LINE;
  if (data.branchSummary) height += MINIMAL_CARD_COUNTS_LINE;
  if (level === "project") {
    height += MINIMAL_PROJECT_BORDER_EXTRA;
    if (data.task.dueDate) height += MINIMAL_CARD_DUE_LINE;
  }
  if (level === "branch" && hasOpenWork(data.branchSummary)) {
    height += MINIMAL_CARD_NEXT_LINE;
  }
  return { width: MINIMAL_CARD_WIDTH, height };
}

/** Layout size of a task node, for any card density. */
export function estimateTaskNodeDimensions(
  data: Partial<TaskNodeData> | undefined,
  showTags: boolean,
  visibleAttachmentKinds: TaskAttachmentKind[],
  nodeDensity: NodeDensity
): NodeDimensions {
  const task = data?.task;
  if (!task) return { width: NODEWIDTH, height: NODEHEIGHT };
  if (nodeDensity === "minimal") {
    return getMinimalNodeDimensions({
      task,
      level: data.level,
      branchSummary: data.branchSummary,
    });
  }
  return estimateNodeDimensions(
    task,
    showTags,
    visibleAttachmentKinds,
    nodeDensity,
    getNodeExtraHeight(data)
  );
}

export function getVisibleTaskAttachments(
  task: BaseTask,
  visibleAttachmentKinds: TaskAttachmentKind[] = DEFAULT_VISIBLE_ATTACHMENT_KINDS
) {
  const visibleKinds = new Set(visibleAttachmentKinds);
  return task.attachments.filter((attachment) =>
    visibleKinds.has(attachment.kind)
  );
}

/** Estimate the rendered task-card bounds used by the layout engine. */
export function estimateNodeDimensions(
  task: BaseTask,
  showTags: boolean = true,
  visibleAttachmentKinds: TaskAttachmentKind[] = DEFAULT_VISIBLE_ATTACHMENT_KINDS,
  nodeDensity: NodeDensity = "comfortable",
  extraHeight: number = 0
): NodeDimensions {
  if (nodeDensity === "minimal") {
    return getMinimalNodeDimensions({ task });
  }
  if (nodeDensity === "compact") {
    return { width: NODEWIDTH, height: COMPACT_NODE_HEIGHT + extraHeight };
  }

  const visibleAttachments = getVisibleTaskAttachments(
    task,
    visibleAttachmentKinds
  );
  const baseWidth =
    visibleAttachments.length > 0
      ? Math.max(NODEWIDTH, ATTACHMENT_LIST_WIDTH)
      : NODEWIDTH;
  const baseHeight = 60;
  const charsPerLine = 24;
  const lineHeight = 22;
  const summaryLines = Math.ceil(task.summary.length / charsPerLine);
  const summaryHeight = Math.max(1, summaryLines) * lineHeight;

  let tagsHeight = 0;
  if (showTags && task.tags.length > 0) {
    const tagsPerRow = 3;
    const tagRows = Math.ceil((task.tags.length + 1) / tagsPerRow);
    tagsHeight = tagRows * 28;
  }

  const attachmentsHeight =
    visibleAttachments.length > 0
      ? ATTACHMENT_LIST_TOP_MARGIN +
        visibleAttachments.length * ATTACHMENT_ROW_HEIGHT
      : 0;
  const quickCommentsHeight =
    task.type === "note" ? (task.quickComments ? 66 : 32) : 0;
  const padding = 24;
  const safetyMargin = 16;
  const totalHeight =
    baseHeight +
    summaryHeight +
    tagsHeight +
    quickCommentsHeight +
    attachmentsHeight +
    padding +
    safetyMargin;

  return {
    width: baseWidth,
    height: Math.max(NODEHEIGHT, totalHeight) + extraHeight,
  };
}
