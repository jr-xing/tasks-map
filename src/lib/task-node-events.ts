export const TASK_NODE_HEADER_CLASS = "tasks-map-task-node-header";
/** Buttons and panels on minimal cards; clicks there never open the note. */
export const MINIMAL_CARD_CONTROLS_CLASS = "tasks-map-mcard-controls";

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
  return [TASK_NODE_HEADER_CLASS, MINIMAL_CARD_CONTROLS_CLASS].some(
    (className) => Boolean(target.closest(`.${className}`))
  );
}
