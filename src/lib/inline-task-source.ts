import { App, ListItemCache, TFile } from "obsidian";
import { RawTask } from "src/types/task";
import { BaseTask } from "src/types/base-task";
import { TaskFactory } from "./task-factory";
import { DEFAULT_TASK_STATUSES, TaskStatusConfig } from "./status-config";

// Matches the list markers and task prefix accepted by Dataview 0.5.68 so
// switching sources does not change which cached task items Tasks Map loads.
const LIST_ITEM_PATTERN =
  /^[\s>]*(\d+\.|\d+\)|\*|-|\+)\s*(\[.{0,1}\])?\s*(.*)$/mu;

/** Convert Obsidian list-item cache entries from one file into parser input. */
export function extractRawInlineTasks(
  file: TFile,
  content: string,
  listItems: readonly ListItemCache[]
): RawTask[] {
  const lines = content.split("\n");
  const tasks: RawTask[] = [];

  for (const item of listItems) {
    if (item.task === undefined) continue;

    const firstLine = lines[item.position.start.line];
    if (firstLine === undefined) continue;

    const match = LIST_ITEM_PATTERN.exec(firstLine);
    if (!match) continue;

    const text = [
      match[3],
      ...lines.slice(item.position.start.line + 1, item.position.end.line + 1),
    ]
      .map((part) => part.trim())
      .join("\n");

    tasks.push({
      status: item.task,
      text,
      link: { path: file.path },
    });
  }

  return tasks;
}

/** Enumerate and parse every inline checkbox task using native Obsidian APIs. */
export async function getAllInlineTasks(
  app: App,
  statuses: TaskStatusConfig[] = DEFAULT_TASK_STATUSES
): Promise<BaseTask[]> {
  const rawTasksByFile = await Promise.all(
    app.vault.getMarkdownFiles().map(async (file) => {
      const listItems = app.metadataCache
        .getFileCache(file)
        ?.listItems?.filter((item) => item.task !== undefined);

      if (!listItems || listItems.length === 0) return [];

      try {
        const content = await app.vault.cachedRead(file);
        return extractRawInlineTasks(file, content, listItems);
      } catch (error) {
        console.warn(
          `[tasks-map] Could not read inline tasks from ${file.path}:`,
          error
        );
        return [];
      }
    })
  );

  const factory = new TaskFactory(statuses);
  const parsedTasks: BaseTask[] = [];

  for (const rawTasks of rawTasksByFile) {
    for (const rawTask of rawTasks) {
      const task = factory.parse(rawTask);
      if (!factory.isEmptyTask(task)) parsedTasks.push(task);
    }
  }

  return parsedTasks;
}
