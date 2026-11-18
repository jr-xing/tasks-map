import {
  chooseFittingButtons,
  getDanglingDividers,
  getFirstLineRight,
} from "../src/components/note-context-strip";
import { formatContexts } from "../src/lib/minimal-card";
import { menuPointBelow, toggleValue } from "../src/views/note-context-menus";

describe("getFirstLineRight", () => {
  it("returns the right edge of the first line only", () => {
    expect(
      getFirstLineRight([
        { top: 10, right: 120 },
        { top: 10, right: 300 },
        { top: 30, right: 500 },
      ])
    ).toBe(300);
  });

  it("tolerates subpixel differences in top", () => {
    expect(
      getFirstLineRight([
        { top: 10, right: 120 },
        { top: 11.5, right: 240 },
      ])
    ).toBe(240);
  });

  it("returns null for an empty row", () => {
    expect(getFirstLineRight([])).toBeNull();
  });
});

describe("getDanglingDividers", () => {
  const item = (top: number) => ({ divider: false, top });
  const divider = (top: number) => ({ divider: true, top });

  it("keeps dividers between items on the same line", () => {
    expect(getDanglingDividers([item(0), divider(0), item(0)])).toEqual([]);
  });

  it("hides a divider whose next item wrapped", () => {
    expect(
      getDanglingDividers([
        item(0),
        divider(0),
        item(20),
        divider(20),
        item(20),
      ])
    ).toEqual([1]);
  });

  it("hides a divider that wrapped to the start of a line", () => {
    expect(getDanglingDividers([item(0), divider(20), item(20)])).toEqual([1]);
  });

  describe("edge cases", () => {
    it("hides a divider with nothing after it", () => {
      expect(getDanglingDividers([item(0), divider(0)])).toEqual([1]);
    });
  });
});

describe("chooseFittingButtons", () => {
  const buttons = [
    { id: "status", width: 90 },
    { id: "priority", width: 70 },
    { id: "context", width: 60 },
  ];

  it("shows all three when they fit", () => {
    expect(chooseFittingButtons(buttons, 224, 2)).toEqual([
      "status",
      "priority",
      "context",
    ]);
  });

  it("drops context first, then priority", () => {
    expect(chooseFittingButtons(buttons, 200, 2)).toEqual([
      "status",
      "priority",
    ]);
    expect(chooseFittingButtons(buttons, 100, 2)).toEqual(["status"]);
  });

  it("shows nothing when even status does not fit", () => {
    expect(chooseFittingButtons(buttons, 50, 2)).toEqual([]);
  });
});

describe("formatContexts", () => {
  it.each([
    [[], null],
    [["lab"], "@lab"],
    [["@home"], "@home"],
    [["lab", "home", "train"], "@lab +2"],
  ])("formats %j as %s", (values, expected) => {
    expect(formatContexts(values as string[])).toBe(expected);
  });
});

describe("context menu helpers", () => {
  it("toggles a value in and out", () => {
    expect(toggleValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("menuPointBelow", () => {
  it("opens under the button, aligned to its left edge", () => {
    expect(
      menuPointBelow({ left: 120, bottom: 40 }, { x: 150, y: 30 })
    ).toEqual({ x: 120, y: 44 });
  });

  it("falls back to the pointer without a button", () => {
    expect(menuPointBelow(null, { x: 150, y: 30 })).toEqual({ x: 150, y: 30 });
  });
});
