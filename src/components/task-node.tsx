import React, {
  useState,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { Handle, Position, NodeProps } from "reactflow";
import {
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Paperclip,
  Plus,
} from "lucide-react";
import { useApp } from "src/hooks/hooks";
import { BaseTask, TaskNodeData, TaskStatus } from "src/types/task";
import { TaskAttachmentKind } from "src/types/base-task";
import { NoteTask } from "src/types/note-task";
import { TaskDetails } from "./task-details";
import { ExpandButton } from "./expand-button";
import { LinkButton } from "./link-button";
import { StarButton } from "./star-button";
import TaskMenu from "./task-menu";
import { Tag } from "./tag";
import { TaskStatusToggle } from "./task-status";
import { TaskBackground } from "./task-background";
import { TaskPriorityToggle } from "./task-priority";
import { ProjectDot } from "./project-dot";
import { TagInput } from "./tag-input";
import { QuickUpdate } from "./quick-update";
import { useSummaryRenderer } from "../hooks/use-summary-renderer";
import {
  removeTagFromTaskInVault,
  addTagToTaskInVault,
  addStarToTaskInVault,
  removeStarFromTaskInVault,
  getVisibleTaskAttachments,
} from "../lib/utils";
import { TagsContext } from "../contexts/context";
import { t } from "../i18n";
import { openFileInObsidian } from "../lib/open-file";
import {
  isTaskNotesCreationModalAvailable,
  openTaskNotesProjectTaskCreationModal,
} from "../lib/tasknotes-bridge";

export const NODEWIDTH = 250;

export const NODEHEIGHT = 120;

const COMPACT_REVEAL_DURATION_MS = 160;
const COMPACT_REVEAL_EASING = "cubic-bezier(0.2, 0, 0, 1)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

interface TaskAttachmentsProps {
  task: BaseTask;
  visibleAttachmentKinds?: TaskAttachmentKind[];
}

function TaskAttachments({
  task,
  visibleAttachmentKinds,
}: TaskAttachmentsProps) {
  const app = useApp();
  const attachments = getVisibleTaskAttachments(task, visibleAttachmentKinds);

  if (attachments.length === 0) return null;

  const handleOpenAttachment = (
    event: React.MouseEvent<HTMLButtonElement>,
    attachment: BaseTask["attachments"][number]
  ) => {
    event.preventDefault();
    event.stopPropagation();
    void openFileInObsidian(
      app,
      attachment.path,
      attachment.linktext,
      task.link
    );
  };

  return (
    <div className="tasks-map-task-attachments nodrag">
      {attachments.map((attachment) => (
        <div key={attachment.path} className="tasks-map-task-attachment-row">
          <Paperclip size={12} className="tasks-map-task-attachments-icon" />
          <button
            type="button"
            className="tasks-map-task-attachment-link"
            title={t("attachments.open", { attachment: attachment.label })}
            onClick={(event) => handleOpenAttachment(event, attachment)}
          >
            {attachment.label}
          </button>
        </div>
      ))}
    </div>
  );
}

export default function TaskNode({ data, selected }: NodeProps<TaskNodeData>) {
  const {
    task,
    layoutDirection = "Horizontal",
    showPriorities = true,
    priorityAccentPosition = "top",
    nodeDensity = "comfortable",
    showTags = true,
    debugVisualization = false,
    tagColorPalette = "rainbow",
    visibleAttachmentKinds,
    priorityOptions = [],
    hasVisibleChildren = false,
    childrenCollapsed = false,
    foldedChildrenCount = 0,
    onToggleChildren,
    groupByProject = false,
    onDeleteTask,
    onTaskChanged,
    onEditTask,
    quickCommentsPropertyName = "quick-comments",
    onQuickCommentsChanged,
    onTaskStatusChange,
    onTaskPriorityChange,
    onTaskStarredChange,
    trackVaultWrite,
  } = data;

  const { allTags, updateTaskTags } = useContext(TagsContext);
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState(task.status);
  const [priority, setPriority] = useState(task.priority);
  const [starred, setStarred] = useState(task.starred);
  const [tags, setTags] = useState(task.tags || []);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [tagError, setTagError] = useState(false);
  const [compactHovered, setCompactHovered] = useState(false);
  const compactCardRef = useRef<HTMLDivElement>(null);
  const compactAnimationRef = useRef<Animation | null>(null);
  const compactAnimationStartHeightRef = useRef<number | null>(null);
  const app = useApp();
  const summaryRef = useSummaryRenderer(task.summary, app);
  const compactRevealed =
    nodeDensity === "compact" && (compactHovered || selected);

  // status/starred/tags are mirrored into local state for optimistic updates.
  // ReactFlow reuses this component instance across reloads (the node id is
  // stable), so the useState initializers never re-run. Resync whenever the
  // task object is replaced — i.e. after reloadTasks pulls fresh data from the
  // vault — otherwise edits made to a note outside the map never show up.
  useEffect(() => {
    setStatus(task.status);
    setPriority(task.priority);
    setStarred(task.starred);
    setTags(task.tags || []);
  }, [task]);

  const stopCompactAnimation = useCallback(() => {
    const animation = compactAnimationRef.current;
    compactAnimationRef.current = null;
    animation?.cancel();

    const background = compactCardRef.current?.querySelector<HTMLElement>(
      ".tasks-map-task-background"
    );
    background?.style.removeProperty("overflow");
  }, []);

  const updateCompactHover = useCallback(
    (hovered: boolean) => {
      if (nodeDensity !== "compact") {
        if (!hovered) setCompactHovered(false);
        return;
      }

      const currentlyRevealed = compactHovered || selected;
      const nextRevealed = hovered || selected;
      setCompactHovered(hovered);

      if (currentlyRevealed === nextRevealed) return;

      const background = compactCardRef.current?.querySelector<HTMLElement>(
        ".tasks-map-task-background"
      );
      compactAnimationStartHeightRef.current =
        background?.getBoundingClientRect().height ?? null;
      stopCompactAnimation();
    },
    [compactHovered, nodeDensity, selected, stopCompactAnimation]
  );

  const handleCompactMouseEnter = useCallback(() => {
    updateCompactHover(true);
  }, [updateCompactHover]);

  const handleCompactMouseLeave = useCallback(() => {
    updateCompactHover(false);
  }, [updateCompactHover]);

  useLayoutEffect(() => {
    const background = compactCardRef.current?.querySelector<HTMLElement>(
      ".tasks-map-task-background"
    );
    const startHeight = compactAnimationStartHeightRef.current;
    compactAnimationStartHeightRef.current = null;

    if (!background || startHeight === null) return;

    const targetHeight = background.getBoundingClientRect().height;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia(REDUCED_MOTION_QUERY).matches;
    if (
      reduceMotion ||
      typeof background.animate !== "function" ||
      Math.abs(startHeight - targetHeight) < 1
    ) {
      background.style.removeProperty("overflow");
      return;
    }

    background.style.setProperty("overflow", "hidden");
    const animation = background.animate(
      [
        {
          height: `${startHeight}px`,
          minHeight: `${startHeight}px`,
          maxHeight: `${startHeight}px`,
        },
        {
          height: `${targetHeight}px`,
          minHeight: `${targetHeight}px`,
          maxHeight: `${targetHeight}px`,
        },
      ],
      {
        duration: COMPACT_REVEAL_DURATION_MS,
        easing: COMPACT_REVEAL_EASING,
      }
    );
    compactAnimationRef.current = animation;

    const finish = () => {
      if (compactAnimationRef.current !== animation) return;
      compactAnimationRef.current = null;
      background.style.removeProperty("overflow");
    };
    animation.onfinish = finish;
    animation.oncancel = finish;

    return () => {
      if (compactAnimationRef.current !== animation) return;
      compactAnimationRef.current = null;
      animation.cancel();
      background.style.removeProperty("overflow");
    };
  }, [compactRevealed]);

  const isVertical = layoutDirection === "Vertical";
  const targetPosition = isVertical ? Position.Top : Position.Left;
  const sourcePosition = isVertical ? Position.Bottom : Position.Right;

  const handleTagRemove = async (tagToRemove: string) => {
    const previousTags = tags;
    const updatedTags = previousTags.filter((tag) => tag !== tagToRemove);
    // Immediately update the visual state
    setTags(updatedTags);
    updateTaskTags(task.id, updatedTags);

    try {
      const update = () => removeTagFromTaskInVault(task, tagToRemove, app);
      if (trackVaultWrite && task.link) {
        await trackVaultWrite(task.link, update);
      } else {
        await update();
      }
    } catch {
      // Revert the visual change if the vault operation failed
      setTags(previousTags);
      updateTaskTags(task.id, previousTags);
    }
  };

  const handleAddTag = async (tagToAdd: string) => {
    if (!tagToAdd.trim()) return;

    // Don't allow tags with spaces - check before any cleaning
    if (tagToAdd.includes(" ")) {
      setTagError(true);
      // Reset after showing error briefly
      window.setTimeout(() => {
        setTagError(false);
        setIsAddingTag(false);
      }, 100);
      return;
    }

    const cleanTag = tagToAdd.trim().replace(/^#+/, ""); // Remove any leading #

    // Clear any previous error
    setTagError(false);

    // Don't add duplicate tags
    if (tags.includes(cleanTag)) {
      setIsAddingTag(false);
      return;
    }

    const previousTags = tags;
    const updatedTags = [...previousTags, cleanTag];
    // Immediately update the visual state and shared task registry.
    setTags(updatedTags);
    updateTaskTags(task.id, updatedTags);

    try {
      const update = () => addTagToTaskInVault(task, cleanTag, app);
      if (trackVaultWrite && task.link) {
        await trackVaultWrite(task.link, update);
      } else {
        await update();
      }
    } catch {
      // Revert the visual change if the vault operation failed
      setTags(previousTags);
      updateTaskTags(task.id, previousTags);
    }

    // Reset input state
    setIsAddingTag(false);
  };

  const handleCancelAddTag = () => {
    setIsAddingTag(false);
    setTagError(false);
  };

  const handleStarToggle = async () => {
    const newStarred = !starred;
    // Immediately update the visual state
    setStarred(newStarred);
    onTaskStarredChange?.(task.id, newStarred);

    try {
      const update = newStarred
        ? () => addStarToTaskInVault(task, app)
        : () => removeStarFromTaskInVault(task, app);
      if (trackVaultWrite && task.link) {
        await trackVaultWrite(task.link, update);
      } else {
        await update();
      }
    } catch {
      // Revert the visual change if the vault operation failed
      setStarred(!newStarred);
      onTaskStarredChange?.(task.id, !newStarred);
    }
  };

  const handleStatusChange = useCallback(
    (newStatus: TaskStatus) => {
      setStatus(newStatus);
      onTaskStatusChange?.(task.id, newStatus);
    },
    [onTaskStatusChange, task.id]
  );

  const handlePriorityChange = useCallback(
    (newPriority: string) => {
      setPriority(newPriority);
      onTaskPriorityChange?.(task.id, newPriority);
    },
    [onTaskPriorityChange, task.id]
  );

  const canCreateTaskNotesProjectTask =
    task.type === "note" &&
    !!task.link &&
    isTaskNotesCreationModalAvailable(app);

  const handleCreateTask = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!task.link) return;
      openTaskNotesProjectTaskCreationModal(app, task.link);
    },
    [app, task.link]
  );

  const handleToggleChildren = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      onToggleChildren?.(task.id);
    },
    [onToggleChildren, task.id]
  );

  const handleHeaderDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div
      className={[
        "tasks-map-task-node-shell",
        `tasks-map-task-node-shell--${nodeDensity}`,
        compactRevealed && "tasks-map-task-node-shell--revealed",
        selected && "tasks-map-task-node-shell--selected",
      ]
        .filter(Boolean)
        .join(" ")}
      onMouseEnter={handleCompactMouseEnter}
      onMouseLeave={handleCompactMouseLeave}
    >
      <div ref={compactCardRef} className="tasks-map-task-node-card">
        <TaskBackground
          status={status}
          priority={showPriorities ? priority : ""}
          priorityAccentPosition={priorityAccentPosition}
          priorityOptions={
            task.type === "dataview" ? undefined : priorityOptions
          }
          starred={starred}
          expanded={expanded}
          debugVisualization={debugVisualization}
          selected={selected}
        >
          <Handle type="target" position={targetPosition} />
          <Handle type="source" position={sourcePosition} />
          <div
            className="tasks-map-task-node-header"
            onDoubleClick={handleHeaderDoubleClick}
          >
            <TaskStatusToggle
              status={status}
              task={task}
              onStatusChange={handleStatusChange}
              trackVaultWrite={trackVaultWrite}
            />
            {showPriorities && (
              <TaskPriorityToggle
                priority={priority}
                task={task}
                priorityOptions={priorityOptions}
                onPriorityChange={handlePriorityChange}
                trackVaultWrite={trackVaultWrite}
              />
            )}
            <div className="tasks-map-task-node-header-spacer" />
            <StarButton
              starred={starred}
              onClick={() => void handleStarToggle()}
            />
            {canCreateTaskNotesProjectTask && (
              <button
                type="button"
                className="tasks-map-task-node-header-button nodrag"
                title={t("task_node.create_project_task")}
                aria-label={t("task_node.create_project_task")}
                onClick={handleCreateTask}
              >
                <CirclePlus size={16} />
              </button>
            )}
            <LinkButton link={task.link} app={app} taskStatus={status} />
            <TaskMenu
              task={task}
              app={app}
              onTaskDeleted={() => onDeleteTask?.(task.id)}
              onTaskChanged={onTaskChanged}
              onEditTask={task.link ? () => onEditTask?.(task.link) : undefined}
              trackVaultWrite={trackVaultWrite}
            />
          </div>

          <div className="tasks-map-task-node-content">
            <span ref={summaryRef} className="tasks-map-task-node-summary" />
          </div>

          {task instanceof NoteTask && (
            <QuickUpdate
              task={task}
              propertyName={quickCommentsPropertyName}
              onChanged={onQuickCommentsChanged}
              trackVaultWrite={trackVaultWrite}
            />
          )}

          {showTags && (
            <div className="tasks-map-task-node-footer">
              <div className="tasks-map-tag-list">
                {tags.map((tag) => (
                  <Tag
                    key={tag}
                    tag={tag}
                    palette={tagColorPalette}
                    onRemove={(tag) => void handleTagRemove(tag)}
                  />
                ))}

                {/* Add tag button/input */}
                {isAddingTag ? (
                  <div className="nodrag">
                    <TagInput
                      allTags={allTags}
                      existingTags={tags}
                      onAddTag={(tag) => void handleAddTag(tag)}
                      onCancel={handleCancelAddTag}
                      hasError={tagError}
                    />
                  </div>
                ) : (
                  <span
                    className="tasks-map-add-tag-button"
                    onClick={() => setIsAddingTag(true)}
                  >
                    <Plus size={10} />
                    Add tag
                  </span>
                )}
              </div>
            </div>
          )}

          {debugVisualization && (
            <ExpandButton
              expanded={expanded}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
            />
          )}

          {debugVisualization && expanded && (
            <TaskDetails task={task} status={status} />
          )}

          {groupByProject && task.projects.length > 0 && (
            <div
              className={[
                "tasks-map-task-node-projects",
                task.projects.length === 1 &&
                  "tasks-map-task-node-projects--single",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {task.projects.map((project, index) => (
                <ProjectDot key={project} project={project} index={index} />
              ))}
            </div>
          )}
        </TaskBackground>
        {hasVisibleChildren && (
          <button
            type="button"
            className={[
              "tasks-map-task-node-fold-button",
              `tasks-map-task-node-fold-button--${
                isVertical ? "vertical" : "horizontal"
              }`,
              "nodrag nopan",
            ].join(" ")}
            title={t(
              childrenCollapsed
                ? "task_node.expand_children_count"
                : "task_node.collapse_children",
              { count: foldedChildrenCount }
            )}
            aria-label={t(
              childrenCollapsed
                ? "task_node.expand_children_count"
                : "task_node.collapse_children",
              { count: foldedChildrenCount }
            )}
            aria-expanded={!childrenCollapsed}
            onClick={handleToggleChildren}
            onDoubleClick={handleHeaderDoubleClick}
          >
            {childrenCollapsed ? (
              <ChevronRight size={14} />
            ) : (
              <ChevronDown size={14} />
            )}
            {childrenCollapsed && (
              <span className="tasks-map-task-node-fold-count">
                {foldedChildrenCount}
              </span>
            )}
          </button>
        )}
      </div>
      <TaskAttachments
        task={task}
        visibleAttachmentKinds={visibleAttachmentKinds}
      />
    </div>
  );
}
