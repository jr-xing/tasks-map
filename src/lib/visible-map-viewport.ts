export interface MapOverlayInsets {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
}

export interface VisibleMapViewport {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  left: number;
  top: number;
}

/** Resolve the map rectangle left visible around overlay panels. */
export function getVisibleMapViewport(
  containerWidth: number,
  containerHeight: number,
  insets: MapOverlayInsets,
  minimumSize: number = 120
): VisibleMapViewport {
  const left = Math.max(0, insets.left ?? 0);
  const top = Math.max(0, insets.top ?? 0);
  const right = Math.max(0, insets.right ?? 0);
  const bottom = Math.max(0, insets.bottom ?? 0);
  const width = Math.max(minimumSize, containerWidth - left - right);
  const height = Math.max(minimumSize, containerHeight - top - bottom);

  return {
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
    left,
    top,
  };
}
