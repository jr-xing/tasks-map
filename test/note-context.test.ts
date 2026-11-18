import {
  buildNoteContext,
  findNoteContextAnchors,
  foldNoteContextTasks,
  getNoteContextRootId,
  shiftIsoDate,
  sortNoteContextTasks,
} from "../src/lib/note-context";
import { DEFAULT_TASK_STATUSES } from "../src/lib/status-config";
import { NoteTask } from "../src/types/note-task";

type TaskOverrides = Partial<
  Pick<NoteTask, "status" | "starred" | "today" | "nextStep">
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

const STATUSES = DEFAULT_TASK_STATUSES;
const ids = (tasks: { id: string }[]) => tasks.map((task) => task.id);

describe("buildNoteContext", () => {
  const tasks = [
    makeTask("project"),
    makeTask("branch", ["project"]),
    makeTask("parent", ["branch"]),
    makeTask("me", ["parent"]),
    makeTask("sibling-b", ["parent"]),
    makeTask("sibling-a", ["parent"]),
    makeTask("child", ["me"]),
    makeTask("unrelated"),
  ];

  it("collects the parent chain, project first", () => {
    const context = buildNoteContext("me", tasks, STATUSES);
    expect(ids(context!.ancestors)).toEqual(["project", "branch", "parent"]);
  });

  it("lists siblings without the task itself, in title order", () => {
    const context = buildNoteContext("me", tasks, STATUSES);
    expect(ids(context!.siblings)).toEqual(["sibling-a", "sibling-b"]);
  });

  it("lists the task's own subtasks", () => {
    const context = buildNoteContext("me", tasks, STATUSES);
    expect(ids(context!.children)).toEqual(["child"]);
  });

  it("shows a project with its subtasks and no path", () => {
    const context = buildNoteContext("project", tasks, STATUSES);
    expect(context!.ancestors).toEqual([]);
    expect(ids(context!.children)).toEqual(["branch"]);
  });

  it("returns null for a lone task unless relations are optional", () => {
    expect(buildNoteContext("unrelated", tasks, STATUSES)).toBeNull();
    const context = buildNoteContext("unrelated", tasks, STATUSES, {
      requireRelations: false,
    });
    expect(context!.task.id).toBe("unrelated");
  });

  it("returns null for an unknown task", () => {
    expect(buildNoteContext("missing", tasks, STATUSES)).toBeNull();
  });

  describe("edge cases", () => {
    it("follows the first parent and reports the others", () => {
      const multi = [
        makeTask("home"),
        makeTask("other"),
        makeTask("me", ["home", "other"]),
        makeTask("home-sibling", ["home"]),
        makeTask("other-sibling", ["other"]),
      ];
      const context = buildNoteContext("me", multi, STATUSES);
      expect(ids(context!.ancestors)).toEqual(["home"]);
      expect(ids(context!.otherParents)).toEqual(["other"]);
      expect(ids(context!.siblings)).toEqual(["home-sibling"]);
    });

    it("stops at a parent cycle", () => {
      const cyclic = [makeTask("a", ["b"]), makeTask("b", ["a"])];
      const context = buildNoteContext("a", cyclic, STATUSES);
      expect(ids(context!.ancestors)).toEqual(["b"]);
    });

    it("ignores links to notes that are not tasks", () => {
      const context = buildNoteContext(
        "me",
        [makeTask("me", ["not-a-task"]), makeTask("kid", ["me"])],
        STATUSES
      );
      expect(context!.ancestors).toEqual([]);
      expect(context!.otherParents).toEqual([]);
    });

    it("ignores a task listed as its own parent", () => {
      const context = buildNoteContext(
        "me",
        [makeTask("me", ["me"])],
        STATUSES
      );
      expect(context).toBeNull();
    });
  });
});

describe("sortNoteContextTasks", () => {
  it("puts the next step first, then flagged, active, open, closed", () => {
    const sorted = sortNoteContextTasks(
      [
        makeTask("done", [], { status: "done" }),
        makeTask("open"),
        makeTask("active", [], { status: "in_progress" }),
        makeTask("starred", [], { starred: true }),
        makeTask("next"),
      ],
      STATUSES,
      "next"
    );
    expect(ids(sorted)).toEqual(["next", "starred", "active", "open", "done"]);
  });

  it("does not lift a closed starred task", () => {
    const sorted = sortNoteContextTasks(
      [makeTask("done", [], { status: "done", starred: true }), makeTask("b")],
      STATUSES
    );
    expect(ids(sorted)).toEqual(["b", "done"]);
  });
});

describe("foldNoteContextTasks", () => {
  it("shows up to the limit and folds open and closed tasks apart", () => {
    const folded = foldNoteContextTasks(
      [
        makeTask("a"),
        makeTask("b"),
        makeTask("c"),
        makeTask("x", [], { status: "done" }),
      ],
      STATUSES,
      2
    );
    expect(ids(folded.shown)).toEqual(["a", "b"]);
    expect(ids(folded.hidden)).toEqual(["c"]);
    expect(ids(folded.closed)).toEqual(["x"]);
  });
});

describe("findNoteContextAnchors", () => {
  const taskIds = new Set(["task-a.md", "task-b.md"]);

  it("anchors a task note on itself", () => {
    expect(
      findNoteContextAnchors("task-a.md", taskIds, ["task-b.md"], [])
    ).toEqual(["task-a.md"]);
  });

  it("anchors other notes on linking tasks first, then linked tasks", () => {
    expect(
      findNoteContextAnchors(
        "chat.md",
        taskIds,
        ["task-b.md", "daily.md"],
        ["task-a.md", "task-b.md"]
      )
    ).toEqual(["task-b.md", "task-a.md"]);
  });

  it("returns no anchors for a note no task claims", () => {
    expect(findNoteContextAnchors("chat.md", taskIds, [], [])).toEqual([]);
  });
});

describe("getNoteContextRootId", () => {
  const tasks = [
    makeTask("project"),
    makeTask("me", ["project"]),
    makeTask("lone"),
  ];

  it.each([
    ["me", "project"],
    ["project", "project"],
  ])("roots %s at %s", (taskId, rootId) => {
    const context = buildNoteContext(taskId, tasks, STATUSES);
    expect(getNoteContextRootId(context!)).toBe(rootId);
  });

  it("has no root for a lone task", () => {
    const context = buildNoteContext("lone", tasks, STATUSES, {
      requireRelations: false,
    });
    expect(getNoteContextRootId(context!)).toBeNull();
  });
});

describe("shiftIsoDate", () => {
  it.each([
    [0, "2026-11-18"],
    [1, "2026-11-19"],
    [13, "2026-12-01"],
    [44, "2027-01-01"],
  ])("shifts by %i days to %s", (days, expected) => {
    expect(shiftIsoDate(new Date(2026, 10, 18), days)).toBe(expected);
  });
});
