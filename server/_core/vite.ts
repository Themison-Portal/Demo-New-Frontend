import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

export async function setupVite(app: Express, server: Server) {
    const serverOptions = {
        middlewareMode: true,
        hmr: { server },
        allowedHosts: true as const,
        // Avoid stale UI bundles across browsers in local dev.
        headers: {
            "Cache-Control": "no-store, max-age=0",
            Pragma: "no-cache",
            Expires: "0",
        },
    };

    const vite = await createViteServer({
        ...viteConfig,
        configFile: false,
        server: serverOptions,
        appType: "custom",
    });

    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
        // skip proxy routes — let Vite handle them
        if (req.originalUrl.startsWith("/api/be")) {
            return next();
        }
        const url = req.originalUrl;

        try {
            const clientTemplate = path.resolve(
                import.meta.dirname,
                "../..",
                "client",
                "index.html"
            );

            // always reload the index.html file from disk incase it changes
            let template = await fs.promises.readFile(clientTemplate, "utf-8");
            template = template.replace(
                `src="/src/main.tsx"`,
                `src="/src/main.tsx?v=${nanoid()}"`
            );
            const page = await vite.transformIndexHtml(url, template);
            res
                .status(200)
                .set({
                    "Content-Type": "text/html",
                    "Cache-Control": "no-store, max-age=0",
                    Pragma: "no-cache",
                    Expires: "0",
                })
                .end(page);
        } catch (e) {
            vite.ssrFixStacktrace(e as Error);
            next(e);
        }
    });
}

export function serveStatic(app: Express) {
    const distPath =
        process.env.NODE_ENV === "development"
            ? path.resolve(import.meta.dirname, "../..", "dist", "public")
            : path.resolve(import.meta.dirname, "public");
    if (!fs.existsSync(distPath)) {
        console.error(
            `Could not find the build directory: ${distPath}, make sure to build the client first`
        );
    }

    app.use(express.static(distPath));

    // fall through to index.html if the file doesn't exist
    app.use("*", (_req, res) => {
        res.sendFile(path.resolve(distPath, "index.html"));
    });
}
