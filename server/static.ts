import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}. Run 'npm run build' first.`,
    );
  }

  app.use(express.static(distPath));

  // SPA fallback: any unmatched route returns index.html (graceful root for
  // logged-out visitors — they get the login page, not a raw 401). Spec §2,
  // kickoff "graceful root."
  app.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
