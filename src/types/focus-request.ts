import { FilterState } from "./filter-state";

interface TaskMapFocusBase {
  taskId: string;
  baseFilter?: FilterState;
}

export type TaskMapFocusRequest = TaskMapFocusBase &
  (
    | { kind: "task" }
    | {
        kind: "project-overview";
        rootTaskIds?: string[];
        /** Seed a normal task view before taking the new map's return snapshot. */
        establishTaskReturnView?: boolean;
      }
  );
