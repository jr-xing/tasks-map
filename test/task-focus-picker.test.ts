import {
  buildTaskFocusCandidates,
  createTaskFocusFilter,
} from "../src/lib/task-focus-picker";
import { DEFAULT_FILTER_STATE, FilterState } from "../src/types/filter-state";
import { NoteTask } from "../src/types/note-task";
import { TaskStatus } from "../src/types/task";

function makeTask(overrides: {
  id: string;
  summary?: string;
  tags?: string[];
  projects?: string[];
  incomingLinks?: string[];
  status?: TaskStatus;
  isProject?: boolean;
}): NoteTask {
  return new NoteTask({
    id: overrides.id,
    summary: overrides.summary ?? overrides.id,
    text: "",
    tags: overrides.tags ?? [],
    status: overrides.status ?? "todo",
    priority: "",
    link: `tasks/${overrides.id}.md`,
    incomingLinks: overrides.incomingLinks ?? [],
    starred: false,
    projects: overrides.projects ?? [],
    isProject: overrides.isProject ?? false,
  });
}

function filter(overrides: Partial<FilterState> = {}): FilterState {
  return { ...DEFAULT_FILTER_STATE, ...overrides };
}

describe("buildTaskFocusCandidates", () => {
  it("returns tree-ordered task candidates with depth and path metadata", () => {
    const candidates = buildTaskFocusCandidates(
      [
        makeTask({ id: "P", summary: "Project" }),
        makeTask({ id: "B", summary: "Beta", incomingLinks: ["P"] }),
        makeTask({ id: "A", summary: "Alpha", incomingLinks: ["P"] }),
        makeTask({ id: "A1", summary: "Alpha One", incomingLinks: ["A"] }),
      ],
      filter()
    );

    expect(candidates.map((candidate) => candidate.taskId)).toEqual([
      "P",
      "A",
      "A1",
      "B",
    ]);
    expect(candidates.map((candidate) => candidate.depth)).toEqual([
      0, 1, 2, 1,
    ]);
    expect(candidates[2]).toMatchObject({
      taskId: "A1",
      rootTaskId: "P",
      path: ["Project", "Alpha", "Alpha One"],
    });
  });

  it("excludes tasks hidden by the default status filter", () => {
    const candidates = buildTaskFocusCandidates(
      [
        makeTask({ id: "P", summary: "Project", status: "todo" }),
        makeTask({
          id: "Done",
          summary: "Done task",
          status: "done",
          incomingLinks: ["P"],
        }),
        makeTask({
          id: "Todo",
          summary: "Todo task",
          status: "todo",
          incomingLinks: ["P"],
        }),
      ],
      filter({ selectedStatuses: ["todo"] })
    );

    expect(candidates.map((candidate) => candidate.taskId)).toEqual([
      "P",
      "Todo",
    ]);
  });

  it("does not include isolated tasks outside the project tree", () => {
    const candidates = buildTaskFocusCandidates(
      [
        makeTask({ id: "P", summary: "Project" }),
        makeTask({ id: "A", summary: "Alpha", incomingLinks: ["P"] }),
        makeTask({ id: "Standalone", summary: "Standalone" }),
      ],
      filter()
    );

    expect(candidates.map((candidate) => candidate.taskId)).toEqual(["P", "A"]);
  });

  it("includes a project note that has no tasks attached to it yet", () => {
    const candidates = buildTaskFocusCandidates(
      [
        makeTask({ id: "P", summary: "Project" }),
        makeTask({ id: "A", summary: "Alpha", incomingLinks: ["P"] }),
        makeTask({ id: "New", summary: "New project", isProject: true }),
      ],
      filter()
    );

    expect(candidates.map((candidate) => candidate.taskId)).toEqual([
      "New",
      "P",
      "A",
    ]);
    expect(candidates[0]).toMatchObject({
      taskId: "New",
      rootTaskId: "New",
      depth: 0,
      path: ["New project"],
    });
  });

  it("includes task metadata and ancestry in search text", () => {
    const [, candidate] = buildTaskFocusCandidates(
      [
        makeTask({ id: "P", summary: "Project" }),
        makeTask({
          id: "A",
          summary: "Write proposal",
          tags: ["planning"],
          projects: ["Alpha"],
          incomingLinks: ["P"],
        }),
      ],
      filter()
    );

    expect(candidate.searchText).toContain("Write proposal");
    expect(candidate.searchText).toContain("tasks/A.md");
    expect(candidate.searchText).toContain("Project");
    expect(candidate.searchText).toContain("planning");
    expect(candidate.searchText).toContain("Alpha");
  });
});

describe("createTaskFocusFilter", () => {
  it("preserves non-search filters while focusing the selected task", () => {
    const result = createTaskFocusFilter(
      filter({
        selectedStatuses: ["todo"],
        selectedTags: ["work"],
        selectedProjects: ["Alpha"],
        searchQuery: "old query",
        traversalMode: "both",
      }),
      "TaskA"
    );

    expect(result).toMatchObject({
      selectedStatuses: ["todo"],
      selectedTags: ["work"],
      selectedProjects: ["Alpha"],
      searchQuery: "",
      traversalMode: "match",
      selectedRootTask: "TaskA",
    });
  });
});
