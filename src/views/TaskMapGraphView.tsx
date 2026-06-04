import React, { useEffect, useCallback, useMemo, useRef } from "react";
import ReactFlow, {
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  getNodesBounds,
  getViewportForBounds,
  type NodeDragHandler,
  type NodeMouseHandler,
  type SelectionDragHandler,
} from "reactflow";
import { Notice } from "obsidian";
import { useApp } from "src/hooks/hooks";
import {
  addLinkSignsBetweenTasks,
  addSignToTaskInFile,
  getAllTasks,
  getLayoutedElements,
  removeLinkSignsBetweenTasks,
  createNodesFromTasks,
  createEdgesFromTasks,
  getUnlinkedTasks,
  addTaskLineToVault,
  deleteTaskFromVault,
  getTasksApi,
  parseTaskLine,
} from "src/lib/utils";
import { Plus } from "lucide-react";
import { BaseTask, TaskNodeData } from "src/types/task";
import {
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
import LeftRail, { RailPanelId } from "src/components/left-rail";
import { GraphEmptyState } from "src/components/graph-empty-state";
import ControlsPanel from "src/components/controls-panel";
import { t } from "../i18n";
import TasksMapPlugin from "../main";

import { TasksMapSettings } from "src/types/settings";
import { FilterState } from "src/types/filter-state";
import { EmbedConfig, DEFAULT_EMBED_CONFIG } from "src/types/embed-config";
import { TaskInsertPosition } from "src/types/base-task";

interface TaskMapGraphViewProps {
  settings: TasksMapSettings;
  filterState: FilterState;
  setFilterState: React.Dispatch<React.SetStateAction<FilterState>>;
  plugin: TasksMapPlugin;
  embedConfig?: EmbedConfig;
}

export default function TaskMapGraphView({
  settings,
  filterState,
  setFilterState,
  plugin,
  embedConfig,
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
  const pendingTreeFocusRef = React.useRef<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const cornerRef = React.useRef<HTMLDivElement>(null);
  // Holds the in-flight requestAnimationFrame id for the camera-fit poll.
  const fitRafRef = React.useRef<number | null>(null);

  const connectStartRef = React.useRef<{
    nodeId: string;
    handleType: "source" | "target";
  } | null>(null);

  const [hideTags, setHideTags] = React.useState(false);
  const [hideUnlinkedTasks, setHideUnlinkedTasks] = React.useState(
    embed.hideUnlinkedTasks
  );
  const [groupByProject, setGroupByProject] = React.useState(true);

  // Which left-rail panel is open in the flyout; `null` keeps all collapsed.
  const [openPanel, setOpenPanel] = React.useState<RailPanelId | null>(null);
  const togglePanel = useCallback((panel: RailPanelId) => {
    setOpenPanel((prev) => (prev === panel ? null : panel));
  }, []);

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

  const getVisibleMapCenterX = useCallback((): number => {
    const containerWidth = containerRef.current?.clientWidth ?? 0;
    return containerWidth / 2 + getLeftOverlayInset() / 2;
  }, [getLeftOverlayInset]);

  const fitNodesToVisibleArea = useCallback(
    (currentNodes: ReturnType<typeof reactFlowInstance.getNodes>) => {
      const leftInset = getLeftOverlayInset();
      if (leftInset <= 0) {
        reactFlowInstance.fitView({ duration: 400 });
        return;
      }

      const container = containerRef.current;
      if (!container || currentNodes.length === 0) {
        reactFlowInstance.fitView({ duration: 400 });
        return;
      }

      const visibleWidth = Math.max(120, container.clientWidth - leftInset);
      const bounds = getNodesBounds(currentNodes);
      const viewport = getViewportForBounds(
        bounds,
        visibleWidth,
        container.clientHeight,
        0.1,
        2,
        0.12
      );
      void reactFlowInstance.setViewport(
        {
          ...viewport,
          x: viewport.x + leftInset,
        },
        { duration: 400 }
      );
    },
    [getLeftOverlayInset, reactFlowInstance]
  );

  // Fit the camera to a freshly built node set once ReactFlow has caught up.
  // `expectedIds` is the id set just handed to setNodes; the poll waits until
  // ReactFlow's store holds exactly those nodes (so it never fits to the
  // previous selection) and every one has been measured. Polls per animation
  // frame and bails out after ~40 frames so an unmeasured node cannot stall
  // the camera forever.
  const scheduleFitView = useCallback(
    (expectedIds: Set<string>) => {
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
            (n) => expectedIds.has(n.id) && n.width != null && n.height != null
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

  // Drop a stale root scope if that task no longer exists after a reload.
  useEffect(() => {
    if (
      filterState.selectedRootTask !== null &&
      !tasks.some((task) => task.id === filterState.selectedRootTask)
    ) {
      setFilterState((prev) => ({ ...prev, selectedRootTask: null }));
    }
  }, [tasks, filterState.selectedRootTask, setFilterState]);

  React.useEffect(() => {
    if (containerRef.current) {
      if (hideTags) {
        containerRef.current.classList.add("tasks-map--hide-tags");
      } else {
        containerRef.current.classList.remove("tasks-map--hide-tags");
      }
    }
  }, [hideTags]);

  const reloadTasks = useCallback(() => {
    setIsLoading(true);
    // Reset dropped state on reload so unlinked tasks return to sidebar
    setDroppedTaskIds(new Set());
    droppedNodePositions.current = new Map();
    // Use setTimeout to allow the loading UI to render before heavy computation
    window.setTimeout(() => {
      const newTasks = getAllTasks(
        app,
        {
          noteTaskPropertyName: settings.noteTaskPropertyName,
          noteTaskPropertyValue: settings.noteTaskPropertyValue,
          noteDependencyProperty: settings.noteDependencyProperty,
        },
        settings.taskStatuses
      );
      setTasks(newTasks);
      const newRegistry = new Map<string, string[]>();
      newTasks.forEach((task) => {
        newRegistry.set(task.id, task.tags);
      });
      setTaskTagsRegistry(newRegistry);
      setIsLoading(false);
      new Notice("Tasks reloaded");
    }, 0);
  }, [
    app,
    settings.noteTaskPropertyName,
    settings.noteTaskPropertyValue,
    settings.noteDependencyProperty,
    settings.taskStatuses,
  ]);

  const updateTaskTags = useCallback((taskId: string, newTags: string[]) => {
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

  useEffect(() => {
    // Get the Dataview plugin to check index status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Obsidian App type does not expose plugins property
    const dataviewPlugin = (app as any).plugins?.plugins?.["dataview"];

    // Check if Dataview index is already initialized
    if (dataviewPlugin?.index?.initialized) {
      // Index already ready, load tasks immediately
      reloadTasks();
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Obsidian App type does not expose metadataCache events
      const metadataCache = (app as any).metadataCache;
      const eventRef = metadataCache.on("dataview:index-ready", () => {
        reloadTasks();
      });

      return () => {
        metadataCache.offref(eventRef);
      };
    }
  }, [app, reloadTasks]);

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
      reloadTasks,
      handleEditTaskByPath,
      settings.visibleAttachmentKinds
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

    // Run dagre layout only on linked nodes
    const layoutedLinkedNodes = getLayoutedElements(
      linkedNodes,
      newEdges,
      settings.layoutDirection,
      settings.showTags,
      groupByProject,
      filteredTasks,
      settings.visibleAttachmentKinds
    );

    // Apply stored drop positions to dropped nodes (bypass dagre)
    const layoutedDroppedNodes = droppedNodes.map((n) => {
      const pos = droppedNodePositions.current.get(n.id);
      return pos ? { ...n, position: pos } : n;
    });

    const finalNodes = [...layoutedLinkedNodes, ...layoutedDroppedNodes];
    setNodes(finalNodes);
    setEdges(newEdges);

    // Fit the camera once the rebuilt nodes have been measured. Skipped for
    // edits that should leave the camera where it is.
    if (skipFitViewRef.current) {
      skipFitViewRef.current = false;
    } else {
      scheduleFitView(new Set(finalNodes.map((n) => n.id)));
    }
  }, [
    graphTasks,
    filterState,
    settings,
    setNodes,
    setEdges,
    handleDeleteTask,
    droppedTaskIds,
    groupByProject,
    reloadTasks,
    handleEditTaskByPath,
    scheduleFitView,
  ]);

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
      setSelectedEdge(edge.id);
    },
    [setSelectedEdge]
  );

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
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
    [setSelectedEdge, editorState, app, openTaskEditor]
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
    setSelectedEdge(null);
  }, [setSelectedEdge]);

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
          y: (containerRef.current?.clientHeight ?? 0) / 2 - nodeCenterY * zoom,
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
    [getVisibleMapCenterX, reactFlowInstance, setNodes]
  );

  useEffect(() => {
    const taskId = pendingTreeFocusRef.current;
    if (!taskId) return;
    if (focusNode(taskId)) {
      pendingTreeFocusRef.current = null;
    }
  }, [nodes, focusNode]);

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
      await removeLinkSignsBetweenTasks(vault, targetTask, sourceTask.id, app);
      setEdges((eds) => eds.filter((e) => e.id !== selectedEdge));
      setSelectedEdge(null);
    }
  }, [app, selectedEdge, edges, tasks, vault, setEdges]);

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

      const hash = await addLinkSignsBetweenTasks(
        vault,
        sourceTask,
        targetTask,
        settings.linkingStyle,
        app
      );
      if (hash) {
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
      let count = 0;
      for (const draggedNode of taskNodes) {
        const task = tasks.find((t) => t.id === draggedNode.id);
        if (!(task instanceof NoteTask)) continue;
        await task.addProject(app, targetProjectName);
        count++;
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
    [tasks, nodes, app, findGroupAtPosition]
  );

  // Handle drag-stop of a graph task node — assign to project if dropped inside a group
  const onNodeDragStop: NodeDragHandler = useCallback(
    (_event, draggedNode) => {
      clearDragOverHighlights();
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- NodeDragHandler expects void; async work is intentionally fire-and-forget
      assignDraggedNodesToProject([draggedNode]);
    },
    [clearDragOverHighlights, assignDraggedNodesToProject]
  );

  // Handle drag-stop of a multi-node selection — assign all task nodes to projects
  const onSelectionDragStop: SelectionDragHandler = useCallback(
    (_event, draggedNodes) => {
      clearDragOverHighlights();
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- SelectionDragHandler expects void; async work is intentionally fire-and-forget
      assignDraggedNodesToProject(draggedNodes);
    },
    [clearDragOverHighlights, assignDraggedNodesToProject]
  );

  // Handle drop of an unlinked task from the sidebar onto the graph canvas
  const onDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const taskId = event.dataTransfer.getData(DRAG_DATA_KEY);
      if (!taskId) return;

      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      // Convert screen coordinates to ReactFlow canvas coordinates
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      // Check if drop landed inside a project group node
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
            await task.addProject(app, projectName);
            new Notice(t("notices.project_assigned", { projectName }));
            break;
          }
        }
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
    },
    [tasks, reactFlowInstance, nodes, app]
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

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
        >
          <div className="tasks-map-corner" ref={cornerRef}>
            <div className="tasks-map-rail-row">
              <LeftRail
                openPanel={openPanel}
                onToggle={togglePanel}
                onRefresh={reloadTasks}
                showFilters={embed.showFilterPanel}
                showPresets={embed.showPresetsPanel}
                showUnlinked={embed.showUnlinkedPanel}
                showTree={embed.showUnlinkedPanel}
                unlinkedCount={sidebarTasks.length}
              />
              {openPanel && (
                <div className="tasks-map-flyout">
                  {openPanel === "filters" && (
                    <GuiOverlay
                      allTags={allTags}
                      filterState={filterState}
                      setFilterState={setFilterState}
                      allFiles={allFiles}
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
                      reloadTasks={reloadTasks}
                      showUnlinkedPanel={embed.showUnlinkedPanel}
                      hideUnlinkedTasks={hideUnlinkedTasks}
                      setHideUnlinkedTasks={setHideUnlinkedTasks}
                      showGroupByProject={showGroupByProject}
                      groupByProject={groupByProject}
                      setGroupByProject={setGroupByProject}
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
            fitView
            onConnect={(params) => void onConnect(params)}
            onConnectStart={onConnectStart}
            onConnectEnd={(e) => void onConnectEnd(e)}
            onEdgeClick={onEdgeClick}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onPaneClick={onPaneClick}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={(e, node, nodes) =>
              void onNodeDragStop(e, node, nodes)
            }
            onSelectionDrag={onSelectionDrag}
            onSelectionDragStop={(e, nodes) =>
              void onSelectionDragStop(e, nodes)
            }
            multiSelectionKeyCode="Shift"
            selectionKeyCode="Shift"
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
                onSaved={reloadTasks}
              />
            </div>
          )}
        </div>
      </TagsContext.Provider>
    </StatusConfigContext.Provider>
  );
}
