import { buildBranchModel } from "../src/lib/branch-model";
import { createBranchViewElements } from "../src/lib/layout/branch-elements";
import {
  CLUSTER_GAP,
  CLUSTER_HEADER_HEIGHT,
  CLUSTER_NODE_TYPE,
  CLUSTER_PAD_X,
  getClusterId,
  splitIntoTwoColumns,
  TaskClusterNodeData,
} from "../src/lib/layout/branch-clusters";
import { MINIMAL_ROW_WIDTH } from "../src/lib/layout/dimensions";
import { DEFAULT_TASK_STATUSES } from "../src/lib/status-config";
import { createEdgesFromTasks, createNodesFromTasks } from "../src/lib/utils";
import { NoteTask } from "../src/types/note-task";

function makeTask(
  id: string,
  parents: string[] = [],
  overrides: Partial<NoteTask> = {}
): NoteTask {
  const task = new NoteTask({
    id,
    summary: id,
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

function layout(tasks: NoteTask[], expanded: string[] = []) {
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
    "minimal",
    undefined,
    model
  );
  return createBranchViewElements(
    nodes,
    createEdgesFromTasks(tasks),
    "Horizontal",
    undefined,
    {
      statuses: DEFAULT_TASK_STATUSES,
      expandedClusterIds: new Set(expanded),
    }
  );
}

const code = { groupValues: ["code"] };
const data = { groupValues: ["data"] };

// Branch B with six rows: three in "code", two in "data", one without.
const tasks = [
  makeTask("P", [], { isProject: true }),
  makeTask("B", ["P"], { isBranch: true, nextStep: "C-next" }),
  makeTask("C-next", ["B"], code),
  makeTask("C-active", ["B"], { ...code, status: "in_progress" }),
  makeTask("C-backlog", ["B"], code),
  makeTask("D-waiting", ["B"], { ...data, waitingOn: "Omar" }),
  makeTask("D-done", ["B"], { ...data, status: "done" }),
  makeTask("Loose", ["B"]),
];

describe("branch clusters", () => {
  const view = layout(tasks);
  const byId = new Map(view.nodes.map((node) => [node.id, node]));
  const clusters = view.nodes.filter((node) => node.type === CLUSTER_NODE_TYPE);
  const cluster = (label: string) =>
    byId.get(getClusterId("B", label))!.data as TaskClusterNodeData;

  it("groups rows by their first group value, unlabelled last", () => {
    expect(clusters.map((node) => node.data.label)).toEqual([
      "code",
      "data",
      "",
    ]);
  });

  it("puts three or more clusters in two columns", () => {
    const code = byId.get(getClusterId("B", "code"))!;
    const data = byId.get(getClusterId("B", "data"))!;
    const other = byId.get(getClusterId("B", ""))!;
    expect(data.position.x).toBe(
      code.position.x + cluster("code").width + CLUSTER_GAP
    );
    expect(data.position.y).toBe(code.position.y);
    expect(other.position.x).toBe(data.position.x);
    expect(other.position.y).toBeGreaterThan(data.position.y);
  });

  it("draws edges to the first column only, never to rows", () => {
    const visible = view.edges.filter((edge) => !edge.hidden);
    expect(
      visible.filter((edge) => edge.source === "B").map((edge) => edge.target)
    ).toEqual([getClusterId("B", "code")]);
    expect(visible.some((edge) => edge.target === "C-next")).toBe(false);
  });

  it("keeps only key rows while folded", () => {
    expect(byId.has("C-next")).toBe(true);
    expect(byId.has("C-active")).toBe(true);
    expect(byId.has("D-waiting")).toBe(true);
    expect(byId.has("C-backlog")).toBe(false);
    expect(byId.has("D-done")).toBe(false);
    expect(cluster("code")).toMatchObject({ hiddenOpen: 1, hiddenClosed: 0 });
    expect(cluster("data")).toMatchObject({ hiddenOpen: 0, hiddenClosed: 1 });
  });

  it("counts every row in its cluster", () => {
    expect(cluster("code").counts).toEqual({
      active: 1,
      waiting: 0,
      open: 2,
      closed: 0,
    });
  });

  it("puts the next step first, inside its frame", () => {
    const frame = byId.get(getClusterId("B", "code"))!;
    const next = byId.get("C-next")!;
    const active = byId.get("C-active")!;
    expect(next.position).toEqual({
      x: frame.position.x + CLUSTER_PAD_X,
      y: frame.position.y + CLUSTER_HEADER_HEIGHT,
    });
    expect(active.position.y).toBeGreaterThan(next.position.y);
  });

  it("shows every row once expanded", () => {
    const open = layout(tasks, [getClusterId("B", "code")]);
    const ids = new Set(open.nodes.map((node) => node.id));
    expect(ids.has("C-backlog")).toBe(true);
    expect(ids.has("D-done")).toBe(false);
  });

  it("wraps a long cluster into two columns of rows", () => {
    const many = [
      ...tasks.slice(0, 2),
      ...["a", "b", "c", "d", "e", "f"].map((id) =>
        makeTask(id, ["B"], { ...code, status: "in_progress" })
      ),
    ];
    const wide = layout(many);
    const frame = wide.nodes.find((node) => node.type === CLUSTER_NODE_TYPE)!;
    const rows = new Map(wide.nodes.map((node) => [node.id, node.position]));
    expect((frame.data as TaskClusterNodeData).width).toBeGreaterThan(
      2 * MINIMAL_ROW_WIDTH
    );
    expect(rows.get("d")!.x).toBeGreaterThan(rows.get("a")!.x);
    expect(rows.get("d")!.y).toBe(rows.get("a")!.y);
  });

  it("puts the cluster holding the next step first", () => {
    const later = tasks.map((task) =>
      task.id === "C-next"
        ? Object.assign(Object.create(Object.getPrototypeOf(task)), task, {
            groupValues: ["zeta"],
          })
        : task
    );
    const frames = layout(later).nodes.filter(
      (node) => node.type === CLUSTER_NODE_TYPE
    );
    expect(frames[0].data.label).toBe("zeta");
  });

  it("renders frames beneath their rows", () => {
    const lastFrame = view.nodes.findLastIndex(
      (node) => node.type === CLUSTER_NODE_TYPE
    );
    expect(lastFrame).toBe(clusters.length - 1);
  });

  describe("splitIntoTwoColumns", () => {
    it.each([
      [[100, 100, 100, 100], 2],
      [[300, 50, 50, 50], 1],
      [[50, 50, 50, 300], 3],
    ])("splits %j after %i items", (heights, expected) => {
      expect(splitIntoTwoColumns(heights, 0)).toBe(expected);
    });
  });

  describe("edge cases", () => {
    it("leaves short lists alone", () => {
      const short = layout(tasks.slice(0, 5));
      expect(short.nodes.some((node) => node.type === CLUSTER_NODE_TYPE)).toBe(
        false
      );
    });

    it("leaves rows with children of their own unclustered", () => {
      const nested = layout([...tasks, makeTask("Sub", ["C-backlog"])]);
      const ids = new Set(nested.nodes.map((node) => node.id));
      expect(ids.has("C-backlog")).toBe(true);
      expect(
        nested.edges.some((edge) => edge.target === "C-backlog" && !edge.hidden)
      ).toBe(true);
    });
  });
});
