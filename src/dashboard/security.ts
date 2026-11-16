import type { NextFunction, Request, Response } from "express";

function isLocalHostHeader(host: string): boolean {
  const h = host.trim().toLowerCase();
  return (
    h === "127.0.0.1" ||
    h.startsWith("127.0.0.1:") ||
    h === "localhost" ||
    h.startsWith("localhost:")
  );
}

function originMatchesLocalHost(origin: string, host: string): boolean {
  try {
    const o = new URL(origin);
    if (o.protocol !== "http:" && o.protocol !== "https:") return false;
    const hostName = host.split(":")[0]?.toLowerCase() ?? "";
    const hostPort = host.includes(":") ? host.split(":").slice(1).join(":") : "";
    const oPort = o.port || (o.protocol === "https:" ? "443" : "80");
    if (hostPort && oPort !== hostPort) return false;
    if (!hostPort && o.port && o.port !== "80" && o.port !== "443") return false;
    const local = new Set(["127.0.0.1", "localhost"]);
    return local.has(hostName) && local.has(o.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Host/Origin checks + hardening headers for the local dashboard. */
export function dashboardSecurityMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
    ].join("; "),
  );

  const host = String(req.headers.host ?? "");
  if (!isLocalHostHeader(host)) {
    res.status(403).json({ ok: false, error: "forbidden host" });
    return;
  }

  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = req.headers.origin ? String(req.headers.origin) : "";
    if (origin && !originMatchesLocalHost(origin, host)) {
      res.status(403).json({ ok: false, error: "forbidden origin" });
      return;
    }
    const onApi =
      req.path.startsWith("/api") ||
      req.baseUrl.startsWith("/api") ||
      req.originalUrl.startsWith("/api");
    if (onApi) {
      const ct = String(req.headers["content-type"] ?? "");
      if (!ct.toLowerCase().includes("application/json")) {
        res.status(415).json({ ok: false, error: "Content-Type must be application/json" });
        return;
      }
    }
  }

  next();
}
