import dagre from "@dagrejs/dagre";
import { Node } from "reactflow";
import {
  COMPACT_NODE_HEIGHT,
  createLayoutSnapshot,
  estimateNodeDimensions,
  getLayoutedElements,
  packLayoutSnapshot,
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

function uniqueCoordinateCount(nodes: Node[], axis: "x" | "y"): number {
  return new Set(nodes.map((node) => Math.round(node.position[axis]))).size;
}

function positionDelta(nodes: Node[], sourceId: string, targetId: string) {
  const source = nodes.find((node) => node.id === sourceId);
  const target = nodes.find((node) => node.id === targetId);
  if (!source || !target) throw new Error("Expected layout nodes");
  return {
    x: target.position.x - source.position.x,
    y: target.position.y - source.position.y,
  };
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

  it("packs horizontal layouts into more columns in a wide viewport", () => {
    const tasks = ["Alpha", "Beta", "Gamma", "Delta"].map((summary) =>
      makeTask({ id: summary.toLowerCase(), summary })
    );
    const nodes = createNodesFromTasks(tasks);
    const edges = createEdgesFromTasks(tasks);
    const wide = getLayoutedElements(
      nodes,
      edges,
      "Horizontal",
      true,
      false,
      tasks,
      undefined,
      "comfortable",
      { width: 2000, height: 250 }
    );
    const tall = getLayoutedElements(
      nodes,
      edges,
      "Horizontal",
      true,
      false,
      tasks,
      undefined,
      "comfortable",
      { width: 250, height: 2000 }
    );

    expect(uniqueCoordinateCount(wide, "x")).toBeGreaterThan(
      uniqueCoordinateCount(tall, "x")
    );
    expect(uniqueCoordinateCount(wide, "y")).toBeLessThan(
      uniqueCoordinateCount(tall, "y")
    );
  });

  it("packs vertical layouts into more columns in a wide viewport", () => {
    const tasks = ["Alpha", "Beta", "Gamma", "Delta"].map((summary) =>
      makeTask({ id: summary.toLowerCase(), summary })
    );
    const nodes = createNodesFromTasks(tasks, "Vertical");
    const edges = createEdgesFromTasks(tasks, "Vertical");
    const wide = getLayoutedElements(
      nodes,
      edges,
      "Vertical",
      true,
      false,
      tasks,
      undefined,
      "comfortable",
      { width: 2000, height: 250 }
    );
    const tall = getLayoutedElements(
      nodes,
      edges,
      "Vertical",
      true,
      false,
      tasks,
      undefined,
      "comfortable",
      { width: 250, height: 2000 }
    );

    expect(uniqueCoordinateCount(wide, "x")).toBeGreaterThan(
      uniqueCoordinateCount(tall, "x")
    );
    expect(uniqueCoordinateCount(wide, "y")).toBeLessThan(
      uniqueCoordinateCount(tall, "y")
    );
  });

  it("preserves intra-component geometry across viewport shapes", () => {
    const tasks = [
      makeTask({ id: "alpha", summary: "Alpha" }),
      makeTask({
        id: "alpha-child",
        summary: "Alpha child",
        incomingLinks: ["alpha"],
      }),
      makeTask({ id: "beta", summary: "Beta" }),
      makeTask({
        id: "beta-child",
        summary: "Beta child",
        incomingLinks: ["beta"],
      }),
    ];
    const snapshot = createLayoutSnapshot(
      createNodesFromTasks(tasks),
      createEdgesFromTasks(tasks),
      "Horizontal",
      true,
      false,
      tasks
    );
    const wide = packLayoutSnapshot(snapshot, { width: 1600, height: 400 });
    const tall = packLayoutSnapshot(snapshot, { width: 400, height: 1600 });

    expect(positionDelta(wide, "alpha", "alpha-child")).toEqual(
      positionDelta(tall, "alpha", "alpha-child")
    );
    expect(positionDelta(wide, "beta", "beta-child")).toEqual(
      positionDelta(tall, "beta", "beta-child")
    );
  });

  it("changes only project-group offsets when repacking grouped tasks", () => {
    const tasks = ["Alpha", "Beta", "Gamma", "Delta"].flatMap((project) => [
      makeTask({
        id: `${project}-root`,
        summary: `${project} root`,
        projects: [project],
      }),
      makeTask({
        id: `${project}-child`,
        summary: `${project} child`,
        incomingLinks: [`${project}-root`],
        projects: [project],
      }),
    ]);
    const snapshot = createLayoutSnapshot(
      createNodesFromTasks(tasks),
      createEdgesFromTasks(tasks),
      "Horizontal",
      true,
      true,
      tasks
    );
    const wide = packLayoutSnapshot(snapshot, { width: 2000, height: 250 });
    const tall = packLayoutSnapshot(snapshot, { width: 250, height: 2000 });

    for (const project of ["Alpha", "Beta", "Gamma", "Delta"]) {
      const wideChild = wide.find((node) => node.id === `${project}-child`);
      const tallChild = tall.find((node) => node.id === `${project}-child`);
      expect(wideChild?.position).toEqual(tallChild?.position);
      expect(wideChild?.parentNode).toBe(`project-group-${project}`);
    }
    const wideGroups = wide.filter((node) => node.type === "projectGroup");
    const tallGroups = tall.filter((node) => node.type === "projectGroup");
    expect(positionSnapshot(wideGroups)).not.toEqual(
      positionSnapshot(tallGroups)
    );
  });

  it("leaves a single connected component unchanged", () => {
    const tasks = [
      makeTask({ id: "root" }),
      makeTask({ id: "child", incomingLinks: ["root"] }),
    ];
    const snapshot = createLayoutSnapshot(
      createNodesFromTasks(tasks),
      createEdgesFromTasks(tasks),
      "Horizontal",
      true,
      false,
      tasks
    );

    expect(
      positionSnapshot(
        packLayoutSnapshot(snapshot, { width: 2000, height: 250 })
      )
    ).toEqual(
      positionSnapshot(
        packLayoutSnapshot(snapshot, { width: 250, height: 2000 })
      )
    );
  });

  it("uses legacy packing for missing or invalid viewport dimensions", () => {
    const tasks = ["Alpha", "Beta", "Gamma"].map((summary) =>
      makeTask({ id: summary.toLowerCase(), summary })
    );
    const snapshot = createLayoutSnapshot(
      createNodesFromTasks(tasks),
      createEdgesFromTasks(tasks),
      "Horizontal",
      true,
      false,
      tasks
    );
    const legacy = positionSnapshot(packLayoutSnapshot(snapshot));

    expect(
      positionSnapshot(packLayoutSnapshot(snapshot, { width: 0, height: 800 }))
    ).toEqual(legacy);
    expect(
      positionSnapshot(
        packLayoutSnapshot(snapshot, {
          width: Number.POSITIVE_INFINITY,
          height: 800,
        })
      )
    ).toEqual(legacy);
  });

  it("repacks a snapshot deterministically without invoking dagre", () => {
    const tasks = ["Alpha", "Beta", "Gamma"].map((summary) =>
      makeTask({ id: summary.toLowerCase(), summary })
    );
    const snapshot = createLayoutSnapshot(
      createNodesFromTasks(tasks),
      createEdgesFromTasks(tasks),
      "Horizontal",
      true,
      false,
      tasks
    );
    const dagreLayout = jest.spyOn(dagre, "layout");

    const first = packLayoutSnapshot(snapshot, {
      width: 1200,
      height: 500,
    });
    const second = packLayoutSnapshot(snapshot, {
      width: 1200,
      height: 500,
    });

    expect(positionSnapshot(first)).toEqual(positionSnapshot(second));
    expect(dagreLayout).not.toHaveBeenCalled();
    dagreLayout.mockRestore();
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
