import {
  buildKanbanColumns,
  buildKanbanFocusOptions,
  buildKanbanSections,
  getKanbanCardTitle,
  getKanbanTasks,
  moveKanbanColumn,
  moveKanbanTaskStatus,
  resolveKanbanColumnOrder,
} from "../src/lib/kanban";
import { DataviewTask } from "../src/types/dataview-task";
import type { TaskPriorityConfig } from "../src/lib/priority-config";
import type { TaskStatusConfig } from "../src/lib/status-config";
import {
  DEFAULT_FILTER_STATE,
  type FilterState,
} from "../src/types/filter-state";
import { NoteTask } from "../src/types/note-task";
import type { BaseTask } from "../src/types/task";
import { DEFAULT_SETTINGS } from "../src/types/settings";

const STATUSES: TaskStatusConfig[] = [
  {
    id: "todo",
    label: "Todo",
    color: "#888888",
    checkboxChar: " ",
    noteValues: "open",
  },
  {
    id: "active",
    label: "Active",
    color: "#4488ff",
    checkboxChar: "/",
    noteValues: "active",
  },
  {
    id: "done",
    label: "Done",
    color: "#44aa66",
    checkboxChar: "x",
    noteValues: "done",
  },
];

const PRIORITIES: TaskPriorityConfig[] = [
  { id: "none", value: "none", label: "None", color: "#888", weight: 0 },
  { id: "high", value: "high", label: "High", color: "#f00", weight: 5 },
];

interface TaskOverrides {
  id: string;
  status?: string;
  priority?: string;
  starred?: boolean;
  tags?: string[];
  link?: string;
  projects?: string[];
  incomingLinks?: string[];
  isProject?: boolean;
  summary?: string;
  noteFilename?: string;
  noteFrontmatterTitle?: string | null;
}

function makeTask(overrides: TaskOverrides): BaseTask {
  return new NoteTask({
    id: overrides.id,
    summary: overrides.summary ?? overrides.id,
    text: overrides.id,
    tags: overrides.tags ?? [],
    status: overrides.status ?? "todo",
    priority: overrides.priority ?? "none",
    link: overrides.link ?? `Tasks/${overrides.id}.md`,
    incomingLinks: overrides.incomingLinks ?? [],
    starred: overrides.starred ?? false,
    projects: overrides.projects ?? [],
    isProject: overrides.isProject ?? false,
    noteFilename: overrides.noteFilename,
    noteFrontmatterTitle: overrides.noteFrontmatterTitle,
  });
}

function filter(overrides: Partial<FilterState> = {}): FilterState {
  return { ...DEFAULT_FILTER_STATE, ...overrides };
}

describe("buildKanbanColumns", () => {
  it("keeps configured order and includes empty status columns", () => {
    const columns = buildKanbanColumns(
      [makeTask({ id: "one", status: "active" })],
      STATUSES,
      PRIORITIES
    );

    expect(columns.map((column) => column.status.id)).toEqual([
      "todo",
      "active",
      "done",
    ]);
    expect(columns.map((column) => column.tasks.length)).toEqual([0, 1, 0]);
  });

  it("uses starred, priority, and stable title ordering", () => {
    const columns = buildKanbanColumns(
      [
        makeTask({ id: "normal" }),
        makeTask({ id: "high", priority: "high" }),
        makeTask({ id: "starred", starred: true }),
      ],
      STATUSES,
      PRIORITIES
    );

    expect(columns[0].tasks.map((task) => task.id)).toEqual([
      "starred",
      "high",
      "normal",
    ]);
  });

  it("reorders columns without changing status assignment", () => {
    const columns = buildKanbanColumns(
      [makeTask({ id: "one", status: "active" })],
      STATUSES,
      PRIORITIES,
      { columnOrder: ["done", "todo", "active"] }
    );

    expect(columns.map((column) => column.status.id)).toEqual([
      "done",
      "todo",
      "active",
    ]);
    expect(columns[2].tasks.map((task) => task.id)).toEqual(["one"]);
  });
});

describe("Kanban titles and visibility", () => {
  it("uses readable backward-compatible defaults", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      kanbanCardTitleSource: "frontmatter",
      kanbanShowProjectTasks: false,
      kanbanShowCardStatus: false,
      kanbanGroupByProject: true,
      kanbanOpenNoteOnDoubleClick: true,
      kanbanColumnOrder: [],
    });
  });

  it("uses a frontmatter title with filename fallback", () => {
    const titled = makeTask({
      id: "titled",
      summary: "Global label",
      noteFilename: "2026-09-03-task",
      noteFrontmatterTitle: "Readable task title",
    });
    const untitled = makeTask({
      id: "untitled",
      noteFilename: "Untitled task",
      noteFrontmatterTitle: null,
    });

    expect(getKanbanCardTitle(titled, "frontmatter")).toBe(
      "Readable task title"
    );
    expect(getKanbanCardTitle(titled, "filename")).toBe("2026-09-03-task");
    expect(getKanbanCardTitle(untitled, "frontmatter")).toBe("Untitled task");
  });

  it("keeps the normal summary for inline tasks", () => {
    const task = new DataviewTask({
      id: "inline",
      summary: "Inline task",
      text: "Inline task",
      tags: [],
      status: "todo",
      priority: "",
      link: "Notes/today.md",
      incomingLinks: [],
      starred: false,
    });

    expect(getKanbanCardTitle(task, "frontmatter")).toBe("Inline task");
    expect(getKanbanCardTitle(task, "filename")).toBe("Inline task");
  });
});

describe("Kanban column order", () => {
  it("drops unknown and duplicate ids and appends new statuses", () => {
    expect(
      resolveKanbanColumnOrder(STATUSES, [
        "done",
        "missing",
        "done",
        "todo",
      ]).map((status) => status.id)
    ).toEqual(["done", "todo", "active"]);
  });

  it("moves a column before or after a target", () => {
    expect(moveKanbanColumn(STATUSES, [], "done", "todo", "before")).toEqual([
      "done",
      "todo",
      "active",
    ]);
    expect(moveKanbanColumn(STATUSES, [], "todo", "done", "after")).toEqual([
      "active",
      "done",
      "todo",
    ]);
  });
});

describe("getKanbanTasks", () => {
  it("ignores root and status filters but preserves content filters", () => {
    const tasks = [
      makeTask({
        id: "root",
        status: "done",
        tags: ["keep"],
        projects: ["Project A"],
      }),
      makeTask({
        id: "child",
        status: "todo",
        tags: ["keep"],
        projects: ["Project A"],
        incomingLinks: ["root"],
      }),
      makeTask({ id: "other", tags: ["other"], projects: ["Project B"] }),
    ];

    const result = getKanbanTasks(
      tasks,
      filter({
        selectedRootTask: "root",
        selectedStatuses: ["todo"],
        selectedTags: ["keep"],
        selectedProjects: ["Project A"],
      })
    );

    expect(result.map((task) => task.id)).toEqual(["root", "child"]);
  });

  it("can hide project task cards after applying content filters", () => {
    const project = makeTask({ id: "project", isProject: true });
    const task = makeTask({ id: "task", incomingLinks: ["project"] });

    expect(
      getKanbanTasks([project, task], filter(), {
        showProjectTasks: false,
      }).map((item) => item.id)
    ).toEqual(["task"]);
  });
});

describe("buildKanbanSections", () => {
  it("prefers explicit TaskNotes project labels for grouping", () => {
    const alpha = makeTask({ id: "alpha", projects: ["Project A"] });
    const beta = makeTask({ id: "beta", projects: ["Project A"] });

    const [section] = buildKanbanSections(
      [alpha, beta],
      new Map(),
      PRIORITIES,
      true
    );

    expect(section).toMatchObject({
      kind: "project",
      label: "Project A",
    });
    expect(section.rows.map((row) => row.task.id).sort()).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("groups one project and indents only visible same-column children", () => {
    const parent = makeTask({ id: "parent", priority: "none" });
    const child = makeTask({
      id: "child",
      priority: "high",
      incomingLinks: ["parent"],
    });
    const options = new Map([
      ["parent", [{ rootTaskId: "project", label: "Project" }]],
      ["child", [{ rootTaskId: "project", label: "Project" }]],
    ]);

    const [section] = buildKanbanSections(
      [child, parent],
      options,
      PRIORITIES,
      true
    );

    expect(section.kind).toBe("project");
    expect(section.rows.map((row) => [row.task.id, row.depth])).toEqual([
      ["parent", 0],
      ["child", 1],
    ]);
  });

  it("makes a child a local root when its parent is in another column", () => {
    const child = makeTask({ id: "child", incomingLinks: ["parent"] });
    const options = new Map([
      ["child", [{ rootTaskId: "project", label: "Project" }]],
    ]);

    const [section] = buildKanbanSections([child], options, PRIORITIES, true);

    expect(section.rows).toEqual([{ task: child, depth: 0 }]);
  });

  it("renders multi-project and unassigned tasks once", () => {
    const shared = makeTask({ id: "shared" });
    const orphan = makeTask({ id: "orphan" });
    const options = new Map([
      [
        "shared",
        [
          { rootTaskId: "alpha", label: "Alpha" },
          { rootTaskId: "beta", label: "Beta" },
        ],
      ],
    ]);

    const sections = buildKanbanSections(
      [shared, orphan],
      options,
      PRIORITIES,
      true
    );

    expect(sections.map((section) => section.kind).sort()).toEqual([
      "multiple_projects",
      "no_project",
    ]);
    expect(sections.flatMap((section) => section.rows)).toHaveLength(2);
  });

  it("breaks dependency cycles and never duplicates cards", () => {
    const alpha = makeTask({ id: "alpha", incomingLinks: ["beta"] });
    const beta = makeTask({ id: "beta", incomingLinks: ["alpha"] });
    const options = new Map([
      ["alpha", [{ rootTaskId: "project", label: "Project" }]],
      ["beta", [{ rootTaskId: "project", label: "Project" }]],
    ]);

    const [section] = buildKanbanSections(
      [alpha, beta],
      options,
      PRIORITIES,
      true
    );

    expect(section.rows.map((row) => row.task.id).sort()).toEqual([
      "alpha",
      "beta",
    ]);
  });
});

describe("buildKanbanFocusOptions", () => {
  it("resolves one project root for every task in a tree", () => {
    const options = buildKanbanFocusOptions([
      makeTask({ id: "project" }),
      makeTask({ id: "task", incomingLinks: ["project"] }),
    ]);

    expect(options.get("task")).toEqual([
      { rootTaskId: "project", label: "project" },
    ]);
  });

  it("returns multiple roots for a task shared by two projects", () => {
    const options = buildKanbanFocusOptions([
      makeTask({ id: "alpha" }),
      makeTask({ id: "beta" }),
      makeTask({ id: "shared", incomingLinks: ["alpha", "beta"] }),
    ]);

    expect(options.get("shared")).toEqual([
      { rootTaskId: "alpha", label: "alpha" },
      { rootTaskId: "beta", label: "beta" },
    ]);
  });

  it("does not invent project context for an isolated task", () => {
    const options = buildKanbanFocusOptions([makeTask({ id: "orphan" })]);
    expect(options.has("orphan")).toBe(false);
  });
});

describe("moveKanbanTaskStatus", () => {
  it("does nothing when dropped into the current status", async () => {
    const task = makeTask({ id: "task", status: "todo" });
    const apply = jest.fn();
    const persist = jest.fn(async () => undefined);

    const result = await moveKanbanTaskStatus(task, "todo", apply, persist);

    expect(result).toEqual({ kind: "unchanged" });
    expect(apply).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("applies and persists an optimistic status move", async () => {
    const task = makeTask({ id: "task", status: "todo" });
    const apply = jest.fn();

    const result = await moveKanbanTaskStatus(
      task,
      "active",
      apply,
      async () => undefined
    );

    expect(result).toEqual({ kind: "updated" });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith("task", "active");
  });

  it("rolls back when vault persistence fails", async () => {
    const task = makeTask({ id: "task", status: "todo" });
    const apply = jest.fn();
    const error = new Error("write failed");

    const result = await moveKanbanTaskStatus(
      task,
      "active",
      apply,
      async () => {
        throw error;
      }
    );

    expect(result).toEqual({ kind: "rolled_back", error });
    expect(apply.mock.calls).toEqual([
      ["task", "active"],
      ["task", "todo"],
    ]);
  });
});
