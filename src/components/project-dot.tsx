import React, { useCallback } from "react";
import { setTooltip } from "obsidian";

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

interface ProjectDotProps {
  project: string;
  index: number;
}

export function ProjectDot({ project, index }: ProjectDotProps) {
  const color = PROJECT_DOT_COLORS[index % PROJECT_DOT_COLORS.length];
  const ref = useCallback(
    (el: HTMLSpanElement | null) => {
      if (!el) return;
      el.style.setProperty("--dot-color", color);
      setTooltip(el, project);
    },
    [project, color]
  );

  return <span ref={ref} className="tasks-map-project-dot" />;
}
