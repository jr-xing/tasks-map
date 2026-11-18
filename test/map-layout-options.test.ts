import {
  applyMapLayout,
  parseMapLayoutState,
  resolveMapLayout,
  toggledLayoutDirection,
  toggledLayoutMode,
} from "../src/lib/map-layout-options";
import { DEFAULT_SETTINGS, TasksMapSettings } from "../src/types/settings";

function makeSettings(
  overrides: Partial<TasksMapSettings> = {}
): TasksMapSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("map layout options", () => {
  describe("parseMapLayoutState", () => {
    it("reads valid per-tab layout values", () => {
      expect(
        parseMapLayoutState({ layoutMode: "tree", layoutDirection: "Vertical" })
      ).toEqual({ layoutMode: "tree", layoutDirection: "Vertical" });
    });

    it.each([null, undefined, "tree", 42])(
      "returns no overrides for non-object state %p",
      (state) => {
        expect(parseMapLayoutState(state)).toEqual({});
      }
    );

    it("drops unknown values instead of trusting persisted junk", () => {
      expect(
        parseMapLayoutState({ layoutMode: "radial", layoutDirection: "Up" })
      ).toEqual({});
    });
  });

  describe("resolveMapLayout", () => {
    it("falls back to the global defaults for missing overrides", () => {
      const settings = makeSettings({
        layoutMode: "graph",
        layoutDirection: "Horizontal",
      });
      expect(resolveMapLayout(settings, { layoutMode: "tree" })).toEqual({
        layoutMode: "tree",
        layoutDirection: "Horizontal",
      });
    });
  });

  describe("applyMapLayout", () => {
    it("keeps the same settings object when nothing is overridden", () => {
      const settings = makeSettings();
      expect(applyMapLayout(settings, {})).toBe(settings);
    });

    it("overrides only the layout fields", () => {
      const settings = makeSettings({ showTags: false });
      const result = applyMapLayout(settings, {
        layoutMode: "tree",
        layoutDirection: "Vertical",
      });
      expect(result).toEqual({
        ...settings,
        layoutMode: "tree",
        layoutDirection: "Vertical",
      });
      expect(settings.layoutMode).toBe("graph");
    });
  });

  it("toggles mode and direction", () => {
    expect(toggledLayoutMode("graph")).toBe("tree");
    expect(toggledLayoutMode("tree")).toBe("branches");
    expect(toggledLayoutMode("branches")).toBe("graph");
    expect(toggledLayoutDirection("Horizontal")).toBe("Vertical");
    expect(toggledLayoutDirection("Vertical")).toBe("Horizontal");
  });
});
