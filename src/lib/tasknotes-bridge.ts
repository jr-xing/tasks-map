import { App, Notice, TFile } from "obsidian";
import type {
  StatusConfig,
  PriorityConfig,
  NLPTriggersConfig,
  UserMappedField,
} from "tasknotes-nlp-core";

/**
 * Bridge to the TaskNotes plugin (https://github.com/callumalpass/tasknotes).
 *
 * TaskNotes does not publish a stable public API, so we reach into its live
 * plugin instance via `app.plugins` and rely only on the public members
 * documented below. Every access is defensively guarded so that a missing or
 * version-changed TaskNotes degrades gracefully instead of throwing.
 *
 * Persistence (create/update) is delegated entirely to TaskNotes' own
 * `taskService`, so its `FieldMapper` performs all frontmatter serialization —
 * the user's `fieldMapping` / task-identification settings are respected for
 * free with no risk of schema drift.
 */

const TASKNOTES_PLUGIN_ID = "tasknotes";

/** A `blockedBy` dependency entry as stored in TaskNotes frontmatter. */
export interface TaskNotesTaskDependency {
  uid: string;
  reltype: string;
  gap?: string;
}

/**
 * Subset of TaskNotes' `TaskInfo` we care about. Extra fields are preserved
 * via the index signature so the object can be round-tripped untouched.
 */
export interface TaskNotesTaskInfo {
  path: string;
  title: string;
  status: string;
  priority: string;
  due?: string;
  scheduled?: string;
  tags?: string[];
  contexts?: string[];
  projects?: string[];
  recurrence?: string;
  timeEstimate?: number;
  blockedBy?: TaskNotesTaskDependency[];
  details?: string;
  archived?: boolean;
  [key: string]: unknown;
}

/** Data accepted by `taskService.createTask`. */
export type TaskNotesTaskCreationData = Partial<TaskNotesTaskInfo>;

interface TaskNotesCacheManager {
  getTaskInfo(_path: string): Promise<TaskNotesTaskInfo | null>;
  isTaskFile(_frontmatter: unknown): boolean;
}

interface TaskNotesTaskService {
  createTask(_data: TaskNotesTaskCreationData): Promise<TaskNotesTaskInfo>;
  updateTask(
    _original: TaskNotesTaskInfo,
    _updates: Partial<TaskNotesTaskInfo>
  ): Promise<TaskNotesTaskInfo>;
}

/** Subset of TaskNotes' settings relevant to the editor panel. */
interface TaskNotesSettings {
  customStatuses?: StatusConfig[];
  customPriorities?: PriorityConfig[];
  nlpLanguage?: string;
  nlpDefaultToScheduled?: boolean;
  nlpTriggers?: NLPTriggersConfig;
  userFields?: UserMappedField[];
  defaultTaskStatus?: string;
  defaultTaskPriority?: string;
}

interface TaskNotesPluginInstance {
  cacheManager: TaskNotesCacheManager;
  taskService?: TaskNotesTaskService;
  settings?: TaskNotesSettings;
  openTaskEditModal(
    _task: TaskNotesTaskInfo,
    _onTaskUpdated?: (_task: TaskNotesTaskInfo) => void
  ): Promise<void>;
}

/** Obsidian's `App.plugins` registry is not part of the public typings. */
interface PluginsRegistry {
  plugins?: Record<string, unknown>;
}

function getPluginsRegistry(app: App): PluginsRegistry | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Obsidian App type does not expose plugins property
  return (app as any).plugins as PluginsRegistry | undefined;
}

/**
 * Return the live TaskNotes plugin instance, or `null` if TaskNotes is not
 * installed, not enabled, not yet loaded, or its internal shape has changed.
 */
export function getTaskNotesPlugin(app: App): TaskNotesPluginInstance | null {
  const plugin = getPluginsRegistry(app)?.plugins?.[TASKNOTES_PLUGIN_ID];
  if (!plugin) return null;

  const candidate = plugin as Partial<TaskNotesPluginInstance>;
  if (
    typeof candidate.openTaskEditModal !== "function" ||
    typeof candidate.cacheManager?.getTaskInfo !== "function"
  ) {
    // TaskNotes is loaded but no longer exposes the members we depend on.
    return null;
  }
  return candidate as TaskNotesPluginInstance;
}

/** Whether the TaskNotes plugin is available for the modal integration. */
export function isTaskNotesAvailable(app: App): boolean {
  return getTaskNotesPlugin(app) !== null;
}

/**
 * Synchronously check whether the note at `filePath` is a TaskNotes task,
 * using the metadata cache. Safe to call during render.
 */
export function isTaskNotesTaskFile(app: App, filePath: string): boolean {
  const plugin = getTaskNotesPlugin(app);
  if (!plugin || !filePath) return false;

  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return false;

  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  try {
    return plugin.cacheManager.isTaskFile(frontmatter);
  } catch {
    // `isTaskFile` may be absent on older/newer TaskNotes versions.
    return false;
  }
}

/**
 * Open the TaskNotes task edit modal for the note at `filePath`.
 *
 * @param onTaskUpdated Invoked after the user saves changes in the modal.
 * @returns `true` if the modal was opened, `false` otherwise.
 */
export async function openTaskNotesEditModal(
  app: App,
  filePath: string,
  onTaskUpdated?: () => void
): Promise<boolean> {
  const plugin = getTaskNotesPlugin(app);
  if (!plugin) {
    new Notice("TaskNotes plugin is not available.");
    return false;
  }

  try {
    const taskInfo = await plugin.cacheManager.getTaskInfo(filePath);
    if (!taskInfo) {
      new Notice("This note is not a TaskNotes task.");
      return false;
    }
    await plugin.openTaskEditModal(taskInfo, () => onTaskUpdated?.());
    return true;
  } catch (error) {
    console.error("Failed to open TaskNotes edit modal:", error);
    new Notice("Failed to open the TaskNotes task editor.");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Persistence: delegated to TaskNotes' taskService
// ---------------------------------------------------------------------------

/** Services needed by the in-app task editor panel. */
export interface TaskNotesServices {
  taskService: TaskNotesTaskService;
  cacheManager: TaskNotesCacheManager;
  settings: TaskNotesSettings | undefined;
}

/**
 * Return TaskNotes' task service + cache, or `null` if TaskNotes is missing or
 * no longer exposes the methods the editor panel relies on.
 */
export function getTaskNotesServices(app: App): TaskNotesServices | null {
  const plugin = getTaskNotesPlugin(app);
  if (!plugin) return null;

  const taskService = plugin.taskService;
  if (
    !taskService ||
    typeof taskService.createTask !== "function" ||
    typeof taskService.updateTask !== "function"
  ) {
    return null;
  }
  return {
    taskService,
    cacheManager: plugin.cacheManager,
    settings: plugin.settings,
  };
}

/** Whether the in-app editor panel can operate (TaskNotes service present). */
export function isTaskNotesEditorAvailable(app: App): boolean {
  return getTaskNotesServices(app) !== null;
}

/**
 * Extract the note body (content after the YAML frontmatter). Mirrors the
 * frontmatter boundary detection used elsewhere in this plugin.
 */
function extractNoteBody(content: string): string {
  const lines = content.split(/\r?\n/);
  if (lines[0] === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === "---") {
        return lines
          .slice(i + 1)
          .join("\n")
          .trimEnd();
      }
    }
  }
  return content.replace(/\r\n/g, "\n").trimEnd();
}

/**
 * Load a TaskNotes `TaskInfo` for the editor form, or `null` on failure.
 *
 * `cacheManager.getTaskInfo()` is backed by the metadata cache and does not
 * include the note body, so the body is read from disk and merged into
 * `details` (returned as a copy so the cache object is not mutated).
 */
export async function getTaskNotesTaskInfo(
  app: App,
  filePath: string
): Promise<TaskNotesTaskInfo | null> {
  const plugin = getTaskNotesPlugin(app);
  if (!plugin) return null;
  try {
    const taskInfo = await plugin.cacheManager.getTaskInfo(filePath);
    if (!taskInfo) return null;

    let details = "";
    const file = app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      try {
        details = extractNoteBody(await app.vault.read(file));
      } catch (error) {
        console.error("Failed to read task note body:", error);
      }
    }
    return { ...taskInfo, details };
  } catch (error) {
    console.error("Failed to load TaskNotes task info:", error);
    return null;
  }
}

/**
 * Create a task via TaskNotes' `taskService` (TaskNotes' FieldMapper handles
 * all serialization). Returns the new task, or `null` on failure.
 */
export async function createTaskNotesTask(
  app: App,
  data: TaskNotesTaskCreationData
): Promise<TaskNotesTaskInfo | null> {
  const services = getTaskNotesServices(app);
  if (!services) {
    new Notice("TaskNotes plugin is not available.");
    return null;
  }
  try {
    return await services.taskService.createTask(data);
  } catch (error) {
    console.error("Failed to create TaskNotes task:", error);
    new Notice("Failed to create the task.");
    return null;
  }
}

/**
 * Update a task via TaskNotes' `taskService`. `updates` may include `details`
 * to rewrite the note body. Returns the updated task, or `null` on failure.
 */
export async function updateTaskNotesTask(
  app: App,
  original: TaskNotesTaskInfo,
  updates: Partial<TaskNotesTaskInfo>
): Promise<TaskNotesTaskInfo | null> {
  const services = getTaskNotesServices(app);
  if (!services) {
    new Notice("TaskNotes plugin is not available.");
    return null;
  }
  try {
    return await services.taskService.updateTask(original, updates);
  } catch (error) {
    console.error("Failed to update TaskNotes task:", error);
    new Notice("Failed to save the task.");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Configuration (statuses, priorities, NLP) — read from TaskNotes settings
// ---------------------------------------------------------------------------

/** TaskNotes' documented defaults, used only if its settings are unreadable. */
const FALLBACK_STATUSES: StatusConfig[] = [
  {
    id: "open",
    value: "open",
    label: "Open",
    color: "#808080",
    isCompleted: false,
    order: 1,
    autoArchive: false,
    autoArchiveDelay: 5,
  },
  {
    id: "in-progress",
    value: "in-progress",
    label: "In progress",
    color: "#3b82f6",
    isCompleted: false,
    order: 2,
    autoArchive: false,
    autoArchiveDelay: 5,
  },
  {
    id: "done",
    value: "done",
    label: "Done",
    color: "#22c55e",
    isCompleted: true,
    order: 3,
    autoArchive: false,
    autoArchiveDelay: 5,
  },
];

const FALLBACK_PRIORITIES: PriorityConfig[] = [
  { id: "low", value: "low", label: "Low", color: "#808080", weight: 1 },
  { id: "normal", value: "normal", label: "Normal", color: "#3b82f6", weight: 2 },
  { id: "high", value: "high", label: "High", color: "#ef4444", weight: 3 },
];

/** Resolved TaskNotes configuration consumed by the editor panel and NLP. */
export interface TaskNotesConfig {
  statuses: StatusConfig[];
  priorities: PriorityConfig[];
  defaultStatus: string;
  defaultPriority: string;
  nlp: {
    language: string;
    defaultToScheduled: boolean;
    triggers?: NLPTriggersConfig;
    userFields?: UserMappedField[];
  };
}

/**
 * Read the user's TaskNotes statuses, priorities and NLP configuration.
 * Falls back to TaskNotes' documented defaults if its settings are unavailable.
 */
export function getTaskNotesConfig(app: App): TaskNotesConfig {
  const settings = getTaskNotesPlugin(app)?.settings;
  const statuses =
    settings?.customStatuses && settings.customStatuses.length > 0
      ? settings.customStatuses
      : FALLBACK_STATUSES;
  const priorities =
    settings?.customPriorities && settings.customPriorities.length > 0
      ? settings.customPriorities
      : FALLBACK_PRIORITIES;

  return {
    statuses,
    priorities,
    defaultStatus: settings?.defaultTaskStatus ?? statuses[0]?.value ?? "open",
    defaultPriority:
      settings?.defaultTaskPriority ??
      priorities.find((p) => p.value === "normal")?.value ??
      priorities[0]?.value ??
      "normal",
    nlp: {
      language: settings?.nlpLanguage ?? "en",
      defaultToScheduled: settings?.nlpDefaultToScheduled ?? true,
      triggers: settings?.nlpTriggers,
      userFields: settings?.userFields,
    },
  };
}
