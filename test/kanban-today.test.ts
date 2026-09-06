import type { App } from "obsidian";
import { changeKanbanTaskToday } from "../src/lib/kanban-today";
import { getNoteTasks } from "../src/lib/utils";
import { NoteTask } from "../src/types/note-task";
import { DataviewTask } from "../src/types/dataview-task";

function makeTask(today = false) {
  return new NoteTask({
    id: "Tasks/Example.md",
    summary: "Example",
    text: "Example",
    tags: ["task"],
    status: "active",
    priority: "normal",
    link: "Tasks/Example.md",
    incomingLinks: [],
    starred: false,
    today,
  });
}

function makeApp(frontmatter: Record<string, unknown>) {
  const file = {
    path: "Tasks/Example.md",
    basename: "Example",
    extension: "md",
  };
  return {
    vault: {
      getFileByPath: jest.fn(() => file),
      getMarkdownFiles: () => [file],
      getAbstractFileByPath: () => null,
    },
    metadataCache: {
      getFileCache: () => ({ frontmatter }),
      getFirstLinkpathDest: () => null,
    },
    fileManager: {
      processFrontMatter: jest.fn(
        async (
          _file: unknown,
          update: (data: Record<string, unknown>) => void
        ) => update(frontmatter)
      ),
    },
  };
}

describe("Today frontmatter", () => {
  it.each([true, false, undefined, null, "true", "false", 1, "2026-09-06"])(
    "selects only boolean true, given %p",
    (value) => {
      const app = makeApp({
        tags: ["task"],
        status: "active",
        "task-today": value,
      });
      expect(getNoteTasks(app)[0].today).toBe(value === true);
    }
  );

  it.each([true, false])(
    "persists %p and reloads without changing other fields",
    async (today) => {
      const frontmatter = {
        tags: ["task"],
        status: "active",
        priority: "high",
        due: "2026-09-06",
        "task-today": !today,
      };
      const app = makeApp(frontmatter);
      await makeTask(!today).updateToday(today, app as unknown as App);
      expect(frontmatter).toEqual({
        tags: ["task"],
        status: "active",
        priority: "high",
        due: "2026-09-06",
        "task-today": today,
      });
      expect(getNoteTasks(app)[0].today).toBe(today);
    }
  );

  it("defaults to false and survives serialization and status changes", () => {
    const data = makeTask().toPlainObject();
    expect(new NoteTask({ ...data, today: undefined }).today).toBe(false);
    const selected = makeTask(true);
    expect(
      new NoteTask({ ...selected.toPlainObject(), status: "done" }).today
    ).toBe(true);
  });

  describe("edge cases", () => {
    it("rejects a missing note without writing", async () => {
      const app = makeApp({});
      app.vault.getFileByPath.mockReturnValue(null as never);
      await expect(
        makeTask().updateToday(true, app as unknown as App)
      ).rejects.toThrow("could not be found");
      expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
    });

    it("surfaces write failures", async () => {
      const app = makeApp({});
      app.fileManager.processFrontMatter.mockRejectedValueOnce(
        new Error("disk full")
      );
      await expect(
        makeTask().updateToday(true, app as unknown as App)
      ).rejects.toThrow("disk full");
    });
  });
});

describe("Today optimistic updates", () => {
  it.each([true, false])(
    "updates to %p without changing status",
    async (today) => {
      const task = makeTask(!today);
      const apply = jest.fn();
      const persist = jest.fn(async () => undefined);
      const pending = new Set<string>();
      expect(
        await changeKanbanTaskToday(task, today, pending, apply, persist)
      ).toEqual({ kind: "updated" });
      expect(apply).toHaveBeenCalledWith(task.id, today);
      expect(persist).toHaveBeenCalledTimes(1);
      expect(task.status).toBe("active");
      expect(pending.size).toBe(0);
    }
  );

  it("rolls back only Today on failure and permits retry", async () => {
    const task = makeTask();
    const apply = jest.fn((_id: string, today: boolean) => {
      task.today = today;
    });
    const pending = new Set<string>();
    const result = await changeKanbanTaskToday(
      task,
      true,
      pending,
      apply,
      async () => {
        task.status = "done";
        throw new Error("disk full");
      }
    );
    expect(result.kind).toBe("rolled_back");
    expect(apply.mock.calls).toEqual([
      [task.id, true],
      [task.id, false],
    ]);
    expect(task.status).toBe("done");
    expect(task.today).toBe(false);
    expect(pending.size).toBe(0);
    expect(
      await changeKanbanTaskToday(
        task,
        true,
        pending,
        apply,
        async () => undefined
      )
    ).toEqual({ kind: "updated" });
  });

  it("ignores repeated selection and overlapping add/remove requests", async () => {
    const task = makeTask(true);
    const apply = jest.fn();
    const persist = jest.fn(async () => undefined);
    const pending = new Set<string>();
    expect(
      await changeKanbanTaskToday(task, true, pending, apply, persist)
    ).toEqual({ kind: "unchanged" });
    let finish!: () => void;
    const inFlight = changeKanbanTaskToday(
      task,
      false,
      pending,
      apply,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    expect(pending.has(task.id)).toBe(true);
    await changeKanbanTaskToday(task, false, pending, apply, persist);
    await changeKanbanTaskToday(task, true, pending, apply, persist);
    expect(persist).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledTimes(1);
    finish();
    await inFlight;
    expect(pending.size).toBe(0);
  });

  it("rejects inline tasks without modifying the containing note", async () => {
    const task = new DataviewTask(makeTask().toPlainObject());
    const apply = jest.fn();
    const persist = jest.fn();
    expect(
      await changeKanbanTaskToday(task, true, new Set(), apply, persist)
    ).toEqual({ kind: "unsupported" });
    expect(apply).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});
