import { getNoteTasks } from "../src/lib/utils";

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

  describe("dependency property", () => {
    it("resolves dependencies from the default blockedBy property", () => {
      const app = makeApp({
        "Task1.md": {
          type: "task",
          blockedBy: ['[[Task2]]'],
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
