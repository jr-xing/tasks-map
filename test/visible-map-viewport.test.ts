import { getVisibleMapViewport } from "../src/lib/visible-map-viewport";

describe("getVisibleMapViewport", () => {
  it("uses the full container when there are no overlays", () => {
    expect(getVisibleMapViewport(1000, 700, {})).toEqual({
      width: 1000,
      height: 700,
      centerX: 500,
      centerY: 350,
      left: 0,
      top: 0,
    });
  });

  it("centers within the area left below top and side overlays", () => {
    expect(
      getVisibleMapViewport(1000, 700, {
        left: 64,
        top: 392,
        right: 200,
      })
    ).toEqual({
      width: 736,
      height: 308,
      centerX: 432,
      centerY: 546,
      left: 64,
      top: 392,
    });
  });

  it("keeps a minimum interaction area for small containers", () => {
    expect(getVisibleMapViewport(200, 180, { left: 150, top: 150 })).toEqual({
      width: 120,
      height: 120,
      centerX: 210,
      centerY: 210,
      left: 150,
      top: 150,
    });
  });
});
