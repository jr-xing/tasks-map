import type {
  LayoutDirectionSetting,
  LayoutMode,
  TasksMapSettings,
} from "src/types/settings";

/** The layout a single map tab renders with. */
export interface MapLayoutOptions {
  layoutMode: LayoutMode;
  layoutDirection: LayoutDirectionSetting;
}

/**
 * Per-tab layout choices. A missing key follows the global default from the
 * plugin settings, so changing the default still affects untouched tabs.
 */
export type MapLayoutOverrides = Partial<MapLayoutOptions>;

const LAYOUT_MODES: readonly LayoutMode[] = ["graph", "tree"];
const LAYOUT_DIRECTIONS: readonly LayoutDirectionSetting[] = [
  "Horizontal",
  "Vertical",
];

function isLayoutMode(value: unknown): value is LayoutMode {
  return LAYOUT_MODES.includes(value as LayoutMode);
}

function isLayoutDirection(value: unknown): value is LayoutDirectionSetting {
  return LAYOUT_DIRECTIONS.includes(value as LayoutDirectionSetting);
}

/** Read layout overrides from persisted Obsidian view state, ignoring junk. */
export function parseMapLayoutState(state: unknown): MapLayoutOverrides {
  if (!state || typeof state !== "object") return {};
  const record = state as Record<string, unknown>;
  const overrides: MapLayoutOverrides = {};
  if (isLayoutMode(record.layoutMode)) {
    overrides.layoutMode = record.layoutMode;
  }
  if (isLayoutDirection(record.layoutDirection)) {
    overrides.layoutDirection = record.layoutDirection;
  }
  return overrides;
}

export function resolveMapLayout(
  settings: Pick<TasksMapSettings, "layoutMode" | "layoutDirection">,
  overrides: MapLayoutOverrides
): MapLayoutOptions {
  return {
    layoutMode: overrides.layoutMode ?? settings.layoutMode,
    layoutDirection: overrides.layoutDirection ?? settings.layoutDirection,
  };
}

/** Merge a tab's overrides into the settings object the map renders with. */
export function applyMapLayout<T extends TasksMapSettings>(
  settings: T,
  overrides: MapLayoutOverrides
): T {
  const layout = resolveMapLayout(settings, overrides);
  if (
    layout.layoutMode === settings.layoutMode &&
    layout.layoutDirection === settings.layoutDirection
  ) {
    return settings;
  }
  return { ...settings, ...layout };
}

export function toggledLayoutMode(mode: LayoutMode): LayoutMode {
  return mode === "tree" ? "graph" : "tree";
}

export function toggledLayoutDirection(
  direction: LayoutDirectionSetting
): LayoutDirectionSetting {
  return direction === "Vertical" ? "Horizontal" : "Vertical";
}
