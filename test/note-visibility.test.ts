import { getTaskFilterReasonCodes } from "../src/lib/filter-tasks";
import {
  buildNoteVisibilityReport,
  LiveMapVisibilityContext,
  NoteVisibilityInput,
} from "../src/lib/note-visibility";
import { NoteTaskInspection } from "../src/lib/utils";
import { DEFAULT_FILTER_STATE, FilterState } from "../src/types/filter-state";
import { NoteTask } from "../src/types/note-task";

function makeTask(
  overrides: Partial<ConstructorParameters<typeof NoteTask>[0]> = {}
): NoteTask {
  return new NoteTask({
    id: "Project.md",
    summary: "Project",
    text: "Project",
    tags: [],
    status: "active",
    priority: "normal",
    link: "Project.md",
    incomingLinks: [],
    starred: false,
    isProject: true,
    ...overrides,
  });
}

function included(task: NoteTask): NoteTaskInspection {
  return {
    kind: "included",
    task,
    propertyName: "type",
    expectedValues: ["task", "project"],
    actualValues: [task.isProject ? "project" : "task"],
    rawStatus: "active",
    statusResolution: {
      id: "active",
      matched: true,
      source: "note_value",
    },
  };
}

function liveContext(
  task: NoteTask,
  overrides: Partial<LiveMapVisibilityContext> = {}
): LiveMapVisibilityContext {
  return {
    tasks: [task],
    filter: { ...DEFAULT_FILTER_STATE },
    hideUnlinkedTasks: true,
    droppedTaskIds: [],
    visibleNodeIds: [task.id],
    foldedNodeIds: [],
    isLoading: false,
    ...overrides,
  };
}

function input(
  task: NoteTask,
  overrides: Partial<NoteVisibilityInput> = {}
): NoteVisibilityInput {
  return {
    filePath: task.id,
    inspection: included(task),
    freshTasks: [task],
    liveContext: liveContext(task),
    defaultFilter: { ...DEFAULT_FILTER_STATE },
    defaultHideUnlinkedTasks: true,
    ...overrides,
  };
}

describe("buildNoteVisibilityReport", () => {
  it("reports a recognized active project as shown in a live map", () => {
    const task = makeTask();

    const report = buildNoteVisibilityReport(input(task));

    expect(report.verdict).toBe("shown");
    expect(report.reasons.map((reason) => reason.code)).toEqual([
      "recognized",
      "parsed",
      "status_mapped",
      "snapshot_current",
      "unlinked_allowed",
      "filters_pass",
      "rendered",
    ]);
  });

  it("reports that an eligible project should show under defaults", () => {
    const task = makeTask();

    const report = buildNoteVisibilityReport(
      input(task, { liveContext: undefined })
    );

    expect(report.verdict).toBe("should_show");
    expect(report.context).toBe("defaults");
    expect(report.reasons.map((reason) => reason.code)).toContain(
      "no_live_map"
    );
  });

  it.each(["missing_frontmatter", "criteria_mismatch", "parse_error"] as const)(
    "reports %s as an eligibility failure",
    (reason) => {
      const task = makeTask();
      const inspection: NoteTaskInspection = {
        kind: "excluded",
        reason,
        propertyName: "type",
        expectedValues: ["task", "project"],
        actualValues: [],
        ...(reason === "parse_error" ? { error: "bad status" } : {}),
      };

      const report = buildNoteVisibilityReport(
        input(task, { inspection, liveContext: undefined })
      );

      expect(report.verdict).toBe("excluded");
      expect(report.reasons[0].code).toBe(reason);
    }
  );

  it("warns when an unknown status falls back to the first configured status", () => {
    const task = makeTask({ status: "todo" });
    const inspection = included(task);
    if (inspection.kind !== "included") throw new Error("Expected inclusion");
    inspection.rawStatus = "mystery";
    inspection.statusResolution = {
      id: "todo",
      matched: false,
      source: "fallback",
    };

    const report = buildNoteVisibilityReport(input(task, { inspection }));

    expect(report.verdict).toBe("shown");
    expect(report.reasons).toContainEqual(
      expect.objectContaining({ code: "status_fallback", state: "warning" })
    );
  });

  it("detects an eligible note missing from the loaded map snapshot", () => {
    const task = makeTask();

    const report = buildNoteVisibilityReport(
      input(task, {
        liveContext: liveContext(task, { tasks: [], visibleNodeIds: [] }),
      })
    );

    expect(report.verdict).toBe("stale");
    expect(report.canReload).toBe(true);
    expect(report.reasons.at(-1)?.code).toBe("stale_missing");
  });

  it("detects visibility-relevant frontmatter changes in the loaded snapshot", () => {
    const task = makeTask({ status: "active" });
    const loaded = makeTask({ status: "done" });

    const report = buildNoteVisibilityReport(
      input(task, { liveContext: liveContext(loaded) })
    );

    expect(report.verdict).toBe("stale");
    expect(report.reasons.at(-1)).toEqual(
      expect.objectContaining({
        code: "stale_changed",
        details: { fields: ["status"] },
      })
    );
  });

  it("detects a renamed note as missing from the old snapshot", () => {
    const task = makeTask({ id: "Renamed.md", link: "Renamed.md" });
    const loaded = makeTask({ id: "Old.md", link: "Old.md" });

    const report = buildNoteVisibilityReport(
      input(task, {
        filePath: task.id,
        liveContext: liveContext(loaded),
      })
    );

    expect(report.verdict).toBe("stale");
    expect(report.reasons.at(-1)?.code).toBe("stale_missing");
  });

  it("reports ordinary unlinked tasks hidden from the canvas", () => {
    const task = makeTask({ isProject: false });

    const report = buildNoteVisibilityReport(input(task));

    expect(report.verdict).toBe("hidden");
    expect(report.reasons.at(-1)?.code).toBe("unlinked_hidden");
  });

  it("does not classify a standalone project as hidden-unlinked", () => {
    const task = makeTask({ isProject: true });

    const report = buildNoteVisibilityReport(input(task));

    expect(report.verdict).toBe("shown");
  });

  it("reports a task hidden under a folded card without offering reload", () => {
    const parent = makeTask({ id: "Parent.md", link: "Parent.md" });
    const task = makeTask({
      id: "Child.md",
      link: "Child.md",
      incomingLinks: [parent.id],
      isProject: false,
    });

    const report = buildNoteVisibilityReport(
      input(task, {
        freshTasks: [parent, task],
        liveContext: liveContext(task, {
          tasks: [parent, task],
          visibleNodeIds: [parent.id],
          foldedNodeIds: [task.id],
        }),
      })
    );

    expect(report.verdict).toBe("hidden");
    expect(report.canReload).toBe(false);
    expect(report.reasons.at(-1)?.code).toBe("folded_branch");
  });

  it.each<{
    name: string;
    task: Partial<ConstructorParameters<typeof NoteTask>[0]>;
    filter: Partial<FilterState>;
    reason: ReturnType<typeof getTaskFilterReasonCodes>[number];
  }>([
    {
      name: "selected tags",
      task: { tags: ["other"] },
      filter: { selectedTags: ["work"] },
      reason: "selected_tags",
    },
    {
      name: "excluded tags",
      task: { tags: ["blocked"] },
      filter: { excludedTags: ["blocked"] },
      reason: "excluded_tags",
    },
    {
      name: "statuses",
      task: { status: "active" },
      filter: { selectedStatuses: ["todo"] },
      reason: "selected_statuses",
    },
    {
      name: "files",
      task: {},
      filter: { selectedFiles: ["tasks/"] },
      reason: "selected_files",
    },
    {
      name: "projects",
      task: { projects: [] },
      filter: { selectedProjects: ["Alpha"] },
      reason: "selected_projects",
    },
    {
      name: "starred only",
      task: { starred: false },
      filter: { onlyStarred: true },
      reason: "only_starred",
    },
    {
      name: "root scope",
      task: {},
      filter: { selectedRootTask: "Other.md" },
      reason: "root_scope",
    },
    {
      name: "search scope",
      task: { summary: "Project" },
      filter: { searchQuery: "missing" },
      reason: "search_scope",
    },
  ])("reports the $name filter", ({ task: taskData, filter, reason }) => {
    const task = makeTask(taskData);
    const activeFilter = { ...DEFAULT_FILTER_STATE, ...filter };

    const report = buildNoteVisibilityReport(
      input(task, {
        liveContext: liveContext(task, { filter: activeFilter }),
      })
    );

    expect(report.verdict).toBe("hidden");
    expect(report.reasons.map((item) => item.code)).toContain(reason);
  });

  it("reports every independently failing active filter", () => {
    const task = makeTask({
      tags: ["blocked"],
      status: "active",
      projects: [],
      starred: false,
    });
    const filter: FilterState = {
      ...DEFAULT_FILTER_STATE,
      selectedTags: ["work"],
      excludedTags: ["blocked"],
      selectedStatuses: ["todo"],
      selectedFiles: ["tasks/"],
      selectedProjects: ["Alpha"],
      onlyStarred: true,
      selectedRootTask: "Other.md",
      searchQuery: "missing",
    };

    expect(getTaskFilterReasonCodes(task, [task], filter)).toEqual([
      "selected_tags",
      "excluded_tags",
      "selected_statuses",
      "selected_files",
      "selected_projects",
      "only_starred",
      "root_scope",
      "search_scope",
    ]);
  });

  it("distinguishes a rendering mismatch from a filter exclusion", () => {
    const task = makeTask();

    const report = buildNoteVisibilityReport(
      input(task, {
        liveContext: liveContext(task, { visibleNodeIds: [] }),
      })
    );

    expect(report.verdict).toBe("not_rendered");
    expect(report.canReload).toBe(true);
    expect(report.reasons.at(-1)?.code).toBe("render_missing");
  });

  it("reports a map that is still loading", () => {
    const task = makeTask();

    const report = buildNoteVisibilityReport(
      input(task, { liveContext: liveContext(task, { isLoading: true }) })
    );

    expect(report.verdict).toBe("pending");
    expect(report.reasons.at(-1)?.code).toBe("map_loading");
  });
});
