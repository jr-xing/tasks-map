import { App, Vault } from "obsidian";
import { BaseTask } from "./base-task";
import { TaskStatus } from "./task";
import { TaskInsertPosition } from "./base-task";
import {
  findTaskLineByIdOrText,
  addDateToTask,
  removeDateFromTask,
  getTodayDate,
  addSignToTaskInFile,
  removeSignFromTaskInFile,
} from "../lib/utils";
import {
  TaskStatusConfig,
  DEFAULT_TASK_STATUSES,
  getStatusById,
} from "../lib/status-config";
import {
  EMOJI_ID_REMOVAL,
  DATAVIEW_BRACKET_ID_REMOVAL,
  DATAVIEW_PARENTHESES_ID_REMOVAL,
  TAG_REMOVAL,
  WHITESPACE_NORMALIZE,
} from "../lib/task-regex";

/**
 * Dataview-style task that stores metadata inline in the task text
 */
export class DataviewTask extends BaseTask {
  readonly type = "dataview" as const;

  async updateStatus(
    newStatus: TaskStatus,
    app: App,
    statuses: TaskStatusConfig[] = DEFAULT_TASK_STATUSES
  ): Promise<void> {
    if (!this.link || !this.text) return;
    const vault = app?.vault;
    if (!vault) return;
    const file = vault.getFileByPath(this.link);
    if (!file) return;

    const checkboxChar = getStatusById(newStatus, statuses).checkboxChar || " ";

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const taskLineIdx = findTaskLineByIdOrText(lines, this.id, this.text);

      if (taskLineIdx === -1) return fileContent;

      // Replace the checkbox character, keeping the list marker intact.
      lines[taskLineIdx] = lines[taskLineIdx].replace(
        /^(\s*[-*+]\s+)\[([^\]])\]/,
        `$1[${checkboxChar}]`
      );

      // Add done timestamp
      if (newStatus === "done") {
        lines[taskLineIdx] = addDateToTask(
          lines[taskLineIdx],
          "done",
          getTodayDate()
        );
      }
      // Delete done timestamp and add start timestamp
      else if (newStatus === "in_progress") {
        lines[taskLineIdx] = removeDateFromTask(lines[taskLineIdx], "done");
        lines[taskLineIdx] = addDateToTask(
          lines[taskLineIdx],
          "start",
          getTodayDate()
        );
      }
      // Delete canceled and done timestamp
      else if (newStatus === "todo") {
        lines[taskLineIdx] = removeDateFromTask(lines[taskLineIdx], "canceled");
        lines[taskLineIdx] = removeDateFromTask(lines[taskLineIdx], "done");
        lines[taskLineIdx] = removeDateFromTask(lines[taskLineIdx], "start");
      }

      return lines.join("\n");
    });
  }

  async addTaskLine(
    newTaskLine: string,
    app: App,
    position: TaskInsertPosition = "after"
  ): Promise<void> {
    if (!this.link) {
      console.log("!task.link: ", newTaskLine);
      return;
    }
    const vault = app?.vault;
    if (!vault) {
      console.log("!vault: ", newTaskLine);
      return;
    }
    const file = vault.getFileByPath(this.link);
    if (!file) {
      console.log("!file: ", newTaskLine);
      return;
    }

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const taskLineIdx = findTaskLineByIdOrText(lines, this.id, this.text);

      if (taskLineIdx === -1) {
        console.log("taskLineIdx === -1: ", newTaskLine);
        return fileContent;
      }

      const insertIdx =
        position === "before"
          ? taskLineIdx
          : Math.min(taskLineIdx + 1, lines.length);
      lines.splice(insertIdx, 0, newTaskLine);

      return lines.join("\n");
    });
  }

  async delete(app: App): Promise<void> {
    if (!this.link) return;
    const vault = app?.vault;
    if (!vault) return;
    const file = vault.getFileByPath(this.link);
    if (!file) return;

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const taskLineIdx = findTaskLineByIdOrText(lines, this.id, this.text);

      if (taskLineIdx === -1) return fileContent;

      // Remove the task line
      lines.splice(taskLineIdx, 1);
      return lines.join("\n");
    });
  }

  async addStar(app: App): Promise<void> {
    if (!this.link || !this.text) return;
    const vault = app?.vault;
    if (!vault) return;
    const file = vault.getFileByPath(this.link);
    if (!file) return;

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const taskLineIdx = findTaskLineByIdOrText(lines, this.id, this.text);

      if (taskLineIdx === -1) return fileContent;

      // Add star emoji if not present
      if (!lines[taskLineIdx].includes("⭐")) {
        lines[taskLineIdx] = lines[taskLineIdx] + " ⭐";
      }
      return lines.join("\n");
    });
  }

  async removeStar(app: App): Promise<void> {
    if (!this.link || !this.text) return;
    const vault = app?.vault;
    if (!vault) return;
    const file = vault.getFileByPath(this.link);
    if (!file) return;

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const taskLineIdx = findTaskLineByIdOrText(lines, this.id, this.text);

      if (taskLineIdx === -1) return fileContent;

      // Remove star emoji
      lines[taskLineIdx] = lines[taskLineIdx].replace(/\s*⭐\s*/g, " ").trim();
      return lines.join("\n");
    });
  }

  async addTag(tagToAdd: string, app: App): Promise<void> {
    if (!this.link || !this.text) return;
    const vault = app?.vault;
    if (!vault) return;
    const file = vault.getFileByPath(this.link);
    if (!file) return;

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      let taskLineIdx = findTaskLineByIdOrText(lines, this.id, this.text);

      if (taskLineIdx === -1) {
        // Fallback: try to find by matching core task text
        const coreTaskText = this.text
          .replace(EMOJI_ID_REMOVAL, "")
          .replace(DATAVIEW_BRACKET_ID_REMOVAL, "")
          .replace(DATAVIEW_PARENTHESES_ID_REMOVAL, "")
          .replace(TAG_REMOVAL, "")
          .replace(WHITESPACE_NORMALIZE, " ")
          .trim();

        taskLineIdx = lines.findIndex((line: string) => {
          const coreLineText = line
            .replace(EMOJI_ID_REMOVAL, "")
            .replace(DATAVIEW_BRACKET_ID_REMOVAL, "")
            .replace(DATAVIEW_PARENTHESES_ID_REMOVAL, "")
            .replace(TAG_REMOVAL, "")
            .replace(WHITESPACE_NORMALIZE, " ")
            .trim();
          return (
            coreLineText.includes(coreTaskText) ||
            coreTaskText.includes(coreLineText)
          );
        });

        if (taskLineIdx === -1) return fileContent;
      }

      const currentLine = lines[taskLineIdx];

      // Check if tag already exists (check for #tag or #tag/subtag)
      const tagPattern = new RegExp(
        `(^|\\s)#${tagToAdd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/|\\s|$)`
      );
      if (tagPattern.test(currentLine)) {
        // Tag already exists, don't add it again
        return fileContent;
      }

      // Add the tag at the end
      lines[taskLineIdx] = currentLine + " #" + tagToAdd;

      return lines.join("\n");
    });
  }

  async removeTag(tagToRemove: string, app: App): Promise<void> {
    if (!this.link || !this.text) return;
    const vault = app?.vault;
    if (!vault) return;
    const file = vault.getFileByPath(this.link);
    if (!file) return;

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);

      let taskLineIdx = findTaskLineByIdOrText(lines, this.id, this.text);

      if (taskLineIdx === -1) {
        // Fallback: try to find by matching core task text
        const coreTaskText = this.text
          .replace(EMOJI_ID_REMOVAL, "")
          .replace(DATAVIEW_BRACKET_ID_REMOVAL, "")
          .replace(DATAVIEW_PARENTHESES_ID_REMOVAL, "")
          .replace(TAG_REMOVAL, "")
          .replace(WHITESPACE_NORMALIZE, " ")
          .trim();

        taskLineIdx = lines.findIndex((line: string) => {
          const coreLineText = line
            .replace(EMOJI_ID_REMOVAL, "")
            .replace(DATAVIEW_BRACKET_ID_REMOVAL, "")
            .replace(DATAVIEW_PARENTHESES_ID_REMOVAL, "")
            .replace(TAG_REMOVAL, "")
            .replace(WHITESPACE_NORMALIZE, " ")
            .trim();
          return (
            coreLineText.includes(coreTaskText) ||
            coreTaskText.includes(coreLineText)
          );
        });

        if (taskLineIdx === -1) return fileContent;
      }

      const currentLine = lines[taskLineIdx];
      const tagPattern = new RegExp(
        `\\s*#${tagToRemove.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/\\S*)?(?=\\s|$)`,
        "g"
      );

      const newLine = currentLine
        .replace(tagPattern, "")
        .replace(/\s+/g, " ")
        .trim();

      lines[taskLineIdx] = newLine;

      return lines.join("\n");
    });
  }

  async addLinkMetadata(
    vault: Vault,
    fromTask: BaseTask,
    linkingStyle: "individual" | "csv" | "dataview" = "individual",
    _app?: App
  ): Promise<void> {
    const id = fromTask.id;
    await addSignToTaskInFile(vault, fromTask, "id", id, linkingStyle);
    await addSignToTaskInFile(vault, this, "stop", id, linkingStyle);
  }

  async removeLinkMetadata(
    vault: Vault,
    hash: string,
    _app?: App
  ): Promise<void> {
    await removeSignFromTaskInFile(vault, this, "stop", hash);
  }
}
