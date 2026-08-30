import { TaskPriorityConfig } from "../src/lib/priority-config";
import {
  buildTaskTriageGroups,
  compareTriageTasks,
} from "../src/lib/task-triage";
import { TaskStatusConfig } from "../src/lib/status-config";
import { DataviewTask } from "../src/types/dataview-task";
import { NoteTask } from "../src/types/note-task";
import { BaseTask } from "../src/types/task";

const STATUSES: TaskStatusConfig[] = [
  {
    id: "active",
    label: "Active",
    color: "#4488ff",
    checkboxChar: "/",
    noteValues: "active",
  },
  {
    id: "todo",
    label: "Todo",
    color: "#888888",
    checkboxChar: " ",
    noteValues: "open",
  },
  {
    id: "done",
    label: "Done",
    color: "#44aa66",
    checkboxChar: "x",
    noteValues: "done",
  },
];

const NOTE_PRIORITIES: TaskPriorityConfig[] = [
  { id: "none", value: "none", label: "None", color: "#888", weight: 0 },
  { id: "high", value: "high", label: "High", color: "#f00", weight: 5 },
  {
    id: "urgent",
    value: "urgent",
    label: "Urgent",
    color: "#d00",
    weight: 10,
  },
];

interface TaskOverrides {
  id: string;
  type?: "note" | "dataview";
  summary?: string;
  status?: string;
  priority?: string;
  starred?: boolean;
  dueDate?: string | null;
}

function makeTask(overrides: TaskOverrides): BaseTask {
  const TaskClass = overrides.type === "dataview" ? DataviewTask : NoteTask;
  return new TaskClass({
    id: overrides.id,
    summary: overrides.summary ?? overrides.id,
    text: overrides.summary ?? overrides.id,
    tags: [],
    status: overrides.status ?? "todo",
    priority: overrides.priority ?? "none",
    link: `Tasks/${overrides.id}.md`,
    incomingLinks: [],
    starred: overrides.starred ?? false,
    dueDate: overrides.dueDate ?? null,
  });
}

describe("buildTaskTriageGroups", () => {
  it("uses configured status order and omits empty groups", () => {
    const groups = buildTaskTriageGroups(
      [
        makeTask({ id: "todo-task", status: "todo" }),
        makeTask({ id: "active-task", status: "active" }),
      ],
      STATUSES,
      NOTE_PRIORITIES
    );

    expect(groups.map((group) => group.status.id)).toEqual(["active", "todo"]);
  });

  it("falls unknown statuses back to the first configured group", () => {
    const groups = buildTaskTriageGroups(
      [makeTask({ id: "unknown", status: "missing" })],
      STATUSES,
      NOTE_PRIORITIES
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].status.id).toBe("active");
    expect(groups[0].tasks[0].id).toBe("unknown");
  });
});

describe("compareTriageTasks", () => {
  it("sorts starred tasks before every unstarred task", () => {
    const tasks = [
      makeTask({ id: "urgent", priority: "urgent" }),
      makeTask({ id: "starred", starred: true }),
    ].sort((left, right) => compareTriageTasks(left, right, NOTE_PRIORITIES));

    expect(tasks.map((task) => task.id)).toEqual(["starred", "urgent"]);
  });

  it("uses source-specific priority weights", () => {
    const tasks = [
      makeTask({ id: "note-high", priority: "high" }),
      makeTask({
        id: "inline-highest",
        type: "dataview",
        priority: "🔺",
      }),
      makeTask({ id: "note-urgent", priority: "urgent" }),
    ].sort((left, right) => compareTriageTasks(left, right, NOTE_PRIORITIES));

    expect(tasks.map((task) => task.id)).toEqual([
      "note-urgent",
      "inline-highest",
      "note-high",
    ]);
  });

  it("sorts due dates ascending and leaves undated tasks last", () => {
    const tasks = [
      makeTask({ id: "undated" }),
      makeTask({ id: "later", dueDate: "2026-09-10" }),
      makeTask({ id: "earlier", dueDate: "2026-09-01" }),
    ].sort((left, right) => compareTriageTasks(left, right, NOTE_PRIORITIES));

    expect(tasks.map((task) => task.id)).toEqual([
      "earlier",
      "later",
      "undated",
    ]);
  });

  it("uses a case-insensitive label and then ID as stable tie-breakers", () => {
    const tasks = [
      makeTask({ id: "b", summary: "alpha" }),
      makeTask({ id: "a", summary: "Alpha" }),
      makeTask({ id: "c", summary: "Beta" }),
    ].sort((left, right) => compareTriageTasks(left, right, NOTE_PRIORITIES));

    expect(tasks.map((task) => task.id)).toEqual(["a", "b", "c"]);
  });
});
