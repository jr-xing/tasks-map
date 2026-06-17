import React, { useCallback } from "react";
import { App, TFile } from "obsidian";
import { ArrowUpRight } from "lucide-react";
import { TaskStatus } from "src/types/task";
import { t } from "../i18n";
import { openFileInObsidian } from "../lib/open-file";

interface LinkButtonProps {
  taskStatus?: TaskStatus;
  link: string;
  app: App;
}

export const LinkButton = ({
  link,
  app,
  taskStatus = "todo",
}: LinkButtonProps) => {
  const status =
    taskStatus === "done"
      ? "success"
      : taskStatus === "canceled"
        ? "error"
        : "normal";

  const openNote = useCallback(
    async (openInNewTab: boolean) => {
      const abstractFile = app.vault.getAbstractFileByPath(link);

      if (!(abstractFile instanceof TFile)) {
        throw new Error(`File not found: ${link}`);
      }

      await openFileInObsidian(app, link, link, link, {
        openInNewTab,
      });
    },
    [app, link]
  );

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      await openNote(e.ctrlKey || e.metaKey);
    },
    [openNote]
  );

  const handleAuxClick = useCallback(
    async (e: React.MouseEvent) => {
      if (e.button !== 1) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      await openNote(true);
    },
    [openNote]
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 1) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <button
      className={`tasks-map-link-button tasks-map-link-button--${status}`}
      onClick={(e) => void handleClick(e)}
      onAuxClick={(e) => void handleAuxClick(e)}
      onMouseDown={handleMouseDown}
      title={t("task_node.open_note")}
      aria-label={t("task_node.open_note")}
    >
      <ArrowUpRight size={16} />
    </button>
  );
};
