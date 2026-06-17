import { App, Vault, parseYaml, stringifyYaml } from "obsidian";
import { BaseTask } from "./base-task";
import { TaskStatus } from "./task";
import { TaskInsertPosition } from "./base-task";
import {
  TaskStatusConfig,
  DEFAULT_TASK_STATUSES,
  getStatusById,
} from "../lib/status-config";
import {
  addTaskNotesDependency,
  addTaskNotesProject,
  addTaskNotesTag,
  deleteTaskNotesTask,
  removeTaskNotesDependency,
  removeTaskNotesTag,
  updateTaskNotesPriority,
  updateTaskNotesStatus,
} from "../lib/tasknotes-bridge";

interface DependencyEntry {
  uid: string;
  reltype: string;
}

/**
 * Note-based task that stores metadata in frontmatter
 */
export class NoteTask extends BaseTask {
  readonly type = "note" as const;

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

    // Map the configured status to the frontmatter value to write. Use the
    // first listed `noteValues` token, falling back to the status id.
    const statusConfig = getStatusById(newStatus, statuses);
    const firstNoteValue = statusConfig.noteValues.split(",")[0]?.trim();
    const noteStatus = firstNoteValue || statusConfig.id;

    if (await updateTaskNotesStatus(app, this.link, noteStatus)) return;

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);

      // Find frontmatter boundaries
      const { frontmatterStart, frontmatterEnd } = this.findFrontmatter(lines);

      if (frontmatterStart === -1 || frontmatterEnd === -1) {
        return fileContent;
      }

      // Find and update status line
      for (let i = frontmatterStart + 1; i < frontmatterEnd; i++) {
        if (lines[i].startsWith("status:")) {
          lines[i] = `status: ${noteStatus}`;
          break;
        }
      }

      return lines.join("\n");
    });
  }

  async updatePriority(newPriority: string, app: App): Promise<void> {
    if (!this.link || !this.text) return;
    const vault = app?.vault;
    if (!vault) return;
    const file = vault.getFileByPath(this.link);
    if (!file) return;

    if (await updateTaskNotesPriority(app, this.link, newPriority)) return;

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const { frontmatterStart, frontmatterEnd } = this.findFrontmatter(lines);

      if (frontmatterStart === -1 || frontmatterEnd === -1) {
        return fileContent;
      }

      for (let i = frontmatterStart + 1; i < frontmatterEnd; i++) {
        if (lines[i].startsWith("priority:")) {
          lines[i] = `priority: ${newPriority || "none"}`;
          return lines.join("\n");
        }
      }

      lines.splice(frontmatterEnd, 0, `priority: ${newPriority || "none"}`);
      return lines.join("\n");
    });
  }

  async addTaskLine(
    newTaskLine: string,
    app: App,
    // _position is intentionally unused: NoteTask always creates a new file
    // regardless of where relative to the anchor the task should appear.
    _position: TaskInsertPosition = "after"
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
    const originalFile = vault.getFileByPath(this.link);
    if (!originalFile) {
      console.log("!originalFile: ", newTaskLine);
      return;
    }

    const folderPath = originalFile.parent?.path;
    if (!folderPath) {
      console.log("!folderPath: ", newTaskLine);
      return;
    }

    const timestamp = Date.now();
    const newFileName = `Task-${timestamp}.md`;
    const newFilePath = `${folderPath}/${newFileName}`;

    await vault.create(newFilePath, `# ${this.text}\n\n${this.text}`);
  }

  async delete(app: App): Promise<void> {
    if (!this.link) return;
    const vault = app?.vault;
    if (!vault) return;
    const file = vault.getFileByPath(this.link);
    if (!file) return;

    if (await deleteTaskNotesTask(app, this.link)) return;

    await app.fileManager.trashFile(file);
  }

  async addStar(app: App): Promise<void> {
    if (!this.link || !this.text) return;
    const vault = app?.vault;
    if (!vault) return;
    const file = vault.getFileByPath(this.link);
    if (!file) return;

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const { frontmatterStart, frontmatterEnd } = this.findFrontmatter(lines);

      if (frontmatterStart === -1 || frontmatterEnd === -1) {
        return fileContent;
      }

      // Find and update starred field, or add it if not present
      let starredLineFound = false;
      for (let i = frontmatterStart + 1; i < frontmatterEnd; i++) {
        if (lines[i].match(/^starred:\s*/)) {
          lines[i] = "starred: true";
          starredLineFound = true;
          break;
        }
      }

      if (!starredLineFound) {
        lines.splice(frontmatterEnd, 0, "starred: true");
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
      const { frontmatterStart, frontmatterEnd } = this.findFrontmatter(lines);

      if (frontmatterStart === -1 || frontmatterEnd === -1) {
        return fileContent;
      }

      // Find and update starred field
      for (let i = frontmatterStart + 1; i < frontmatterEnd; i++) {
        if (lines[i].match(/^starred:\s*/)) {
          lines[i] = "starred: false";
          break;
        }
      }

      return lines.join("\n");
    });
  }

  async addTag(tagToAdd: string, app: App): Promise<void> {
    if (!this.link || !this.text) return;
    const vault = app?.vault;
    if (!vault) return;
    const file = vault.getFileByPath(this.link);
    if (!file) return;

    if (await addTaskNotesTag(app, this.link, tagToAdd)) return;

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const { frontmatterStart, frontmatterEnd } = this.findFrontmatter(lines);

      if (frontmatterStart === -1 || frontmatterEnd === -1) {
        return fileContent;
      }

      // Find tags section
      let i = frontmatterStart + 1;
      let tagsLineIdx = -1;
      while (i < frontmatterEnd) {
        if (lines[i] === "tags:") {
          tagsLineIdx = i;
          break;
        }
        i++;
      }

      // If tags section doesn't exist, add it
      if (tagsLineIdx === -1) {
        lines.splice(frontmatterEnd, 0, "tags:", `  - ${tagToAdd}`);
        return lines.join("\n");
      }

      // Check if tag already exists
      i = tagsLineIdx + 1;
      while (i < frontmatterEnd && lines[i].match(/^\s{2}- /)) {
        const tagMatch = lines[i].match(/^\s{2}- (.+)$/);
        if (tagMatch && tagMatch[1] === tagToAdd) {
          // Tag already exists
          return fileContent;
        }
        i++;
      }

      // Add the tag
      lines.splice(i, 0, `  - ${tagToAdd}`);

      return lines.join("\n");
    });
  }

  async removeTag(tagToRemove: string, app: App): Promise<void> {
    if (!this.link || !this.text) return;
    const vault = app?.vault;
    if (!vault) return;
    const file = vault.getFileByPath(this.link);
    if (!file) return;

    if (await removeTaskNotesTag(app, this.link, tagToRemove)) return;

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      let { frontmatterStart, frontmatterEnd } = this.findFrontmatter(lines);

      if (frontmatterStart === -1 || frontmatterEnd === -1) {
        return fileContent;
      }

      // Find and remove the tag from the tags array
      let i = frontmatterStart + 1;
      while (i < frontmatterEnd) {
        const line = lines[i];
        if (line === "tags:") {
          // Found tags section, look for the tag in the following lines
          i++;
          while (i < frontmatterEnd && lines[i].match(/^\s{2}- /)) {
            const tagLine = lines[i];
            const tagMatch = tagLine.match(/^\s{2}- (.+)$/);
            if (tagMatch && tagMatch[1] === tagToRemove) {
              // Found the tag, remove it
              lines.splice(i, 1);
              break;
            }
            i++;
          }
          break;
        }
        i++;
      }

      return lines.join("\n");
    });
  }

  async addProject(app: App, projectName: string): Promise<void> {
    if (!this.link || !this.text) return;
    const vault = app?.vault;
    if (!vault) return;
    const file = vault.getFileByPath(this.link);
    if (!file) return;

    if (await addTaskNotesProject(app, this.link, projectName)) return;

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const { frontmatterStart, frontmatterEnd } = this.findFrontmatter(lines);

      if (frontmatterStart === -1 || frontmatterEnd === -1) {
        return fileContent;
      }

      // Find projects section
      let i = frontmatterStart + 1;
      let projectsLineIdx = -1;
      while (i < frontmatterEnd) {
        if (lines[i] === "projects:") {
          projectsLineIdx = i;
          break;
        }
        i++;
      }

      // If projects section doesn't exist, add it
      if (projectsLineIdx === -1) {
        lines.splice(
          frontmatterEnd,
          0,
          "projects:",
          `  - "[[${projectName}]]"`
        );
        return lines.join("\n");
      }

      // Check if project already exists
      i = projectsLineIdx + 1;
      while (i < frontmatterEnd && lines[i].match(/^\s{2}- /)) {
        const entryMatch = lines[i].match(/^\s{2}- (.+)$/);
        if (entryMatch) {
          const raw = entryMatch[1].replace(/^"|"$/g, "");
          const wikiMatch = raw.match(/^\[\[(.+)\]\]$/);
          const existing = wikiMatch ? wikiMatch[1] : raw;
          if (existing === projectName) {
            return fileContent;
          }
        }
        i++;
      }

      // Append project entry
      lines.splice(i, 0, `  - "[[${projectName}]]"`);
      return lines.join("\n");
    });
  }

  async addLinkMetadata(
    vault: Vault,
    fromTask: BaseTask,
    _linkingStyle: "individual" | "csv" | "dataview" = "individual",
    app?: App
  ): Promise<void> {
    if (
      app &&
      (await addTaskNotesDependency(app, this.link, {
        uid: this.dependencyUidFromTask(fromTask),
        reltype: "FINISHTOSTART",
      }))
    ) {
      return;
    }

    await this.addDependencyToFrontmatter(vault, fromTask);
  }

  async removeLinkMetadata(
    vault: Vault,
    fromTaskId: string,
    app?: App
  ): Promise<void> {
    if (
      app &&
      (await removeTaskNotesDependency(
        app,
        this.link,
        this.dependencyUidFromTaskId(fromTaskId)
      ))
    ) {
      return;
    }

    await this.removeDependencyFromFrontmatter(vault, fromTaskId);
  }

  /**
   * Helper method to find frontmatter boundaries
   */
  private findFrontmatter(lines: string[]): {
    frontmatterStart: number;
    frontmatterEnd: number;
  } {
    let frontmatterStart = -1;
    let frontmatterEnd = -1;

    if (lines[0] === "---") {
      frontmatterStart = 0;
      for (let i = 1; i < lines.length; i++) {
        if (lines[i] === "---") {
          frontmatterEnd = i;
          break;
        }
      }
    }

    return { frontmatterStart, frontmatterEnd };
  }

  private dependencyUidFromTask(fromTask: BaseTask): string {
    const taskName =
      fromTask.text || fromTask.id.split("/").pop()?.replace(/\.md$/, "") || "";
    return `[[${taskName}]]`;
  }

  private dependencyUidFromTaskId(fromTaskId: string): string {
    let taskNameToRemove = fromTaskId;
    if (fromTaskId.includes("/") || fromTaskId.endsWith(".md")) {
      taskNameToRemove =
        fromTaskId.split("/").pop()?.replace(/\.md$/, "") || fromTaskId;
    }

    return `[[${taskNameToRemove}]]`;
  }

  /**
   * Add a dependency to this note task by updating its frontmatter
   */
  private async addDependencyToFrontmatter(
    vault: Vault,
    fromTask: BaseTask
  ): Promise<void> {
    if (!this.link) return;

    const file = vault.getFileByPath(this.link);
    if (!file) return;

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const { frontmatterStart, frontmatterEnd } = this.findFrontmatter(lines);

      if (frontmatterStart === -1 || frontmatterEnd === -1) {
        return fileContent;
      }

      // Extract frontmatter YAML content (excluding the --- delimiters)
      const frontmatterYaml = lines
        .slice(frontmatterStart + 1, frontmatterEnd)
        .join("\n");
      const bodyContent = lines.slice(frontmatterEnd + 1).join("\n");

      // Parse YAML into an object
      const frontmatterData = parseYaml(frontmatterYaml) || {};

      const uidValue = this.dependencyUidFromTask(fromTask);

      // Ensure blockedBy array exists
      if (!frontmatterData.blockedBy) {
        frontmatterData.blockedBy = [];
      } else if (!Array.isArray(frontmatterData.blockedBy)) {
        frontmatterData.blockedBy = [];
      }

      // Check if dependency already exists
      const exists = frontmatterData.blockedBy.some(
        (dep: DependencyEntry) => dep && dep.uid === uidValue
      );

      if (!exists) {
        frontmatterData.blockedBy.push({
          uid: uidValue,
          reltype: "FINISHTOSTART",
        });
      }

      const newFrontmatterYaml = stringifyYaml(frontmatterData);

      return `---\n${newFrontmatterYaml}---\n${bodyContent}`;
    });
  }

  /**
   * Remove a dependency from this note task by updating its frontmatter
   */
  private async removeDependencyFromFrontmatter(
    vault: Vault,
    fromTaskId: string
  ): Promise<void> {
    if (!this.link) return;

    const file = vault.getFileByPath(this.link);
    if (!file) return;

    await vault.process(file, (fileContent) => {
      const lines = fileContent.split(/\r?\n/);
      const { frontmatterStart, frontmatterEnd } = this.findFrontmatter(lines);

      if (frontmatterStart === -1 || frontmatterEnd === -1) {
        return fileContent;
      }

      // Extract frontmatter YAML content (excluding the --- delimiters)
      const frontmatterYaml = lines
        .slice(frontmatterStart + 1, frontmatterEnd)
        .join("\n");
      const bodyContent = lines.slice(frontmatterEnd + 1).join("\n");

      // Parse YAML into an object
      const frontmatterData = parseYaml(frontmatterYaml) || {};

      const uidToRemove = this.dependencyUidFromTaskId(fromTaskId);

      // Remove the dependency from blockedBy array
      if (Array.isArray(frontmatterData.blockedBy)) {
        frontmatterData.blockedBy = frontmatterData.blockedBy.filter(
          (dep: DependencyEntry) => dep && dep.uid !== uidToRemove
        );

        if (frontmatterData.blockedBy.length === 0) {
          delete frontmatterData.blockedBy;
        }
      }

      const newFrontmatterYaml = stringifyYaml(frontmatterData);

      return `---\n${newFrontmatterYaml}---\n${bodyContent}`;
    });
  }
}
