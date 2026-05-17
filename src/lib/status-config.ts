/**
 * User-configurable task statuses.
 *
 * The plugin reads tasks from two sources with different status models:
 *  - Tasks-plugin checkbox tasks, where the status is the single character
 *    inside the checkbox (e.g. " ", "x", "/", "-").
 *  - Note-based tasks, where the status is a free-form `status:` frontmatter
 *    value (e.g. "open", "in-progress", "planned").
 *
 * Each {@link TaskStatusConfig} ties a stable internal `id` to both
 * representations plus a display label and color.
 */
export interface TaskStatusConfig {
  /** Stable, unique key used everywhere status is referenced internally. */
  id: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** Hex color used for the node border, indicator dot and counts overlay. */
  color: string;
  /** Checkbox character for Tasks-plugin tasks. Use " " for an empty box. */
  checkboxChar: string;
  /**
   * Comma-separated `status:` frontmatter values that map to this status.
   * Matching is case-insensitive and whitespace-trimmed.
   */
  noteValues: string;
}

/**
 * Default status set. Mirrors the previously hard-coded behavior so existing
 * vaults keep working: blank/unknown values fall back to the first entry.
 */
export const DEFAULT_TASK_STATUSES: TaskStatusConfig[] = [
  {
    id: "todo",
    label: "Todo",
    color: "#8a8a8a",
    checkboxChar: " ",
    noteValues: "open, none",
  },
  {
    id: "in_progress",
    label: "In Progress",
    color: "#4a9eff",
    checkboxChar: "/",
    noteValues: "in-progress",
  },
  {
    id: "done",
    label: "Done",
    color: "#4caf50",
    checkboxChar: "x",
    noteValues: "done",
  },
  {
    id: "canceled",
    label: "Canceled",
    color: "#e5534b",
    checkboxChar: "-",
    noteValues: "canceled",
  },
];

/** Returns a fresh, mutable copy of the default status set. */
export function cloneDefaultStatuses(): TaskStatusConfig[] {
  return DEFAULT_TASK_STATUSES.map((s) => ({ ...s }));
}

/** Splits the comma-separated `noteValues` field into normalized tokens. */
function splitNoteValues(noteValues: string): string[] {
  return noteValues
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);
}

/**
 * Resolves a raw status string (a checkbox character or a frontmatter value)
 * to a configured status `id`. Falls back to the first configured status when
 * nothing matches, preserving the legacy "unknown -> todo" behavior.
 */
export function resolveStatusId(
  raw: string,
  statuses: TaskStatusConfig[]
): string {
  const list = statuses.length > 0 ? statuses : DEFAULT_TASK_STATUSES;
  const fallback = list[0].id;
  const trimmed = (raw ?? "").trim().toLowerCase();

  for (const status of list) {
    // Exact checkbox-character match (kept un-trimmed so " " matches a blank box).
    if (status.checkboxChar === raw) return status.id;
    if (splitNoteValues(status.noteValues).includes(trimmed)) return status.id;
    if (status.id.toLowerCase() === trimmed) return status.id;
  }

  return fallback;
}

/** Returns the config for `id`, or the first status when `id` is unknown. */
export function getStatusById(
  id: string,
  statuses: TaskStatusConfig[]
): TaskStatusConfig {
  const list = statuses.length > 0 ? statuses : DEFAULT_TASK_STATUSES;
  return list.find((s) => s.id === id) ?? list[0];
}
