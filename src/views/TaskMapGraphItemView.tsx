import React, { useState, useEffect, useCallback } from "react";
import { ItemView, WorkspaceLeaf } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import { ReactFlowProvider } from "reactflow";
import { AppContext } from "src/contexts/context";
import TaskMapGraphView from "./TaskMapGraphView";
import TasksMapPlugin from "../main";
import { TasksMapSettings } from "src/types/settings";
import { FilterState, createDefaultFilterState } from "src/types/filter-state";
import { TaskMapFocusRequest } from "src/types/focus-request";
import { t } from "../i18n";
import type { LiveMapVisibilityContext } from "src/lib/note-visibility";

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
}) {
  const [settings, setSettings] = useState<TasksMapSettings>({
    ...pluginSettings,
  });

  useEffect(() => {
    const handler = () => setSettings({ ...plugin.settings });
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
      />
    </ReactFlowProvider>
  );
}

export const VIEW_TYPE = "tasks-map-graph-view";

export default class TaskMapGraphItemView extends ItemView {
  root: Root | null = null;
  private filterState: FilterState;
  private plugin: TasksMapPlugin;
  private focusRequest: TaskMapFocusRequest | null = null;
  private focusRequestHandler:
    | ((_request: TaskMapFocusRequest) => void)
    | null = null;
  private visibilityContext: LiveMapVisibilityContext | null = null;
  private reloadHandler: (() => void) | null = null;

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
    };
  }

  reloadTasks(): boolean {
    if (!this.reloadHandler) return false;
    this.reloadHandler();
    return true;
  }

  focus(request: TaskMapFocusRequest): void {
    this.focusRequest = request;
    this.focusRequestHandler?.(request);
  }

  async onOpen() {
    this.root = createRoot(this.containerEl.children[1]);

    this.root.render(
      <AppContext.Provider value={this.app}>
        <TaskMapGraphWrapper
          pluginSettings={this.plugin.settings}
          plugin={this.plugin}
          initialFocusRequest={this.focusRequest}
          onFilterStateChange={(state) => {
            this.filterState = state;
          }}
          onFocusRequestHandled={() => {
            this.focusRequest = null;
          }}
          onFocusRequestHandlerChange={(handler) => {
            this.focusRequestHandler = handler;
          }}
          onVisibilityContextChange={(context) => {
            this.visibilityContext = context;
          }}
          onReloadHandlerChange={(handler) => {
            this.reloadHandler = handler;
          }}
        />
      </AppContext.Provider>
    );
  }

  async onClose() {
    this.focusRequestHandler = null;
    this.visibilityContext = null;
    this.reloadHandler = null;
    this.root?.unmount();
  }
}
