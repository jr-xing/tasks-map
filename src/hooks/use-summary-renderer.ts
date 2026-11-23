import { RefCallback, useCallback } from "react";
import { App } from "obsidian";
import { openFileInObsidian } from "../lib/open-file";

/**
 * Returns a callback ref that renders the summary into whichever element it
 * is attached to. A callback ref (rather than an effect keyed on the summary)
 * also covers the element being remounted with an unchanged summary, e.g. when
 * a card switches between the row and summary-card layouts.
 */
export function useSummaryRenderer<T extends HTMLElement = HTMLSpanElement>(
  summary: string,
  app?: App
): RefCallback<T> {
  return useCallback(
    (element: T | null) => {
      if (!element) return;

      element.empty();
      renderSummaryWithLinks(summary, element, app);
    },
    [summary, app]
  );
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
