import type { App } from "obsidian";
import {
  getHomeRoots,
  NO_TASK_GROUP,
  orderTaskGroups,
  parseTaskGroupOrder,
  resolveTaskGroups,
  splitTaskGroupEdges,
} from "../src/lib/task-groups";
import {
  createEdgesFromTasks,
  getNoteTasks,
  parseTaskGroupValue,
} from "../src/lib/utils";
import { NoteTask } from "../src/types/note-task";

function makeTask(
  id: string,
  parents: string[] = [],
  overrides: Partial<NoteTask> = {}
): NoteTask {
  const task = new NoteTask({
    id,
    summary: id,
    text: id,
    tags: [],
    status: "todo",
    priority: "normal",
    link: `${id}.md`,
    incomingLinks: parents,
    starred: false,
  });
  return Object.assign(task, overrides);
}

function makeApp(frontmatter: Record<string, unknown>) {
  const file = {
    path: "Tasks/Example.md",
    basename: "Example",
    extension: "md",
  };
  return {
    vault: {
      getFileByPath: () => file,
      getMarkdownFiles: () => [file],
      getAbstractFileByPath: () => null,
    },
    metadataCache: {
      getFileCache: () => ({ frontmatter }),
      getFirstLinkpathDest: () => null,
    },
  } as unknown as App;
}

describe("parseTaskGroupValue", () => {
  it.each([
    ["Yale core", "Yale core"],
    ["  Yale core  ", "Yale core"],
    ["[[Yale core]]", "Yale core"],
    ["[[groups/Yale core.md]]", "Yale core"],
    ["[[groups/Yale core#Notes|Core]]", "Core"],
    [["My own work", "Other"], "My own work"],
    [["", "Second"], "Second"],
    [undefined, ""],
    [null, ""],
    [3, ""],
  ])("reads %p as %p", (value, expected) => {
    expect(parseTaskGroupValue(value)).toBe(expected);
  });
});

describe("reading the task group from frontmatter", () => {
  it("uses the default taskGroup property", () => {
    const app = makeApp({ tags: ["task"], taskGroup: "Yale core" });
    expect(getNoteTasks(app)[0].taskGroup).toBe("Yale core");
  });

  it("uses a configured property", () => {
    const app = makeApp({ tags: ["task"], area: "[[My own work]]" });
    const [task] = getNoteTasks(app, {
      branchProperties: {
        kindProperty: "kind",
        branchValue: "area",
        nextProperty: "next",
        waitingOnProperty: "waitingOn",
        relatedProperty: "related",
        groupProperty: "contexts",
        taskGroupProperty: "area",
      },
    });
    expect(task.taskGroup).toBe("My own work");
  });

  it("is empty when the note names no group", () => {
    const app = makeApp({ tags: ["task"] });
    expect(getNoteTasks(app)[0].taskGroup).toBe("");
  });
});

describe("resolveTaskGroups", () => {
  it("passes a project's group down to its subtasks", () => {
    const tasks = [
      makeTask("P", [], { taskGroup: "Yale core" }),
      makeTask("A", ["P"]),
      makeTask("A1", ["A"]),
      makeTask("Q"),
    ];
    const groups = resolveTaskGroups(tasks);
    expect(groups.get("P")).toBe("Yale core");
    expect(groups.get("A")).toBe("Yale core");
    expect(groups.get("A1")).toBe("Yale core");
    expect(groups.get("Q")).toBe(NO_TASK_GROUP);
  });

  it("lets a subtask name its own group", () => {
    const tasks = [
      makeTask("P", [], { taskGroup: "Yale core" }),
      makeTask("A", ["P"], { taskGroup: "My own work" }),
      makeTask("A1", ["A"]),
    ];
    const groups = resolveTaskGroups(tasks);
    expect(groups.get("A")).toBe("My own work");
    expect(groups.get("A1")).toBe("My own work");
  });

  it("follows the first parent of a shared note", () => {
    const tasks = [
      makeTask("Toolkit", [], { taskGroup: "Data" }),
      makeTask("PIS", [], { taskGroup: "Core" }),
      makeTask("Shared", ["Toolkit", "PIS"]),
    ];
    expect(resolveTaskGroups(tasks).get("Shared")).toBe("Data");
  });

  it("skips parents that are not tasks", () => {
    const tasks = [
      makeTask("P", [], { taskGroup: "Core" }),
      makeTask("A", ["missing.md", "P"]),
    ];
    expect(resolveTaskGroups(tasks).get("A")).toBe("Core");
  });

  it("matches names regardless of case and keeps the first spelling", () => {
    const tasks = [
      makeTask("P", [], { taskGroup: "Yale core" }),
      makeTask("Q", [], { taskGroup: "yale CORE" }),
    ];
    const groups = resolveTaskGroups(tasks);
    expect(groups.get("Q")).toBe("Yale core");
  });

  describe("edge cases", () => {
    it("ends a parent cycle without a group", () => {
      const tasks = [makeTask("A", ["B"]), makeTask("B", ["A"])];
      const groups = resolveTaskGroups(tasks);
      expect(groups.get("A")).toBe(NO_TASK_GROUP);
      expect(groups.get("B")).toBe(NO_TASK_GROUP);
    });

    it("ignores a task listing itself as parent", () => {
      const tasks = [makeTask("A", ["A"], { taskGroup: "Core" })];
      expect(resolveTaskGroups(tasks).get("A")).toBe("Core");
    });
  });
});

describe("getHomeRoots", () => {
  it("walks first parents up to the project", () => {
    const tasks = [
      makeTask("P"),
      makeTask("Q"),
      makeTask("A", ["P"]),
      makeTask("B", ["A", "Q"]),
    ];
    const roots = getHomeRoots(tasks);
    expect(roots.get("A")).toBe("P");
    expect(roots.get("B")).toBe("P");
    expect(roots.get("Q")).toBe("Q");
  });

  it("gives every task in a parent cycle the same root", () => {
    const roots = getHomeRoots([makeTask("A", ["B"]), makeTask("B", ["A"])]);
    expect(roots.get("A")).toBe("A");
    expect(roots.get("B")).toBe("A");
  });
});

describe("splitTaskGroupEdges", () => {
  const tasks = [
    makeTask("Toolkit", [], { taskGroup: "Data" }),
    makeTask("PIS", [], { taskGroup: "Core" }),
    makeTask("CHIP", [], { taskGroup: "Core" }),
    makeTask("T1", ["Toolkit"]),
    makeTask("Shared", ["Toolkit", "PIS"]),
    makeTask("CoreShared", ["PIS", "CHIP"]),
    makeTask("Inner", ["T1", "Toolkit"]),
  ];
  const edges = createEdgesFromTasks(tasks);
  const { layoutEdges, crossEdges } = splitTaskGroupEdges(
    edges,
    tasks,
    resolveTaskGroups(tasks)
  );
  const ids = (list: typeof edges) => list.map((edge) => edge.id).sort();

  it("keeps links inside one project in the layout", () => {
    expect(ids(layoutEdges)).toEqual(
      [
        "Toolkit-T1",
        "Toolkit-Shared",
        "PIS-CoreShared",
        "T1-Inner",
        "Toolkit-Inner",
      ].sort()
    );
  });

  it("draws links to other projects without laying them out", () => {
    expect(ids(crossEdges)).toEqual(["CHIP-CoreShared", "PIS-Shared"]);
  });
});

describe("orderTaskGroups", () => {
  it("puts listed groups first, then the rest, then no group", () => {
    expect(
      orderTaskGroups(
        ["Others", NO_TASK_GROUP, "My own work", "Alpha", "Yale core"],
        ["yale core", "My own work", "Missing"]
      )
    ).toEqual(["Yale core", "My own work", "Alpha", "Others", NO_TASK_GROUP]);
  });

  it("sorts alphabetically without an order", () => {
    expect(orderTaskGroups(["b", "A", "c"], [])).toEqual(["A", "b", "c"]);
  });

  it("drops duplicate names", () => {
    expect(orderTaskGroups(["A", "A"], [])).toEqual(["A"]);
  });
});

describe("parseTaskGroupOrder", () => {
  it("splits lines and commas, trims and drops duplicates", () => {
    expect(
      parseTaskGroupOrder("Yale core\n My own work , Others\n\nyale core")
    ).toEqual(["Yale core", "My own work", "Others"]);
  });
});
