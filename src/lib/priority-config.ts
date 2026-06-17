import type { PriorityConfig } from "tasknotes-nlp-core";

export interface TaskPriorityConfig extends PriorityConfig {
  icon?: string;
}

export const TASKS_PLUGIN_PRIORITY_OPTIONS: TaskPriorityConfig[] = [
  {
    id: "none",
    value: "",
    label: "None",
    color: "#8a8a8a",
    weight: 0,
  },
  {
    id: "lowest",
    value: "\u{23EC}",
    label: "Lowest",
    color: "#6b7280",
    weight: 1,
  },
  {
    id: "low",
    value: "\u{1F53D}",
    label: "Low",
    color: "#22c55e",
    weight: 2,
  },
  {
    id: "medium",
    value: "\u{1F53C}",
    label: "Medium",
    color: "#f59e0b",
    weight: 3,
  },
  {
    id: "high",
    value: "\u{23EB}",
    label: "High",
    color: "#ef4444",
    weight: 4,
  },
  {
    id: "highest",
    value: "\u{1F53A}",
    label: "Highest",
    color: "#dc2626",
    weight: 5,
  },
];

export function isNoPriority(priority: string | undefined): boolean {
  const normalized = (priority ?? "").trim().toLowerCase();
  return normalized === "" || normalized === "none";
}

function normalizePriorityValue(priority: string): string {
  return priority.trim().toLowerCase();
}

export function getPriorityByValue(
  value: string,
  priorities: TaskPriorityConfig[]
): TaskPriorityConfig {
  const normalized = normalizePriorityValue(value);
  if (isNoPriority(value)) {
    const nonePriority = priorities.find((priority) =>
      isNoPriority(priority.value)
    );
    if (nonePriority) return nonePriority;
  }

  const matched = priorities.find((priority) => {
    if (priority.value === value) return true;
    return normalizePriorityValue(priority.value) === normalized;
  });

  if (matched) return matched;

  return {
    id: normalized || "none",
    value,
    label: value || "None",
    color: "#8a8a8a",
    weight: 0,
  };
}

export function visiblePriorityOptions(
  priorities: TaskPriorityConfig[]
): TaskPriorityConfig[] {
  return [...priorities].sort((a, b) => b.weight - a.weight);
}
