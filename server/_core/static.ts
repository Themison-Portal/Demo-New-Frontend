import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname =
    import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));

export function serveStatic(app: Express) {
    const rootDist = path.resolve(__dirname, "../..", "dist", "public");
    const localDist = path.resolve(__dirname, "public");
    const distPath = fs.existsSync(rootDist) ? rootDist : localDist;
    if (!fs.existsSync(distPath)) {
        console.error(
            `Could not find the build directory: ${distPath}, make sure to build the client first`
        );
    }

    app.use(express.static(distPath));

    app.use("*", (req, res, next) => {
        if (req.originalUrl.startsWith("/api/be")) {
            return next();
        }
        res.sendFile(path.resolve(distPath, "index.html"));
    });
}
