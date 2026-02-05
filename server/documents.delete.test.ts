import { describe, it, expect, beforeAll } from "vitest";
import { appRouter } from "./routers";
import { getDb } from "./db";
import { protocols, fileSearchDocuments, fileSearchStores } from "../drizzle/schema";
import { eq } from "drizzle-orm";

describe("documents.delete", () => {
  let testProtocolId: number;
  let testTrialId: string;

  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Create a test trial ID
    testTrialId = `test-trial-${Date.now()}`;

    // Insert a test protocol
    await db.insert(protocols).values({
      trialId: testTrialId,
      filename: "test-delete.pdf",
      fileUrl: "https://example.com/test-delete.pdf",
      fileKey: `test-delete-${Date.now()}.pdf`,
      fileSize: 1024,
      category: "Protocol",
      uploadedBy: 1,
      createdAt: new Date(),
    });

    // Get the inserted protocol ID
    const inserted = await db
      .select()
      .from(protocols)
      .where(eq(protocols.trialId, testTrialId))
      .limit(1);

    testProtocolId = inserted[0].id;
  });

  it("should delete a document successfully", async () => {
    const caller = appRouter.createCaller({
      user: { id: "test-user", name: "Test User", email: "test@example.com", role: "user" },
    });

    // Delete the document
    const result = await caller.documents.delete({ id: testProtocolId });

    expect(result.success).toBe(true);

    // Verify document is deleted from database
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const deleted = await db
      .select()
      .from(protocols)
      .where(eq(protocols.id, testProtocolId))
      .limit(1);

    expect(deleted.length).toBe(0);
  });

  it("should return error for non-existent document", async () => {
    const caller = appRouter.createCaller({
      user: { id: "test-user", name: "Test User", email: "test@example.com", role: "user" },
    });

    // Try to delete non-existent document
    await expect(
      caller.documents.delete({ id: 999999 })
    ).rejects.toThrow("Document not found");
  });

  it("should delete associated File Search document records", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Create another test protocol
    await db.insert(protocols).values({
      trialId: testTrialId,
      filename: "test-with-filesearch.pdf",
      fileUrl: "https://example.com/test-with-filesearch.pdf",
      fileKey: `test-with-filesearch-${Date.now()}.pdf`,
      fileSize: 2048,
      category: "Protocol",
      uploadedBy: 1,
      createdAt: new Date(),
    });

    const inserted = await db
      .select()
      .from(protocols)
      .where(eq(protocols.filename, "test-with-filesearch.pdf"))
      .limit(1);

    const protocolId = inserted[0].id;

    // Create a File Search Store
    await db.insert(fileSearchStores).values({
      trialId: testTrialId,
      storeName: `test-store-${Date.now()}`,
      displayName: "Test Store",
    });

    const store = await db
      .select()
      .from(fileSearchStores)
      .where(eq(fileSearchStores.trialId, testTrialId))
      .limit(1);

    // Create a File Search document record
    await db.insert(fileSearchDocuments).values({
      storeId: store[0].id,
      protocolId: protocolId,
      documentName: "test-doc-name",
      displayName: "test-with-filesearch.pdf",
    });

    // Delete the protocol
    const caller = appRouter.createCaller({
      user: { id: "test-user", name: "Test User", email: "test@example.com", role: "user" },
    });

    await caller.documents.delete({ id: protocolId });

    // Verify File Search document record is also deleted
    const fileSearchDoc = await db
      .select()
      .from(fileSearchDocuments)
      .where(eq(fileSearchDocuments.protocolId, protocolId))
      .limit(1);

    expect(fileSearchDoc.length).toBe(0);
  });
});
