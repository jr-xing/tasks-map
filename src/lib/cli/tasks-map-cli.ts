import type { CliFlags } from "obsidian";
import type { BaseTask } from "src/types/base-task";
import type { TaskStatusConfig } from "src/lib/status-config";
import type { TaskNotesTaskCreationData } from "src/lib/tasknotes-bridge";
import type { MapLayoutOptions } from "src/lib/map-layout-options";
import {
  appendLogEntry,
  CliError,
  CliParams,
  filterTaskList,
  flag,
  formatTaskLine,
  isIsoDate,
  noteStatusValue,
  param,
  rankTasks,
  renderTreeText,
  requireParam,
  resolveStatusArg,
  resolveTask,
  subtreeIds,
  summarizeTask,
  taskTitle,
  unescapeCliText,
} from "./cli-core";
import { buildAgentGuide } from "./agent-guide";

/** Everything the CLI needs from Obsidian, injected so it can be tested. */
export interface TasksMapCliDeps {
  loadTasks(): Promise<BaseTask[]>;
  statuses(): TaskStatusConfig[];
  /** Status ids a map shows by default; `list` uses them unless `all`. */
  defaultStatusIds(): string[];
  /** Frontmatter property holding a task's parents (e.g. `projects`). */
  dependencyProperty(): string;
  priorities(): { id: string; label: string }[];
  today(): string;
  /** Shortest unambiguous wikilink target for a vault path. */
  linkTarget(_path: string): string;
  processNote(
    _path: string,
    _transform: (_content: string) => string
  ): Promise<void>;
  processFrontmatter(
    _path: string,
    _mutate: (_frontmatter: Record<string, unknown>) => void
  ): Promise<void>;
  setStatus(_task: BaseTask, _statusId: string): Promise<void>;
  setPriority(_task: BaseTask, _priority: string): Promise<void>;
  /** Create through TaskNotes; null when TaskNotes is unavailable or fails. */
  createTask(_data: TaskNotesTaskCreationData): Promise<string | null>;
  focus(
    _taskId: string,
    _options: {
      overview: boolean;
      newTab: boolean;
      layout: Partial<MapLayoutOptions>;
    }
  ): Promise<void>;
}

export interface TasksMapCliCommand {
  /** Sub-command name; empty for the plugin's default command. */
  action: string;
  description: string;
  flags: CliFlags | null;
  run(_params: CliParams): Promise<string>;
}

const FORMAT_FLAG = {
  value: "json|text",
  description: "Output format (default: text)",
};

function asJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function wantsJson(params: CliParams): boolean {
  return param(params, "format")?.toLowerCase() === "json";
}

function parseLimit(params: CliParams): number | undefined {
  const raw = param(params, "limit");
  if (!raw) return undefined;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new CliError(`limit must be a positive whole number, got "${raw}".`);
  }
  return limit;
}

function parseDate(params: CliParams, name: string): string | undefined {
  const value = param(params, name);
  if (value && !isIsoDate(value)) {
    throw new CliError(`${name} must be YYYY-MM-DD or YYYY-MM-DDTHH:MM.`);
  }
  return value;
}

function sameLinkTarget(value: unknown, target: string): boolean {
  const raw =
    typeof value === "object" && value !== null && "uid" in value
      ? String((value as { uid: unknown }).uid)
      : String(value);
  const normalize = (text: string) =>
    text
      .replace(/^\[\[|\]\]$/g, "")
      .split("|")[0]
      .replace(/\.md$/i, "")
      .split("/")
      .pop()!
      .trim()
      .toLowerCase();
  return normalize(raw) === normalize(target);
}

export function createTasksMapCliCommands(
  deps: TasksMapCliDeps,
  commandPrefix: string
): TasksMapCliCommand[] {
  const guide = () => buildAgentGuide(commandPrefix);

  const resolvePriority = (value: string): string => {
    const options = deps.priorities();
    const found = options.find(
      (option) =>
        option.id.toLowerCase() === value.toLowerCase() ||
        option.label.toLowerCase() === value.toLowerCase()
    );
    if (!found) {
      const allowed = options.map((option) => option.id).join(", ");
      throw new CliError(
        `Unknown priority "${value}". Use one of: ${allowed}.`
      );
    }
    return found.id;
  };

  const writeParentLink = async (
    child: BaseTask,
    parent: BaseTask,
    remove: boolean
  ) => {
    const property = deps.dependencyProperty();
    const target = `[[${deps.linkTarget(parent.link || parent.id)}]]`;
    await deps.processFrontmatter(child.link, (frontmatter) => {
      const current = frontmatter[property];
      const list = Array.isArray(current)
        ? [...current]
        : current === undefined || current === null || current === ""
          ? []
          : [current];
      const kept = list.filter((entry) => !sameLinkTarget(entry, target));
      if (!remove) {
        kept.push(
          property === "blockedBy"
            ? { uid: target, reltype: "FINISHTOSTART" }
            : target
        );
      }
      frontmatter[property] = kept;
    });
    return target;
  };

  return [
    {
      action: "",
      description: "Tasks Map: print the guide for AI agents",
      flags: null,
      run: async () => guide(),
    },
    {
      action: "skill",
      description: "Print the guide for AI agents using this CLI",
      flags: null,
      run: async () => guide(),
    },
    {
      action: "schema",
      description: "Statuses, priorities and properties this vault uses",
      flags: { format: FORMAT_FLAG },
      run: async (params) => {
        const schema = {
          parentProperty: deps.dependencyProperty(),
          defaultStatuses: deps.defaultStatusIds(),
          statuses: deps.statuses().map((status) => ({
            id: status.id,
            label: status.label,
            noteValues: status.noteValues
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          })),
          priorities: deps.priorities(),
        };
        if (wantsJson(params)) return asJson(schema);
        return [
          `Parent property: ${schema.parentProperty}`,
          "Statuses (id: label = note values):",
          ...schema.statuses.map(
            (status) =>
              `  ${status.id}: ${status.label} = ${status.noteValues.join(", ")}`
          ),
          `Shown by default: ${schema.defaultStatuses.join(", ")}`,
          `Priorities: ${schema.priorities.map((p) => p.id).join(", ")}`,
        ].join("\n");
      },
    },
    {
      action: "list",
      description: "List tasks, filtered like the map",
      flags: {
        status: {
          value: "<status,...>",
          description: "Status ids, labels or note values (default: open)",
        },
        all: { description: "Include every status" },
        within: {
          value: "<task>",
          description: "Only this task or project and everything under it",
        },
        tag: { value: "<tag>", description: "Tag, including nested tags" },
        search: { value: "<text>", description: "Text in title or path" },
        overdue: { description: "Only tasks past their due date" },
        "due-before": { value: "<date>", description: "Due on or before" },
        projects: { description: "Only project notes" },
        limit: { value: "<n>", description: "Maximum number of tasks" },
        format: FORMAT_FLAG,
      },
      run: async (params) => {
        const tasks = await deps.loadTasks();
        const statuses = deps.statuses();
        const statusArg = param(params, "status");
        const statusIds = flag(params, "all")
          ? undefined
          : statusArg
            ? statusArg
                .split(",")
                .map((value) => resolveStatusArg(value, statuses).id)
            : deps.defaultStatusIds();
        const withinRef = param(params, "within");
        const result = filterTaskList(
          tasks,
          {
            statusIds,
            withinTaskId: withinRef
              ? resolveTask(tasks, withinRef).id
              : undefined,
            tag: param(params, "tag"),
            search: param(params, "search"),
            overdue: flag(params, "overdue"),
            dueBefore: parseDate(params, "due-before"),
            projectsOnly: flag(params, "projects"),
            limit: parseLimit(params),
          },
          deps.today()
        );
        if (wantsJson(params)) {
          const byId = new Map(tasks.map((task) => [task.id, task]));
          return asJson(
            result.map((task) => summarizeTask(task, statuses, byId))
          );
        }
        if (result.length === 0) return "(no matching tasks)";
        return result.map((task) => formatTaskLine(task, statuses)).join("\n");
      },
    },
    {
      action: "tree",
      description: "Show the project tree as text, like the map's tree layout",
      flags: {
        task: {
          value: "<task>",
          description: "Root task or project (default: whole vault)",
        },
        all: { description: "Include done and canceled tasks" },
        paths: { description: "Append each task's path" },
      },
      run: async (params) => {
        const tasks = await deps.loadTasks();
        const rootRef = param(params, "task");
        let scoped = tasks;
        if (rootRef) {
          const keep = subtreeIds(tasks, resolveTask(tasks, rootRef).id);
          scoped = tasks.filter((task) => keep.has(task.id));
        }
        if (!flag(params, "all")) {
          const visible = new Set(deps.defaultStatusIds());
          const rootId = rootRef ? resolveTask(tasks, rootRef).id : null;
          scoped = scoped.filter(
            (task) => visible.has(task.status) || task.id === rootId
          );
        }
        return renderTreeText(scoped, deps.statuses(), {
          showPaths: flag(params, "paths"),
        });
      },
    },
    {
      action: "show",
      description: "Show one task with its parents and children",
      flags: {
        task: {
          value: "<task>",
          description: "Path, wikilink or title",
          required: true,
        },
        format: FORMAT_FLAG,
      },
      run: async (params) => {
        const tasks = await deps.loadTasks();
        const task = resolveTask(tasks, requireParam(params, "task"));
        const statuses = deps.statuses();
        const byId = new Map(tasks.map((item) => [item.id, item]));
        const children = tasks
          .filter((item) => item.incomingLinks.includes(task.id))
          .map((item) => item.link || item.id);
        const summary = {
          ...summarizeTask(task, statuses, byId),
          wikilink: `[[${deps.linkTarget(task.link || task.id)}]]`,
          children,
        };
        if (wantsJson(params)) return asJson(summary);
        return [
          `${summary.title}${summary.isProject ? " (project)" : ""}`,
          `  path:     ${summary.path}`,
          `  wikilink: ${summary.wikilink}`,
          `  status:   ${summary.statusLabel} (${summary.status})`,
          `  priority: ${summary.priority || "none"}`,
          `  due:      ${summary.due ?? "-"}`,
          `  tags:     ${summary.tags.join(", ") || "-"}`,
          `  parents:  ${summary.parents.join(", ") || "-"}`,
          `  children: ${children.length > 0 ? `\n    ${children.join("\n    ")}` : "-"}`,
        ].join("\n");
      },
    },
    {
      action: "resolve",
      description: "Find tasks by title or name; prints exact paths and links",
      flags: {
        query: {
          value: "<text>",
          description: "Title, filename or wikilink",
          required: true,
        },
        limit: { value: "<n>", description: "Maximum matches (default 10)" },
        format: FORMAT_FLAG,
      },
      run: async (params) => {
        const tasks = await deps.loadTasks();
        const statuses = deps.statuses();
        const matches = rankTasks(tasks, requireParam(params, "query")).slice(
          0,
          parseLimit(params) ?? 10
        );
        const rows = matches.map(({ task, score }) => ({
          path: task.link || task.id,
          wikilink: `[[${deps.linkTarget(task.link || task.id)}]]`,
          title: taskTitle(task),
          status: task.status,
          isProject: task.isProject,
          score,
        }));
        if (wantsJson(params)) return asJson(rows);
        if (rows.length === 0) return "(no matches)";
        return matches
          .map(
            ({ task }, index) =>
              `${formatTaskLine(task, statuses)}\n    ${rows[index].wikilink}`
          )
          .join("\n");
      },
    },
    {
      action: "create",
      description: "Create a task through TaskNotes, optionally under a parent",
      flags: {
        title: { value: "<title>", description: "Task title", required: true },
        parent: { value: "<task>", description: "Parent task or project" },
        status: { value: "<status>", description: "Initial status" },
        priority: { value: "<priority>", description: "Priority id" },
        due: { value: "<date>", description: "Due date (YYYY-MM-DD)" },
        scheduled: { value: "<date>", description: "Scheduled date" },
        tags: { value: "<tag,...>", description: "Comma-separated tags" },
        details: { value: "<text>", description: "Body text above the log" },
        log: { value: "<text>", description: "Text of the first log entry" },
      },
      run: async (params) => {
        const title = requireParam(params, "title");
        const tasks = await deps.loadTasks();
        const parentRef = param(params, "parent");
        const parent = parentRef ? resolveTask(tasks, parentRef) : null;
        const statusArg = param(params, "status");
        const priorityArg = param(params, "priority");
        const data: TaskNotesTaskCreationData = { title };
        if (statusArg) {
          data.status = noteStatusValue(
            resolveStatusArg(statusArg, deps.statuses())
          );
        }
        if (priorityArg) data.priority = resolvePriority(priorityArg);
        const due = parseDate(params, "due");
        const scheduled = parseDate(params, "scheduled");
        if (due) data.due = due;
        if (scheduled) data.scheduled = scheduled;
        const tags = param(params, "tags");
        if (tags) {
          data.tags = tags
            .split(",")
            .map((tag) => tag.trim().replace(/^#/, ""))
            .filter(Boolean);
        }
        const property = deps.dependencyProperty();
        const parentLink = parent
          ? `[[${deps.linkTarget(parent.link || parent.id)}]]`
          : null;
        if (parentLink && property === "projects") data.projects = [parentLink];
        if (parentLink && property === "blockedBy") {
          data.blockedBy = [{ uid: parentLink, reltype: "FINISHTOSTART" }];
        }
        const details = param(params, "details");
        const logText = param(params, "log");
        const body = appendLogEntry(details ? unescapeCliText(details) : "", {
          date: deps.today(),
          title: "Created",
          text: logText ? unescapeCliText(logText) : "",
        }).replace(/^\n+/, "");
        data.details = body;

        const path = await deps.createTask(data);
        if (!path) {
          throw new CliError(
            "TaskNotes could not create the task. Is the TaskNotes plugin enabled?"
          );
        }
        if (parent && property !== "projects" && property !== "blockedBy") {
          await deps.processFrontmatter(path, (frontmatter) => {
            frontmatter[property] = [parentLink];
          });
        }
        return [
          `Created ${path}`,
          `  wikilink: [[${deps.linkTarget(path)}]]`,
          parent ? `  parent:   ${parent.link || parent.id}` : null,
        ]
          .filter(Boolean)
          .join("\n");
      },
    },
    {
      action: "update",
      description: "Change a task's status, priority or dates",
      flags: {
        task: {
          value: "<task>",
          description: "Path, wikilink or title",
          required: true,
        },
        status: { value: "<status>", description: "New status" },
        priority: { value: "<priority>", description: "New priority" },
        due: { value: "<date>", description: "New due date" },
        scheduled: { value: "<date>", description: "New scheduled date" },
        "clear-due": { description: "Remove the due date" },
        "clear-scheduled": { description: "Remove the scheduled date" },
      },
      run: async (params) => {
        const tasks = await deps.loadTasks();
        const task = resolveTask(tasks, requireParam(params, "task"));
        const changes: string[] = [];
        const statusArg = param(params, "status");
        const priorityArg = param(params, "priority");
        const due = parseDate(params, "due");
        const scheduled = parseDate(params, "scheduled");
        const clearDue = flag(params, "clear-due");
        const clearScheduled = flag(params, "clear-scheduled");
        if (
          !statusArg &&
          !priorityArg &&
          !due &&
          !scheduled &&
          !clearDue &&
          !clearScheduled
        ) {
          throw new CliError(
            "Nothing to update: pass status=, priority=, due=, scheduled=, clear-due or clear-scheduled."
          );
        }
        if (statusArg) {
          const status = resolveStatusArg(statusArg, deps.statuses());
          await deps.setStatus(task, status.id);
          changes.push(`status → ${status.label}`);
        }
        if (priorityArg) {
          const priority = resolvePriority(priorityArg);
          await deps.setPriority(task, priority);
          changes.push(`priority → ${priority}`);
        }
        if (due || scheduled || clearDue || clearScheduled) {
          if (task.type !== "note") {
            throw new CliError("Dates can only be changed on note tasks.");
          }
          await deps.processFrontmatter(task.link, (frontmatter) => {
            if (due) frontmatter.due = due;
            if (scheduled) frontmatter.scheduled = scheduled;
            if (clearDue) delete frontmatter.due;
            if (clearScheduled) delete frontmatter.scheduled;
          });
          if (due) changes.push(`due → ${due}`);
          if (scheduled) changes.push(`scheduled → ${scheduled}`);
          if (clearDue) changes.push("due cleared");
          if (clearScheduled) changes.push("scheduled cleared");
        }
        return `Updated ${task.link || task.id}: ${changes.join(", ")}`;
      },
    },
    {
      action: "log",
      description: "Append a dated entry to a task's ## Log section",
      flags: {
        task: {
          value: "<task>",
          description: "Path, wikilink or title",
          required: true,
        },
        text: {
          value: "<text>",
          description: "Entry text (\\n for new lines)",
          required: true,
        },
        title: {
          value: "<title>",
          description: "Entry heading (default: Update)",
        },
        date: { value: "<date>", description: "Entry date (default: today)" },
      },
      run: async (params) => {
        const tasks = await deps.loadTasks();
        const task = resolveTask(tasks, requireParam(params, "task"));
        if (task.type !== "note") {
          throw new CliError("Log entries can only be added to note tasks.");
        }
        const date = parseDate(params, "date") ?? deps.today();
        const title = param(params, "title") ?? "Update";
        const text = unescapeCliText(requireParam(params, "text"));
        await deps.processNote(task.link, (content) =>
          appendLogEntry(content, { date, title, text })
        );
        return `Logged to ${task.link}: ### ${date} — ${title}`;
      },
    },
    {
      action: "link",
      description: "Put a task under a parent (or remove that link)",
      flags: {
        task: { value: "<task>", description: "Child task", required: true },
        parent: {
          value: "<task>",
          description: "Parent task or project",
          required: true,
        },
        remove: { description: "Remove the link instead of adding it" },
      },
      run: async (params) => {
        const tasks = await deps.loadTasks();
        const child = resolveTask(tasks, requireParam(params, "task"));
        const parent = resolveTask(tasks, requireParam(params, "parent"));
        const remove = flag(params, "remove");
        if (child.id === parent.id) {
          throw new CliError("A task cannot be its own parent.");
        }
        if (child.type !== "note") {
          throw new CliError("Links can only be written to note tasks.");
        }
        if (!remove && subtreeIds(tasks, child.id).has(parent.id)) {
          throw new CliError(
            `${parent.link} is already under ${child.link}; linking would create a cycle.`
          );
        }
        const target = await writeParentLink(child, parent, remove);
        const property = deps.dependencyProperty();
        return remove
          ? `Removed ${target} from ${property} of ${child.link}`
          : `Added ${target} to ${property} of ${child.link}`;
      },
    },
    {
      action: "focus",
      description: "Show a task or project in the user's task map",
      flags: {
        task: {
          value: "<task>",
          description: "Path, wikilink or title",
          required: true,
        },
        overview: { description: "Show the whole project around the task" },
        newtab: { description: "Open a new map tab instead of reusing one" },
        layout: { value: "graph|tree", description: "Layout for that tab" },
        direction: {
          value: "horizontal|vertical",
          description: "Layout direction for that tab",
        },
      },
      run: async (params) => {
        const tasks = await deps.loadTasks();
        const task = resolveTask(tasks, requireParam(params, "task"));
        const layout: Partial<MapLayoutOptions> = {};
        const layoutArg = param(params, "layout")?.toLowerCase();
        if (layoutArg) {
          if (layoutArg !== "graph" && layoutArg !== "tree") {
            throw new CliError("layout must be graph or tree.");
          }
          layout.layoutMode = layoutArg;
        }
        const directionArg = param(params, "direction")?.toLowerCase();
        if (directionArg) {
          if (directionArg !== "horizontal" && directionArg !== "vertical") {
            throw new CliError("direction must be horizontal or vertical.");
          }
          layout.layoutDirection =
            directionArg === "vertical" ? "Vertical" : "Horizontal";
        }
        await deps.focus(task.id, {
          overview: flag(params, "overview"),
          newTab: flag(params, "newtab"),
          layout,
        });
        return `Showing ${task.link || task.id} in the task map`;
      },
    },
  ];
}

/** Wrap a command so CLI errors print a clean message instead of a stack. */
export async function runCliCommand(
  command: TasksMapCliCommand,
  params: CliParams
): Promise<string> {
  try {
    return await command.run(params);
  } catch (error) {
    if (error instanceof CliError) return `Error: ${error.message}`;
    console.error("[tasks-map] CLI command failed:", error);
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
}
