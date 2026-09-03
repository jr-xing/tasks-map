import type { App } from "obsidian";
import type { BaseTask } from "src/types/task";
import { openFileInObsidian } from "./open-file";

const KANBAN_CARD_INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "[role='button']",
  "[contenteditable='true']",
].join(", ");

interface KanbanOpenNoteOptions {
  openInNewTab?: boolean;
}

export function canOpenKanbanTaskNote(app: App, task: BaseTask): boolean {
  const path = task.link.trim();
  return path.length > 0 && app.vault.getFileByPath(path) !== null;
}

export async function openKanbanTaskNote(
  app: App,
  task: BaseTask,
  options: KanbanOpenNoteOptions = {}
): Promise<boolean> {
  const path = task.link.trim();
  const file = path ? app.vault.getFileByPath(path) : null;
  if (!file) return false;

  await openFileInObsidian(app, file.path, file.path, file.path, options);
  return true;
}

export function isKanbanCardInteractiveTarget(
  target: EventTarget | null
): boolean {
  const candidate = target as {
    closest?: (_selector: string) => Element | null;
  } | null;
  return candidate?.closest?.(KANBAN_CARD_INTERACTIVE_SELECTOR) != null;
}

export function shouldOpenKanbanCardOnDoubleClick(options: {
  enabled: boolean;
  isDragging: boolean;
  target: EventTarget | null;
}): boolean {
  return (
    options.enabled &&
    !options.isDragging &&
    !isKanbanCardInteractiveTarget(options.target)
  );
}
