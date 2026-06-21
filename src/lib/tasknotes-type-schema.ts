import type { Vault } from "obsidian";
import { TFile } from "obsidian";
import * as yaml from "yaml";
import type { TaskPriorityConfig } from "./priority-config";

export const DEFAULT_TASKNOTES_TYPE_SCHEMA_PATH = "_types/task.md";

export type TaskNotesTypeSchemaReadResult =
  | {
      kind: "loaded";
      path: string;
      priorityValues: string[];
      defaultPriority: string;
    }
  | { kind: "missing"; path: string; message: string }
  | { kind: "invalid"; path: string; message: string };

export type TaskNotesTypeSchemaWriteResult =
  | { kind: "written"; path: string; priorityValues: string[] }
  | { kind: "missing"; path: string; message: string }
  | { kind: "invalid"; path: string; message: string }
  | { kind: "error"; path: string; message: string };

interface FrontmatterParts {
  yamlText: string;
  body: string;
}

const FALLBACK_PRIORITY_COLORS = [
  "#8a8a8a",
  "#6b7280",
  "#22c55e",
  "#3b82f6",
  "#f59e0b",
  "#ef4444",
  "#dc2626",
];

export function normalizeTaskNotesTypeSchemaPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  return normalized || DEFAULT_TASKNOTES_TYPE_SCHEMA_PATH;
}

function splitFrontmatter(content: string): FrontmatterParts | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*)?$/);
  if (!match) return null;
  return {
    yamlText: match[1],
    body: match[2] ?? "\n",
  };
}

function parseSchemaYaml(
  yamlText: string
): Record<string, unknown> | null {
  try {
    const parsed = yaml.parse(yamlText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function priorityField(
  data: Record<string, unknown>
): Record<string, unknown> | null {
  const fields = data.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return null;
  }
  const priority = (fields as Record<string, unknown>).priority;
  if (!priority || typeof priority !== "object" || Array.isArray(priority)) {
    return null;
  }
  return priority as Record<string, unknown>;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const values = value.map((entry) => String(entry).trim());
  if (values.some((entry) => entry.length === 0)) return null;
  return values;
}

export function parseTaskNotesTypeSchema(
  content: string,
  path: string = DEFAULT_TASKNOTES_TYPE_SCHEMA_PATH
): TaskNotesTypeSchemaReadResult {
  const normalizedPath = normalizeTaskNotesTypeSchemaPath(path);
  const frontmatter = splitFrontmatter(content);
  if (!frontmatter) {
    return {
      kind: "invalid",
      path: normalizedPath,
      message: "Task type file has no YAML frontmatter.",
    };
  }

  const data = parseSchemaYaml(frontmatter.yamlText);
  if (!data) {
    return {
      kind: "invalid",
      path: normalizedPath,
      message: "Task type file frontmatter is not valid YAML.",
    };
  }

  const priority = priorityField(data);
  const priorityValues = stringArray(priority?.values);
  if (!priority || !priorityValues) {
    return {
      kind: "invalid",
      path: normalizedPath,
      message: "Task type file does not define fields.priority.values.",
    };
  }

  return {
    kind: "loaded",
    path: normalizedPath,
    priorityValues,
    defaultPriority:
      typeof priority.default === "string" ? priority.default : priorityValues[0],
  };
}

export function updateTaskNotesTypeSchemaPriorityValues(
  content: string,
  values: string[]
): string {
  const frontmatter = splitFrontmatter(content);
  if (!frontmatter) {
    throw new Error("Task type file has no YAML frontmatter.");
  }

  const data = parseSchemaYaml(frontmatter.yamlText);
  if (!data) {
    throw new Error("Task type file frontmatter is not valid YAML.");
  }

  const priority = priorityField(data);
  if (!priority) {
    throw new Error("Task type file does not define fields.priority.");
  }

  priority.values = values;
  const yamlText = yaml.stringify(data, {
    indent: 2,
    lineWidth: 0,
    sortMapEntries: false,
  });
  return `---\n${yamlText}---${frontmatter.body}`;
}

export async function readTaskNotesTypeSchema(
  vault: Vault,
  path: string
): Promise<TaskNotesTypeSchemaReadResult> {
  const normalizedPath = normalizeTaskNotesTypeSchemaPath(path);
  const file = vault.getAbstractFileByPath(normalizedPath);
  if (!(file instanceof TFile)) {
    return {
      kind: "missing",
      path: normalizedPath,
      message: `Task type file not found: ${normalizedPath}`,
    };
  }

  const content = await vault.read(file);
  return parseTaskNotesTypeSchema(content, normalizedPath);
}

export async function writeTaskNotesTypeSchemaPriorityValues(
  vault: Vault,
  path: string,
  values: string[]
): Promise<TaskNotesTypeSchemaWriteResult> {
  const normalizedPath = normalizeTaskNotesTypeSchemaPath(path);
  const file = vault.getAbstractFileByPath(normalizedPath);
  if (!(file instanceof TFile)) {
    return {
      kind: "missing",
      path: normalizedPath,
      message: `Task type file not found: ${normalizedPath}`,
    };
  }

  try {
    await vault.process(file, (content) =>
      updateTaskNotesTypeSchemaPriorityValues(content, values)
    );
  } catch (error) {
    return {
      kind: "error",
      path: normalizedPath,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return { kind: "written", path: normalizedPath, priorityValues: values };
}

function humanizePriorityLabel(value: string): string {
  if (!value) return "None";
  return value
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function taskPrioritiesFromSchemaValues(
  values: string[],
  catalog: TaskPriorityConfig[] = [],
  colorOverrides: Record<string, string> = {}
): TaskPriorityConfig[] {
  return values.map((value, index) => {
    const normalized = value.toLowerCase();
    const match = catalog.find(
      (priority) => priority.value.toLowerCase() === normalized
    );
    const overrideColor =
      colorOverrides[value] ?? colorOverrides[normalized] ?? null;
    return {
      id: match?.id ?? normalized,
      value,
      label: match?.label ?? humanizePriorityLabel(value),
      color:
        overrideColor ??
        match?.color ??
        FALLBACK_PRIORITY_COLORS[index % FALLBACK_PRIORITY_COLORS.length],
      weight: values.length - index,
      icon: match?.icon,
    };
  });
}
