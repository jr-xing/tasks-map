import React, { useState, useEffect, useCallback, useMemo } from "react";
import { ItemView, WorkspaceLeaf } from "obsidian";
import type { HoverParent, ViewStateResult } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import { ReactFlowProvider } from "reactflow";
import { AppContext, TaskHoverPreviewContext } from "src/contexts/context";
import TaskMapGraphView from "./TaskMapGraphView";
import TasksMapPlugin from "../main";
import { TasksMapSettings } from "src/types/settings";
import { FilterState, createDefaultFilterState } from "src/types/filter-state";
import { TaskMapFocusRequest } from "src/types/focus-request";
import { t } from "../i18n";
import type { LiveMapVisibilityContext } from "src/lib/note-visibility";
import type { TaskMapNavigationContext } from "src/lib/project-navigation";
import { TaskFocusRequests } from "src/lib/task-focus-requests";
import {
  MapLayoutOptions,
  MapLayoutOverrides,
  applyMapLayout,
  parseMapLayoutState,
  resolveMapLayout,
  toggledLayoutDirection,
  toggledLayoutMode,
} from "src/lib/map-layout-options";

// Wrapper component that manages settings updates and filter state for the graph view
function TaskMapGraphWrapper({
  pluginSettings,
  plugin,
  initialFocusRequest,
  onFilterStateChange,
  onFocusRequestHandled,
  onFocusRequestHandlerChange,
  onVisibilityContextChange,
  onReloadHandlerChange,
  onNavigationContextChange,
  onResizeHandlerChange,
  hoverParent,
  initialLayout,
  onLayoutChange,
  onLayoutListenerChange,
}: {
  pluginSettings: TasksMapSettings;
  plugin: TasksMapPlugin;
  initialFocusRequest: TaskMapFocusRequest | null;
  onFilterStateChange: (_state: FilterState) => void;
  onFocusRequestHandled: () => void;
  onFocusRequestHandlerChange: (
    _handler: ((_request: TaskMapFocusRequest) => void) | null
  ) => void;
  onVisibilityContextChange: (
    _context: LiveMapVisibilityContext | null
  ) => void;
  onReloadHandlerChange: (_handler: (() => void) | null) => void;
  onNavigationContextChange: (_context: TaskMapNavigationContext) => void;
  onResizeHandlerChange: (_handler: (() => void) | null) => void;
  hoverParent: HoverParent;
  initialLayout: MapLayoutOverrides;
  onLayoutChange: (_patch: Partial<MapLayoutOptions>) => void;
  onLayoutListenerChange: (
    _listener: ((_layout: MapLayoutOverrides) => void) | null
  ) => void;
}) {
  const [baseSettings, setBaseSettings] = useState<TasksMapSettings>({
    ...pluginSettings,
  });
  const [layoutOverrides, setLayoutOverrides] =
    useState<MapLayoutOverrides>(initialLayout);
  const settings = useMemo(
    () => applyMapLayout(baseSettings, layoutOverrides),
    [baseSettings, layoutOverrides]
  );

  useEffect(() => {
    onLayoutListenerChange((layout) => setLayoutOverrides({ ...layout }));
    return () => onLayoutListenerChange(null);
  }, [onLayoutListenerChange]);

  useEffect(() => {
    const handler = () => setBaseSettings({ ...plugin.settings });
    window.addEventListener("tasks-map:settings-changed", handler);
    return () =>
      window.removeEventListener("tasks-map:settings-changed", handler);
  }, [plugin]);

  // Seed the status filter from the configured default so the map opens with
  // the user's preferred statuses visible instead of always showing all.
  const [filterState, setFilterState] = useState<FilterState>(() =>
    createDefaultFilterState(plugin.settings.defaultStatusFilter)
  );
  const [focusRequest, setFocusRequest] = useState<TaskMapFocusRequest | null>(
    initialFocusRequest
  );
  const hoverPreviewContextValue = useMemo(
    () => ({ source: plugin.manifest.id, hoverParent }),
    [hoverParent, plugin.manifest.id]
  );

  useEffect(() => {
    onFocusRequestHandlerChange((request) => {
      setFocusRequest({ ...request });
    });
    return () => onFocusRequestHandlerChange(null);
  }, [onFocusRequestHandlerChange]);

  const handleSetFilterState = useCallback(
    (state: FilterState | ((_prev: FilterState) => FilterState)) => {
      setFilterState((prev) => {
        const next = typeof state === "function" ? state(prev) : state;
        onFilterStateChange(next);
        return next;
      });
    },
    [onFilterStateChange]
  );

  return (
    <TaskHoverPreviewContext.Provider value={hoverPreviewContextValue}>
      <ReactFlowProvider>
        <TaskMapGraphView
          settings={settings}
          filterState={filterState}
          setFilterState={handleSetFilterState}
          plugin={plugin}
          focusRequest={focusRequest}
          onFocusRequestHandled={() => {
            setFocusRequest(null);
            onFocusRequestHandled();
          }}
          onVisibilityContextChange={onVisibilityContextChange}
          onReloadHandlerChange={onReloadHandlerChange}
          onNavigationContextChange={onNavigationContextChange}
          onResizeHandlerChange={onResizeHandlerChange}
          onLayoutChange={onLayoutChange}
        />
      </ReactFlowProvider>
    </TaskHoverPreviewContext.Provider>
  );
}

export const VIEW_TYPE = "tasks-map-graph-view";

export default class TaskMapGraphItemView extends ItemView {
  root: Root | null = null;
  private filterState: FilterState;
  private plugin: TasksMapPlugin;
  private focusRequests = new TaskFocusRequests();
  private visibilityContext: LiveMapVisibilityContext | null = null;
  private reloadHandler: (() => void) | null = null;
  private resizeHandler: (() => void) | null = null;
  private navigationContext: TaskMapNavigationContext = {
    selectedTaskIds: [],
    focusedTaskId: null,
  };
  private layoutOverrides: MapLayoutOverrides = {};
  private layoutListener: ((_layout: MapLayoutOverrides) => void) | null = null;
  private layoutActionEl: HTMLElement | null = null;

  getNavigationContext(): TaskMapNavigationContext {
    return structuredClone(this.navigationContext);
  }

  constructor(leaf: WorkspaceLeaf, plugin: TasksMapPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.filterState = createDefaultFilterState(
      this.plugin.settings.defaultStatusFilter
    );
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return t("view.title");
  }

  /** Returns the current filter state of the open Tasks Map view. */
  getFilterState(): FilterState {
    return structuredClone(this.filterState);
  }

  getVisibilityContext(): LiveMapVisibilityContext | null {
    if (!this.visibilityContext) return null;
    return {
      ...this.visibilityContext,
      tasks: [...this.visibilityContext.tasks],
      filter: structuredClone(this.visibilityContext.filter),
      droppedTaskIds: [...this.visibilityContext.droppedTaskIds],
      visibleNodeIds: [...this.visibilityContext.visibleNodeIds],
      foldedNodeIds: [...this.visibilityContext.foldedNodeIds],
      projectRootTaskIds: this.visibilityContext.projectRootTaskIds?.slice(),
    };
  }

  reloadTasks(): boolean {
    if (!this.reloadHandler) return false;
    this.reloadHandler();
    return true;
  }

  focus(request: TaskMapFocusRequest): void {
    this.focusRequests.send(request);
  }

  onResize(): void {
    this.resizeHandler?.();
  }

  getState(): Record<string, unknown> {
    return { ...super.getState(), ...this.layoutOverrides };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    this.layoutOverrides = parseMapLayoutState(state);
    this.publishLayout();
    await super.setState(state, result);
  }

  /** The layout this tab renders with (its overrides over the defaults). */
  getLayout(): MapLayoutOptions {
    return resolveMapLayout(this.plugin.settings, this.layoutOverrides);
  }

  /** Change this tab's layout only; other map tabs keep theirs. */
  setLayout(patch: Partial<MapLayoutOptions>): void {
    this.layoutOverrides = { ...this.layoutOverrides, ...patch };
    this.publishLayout();
    this.app.workspace.requestSaveLayout();
  }

  toggleLayoutMode(): void {
    this.setLayout({
      layoutMode: toggledLayoutMode(this.getLayout().layoutMode),
    });
  }

  toggleLayoutDirection(): void {
    this.setLayout({
      layoutDirection: toggledLayoutDirection(this.getLayout().layoutDirection),
    });
  }

  private publishLayout(): void {
    this.layoutListener?.(this.layoutOverrides);
    this.updateLayoutAction();
  }

  private updateLayoutAction(): void {
    const actionEl = this.layoutActionEl;
    if (!actionEl) return;
    const isTree = this.getLayout().layoutMode === "tree";
    const label = t(isTree ? "view.switch_to_graph" : "view.switch_to_tree");
    actionEl.setAttribute("aria-label", label);
    actionEl.toggleClass("is-active", isTree);
  }

  async onOpen() {
    this.layoutActionEl = this.addAction(
      "git-branch",
      t("view.switch_to_tree"),
      () => this.toggleLayoutMode()
    );
    this.updateLayoutAction();
    this.root = createRoot(this.containerEl.children[1]);

    this.root.render(
      <AppContext.Provider value={this.app}>
        <TaskMapGraphWrapper
          pluginSettings={this.plugin.settings}
          plugin={this.plugin}
          initialFocusRequest={this.focusRequests.pending}
          onFilterStateChange={(state) => {
            this.filterState = state;
          }}
          onFocusRequestHandled={() => {
            this.focusRequests.handled();
          }}
          onFocusRequestHandlerChange={(handler) => {
            this.focusRequests.attach(handler);
          }}
          onVisibilityContextChange={(context) => {
            this.visibilityContext = context;
          }}
          onReloadHandlerChange={(handler) => {
            this.reloadHandler = handler;
          }}
          onNavigationContextChange={(context) => {
            this.navigationContext = context;
          }}
          onResizeHandlerChange={(handler) => {
            this.resizeHandler = handler;
          }}
          hoverParent={this.leaf}
          initialLayout={this.layoutOverrides}
          onLayoutChange={(patch) => this.setLayout(patch)}
          onLayoutListenerChange={(listener) => {
            this.layoutListener = listener;
            listener?.(this.layoutOverrides);
          }}
        />
      </AppContext.Provider>
    );
  }

  async onClose() {
    this.focusRequests.attach(null);
    this.focusRequests.handled();
    this.visibilityContext = null;
    this.reloadHandler = null;
    this.resizeHandler = null;
    this.layoutListener = null;
    this.layoutActionEl = null;
    this.root?.unmount();
  }
}
