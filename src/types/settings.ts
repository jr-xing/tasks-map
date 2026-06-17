import { Language } from "../i18n";
import { FilterState } from "./filter-state";
import { TagColorPalette } from "../lib/tag-color-manager";
import { TaskStatusConfig, cloneDefaultStatuses } from "../lib/status-config";
import type { TaskAttachmentKind } from "./base-task";

export type PriorityAccentPosition = "top" | "right";

export interface FilterPreset {
  id: string;
  name: string;
  filter: FilterState;
}

export interface TasksMapSettings {
  showPriorities: boolean;
  priorityAccentPosition: PriorityAccentPosition;
  showTags: boolean;
  showStatusCounts: boolean;
  visibleAttachmentKinds: TaskAttachmentKind[];

  layoutDirection: "Horizontal" | "Vertical";
  edgeStyle: "Bezier" | "Straight" | "SmoothStep";
  smoothStepRadius: number;
  linkingStyle: "individual" | "csv" | "dataview";

  debugVisualization: boolean;

  // Note-based task detection
  // Which frontmatter property marks a note as a task, and the value to match.
  // Example: property "tags" + value "task", or property "type" + value "task".
  noteTaskPropertyName: string;
  noteTaskPropertyValue: string;
  // Which frontmatter property holds this note's dependencies (a list of note
  // links or { uid } objects). Example: "blockedBy" or "projects".
  noteDependencyProperty: string;

  // Width (in pixels) of the left sidebar holding the unlinked-tasks
  // and project-tree panels.
  sidebarWidth: number;

  // Task editor (right sidebar) panel preferences.
  // Width in pixels of the resizable panel.
  editorPanelWidth: number;
  // Whether metadata sits above the body ("stacked"), beside it
  // ("side-by-side"), or adapts to the panel width ("auto").
  editorPanelLayout: "auto" | "stacked" | "side-by-side";
  // Font size (in pixels) of the markdown body editor.
  editorBodyFontSize: number;
  // When true, edits in the task editor panel are written to disk
  // automatically (debounced). When false, an explicit Save is required.
  editorAutosave: boolean;

  // Tag color settings
  tagColorPalette: TagColorPalette;

  // User-configurable task statuses (id, label, color, checkbox char,
  // frontmatter values). Replaces the previously hard-coded status set.
  taskStatuses: TaskStatusConfig[];
  // Status ids that are visible by default when the map is opened. An empty
  // list means "show all statuses".
  defaultStatusFilter: string[];

  // Language setting
  language: Language;

  // Filter presets
  filterPresets: FilterPreset[];
}

export const DEFAULT_VISIBLE_ATTACHMENT_KINDS: TaskAttachmentKind[] = [
  "markdown",
  "pdf",
  "file",
];

export const DEFAULT_SETTINGS: TasksMapSettings = {
  showPriorities: true,
  priorityAccentPosition: "top",
  showTags: true,
  showStatusCounts: true,
  visibleAttachmentKinds: [...DEFAULT_VISIBLE_ATTACHMENT_KINDS],

  layoutDirection: "Horizontal",
  edgeStyle: "Bezier",
  smoothStepRadius: 10,
  linkingStyle: "csv",

  debugVisualization: false,

  // Note-based task detection defaults (backward-compatible: #task tag)
  noteTaskPropertyName: "tags",
  noteTaskPropertyValue: "task",
  noteDependencyProperty: "blockedBy",

  // Left sidebar width default
  sidebarWidth: 220,

  // Task editor panel defaults
  editorPanelWidth: 340,
  editorPanelLayout: "auto",
  editorBodyFontSize: 14,
  editorAutosave: true,

  // Tag color defaults
  tagColorPalette: "rainbow",

  // Task status defaults (mirrors the legacy hard-coded status set)
  taskStatuses: cloneDefaultStatuses(),
  defaultStatusFilter: [],

  // Language default
  language: "en",

  // Filter presets default
  filterPresets: [],
};
