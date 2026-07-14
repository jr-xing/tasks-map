import React from "react";
import {
  WorkspaceLeaf,
  Plugin,
  TFile,
  FuzzySuggestModal,
  MarkdownRenderChild,
  Notice,
} from "obsidian";
import type { FuzzyMatch, TAbstractFile } from "obsidian";
import { createRoot } from "react-dom/client";

import TaskMapGraphItemView, { VIEW_TYPE } from "./views/TaskMapGraphItemView";
import TaskMapGraphEmbedView, {
  TaskMapEmbedError,
  filterStateFromSource,
} from "./views/TaskMapGraphEmbedView";
import {
  TasksMapSettings,
  DEFAULT_SETTINGS,
  FilterPreset,
} from "./types/settings";
import { TasksMapSettingTab } from "./settings/settings-tab";
import { initI18n, changeLanguage, t } from "./i18n";
import {
  FilterState,
  DEFAULT_FILTER_STATE,
  createDefaultFilterState,
} from "./types/filter-state";
import { EmbedConfig, DEFAULT_EMBED_CONFIG } from "./types/embed-config";
import { TaskMapFocusRequest } from "./types/focus-request";
import {
  TaskPriorityConfig,
  cloneDefaultPriorities,
  resolveTaskPriorities,
} from "./lib/priority-config";
import {
  TaskNotesTypeSchemaReadResult,
  normalizeTaskNotesTypeSchemaPath,
  readTaskNotesTypeSchema,
  taskPrioritiesFromSchemaValues,
  writeTaskNotesTypeSchemaPriorityValues,
} from "./lib/tasknotes-type-schema";
import { checkDataviewPlugin, getAllTasks } from "./lib/utils";
import {
  buildTaskFocusCandidates,
  TaskFocusCandidate,
} from "./lib/task-focus-picker";

const EMBED_CODE_BLOCK = "tasks-map";

class NoteSuggestModal extends FuzzySuggestModal<TFile> {
  private onChoose: (_file: TFile) => void;

  constructor(
    app: InstanceType<typeof Plugin>["app"],
    onChoose: (_file: TFile) => void
  ) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder(t("embed.pick_note_placeholder"));
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}

class TaskFocusSuggestModal extends FuzzySuggestModal<TaskFocusCandidate> {
  private items: TaskFocusCandidate[];
  private onChoose: (_item: TaskFocusCandidate) => void;

  constructor(
    app: InstanceType<typeof Plugin>["app"],
    items: TaskFocusCandidate[],
    onChoose: (_item: TaskFocusCandidate) => void
  ) {
    super(app);
    this.items = items;
    this.onChoose = onChoose;
    this.setPlaceholder(t("focus_picker.placeholder"));
  }

  getItems(): TaskFocusCandidate[] {
    return this.items;
  }

  getItemText(item: TaskFocusCandidate): string {
    return item.searchText;
  }

  renderSuggestion(
    match: FuzzyMatch<TaskFocusCandidate>,
    el: HTMLElement
  ): void {
    const item = match.item;
    el.classList.add("tasks-map-focus-suggestion");

    const header = el.createDiv("tasks-map-focus-suggestion__header");
    header.style.paddingLeft = `${item.depth * 14}px`;
    header.createSpan({
      cls: "tasks-map-focus-suggestion__label",
      text: item.label,
    });
    header.createSpan({
      cls: "tasks-map-focus-suggestion__type",
      text: t("focus_picker.task"),
    });

    const detail = el.createDiv("tasks-map-focus-suggestion__detail");
    detail.style.paddingLeft = `${item.depth * 14}px`;

    const path = item.path.slice(0, -1).join(" / ");
    const metadata =
      path ||
      (item.projects.length > 0
        ? item.projects.join(", ")
        : item.tags.slice(0, 3).join(", "));
    detail.setText(metadata || item.link);
  }

  onChooseItem(item: TaskFocusCandidate): void {
    this.onChoose(item);
  }
}

function normalizeFilterPreset(preset: FilterPreset): FilterPreset {
  return {
    ...preset,
    filter: {
      ...DEFAULT_FILTER_STATE,
      ...preset.filter,
    },
  };
}

export type TaskNotesTypeSchemaState =
  | { kind: "disabled"; path: string; message: string }
  | TaskNotesTypeSchemaReadResult
  | { kind: "write-error"; path: string; message: string };

export default class TasksMapPlugin extends Plugin {
  settings: TasksMapSettings = {
    ...DEFAULT_SETTINGS,
    filterPresets: [...DEFAULT_SETTINGS.filterPresets],
    taskPriorities: cloneDefaultPriorities(),
    taskPriorityColorOverrides: {
      ...DEFAULT_SETTINGS.taskPriorityColorOverrides,
    },
    visibleAttachmentKinds: [...DEFAULT_SETTINGS.visibleAttachmentKinds],
  };
  private taskNotesTypeSchemaState: TaskNotesTypeSchemaState = {
    kind: "disabled",
    path: DEFAULT_SETTINGS.taskNotesTypeSchemaPath,
    message: "TaskNotes type schema sync is disabled.",
  };
  private taskNotesTypeSchemaRefreshTimer: number | null = null;

  async onload() {
    // Load settings
    await this.loadSettings();

    // Initialize i18n with saved language
    await initI18n(this.settings.language);
    await this.refreshTaskNotesTypeSchema({ notify: false });
    this.registerTaskNotesTypeSchemaEvents();

    // Always register the view - it will handle the Dataview check internally
    this.registerView(
      VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new TaskMapGraphItemView(leaf, this)
    );

    this.addSettingTab(new TasksMapSettingTab(this.app, this));

    this.addCommand({
      id: "open-tasks-map-view",
      name: t("commands.open_map_view"),
      callback: () => {
        void this.activateViewInMainArea();
      },
    });

    this.addCommand({
      id: "focus-project-or-task",
      name: t("commands.focus_project_or_task"),
      callback: () => {
        this.openFocusPicker();
      },
    });

    this.addCommand({
      id: "insert-filter-as-code-block",
      name: t("commands.insert_filter_as_code_block"),
      callback: () => {
        this.insertFilterIntoActiveNote(null);
      },
    });

    this.addRibbonIcon("map", t("ribbon.open_tasks_map"), () => {
      void this.activateViewInMainArea();
    });

    // Register the tasks-map fenced code block processor
    this.registerMarkdownCodeBlockProcessor(
      EMBED_CODE_BLOCK,
      (source, el, ctx) => {
        const dataviewCheck = checkDataviewPlugin(this.app);

        const root = createRoot(el);

        // Register cleanup via MarkdownRenderChild so the root is unmounted
        // when the embed is removed or the preview re-renders
        const child = new MarkdownRenderChild(el);
        child.onunload = () => root.unmount();
        ctx.addChild(child);

        if (!dataviewCheck.isReady) {
          root.render(
            <TaskMapEmbedError message={t("embed.dataview_required")} />
          );
          return;
        }

        const parsed = filterStateFromSource(source);

        if (parsed.kind === "invalid") {
          root.render(<TaskMapEmbedError message={t("embed.invalid_json")} />);
          return;
        }

        if (parsed.kind === "legacy") {
          root.render(<TaskMapEmbedError message={t("embed.legacy_format")} />);
          return;
        }

        root.render(
          <TaskMapGraphEmbedView
            plugin={this}
            initialFilter={parsed.filter}
            embedConfig={parsed.config}
          />
        );
      }
    );
  }

  async loadSettings() {
    const loadedSettings =
      ((await this.loadData()) as Partial<TasksMapSettings> | null) ?? {};
    const filterPresets = loadedSettings.filterPresets ?? [
      ...DEFAULT_SETTINGS.filterPresets,
    ];
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loadedSettings,
      filterPresets: filterPresets.map(normalizeFilterPreset),
      taskPriorities: resolveTaskPriorities(loadedSettings.taskPriorities),
      taskPriorityColorOverrides: {
        ...DEFAULT_SETTINGS.taskPriorityColorOverrides,
        ...(loadedSettings.taskPriorityColorOverrides ?? {}),
      },
      taskNotesTypeSchemaPath: normalizeTaskNotesTypeSchemaPath(
        loadedSettings.taskNotesTypeSchemaPath ??
          DEFAULT_SETTINGS.taskNotesTypeSchemaPath
      ),
      visibleAttachmentKinds: loadedSettings.visibleAttachmentKinds ?? [
        ...DEFAULT_SETTINGS.visibleAttachmentKinds,
      ],
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Update language when settings change
    changeLanguage(this.settings.language);
    // Notify open views of settings change
    window.dispatchEvent(new Event("tasks-map:settings-changed"));
  }

  /** Apply a partial settings patch and persist it. */
  async updateSettings(patch: Partial<TasksMapSettings>): Promise<void> {
    Object.assign(this.settings, patch);
    await this.saveSettings();
  }

  getTaskNotesTypeSchemaState(): TaskNotesTypeSchemaState {
    return this.taskNotesTypeSchemaState;
  }

  getTaskPriorityOptions(
    taskNotesCatalog: TaskPriorityConfig[] = []
  ): TaskPriorityConfig[] {
    if (
      this.settings.useTaskNotesTypeSchema &&
      this.taskNotesTypeSchemaState.kind === "loaded"
    ) {
      return taskPrioritiesFromSchemaValues(
        this.taskNotesTypeSchemaState.priorityValues,
        taskNotesCatalog,
        this.settings.taskPriorityColorOverrides
      );
    }
    return this.settings.taskPriorities;
  }

  async refreshTaskNotesTypeSchema({
    notify = true,
  }: {
    notify?: boolean;
  } = {}): Promise<TaskNotesTypeSchemaState> {
    const path = normalizeTaskNotesTypeSchemaPath(
      this.settings.taskNotesTypeSchemaPath
    );
    this.settings.taskNotesTypeSchemaPath = path;

    if (!this.settings.useTaskNotesTypeSchema) {
      this.taskNotesTypeSchemaState = {
        kind: "disabled",
        path,
        message: "TaskNotes type schema sync is disabled.",
      };
    } else {
      this.taskNotesTypeSchemaState = await readTaskNotesTypeSchema(
        this.app.vault,
        path
      );
    }

    if (notify) {
      window.dispatchEvent(new Event("tasks-map:settings-changed"));
    }
    return this.taskNotesTypeSchemaState;
  }

  async writeTaskNotesTypeSchemaPriorities(
    values: string[]
  ): Promise<boolean> {
    const priorityValues = values
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (priorityValues.length === 0) {
      new Notice(t("settings.tasknotes_schema_write_empty"));
      return false;
    }

    const result = await writeTaskNotesTypeSchemaPriorityValues(
      this.app.vault,
      this.settings.taskNotesTypeSchemaPath,
      priorityValues
    );
    if (result.kind !== "written") {
      this.taskNotesTypeSchemaState = {
        kind: result.kind === "error" ? "write-error" : result.kind,
        path: result.path,
        message: result.message,
      };
      new Notice(t("settings.tasknotes_schema_write_failed"));
      window.dispatchEvent(new Event("tasks-map:settings-changed"));
      return false;
    }

    await this.refreshTaskNotesTypeSchema({ notify: true });
    return true;
  }

  private registerTaskNotesTypeSchemaEvents(): void {
    const onPathChange = (path: string) => {
      if (!this.settings.useTaskNotesTypeSchema) return;
      if (
        normalizeTaskNotesTypeSchemaPath(path) !==
        normalizeTaskNotesTypeSchemaPath(this.settings.taskNotesTypeSchemaPath)
      ) {
        return;
      }
      this.scheduleTaskNotesTypeSchemaRefresh();
    };

    this.registerEvent(
      this.app.vault.on("modify", (file: TAbstractFile) =>
        onPathChange(file.path)
      )
    );
    this.registerEvent(
      this.app.vault.on("create", (file: TAbstractFile) =>
        onPathChange(file.path)
      )
    );
    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) =>
        onPathChange(file.path)
      )
    );
    this.registerEvent(
      this.app.vault.on(
        "rename",
        (file: TAbstractFile, oldPath: string) => {
          onPathChange(file.path);
          onPathChange(oldPath);
        }
      )
    );
  }

  private scheduleTaskNotesTypeSchemaRefresh(): void {
    if (this.taskNotesTypeSchemaRefreshTimer !== null) {
      window.clearTimeout(this.taskNotesTypeSchemaRefreshTimer);
    }
    this.taskNotesTypeSchemaRefreshTimer = window.setTimeout(() => {
      this.taskNotesTypeSchemaRefreshTimer = null;
      void this.refreshTaskNotesTypeSchema({ notify: true });
    }, 250);
  }

  async savePreset(name: string, filter: FilterState): Promise<void> {
    const preset: FilterPreset = {
      id: crypto.randomUUID(),
      name: name.trim(),
      filter,
    };
    this.settings.filterPresets = [...this.settings.filterPresets, preset];
    await this.saveSettings();
  }

  async renamePreset(id: string, name: string): Promise<void> {
    this.settings.filterPresets = this.settings.filterPresets.map((p) =>
      p.id === id ? { ...p, name: name.trim() } : p
    );
    await this.saveSettings();
  }

  async deletePreset(id: string): Promise<void> {
    this.settings.filterPresets = this.settings.filterPresets.filter(
      (p) => p.id !== id
    );
    await this.saveSettings();
  }

  insertPresetIntoNote(preset: FilterPreset): void {
    new NoteSuggestModal(this.app, (file) => {
      void this.appendCodeBlockToFile(
        file,
        preset.filter,
        DEFAULT_EMBED_CONFIG
      );
    }).open();
  }

  insertFilterIntoActiveNote(filter: FilterState | null): void {
    const activeFile = this.app.workspace.getActiveFile();
    const filterToInsert = filter ?? this.getCurrentFilterState();

    if (activeFile) {
      void this.appendCodeBlockToFile(
        activeFile,
        filterToInsert,
        DEFAULT_EMBED_CONFIG
      );
    } else {
      new NoteSuggestModal(this.app, (file) => {
        void this.appendCodeBlockToFile(
          file,
          filterToInsert,
          DEFAULT_EMBED_CONFIG
        );
      }).open();
    }
  }

  private openFocusPicker(): void {
    const baseFilter = this.getFocusBaseFilter();
    const tasks = getAllTasks(
      this.app,
      {
        noteTaskPropertyName: this.settings.noteTaskPropertyName,
        noteTaskPropertyValue: this.settings.noteTaskPropertyValue,
        noteTaskTitleSource: this.settings.noteTaskTitleSource,
        noteTaskTitleProperty: this.settings.noteTaskTitleProperty,
        noteTaskDatePrefixEnabled: this.settings.noteTaskDatePrefixEnabled,
        noteTaskCreatedDateProperty:
          this.settings.noteTaskCreatedDateProperty,
        quickCommentsPropertyName: this.settings.quickCommentsPropertyName,
        noteDependencyProperty: this.settings.noteDependencyProperty,
      },
      this.settings.taskStatuses
    );
    const items = buildTaskFocusCandidates(tasks, baseFilter);
    if (items.length === 0) {
      new Notice(t("focus_picker.no_items"));
      return;
    }

    new TaskFocusSuggestModal(this.app, items, (item) => {
      void this.activateViewInMainArea({
        kind: "task",
        taskId: item.taskId,
        baseFilter,
      });
    }).open();
  }

  private getDefaultFilterState(): FilterState {
    return createDefaultFilterState(this.settings.defaultStatusFilter);
  }

  private getFocusBaseFilter(): FilterState {
    const leaf = this.app.workspace
      .getLeavesOfType(VIEW_TYPE)
      .find((candidate) => candidate.view instanceof TaskMapGraphItemView);
    if (leaf?.view instanceof TaskMapGraphItemView) {
      return leaf.view.getFilterState();
    }
    return this.getDefaultFilterState();
  }

  private getCurrentFilterState(): FilterState {
    const leaf = this.app.workspace.getMostRecentLeaf();
    if (leaf?.view instanceof TaskMapGraphItemView) {
      return leaf.view.getFilterState();
    }
    // Fall back to an empty filter if no active Tasks Map view is found
    return this.getDefaultFilterState();
  }

  private async appendCodeBlockToFile(
    file: TFile,
    filter: FilterState,
    config: EmbedConfig
  ): Promise<void> {
    const payload = JSON.stringify({ filter, config }, null, 2);
    const block = `\n\`\`\`${EMBED_CODE_BLOCK}\n${payload}\n\`\`\`\n`;
    await this.app.vault.process(file, (content) => content + block);
  }

  async activateViewInMainArea(focusRequest?: TaskMapFocusRequest) {
    const existingLeaf = focusRequest
      ? this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]
      : null;
    const leaf = existingLeaf ?? this.app.workspace.getLeaf(true); // true = main area
    if (!existingLeaf) {
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    void this.app.workspace.revealLeaf(leaf);
    if (focusRequest && leaf.view instanceof TaskMapGraphItemView) {
      leaf.view.focus(focusRequest);
    }
  }

  onunload(): void {
    // Embed roots are cleaned up individually via MarkdownRenderChild
  }
}
