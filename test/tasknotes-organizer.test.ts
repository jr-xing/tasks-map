import {
  buildTaskOrganizerPlanFromInput,
  TASK_FOLDER_SCHEMA,
  TaskOrganizerPlanInput,
  TaskOrganizerPlannerNote,
} from "../src/lib/tasknotes-organizer";
import { DEFAULT_SETTINGS } from "../src/types/settings";

function makeNote(
  overrides: Partial<TaskOrganizerPlannerNote>
): TaskOrganizerPlannerNote {
  const path = overrides.path ?? "tasks/Task.md";
  const name = path.split("/").pop() ?? path;
  return {
    path,
    basename: name.replace(/\.md$/, ""),
    extension: "md",
    kind: "task",
    frontmatter: { type: "task", title: name.replace(/\.md$/, "") },
    links: [],
    embeds: [],
    ...overrides,
  };
}

function makeInput(
  notes: TaskOrganizerPlannerNote[],
  links: Record<string, string>,
  overrides: Partial<TaskOrganizerPlanInput> = {}
): TaskOrganizerPlanInput {
  return {
    notes,
    existingPaths: new Set([
      ...notes.map((note) => note.path),
      ...Object.values(links).filter((path) => !path.endsWith(".md")),
    ]),
    resolveLink: (_sourcePath, rawLink) => links[rawLink] ?? null,
    settings: {
      ...DEFAULT_SETTINGS,
      taskOrganizerRenameProjectFolders: false,
      taskOrganizerRenameTaskFolders: true,
      taskOrganizerUseAiFolderNames: false,
      taskOrganizerAiProvider: "openai",
      taskOrganizerAiModel: "",
      taskOrganizerAiApiKey: "",
      taskOrganizerOrphans: "skip",
      taskOrganizerExcludedFolders: "Templates",
      ...overrides.settings,
    },
    fetchImpl: overrides.fetchImpl,
    onProgress: overrides.onProgress,
  };
}

describe("tasknotes organizer planner", () => {
  it("moves project and task notes into the two-layer project layout", async () => {
    const project = makeNote({
      path: "legacy/Project.md",
      kind: "project",
      frontmatter: { type: "project", title: "Alpha Project" },
    });
    const parent = makeNote({
      path: "inbox/Parent Task.md",
      frontmatter: {
        type: "task",
        title: "Parent Task",
        projects: ["[[Project]]"],
      },
      embeds: [{ link: "photo.png" }],
    });
    const child = makeNote({
      path: "inbox/deep/Child Task.md",
      frontmatter: {
        type: "task",
        title: "Child Task",
        projects: ["[[Parent Task]]"],
      },
    });

    const plan = await buildTaskOrganizerPlanFromInput(
      makeInput([project, parent, child], {
        "[[Project]]": project.path,
        "[[Parent Task]]": parent.path,
        "photo.png": "attachments/photo.png",
      })
    );

    expect(plan.noteMoves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: project.path,
          to: "projects/alpha-project/Project.md",
        }),
        expect.objectContaining({
          from: parent.path,
          to: "projects/alpha-project/parent-task/Parent Task.md",
        }),
        expect.objectContaining({
          from: child.path,
          to: "projects/alpha-project/child-task/Child Task.md",
        }),
      ])
    );
    expect(plan.attachmentMoves).toEqual([
      expect.objectContaining({
        from: "attachments/photo.png",
        to: "projects/alpha-project/parent-task/assets/photo.png",
      }),
    ]);
    expect(plan.metadataUpdates.map((update) => update.fields)).toEqual(
      expect.arrayContaining([
        {
          folder_slug: "parent-task",
          folder_slug_source: "fallback",
          folder_schema: TASK_FOLDER_SCHEMA,
        },
        {
          folder_slug: "child-task",
          folder_slug_source: "fallback",
          folder_schema: TASK_FOLDER_SCHEMA,
        },
      ])
    );
  });

  it("preserves existing project folder names by default", async () => {
    const project = makeNote({
      path: "projects/2026-08-08-alpha/Project.md",
      kind: "project",
      frontmatter: { type: "project", title: "Alpha Project" },
    });
    const task = makeNote({
      path: "inbox/Task.md",
      frontmatter: {
        type: "task",
        title: "Task",
        projects: ["[[Project]]"],
      },
    });

    const plan = await buildTaskOrganizerPlanFromInput(
      makeInput([project, task], { "[[Project]]": project.path })
    );

    expect(plan.noteMoves).not.toContainEqual(
      expect.objectContaining({ from: project.path })
    );
    expect(plan.noteMoves).toContainEqual(
      expect.objectContaining({
        from: task.path,
        to: "projects/2026-08-08-alpha/task/Task.md",
      })
    );
  });

  it("renames project folders when enabled", async () => {
    const project = makeNote({
      path: "projects/2026-08-08-alpha/Project.md",
      kind: "project",
      frontmatter: { type: "project", title: "Alpha Project" },
    });

    const plan = await buildTaskOrganizerPlanFromInput(
      makeInput(
        [project],
        {},
        {
          settings: {
            ...DEFAULT_SETTINGS,
            taskOrganizerRenameProjectFolders: true,
          },
        }
      )
    );

    expect(plan.noteMoves).toContainEqual(
      expect.objectContaining({
        from: project.path,
        to: "projects/alpha-project/Project.md",
      })
    );
  });

  it("preserves existing task folder names when task renaming is disabled", async () => {
    const project = makeNote({
      path: "projects/2026-08-08-alpha/Project.md",
      kind: "project",
      frontmatter: { type: "project", title: "Alpha Project" },
    });
    const task = makeNote({
      path: "projects/old-project/2026-08-08-task/Task.md",
      frontmatter: {
        type: "task",
        title: "Task",
        projects: ["[[Project]]"],
      },
    });
    const fetchImpl = jest.fn();

    const plan = await buildTaskOrganizerPlanFromInput(
      makeInput(
        [project, task],
        { "[[Project]]": project.path },
        {
          settings: {
            ...DEFAULT_SETTINGS,
            taskOrganizerRenameTaskFolders: false,
            taskOrganizerUseAiFolderNames: true,
            taskOrganizerAiProvider: "openai",
            taskOrganizerAiModel: "test-model",
            taskOrganizerAiApiKey: "test-key",
          },
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }
      )
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(plan.noteMoves).toContainEqual(
      expect.objectContaining({
        from: task.path,
        to: "projects/2026-08-08-alpha/2026-08-08-task/Task.md",
      })
    );
    expect(plan.metadataUpdates).toEqual([]);
  });

  it("uses AI names for task folders only", async () => {
    const project = makeNote({
      path: "projects/Readable Project.md",
      kind: "project",
      frontmatter: { type: "project", title: "Readable Project" },
    });
    const task = makeNote({
      path: "tasks/Long Task.md",
      frontmatter: {
        type: "task",
        title: "Long Task",
        projects: ["[[Readable Project]]"],
      },
    });
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: "semantic-task-folder" }),
      status: 200,
    });

    const plan = await buildTaskOrganizerPlanFromInput(
      makeInput(
        [project, task],
        { "[[Readable Project]]": project.path },
        {
          settings: {
            ...DEFAULT_SETTINGS,
            taskOrganizerUseAiFolderNames: true,
            taskOrganizerAiProvider: "openai",
            taskOrganizerAiModel: "test-model",
            taskOrganizerAiApiKey: "test-key",
            taskOrganizerOrphans: "skip",
          },
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }
      )
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(plan.noteMoves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: "projects/readable-project/Readable Project.md",
        }),
        expect.objectContaining({
          to: "projects/readable-project/semantic-task-folder/Long Task.md",
        }),
      ])
    );
    expect(plan.metadataUpdates[0].fields.folder_slug_source).toBe("llm");
  });

  it("reports AI folder naming progress for tasks that need generated slugs", async () => {
    const project = makeNote({
      path: "projects/Readable Project.md",
      kind: "project",
      frontmatter: { type: "project", title: "Readable Project" },
    });
    const first = makeNote({
      path: "tasks/First Task.md",
      frontmatter: {
        type: "task",
        title: "First Task",
        projects: ["[[Readable Project]]"],
      },
    });
    const alreadyNamed = makeNote({
      path: "projects/readable-project/already-named/Already.md",
      frontmatter: {
        type: "task",
        title: "Already",
        projects: ["[[Readable Project]]"],
        folder_schema: TASK_FOLDER_SCHEMA,
      },
    });
    const progress: string[] = [];
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: "semantic-task-folder" }),
      status: 200,
    });

    await buildTaskOrganizerPlanFromInput(
      makeInput(
        [project, first, alreadyNamed],
        { "[[Readable Project]]": project.path },
        {
          settings: {
            ...DEFAULT_SETTINGS,
            taskOrganizerUseAiFolderNames: true,
            taskOrganizerAiProvider: "openai",
            taskOrganizerAiModel: "test-model",
            taskOrganizerAiApiKey: "test-key",
          },
          fetchImpl: fetchImpl as unknown as typeof fetch,
          onProgress: ({ completed, total }) => {
            progress.push(`${completed}/${total}`);
          },
        }
      )
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(progress).toEqual(["0/1", "1/1"]);
  });

  it("reuses stored task folder slugs", async () => {
    const project = makeNote({
      path: "Project.md",
      kind: "project",
      frontmatter: { type: "project", title: "Project" },
    });
    const task = makeNote({
      path: "Task.md",
      frontmatter: {
        type: "task",
        title: "Task",
        projects: ["[[Project]]"],
        folder_slug: "stored-folder",
        folder_slug_source: "manual",
        folder_schema: TASK_FOLDER_SCHEMA,
      },
    });

    const plan = await buildTaskOrganizerPlanFromInput(
      makeInput([project, task], { "[[Project]]": project.path })
    );

    expect(plan.noteMoves).toContainEqual(
      expect.objectContaining({
        to: "projects/project/stored-folder/Task.md",
      })
    );
    expect(plan.metadataUpdates).toEqual([]);
  });

  it("reuses schema-marked current task folders without asking AI again", async () => {
    const project = makeNote({
      path: "projects/alpha-project/Project.md",
      kind: "project",
      frontmatter: { type: "project", title: "Alpha Project" },
    });
    const task = makeNote({
      path: "projects/alpha-project/semantic-task-folder/Task.md",
      frontmatter: {
        type: "task",
        title: "Task",
        projects: ["[[Project]]"],
        folder_schema: TASK_FOLDER_SCHEMA,
      },
    });
    const fetchImpl = jest.fn();

    const plan = await buildTaskOrganizerPlanFromInput(
      makeInput(
        [project, task],
        { "[[Project]]": project.path },
        {
          settings: {
            ...DEFAULT_SETTINGS,
            taskOrganizerUseAiFolderNames: true,
            taskOrganizerAiProvider: "openai",
            taskOrganizerAiModel: "test-model",
            taskOrganizerAiApiKey: "test-key",
          },
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }
      )
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(plan.noteMoves).toEqual([]);
    expect(plan.metadataUpdates).toEqual([
      {
        path: task.path,
        fields: {
          folder_slug: "semantic-task-folder",
          folder_slug_source: "manual",
          folder_schema: TASK_FOLDER_SCHEMA,
        },
      },
    ]);
  });

  it("skips orphan tasks by default and can move them to _unassigned", async () => {
    const orphan = makeNote({
      path: "inbox/Loose.md",
      frontmatter: { type: "task", title: "Loose Task" },
    });

    const skipped = await buildTaskOrganizerPlanFromInput(
      makeInput([orphan], {})
    );
    const unassigned = await buildTaskOrganizerPlanFromInput(
      makeInput(
        [orphan],
        {},
        {
          settings: {
            ...DEFAULT_SETTINGS,
            taskOrganizerOrphans: "unassigned",
          },
        }
      )
    );

    expect(skipped.skippedOrphans).toEqual([orphan.path]);
    expect(skipped.noteMoves).toEqual([]);
    expect(unassigned.noteMoves).toEqual([
      expect.objectContaining({
        to: "projects/_unassigned/loose-task/Loose.md",
      }),
    ]);
  });

  it("ignores notes under configured excluded folders", async () => {
    const templateProject = makeNote({
      path: "Templates/project template.md",
      kind: "project",
      frontmatter: { type: "project", title: "Project Template" },
    });
    const templateTask = makeNote({
      path: "Templates/task template.md",
      frontmatter: {
        type: "task",
        title: "Task Template",
        projects: ["[[project template]]"],
      },
    });

    const plan = await buildTaskOrganizerPlanFromInput(
      makeInput([templateProject, templateTask], {
        "[[project template]]": templateProject.path,
      })
    );

    expect(plan.noteMoves).toEqual([]);
    expect(plan.metadataUpdates).toEqual([]);
    expect(plan.skippedOrphans).toEqual([]);
  });

  it("skips shared attachments", async () => {
    const project = makeNote({
      path: "Project.md",
      kind: "project",
      frontmatter: { type: "project", title: "Project" },
    });
    const first = makeNote({
      path: "A.md",
      frontmatter: { type: "task", title: "A", projects: ["[[Project]]"] },
      embeds: [{ link: "shared.png" }],
    });
    const second = makeNote({
      path: "B.md",
      frontmatter: { type: "task", title: "B", projects: ["[[Project]]"] },
      embeds: [{ link: "shared.png" }],
    });

    const plan = await buildTaskOrganizerPlanFromInput(
      makeInput([project, first, second], {
        "[[Project]]": project.path,
        "shared.png": "attachments/shared.png",
      })
    );

    expect(plan.attachmentMoves).toEqual([]);
    expect(plan.skippedSharedAttachments).toEqual(["attachments/shared.png"]);
  });

  it("does not move attachments under configured excluded folders", async () => {
    const project = makeNote({
      path: "Project.md",
      kind: "project",
      frontmatter: { type: "project", title: "Project" },
    });
    const task = makeNote({
      path: "Task.md",
      frontmatter: { type: "task", title: "Task", projects: ["[[Project]]"] },
      embeds: [{ link: "template.png" }],
    });

    const plan = await buildTaskOrganizerPlanFromInput(
      makeInput([project, task], {
        "[[Project]]": project.path,
        "template.png": "Templates/template.png",
      })
    );

    expect(plan.attachmentMoves).toEqual([]);
  });

  it("moves single-owner owned markdown attachments", async () => {
    const project = makeNote({
      path: "Project.md",
      kind: "project",
      frontmatter: { type: "project", title: "Project" },
    });
    const task = makeNote({
      path: "Task.md",
      frontmatter: { type: "task", title: "Task", projects: ["[[Project]]"] },
      links: [{ link: "Card" }],
    });
    const card = makeNote({
      path: "cards/Card.md",
      kind: "attachment-note",
      frontmatter: { type: "task-card", title: "Card" },
    });

    const plan = await buildTaskOrganizerPlanFromInput(
      makeInput([project, task, card], {
        "[[Project]]": project.path,
        Card: card.path,
      })
    );

    expect(plan.attachmentMoves).toEqual([
      expect.objectContaining({
        from: card.path,
        to: "projects/project/task/assets/Card.md",
      }),
    ]);
  });

  it("adds deterministic suffixes for same-project folder collisions", async () => {
    const project = makeNote({
      path: "Project.md",
      kind: "project",
      frontmatter: { type: "project", title: "Project" },
    });
    const first = makeNote({
      path: "First.md",
      frontmatter: {
        type: "task",
        title: "Same Name",
        projects: ["[[Project]]"],
      },
    });
    const second = makeNote({
      path: "Second.md",
      frontmatter: {
        type: "task",
        title: "Same Name",
        projects: ["[[Project]]"],
      },
    });

    const plan = await buildTaskOrganizerPlanFromInput(
      makeInput([project, first, second], { "[[Project]]": project.path })
    );

    expect(plan.noteMoves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: "projects/project/same-name/First.md",
        }),
        expect.objectContaining({
          to: "projects/project/same-name-2/Second.md",
        }),
      ])
    );
  });
});
