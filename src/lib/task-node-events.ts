export const TASK_NODE_HEADER_CLASS = "tasks-map-task-node-header";

interface ClosestElementTarget {
  closest(_selector: string): unknown;
}

function hasClosest(
  target: EventTarget | null
): target is EventTarget & ClosestElementTarget {
  return (
    !!target &&
    typeof (target as Partial<ClosestElementTarget>).closest === "function"
  );
}

export function isTaskNodeHeaderEventTarget(
  target: EventTarget | null
): boolean {
  if (!hasClosest(target)) return false;
  return Boolean(target.closest(`.${TASK_NODE_HEADER_CLASS}`));
}
