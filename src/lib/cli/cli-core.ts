import { layoutTree, treeSortKey } from "src/lib/layout";
import { getStatusById, TaskStatusConfig } from "src/lib/status-config";
import type { BaseTask } from "src/types/base-task";

/**
 * Pure helpers behind the Tasks Map CLI commands. Nothing here touches the
 * Obsidian API, so the behaviour AI agents rely on is covered by unit tests.
 */

/** Values from the Obsidian CLI: `key=value`, or `"true"` for bare flags. */
export type CliParams = Record<string, string>;

/** A user-facing CLI failure; its message is printed as-is. */
export class CliError extends Error {}

export function flag(params: CliParams, name: string): boolean {
  const value = params[name];
  return value !== undefined && value.toLowerCase() !== "false";
}

/** A trimmed value, or undefined when missing, empty, or a bare flag. */
export function param(params: CliParams, name: string): string | undefined {
  const value = params[name];
  if (value === undefined || value === "true") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function requireParam(params: CliParams, name: string): string {
  const value = param(params, name);
  if (!value) throw new CliError(`Missing required ${name}=<value>.`);
  return value;
}

/** The CLI passes `\n` and `\t` through literally; turn them into text. */
export function unescapeCliText(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

export function taskTitle(task: BaseTask): string {
  return (task.summary || task.text || task.id).trim();
}

function basename(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

function normalizeRef(ref: string): string {
  let value = ref.trim();
  const wikilink = value.match(/^\[\[([^\]]+)\]\]$/);
  if (wikilink) value = wikilink[1];
  value = value.split("|")[0].split("#")[0];
  return value.replace(/\.md$/i, "").trim().toLowerCase();
}

export interface TaskMatch {
  task: BaseTask;
  score: number;
}

interface MatchFields {
  id: string;
  path: string;
  name: string;
  title: string;
}

function scoreFields(
  { id, path, name, title }: MatchFields,
  needle: string,
  words: string[]
): number {
  if (path === needle || id === needle) return 100;
  if (name === needle) return 95;
  if (title === needle) return 90;
  if (name.startsWith(needle) || title.startsWith(needle)) return 70;
  if (name.includes(needle) || title.includes(needle)) return 50;
  if (
    words.length > 1 &&
    words.every((word) => name.includes(word) || title.includes(word))
  ) {
    return 30;
  }
  return 0;
}

/** Rank tasks against a path, wikilink, filename, or title fragment. */
export function rankTasks(tasks: BaseTask[], query: string): TaskMatch[] {
  const needle = normalizeRef(query);
  if (!needle) return [];
  const words = needle.split(/\s+/).filter(Boolean);
  const matches: TaskMatch[] = [];
  for (const task of tasks) {
    const fields: MatchFields = {
      id: task.id.toLowerCase(),
      path: (task.link || task.id).replace(/\.md$/i, "").toLowerCase(),
      name: basename(task.link || task.id).toLowerCase(),
      title: taskTitle(task).toLowerCase(),
    };
    // A checkbox task shares its note's path and filename. It matches its
    // own text at full strength, but a match that only comes from the file
    // ranks just below the note task itself, so a project note with
    // checkboxes in its body still resolves by path or name.
    const score =
      task.type === "note"
        ? scoreFields(fields, needle, words)
        : Math.max(
            scoreFields({ ...fields, path: "", name: "" }, needle, words),
            scoreFields(fields, needle, words) - 1
          );
    if (score > 0) matches.push({ task, score });
  }
  return matches.sort(
    (left, right) =>
      right.score - left.score ||
      Number(right.task.isProject) - Number(left.task.isProject) ||
      treeSortKey(left.task).localeCompare(treeSortKey(right.task))
  );
}

/** Resolve one task, refusing to guess between equally good matches. */
export function resolveTask(tasks: BaseTask[], ref: string): BaseTask {
  const matches = rankTasks(tasks, ref);
  if (matches.length === 0) {
    throw new CliError(`No task matches "${ref}". Try the resolve command.`);
  }
  const best = matches[0].score;
  const tied = matches.filter((match) => match.score === best);
  if (tied.length > 1) {
    const options = tied
      .slice(0, 8)
      .map(({ task }) =>
        task.type === "note"
          ? `  - ${task.link || task.id}`
          : `  - ${task.link || task.id} (checkbox: ${taskTitle(task)})`
      )
      .join("\n");
    throw new CliError(
      `"${ref}" matches ${tied.length} tasks equally well. Pass the path:\n${options}`
    );
  }
  return matches[0].task;
}

/** Match a status by id, label, or any of its note values. */
export function resolveStatusArg(
  value: string,
  statuses: TaskStatusConfig[]
): TaskStatusConfig {
  const needle = value.trim().toLowerCase();
  const found = statuses.find(
    (status) =>
      status.id.toLowerCase() === needle ||
      status.label.toLowerCase() === needle ||
      status.noteValues
        .split(",")
        .some((noteValue) => noteValue.trim().toLowerCase() === needle)
  );
  if (!found) {
    const allowed = statuses
      .map((status) => `${status.label} (${status.id})`)
      .join(", ");
    throw new CliError(`Unknown status "${value}". Use one of: ${allowed}.`);
  }
  return found;
}

/** The frontmatter value TaskNotes stores for a configured status. */
export function noteStatusValue(status: TaskStatusConfig): string {
  return status.noteValues.split(",")[0]?.trim() || status.id;
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(value);
}

export function childrenByParent(tasks: BaseTask[]): Map<string, BaseTask[]> {
  const ids = new Set(tasks.map((task) => task.id));
  const children = new Map<string, BaseTask[]>();
  for (const task of tasks) {
    for (const parentId of task.incomingLinks) {
      if (!ids.has(parentId) || parentId === task.id) continue;
      const list = children.get(parentId) ?? [];
      list.push(task);
      children.set(parentId, list);
    }
  }
  return children;
}

/** The task and everything below it (cycle-safe). */
export function subtreeIds(tasks: BaseTask[], rootId: string): Set<string> {
  const children = childrenByParent(tasks);
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const child of children.get(id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      queue.push(child.id);
    }
  }
  return seen;
}

export interface TaskListOptions {
  /** Status ids to keep; undefined keeps every status. */
  statusIds?: string[];
  /** Keep only this task's subtree (including itself). */
  withinTaskId?: string;
  tag?: string;
  search?: string;
  overdue?: boolean;
  dueBefore?: string;
  projectsOnly?: boolean;
  limit?: number;
}

export function filterTaskList(
  tasks: BaseTask[],
  options: TaskListOptions,
  today: string
): BaseTask[] {
  const within = options.withinTaskId
    ? subtreeIds(tasks, options.withinTaskId)
    : null;
  const statusIds = options.statusIds ? new Set(options.statusIds) : null;
  const tag = options.tag?.replace(/^#/, "").toLowerCase();
  const search = options.search?.toLowerCase();
  const result = tasks
    .filter((task) => !within || within.has(task.id))
    .filter((task) => !statusIds || statusIds.has(task.status))
    .filter((task) => !options.projectsOnly || task.isProject)
    .filter(
      (task) =>
        !tag ||
        task.tags.some((taskTag) => {
          const value = taskTag.replace(/^#/, "").toLowerCase();
          return value === tag || value.startsWith(`${tag}/`);
        })
    )
    .filter(
      (task) =>
        !search ||
        taskTitle(task).toLowerCase().includes(search) ||
        (task.link || "").toLowerCase().includes(search)
    )
    .filter(
      (task) => !options.overdue || (!!task.dueDate && task.dueDate < today)
    )
    .filter(
      (task) =>
        !options.dueBefore ||
        (!!task.dueDate && task.dueDate <= options.dueBefore)
    )
    .sort((left, right) => treeSortKey(left).localeCompare(treeSortKey(right)));
  return options.limit ? result.slice(0, options.limit) : result;
}

export interface TaskSummary {
  path: string;
  title: string;
  status: string;
  statusLabel: string;
  priority: string;
  due: string | null;
  isProject: boolean;
  tags: string[];
  parents: string[];
}

export function summarizeTask(
  task: BaseTask,
  statuses: TaskStatusConfig[],
  byId: Map<string, BaseTask>
): TaskSummary {
  return {
    path: task.link || task.id,
    title: taskTitle(task),
    status: task.status,
    statusLabel: getStatusById(task.status, statuses).label,
    priority: task.priority,
    due: task.dueDate,
    isProject: task.isProject,
    tags: task.tags,
    parents: task.incomingLinks.map((id) => {
      const parent = byId.get(id);
      return parent ? parent.link || parent.id : id;
    }),
  };
}

export function formatTaskLine(
  task: BaseTask,
  statuses: TaskStatusConfig[]
): string {
  const parts = [
    `[${getStatusById(task.status, statuses).label}]`,
    taskTitle(task),
  ];
  if (task.isProject) parts.push("(project)");
  if (task.dueDate) parts.push(`due ${task.dueDate}`);
  if (task.priority && task.priority !== "none") {
    parts.push(`priority ${task.priority}`);
  }
  return `${parts.join(" ")}  — ${task.link || task.id}`;
}

/**
 * Text version of the map's tree layout: one task per line, project first,
 * with lane rails (│) so an agent sees the same structure the user does.
 */
export function renderTreeText(
  tasks: BaseTask[],
  statuses: TaskStatusConfig[],
  options: { showPaths?: boolean } = {}
): string {
  if (tasks.length === 0) return "(no tasks)";
  const ids = new Set(tasks.map((task) => task.id));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const sortKeys = new Map(tasks.map((task) => [task.id, treeSortKey(task)]));
  const layout = layoutTree({
    nodeIds: tasks.map((task) => task.id),
    edges: tasks.flatMap((task) =>
      task.incomingLinks
        .filter((parentId) => ids.has(parentId))
        .map((parentId) => ({ source: parentId, target: task.id }))
    ),
    dimensions: new Map(),
    direction: "Vertical",
    compare: (left, right) =>
      (sortKeys.get(left) ?? left).localeCompare(sortKeys.get(right) ?? right),
  });

  // Each parent's children share one lane from its first to its last child.
  const spans: { lane: number; from: number; to: number }[] = [];
  const firstChild = new Map<string, number>();
  const lastChild = new Map<string, number>();
  for (const row of layout.rows) {
    if (!row.parentId) continue;
    if (!firstChild.has(row.parentId)) firstChild.set(row.parentId, row.index);
    lastChild.set(row.parentId, row.index);
  }
  for (const [parentId, from] of firstChild) {
    const lane = layout.rows[from].lane;
    spans.push({ lane, from, to: lastChild.get(parentId) ?? from });
  }

  const lines: string[] = [];
  for (const row of layout.rows) {
    if (row.isRoot && row.index > 0) lines.push("");
    let prefix = "";
    for (let lane = 0; lane < row.lane; lane += 1) {
      const active = spans.some(
        (span) =>
          span.lane === lane && span.from <= row.index && row.index <= span.to
      );
      prefix += active ? "│ " : "  ";
    }
    const task = byId.get(row.id)!;
    const status = getStatusById(task.status, statuses).label;
    let line = `${prefix}● ${taskTitle(task)} [${status}]`;
    if (task.dueDate) line += ` due ${task.dueDate}`;
    if (options.showPaths) line += `  — ${task.link || task.id}`;
    lines.push(line);
  }
  const extra = layout.links.length;
  if (extra > 0) {
    lines.push(
      "",
      `(${extra} extra parent link${extra === 1 ? "" : "s"} not drawn; see show)`
    );
  }
  return lines.join("\n");
}

const LOG_HEADING = /^##\s+Log\s*$/i;
const SECTION_HEADING = /^#{1,2}\s/;

/**
 * Append a dated entry to the note's `## Log` section (creating the section
 * at the end when missing). Existing entries are never reordered.
 */
export function appendLogEntry(
  content: string,
  entry: { date: string; title: string; text: string }
): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const block = [`### ${entry.date} — ${entry.title}`];
  if (entry.text.trim()) block.push(...entry.text.trim().split(/\r?\n/));

  const logIndex = lines.findIndex((line) => LOG_HEADING.test(line));
  if (logIndex === -1) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }
    return [...lines, "", "## Log", "", ...block, ""].join(newline);
  }

  let end = lines.length;
  for (let index = logIndex + 1; index < lines.length; index += 1) {
    if (SECTION_HEADING.test(lines[index])) {
      end = index;
      break;
    }
  }
  let insertAt = end;
  while (insertAt > logIndex + 1 && lines[insertAt - 1].trim() === "") {
    insertAt -= 1;
  }
  const before = lines.slice(0, insertAt);
  const after = lines.slice(end);
  const tail = after.length > 0 ? ["", ...after] : [""];
  return [...before, "", ...block, ...tail].join(newline);
}
