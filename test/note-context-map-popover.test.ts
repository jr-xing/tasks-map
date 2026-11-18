import { getPopoverGeometry } from "../src/components/note-context-map-popover";

const VIEWPORT = { width: 1400, height: 900 };

function anchor(top: number, left: number, width: number) {
  return { top, bottom: top + 60, left, width };
}

describe("getPopoverGeometry", () => {
  it("opens under the strip, at least 720px wide", () => {
    expect(getPopoverGeometry(anchor(100, 300, 600), VIEWPORT)).toEqual({
      top: 166,
      left: 300,
      width: 720,
      height: 460,
    });
  });

  it("keeps the map inside the window", () => {
    const geometry = getPopoverGeometry(anchor(100, 1000, 600), VIEWPORT);
    expect(geometry.left + geometry.width).toBe(VIEWPORT.width - 8);
  });

  it("flips above the strip when there is no room below", () => {
    const geometry = getPopoverGeometry(anchor(700, 300, 600), VIEWPORT);
    expect(geometry.top + geometry.height).toBe(694);
    expect(geometry.height).toBe(460);
  });

  describe("edge cases", () => {
    it("shrinks to a narrow window", () => {
      const geometry = getPopoverGeometry(anchor(100, 0, 300), {
        width: 500,
        height: 900,
      });
      expect(geometry).toMatchObject({ left: 8, width: 484 });
    });
  });
});
