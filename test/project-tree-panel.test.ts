import {
  buildProjectTree,
  filterProjectTree,
  getProjectTreeDepth,
  getTreePathRootId,
} from "../src/components/project-tree-panel";
import { NoteTask } from "../src/types/note-task";

function makeTask(overrides: {
  id: string;
  summary?: string;
  tags?: string[];
  incomingLinks?: string[];
  isProject?: boolean;
}): NoteTask {
  return new NoteTask({
    id: overrides.id,
    summary: overrides.summary ?? overrides.id,
    text: "",
    tags: overrides.tags ?? [],
    status: "todo",
    priority: "",
    link: `tasks/${overrides.id}.md`,
    incomingLinks: overrides.incomingLinks ?? [],
    starred: false,
    isProject: overrides.isProject ?? false,
  });
}

describe("project tree helpers", () => {
  it("builds the full task tree from the provided tasks", () => {
    const tree = buildProjectTree([
      makeTask({ id: "P", summary: "Project" }),
      makeTask({ id: "A", summary: "Alpha", incomingLinks: ["P"] }),
      makeTask({ id: "B", summary: "Beta", incomingLinks: ["P"] }),
      makeTask({ id: "Hidden", summary: "Hidden" }),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].task.id).toBe("P");
    expect(tree[0].children.map((node) => node.task.id)).toEqual(["A", "B"]);
  });

  it("keeps a project note with no tasks attached to it", () => {
    const tree = buildProjectTree([
      makeTask({ id: "Empty", summary: "Empty project", isProject: true }),
      makeTask({ id: "Loose", summary: "Loose task" }),
    ]);

    expect(tree.map((node) => node.task.id)).toEqual(["Empty"]);
    expect(tree[0].children).toEqual([]);
  });

  it("filters only the tree display while preserving matching branches", () => {
    const tree = buildProjectTree([
      makeTask({ id: "P", summary: "Project" }),
      makeTask({ id: "A", summary: "Alpha", incomingLinks: ["P"] }),
      makeTask({ id: "B", summary: "Beta", incomingLinks: ["P"] }),
    ]);

    const filtered = filterProjectTree(tree, "Alpha");

    expect(filtered).toHaveLength(1);
    expect(filtered[0].task.id).toBe("P");
    expect(filtered[0].children.map((node) => node.task.id)).toEqual(["A"]);
  });

  it("resolves the focused root from the clicked tree path", () => {
    expect(getTreePathRootId(["Project", "Task", "Leaf"])).toBe("Project");
  });

  it("reports the maximum visible level depth", () => {
    const tree = buildProjectTree([
      makeTask({ id: "P", summary: "Project" }),
      makeTask({ id: "A", summary: "Alpha", incomingLinks: ["P"] }),
      makeTask({ id: "A1", summary: "Alpha One", incomingLinks: ["A"] }),
    ]);

    expect(getProjectTreeDepth(tree)).toBe(3);
  });

  it("uses the clicked DAG branch when resolving the focused root", () => {
    const tree = buildProjectTree([
      makeTask({ id: "A", summary: "Alpha" }),
      makeTask({ id: "B", summary: "Beta" }),
      makeTask({ id: "C", summary: "Shared", incomingLinks: ["A", "B"] }),
    ]);

    expect(tree.map((node) => node.task.id)).toEqual(["A", "B"]);
    expect(tree[0].children[0].task.id).toBe("C");
    expect(tree[1].children[0].task.id).toBe("C");
    expect(getTreePathRootId(["B", "C"])).toBe("B");
  });
});
