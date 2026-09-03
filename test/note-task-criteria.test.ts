import { getNoteTasks, inspectNoteTask } from "../src/lib/utils";
import { getFilteredNodeIds } from "../src/lib/filter-tasks";
import { DEFAULT_FILTER_STATE } from "../src/types/filter-state";

/**
 * Tests for the configurable note-based task detection:
 * - which frontmatter property/value marks a note as a task
 * - which frontmatter property holds the note's dependencies
 */

interface FakeFile {
  path: string;
  basename: string;
}

function makeFile(path: string): FakeFile {
  return { path, basename: path.split("/").pop()!.replace(/\.md$/, "") };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- frontmatter shape is dynamic in tests
function makeApp(
  notes: Record<string, any>,
  bodyLinks: Record<string, { link: string; displayText?: string }[]> = {}
) {
  const files = Object.keys(notes).map(makeFile);
  return {
    vault: {
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (p: string) =>
        files.find((f) => f.path === p || f.path === `${p}.md`) || null,
    },
    metadataCache: {
      getFirstLinkpathDest: (linkpath: string) =>
        files.find(
          (f) =>
            f.path === linkpath ||
            f.path === `${linkpath}.md` ||
            f.basename === linkpath
        ) || null,
      getFileCache: (file: FakeFile) => ({
        frontmatter: notes[file.path],
        links: bodyLinks[file.path] ?? [],
      }),
    },
    // No Dataview plugin in these tests
    plugins: { plugins: {} },
  };
}

describe("inspectNoteTask", () => {
  const statuses = [
    {
      id: "todo",
      label: "Todo",
      color: "#888888",
      checkboxChar: " ",
      noteValues: "open, none",
    },
    {
      id: "active-status",
      label: "Active",
      color: "#ff0000",
      checkboxChar: "/",
      noteValues: "active",
    },
  ];

  it("recognizes the reported active project with null list entries", () => {
    const app = makeApp({
      "Project.md": {
        type: "project",
        status: "active",
        tags: [null],
        aliases: [null],
        title: "AHA Scientific Session Abstract Submission",
      },
    });
    const [file] = app.vault.getMarkdownFiles();

    const result = inspectNoteTask(
      app,
      file as never,
      {
        noteTaskPropertyName: "type",
        noteTaskPropertyValue: "task, project",
        noteTaskTitleSource: "frontmatter",
        noteTaskTitleProperty: "title",
      },
      statuses
    );

    expect(result.kind).toBe("included");
    if (result.kind !== "included") return;
    expect(result.task.isProject).toBe(true);
    expect(result.task.noteFilename).toBe("Project");
    expect(result.task.noteFrontmatterTitle).toBe(
      "AHA Scientific Session Abstract Submission"
    );
    expect(result.task.tags).toEqual([]);
    expect(result.task.status).toBe("active-status");
    expect(result.statusResolution).toEqual({
      id: "active-status",
      matched: true,
      source: "note_value",
    });
  });

  it("returns the configured criteria mismatch details", () => {
    const app = makeApp({ "Note.md": { type: "reference" } });
    const [file] = app.vault.getMarkdownFiles();

    const result = inspectNoteTask(app, file as never, {
      noteTaskPropertyName: "type",
      noteTaskPropertyValue: "task, project",
    });

    expect(result).toEqual({
      kind: "excluded",
      reason: "criteria_mismatch",
      propertyName: "type",
      expectedValues: ["task", "project"],
      actualValues: ["reference"],
    });
  });

  it("returns parse errors that the task loader otherwise skips", () => {
    const app = makeApp({ "Task.md": { type: "task", status: {} } });
    const [file] = app.vault.getMarkdownFiles();

    const result = inspectNoteTask(app, file as never, {
      noteTaskPropertyName: "type",
      noteTaskPropertyValue: "task",
    });

    expect(result).toEqual(
      expect.objectContaining({ kind: "excluded", reason: "parse_error" })
    );
  });
});

describe("getNoteTasks - quick updates", () => {
  it("reads and normalizes the default quick-comments property", () => {
    const app = makeApp({
      "Task1.md": {
        tags: ["task"],
        "quick-comments": "  Waiting for review.\r\nNext: revise.  ",
      },
    });

    const [task] = getNoteTasks(app);

    expect(task.quickComments).toBe("Waiting for review.\nNext: revise.");
  });

  it("reads a configured quick update property", () => {
    const app = makeApp({
      "Project.md": {
        type: "project",
        update: "Choose the next milestone",
      },
    });

    const [task] = getNoteTasks(app, {
      noteTaskPropertyName: "type",
      noteTaskPropertyValue: "project",
      quickCommentsPropertyName: "update",
    });

    expect(task.quickComments).toBe("Choose the next milestone");
  });

  it.each([undefined, null, "   ", ["not", "text"]])(
    "treats %p as an empty quick update",
    (value) => {
      const app = makeApp({
        "Task1.md": { tags: ["task"], "quick-comments": value },
      });

      const [task] = getNoteTasks(app);

      expect(task.quickComments).toBe("");
    }
  );
});

describe("getNoteTasks - due dates", () => {
  it.each([
    ["2026-09-05", "2026-09-05"],
    ["2026-09-06T14:30:00Z", "2026-09-06"],
    ["2026-02-30", null],
    ["not-a-date", null],
    ["2026-09-05 later", null],
  ])("normalizes due frontmatter value %p", (due, expected) => {
    const [task] = getNoteTasks(
      makeApp({ "Task.md": { tags: ["task"], due } })
    );

    expect(task.dueDate).toBe(expected);
    expect(task.toPlainObject().dueDate).toBe(expected);
  });
});

describe("getNoteTasks - configurable criteria", () => {
  describe("task detection property", () => {
    it("detects notes by the default tags/task criteria", () => {
      const app = makeApp({
        "Task1.md": { tags: ["task"] },
        "Note.md": { tags: ["misc"] },
      });

      const tasks = getNoteTasks(app);

      expect(tasks.map((t) => t.id)).toEqual(["Task1.md"]);
    });

    it("ignores a leading # on tag values", () => {
      const app = makeApp({
        "Task1.md": { tags: ["#task"] },
      });

      const tasks = getNoteTasks(app);

      expect(tasks.map((t) => t.id)).toEqual(["Task1.md"]);
    });

    it("detects notes by a custom property/value (type=task)", () => {
      const app = makeApp({
        "Task1.md": { type: "task" },
        "Project.md": { type: "project" },
        "Tagged.md": { tags: ["task"] },
      });

      const tasks = getNoteTasks(app, {
        noteTaskPropertyName: "type",
        noteTaskPropertyValue: "task",
      });

      // Only the note with type: task — the tags-based note is not matched
      expect(tasks.map((t) => t.id)).toEqual(["Task1.md"]);
    });

    it("matches a scalar property value (not just lists)", () => {
      const app = makeApp({
        "Task1.md": { type: "task" },
      });

      const tasks = getNoteTasks(app, {
        noteTaskPropertyName: "type",
        noteTaskPropertyValue: "task",
      });

      expect(tasks).toHaveLength(1);
    });

    it("detects notes matching any of several comma-separated values", () => {
      const app = makeApp({
        "Task1.md": { type: "task" },
        "Project1.md": { type: "project" },
        "Area1.md": { type: "area" },
      });

      const tasks = getNoteTasks(app, {
        noteTaskPropertyName: "type",
        noteTaskPropertyValue: "task, project",
      });

      // Both task and project notes match; the area note does not
      expect(tasks.map((t) => t.id).sort()).toEqual([
        "Project1.md",
        "Task1.md",
      ]);
    });

    it("tolerates whitespace around comma-separated values", () => {
      const app = makeApp({
        "Project1.md": { type: "project" },
      });

      const tasks = getNoteTasks(app, {
        noteTaskPropertyName: "type",
        noteTaskPropertyValue: "  task ,  project  ",
      });

      expect(tasks).toHaveLength(1);
    });

    it("does not drop matching notes with null tag entries", () => {
      const app = makeApp({
        "Project1.md": { type: "project", tags: [null] },
      });

      const tasks = getNoteTasks(app, {
        noteTaskPropertyName: "type",
        noteTaskPropertyValue: "task, project",
      });

      expect(tasks.map((t) => t.id)).toEqual(["Project1.md"]);
      expect(tasks[0].tags).toEqual([]);
    });

    it("skips notes with no frontmatter", () => {
      const app = makeApp({
        "Empty.md": undefined,
        "Task1.md": { type: "task" },
      });

      const tasks = getNoteTasks(app, {
        noteTaskPropertyName: "type",
        noteTaskPropertyValue: "task",
      });

      expect(tasks.map((t) => t.id)).toEqual(["Task1.md"]);
    });
  });

  describe("display title", () => {
    it("uses the filename by default even when frontmatter has a title", () => {
      const tasks = getNoteTasks(
        makeApp({
          "Short.md": { tags: ["task"], title: "Readable title" },
        })
      );

      expect(tasks[0]).toMatchObject({
        id: "Short.md",
        link: "Short.md",
        text: "Short",
        summary: "Short",
        noteFilename: "Short",
        noteFrontmatterTitle: "Readable title",
      });
    });

    it("uses a frontmatter title only for the presentation summary", () => {
      const tasks = getNoteTasks(
        makeApp({
          "Short.md": { tags: ["task"], title: "Readable title" },
        }),
        { noteTaskTitleSource: "frontmatter" }
      );

      expect(tasks[0]).toMatchObject({
        id: "Short.md",
        link: "Short.md",
        text: "Short",
        summary: "Readable title",
        noteFilename: "Short",
        noteFrontmatterTitle: "Readable title",
      });
    });

    it("supports an arbitrary configured frontmatter title property", () => {
      const tasks = getNoteTasks(
        makeApp({
          "Short.md": {
            tags: ["task"],
            displayName: "Custom readable title",
          },
        }),
        {
          noteTaskTitleSource: "frontmatter",
          noteTaskTitleProperty: "displayName",
        }
      );

      expect(tasks[0].summary).toBe("Custom readable title");
    });

    it.each([undefined, null, "", "   ", [], { nested: "title" }])(
      "falls back to the filename for unsupported title value %p",
      (title) => {
        const tasks = getNoteTasks(
          makeApp({ "Short.md": { tags: ["task"], title } }),
          { noteTaskTitleSource: "frontmatter" }
        );

        expect(tasks[0].summary).toBe("Short");
      }
    );

    it.each([
      "2025-11-12",
      "2025-11-12T20:54:39.012+01:00",
      "2025-11-12 20:54:39",
    ])("prefixes the display title from creation date %s", (dateCreated) => {
      const tasks = getNoteTasks(
        makeApp({
          "Short.md": {
            tags: ["task"],
            title: "Readable title",
            dateCreated,
          },
        }),
        {
          noteTaskTitleSource: "frontmatter",
          noteTaskDatePrefixEnabled: true,
        }
      );

      expect(tasks[0].summary).toBe("2025-11-12 Readable title");
    });

    it("supports a custom creation-date property", () => {
      const tasks = getNoteTasks(
        makeApp({
          "Short.md": {
            tags: ["task"],
            title: "Readable title",
            createdAt: "2024-03-05T09:30:00Z",
          },
        }),
        {
          noteTaskTitleSource: "frontmatter",
          noteTaskDatePrefixEnabled: true,
          noteTaskCreatedDateProperty: "createdAt",
        }
      );

      expect(tasks[0].summary).toBe("2024-03-05 Readable title");
    });

    it.each([undefined, "not-a-date", "2025-02-30", "2025-13-01"])(
      "omits an invalid creation date %p",
      (dateCreated) => {
        const tasks = getNoteTasks(
          makeApp({
            "Short.md": {
              tags: ["task"],
              title: "Readable title",
              dateCreated,
            },
          }),
          {
            noteTaskTitleSource: "frontmatter",
            noteTaskDatePrefixEnabled: true,
          }
        );

        expect(tasks[0].summary).toBe("Readable title");
      }
    );

    it("prefixes the filename fallback and avoids duplicate date prefixes", () => {
      const fallback = getNoteTasks(
        makeApp({
          "Short.md": { tags: ["task"], dateCreated: "2025-11-12" },
        }),
        {
          noteTaskTitleSource: "frontmatter",
          noteTaskDatePrefixEnabled: true,
        }
      );
      const alreadyPrefixed = getNoteTasks(
        makeApp({
          "Short.md": {
            tags: ["task"],
            title: "2025-11-12 Readable title",
            dateCreated: "2025-11-12",
          },
        }),
        {
          noteTaskTitleSource: "frontmatter",
          noteTaskDatePrefixEnabled: true,
        }
      );

      expect(fallback[0].summary).toBe("2025-11-12 Short");
      expect(alreadyPrefixed[0].summary).toBe("2025-11-12 Readable title");
    });

    it("is searchable by both the presentation title and filename identity", () => {
      const tasks = getNoteTasks(
        makeApp({
          "ShortCode.md": { tags: ["task"], title: "Readable title" },
        }),
        { noteTaskTitleSource: "frontmatter" }
      );

      expect(
        getFilteredNodeIds(tasks, {
          ...DEFAULT_FILTER_STATE,
          searchQuery: "readable",
        })
      ).toEqual(["ShortCode.md"]);
      expect(
        getFilteredNodeIds(tasks, {
          ...DEFAULT_FILTER_STATE,
          searchQuery: "shortcode",
        })
      ).toEqual(["ShortCode.md"]);
    });
  });

  describe("dependency property", () => {
    it("resolves dependencies from the default blockedBy property", () => {
      const app = makeApp({
        "Task1.md": {
          type: "task",
          blockedBy: ["[[Task2]]"],
        },
        "Task2.md": { type: "task" },
      });

      const tasks = getNoteTasks(app, {
        noteTaskPropertyName: "type",
        noteTaskPropertyValue: "task",
      });

      const task1 = tasks.find((t) => t.id === "Task1.md");
      expect(task1?.incomingLinks).toEqual(["Task2.md"]);
    });

    it("resolves dependencies from a custom property (projects)", () => {
      const app = makeApp({
        "Task1.md": {
          type: "task",
          projects: ["[[ProjectA]]", "[[ProjectB]]"],
        },
        "ProjectA.md": { type: "task" },
        "ProjectB.md": { type: "task" },
      });

      const tasks = getNoteTasks(app, {
        noteTaskPropertyName: "type",
        noteTaskPropertyValue: "task",
        noteDependencyProperty: "projects",
      });

      const task1 = tasks.find((t) => t.id === "Task1.md");
      expect(task1?.incomingLinks.sort()).toEqual([
        "ProjectA.md",
        "ProjectB.md",
      ]);
    });

    it("supports { uid } dependency objects under a custom property", () => {
      const app = makeApp({
        "Task1.md": {
          type: "task",
          projects: [{ uid: "[[ProjectA]]", reltype: "FINISHTOSTART" }],
        },
        "ProjectA.md": { type: "task" },
      });

      const tasks = getNoteTasks(app, {
        noteTaskPropertyName: "type",
        noteTaskPropertyValue: "task",
        noteDependencyProperty: "projects",
      });

      const task1 = tasks.find((t) => t.id === "Task1.md");
      expect(task1?.incomingLinks).toEqual(["ProjectA.md"]);
    });

    it("connects a project -> task -> subtask chain via the projects property", () => {
      // Option 1 model: project notes are nodes too, and `projects` links
      // each note to its parent, forming one connected dependency chain.
      const app = makeApp({
        "ProjectA.md": { type: "project" },
        "Task1.md": { type: "task", projects: ["[[ProjectA]]"] },
        "Subtask1.md": { type: "task", projects: ["[[Task1]]"] },
      });

      const tasks = getNoteTasks(app, {
        noteTaskPropertyName: "type",
        noteTaskPropertyValue: "task, project",
        noteDependencyProperty: "projects",
      });

      const byId = new Map(tasks.map((t) => [t.id, t]));
      expect(byId.get("ProjectA.md")?.incomingLinks).toEqual([]);
      expect(byId.get("Task1.md")?.incomingLinks).toEqual(["ProjectA.md"]);
      expect(byId.get("Subtask1.md")?.incomingLinks).toEqual(["Task1.md"]);
    });

    it("marks project notes without treating body links as children", () => {
      const app = makeApp(
        {
          "projects/2026-08-05-Project General Planning.md": {
            type: "project",
            status: "active",
          },
          "2026-08-05-TASK General Planning 2026-08-05.md": {
            type: "task",
          },
        },
        {
          "projects/2026-08-05-Project General Planning.md": [
            { link: "2026-08-05-TASK General Planning 2026-08-05" },
          ],
        }
      );

      const tasks = getNoteTasks(app, {
        noteTaskPropertyName: "type",
        noteTaskPropertyValue: "task, project",
        noteDependencyProperty: "projects",
      });

      const project = tasks.find(
        (t) => t.id === "projects/2026-08-05-Project General Planning.md"
      );
      const task = tasks.find(
        (t) => t.id === "2026-08-05-TASK General Planning 2026-08-05.md"
      );
      expect(project?.isProject).toBe(true);
      expect(task?.isProject).toBe(false);
      expect(task?.incomingLinks).toEqual([]);
    });

    it("does not also use projects for grouping when it is the dependency property", () => {
      const app = makeApp({
        "ProjectA.md": { type: "project" },
        "Task1.md": { type: "task", projects: ["[[ProjectA]]"] },
      });

      const tasks = getNoteTasks(app, {
        noteTaskPropertyName: "type",
        noteTaskPropertyValue: "task, project",
        noteDependencyProperty: "projects",
      });

      // projects drives dependency edges, so it must NOT also populate the
      // grouping field (which would represent the same relationship twice)
      const task1 = tasks.find((t) => t.id === "Task1.md");
      expect(task1?.projects).toEqual([]);
    });

    it("still uses projects for grouping when a different dependency property is set", () => {
      const app = makeApp({
        "Task1.md": {
          type: "task",
          projects: ["[[ProjectA]]"],
          blockedBy: ["[[Task2]]"],
        },
        "Task2.md": { type: "task" },
      });

      const tasks = getNoteTasks(app, {
        noteTaskPropertyName: "type",
        noteTaskPropertyValue: "task",
        noteDependencyProperty: "blockedBy",
      });

      const task1 = tasks.find((t) => t.id === "Task1.md");
      expect(task1?.projects).toEqual(["ProjectA"]);
      expect(task1?.incomingLinks).toEqual(["Task2.md"]);
    });

    it("does not read dependencies from a property other than the configured one", () => {
      const app = makeApp({
        "Task1.md": {
          type: "task",
          blockedBy: ["[[Task2]]"],
        },
        "Task2.md": { type: "task" },
      });

      const tasks = getNoteTasks(app, {
        noteTaskPropertyName: "type",
        noteTaskPropertyValue: "task",
        noteDependencyProperty: "projects",
      });

      const task1 = tasks.find((t) => t.id === "Task1.md");
      expect(task1?.incomingLinks).toEqual([]);
    });
  });
});
