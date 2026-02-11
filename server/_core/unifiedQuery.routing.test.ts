import { describe, expect, it } from "vitest";
import { buildUnifiedQueryPlan } from "./unifiedQuery";

describe("unifiedQuery routing", () => {
  it("routes task-week questions to operational even when docs exist", () => {
    const plan = buildUnifiedQueryPlan("What are my tasks this week?", true, false);
    expect(plan.route).toBe("operational");
    expect(plan.tools).toContain("operational_state");
    expect(plan.tools).not.toContain("document_retrieval");
  });

  it("routes mixed task + protocol question to hybrid", () => {
    const plan = buildUnifiedQueryPlan(
      "What are my tasks this week and what does the protocol say about Visit 3?",
      true,
      false
    );
    expect(plan.route).toBe("hybrid");
    expect(plan.tools).toContain("operational_state");
    expect(plan.tools).toContain("document_retrieval");
  });

  it("routes patient enrollment question to operational", () => {
    const plan = buildUnifiedQueryPlan("How many patients are enrolled right now?", true, false);
    expect(plan.route).toBe("operational");
    expect(plan.tools).toContain("operational_state");
  });

  it("routes document inventory question to operational", () => {
    const plan = buildUnifiedQueryPlan("How many documents are indexed in the hub?", true, false);
    expect(plan.route).toBe("operational");
    expect(plan.tools).toContain("operational_state");
  });

  it("keeps protocol content question as document route", () => {
    const plan = buildUnifiedQueryPlan("What does the protocol say about Visit 3 assessments?", true, false);
    expect(plan.route).toBe("document");
    expect(plan.tools).toContain("document_retrieval");
  });
});
