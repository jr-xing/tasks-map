import type { LayoutViewport } from "./layout";

export const VIEWPORT_RESIZE_DEBOUNCE_MS = 300;
const MAX_MEASUREMENT_FRAMES = 40;

interface ViewportRequest {
  isReady: () => boolean;
  onReady?: () => void;
}

interface GraphViewportSyncOptions {
  synchronize: () => boolean;
  onResize: (_viewport: LayoutViewport) => void;
  isInteracting: () => boolean;
}

export function readGraphViewport(
  container: HTMLElement | null
): LayoutViewport | undefined {
  if (!container?.isConnected) return undefined;
  const { clientWidth: width, clientHeight: height } = container;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  return width > 0 && height > 0 ? { width, height } : undefined;
}

/** Owns measurement work for one map, including maps moved to pop-out windows. */
export class GraphViewportSync {
  private readonly container: HTMLElement;
  private readonly options: GraphViewportSyncOptions;
  private ownerWindow: Window | null = null;
  private ownerDocument: Document | null = null;
  private observer: ResizeObserver | null = null;
  private unwatchMigration: (() => void) | undefined;
  private frame: number | null = null;
  private resizeTimer: number | null = null;
  private request: ViewportRequest | null = null;
  private lastViewport: LayoutViewport | undefined;
  private resizePending = false;
  private generation = 0;
  private started = false;

  constructor(container: HTMLElement, options: GraphViewportSyncOptions) {
    this.container = container;
    this.options = options;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.lastViewport = readGraphViewport(this.container);
    this.bindWindow();
    this.unwatchMigration = this.container.onWindowMigrated?.(() => {
      this.bindWindow();
      this.resizePending = true;
      this.resume();
    });
    this.resume();
  }

  stop(): void {
    this.started = false;
    this.cancel();
    this.unbindWindow();
    this.unwatchMigration?.();
    this.unwatchMigration = undefined;
  }

  /** Replaces obsolete graph work, including camera-preserving reloads. */
  requestMeasurement(request: ViewportRequest): void {
    this.request = request;
    this.resizePending = true;
    this.resume();
  }

  cancel(): void {
    this.cancelFrame();
    this.clearResizeTimer();
    this.request = null;
  }

  resize = (): void => {
    if (!this.started) return;
    this.bindWindow();
    this.cancelFrame();
    this.clearResizeTimer();
    this.resizePending = true;
    if (!this.ownerWindow) return;
    this.resizeTimer = this.ownerWindow.setTimeout(() => {
      this.resizeTimer = null;
      // Read the final dimensions in the frame, not those at event delivery.
      this.resume();
    }, VIEWPORT_RESIZE_DEBOUNCE_MS);
  };

  resume = (): void => {
    if (!this.started) return;
    this.bindWindow();
    this.cancelFrame();
    if (this.resizeTimer !== null || !this.ownerWindow) return;
    const generation = this.generation;
    let attempts = 0;
    const tick = () => {
      if (!this.started || generation !== this.generation) return;
      this.frame = null;
      if (this.options.isInteracting()) return;
      const viewport = readGraphViewport(this.container);
      const ready =
        viewport &&
        this.options.synchronize() &&
        (this.request?.isReady() ?? true);
      if (generation !== this.generation) return;
      if (ready) {
        if (this.resizePending) {
          this.resizePending = false;
          const changed =
            viewport.width !== this.lastViewport?.width ||
            viewport.height !== this.lastViewport?.height;
          this.lastViewport = viewport;
          if (changed) this.options.onResize(viewport);
          // Repacking can replace the request with new expected positions.
          if (generation !== this.generation) return;
        }
        const request = this.request;
        this.request = null;
        request?.onReady?.();
        return;
      }
      if (++attempts < MAX_MEASUREMENT_FRAMES) {
        this.frame = this.ownerWindow!.requestAnimationFrame(tick);
      }
      // Keep the request pending. A resize, visibility change, or graph
      // rebuild resumes it; never fit to zero or incomplete measurements.
    };
    this.frame = this.ownerWindow.requestAnimationFrame(tick);
  };

  private visibilityChanged = (): void => {
    if (this.ownerDocument?.visibilityState !== "hidden") {
      this.resizePending = true;
      this.resume();
    }
  };

  private bindWindow(): void {
    const ownerWindow = this.container.ownerDocument.defaultView;
    if (ownerWindow === this.ownerWindow) return;
    this.unbindWindow();
    this.ownerWindow = ownerWindow;
    this.ownerDocument = this.container.ownerDocument;
    if (!ownerWindow) return;
    ownerWindow.addEventListener("resize", this.resize);
    this.ownerDocument.addEventListener(
      "visibilitychange",
      this.visibilityChanged
    );
    // DOM constructors live on each realm, although TypeScript's Window
    // interface does not declare them.
    const Observer = (ownerWindow as Window & typeof globalThis).ResizeObserver;
    if (Observer) {
      this.observer = new Observer(this.resize);
      this.observer.observe(this.container);
    }
  }

  private unbindWindow(): void {
    this.cancelFrame();
    this.clearResizeTimer();
    this.observer?.disconnect();
    this.observer = null;
    this.ownerWindow?.removeEventListener("resize", this.resize);
    this.ownerDocument?.removeEventListener(
      "visibilitychange",
      this.visibilityChanged
    );
    this.ownerWindow = null;
    this.ownerDocument = null;
  }

  private cancelFrame(): void {
    this.generation += 1;
    if (this.frame !== null) this.ownerWindow?.cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private clearResizeTimer(): void {
    if (this.resizeTimer !== null) {
      this.ownerWindow?.clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
  }
}
