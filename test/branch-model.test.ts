import {
  buildBranchModel,
  getDependencyConnections,
  getStatusCategory,
} from "../src/lib/branch-model";
import { DEFAULT_TASK_STATUSES } from "../src/lib/status-config";
import { NoteTask } from "../src/types/note-task";

type TaskOverrides = Partial<
  Pick<
    NoteTask,
    | "status"
    | "isProject"
    | "isBranch"
    | "nextStep"
    | "waitingOn"
    | "relatedLinks"
    | "blockedByLinks"
    | "dueDate"
  >
>;

function makeTask(
  id: string,
  parents: string[] = [],
  overrides: TaskOverrides = {}
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

const STATUSES = [
  ...DEFAULT_TASK_STATUSES,
  {
    id: "custom-active",
    label: "Active",
    color: "#000",
    checkboxChar: "",
    noteValues: "active",
  },
  {
    id: "custom-pinned",
    label: "Pinned",
    color: "#000",
    checkboxChar: "",
    noteValues: "pinned",
  },
];

describe("getStatusCategory", () => {
  it.each([
    ["done", "closed"],
    ["canceled", "closed"],
    ["in_progress", "active"],
    ["custom-active", "active"],
    ["custom-pinned", "open"],
    ["todo", "open"],
  ])("sorts %s as %s", (status, expected) => {
    expect(getStatusCategory(status, STATUSES)).toBe(expected);
  });
});

describe("buildBranchModel", () => {
  describe("explicit branches", () => {
    const tasks = [
      makeTask("P", [], { isProject: true }),
      makeTask("Bio", ["P"], { isBranch: true }),
      makeTask("Strain", ["Bio"], { isBranch: true, nextStep: "S2" }),
      makeTask("S1", ["Strain"], { status: "in_progress" }),
      makeTask("S2", ["Strain"]),
      makeTask("S3", ["Strain"], { waitingOn: "Omar" }),
      makeTask("S4", ["Strain"], { status: "done" }),
      makeTask("T1", ["Bio"], { isBranch: true }),
      makeTask("T1a", ["T1"]),
      makeTask("Loose", ["P"]),
      makeTask("LooseChild", ["Loose"]),
    ];
    const model = buildBranchModel(tasks, STATUSES);

    it("assigns levels from the notes", () => {
      expect(model.levels.get("P")).toBe("project");
      expect(model.levels.get("Bio")).toBe("group");
      expect(model.levels.get("Strain")).toBe("branch");
      expect(model.levels.get("S1")).toBe("task");
    });

    it("does not guess branches when the project marks its own", () => {
      expect(model.levels.get("Loose")).toBe("task");
    });

    it("folds leaf branches only", () => {
      expect([...model.foldIds].sort()).toEqual(["Strain", "T1"]);
    });

    it("summarises a branch", () => {
      const summary = model.summaries.get("Strain")!;
      expect(summary).toMatchObject({
        active: 1,
        open: 1,
        waiting: 1,
        closed: 1,
        waitingOn: ["Omar"],
      });
      expect(summary.next?.id).toBe("S2");
      expect(summary.suggested).toBeNull();
    });

    it("aggregates a group over its sub-branches", () => {
      const summary = model.summaries.get("Bio")!;
      expect(summary.subBranches).toBe(2);
      expect(summary.active + summary.open + summary.waiting).toBe(4);
    });

    it("suggests the most pressing task when no next step is named", () => {
      expect(model.summaries.get("T1")!.suggested?.id).toBe("T1a");
    });

    it("leaves suggestions to the sub-branches of a group", () => {
      expect(model.summaries.get("Bio")!.suggested).toBeNull();
    });
  });

  describe("fallback without kind properties", () => {
    it("treats a project's children that have children as branches", () => {
      const tasks = [
        makeTask("P", [], { isProject: true }),
        makeTask("A", ["P"]),
        makeTask("A1", ["A"]),
        makeTask("A1x", ["A1"]),
        makeTask("Leaf", ["P"]),
      ];
      const model = buildBranchModel(tasks, STATUSES);
      expect(model.levels.get("A")).toBe("branch");
      expect(model.levels.get("A1")).toBe("task");
      expect(model.levels.get("Leaf")).toBe("task");
      expect(model.summaries.get("A")!.open).toBe(2);
    });

    it("uses a parentless task with children as an anchor", () => {
      const tasks = [
        makeTask("Root"),
        makeTask("A", ["Root"]),
        makeTask("A1", ["A"]),
      ];
      expect(buildBranchModel(tasks, STATUSES).levels.get("A")).toBe("branch");
    });
  });

  describe("edge cases", () => {
    it("ignores a next step that is already closed", () => {
      const tasks = [
        makeTask("P", [], { isProject: true }),
        makeTask("B", ["P"], { isBranch: true, nextStep: "B1" }),
        makeTask("B1", ["B"], { status: "done" }),
        makeTask("B2", ["B"]),
      ];
      const summary = buildBranchModel(tasks, STATUSES).summaries.get("B")!;
      expect(summary.next).toBeNull();
      expect(summary.suggested?.id).toBe("B2");
    });

    it("lists open related tasks from outside the branch", () => {
      const tasks = [
        makeTask("P", [], { isProject: true }),
        makeTask("B", ["P"], { isBranch: true }),
        makeTask("B1", ["B"]),
        makeTask("Elsewhere", [], { relatedLinks: ["B"] }),
        makeTask("Finished", [], { relatedLinks: ["B"], status: "done" }),
      ];
      const summary = buildBranchModel(tasks, STATUSES).summaries.get("B")!;
      expect(summary.related.map((task) => task.id)).toEqual(["Elsewhere"]);
    });

    it("survives a parent cycle", () => {
      const tasks = [
        makeTask("P", [], { isProject: true }),
        makeTask("A", ["P", "B"], { isBranch: true }),
        makeTask("B", ["A"]),
      ];
      expect(() => buildBranchModel(tasks, STATUSES)).not.toThrow();
    });
  });
});

describe("getDependencyConnections", () => {
  const tasks = [
    makeTask("P", [], { isProject: true }),
    makeTask("LGE", ["P"], { isBranch: true }),
    makeTask("relabel", ["LGE"]),
    makeTask("Analysis", ["P"], { isBranch: true }),
    makeTask("verify", ["Analysis"], { blockedByLinks: ["relabel"] }),
  ];

  it("connects the visible cards when both ends are shown", () => {
    const visible = new Set(tasks.map((task) => task.id));
    expect(getDependencyConnections(tasks, visible)).toEqual([
      { source: "relabel", target: "verify", label: "relabel → verify" },
    ]);
  });

  it("moves folded ends to their nearest visible ancestor", () => {
    const visible = new Set(["P", "LGE", "Analysis"]);
    expect(getDependencyConnections(tasks, visible)).toEqual([
      { source: "LGE", target: "Analysis", label: "relabel → verify" },
    ]);
  });

  it("drops links that collapse onto one card", () => {
    const visible = new Set(["P"]);
    expect(getDependencyConnections(tasks, visible)).toEqual([]);
  });
});
