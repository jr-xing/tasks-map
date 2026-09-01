import React, { useEffect, useCallback, useMemo, useRef } from "react";
import ReactFlow, {
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  getNodesBounds,
  getViewportForBounds,
  PanOnScrollMode,
  type Node,
  type NodeDragHandler,
  type NodeMouseHandler,
  type SelectionDragHandler,
} from "reactflow";
import { Notice } from "obsidian";
import { Plus } from "lucide-react";
import { useApp } from "src/hooks/hooks";
import {
  addLinkSignsBetweenTasks,
  addSignToTaskInFile,
  getAllTasks,
  removeLinkSignsBetweenTasks,
  createNodesFromTasks,
  createEdgesFromTasks,
  getUnlinkedTasks,
  addTaskLineToVault,
  deleteTaskFromVault,
  getTasksApi,
  parseTaskLine,
  updateTaskStatusInVault,
} from "src/lib/utils";
import { BaseTask, TaskNodeData, TaskStatus } from "src/types/task";
import {
  getTaskNotesConfig,
  isTaskNotesTaskFile,
  isTaskNotesEditorAvailable,
} from "src/lib/tasknotes-bridge";
import { isTaskNodeHeaderEventTarget } from "src/lib/task-node-events";
import TaskEditorPanel from "src/components/task-editor-panel";
import { NoteTask } from "src/types/note-task";
import GuiOverlay from "src/components/gui-overlay";
import FilterPresetsPanel from "src/components/filter-presets-panel";
import StatusCountsOverlay from "src/components/status-counts-overlay";
import TaskNode from "src/components/task-node";
import ProjectGroupNode from "src/components/project-group-node";
import {
  getFilteredNodeIds,
  getVisibilityFilteredNodeIds,
} from "src/lib/filter-tasks";
import { TaskMinimap } from "src/components/task-minimap";
import HashEdge from "src/components/hash-edge";
import { DeleteEdgeButton } from "src/components/delete-edge-button";
import { TagsContext, StatusConfigContext } from "src/contexts/context";
import UnlinkedTasksPanel, {
  DRAG_DATA_KEY,
} from "src/components/unlinked-tasks-panel";
import ProjectTreePanel from "src/components/project-tree-panel";
import KanbanPanel from "src/components/kanban-panel";
import LeftRail, { RailPanelId } from "src/components/left-rail";
import { GraphEmptyState } from "src/components/graph-empty-state";
import ControlsPanel from "src/components/controls-panel";
import { createTaskFocusFilter } from "src/lib/task-focus-picker";
import { TasksMapSettings } from "src/types/settings";
import { FilterState } from "src/types/filter-state";
import { EmbedConfig, DEFAULT_EMBED_CONFIG } from "src/types/embed-config";
import { TaskInsertPosition } from "src/types/base-task";
import { TaskMapFocusRequest } from "src/types/focus-request";
import { TaskPriorityConfig } from "src/lib/priority-config";
import {
  buildKanbanFocusOptions,
  getKanbanTasks,
  moveKanbanTaskStatus,
} from "src/lib/kanban";
import { getVisibleMapViewport } from "src/lib/visible-map-viewport";
import type { LiveMapVisibilityContext } from "src/lib/note-visibility";
import { normalizeTaskNotesTypeSchemaPath } from "src/lib/tasknotes-type-schema";
import {
  VaultWatcher,
  type RefreshRequestOptions,
  type VaultWriteTracker,
} from "src/lib/vault-watcher";
import {
  createLayoutSnapshot,
  packLayoutSnapshot,
  type LayoutSnapshot,
  type LayoutViewport,
} from "src/lib/layout";
import { t } from "../i18n";
import TasksMapPlugin from "../main";

interface ReloadTasksOptions {
  auto?: boolean;
}

type NodePosition = Node["position"];

const RESIZE_PACKING_DEBOUNCE_MS = 300;

const REFRESH_BLOCKING_SELECTOR = [
  ".tasks-map-tag-select__control",
  ".tasks-map-quick-update-popover",
  ".tasks-map-editor-panel",
].join(",");

function isRefreshBlockingTarget(target: EventTarget | null): boolean {
  const candidate = target as {
    closest?: (_selector: string) => Element | null;
  };
  return candidate?.closest?.(REFRESH_BLOCKING_SELECTOR) != null;
}

function cloneTaskWithUpdates(
  task: BaseTask,
  updates: Partial<BaseTask>
): BaseTask {
  return Object.assign(
    Object.create(Object.getPrototypeOf(task)) as BaseTask,
    task,
    updates
  );
}

function getLayoutViewport(
  container: HTMLDivElement | null
): LayoutViewport | undefined {
  if (!container) return undefined;
  return {
    width: container.clientWidth,
    height: container.clientHeight,
  };
}

function getTopLevelPositions(
  snapshot: LayoutSnapshot,
  nodes: Node[]
): Map<string, NodePosition> {
  return new Map(
    nodes
      .filter((node) => snapshot.topLevelNodeIds.has(node.id))
      .map((node) => [node.id, { ...node.position }])
  );
}

function positionsEqual(
  left: Map<string, NodePosition>,
  right: Map<string, NodePosition>
): boolean {
  if (left.size !== right.size) return false;
  return [...left].every(([id, position]) => {
    const other = right.get(id);
    return other?.x === position.x && other.y === position.y;
  });
}

interface TaskMapGraphViewProps {
  settings: TasksMapSettings;
  filterState: FilterState;
  setFilterState: React.Dispatch<React.SetStateAction<FilterState>>;
  plugin: TasksMapPlugin;
  embedConfig?: EmbedConfig;
  focusRequest?: TaskMapFocusRequest | null;
  onFocusRequestHandled?: () => void;
  onVisibilityContextChange?: (
    _context: LiveMapVisibilityContext | null
  ) => void;
  onReloadHandlerChange?: (_handler: (() => void) | null) => void;
}

export default function TaskMapGraphView({
  settings,
  filterState,
  setFilterState,
  plugin,
  embedConfig,
  focusRequest,
  onFocusRequestHandled,
  onVisibilityContextChange,
  onReloadHandlerChange,
}: TaskMapGraphViewProps) {
  const embed = { ...DEFAULT_EMBED_CONFIG, ...embedConfig };
  const app = useApp();
  const vault = app.vault;
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [tasks, setTasks] = React.useState<BaseTask[]>([]);
  const [selectedEdge, setSelectedEdge] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const reactFlowInstance = useReactFlow();
  const skipFitViewRef = React.useRef(false);
  const loadGenerationRef = React.useRef(0);
  const reloadTimerRef = React.useRef<number | null>(null);
  const vaultWatcherRef = React.useRef<VaultWatcher | null>(null);
  const previousAutoRefreshRef = React.useRef(settings.autoRefresh);
  const dragInteractionDepthRef = React.useRef(0);
  const textInteractionActiveRef = React.useRef(false);
  const pendingTreeFocusRef = React.useRef<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const cornerRef = React.useRef<HTMLDivElement>(null);
  // Holds the in-flight requestAnimationFrame id for the camera-fit poll.
  const fitRafRef = React.useRef<number | null>(null);
  const layoutSnapshotRef = React.useRef<LayoutSnapshot | null>(null);
  const lastPackedPositionsRef = React.useRef<Map<string, NodePosition>>(
    new Map()
  );
  const latestResizeViewportRef = React.useRef<LayoutViewport | null>(null);
  const resizePackingTimerRef = React.useRef<number | null>(null);
  const pendingResizePackingRef = React.useRef(false);

  const connectStartRef = React.useRef<{
    nodeId: string;
    handleType: "source" | "target";
  } | null>(null);

  const [hideTags, setHideTags] = React.useState(false);
  const [hideUnlinkedTasks, setHideUnlinkedTasks] = React.useState(
    embed.hideUnlinkedTasks
  );
  const [groupByProject, setGroupByProject] = React.useState(true);
  const [arrangeMode, setArrangeMode] = React.useState(false);

  // Which left-rail panel is open in the flyout; `null` keeps all collapsed.
  const [openPanel, setOpenPanel] = React.useState<RailPanelId | null>(null);
  const [isKanbanPinned, setIsKanbanPinned] = React.useState(false);
  const [kanbanPanelHeight, setKanbanPanelHeight] = React.useState(
    settings.kanbanPanelHeight
  );
  const kanbanHeightRef = React.useRef(settings.kanbanPanelHeight);
  const kanbanPanelRef = React.useRef<HTMLDivElement | null>(null);
  const kanbanResizeRef = React.useRef<{
    startY: number;
    startHeight: number;
  } | null>(null);

  const closeKanban = useCallback(() => {
    setOpenPanel((previous) => (previous === "kanban" ? null : previous));
    setIsKanbanPinned(false);
  }, []);

  const togglePanel = useCallback(
    (panel: RailPanelId) => {
      if (openPanel === panel) {
        if (panel === "kanban") setIsKanbanPinned(false);
        setOpenPanel(null);
        return;
      }
      if (openPanel === "kanban" || panel === "kanban") {
        setIsKanbanPinned(false);
      }
      setOpenPanel(panel);
    },
    [openPanel]
  );

  const dismissUnpinnedKanban = useCallback(() => {
    if (openPanel === "kanban" && !isKanbanPinned) closeKanban();
  }, [openPanel, isKanbanPinned, closeKanban]);

  useEffect(() => {
    if (openPanel !== "kanban") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeKanban();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [openPanel, closeKanban]);

  const getLeftOverlayInset = useCallback((): number => {
    if (openPanel === null) return 0;

    const container = containerRef.current;
    const corner = cornerRef.current;
    if (!container || !corner) return 0;

    const containerRect = container.getBoundingClientRect();
    const cornerRect = corner.getBoundingClientRect();
    const rawInset = cornerRect.right - containerRect.left + 16;
    return Math.min(
      Math.max(0, rawInset),
      Math.max(0, containerRect.width - 120)
    );
  }, [openPanel]);

  const getTopOverlayInset = useCallback((): number => {
    if (openPanel !== "kanban") return 0;
    const container = containerRef.current;
    const panel = kanbanPanelRef.current;
    if (!container || !panel) return 0;
    const containerRect = container.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return Math.min(
      Math.max(0, panelRect.bottom - containerRect.top + 16),
      Math.max(0, container.clientHeight - 120)
    );
  }, [openPanel]);

  const getVisibleMapArea = useCallback(() => {
    const container = containerRef.current;
    return getVisibleMapViewport(
      container?.clientWidth ?? 0,
      container?.clientHeight ?? 0,
      {
        left: getLeftOverlayInset(),
        top: getTopOverlayInset(),
      }
    );
  }, [getLeftOverlayInset, getTopOverlayInset]);

  const getVisibleMapCenterX = useCallback(
    (): number => getVisibleMapArea().centerX,
    [getVisibleMapArea]
  );

  const getVisibleMapCenterY = useCallback(
    (): number => getVisibleMapArea().centerY,
    [getVisibleMapArea]
  );

  const fitNodesToVisibleArea = useCallback(
    (currentNodes: ReturnType<typeof reactFlowInstance.getNodes>) => {
      const visibleArea = getVisibleMapArea();
      if (visibleArea.left <= 0 && visibleArea.top <= 0) {
        reactFlowInstance.fitView({ duration: 400 });
        return;
      }

      const container = containerRef.current;
      if (!container || currentNodes.length === 0) {
        reactFlowInstance.fitView({ duration: 400 });
        return;
      }

      const bounds = getNodesBounds(currentNodes);
      const viewport = getViewportForBounds(
        bounds,
        visibleArea.width,
        visibleArea.height,
        0.1,
        2,
        0.12
      );
      void reactFlowInstance.setViewport(
        {
          ...viewport,
          x: viewport.x + visibleArea.left,
          y: viewport.y + visibleArea.top,
        },
        { duration: 400 }
      );
    },
    [getVisibleMapArea, reactFlowInstance]
  );

  // Fit the camera to a freshly built node set once ReactFlow has caught up.
  // `expectedIds` is the id set just handed to setNodes; the poll waits until
  // ReactFlow's store holds exactly those nodes (so it never fits to the
  // previous selection), every one has been measured, and any expected
  // positions have landed. Polls per animation frame and bails out after ~40
  // frames so an unmeasured node cannot stall the camera forever.
  const scheduleFitView = useCallback(
    (
      expectedIds: Set<string>,
      expectedPositions?: Map<string, NodePosition>
    ) => {
      if (fitRafRef.current !== null) {
        cancelAnimationFrame(fitRafRef.current);
      }
      let frames = 0;
      const tick = () => {
        const currentNodes = reactFlowInstance.getNodes();
        const ready =
          currentNodes.length === expectedIds.size &&
          currentNodes.length > 0 &&
          currentNodes.every(
            (node) =>
              expectedIds.has(node.id) &&
              node.width != null &&
              node.height != null &&
              (expectedPositions === undefined ||
                (node.position.x === expectedPositions.get(node.id)?.x &&
                  node.position.y === expectedPositions.get(node.id)?.y))
          );
        if (ready || frames >= 40) {
          fitRafRef.current = null;
          fitNodesToVisibleArea(currentNodes);
          return;
        }
        frames += 1;
        fitRafRef.current = requestAnimationFrame(tick);
      };
      fitRafRef.current = requestAnimationFrame(tick);
    },
    [fitNodesToVisibleArea, reactFlowInstance]
  );

  // Tracks which unlinked task IDs have been dropped onto the canvas this session
  const [droppedTaskIds, setDroppedTaskIds] = React.useState<Set<string>>(
    new Set()
  );
  // Stores the drop position for each dropped task (bypasses dagre layout)
  const droppedNodePositions = useRef<Map<string, { x: number; y: number }>>(
    new Map()
  );

  const toggleHideTags = useCallback(() => {
    setHideTags((prev) => !prev);
  }, []);

  // Maintain a live registry of tags per task for efficient allTags computation
  const [taskTagsRegistry, setTaskTagsRegistry] = React.useState<
    Map<string, string[]>
  >(new Map());

  const allTags = useMemo(() => {
    const tagFrequency = new Map<string, number>();
    taskTagsRegistry.forEach((tags) => {
      tags.forEach((tag) => {
        tagFrequency.set(tag, (tagFrequency.get(tag) || 0) + 1);
      });
    });
    return Array.from(tagFrequency.keys()).sort((a, b) => {
      const freqDiff = (tagFrequency.get(b) || 0) - (tagFrequency.get(a) || 0);
      if (freqDiff !== 0) return freqDiff;
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    });
  }, [taskTagsRegistry]);

  // Compute all unique files and folders from tasks
  const allFiles = useMemo(() => {
    const filesSet = new Set<string>();
    const foldersSet = new Set<string>();

    tasks.forEach((task) => {
      if (task.link) {
        // Add the file
        filesSet.add(task.link);

        // Extract and add all parent folders
        const parts = task.link.split("/");
        for (let i = 1; i < parts.length; i++) {
          const folder = parts.slice(0, i).join("/") + "/";
          foldersSet.add(folder);
        }
      }
    });

    // Combine folders and files, with folders first
    const folders = Array.from(foldersSet).sort();
    const files = Array.from(filesSet).sort();

    return [...folders, ...files];
  }, [tasks]);

  const allProjects = useMemo(() => {
    const projects = new Set<string>();
    tasks.forEach((task) => {
      task.projects.forEach((project) => {
        const trimmed = project.trim();
        if (trimmed) projects.add(trimmed);
      });
    });
    return Array.from(projects).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [tasks]);

  // Drop a stale root scope if that task no longer exists after a reload.
  useEffect(() => {
    if (isLoading) return;
    if (
      filterState.selectedRootTask !== null &&
      !tasks.some((task) => task.id === filterState.selectedRootTask)
    ) {
      setFilterState((prev) => ({ ...prev, selectedRootTask: null }));
    }
  }, [isLoading, tasks, filterState.selectedRootTask, setFilterState]);

  React.useEffect(() => {
    if (containerRef.current) {
      if (hideTags) {
        containerRef.current.classList.add("tasks-map--hide-tags");
      } else {
        containerRef.current.classList.remove("tasks-map--hide-tags");
      }
    }
  }, [hideTags]);

  const reloadTasks = useCallback(
    (options: ReloadTasksOptions = {}) => {
      const auto = options.auto === true;
      const generation = ++loadGenerationRef.current;
      if (!auto) {
        setIsLoading(true);
        // A manual reload resets session-only dropped nodes as before.
        setDroppedTaskIds(new Set());
        droppedNodePositions.current = new Map();
      }
      if (reloadTimerRef.current !== null) {
        window.clearTimeout(reloadTimerRef.current);
      }
      // Use setTimeout to allow the loading UI to render before heavy computation
      reloadTimerRef.current = window.setTimeout(() => {
        reloadTimerRef.current = null;
        void (async () => {
          try {
            const newTasks = await getAllTasks(
              app,
              {
                noteTaskPropertyName: settings.noteTaskPropertyName,
                noteTaskPropertyValue: settings.noteTaskPropertyValue,
                noteTaskTitleSource: settings.noteTaskTitleSource,
                noteTaskTitleProperty: settings.noteTaskTitleProperty,
                noteTaskDatePrefixEnabled: settings.noteTaskDatePrefixEnabled,
                noteTaskCreatedDateProperty:
                  settings.noteTaskCreatedDateProperty,
                quickCommentsPropertyName: settings.quickCommentsPropertyName,
                noteDependencyProperty: settings.noteDependencyProperty,
              },
              settings.taskStatuses
            );
            if (generation !== loadGenerationRef.current) return;

            if (auto) {
              if (fitRafRef.current !== null) {
                cancelAnimationFrame(fitRafRef.current);
                fitRafRef.current = null;
              }
              skipFitViewRef.current = true;
            }
            setTasks(newTasks);
            const newRegistry = new Map<string, string[]>();
            newTasks.forEach((task) => {
              newRegistry.set(task.id, task.tags);
            });
            setTaskTagsRegistry(newRegistry);
            setIsLoading(false);
            if (!auto) new Notice(t("notices.tasks_reloaded"));
          } catch (error) {
            if (generation !== loadGenerationRef.current) return;
            console.error("[tasks-map] Failed to reload tasks:", error);
            setIsLoading(false);
            new Notice(t("notices.tasks_load_failed"));
          }
        })();
      }, 0);
    },
    [
      app,
      settings.noteTaskPropertyName,
      settings.noteTaskPropertyValue,
      settings.noteTaskTitleSource,
      settings.noteTaskTitleProperty,
      settings.noteTaskDatePrefixEnabled,
      settings.noteTaskCreatedDateProperty,
      settings.quickCommentsPropertyName,
      settings.noteDependencyProperty,
      settings.taskStatuses,
    ]
  );

  const manualReloadTasks = useCallback(() => reloadTasks(), [reloadTasks]);

  const requestAutoRefresh = useCallback(
    (options: RefreshRequestOptions = {}) => {
      vaultWatcherRef.current?.requestRefresh(options);
    },
    []
  );

  const trackVaultWrite: VaultWriteTracker = useCallback(
    async (paths, operation) => {
      const watcher = vaultWatcherRef.current;
      if (watcher) {
        await watcher.trackWrite(paths, operation);
        return;
      }
      await operation();
    },
    []
  );

  useEffect(() => {
    const wasEnabled = previousAutoRefreshRef.current;
    previousAutoRefreshRef.current = settings.autoRefresh;
    if (!settings.autoRefresh) {
      vaultWatcherRef.current?.stop();
      vaultWatcherRef.current = null;
      return;
    }

    const ignoredSchemaPath = normalizeTaskNotesTypeSchemaPath(
      settings.taskNotesTypeSchemaPath
    );
    const watcher = new VaultWatcher(app, {
      onRefresh: () => reloadTasks({ auto: true }),
      isInteractionActive: () =>
        dragInteractionDepthRef.current > 0 || textInteractionActiveRef.current,
      isIgnoredPath: (path) =>
        normalizeTaskNotesTypeSchemaPath(path) === ignoredSchemaPath,
    });
    vaultWatcherRef.current = watcher;
    watcher.start();
    if (!wasEnabled) watcher.requestRefresh();

    return () => {
      watcher.stop();
      if (vaultWatcherRef.current === watcher) {
        vaultWatcherRef.current = null;
      }
    };
  }, [
    app,
    reloadTasks,
    settings.autoRefresh,
    settings.taskNotesTypeSchemaPath,
  ]);

  useEffect(() => {
    onReloadHandlerChange?.(manualReloadTasks);
    return () => onReloadHandlerChange?.(null);
  }, [onReloadHandlerChange, manualReloadTasks]);

  const updateTaskTags = useCallback((taskId: string, newTags: string[]) => {
    skipFitViewRef.current = true;
    setTasks((previousTasks) =>
      previousTasks.map((task) =>
        task.id === taskId
          ? cloneTaskWithUpdates(task, { tags: newTags })
          : task
      )
    );
    setTaskTagsRegistry((prevRegistry) => {
      const newRegistry = new Map(prevRegistry);
      newRegistry.set(taskId, newTags);
      return newRegistry;
    });
  }, []);

  const handleDeleteTask = useCallback((taskId: string) => {
    skipFitViewRef.current = true;
    setTasks((prevTasks) => prevTasks.filter((t) => t.id !== taskId));
    setTaskTagsRegistry((prevRegistry) => {
      const newRegistry = new Map(prevRegistry);
      newRegistry.delete(taskId);
      return newRegistry;
    });
  }, []);

  const handleQuickCommentsChanged = useCallback(
    (taskId: string, value: string) => {
      skipFitViewRef.current = true;
      setTasks((previousTasks) =>
        previousTasks.map((task) => {
          if (task.id === taskId && task instanceof NoteTask) {
            return new NoteTask({
              ...task.toPlainObject(),
              quickComments: value,
            });
          }
          return task;
        })
      );
    },
    []
  );

  const handleTaskStatusChange = useCallback(
    (taskId: string, status: TaskStatus) => {
      skipFitViewRef.current = true;
      setTasks((previousTasks) =>
        previousTasks.map((task) =>
          task.id === taskId ? cloneTaskWithUpdates(task, { status }) : task
        )
      );
    },
    []
  );

  const handleKanbanStatusMove = useCallback(
    async (taskId: string, status: TaskStatus) => {
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (!task) return;

      const result = await moveKanbanTaskStatus(
        task,
        status,
        handleTaskStatusChange,
        async () => {
          const update = () =>
            updateTaskStatusInVault(task, status, app, settings.taskStatuses);
          if (task.link) {
            await trackVaultWrite(task.link, update);
          } else {
            await update();
          }
        }
      );

      if (result.kind !== "rolled_back") return;
      console.error("Failed to move Kanban task:", result.error);
      new Notice(t("kanban.status_update_failed"));
    },
    [app, handleTaskStatusChange, settings.taskStatuses, tasks, trackVaultWrite]
  );

  const handleTaskPriorityChange = useCallback(
    (taskId: string, priority: string) => {
      skipFitViewRef.current = true;
      setTasks((previousTasks) =>
        previousTasks.map((task) =>
          task.id === taskId ? cloneTaskWithUpdates(task, { priority }) : task
        )
      );
    },
    []
  );

  const handleTaskStarredChange = useCallback(
    (taskId: string, starred: boolean) => {
      skipFitViewRef.current = true;
      setTasks((previousTasks) =>
        previousTasks.map((task) =>
          task.id === taskId ? cloneTaskWithUpdates(task, { starred }) : task
        )
      );
    },
    []
  );

  useEffect(() => {
    let active = true;
    app.workspace.onLayoutReady(() => {
      if (active) manualReloadTasks();
    });

    return () => {
      active = false;
    };
  }, [app, manualReloadTasks]);

  useEffect(
    () => () => {
      loadGenerationRef.current += 1;
      if (reloadTimerRef.current !== null) {
        window.clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
    },
    []
  );

  // Update tag registry when tasks change
  useEffect(() => {
    const newRegistry = new Map<string, string[]>();
    tasks.forEach((task) => {
      newRegistry.set(task.id, task.tags);
    });
    setTaskTagsRegistry(newRegistry);
  }, [tasks]);

  // Compute which tasks are unlinked (no connections at all)
  const allUnlinkedTasks = useMemo(() => getUnlinkedTasks(tasks), [tasks]);

  // Tasks visible in the sidebar: unlinked, not yet dropped, and matching the active filter
  const sidebarTasks = useMemo(() => {
    const undroppedUnlinked = allUnlinkedTasks.filter(
      (t) => !droppedTaskIds.has(t.id)
    );
    const filteredIds = new Set(
      getFilteredNodeIds(undroppedUnlinked, filterState)
    );
    return undroppedUnlinked.filter((t) => filteredIds.has(t.id));
  }, [allUnlinkedTasks, droppedTaskIds, filterState]);

  // Tasks that are linked OR have been dropped onto the canvas this session
  // OR all tasks when hideUnlinkedTasks is disabled (unlinked appear as isolated nodes)
  const graphTasks = useMemo(() => {
    if (!hideUnlinkedTasks) return tasks;
    const unlinkedIds = new Set(allUnlinkedTasks.map((t) => t.id));
    return tasks.filter(
      (t) => !unlinkedIds.has(t.id) || droppedTaskIds.has(t.id)
    );
  }, [tasks, allUnlinkedTasks, droppedTaskIds, hideUnlinkedTasks]);

  useEffect(() => {
    onVisibilityContextChange?.({
      tasks,
      filter: filterState,
      hideUnlinkedTasks,
      droppedTaskIds: [...droppedTaskIds],
      visibleNodeIds: nodes
        .filter((node) => node.type === "task")
        .map((node) => node.id),
      isLoading,
    });
  }, [
    droppedTaskIds,
    filterState,
    hideUnlinkedTasks,
    isLoading,
    nodes,
    onVisibilityContextChange,
    tasks,
  ]);

  useEffect(
    () => () => {
      onVisibilityContextChange?.(null);
    },
    [onVisibilityContextChange]
  );

  // In-app task editor panel state (create or edit a TaskNotes task).
  const [editorState, setEditorState] = React.useState<{
    mode: "create" | "edit";
    taskPath?: string;
  } | null>(null);

  const openTaskEditor = useCallback(
    (mode: "create" | "edit", taskPath?: string) => {
      setEditorState({ mode, taskPath });
    },
    []
  );

  // Editor panel layout preferences (seeded from settings, persisted on commit).
  const [editorPanelWidth, setEditorPanelWidth] = React.useState(
    settings.editorPanelWidth
  );
  const [editorPanelLayout, setEditorPanelLayout] = React.useState(
    settings.editorPanelLayout
  );
  const [editorBodyFontSize, setEditorBodyFontSize] = React.useState(
    settings.editorBodyFontSize
  );

  const handleEditorLayoutChange = useCallback(
    (layout: TasksMapSettings["editorPanelLayout"]) => {
      setEditorPanelLayout(layout);
      void plugin.updateSettings({ editorPanelLayout: layout });
    },
    [plugin]
  );

  const handleEditorBodyFontSizeChange = useCallback(
    (size: number) => {
      const clamped = Math.min(24, Math.max(10, size));
      setEditorBodyFontSize(clamped);
      void plugin.updateSettings({ editorBodyFontSize: clamped });
    },
    [plugin]
  );

  // Drag-to-resize the editor panel; persists width only on pointer-up.
  // editorWidthRef tracks the live width so pointer handlers avoid stale state.
  const editorResizeRef = useRef<{ startX: number; startWidth: number } | null>(
    null
  );
  const editorWidthRef = useRef(editorPanelWidth);

  const onEditorResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      editorResizeRef.current = {
        startX: e.clientX,
        startWidth: editorWidthRef.current,
      };
    },
    []
  );

  const onEditorResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = editorResizeRef.current;
      if (!drag) return;
      const parentW = containerRef.current?.clientWidth ?? window.innerWidth;
      const max = Math.max(360, parentW * 0.9);
      // Dragging the handle leftwards (smaller clientX) widens the panel.
      const next = Math.min(
        max,
        Math.max(300, drag.startWidth + (drag.startX - e.clientX))
      );
      editorWidthRef.current = next;
      setEditorPanelWidth(next);
    },
    []
  );

  const onEditorResizePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!editorResizeRef.current) return;
      editorResizeRef.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      void plugin.updateSettings({ editorPanelWidth: editorWidthRef.current });
    },
    [plugin]
  );

  const handleEditTaskByPath = useCallback(
    (taskPath: string) => openTaskEditor("edit", taskPath),
    [openTaskEditor]
  );

  // Note-based tasks offered as dependency targets in the editor panel.
  const noteTasks = useMemo(
    () => tasks.filter((task) => task.type === "note"),
    [tasks]
  );
  const taskNotesEditorAvailable = useMemo(
    () => isTaskNotesEditorAvailable(app),
    [app]
  );
  const taskNotesPriorityOptions = useMemo<TaskPriorityConfig[]>(
    () => getTaskNotesConfig(app).priorities,
    [app]
  );
  const notePriorityOptions = useMemo(
    () => plugin.getTaskPriorityOptions(taskNotesPriorityOptions),
    [plugin, settings, taskNotesPriorityOptions]
  );

  const onKanbanResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      kanbanResizeRef.current = {
        startY: event.clientY,
        startHeight:
          kanbanPanelRef.current?.getBoundingClientRect().height ??
          kanbanHeightRef.current,
      };
    },
    []
  );

  const onKanbanResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = kanbanResizeRef.current;
      if (!drag) return;
      const containerHeight = containerRef.current?.clientHeight ?? 0;
      const maximumHeight = Math.max(180, containerHeight - 192);
      const nextHeight = Math.min(
        maximumHeight,
        Math.max(180, drag.startHeight + event.clientY - drag.startY)
      );
      kanbanHeightRef.current = nextHeight;
      setKanbanPanelHeight(nextHeight);
    },
    []
  );

  const onKanbanResizePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!kanbanResizeRef.current) return;
      kanbanResizeRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      void plugin.updateSettings({
        kanbanPanelHeight: kanbanHeightRef.current,
      });
      window.requestAnimationFrame(() => {
        fitNodesToVisibleArea(reactFlowInstance.getNodes());
      });
    },
    [fitNodesToVisibleArea, plugin, reactFlowInstance]
  );

  useEffect(() => {
    let newNodes = createNodesFromTasks(
      graphTasks,
      settings.layoutDirection,
      settings.showPriorities,
      settings.showTags,
      settings.debugVisualization,
      handleDeleteTask,
      groupByProject,
      settings.tagColorPalette,
      requestAutoRefresh,
      handleEditTaskByPath,
      settings.visibleAttachmentKinds,
      notePriorityOptions,
      settings.priorityAccentPosition,
      settings.quickCommentsPropertyName,
      handleQuickCommentsChanged,
      handleTaskStatusChange,
      handleTaskPriorityChange,
      handleTaskStarredChange,
      trackVaultWrite,
      settings.nodeDensity
    );
    let newEdges = createEdgesFromTasks(
      graphTasks,
      settings.layoutDirection,
      settings.debugVisualization,
      settings.edgeStyle,
      settings.smoothStepRadius
    );

    const filteredNodeIds = getFilteredNodeIds(graphTasks, filterState);
    const filteredTasks = graphTasks.filter((t) =>
      filteredNodeIds.includes(t.id)
    );

    newNodes = newNodes.filter((n) => filteredNodeIds.includes(n.id));
    newEdges = newEdges.filter(
      (e) =>
        filteredNodeIds.includes(e.source) && filteredNodeIds.includes(e.target)
    );

    // Separate dropped (unlinked) nodes from linked nodes for layout
    const droppedNodes = newNodes.filter((n) => droppedTaskIds.has(n.id));
    const linkedNodes = newNodes.filter((n) => !droppedTaskIds.has(n.id));

    // Run dagre once and retain its component-local geometry so a later
    // container resize only needs to recompute the outer packing offsets.
    const layoutSnapshot = createLayoutSnapshot(
      linkedNodes,
      newEdges,
      settings.layoutDirection,
      settings.showTags,
      groupByProject,
      filteredTasks,
      settings.visibleAttachmentKinds,
      settings.nodeDensity
    );
    const layoutedLinkedNodes = packLayoutSnapshot(
      layoutSnapshot,
      getLayoutViewport(containerRef.current)
    );
    layoutSnapshotRef.current = layoutSnapshot;
    lastPackedPositionsRef.current = getTopLevelPositions(
      layoutSnapshot,
      layoutedLinkedNodes
    );

    // Apply stored drop positions to dropped nodes (bypass dagre)
    const layoutedDroppedNodes = droppedNodes.map((n) => {
      const pos = droppedNodePositions.current.get(n.id);
      return pos ? { ...n, position: pos } : n;
    });

    const finalNodes = [...layoutedLinkedNodes, ...layoutedDroppedNodes];
    setNodes(finalNodes);
    setEdges(newEdges);

    const expectedIds = new Set(finalNodes.map((n) => n.id));
    const expectedPositions = new Map(
      finalNodes.map((node) => [node.id, { ...node.position }])
    );
    if (skipFitViewRef.current) {
      skipFitViewRef.current = false;
    } else {
      // Fit the camera once the rebuilt nodes have been measured. Skipped for
      // edits that should leave the camera where it is.
      scheduleFitView(expectedIds, expectedPositions);
    }
  }, [
    graphTasks,
    filterState,
    settings,
    taskNotesPriorityOptions,
    notePriorityOptions,
    setNodes,
    setEdges,
    handleDeleteTask,
    droppedTaskIds,
    groupByProject,
    requestAutoRefresh,
    handleEditTaskByPath,
    handleQuickCommentsChanged,
    handleTaskStatusChange,
    handleTaskPriorityChange,
    handleTaskStarredChange,
    trackVaultWrite,
    scheduleFitView,
  ]);

  const applyViewportPacking = useCallback(
    (viewport: LayoutViewport) => {
      const snapshot = layoutSnapshotRef.current;
      if (!snapshot) return;

      const packedNodes = packLayoutSnapshot(snapshot, viewport);
      const packedPositions = getTopLevelPositions(snapshot, packedNodes);
      if (positionsEqual(packedPositions, lastPackedPositionsRef.current)) {
        return;
      }

      lastPackedPositionsRef.current = packedPositions;
      const currentNodes = reactFlowInstance.getNodes();
      const expectedPositions = new Map(
        currentNodes.map((node) => [node.id, { ...node.position }])
      );
      packedPositions.forEach((position, id) => {
        expectedPositions.set(id, { ...position });
      });

      setNodes((previousNodes) =>
        previousNodes.map((node) => {
          const position = packedPositions.get(node.id);
          return position ? { ...node, position: { ...position } } : node;
        })
      );
      scheduleFitView(
        new Set(currentNodes.map((node) => node.id)),
        expectedPositions
      );
    },
    [reactFlowInstance, scheduleFitView, setNodes]
  );

  const scheduleViewportPacking = useCallback(() => {
    const viewport = getLayoutViewport(containerRef.current);
    if (!viewport) return;
    latestResizeViewportRef.current = viewport;

    if (resizePackingTimerRef.current !== null) {
      window.clearTimeout(resizePackingTimerRef.current);
    }
    resizePackingTimerRef.current = window.setTimeout(() => {
      resizePackingTimerRef.current = null;
      if (dragInteractionDepthRef.current > 0) {
        pendingResizePackingRef.current = true;
        return;
      }

      pendingResizePackingRef.current = false;
      const latestViewport = latestResizeViewportRef.current;
      if (latestViewport) applyViewportPacking(latestViewport);
    }, RESIZE_PACKING_DEBOUNCE_MS);
  }, [applyViewportPacking]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => scheduleViewportPacking());
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (resizePackingTimerRef.current !== null) {
        window.clearTimeout(resizePackingTimerRef.current);
        resizePackingTimerRef.current = null;
      }
    };
  }, [scheduleViewportPacking]);

  // Cancel any in-flight camera-fit poll when the view unmounts.
  useEffect(
    () => () => {
      if (fitRafRef.current !== null) {
        cancelAnimationFrame(fitRafRef.current);
      }
    },
    []
  );

  const nodeTypes = useMemo(
    () => ({ task: TaskNode, projectGroup: ProjectGroupNode }),
    []
  );
  const edgeTypes = useMemo(() => ({ hash: HashEdge }), []);

  // Show the "group by project" toggle only when at least one task has a project
  const showGroupByProject = useMemo(
    () => tasks.some((t) => t.projects.length > 0),
    [tasks]
  );

  const onEdgeClick = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ReactFlow event/edge types lack exported union
    (event: any, edge: any) => {
      event.stopPropagation();
      dismissUnpinnedKanban();
      setSelectedEdge(edge.id);
    },
    [dismissUnpinnedKanban, setSelectedEdge]
  );

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      dismissUnpinnedKanban();
      setSelectedEdge(null);
      // When the editor panel is already open, a single click retargets it to
      // the clicked TaskNotes task (ReactFlow handles node selection itself).
      if (!editorState) return;
      if (node.type !== "task") return;
      const task = (node.data as TaskNodeData | undefined)?.task;
      if (!task || task.type !== "note" || !task.link) return;
      if (!isTaskNotesTaskFile(app, task.link)) return;
      if (editorState.mode === "edit" && editorState.taskPath === task.link) {
        return;
      }
      openTaskEditor("edit", task.link);
    },
    [dismissUnpinnedKanban, setSelectedEdge, editorState, app, openTaskEditor]
  );

  // Double-clicking a TaskNotes task node opens the editor panel directly,
  // skipping the ⋮ menu. Non-TaskNotes nodes fall through to the default
  // (ReactFlow zoom-on-double-click).
  const onNodeDoubleClick = useCallback<NodeMouseHandler>(
    (event, node) => {
      if (isTaskNodeHeaderEventTarget(event.target)) return;
      if (node.type !== "task") return;
      const task = (node.data as TaskNodeData | undefined)?.task;
      if (!task || task.type !== "note" || !task.link) return;
      if (!isTaskNotesTaskFile(app, task.link)) return;
      // Stop the event from reaching ReactFlow's zoom-on-double-click handler.
      event.stopPropagation();
      openTaskEditor("edit", task.link);
    },
    [app, openTaskEditor]
  );

  const onPaneClick = useCallback(() => {
    dismissUnpinnedKanban();
    setSelectedEdge(null);
  }, [dismissUnpinnedKanban, setSelectedEdge]);

  // Pan the canvas to center a task node and briefly pulse it. Used by the
  // project tree sidebar to jump to a node when its tree row is clicked.
  const focusNode = useCallback(
    (taskId: string): boolean => {
      const node = reactFlowInstance.getNode(taskId);
      if (!node) return false;

      const pos = node.positionAbsolute ?? node.position;
      const width = node.width ?? 0;
      const height = node.height ?? 0;
      const zoom = reactFlowInstance.getZoom();
      const nodeCenterX = pos.x + width / 2;
      const nodeCenterY = pos.y + height / 2;
      void reactFlowInstance.setViewport(
        {
          x: getVisibleMapCenterX() - nodeCenterX * zoom,
          y: getVisibleMapCenterY() - nodeCenterY * zoom,
          zoom,
        },
        { duration: 500 }
      );

      const FOCUS_CLASS = "tasks-map-node--focused";
      setNodes((nds) =>
        nds.map((n) =>
          n.id === taskId
            ? { ...n, className: `${n.className ?? ""} ${FOCUS_CLASS}`.trim() }
            : n
        )
      );
      window.setTimeout(() => {
        setNodes((nds) =>
          nds.map((n) =>
            n.id === taskId
              ? {
                  ...n,
                  className: (n.className ?? "")
                    .split(/\s+/)
                    .filter((c) => c && c !== FOCUS_CLASS)
                    .join(" "),
                }
              : n
          )
        );
      }, 1600);
      return true;
    },
    [getVisibleMapCenterX, getVisibleMapCenterY, reactFlowInstance, setNodes]
  );

  useEffect(() => {
    const taskId = pendingTreeFocusRef.current;
    if (!taskId) return;
    if (focusNode(taskId)) {
      pendingTreeFocusRef.current = null;
    }
  }, [nodes, focusNode]);

  useEffect(() => {
    if (!focusRequest) return;
    if (isLoading) return;
    if (!tasks.some((task) => task.id === focusRequest.taskId)) {
      onFocusRequestHandled?.();
      return;
    }

    skipFitViewRef.current = false;
    setFilterState((prev) =>
      createTaskFocusFilter(
        focusRequest.baseFilter ?? prev,
        focusRequest.taskId
      )
    );

    onFocusRequestHandled?.();
  }, [isLoading, tasks, focusRequest, onFocusRequestHandled, setFilterState]);

  const handleTreeTaskClick = useCallback(
    (taskId: string, rootTaskId: string) => {
      if (focusNode(taskId)) return;
      if (!filterState.selectedRootTask) return;

      pendingTreeFocusRef.current = taskId;
      skipFitViewRef.current = true;
      setFilterState((prev) => ({
        ...prev,
        selectedRootTask: rootTaskId,
      }));
    },
    [filterState.selectedRootTask, focusNode, setFilterState]
  );

  const handleTreeTaskFocus = useCallback(
    (taskId: string) => {
      setFilterState((prev) => ({ ...prev, selectedRootTask: taskId }));
    },
    [setFilterState]
  );

  const handleTreeClearFocus = useCallback(() => {
    setFilterState((prev) => ({ ...prev, selectedRootTask: null }));
  }, [setFilterState]);

  const onDeleteSelectedEdge = useCallback(async () => {
    if (!selectedEdge) return;

    const edge = edges.find((e) => e.id === selectedEdge);
    if (!edge || !edge.data?.hash) return;

    const sourceTask = tasks.find((t) => t.id === edge.source);
    const targetTask = tasks.find((t) => t.id === edge.target);
    if (!sourceTask || !targetTask) return;

    if (vault) {
      await trackVaultWrite([sourceTask.link, targetTask.link], () =>
        removeLinkSignsBetweenTasks(vault, targetTask, sourceTask.id, app)
      );
      skipFitViewRef.current = true;
      setTasks((previousTasks) =>
        previousTasks.map((task) =>
          task.id === targetTask.id
            ? cloneTaskWithUpdates(task, {
                incomingLinks: task.incomingLinks.filter(
                  (id) => id !== sourceTask.id
                ),
              })
            : task
        )
      );
      setEdges((eds) => eds.filter((e) => e.id !== selectedEdge));
      setSelectedEdge(null);
    }
  }, [app, selectedEdge, edges, tasks, vault, setEdges, trackVaultWrite]);

  const onConnect = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ReactFlow Connection type is not exported
    async (params: any) => {
      // Reset so onConnectEnd (which fires after onConnect) does not
      // misinterpret this as a canvas-drop and open the create modal.
      connectStartRef.current = null;

      const sourceTask = tasks.find((t) => t.id === params.source);
      const targetTask = tasks.find((t) => t.id === params.target);

      if (!vault || !sourceTask || !targetTask) return;

      if (sourceTask.type !== targetTask.type) {
        new Notice(t("errors.cannot_create_edges_different_types"), 5000);
        return;
      }

      let hash: string | undefined;
      await trackVaultWrite([sourceTask.link, targetTask.link], async () => {
        hash = await addLinkSignsBetweenTasks(
          vault,
          sourceTask,
          targetTask,
          settings.linkingStyle,
          app
        );
      });
      if (hash) {
        skipFitViewRef.current = true;
        setTasks((previousTasks) =>
          previousTasks.map((task) =>
            task.id === targetTask.id &&
            !task.incomingLinks.includes(sourceTask.id)
              ? cloneTaskWithUpdates(task, {
                  incomingLinks: [...task.incomingLinks, sourceTask.id],
                })
              : task
          )
        );
        setEdges((eds) =>
          addEdge(
            {
              ...params,
              type: "hash",
              data: {
                hash,
                layoutDirection: settings.layoutDirection,
                debugVisualization: settings.debugVisualization,
              },
            },
            eds
          )
        );
      }
    },
    [
      vault,
      app,
      tasks,
      setEdges,
      settings.layoutDirection,
      settings.debugVisualization,
      settings.linkingStyle,
      trackVaultWrite,
    ]
  );

  const createUpdatedTask = useCallback(
    (task: BaseTask, incomingLinks: string[]) =>
      Object.assign(Object.create(Object.getPrototypeOf(task)), task, {
        incomingLinks,
      }) as BaseTask,
    []
  );

  const createConnectedTask = useCallback(
    async (
      anchorTask: BaseTask,
      position: TaskInsertPosition,
      relation: "before" | "after"
    ) => {
      if (!vault || anchorTask.type !== "dataview") {
        return;
      }

      const tasksApi = getTasksApi(app);
      if (!tasksApi) {
        console.error("Tasks plugin not found or API not available");
        return;
      }

      const taskLine = await tasksApi.createTaskLineModal();
      if (!taskLine?.trim()) {
        return;
      }

      const newTask = parseTaskLine(
        taskLine,
        anchorTask.link,
        settings.taskStatuses
      );
      if (!newTask || newTask.type !== anchorTask.type) {
        return;
      }

      try {
        await trackVaultWrite(anchorTask.link, async () => {
          await addTaskLineToVault(anchorTask, taskLine, app, position);

          // Persist the in-memory ID into the newly written task line so that
          // all subsequent vault lookups (addLinkSignsBetweenTasks, rollback
          // deleteTaskFromVault) can find the line by ID rather than falling
          // back to an ambiguous text-match.
          await addSignToTaskInFile(
            vault,
            newTask,
            "id",
            newTask.id,
            settings.linkingStyle
          );

          if (relation === "after") {
            await addLinkSignsBetweenTasks(
              vault,
              anchorTask,
              newTask,
              settings.linkingStyle,
              app
            );
          } else {
            await addLinkSignsBetweenTasks(
              vault,
              newTask,
              anchorTask,
              settings.linkingStyle,
              app
            );
          }
        });

        skipFitViewRef.current = true;
        setTasks((prevTasks) => {
          const nextTasks =
            relation === "after"
              ? prevTasks
              : prevTasks.map((task) =>
                  task.id === anchorTask.id
                    ? createUpdatedTask(task, [
                        ...task.incomingLinks,
                        newTask.id,
                      ])
                    : task
                );

          const taskToAdd =
            relation === "after"
              ? createUpdatedTask(newTask, [
                  ...newTask.incomingLinks,
                  anchorTask.id,
                ])
              : newTask;

          return [...nextTasks, taskToAdd];
        });
      } catch (error) {
        console.error("Failed to create connected task:", error);

        try {
          await deleteTaskFromVault(newTask, app);
        } catch (rollbackError) {
          console.error("Failed to rollback created task:", rollbackError);
        }
      }
    },
    [
      app,
      createUpdatedTask,
      settings.linkingStyle,
      settings.taskStatuses,
      trackVaultWrite,
      vault,
    ]
  );

  const onConnectStart = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ReactFlow OnConnectStartParams type is not exported
    (_event: any, params: any) => {
      if (!params?.nodeId || !params?.handleType) {
        connectStartRef.current = null;
        return;
      }

      connectStartRef.current = {
        nodeId: params.nodeId,
        handleType: params.handleType,
      };
    },
    []
  );

  const onConnectEnd = useCallback(
    async (event: MouseEvent | TouchEvent) => {
      const connectStart = connectStartRef.current;
      connectStartRef.current = null;

      if (!connectStart) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const endedOnHandle = target.closest(".react-flow__handle");
      const endedOnNode = target.closest(".react-flow__node");
      const endedOnCanvas = target.closest(
        ".react-flow__pane, .react-flow__background"
      );

      if (endedOnHandle || endedOnNode || !endedOnCanvas) {
        return;
      }

      const anchorTask = tasks.find((task) => task.id === connectStart.nodeId);
      if (!anchorTask) {
        return;
      }

      if (connectStart.handleType === "source") {
        await createConnectedTask(anchorTask, "after", "after");
      } else {
        await createConnectedTask(anchorTask, "before", "before");
      }
    },
    [createConnectedTask, tasks]
  );

  // Returns the project group node id that contains the given position, or null
  const findGroupAtPosition = useCallback(
    (pos: { x: number; y: number }): string | null => {
      for (const groupNode of nodes.filter((n) => n.type === "projectGroup")) {
        const { x, y } = groupNode.position;
        const w =
          groupNode.width ??
          (groupNode.style?.width as number | undefined) ??
          0;
        const h =
          groupNode.height ??
          (groupNode.style?.height as number | undefined) ??
          0;
        if (pos.x >= x && pos.x <= x + w && pos.y >= y && pos.y <= y + h) {
          return groupNode.id;
        }
      }
      return null;
    },
    [nodes]
  );

  // Update isDragOver highlights for project group nodes based on a set of drag positions.
  // Groups whose IDs appear in excludeGroupIds are never highlighted (used to suppress
  // highlighting the group a node already belongs to).
  const updateDragOverHighlights = useCallback(
    (
      positions: { x: number; y: number }[],
      excludeGroupIds: Set<string> = new Set()
    ) => {
      const hoveredGroupIds = new Set(
        positions
          .map((pos) => findGroupAtPosition(pos))
          .filter((id): id is string => id !== null && !excludeGroupIds.has(id))
      );
      setNodes((nds) =>
        nds.map((n) => {
          if (n.type !== "projectGroup") return n;
          const isDragOver = hoveredGroupIds.has(n.id);
          if ((n.data as { isDragOver?: boolean }).isDragOver === isDragOver)
            return n;
          return { ...n, data: { ...n.data, isDragOver } };
        })
      );
    },
    [findGroupAtPosition, setNodes]
  );

  // Highlight project group node while a task node is dragged over it
  const onNodeDrag: NodeDragHandler = useCallback(
    (_event, draggedNode) => {
      if (draggedNode.type !== "task") return;
      const dragPos = draggedNode.positionAbsolute ?? draggedNode.position;
      const excludeGroupIds = new Set(
        draggedNode.parentId ? [draggedNode.parentId] : []
      );
      updateDragOverHighlights([dragPos], excludeGroupIds);
    },
    [updateDragOverHighlights]
  );

  const beginDragInteraction = useCallback(() => {
    dragInteractionDepthRef.current += 1;
  }, []);

  const endDragInteraction = useCallback(() => {
    dragInteractionDepthRef.current = Math.max(
      0,
      dragInteractionDepthRef.current - 1
    );
    if (dragInteractionDepthRef.current === 0) {
      vaultWatcherRef.current?.resume();
      if (pendingResizePackingRef.current) {
        pendingResizePackingRef.current = false;
        scheduleViewportPacking();
      }
    }
  }, [scheduleViewportPacking]);

  // Highlight project group nodes while multiple selected task nodes are dragged
  const onSelectionDrag: SelectionDragHandler = useCallback(
    (_event, draggedNodes) => {
      const taskNodes = draggedNodes.filter((n) => n.type === "task");
      const positions = taskNodes.map((n) => n.positionAbsolute ?? n.position);
      const excludeGroupIds = new Set(
        taskNodes.map((n) => n.parentId).filter((id): id is string => !!id)
      );
      updateDragOverHighlights(positions, excludeGroupIds);
    },
    [updateDragOverHighlights]
  );

  // Clear all drag-over highlights on project group nodes
  const clearDragOverHighlights = useCallback(() => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.type !== "projectGroup") return n;
        if (!(n.data as { isDragOver?: boolean }).isDragOver) return n;
        return { ...n, data: { ...n.data, isDragOver: false } };
      })
    );
  }, [setNodes]);

  // Assign a list of task nodes to the project group they were dropped into.
  // For a multi-node selection, any single node overlapping a group is enough
  // to assign the entire selection to that group.
  const assignDraggedNodesToProject = useCallback(
    async (
      draggedNodes: {
        id: string;
        type?: string;
        position: { x: number; y: number };
        positionAbsolute?: { x: number; y: number };
      }[]
    ) => {
      const taskNodes = draggedNodes.filter((n) => n.type === "task");
      if (taskNodes.length === 0) return;

      // Find the first group that any dragged node overlaps
      let targetProjectName: string | null = null;
      for (const draggedNode of taskNodes) {
        const dragPos = draggedNode.positionAbsolute ?? draggedNode.position;
        const groupId = findGroupAtPosition(dragPos);
        if (!groupId) continue;
        const groupNode = nodes.find((n) => n.id === groupId);
        if (!groupNode) continue;
        targetProjectName = (groupNode.data as { label: string }).label;
        break;
      }

      if (!targetProjectName) return;

      // Assign all task nodes in the selection to that project
      const assignedTaskIds = new Set<string>();
      for (const draggedNode of taskNodes) {
        const task = tasks.find((t) => t.id === draggedNode.id);
        if (!(task instanceof NoteTask)) continue;
        try {
          await trackVaultWrite(task.link, () =>
            task.addProject(app, targetProjectName)
          );
          assignedTaskIds.add(task.id);
        } catch (error) {
          console.error("Failed to assign task to project:", error);
        }
      }

      const count = assignedTaskIds.size;
      if (count > 0) {
        skipFitViewRef.current = true;
        setTasks((previousTasks) =>
          previousTasks.map((task) =>
            assignedTaskIds.has(task.id) &&
            !task.projects.includes(targetProjectName)
              ? cloneTaskWithUpdates(task, {
                  projects: [...task.projects, targetProjectName],
                })
              : task
          )
        );
      }

      if (count === 1) {
        new Notice(
          t("notices.project_assigned", { projectName: targetProjectName })
        );
      } else if (count > 1) {
        new Notice(
          t("notices.project_assigned_multiple", {
            projectName: targetProjectName,
            count,
          })
        );
      }
    },
    [tasks, nodes, app, findGroupAtPosition, trackVaultWrite]
  );

  // Handle drag-stop of a graph task node — assign to project if dropped inside a group
  const onNodeDragStop: NodeDragHandler = useCallback(
    (_event, draggedNode) => {
      clearDragOverHighlights();
      void assignDraggedNodesToProject([draggedNode]).finally(
        endDragInteraction
      );
    },
    [clearDragOverHighlights, assignDraggedNodesToProject, endDragInteraction]
  );

  // Handle drag-stop of a multi-node selection — assign all task nodes to projects
  const onSelectionDragStop: SelectionDragHandler = useCallback(
    (_event, draggedNodes) => {
      clearDragOverHighlights();
      void assignDraggedNodesToProject(draggedNodes).finally(
        endDragInteraction
      );
    },
    [clearDragOverHighlights, assignDraggedNodesToProject, endDragInteraction]
  );

  // Handle drop of an unlinked task from the sidebar onto the graph canvas
  const onDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const taskId = event.dataTransfer.getData(DRAG_DATA_KEY);
      if (!taskId) {
        endDragInteraction();
        return;
      }

      const task = tasks.find((t) => t.id === taskId);
      if (!task) {
        endDragInteraction();
        return;
      }

      // Convert screen coordinates to ReactFlow canvas coordinates
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      // Check if drop landed inside a project group node
      let assignedToProject = false;
      if (task instanceof NoteTask) {
        const projectGroupNodes = nodes.filter(
          (n) => n.type === "projectGroup"
        );
        for (const groupNode of projectGroupNodes) {
          const { x, y } = groupNode.position;
          const w =
            groupNode.width ??
            (groupNode.style?.width as number | undefined) ??
            0;
          const h =
            groupNode.height ??
            (groupNode.style?.height as number | undefined) ??
            0;
          if (
            position.x >= x &&
            position.x <= x + w &&
            position.y >= y &&
            position.y <= y + h
          ) {
            const projectName = (groupNode.data as { label: string }).label;
            try {
              await trackVaultWrite(task.link, () =>
                task.addProject(app, projectName)
              );
            } catch (error) {
              console.error("Failed to assign task to project:", error);
              endDragInteraction();
              return;
            }
            skipFitViewRef.current = true;
            setTasks((previousTasks) =>
              previousTasks.map((candidate) =>
                candidate.id === task.id &&
                !candidate.projects.includes(projectName)
                  ? cloneTaskWithUpdates(candidate, {
                      projects: [...candidate.projects, projectName],
                    })
                  : candidate
              )
            );
            new Notice(t("notices.project_assigned", { projectName }));
            assignedToProject = true;
            break;
          }
        }
      }

      if (assignedToProject) {
        droppedNodePositions.current.delete(taskId);
        setDroppedTaskIds((previous) => {
          const next = new Set(previous);
          next.delete(taskId);
          return next;
        });
        endDragInteraction();
        return;
      }

      // Store the position so the node appears exactly at the drop point
      droppedNodePositions.current.set(taskId, position);

      // Prevent fitView from zooming out after a sidebar drop
      skipFitViewRef.current = true;

      // Mark task as dropped — triggers graph re-render with the new node
      setDroppedTaskIds((prev) => {
        const next = new Set(prev);
        next.add(taskId);
        return next;
      });
      endDragInteraction();
    },
    [tasks, reactFlowInstance, nodes, app, trackVaultWrite, endDragInteraction]
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onRefreshBlockingFocus = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (isRefreshBlockingTarget(event.target)) {
        textInteractionActiveRef.current = true;
      }
    },
    []
  );

  const onRefreshBlockingBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (!isRefreshBlockingTarget(event.target)) return;
      const ownerDocument = event.currentTarget.ownerDocument;
      window.setTimeout(() => {
        textInteractionActiveRef.current = isRefreshBlockingTarget(
          ownerDocument.activeElement
        );
        if (!textInteractionActiveRef.current) {
          vaultWatcherRef.current?.resume();
        }
      }, 0);
    },
    []
  );

  const tagsContextValue = useMemo(
    () => ({
      allTags,
      updateTaskTags,
    }),
    [allTags, updateTaskTags]
  );

  const preSearchFilteredTasks = useMemo(() => {
    const filteredIds = getFilteredNodeIds(graphTasks, {
      ...filterState,
      searchQuery: "",
      traversalMode: "match",
    });
    const idSet = new Set(filteredIds);
    return graphTasks.filter((t) => idSet.has(t.id));
  }, [graphTasks, filterState]);

  const filteredTasks = useMemo(() => {
    const filteredIds = getFilteredNodeIds(graphTasks, filterState);
    const idSet = new Set(filteredIds);
    return graphTasks.filter((t) => idSet.has(t.id));
  }, [graphTasks, filterState]);

  const kanbanTasks = useMemo(
    () => getKanbanTasks(tasks, filterState),
    [tasks, filterState]
  );

  const kanbanFocusOptions = useMemo(
    () => buildKanbanFocusOptions(tasks),
    [tasks]
  );

  const treeTasks = useMemo(() => {
    const filteredIds = getVisibilityFilteredNodeIds(graphTasks, filterState);
    const idSet = new Set(filteredIds);
    return graphTasks.filter((t) => idSet.has(t.id));
  }, [graphTasks, filterState]);

  const selectedRootLabel = useMemo(() => {
    if (!filterState.selectedRootTask) return null;
    const task = graphTasks.find((t) => t.id === filterState.selectedRootTask);
    return task ? task.summary || task.text : null;
  }, [graphTasks, filterState.selectedRootTask]);

  const searchResultCount = useMemo(() => {
    if (!filterState.searchQuery.trim()) return null;
    return filteredTasks.length;
  }, [filterState.searchQuery, filteredTasks]);

  const handleSearch = useCallback(
    (query: string): void => {
      setFilterState((prev) => ({ ...prev, searchQuery: query }));
    },
    [setFilterState]
  );

  const handleSavePreset = useCallback(
    async (name: string, filter: FilterState): Promise<void> => {
      await plugin.savePreset(name, filter);
    },
    [plugin]
  );

  const handleRenamePreset = useCallback(
    async (id: string, name: string): Promise<void> => {
      await plugin.renamePreset(id, name);
    },
    [plugin]
  );

  const handleDeletePreset = useCallback(
    async (id: string): Promise<void> => {
      await plugin.deletePreset(id);
    },
    [plugin]
  );

  return (
    <StatusConfigContext.Provider value={settings.taskStatuses}>
      <TagsContext.Provider value={tagsContextValue}>
        <div
          className="tasks-map-graph-container"
          ref={containerRef}
          onDrop={(e) => void onDrop(e)}
          onDragOver={onDragOver}
          onDragStartCapture={beginDragInteraction}
          onDragEndCapture={endDragInteraction}
          onFocusCapture={onRefreshBlockingFocus}
          onBlurCapture={onRefreshBlockingBlur}
        >
          <div className="tasks-map-corner" ref={cornerRef}>
            <div className="tasks-map-rail-row">
              <LeftRail
                openPanel={openPanel}
                onToggle={togglePanel}
                onRefresh={manualReloadTasks}
                showFilters={embed.showFilterPanel}
                showKanban={embed.showFilterPanel}
                showPresets={embed.showPresetsPanel}
                showUnlinked={embed.showUnlinkedPanel}
                showTree={embed.showUnlinkedPanel}
                unlinkedCount={sidebarTasks.length}
              />
              {openPanel && openPanel !== "kanban" && (
                <div className="tasks-map-flyout">
                  {openPanel === "filters" && (
                    <GuiOverlay
                      allTags={allTags}
                      filterState={filterState}
                      setFilterState={setFilterState}
                      allFiles={allFiles}
                      allProjects={allProjects}
                      statuses={settings.taskStatuses}
                      onSearch={handleSearch}
                      searchResultCount={searchResultCount}
                      suggestionTasks={preSearchFilteredTasks}
                    />
                  )}
                  {openPanel === "presets" && (
                    <FilterPresetsPanel
                      presets={settings.filterPresets}
                      filterState={filterState}
                      plugin={plugin}
                      onApply={(filter) => setFilterState(filter)}
                      onSave={handleSavePreset}
                      onRename={handleRenamePreset}
                      onDelete={handleDeletePreset}
                    />
                  )}
                  {openPanel === "view" && (
                    <ControlsPanel
                      showTags={settings.showTags}
                      hideTags={hideTags}
                      setHideTags={toggleHideTags}
                      reloadTasks={manualReloadTasks}
                      showUnlinkedPanel={embed.showUnlinkedPanel}
                      hideUnlinkedTasks={hideUnlinkedTasks}
                      setHideUnlinkedTasks={setHideUnlinkedTasks}
                      showGroupByProject={showGroupByProject}
                      groupByProject={groupByProject}
                      setGroupByProject={setGroupByProject}
                      arrangeMode={arrangeMode}
                      setArrangeMode={setArrangeMode}
                    />
                  )}
                  {openPanel === "unlinked" && (
                    <UnlinkedTasksPanel tasks={sidebarTasks} />
                  )}
                  {openPanel === "tree" && (
                    <ProjectTreePanel
                      tasks={treeTasks}
                      selectedRootTask={filterState.selectedRootTask}
                      selectedRootLabel={selectedRootLabel}
                      onClearFocus={handleTreeClearFocus}
                      onTaskClick={handleTreeTaskClick}
                      onTaskFocus={handleTreeTaskFocus}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
          {openPanel === "kanban" && (
            <div
              className="tasks-map-kanban-overlay"
              ref={(element) => {
                kanbanPanelRef.current = element;
                if (!element) return;
                element.style.setProperty(
                  "--tasks-map-kanban-height",
                  `${kanbanPanelHeight}px`
                );
                element.style.setProperty(
                  "--tasks-map-kanban-right",
                  editorState ? `${editorPanelWidth + 8}px` : "16px"
                );
              }}
            >
              <KanbanPanel
                tasks={kanbanTasks}
                statuses={settings.taskStatuses}
                notePriorityOptions={notePriorityOptions}
                focusOptions={kanbanFocusOptions}
                pinned={isKanbanPinned}
                onPinnedChange={setIsKanbanPinned}
                onClose={closeKanban}
                onFocusProject={handleTreeTaskFocus}
                onTaskStatusChange={handleTaskStatusChange}
                onTaskStatusMove={handleKanbanStatusMove}
                trackVaultWrite={trackVaultWrite}
              />
              <div
                className="tasks-map-kanban-resize-handle"
                onPointerDown={onKanbanResizePointerDown}
                onPointerMove={onKanbanResizePointerMove}
                onPointerUp={onKanbanResizePointerUp}
                role="separator"
                aria-orientation="horizontal"
                aria-label={t("kanban.resize")}
              />
            </div>
          )}
          {isLoading && (
            <div className="tasks-map-loading-container">
              <div className="tasks-map-spinner" />
              <div className="tasks-map-loading-text">Loading tasks...</div>
            </div>
          )}
          {!isLoading && tasks.length === 0 && (
            <GraphEmptyState variant="no_tasks" />
          )}
          {!isLoading && tasks.length > 0 && graphTasks.length === 0 && (
            <GraphEmptyState variant="all_unlinked" />
          )}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            proOptions={{ hideAttribution: true }}
            minZoom={0.1}
            zoomOnScroll={false}
            zoomOnPinch
            zoomActivationKeyCode="Control"
            panOnScroll
            panOnScrollMode={PanOnScrollMode.Free}
            fitView
            onConnect={(params) => void onConnect(params)}
            onConnectStart={onConnectStart}
            onConnectEnd={(e) => void onConnectEnd(e)}
            onEdgeClick={onEdgeClick}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onPaneClick={onPaneClick}
            onNodeDragStart={beginDragInteraction}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={(e, node, nodes) =>
              void onNodeDragStop(e, node, nodes)
            }
            onSelectionDragStart={beginDragInteraction}
            onSelectionDrag={onSelectionDrag}
            onSelectionDragStop={(e, nodes) =>
              void onSelectionDragStop(e, nodes)
            }
            multiSelectionKeyCode="Shift"
            selectionKeyCode="Shift"
            nodesDraggable={arrangeMode}
          >
            {embed.showMinimap && <TaskMinimap />}
            <Background />
            {settings.showStatusCounts && embed.showStatusCounts && (
              <StatusCountsOverlay tasks={filteredTasks} />
            )}
          </ReactFlow>
          {selectedEdge && (
            <DeleteEdgeButton onDelete={() => void onDeleteSelectedEdge()} />
          )}
          {taskNotesEditorAvailable && !editorState && (
            <button
              className="tasks-map-new-task-button"
              onClick={() => openTaskEditor("create")}
            >
              <Plus size={16} />
              <span>{t("task_editor.new_task")}</span>
            </button>
          )}
          {editorState && (
            <div
              className="tasks-map-editor-panel-container"
              ref={(el) => {
                if (el) el.style.width = `${editorPanelWidth}px`;
              }}
            >
              <div
                className="tasks-map-editor-resize-handle"
                onPointerDown={onEditorResizePointerDown}
                onPointerMove={onEditorResizePointerMove}
                onPointerUp={onEditorResizePointerUp}
                role="separator"
                aria-orientation="vertical"
                aria-label={t("task_editor.resize")}
              />
              <TaskEditorPanel
                key={`${editorState.mode}:${editorState.taskPath ?? ""}`}
                app={app}
                mode={editorState.mode}
                taskPath={editorState.taskPath}
                availableTasks={noteTasks}
                layout={editorPanelLayout}
                onLayoutChange={handleEditorLayoutChange}
                bodyFontSize={editorBodyFontSize}
                onBodyFontSizeChange={handleEditorBodyFontSizeChange}
                autosaveEnabled={settings.editorAutosave}
                onClose={() => setEditorState(null)}
                onSaved={() => requestAutoRefresh({ force: true })}
              />
            </div>
          )}
        </div>
      </TagsContext.Provider>
    </StatusConfigContext.Provider>
  );
}
