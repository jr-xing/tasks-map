import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquarePlus, Trash2, X } from "lucide-react";
import { useApp } from "src/hooks/hooks";
import { NoteTask } from "src/types/note-task";
import { useSummaryRenderer } from "../hooks/use-summary-renderer";
import { t } from "../i18n";

interface QuickUpdateProps {
  task: NoteTask;
  propertyName: string;
  // eslint-disable-next-line no-unused-vars -- callback parameter convention
  onChanged?: (taskId: string, value: string) => void;
}

interface PopoverPosition {
  left: number;
  top: number;
  width: number;
}

const POPOVER_WIDTH = 320;
const POPOVER_HEIGHT = 250;
const POPOVER_GAP = 8;

function normalizeQuickUpdate(value: string) {
  return value.replace(/\r\n?/g, "\n").trim();
}

export function QuickUpdate({
  task,
  propertyName,
  onChanged,
}: QuickUpdateProps) {
  const app = useApp();
  const anchorElementRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(task.quickComments);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<PopoverPosition>({
    left: 0,
    top: 0,
    width: POPOVER_WIDTH,
  });
  const previewRef = useSummaryRenderer<HTMLDivElement>(
    task.quickComments,
    app
  );

  const anchorRef = useCallback((element: HTMLDivElement | null) => {
    anchorElementRef.current = element;
    setPortalTarget(element?.ownerDocument.body ?? null);
  }, []);

  const updatePosition = useCallback(() => {
    const anchor = anchorElementRef.current;
    if (!anchor) return;
    const ownerWindow = anchor.ownerDocument.defaultView ?? window;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(
      POPOVER_WIDTH,
      Math.max(240, ownerWindow.innerWidth - POPOVER_GAP * 2)
    );
    const fitsRight =
      rect.right + POPOVER_GAP + width <= ownerWindow.innerWidth - POPOVER_GAP;
    const left = fitsRight
      ? rect.right + POPOVER_GAP
      : Math.max(POPOVER_GAP, rect.left - width - POPOVER_GAP);
    const top = Math.min(
      Math.max(POPOVER_GAP, rect.top),
      Math.max(POPOVER_GAP, ownerWindow.innerHeight - POPOVER_HEIGHT)
    );
    setPosition((current) =>
      current.left === left && current.top === top && current.width === width
        ? current
        : { left, top, width }
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    const ownerWindow =
      anchorElementRef.current?.ownerDocument.defaultView ?? window;
    let animationFrame: number;
    const syncPosition = () => {
      updatePosition();
      animationFrame = ownerWindow.requestAnimationFrame(syncPosition);
    };
    animationFrame = ownerWindow.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      syncPosition();
    });

    return () => {
      ownerWindow.cancelAnimationFrame(animationFrame);
    };
  }, [open, updatePosition]);

  const openEditor = useCallback(() => {
    updatePosition();
    setDraft(task.quickComments);
    setError(false);
    setOpen(true);
  }, [task.quickComments, updatePosition]);

  const cancelEditor = useCallback(() => {
    if (saving) return;
    setDraft(task.quickComments);
    setError(false);
    setOpen(false);
  }, [saving, task.quickComments]);

  const saveDraft = useCallback(async () => {
    if (saving) return;
    const normalized = normalizeQuickUpdate(draft);
    setSaving(true);
    setError(false);
    try {
      await task.updateQuickComments(normalized, propertyName, app);
      setDraft(normalized);
      onChanged?.(task.id, normalized);
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }, [app, draft, onChanged, propertyName, saving, task]);

  const handlePreviewClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      if ((event.target as HTMLElement).closest("a")) return;
      event.preventDefault();
      openEditor();
    },
    [openEditor]
  );

  const handlePreviewKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.stopPropagation();
      if ((event.target as HTMLElement).closest("a")) return;
      event.preventDefault();
      openEditor();
    },
    [openEditor]
  );

  const handleEditorKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelEditor();
        return;
      }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void saveDraft();
      }
    },
    [cancelEditor, saveDraft]
  );

  const popoverRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      element.style.setProperty("--tm-quick-update-left", `${position.left}px`);
      element.style.setProperty("--tm-quick-update-top", `${position.top}px`);
      element.style.setProperty(
        "--tm-quick-update-width",
        `${position.width}px`
      );
    },
    [position]
  );

  const stopPropagation = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  const handlePopoverKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      event.stopPropagation();
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelEditor();
    },
    [cancelEditor]
  );

  return (
    <div ref={anchorRef} className="tasks-map-quick-update nodrag nopan">
      {task.quickComments ? (
        <div
          className="tasks-map-quick-update-preview"
          role="button"
          tabIndex={0}
          aria-label={t("quick_update.edit")}
          title={t("quick_update.edit")}
          onClick={handlePreviewClick}
          onKeyDown={handlePreviewKeyDown}
        >
          <div ref={previewRef} className="tasks-map-quick-update-content" />
        </div>
      ) : (
        <button
          type="button"
          className="tasks-map-quick-update-add nodrag nopan"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            openEditor();
          }}
        >
          <MessageSquarePlus size={13} />
          <span>{t("quick_update.add")}</span>
        </button>
      )}

      {open &&
        portalTarget &&
        createPortal(
          <div
            ref={popoverRef}
            className="tasks-map-quick-update-popover nodrag nopan nowheel"
            role="dialog"
            aria-label={t("quick_update.label")}
            onClick={stopPropagation}
            onDoubleClick={stopPropagation}
            onPointerDown={stopPropagation}
            onWheel={stopPropagation}
            onKeyDown={handlePopoverKeyDown}
          >
            <div className="tasks-map-quick-update-popover-header">
              <span>{t("quick_update.label")}</span>
              <button
                type="button"
                className="tasks-map-quick-update-icon-button"
                aria-label={t("quick_update.cancel")}
                title={t("quick_update.cancel")}
                disabled={saving}
                onClick={cancelEditor}
              >
                <X size={15} />
              </button>
            </div>
            <textarea
              ref={textareaRef}
              className="tasks-map-quick-update-textarea"
              rows={6}
              value={draft}
              placeholder={t("quick_update.placeholder")}
              disabled={saving}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleEditorKeyDown}
            />
            {error && (
              <div className="tasks-map-quick-update-error" role="alert">
                {t("quick_update.save_error")}
              </div>
            )}
            <div className="tasks-map-quick-update-actions">
              <button
                type="button"
                className="tasks-map-quick-update-clear"
                disabled={saving || !draft}
                onClick={() => setDraft("")}
              >
                <Trash2 size={13} />
                <span>{t("quick_update.clear")}</span>
              </button>
              <div className="tasks-map-quick-update-actions-spacer" />
              <button type="button" disabled={saving} onClick={cancelEditor}>
                {t("quick_update.cancel")}
              </button>
              <button
                type="button"
                className="mod-cta"
                disabled={saving}
                onClick={() => void saveDraft()}
              >
                {saving ? t("quick_update.saving") : t("quick_update.save")}
              </button>
            </div>
          </div>,
          portalTarget
        )}
    </div>
  );
}
