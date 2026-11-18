import { Node } from "reactflow";
import {
  easeInOutCubic,
  ENTERING_NODE_CLASS,
  getAbsolutePosition,
  getAnchoredViewport,
  getStartBoxes,
  interpolateNodes,
  interpolateViewport,
} from "../src/lib/fold-animation";
import { NoteTask } from "../src/types/note-task";

function makeTask(id: string, parents: string[] = []): NoteTask {
  return new NoteTask({
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
}

function makeNode(
  id: string,
  x: number,
  y: number,
  overrides: Partial<Node> = {}
): Node {
  return {
    id,
    position: { x, y },
    data: { task: makeTask(id, overrides.data?.parents ?? []) },
    ...overrides,
  };
}

describe("easeInOutCubic", () => {
  it.each([
    [0, 0],
    [0.5, 0.5],
    [1, 1],
    [-1, 0],
    [2, 1],
  ])("maps %p to %p", (t, expected) => {
    expect(easeInOutCubic(t)).toBeCloseTo(expected);
  });
});

describe("getAbsolutePosition", () => {
  it("adds up parent positions", () => {
    const nodes = new Map<string, Node>([
      ["box", makeNode("box", 100, 50)],
      ["child", makeNode("child", 10, 5, { parentNode: "box" })],
    ]);
    expect(getAbsolutePosition("child", nodes)).toEqual({ x: 110, y: 55 });
    expect(getAbsolutePosition("missing", nodes)).toBeNull();
  });
});

describe("getStartBoxes", () => {
  const previous = [makeNode("P", 0, 0), makeNode("A", 300, 0)];

  it("starts existing cards where they were", () => {
    const { starts, entering } = getStartBoxes(previous, [
      makeNode("A", 300, 200),
    ]);
    expect(starts.get("A")).toMatchObject({ x: 300, y: 0 });
    expect(entering.size).toBe(0);
  });

  it("grows new cards out of their parent", () => {
    const child = makeNode("A1", 600, 100, {
      data: { task: makeTask("A1", ["A"]) },
    });
    const { starts, entering } = getStartBoxes(previous, [child]);
    expect(starts.get("A1")).toEqual({ x: 300, y: 0 });
    expect(entering.has("A1")).toBe(true);
  });

  it("shows new cards in place when no parent was on the map", () => {
    const loose = makeNode("Z", 50, 60);
    const { starts } = getStartBoxes(previous, [loose]);
    expect(starts.get("Z")).toEqual({ x: 50, y: 60 });
  });

  it("keeps the old size of frames", () => {
    const zone = (width: number) =>
      makeNode("zone", 0, 0, {
        style: { width, height: 100 },
        data: { width, height: 100 },
      });
    const { starts } = getStartBoxes([zone(200)], [zone(400)]);
    expect(starts.get("zone")).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });
});

describe("interpolateNodes", () => {
  it("moves cards part of the way and resizes frames", () => {
    const target = [
      makeNode("A", 100, 200),
      makeNode("zone", 0, 0, {
        style: { width: 400, height: 300 },
        data: { width: 400, height: 300 },
      }),
    ];
    const starts = new Map([
      ["A", { x: 0, y: 0 }],
      ["zone", { x: 0, y: 0, width: 200, height: 100 }],
    ]);
    const [card, zone] = interpolateNodes(target, starts, new Set(), 0.5);
    expect(card.position).toEqual({ x: 50, y: 100 });
    expect(zone.style).toMatchObject({ width: 300, height: 200 });
    expect(zone.data).toMatchObject({ width: 300, height: 200 });
  });

  it("marks entering cards so they fade in", () => {
    const [card] = interpolateNodes(
      [makeNode("A", 10, 10, { className: "x" })],
      new Map([["A", { x: 0, y: 0 }]]),
      new Set(["A"]),
      0.2
    );
    expect(card.className).toBe(`x ${ENTERING_NODE_CLASS}`);
  });

  it("ends exactly on the new layout", () => {
    const target = [makeNode("A", 100, 200)];
    const [card] = interpolateNodes(
      target,
      new Map([["A", { x: 0, y: 0 }]]),
      new Set(),
      1
    );
    expect(card.position).toEqual({ x: 100, y: 200 });
  });
});

describe("keeping the folded card in place", () => {
  it("pans so the card returns to its screen point", () => {
    // The card was at canvas (100, 100) on screen (250, 250) at zoom 2,
    // and the new layout moves it to (300, 0).
    const viewport = getAnchoredViewport(
      "A",
      { x: 250, y: 250 },
      [makeNode("A", 300, 0)],
      2
    );
    expect(viewport).toEqual({ x: -350, y: 250, zoom: 2 });
  });

  it("holds the card still during the whole glide", () => {
    const from = { x: 50, y: 50, zoom: 2 };
    const to = { x: -350, y: 250, zoom: 2 };
    const starts = new Map([["A", { x: 100, y: 100 }]]);
    const target = [makeNode("A", 300, 0)];
    for (const t of [0, 0.25, 0.5, 0.9, 1]) {
      const [card] = interpolateNodes(target, starts, new Set(), t);
      const view = interpolateViewport(from, to, t);
      expect(card.position.x * view.zoom + view.x).toBeCloseTo(250);
      expect(card.position.y * view.zoom + view.y).toBeCloseTo(250);
    }
  });

  it("gives up when the card is gone", () => {
    expect(getAnchoredViewport("A", { x: 0, y: 0 }, [], 1)).toBeNull();
  });
});
