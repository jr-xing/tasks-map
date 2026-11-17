import {
  createTasksMapCliCommands,
  runCliCommand,
  TasksMapCliDeps,
} from "../src/lib/cli/tasks-map-cli";
import { DEFAULT_TASK_STATUSES } from "../src/lib/status-config";
import { NoteTask } from "../src/types/note-task";
import type { BaseTask } from "../src/types/base-task";

function makeTask(
  overrides: Partial<ConstructorParameters<typeof NoteTask>[0]> = {}
): NoteTask {
  const id = overrides.id ?? "tasks/task.md";
  return new NoteTask({
    id,
    summary: "Task",
    text: "Task",
    tags: [],
    status: "todo",
    priority: "",
    link: id,
    incomingLinks: [],
    starred: false,
    projects: [],
    ...overrides,
  });
}

function basename(path: string) {
  return path.split("/").pop()!.replace(/\.md$/, "");
}

function setup(dependencyProperty = "projects") {
  const project = makeTask({
    id: "projects/P Alpha.md",
    summary: "Alpha",
    isProject: true,
  });
  const child = makeTask({
    id: "tasks/T Child.md",
    summary: "Child",
    incomingLinks: [project.id],
  });
  const other = makeTask({ id: "tasks/T Other.md", summary: "Other" });
  const tasks: BaseTask[] = [project, child, other];
  const notes = new Map<string, string>([[child.id, "# Child\n"]]);
  const frontmatter = new Map<string, Record<string, unknown>>([
    [child.id, { projects: ["[[P Alpha]]"] }],
    [other.id, {}],
  ]);
  const deps = {
    loadTasks: jest.fn(async () => tasks),
    statuses: () => DEFAULT_TASK_STATUSES,
    defaultStatusIds: () => ["todo", "in_progress"],
    dependencyProperty: () => dependencyProperty,
    priorities: () => [
      { id: "high", label: "High" },
      { id: "low", label: "Low" },
    ],
    today: () => "2026-02-01",
    linkTarget: (path: string) => basename(path),
    processNote: jest.fn(async (path: string, transform) => {
      notes.set(path, transform(notes.get(path) ?? ""));
    }),
    processFrontmatter: jest.fn(async (path: string, mutate) => {
      const fm = frontmatter.get(path) ?? {};
      mutate(fm);
      frontmatter.set(path, fm);
    }),
    setStatus: jest.fn(async () => {}),
    setPriority: jest.fn(async () => {}),
    createTask: jest.fn(async () => "tasks/2026-02-01-TASK New.md"),
    focus: jest.fn(async () => {}),
  } satisfies TasksMapCliDeps;
  const commands = createTasksMapCliCommands(deps, "tasks-map-jrxing");
  const run = (action: string, params: Record<string, string> = {}) =>
    runCliCommand(
      commands.find((command) => command.action === action)!,
      params
    );
  return { deps, run, notes, frontmatter, project, child, other, commands };
}

describe("tasks map CLI", () => {
  it("registers a default command and named actions", () => {
    const { commands } = setup();
    expect(commands.map((command) => command.action)).toEqual([
      "",
      "skill",
      "schema",
      "list",
      "tree",
      "show",
      "resolve",
      "create",
      "update",
      "log",
      "link",
      "focus",
    ]);
  });

  it("prints the agent guide with the plugin's command prefix", async () => {
    const { run } = setup();
    const guide = await run("skill");
    expect(guide).toContain("obsidian tasks-map-jrxing:resolve");
    expect(await run("")).toBe(guide);
  });

  it("lists open tasks by default and all tasks with all", async () => {
    const { run, child } = setup();
    child.status = "done";
    expect(await run("list")).not.toContain("Child");
    expect(await run("list", { all: "true" })).toContain("Child");
  });

  it("returns parseable JSON when asked", async () => {
    const { run } = setup();
    const rows = JSON.parse(await run("list", { format: "json" }));
    expect(rows.map((row: { title: string }) => row.title)).toEqual([
      "Alpha",
      "Child",
      "Other",
    ]);
  });

  it("prints a clean error instead of throwing", async () => {
    const { run } = setup();
    expect(await run("show", {})).toBe("Error: Missing required task=<value>.");
    expect(await run("update", { task: "Child" })).toMatch(
      /^Error: Nothing to update/
    );
  });

  it("shows parents, children and the wikilink", async () => {
    const { run } = setup();
    const text = await run("show", { task: "Alpha" });
    expect(text).toContain("wikilink: [[P Alpha]]");
    expect(text).toContain("tasks/T Child.md");
  });

  it("updates status through the task and dates in frontmatter", async () => {
    const { run, deps, frontmatter, child } = setup();
    const result = await run("update", {
      task: "Child",
      status: "Done",
      due: "2026-03-01",
    });
    expect(deps.setStatus).toHaveBeenCalledWith(child, "done");
    expect(frontmatter.get(child.id)?.due).toBe("2026-03-01");
    expect(result).toBe(
      "Updated tasks/T Child.md: status → Done, due → 2026-03-01"
    );
  });

  it("rejects malformed dates", async () => {
    const { run } = setup();
    expect(await run("update", { task: "Child", due: "next week" })).toMatch(
      /^Error: due must be/
    );
  });

  it("appends a log entry with escaped new lines", async () => {
    const { run, notes, child } = setup();
    await run("log", { task: "Child", text: "line one\nline two" });
    expect(notes.get(child.id)).toBe(
      "# Child\n\n## Log\n\n### 2026-02-01 — Update\nline one\nline two\n"
    );
  });

  it("links into the configured parent property without duplicates", async () => {
    const { run, frontmatter, other } = setup();
    await run("link", { task: "Other", parent: "Alpha" });
    await run("link", { task: "Other", parent: "Alpha" });
    expect(frontmatter.get(other.id)?.projects).toEqual(["[[P Alpha]]"]);
    await run("link", { task: "Other", parent: "Alpha", remove: "true" });
    expect(frontmatter.get(other.id)?.projects).toEqual([]);
  });

  it("writes TaskNotes dependency objects for blockedBy", async () => {
    const { run, frontmatter, other } = setup("blockedBy");
    await run("link", { task: "Other", parent: "Alpha" });
    expect(frontmatter.get(other.id)?.blockedBy).toEqual([
      { uid: "[[P Alpha]]", reltype: "FINISHTOSTART" },
    ]);
  });

  it("refuses links that would create a cycle", async () => {
    const { run } = setup();
    expect(await run("link", { task: "Alpha", parent: "Child" })).toMatch(
      /cycle/
    );
  });

  it("creates through TaskNotes with the parent and a first log entry", async () => {
    const { run, deps } = setup();
    const result = await run("create", {
      title: "New",
      parent: "Alpha",
      status: "in progress",
      priority: "High",
      contexts: "@writing, email",
      log: "Asked by user.",
    });
    expect(deps.createTask).toHaveBeenCalledWith({
      title: "New",
      status: "in-progress",
      priority: "high",
      contexts: ["writing", "email"],
      projects: ["[[P Alpha]]"],
      details: "## Log\n\n### 2026-02-01 — Created\nAsked by user.\n",
    });
    expect(result).toContain("Created tasks/2026-02-01-TASK New.md");
  });

  it("explains when TaskNotes cannot create the task", async () => {
    const { run, deps } = setup();
    deps.createTask.mockResolvedValueOnce(null as never);
    expect(await run("create", { title: "New" })).toMatch(/TaskNotes/);
  });

  it("focuses the map with an optional per-tab layout", async () => {
    const { run, deps, child } = setup();
    await run("focus", {
      task: "Child",
      newtab: "true",
      layout: "tree",
      direction: "vertical",
    });
    expect(deps.focus).toHaveBeenCalledWith(child.id, {
      overview: false,
      newTab: true,
      layout: { layoutMode: "tree", layoutDirection: "Vertical" },
    });
  });
});
