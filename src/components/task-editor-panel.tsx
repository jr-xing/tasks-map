import React, { useEffect, useMemo, useRef, useState } from "react";
import { App, Platform, Scope } from "obsidian";
import Select, { type MultiValue, type SingleValue } from "react-select";
import CreatableSelect from "react-select/creatable";
import {
  ALargeSmall,
  Check,
  CircleAlert,
  Columns2,
  Minus,
  Plus,
  RefreshCw,
  Rows2,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { TasksMapSettings } from "src/types/settings";
import { BaseTask } from "src/types/task";
import { t } from "../i18n";
import { obsidianSelectStyles } from "../lib/select-styles";
import MarkdownBodyEditor from "./markdown-body-editor";
import {
  TaskNotesTaskInfo,
  createTaskNotesTask,
  getTaskNotesConfig,
  getTaskNotesTaskInfo,
  updateTaskNotesTask,
} from "../lib/tasknotes-bridge";
import {
  TaskFormValues,
  applyParsedToForm,
  createNlpParser,
  emptyTaskForm,
} from "../lib/tasknotes-nlp";

interface Option {
  value: string;
  label: string;
}

type EditorPanelLayout = TasksMapSettings["editorPanelLayout"];

interface TaskEditorPanelProps {
  app: App;
  mode: "create" | "edit";
  /** Path of the task being edited (edit mode only). */
  taskPath?: string;
  /** Note tasks available as dependency targets. */
  availableTasks: BaseTask[];
  /** Metadata/body arrangement: stacked, side-by-side, or width-adaptive. */
  layout: EditorPanelLayout;
  // eslint-disable-next-line no-unused-vars -- callback parameter convention
  onLayoutChange: (layout: EditorPanelLayout) => void;
  /** Markdown body editor font size, in pixels. */
  bodyFontSize: number;
  // eslint-disable-next-line no-unused-vars -- callback parameter convention
  onBodyFontSizeChange: (size: number) => void;
  /** When true (edit mode), changes are debounce-saved to disk automatically. */
  autosaveEnabled: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** Layout options shown in the header toggle, with their icons. */
const LAYOUT_OPTIONS: {
  value: EditorPanelLayout;
  icon: typeof Wand2;
  labelKey: string;
}[] = [
  { value: "auto", icon: Wand2, labelKey: "task_editor.layout_auto" },
  { value: "stacked", icon: Rows2, labelKey: "task_editor.layout_stacked" },
  { value: "side-by-side", icon: Columns2, labelKey: "task_editor.layout_side" },
];

/** Allowed body-font-size range, in pixels. */
const MIN_BODY_FONT = 10;
const MAX_BODY_FONT = 24;

/** Default reltype for dependencies created through the panel. */
const DEFAULT_RELTYPE = "FINISHTOSTART";

/** Debounce delay before an edit-mode change is auto-saved, in ms. */
const AUTOSAVE_DELAY = 800;

/** Edit-mode autosave lifecycle state, surfaced in the footer indicator. */
type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

/** Trim a date/datetime string down to its `YYYY-MM-DD` part. */
function dateOnly(value?: string): string {
  return value ? value.slice(0, 10) : "";
}

function taskInfoToForm(info: TaskNotesTaskInfo): TaskFormValues {
  return {
    title: info.title ?? "",
    status: info.status ?? "",
    priority: info.priority ?? "",
    due: dateOnly(info.due),
    scheduled: dateOnly(info.scheduled),
    tags: info.tags ?? [],
    contexts: info.contexts ?? [],
    projects: info.projects ?? [],
    blockedBy: (info.blockedBy ?? []).map((dep) => dep.uid),
    timeEstimate: info.timeEstimate ?? 0,
    recurrence: info.recurrence ?? "",
    details: info.details ?? "",
  };
}

/** Build the create/update payload from the current form values. */
function formToPayload(form: TaskFormValues): Partial<TaskNotesTaskInfo> {
  return {
    title: form.title.trim(),
    status: form.status,
    priority: form.priority,
    due: form.due || undefined,
    scheduled: form.scheduled || undefined,
    tags: form.tags,
    contexts: form.contexts,
    projects: form.projects,
    blockedBy: form.blockedBy.map((uid) => ({
      uid,
      reltype: DEFAULT_RELTYPE,
    })),
    timeEstimate: form.timeEstimate > 0 ? form.timeEstimate : undefined,
    recurrence: form.recurrence.trim() || undefined,
    details: form.details,
  };
}

/** Resolve a value to an option, synthesizing one if it is not in `options`. */
function toOption(value: string, options: Option[]): Option | null {
  if (!value) return null;
  return options.find((o) => o.value === value) ?? { value, label: value };
}

function toOptions(values: string[], labelOf?: (_v: string) => string): Option[] {
  return values.map((v) => ({ value: v, label: labelOf ? labelOf(v) : v }));
}

export default function TaskEditorPanel({
  app,
  mode,
  taskPath,
  availableTasks,
  layout,
  onLayoutChange,
  bodyFontSize,
  onBodyFontSizeChange,
  autosaveEnabled,
  onClose,
  onSaved,
}: TaskEditorPanelProps) {
  const config = useMemo(() => getTaskNotesConfig(app), [app]);
  const selectStyles = useMemo(() => obsidianSelectStyles<Option>(), []);

  // Autosave applies only when editing an existing task and the user has it
  // enabled; otherwise the panel uses an explicit Save button.
  const autosave = mode === "edit" && autosaveEnabled;

  const [form, setForm] = useState<TaskFormValues>(() => emptyTaskForm(config));
  const [originalTask, setOriginalTask] = useState<TaskNotesTaskInfo | null>(
    null
  );
  const [loading, setLoading] = useState(mode === "edit");
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nlpInput, setNlpInput] = useState("");
  // Edit-mode autosave state shown in the footer indicator.
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  // Mirrors of state read by the (non-reactive) autosave callbacks.
  const formRef = useRef(form);
  const originalTaskRef = useRef(originalTask);
  useEffect(() => {
    formRef.current = form;
  }, [form]);
  useEffect(() => {
    originalTaskRef.current = originalTask;
  }, [originalTask]);

  // Panel root, used to capture the Ctrl/Cmd+S save shortcut.
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Latest save-shortcut action; refreshed every render so the (mount-time)
  // listener never goes stale. Returns true when the panel handled the key.
  const saveShortcutRef = useRef<() => boolean>(() => false);

  // The title is persisted on blur rather than per keystroke, so the note
  // file is renamed at most once per edit instead of on every character.
  // This holds the last blur-committed title (safe to write to disk).
  const committedTitleRef = useRef("");
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether an autosave write is currently in flight.
  const savingRef = useRef(false);
  // Whether there are edits not yet written to disk.
  const pendingRef = useRef(false);

  // Load the existing task when editing.
  useEffect(() => {
    if (mode !== "edit" || !taskPath) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    void getTaskNotesTaskInfo(app, taskPath).then((info) => {
      if (cancelled) return;
      if (!info) {
        setLoadError(true);
      } else {
        setOriginalTask(info);
        setForm(taskInfoToForm(info));
        committedTitleRef.current = info.title ?? "";
        pendingRef.current = false;
        setSaveStatus("idle");
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [app, mode, taskPath]);

  /**
   * Persist the current form to disk via TaskNotes (edit mode only).
   *
   * Reads all state through refs so it can be invoked from debounced timers
   * and effect cleanups without going stale. Concurrent invocations are
   * serialized: a call made while a save is in flight is folded into a
   * follow-up run once the in-flight save completes.
   */
  async function commitChanges() {
    if (!autosave) return;
    const original = originalTaskRef.current;
    if (!original) return;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    // A save is already running; it re-checks `pendingRef` when it finishes.
    if (savingRef.current) return;

    savingRef.current = true;
    pendingRef.current = false;
    setSaveStatus("saving");

    const snapshot = formRef.current;
    const payload = formToPayload(snapshot);
    // Persist only the blur-committed title, never a half-typed one.
    payload.title = committedTitleRef.current.trim() || original.title;

    const updated = await updateTaskNotesTask(app, original, payload);
    savingRef.current = false;

    if (updated) {
      // `updateTask`'s result omits the note body; keep the snapshot's copy
      // so the next diff is computed against what is actually on disk.
      setOriginalTask({ ...updated, details: snapshot.details });
      committedTitleRef.current = updated.title ?? committedTitleRef.current;
      setSaveStatus(pendingRef.current ? "unsaved" : "saved");
      onSaved();
      // Flush any edits made while this save was in flight.
      if (pendingRef.current) void commitChanges();
    } else {
      // Keep changes pending so the user can retry from the indicator.
      pendingRef.current = true;
      setSaveStatus("error");
    }
  }

  /** Schedule a debounced autosave (edit mode, autosave enabled). */
  function scheduleAutosave() {
    if (!autosave) return;
    pendingRef.current = true;
    setSaveStatus("unsaved");
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void commitChanges();
    }, AUTOSAVE_DELAY);
  }

  // On unmount, flush a pending autosave so in-progress edits are not lost.
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (autosave && pendingRef.current && !savingRef.current) {
        committedTitleRef.current = formRef.current.title;
        void commitChanges();
      }
    };
    // Runs once: the cleanup reads everything it needs through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps, @eslint-react/exhaustive-deps
  }, []);

  const statusOptions = useMemo<Option[]>(
    () => config.statuses.map((s) => ({ value: s.value, label: s.label })),
    [config]
  );
  const priorityOptions = useMemo<Option[]>(
    () => config.priorities.map((p) => ({ value: p.value, label: p.label })),
    [config]
  );

  // Dependency picker: other note tasks, keyed by file path.
  const dependencyOptions = useMemo<Option[]>(
    () =>
      availableTasks
        .filter((task) => task.link && task.link !== taskPath)
        .map((task) => ({ value: task.link, label: task.text || task.link })),
    [availableTasks, taskPath]
  );
  const dependencyLabel = useMemo(() => {
    const byPath = new Map(dependencyOptions.map((o) => [o.value, o.label]));
    return (uid: string) => byPath.get(uid) ?? uid;
  }, [dependencyOptions]);

  function update<K extends keyof TaskFormValues>(
    key: K,
    value: TaskFormValues[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (!autosave) return;
    if (key === "title") {
      // The title is committed on blur; just flag the unsaved state now.
      pendingRef.current = true;
      setSaveStatus("unsaved");
    } else {
      scheduleAutosave();
    }
  }

  /** Commit the title (as a blur would) and trigger an autosave. */
  function commitTitle() {
    if (!autosave) return;
    if (form.title === committedTitleRef.current) return;
    committedTitleRef.current = form.title;
    scheduleAutosave();
  }

  /** Flush any pending edit-mode autosave, then close the panel. */
  async function handleClose() {
    if (autosave) {
      // Closing commits the title, just like blurring the title input.
      committedTitleRef.current = formRef.current.title;
      if (autosaveTimerRef.current || pendingRef.current) {
        await commitChanges();
      }
    }
    onClose();
  }

  function handleParse() {
    const text = nlpInput.trim();
    if (!text) return;
    try {
      const parsed = createNlpParser(app).parseInput(text);
      setForm((prev) => applyParsedToForm(parsed, prev));
      setNlpInput("");
    } catch (error) {
      console.error("Natural-language parsing failed:", error);
    }
  }

  /**
   * Persist the form via TaskNotes. `closeAfter` controls whether the panel
   * closes on success — the Save button closes, the Ctrl+S shortcut does not.
   */
  async function handleSave(closeAfter = true) {
    if (!form.title.trim() || saving) return;
    setSaving(true);
    const payload = formToPayload(form);
    let ok = false;
    if (mode === "create") {
      ok = (await createTaskNotesTask(app, payload)) !== null;
    } else if (originalTask) {
      const updated = await updateTaskNotesTask(app, originalTask, payload);
      if (updated) {
        // Refresh the baseline so a later save (panel still open) diffs
        // against what is now on disk rather than the stale original.
        setOriginalTask({ ...updated, details: form.details });
        ok = true;
      }
    }
    setSaving(false);
    if (ok) {
      onSaved();
      if (closeAfter) onClose();
    }
  }

  /** Whether the explicit Save action can run right now. */
  const canSave = !loading && !loadError && !saving && Boolean(form.title.trim());

  // Refresh the save-shortcut action with current state on every render.
  useEffect(() => {
    saveShortcutRef.current = () => {
      // In autosave mode the panel does not own Ctrl+S — let it pass through.
      if (autosave) return false;
      // Ctrl+S saves in place; only create mode closes (the task is done).
      if (canSave) void handleSave(mode === "create");
      return true;
    };
  });

  // Register Ctrl/Cmd+S through an Obsidian keymap Scope, active while focus
  // is anywhere inside the panel. A Scope is required because Obsidian's
  // keymap intercepts Ctrl+S globally (capture phase) before it can reach a
  // DOM listener; the keymap consults the active Scope first, so registering
  // there is the only reliable way to claim the shortcut. The embedded body
  // editor registers the same shortcut on its own Scope (see
  // embeddable-markdown-editor.ts) for when the cursor is in the note body.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const scope = new Scope(app.scope);
    scope.register(["Mod"], "s", () => !saveShortcutRef.current());

    let pushed = false;
    const push = () => {
      if (!pushed) {
        app.keymap.pushScope(scope);
        pushed = true;
      }
    };
    const pop = () => {
      if (pushed) {
        app.keymap.popScope(scope);
        pushed = false;
      }
    };
    const onFocusIn = () => push();
    const onFocusOut = (e: FocusEvent) => {
      // Pop only when focus has left the panel entirely.
      if (!root.contains(e.relatedTarget as Node | null)) pop();
    };
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    if (root.contains(root.ownerDocument.activeElement)) push();

    return () => {
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      pop();
    };
  }, [app]);

  /** Save-button label with its keyboard-shortcut hint. */
  const saveHint = `${t("task_editor.save")} (${
    Platform.isMacOS ? "⌘S" : "Ctrl+S"
  })`;

  const headerTitle =
    mode === "create"
      ? t("task_editor.create_title")
      : t("task_editor.edit_title");

  return (
    <div className="tasks-map-editor-panel" ref={rootRef}>
      <div className="tasks-map-editor-header">
        <span className="tasks-map-editor-title">{headerTitle}</span>
        <div className="tasks-map-editor-header-actions">
          <div className="tasks-map-editor-layout-toggle" role="group">
            {LAYOUT_OPTIONS.map(({ value, icon: Icon, labelKey }) => (
              <button
                key={value}
                type="button"
                className={
                  "tasks-map-editor-layout-btn" +
                  (layout === value
                    ? " tasks-map-editor-layout-btn--active"
                    : "")
                }
                onClick={() => onLayoutChange(value)}
                aria-label={t(labelKey)}
                aria-pressed={layout === value}
                title={t(labelKey)}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
          <button
            className="tasks-map-editor-close"
            onClick={onClose}
            aria-label={t("task_editor.close")}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="tasks-map-editor-body">
        {loading && (
          <div className="tasks-map-editor-message">
            {t("task_editor.loading")}
          </div>
        )}
        {!loading && loadError && (
          <div className="tasks-map-editor-message">
            {t("task_editor.load_error")}
          </div>
        )}

        {!loading && !loadError && (
          <>
            {mode === "create" && (
              <div className="tasks-map-editor-nlp">
                <textarea
                  className="tasks-map-editor-nlp-input"
                  rows={2}
                  value={nlpInput}
                  placeholder={t("task_editor.nlp_placeholder")}
                  onChange={(e) => setNlpInput(e.target.value)}
                />
                <button
                  className="tasks-map-editor-nlp-button"
                  onClick={handleParse}
                  disabled={!nlpInput.trim()}
                >
                  <Sparkles size={14} />
                  <span>{t("task_editor.nlp_parse")}</span>
                </button>
              </div>
            )}

            <div className="tasks-map-editor-layout" data-layout={layout}>
              <div className="tasks-map-editor-meta">
            <div className="tasks-map-editor-field tasks-map-editor-field--full">
              <span className="tasks-map-editor-label">
                {t("task_editor.field_title")}
              </span>
              <input
                type="text"
                className="tasks-map-editor-input"
                value={form.title}
                placeholder={t("task_editor.title_placeholder")}
                onChange={(e) => update("title", e.target.value)}
                onBlur={commitTitle}
              />
            </div>

            <div className="tasks-map-editor-field">
              <span className="tasks-map-editor-label">
                {t("task_editor.field_status")}
              </span>
              <Select<Option>
                options={statusOptions}
                value={toOption(form.status, statusOptions)}
                onChange={(opt: SingleValue<Option>) =>
                  update("status", opt?.value ?? "")
                }
                styles={selectStyles}
                menuPlacement="auto"
              />
            </div>

            <div className="tasks-map-editor-field">
              <span className="tasks-map-editor-label">
                {t("task_editor.field_priority")}
              </span>
              <Select<Option>
                options={priorityOptions}
                value={toOption(form.priority, priorityOptions)}
                onChange={(opt: SingleValue<Option>) =>
                  update("priority", opt?.value ?? "")
                }
                styles={selectStyles}
                menuPlacement="auto"
              />
            </div>

            <div className="tasks-map-editor-field">
              <span className="tasks-map-editor-label">
                {t("task_editor.field_due")}
              </span>
              <input
                type="date"
                className="tasks-map-editor-input"
                value={form.due}
                onChange={(e) => update("due", e.target.value)}
              />
            </div>
            <div className="tasks-map-editor-field">
              <span className="tasks-map-editor-label">
                {t("task_editor.field_scheduled")}
              </span>
              <input
                type="date"
                className="tasks-map-editor-input"
                value={form.scheduled}
                onChange={(e) => update("scheduled", e.target.value)}
              />
            </div>

            <div className="tasks-map-editor-field">
              <span className="tasks-map-editor-label">
                {t("task_editor.field_tags")}
              </span>
              <CreatableSelect<Option, true>
                isMulti
                options={[]}
                value={toOptions(form.tags)}
                onChange={(opts: MultiValue<Option>) =>
                  update(
                    "tags",
                    opts.map((o) => o.value)
                  )
                }
                styles={selectStyles}
                placeholder={t("task_editor.add_placeholder")}
                menuPlacement="auto"
              />
            </div>

            <div className="tasks-map-editor-field">
              <span className="tasks-map-editor-label">
                {t("task_editor.field_contexts")}
              </span>
              <CreatableSelect<Option, true>
                isMulti
                options={[]}
                value={toOptions(form.contexts)}
                onChange={(opts: MultiValue<Option>) =>
                  update(
                    "contexts",
                    opts.map((o) => o.value)
                  )
                }
                styles={selectStyles}
                placeholder={t("task_editor.add_placeholder")}
                menuPlacement="auto"
              />
            </div>

            <div className="tasks-map-editor-field">
              <span className="tasks-map-editor-label">
                {t("task_editor.field_projects")}
              </span>
              <CreatableSelect<Option, true>
                isMulti
                options={[]}
                value={toOptions(form.projects)}
                onChange={(opts: MultiValue<Option>) =>
                  update(
                    "projects",
                    opts.map((o) => o.value)
                  )
                }
                styles={selectStyles}
                placeholder={t("task_editor.add_placeholder")}
                menuPlacement="auto"
              />
            </div>

            <div className="tasks-map-editor-field">
              <span className="tasks-map-editor-label">
                {t("task_editor.field_blocked_by")}
              </span>
              <Select<Option, true>
                isMulti
                options={dependencyOptions}
                value={toOptions(form.blockedBy, dependencyLabel)}
                onChange={(opts: MultiValue<Option>) =>
                  update(
                    "blockedBy",
                    opts.map((o) => o.value)
                  )
                }
                styles={selectStyles}
                placeholder={t("task_editor.add_placeholder")}
                menuPlacement="auto"
              />
            </div>

            <div className="tasks-map-editor-field">
              <span className="tasks-map-editor-label">
                {t("task_editor.field_time_estimate")}
              </span>
              <input
                type="number"
                min={0}
                className="tasks-map-editor-input"
                value={form.timeEstimate || ""}
                onChange={(e) =>
                  update(
                    "timeEstimate",
                    Math.max(0, Math.floor(Number(e.target.value) || 0))
                  )
                }
              />
            </div>
            <div className="tasks-map-editor-field">
              <span className="tasks-map-editor-label">
                {t("task_editor.field_recurrence")}
              </span>
              <input
                type="text"
                className="tasks-map-editor-input"
                value={form.recurrence}
                placeholder="FREQ=WEEKLY"
                onChange={(e) => update("recurrence", e.target.value)}
              />
            </div>
              </div>

              <div
                className="tasks-map-editor-body-region"
                ref={(el) => {
                  if (el)
                    el.style.setProperty(
                      "--tm-body-font-size",
                      `${bodyFontSize}px`
                    );
                }}
              >
                <div className="tasks-map-editor-body-head">
                  <span className="tasks-map-editor-label">
                    {t("task_editor.field_body")}
                  </span>
                  <div className="tasks-map-editor-font-stepper">
                    <button
                      type="button"
                      className="tasks-map-editor-font-btn"
                      onClick={() => onBodyFontSizeChange(bodyFontSize - 1)}
                      disabled={bodyFontSize <= MIN_BODY_FONT}
                      aria-label={t("task_editor.body_font_smaller")}
                      title={t("task_editor.body_font_smaller")}
                    >
                      <Minus size={12} />
                    </button>
                    <ALargeSmall
                      size={14}
                      className="tasks-map-editor-font-icon"
                    />
                    <button
                      type="button"
                      className="tasks-map-editor-font-btn"
                      onClick={() => onBodyFontSizeChange(bodyFontSize + 1)}
                      disabled={bodyFontSize >= MAX_BODY_FONT}
                      aria-label={t("task_editor.body_font_larger")}
                      title={t("task_editor.body_font_larger")}
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </div>
                <MarkdownBodyEditor
                  app={app}
                  value={form.details}
                  onChange={(v) => update("details", v)}
                  filePath={mode === "edit" ? taskPath : undefined}
                  onSave={() => saveShortcutRef.current()}
                />
              </div>
            </div>
          </>
        )}
      </div>

      <div className="tasks-map-editor-footer">
        {autosave ? (
          <>
            <span
              className={
                "tasks-map-editor-autosave tasks-map-editor-autosave--" +
                saveStatus
              }
              onClick={
                saveStatus === "error" ? () => void commitChanges() : undefined
              }
              role={saveStatus === "error" ? "button" : undefined}
              title={
                saveStatus === "error"
                  ? t("task_editor.autosave_error")
                  : undefined
              }
            >
              {saveStatus === "saving" && (
                <>
                  <RefreshCw
                    size={13}
                    className="tasks-map-editor-autosave-spin"
                  />
                  <span>{t("task_editor.saving")}</span>
                </>
              )}
              {saveStatus === "saved" && (
                <>
                  <Check size={13} />
                  <span>{t("task_editor.autosave_saved")}</span>
                </>
              )}
              {saveStatus === "unsaved" && (
                <span>{t("task_editor.autosave_unsaved")}</span>
              )}
              {saveStatus === "error" && (
                <>
                  <CircleAlert size={13} />
                  <span>{t("task_editor.autosave_error")}</span>
                </>
              )}
            </span>
            <button
              className="tasks-map-editor-btn tasks-map-editor-btn--primary"
              onClick={() => void handleClose()}
            >
              {t("task_editor.done")}
            </button>
          </>
        ) : (
          <>
            <button className="tasks-map-editor-btn" onClick={onClose}>
              {t("task_editor.cancel")}
            </button>
            <button
              className="tasks-map-editor-btn tasks-map-editor-btn--primary"
              onClick={() => void handleSave()}
              disabled={!canSave}
              title={saveHint}
            >
              {saving ? t("task_editor.saving") : t("task_editor.save")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
