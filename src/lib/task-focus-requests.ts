import { TaskMapFocusRequest } from "src/types/focus-request";

type FocusHandler = (_request: TaskMapFocusRequest) => void;

/** Retain navigation across the gap between root.render and React mounting. */
export class TaskFocusRequests {
  pending: TaskMapFocusRequest | null = null;
  private handler: FocusHandler | null = null;

  send(request: TaskMapFocusRequest): void {
    this.pending = request;
    this.handler?.(request);
  }

  attach(handler: FocusHandler | null): void {
    this.handler = handler;
    if (handler && this.pending) handler(this.pending);
  }

  handled(): void {
    this.pending = null;
  }
}
