import type { Node } from "reactflow";
import {
  GraphViewportSync,
  readGraphViewport,
  VIEWPORT_RESIZE_DEBOUNCE_MS,
} from "../src/lib/graph-viewport-sync";
import {
  areGraphNodesReady,
  synchronizeReactFlowMeasurements,
} from "../src/lib/react-flow-measurement";

function makeWindow() {
  let nextId = 0;
  let now = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, { callback: () => void; due: number }>();
  const observers: { callback: () => void; disconnect: jest.Mock }[] = [];
  const ownerWindow = Object.assign(new EventTarget(), {
    requestAnimationFrame: jest.fn((callback: FrameRequestCallback) => {
      frames.set(++nextId, callback);
      return nextId;
    }),
    cancelAnimationFrame: jest.fn((id: number) => frames.delete(id)),
    setTimeout: jest.fn((callback: () => void, delay: number) => {
      timers.set(++nextId, { callback, due: now + delay });
      return nextId;
    }),
    clearTimeout: jest.fn((id: number) => timers.delete(id)),
    ResizeObserver: class {
      disconnect = jest.fn();
      observe = jest.fn();
      constructor(callback: () => void) {
        observers.push({ callback, disconnect: this.disconnect });
      }
    },
  });
  const ownerDocument = Object.assign(new EventTarget(), {
    defaultView: ownerWindow as unknown as Window,
    visibilityState: "visible",
  });
  return {
    ownerWindow,
    ownerDocument,
    frames,
    timers,
    observers,
    frame() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(now));
    },
    advance(delay = VIEWPORT_RESIZE_DEBOUNCE_MS) {
      now += delay;
      [...timers].forEach(([id, timer]) => {
        if (timer.due <= now) {
          timers.delete(id);
          timer.callback();
        }
      });
    },
  };
}

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    id: "task",
    data: {},
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

function makeMap() {
  const realm = makeWindow();
  let migration: (() => void) | undefined;
  const unwatchMigration = jest.fn(() => {
    migration = undefined;
  });
  const container = {
    isConnected: true,
    clientWidth: 800,
    clientHeight: 600,
    ownerDocument: realm.ownerDocument,
    onWindowMigrated: (callback: () => void) => {
      migration = callback;
      return unwatchMigration;
    },
  };
  const element = {
    offsetWidth: 250,
    offsetHeight: 120,
    getAttribute: () => "task",
  };
  let elements = [element];
  const domNode = {
    get isConnected() {
      return container.isConnected;
    },
    get clientWidth() {
      return container.clientWidth;
    },
    get clientHeight() {
      return container.clientHeight;
    },
    querySelector: jest.fn(() => ({})),
    querySelectorAll: jest.fn(() => elements),
  };
  let nodes = [makeNode()];
  const state = {
    width: 800,
    height: 600,
    domNode: domNode as unknown as HTMLDivElement,
    updateNodeDimensions: jest.fn(
      (updates: { id: string; nodeElement: HTMLElement }[]) => {
        nodes = nodes.map((node) => {
          const update = updates.find((item) => item.id === node.id);
          return update
            ? {
                ...node,
                width: update.nodeElement.offsetWidth,
                height: update.nodeElement.offsetHeight,
              }
            : node;
        });
      }
    ),
  };
  const store = {
    getState: () => state,
    setState: jest.fn((size: { width: number; height: number }) => {
      Object.assign(state, size);
    }),
  };
  const fit = jest.fn();
  const synchronize = jest.fn(() => synchronizeReactFlowMeasurements(store));
  let dragging = false;
  const isReady = () => areGraphNodesReady(nodes, new Set(["task"]));
  // Models unchanged packing: it still requests fitting to the new viewport.
  const onResize = jest.fn(() => {
    sync.requestMeasurement({ isReady, onReady: fit });
  });
  const sync = new GraphViewportSync(container as unknown as HTMLElement, {
    synchronize,
    onResize,
    isInteracting: () => dragging,
  });
  sync.start();
  return {
    realm,
    container,
    element,
    domNode,
    state,
    store,
    sync,
    fit,
    isReady,
    synchronize,
    onResize,
    unwatchMigration,
    nodes: () => nodes,
    reload(onReady: (() => void) | undefined = fit) {
      sync.cancel();
      nodes = [makeNode()];
      sync.requestMeasurement({ isReady, onReady });
    },
    removeRenderedNodes() {
      elements = [];
    },
    setDragging(value: boolean) {
      dragging = value;
    },
    migrate(nextRealm: ReturnType<typeof makeWindow>) {
      container.ownerDocument = nextRealm.ownerDocument;
      migration?.();
    },
  };
}

describe("graph viewport synchronization", () => {
  it("remeasures and fits after maximize and reload without observer delivery", () => {
    const map = makeMap();
    map.reload();
    map.realm.frame();
    expect(map.fit).toHaveBeenCalledTimes(1);
    map.container.clientWidth = 1920;
    map.container.clientHeight = 1080;
    map.reload();
    expect(map.nodes()[0].width).toBeUndefined();
    map.realm.frame();
    map.realm.frame();
    expect(map.store.setState).toHaveBeenCalledWith({
      width: 1920,
      height: 1080,
    });
    expect(map.nodes()[0]).toMatchObject({ width: 250, height: 120 });
    expect(map.fit).toHaveBeenCalledTimes(2);
    expect(map.onResize).toHaveBeenCalledTimes(1);
    map.sync.stop();
  });

  it.each(["window", "observer", "view"])(
    "reads final dimensions after a %s resize, even with identical packing",
    (source) => {
      const map = makeMap();
      if (source === "window")
        map.realm.ownerWindow.dispatchEvent(new Event("resize"));
      if (source === "observer") map.realm.observers[0].callback();
      if (source === "view") map.sync.resize();
      // The event precedes the actual size change (maximize/programmatic resize).
      map.container.clientWidth = 1600;
      map.realm.advance();
      map.realm.frame();
      map.realm.frame();
      expect(map.onResize).toHaveBeenCalledWith({ width: 1600, height: 600 });
      expect(map.fit).toHaveBeenCalledTimes(1);
      map.sync.stop();
    }
  );

  it("coalesces a burst of resizes using the latest dimensions", () => {
    const map = makeMap();
    for (const width of [1000, 1200, 1800]) {
      map.container.clientWidth = width;
      map.sync.resize();
      map.realm.advance(100);
    }
    expect(map.onResize).not.toHaveBeenCalled();
    map.realm.advance();
    map.realm.frame();
    map.realm.frame();
    expect(map.onResize).toHaveBeenCalledTimes(1);
    expect(map.onResize).toHaveBeenCalledWith({ width: 1800, height: 600 });
    map.sync.stop();
  });

  it("remeasures automatic refreshes without changing the camera", () => {
    const map = makeMap();
    map.reload();
    map.realm.frame();
    map.reload(undefined);
    // Supply no fitting callback, as automatic refresh does.
    map.sync.requestMeasurement({ isReady: map.isReady });
    map.realm.frame();
    expect(map.nodes()[0].width).toBe(250);
    expect(map.fit).toHaveBeenCalledTimes(1);
    map.sync.stop();
  });

  it("discards obsolete work when a second reload replaces the first", () => {
    const map = makeMap();
    const firstFit = jest.fn();
    map.reload(firstFit);
    const obsoleteFrame = [...map.realm.frames.values()][0];
    map.reload();
    obsoleteFrame(0);
    map.realm.frame();
    expect(firstFit).not.toHaveBeenCalled();
    expect(map.fit).toHaveBeenCalledTimes(1);
    map.sync.stop();
  });

  it("runs follow-up navigation in the next owning-window frame", () => {
    const map = makeMap();
    const navigate = jest.fn();
    map.reload(() => {
      map.sync.requestMeasurement({ isReady: () => true, onReady: navigate });
    });
    map.realm.frame();
    expect(navigate).not.toHaveBeenCalled();
    map.realm.frame();
    expect(navigate).toHaveBeenCalledTimes(1);
    map.sync.stop();
  });

  it("defers repacking and fitting during dragging", () => {
    const map = makeMap();
    map.setDragging(true);
    map.container.clientWidth = 1400;
    map.sync.resize();
    map.realm.advance();
    map.realm.frame();
    expect(map.onResize).not.toHaveBeenCalled();
    expect(map.fit).not.toHaveBeenCalled();
    map.setDragging(false);
    map.sync.resume();
    map.realm.frame();
    map.realm.frame();
    expect(map.fit).toHaveBeenCalledTimes(1);
    map.sync.stop();
  });

  it("moves pending work to the owning window and detaches old listeners", () => {
    const map = makeMap();
    map.reload();
    map.sync.resize();
    const popout = makeWindow();
    map.migrate(popout);
    expect(map.realm.frames.size).toBe(0);
    expect(map.realm.timers.size).toBe(0);
    expect(map.realm.observers[0].disconnect).toHaveBeenCalled();
    map.realm.ownerWindow.dispatchEvent(new Event("resize"));
    expect(map.realm.timers.size).toBe(0);
    popout.frame();
    expect(map.fit).toHaveBeenCalledTimes(1);
    map.container.clientWidth = 1000;
    popout.ownerWindow.dispatchEvent(new Event("resize"));
    popout.advance();
    popout.frame();
    popout.frame();
    expect(map.fit).toHaveBeenCalledTimes(2);
    map.sync.stop();
    expect(popout.frames.size).toBe(0);
    expect(popout.timers.size).toBe(0);
    expect(popout.observers[0].disconnect).toHaveBeenCalled();
    expect(map.unwatchMigration).toHaveBeenCalled();
  });

  it("cancels callbacks when the map closes", () => {
    const map = makeMap();
    map.reload();
    const obsoleteFrame = [...map.realm.frames.values()][0];
    map.sync.resize();
    map.sync.stop();
    obsoleteFrame(0);
    map.realm.advance();
    map.realm.ownerWindow.dispatchEvent(new Event("resize"));
    expect(map.realm.timers.size).toBe(0);
    expect(map.realm.frames.size).toBe(0);
    expect(map.fit).not.toHaveBeenCalled();
  });

  describe("edge cases", () => {
    it.each(["container", "node"])(
      "waits for positive %s dimensions and resumes after bounded retries",
      (target) => {
        const map = makeMap();
        if (target === "container") map.container.clientWidth = 0;
        else map.element.offsetWidth = 0;
        map.reload();
        for (let i = 0; i < 45; i++) map.realm.frame();
        expect(map.fit).not.toHaveBeenCalled();
        expect(map.realm.frames.size).toBe(0);
        map.container.clientWidth = 800;
        map.element.offsetWidth = 250;
        map.realm.ownerDocument.dispatchEvent(new Event("visibilitychange"));
        map.realm.frame();
        expect(map.fit).toHaveBeenCalledTimes(1);
        map.sync.stop();
      }
    );

    it("does not fit nodes before their elements have rendered", () => {
      const map = makeMap();
      map.removeRenderedNodes();
      map.reload();
      map.realm.frame();
      expect(map.fit).not.toHaveBeenCalled();
      map.sync.stop();
    });

    it("does not measure a detached or zero-size ReactFlow canvas", () => {
      const map = makeMap();
      map.container.isConnected = false;
      expect(synchronizeReactFlowMeasurements(map.store)).toBe(false);
      expect(
        readGraphViewport(map.container as unknown as HTMLElement)
      ).toBeUndefined();
      map.container.isConnected = true;
      map.container.clientHeight = 0;
      expect(synchronizeReactFlowMeasurements(map.store)).toBe(false);
      expect(map.state.updateNodeDimensions).not.toHaveBeenCalled();
      map.sync.stop();
    });

    it.each([undefined, 0, -1, NaN, Infinity])(
      "rejects unmeasured or invalid node widths: %s",
      (width) => {
        expect(
          areGraphNodesReady(
            [makeNode({ width, height: 120 })],
            new Set(["task"])
          )
        ).toBe(false);
      }
    );

    it("waits for the expected node set and packed positions", () => {
      const nodes = [makeNode({ width: 250, height: 120 })];
      expect(areGraphNodesReady(nodes, new Set(["other"]))).toBe(false);
      expect(
        areGraphNodesReady(
          nodes,
          new Set(["task"]),
          new Map([["task", { x: 10, y: 20 }]])
        )
      ).toBe(false);
      expect(
        areGraphNodesReady(
          nodes,
          new Set(["task"]),
          new Map([["task", { x: 0, y: 0 }]])
        )
      ).toBe(true);
    });
  });
});
