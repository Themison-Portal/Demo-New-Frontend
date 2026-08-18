import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

function loadEnvOnce() {
  const cwdEnvPath = path.resolve(process.cwd(), ".env");
  const fileEnvPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.env"
  );
  const envPath = fs.existsSync(cwdEnvPath)
    ? cwdEnvPath
    : fs.existsSync(fileEnvPath)
      ? fileEnvPath
      : undefined;

  loadEnv(envPath ? { path: envPath } : undefined);
}

function redactDatabaseUrl(rawUrl: string) {
  const parsed = new URL(rawUrl);
  const password = parsed.password ? "********" : "";
  const username = parsed.username ? `${parsed.username}${password ? ":" : ""}` : "";
  const auth = username || password ? `${username}${password}@` : "";
  return `${parsed.protocol}//${auth}${parsed.hostname}:${parsed.port}${parsed.pathname}`;
}

async function tableExists(sql: postgres.Sql, tableName: string) {
  const rows = await sql`
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = ${tableName}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function summarizeTable(
  sql: postgres.Sql,
  tableName: string,
  updatedAtColumn = "updatedAt"
) {
  if (!(await tableExists(sql, tableName))) {
    return { table: tableName, exists: false as const };
  }

  try {
    const rows = await sql.unsafe(
      `SELECT COUNT(*)::int AS "rowCount", MAX("${updatedAtColumn}") AS "latestUpdatedAt" FROM "bff"."${tableName}"`
    );
    const row = rows[0] ?? {};
    return {
      table: tableName,
      exists: true as const,
      rowCount: Number(row.rowCount ?? 0),
      latestUpdatedAt: row.latestUpdatedAt ?? null,
    };
  } catch {
    return { table: tableName, exists: false as const };
  }
}

async function main() {
  loadEnvOnce();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const parsed = new URL(databaseUrl);
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    const databaseRows = await sql`SELECT current_database() AS "databaseName", version() AS version`;
    const databaseInfo = databaseRows[0] ?? {};

    const summaries = await Promise.all([
      summarizeTable(sql, "users"),
      summarizeTable(sql, "trials"),
      summarizeTable(sql, "protocols"),
      summarizeTable(sql, "taskScaffolds"),
      summarizeTable(sql, "tasks"),
      summarizeTable(sql, "telemetry_events"),
    ]);

    const output = {
      connectedTo: {
        host: parsed.hostname,
        port: parsed.port || "5432",
        database: parsed.pathname.replace(/^\//, ""),
        redactedUrl: redactDatabaseUrl(databaseUrl),
      },
      serverReported: {
        databaseName: databaseInfo.databaseName ?? null,
        version: databaseInfo.version ?? null,
      },
      tables: summaries,
    };

    console.log(JSON.stringify(output, null, 2));
  } finally {
    await sql.end();
  }
}

void main().catch((error) => {
  console.error("[db-fingerprint] Failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
