import { Edge, Node } from "reactflow";
import {
  createTreeLayoutElements,
  TREE_GUTTER_NODE_ID,
  treeSortKey,
} from "../src/lib/layout";
import { DEFAULT_TASK_STATUSES } from "../src/lib/status-config";
import { NoteTask } from "../src/types/note-task";

function makeTask(
  overrides: Partial<ConstructorParameters<typeof NoteTask>[0]> = {}
): NoteTask {
  return new NoteTask({
    id: "task",
    summary: "Task",
    text: "Task",
    tags: [],
    status: "todo",
    priority: "",
    link: "tasks/task.md",
    incomingLinks: [],
    starred: false,
    projects: [],
    ...overrides,
  });
}

function taskNode(id: string): Node {
  return { id, type: "task", position: { x: 0, y: 0 }, data: {} };
}

function build(tasks: NoteTask[], edges: Edge[]) {
  return createTreeLayoutElements({
    nodes: tasks.map((task) => taskNode(task.id)),
    edges,
    tasks,
    direction: "Vertical",
    statuses: DEFAULT_TASK_STATUSES,
    showTags: true,
    visibleAttachmentKinds: [],
    nodeDensity: "compact",
  });
}

describe("tree layout elements", () => {
  const project = makeTask({ id: "p", summary: "Project" });
  const done = DEFAULT_TASK_STATUSES.find((status) => status.id === "done")!;
  const child = makeTask({
    id: "c",
    summary: "Child",
    status: "done",
    incomingLinks: ["p"],
  });
  const edges: Edge[] = [{ id: "p-c", source: "p", target: "c" }];

  it("adds one background gutter node that cannot be selected or dragged", () => {
    const { nodes } = build([project, child], edges);
    const gutter = nodes.find((node) => node.id === TREE_GUTTER_NODE_ID)!;
    expect(gutter).toMatchObject({
      selectable: false,
      draggable: false,
      connectable: false,
      zIndex: -1,
    });
    expect(
      nodes.filter((node) => node.id === TREE_GUTTER_NODE_ID)
    ).toHaveLength(1);
  });

  it("colors each dot with its task's status color", () => {
    const { nodes } = build([project, child], edges);
    const gutter = nodes.find((node) => node.id === TREE_GUTTER_NODE_ID)!;
    const dot = gutter.data.dots.find((d: { id: string }) => d.id === "c");
    expect(dot.color).toBe(done.color);
  });

  it("puts the project above its task and hides graph edges", () => {
    const result = build([child, project], edges);
    const positions = Object.fromEntries(
      result.nodes.map((node) => [node.id, node.position])
    );
    expect(positions.p.y).toBeLessThan(positions.c.y);
    expect(result.edges.every((edge) => edge.hidden)).toBe(true);
  });

  it("returns no gutter for an empty map", () => {
    expect(build([], []).nodes).toEqual([]);
  });

  it("sorts by note filename first so dated notes read chronologically", () => {
    const early = makeTask({ id: "a", summary: "Zeta" });
    early.noteFilename = "2026-01-01-TASK Zeta";
    const late = makeTask({ id: "b", summary: "Alpha" });
    late.noteFilename = "2026-02-01-TASK Alpha";
    expect(treeSortKey(early) < treeSortKey(late)).toBe(true);
  });
});
