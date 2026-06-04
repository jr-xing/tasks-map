import { App } from "./mocks/obsidian";
import {
  createTaskNotesTask,
  getTaskNotesConfig,
  openTaskNotesProjectTaskCreationModal,
  openTaskNotesTaskCreationModalForProject,
  updateTaskNotesTask,
} from "../src/lib/tasknotes-bridge";
import { NoteTask } from "../src/types/note-task";

function appWithTaskNotes(
  api: Record<string, unknown>,
  pluginExtras: Record<string, unknown> = {}
): App {
  const app = new App() as App & {
    plugins: { getPlugin: (_id: string) => unknown };
    metadataCache: {
      getFileCache: () => { frontmatter: Record<string, unknown> };
      fileToLinktext: (_file: unknown, _sourcePath: string) => string;
    };
    fileManager: {
      generateMarkdownLink: (_file: unknown, _sourcePath: string) => string;
    };
  };
  app.plugins = {
    getPlugin: (id: string) =>
      id === "tasknotes" ? { api, ...pluginExtras } : null,
  };
  app.metadataCache = {
    getFileCache: () => ({ frontmatter: { tags: ["task"] } }),
    fileToLinktext: (file: { basename?: string }) => file.basename ?? "Task",
  };
  app.fileManager = {
    generateMarkdownLink: (file: { basename?: string }) =>
      `[${file.basename ?? "Task"}](${file.basename ?? "Task"}.md)`,
  };
  return app;
}

function makeNoteTask(path: string, text: string): NoteTask {
  return new NoteTask({
    id: path,
    summary: text,
    text,
    tags: [],
    status: "todo",
    priority: "",
    link: path,
    incomingLinks: [],
    starred: false,
  });
}

describe("tasknotes bridge", () => {
  it("opens TaskNotes creation modal with the current note as project", () => {
    const openTaskCreationModal = jest.fn();
    const app = appWithTaskNotes(
      {
        apiVersion: 1,
        tasks: { create: jest.fn(), update: jest.fn() },
      },
      { openTaskCreationModal }
    );
    app.vault.setFileContent("TaskNotes/Tasks/Parent.md", "");

    const opened = openTaskNotesProjectTaskCreationModal(
      app,
      "TaskNotes/Tasks/Parent.md"
    );

    expect(opened).toBe(true);
    expect(openTaskCreationModal).toHaveBeenCalledWith({
      projects: ["[[Parent]]"],
    });
  });

  it("opens TaskNotes creation modal with a raw project value", () => {
    const openTaskCreationModal = jest.fn();
    const app = appWithTaskNotes(
      {
        apiVersion: 1,
        tasks: { create: jest.fn(), update: jest.fn() },
      },
      { openTaskCreationModal }
    );

    const opened = openTaskNotesTaskCreationModalForProject(app, " Alpha ");

    expect(opened).toBe(true);
    expect(openTaskCreationModal).toHaveBeenCalledWith({
      projects: ["Alpha"],
    });
  });

  it("uses markdown project links when TaskNotes settings request them", () => {
    const openTaskCreationModal = jest.fn();
    const app = appWithTaskNotes(
      {
        apiVersion: 1,
        tasks: { create: jest.fn(), update: jest.fn() },
        settings: {
          snapshot: () => ({ useFrontmatterMarkdownLinks: true }),
        },
      },
      { openTaskCreationModal }
    );
    app.vault.setFileContent("TaskNotes/Tasks/Parent.md", "");

    openTaskNotesProjectTaskCreationModal(app, "TaskNotes/Tasks/Parent.md");

    expect(openTaskCreationModal).toHaveBeenCalledWith({
      projects: ["[Parent](Parent.md)"],
    });
  });

  it("does not open TaskNotes creation modal for a missing parent file", () => {
    const openTaskCreationModal = jest.fn();
    const app = appWithTaskNotes(
      {
        apiVersion: 1,
        tasks: { create: jest.fn(), update: jest.fn() },
      },
      { openTaskCreationModal }
    );

    const opened = openTaskNotesProjectTaskCreationModal(
      app,
      "TaskNotes/Tasks/Missing.md"
    );

    expect(opened).toBe(false);
    expect(openTaskCreationModal).not.toHaveBeenCalled();
  });

  it("does not open TaskNotes creation modal when TaskNotes is unavailable", () => {
    const app = new App();

    const opened = openTaskNotesProjectTaskCreationModal(
      app,
      "TaskNotes/Tasks/Parent.md"
    );

    expect(opened).toBe(false);
  });

  it("creates tasks through the official runtime API", async () => {
    const create = jest.fn().mockResolvedValue({
      path: "TaskNotes/Tasks/New.md",
      title: "New",
      status: "open",
      priority: "normal",
    });
    const app = appWithTaskNotes({
      apiVersion: 1,
      hasCapability: () => true,
      tasks: { create, update: jest.fn() },
    });

    const result = await createTaskNotesTask(app, { title: "New" });

    expect(result?.path).toBe("TaskNotes/Tasks/New.md");
    expect(create).toHaveBeenCalledWith(
      { title: "New" },
      { source: "tasks-map", reason: "Task Map created a task" }
    );
  });

  it("updates tasks through the official runtime API", async () => {
    const update = jest.fn().mockResolvedValue({
      path: "TaskNotes/Tasks/Existing.md",
      title: "Existing",
      status: "done",
      priority: "normal",
    });
    const app = appWithTaskNotes({
      apiVersion: 1,
      hasCapability: () => true,
      tasks: { create: jest.fn(), update },
    });

    await updateTaskNotesTask(
      app,
      {
        path: "TaskNotes/Tasks/Existing.md",
        title: "Existing",
        status: "open",
        priority: "normal",
        tags: [],
        contexts: [],
        projects: [],
        incomingLinks: [],
        summary: "Existing",
        text: "Existing",
        link: "TaskNotes/Tasks/Existing.md",
        starred: false,
      },
      { status: "done" }
    );

    expect(update).toHaveBeenCalledWith(
      "TaskNotes/Tasks/Existing.md",
      { status: "done" },
      { source: "tasks-map", reason: "Task Map updated a task" }
    );
  });

  it("reads statuses, priorities, and defaults from runtime catalog/settings", () => {
    const app = appWithTaskNotes({
      apiVersion: 1,
      tasks: { create: jest.fn(), update: jest.fn() },
      catalog: {
        statuses: () => [
          {
            id: "active",
            value: "active",
            label: "Active",
            color: "#111111",
            isCompleted: false,
            order: 1,
            autoArchive: false,
            autoArchiveDelay: 5,
          },
        ],
        priorities: () => [
          {
            id: "urgent",
            value: "urgent",
            label: "Urgent",
            color: "#222222",
            weight: 10,
          },
        ],
      },
      settings: {
        snapshot: () => ({
          defaultTaskStatus: "active",
          defaultTaskPriority: "urgent",
          nlpLanguage: "nl",
          nlpDefaultToScheduled: false,
        }),
      },
    });

    const config = getTaskNotesConfig(app);

    expect(config.statuses.map((status) => status.value)).toEqual(["active"]);
    expect(config.priorities.map((priority) => priority.value)).toEqual([
      "urgent",
    ]);
    expect(config.defaultStatus).toBe("active");
    expect(config.defaultPriority).toBe("urgent");
    expect(config.nlp.language).toBe("nl");
    expect(config.nlp.defaultToScheduled).toBe(false);
  });

  it("lets note-task tag writes use the runtime API instead of YAML fallback", async () => {
    const addTag = jest.fn().mockResolvedValue({
      path: "TaskNotes/Tasks/Existing.md",
      title: "Existing",
      status: "open",
      priority: "normal",
    });
    const app = appWithTaskNotes({
      apiVersion: 1,
      hasCapability: () => true,
      tasks: { create: jest.fn(), update: jest.fn(), addTag },
    });
    app.vault.setFileContent(
      "TaskNotes/Tasks/Existing.md",
      "---\nstatus: open\n---\n# Existing"
    );
    const task = new NoteTask({
      id: "TaskNotes/Tasks/Existing.md",
      summary: "Existing",
      text: "Existing",
      tags: [],
      status: "todo",
      priority: "",
      link: "TaskNotes/Tasks/Existing.md",
      incomingLinks: [],
      starred: false,
    });

    await task.addTag("urgent", app);

    expect(addTag).toHaveBeenCalledWith(
      "TaskNotes/Tasks/Existing.md",
      "urgent",
      { source: "tasks-map", reason: "Task Map added a task tag" }
    );
    expect(
      app.vault.getFileContent("TaskNotes/Tasks/Existing.md")
    ).not.toContain("urgent");
  });

  it("lets note-task dependency adds use the runtime API instead of YAML fallback", async () => {
    const addDependency = jest.fn().mockResolvedValue({
      path: "TaskNotes/Tasks/Existing.md",
      title: "Existing",
      status: "open",
      priority: "normal",
    });
    const app = appWithTaskNotes({
      apiVersion: 1,
      hasCapability: () => true,
      tasks: { create: jest.fn(), update: jest.fn(), addDependency },
    });
    app.vault.setFileContent(
      "TaskNotes/Tasks/Existing.md",
      "---\nstatus: open\n---\n# Existing"
    );
    const task = makeNoteTask("TaskNotes/Tasks/Existing.md", "Existing");
    const dependency = makeNoteTask(
      "TaskNotes/Tasks/Dependency.md",
      "Dependency"
    );

    await task.addLinkMetadata(app.vault, dependency, "individual", app);

    expect(addDependency).toHaveBeenCalledWith(
      "TaskNotes/Tasks/Existing.md",
      { uid: "[[Dependency]]", reltype: "FINISHTOSTART" },
      { source: "tasks-map", reason: "Task Map added a dependency" }
    );
    expect(
      app.vault.getFileContent("TaskNotes/Tasks/Existing.md")
    ).not.toContain("blockedBy:");
  });

  it("lets note-task dependency removals use the runtime API instead of YAML fallback", async () => {
    const removeDependency = jest.fn().mockResolvedValue({
      path: "TaskNotes/Tasks/Existing.md",
      title: "Existing",
      status: "open",
      priority: "normal",
    });
    const app = appWithTaskNotes({
      apiVersion: 1,
      hasCapability: () => true,
      tasks: { create: jest.fn(), update: jest.fn(), removeDependency },
    });
    app.vault.setFileContent(
      "TaskNotes/Tasks/Existing.md",
      '---\nstatus: open\nblockedBy:\n  - uid: "[[Dependency]]"\n    reltype: FINISHTOSTART\n---\n# Existing'
    );
    const task = makeNoteTask("TaskNotes/Tasks/Existing.md", "Existing");

    await task.removeLinkMetadata(
      app.vault,
      "TaskNotes/Tasks/Dependency.md",
      app
    );

    expect(removeDependency).toHaveBeenCalledWith(
      "TaskNotes/Tasks/Existing.md",
      "[[Dependency]]",
      { source: "tasks-map", reason: "Task Map removed a dependency" }
    );
    expect(app.vault.getFileContent("TaskNotes/Tasks/Existing.md")).toContain(
      "blockedBy:"
    );
  });

  it("falls back to YAML dependency writes when the runtime API fails", async () => {
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const addDependency = jest
      .fn()
      .mockRejectedValue(new Error("TaskNotes API unavailable"));
    const app = appWithTaskNotes({
      apiVersion: 1,
      hasCapability: () => true,
      tasks: { create: jest.fn(), update: jest.fn(), addDependency },
    });
    app.vault.setFileContent(
      "TaskNotes/Tasks/Existing.md",
      "---\nstatus: open\n---\n# Existing"
    );
    const task = makeNoteTask("TaskNotes/Tasks/Existing.md", "Existing");
    const dependency = makeNoteTask(
      "TaskNotes/Tasks/Dependency.md",
      "Dependency"
    );

    await task.addLinkMetadata(app.vault, dependency, "individual", app);

    expect(addDependency).toHaveBeenCalled();
    expect(app.vault.getFileContent("TaskNotes/Tasks/Existing.md")).toContain(
      "blockedBy:"
    );
    expect(app.vault.getFileContent("TaskNotes/Tasks/Existing.md")).toContain(
      '  - uid: "[[Dependency]]"'
    );
    warn.mockRestore();
  });
});
