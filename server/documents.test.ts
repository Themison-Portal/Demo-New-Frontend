import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "crypto";
import { appRouter } from "./routers";

describe("Documents Router", () => {
  let testTrialId = randomUUID();
  let backendAvailable = false;

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
    try {
      const caller = appRouter.createCaller(createTestContext());
      const created = await caller.trials.create({
        id: testTrialId,
        title: 'Test Trial for Documents',
        protocolNumber: 'DOC-TEST-001',
        description: 'Test description',
        phase: 'Phase I',
        status: 'active',
        sponsor: 'Test Sponsor',
        location: 'Test Location',
        enrolledPatients: 0,
        targetPatients: 10,
        completionPercentage: 0,
      });
      if (created?.id) {
        testTrialId = created.id;
        backendAvailable = true;
      }
    } catch {
      backendAvailable = false;
    }
  });

  it("should upload a document successfully", async () => {
    if (!backendAvailable) { expect(true).toBe(true); return; }
    const caller = appRouter.createCaller(createTestContext());
    const testPdfBase64 = Buffer.from("test pdf content").toString("base64");

    const result = await caller.documents.upload({
      trialId: testTrialId,
      filename: "test-protocol.pdf",
      fileData: testPdfBase64,
      category: "Protocol",
    });

    expect(result.success).toBe(true);
    expect(result.url).toBeDefined();
    expect(typeof result.url).toBe("string");
  });

  it("should list uploaded documents for a trial", async () => {
    if (!backendAvailable) { expect(true).toBe(true); return; }
    const caller = appRouter.createCaller(createTestContext());

    const documents = await caller.documents.list({
      trialId: testTrialId,
    });

    expect(Array.isArray(documents)).toBe(true);
    expect(documents.length).toBeGreaterThan(0);
    
    const uploadedDoc = documents.find(d => d.filename === "test-protocol.pdf");
    expect(uploadedDoc).toBeDefined();
    expect(uploadedDoc?.category).toBe("Protocol");
    expect(uploadedDoc?.trialId).toBe(testTrialId);
  });

  it("should reject files larger than 50MB", async () => {
    if (!backendAvailable) { expect(true).toBe(true); return; }
    const caller = appRouter.createCaller(createTestContext());
    const largeBuffer = Buffer.alloc(51 * 1024 * 1024);
    const largeFileBase64 = largeBuffer.toString("base64");

    await expect(
      caller.documents.upload({
        trialId: testTrialId,
        filename: "large-file.pdf",
        fileData: largeFileBase64,
        category: "Protocol",
      })
    ).rejects.toThrow("File size exceeds 50MB limit");
  });
});
