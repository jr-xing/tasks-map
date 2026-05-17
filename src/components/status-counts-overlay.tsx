import React, { useMemo, useRef, useEffect, useContext } from "react";
import { BaseTask } from "src/types/task";
import { t } from "../i18n";
import { StatusConfigContext } from "src/contexts/context";

function getContrastColor(bgColor: string): string {
  const canvas = activeDocument.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "#000000";
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  // Relative luminance (sRGB)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

interface StatusCountsOverlayProps {
  tasks: BaseTask[];
}

export default function StatusCountsOverlay({
  tasks,
}: StatusCountsOverlayProps) {
  const statuses = useContext(StatusConfigContext);
  const totalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateColor = () => {
      if (totalRef.current) {
        const accent = getComputedStyle(totalRef.current).backgroundColor;
        totalRef.current.style.setProperty(
          "--status-counts-total-color",
          getContrastColor(accent)
        );
      }
    };

    updateColor();

    // Re-compute when Obsidian changes theme/accent (style or class mutations on body)
    const observer = new MutationObserver(updateColor);
    observer.observe(activeDocument.body, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });

    return () => observer.disconnect();
  }, []);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const status of statuses) {
      map[status.id] = 0;
    }
    for (const task of tasks) {
      map[task.status] = (map[task.status] ?? 0) + 1;
    }
    return map;
  }, [tasks, statuses]);

  return (
    <div className="tasks-map-status-counts-overlay">
      {statuses.map((status) => (
        <div key={status.id} className="tasks-map-status-counts-item">
          <span
            className="tasks-map-status-counts-dot"
            ref={(el) => {
              if (el) {
                el.style.setProperty(
                  "--tasks-map-status-color",
                  status.color
                );
              }
            }}
          />
          <span className="tasks-map-status-counts-label">
            {status.label}
          </span>
          <span className="tasks-map-status-counts-value">
            {counts[status.id] ?? 0}
          </span>
        </div>
      ))}
      <div
        ref={totalRef}
        className="tasks-map-status-counts-item tasks-map-status-counts-total"
      >
        <span className="tasks-map-status-counts-label">
          {t("filters.status_total")}
        </span>
        <span className="tasks-map-status-counts-value">{tasks.length}</span>
      </div>
    </div>
  );
}
