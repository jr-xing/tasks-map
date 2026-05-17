import React, { useEffect, useMemo, useState } from "react";
import { App } from "obsidian";
import Select, { type MultiValue, type SingleValue } from "react-select";
import CreatableSelect from "react-select/creatable";
import { Sparkles, X } from "lucide-react";
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

interface TaskEditorPanelProps {
  app: App;
  mode: "create" | "edit";
  /** Path of the task being edited (edit mode only). */
  taskPath?: string;
  /** Note tasks available as dependency targets. */
  availableTasks: BaseTask[];
  onClose: () => void;
  onSaved: () => void;
}

/** Default reltype for dependencies created through the panel. */
const DEFAULT_RELTYPE = "FINISHTOSTART";

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
  onClose,
  onSaved,
}: TaskEditorPanelProps) {
  const config = useMemo(() => getTaskNotesConfig(app), [app]);
  const selectStyles = useMemo(() => obsidianSelectStyles<Option>(), []);

  const [form, setForm] = useState<TaskFormValues>(() => emptyTaskForm(config));
  const [originalTask, setOriginalTask] = useState<TaskNotesTaskInfo | null>(
    null
  );
  const [loading, setLoading] = useState(mode === "edit");
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nlpInput, setNlpInput] = useState("");

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
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [app, mode, taskPath]);

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

  async function handleSave() {
    if (!form.title.trim() || saving) return;
    setSaving(true);
    const payload = formToPayload(form);
    let ok = false;
    if (mode === "create") {
      ok = (await createTaskNotesTask(app, payload)) !== null;
    } else if (originalTask) {
      ok = (await updateTaskNotesTask(app, originalTask, payload)) !== null;
    }
    setSaving(false);
    if (ok) {
      onSaved();
      onClose();
    }
  }

  const headerTitle =
    mode === "create"
      ? t("task_editor.create_title")
      : t("task_editor.edit_title");

  return (
    <div className="tasks-map-editor-panel">
      <div className="tasks-map-editor-header">
        <span className="tasks-map-editor-title">{headerTitle}</span>
        <button
          className="tasks-map-editor-close"
          onClick={onClose}
          aria-label={t("task_editor.close")}
        >
          <X size={16} />
        </button>
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

            <div className="tasks-map-editor-field">
              <span className="tasks-map-editor-label">
                {t("task_editor.field_title")}
              </span>
              <input
                type="text"
                className="tasks-map-editor-input"
                value={form.title}
                placeholder={t("task_editor.title_placeholder")}
                onChange={(e) => update("title", e.target.value)}
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

            <div className="tasks-map-editor-row">
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

            <div className="tasks-map-editor-row">
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

            <div className="tasks-map-editor-field">
              <span className="tasks-map-editor-label">
                {t("task_editor.field_body")}
              </span>
              <MarkdownBodyEditor
                app={app}
                value={form.details}
                onChange={(v) => update("details", v)}
                filePath={mode === "edit" ? taskPath : undefined}
              />
            </div>
          </>
        )}
      </div>

      <div className="tasks-map-editor-footer">
        <button className="tasks-map-editor-btn" onClick={onClose}>
          {t("task_editor.cancel")}
        </button>
        <button
          className="tasks-map-editor-btn tasks-map-editor-btn--primary"
          onClick={() => void handleSave()}
          disabled={loading || loadError || saving || !form.title.trim()}
        >
          {saving ? t("task_editor.saving") : t("task_editor.save")}
        </button>
      </div>
    </div>
  );
}
