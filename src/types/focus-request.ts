import { FilterState } from "./filter-state";

export interface TaskMapFocusRequest {
  kind: "task";
  taskId: string;
  baseFilter?: FilterState;
}
