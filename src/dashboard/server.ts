import express from "express";
import path from "node:path";
import type { Server } from "node:http";
import type { OfficeConfig } from "../lib/config.js";
import { REPO_ROOT } from "../lib/paths.js";
import { createDashboardRouter } from "./routes.js";
import { dashboardSecurityMiddleware } from "./security.js";

export type ServeOptions = {
  config: OfficeConfig;
  port?: number;
  host?: string;
};

export function createDashboardApp(config: OfficeConfig) {
  const app = express();
  app.use(dashboardSecurityMiddleware);
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", createDashboardRouter({ config }));
  const publicDir = path.join(REPO_ROOT, "dashboard", "public");
  app.use(express.static(publicDir));
  return app;
}

export async function startDashboardServer(
  options: ServeOptions,
): Promise<{ server: Server; url: string; port: number }> {
  const port = options.port ?? 3847;
  const host = options.host ?? "127.0.0.1";
  const app = createDashboardApp(options.config);
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(port, host, () => resolve(s));
    s.on("error", reject);
  });
  return { server, url: `http://${host}:${port}`, port };
}
