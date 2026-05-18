export interface EmbedConfig {
  height: number;
  showMinimap: boolean;
  showFilterPanel: boolean;
  showPresetsPanel: boolean;
  showUnlinkedPanel: boolean;
  hideUnlinkedTasks: boolean;
  showStatusCounts: boolean;
  showProjectBar: boolean;
}

export const DEFAULT_EMBED_CONFIG: EmbedConfig = {
  height: 400,
  showMinimap: true,
  showFilterPanel: true,
  showPresetsPanel: true,
  showUnlinkedPanel: true,
  hideUnlinkedTasks: true,
  showStatusCounts: true,
  showProjectBar: true,
};
