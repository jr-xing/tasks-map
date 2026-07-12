import { getNoteTasks } from "../src/lib/utils";
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
function makeApp(notes: Record<string, any>) {
  const files = Object.keys(notes).map(makeFile);
  return {
    vault: {
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (p: string) =>
        files.find((f) => f.path === p) || null,
    },
    metadataCache: {
      getFileCache: (file: FakeFile) => ({ frontmatter: notes[file.path] }),
    },
    // No Dataview plugin in these tests
    plugins: { plugins: {} },
  };
}

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
