import type { NoteTaskTitleSource, TasksMapSettings } from "src/types/settings";

export interface KanbanDisplayPreferences {
  cardTitleSource: NoteTaskTitleSource;
  showProjectTasks: boolean;
  showCardStatus: boolean;
  groupByProject: boolean;
  openNoteOnDoubleClick: boolean;
  columnOrder: string[];
}

export function kanbanPreferencePatchToSettings(
  patch: Partial<KanbanDisplayPreferences>
): Partial<TasksMapSettings> {
  const settingsPatch: Partial<TasksMapSettings> = {};
  if (patch.cardTitleSource !== undefined) {
    settingsPatch.kanbanCardTitleSource = patch.cardTitleSource;
  }
  if (patch.showProjectTasks !== undefined) {
    settingsPatch.kanbanShowProjectTasks = patch.showProjectTasks;
  }
  if (patch.showCardStatus !== undefined) {
    settingsPatch.kanbanShowCardStatus = patch.showCardStatus;
  }
  if (patch.groupByProject !== undefined) {
    settingsPatch.kanbanGroupByProject = patch.groupByProject;
  }
  if (patch.openNoteOnDoubleClick !== undefined) {
    settingsPatch.kanbanOpenNoteOnDoubleClick = patch.openNoteOnDoubleClick;
  }
  if (patch.columnOrder !== undefined) {
    settingsPatch.kanbanColumnOrder = patch.columnOrder;
  }
  return settingsPatch;
}
