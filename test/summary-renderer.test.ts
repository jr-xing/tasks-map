import { useCallback } from "react";
import { useSummaryRenderer } from "../src/hooks/use-summary-renderer";

interface FakeElement {
  text: string;
  empty: () => void;
  createSpan: (options: { text: string }) => void;
  createEl: (
    tag: string,
    options: { text: string }
  ) => {
    addEventListener: () => void;
  };
}

function makeElement(): FakeElement {
  const element: FakeElement = {
    text: "",
    empty: () => {
      element.text = "";
    },
    createSpan: ({ text }) => {
      element.text += text;
    },
    createEl: (_tag, { text }) => {
      element.text += text;
      return { addEventListener: () => undefined };
    },
  };
  return element;
}

function render(summary: string, element: FakeElement | null) {
  const ref = useSummaryRenderer(summary);
  if (typeof ref !== "function") throw new Error("expected a callback ref");
  ref(element as unknown as HTMLSpanElement);
}

describe("useSummaryRenderer", () => {
  beforeEach(() => {
    (useCallback as jest.Mock).mockImplementation((fn) => fn);
  });

  it("renders the summary into the attached element", () => {
    const element = makeElement();
    render("Draft specific aims page", element);
    expect(element.text).toBe("Draft specific aims page");
  });

  it("renders into a remounted element when the summary is unchanged", () => {
    const first = makeElement();
    const remounted = makeElement();
    render("AHA WH Aim 2b", first);
    render("AHA WH Aim 2b", remounted);
    expect(remounted.text).toBe("AHA WH Aim 2b");
  });

  it("replaces previous content when the summary changes", () => {
    const element = makeElement();
    render("Old title", element);
    render("New [[Note|link]] title", element);
    expect(element.text).toBe("New link title");
  });

  describe("edge cases", () => {
    it("ignores detach calls", () => {
      expect(() => render("Title", null)).not.toThrow();
    });
  });
});
