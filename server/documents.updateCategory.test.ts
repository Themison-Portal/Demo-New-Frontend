import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "./db";
import { protocols } from "../drizzle/schema";
import { eq } from "drizzle-orm";

describe("Update Document Category", () => {
  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
  });

  it("should update document category successfully", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Create a test document
    await db.insert(protocols).values({
      trialId: "test-trial-update",
      filename: "test-category-update.pdf",
      fileUrl: "https://example.com/test.pdf",
      fileKey: "test-key",
      fileSize: 1000,
      category: "Protocol",
      uploadedBy: 1,
    });

    // Get the inserted document
    const inserted = await db
      .select()
      .from(protocols)
      .where(eq(protocols.filename, "test-category-update.pdf"))
      .limit(1);

    expect(inserted.length).toBe(1);
    const insertedId = inserted[0].id;

    // Verify initial category
    let doc = await db
      .select()
      .from(protocols)
      .where(eq(protocols.id, insertedId))
      .limit(1);

    expect(doc.length).toBe(1);
    expect(doc[0].category).toBe("Protocol");

    // Update category
    await db
      .update(protocols)
      .set({ category: "Lab Manual" })
      .where(eq(protocols.id, insertedId));

    // Verify category was updated
    doc = await db
      .select()
      .from(protocols)
      .where(eq(protocols.id, insertedId))
      .limit(1);

    expect(doc.length).toBe(1);
    expect(doc[0].category).toBe("Lab Manual");

    // Cleanup
    await db.delete(protocols).where(eq(protocols.id, insertedId));
  });

  it("should handle updating to custom category", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Create a test document
    await db.insert(protocols).values({
      trialId: "test-trial-custom",
      filename: "test-custom-category.pdf",
      fileUrl: "https://example.com/test.pdf",
      fileKey: "test-key",
      fileSize: 1000,
      category: "Protocol",
      uploadedBy: 1,
    });

    // Get the inserted document
    const inserted = await db
      .select()
      .from(protocols)
      .where(eq(protocols.filename, "test-custom-category.pdf"))
      .limit(1);

    expect(inserted.length).toBe(1);
    const insertedId = inserted[0].id;

    // Update to custom category
    const customCategory = `Custom Category ${Date.now()}`;
    await db
      .update(protocols)
      .set({ category: customCategory })
      .where(eq(protocols.id, insertedId));

    // Verify category was updated
    const doc = await db
      .select()
      .from(protocols)
      .where(eq(protocols.id, insertedId))
      .limit(1);

    expect(doc.length).toBe(1);
    expect(doc[0].category).toBe(customCategory);

    // Cleanup
    await db.delete(protocols).where(eq(protocols.id, insertedId));
  });
});
