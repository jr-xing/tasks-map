import { Node } from "reactflow";
import { buildBranchModel } from "../src/lib/branch-model";
import { createLayoutSnapshot, packLayoutSnapshot } from "../src/lib/layout";
import { createBranchViewElements } from "../src/lib/layout/branch-elements";
import {
  createTaskGroupZoning,
  getTaskGroupZoneId,
  TASK_GROUP_ZONE_HEADER_HEIGHT,
  TASK_GROUP_ZONE_TYPE,
  TaskGroupZoneData,
} from "../src/lib/layout/task-group-zones";
import type { TaskGroupArrangement } from "../src/types/settings";
import { DEFAULT_TASK_STATUSES } from "../src/lib/status-config";
import { NO_TASK_GROUP, resolveTaskGroups } from "../src/lib/task-groups";
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
    priority: "",
    link: `${id}.md`,
    incomingLinks: parents,
    starred: false,
  });
  return Object.assign(task, overrides);
}

function zoningFor(
  tasks: NoteTask[],
  order: string[] = [],
  arrangement: TaskGroupArrangement = "rows"
) {
  return createTaskGroupZoning({
    tasks,
    edges: createEdgesFromTasks(tasks),
    groups: resolveTaskGroups(tasks),
    order,
    statuses: DEFAULT_TASK_STATUSES,
    arrangement,
  });
}

function graphLayout(
  tasks: NoteTask[],
  direction: "Horizontal" | "Vertical" = "Horizontal",
  order: string[] = [],
  arrangement: TaskGroupArrangement = "rows"
) {
  const zoning = zoningFor(tasks, order, arrangement);
  if (!zoning) throw new Error("Expected zoning");
  const snapshot = {
    ...createLayoutSnapshot(
      createNodesFromTasks(tasks),
      zoning.layoutEdges,
      direction,
      true,
      false,
      tasks
    ),
    zones: zoning.zones,
  };
  return packLayoutSnapshot(snapshot, { width: 1600, height: 900 });
}

function zonesOf(nodes: Node[]): Node<TaskGroupZoneData>[] {
  return nodes.filter((node) => node.type === TASK_GROUP_ZONE_TYPE);
}

function isInside(node: Node, zone: Node<TaskGroupZoneData>) {
  return (
    node.position.x >= zone.position.x &&
    node.position.y >= zone.position.y + TASK_GROUP_ZONE_HEADER_HEIGHT &&
    node.position.x < zone.position.x + zone.data.width &&
    node.position.y < zone.position.y + zone.data.height
  );
}

function nodeById(nodes: Node[], id: string): Node {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`Missing node ${id}`);
  return node;
}

// Two Yale projects, two of my own, one without a group, and a note shared
// by the toolkit (its home) and PIS.
const tasks = [
  makeTask("PIS", [], {
    isProject: true,
    taskGroup: "Yale core",
    status: "in_progress",
  }),
  makeTask("PIS-a", ["PIS"]),
  makeTask("PIS-b", ["PIS"]),
  makeTask("Toolkit", [], { isProject: true, taskGroup: "Yale data" }),
  makeTask("Toolkit-a", ["Toolkit"]),
  makeTask("Shared", ["Toolkit", "PIS"]),
  makeTask("MICCAI", [], {
    isProject: true,
    taskGroup: "My own work",
    status: "done",
  }),
  makeTask("ISBI", [], { isProject: true, taskGroup: "My own work" }),
  makeTask("ISBI-a", ["ISBI"]),
  makeTask("Loose"),
];

describe("createTaskGroupZoning", () => {
  it("does nothing for a map with a single group", () => {
    const single = [
      makeTask("P", [], { taskGroup: "Yale core" }),
      makeTask("A", ["P"]),
    ];
    expect(zoningFor(single)).toBeNull();
  });

  it("does nothing when no task names a group", () => {
    expect(zoningFor([makeTask("A"), makeTask("B")])).toBeNull();
  });

  it("orders groups by the setting, then by name, then no group", () => {
    const zoning = zoningFor(tasks, ["Yale core", "Yale data"]);
    expect(zoning?.zones.order).toEqual([
      "Yale core",
      "Yale data",
      "My own work",
      NO_TASK_GROUP,
    ]);
    expect(zoning?.groupRank("Toolkit-a")).toBe(1);
    expect(zoning?.groupRank("Loose")).toBe(3);
  });

  it("counts each group's projects and open tasks", () => {
    const zones = zoningFor(tasks)?.zones;
    expect(zones?.zoneData("My own work")).toMatchObject({
      label: "My own work",
      projects: 2,
      open: 2,
    });
    expect(zones?.zoneData(NO_TASK_GROUP)).toMatchObject({
      label: "",
      color: undefined,
      projects: 0,
      open: 1,
    });
  });
});

describe("zones in the graph layout", () => {
  const nodes = graphLayout(tasks, "Horizontal", ["Yale core", "Yale data"]);
  const zones = zonesOf(nodes);

  it("draws one zone per group, before the cards", () => {
    expect(zones.map((zone) => zone.id)).toEqual([
      getTaskGroupZoneId("Yale core"),
      getTaskGroupZoneId("Yale data"),
      getTaskGroupZoneId("My own work"),
      getTaskGroupZoneId(NO_TASK_GROUP),
    ]);
    expect(nodes.slice(0, zones.length)).toEqual(zones);
  });

  it("stacks horizontal zones as bands of equal width", () => {
    const widths = new Set(zones.map((zone) => zone.data.width));
    expect(widths.size).toBe(1);
    zones.slice(1).forEach((zone, index) => {
      const above = zones[index];
      expect(zone.position.x).toBe(above.position.x);
      expect(zone.position.y).toBeGreaterThanOrEqual(
        above.position.y + above.data.height
      );
    });
  });

  it("places each task inside its group's zone", () => {
    const zoneOf = new Map(zones.map((zone) => [zone.data.label, zone]));
    const groups = resolveTaskGroups(tasks);
    for (const task of tasks) {
      const zone = zoneOf.get(groups.get(task.id) ?? NO_TASK_GROUP);
      if (!zone) throw new Error(`No zone for ${task.id}`);
      expect(isInside(nodeById(nodes, task.id), zone)).toBe(true);
    }
  });

  it("keeps a shared note with its first parent", () => {
    const toolkitZone = nodeById(zones, getTaskGroupZoneId("Yale data"));
    expect(isInside(nodeById(nodes, "Shared"), toolkitZone as never)).toBe(
      true
    );
  });

  it("puts active projects first and finished ones last", () => {
    const miccai = nodeById(nodes, "MICCAI");
    const isbi = nodeById(nodes, "ISBI");
    expect(isbi.position.x).toBeLessThan(miccai.position.x);
  });

  it("aligns the tops of projects in one band", () => {
    expect(nodeById(nodes, "ISBI").position.y).toBe(
      nodeById(nodes, "MICCAI").position.y
    );
  });
});

function overlaps(
  left: Node<TaskGroupZoneData>,
  right: Node<TaskGroupZoneData>
) {
  return (
    left.position.x < right.position.x + right.data.width &&
    right.position.x < left.position.x + left.data.width &&
    left.position.y < right.position.y + right.data.height &&
    right.position.y < left.position.y + left.data.height
  );
}

describe.each(["Horizontal", "Vertical"] as const)(
  "zone arrangements in %s maps",
  (direction) => {
    it("sets columns side by side with equal heights", () => {
      const nodes = graphLayout(tasks, direction, [], "columns");
      const columns = zonesOf(nodes);
      expect(new Set(columns.map((zone) => zone.data.height)).size).toBe(1);
      columns.slice(1).forEach((zone, index) => {
        const left = columns[index];
        expect(zone.position.y).toBe(left.position.y);
        expect(zone.position.x).toBeGreaterThanOrEqual(
          left.position.x + left.data.width
        );
      });
    });

    it("lines projects up by their left edges in columns", () => {
      const nodes = graphLayout(tasks, direction, [], "columns");
      // ISBI (open) is stacked above MICCAI (done) in the same column.
      const isbi = nodeById(nodes, "ISBI");
      const miccai = nodeById(nodes, "MICCAI");
      expect(miccai.position.y).toBeGreaterThan(isbi.position.y);
    });

    it("puts grid zones in aligned cells without overlap", () => {
      const nodes = graphLayout(tasks, direction, [], "grid");
      const grid = zonesOf(nodes);
      expect(grid).toHaveLength(4);
      grid.forEach((zone, index) =>
        grid.slice(index + 1).forEach((other) => {
          expect(overlaps(zone, other)).toBe(false);
        })
      );
      // Zones in one row share their top and height.
      const rows = new Map<number, Node<TaskGroupZoneData>[]>();
      grid.forEach((zone) =>
        rows.set(zone.position.y, [...(rows.get(zone.position.y) ?? []), zone])
      );
      rows.forEach((row) =>
        expect(new Set(row.map((zone) => zone.data.height)).size).toBe(1)
      );
      const zoneOf = new Map(grid.map((zone) => [zone.data.label, zone]));
      const groups = resolveTaskGroups(tasks);
      for (const task of tasks) {
        const zone = zoneOf.get(groups.get(task.id) ?? NO_TASK_GROUP);
        if (!zone) throw new Error(`No zone for ${task.id}`);
        expect(isInside(nodeById(nodes, task.id), zone)).toBe(true);
      }
    });
  }
);

describe("grid packing", () => {
  it("fills the space beside a tall project with short ones", () => {
    const many = [
      makeTask("Big", [], { isProject: true, taskGroup: "A" }),
      ...Array.from({ length: 8 }, (_, index) =>
        makeTask(`Big-${index}`, ["Big"])
      ),
      ...["S1", "S2", "S3"].map((id) =>
        makeTask(id, [], { isProject: true, taskGroup: "A" })
      ),
      makeTask("Other", [], { isProject: true, taskGroup: "B" }),
    ];
    const nodes = graphLayout(many, "Horizontal", [], "grid");
    const big = zonesOf(nodes).find((zone) => zone.data.label === "A");
    if (!big) throw new Error("Missing zone A");
    // The small projects stack beside the tall one instead of each
    // starting a new row under it.
    const bigBottom = Math.max(
      ...nodes
        .filter((node) => node.id.startsWith("Big"))
        .map((node) => node.position.y)
    );
    ["S1", "S2", "S3"].forEach((id) =>
      expect(nodeById(nodes, id).position.y).toBeLessThan(bigBottom)
    );
  });
});

describe("zones in the branches layout", () => {
  it("adds the zones beneath the branch cards", () => {
    const zoning = zoningFor(tasks);
    if (!zoning) throw new Error("Expected zoning");
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
    const view = createBranchViewElements(
      nodes,
      zoning.layoutEdges,
      "Horizontal",
      { width: 1600, height: 900 },
      { statuses: DEFAULT_TASK_STATUSES },
      zoning.zones
    );
    const zones = zonesOf(view.nodes);
    expect(zones).toHaveLength(4);
    expect(view.nodes.slice(0, 4)).toEqual(zones);
    const yaleCore = nodeById(zones, getTaskGroupZoneId("Yale core"));
    expect(isInside(nodeById(view.nodes, "PIS"), yaleCore as never)).toBe(true);
  });
});
