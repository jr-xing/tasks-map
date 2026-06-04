import React, { useState, useContext, useCallback, useEffect } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { setTooltip } from "obsidian";
import { CirclePlus, Paperclip, Plus } from "lucide-react";
import { useApp } from "src/hooks/hooks";
import { BaseTask } from "src/types/task";
import { TaskAttachmentKind } from "src/types/base-task";
import { TaskDetails } from "./task-details";
import { ExpandButton } from "./expand-button";
import { LinkButton } from "./link-button";
import { StarButton } from "./star-button";
import TaskMenu from "./task-menu";
import { Tag } from "./tag";
import { TaskStatusToggle } from "./task-status";
import { TaskBackground } from "./task-background";
import { TaskPriority } from "./task-priority";
import { TagInput } from "./tag-input";
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

const PROJECT_DOT_COLORS = [
  "var(--color-blue)",
  "var(--color-purple)",
  "var(--color-green)",
  "var(--color-red)",
  "var(--color-orange)",
  "var(--color-cyan)",
  "var(--color-pink)",
  "var(--color-yellow)",
];
export const NODEHEIGHT = 120;

interface ProjectDotProps {
  project: string;
  color: string;
}

function ProjectDot({ project, color }: ProjectDotProps) {
  const ref = useCallback(
    (el: HTMLSpanElement | null) => {
      if (el) {
        el.style.setProperty("--dot-color", color);
        setTooltip(el, project);
      }
    },
    [project, color]
  );
  return <span ref={ref} className="tasks-map-project-dot" />;
}

interface TaskNodeData {
  task: BaseTask;
  layoutDirection?: "Horizontal" | "Vertical";
  showPriorities?: boolean;
  showTags?: boolean;
  debugVisualization?: boolean;
  tagColorPalette?: import("src/lib/tag-color-manager").TagColorPalette;
  visibleAttachmentKinds?: TaskAttachmentKind[];
  groupByProject?: boolean;
  // eslint-disable-next-line no-unused-vars -- callback parameter convention
  onDeleteTask?: (taskId: string) => void;
  onTaskChanged?: () => void;
  // eslint-disable-next-line no-unused-vars -- callback parameter convention
  onEditTask?: (taskPath: string) => void;
}

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
    showTags = true,
    debugVisualization = false,
    tagColorPalette = "rainbow",
    visibleAttachmentKinds,
    groupByProject = false,
    onDeleteTask,
    onTaskChanged,
    onEditTask,
  } = data;

  const { allTags, updateTaskTags } = useContext(TagsContext);
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState(task.status);
  const [starred, setStarred] = useState(task.starred);
  const [tags, setTags] = useState(task.tags || []);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [tagError, setTagError] = useState(false);
  const app = useApp();
  const summaryRef = useSummaryRenderer(task.summary, app);

  // status/starred/tags are mirrored into local state for optimistic updates.
  // ReactFlow reuses this component instance across reloads (the node id is
  // stable), so the useState initializers never re-run. Resync whenever the
  // task object is replaced — i.e. after reloadTasks pulls fresh data from the
  // vault — otherwise edits made to a note outside the map never show up.
  useEffect(() => {
    setStatus(task.status);
    setStarred(task.starred);
    setTags(task.tags || []);
  }, [task]);

  const isVertical = layoutDirection === "Vertical";
  const targetPosition = isVertical ? Position.Top : Position.Left;
  const sourcePosition = isVertical ? Position.Bottom : Position.Right;

  const handleTagRemove = async (tagToRemove: string) => {
    // Immediately update the visual state
    setTags((prevTags) => {
      const updatedTags = prevTags.filter((tag) => tag !== tagToRemove);
      // Update tasks array so allTags recomputes
      updateTaskTags(task.id, updatedTags);
      return updatedTags;
    });

    try {
      await removeTagFromTaskInVault(task, tagToRemove, app);
    } catch {
      // Revert the visual change if the vault operation failed
      setTags((prevTags) => {
        const revertedTags = [...prevTags, tagToRemove];
        updateTaskTags(task.id, revertedTags);
        return revertedTags;
      });
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

    // Immediately update the visual state
    setTags((prevTags) => {
      const updatedTags = [...prevTags, cleanTag];
      // Update tasks array so allTags recomputes
      updateTaskTags(task.id, updatedTags);
      return updatedTags;
    });

    try {
      await addTagToTaskInVault(task, cleanTag, app);
    } catch {
      // Revert the visual change if the vault operation failed
      setTags((prevTags) => {
        const revertedTags = prevTags.filter((tag) => tag !== cleanTag);
        updateTaskTags(task.id, revertedTags);
        return revertedTags;
      });
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

    try {
      if (newStarred) {
        await addStarToTaskInVault(task, app);
      } else {
        await removeStarFromTaskInVault(task, app);
      }
    } catch {
      // Revert the visual change if the vault operation failed
      setStarred(!newStarred);
    }
  };

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

  const handleHeaderDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div className="tasks-map-task-node-shell">
      <TaskBackground
        status={status}
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
            onStatusChange={setStatus}
          />
          {showPriorities && <TaskPriority priority={task.priority} />}
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
          />
        </div>

        <div className="tasks-map-task-node-content">
          <span ref={summaryRef} className="tasks-map-task-node-summary" />
        </div>

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

        {groupByProject && task.projects.length > 1 && (
          <div className="tasks-map-task-node-projects">
            {task.projects.map((project, index) => (
              <ProjectDot
                key={project}
                project={project}
                color={PROJECT_DOT_COLORS[index % PROJECT_DOT_COLORS.length]}
              />
            ))}
          </div>
        )}
      </TaskBackground>
      <TaskAttachments
        task={task}
        visibleAttachmentKinds={visibleAttachmentKinds}
      />
    </div>
  );
}
