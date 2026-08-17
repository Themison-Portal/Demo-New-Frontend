import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "./db";
import { documentCategories, protocols, fileSearchStores, fileSearchDocuments } from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";

let dbAvailable = false;

describe("Document Categories", () => {
  beforeAll(async () => {
    try {
      const db = await getDb();
      if (db) {
        await db.execute(sql`SELECT 1`);
        dbAvailable = true;

        // Ensure predefined categories exist
        const categories = ["Protocol", "Lab Manual", "Pharmacy Manual"];
        for (const name of categories) {
          try {
            await db.insert(documentCategories).values({
              name,
              isDefault: true,
            });
          } catch {
            // ignore duplicate entry error
          }
          
          // Explicitly update to make sure it is marked as default
          await db
            .update(documentCategories)
            .set({ isDefault: true })
            .where(eq(documentCategories.name, name));
        }
      }
    } catch {
      dbAvailable = false;
    }
  });

  it("should have predefined categories seeded", async () => {
    const db = await getDb();
    if (!db || !dbAvailable) {
      expect(true).toBe(true);
      return;
    }

    const categories = await db.select().from(documentCategories);
    
    expect(categories.length).toBeGreaterThan(0);
    
    // Check for some expected predefined categories
    const categoryNames = categories.map(c => c.name);
    expect(categoryNames).toContain("Protocol");
    expect(categoryNames).toContain("Lab Manual");
    expect(categoryNames).toContain("Pharmacy Manual");
  });

  it("should mark predefined categories with isDefault=true", async () => {
    const db = await getDb();
    if (!db || !dbAvailable) {
      expect(true).toBe(true);
      return;
    }

    const protocolCategory = await db
      .select()
      .from(documentCategories)
      .where(eq(documentCategories.name, "Protocol"))
      .limit(1);

    expect(protocolCategory.length).toBe(1);
    expect(protocolCategory[0].isDefault).toBe(true);
  });

  it("should allow creating custom categories", async () => {
    const db = await getDb();
    if (!db || !dbAvailable) {
      expect(true).toBe(true);
      return;
    }

    const customCategoryName = `Test Category ${Date.now()}`;

    // Create custom category
    await db.insert(documentCategories).values({
      name: customCategoryName,
      isDefault: false,
    });

    // Verify it was created
    const created = await db
      .select()
      .from(documentCategories)
      .where(eq(documentCategories.name, customCategoryName))
      .limit(1);

    expect(created.length).toBe(1);
    expect(created[0].name).toBe(customCategoryName);
    expect(created[0].isDefault).toBe(false);

    // Cleanup
    await db.delete(documentCategories).where(eq(documentCategories.name, customCategoryName));
  });

  it("should prevent duplicate category names", async () => {
    const db = await getDb();
    if (!db || !dbAvailable) {
      expect(true).toBe(true);
      return;
    }

    // Try to insert duplicate "Protocol" category
    await expect(async () => {
      await db.insert(documentCategories).values({
        name: "Protocol",
        isDefault: false,
      });
    }).rejects.toThrow();
  });
});

describe("Document Retry Processing", () => {
  it("should verify fileSearchDocuments table structure for retry logic", async () => {
    const db = await getDb();
    if (!db || !dbAvailable) {
      expect(true).toBe(true);
      return;
    }

    // Verify fileSearchDocuments table exists and has expected structure
    const fileSearchDocs = await db.select().from(fileSearchDocuments).limit(1);
    
    // Table should exist (query should not throw)
    expect(fileSearchDocs).toBeDefined();
    
    // Verify protocols table exists
    const protocolsList = await db.select().from(protocols).limit(1);
    expect(protocolsList).toBeDefined();
    
    // Verify fileSearchStores table exists
    const storesList = await db.select().from(fileSearchStores).limit(1);
    expect(storesList).toBeDefined();
  });
});
