import type { App, EventRef, TAbstractFile, TFile } from "obsidian";

export const AUTO_REFRESH_DEBOUNCE_MS = 750;
export const SELF_WRITE_TTL_MS = 2000;

export interface RefreshRequestOptions {
  force?: boolean;
}

export type VaultWriteTracker = (
  _paths: string | string[],
  _operation: () => Promise<void>
) => Promise<void>;

export interface VaultWatcherOptions {
  onRefresh: () => void;
  isInteractionActive?: () => boolean;
  isIgnoredPath?: (_path: string) => boolean;
  debounceMs?: number;
  selfWriteTtlMs?: number;
}

interface TrackedWrite {
  timestamp: number;
  token: number;
}

interface RegisteredEvent {
  offref: (_ref: EventRef) => void;
  ref: EventRef;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isMarkdownPath(path: string): boolean {
  return normalizePath(path).toLowerCase().endsWith(".md");
}

/**
 * Watches one mounted map for task-relevant vault changes. Self-write tracking
 * deliberately belongs to the watcher instance: the map that made an
 * optimistic change can ignore its own event while other mounted maps still
 * refresh from the same vault event.
 */
export class VaultWatcher {
  private readonly app: App;
  private readonly options: Required<
    Pick<VaultWatcherOptions, "debounceMs" | "selfWriteTtlMs">
  > &
    Omit<VaultWatcherOptions, "debounceMs" | "selfWriteTtlMs">;
  private readonly recentSelfWrites = new Map<string, TrackedWrite>();
  private readonly registeredEvents: RegisteredEvent[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRefresh = false;
  private forcePendingRefresh = false;
  private nextWriteToken = 0;
  private started = false;

  constructor(app: App, options: VaultWatcherOptions) {
    this.app = app;
    this.options = {
      ...options,
      debounceMs: options.debounceMs ?? AUTO_REFRESH_DEBOUNCE_MS,
      selfWriteTtlMs: options.selfWriteTtlMs ?? SELF_WRITE_TTL_MS,
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.registeredEvents.push({
      offref: (ref) => this.app.metadataCache.offref(ref),
      ref: this.app.metadataCache.on("changed", (file: TFile) => {
        this.handlePaths([file.path]);
      }),
    });
    this.registeredEvents.push({
      offref: (ref) => this.app.vault.offref(ref),
      ref: this.app.vault.on("delete", (file: TAbstractFile) => {
        this.handlePaths([file.path]);
      }),
    });
    this.registeredEvents.push({
      offref: (ref) => this.app.vault.offref(ref),
      ref: this.app.vault.on(
        "rename",
        (file: TAbstractFile, oldPath: string) => {
          this.handlePaths([oldPath, file.path]);
        }
      ),
    });
  }

  stop(): void {
    this.started = false;
    this.registeredEvents.splice(0).forEach(({ offref, ref }) => offref(ref));
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.pendingRefresh = false;
    this.forcePendingRefresh = false;
    this.recentSelfWrites.clear();
  }

  requestRefresh(options: RefreshRequestOptions = {}): void {
    if (!this.started) return;
    this.pendingRefresh = true;
    this.forcePendingRefresh ||= options.force === true;

    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.flushRefresh();
    }, this.options.debounceMs);
  }

  resume(): void {
    if (!this.started || !this.pendingRefresh) return;
    if (this.options.isInteractionActive?.()) return;

    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.flushRefresh();
  }

  async trackWrite<T>(
    paths: string | string[],
    operation: () => Promise<T>
  ): Promise<T> {
    const normalizedPaths = (Array.isArray(paths) ? paths : [paths])
      .map(normalizePath)
      .filter(Boolean);
    const token = ++this.nextWriteToken;
    const startedAt = Date.now();
    normalizedPaths.forEach((path) => {
      this.recentSelfWrites.set(path, { timestamp: startedAt, token });
    });

    try {
      const result = await operation();
      const completedAt = Date.now();
      normalizedPaths.forEach((path) => {
        this.recentSelfWrites.set(path, { timestamp: completedAt, token });
      });
      return result;
    } catch (error) {
      normalizedPaths.forEach((path) => {
        if (this.recentSelfWrites.get(path)?.token === token) {
          this.recentSelfWrites.delete(path);
        }
      });
      throw error;
    }
  }

  private handlePaths(paths: string[]): void {
    const relevantPaths = paths
      .map(normalizePath)
      .filter(
        (path) => isMarkdownPath(path) && !this.options.isIgnoredPath?.(path)
      );
    if (relevantPaths.length === 0) return;

    // Rename-to-trash events include both the tracked source path and a new
    // trash path. Treat the event as self-owned when either side was tracked.
    if (relevantPaths.some((path) => this.isRecentSelfWrite(path))) return;
    this.requestRefresh();
  }

  private isRecentSelfWrite(path: string): boolean {
    const tracked = this.recentSelfWrites.get(path);
    if (!tracked) return false;
    if (Date.now() - tracked.timestamp <= this.options.selfWriteTtlMs) {
      return true;
    }
    this.recentSelfWrites.delete(path);
    return false;
  }

  private flushRefresh(): void {
    if (!this.pendingRefresh) return;
    if (
      !this.forcePendingRefresh &&
      this.options.isInteractionActive?.() === true
    ) {
      return;
    }

    this.pendingRefresh = false;
    this.forcePendingRefresh = false;
    this.options.onRefresh();
  }
}
