import { App } from "./mocks/obsidian";
import { openFileInObsidian } from "../src/lib/open-file";

function makeAppWithExistingLeaf() {
  const existingLeaf = {
    view: { file: { path: "TaskNotes/Tasks/Existing.md" } },
    getViewState: () => ({ state: { file: "TaskNotes/Tasks/Existing.md" } }),
  };
  const app = {
    metadataCache: {
      getFirstLinkpathDest: jest.fn(() => ({
        path: "TaskNotes/Tasks/Existing.md",
      })),
    },
    workspace: {
      iterateAllLeaves: jest.fn((callback: (leaf: unknown) => void) =>
        callback(existingLeaf)
      ),
      revealLeaf: jest.fn(),
      setActiveLeaf: jest.fn(),
      openLinkText: jest.fn(),
    },
  };

  return { app, existingLeaf };
}

describe("openFileInObsidian", () => {
  it("reveals an existing leaf for normal opens", async () => {
    const { app, existingLeaf } = makeAppWithExistingLeaf();

    await openFileInObsidian(
      app as unknown as App,
      "TaskNotes/Tasks/Existing.md",
      "TaskNotes/Tasks/Existing.md"
    );

    expect(app.workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
    expect(app.workspace.setActiveLeaf).toHaveBeenCalledWith(existingLeaf, {
      focus: true,
    });
    expect(app.workspace.openLinkText).not.toHaveBeenCalled();
  });

  it("opens a new tab when requested instead of reusing an existing leaf", async () => {
    const { app } = makeAppWithExistingLeaf();

    await openFileInObsidian(
      app as unknown as App,
      "TaskNotes/Tasks/Existing.md",
      "TaskNotes/Tasks/Existing.md",
      "",
      { openInNewTab: true }
    );

    expect(app.workspace.openLinkText).toHaveBeenCalledWith(
      "TaskNotes/Tasks/Existing.md",
      "",
      true
    );
    expect(app.workspace.revealLeaf).not.toHaveBeenCalled();
    expect(app.workspace.setActiveLeaf).not.toHaveBeenCalled();
  });
});
