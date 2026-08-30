import type { App, EventRef } from "obsidian";
import { TFile } from "obsidian";
import {
  AUTO_REFRESH_DEBOUNCE_MS,
  SELF_WRITE_TTL_MS,
  VaultWatcher,
} from "../src/lib/vault-watcher";

type EventCallback = (...args: unknown[]) => void;

interface FakeEventRef {
  callback: EventCallback;
  name: string;
}

class FakeEvents {
  private callbacks = new Map<string, Set<EventCallback>>();

  on(name: string, callback: EventCallback): EventRef {
    const callbacks = this.callbacks.get(name) ?? new Set<EventCallback>();
    callbacks.add(callback);
    this.callbacks.set(name, callbacks);
    return { name, callback } as unknown as EventRef;
  }

  offref(ref: EventRef): void {
    const fakeRef = ref as unknown as FakeEventRef;
    this.callbacks.get(fakeRef.name)?.delete(fakeRef.callback);
  }

  trigger(name: string, ...args: unknown[]): void {
    this.callbacks.get(name)?.forEach((callback) => callback(...args));
  }

  listenerCount(name: string): number {
    return this.callbacks.get(name)?.size ?? 0;
  }
}

function makeApp() {
  const metadataCache = new FakeEvents();
  const vault = new FakeEvents();
  return {
    app: { metadataCache, vault } as unknown as App,
    metadataCache,
    vault,
  };
}

describe("VaultWatcher", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-30T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("batches relevant Markdown cache changes and ignores other files", () => {
    const { app, metadataCache } = makeApp();
    const onRefresh = jest.fn();
    const watcher = new VaultWatcher(app, {
      onRefresh,
      isIgnoredPath: (path) => path === "TaskNotes/Task.md",
    });
    watcher.start();

    metadataCache.trigger("changed", new TFile("Tasks/One.md"));
    jest.advanceTimersByTime(AUTO_REFRESH_DEBOUNCE_MS - 1);
    expect(onRefresh).not.toHaveBeenCalled();

    metadataCache.trigger("changed", new TFile("Tasks/Two.md"));
    metadataCache.trigger("changed", new TFile("assets/data.json"));
    metadataCache.trigger("changed", new TFile("TaskNotes/Task.md"));
    jest.advanceTimersByTime(AUTO_REFRESH_DEBOUNCE_MS);

    expect(onRefresh).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it("refreshes once for Markdown deletes and renames", () => {
    const { app, vault } = makeApp();
    const onRefresh = jest.fn();
    const watcher = new VaultWatcher(app, { onRefresh });
    watcher.start();

    vault.trigger("delete", new TFile("Tasks/Deleted.md"));
    vault.trigger("rename", new TFile("Tasks/Renamed.md"), "Tasks/Old.md");
    jest.advanceTimersByTime(AUTO_REFRESH_DEBOUNCE_MS);

    expect(onRefresh).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it("suppresses its own writes until the self-write window expires", async () => {
    const { app, metadataCache, vault } = makeApp();
    const onRefresh = jest.fn();
    const watcher = new VaultWatcher(app, { onRefresh });
    watcher.start();

    await watcher.trackWrite("Tasks/Owned.md", async () => {
      metadataCache.trigger("changed", new TFile("Tasks/Owned.md"));
      vault.trigger(
        "rename",
        new TFile(".trash/Tasks/Owned.md"),
        "Tasks/Owned.md"
      );
    });
    jest.advanceTimersByTime(AUTO_REFRESH_DEBOUNCE_MS);
    expect(onRefresh).not.toHaveBeenCalled();

    jest.advanceTimersByTime(SELF_WRITE_TTL_MS + 1);
    metadataCache.trigger("changed", new TFile("Tasks/Owned.md"));
    jest.advanceTimersByTime(AUTO_REFRESH_DEBOUNCE_MS);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it("does not suppress the same write in another mounted map", async () => {
    const { app, metadataCache } = makeApp();
    const firstRefresh = jest.fn();
    const secondRefresh = jest.fn();
    const first = new VaultWatcher(app, { onRefresh: firstRefresh });
    const second = new VaultWatcher(app, { onRefresh: secondRefresh });
    first.start();
    second.start();

    await first.trackWrite("Tasks/Shared.md", async () => {
      metadataCache.trigger("changed", new TFile("Tasks/Shared.md"));
    });
    jest.advanceTimersByTime(AUTO_REFRESH_DEBOUNCE_MS);

    expect(firstRefresh).not.toHaveBeenCalled();
    expect(secondRefresh).toHaveBeenCalledTimes(1);
    first.stop();
    second.stop();
  });

  it("clears suppression when a tracked write fails", async () => {
    const { app, metadataCache } = makeApp();
    const onRefresh = jest.fn();
    const watcher = new VaultWatcher(app, { onRefresh });
    watcher.start();

    await expect(
      watcher.trackWrite("Tasks/Failed.md", async () => {
        throw new Error("write failed");
      })
    ).rejects.toThrow("write failed");
    metadataCache.trigger("changed", new TFile("Tasks/Failed.md"));
    jest.advanceTimersByTime(AUTO_REFRESH_DEBOUNCE_MS);

    expect(onRefresh).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it("defers interaction refreshes, resumes once, and permits forced saves", () => {
    const { app, metadataCache } = makeApp();
    const onRefresh = jest.fn();
    let interactionActive = true;
    const watcher = new VaultWatcher(app, {
      onRefresh,
      isInteractionActive: () => interactionActive,
    });
    watcher.start();

    metadataCache.trigger("changed", new TFile("Tasks/External.md"));
    jest.advanceTimersByTime(AUTO_REFRESH_DEBOUNCE_MS);
    expect(onRefresh).not.toHaveBeenCalled();

    interactionActive = false;
    watcher.resume();
    watcher.resume();
    expect(onRefresh).toHaveBeenCalledTimes(1);

    interactionActive = true;
    watcher.requestRefresh({ force: true });
    jest.advanceTimersByTime(AUTO_REFRESH_DEBOUNCE_MS);
    expect(onRefresh).toHaveBeenCalledTimes(2);
    watcher.stop();
  });

  it("removes listeners and cancels pending work when stopped", () => {
    const { app, metadataCache, vault } = makeApp();
    const onRefresh = jest.fn();
    const watcher = new VaultWatcher(app, { onRefresh });
    watcher.start();

    expect(metadataCache.listenerCount("changed")).toBe(1);
    expect(vault.listenerCount("delete")).toBe(1);
    expect(vault.listenerCount("rename")).toBe(1);

    metadataCache.trigger("changed", new TFile("Tasks/Pending.md"));
    watcher.stop();
    jest.advanceTimersByTime(AUTO_REFRESH_DEBOUNCE_MS);

    expect(onRefresh).not.toHaveBeenCalled();
    expect(metadataCache.listenerCount("changed")).toBe(0);
    expect(vault.listenerCount("delete")).toBe(0);
    expect(vault.listenerCount("rename")).toBe(0);
  });
});
