import { App, FuzzySuggestModal, Notice } from "obsidian";
import type { FuzzyMatch } from "obsidian";
import { TaskFocusCandidate } from "./task-focus-picker";
import { canOpenPickerProjects, ProjectRootOption } from "./project-navigation";
import { t } from "../i18n";

const NEW_TAB_KEY_LABEL = "Ctrl/Cmd+Enter";

/** True when a pick event carries the Ctrl/Cmd "open in new tab" modifier. */
export function wantsNewTab(
  evt: Pick<MouseEvent | KeyboardEvent, "ctrlKey" | "metaKey"> | undefined
): boolean {
  return !!evt && (evt.ctrlKey || evt.metaKey);
}

export class TaskFocusSuggestModal extends FuzzySuggestModal<TaskFocusCandidate> {
  private chooseProject = false;
  private forceNewTab = false;
  private items: TaskFocusCandidate[];
  private projects: Map<string, ProjectRootOption[]>;
  private onChoose: (_item: TaskFocusCandidate, _newTab: boolean) => void;
  private onProject: (_item: TaskFocusCandidate, _query: string) => void;
  private initialQuery: string;
  private newTabOnEnter: boolean;

  constructor(
    app: App,
    items: TaskFocusCandidate[],
    projects: Map<string, ProjectRootOption[]>,
    onChoose: (_item: TaskFocusCandidate, _newTab: boolean) => void,
    onProject: (_item: TaskFocusCandidate, _query: string) => void,
    initialQuery = "",
    overviewOnEnter = false,
    newTabOnEnter = false
  ) {
    super(app);
    this.items = items;
    this.projects = projects;
    this.onChoose = onChoose;
    this.onProject = onProject;
    this.initialQuery = initialQuery;
    this.newTabOnEnter = newTabOnEnter;
    this.setPlaceholder(t("focus_picker.placeholder"));
    const enterPurpose = t(
      overviewOnEnter ? "project_overview.show" : "project_overview.focus_task"
    );
    this.setInstructions([
      { command: "↑ ↓", purpose: t("project_overview.navigate") },
      {
        command: "Enter",
        purpose: newTabOnEnter
          ? `${enterPurpose} · ${t("project_overview.open_in_new_tab")}`
          : enterPurpose,
      },
      ...(newTabOnEnter
        ? []
        : [
            {
              command: NEW_TAB_KEY_LABEL,
              purpose: t("project_overview.open_in_new_tab"),
            },
          ]),
      { command: "→", purpose: t("project_overview.projects") },
    ]);
    this.scope.register([], "ArrowRight", (event) => {
      if (!canOpenPickerProjects(event, this.inputEl)) return;
      this.chooseProject = true;
      this.selectActiveSuggestion(event);
      this.chooseProject = false;
      return false;
    });
    this.scope.register(["Mod"], "Enter", (event) => {
      this.forceNewTab = true;
      this.selectActiveSuggestion(event);
      this.forceNewTab = false;
      return false;
    });
  }

  onOpen() {
    super.onOpen();
    this.inputEl.value = this.initialQuery;
    this.inputEl.trigger("input");
    this.inputEl.setSelectionRange(
      this.initialQuery.length,
      this.initialQuery.length
    );
  }

  getItems() {
    return this.items;
  }
  getItemText(item: TaskFocusCandidate) {
    return item.searchText;
  }

  renderSuggestion(match: FuzzyMatch<TaskFocusCandidate>, el: HTMLElement) {
    const item = match.item;
    el.addClass("tasks-map-focus-suggestion");
    const header = el.createDiv("tasks-map-focus-suggestion__header");
    header.createSpan({
      cls: "tasks-map-focus-suggestion__label",
      text: item.label,
    });
    header.createSpan({
      cls: "tasks-map-focus-suggestion__type",
      text: t("focus_picker.task"),
    });
    if (this.projects.get(item.taskId)?.length) {
      const button = header.createEl("button", {
        cls: "tasks-map-focus-project-action",
        text: t("project_overview.projects_action"),
        attr: {
          "aria-label": t("project_overview.show_for", { task: item.label }),
          type: "button",
        },
      });
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.close();
        this.onProject(item, this.inputEl.value);
      });
    }
    // Nested spans express tree depth without inline styles or a depth limit.
    let labelContainer = header;
    for (let depth = 0; depth < item.depth; depth++) {
      const indent = el.createDiv("tasks-map-focus-suggestion__indent");
      indent.appendChild(labelContainer);
      labelContainer = indent;
    }
    const detail = el.createDiv("tasks-map-focus-suggestion__detail");
    detail.setText(
      item.path.slice(0, -1).join(" / ") ||
        item.projects.join(", ") ||
        item.tags.slice(0, 3).join(", ") ||
        item.link
    );
  }

  onChooseItem(item: TaskFocusCandidate, evt?: MouseEvent | KeyboardEvent) {
    if (this.chooseProject) {
      this.onProject(item, this.inputEl.value);
    } else {
      this.onChoose(
        item,
        this.newTabOnEnter || this.forceNewTab || wantsNewTab(evt)
      );
    }
  }
}

interface ProjectChoice {
  label: string;
  rootTaskIds?: string[];
}

export class TaskProjectSuggestModal extends FuzzySuggestModal<ProjectChoice> {
  private chosen = false;
  private forceNewTab = false;
  private onChoose: (
    _rootTaskIds: string[] | undefined,
    _newTab: boolean
  ) => void;
  private onBack: () => void;
  private choices: ProjectChoice[];
  private newTabOnEnter: boolean;

  constructor(
    app: App,
    options: ProjectRootOption[],
    onChoose: (_rootTaskIds: string[] | undefined, _newTab: boolean) => void,
    onBack: () => void,
    newTabOnEnter = false
  ) {
    super(app);
    this.onChoose = onChoose;
    this.onBack = onBack;
    this.newTabOnEnter = newTabOnEnter;
    this.choices = [
      { label: t("project_overview.all_projects") },
      ...options.map((option) => ({
        label: option.label,
        rootTaskIds: [option.rootTaskId],
      })),
    ];
    this.setPlaceholder(t("project_overview.choose_project"));
    this.setInstructions([
      { command: "Enter", purpose: t("project_overview.open_project") },
      ...(newTabOnEnter
        ? []
        : [
            {
              command: NEW_TAB_KEY_LABEL,
              purpose: t("project_overview.open_in_new_tab"),
            },
          ]),
      { command: "Esc", purpose: t("project_overview.back_to_results") },
    ]);
    this.scope.register(["Mod"], "Enter", (event) => {
      this.forceNewTab = true;
      this.selectActiveSuggestion(event);
      this.forceNewTab = false;
      return false;
    });
  }

  getItems() {
    return this.choices;
  }
  getItemText(item: ProjectChoice) {
    return item.label;
  }
  onChooseItem(item: ProjectChoice, evt?: MouseEvent | KeyboardEvent) {
    this.chosen = true;
    this.onChoose(
      item.rootTaskIds,
      this.newTabOnEnter || this.forceNewTab || wantsNewTab(evt)
    );
  }
  onClose() {
    super.onClose();
    // Obsidian closes the modal before invoking onChooseItem.
    queueMicrotask(() => {
      if (!this.chosen) this.onBack();
    });
  }
}

export function openTaskProjects(
  app: App,
  options: ProjectRootOption[],
  onChoose: (_rootTaskIds: string[] | undefined, _newTab: boolean) => void,
  onBack: () => void,
  newTabOnEnter = false
) {
  if (options.length === 0) {
    new Notice(t("project_overview.no_project"));
    onBack();
  } else if (options.length === 1) {
    onChoose([options[0].rootTaskId], newTabOnEnter);
  } else {
    new TaskProjectSuggestModal(
      app,
      options,
      onChoose,
      onBack,
      newTabOnEnter
    ).open();
  }
}
