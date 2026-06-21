import {
  parseTaskNotesTypeSchema,
  readTaskNotesTypeSchema,
  taskPrioritiesFromSchemaValues,
  updateTaskNotesTypeSchemaPriorityValues,
  writeTaskNotesTypeSchemaPriorityValues,
} from "../src/lib/tasknotes-type-schema";
import { Vault } from "./mocks/obsidian";

const TASK_TYPE_FILE = `---
name: task
fields:
  status:
    type: enum
    values: [open, done]
    default: open
    tn_role: status
  priority:
    type: enum
    values: [none, low, normal, high]
    default: normal
    tn_role: priority
---

# Task

Body stays here.
`;

describe("TaskNotes task type schema", () => {
  it("parses priority values and default priority", () => {
    const result = parseTaskNotesTypeSchema(TASK_TYPE_FILE, "_types/task.md");

    expect(result.kind).toBe("loaded");
    if (result.kind !== "loaded") return;
    expect(result.priorityValues).toEqual(["none", "low", "normal", "high"]);
    expect(result.defaultPriority).toBe("normal");
  });

  it("writes only priority values while preserving body content", () => {
    const updated = updateTaskNotesTypeSchemaPriorityValues(TASK_TYPE_FILE, [
      "none",
      "normal",
      "urgent",
    ]);

    expect(updated).toContain("# Task\n\nBody stays here.");
    const parsed = parseTaskNotesTypeSchema(updated, "_types/task.md");
    expect(parsed.kind).toBe("loaded");
    if (parsed.kind !== "loaded") return;
    expect(parsed.priorityValues).toEqual(["none", "normal", "urgent"]);
  });

  it("returns missing when the schema file does not exist", async () => {
    const vault = new Vault();

    const result = await readTaskNotesTypeSchema(vault, "_types/task.md");

    expect(result.kind).toBe("missing");
  });

  it("returns invalid for malformed schema content", () => {
    const result = parseTaskNotesTypeSchema("---\nname: task\n---\n");

    expect(result.kind).toBe("invalid");
  });

  it("writes priority values through the vault", async () => {
    const vault = new Vault();
    vault.setFileContent("_types/task.md", TASK_TYPE_FILE);

    const result = await writeTaskNotesTypeSchemaPriorityValues(
      vault,
      "_types/task.md",
      ["none", "high"]
    );

    expect(result.kind).toBe("written");
    expect(vault.getFileContent("_types/task.md")).toContain("- high");
  });

  it("merges schema values with TaskNotes catalog colors", () => {
    const priorities = taskPrioritiesFromSchemaValues(
      ["normal", "urgent"],
      [
        {
          id: "urgent",
          value: "urgent",
          label: "Urgent",
          color: "#ff1111",
          weight: 10,
        },
      ]
    );

    expect(priorities[0].label).toBe("Normal");
    expect(priorities[1].label).toBe("Urgent");
    expect(priorities[1].color).toBe("#ff1111");
    expect(priorities[0].weight).toBeGreaterThan(priorities[1].weight);
  });

  it("prefers Task Map color overrides over TaskNotes catalog colors", () => {
    const priorities = taskPrioritiesFromSchemaValues(
      ["urgent"],
      [
        {
          id: "urgent",
          value: "urgent",
          label: "Urgent",
          color: "#ff1111",
          weight: 10,
        },
      ],
      { urgent: "#123456" }
    );

    expect(priorities[0].color).toBe("#123456");
  });
});
