import { readFileSync } from "fs";
import { join } from "path";
import type {
  App as ObsidianApp,
  ListItemCache,
  TFile as ObsidianFile,
} from "obsidian";
import {
  extractRawInlineTasks,
  getAllInlineTasks,
} from "../src/lib/inline-task-source";
import { getAllTasks } from "../src/lib/utils";
import { App, TFile } from "./mocks/obsidian";

function makeListItem(
  line: number,
  task: string | undefined,
  endLine = line,
  parent = -1
): ListItemCache {
  return {
    task,
    parent,
    position: {
      start: { line, col: 0, offset: 0 },
      end: { line: endLine, col: 0, offset: 0 },
    },
  };
}

function singleLineTaskItems(content: string): ListItemCache[] {
  return content.split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(/^[\s>]*(?:\d+\.|\d+\)|\*|-|\+)\s*\[([^\]])\]/u);
    return match ? [makeListItem(index, match[1])] : [];
  });
}

function fixture(name: string): string {
  return readFileSync(join(__dirname, "fixture", name), "utf8");
}

function makeApp(files: Record<string, string>): App {
  const app = new App();
  for (const [path, content] of Object.entries(files)) {
    app.vault.setFileContent(path, content);
  }
  app.metadataCache.getFileCache = (file) => ({
    listItems: singleLineTaskItems(files[file.path] ?? ""),
  });
  return app;
}

describe("extractRawInlineTasks", () => {
  it.each([
    [
      "Dataview format tasks.md",
      [
        [" ", "Do this first [id:: dcf64c]"],
        [
          " ",
          "Do this after first and some other task [dependsOn:: dcf64c, 0h17ye]",
        ],
        [" ", "Another independent task [id:: 0h17ye]"],
        [" ", "Final task depending on all [dependsOn:: dcf64c, 0h17ye] ⭐"],
      ],
    ],
    [
      "Simple tasks.md",
      [
        ["x", "Define what to do #example #project 🆔 ogeuh4"],
        ["x", "List resources #example 🆔 zfhxot"],
        ["/", "Start work #example #new 🆔 28hf1s ⛔ ogeuh4 ⏫"],
        [" ", "Check progress #example #easy ⛔ 28hf1s,zfhxot 🆔 67zv0n"],
        [" ", "See what went well #example #easy ⛔ 67zv0n 🆔 3quyej"],
        [" ", "Note improvements #example #documentation ⛔ 3quyej 🆔 ldri05"],
        [
          " ",
          "Extra final task with a really long description here ⛔ ldri05 ⛔ 3quyej",
        ],
        [" ", ""],
      ],
    ],
    [
      "Mixed format tasks.md",
      [
        ["x", "Define what to do #example #project 🆔 abc123 ⭐"],
        ["x", "List resources #example 🆔 def456"],
        ["/", "Start work #example #new ⛔ abc123 ⛔ def456 🆔 ghi789"],
        [" ", "Check progress #example #easy ⛔ ghi789,def456"],
        [" ", "Design architecture #dataview [id:: 7f3yaw]"],
        [" ", "Implement feature #dataview [dependsOn:: 7f3yaw] [id:: jmhi6u]"],
        [" ", "Write tests #dataview [dependsOn:: jmhi6u] [id:: i2a0b2]"],
        [" ", "⭐ Deploy to production #dataview [dependsOn:: jmhi6u, i2a0b2]"],
        [" ", "Task with emoji ID #mixed 🆔 mno345"],
        [" ", "Task with dataview dependency #mixed [dependsOn:: mno345]"],
      ],
    ],
    [
      "Tasks with link in title.md",
      [
        [" ", "Some task #basic  🆔 fje2wy"],
        [" ", "Some [[Renovate Bot]] related task #basic  ⛔ fje2wy 🆔 2bv892"],
        [
          " ",
          "Some [external](https://google.com) link #basic  ⛔ 2bv892 🆔 s6t8ha",
        ],
        [" ", "Final task #basic ⛔ s6t8ha"],
      ],
    ],
  ])("matches the expected raw tasks in %s", (name, expected) => {
    const content = fixture(name as string);
    const file = new TFile(name as string);

    const tasks = extractRawInlineTasks(
      file as unknown as ObsidianFile,
      content,
      singleLineTaskItems(content)
    );

    expect(tasks).toEqual(
      (expected as string[][]).map(([status, text]) => ({
        status,
        text,
        link: { path: name },
      }))
    );
  });

  it("preserves ordered, quoted, nested, multiline, CRLF, and custom-status tasks", () => {
    const content = [
      "> 1) [/] Parent task\r",
      "    continuation [dependsOn:: abc123]\r",
      "  * [x] Nested task\r",
      "+ [-] Custom status\r",
      "* [] Empty status character\r",
      "- Ordinary list item\r",
    ].join("\n");
    const items = [
      makeListItem(0, "/", 1),
      makeListItem(2, "x", 2, 0),
      makeListItem(3, "-"),
      makeListItem(4, ""),
      makeListItem(5, undefined),
    ];

    expect(
      extractRawInlineTasks(
        new TFile("Complex.md") as unknown as ObsidianFile,
        content,
        items
      )
    ).toEqual([
      {
        status: "/",
        text: "Parent task\ncontinuation [dependsOn:: abc123]",
        link: { path: "Complex.md" },
      },
      {
        status: "x",
        text: "Nested task",
        link: { path: "Complex.md" },
      },
      {
        status: "-",
        text: "Custom status",
        link: { path: "Complex.md" },
      },
      {
        status: "",
        text: "Empty status character",
        link: { path: "Complex.md" },
      },
    ]);
  });
});

describe("getAllInlineTasks", () => {
  it("parses every non-empty fixture task in deterministic file order", async () => {
    const names = [
      "Dataview format tasks.md",
      "Simple tasks.md",
      "Mixed format tasks.md",
      "Tasks with link in title.md",
    ];
    const files = Object.fromEntries(
      names.map((name) => [name, fixture(name)])
    );

    const tasks = await getAllInlineTasks(
      makeApp(files) as unknown as ObsidianApp
    );

    expect(tasks).toHaveLength(25);
    expect(tasks.slice(0, 4).map((task) => task.link)).toEqual(
      Array(4).fill("Dataview format tasks.md")
    );
    expect(
      tasks.find((task) => task.id === "28hf1s")?.toPlainObject()
    ).toMatchObject({
      status: "in_progress",
      priority: "⏫",
      tags: ["example", "new"],
      incomingLinks: ["ogeuh4"],
    });
    expect(tasks.find((task) => task.id === "jmhi6u")?.incomingLinks).toEqual([
      "7f3yaw",
    ]);
    expect(tasks.find((task) => task.id === "2bv892")?.summary).toBe(
      "Some [[Renovate Bot]] related task"
    );
    expect(tasks.some((task) => task.summary === "")).toBe(false);
  });

  it("skips files without cached tasks without reading them", async () => {
    const app = makeApp({ "Notes.md": "No tasks here" });
    const read = jest.spyOn(app.vault, "cachedRead");

    await expect(
      getAllInlineTasks(app as unknown as ObsidianApp)
    ).resolves.toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it("logs and skips a file that cannot be read", async () => {
    const app = makeApp({ "Tasks.md": "- [ ] Task 🆔 abc123" });
    jest.spyOn(app.vault, "cachedRead").mockRejectedValue(new Error("gone"));
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      getAllInlineTasks(app as unknown as ObsidianApp)
    ).resolves.toEqual([]);
    expect(warning).toHaveBeenCalledWith(
      "[tasks-map] Could not read inline tasks from Tasks.md:",
      expect.any(Error)
    );

    warning.mockRestore();
  });
});

describe("getAllTasks", () => {
  it("returns native inline tasks followed by note-based tasks", async () => {
    const app = makeApp({
      "Inline.md": "- [ ] Inline task 🆔 abc123",
      "Note task.md": "---\ntags:\n  - task\nstatus: open\n---\n",
    });
    const inlineCache = app.metadataCache.getFileCache;
    app.metadataCache.getFileCache = (file) =>
      file.path === "Note task.md"
        ? { frontmatter: { tags: ["task"], status: "open" } }
        : inlineCache(file);

    const tasks = await getAllTasks(app as unknown as ObsidianApp);

    expect(tasks.map((task) => [task.type, task.link])).toEqual([
      ["dataview", "Inline.md"],
      ["note", "Note task.md"],
    ]);
  });
});
