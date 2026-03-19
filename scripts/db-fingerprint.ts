import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import mysql from "mysql2/promise";

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

async function tableExists(connection: mysql.Connection, tableName: string) {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?
      LIMIT 1
    `,
    [tableName]
  );
  return rows.length > 0;
}

async function summarizeTable(
  connection: mysql.Connection,
  tableName: string,
  updatedAtColumn = "updatedAt"
) {
  if (!(await tableExists(connection, tableName))) {
    return { table: tableName, exists: false as const };
  }

  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS rowCount, MAX(\`${updatedAtColumn}\`) AS latestUpdatedAt FROM \`${tableName}\``
  );
  const row = rows[0] ?? {};
  return {
    table: tableName,
    exists: true as const,
    rowCount: Number(row.rowCount ?? 0),
    latestUpdatedAt: row.latestUpdatedAt ?? null,
  };
}

async function summarizeTrialModes(connection: mysql.Connection) {
  if (!(await tableExists(connection, "trials"))) {
    return null;
  }

  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `
      SELECT
        CASE
          WHEN id LIKE 'sample:%' THEN 'sample'
          WHEN id LIKE 'full:%' THEN 'full'
          WHEN id LIKE 'building:%' THEN 'building'
          ELSE 'unprefixed'
        END AS mode,
        COUNT(*) AS rowCount
      FROM \`trials\`
      GROUP BY 1
      ORDER BY 1
    `
  );

  return rows.map((row) => ({
    mode: String(row.mode ?? ""),
    rowCount: Number(row.rowCount ?? 0),
  }));
}

async function main() {
  loadEnvOnce();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const parsed = new URL(databaseUrl);
  const connection = await mysql.createConnection(databaseUrl);

  try {
    const [databaseRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT DATABASE() AS databaseName, @@version AS version"
    );
    const databaseInfo = databaseRows[0] ?? {};

    const summaries = await Promise.all([
      summarizeTable(connection, "users"),
      summarizeTable(connection, "trials"),
      summarizeTable(connection, "protocols"),
      summarizeTable(connection, "taskScaffolds"),
      summarizeTable(connection, "tasks"),
      summarizeTable(connection, "telemetryEvents"),
    ]);
    const trialModes = await summarizeTrialModes(connection);

    const [recentTrialRows] = await connection.query<mysql.RowDataPacket[]>(
      `
        SELECT id, title, updatedAt
        FROM \`trials\`
        ORDER BY updatedAt DESC
        LIMIT 5
      `
    ).catch(() => [[] as mysql.RowDataPacket[]]);

    const output = {
      connectedTo: {
        host: parsed.hostname,
        port: parsed.port || "3306",
        database: parsed.pathname.replace(/^\//, ""),
        redactedUrl: redactDatabaseUrl(databaseUrl),
      },
      serverReported: {
        databaseName: databaseInfo.databaseName ?? null,
        version: databaseInfo.version ?? null,
      },
      tables: summaries,
      trialModes,
      recentTrials: Array.isArray(recentTrialRows)
        ? recentTrialRows.map((row) => ({
            id: row.id ?? null,
            title: row.title ?? null,
            updatedAt: row.updatedAt ?? null,
          }))
        : [],
    };

    console.log(JSON.stringify(output, null, 2));
  } finally {
    await connection.end();
  }
}

void main().catch((error) => {
  console.error("[db-fingerprint] Failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
