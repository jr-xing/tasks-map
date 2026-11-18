import { buildBranchModel } from "../src/lib/branch-model";
import { createBranchViewElements } from "../src/lib/layout/branch-elements";
import {
  estimateTaskNodeDimensions,
  getMinimalNodeDimensions,
  MINIMAL_CARD_WIDTH,
  MINIMAL_ROW_HEIGHT,
  MINIMAL_ROW_WIDTH,
} from "../src/lib/layout/dimensions";
import { DEFAULT_TASK_STATUSES } from "../src/lib/status-config";
import { createEdgesFromTasks, createNodesFromTasks } from "../src/lib/utils";
import { NoteTask } from "../src/types/note-task";
import { TaskNodeData } from "../src/types/task";

function makeTask(
  id: string,
  parents: string[] = [],
  overrides: Partial<NoteTask> = {}
): NoteTask {
  const task = new NoteTask({
    id,
    summary: `2026-01-01 ${id}`,
    text: id,
    tags: [],
    status: "todo",
    priority: "normal",
    link: `${id}.md`,
    incomingLinks: parents,
    starred: false,
    noteFrontmatterTitle: id,
  });
  return Object.assign(task, overrides);
}

function buildNodes(tasks: NoteTask[]) {
  const model = buildBranchModel(tasks, DEFAULT_TASK_STATUSES);
  const nodes = createNodesFromTasks(
    tasks,
    "Horizontal",
    true,
    true,
    false,
    undefined,
    false,
    "rainbow",
    undefined,
    undefined,
    undefined,
    [],
    "top",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    "comfortable",
    undefined,
    model
  );
  const edges = createEdgesFromTasks(tasks);
  return createBranchViewElements(nodes, edges, "Horizontal").nodes;
}

describe("createBranchViewElements", () => {
  const tasks = [
    makeTask("P", [], { isProject: true }),
    makeTask("B", ["P"], { isBranch: true, nextStep: "B1" }),
    makeTask("B1", ["B"]),
    makeTask("B2", ["B"]),
  ];
  const nodes = buildNodes(tasks);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const data = (id: string) => byId.get(id)!.data as TaskNodeData;

  it("draws every node as a minimal card", () => {
    expect(nodes.every((node) => node.data.nodeDensity === "minimal")).toBe(
      true
    );
  });

  it("marks the next step a branch names", () => {
    expect(data("B1").isNextStep).toBe(true);
    expect(data("B2").isNextStep).toBe(false);
  });

  it("places children to the right of their branch", () => {
    expect(byId.get("B1")!.position.x).toBeGreaterThan(
      byId.get("B")!.position.x
    );
  });

  it("stacks sibling rows without overlap", () => {
    const [top, bottom] = [byId.get("B1")!, byId.get("B2")!].sort(
      (left, right) => left.position.y - right.position.y
    );
    expect(bottom.position.y - top.position.y).toBeGreaterThanOrEqual(
      MINIMAL_ROW_HEIGHT
    );
  });
});

describe("getMinimalNodeDimensions", () => {
  const task = makeTask("Short");

  it("draws tasks as rows", () => {
    expect(getMinimalNodeDimensions({ task })).toEqual({
      width: MINIMAL_ROW_WIDTH,
      height: MINIMAL_ROW_HEIGHT,
    });
  });

  it("gives long task titles a second line", () => {
    const long = makeTask("A task title long enough to need two lines");
    expect(getMinimalNodeDimensions({ task: long }).height).toBeGreaterThan(
      MINIMAL_ROW_HEIGHT
    );
  });

  it("sizes by the note title, not the date prefix", () => {
    const titled = makeTask("Short", [], {
      summary: "2026-01-01 a summary that is far too long for one row",
    });
    expect(getMinimalNodeDimensions({ task: titled }).height).toBe(
      MINIMAL_ROW_HEIGHT
    );
  });

  it("gives a branch with open work room for its next step", () => {
    const summary = {
      active: 0,
      open: 2,
      waiting: 0,
      closed: 0,
      subBranches: 0,
      next: null,
      suggested: null,
      waitingOn: [],
      related: [],
    };
    const withWork = getMinimalNodeDimensions({
      task,
      level: "branch",
      branchSummary: summary,
    });
    const finished = getMinimalNodeDimensions({
      task,
      level: "branch",
      branchSummary: { ...summary, open: 0, closed: 2 },
    });
    expect(withWork.width).toBe(MINIMAL_CARD_WIDTH);
    expect(withWork.height).toBeGreaterThan(finished.height);
  });

  it("is what the layout uses for the minimal density", () => {
    expect(estimateTaskNodeDimensions({ task }, true, [], "minimal")).toEqual(
      getMinimalNodeDimensions({ task })
    );
  });
});
