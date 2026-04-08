import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";

let didLoadEnv = false;
const loadEnvOnce = () => {
    if (didLoadEnv) return;
    didLoadEnv = true;

    // Load .env from project root even if the process cwd is different.
    const cwdEnvPath = path.resolve(process.cwd(), ".env");
    const fileEnvPath = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../.env"
    );
    const envPath = fs.existsSync(cwdEnvPath)
        ? cwdEnvPath
        : fs.existsSync(fileEnvPath)
            ? fileEnvPath
            : undefined;

    loadEnv(envPath ? { path: envPath } : undefined);
};

loadEnvOnce();

const openaiApiKey = process.env.OPENAI_API_KEY ?? "";
const ragProviderRaw = (process.env.RAG_PROVIDER ?? "internal").trim().toLowerCase();
const ragProvider = ragProviderRaw === "external" ? "external" : "internal";
const externalRagTimeoutMsRaw = Number.parseInt(
    process.env.EXTERNAL_RAG_TIMEOUT_MS ?? "15000",
    10
);
const externalRagTimeoutMs = Number.isFinite(externalRagTimeoutMsRaw)
    ? externalRagTimeoutMsRaw
    : 15000;

if (process.env.NODE_ENV === "development") {
    console.log(
        `[Env] OPENAI_API_KEY ${openaiApiKey ? "loaded" : "missing"} (length: ${openaiApiKey.length})`
    );
    console.log(
        `[Env] OPENAI_MODEL ${process.env.OPENAI_MODEL ?? "gpt-4o-mini"}`
    );
    console.log(`[Env] RAG_PROVIDER ${ragProvider}`);
}

export const ENV = {
    appId: process.env.VITE_APP_ID ?? "",
    cookieSecret: process.env.JWT_SECRET ?? "",
    databaseUrl: process.env.DATABASE_URL ?? "",
    oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
    ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
    isProduction: process.env.NODE_ENV === "production",
    forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
    forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
    geminiApiKey: process.env.GEMINI_API_KEY ?? "",
    openaiApiKey,
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    forceOpenAIDirect: /^(1|true|yes)$/i.test(process.env.FORCE_OPENAI_DIRECT ?? ""),
    ragProvider,
    //   externalRagApiUrl: process.env.EXTERNAL_RAG_API_URL ?? "",
    externalRagApiUrl: process.env.EXTERNAL_RAG_API_CLOUD_URL ?? "",
    externalRagApiKey: process.env.EXTERNAL_RAG_API_KEY ?? "",
    externalRagTimeoutMs,
};
