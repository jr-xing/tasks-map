import { App, Modal, Setting } from "obsidian";
import {
  executeTaskOrganizerPlan,
  TaskOrganizerMove,
  TaskOrganizerPlan,
} from "./tasknotes-organizer";
import { t } from "../i18n";

function groupMovesByProject(moves: TaskOrganizerMove[]) {
  const groups = new Map<string, TaskOrganizerMove[]>();
  for (const move of moves) {
    const group = groups.get(move.projectFolder) ?? [];
    group.push(move);
    groups.set(move.projectFolder, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function countTotalChanges(plan: TaskOrganizerPlan): number {
  return (
    plan.noteMoves.length +
    plan.attachmentMoves.length +
    plan.metadataUpdates.length
  );
}

export class TaskOrganizerPreviewModal extends Modal {
  private plan: TaskOrganizerPlan;
  private onComplete: () => void;
  private applying = false;

  constructor(app: App, plan: TaskOrganizerPlan, onComplete: () => void) {
    super(app);
    this.plan = plan;
    this.onComplete = onComplete;
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tasks-map-organizer-modal");

    contentEl.createEl("h2", { text: t("organizer.preview_title") });

    const summary = contentEl.createDiv({
      cls: "tasks-map-organizer-summary",
    });
    summary.createDiv({
      text: t("organizer.summary_note_moves", {
        count: this.plan.noteMoves.length,
      }),
    });
    summary.createDiv({
      text: t("organizer.summary_attachment_moves", {
        count: this.plan.attachmentMoves.length,
      }),
    });
    summary.createDiv({
      text: t("organizer.summary_metadata_updates", {
        count: this.plan.metadataUpdates.length,
      }),
    });
    summary.createDiv({
      text: t("organizer.summary_skipped_orphans", {
        count: this.plan.skippedOrphans.length,
      }),
    });
    summary.createDiv({
      text: t("organizer.summary_skipped_shared", {
        count: this.plan.skippedSharedAttachments.length,
      }),
    });

    if (countTotalChanges(this.plan) === 0) {
      contentEl.createDiv({
        cls: "tasks-map-organizer-empty",
        text: t("organizer.no_changes"),
      });
    } else {
      this.renderMoves(contentEl);
      this.renderMetadata(contentEl);
    }

    if (this.plan.warnings.length > 0) {
      const warningBox = contentEl.createDiv({
        cls: "tasks-map-organizer-warnings",
      });
      warningBox.createEl("h3", { text: t("organizer.warnings") });
      const list = warningBox.createEl("ul");
      this.plan.warnings.forEach((warning) => {
        list.createEl("li", { text: warning });
      });
    }

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText(t("organizer.cancel")).onClick(() => this.close())
      )
      .addButton((button) =>
        button
          .setButtonText(t("organizer.apply"))
          .setCta()
          .setDisabled(countTotalChanges(this.plan) === 0 || this.applying)
          .onClick(async () => {
            if (this.applying) return;
            this.applying = true;
            button.setButtonText(t("organizer.applying"));
            button.setDisabled(true);
            await executeTaskOrganizerPlan(this.app, this.plan);
            this.onComplete();
            this.close();
          })
      );
  }

  private renderMoves(containerEl: HTMLElement): void {
    const moves = [...this.plan.noteMoves, ...this.plan.attachmentMoves];
    if (moves.length === 0) return;

    const section = containerEl.createDiv({
      cls: "tasks-map-organizer-section",
    });
    section.createEl("h3", { text: t("organizer.planned_moves") });

    for (const [projectFolder, projectMoves] of groupMovesByProject(moves)) {
      const group = section.createDiv({
        cls: "tasks-map-organizer-group",
      });
      group.createEl("h4", {
        text: t("organizer.project_group", {
          project: projectFolder,
          count: projectMoves.length,
        }),
      });

      const list = group.createEl("ul");
      for (const move of projectMoves) {
        const item = list.createEl("li");
        item.createDiv({
          cls: "tasks-map-organizer-from",
          text: move.from,
        });
        item.createDiv({
          cls: "tasks-map-organizer-to",
          text: move.to,
        });
      }
    }
  }

  private renderMetadata(containerEl: HTMLElement): void {
    if (this.plan.metadataUpdates.length === 0) return;

    const section = containerEl.createDiv({
      cls: "tasks-map-organizer-section",
    });
    section.createEl("h3", { text: t("organizer.metadata_updates") });
    const list = section.createEl("ul");
    for (const update of this.plan.metadataUpdates) {
      list.createEl("li", {
        text: t("organizer.metadata_update_item", {
          path: update.path,
          slug: update.fields.folder_slug,
        }),
      });
    }
  }
}
