import { NODEHEIGHT, NODEWIDTH } from "src/components/task-node";
import { BaseTask, TaskAttachmentKind } from "src/types/base-task";
import {
  DEFAULT_VISIBLE_ATTACHMENT_KINDS,
  NodeDensity,
} from "src/types/settings";

const ATTACHMENT_LIST_WIDTH = 420;
const ATTACHMENT_ROW_HEIGHT = 20;
const ATTACHMENT_LIST_TOP_MARGIN = 6;

export const COMPACT_NODE_HEIGHT = 56;

export interface NodeDimensions {
  width: number;
  height: number;
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
  nodeDensity: NodeDensity = "comfortable"
): NodeDimensions {
  if (nodeDensity === "compact") {
    return { width: NODEWIDTH, height: COMPACT_NODE_HEIGHT };
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
    height: Math.max(NODEHEIGHT, totalHeight),
  };
}
