import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowUpRight,
  ChevronRight,
  Flag,
  Link2,
  MoreHorizontal,
  Network,
} from "lucide-react";
import { getStatusCategory } from "src/lib/branch-model";
import {
  formatContexts,
  formatShortDate,
  getDueState,
  isImportantPriority,
} from "src/lib/minimal-card";
import {
  foldNoteContextTasks,
  getNoteContextRootId,
  getNoteContextTitle,
  NoteContext,
} from "src/lib/note-context";
import {
  getPriorityByValue,
  TaskPriorityConfig,
} from "src/lib/priority-config";
import { getStatusById, TaskStatusConfig } from "src/lib/status-config";
import { NoteContextStyle } from "src/types/settings";
import { BaseTask } from "src/types/task";
import NoteContextMapPopover from "./note-context-map-popover";
import { t } from "../i18n";

/** Space kept between the first line's last item and the buttons. */
const PROPS_MARGIN = 16;

/** Hover delay before the project map peeks, and grace before it hides. */
const MAP_OPEN_DELAY_MS = 350;
const MAP_CLOSE_DELAY_MS = 300;

export interface NoteContextActions {
  open(_task: BaseTask, _event: React.MouseEvent): void;
  hover(_task: BaseTask, _event: React.MouseEvent, _el: HTMLElement): void;
  /** Open a map tab on the whole project, with the task highlighted. */
  openInMap(_task: BaseTask, _rootId: string | null): void;
  showMenu(_tasks: BaseTask[], _event: React.MouseEvent): void;
  /** Pick a status for the task from a menu. */
  showStatusMenu(_task: BaseTask, _event: React.MouseEvent): void;
  /** Pick a priority for the task from a menu. */
  showPriorityMenu(_task: BaseTask, _event: React.MouseEvent): void;
  /** Toggle the task's contexts from a menu. */
  showContextMenu(_task: BaseTask, _event: React.MouseEvent): void;
  /** Priority, dates, star and today for the task. */
  showTaskMenu(_task: BaseTask, _event: React.MouseEvent): void;
  /** The project map shown in the floating popover. */
  renderProjectMap(
    _rootId: string,
    _taskId: string,
    _height: number
  ): React.ReactNode;
}

interface NoteContextStripProps {
  context: NoteContext;
  displayStyle: Exclude<NoteContextStyle, "off">;
  statuses: TaskStatusConfig[];
  priorities: TaskPriorityConfig[];
  /** True when the note is not the task itself but hangs off it. */
  linked: boolean;
  anchorIndex: number;
  anchorCount: number;
  onNextAnchor: () => void;
  actions: NoteContextActions;
}

type MapState = "closed" | "peek" | "pinned";

interface TaskLinkProps {
  task: BaseTask;
  statuses: TaskStatusConfig[];
  actions: NoteContextActions;
  current?: boolean;
  project?: boolean;
  showDot?: boolean;
  /** The status dot opens the status menu. */
  editable?: boolean;
  /** Markers drawn after the title (priority, due date). */
  markers?: React.ReactNode;
}

interface StatusDotProps {
  color: string;
  label: string;
  /** Given for editable tasks: the dot becomes a status button. */
  onClick?: (_event: React.MouseEvent) => void;
}

function StatusDot({ color, label, onClick }: StatusDotProps) {
  const dotRef = useCallback(
    (element: HTMLElement | null) => {
      element?.style.setProperty("--tasks-map-status-color", color);
    },
    [color]
  );
  if (!onClick) {
    return <span className="tasks-map-note-context-dot" ref={dotRef} />;
  }
  return (
    <button
      className="tasks-map-note-context-dot is-button"
      ref={dotRef}
      onClick={onClick}
      aria-label={t("note_context.dot_status", { status: label })}
    />
  );
}

function TaskLink({
  task,
  statuses,
  actions,
  current = false,
  project = false,
  showDot = true,
  editable = false,
  markers,
}: TaskLinkProps) {
  const { color, label: statusLabel } = getStatusById(task.status, statuses);
  const closed = getStatusCategory(task.status, statuses) === "closed";
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      actions.open(task, event);
    },
    [actions, task]
  );
  const handleDotClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      actions.showStatusMenu(task, event);
    },
    [actions, task]
  );
  const handleHover = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      actions.hover(task, event, event.currentTarget);
    },
    [actions, task]
  );
  const classes = ["tasks-map-note-context-task"];
  if (current) classes.push("is-current");
  if (project) classes.push("is-project");
  if (closed) classes.push("is-closed");

  return (
    <span className={classes.join(" ")}>
      {showDot && (
        <StatusDot
          color={color}
          label={statusLabel}
          onClick={editable ? handleDotClick : undefined}
        />
      )}
      <a
        className="tasks-map-note-context-title"
        role="link"
        tabIndex={0}
        onClick={handleClick}
        onMouseEnter={handleHover}
      >
        {getNoteContextTitle(task)}
      </a>
      {markers}
    </span>
  );
}

interface Box {
  top: number;
  right: number;
}

/**
 * Right edge of the items on the first line of a wrapping row. Items whose
 * top differs from the first item's by more than 2px are on later lines.
 */
export function getFirstLineRight(items: Box[]): number | null {
  if (items.length === 0) return null;
  const top = items[0].top;
  return Math.max(
    ...items
      .filter((item) => Math.abs(item.top - top) <= 2)
      .map((item) => item.right)
  );
}

/**
 * Dividers that end a line or start one: the item before and the item
 * after them sit on different lines, so they would dangle.
 */
export function getDanglingDividers(
  items: { divider: boolean; top: number }[]
): number[] {
  const dangling: number[] = [];
  items.forEach((item, index) => {
    if (!item.divider) return;
    const before = items[index - 1];
    const after = items[index + 1];
    if (!before || !after || Math.abs(before.top - after.top) > 2) {
      dangling.push(index);
    }
  });
  return dangling;
}

function measureRow(row: Element) {
  return Array.from(row.children).map((child) => {
    const rect = child.getBoundingClientRect();
    return {
      element: child,
      divider: child.classList.contains("tasks-map-note-context-divider"),
      top: rect.top,
      right: rect.right,
    };
  });
}

/** Gap between the property buttons, matching the CSS. */
const PROP_GAP = 2;

/** The quick-edit buttons, in the order they are dropped from the end. */
export const PROPERTY_BUTTONS = ["status", "priority", "context"] as const;
export type PropertyButton = (typeof PROPERTY_BUTTONS)[number];

/**
 * The longest leading run of buttons that fits in `available` px: when
 * space is short, context goes first, then priority. Status is kept only if
 * it fits on its own.
 */
export function chooseFittingButtons<T extends string>(
  buttons: { id: T; width: number }[],
  available: number,
  gap = PROP_GAP
): T[] {
  const chosen: T[] = [];
  let used = 0;
  for (const button of buttons) {
    const width = used + (chosen.length > 0 ? gap : 0) + button.width;
    if (width > available) break;
    chosen.push(button.id);
    used = width;
  }
  return chosen;
}

/**
 * Keep the strip tidy as it wraps: hide dividers left at a line end, and
 * pick the property buttons that fit beside the first line.
 */
function useStripLayout(
  stripEl: HTMLElement | null,
  measureEl: HTMLElement | null,
  toolbarEl: HTMLElement | null
): PropertyButton[] {
  const [chosenKey, setChosenKey] = useState("");

  useLayoutEffect(() => {
    if (!stripEl) return;
    const win = stripEl.ownerDocument.defaultView ?? window;
    const update = () => {
      const rows = stripEl.querySelectorAll(".tasks-map-note-context-row");
      rows.forEach((row) => {
        const items = measureRow(row);
        const dangling = new Set(getDanglingDividers(items));
        items.forEach((item, index) => {
          if (item.divider)
            item.element.classList.toggle("is-line-end", dangling.has(index));
        });
      });
      if (!measureEl || !toolbarEl || rows.length === 0) {
        setChosenKey("");
        return;
      }
      const widths = new Map<string, number>();
      measureEl.querySelectorAll<HTMLElement>("[data-prop]").forEach((el) => {
        widths.set(el.dataset.prop ?? "", el.offsetWidth);
      });
      const firstLineRight = getFirstLineRight(measureRow(rows[0]));
      const available =
        toolbarEl.getBoundingClientRect().left -
        PROPS_MARGIN -
        (firstLineRight ?? stripEl.getBoundingClientRect().left);
      const chosen = chooseFittingButtons(
        PROPERTY_BUTTONS.map((id) => ({ id, width: widths.get(id) ?? 0 })),
        available
      );
      setChosenKey(chosen.join(" "));
    };
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = win.requestAnimationFrame(() => {
        frame = null;
        update();
      });
    };
    schedule();
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(stripEl);
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(stripEl, { childList: true, subtree: true });
    return () => {
      if (frame !== null) win.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [stripEl, measureEl, toolbarEl]);

  return useMemo(
    () => (chosenKey ? (chosenKey.split(" ") as PropertyButton[]) : []),
    [chosenKey]
  );
}

interface PropertyContentProps {
  prop: PropertyButton;
  task: BaseTask;
  statuses: TaskStatusConfig[];
  priorities: TaskPriorityConfig[];
}

/** What a property button shows: status, priority or context. */
function PropertyContent({
  prop,
  task,
  statuses,
  priorities,
}: PropertyContentProps) {
  const status = getStatusById(task.status, statuses);
  const priority = getPriorityByValue(task.priority, priorities);
  const flagRef = useCallback(
    (element: HTMLElement | null) => {
      element?.style.setProperty(
        "--tasks-map-priority-color",
        priority.color ?? ""
      );
    },
    [priority.color]
  );
  if (prop === "status") {
    return (
      <>
        <StatusDot color={status.color} label={status.label} />
        {status.label}
      </>
    );
  }
  if (prop === "priority") {
    return (
      <>
        <span className="tasks-map-note-context-prop-flag" ref={flagRef}>
          <Flag size={11} fill="currentColor" />
        </span>
        {priority.label}
      </>
    );
  }
  const contexts = formatContexts(task.groupValues);
  return contexts ? (
    <>{contexts}</>
  ) : (
    <span className="tasks-map-note-context-prop-empty">
      {t("note_context.no_context")}
    </span>
  );
}

interface PropertyButtonsProps {
  task: BaseTask;
  statuses: TaskStatusConfig[];
  priorities: TaskPriorityConfig[];
  actions: NoteContextActions;
  /** Buttons chosen to show; empty shows nothing. */
  chosen: PropertyButton[];
  measureRef: (_element: HTMLSpanElement | null) => void;
}

/**
 * Status, priority and context as three buttons that open their menus.
 * An invisible copy of each is kept for measuring.
 */
function PropertyButtons({
  task,
  statuses,
  priorities,
  actions,
  chosen,
  measureRef,
}: PropertyButtonsProps) {
  const handlers: Record<PropertyButton, (_e: React.MouseEvent) => void> =
    useMemo(
      () => ({
        status: (event) => actions.showStatusMenu(task, event),
        priority: (event) => actions.showPriorityMenu(task, event),
        context: (event) => actions.showContextMenu(task, event),
      }),
      [actions, task]
    );
  const content = (prop: PropertyButton) => (
    <PropertyContent
      prop={prop}
      task={task}
      statuses={statuses}
      priorities={priorities}
    />
  );

  return (
    <>
      <span
        className="tasks-map-note-context-props is-measure"
        ref={measureRef}
        aria-hidden="true"
      >
        {PROPERTY_BUTTONS.map((prop) => (
          <span
            key={prop}
            className="tasks-map-note-context-prop"
            data-prop={prop}
          >
            {content(prop)}
          </span>
        ))}
      </span>
      {chosen.length > 0 && (
        <span className="tasks-map-note-context-props">
          {chosen.map((prop) => (
            <button
              key={prop}
              className={`tasks-map-note-context-prop is-${prop}`}
              onClick={handlers[prop]}
              aria-label={t(`note_context.change_${prop}`)}
            >
              {content(prop)}
            </button>
          ))}
        </span>
      )}
    </>
  );
}

interface TaskMarkersProps {
  task: BaseTask;
  priorities: TaskPriorityConfig[];
}

/** At rest the current task only flags a top priority and a near due date. */
function TaskMarkers({ task, priorities }: TaskMarkersProps) {
  const dueState = getDueState(task.dueDate);
  const important = isImportantPriority(task.priority, priorities);
  if (!dueState && !important) return null;
  return (
    <>
      {important && (
        <span
          className="tasks-map-note-context-marker is-priority"
          aria-label={t("minimal.priority", {
            priority: getPriorityByValue(task.priority, priorities).label,
          })}
        >
          <Flag size={11} fill="currentColor" />
        </span>
      )}
      {dueState && task.dueDate && (
        <span
          className={`tasks-map-note-context-marker is-due is-${dueState}`}
          aria-label={t(`minimal.due_${dueState}`, { date: task.dueDate })}
        >
          {formatShortDate(task.dueDate)}
        </span>
      )}
    </>
  );
}

function Divider() {
  return <span className="tasks-map-note-context-divider" aria-hidden="true" />;
}

function Separator() {
  return (
    <span className="tasks-map-note-context-separator" aria-hidden="true">
      ›
    </span>
  );
}

interface FoldedRowProps {
  tasks: BaseTask[];
  statuses: TaskStatusConfig[];
  actions: NoteContextActions;
  /** Draw a divider before the first task too (it follows the current one). */
  leadingDivider?: boolean;
  /** Status dots open the status menu. */
  editable?: boolean;
}

/** Up to four open tasks, then "+N" and "✓N" toggles for the rest. */
function FoldedTasks({
  tasks,
  statuses,
  actions,
  leadingDivider = false,
  editable = false,
}: FoldedRowProps) {
  const [showHidden, setShowHidden] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const folded = useMemo(
    () => foldNoteContextTasks(tasks, statuses),
    [tasks, statuses]
  );
  const toggleHidden = useCallback(() => setShowHidden((v) => !v), []);
  const toggleClosed = useCallback(() => setShowClosed((v) => !v), []);
  const visible = [
    ...folded.shown,
    ...(showHidden ? folded.hidden : []),
    ...(showClosed ? folded.closed : []),
  ];

  return (
    <>
      {visible.map((task, index) => (
        <React.Fragment key={task.id}>
          {(leadingDivider || index > 0) && <Divider />}
          <TaskLink
            task={task}
            statuses={statuses}
            actions={actions}
            editable={editable}
          />
        </React.Fragment>
      ))}
      {folded.hidden.length > 0 && (
        <button
          className="tasks-map-note-context-more"
          onClick={toggleHidden}
          aria-label={t("note_context.toggle_more")}
        >
          {showHidden
            ? t("note_context.less")
            : t("note_context.more", { count: folded.hidden.length })}
        </button>
      )}
      {folded.closed.length > 0 && (
        <button
          className="tasks-map-note-context-more"
          onClick={toggleClosed}
          aria-label={t("note_context.toggle_closed")}
        >
          {showClosed
            ? t("note_context.hide_closed")
            : t("note_context.closed", { count: folded.closed.length })}
        </button>
      )}
    </>
  );
}

interface PathProps {
  ancestors: BaseTask[];
  statuses: TaskStatusConfig[];
  actions: NoteContextActions;
}

/** Project › … › direct parent; the middle folds into "…". */
function AncestorPath({ ancestors, statuses, actions }: PathProps) {
  const [expanded, setExpanded] = useState(false);
  const expand = useCallback(() => setExpanded(true), []);
  const middleFolded = !expanded && ancestors.length > 2;
  const shown = middleFolded
    ? [ancestors[0], null, ancestors[ancestors.length - 1]]
    : ancestors;

  return (
    <>
      {shown.map((task, index) => (
        <React.Fragment key={task?.id ?? "folded"}>
          {index > 0 && <Separator />}
          {task ? (
            <TaskLink
              task={task}
              statuses={statuses}
              actions={actions}
              project={index === 0}
              showDot={false}
            />
          ) : (
            <button
              className="tasks-map-note-context-more"
              onClick={expand}
              aria-label={t("note_context.show_path")}
            >
              …
            </button>
          )}
        </React.Fragment>
      ))}
    </>
  );
}

/** Hover to peek at the project map, click to pin it open. */
function useMapPopover() {
  const [state, setState] = useState<MapState>("closed");
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const clearTimers = useCallback(() => {
    if (openTimerRef.current !== null)
      window.clearTimeout(openTimerRef.current);
    if (closeTimerRef.current !== null)
      window.clearTimeout(closeTimerRef.current);
    openTimerRef.current = null;
    closeTimerRef.current = null;
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const scheduleClose = useCallback(() => {
    if (openTimerRef.current !== null)
      window.clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
    if (closeTimerRef.current !== null)
      window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setState((current) => (current === "peek" ? "closed" : current));
    }, MAP_CLOSE_DELAY_MS);
  }, []);
  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null)
      window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);
  const onButtonEnter = useCallback(() => {
    cancelClose();
    if (openTimerRef.current !== null) return;
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      setState((current) => (current === "closed" ? "peek" : current));
    }, MAP_OPEN_DELAY_MS);
  }, [cancelClose]);
  const onButtonClick = useCallback(() => {
    clearTimers();
    setState((current) => (current === "pinned" ? "closed" : "pinned"));
  }, [clearTimers]);
  const pin = useCallback(() => {
    clearTimers();
    setState("pinned");
  }, [clearTimers]);
  const close = useCallback(() => {
    clearTimers();
    setState("closed");
  }, [clearTimers]);

  return {
    state,
    onButtonEnter,
    onButtonLeave: scheduleClose,
    onButtonClick,
    onPopoverEnter: cancelClose,
    onPopoverLeave: scheduleClose,
    pin,
    close,
  };
}

export default function NoteContextStrip({
  context,
  displayStyle,
  statuses,
  priorities,
  linked,
  anchorIndex,
  anchorCount,
  onNextAnchor,
  actions,
}: NoteContextStripProps) {
  const { task, ancestors, otherParents, siblings, children } = context;
  const rootId = getNoteContextRootId(context);
  const [stripEl, setStripEl] = useState<HTMLDivElement | null>(null);
  const [mapButtonEl, setMapButtonEl] = useState<HTMLButtonElement | null>(
    null
  );
  const map = useMapPopover();
  const [measureEl, setMeasureEl] = useState<HTMLSpanElement | null>(null);
  const [toolbarEl, setToolbarEl] = useState<HTMLSpanElement | null>(null);
  const chosenProps = useStripLayout(stripEl, measureEl, toolbarEl);

  const handleOpenInMap = useCallback(
    () => actions.openInMap(task, rootId),
    [actions, task, rootId]
  );
  const showSiblingMenu = useCallback(
    (event: React.MouseEvent) => actions.showMenu(siblings, event),
    [actions, siblings]
  );
  const showChildMenu = useCallback(
    (event: React.MouseEvent) => actions.showMenu(children, event),
    [actions, children]
  );
  const showTaskMenu = useCallback(
    (event: React.MouseEvent) => actions.showTaskMenu(task, event),
    [actions, task]
  );
  const renderMap = useCallback(
    (height: number) =>
      rootId ? actions.renderProjectMap(rootId, task.id, height) : null,
    [actions, rootId, task.id]
  );

  const current = (
    <>
      {linked && (
        <span
          className="tasks-map-note-context-linked"
          aria-label={t("note_context.linked_from")}
        >
          <Link2 size={12} />
        </span>
      )}
      <TaskLink
        task={task}
        statuses={statuses}
        actions={actions}
        current
        editable
        markers={<TaskMarkers task={task} priorities={priorities} />}
      />
    </>
  );

  const toolbarClasses = ["tasks-map-note-context-actions"];
  if (map.state !== "closed") toolbarClasses.push("is-open");
  const toolbar = (
    <span className={toolbarClasses.join(" ")} ref={setToolbarEl}>
      <PropertyButtons
        task={task}
        statuses={statuses}
        priorities={priorities}
        actions={actions}
        chosen={chosenProps}
        measureRef={setMeasureEl}
      />
      {anchorCount > 1 && (
        <button
          className="tasks-map-note-context-action"
          onClick={onNextAnchor}
          aria-label={t("note_context.next_anchor", { count: anchorCount })}
        >
          {anchorIndex + 1}/{anchorCount}
        </button>
      )}
      {rootId && (
        <button
          className={`tasks-map-note-context-action${
            map.state === "pinned" ? " is-active" : ""
          }`}
          ref={setMapButtonEl}
          onClick={map.onButtonClick}
          onMouseEnter={map.onButtonEnter}
          onMouseLeave={map.onButtonLeave}
          aria-label={t("note_context.peek_map")}
        >
          <Network size={13} />
        </button>
      )}
      <button
        className="tasks-map-note-context-action"
        onClick={showTaskMenu}
        aria-label={t("note_context.edit_task")}
      >
        <MoreHorizontal size={13} />
      </button>
      <button
        className="tasks-map-note-context-action"
        onClick={handleOpenInMap}
        aria-label={t("note_context.open_in_map")}
      >
        <ArrowUpRight size={13} />
      </button>
    </span>
  );

  const popover = map.state !== "closed" && stripEl && rootId && (
    <NoteContextMapPopover
      anchorEl={stripEl}
      buttonEl={mapButtonEl}
      onPin={map.pin}
      onClose={map.close}
      onPointerEnter={map.onPopoverEnter}
      onPointerLeave={map.onPopoverLeave}
      render={renderMap}
    />
  );

  const extraParents = otherParents.length > 0 && (
    <span
      className="tasks-map-note-context-note"
      aria-label={otherParents.map(getNoteContextTitle).join(", ")}
    >
      {t("note_context.other_parents", { count: otherParents.length })}
    </span>
  );

  if (displayStyle === "breadcrumb") {
    return (
      <div className="tasks-map-note-context is-breadcrumb" ref={setStripEl}>
        <div className="tasks-map-note-context-row">
          <AncestorPath
            ancestors={ancestors}
            statuses={statuses}
            actions={actions}
          />
          {ancestors.length > 0 &&
            (siblings.length > 0 ? (
              <button
                className="tasks-map-note-context-separator is-menu"
                onClick={showSiblingMenu}
                aria-label={t("note_context.siblings", {
                  count: siblings.length,
                })}
              >
                ›
              </button>
            ) : (
              <Separator />
            ))}
          {current}
          {children.length > 0 && (
            <>
              <Separator />
              <button
                className="tasks-map-note-context-more"
                onClick={showChildMenu}
              >
                {t("note_context.subtasks", { count: children.length })}
                <ChevronRight size={11} />
              </button>
            </>
          )}
          {extraParents}
        </div>
        {toolbar}
        {popover}
      </div>
    );
  }

  const rowsClasses = ["tasks-map-note-context-rows"];
  if (ancestors.length > 0) rowsClasses.push("has-path");
  return (
    <div className="tasks-map-note-context is-map" ref={setStripEl}>
      <div className={rowsClasses.join(" ")}>
        {ancestors.length > 0 && (
          <div className="tasks-map-note-context-row is-path">
            <AncestorPath
              ancestors={ancestors}
              statuses={statuses}
              actions={actions}
            />
            {extraParents}
          </div>
        )}
        <div className="tasks-map-note-context-row is-here">
          {current}
          <FoldedTasks
            tasks={siblings}
            statuses={statuses}
            actions={actions}
            leadingDivider
          />
        </div>
        {children.length > 0 && (
          <div className="tasks-map-note-context-row is-below">
            <FoldedTasks
              tasks={children}
              statuses={statuses}
              actions={actions}
              editable
            />
          </div>
        )}
      </div>
      {toolbar}
      {popover}
    </div>
  );
}
