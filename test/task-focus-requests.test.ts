import { TaskFocusRequests } from "../src/lib/task-focus-requests";
import { TaskMapFocusRequest } from "../src/types/focus-request";

describe("TaskFocusRequests", () => {
  const request: TaskMapFocusRequest = {
    kind: "project-overview",
    taskId: "task",
    establishTaskReturnView: true,
  };

  it("replays a request arriving between the initial render and handler mount", () => {
    const queue = new TaskFocusRequests();
    const initialRenderRequest = queue.pending;
    queue.send(request);
    const handler = jest.fn();
    queue.attach(handler);
    expect(initialRenderRequest).toBeNull();
    expect(handler).toHaveBeenCalledWith(request);
    expect(queue.pending).toBe(request);
  });

  it("retains the latest request while the map is loading and clears only when handled", () => {
    const queue = new TaskFocusRequests();
    queue.send({ kind: "task", taskId: "old" });
    queue.send(request);
    const handler = jest.fn();
    queue.attach(handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(request);
    queue.handled();
    queue.attach(null);
    queue.attach(handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("delivers warm requests immediately without sending to a detached view", () => {
    const queue = new TaskFocusRequests();
    const handler = jest.fn();
    queue.attach(handler);
    queue.send(request);
    expect(handler).toHaveBeenCalledWith(request);
    queue.attach(null);
    queue.send({ kind: "task", taskId: "next" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(queue.pending?.taskId).toBe("next");
  });
});
