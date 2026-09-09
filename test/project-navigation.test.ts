import {
  buildProjectRootOptions,
  canOpenPickerProjects,
  createOverviewState,
  getNavigationTaskId,
  getProjectScopeTaskIds,
  selectNavigationMap,
  selectProjectRoots,
  survivingProjectRoots,
  TaskMapReturnState,
} from "../src/lib/project-navigation";
import {
  getFilteredNodeIds,
  getTaskFilterReasonCodes,
} from "../src/lib/filter-tasks";
import { getFoldedGraphVisibility } from "../src/lib/fold-task-children";
import {
  buildTaskFocusCandidates,
  createTaskFocusFilter,
} from "../src/lib/task-focus-picker";
import { DEFAULT_FILTER_STATE } from "../src/types/filter-state";
import { NoteTask } from "../src/types/note-task";

function makeTask(
  id: string,
  incomingLinks: string[] = [],
  overrides: Partial<NoteTask> = {}
) {
  return new NoteTask({
    id,
    incomingLinks,
    summary: id,
    text: "",
    tags: [],
    status: "todo",
    priority: "",
    link: `tasks/${id}.md`,
    starred: false,
    ...overrides,
  });
}

const tasks = [
  makeTask("Alpha", [], { isProject: true, status: "done" }),
  makeTask("Beta", [], { isProject: true }),
  makeTask("parent", ["Alpha"], { status: "done" }),
  makeTask("shared", ["parent", "Beta"]),
  makeTask("sibling", ["Alpha"]),
  makeTask("child", ["shared"]),
  makeTask("unrelated"),
];

describe("project navigation", () => {
  it("revalidates project choices and retains only roots still present after refresh", () => {
    const options = buildProjectRootOptions(tasks).get("shared") ?? [];
    expect(selectProjectRoots(options, ["Beta", "removed"])).toEqual([
      { rootTaskId: "Beta", label: "Beta" },
    ]);
    expect(selectProjectRoots(options, ["removed"])).toEqual([]);
    expect(
      survivingProjectRoots(
        tasks.filter((task) => task.id !== "Alpha"),
        ["Alpha", "Beta"]
      )
    ).toEqual(["Beta"]);
    expect(survivingProjectRoots([], ["Alpha", "Beta"])).toEqual([]);
  });

  it("finds all top-level projects through nested and shared ancestry", () => {
    expect(buildProjectRootOptions(tasks).get("child")).toEqual([
      { rootTaskId: "Alpha", label: "Alpha" },
      { rootTaskId: "Beta", label: "Beta" },
    ]);
  });

  it("includes siblings and deduplicates shared descendants in a project union", () => {
    expect([...getProjectScopeTaskIds(tasks, ["Alpha", "Beta"])]).toEqual([
      "Alpha",
      "Beta",
      "parent",
      "shared",
      "sibling",
      "child",
    ]);
    expect([...getProjectScopeTaskIds(tasks, ["Beta"])]).toEqual([
      "Beta",
      "shared",
      "child",
    ]);
  });

  it("retains true picker ancestry when parents are hidden by status", () => {
    const candidates = buildTaskFocusCandidates(tasks, {
      ...DEFAULT_FILTER_STATE,
      selectedStatuses: ["todo"],
    });
    const childPaths = candidates.filter((item) => item.taskId === "child");
    expect(childPaths.map((item) => item.rootTaskId)).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(childPaths[0].path).toEqual(["Alpha", "parent", "shared", "child"]);
    expect(candidates.some((item) => item.taskId === "Alpha")).toBe(false);
  });

  it("includes an empty project, but never invents a project for an orphan", () => {
    const options = buildProjectRootOptions([
      makeTask("empty", [], { isProject: true }),
      makeTask("orphan", ["missing"]),
    ]);
    expect(options.get("empty")).toEqual([
      { rootTaskId: "empty", label: "empty" },
    ]);
    expect(options.has("orphan")).toBe(false);
    expect([...getProjectScopeTaskIds(tasks, ["missing"])]).toEqual([]);
  });

  it("terminates for cycles and does not invent a root for a rootless cycle", () => {
    const cyclic = [
      makeTask("root"),
      makeTask("a", ["root", "b"]),
      makeTask("b", ["a"]),
    ];
    expect(buildProjectRootOptions(cyclic).get("b")?.[0].rootTaskId).toBe(
      "root"
    );
    expect([...getProjectScopeTaskIds(cyclic, ["root"])]).toEqual([
      "root",
      "a",
      "b",
    ]);
    expect(buildProjectRootOptions(cyclic.slice(1)).size).toBe(0);
  });

  it("applies filters within the project without severing hidden ancestors", () => {
    const filter = { ...DEFAULT_FILTER_STATE, selectedStatuses: ["todo"] };
    expect(getFilteredNodeIds(tasks, filter, ["Alpha"])).toEqual([
      "shared",
      "sibling",
      "child",
    ]);
    expect(
      getTaskFilterReasonCodes(tasks[6], tasks, filter, ["Alpha"])
    ).toContain("project_scope");
    expect(
      getFilteredNodeIds(
        tasks,
        { ...filter, searchQuery: "shared", traversalMode: "both" },
        ["Beta"]
      )
    ).toEqual(["Beta", "shared", "child"]);
  });

  it("preserves filters, expands folds, and keeps the first return snapshot", () => {
    const original: TaskMapReturnState = {
      filter: createTaskFocusFilter(
        {
          ...DEFAULT_FILTER_STATE,
          selectedStatuses: ["todo"],
          selectedTags: [],
        },
        "shared"
      ),
      collapsedTaskIds: ["shared"],
      selectedTaskIds: ["child"],
      hideUnlinkedTasks: true,
      viewport: { x: 42, y: -120, zoom: 0.8 },
    };
    const overview = createOverviewState(original, null);
    expect(overview.filter).toEqual({
      ...original.filter,
      selectedRootTask: null,
    });
    expect(overview.collapsedTaskIds.size).toBe(0);
    expect(overview.hideUnlinkedTasks).toBe(true);
    const ids = getFilteredNodeIds(tasks, overview.filter, ["Alpha", "Beta"]);
    expect(ids).toContain("child");
    expect(ids).not.toContain("Alpha");
    const folded = getFoldedGraphVisibility(tasks, ids, new Set(["shared"]));
    expect(folded.visibleNodeIds.has("child")).toBe(false);
    const next = createOverviewState(
      {
        ...original,
        filter: { ...overview.filter, selectedStatuses: ["done"] },
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      overview.returnState
    );
    expect(next.returnState).toBe(overview.returnState);
    expect(next.returnState).toEqual(original);
    expect(next.filter.selectedStatuses).toEqual(["done"]);
    original.filter.selectedTags.push("later");
    expect(next.returnState.filter.selectedTags).toEqual([]);
  });

  it("retains every visibility filter while removing the previous task search and focus", () => {
    const original: TaskMapReturnState = {
      filter: {
        ...DEFAULT_FILTER_STATE,
        selectedStatuses: ["todo", "in_progress"],
        selectedTags: ["work"],
        excludedTags: ["private"],
        selectedFiles: ["tasks/"],
        selectedProjects: ["Alpha"],
        onlyStarred: true,
        searchQuery: "child",
        traversalMode: "both",
        selectedRootTask: "child",
      },
      collapsedTaskIds: [],
      selectedTaskIds: ["child"],
      hideUnlinkedTasks: true,
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const overview = createOverviewState(original, null);
    expect(overview.filter).toEqual({
      ...original.filter,
      searchQuery: "",
      traversalMode: "match",
      selectedRootTask: null,
    });
    overview.filter.selectedStatuses.push("done");
    expect(original.filter.selectedStatuses).toEqual(["todo", "in_progress"]);
    expect(overview.returnState.filter).toEqual(original.filter);
  });
});

describe("command and keyboard context", () => {
  it.each([
    [["selected"], "focused", "selected"],
    [[], "focused", "focused"],
    [["a", "b"], "focused", "focused"],
    [[], null, null],
  ] as [string[], string | null, string | null][])(
    "uses selection %j and focus %s",
    (selectedTaskIds, focusedTaskId, expected) => {
      expect(getNavigationTaskId({ selectedTaskIds, focusedTaskId })).toBe(
        expected
      );
    }
  );

  it("routes to active/recent surviving maps and falls back to a new map only when needed", () => {
    expect(selectNavigationMap(["a", "b"], "b", "a")).toBe("b");
    expect(selectNavigationMap(["a", "b"], "note", "b")).toBe("b");
    expect(selectNavigationMap(["a"], "note", "closed")).toBe("a");
    expect(selectNavigationMap([], "note", "closed")).toBeNull();
  });

  const event = {
    key: "ArrowRight",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
  };
  const input = { value: "query", selectionStart: 5, selectionEnd: 5 };
  it("accepts right arrow only at the end of an unselected query", () => {
    expect(canOpenPickerProjects(event, input)).toBe(true);
    expect(
      canOpenPickerProjects(event, {
        ...input,
        selectionStart: 2,
        selectionEnd: 2,
      })
    ).toBe(false);
    expect(canOpenPickerProjects(event, { ...input, selectionStart: 0 })).toBe(
      false
    );
  });
  it.each(["altKey", "ctrlKey", "metaKey", "shiftKey", "isComposing"])(
    "preserves %s keyboard behavior",
    (key) => {
      expect(canOpenPickerProjects({ ...event, [key]: true }, input)).toBe(
        false
      );
    }
  );
});
