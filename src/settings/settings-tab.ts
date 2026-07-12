import { App, PluginSettingTab, Setting } from "obsidian";
import TasksMapPlugin from "../main";
import { TagColorPalette, getTagColorClass } from "../lib/tag-color-manager";
import {
  cloneDefaultPriorities,
  isNoPriority,
} from "../lib/priority-config";
import { taskPrioritiesFromSchemaValues } from "../lib/tasknotes-type-schema";
import { getTaskNotesConfig } from "../lib/tasknotes-bridge";
import { cloneDefaultStatuses } from "../lib/status-config";
import {
  DEFAULT_VISIBLE_ATTACHMENT_KINDS,
  NoteTaskTitleSource,
  PriorityAccentPosition,
} from "../types/settings";
import { TaskAttachmentKind } from "../types/base-task";
import { t } from "../i18n";
import { SUPPORTED_LANGUAGES } from "../i18n";

const ATTACHMENT_KIND_OPTIONS: TaskAttachmentKind[] = [
  "markdown",
  "pdf",
  "image",
  "file",
];

export class TasksMapSettingTab extends PluginSettingTab {
  plugin: TasksMapPlugin;
  private prioritySchemaDraft: string[] | null = null;
  private prioritySchemaDraftPath = "";

  constructor(app: App, plugin: TasksMapPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private getPrioritySchemaDraft(path: string, values: string[]): string[] {
    if (!this.prioritySchemaDraft || this.prioritySchemaDraftPath !== path) {
      this.prioritySchemaDraft = [...values];
      this.prioritySchemaDraftPath = path;
    }
    return this.prioritySchemaDraft;
  }

  private clearPrioritySchemaDraft(): void {
    this.prioritySchemaDraft = null;
    this.prioritySchemaDraftPath = "";
  }

  private createTagPreview(
    container: HTMLElement,
    tags: string[],
    palette: TagColorPalette
  ): void {
    container.empty();

    const previewDiv = container.createDiv({
      cls: "tasks-map-tag-preview-container",
    });

    tags.forEach((tag) => {
      previewDiv.createSpan({
        cls: `tasks-map-tag ${getTagColorClass(tag, palette)}`,
        text: tag,
      });
    });
  }

  private async setAttachmentKindVisibility(
    kind: TaskAttachmentKind,
    visible: boolean
  ): Promise<void> {
    const visibleKinds = new Set(
      this.plugin.settings.visibleAttachmentKinds ??
        DEFAULT_VISIBLE_ATTACHMENT_KINDS
    );

    if (visible) {
      visibleKinds.add(kind);
    } else {
      visibleKinds.delete(kind);
    }

    this.plugin.settings.visibleAttachmentKinds =
      ATTACHMENT_KIND_OPTIONS.filter((option) => visibleKinds.has(option));
    await this.plugin.saveSettings();
  }

  /**
   * Renders the configurable task-statuses section: an editable row per
   * status (label, color, checkbox character, frontmatter values) plus
   * add/reset actions and the "default visible statuses" toggles.
   */
  private renderTaskStatusesSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setHeading().setName(t("settings.task_statuses"));

    const desc = containerEl.createDiv({ cls: "tasks-map-preview-desc" });
    desc.textContent = t("settings.task_statuses_desc");

    const statuses = this.plugin.settings.taskStatuses;

    statuses.forEach((status, index) => {
      const setting = new Setting(containerEl).setName(
        status.label || t("settings.status_unnamed")
      );

      setting.addText((text) =>
        text
          .setPlaceholder(t("settings.status_label_placeholder"))
          .setValue(status.label)
          .onChange(async (value) => {
            status.label = value;
            await this.plugin.saveSettings();
          })
      );

      setting.addColorPicker((picker) =>
        picker.setValue(status.color).onChange(async (value) => {
          status.color = value;
          await this.plugin.saveSettings();
        })
      );

      setting.addText((text) => {
        text
          .setPlaceholder(t("settings.status_checkbox_placeholder"))
          .setValue(status.checkboxChar)
          .onChange(async (value) => {
            // Keep a single character; blank means an empty checkbox.
            status.checkboxChar = value.length > 0 ? value[0] : " ";
            await this.plugin.saveSettings();
          });
        text.inputEl.maxLength = 1;
        text.inputEl.addClass("tasks-map-status-char-input");
      });

      setting.addText((text) =>
        text
          .setPlaceholder(t("settings.status_note_values_placeholder"))
          .setValue(status.noteValues)
          .onChange(async (value) => {
            status.noteValues = value;
            await this.plugin.saveSettings();
          })
      );

      setting.addExtraButton((btn) =>
        btn
          .setIcon("trash")
          .setTooltip(t("settings.status_remove"))
          .onClick(async () => {
            statuses.splice(index, 1);
            this.plugin.settings.defaultStatusFilter =
              this.plugin.settings.defaultStatusFilter.filter(
                (id) => id !== status.id
              );
            await this.plugin.saveSettings();
            this.display();
          })
      );
    });

    new Setting(containerEl)
      .addButton((btn) =>
        btn.setButtonText(t("settings.status_add")).onClick(async () => {
          statuses.push({
            id: `status-${Date.now().toString(36)}-${Math.floor(
              Math.random() * 1296
            ).toString(36)}`,
            label: t("settings.status_new"),
            color: "#8a8a8a",
            checkboxChar: " ",
            noteValues: "",
          });
          await this.plugin.saveSettings();
          this.display();
        })
      )
      .addButton((btn) =>
        btn
          .setButtonText(t("settings.status_reset"))
          .setWarning()
          .onClick(async () => {
            this.plugin.settings.taskStatuses = cloneDefaultStatuses();
            this.plugin.settings.defaultStatusFilter = [];
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setHeading()
      .setName(t("settings.default_status_filter"));

    const filterDesc = containerEl.createDiv({
      cls: "tasks-map-preview-desc",
    });
    filterDesc.textContent = t("settings.default_status_filter_desc");

    const allIds = statuses.map((s) => s.id);
    // Reads the effective visible set live: an empty stored filter means
    // "all statuses visible".
    const effectiveVisible = (): Set<string> => {
      const stored = this.plugin.settings.defaultStatusFilter;
      return stored.length === 0 ? new Set(allIds) : new Set(stored);
    };

    statuses.forEach((status) => {
      new Setting(containerEl)
        .setName(status.label || t("settings.status_unnamed"))
        .addToggle((toggle) => {
          toggle.setValue(effectiveVisible().has(status.id));
          toggle.onChange(async (value) => {
            const visible = effectiveVisible();
            if (value) visible.add(status.id);
            else visible.delete(status.id);
            // Canonicalize "everything visible" back to an empty filter.
            this.plugin.settings.defaultStatusFilter =
              visible.size === allIds.length
                ? []
                : allIds.filter((id) => visible.has(id));
            await this.plugin.saveSettings();
          });
        });
    });
  }

  private renderTaskPrioritiesSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setHeading().setName(t("settings.task_priorities"));

    const desc = containerEl.createDiv({ cls: "tasks-map-preview-desc" });
    desc.textContent = t("settings.task_priorities_desc");

    new Setting(containerEl)
      .setName(t("settings.tasknotes_schema_use"))
      .setDesc(t("settings.tasknotes_schema_use_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useTaskNotesTypeSchema)
          .onChange(async (value) => {
            this.plugin.settings.useTaskNotesTypeSchema = value;
            await this.plugin.saveSettings();
            this.clearPrioritySchemaDraft();
            await this.plugin.refreshTaskNotesTypeSchema();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.tasknotes_schema_path"))
      .setDesc(t("settings.tasknotes_schema_path_desc"))
      .addText((text) =>
        text
          .setPlaceholder("_types/task.md")
          .setValue(this.plugin.settings.taskNotesTypeSchemaPath)
          .onChange(async (value) => {
            this.plugin.settings.taskNotesTypeSchemaPath = value;
            await this.plugin.saveSettings();
          })
      );

    const schemaState = this.plugin.getTaskNotesTypeSchemaState();
    const schemaEnabled = this.plugin.settings.useTaskNotesTypeSchema;

    new Setting(containerEl).addButton((btn) =>
      btn
        .setButtonText(t("settings.tasknotes_schema_refresh"))
        .onClick(async () => {
          this.clearPrioritySchemaDraft();
          await this.plugin.refreshTaskNotesTypeSchema();
          this.display();
        })
    );

    if (schemaEnabled && schemaState.kind !== "loaded") {
      const warning = containerEl.createDiv({
        cls: "tasks-map-preview-desc",
      });
      warning.textContent = t("settings.tasknotes_schema_warning", {
        message: schemaState.message,
      });
    }

    if (schemaEnabled && schemaState.kind === "loaded") {
      this.renderTaskNotesSchemaPriorities(containerEl, schemaState);
      return;
    }

    this.renderFallbackTaskPriorities(containerEl);
  }

  private renderTaskNotesSchemaPriorities(
    containerEl: HTMLElement,
    schemaState: Extract<
      ReturnType<TasksMapPlugin["getTaskNotesTypeSchemaState"]>,
      { kind: "loaded" }
    >
  ): void {
    const draftValues = this.getPrioritySchemaDraft(
      schemaState.path,
      schemaState.priorityValues
    );
    const catalog = getTaskNotesConfig(this.app).priorities;
    const priorities = taskPrioritiesFromSchemaValues(
      draftValues,
      catalog,
      this.plugin.settings.taskPriorityColorOverrides
    );
    const hasDraftChanges =
      draftValues.join("\n") !== schemaState.priorityValues.join("\n");

    if (hasDraftChanges) {
      const draftNotice = containerEl.createDiv({
        cls: "tasks-map-preview-desc",
      });
      draftNotice.textContent = t("settings.tasknotes_schema_unsaved");
    }

    priorities.forEach((priority, index) => {
      const setting = new Setting(containerEl).setName(
        priority.label || t("settings.priority_unnamed")
      );

      setting.addText((text) =>
        text
          .setPlaceholder(t("settings.priority_value_placeholder"))
          .setValue(priority.value)
          .onChange((value) => {
            draftValues[index] = value;
          })
      );

      setting.addColorPicker((picker) =>
        picker.setValue(priority.color).onChange(async (value) => {
          this.plugin.settings.taskPriorityColorOverrides = {
            ...this.plugin.settings.taskPriorityColorOverrides,
            [priority.value]: value,
          };
          await this.plugin.saveSettings();
        })
      );

      setting
        .addExtraButton((btn) =>
          btn
            .setIcon("arrow-up")
            .setTooltip(t("settings.priority_move_up"))
            .setDisabled(index === 0)
            .onClick(() => {
              const previous = draftValues[index - 1];
              draftValues[index - 1] = draftValues[index];
              draftValues[index] = previous;
              this.display();
            })
        )
        .addExtraButton((btn) =>
          btn
            .setIcon("arrow-down")
            .setTooltip(t("settings.priority_move_down"))
            .setDisabled(index === draftValues.length - 1)
            .onClick(() => {
              const next = draftValues[index + 1];
              draftValues[index + 1] = draftValues[index];
              draftValues[index] = next;
              this.display();
            })
        )
        .addExtraButton((btn) =>
          btn
            .setIcon("trash")
            .setTooltip(t("settings.priority_remove"))
            .onClick(() => {
              draftValues.splice(index, 1);
              this.display();
            })
        );
    });

    new Setting(containerEl)
      .addButton((btn) =>
        btn.setButtonText(t("settings.priority_add")).onClick(() => {
          draftValues.push(t("settings.priority_new_value"));
          this.display();
        })
      )
      .addButton((btn) =>
        btn
          .setButtonText(t("settings.tasknotes_schema_apply"))
          .setCta()
          .onClick(async () => {
            const written =
              await this.plugin.writeTaskNotesTypeSchemaPriorities(draftValues);
            if (written) {
              this.clearPrioritySchemaDraft();
            }
            this.display();
          })
      )
      .addButton((btn) =>
        btn.setButtonText(t("settings.tasknotes_schema_discard")).onClick(() => {
          this.clearPrioritySchemaDraft();
          this.display();
        })
      );
  }

  private renderFallbackTaskPriorities(containerEl: HTMLElement): void {
    const priorities = this.plugin.settings.taskPriorities;

    priorities.forEach((priority, index) => {
      const isNonePriority =
        priority.id === "none" || isNoPriority(priority.value);
      const setting = new Setting(containerEl).setName(
        priority.label || t("settings.priority_unnamed")
      );

      setting.addText((text) =>
        text
          .setPlaceholder(t("settings.priority_label_placeholder"))
          .setValue(priority.label)
          .onChange(async (value) => {
            priority.label = value;
            await this.plugin.saveSettings();
          })
      );

      setting.addText((text) => {
        text
          .setPlaceholder(t("settings.priority_value_placeholder"))
          .setValue(priority.value)
          .onChange(async (value) => {
            priority.value = isNonePriority ? "" : value;
            await this.plugin.saveSettings();
          });
        if (isNonePriority) text.setDisabled(true);
      });

      setting.addColorPicker((picker) =>
        picker.setValue(priority.color).onChange(async (value) => {
          priority.color = value;
          await this.plugin.saveSettings();
        })
      );

      setting.addText((text) =>
        text
          .setPlaceholder(t("settings.priority_weight_placeholder"))
          .setValue(String(priority.weight))
          .onChange(async (value) => {
            priority.weight = parseInt(value, 10) || 0;
            await this.plugin.saveSettings();
          })
      );

      if (!isNonePriority) {
        setting.addExtraButton((btn) =>
          btn
            .setIcon("trash")
            .setTooltip(t("settings.priority_remove"))
            .onClick(async () => {
              priorities.splice(index, 1);
              await this.plugin.saveSettings();
              this.display();
            })
        );
      }
    });

    new Setting(containerEl)
      .addButton((btn) =>
        btn.setButtonText(t("settings.priority_add")).onClick(async () => {
          const nextWeight =
            priorities.reduce(
              (max, priority) => Math.max(max, priority.weight),
              0
            ) + 1;
          priorities.push({
            id: `priority-${Date.now().toString(36)}-${Math.floor(
              Math.random() * 1296
            ).toString(36)}`,
            value: t("settings.priority_new_value"),
            label: t("settings.priority_new"),
            color: "#8a8a8a",
            weight: nextWeight,
          });
          await this.plugin.saveSettings();
          this.display();
        })
      )
      .addButton((btn) =>
        btn
          .setButtonText(t("settings.priority_reset"))
          .setWarning()
          .onClick(async () => {
            this.plugin.settings.taskPriorities = cloneDefaultPriorities();
            await this.plugin.saveSettings();
            this.display();
          })
      );
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName(t("settings.language"))
      .setDesc(t("settings.language_desc"))
      .addDropdown((dropdown) => {
        SUPPORTED_LANGUAGES.forEach((lang) => {
          dropdown.addOption(lang.value, lang.label);
        });
        dropdown
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value as "en" | "nl" | "zh-CN";
            await this.plugin.saveSettings();
            // Redraw the settings tab with new language
            this.display();
          });
      });

    new Setting(containerEl)
      .setHeading()
      .setName(t("settings.display_options"));

    new Setting(containerEl)
      .setName(t("settings.show_task_priorities"))
      .setDesc(t("settings.show_task_priorities_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showPriorities)
          .onChange(async (value) => {
            this.plugin.settings.showPriorities = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.priority_accent_position"))
      .setDesc(t("settings.priority_accent_position_desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("top", t("settings.priority_accent_top"))
          .addOption("right", t("settings.priority_accent_right"))
          .setValue(this.plugin.settings.priorityAccentPosition)
          .onChange(async (value) => {
            this.plugin.settings.priorityAccentPosition =
              value as PriorityAccentPosition;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.show_task_tags"))
      .setDesc(t("settings.show_task_tags_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showTags)
          .onChange(async (value) => {
            this.plugin.settings.showTags = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.show_status_counts"))
      .setDesc(t("settings.show_status_counts_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showStatusCounts)
          .onChange(async (value) => {
            this.plugin.settings.showStatusCounts = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setHeading()
      .setName(t("settings.attachment_types"));

    const visibleAttachmentKinds = new Set(
      this.plugin.settings.visibleAttachmentKinds ??
        DEFAULT_VISIBLE_ATTACHMENT_KINDS
    );

    ATTACHMENT_KIND_OPTIONS.forEach((kind) => {
      new Setting(containerEl)
        .setName(t(`settings.attachment_type_${kind}`))
        .setDesc(t(`settings.attachment_type_${kind}_desc`))
        .addToggle((toggle) =>
          toggle
            .setValue(visibleAttachmentKinds.has(kind))
            .onChange(async (value) => {
              await this.setAttachmentKindVisibility(kind, value);
            })
        );
    });

    new Setting(containerEl)
      .setName(t("settings.editor_autosave"))
      .setDesc(t("settings.editor_autosave_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.editorAutosave)
          .onChange(async (value) => {
            this.plugin.settings.editorAutosave = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setHeading().setName(t("settings.layout"));

    new Setting(containerEl)
      .setName(t("settings.layout_direction"))
      .setDesc(t("settings.layout_direction_desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("Horizontal", t("settings.layout_horizontal"))
          .addOption("Vertical", t("settings.layout_vertical"))
          .setValue(this.plugin.settings.layoutDirection)
          .onChange(async (value) => {
            this.plugin.settings.layoutDirection = value as
              | "Horizontal"
              | "Vertical";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.edge_style"))
      .setDesc(t("settings.edge_style_desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("Bezier", t("settings.edge_style_bezier"))
          .addOption("Straight", t("settings.edge_style_straight"))
          .addOption("SmoothStep", t("settings.edge_style_smoothstep"))
          .setValue(this.plugin.settings.edgeStyle)
          .onChange(async (value) => {
            this.plugin.settings.edgeStyle = value as
              | "Bezier"
              | "Straight"
              | "SmoothStep";
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.edgeStyle === "SmoothStep") {
      new Setting(containerEl)
        .setName(t("settings.smooth_step_radius"))
        .setDesc(t("settings.smooth_step_radius_desc"))
        .addText((text) =>
          text
            .setPlaceholder("5")
            .setValue(this.plugin.settings.smoothStepRadius.toString())
            .onChange(async (value) => {
              const radius = Math.max(0, parseInt(value) || 0);
              this.plugin.settings.smoothStepRadius = radius;
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName(t("settings.sidebar_width"))
      .setDesc(t("settings.sidebar_width_desc"))
      .addSlider((slider) =>
        slider
          .setLimits(180, 600, 10)
          .setValue(this.plugin.settings.sidebarWidth)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.sidebarWidth = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setHeading().setName(t("settings.tag_appearance"));

    new Setting(containerEl)
      .setName(t("settings.tag_color_palette"))
      .setDesc(t("settings.tag_color_palette_desc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("rainbow", t("settings.palette_rainbow"))
          .addOption("ocean", t("settings.palette_ocean"))
          .addOption("forest", t("settings.palette_forest"))
          .addOption("sunset", t("settings.palette_sunset"))
          .addOption("mono", t("settings.palette_mono"))
          .setValue(this.plugin.settings.tagColorPalette)
          .onChange(async (value) => {
            this.plugin.settings.tagColorPalette = value as TagColorPalette;
            await this.plugin.saveSettings();
            this.createTagPreview(
              tagPreviewContainer,
              ["priority", "bug", "feature", "docs", "blocked"],
              value as TagColorPalette
            );
          });
      });

    const tagPreviewContainer = containerEl.createDiv();
    this.createTagPreview(
      tagPreviewContainer,
      ["priority", "bug", "feature", "docs", "blocked"],
      this.plugin.settings.tagColorPalette
    );

    this.renderTaskStatusesSection(containerEl);
    this.renderTaskPrioritiesSection(containerEl);

    new Setting(containerEl)
      .setHeading()
      .setName(t("settings.simple_task_relations"));

    new Setting(containerEl)
      .setName(t("settings.linking_style"))
      .setDesc(t("settings.linking_style_desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("csv", t("settings.linking_csv"))
          .addOption("individual", t("settings.linking_individual"))
          .addOption("dataview", t("settings.linking_dataview"))
          .setValue(this.plugin.settings.linkingStyle)
          .onChange(async (value) => {
            this.plugin.settings.linkingStyle = value as
              | "individual"
              | "csv"
              | "dataview";
            await this.plugin.saveSettings();
            updatePreview(value as "individual" | "csv" | "dataview");
          })
      );

    // Create preview container
    const previewContainer = containerEl.createDiv();
    previewContainer.addClass("tasks-map-preview-container");

    const updatePreview = (style: "individual" | "csv" | "dataview") => {
      previewContainer.empty();

      if (style === "individual") {
        const title = previewContainer.createDiv({
          cls: "tasks-map-preview-title",
        });
        title.textContent = t("settings.linking_individual_title");

        const desc = previewContainer.createDiv({
          cls: "tasks-map-preview-desc",
        });
        desc.textContent = t("settings.linking_individual_desc");

        const example = previewContainer.createDiv({
          cls: "tasks-map-preview-example",
        });
        example.textContent = t("settings.linking_individual_example");
      } else if (style === "dataview") {
        const title = previewContainer.createDiv({
          cls: "tasks-map-preview-title",
        });
        title.textContent = t("settings.linking_dataview_title");

        const desc = previewContainer.createDiv({
          cls: "tasks-map-preview-desc",
        });
        desc.textContent = t("settings.linking_dataview_desc");

        const example = previewContainer.createDiv({
          cls: "tasks-map-preview-example",
        });
        example.textContent = t("settings.linking_dataview_example");
      } else {
        const title = previewContainer.createDiv({
          cls: "tasks-map-preview-title",
        });
        title.textContent = t("settings.linking_csv_title");

        const desc = previewContainer.createDiv({
          cls: "tasks-map-preview-desc",
        });
        desc.textContent = t("settings.linking_csv_desc");

        const example = previewContainer.createDiv({
          cls: "tasks-map-preview-example",
        });
        example.textContent = t("settings.linking_csv_example");
      }
    };

    // Initialize preview
    updatePreview(this.plugin.settings.linkingStyle);

    new Setting(containerEl).setHeading().setName(t("settings.note_tasks"));

    new Setting(containerEl)
      .setName(t("settings.note_task_property_name"))
      .setDesc(t("settings.note_task_property_name_desc"))
      .addText((text) =>
        text
          .setPlaceholder("tags")
          .setValue(this.plugin.settings.noteTaskPropertyName)
          .onChange(async (value) => {
            this.plugin.settings.noteTaskPropertyName = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.note_task_property_value"))
      .setDesc(t("settings.note_task_property_value_desc"))
      .addText((text) =>
        text
          .setPlaceholder("task, project")
          .setValue(this.plugin.settings.noteTaskPropertyValue)
          .onChange(async (value) => {
            this.plugin.settings.noteTaskPropertyValue = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.note_task_title_source"))
      .setDesc(t("settings.note_task_title_source_desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption(
            "filename",
            t("settings.note_task_title_source_filename")
          )
          .addOption(
            "frontmatter",
            t("settings.note_task_title_source_frontmatter")
          )
          .setValue(this.plugin.settings.noteTaskTitleSource)
          .onChange(async (value) => {
            this.plugin.settings.noteTaskTitleSource =
              value as NoteTaskTitleSource;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.noteTaskTitleSource === "frontmatter") {
      new Setting(containerEl)
        .setName(t("settings.note_task_title_property"))
        .setDesc(t("settings.note_task_title_property_desc"))
        .addText((text) =>
          text
            .setPlaceholder("title")
            .setValue(this.plugin.settings.noteTaskTitleProperty)
            .onChange(async (value) => {
              this.plugin.settings.noteTaskTitleProperty = value.trim();
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName(t("settings.note_task_date_prefix"))
      .setDesc(t("settings.note_task_date_prefix_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.noteTaskDatePrefixEnabled)
          .onChange(async (value) => {
            this.plugin.settings.noteTaskDatePrefixEnabled = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.noteTaskDatePrefixEnabled) {
      new Setting(containerEl)
        .setName(t("settings.note_task_created_date_property"))
        .setDesc(t("settings.note_task_created_date_property_desc"))
        .addText((text) =>
          text
            .setPlaceholder("dateCreated")
            .setValue(this.plugin.settings.noteTaskCreatedDateProperty)
            .onChange(async (value) => {
              this.plugin.settings.noteTaskCreatedDateProperty = value.trim();
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName(t("settings.note_dependency_property"))
      .setDesc(t("settings.note_dependency_property_desc"))
      .addText((text) =>
        text
          .setPlaceholder("blockedBy")
          .setValue(this.plugin.settings.noteDependencyProperty)
          .onChange(async (value) => {
            this.plugin.settings.noteDependencyProperty = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setHeading()
      .setName(t("settings.advanced_options"));

    new Setting(containerEl)
      .setName(t("settings.debug_visualization"))
      .setDesc(t("settings.debug_visualization_desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debugVisualization)
          .onChange(async (value) => {
            this.plugin.settings.debugVisualization = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
