import { App } from "obsidian";
import {
  NaturalLanguageParserCore,
  type ParsedTaskData,
} from "tasknotes-nlp-core";
import { getTaskNotesConfig, type TaskNotesConfig } from "./tasknotes-bridge";

export type { ParsedTaskData };

/**
 * Flat, UI-friendly representation of a task, shared by the editor panel and
 * the natural-language parser. Dates are plain `YYYY-MM-DD` strings; an empty
 * string / empty array / `0` means "unset".
 */
export interface TaskFormValues {
  title: string;
  status: string;
  priority: string;
  due: string;
  scheduled: string;
  tags: string[];
  contexts: string[];
  projects: string[];
  /** Dependency UIDs (task paths or `[[links]]`) that block this task. */
  blockedBy: string[];
  /** Estimated minutes; `0` means none. */
  timeEstimate: number;
  /** RFC 5545 RRULE string; empty means non-recurring. */
  recurrence: string;
  /** Note body content. */
  details: string;
}

/** A blank form pre-filled with the user's configured default status/priority. */
export function emptyTaskForm(config: TaskNotesConfig): TaskFormValues {
  return {
    title: "",
    status: config.defaultStatus,
    priority: config.defaultPriority,
    due: "",
    scheduled: "",
    tags: [],
    contexts: [],
    projects: [],
    blockedBy: [],
    timeEstimate: 0,
    recurrence: "",
    details: "",
  };
}

/**
 * Build a natural-language parser configured from the user's TaskNotes
 * settings (statuses, priorities, triggers, language).
 */
export function createNlpParser(app: App): NaturalLanguageParserCore {
  const { nlp, statuses, priorities } = getTaskNotesConfig(app);
  return new NaturalLanguageParserCore(
    statuses,
    priorities,
    nlp.defaultToScheduled,
    nlp.language,
    nlp.triggers,
    nlp.userFields,
    { dateLocale: getDateLocale() }
  );
}

function getDateLocale(): string | undefined {
  try {
    return window.navigator?.language || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Merge natural-language parse results into existing form values. Only fields
 * the parser actually populated are overwritten; list fields are unioned.
 */
export function applyParsedToForm(
  parsed: ParsedTaskData,
  base: TaskFormValues
): TaskFormValues {
  const next: TaskFormValues = { ...base };

  if (parsed.title) next.title = parsed.title;
  if (parsed.status) next.status = parsed.status;
  if (parsed.priority) next.priority = parsed.priority;
  if (parsed.dueDate) next.due = parsed.dueDate;
  if (parsed.scheduledDate) next.scheduled = parsed.scheduledDate;
  if (parsed.tags?.length) next.tags = mergeUnique(base.tags, parsed.tags);
  if (parsed.contexts?.length) {
    next.contexts = mergeUnique(base.contexts, parsed.contexts);
  }
  if (parsed.projects?.length) {
    next.projects = mergeUnique(base.projects, parsed.projects);
  }
  if (parsed.recurrence) next.recurrence = parsed.recurrence;
  if (typeof parsed.estimate === "number" && parsed.estimate > 0) {
    next.timeEstimate = parsed.estimate;
  }
  if (parsed.details) {
    next.details = base.details
      ? `${base.details}\n${parsed.details}`
      : parsed.details;
  }
  return next;
}

function mergeUnique(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}
