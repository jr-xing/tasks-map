jest.mock("obsidian", () => {
  const actual = jest.requireActual("obsidian");
  class FuzzySuggestModal {
    scope = { register: jest.fn() };
    inputEl = {
      value: "",
      selectionStart: 0,
      selectionEnd: 0,
      trigger: jest.fn(),
      setSelectionRange: jest.fn(),
    };
    setPlaceholder = jest.fn();
    setInstructions = jest.fn();
    selectActiveSuggestion = jest.fn();
    open() {
      this.onOpen();
    }
    close() {
      this.onClose();
    }
    onOpen() {}
    onClose() {}
  }
  return { ...actual, FuzzySuggestModal };
});

import { App } from "obsidian";
import {
  TaskFocusSuggestModal,
  TaskProjectSuggestModal,
  openTaskProjects,
} from "../src/lib/task-focus-modal";
import { TaskFocusCandidate } from "../src/lib/task-focus-picker";

const item: TaskFocusCandidate = {
  id: "task:child",
  taskId: "child",
  rootTaskId: "a",
  label: "Child",
  searchText: "Child",
  depth: 1,
  path: ["Alpha", "Child"],
  link: "child.md",
  tags: [],
  projects: [],
};
const options = [
  { rootTaskId: "a", label: "Alpha" },
  { rootTaskId: "b", label: "Beta" },
];

describe("task picker navigation", () => {
  it("keeps Enter as task focus and dispatches right arrow with the original query", () => {
    const choose = jest.fn();
    const project = jest.fn();
    const modal = new TaskFocusSuggestModal(
      new App(),
      [item],
      new Map([["child", options]]),
      choose,
      project,
      "Child"
    );
    modal.onOpen();
    expect(modal.inputEl.value).toBe("Child");
    modal.onChooseItem(item);
    expect(choose).toHaveBeenCalledWith(item, false);
    expect(project).not.toHaveBeenCalled();
    modal.inputEl.selectionStart = 5;
    modal.inputEl.selectionEnd = 5;
    jest.spyOn(modal, "selectActiveSuggestion").mockImplementation(() => {
      modal.close();
      modal.onChooseItem(item);
    });
    const register = modal.scope.register as jest.Mock;
    const handler = register.mock.calls[0][2];
    handler({
      key: "ArrowRight",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      isComposing: false,
    });
    expect(project).toHaveBeenCalledWith(item, "Child");
    // A subsequent ordinary selection must not inherit project intent.
    modal.onChooseItem(item);
    expect(choose).toHaveBeenCalledTimes(2);
  });

  it("does not consume right arrow while editing the query", () => {
    const modal = new TaskFocusSuggestModal(
      new App(),
      [item],
      new Map(),
      jest.fn(),
      jest.fn()
    );
    modal.inputEl.value = "query";
    modal.inputEl.selectionStart = 2;
    modal.inputEl.selectionEnd = 2;
    const handler = (modal.scope.register as jest.Mock).mock.calls[0][2];
    expect(handler({ key: "ArrowRight", isComposing: false })).toBeUndefined();
    expect(modal.selectActiveSuggestion).not.toHaveBeenCalled();
  });

  it("opens a single project immediately and returns from a task with no project", () => {
    const choose = jest.fn();
    const back = jest.fn();
    openTaskProjects(new App(), options.slice(0, 1), choose, back);
    expect(choose).toHaveBeenCalledWith(["a"], false);
    expect(back).not.toHaveBeenCalled();
    openTaskProjects(new App(), [], choose, back);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("puts all projects first and does not reopen task search after selection", async () => {
    const choose = jest.fn();
    const back = jest.fn();
    const modal = new TaskProjectSuggestModal(new App(), options, choose, back);
    expect(modal.getItems().map((choice) => choice.rootTaskIds)).toEqual([
      undefined,
      ["a"],
      ["b"],
    ]);
    modal.close(); // Native close-before-choice ordering.
    modal.onChooseItem(modal.getItems()[0]);
    await Promise.resolve();
    expect(choose).toHaveBeenCalledWith(undefined, false);
    expect(back).not.toHaveBeenCalled();
  });

  it("returns to task search when the project chooser is cancelled", async () => {
    const back = jest.fn();
    const choose = jest.fn();
    const modal = new TaskProjectSuggestModal(new App(), options, choose, back);
    modal.close();
    await Promise.resolve();
    expect(back).toHaveBeenCalledTimes(1);
    expect(choose).not.toHaveBeenCalled();
  });

  describe("open in new tab", () => {
    function modHandler(modal: { scope: { register: unknown } }) {
      const register = modal.scope.register as jest.Mock;
      const call = register.mock.calls.find(
        ([modifiers, key]) => modifiers[0] === "Mod" && key === "Enter"
      );
      return call?.[2];
    }

    it("opens a task in a new tab with Ctrl/Cmd+Enter only", () => {
      const choose = jest.fn();
      const modal = new TaskFocusSuggestModal(
        new App(),
        [item],
        new Map(),
        choose,
        jest.fn()
      );
      jest
        .spyOn(modal, "selectActiveSuggestion")
        .mockImplementation(() => modal.onChooseItem(item));
      expect(modHandler(modal)({ key: "Enter", ctrlKey: true })).toBe(false);
      expect(choose).toHaveBeenLastCalledWith(item, true);
      // The modifier must not leak into a following plain Enter.
      modal.onChooseItem(item);
      expect(choose).toHaveBeenLastCalledWith(item, false);
    });

    it("treats Ctrl/Cmd+click as a new-tab pick", () => {
      const choose = jest.fn();
      const modal = new TaskFocusSuggestModal(
        new App(),
        [item],
        new Map(),
        choose,
        jest.fn()
      );
      modal.onChooseItem(item, { ctrlKey: false, metaKey: true } as MouseEvent);
      expect(choose).toHaveBeenLastCalledWith(item, true);
    });

    it("uses a new tab for plain Enter when opened from the new-tab command", () => {
      const choose = jest.fn();
      const modal = new TaskFocusSuggestModal(
        new App(),
        [item],
        new Map(),
        choose,
        jest.fn(),
        "",
        false,
        true
      );
      modal.onChooseItem(item);
      expect(choose).toHaveBeenCalledWith(item, true);
    });

    it("carries new-tab intent through the project chooser", async () => {
      const choose = jest.fn();
      const modal = new TaskProjectSuggestModal(
        new App(),
        options,
        choose,
        jest.fn()
      );
      jest
        .spyOn(modal, "selectActiveSuggestion")
        .mockImplementation(() => modal.onChooseItem(modal.getItems()[1]));
      modHandler(modal)({ key: "Enter", ctrlKey: true });
      expect(choose).toHaveBeenCalledWith(["a"], true);

      const single = jest.fn();
      openTaskProjects(new App(), options.slice(0, 1), single, jest.fn(), true);
      expect(single).toHaveBeenCalledWith(["a"], true);
    });
  });
});
