import React from "react";
import {
  HoverParent,
  HoverPopover,
  Keymap,
  MarkdownView,
  Menu,
  PaneType,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { createRoot, Root } from "react-dom/client";
import NoteContextStrip, {
  NoteContextActions,
} from "src/components/note-context-strip";
import { getStatusCategory } from "src/lib/branch-model";
import {
  buildNoteContext,
  findNoteContextAnchors,
  getNoteContextTitle,
} from "src/lib/note-context";
import { getNoteTasks } from "src/lib/utils";
import { DEFAULT_EMBED_CONFIG } from "src/types/embed-config";
import { createDefaultFilterState } from "src/types/filter-state";
import { BaseTask } from "src/types/task";
import type TasksMapPlugin from "src/main";
import TaskMapGraphEmbedView from "./TaskMapGraphEmbedView";
import {
  collectGroupValues,
  menuPointBelow,
  showContextMenu,
  showPriorityMenu,
  showStatusMenu,
  showTaskEditMenu,
} from "./note-context-menus";

/**
 * A note that is not a task (a chat, a meeting log) only gets a strip when
 * a handful of tasks claim it; a daily note linked from every task does not.
 */
export const NOTE_CONTEXT_MAX_LINKED_ANCHORS = 3;

const WIDGET_CLASS = "tasks-map-note-context-host";

interface Widget {
  el: HTMLElement;
  root: Root;
  hoverParent: HoverParent;
}

interface ResolvedContext {
  key: string;
  render: (_widget: Widget) => React.ReactElement;
}

class StripHoverParent implements HoverParent {
  hoverPopover: HoverPopover | null = null;
}

/**
 * Places the task context strip between a note's properties and its body,
 * in Live Preview and in reading view.
 *
 * Obsidian has no API for that spot, so the strip is inserted into the
 * view's DOM (as TaskNotes does for its task card):
 * - Live Preview: inside `.cm-sizer`, right before `.cm-contentContainer`.
 * - Reading view: inside the note header, after `.metadata-container`.
 *   Reading view deletes unknown *direct* children of its sizer on every
 *   render pass, but leaves the header's own children alone.
 * A MutationObserver puts the strip back when Obsidian rebuilds either.
 */
export class NoteContextInjector {
  private tasks: BaseTask[] | null = null;
  private widgets = new Map<HTMLElement, Widget>();
  private observers = new Map<HTMLElement, MutationObserver>();
  private anchorChoice = new Map<string, number>();
  private refreshTimer: number | null = null;
  private placementFrame: number | null = null;

  private plugin: TasksMapPlugin;

  constructor(plugin: TasksMapPlugin) {
    this.plugin = plugin;
  }

  load(): void {
    const { app } = this.plugin;
    const refresh = () => this.scheduleRefresh(50);
    const invalidate = () => {
      this.tasks = null;
      this.scheduleRefresh(300);
    };
    this.plugin.registerEvent(app.workspace.on("layout-change", refresh));
    this.plugin.registerEvent(app.workspace.on("active-leaf-change", refresh));
    this.plugin.registerEvent(app.workspace.on("file-open", refresh));
    this.plugin.registerEvent(app.metadataCache.on("changed", invalidate));
    this.plugin.registerEvent(app.metadataCache.on("resolved", invalidate));
    this.plugin.registerEvent(app.vault.on("rename", invalidate));
    this.plugin.registerEvent(app.vault.on("delete", invalidate));
    const onSettingsChanged = () => {
      this.tasks = null;
      // Statuses, priorities and chip order are not in the render key.
      this.widgets.forEach((widget) => delete widget.el.dataset.key);
      this.refreshAll();
    };
    window.addEventListener("tasks-map:settings-changed", onSettingsChanged);
    this.plugin.register(() =>
      window.removeEventListener(
        "tasks-map:settings-changed",
        onSettingsChanged
      )
    );
    app.workspace.onLayoutReady(() => this.refreshAll());
  }

  unload(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    if (this.placementFrame !== null)
      window.cancelAnimationFrame(this.placementFrame);
    this.observers.forEach((observer) => observer.disconnect());
    this.observers.clear();
    [...this.widgets.keys()].forEach((container) => this.remove(container));
  }

  private scheduleRefresh(delay: number): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshAll();
    }, delay);
  }

  private refreshAll(): void {
    const containers = new Set<HTMLElement>();
    for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
      this.refreshLeaf(leaf).forEach((container) => containers.add(container));
    }
    // Drop strips of closed leaves.
    [...this.widgets.keys()]
      .filter((container) => !containers.has(container))
      .forEach((container) => this.remove(container));
    [...this.observers.entries()]
      .filter(([el]) => !el.isConnected)
      .forEach(([el, observer]) => {
        observer.disconnect();
        this.observers.delete(el);
      });
  }

  /** Render or remove the strip in both of the leaf's mode containers. */
  private refreshLeaf(leaf: WorkspaceLeaf): HTMLElement[] {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return [];
    this.observe(view.containerEl);
    const source = getSourceSizer(view);
    const preview = getPreviewSizer(view);
    const containers = [source, preview].filter(
      (el): el is HTMLElement => !!el
    );
    const file = view.file;
    const resolved = file ? this.resolve(file) : null;
    const sourceMode = view.getState().source === true;

    for (const container of containers) {
      // Raw source mode shows the YAML inside the text; there is no spot
      // between properties and body there.
      if (!resolved || (container === source && sourceMode)) {
        this.remove(container);
        continue;
      }
      const widget = this.widgets.get(container) ?? this.create(container);
      if (widget.el.dataset.key !== resolved.key) {
        widget.el.dataset.key = resolved.key;
        widget.root.render(resolved.render(widget));
      }
      place(container, widget.el, container === source);
    }
    return containers;
  }

  private resolve(file: TFile): ResolvedContext | null {
    const style = this.plugin.settings.noteContextStyle;
    if (style === "off") return null;
    const tasks = this.getTasks();
    const anchors = this.getAnchors(file.path, tasks);
    if (anchors.length === 0) return null;
    const linked = anchors[0] !== file.path;
    if (linked && anchors.length > NOTE_CONTEXT_MAX_LINKED_ANCHORS) return null;

    const statuses = this.plugin.settings.taskStatuses;
    const index = (this.anchorChoice.get(file.path) ?? 0) % anchors.length;
    const context = buildNoteContext(anchors[index], tasks, statuses, {
      requireRelations: !linked,
    });
    if (!context) return null;

    const key = JSON.stringify([
      style,
      file.path,
      index,
      anchors.length,
      [
        context.task,
        ...context.ancestors,
        ...context.otherParents,
        ...context.siblings,
        ...context.children,
      ].map((task) => [task.id, getNoteContextTitle(task), task.status]),
      [
        context.task.priority,
        context.task.dueDate,
        context.task.starred,
        context.task.today,
        context.task.groupValues,
      ],
      context.ancestors.length,
      context.otherParents.length,
      context.siblings.length,
    ]);
    const onNextAnchor = () => {
      this.anchorChoice.set(file.path, index + 1);
      this.refreshAll();
    };
    return {
      key,
      render: (widget) => (
        <NoteContextStrip
          key={`${file.path}:${context.task.id}`}
          context={context}
          displayStyle={style}
          statuses={statuses}
          priorities={this.plugin.getTaskPriorityOptions()}
          linked={linked}
          anchorIndex={index}
          anchorCount={anchors.length}
          onNextAnchor={onNextAnchor}
          actions={this.createActions(file.path, widget)}
        />
      ),
    };
  }

  private getTasks(): BaseTask[] {
    this.tasks ??= getNoteTasks(
      this.plugin.app,
      this.plugin.getNoteTaskSettings(),
      this.plugin.settings.taskStatuses
    );
    return this.tasks;
  }

  private getAnchors(notePath: string, tasks: BaseTask[]): string[] {
    const { metadataCache } = this.plugin.app;
    const taskIds = new Set(tasks.map((task) => task.id));
    if (taskIds.has(notePath)) return [notePath];
    const resolvedLinks = metadataCache.resolvedLinks;
    const linksToNote = tasks
      .filter((task) => (resolvedLinks[task.id]?.[notePath] ?? 0) > 0)
      .map((task) => task.id);
    // Only the note's own properties count as outgoing claims: a body that
    // mentions a task is not the same as belonging to it.
    const file = this.plugin.app.vault.getFileByPath(notePath);
    const frontmatterLinks = file
      ? (metadataCache.getFileCache(file)?.frontmatterLinks ?? [])
      : [];
    const linksFromNote = frontmatterLinks
      .map(
        (link) => metadataCache.getFirstLinkpathDest(link.link, notePath)?.path
      )
      .filter((path): path is string => !!path);
    return findNoteContextAnchors(
      notePath,
      taskIds,
      linksToNote,
      linksFromNote
    );
  }

  private createActions(notePath: string, widget: Widget): NoteContextActions {
    const { app } = this.plugin;
    const statuses = this.plugin.settings.taskStatuses;
    // Menus open under the button that was clicked, not at the pointer.
    const below = (event: React.MouseEvent) =>
      menuPointBelow(
        event.currentTarget instanceof Element
          ? event.currentTarget.getBoundingClientRect()
          : null,
        { x: event.clientX, y: event.clientY }
      );
    const contextSource = () => ({
      property: this.plugin.settings.branchProperties.groupProperty,
      knownValues: collectGroupValues(this.getTasks()),
    });
    const open = (task: BaseTask, newTab: PaneType | boolean) => {
      void app.workspace.openLinkText(task.link, notePath, newTab);
    };
    return {
      open: (task, event) => open(task, Keymap.isModEvent(event.nativeEvent)),
      hover: (task, event, el) => {
        app.workspace.trigger("hover-link", {
          event: event.nativeEvent,
          source: this.plugin.manifest.id,
          hoverParent: widget.hoverParent,
          targetEl: el,
          linktext: task.link,
          sourcePath: notePath,
        });
      },
      openInMap: (task, rootId) => this.plugin.focusTaskInMap(task.id, rootId),
      renderProjectMap: (rootId, taskId, height) => (
        <TaskMapGraphEmbedView
          plugin={this.plugin}
          initialFilter={createDefaultFilterState(
            this.plugin.settings.defaultStatusFilter
          )}
          embedConfig={{
            ...DEFAULT_EMBED_CONFIG,
            height,
            showMinimap: false,
            showFilterPanel: false,
            showPresetsPanel: false,
            showUnlinkedPanel: false,
            showStatusCounts: false,
            showProjectBar: false,
          }}
          hoverParent={widget.hoverParent}
          initialFocus={{
            kind: "project-overview",
            taskId,
            rootTaskIds: [rootId],
          }}
        />
      ),
      showStatusMenu: (task, event) =>
        showStatusMenu(app, task, statuses, below(event)),
      showPriorityMenu: (task, event) =>
        showPriorityMenu(
          app,
          task,
          this.plugin.getTaskPriorityOptions(),
          below(event)
        ),
      showContextMenu: (task, event) =>
        showContextMenu(app, task, contextSource(), below(event)),
      showTaskMenu: (task, event) =>
        showTaskEditMenu(
          app,
          task,
          this.plugin.getTaskPriorityOptions(),
          contextSource(),
          below(event)
        ),
      showMenu: (tasks, event) => {
        const menu = new Menu();
        for (const task of tasks) {
          const category = getStatusCategory(task.status, statuses);
          menu.addItem((item) =>
            item
              .setTitle(getNoteContextTitle(task))
              .setIcon(
                category === "closed"
                  ? "circle-check"
                  : category === "active"
                    ? "circle-dot"
                    : "circle"
              )
              .onClick((clickEvent) =>
                open(
                  task,
                  clickEvent instanceof MouseEvent &&
                    Keymap.isModEvent(clickEvent)
                )
              )
          );
        }
        menu.showAtPosition(below(event));
      },
    };
  }

  private create(container: HTMLElement): Widget {
    const el = container.ownerDocument.createElement("div");
    el.className = WIDGET_CLASS;
    el.setAttribute("contenteditable", "false");
    const widget = {
      el,
      root: createRoot(el),
      hoverParent: new StripHoverParent(),
    };
    this.widgets.set(container, widget);
    return widget;
  }

  private remove(container: HTMLElement): void {
    const widget = this.widgets.get(container);
    if (!widget) return;
    widget.root.unmount();
    widget.el.remove();
    this.widgets.delete(container);
  }

  /** Re-place strips that Obsidian moved or dropped while re-rendering. */
  private observe(viewEl: HTMLElement): void {
    if (this.observers.has(viewEl)) return;
    const observer = new MutationObserver(() => {
      if (this.placementFrame !== null) return;
      this.placementFrame = window.requestAnimationFrame(() => {
        this.placementFrame = null;
        this.widgets.forEach((widget, container) => {
          if (!container.isConnected) return;
          const isSource = container.classList.contains("cm-sizer");
          place(container, widget.el, isSource);
        });
      });
    });
    observer.observe(viewEl, { childList: true, subtree: true });
    this.observers.set(viewEl, observer);
  }
}

function getSourceSizer(view: MarkdownView): HTMLElement | null {
  return view.containerEl.querySelector<HTMLElement>(
    ".markdown-source-view .cm-sizer"
  );
}

function getPreviewSizer(view: MarkdownView): HTMLElement | null {
  return view.containerEl.querySelector<HTMLElement>(
    ".markdown-reading-view .markdown-preview-sizer"
  );
}

function directChildWithClass(
  container: HTMLElement,
  className: string
): HTMLElement | null {
  for (const child of Array.from(container.children)) {
    if (child.classList.contains(className)) return child as HTMLElement;
  }
  return null;
}

/** Put `el` under the properties; a no-op when it is already there. */
function place(container: HTMLElement, el: HTMLElement, isSource: boolean) {
  if (isSource) {
    const content = directChildWithClass(container, "cm-contentContainer");
    if (!content) return;
    if (el.nextElementSibling !== content) container.insertBefore(el, content);
    return;
  }
  // While the header is scrolled out of reading view's render window it
  // is detached together with the strip; it comes back with it.
  const header = directChildWithClass(container, "mod-header");
  if (!header) return;
  const metadata = header.querySelector(".metadata-container");
  if (metadata?.parentElement) {
    if (el.previousElementSibling !== metadata) metadata.after(el);
    return;
  }
  if (el.parentElement !== header || header.lastElementChild !== el)
    header.appendChild(el);
}
