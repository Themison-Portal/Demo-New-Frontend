import { describe, it, expect, beforeAll } from "vitest";
import { appRouter } from "./routers";
import { getDb } from "./db";
import { protocols } from "../drizzle/schema";
import { eq } from "drizzle-orm";

describe("Bidirectional Document Synchronization", () => {
  const testTrialId = "test-trial-bidirectional-" + Date.now();
  const mockUser = {
    id: 999,
    openId: "test-open-id",
    name: "Test User",
    email: "test@example.com",
    role: "user" as const,
    createdAt: new Date(),
  };

  const createTestContext = () => ({
    user: mockUser,
  });

  beforeAll(async () => {
    const db = await getDb();
    if (db) {
      await db.delete(protocols).where(eq(protocols.trialId, testTrialId));
    }
  });

  it("should show documents uploaded in Document Hub in the Study Setup Wizard", async () => {
    const caller = appRouter.createCaller(createTestContext());

    // Upload different document types via Document Hub
    const documentCategories = [
      "Protocol",
      "Lab Manual",
      "Pharmacy Manual",
      "Schedule of Assessments (SoA)",
      "Informed Consent Form (ICF)",
      "EDC/CRF Completion Guide",
      "Safety Reporting Manual",
      "Monitoring Plan",
    ];

    // Upload one document of each type
    for (const category of documentCategories) {
      const testPdfBase64 = Buffer.from(`test ${category} content`).toString("base64");
      
      await caller.documents.upload({
        trialId: testTrialId,
        filename: `${category.toLowerCase().replace(/\s+/g, '-')}.pdf`,
        fileData: testPdfBase64,
        category: category,
      });
    }

    // Query documents (this is what both Hub and Wizard use)
    const documents = await caller.documents.list({
      trialId: testTrialId,
    });

    // Verify all 8 documents are present
    expect(documents.length).toBe(8);

    // Verify each category is represented
    for (const category of documentCategories) {
      const doc = documents.find(d => d.category === category);
      expect(doc).toBeDefined();
      expect(doc?.trialId).toBe(testTrialId);
    }
  });

  it("should correctly categorize documents by exact category match", async () => {
    const caller = appRouter.createCaller(createTestContext());

    const documents = await caller.documents.list({
      trialId: testTrialId,
    });

    // Test that category matching works for all document types
    const protocolDoc = documents.find(d => d.category === "Protocol");
    const labManualDoc = documents.find(d => d.category === "Lab Manual");
    const pharmacyDoc = documents.find(d => d.category === "Pharmacy Manual");
    const soaDoc = documents.find(d => d.category === "Schedule of Assessments (SoA)");
    const icfDoc = documents.find(d => d.category === "Informed Consent Form (ICF)");
    const edcDoc = documents.find(d => d.category === "EDC/CRF Completion Guide");
    const safetyDoc = documents.find(d => d.category === "Safety Reporting Manual");
    const monitoringDoc = documents.find(d => d.category === "Monitoring Plan");

    expect(protocolDoc).toBeDefined();
    expect(labManualDoc).toBeDefined();
    expect(pharmacyDoc).toBeDefined();
    expect(soaDoc).toBeDefined();
    expect(icfDoc).toBeDefined();
    expect(edcDoc).toBeDefined();
    expect(safetyDoc).toBeDefined();
    expect(monitoringDoc).toBeDefined();
  });

  it("should handle documents with 'Other' category", async () => {
    const caller = appRouter.createCaller(createTestContext());

    const testPdfBase64 = Buffer.from("test other document").toString("base64");
    
    await caller.documents.upload({
      trialId: testTrialId,
      filename: "custom-document.pdf",
      fileData: testPdfBase64,
      category: "Other",
    });

    const documents = await caller.documents.list({
      trialId: testTrialId,
    });

    const otherDoc = documents.find(d => d.category === "Other");
    expect(otherDoc).toBeDefined();
    expect(otherDoc?.filename).toBe("custom-document.pdf");
  });
});
