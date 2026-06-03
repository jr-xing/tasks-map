import { useEffect, useRef } from "react";
import { App } from "obsidian";
import { openFileInObsidian } from "../lib/open-file";

export function useSummaryRenderer(summary: string, app?: App) {
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    containerRef.current.empty();
    renderSummaryWithLinks(summary, containerRef.current, app);
  }, [summary, app]);

  return containerRef;
}

function renderSummaryWithLinks(
  summary: string,
  container: HTMLElement,
  app?: App
) {
  // Split by links and inline code blocks
  const parts = summary.split(/(\[[^\]]+\]\([^)]+\)|\[\[[^\]]+\]\]|`[^`]+`)/g);

  parts.forEach((part) => {
    const mdLinkMatch = part.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (mdLinkMatch) {
      const [, text, url] = mdLinkMatch;
      container.createEl("a", {
        text: text,
        href: url,
        cls: "tasks-map-link",
        attr: {
          target: "_blank",
          rel: "noopener noreferrer",
        },
      });
      return;
    }

    // Check if it's an obsidian link [[file]] or [[file|alias]]
    const obsidianLinkMatch = part.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    if (obsidianLinkMatch) {
      const [, file, alias] = obsidianLinkMatch;
      const displayText = alias || file;
      const link = container.createEl("a", {
        text: displayText,
        cls: "tasks-map-link tasks-map-link--internal",
      });

      link.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (app) {
          void openFileInObsidian(app, file, file);
        }
      });
      return;
    }

    // Check if it's inline code `text`
    const inlineCodeMatch = part.match(/^`([^`]+)`$/);
    if (inlineCodeMatch) {
      const [, code] = inlineCodeMatch;
      container.createEl("code", {
        text: code,
        cls: "tasks-map-inline-code",
      });
      return;
    }

    // Regular text
    if (part.trim()) {
      container.createSpan({ text: part });
    }
  });
}
