import { App, Modal } from "obsidian";

/** A one-field modal that picks a date and hands it back as YYYY-MM-DD. */
export class DatePickerModal extends Modal {
  private title: string;
  private initial: string;
  private confirmLabel: string;
  private onPick: (_value: string) => void;

  constructor(
    app: App,
    title: string,
    confirmLabel: string,
    initial: string,
    onPick: (_value: string) => void
  ) {
    super(app);
    this.title = title;
    this.confirmLabel = confirmLabel;
    this.initial = initial;
    this.onPick = onPick;
  }

  onOpen(): void {
    this.titleEl.setText(this.title);
    this.modalEl.addClass("tasks-map-date-picker-modal");
    const input = this.contentEl.createEl("input", {
      type: "date",
      cls: "tasks-map-date-picker-input",
    });
    input.value = this.initial;
    const pick = () => {
      if (!input.value) return;
      this.onPick(input.value);
      this.close();
    };
    // No auto-close on "change": typing a year fires it once per digit.
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") pick();
    });
    const button = this.contentEl.createEl("button", {
      text: this.confirmLabel,
      cls: "mod-cta",
    });
    button.addEventListener("click", pick);
    window.setTimeout(() => input.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
