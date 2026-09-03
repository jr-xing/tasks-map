import type { App, HoverParent } from "obsidian";
import type { BaseTask } from "src/types/task";

const TASK_CARD_INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "[role='button']",
  "[contenteditable='true']",
  ".react-flow__handle",
  ".tasks-map-add-tag-button",
  ".tasks-map-tag-remove-icon",
  ".tasks-map-quick-update",
  ".tasks-map-task-attachments",
].join(", ");

interface ClosestElementTarget {
  closest(_selector: string): Element | null;
}

interface TriggerTaskHoverPreviewOptions {
  app: App;
  task: BaseTask;
  event: MouseEvent;
  source: string;
  hoverParent: HoverParent;
  targetEl: HTMLElement;
  originTarget: EventTarget | null;
}

function hasClosest(
  target: EventTarget | null
): target is EventTarget & ClosestElementTarget {
  return (
    !!target &&
    typeof (target as Partial<ClosestElementTarget>).closest === "function"
  );
}

export function isTaskCardInteractiveTarget(
  target: EventTarget | null,
  cardEl?: HTMLElement
): boolean {
  if (!hasClosest(target)) return false;
  const interactiveTarget = target.closest(TASK_CARD_INTERACTIVE_SELECTOR);
  if (!interactiveTarget) return false;
  if (!cardEl) return true;

  // ReactFlow's node wrapper has role="button" for keyboard accessibility.
  // It sits outside the task card and must not make the whole card look like
  // an interactive child control.
  return interactiveTarget !== cardEl && cardEl.contains(interactiveTarget);
}

export function triggerTaskHoverPreview({
  app,
  task,
  event,
  source,
  hoverParent,
  targetEl,
  originTarget,
}: TriggerTaskHoverPreviewOptions): boolean {
  if (isTaskCardInteractiveTarget(originTarget, targetEl)) return false;

  const path = task.link.trim();
  const file = path ? app.vault.getFileByPath(path) : null;
  if (!file) return false;

  app.workspace.trigger("hover-link", {
    event,
    source,
    hoverParent,
    targetEl,
    linktext: file.path,
    sourcePath: file.path,
  });
  return true;
}
