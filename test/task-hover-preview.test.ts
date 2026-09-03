import type { App, HoverParent } from "obsidian";
import {
  isTaskCardInteractiveTarget,
  triggerTaskHoverPreview,
} from "../src/lib/task-hover-preview";
import type { BaseTask } from "../src/types/task";

function makeTask(type: "note" | "dataview", link: string): BaseTask {
  return { type, link } as BaseTask;
}

function makeApp(existingPath: string | null) {
  const trigger = jest.fn();
  const getFileByPath = jest.fn((path: string) =>
    path === existingPath ? { path } : null
  );
  const app = {
    vault: { getFileByPath },
    workspace: { trigger },
  } as unknown as App;
  return { app, getFileByPath, trigger };
}

function makeTarget(match: string | null): EventTarget {
  return {
    closest: jest.fn((selector: string) =>
      match && selector.includes(match) ? ({} as Element) : null
    ),
  } as unknown as EventTarget;
}

function makeCardElement(containsInteractiveTarget = true): HTMLElement {
  return {
    contains: jest.fn(() => containsInteractiveTarget),
  } as unknown as HTMLElement;
}

describe("task hover preview", () => {
  it.each(["note", "dataview"] as const)(
    "emits the native hover-link payload for a %s task",
    (type) => {
      const path = "Tasks/Example.md";
      const { app, getFileByPath, trigger } = makeApp(path);
      const event = {} as MouseEvent;
      const hoverParent = { hoverPopover: null } as HoverParent;
      const targetEl = makeCardElement();

      expect(
        triggerTaskHoverPreview({
          app,
          task: makeTask(type, ` ${path} `),
          event,
          source: "tasks-map-jrxing",
          hoverParent,
          targetEl,
          originTarget: makeTarget(null),
        })
      ).toBe(true);

      expect(getFileByPath).toHaveBeenCalledWith(path);
      expect(trigger).toHaveBeenCalledWith("hover-link", {
        event,
        source: "tasks-map-jrxing",
        hoverParent,
        targetEl,
        linktext: path,
        sourcePath: path,
      });
    }
  );

  it.each(["", "Missing.md"])(
    "does not emit when the backing path is unavailable: %p",
    (path) => {
      const { app, trigger } = makeApp(null);

      expect(
        triggerTaskHoverPreview({
          app,
          task: makeTask("note", path),
          event: {} as MouseEvent,
          source: "tasks-map-jrxing",
          hoverParent: { hoverPopover: null } as HoverParent,
          targetEl: makeCardElement(),
          originTarget: makeTarget(null),
        })
      ).toBe(false);
      expect(trigger).not.toHaveBeenCalled();
    }
  );

  it.each([
    "button",
    "[role='button']",
    ".react-flow__handle",
    ".tasks-map-add-tag-button",
    ".tasks-map-tag-remove-icon",
    ".tasks-map-quick-update",
    ".tasks-map-task-attachments",
  ])("recognizes %s as an interactive card target", (selector) => {
    expect(isTaskCardInteractiveTarget(makeTarget(selector))).toBe(true);
  });

  it("ignores ReactFlow's interactive wrapper outside the card", () => {
    expect(
      isTaskCardInteractiveTarget(
        makeTarget("[role='button']"),
        makeCardElement(false)
      )
    ).toBe(false);
  });

  it("does not emit from interactive card controls", () => {
    const path = "Tasks/Example.md";
    const { app, getFileByPath, trigger } = makeApp(path);

    expect(
      triggerTaskHoverPreview({
        app,
        task: makeTask("note", path),
        event: {} as MouseEvent,
        source: "tasks-map-jrxing",
        hoverParent: { hoverPopover: null } as HoverParent,
        targetEl: makeCardElement(),
        originTarget: makeTarget("button"),
      })
    ).toBe(false);

    expect(getFileByPath).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });
});
