import { Language } from "../i18n";
import { FilterState } from "./filter-state";
import { TagColorPalette } from "../lib/tag-color-manager";
import {
  TaskPriorityConfig,
  cloneDefaultPriorities,
} from "../lib/priority-config";
import { DEFAULT_TASKNOTES_TYPE_SCHEMA_PATH } from "../lib/tasknotes-type-schema";
import { TaskStatusConfig, cloneDefaultStatuses } from "../lib/status-config";
import type { TaskAttachmentKind } from "./base-task";

export type PriorityAccentPosition = "top" | "right";
/**
 * "minimal" draws flat cards that show colours and key indicators and reveal
 * their buttons on hover; "comfortable" and "compact" are the classic cards.
 */
export type NodeDensity = "minimal" | "comfortable" | "compact";
/**
 * "graph" is the dagre dependency graph; "tree" is the git-style lane view;
 * "branches" draws projects, groups and branches as summary cards with
 * their tasks as slim rows.
 */
export type LayoutMode = "graph" | "tree" | "branches";
export type LayoutDirectionSetting = "Horizontal" | "Vertical";
export type NoteTaskTitleSource = "filename" | "frontmatter";
export type TaskOrganizerAiProvider = "openai" | "anthropic" | "google";
export type TaskOrganizerOrphans = "skip" | "unassigned";

export const DEFAULT_QUICK_COMMENTS_PROPERTY_NAME = "quick-comments";

/**
 * Frontmatter properties that describe a project's branch structure. All of
 * them are optional in notes; the map falls back to the parent links alone.
 */
export interface BranchPropertySettings {
  /** Property marking a note's role, e.g. `kind`. */
  kindProperty: string;
  /** Value of {@link kindProperty} that marks a branch, e.g. `area`. */
  branchValue: string;
  /** Property linking a branch to its next step, e.g. `next`. */
  nextProperty: string;
  /** Property naming who a task is waiting on, e.g. `waitingOn`. */
  waitingOnProperty: string;
  /** Property linking a note to other notes that also use it, e.g. `related`. */
  relatedProperty: string;
  /**
   * Property whose first value groups a long list of sibling tasks into
   * clusters in the Branches layout, e.g. `contexts`.
   */
  groupProperty: string;
}

export const DEFAULT_BRANCH_PROPERTIES: BranchPropertySettings = {
  kindProperty: "kind",
  branchValue: "area",
  nextProperty: "next",
  waitingOnProperty: "waitingOn",
  relatedProperty: "related",
  groupProperty: "contexts",
};

export interface FilterPreset {
  id: string;
  name: string;
  filter: FilterState;
}

export interface TasksMapSettings {
  autoRefresh: boolean;
  showPriorities: boolean;
  priorityAccentPosition: PriorityAccentPosition;
  showTags: boolean;
  showStatusCounts: boolean;
  visibleAttachmentKinds: TaskAttachmentKind[];
  nodeDensity: NodeDensity;

  // Defaults for new map tabs; each tab can override both.
  layoutMode: LayoutMode;
  layoutDirection: LayoutDirectionSetting;
  edgeStyle: "Bezier" | "Straight" | "SmoothStep";
  smoothStepRadius: number;
  linkingStyle: "individual" | "csv" | "dataview";

  debugVisualization: boolean;

  // Note-based task detection
  // Which frontmatter property marks a note as a task, and the value to match.
  // Example: property "tags" + value "task", or property "type" + value "task".
  noteTaskPropertyName: string;
  noteTaskPropertyValue: string;
  // Controls the presentation label used for note-based tasks. Task identity
  // and link targets remain filename/path based.
  noteTaskTitleSource: NoteTaskTitleSource;
  noteTaskTitleProperty: string;
  noteTaskDatePrefixEnabled: boolean;
  noteTaskCreatedDateProperty: string;
  quickCommentsPropertyName: string;
  // Which frontmatter property holds this note's dependencies (a list of note
  // links or { uid } objects). Example: "blockedBy" or "projects".
  noteDependencyProperty: string;
  // Branch structure properties (see BranchPropertySettings).
  branchProperties: BranchPropertySettings;
  // When true, a map opens folded to branch level: branch cards show their
  // summary and their tasks stay hidden until the branch is unfolded.
  foldToBranches: boolean;

  // Width (in pixels) of the left sidebar holding the unlinked-tasks
  // and project-tree panels.
  sidebarWidth: number;

  // Height (in pixels) of the resizable Kanban overlay.
  kanbanPanelHeight: number;
  // Kanban-only display preferences. These do not change graph task labels or
  // the order of the underlying status definitions.
  kanbanCardTitleSource: NoteTaskTitleSource;
  kanbanShowProjectTasks: boolean;
  kanbanShowCardStatus: boolean;
  kanbanGroupByProject: boolean;
  kanbanOpenNoteOnDoubleClick: boolean;
  // Empty means use the configured task-status order.
  kanbanColumnOrder: string[];

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
  // User-configurable fallback priorities for TaskNotes note tasks.
  // Used as a fallback when the TaskNotes type schema is disabled/unavailable.
  taskPriorities: TaskPriorityConfig[];
  // Task Map color overrides for schema-backed TaskNotes priorities. The
  // TaskNotes type schema stores values, but not colors.
  taskPriorityColorOverrides: Record<string, string>;
  // When enabled, TaskNotes note priority values are read from the vault's
  // task type definition file instead of this plugin's fallback data.
  useTaskNotesTypeSchema: boolean;
  taskNotesTypeSchemaPath: string;
  taskOrganizerRenameProjectFolders: boolean;
  taskOrganizerRenameTaskFolders: boolean;
  taskOrganizerUseAiFolderNames: boolean;
  taskOrganizerAiProvider: TaskOrganizerAiProvider;
  taskOrganizerAiModel: string;
  taskOrganizerAiApiKey: string;
  taskOrganizerOrphans: TaskOrganizerOrphans;
  taskOrganizerExcludedFolders: string;
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
  autoRefresh: true,
  showPriorities: true,
  priorityAccentPosition: "top",
  showTags: true,
  showStatusCounts: true,
  visibleAttachmentKinds: [...DEFAULT_VISIBLE_ATTACHMENT_KINDS],
  nodeDensity: "minimal",

  layoutMode: "graph",
  layoutDirection: "Horizontal",
  edgeStyle: "Bezier",
  smoothStepRadius: 10,
  linkingStyle: "csv",

  debugVisualization: false,

  // Note-based task detection defaults (backward-compatible: #task tag)
  noteTaskPropertyName: "tags",
  noteTaskPropertyValue: "task",
  noteTaskTitleSource: "filename",
  noteTaskTitleProperty: "title",
  noteTaskDatePrefixEnabled: false,
  noteTaskCreatedDateProperty: "dateCreated",
  quickCommentsPropertyName: DEFAULT_QUICK_COMMENTS_PROPERTY_NAME,
  noteDependencyProperty: "blockedBy",
  branchProperties: { ...DEFAULT_BRANCH_PROPERTIES },
  foldToBranches: true,

  // Left sidebar width default
  sidebarWidth: 220,

  // Kanban overlay default
  kanbanPanelHeight: 360,
  kanbanCardTitleSource: "frontmatter",
  kanbanShowProjectTasks: false,
  kanbanShowCardStatus: false,
  kanbanGroupByProject: true,
  kanbanOpenNoteOnDoubleClick: true,
  kanbanColumnOrder: [],

  // Task editor panel defaults
  editorPanelWidth: 340,
  editorPanelLayout: "auto",
  editorBodyFontSize: 14,
  editorAutosave: true,

  // Tag color defaults
  tagColorPalette: "rainbow",

  // Task status defaults (mirrors the legacy hard-coded status set)
  taskStatuses: cloneDefaultStatuses(),
  taskPriorities: cloneDefaultPriorities(),
  taskPriorityColorOverrides: {},
  useTaskNotesTypeSchema: true,
  taskNotesTypeSchemaPath: DEFAULT_TASKNOTES_TYPE_SCHEMA_PATH,
  taskOrganizerRenameProjectFolders: false,
  taskOrganizerRenameTaskFolders: true,
  taskOrganizerUseAiFolderNames: false,
  taskOrganizerAiProvider: "openai",
  taskOrganizerAiModel: "",
  taskOrganizerAiApiKey: "",
  taskOrganizerOrphans: "skip",
  taskOrganizerExcludedFolders: "Templates",
  defaultStatusFilter: [],

  // Language default
  language: "en",

  // Filter presets default
  filterPresets: [],
};
