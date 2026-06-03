import { App } from "./mocks/obsidian";
import {
  createTaskNotesTask,
  getTaskNotesConfig,
  updateTaskNotesTask,
} from "../src/lib/tasknotes-bridge";
import { NoteTask } from "../src/types/note-task";

function appWithTaskNotes(api: Record<string, unknown>): App {
  const app = new App() as App & {
    plugins: { getPlugin: (_id: string) => unknown };
    metadataCache: {
      getFileCache: () => { frontmatter: Record<string, unknown> };
    };
  };
  app.plugins = {
    getPlugin: (id: string) => (id === "tasknotes" ? { api } : null),
  };
  app.metadataCache = {
    getFileCache: () => ({ frontmatter: { tags: ["task"] } }),
  };
  return app;
}

describe("tasknotes bridge", () => {
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
});
