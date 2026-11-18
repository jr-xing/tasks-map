import React, { useCallback } from "react";
import { NodeProps, useStore } from "reactflow";
import type { TaskGroupZoneData } from "src/lib/layout/task-group-zones";
import { t } from "../i18n";

/** On-screen label size the zone header aims for, in pixels. */
const LABEL_SCREEN_SIZE = 15;
const LABEL_MIN_SIZE = 20;
const LABEL_MAX_SIZE = 46;

/**
 * The frame around one task group's projects. Its label grows as the map
 * zooms out, so group names stay readable on the full map. The cards are
 * separate nodes placed on top of the frame.
 */
export default function TaskGroupZoneNode({
  data,
}: NodeProps<TaskGroupZoneData>) {
  const zoom = useStore((state) => state.transform[2]);
  const labelSize = Math.round(
    Math.min(
      LABEL_MAX_SIZE,
      Math.max(LABEL_MIN_SIZE, LABEL_SCREEN_SIZE / (zoom || 1))
    )
  );

  const setFrameVars = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      element.style.setProperty("--tasks-map-zone-width", `${data.width}px`);
      element.style.setProperty("--tasks-map-zone-height", `${data.height}px`);
      element.style.setProperty(
        "--tasks-map-zone-label-size",
        `${labelSize}px`
      );
      if (data.color) {
        element.style.setProperty("--tasks-map-zone-color", data.color);
      } else {
        element.style.removeProperty("--tasks-map-zone-color");
      }
    },
    [data.width, data.height, data.color, labelSize]
  );

  const counts = [
    data.projects > 0 && t("task_groups.projects", { count: data.projects }),
    t("task_groups.open", { count: data.open }),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      ref={setFrameVars}
      className={[
        "tasks-map-task-group-zone",
        !data.label && "tasks-map-task-group-zone--ungrouped",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="tasks-map-task-group-zone-header">
        <span className="tasks-map-task-group-zone-label">
          {data.label || t("task_groups.ungrouped")}
        </span>
        <span className="tasks-map-task-group-zone-counts">{counts}</span>
      </div>
    </div>
  );
}
