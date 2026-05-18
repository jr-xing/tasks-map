/**
 * An embeddable Obsidian markdown editor (CodeMirror Live Preview) that can be
 * mounted into any container element. Ported from the TaskNotes plugin's
 * `EmbeddableMarkdownEditor`, itself based on Fevol's implementation.
 *
 * It resolves Obsidian's internal `ScrollableMarkdownEditor` class at runtime,
 * so the body field renders markdown inline exactly like a real note editor.
 * The class is built lazily (on first use) so importing this module never
 * touches Obsidian internals at plugin-load time.
 */
import {
  App,
  Constructor,
  Scope,
  TFile,
  type Editor,
  type EditorPosition,
  type EditorSelection,
  type EditorSelectionOrCaret,
  type EditorTransaction,
} from "obsidian";
import {
  EditorSelection as CMEditorSelection,
  Extension,
  Prec,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder,
  ViewUpdate,
  tooltips,
} from "@codemirror/view";
import { around } from "monkey-around";

declare const app: App;

/** Minimal public surface the React wrapper relies on. */
export interface EmbeddableMarkdownEditorInstance {
  readonly value: string;
  // eslint-disable-next-line no-unused-vars -- interface parameter name
  setValue(value: string): void;
  destroy(): void;
}

// Internal Obsidian type - not exported in the official API.
interface ScrollableMarkdownEditor {
  app: App;
  containerEl: HTMLElement;
  editor: MarkdownEditorInternal;
  editorEl: HTMLElement;
  activeCM: unknown;
  owner: MarkdownEditorOwner;
  _loaded: boolean;
  // eslint-disable-next-line no-unused-vars -- interface parameter name
  set(value: string): void;
  // eslint-disable-next-line no-unused-vars -- interface parameter names
  onUpdate(update: ViewUpdate, changed: boolean): void;
  buildLocalExtensions(): Extension[];
  destroy(): void;
  unload(): void;
}

// Internal Obsidian type - not exported in the official API.
interface WidgetEditorView {
  editable: boolean;
  editMode: unknown;
  showEditor(): void;
  unload(): void;
}

type MarkdownEditorInternal = {
  cm: {
    cm?: unknown;
    contentDOM: HTMLElement;
    focus(): void;
    scrollDOM: HTMLElement;
    // eslint-disable-next-line no-unused-vars -- type parameter name
    dispatch(spec: unknown): void;
    state: {
      doc: {
        toString(): string;
      };
    };
  };
};

type MarkdownEditorOwner = {
  editMode: unknown;
  editor: MarkdownEditorInternal | null;
};

type ActiveMarkdownEditorOwner = {
  editMode: unknown;
  editor: Editor;
  file: TFile | null;
};

type WorkspaceWithActiveEditor = {
  activeEditor: ActiveMarkdownEditorOwner | null;
};

type ActiveLeafContext = {
  activeCM?: {
    hasFocus?: boolean;
  };
};

type VaultWithConfig = {
  // eslint-disable-next-line no-unused-vars -- type parameter name
  getConfig(key: string): unknown;
};

type WindowWithCodeMirrorAdapter = Window & {
  CodeMirrorAdapter?: {
    Vim?: {
      // eslint-disable-next-line no-unused-vars -- type parameter names
      handleKey(cm: unknown, key: string, origin: string): void;
    };
  };
};

/**
 * Resolves the internal `ScrollableMarkdownEditor` prototype from Obsidian.
 * Uses the active file when it is markdown, otherwise falls back to any
 * markdown file in the vault (the throwaway widget only needs a reference
 * file to instantiate).
 */
function resolveEditorPrototype(
  hostApp: App
): Constructor<ScrollableMarkdownEditor> {
  let referenceFile = hostApp.workspace.getActiveFile();
  if (!(referenceFile instanceof TFile) || referenceFile.extension !== "md") {
    referenceFile = hostApp.vault.getMarkdownFiles()[0] ?? null;
  }
  if (!(referenceFile instanceof TFile)) {
    throw new Error(
      "Cannot resolve markdown editor prototype without a markdown file."
    );
  }

  // @ts-expect-error - Using internal API
  const widgetEditorView = hostApp.embedRegistry.embedByExtension.md(
    { app: hostApp, containerEl: activeDocument.createElement("div") },
    referenceFile,
    ""
  ) as WidgetEditorView;

  widgetEditorView.editable = true;
  widgetEditorView.showEditor();

  const editMode = widgetEditorView.editMode;
  if (!editMode) {
    widgetEditorView.unload();
    throw new Error("Markdown editor edit mode was not initialized");
  }

  const MarkdownEditor = Object.getPrototypeOf(Object.getPrototypeOf(editMode));

  widgetEditorView.unload();
  return MarkdownEditor.constructor as Constructor<ScrollableMarkdownEditor>;
}

/** Gets the editor base class, with a fallback mock for test environments. */
function getEditorBase(): Constructor<ScrollableMarkdownEditor> {
  // In test environments, `app` won't be defined, so return a mock base class.
  if (typeof app === "undefined") {
    return class MockScrollableMarkdownEditor {
      app: App;
      containerEl: HTMLElement = activeDocument.createElement("div");
      editor: MarkdownEditorInternal = {
        cm: new EditorView() as unknown as MarkdownEditorInternal["cm"],
      };
      editorEl: HTMLElement = activeDocument.createElement("div");
      activeCM: unknown;
      owner: MarkdownEditorOwner = { editMode: null, editor: null };
      _loaded = false;
      set(value: string): void {
        const view = this.editor.cm as unknown as EditorView;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value },
        });
      }
      onUpdate(_update: ViewUpdate, _changed: boolean): void {}
      buildLocalExtensions(): Extension[] {
        return [];
      }
      destroy(): void {}
      unload(): void {}
      constructor(hostApp: App, container: HTMLElement, _options: unknown) {
        this.app = hostApp;
        this.containerEl = container;
      }
    };
  }
  return resolveEditorPrototype(app);
}

export interface MarkdownEditorProps {
  /** Initial cursor position */
  cursorLocation?: { anchor: number; head: number };
  /** Initial text content */
  value?: string;
  /** CSS class to add to editor element */
  cls?: string;
  /** Placeholder text when empty */
  placeholder?: string;
  /** Handler for Enter key (return false to use default behavior) */
  onEnter?: (
    // eslint-disable-next-line no-unused-vars -- callback parameter names
    editor: EmbeddableMarkdownEditorInstance,
    // eslint-disable-next-line no-unused-vars -- callback parameter names
    mod: boolean,
    // eslint-disable-next-line no-unused-vars -- callback parameter names
    shift: boolean
  ) => boolean;
  /** Handler for Escape key */
  // eslint-disable-next-line no-unused-vars -- callback parameter name
  onEscape?: (editor: EmbeddableMarkdownEditorInstance) => void;
  /** Handler for Tab key (return false to use default behavior) */
  onTab?: (
    // eslint-disable-next-line no-unused-vars -- callback parameter names
    editor: EmbeddableMarkdownEditorInstance,
    // eslint-disable-next-line no-unused-vars -- callback parameter names
    shift: boolean
  ) => boolean;
  /** Handler for Ctrl/Cmd+Enter */
  onSubmit?: (
    // eslint-disable-next-line no-unused-vars -- callback parameter names
    editor: EmbeddableMarkdownEditorInstance,
    // eslint-disable-next-line no-unused-vars -- callback parameter names
    shift: boolean
  ) => void;
  /** Handler for Ctrl/Cmd+S; return true when the key was handled. */
  onSave?: (
    // eslint-disable-next-line no-unused-vars -- callback parameter name
    editor: EmbeddableMarkdownEditorInstance
  ) => boolean;
  /** Handler for blur event */
  // eslint-disable-next-line no-unused-vars -- callback parameter name
  onBlur?: (editor: EmbeddableMarkdownEditorInstance) => void;
  /** Handler for paste event */
  onPaste?: (
    // eslint-disable-next-line no-unused-vars -- callback parameter names
    e: ClipboardEvent,
    // eslint-disable-next-line no-unused-vars -- callback parameter names
    editor: EmbeddableMarkdownEditorInstance
  ) => void;
  /** Handler for content changes */
  // eslint-disable-next-line no-unused-vars -- callback parameter names
  onChange?: (value: string, update: ViewUpdate) => void;
  /** Additional CodeMirror extensions (e.g., autocomplete) */
  extensions?: Extension[];
  /** Automatically enter vim insert mode on first focus when vim is enabled */
  enterVimInsertMode?: boolean;
  /** File associated with this editor, for plugins reading workspace.activeEditor */
  file?: TFile | null;
}

type ResolvedMarkdownEditorProps = Required<
  Omit<MarkdownEditorProps, "cursorLocation" | "file">
> &
  Pick<MarkdownEditorProps, "cursorLocation" | "file">;

const defaultProperties: ResolvedMarkdownEditorProps = {
  cursorLocation: undefined,
  value: "",
  cls: "",
  placeholder: "",
  onEnter: () => false,
  onEscape: () => {},
  onTab: () => false,
  onSubmit: () => {},
  onSave: () => false,
  onBlur: () => {},
  onPaste: () => {},
  onChange: () => {},
  extensions: [],
  enterVimInsertMode: false,
  file: undefined,
};

/** Adapts a CodeMirror `EditorView` to Obsidian's `Editor` interface. */
class CodeMirrorEditorAdapter {
  // eslint-disable-next-line no-unused-vars -- parameter property used as this.view
  constructor(private readonly view: EditorView) {}

  getDoc(): CodeMirrorEditorAdapter {
    return this;
  }

  getValue(): string {
    return this.view.state.doc.toString();
  }

  setValue(content: string): void {
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: content },
    });
  }

  getLine(line: number): string {
    return this.view.state.doc.line(line + 1).text;
  }

  lineCount(): number {
    return this.view.state.doc.lines;
  }

  lastLine(): number {
    return this.lineCount() - 1;
  }

  getSelection(): string {
    const range = this.view.state.selection.main;
    return this.view.state.doc.sliceString(range.from, range.to);
  }

  somethingSelected(): boolean {
    return !this.view.state.selection.main.empty;
  }

  getRange(from: EditorPosition, to: EditorPosition): string {
    return this.view.state.doc.sliceString(
      this.posToOffset(from),
      this.posToOffset(to)
    );
  }

  replaceSelection(replacement: string): void {
    const transaction = this.view.state.changeByRange((range) => ({
      changes: { from: range.from, to: range.to, insert: replacement },
      range: CMEditorSelection.cursor(range.from + replacement.length),
    }));
    this.view.dispatch(transaction);
  }

  replaceRange(
    replacement: string,
    from: EditorPosition,
    to?: EditorPosition
  ): void {
    this.view.dispatch({
      changes: {
        from: this.posToOffset(from),
        to: this.posToOffset(to ?? from),
        insert: replacement,
      },
    });
  }

  getCursor(
    side: "from" | "to" | "head" | "anchor" = "head"
  ): EditorPosition {
    const range = this.view.state.selection.main;
    switch (side) {
      case "from":
        return this.offsetToPos(range.from);
      case "to":
        return this.offsetToPos(range.to);
      case "anchor":
        return this.offsetToPos(range.anchor);
      case "head":
      default:
        return this.offsetToPos(range.head);
    }
  }

  listSelections(): EditorSelection[] {
    return this.view.state.selection.ranges.map((range) => ({
      anchor: this.offsetToPos(range.anchor),
      head: this.offsetToPos(range.head),
    }));
  }

  setCursor(pos: EditorPosition | number, ch?: number): void {
    if (typeof pos === "number") {
      this.setSelection({ line: pos, ch: ch ?? 0 });
      return;
    }
    this.setSelection(pos);
  }

  setSelection(anchor: EditorPosition, head?: EditorPosition): void {
    this.view.dispatch({
      selection: CMEditorSelection.range(
        this.posToOffset(anchor),
        this.posToOffset(head ?? anchor)
      ),
    });
  }

  setSelections(ranges: EditorSelectionOrCaret[], main = 0): void {
    if (ranges.length === 0) return;
    this.view.dispatch({
      selection: CMEditorSelection.create(
        ranges.map((range) =>
          CMEditorSelection.range(
            this.posToOffset(range.anchor),
            this.posToOffset(range.head ?? range.anchor)
          )
        ),
        main
      ),
    });
  }

  focus(): void {
    this.view.focus();
  }

  blur(): void {
    this.view.contentDOM.blur();
  }

  hasFocus(): boolean {
    return this.view.hasFocus;
  }

  transaction(tx: EditorTransaction): void {
    if (tx.replaceSelection !== undefined) {
      this.replaceSelection(tx.replaceSelection);
      return;
    }

    const changes = tx.changes?.map((change) => ({
      from: this.posToOffset(change.from),
      to: this.posToOffset(change.to ?? change.from),
      insert: change.text,
    }));

    const selections = tx.selections ?? (tx.selection ? [tx.selection] : undefined);
    this.view.dispatch({
      ...(changes ? { changes } : {}),
      ...(selections && selections.length > 0
        ? {
            selection: CMEditorSelection.create(
              selections.map((selection) =>
                CMEditorSelection.range(
                  this.posToOffset(selection.from),
                  this.posToOffset(selection.to ?? selection.from)
                )
              )
            ),
          }
        : {}),
    });
  }

  posToOffset(pos: EditorPosition): number {
    const lineNumber = Math.max(
      1,
      Math.min(pos.line + 1, this.view.state.doc.lines)
    );
    const line = this.view.state.doc.line(lineNumber);
    return Math.max(line.from, Math.min(line.from + pos.ch, line.to));
  }

  offsetToPos(offset: number): EditorPosition {
    const clampedOffset = Math.max(
      0,
      Math.min(offset, this.view.state.doc.length)
    );
    const line = this.view.state.doc.lineAt(clampedOffset);
    return { line: line.number - 1, ch: clampedOffset - line.from };
  }
}

/** Concrete constructor type for the embedded editor (non-abstract). */
type EditorConstructor = new (
  // eslint-disable-next-line no-unused-vars -- type parameter names
  hostApp: App,
  // eslint-disable-next-line no-unused-vars -- type parameter names
  container: HTMLElement,
  // eslint-disable-next-line no-unused-vars -- type parameter names
  options: Partial<MarkdownEditorProps>
) => EmbeddableMarkdownEditorInstance;

/** Builds the `EmbeddableMarkdownEditor` class against the resolved base. */
function defineEditorClass(): EditorConstructor {
  const Base = getEditorBase();

  class EmbeddableMarkdownEditor
    extends Base
    implements EmbeddableMarkdownEditorInstance
  {
    options: ResolvedMarkdownEditorProps;
    initial_value: string;
    scope: Scope;
    private uninstaller?: () => void;
    private hasEnteredVimInsertMode = false;
    private activeEditorOwner: ActiveMarkdownEditorOwner;

    constructor(
      hostApp: App,
      container: HTMLElement,
      options: Partial<MarkdownEditorProps> = {}
    ) {
      super(hostApp, container, {
        app: hostApp,
        onMarkdownScroll: () => {},
        getMode: () => "source",
      });

      this.options = { ...defaultProperties, ...options };
      this.initial_value = this.options.value;
      this.scope = new Scope(this.app.scope);

      // Override Mod+Enter to prevent default workspace behavior.
      this.scope.register(["Mod"], "Enter", () => true);
      this.scope.register(["Mod", "Shift"], "Enter", () => true);
      // Claim Ctrl/Cmd+S so it reaches `onSave` instead of being swallowed
      // by Obsidian's global keymap. Returning false marks it handled
      // (preventDefault); returning true lets it fall through when `onSave`
      // declines to handle it.
      this.scope.register(["Mod"], "s", () => !this.options.onSave(this));

      this.owner.editMode = this;
      this.owner.editor = this.editor;
      this.activeEditorOwner = {
        editMode: this,
        editor: new CodeMirrorEditorAdapter(
          this.editor.cm as unknown as EditorView
        ) as unknown as Editor,
        file: this.getActiveEditorFile(),
      };

      // From Obsidian 1.5.8+, the value must be set explicitly.
      this.set(options.value || "");

      // Prevent the workspace from stealing focus while editing.
      this.uninstaller = around(
        this.app.workspace as unknown as Record<
          string,
          // eslint-disable-next-line no-unused-vars -- type parameter names
          (...args: unknown[]) => unknown
        >,
        {
          setActiveLeaf: (oldMethod) => {
            return function (this: ActiveLeafContext, ...args: unknown[]) {
              if (!this.activeCM?.hasFocus) {
                oldMethod.call(this, ...args);
              }
            };
          },
        }
      );

      // Always pop the scope on blur so it stays balanced with the
      // focusin push below (the scope outlives a single focus otherwise).
      this.editor.cm.contentDOM.addEventListener("blur", () => {
        this.app.keymap.popScope(this.scope);
        if (this._loaded) this.options.onBlur(this);
      });

      this.editor.cm.contentDOM.addEventListener("focusin", () => {
        this.app.keymap.pushScope(this.scope);
        this.activeEditorOwner.file = this.getActiveEditorFile();
        (this.app.workspace as unknown as WorkspaceWithActiveEditor).activeEditor =
          this.activeEditorOwner;

        if (this.options.enterVimInsertMode && !this.hasEnteredVimInsertMode) {
          this.hasEnteredVimInsertMode = true;
          this.enterVimInsertMode();
        }
      });

      if (options.cls) {
        this.editorEl.classList.add(options.cls);
      }

      if (options.cursorLocation) {
        this.editor.cm.dispatch({
          selection: CMEditorSelection.range(
            options.cursorLocation.anchor,
            options.cursorLocation.head
          ),
        });
      }
    }

    private getActiveEditorFile(): TFile | null {
      if (this.options.file !== undefined) {
        return this.options.file ?? null;
      }
      return this.app.workspace.getActiveFile();
    }

    /** The current text content of the editor. */
    get value(): string {
      return this.editor.cm.state.doc.toString();
    }

    /** Replace the text content of the editor. */
    setValue(value: string): void {
      this.set(value);
    }

    /** Enter vim insert mode if vim keybindings are enabled in Obsidian. */
    private enterVimInsertMode(): void {
      window.setTimeout(() => {
        try {
          const vimModeEnabled = (
            this.app.vault as unknown as VaultWithConfig
          ).getConfig("vimMode");
          if (!vimModeEnabled) return;

          const Vim = (window as unknown as WindowWithCodeMirrorAdapter)
            .CodeMirrorAdapter?.Vim;
          if (!Vim) return;

          const cm5 = this.editor.cm.cm ?? this.activeCM;
          if (!cm5) return;

          Vim.handleKey(cm5, "i", "api");
        } catch {
          // Silently fail if vim integration isn't available.
        }
      }, 50);
    }

    /** Override to propagate content changes. */
    onUpdate(update: ViewUpdate, changed: boolean): void {
      super.onUpdate(update, changed);
      if (changed) {
        this.options.onChange(this.value, update);
      }
    }

    /** Build CodeMirror extensions: placeholder, paste and keyboard handlers. */
    buildLocalExtensions(): Extension[] {
      const extensions = super.buildLocalExtensions();

      extensions.push(tooltips({ parent: activeDocument.body }));

      if (this.options.placeholder) {
        extensions.push(placeholder(this.options.placeholder));
      }

      extensions.push(
        EditorView.domEventHandlers({
          paste: (event) => {
            this.options.onPaste(event, this);
          },
        })
      );

      extensions.push(
        Prec.highest(
          keymap.of([
            {
              key: "Enter",
              run: () => this.options.onEnter(this, false, false),
              shift: () => this.options.onEnter(this, false, true),
            },
            {
              key: "Shift-Mod-Enter",
              run: () => {
                this.options.onSubmit(this, true);
                return true;
              },
            },
            {
              key: "Mod-Enter",
              run: () => {
                this.options.onSubmit(this, false);
                return true;
              },
            },
            {
              key: "Escape",
              run: () => {
                this.options.onEscape(this);
                return true;
              },
            },
            {
              key: "Tab",
              run: () => this.options.onTab(this, false),
            },
            {
              key: "Shift-Tab",
              run: () => this.options.onTab(this, true),
            },
          ])
        )
      );

      if (this.options.extensions && this.options.extensions.length > 0) {
        extensions.push(...this.options.extensions);
      }

      return extensions;
    }

    /** Clean up the editor and remove all event listeners. */
    destroy(): void {
      if (this._loaded) {
        this.unload();
      }

      this.app.keymap.popScope(this.scope);
      const workspace = this.app
        .workspace as unknown as WorkspaceWithActiveEditor;
      if (workspace.activeEditor === this.activeEditorOwner) {
        workspace.activeEditor = null;
      }

      if (this.uninstaller) {
        this.uninstaller();
        this.uninstaller = undefined;
      }

      this.containerEl.empty();
      super.destroy();
    }

    onunload(): void {
      this.destroy();
    }
  }

  return EmbeddableMarkdownEditor as unknown as EditorConstructor;
}

let cachedEditorClass: EditorConstructor | null = null;

/**
 * Create an embedded markdown editor inside `container`. The underlying class
 * is resolved from Obsidian internals on first call and cached thereafter.
 * Throws if the internal editor prototype cannot be resolved.
 */
export function createEmbeddableMarkdownEditor(
  hostApp: App,
  container: HTMLElement,
  options: Partial<MarkdownEditorProps>
): EmbeddableMarkdownEditorInstance {
  if (!cachedEditorClass) {
    cachedEditorClass = defineEditorClass();
  }
  return new cachedEditorClass(hostApp, container, options);
}
