import type { App } from "obsidian";
import {
  canOpenKanbanTaskNote,
  openKanbanTaskNote,
  shouldOpenKanbanCardOnDoubleClick,
} from "../src/lib/kanban-open-note";
import type { BaseTask } from "../src/types/task";

function makeTask(type: BaseTask["type"], link: string): BaseTask {
  return { type, link } as BaseTask;
}

function makeApp(filePath: string | null, existingLeaf?: object) {
  const file = filePath ? { path: filePath } : null;
  const workspace = {
    iterateAllLeaves: jest.fn((callback: (_leaf: object) => void) => {
      if (existingLeaf) callback(existingLeaf);
    }),
    revealLeaf: jest.fn(),
    setActiveLeaf: jest.fn(),
    openLinkText: jest.fn().mockResolvedValue(undefined),
  };
  const app = {
    vault: {
      getFileByPath: jest.fn((path: string) =>
        path === filePath ? file : null
      ),
    },
    metadataCache: {
      getFirstLinkpathDest: jest.fn(() => file),
    },
    workspace,
  } as unknown as App;

  return { app, workspace };
}

describe("Kanban note opening", () => {
  it.each([
    ["note", "TaskNotes/Prepare data.md"],
    ["dataview", "Projects/Study.md"],
  ] as const)("opens the source note for a %s task", async (type, path) => {
    const { app, workspace } = makeApp(path);
    const task = makeTask(type, path);

    await expect(openKanbanTaskNote(app, task)).resolves.toBe(true);
    expect(workspace.openLinkText).toHaveBeenCalledWith(path, path);
  });

  it("reuses an existing note leaf", async () => {
    const path = "TaskNotes/Existing.md";
    const existingLeaf = {
      view: { file: { path } },
      getViewState: () => ({ state: { file: path } }),
    };
    const { app, workspace } = makeApp(path, existingLeaf);

    await openKanbanTaskNote(app, makeTask("note", path));

    expect(workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
    expect(workspace.setActiveLeaf).toHaveBeenCalledWith(existingLeaf, {
      focus: true,
    });
    expect(workspace.openLinkText).not.toHaveBeenCalled();
  });

  it("opens a new tab when requested", async () => {
    const path = "TaskNotes/New tab.md";
    const { app, workspace } = makeApp(path);

    await openKanbanTaskNote(app, makeTask("note", path), {
      openInNewTab: true,
    });

    expect(workspace.openLinkText).toHaveBeenCalledWith(path, path, true);
  });

  it("rejects missing and blank task-note paths without opening", async () => {
    const { app, workspace } = makeApp(null);

    expect(canOpenKanbanTaskNote(app, makeTask("note", "Missing.md"))).toBe(
      false
    );
    await expect(
      openKanbanTaskNote(app, makeTask("dataview", ""))
    ).resolves.toBe(false);
    expect(workspace.openLinkText).not.toHaveBeenCalled();
  });

  it("propagates workspace failures for the caller to report", async () => {
    const path = "TaskNotes/Failure.md";
    const { app, workspace } = makeApp(path);
    workspace.openLinkText.mockRejectedValueOnce(new Error("open failed"));

    await expect(
      openKanbanTaskNote(app, makeTask("note", path))
    ).rejects.toThrow("open failed");
  });
});

describe("Kanban card double-click guard", () => {
  const plainTarget = {
    closest: jest.fn(() => null),
  } as unknown as EventTarget;
  const interactiveTarget = {
    closest: jest.fn(() => ({ tagName: "BUTTON" })),
  } as unknown as EventTarget;

  it("opens only an enabled, idle card surface", () => {
    expect(
      shouldOpenKanbanCardOnDoubleClick({
        enabled: true,
        isDragging: false,
        target: plainTarget,
      })
    ).toBe(true);
  });

  it.each([
    [false, false, plainTarget],
    [true, true, plainTarget],
    [true, false, interactiveTarget],
  ])(
    "blocks disabled, dragging, or interactive-target double-clicks",
    (enabled, isDragging, target) => {
      expect(
        shouldOpenKanbanCardOnDoubleClick({
          enabled,
          isDragging,
          target,
        })
      ).toBe(false);
    }
  );
});
