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
 * New TaskNotes builds expose an official in-process runtime API at
 * `app.plugins.getPlugin("tasknotes")?.api`. Prefer that API for reads,
 * writes, catalogs and settings so companion plugins such as TaskNotes
 * Workflows receive normalized events and mutation context.
 *
 * Older TaskNotes builds did not expose the runtime API, so this bridge keeps
 * defensive fallbacks to the legacy live plugin members Task Map already used.
 */

const TASKNOTES_PLUGIN_ID = "tasknotes";
const TASKS_MAP_SOURCE = "tasks-map";

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

/** Data accepted by the TaskNotes runtime task creation API. */
export type TaskNotesTaskCreationData = Partial<TaskNotesTaskInfo>;

interface TaskNotesMutationContext {
  source?: string;
  reason?: string;
}

interface TaskNotesRuntimeTasksApi {
  get(_path: string): Promise<TaskNotesTaskInfo | null>;
  create(
    _data: TaskNotesTaskCreationData,
    _context?: TaskNotesMutationContext
  ): Promise<TaskNotesTaskInfo>;
  update(
    _path: string,
    _updates: Partial<TaskNotesTaskInfo>,
    _context?: TaskNotesMutationContext
  ): Promise<TaskNotesTaskInfo>;
  patch?(
    _path: string,
    _updates: Partial<TaskNotesTaskInfo>,
    _context?: TaskNotesMutationContext
  ): Promise<TaskNotesTaskInfo>;
  delete?(_path: string, _context?: TaskNotesMutationContext): Promise<void>;
  setStatus?(
    _path: string,
    _status: string,
    _context?: TaskNotesMutationContext
  ): Promise<TaskNotesTaskInfo>;
  addTag?(
    _path: string,
    _tag: string,
    _context?: TaskNotesMutationContext
  ): Promise<TaskNotesTaskInfo>;
  removeTag?(
    _path: string,
    _tag: string,
    _context?: TaskNotesMutationContext
  ): Promise<TaskNotesTaskInfo>;
  addProject?(
    _path: string,
    _project: string,
    _context?: TaskNotesMutationContext
  ): Promise<TaskNotesTaskInfo>;
  removeProject?(
    _path: string,
    _project: string,
    _context?: TaskNotesMutationContext
  ): Promise<TaskNotesTaskInfo>;
}

interface TaskNotesRuntimeCatalogApi {
  statuses?(): StatusConfig[];
  priorities?(): PriorityConfig[];
}

interface TaskNotesRuntimeSettingsApi {
  snapshot?(): TaskNotesSettings;
}

interface TaskNotesRuntimeApi {
  apiVersion: number;
  hasCapability?(_capability: string): boolean;
  tasks?: Partial<TaskNotesRuntimeTasksApi>;
  catalog?: TaskNotesRuntimeCatalogApi;
  settings?: TaskNotesRuntimeSettingsApi;
}

interface TaskNotesCacheManager {
  getTaskInfo(_path: string): Promise<TaskNotesTaskInfo | null>;
  isTaskFile?(_frontmatter: unknown): boolean;
}

interface TaskNotesTaskService {
  createTask(_data: TaskNotesTaskCreationData): Promise<TaskNotesTaskInfo>;
  updateTask(
    _original: TaskNotesTaskInfo,
    _updates: Partial<TaskNotesTaskInfo>
  ): Promise<TaskNotesTaskInfo>;
  deleteTask?(_task: TaskNotesTaskInfo): Promise<void>;
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
  taskIdentificationMethod?: "tag" | "property";
  taskTag?: string;
  taskPropertyName?: string;
  taskPropertyValue?: string;
}

interface TaskNotesPluginInstance {
  api?: TaskNotesRuntimeApi;
  cacheManager?: TaskNotesCacheManager;
  taskService?: TaskNotesTaskService;
  settings?: TaskNotesSettings;
  openTaskEditModal?(
    _task: TaskNotesTaskInfo,
    _onTaskUpdated?: (_task: TaskNotesTaskInfo) => void
  ): Promise<void>;
}

/** Obsidian's `App.plugins` registry is not part of the public typings. */
interface PluginsRegistry {
  plugins?: Record<string, unknown>;
  getPlugin?(_id: string): unknown;
}

function getPluginsRegistry(app: App): PluginsRegistry | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Obsidian App type does not expose plugins property
  return (app as any).plugins as PluginsRegistry | undefined;
}

function getTaskNotesPluginObject(app: App): unknown {
  const plugins = getPluginsRegistry(app);
  return (
    plugins?.getPlugin?.(TASKNOTES_PLUGIN_ID) ??
    plugins?.plugins?.[TASKNOTES_PLUGIN_ID] ??
    null
  );
}

function mutationContext(reason: string): TaskNotesMutationContext {
  return { source: TASKS_MAP_SOURCE, reason };
}

function hasTaskWrite(api: TaskNotesRuntimeApi | null): boolean {
  return api?.hasCapability?.("tasks.write") !== false;
}

function hasTaskDelete(api: TaskNotesRuntimeApi | null): boolean {
  return api?.hasCapability?.("tasks.delete") !== false;
}

/**
 * Return the live TaskNotes plugin instance, or `null` if TaskNotes is not
 * installed, not enabled, not yet loaded, or has no usable integration surface.
 */
export function getTaskNotesPlugin(app: App): TaskNotesPluginInstance | null {
  const plugin = getTaskNotesPluginObject(app);
  if (!plugin || typeof plugin !== "object") return null;

  const candidate = plugin as Partial<TaskNotesPluginInstance>;
  const hasRuntimeApi =
    typeof candidate.api?.apiVersion === "number" && !!candidate.api.tasks;
  const hasLegacyTaskAccess =
    typeof candidate.cacheManager?.getTaskInfo === "function";

  if (!hasRuntimeApi && !hasLegacyTaskAccess) return null;
  return candidate as TaskNotesPluginInstance;
}

/** Return TaskNotes' official runtime API, or `null` when unavailable. */
export function getTaskNotesApi(app: App): TaskNotesRuntimeApi | null {
  const api = getTaskNotesPlugin(app)?.api;
  if (!api || typeof api.apiVersion !== "number") return null;
  return api;
}

/** Whether the TaskNotes plugin is available for Task Map integration. */
export function isTaskNotesAvailable(app: App): boolean {
  return getTaskNotesPlugin(app) !== null;
}

function frontmatterListIncludes(value: unknown, expected: string): boolean {
  const normalized = expected.replace(/^#/, "").toLowerCase();
  const values = Array.isArray(value) ? value : [value];

  return values.some((entry) => {
    if (typeof entry !== "string") return false;
    return entry.replace(/^#/, "").toLowerCase() === normalized;
  });
}

function settingsIdentifyTask(
  frontmatter: Record<string, unknown> | undefined,
  settings: TaskNotesSettings | undefined
): boolean {
  if (!frontmatter || !settings) return false;

  if (settings.taskIdentificationMethod === "property") {
    const name = settings.taskPropertyName;
    if (!name) return false;
    const expected = settings.taskPropertyValue ?? "";
    const actual = frontmatter[name];
    if (Array.isArray(actual)) return actual.includes(expected);
    return String(actual ?? "") === expected;
  }

  const taskTag = settings.taskTag ?? "task";
  return frontmatterListIncludes(frontmatter.tags, taskTag);
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

  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter as
    | Record<string, unknown>
    | undefined;

  try {
    if (typeof plugin.cacheManager?.isTaskFile === "function") {
      return plugin.cacheManager.isTaskFile(frontmatter);
    }
  } catch {
    return false;
  }

  return settingsIdentifyTask(
    frontmatter,
    plugin.api?.settings?.snapshot?.() ?? plugin.settings
  );
}

/**
 * Open the TaskNotes task edit modal for the note at `filePath`.
 *
 * The edit modal is still a TaskNotes plugin method, not part of the runtime
 * API, so this method keeps using the legacy modal entrypoint when present.
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
  if (!plugin || typeof plugin.openTaskEditModal !== "function") {
    new Notice("TaskNotes plugin is not available.");
    return false;
  }

  try {
    const taskInfo =
      (await plugin.api?.tasks?.get?.(filePath)) ??
      (await plugin.cacheManager?.getTaskInfo(filePath)) ??
      null;
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
// Persistence: official TaskNotes runtime API first, legacy service fallback
// ---------------------------------------------------------------------------

/** Services needed by the in-app task editor panel. */
export interface TaskNotesServices {
  api: TaskNotesRuntimeApi | null;
  taskService: TaskNotesTaskService | undefined;
  cacheManager: TaskNotesCacheManager | undefined;
  settings: TaskNotesSettings | undefined;
}

/**
 * Return TaskNotes runtime API and/or legacy service access, or `null` if
 * TaskNotes is missing or no longer exposes methods the editor can use.
 */
export function getTaskNotesServices(app: App): TaskNotesServices | null {
  const plugin = getTaskNotesPlugin(app);
  if (!plugin) return null;

  const api = getTaskNotesApi(app);
  const hasRuntimeEditor =
    typeof api?.tasks?.create === "function" &&
    typeof api?.tasks?.update === "function";
  const hasLegacyEditor =
    typeof plugin.taskService?.createTask === "function" &&
    typeof plugin.taskService?.updateTask === "function";

  if (!hasRuntimeEditor && !hasLegacyEditor) return null;

  return {
    api,
    taskService: plugin.taskService,
    cacheManager: plugin.cacheManager,
    settings: plugin.api?.settings?.snapshot?.() ?? plugin.settings,
  };
}

/** Whether the in-app editor panel can operate. */
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
 * The runtime API returns task metadata; the body is read from disk and merged
 * into `details` for Task Map's embedded editor.
 */
export async function getTaskNotesTaskInfo(
  app: App,
  filePath: string
): Promise<TaskNotesTaskInfo | null> {
  const plugin = getTaskNotesPlugin(app);
  if (!plugin) return null;
  try {
    const taskInfo =
      (await plugin.api?.tasks?.get?.(filePath)) ??
      (await plugin.cacheManager?.getTaskInfo(filePath)) ??
      null;
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
 * Create a task via TaskNotes. Returns the new task, or `null` on failure.
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
    if (
      typeof services.api?.tasks?.create === "function" &&
      hasTaskWrite(services.api)
    ) {
      return await services.api.tasks.create(
        data,
        mutationContext("Task Map created a task")
      );
    }
    return (await services.taskService?.createTask(data)) ?? null;
  } catch (error) {
    console.error("Failed to create TaskNotes task:", error);
    new Notice("Failed to create the task.");
    return null;
  }
}

/**
 * Update a task via TaskNotes. `updates` may include `details` to rewrite the
 * note body. Returns the updated task, or `null` on failure.
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
    if (
      original.path &&
      typeof services.api?.tasks?.update === "function" &&
      hasTaskWrite(services.api)
    ) {
      return await services.api.tasks.update(
        original.path,
        updates,
        mutationContext("Task Map updated a task")
      );
    }
    return (await services.taskService?.updateTask(original, updates)) ?? null;
  } catch (error) {
    console.error("Failed to update TaskNotes task:", error);
    new Notice("Failed to save the task.");
    return null;
  }
}

export async function updateTaskNotesStatus(
  app: App,
  taskPath: string,
  status: string
): Promise<boolean> {
  const api = getTaskNotesApi(app);
  if (!api || !hasTaskWrite(api)) return false;

  try {
    if (typeof api.tasks?.setStatus === "function") {
      await api.tasks.setStatus(
        taskPath,
        status,
        mutationContext("Task Map changed task status")
      );
      return true;
    }
    if (typeof api.tasks?.update === "function") {
      await api.tasks.update(
        taskPath,
        { status },
        mutationContext("Task Map changed task status")
      );
      return true;
    }
  } catch (error) {
    console.warn("TaskNotes runtime status update failed:", error);
  }
  return false;
}

export async function deleteTaskNotesTask(
  app: App,
  taskPath: string
): Promise<boolean> {
  const api = getTaskNotesApi(app);
  if (api && hasTaskDelete(api) && typeof api.tasks?.delete === "function") {
    try {
      await api.tasks.delete(
        taskPath,
        mutationContext("Task Map deleted a task")
      );
      return true;
    } catch (error) {
      console.warn("TaskNotes runtime delete failed:", error);
    }
  }

  const plugin = getTaskNotesPlugin(app);
  if (
    typeof plugin?.taskService?.deleteTask === "function" &&
    typeof plugin.cacheManager?.getTaskInfo === "function"
  ) {
    try {
      const task = await plugin.cacheManager.getTaskInfo(taskPath);
      if (!task) return false;
      await plugin.taskService.deleteTask(task);
      return true;
    } catch (error) {
      console.warn("TaskNotes legacy delete failed:", error);
    }
  }

  return false;
}

export async function addTaskNotesTag(
  app: App,
  taskPath: string,
  tag: string
): Promise<boolean> {
  const api = getTaskNotesApi(app);
  if (!api || !hasTaskWrite(api)) return false;

  try {
    if (typeof api.tasks?.addTag === "function") {
      await api.tasks.addTag(
        taskPath,
        tag,
        mutationContext("Task Map added a task tag")
      );
      return true;
    }

    const task = await api.tasks?.get?.(taskPath);
    if (!task || typeof api.tasks?.update !== "function") return false;
    const tags = task.tags ?? [];
    if (tags.includes(tag)) return true;
    await api.tasks.update(
      taskPath,
      { tags: [...tags, tag] },
      mutationContext("Task Map added a task tag")
    );
    return true;
  } catch (error) {
    console.warn("TaskNotes runtime tag add failed:", error);
    return false;
  }
}

export async function removeTaskNotesTag(
  app: App,
  taskPath: string,
  tag: string
): Promise<boolean> {
  const api = getTaskNotesApi(app);
  if (!api || !hasTaskWrite(api)) return false;

  try {
    if (typeof api.tasks?.removeTag === "function") {
      await api.tasks.removeTag(
        taskPath,
        tag,
        mutationContext("Task Map removed a task tag")
      );
      return true;
    }

    const task = await api.tasks?.get?.(taskPath);
    if (!task || typeof api.tasks?.update !== "function") return false;
    await api.tasks.update(
      taskPath,
      { tags: (task.tags ?? []).filter((entry) => entry !== tag) },
      mutationContext("Task Map removed a task tag")
    );
    return true;
  } catch (error) {
    console.warn("TaskNotes runtime tag removal failed:", error);
    return false;
  }
}

export async function addTaskNotesProject(
  app: App,
  taskPath: string,
  project: string
): Promise<boolean> {
  const api = getTaskNotesApi(app);
  if (!api || !hasTaskWrite(api)) return false;

  try {
    if (typeof api.tasks?.addProject === "function") {
      await api.tasks.addProject(
        taskPath,
        project,
        mutationContext("Task Map added a task project")
      );
      return true;
    }

    const task = await api.tasks?.get?.(taskPath);
    if (!task || typeof api.tasks?.update !== "function") return false;
    const projects = task.projects ?? [];
    if (projects.includes(project)) return true;
    await api.tasks.update(
      taskPath,
      { projects: [...projects, project] },
      mutationContext("Task Map added a task project")
    );
    return true;
  } catch (error) {
    console.warn("TaskNotes runtime project add failed:", error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Configuration (statuses, priorities, NLP) - read from TaskNotes settings
// ---------------------------------------------------------------------------

/** TaskNotes' documented defaults, used only if its config is unreadable. */
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
  {
    id: "normal",
    value: "normal",
    label: "Normal",
    color: "#3b82f6",
    weight: 2,
  },
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

function nonEmptyStatusList(value: unknown): value is StatusConfig[] {
  return Array.isArray(value) && value.length > 0;
}

function nonEmptyPriorityList(value: unknown): value is PriorityConfig[] {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Read the user's TaskNotes statuses, priorities and NLP configuration.
 * Falls back to TaskNotes' documented defaults if its settings are unavailable.
 */
export function getTaskNotesConfig(app: App): TaskNotesConfig {
  const plugin = getTaskNotesPlugin(app);
  const api = plugin?.api;
  const settings = api?.settings?.snapshot?.() ?? plugin?.settings;
  const catalogStatuses = api?.catalog?.statuses?.();
  const catalogPriorities = api?.catalog?.priorities?.();

  const statuses = nonEmptyStatusList(catalogStatuses)
    ? catalogStatuses
    : nonEmptyStatusList(settings?.customStatuses)
      ? settings.customStatuses
      : FALLBACK_STATUSES;
  const priorities = nonEmptyPriorityList(catalogPriorities)
    ? catalogPriorities
    : nonEmptyPriorityList(settings?.customPriorities)
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
