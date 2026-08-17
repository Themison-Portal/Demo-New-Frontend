import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { protocols } from "../drizzle/schema.ts";
import "dotenv/config";

const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client);

async function seed() {
  console.log("Seeding protocols...");

  try {
    // Insert sample protocol
    await db.insert(protocols).values({
      trialId: 1,
      filename: "Protocol_Diabetes_Tirzepatide.pdf",
      fileUrl: "https://example.com/protocols/diabetes-tirzepatide.pdf",
      fileKey: "protocols/diabetes-tirzepatide.pdf",
      uploadedAt: new Date(),
      uploadedBy: 1,
    });

    console.log("✅ Seed data inserted successfully!");
  } catch (error) {
    console.error("❌ Error seeding data:", error);
    process.exit(1);
  }

  process.exit(0);
}

seed();
