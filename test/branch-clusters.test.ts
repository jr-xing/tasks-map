import { buildBranchModel } from "../src/lib/branch-model";
import { createBranchViewElements } from "../src/lib/layout/branch-elements";
import {
  CLUSTER_BLOCK_NODE_TYPE,
  CLUSTER_GAP,
  CLUSTER_HEADER_HEIGHT,
  CLUSTER_NODE_TYPE,
  CLUSTER_PAD_X,
  getClusterBlockChildren,
  getClusterBlockFrames,
  getClusteredEdges,
  getClusterId,
  planBranchClusters,
  splitIntoTwoColumns,
  TaskClusterNodeData,
} from "../src/lib/layout/branch-clusters";
import {
  createLayoutSnapshot,
  packLayoutSnapshot,
} from "../src/lib/layout/layout";
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

function makeNodes(tasks: NoteTask[]) {
  const model = buildBranchModel(tasks, DEFAULT_TASK_STATUSES);
  return createNodesFromTasks(
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
}

function layout(tasks: NoteTask[], expanded: string[] = []) {
  return createBranchViewElements(
    makeNodes(tasks),
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

describe("cluster blocks in the graph layout", () => {
  const options = { statuses: DEFAULT_TASK_STATUSES };
  const blockId = (parent: string) => `tasks-map-cluster-block:${parent}`;

  function graph(input: NoteTask[], groupByProject = false) {
    const nodes = makeNodes(input);
    const edges = createEdgesFromTasks(input);
    const plan = planBranchClusters(nodes, edges, options);
    const frames = getClusterBlockFrames(plan);
    const clustered = (id: string) => plan.clusteredIds.has(id);
    const snapshot = createLayoutSnapshot(
      [...nodes.filter((node) => !clustered(node.id)), ...frames.nodes],
      [...edges.filter((edge) => !clustered(edge.target)), ...plan.blockEdges],
      "Horizontal",
      true,
      groupByProject,
      [...input.filter((task) => !clustered(task.id)), ...frames.members],
      [],
      "minimal",
      frames.dimensions
    );
    return {
      plan,
      frames,
      laidOut: packLayoutSnapshot(snapshot),
      children: getClusterBlockChildren(plan),
      edges,
    };
  }

  it("lays each parent's clusters out as one inert block node", () => {
    const { frames, laidOut } = graph(tasks);
    expect(frames.nodes).toHaveLength(1);
    expect(frames.nodes[0]).toMatchObject({
      id: blockId("B"),
      type: CLUSTER_BLOCK_NODE_TYPE,
      selectable: false,
      draggable: false,
    });
    expect(laidOut.some((node) => node.id === blockId("B"))).toBe(true);
    expect(laidOut.some((node) => node.id === "C-next")).toBe(false);
  });

  it("sizes the block from its clusters, not as a task card", () => {
    const { plan, frames } = graph(tasks);
    const block = plan.blocks[0];
    expect(frames.dimensions.get(block.id)).toMatchObject({
      width: block.width,
      height: block.height,
    });
    expect(block.width).toBeGreaterThan(MINIMAL_ROW_WIDTH);
  });

  it("makes clusters and rows children of their block", () => {
    const { children } = graph(tasks);
    const code = children.clusters.find(
      (node) => node.id === getClusterId("B", "code")
    )!;
    const next = children.rows.find((node) => node.id === "C-next")!;
    expect(code.parentNode).toBe(blockId("B"));
    expect(next.parentNode).toBe(blockId("B"));
    expect(next.position).toEqual({
      x: code.position.x + CLUSTER_PAD_X,
      y: code.position.y + CLUSTER_HEADER_HEIGHT,
    });
  });

  it("draws cluster edges and hides the shown rows' own edges", () => {
    const { plan, children, edges } = graph(tasks);
    const drawn = getClusteredEdges(plan, edges, children.rows);
    const visible = drawn.filter((edge) => !edge.hidden);
    expect(visible.map((edge) => edge.target)).toEqual([
      "B",
      getClusterId("B", "code"),
    ]);
    expect(drawn.find((edge) => edge.target === "C-next")?.hidden).toBe(true);
    // Folded-away rows are not drawn, so neither are their edges.
    expect(drawn.some((edge) => edge.target === "C-backlog")).toBe(false);
  });

  describe("project frames", () => {
    const inProject = (input: NoteTask[], project: (id: string) => string[]) =>
      input.map((task) =>
        task.id === "P"
          ? task
          : Object.assign(Object.create(Object.getPrototypeOf(task)), task, {
              projects: project(task.id),
            })
      );

    it("puts the block in its rows' project frame", () => {
      const { laidOut } = graph(
        inProject(tasks, () => ["P"]),
        true
      );
      const block = laidOut.find((node) => node.id === blockId("B"))!;
      expect(block.parentNode).toBe("project-group-P");
    });

    it("leaves the block outside frames when its rows' projects differ", () => {
      const { frames } = graph(
        inProject(tasks, (id) => (id === "Loose" ? ["Q"] : ["P"])),
        true
      );
      expect(frames.members).toEqual([{ id: blockId("B"), projects: [] }]);
    });
  });

  describe("edge cases", () => {
    it("clusters nothing when disabled with minRows: Infinity", () => {
      const plan = planBranchClusters(
        makeNodes(tasks),
        createEdgesFromTasks(tasks),
        { ...options, minRows: Infinity }
      );
      expect(plan.blocks).toEqual([]);
      expect(getClusterBlockChildren(plan)).toEqual({
        clusters: [],
        rows: [],
      });
    });
  });
});
