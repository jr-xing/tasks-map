import { kanbanPreferencePatchToSettings } from "../src/lib/kanban-preferences";

describe("Kanban preference persistence", () => {
  it("maps every display preference to its plugin setting", () => {
    expect(
      kanbanPreferencePatchToSettings({
        cardTitleSource: "filename",
        showProjectTasks: true,
        showCardStatus: true,
        groupByProject: false,
        openNoteOnDoubleClick: false,
        columnOrder: ["done", "todo"],
      })
    ).toEqual({
      kanbanCardTitleSource: "filename",
      kanbanShowProjectTasks: true,
      kanbanShowCardStatus: true,
      kanbanGroupByProject: false,
      kanbanOpenNoteOnDoubleClick: false,
      kanbanColumnOrder: ["done", "todo"],
    });
  });

  it("does not overwrite settings omitted from a partial patch", () => {
    expect(
      kanbanPreferencePatchToSettings({ openNoteOnDoubleClick: true })
    ).toEqual({ kanbanOpenNoteOnDoubleClick: true });
  });
});
