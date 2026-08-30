import { Node } from "reactflow";
import {
  COMPACT_NODE_HEIGHT,
  estimateNodeDimensions,
  getLayoutedElements,
} from "../src/lib/layout";
import {
  createEdgesFromTasks,
  createNodesFromTasks,
  getLayoutedElements as getLayoutedElementsFromUtils,
} from "../src/lib/utils";
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

function positionSnapshot(nodes: Node[]) {
  return Object.fromEntries(
    [...nodes]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((node) => [node.id, node.position])
  );
}

function visualOrder(nodes: Node[]): string[] {
  return [...nodes]
    .sort(
      (left, right) =>
        left.position.y - right.position.y || left.position.x - right.position.x
    )
    .map((node) => node.id);
}

describe("layout module", () => {
  it("keeps the established utils re-export", () => {
    expect(getLayoutedElementsFromUtils).toBe(getLayoutedElements);
  });

  it("sorts disconnected project groups alphabetically", () => {
    const tasks = [
      makeTask({ id: "z", summary: "Z task", projects: ["Zeta"] }),
      makeTask({ id: "a", summary: "A task", projects: ["Alpha"] }),
      makeTask({ id: "m", summary: "M task", projects: ["Mu"] }),
    ];
    const result = getLayoutedElements(
      createNodesFromTasks(tasks),
      createEdgesFromTasks(tasks),
      "Horizontal",
      true,
      true,
      tasks
    );
    const groups = result.filter((node) => node.type === "projectGroup");

    expect(visualOrder(groups)).toEqual([
      "project-group-Alpha",
      "project-group-Mu",
      "project-group-Zeta",
    ]);
  });

  it("sorts other disconnected components by root-task label", () => {
    const tasks = [
      makeTask({ id: "z-root", summary: "Zulu", link: "z.md" }),
      makeTask({
        id: "z-child",
        summary: "Zulu child",
        link: "z-child.md",
        incomingLinks: ["z-root"],
      }),
      makeTask({ id: "a-root", summary: "Alpha", link: "a.md" }),
      makeTask({
        id: "a-child",
        summary: "Alpha child",
        link: "a-child.md",
        incomingLinks: ["a-root"],
      }),
    ];
    const result = getLayoutedElements(
      createNodesFromTasks(tasks),
      createEdgesFromTasks(tasks),
      "Horizontal",
      true,
      false,
      tasks
    );
    const roots = result.filter((node) => node.id.endsWith("root"));

    expect(visualOrder(roots)).toEqual(["a-root", "z-root"]);
  });

  it("produces identical positions when task input order changes", () => {
    const alphaRoot = makeTask({
      id: "alpha-root",
      summary: "Alpha root",
      projects: ["Alpha"],
    });
    const alphaChild = makeTask({
      id: "alpha-child",
      summary: "Alpha child",
      incomingLinks: ["alpha-root"],
      projects: ["Alpha"],
    });
    const beta = makeTask({
      id: "beta",
      summary: "Beta",
      projects: ["Beta"],
    });
    const firstOrder = [beta, alphaChild, alphaRoot];
    const secondOrder = [alphaRoot, beta, alphaChild];

    const first = getLayoutedElements(
      createNodesFromTasks(firstOrder),
      createEdgesFromTasks(firstOrder),
      "Horizontal",
      true,
      true,
      firstOrder
    );
    const second = getLayoutedElements(
      createNodesFromTasks(secondOrder),
      createEdgesFromTasks(secondOrder),
      "Horizontal",
      true,
      true,
      secondOrder
    );

    expect(positionSnapshot(first)).toEqual(positionSnapshot(second));
  });

  it("uses fixed collapsed bounds for compact nodes", () => {
    const task = makeTask({
      summary: "A long summary that would wrap in comfortable mode",
      tags: ["one", "two", "three", "four"],
      quickComments: "A populated quick update",
      attachments: [
        {
          path: "report.pdf",
          linktext: "report.pdf",
          label: "Report",
          kind: "pdf",
        },
      ],
    });

    expect(estimateNodeDimensions(task, true, undefined, "compact")).toEqual({
      width: 250,
      height: COMPACT_NODE_HEIGHT,
    });
    expect(
      estimateNodeDimensions(task, true, undefined, "comfortable").height
    ).toBeGreaterThan(COMPACT_NODE_HEIGHT);
  });

  it("does not overlap compact task bounds", () => {
    const tasks = [
      makeTask({ id: "root", summary: "Root" }),
      makeTask({ id: "left", summary: "Left", incomingLinks: ["root"] }),
      makeTask({ id: "right", summary: "Right", incomingLinks: ["root"] }),
      makeTask({
        id: "leaf",
        summary: "Leaf",
        incomingLinks: ["left", "right"],
      }),
    ];
    const nodes = getLayoutedElements(
      createNodesFromTasks(tasks),
      createEdgesFromTasks(tasks),
      "Horizontal",
      true,
      false,
      tasks,
      undefined,
      "compact"
    );

    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < nodes.length;
        rightIndex += 1
      ) {
        const left = nodes[leftIndex];
        const right = nodes[rightIndex];
        const separated =
          left.position.x + 250 <= right.position.x ||
          right.position.x + 250 <= left.position.x ||
          left.position.y + COMPACT_NODE_HEIGHT <= right.position.y ||
          right.position.y + COMPACT_NODE_HEIGHT <= left.position.y;
        expect(separated).toBe(true);
      }
    }
  });

  it("leaves task and project-group dragging to the view policy", () => {
    const tasks = [makeTask({ projects: ["Alpha"] })];
    const nodes = getLayoutedElements(
      createNodesFromTasks(tasks),
      createEdgesFromTasks(tasks),
      "Horizontal",
      true,
      true,
      tasks
    );

    expect(nodes).not.toHaveLength(0);
    expect(nodes.every((node) => node.draggable === undefined)).toBe(true);
  });
});
