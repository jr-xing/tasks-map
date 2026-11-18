import { App, Menu, Notice } from "obsidian";
import { DatePickerModal } from "src/lib/date-picker-modal";
import { TextInputModal } from "src/lib/text-input-modal";
import { formatContexts, formatShortDate } from "src/lib/minimal-card";
import { shiftIsoDate } from "src/lib/note-context";
import { normalizeDueDate } from "src/lib/task-dates";
import {
  getPriorityByValue,
  TaskPriorityConfig,
  visiblePriorityOptions,
} from "src/lib/priority-config";
import { TaskStatusConfig } from "src/lib/status-config";
import {
  addStarToTaskInVault,
  removeStarFromTaskInVault,
  updateTaskPriorityInVault,
  updateTaskStatusInVault,
} from "src/lib/utils";
import { NoteTask } from "src/types/note-task";
import { BaseTask } from "src/types/task";
import { t } from "../i18n";

type DateField = "due" | "scheduled";

export interface MenuPoint {
  x: number;
  y: number;
}

/** Gap between a button's bottom edge and the menu it opens. */
const MENU_OFFSET = 4;

/**
 * Where a button's menu opens: under the button, aligned to its left edge.
 * Falls back to the pointer when there is no element to anchor to.
 */
export function menuPointBelow(
  rect: Pick<DOMRect, "left" | "bottom"> | null,
  pointer: MenuPoint
): MenuPoint {
  return rect ? { x: rect.left, y: rect.bottom + MENU_OFFSET } : pointer;
}

async function runWrite(write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (error) {
    console.error("Tasks Map: task update from the note strip failed", error);
    new Notice(t("note_context.update_failed"));
  }
}

export function setTaskStatus(
  app: App,
  task: BaseTask,
  statusId: string,
  statuses: TaskStatusConfig[]
): Promise<void> {
  return runWrite(() => updateTaskStatusInVault(task, statusId, app, statuses));
}

/** Every configured status, the current one ticked. */
export function showStatusMenu(
  app: App,
  task: BaseTask,
  statuses: TaskStatusConfig[],
  at: MenuPoint
): void {
  const menu = new Menu();
  for (const status of statuses) {
    menu.addItem((item) =>
      item
        .setTitle(status.label)
        .setChecked(status.id === task.status)
        .onClick(() => setTaskStatus(app, task, status.id, statuses))
    );
  }
  menu.showAtPosition(at);
}

function showPriorityMenuAt(
  app: App,
  task: BaseTask,
  priorities: TaskPriorityConfig[],
  at: MenuPoint
): void {
  const menu = new Menu();
  const current = getPriorityByValue(task.priority, priorities).value;
  for (const priority of visiblePriorityOptions(priorities)) {
    menu.addItem((item) =>
      item
        .setTitle(priority.label)
        .setChecked(priority.value === current)
        .onClick(() =>
          runWrite(() => updateTaskPriorityInVault(task, priority.value, app))
        )
    );
  }
  menu.showAtPosition(at);
}

/** The task's date, read fresh from its frontmatter. */
/** Every configured priority, the current one ticked. */
export function showPriorityMenu(
  app: App,
  task: BaseTask,
  priorities: TaskPriorityConfig[],
  at: MenuPoint
): void {
  showPriorityMenuAt(app, task, priorities, at);
}

/** Every distinct value of the group property across tasks, sorted. */
export function collectGroupValues(tasks: BaseTask[]): string[] {
  const values = new Set<string>();
  tasks.forEach((task) => task.groupValues.forEach((v) => values.add(v)));
  return [...values].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}

/** Add `value` when missing, remove it when present. */
export function toggleValue(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((existing) => existing !== value)
    : [...values, value];
}

/**
 * The task's contexts (the configured group property): known values are
 * ticked and toggle on click; "New context…" adds one.
 */
/** Where the context menu reads and writes: property and known values. */
export interface ContextSource {
  property: string;
  knownValues: string[];
}

export function showContextMenu(
  app: App,
  task: BaseTask,
  { property, knownValues }: ContextSource,
  at: MenuPoint
): void {
  if (!(task instanceof NoteTask) || !property.trim()) return;
  const save = (values: string[]) =>
    runWrite(() => task.updateListProperty(property, values, app));
  const menu = new Menu();
  for (const value of new Set([...task.groupValues, ...knownValues])) {
    menu.addItem((item) =>
      item
        .setTitle(value)
        .setChecked(task.groupValues.includes(value))
        .onClick(() => save(toggleValue(task.groupValues, value)))
    );
  }
  menu.addSeparator();
  menu.addItem((item) =>
    item
      .setTitle(t("note_context.new_context"))
      .setIcon("plus")
      .onClick(() =>
        new TextInputModal(
          app,
          t("note_context.new_context_title"),
          t("note_context.add"),
          (value) => {
            const trimmed = value.trim();
            if (trimmed && !task.groupValues.includes(trimmed))
              void save([...task.groupValues, trimmed]);
          }
        ).open()
      )
  );
  if (task.groupValues.length > 0) {
    menu.addItem((item) =>
      item
        .setTitle(t("note_context.clear_contexts"))
        .setIcon("x")
        .onClick(() => save([]))
    );
  }
  menu.showAtPosition(at);
}

function getDate(app: App, task: NoteTask, field: DateField): string | null {
  if (field === "due") return task.dueDate;
  const file = app.vault.getFileByPath(task.link);
  const frontmatter = file
    ? app.metadataCache.getFileCache(file)?.frontmatter
    : undefined;
  return normalizeDueDate(frontmatter?.[field]);
}

function showDateMenu(
  app: App,
  task: NoteTask,
  field: DateField,
  at: MenuPoint
): void {
  const set = (value: string | null) =>
    runWrite(() => task.updateDate(field, value, app));
  const today = new Date();
  const menu = new Menu();
  const presets: [string, number][] = [
    [t("note_context.date_today"), 0],
    [t("note_context.date_tomorrow"), 1],
    [t("note_context.date_next_week"), 7],
  ];
  for (const [label, days] of presets) {
    menu.addItem((item) =>
      item.setTitle(label).onClick(() => set(shiftIsoDate(today, days)))
    );
  }
  menu.addItem((item) =>
    item
      .setTitle(t("note_context.date_pick"))
      .setIcon("calendar")
      .onClick(() =>
        new DatePickerModal(
          app,
          t(`note_context.${field}_title`),
          t("note_context.date_set"),
          getDate(app, task, field) ?? shiftIsoDate(today, 0),
          (value) => void set(value)
        ).open()
      )
  );
  if (getDate(app, task, field)) {
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("note_context.date_clear"))
        .setIcon("x")
        .onClick(() => set(null))
    );
  }
  menu.showAtPosition(at);
}

/**
 * The quick-edit menu behind "⋯": priority and dates open a second menu at
 * the same spot, star and today toggle straight away.
 */
export function showTaskEditMenu(
  app: App,
  task: BaseTask,
  priorities: TaskPriorityConfig[],
  contextSource: ContextSource,
  at: MenuPoint
): void {
  const menu = new Menu();
  const priority = getPriorityByValue(task.priority, priorities);
  menu.addItem((item) =>
    item
      .setTitle(t("note_context.priority", { value: priority.label }))
      .setIcon("flag")
      .onClick(() => showPriorityMenuAt(app, task, priorities, at))
  );
  if (task instanceof NoteTask) {
    for (const field of ["due", "scheduled"] as const) {
      const value = getDate(app, task, field);
      menu.addItem((item) =>
        item
          .setTitle(
            t(`note_context.${field}`, {
              value: value ? formatShortDate(value) : t("note_context.none"),
            })
          )
          .setIcon(field === "due" ? "calendar" : "calendar-clock")
          .onClick(() => showDateMenu(app, task, field, at))
      );
    }
  }
  if (task instanceof NoteTask && contextSource.property.trim()) {
    menu.addItem((item) =>
      item
        .setTitle(
          t("note_context.context", {
            value: formatContexts(task.groupValues) ?? t("note_context.none"),
          })
        )
        .setIcon("at-sign")
        .onClick(() => showContextMenu(app, task, contextSource, at))
    );
  }
  menu.addSeparator();
  menu.addItem((item) =>
    item
      .setTitle(t(task.starred ? "note_context.unstar" : "note_context.star"))
      .setIcon("star")
      .onClick(() =>
        runWrite(() =>
          task.starred
            ? removeStarFromTaskInVault(task, app)
            : addStarToTaskInVault(task, app)
        )
      )
  );
  if (task instanceof NoteTask) {
    menu.addItem((item) =>
      item
        .setTitle(
          t(task.today ? "note_context.remove_today" : "note_context.add_today")
        )
        .setIcon("sun")
        .onClick(() => runWrite(() => task.updateToday(!task.today, app)))
    );
  }
  menu.showAtPosition(at);
}
