import {
  buildKanbanColumns,
  buildKanbanFocusOptions,
  getKanbanTasks,
  moveKanbanTaskStatus,
} from "../src/lib/kanban";
import type { TaskPriorityConfig } from "../src/lib/priority-config";
import type { TaskStatusConfig } from "../src/lib/status-config";
import {
  DEFAULT_FILTER_STATE,
  type FilterState,
} from "../src/types/filter-state";
import { NoteTask } from "../src/types/note-task";
import type { BaseTask } from "../src/types/task";

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
}

function makeTask(overrides: TaskOverrides): BaseTask {
  return new NoteTask({
    id: overrides.id,
    summary: overrides.id,
    text: overrides.id,
    tags: overrides.tags ?? [],
    status: overrides.status ?? "todo",
    priority: overrides.priority ?? "none",
    link: overrides.link ?? `Tasks/${overrides.id}.md`,
    incomingLinks: overrides.incomingLinks ?? [],
    starred: overrides.starred ?? false,
    projects: overrides.projects ?? [],
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
