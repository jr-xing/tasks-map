// Mock implementations for Obsidian API
import * as yaml from "yaml";

export class TFile {
  path: string;
  basename: string;
  extension: string;
  parent: { path: string } | null;

  constructor(path: string) {
    this.path = path;
    const name = path.split("/").pop() || "";
    const dotIndex = name.lastIndexOf(".");
    this.basename = dotIndex === -1 ? name : name.slice(0, dotIndex);
    this.extension = dotIndex === -1 ? "" : name.slice(dotIndex + 1);
    const parentPath = path.split("/").slice(0, -1).join("/");
    this.parent = parentPath ? { path: parentPath } : null;
  }
}

export class Vault {
  private files: Map<string, string> = new Map();
  adapter = {
    mkdir: async (_path: string): Promise<void> => undefined,
    list: async (
      path: string
    ): Promise<{ files: string[]; folders: string[] }> => {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const files: string[] = [];
      const folders = new Set<string>();
      for (const filePath of this.files.keys()) {
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash === -1) files.push(filePath);
        else folders.add(`${prefix}${rest.slice(0, slash)}`);
      }
      return { files, folders: [...folders] };
    },
    rmdir: async (_path: string, _recursive: boolean): Promise<void> =>
      undefined,
  };

  getAbstractFileByPath(path: string): TFile | null {
    if (this.files.has(path)) {
      return new TFile(path);
    }
    return null;
  }

  getFileByPath(path: string): TFile | null {
    return this.getAbstractFileByPath(path);
  }

  getMarkdownFiles(): TFile[] {
    return [...this.files.keys()]
      .filter((path) => path.endsWith(".md"))
      .map((path) => new TFile(path));
  }

  async process(file: TFile, fn: (content: string) => string): Promise<string> {
    const content = this.files.get(file.path) || "";
    const newContent = fn(content);
    this.files.set(file.path, newContent);
    return newContent;
  }

  async read(file: TFile): Promise<string> {
    return this.files.get(file.path) || "";
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.read(file);
  }

  async modify(file: TFile, content: string): Promise<void> {
    this.files.set(file.path, content);
  }

  async rename(file: TFile, newPath: string): Promise<void> {
    const content = this.files.get(file.path);
    if (content === undefined) throw new Error("File not found");
    this.files.delete(file.path);
    this.files.set(newPath, content);
    file.path = newPath;
  }

  // Test utility methods
  setFileContent(path: string, content: string): void {
    this.files.set(path, content);
  }

  getFileContent(path: string): string {
    return this.files.get(path) || "";
  }
}

export class App {
  vault: Vault;
  metadataCache: {
    resolvedLinks: Record<string, Record<string, number>>;
    getFileCache: (_file: TFile) => {
      frontmatter?: Record<string, unknown>;
      links?: Array<{ link: string }>;
      embeds?: Array<{ link: string }>;
      listItems?: Array<{
        task?: string;
        parent: number;
        position: {
          start: { line: number; col: number; offset: number };
          end: { line: number; col: number; offset: number };
        };
      }>;
    };
    getFirstLinkpathDest: (
      _linkpath: string,
      _sourcePath: string
    ) => TFile | null;
    fileToLinktext: (_file: TFile, _sourcePath: string) => string;
  };
  fileManager: {
    renameFile: (_file: TFile, _newPath: string) => Promise<void>;
    processFrontMatter: (
      _file: TFile,
      _fn: (_frontmatter: Record<string, unknown>) => void
    ) => Promise<void>;
    generateMarkdownLink: (_file: TFile, _sourcePath: string) => string;
    trashFile: (_file: TFile) => Promise<void>;
  };

  constructor() {
    this.vault = new Vault();
    this.metadataCache = {
      resolvedLinks: {},
      getFileCache: () => ({}),
      getFirstLinkpathDest: (linkpath: string) =>
        this.vault.getAbstractFileByPath(linkpath) ??
        this.vault.getAbstractFileByPath(`${linkpath}.md`),
      fileToLinktext: (file: TFile) => file.basename,
    };
    this.fileManager = {
      renameFile: async (file: TFile, newPath: string) => {
        await this.vault.rename(file, newPath);
      },
      processFrontMatter: async (file: TFile, fn) => {
        const content = await this.vault.read(file);
        const lines = content.split(/\r?\n/);
        if (lines[0] !== "---") return;
        const end = lines.indexOf("---", 1);
        if (end === -1) return;
        const frontmatter = parseYaml(lines.slice(1, end).join("\n")) ?? {};
        fn(frontmatter);
        const body = lines.slice(end + 1).join("\n");
        await this.vault.modify(
          file,
          `---\n${stringifyYaml(frontmatter)}---\n${body}`
        );
      },
      generateMarkdownLink: (file: TFile) =>
        `[${file.basename}](${file.basename}.md)`,
      trashFile: async (file: TFile) => {
        await this.vault.rename(file, `.trash/${file.path}`);
      },
    };
  }
}

export class Modal {
  app: App;
  contentEl: HTMLElement;

  constructor(app: App) {
    this.app = app;
    this.contentEl = document.createElement("div");
  }

  open(): void {
    this.onOpen();
  }

  close(): void {
    this.onClose();
  }

  onOpen(): void {}

  onClose(): void {}
}

export class Notice {
  constructor(message: string, timeout?: number) {
    // Mock implementation - does nothing
  }

  setMessage(message: string | DocumentFragment): this {
    return this;
  }

  hide(): void {}
}

export async function requestUrl(): Promise<{
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
  json: unknown;
  text: string;
}> {
  throw new Error("requestUrl mock was not configured");
}

export function setIcon(el: HTMLElement, icon: string): void {
  el.setAttribute("data-icon", icon);
}

export function setTooltip(_el: HTMLElement, _tooltip: string): void {}

/**
 * Wrapper around yaml for Obsidian's parseYaml API
 * Matches Obsidian's behavior
 */
export function parseYaml(yamlString: string): any {
  try {
    return yaml.parse(yamlString);
  } catch (e) {
    // Return empty object on parse error, similar to Obsidian
    return {};
  }
}

/**
 * Wrapper around yaml for Obsidian's stringifyYaml API
 * Matches Obsidian's YAML formatting style
 */
export function stringifyYaml(obj: any): string {
  return yaml.stringify(obj, {
    indent: 2,
    lineWidth: 0, // Don't wrap lines
    sortMapEntries: false, // Preserve key order
  });
}
