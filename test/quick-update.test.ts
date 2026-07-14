import { App } from "obsidian";
import { NoteTask } from "../src/types/note-task";

function makeTask() {
  return new NoteTask({
    id: "Tasks/Example.md",
    summary: "Example",
    text: "Example",
    tags: ["task"],
    status: "todo",
    priority: "normal",
    link: "Tasks/Example.md",
    incomingLinks: [],
    starred: false,
  });
}

describe("NoteTask quick updates", () => {
  it("updates only the configured frontmatter property", async () => {
    const task = makeTask();
    const file = { path: task.link };
    const frontmatter: Record<string, unknown> = {
      status: "open",
      priority: "normal",
    };
    const processFrontMatter = jest.fn(
      async (
        _file: unknown,
        update: (data: Record<string, unknown>) => void
      ) => update(frontmatter)
    );
    const app = {
      vault: { getFileByPath: () => file },
      fileManager: { processFrontMatter },
    } as unknown as App;

    await task.updateQuickComments(
      "  Waiting for review.\r\nNext: revise.  ",
      "current-update",
      app
    );

    expect(frontmatter).toEqual({
      status: "open",
      priority: "normal",
      "current-update": "Waiting for review.\nNext: revise.",
    });
    expect(processFrontMatter).toHaveBeenCalledTimes(1);
  });

  it("keeps the property with an empty string when cleared", async () => {
    const task = makeTask();
    const frontmatter: Record<string, unknown> = {
      "quick-comments": "Old update",
    };
    const app = {
      vault: { getFileByPath: () => ({ path: task.link }) },
      fileManager: {
        processFrontMatter: async (
          _file: unknown,
          update: (data: Record<string, unknown>) => void
        ) => update(frontmatter),
      },
    } as unknown as App;

    await task.updateQuickComments("  \r\n ", "", app);

    expect(frontmatter["quick-comments"]).toBe("");
  });

  it("rejects when the source note no longer exists", async () => {
    const task = makeTask();
    const app = {
      vault: { getFileByPath: () => null },
      fileManager: { processFrontMatter: jest.fn() },
    } as unknown as App;

    await expect(
      task.updateQuickComments("Next step", "quick-comments", app)
    ).rejects.toThrow("Quick update note could not be found.");
  });

  it("surfaces frontmatter write failures", async () => {
    const task = makeTask();
    const app = {
      vault: { getFileByPath: () => ({ path: task.link }) },
      fileManager: {
        processFrontMatter: jest.fn().mockRejectedValue(new Error("disk full")),
      },
    } as unknown as App;

    await expect(
      task.updateQuickComments("Next step", "quick-comments", app)
    ).rejects.toThrow("disk full");
  });
});
