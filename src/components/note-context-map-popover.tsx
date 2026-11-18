import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

/** Preferred size of the floating project map. */
const POPOVER_HEIGHT = 460;
const POPOVER_MIN_WIDTH = 720;
const VIEWPORT_MARGIN = 8;
const GAP = 6;

/** Clicks inside Obsidian's own floating UI must not close the map. */
const FLOATING_UI_SELECTOR =
  ".menu, .popover, .modal-container, .suggestion-container";

interface PopoverGeometry {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Place the map under the strip, as wide as the strip (at least 720px) and
 * inside the window; flip above the strip when there is no room below.
 */
export function getPopoverGeometry(
  anchor: Pick<DOMRect, "top" | "bottom" | "left" | "width">,
  viewport: { width: number; height: number }
): PopoverGeometry {
  const maxWidth = viewport.width - VIEWPORT_MARGIN * 2;
  const width = Math.min(Math.max(anchor.width, POPOVER_MIN_WIDTH), maxWidth);
  const left = Math.min(
    Math.max(anchor.left, VIEWPORT_MARGIN),
    viewport.width - VIEWPORT_MARGIN - width
  );
  const below = viewport.height - anchor.bottom - GAP - VIEWPORT_MARGIN;
  const above = anchor.top - GAP - VIEWPORT_MARGIN;
  if (below >= Math.min(POPOVER_HEIGHT, 280) || below >= above) {
    const height = Math.max(Math.min(POPOVER_HEIGHT, below), 160);
    return { top: anchor.bottom + GAP, left, width, height };
  }
  const height = Math.min(POPOVER_HEIGHT, above);
  return { top: anchor.top - GAP - height, left, width, height };
}

interface NoteContextMapPopoverProps {
  anchorEl: HTMLElement;
  buttonEl: HTMLElement | null;
  onPin: () => void;
  onClose: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  render: (_height: number) => React.ReactNode;
}

/** The project map floating over the note, like a page preview. */
export default function NoteContextMapPopover({
  anchorEl,
  buttonEl,
  onPin,
  onClose,
  onPointerEnter,
  onPointerLeave,
  render,
}: NoteContextMapPopoverProps) {
  const doc = anchorEl.ownerDocument;
  const win = doc.defaultView ?? window;
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const geometry = useMemo(
    () =>
      getPopoverGeometry(anchorEl.getBoundingClientRect(), {
        width: win.innerWidth,
        height: win.innerHeight,
      }),
    [anchorEl, win]
  );

  const setPopoverEl = useCallback(
    (element: HTMLDivElement | null) => {
      popoverRef.current = element;
      if (!element) return;
      element.style.top = `${geometry.top}px`;
      element.style.left = `${geometry.left}px`;
      element.style.width = `${geometry.width}px`;
      element.style.height = `${geometry.height}px`;
    },
    [geometry]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (buttonEl?.contains(target)) return;
      if (target instanceof Element && target.closest(FLOATING_UI_SELECTOR))
        return;
      onClose();
    };
    doc.addEventListener("keydown", onKeyDown, true);
    doc.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      doc.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [doc, buttonEl, onClose]);

  return createPortal(
    <div
      className="tasks-map-note-context-popover"
      ref={setPopoverEl}
      onPointerDown={onPin}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
    >
      {render(geometry.height)}
    </div>,
    doc.body
  );
}
