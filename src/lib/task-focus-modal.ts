import { App, FuzzySuggestModal, Notice } from "obsidian";
import type { FuzzyMatch } from "obsidian";
import { TaskFocusCandidate } from "./task-focus-picker";
import { canOpenPickerProjects, ProjectRootOption } from "./project-navigation";
import { t } from "../i18n";

export class TaskFocusSuggestModal extends FuzzySuggestModal<TaskFocusCandidate> {
  private chooseProject = false;
  private items: TaskFocusCandidate[];
  private projects: Map<string, ProjectRootOption[]>;
  private onChoose: (_item: TaskFocusCandidate) => void;
  private onProject: (_item: TaskFocusCandidate, _query: string) => void;
  private initialQuery: string;

  constructor(
    app: App,
    items: TaskFocusCandidate[],
    projects: Map<string, ProjectRootOption[]>,
    onChoose: (_item: TaskFocusCandidate) => void,
    onProject: (_item: TaskFocusCandidate, _query: string) => void,
    initialQuery = "",
    overviewOnEnter = false
  ) {
    super(app);
    this.items = items;
    this.projects = projects;
    this.onChoose = onChoose;
    this.onProject = onProject;
    this.initialQuery = initialQuery;
    this.setPlaceholder(t("focus_picker.placeholder"));
    this.setInstructions([
      { command: "↑ ↓", purpose: t("project_overview.navigate") },
      {
        command: "Enter",
        purpose: t(
          overviewOnEnter
            ? "project_overview.show"
            : "project_overview.focus_task"
        ),
      },
      { command: "→", purpose: t("project_overview.projects") },
    ]);
    this.scope.register([], "ArrowRight", (event) => {
      if (!canOpenPickerProjects(event, this.inputEl)) return;
      this.chooseProject = true;
      this.selectActiveSuggestion(event);
      this.chooseProject = false;
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

  onChooseItem(item: TaskFocusCandidate) {
    if (this.chooseProject) {
      this.onProject(item, this.inputEl.value);
    } else {
      this.onChoose(item);
    }
  }
}

interface ProjectChoice {
  label: string;
  rootTaskIds?: string[];
}

export class TaskProjectSuggestModal extends FuzzySuggestModal<ProjectChoice> {
  private chosen = false;
  private onChoose: (_rootTaskIds?: string[]) => void;
  private onBack: () => void;
  private choices: ProjectChoice[];

  constructor(
    app: App,
    options: ProjectRootOption[],
    onChoose: (_rootTaskIds?: string[]) => void,
    onBack: () => void
  ) {
    super(app);
    this.onChoose = onChoose;
    this.onBack = onBack;
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
      { command: "Esc", purpose: t("project_overview.back_to_results") },
    ]);
  }

  getItems() {
    return this.choices;
  }
  getItemText(item: ProjectChoice) {
    return item.label;
  }
  onChooseItem(item: ProjectChoice) {
    this.chosen = true;
    this.onChoose(item.rootTaskIds);
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
  onChoose: (_rootTaskIds?: string[]) => void,
  onBack: () => void
) {
  if (options.length === 0) {
    new Notice(t("project_overview.no_project"));
    onBack();
  } else if (options.length === 1) {
    onChoose([options[0].rootTaskId]);
  } else {
    new TaskProjectSuggestModal(app, options, onChoose, onBack).open();
  }
}
