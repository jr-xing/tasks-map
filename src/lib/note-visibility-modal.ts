import { App, Modal, Setting } from "obsidian";
import type {
  NoteVisibilityReason,
  NoteVisibilityReport,
} from "./note-visibility";
import { t } from "../i18n";

function reasonOptions(reason: NoteVisibilityReason): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(reason.details ?? {}).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(", ") || "—" : value || "—",
    ])
  );
}

export class NoteVisibilityModal extends Modal {
  private report: NoteVisibilityReport;
  private onReload: (() => void) | null;

  constructor(
    app: App,
    report: NoteVisibilityReport,
    onReload: (() => void) | null
  ) {
    super(app);
    this.report = report;
    this.onReload = onReload;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tasks-map-visibility-modal");
    contentEl.createEl("h2", { text: t("visibility.title") });
    contentEl.createDiv({
      cls: "tasks-map-visibility-path",
      text: this.report.filePath,
    });

    contentEl.createDiv({
      cls: `tasks-map-visibility-verdict tasks-map-visibility-verdict--${this.report.verdict.replace(/_/g, "-")}`,
      text: t(`visibility.verdict_${this.report.verdict}`),
    });
    contentEl.createDiv({
      cls: "tasks-map-visibility-context",
      text: t(`visibility.context_${this.report.context}`),
    });

    const checks = contentEl.createDiv({
      cls: "tasks-map-visibility-checks",
    });
    for (const reason of this.report.reasons) {
      this.renderReason(checks, reason);
    }

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText(t("visibility.close")).onClick(() => this.close())
      )
      .addButton((button) => {
        if (!this.report.canReload || !this.onReload) {
          button.buttonEl.hide();
          return button;
        }
        return button
          .setButtonText(t("visibility.reload_map"))
          .setCta()
          .onClick(() => {
            this.onReload?.();
            this.close();
          });
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderReason(
    containerEl: HTMLElement,
    reason: NoteVisibilityReason
  ): void {
    const row = containerEl.createDiv({
      cls: `tasks-map-visibility-check tasks-map-visibility-check--${reason.state}`,
    });
    row.createSpan({
      cls: "tasks-map-visibility-check-icon",
      text: reason.state === "pass" ? "✓" : reason.state === "fail" ? "×" : "!",
    });
    row.createDiv({
      cls: "tasks-map-visibility-check-message",
      text: t(`visibility.reasons.${reason.code}`, reasonOptions(reason)),
    });
  }
}
