import { App, Notice, TFile } from "obsidian";

/**
 * Bridge to the TaskNotes plugin (https://github.com/callumalpass/tasknotes).
 *
 * TaskNotes does not publish a stable public API, so we reach into its live
 * plugin instance via `app.plugins` and rely only on the public members
 * documented below. Every access is defensively guarded so that a missing or
 * version-changed TaskNotes degrades gracefully instead of throwing.
 */

const TASKNOTES_PLUGIN_ID = "tasknotes";

/**
 * Subset of TaskNotes' `TaskInfo` we care about. The modal needs the full
 * object, so we treat it as opaque apart from the fields we read.
 */
export interface TaskNotesTaskInfo {
  path: string;
  title: string;
  [key: string]: unknown;
}

interface TaskNotesCacheManager {
  getTaskInfo(_path: string): Promise<TaskNotesTaskInfo | null>;
  isTaskFile(_frontmatter: unknown): boolean;
}

interface TaskNotesPluginInstance {
  cacheManager: TaskNotesCacheManager;
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
