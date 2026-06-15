import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import {
    getLocalStorageRoot,
    getLocalStorageRoute,
    isUsingLocalStorage,
} from "../storage";
import { createProxyMiddleware } from "http-proxy-middleware";

function isPortAvailable(port: number): Promise<boolean> {
    return new Promise(resolve => {
        const server = net.createServer();
        server.listen(port, "0.0.0.0", () => {
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

    // // Configure body parser with larger size limit for file uploads
    // app.use(express.json({ limit: "50mb" }));
    // app.use(express.urlencoded({ limit: "50mb", extended: true }));
    // Body parser — skip for proxy routes so stream is not consumed
    app.use((req, res, next) => {
        if (req.path.startsWith("/api/be")) return next();
        express.json({ limit: "50mb" })(req, res, next);
    });
    app.use((req, res, next) => {
        if (req.path.startsWith("/api/be")) return next();
        express.urlencoded({ limit: "50mb", extended: true })(req, res, next);
    });

    // OAuth callback under /api/oauth/callback
    registerOAuthRoutes(app);

    // Local-filesystem storage fallback
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

    // development mode uses Vite, production mode uses static files
    if (process.env.NODE_ENV === "development") {
        await setupVite(app, server);
    } else {
        serveStatic(app);
    }

    // ─── Proxy /api/be/* → FastAPI BE ───────────────────────────────
    // Must be AFTER setupVite so Vite middleware does not intercept it
    app.use(
        "/api/be",
        createProxyMiddleware({
            target: "http://localhost:8080",
            changeOrigin: true,
            pathRewrite: { "^/api/be": "" },
        })
    );

    const preferredPort = parseInt(process.env.PORT || "3000");
    const port = await findAvailablePort(preferredPort);

    if (port !== preferredPort) {
        console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
    }

    server.listen(port, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${port}/`);
    });
}

startServer().catch(console.error);