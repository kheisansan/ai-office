/** Validate URLs before passing to yt-dlp or storing as ingest targets. */

import dns from "node:dns/promises";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
]);

const SSRF_HELPER_SUFFIXES = [
  ".nip.io",
  ".sslip.io",
  ".localtest.me",
  ".lvh.me",
];

const YOUTUBE_HOSTS = new Set([
  "youtu.be",
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export type LookupFn = (hostname: string) => Promise<string[]>;

export type SafeHttpUrl = {
  href: string;
  hostname: string;
};

function normalizeHostname(hostname: string): string {
  let h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  while (h.endsWith(".")) h = h.slice(0, -1);
  return h;
}

function isPrivateIpv4Parts(a: number[]): boolean {
  if (a.length !== 4 || a.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  if (a[0] === 10) return true;
  if (a[0] === 127) return true;
  if (a[0] === 169 && a[1] === 254) return true;
  if (a[0] === 172 && a[1] >= 16 && a[1] <= 31) return true;
  if (a[0] === 192 && a[1] === 168) return true;
  if (a[0] === 0) return true;
  return false;
}

/** ::ffff:127.0.0.1 / ::ffff:7f00:1 / ::ffff:0:7f00:1 / ::127.0.0.1 / ::7f00:1 */
function parseEmbeddedIpv4(h: string): number[] | null {
  const patterns = [
    /^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i,
    /^::ffff:0:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i,
    /^::(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i,
  ];
  for (const re of patterns) {
    const m = re.exec(h);
    if (m) return m.slice(1).map(Number);
  }
  const hexPatterns = [
    /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i,
    /^::ffff:0:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i,
    /^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i,
  ];
  for (const re of hexPatterns) {
    const m = re.exec(h);
    if (!m) continue;
    const hi = parseInt(m[1], 16);
    const lo = parseInt(m[2], 16);
    return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
  }
  return null;
}

export function isPrivateOrLocalHostname(hostname: string): boolean {
  const h = normalizeHostname(hostname);
  if (!h) return true;
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (SSRF_HELPER_SUFFIXES.some((s) => h === s.slice(1) || h.endsWith(s))) return true;

  const embedded = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\./.exec(h);
  if (embedded && isPrivateIpv4Parts(embedded.slice(1).map(Number))) return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) return isPrivateIpv4Parts(v4.slice(1).map(Number));

  const mapped = parseEmbeddedIpv4(h);
  if (mapped) return isPrivateIpv4Parts(mapped);

  if (h.includes(":")) {
    if (h === "::" || h === "0:0:0:0:0:0:0:0" || h === "0:0:0:0:0:0:0:1") return true;
    if (/^f[cd][0-9a-f]{0,2}:/i.test(h) || /^fe[89ab][0-9a-f]:/i.test(h)) return true;
  }
  return false;
}

function isIpLiteral(hostname: string): boolean {
  const h = normalizeHostname(hostname);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (h.includes(":")) return true;
  return false;
}

function isYoutubeHost(hostname: string): boolean {
  const h = normalizeHostname(hostname);
  if (YOUTUBE_HOSTS.has(h)) return true;
  return h.endsWith(".youtube.com") || h.endsWith(".youtube-nocookie.com");
}

async function defaultLookup(hostname: string): Promise<string[]> {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
}

/**
 * Sync literal checks only (no DNS). Prefer assertSafeHttpUrl for ingest.
 */
export function assertSafeHttpUrlLiteral(raw: string): SafeHttpUrl {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) throw new Error("url required");
  if (trimmed.startsWith("-")) throw new Error("url must not start with -");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("invalid url");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("url must be http or https");
  }
  if (!parsed.hostname) throw new Error("url hostname required");
  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) throw new Error("url hostname required");
  if (isPrivateOrLocalHostname(hostname)) {
    throw new Error("url host is not allowed");
  }
  parsed.hostname = hostname;
  return { href: parsed.href, hostname };
}

/**
 * Accept only http(s) URLs that are not option-like, not local/private (literal + DNS).
 */
export async function assertSafeHttpUrl(
  raw: string,
  opts: { lookup?: LookupFn } = {},
): Promise<SafeHttpUrl> {
  const literal = assertSafeHttpUrlLiteral(raw);
  if (isIpLiteral(literal.hostname)) return literal;
  let addrs: string[];
  try {
    addrs = await (opts.lookup ?? defaultLookup)(literal.hostname);
  } catch {
    throw new Error("url host could not be resolved");
  }
  if (!addrs.length) throw new Error("url host could not be resolved");
  for (const addr of addrs) {
    if (isPrivateOrLocalHostname(addr)) {
      throw new Error("url host is not allowed");
    }
  }
  return literal;
}

/**
 * Ingest targets for yt-dlp: safe URL + YouTube host allowlist
 * (blocks open-redirect SSRF via arbitrary public origins).
 */
export async function assertSafeIngestUrl(
  raw: string,
  opts: { lookup?: LookupFn } = {},
): Promise<SafeHttpUrl> {
  const safe = await assertSafeHttpUrl(raw, opts);
  if (!isYoutubeHost(safe.hostname)) {
    throw new Error("url host must be YouTube (youtube.com / youtu.be)");
  }
  return safe;
}
