import React from "react";
import { App, TFile } from "obsidian";
import { ArrowUpRight } from "lucide-react";
import { TaskStatus } from "src/types/task";
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
  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const abstractFile = app.vault.getAbstractFileByPath(link);

    if (!(abstractFile instanceof TFile)) {
      throw new Error(`File not found: ${link}`);
    }

    await openFileInObsidian(app, link, link, link);
  };

  return (
    <button
      className={`tasks-map-link-button tasks-map-link-button--${status}`}
      onClick={(e) => void handleClick(e)}
    >
      <ArrowUpRight size={16} />
    </button>
  );
};
