import { Language } from "../i18n";
import { FilterState } from "./filter-state";
import { TagColorPalette } from "../lib/tag-color-manager";

export interface FilterPreset {
  id: string;
  name: string;
  filter: FilterState;
}

export interface TasksMapSettings {
  showPriorities: boolean;
  showTags: boolean;
  showStatusCounts: boolean;

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

  // Tag color settings
  tagColorPalette: TagColorPalette;

  // Language setting
  language: Language;

  // Filter presets
  filterPresets: FilterPreset[];
}

export const DEFAULT_SETTINGS: TasksMapSettings = {
  showPriorities: true,
  showTags: true,
  showStatusCounts: true,

  layoutDirection: "Horizontal",
  edgeStyle: "Bezier",
  smoothStepRadius: 10,
  linkingStyle: "csv",

  debugVisualization: false,

  // Note-based task detection defaults (backward-compatible: #task tag)
  noteTaskPropertyName: "tags",
  noteTaskPropertyValue: "task",
  noteDependencyProperty: "blockedBy",

  // Tag color defaults
  tagColorPalette: "rainbow",

  // Language default
  language: "en",

  // Filter presets default
  filterPresets: [],
};
