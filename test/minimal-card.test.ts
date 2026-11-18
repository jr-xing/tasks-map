import {
  getDueState,
  getMinimalNodeTitle,
  isImportantPriority,
} from "../src/lib/minimal-card";
import { TASKNOTES_PRIORITY_OPTIONS } from "../src/lib/priority-config";
import { NoteTask } from "../src/types/note-task";

function makeTask(overrides: Partial<NoteTask> = {}): NoteTask {
  const task = new NoteTask({
    id: "t",
    summary: "2026-01-01 Summary",
    text: "t",
    tags: [],
    status: "todo",
    priority: "normal",
    link: "t.md",
    incomingLinks: [],
    starred: false,
  });
  return Object.assign(task, overrides);
}

describe("getDueState", () => {
  const today = new Date(2026, 10, 17);

  it.each([
    ["2026-11-16", "overdue"],
    ["2026-11-17", "soon"],
    ["2026-11-20", "soon"],
    ["2026-11-21", null],
    ["2026-11-20T09:00", "soon"],
  ])("sorts %s as %s", (due, expected) => {
    expect(getDueState(due, today)).toBe(expected);
  });

  it("ignores missing and malformed dates", () => {
    expect(getDueState(null, today)).toBeNull();
    expect(getDueState("next week", today)).toBeNull();
  });
});

describe("isImportantPriority", () => {
  it.each([
    ["urgent", true],
    ["high", true],
    ["medium-high", false],
    ["normal", false],
    ["none", false],
  ])("TaskNotes %s → %s", (priority, expected) => {
    expect(isImportantPriority(priority, TASKNOTES_PRIORITY_OPTIONS)).toBe(
      expected
    );
  });

  it.each([
    ["\u{1F53A}", true],
    ["\u{23EB}", true],
    ["\u{1F53C}", false],
    ["", false],
  ])("Tasks plugin %s → %s", (priority, expected) => {
    expect(isImportantPriority(priority)).toBe(expected);
  });
});

describe("getMinimalNodeTitle", () => {
  it("prefers the note title over the summary", () => {
    expect(
      getMinimalNodeTitle(makeTask({ noteFrontmatterTitle: "Title" }))
    ).toBe("Title");
  });

  it("falls back to the summary", () => {
    expect(getMinimalNodeTitle(makeTask())).toBe("2026-01-01 Summary");
  });
});
