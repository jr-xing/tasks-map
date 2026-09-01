import React from "react";
import {
  Filter,
  Bookmark,
  SlidersHorizontal,
  Inbox,
  Kanban,
  ListTree,
  RefreshCw,
} from "lucide-react";
import { t } from "../i18n";

export type RailPanelId =
  | "filters"
  | "kanban"
  | "presets"
  | "view"
  | "unlinked"
  | "tree";

interface LeftRailProps {
  /** The panel currently open in the flyout, or `null` when all are closed. */
  openPanel: RailPanelId | null;
  // eslint-disable-next-line no-unused-vars -- prop callback parameter convention
  onToggle: (panel: RailPanelId) => void;
  /** Re-reads all task notes from the vault, keeping the active project view. */
  onRefresh: () => void;
  showFilters: boolean;
  showKanban: boolean;
  showPresets: boolean;
  showUnlinked: boolean;
  showTree: boolean;
  /** Count shown as a badge on the unlinked-tasks icon. */
  unlinkedCount: number;
}

interface RailItem {
  id: RailPanelId;
  icon: React.ReactNode;
  label: string;
  visible: boolean;
  badge?: number;
}

/**
 * A vertical strip of icon buttons in the top-left corner. Each button toggles
 * its panel open as a flyout; clicking the active button closes it. Collapsed
 * to just icons by default, this keeps the canvas clear.
 */
export default function LeftRail({
  openPanel,
  onToggle,
  onRefresh,
  showFilters,
  showKanban,
  showPresets,
  showUnlinked,
  showTree,
  unlinkedCount,
}: LeftRailProps) {
  const items: RailItem[] = [
    {
      id: "filters",
      icon: <Filter size={16} />,
      label: t("filters.title"),
      visible: showFilters,
    },
    {
      id: "kanban",
      icon: <Kanban size={16} />,
      label: t("kanban.title"),
      visible: showKanban,
    },
    {
      id: "presets",
      icon: <Bookmark size={16} />,
      label: t("presets.panel_title"),
      visible: showPresets,
    },
    {
      id: "view",
      icon: <SlidersHorizontal size={16} />,
      label: t("controls.title"),
      visible: true,
    },
    {
      id: "unlinked",
      icon: <Inbox size={16} />,
      label: t("unlinked_panel.title"),
      visible: showUnlinked,
      badge: unlinkedCount,
    },
    {
      id: "tree",
      icon: <ListTree size={16} />,
      label: t("project_tree.title"),
      visible: showTree,
    },
  ];

  const shown = items.filter((item) => item.visible);

  return (
    <div
      className="tasks-map-left-rail"
      role="toolbar"
      aria-label={t("rail.label")}
    >
      <button
        className="tasks-map-left-rail__btn"
        onClick={onRefresh}
        aria-label={t("rail.refresh")}
        title={t("rail.refresh")}
      >
        <RefreshCw size={16} />
      </button>
      {shown.length > 0 && <div className="tasks-map-left-rail__divider" />}
      {shown.map((item) => {
        const active = openPanel === item.id;
        return (
          <button
            key={item.id}
            className={`tasks-map-left-rail__btn${
              active ? " tasks-map-left-rail__btn--active" : ""
            }`}
            onClick={() => onToggle(item.id)}
            aria-label={item.label}
            aria-pressed={active}
            title={item.label}
          >
            {item.icon}
            {item.badge !== undefined && item.badge > 0 && (
              <span className="tasks-map-left-rail__badge">{item.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
