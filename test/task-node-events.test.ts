import {
  isTaskNodeHeaderEventTarget,
  TASK_NODE_HEADER_CLASS,
} from "../src/lib/task-node-events";

describe("task node event guards", () => {
  it("detects events that start inside the task node header", () => {
    const target = {
      closest: jest.fn((selector: string) =>
        selector === `.${TASK_NODE_HEADER_CLASS}` ? {} : null
      ),
    };

    expect(isTaskNodeHeaderEventTarget(target as unknown as EventTarget)).toBe(
      true
    );
  });

  it("ignores events outside the task node header", () => {
    const target = {
      closest: jest.fn(() => null),
    };

    expect(isTaskNodeHeaderEventTarget(target as unknown as EventTarget)).toBe(
      false
    );
    expect(isTaskNodeHeaderEventTarget(null)).toBe(false);
  });
});
