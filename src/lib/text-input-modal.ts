import { App, Modal } from "obsidian";

/** A one-line text prompt; Enter or the button confirms. */
export class TextInputModal extends Modal {
  private title: string;
  private confirmLabel: string;
  private onSubmit: (_value: string) => void;

  constructor(
    app: App,
    title: string,
    confirmLabel: string,
    onSubmit: (_value: string) => void
  ) {
    super(app);
    this.title = title;
    this.confirmLabel = confirmLabel;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.titleEl.setText(this.title);
    this.modalEl.addClass("tasks-map-date-picker-modal");
    const input = this.contentEl.createEl("input", {
      type: "text",
      cls: "tasks-map-date-picker-input",
    });
    const submit = () => {
      if (!input.value.trim()) return;
      this.onSubmit(input.value);
      this.close();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
    });
    const button = this.contentEl.createEl("button", {
      text: this.confirmLabel,
      cls: "mod-cta",
    });
    button.addEventListener("click", submit);
    window.setTimeout(() => input.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
