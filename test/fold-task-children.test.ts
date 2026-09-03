import {
  getFoldedGraphVisibility,
  getTaskConnectionKey,
} from "../src/lib/fold-task-children";
import { NoteTask } from "../src/types/note-task";

function makeTask(id: string, incomingLinks: string[] = []): NoteTask {
  return new NoteTask({
    id,
    summary: id,
    text: id,
    tags: [],
    status: "todo",
    priority: "normal",
    link: `${id}.md`,
    incomingLinks,
    starred: false,
  });
}

function visibility(
  tasks: NoteTask[],
  collapsedTaskIds: string[],
  filteredNodeIds: string[] = tasks.map((task) => task.id)
) {
  return getFoldedGraphVisibility(
    tasks,
    filteredNodeIds,
    new Set(collapsedTaskIds)
  );
}

describe("getFoldedGraphVisibility", () => {
  it("folds the complete descendant branch and keeps unrelated roots", () => {
    const tasks = [
      makeTask("P"),
      makeTask("A", ["P"]),
      makeTask("A1", ["A"]),
      makeTask("B", ["P"]),
      makeTask("Other"),
    ];

    const result = visibility(tasks, ["A"]);

    expect(result.visibleNodeIds).toEqual(new Set(["P", "A", "B", "Other"]));
    expect(result.foldedNodeIds).toEqual(new Set(["A1"]));
    expect(result.foldedDescendantCounts).toEqual(new Map([["A", 1]]));
    expect(result.visibleConnectionKeys).toEqual(
      new Set([getTaskConnectionKey("P", "A"), getTaskConnectionKey("P", "B")])
    );
  });

  it("retains nested fold state when an ancestor is expanded", () => {
    const tasks = [makeTask("P"), makeTask("A", ["P"]), makeTask("A1", ["A"])];

    const ancestorAndChildFolded = visibility(tasks, ["P", "A"]);
    expect(ancestorAndChildFolded.visibleNodeIds).toEqual(new Set(["P"]));
    expect(ancestorAndChildFolded.foldedDescendantCounts).toEqual(
      new Map([
        ["P", 2],
        ["A", 1],
      ])
    );

    const childFoldRetained = visibility(tasks, ["A"]);
    expect(childFoldRetained.visibleNodeIds).toEqual(new Set(["P", "A"]));
    expect(childFoldRetained.foldedDescendantCounts).toEqual(
      new Map([["A", 1]])
    );
    expect(visibility(tasks, []).visibleNodeIds).toEqual(
      new Set(["P", "A", "A1"])
    );
  });

  it("keeps a shared branch through another expanded parent", () => {
    const tasks = [
      makeTask("A"),
      makeTask("B"),
      makeTask("Shared", ["A", "B"]),
      makeTask("Leaf", ["Shared"]),
    ];

    const oneParentFolded = visibility(tasks, ["A"]);
    expect(oneParentFolded.visibleNodeIds).toEqual(
      new Set(["A", "B", "Shared", "Leaf"])
    );
    expect(oneParentFolded.visibleConnectionKeys).not.toContain(
      getTaskConnectionKey("A", "Shared")
    );
    expect(oneParentFolded.visibleConnectionKeys).toContain(
      getTaskConnectionKey("B", "Shared")
    );
    expect(oneParentFolded.foldedDescendantCounts).toEqual(new Map([["A", 0]]));

    const bothParentsFolded = visibility(tasks, ["A", "B"]);
    expect(bothParentsFolded.visibleNodeIds).toEqual(new Set(["A", "B"]));
    expect(bothParentsFolded.foldedNodeIds).toEqual(
      new Set(["Shared", "Leaf"])
    );
    expect(bothParentsFolded.foldedDescendantCounts).toEqual(
      new Map([
        ["A", 2],
        ["B", 2],
      ])
    );
  });

  it("applies folds only to relationships in the current filtered graph", () => {
    const tasks = [makeTask("P"), makeTask("A", ["P"]), makeTask("A1", ["A"])];

    expect(visibility(tasks, ["P"], ["A", "A1"]).visibleNodeIds).toEqual(
      new Set(["A", "A1"])
    );
    expect(visibility(tasks, ["P"]).visibleNodeIds).toEqual(new Set(["P"]));
  });

  it("ignores stale collapsed IDs and reports only visible parents as foldable", () => {
    const tasks = [makeTask("P"), makeTask("A", ["P"]), makeTask("Other")];
    const result = visibility(tasks, ["Missing"]);

    expect(result.visibleNodeIds).toEqual(new Set(["P", "A", "Other"]));
    expect(result.foldedNodeIds).toEqual(new Set());
    expect(result.taskIdsWithVisibleChildren).toEqual(new Set(["P"]));
  });

  it("keeps source cycles stable and terminates when an edge is folded", () => {
    const tasks = [
      makeTask("A", ["B"]),
      makeTask("B", ["A"]),
      makeTask("Leaf", ["B"]),
    ];
    const result = visibility(tasks, ["A"]);

    expect(result.visibleNodeIds).toEqual(new Set(["A", "B", "Leaf"]));
    expect(result.visibleConnectionKeys).not.toContain(
      getTaskConnectionKey("A", "B")
    );
    expect(result.visibleConnectionKeys).toContain(
      getTaskConnectionKey("B", "A")
    );
  });

  it("hides a downstream cycle when its only entry branch is folded", () => {
    const tasks = [
      makeTask("Root"),
      makeTask("A", ["Root", "B"]),
      makeTask("B", ["A"]),
    ];

    const result = visibility(tasks, ["Root"]);

    expect(result.visibleNodeIds).toEqual(new Set(["Root"]));
    expect(result.foldedNodeIds).toEqual(new Set(["A", "B"]));
    expect(result.foldedDescendantCounts).toEqual(new Map([["Root", 2]]));
  });
});
