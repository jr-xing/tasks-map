import {
  fitTreeViewport,
  layoutTree,
  orderTreeRows,
  TREE_BLOCK_GAP,
  TREE_GUTTER_PADDING,
  TREE_LANE_WIDTH,
  TREE_ROW_GAP,
} from "../src/lib/layout/tree";

const CARD = { width: 250, height: 76 };

function edge(source: string, target: string) {
  return { source, target };
}

function makeLayout(
  nodeIds: string[],
  edges: { source: string; target: string }[],
  direction: "Horizontal" | "Vertical" = "Vertical"
) {
  return layoutTree({
    nodeIds,
    edges,
    dimensions: new Map(nodeIds.map((id) => [id, CARD])),
    direction,
  });
}

function lanes(layout: ReturnType<typeof makeLayout>) {
  return Object.fromEntries(layout.rows.map((row) => [row.id, row.lane]));
}

describe("tree layout", () => {
  describe("row order", () => {
    it("lists each task directly before its subtree, project first", () => {
      const { order } = orderTreeRows(
        ["p", "a", "a1", "a2", "b"],
        [edge("p", "a"), edge("p", "b"), edge("a", "a1"), edge("a", "a2")]
      );
      expect(order).toEqual(["p", "a", "a1", "a2", "b"]);
    });

    it("orders roots and siblings with the given comparator", () => {
      const byReverse = (left: string, right: string) =>
        right.localeCompare(left);
      const { order } = orderTreeRows(
        ["p", "a", "b", "q"],
        [edge("p", "a"), edge("p", "b")],
        byReverse
      );
      expect(order).toEqual(["q", "p", "b", "a"]);
    });

    it("places a task with two parents after both, under the later one", () => {
      const { order, parentOf, links } = orderTreeRows(
        ["p", "a", "b", "c"],
        [edge("p", "a"), edge("p", "b"), edge("a", "c"), edge("b", "c")]
      );
      expect(order).toEqual(["p", "a", "b", "c"]);
      expect(parentOf.get("c")).toBe("b");
      expect(links).toEqual([edge("a", "c")]);
    });
  });

  describe("lanes", () => {
    it("keeps a project's direct tasks on the project's own line", () => {
      const layout = makeLayout(
        ["p", "a", "b", "c"],
        [edge("p", "a"), edge("p", "b"), edge("p", "c")]
      );
      expect(lanes(layout)).toEqual({ p: 0, a: 0, b: 0, c: 0 });
      expect(layout.laneCount).toBe(1);
    });

    it("branches subtasks one lane right and reuses the lane afterwards", () => {
      const layout = makeLayout(
        ["p", "a", "a1", "a2", "b", "b1"],
        [
          edge("p", "a"),
          edge("p", "b"),
          edge("a", "a1"),
          edge("a", "a2"),
          edge("b", "b1"),
        ]
      );
      expect(lanes(layout)).toEqual({
        p: 0,
        a: 0,
        a1: 1,
        a2: 1,
        b: 0,
        b1: 1,
      });
      expect(layout.laneCount).toBe(2);
    });

    it("grows lanes with depth, not with the number of siblings", () => {
      const siblings = Array.from({ length: 12 }, (_, index) => `t${index}`);
      const layout = makeLayout(
        ["p", ...siblings],
        siblings.map((id) => edge("p", id))
      );
      expect(layout.laneCount).toBe(1);
    });
  });

  describe("geometry", () => {
    it("stacks rows vertically and separates projects with a block gap", () => {
      const layout = makeLayout(["p", "a", "q"], [edge("p", "a")]);
      const offsets = layout.rows.map((row) => row.offset);
      expect(offsets).toEqual([
        0,
        CARD.height + TREE_ROW_GAP,
        2 * CARD.height + TREE_ROW_GAP + TREE_BLOCK_GAP,
      ]);
    });

    it("aligns every card just right of the gutter", () => {
      const layout = makeLayout(
        ["p", "a", "a1"],
        [edge("p", "a"), edge("a", "a1")]
      );
      const gutterWidth = TREE_GUTTER_PADDING * 2 + 2 * TREE_LANE_WIDTH;
      expect(layout.gutter.width).toBe(gutterWidth);
      for (const position of layout.positions.values()) {
        expect(position.x).toBe(gutterWidth);
      }
      expect(layout.gutter.height).toBe(layout.rows[2].offset + CARD.height);
    });

    it("draws a branch line, a tick per row and a dot per task", () => {
      const layout = makeLayout(
        ["p", "a", "a1"],
        [edge("p", "a"), edge("a", "a1")]
      );
      const kinds = layout.gutter.lines.map((line) => line.kind);
      expect(kinds.filter((kind) => kind === "branch")).toHaveLength(2);
      expect(kinds.filter((kind) => kind === "tick")).toHaveLength(3);
      expect(layout.gutter.dots.map((dot) => dot.id)).toEqual(["p", "a", "a1"]);
    });

    it("routes extra parents on a link lane right of the tree lanes", () => {
      const layout = makeLayout(
        ["p", "a", "b", "c"],
        [edge("p", "a"), edge("p", "b"), edge("a", "c"), edge("b", "c")]
      );
      expect(layout.links).toEqual([{ source: "a", target: "c", lane: 0 }]);
      expect(layout.gutter.lines.some((line) => line.kind === "link")).toBe(
        true
      );
      expect(layout.gutter.width).toBe(
        TREE_GUTTER_PADDING * 2 + 3 * TREE_LANE_WIDTH
      );
    });

    it("transposes the layout when horizontal", () => {
      const layout = makeLayout(["p", "a"], [edge("p", "a")], "Horizontal");
      const gutterHeight = TREE_GUTTER_PADDING * 2 + TREE_LANE_WIDTH;
      expect(layout.positions.get("p")).toEqual({ x: 0, y: gutterHeight });
      expect(layout.positions.get("a")).toEqual({
        x: CARD.width + 24,
        y: gutterHeight,
      });
      expect(layout.gutter.height).toBe(gutterHeight);
    });
  });

  describe("edge cases", () => {
    it("returns an empty layout for no tasks", () => {
      const layout = makeLayout([], []);
      expect(layout.rows).toEqual([]);
      expect(layout.gutter).toMatchObject({ width: 0, height: 0 });
    });

    it("ignores self-links, duplicates and links to hidden tasks", () => {
      const { order, links } = orderTreeRows(
        ["a", "b"],
        [edge("a", "a"), edge("a", "b"), edge("a", "b"), edge("x", "b")]
      );
      expect(order).toEqual(["a", "b"]);
      expect(links).toEqual([]);
    });

    it("still lays out every task on a dependency cycle", () => {
      const { order, links } = orderTreeRows(
        ["a", "b", "c"],
        [edge("a", "b"), edge("b", "c"), edge("c", "a")]
      );
      expect(order).toEqual(["a", "b", "c"]);
      expect(links).toEqual([edge("c", "a")]);
    });
  });
});

describe("fitTreeViewport", () => {
  const area = { left: 40, top: 10, width: 400, height: 300 };

  it("shows a narrow vertical tree at 100% from its top", () => {
    expect(
      fitTreeViewport(
        { x: 0, y: 0, width: 300, height: 5000 },
        area,
        "Vertical"
      )
    ).toEqual({ x: 56, y: 26, zoom: 1 });
  });

  it("scales a wide vertical tree down to fit the width", () => {
    const viewport = fitTreeViewport(
      { x: 0, y: 0, width: 736, height: 5000 },
      area,
      "Vertical"
    );
    expect(viewport.zoom).toBeCloseTo(0.5);
  });

  it("fits a horizontal tree's height, never below the minimum zoom", () => {
    expect(
      fitTreeViewport(
        { x: 0, y: 0, width: 9000, height: 2000 },
        area,
        "Horizontal"
      ).zoom
    ).toBe(0.5);
  });
});
