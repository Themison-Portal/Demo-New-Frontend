import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./serveStatic";
import {
  getLocalStorageRoot,
  getLocalStorageRoute,
  isUsingLocalStorage,
} from "../storage";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // Local-filesystem storage fallback (active when BUILT_IN_FORGE_*
  // env vars aren't set). Serves files written by `storagePut` from
  // `LOCAL_STORAGE_ROOT` so `extractPdfText(url)` and similar consumers
  // can fetch them via HTTP. No-op when the Manus Forge proxy is in use.
  if (isUsingLocalStorage()) {
    app.use(getLocalStorageRoute(), express.static(getLocalStorageRoot()));
    console.log(
      `[Storage] Local-filesystem fallback active — serving ${getLocalStorageRoot()} at ${getLocalStorageRoute()}`
    );
  }
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite (HMR + middleware), production mode serves
  // the prebuilt static client bundle. The vite import path is a runtime
  // variable so esbuild (which we use to bundle the prod server) does NOT
  // statically resolve it — vite.ts and vite.config.ts stay out of the
  // production bundle, and the prod runtime never needs the vite package.
  if (process.env.NODE_ENV === "development") {
    const devModulePath = "./vite";
    const devModule = await import(/* @vite-ignore */ devModulePath);
    await devModule.setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
