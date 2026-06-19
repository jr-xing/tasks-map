import { createDefaultFilterState } from "../src/types/filter-state";
import { TaskStatus } from "../src/types/task";

describe("createDefaultFilterState", () => {
  it("uses the configured default status filter", () => {
    const result = createDefaultFilterState(["todo"]);

    expect(result.selectedStatuses).toEqual(["todo"]);
  });

  it("clones the default status filter array", () => {
    const defaultStatusFilter: TaskStatus[] = ["todo"];
    const result = createDefaultFilterState(defaultStatusFilter);

    defaultStatusFilter.push("done");

    expect(result.selectedStatuses).toEqual(["todo"]);
  });
});
