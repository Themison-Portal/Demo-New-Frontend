// Production-only static file serving.
//
// Kept separate from `./vite.ts` so the production server bundle never
// transitively imports the `vite` package — vite is a devDependency and
// excluding it from the prod install saves ~30 MB on the runtime image.
//
// `./vite.ts` (which imports the vite package) is only loaded via a
// dynamic import from `./index.ts` when NODE_ENV === "development".

import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  // In a built esbuild bundle, `import.meta.dirname` resolves to the
  // directory of `dist/index.js`. The vite client output lives at
  // `dist/public/` (see vite.config.ts `build.outDir`).
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

  // SPA fall-through: any unmatched route returns index.html so the
  // client-side router (wouter) can handle it.
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
