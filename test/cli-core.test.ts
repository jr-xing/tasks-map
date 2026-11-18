import {
  appendLogEntry,
  CliError,
  filterTaskList,
  flag,
  param,
  rankTasks,
  renderTreeText,
  resolveStatusArg,
  resolveTask,
  subtreeIds,
  unescapeCliText,
} from "../src/lib/cli/cli-core";
import { DEFAULT_TASK_STATUSES } from "../src/lib/status-config";
import { DataviewTask } from "../src/types/dataview-task";
import { NoteTask } from "../src/types/note-task";

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

const project = makeTask({
  id: "projects/2026-01-01-PROJECT Alpha.md",
  summary: "Alpha",
  isProject: true,
});
const setup = makeTask({
  id: "tasks/2026-01-02-TASK Set up data.md",
  summary: "Set up data",
  incomingLinks: [project.id],
  dueDate: "2026-01-10",
});
const clean = makeTask({
  id: "tasks/2026-01-03-TASK Clean cohort.md",
  summary: "Clean cohort",
  incomingLinks: [setup.id],
  status: "done",
  tags: ["source/yale"],
});
const report = makeTask({
  id: "tasks/2026-01-04-TASK Write report.md",
  summary: "Write report",
  incomingLinks: [project.id],
});
const tasks = [report, clean, project, setup];

describe("cli core", () => {
  describe("params", () => {
    it("treats bare flags as true and false as off", () => {
      expect(flag({ all: "true" }, "all")).toBe(true);
      expect(flag({ all: "false" }, "all")).toBe(false);
      expect(flag({}, "all")).toBe(false);
    });

    it("ignores empty values and bare flags for value params", () => {
      expect(param({ task: "  " }, "task")).toBeUndefined();
      expect(param({ task: "true" }, "task")).toBeUndefined();
      expect(param({ task: " Alpha " }, "task")).toBe("Alpha");
    });

    it("turns literal \n into new lines", () => {
      expect(unescapeCliText("a\nb\tc")).toBe("a\nb\tc");
    });
  });

  describe("resolving tasks", () => {
    it.each([
      ["projects/2026-01-01-PROJECT Alpha.md", project],
      ["[[2026-01-01-PROJECT Alpha]]", project],
      ["[[2026-01-01-PROJECT Alpha|Alpha]]", project],
      ["Alpha", project],
      ["clean", clean],
      ["write rep", report],
    ])("resolves %p", (ref, expected) => {
      expect(resolveTask(tasks, ref)).toBe(expected);
    });

    it("refuses to guess between equally good matches", () => {
      const twin = makeTask({
        id: "other/2026-03-01-TASK Write report.md",
        summary: "Write report",
      });
      expect(() => resolveTask([report, twin], "Write report")).toThrow(
        /matches 2 tasks/
      );
    });

    it("reports unknown tasks", () => {
      expect(() => resolveTask(tasks, "nothing like this")).toThrow(CliError);
    });

    it("matches all words in any order as a last resort", () => {
      expect(rankTasks(tasks, "cohort clean")[0].task).toBe(clean);
    });

    describe("checkbox tasks inside a note", () => {
      const notePath = "projects/2026-03-07-Project PIS score.md";
      const pis = makeTask({ id: notePath, summary: "PIS score" });
      const checkbox = (text: string, line: number) =>
        new DataviewTask({
          id: `${notePath}:${line}`,
          summary: text,
          text,
          tags: [],
          status: "todo",
          priority: "",
          link: notePath,
          incomingLinks: [],
          starred: false,
          projects: [],
        });
      const freeze = checkbox("By 2026-08-14: freeze the PIS v0 cohort", 22);
      const train = checkbox("By 2026-08-28: train the T1 baseline", 24);
      const withCheckboxes = [freeze, pis, train];

      it.each([
        [notePath],
        ["[[2026-03-07-Project PIS score]]"],
        ["2026-03-07-Project PIS"],
        ["PIS score"],
      ])("resolves %p to the note, not its checkboxes", (ref) => {
        expect(resolveTask(withCheckboxes, ref)).toBe(pis);
      });

      it("still finds a checkbox by its own text", () => {
        expect(resolveTask(withCheckboxes, "freeze the PIS v0")).toBe(freeze);
      });

      it("names checkboxes when only checkboxes match the file", () => {
        expect(() => resolveTask([freeze, train], notePath)).toThrow(
          /checkbox: By 2026-08-14/
        );
      });
    });
  });

  describe("statuses", () => {
    it("accepts id, label or note value", () => {
      expect(resolveStatusArg("done", DEFAULT_TASK_STATUSES).id).toBe("done");
      expect(resolveStatusArg("Todo", DEFAULT_TASK_STATUSES).id).toBe("todo");
      expect(resolveStatusArg("open", DEFAULT_TASK_STATUSES).id).toBe("todo");
    });

    it("lists allowed statuses on a typo", () => {
      expect(() => resolveStatusArg("dnoe", DEFAULT_TASK_STATUSES)).toThrow(
        /Use one of/
      );
    });
  });

  describe("listing", () => {
    it("collects a subtree without escaping it", () => {
      expect(subtreeIds(tasks, setup.id)).toEqual(
        new Set([setup.id, clean.id])
      );
    });

    it("filters by status, subtree, tag and due date", () => {
      const today = "2026-02-01";
      expect(
        filterTaskList(tasks, { statusIds: ["todo"] }, today).map((t) => t.id)
      ).toEqual([project.id, setup.id, report.id]);
      expect(filterTaskList(tasks, { withinTaskId: setup.id }, today)).toEqual([
        clean,
        setup,
      ]);
      expect(filterTaskList(tasks, { tag: "source" }, today)).toEqual([clean]);
      expect(filterTaskList(tasks, { overdue: true }, today)).toEqual([setup]);
      expect(filterTaskList(tasks, { limit: 1 }, today)).toHaveLength(1);
    });
  });

  describe("text tree", () => {
    it("draws the project first with subtasks on a branch lane", () => {
      expect(renderTreeText(tasks, DEFAULT_TASK_STATUSES)).toBe(
        [
          "● Alpha [Todo]",
          "● Set up data [Todo] due 2026-01-10",
          "│ ● Clean cohort [Done]",
          "● Write report [Todo]",
        ].join("\n")
      );
    });

    it("says so when there is nothing to draw", () => {
      expect(renderTreeText([], DEFAULT_TASK_STATUSES)).toBe("(no tasks)");
    });
  });

  describe("log entries", () => {
    const entry = { date: "2026-02-01", title: "Update", text: "Ran 052." };

    it("appends after the last entry in the Log section", () => {
      const note = [
        "# Task",
        "",
        "## Log",
        "",
        "### 2026-01-01 — Created",
        "Start.",
        "",
        "## Notes",
        "Keep.",
      ].join("\n");
      expect(appendLogEntry(note, entry)).toBe(
        [
          "# Task",
          "",
          "## Log",
          "",
          "### 2026-01-01 — Created",
          "Start.",
          "",
          "### 2026-02-01 — Update",
          "Ran 052.",
          "",
          "## Notes",
          "Keep.",
        ].join("\n")
      );
    });

    it("creates the Log section at the end when missing", () => {
      expect(appendLogEntry("Body\n\n", entry)).toBe(
        "Body\n\n## Log\n\n### 2026-02-01 — Update\nRan 052.\n"
      );
    });

    it("keeps Windows line endings", () => {
      const result = appendLogEntry("## Log\r\n", entry);
      expect(result).toContain("\r\n### 2026-02-01 — Update\r\n");
      expect(result).not.toMatch(/[^\r]\n/);
    });

    it("keeps deeper headings inside the Log section", () => {
      const note = "## Log\n\n### 2026-01-01 — Created\n#### Detail\nx\n";
      expect(
        appendLogEntry(note, entry).endsWith(
          "#### Detail\nx\n\n### 2026-02-01 — Update\nRan 052.\n"
        )
      ).toBe(true);
    });
  });
});
