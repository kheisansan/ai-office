import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeJson, writeText } from "../lib/fsutil.js";
import { assertSafeIngestUrl } from "../lib/safe-url.js";

export type FetchInput = {
  jobDir: string;
  url: string;
  ytDlpPath?: string;
  /** Use fixture text instead of yt-dlp (tests / offline) */
  fixtureTranscript?: string;
  fixtureTitle?: string;
  fixtureDescription?: string;
  /** Explicitly keep/use existing raw/transcript.txt */
  manualTranscript?: boolean;
};

export type FetchResult = {
  rawDir: string;
  title: string;
  transcriptPath: string;
  metadataPath: string;
  mode: "yt-dlp" | "fixture" | "manual";
};

function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stripVtt(content: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (
      t === "WEBVTT" ||
      t.startsWith("NOTE") ||
      t.startsWith("Kind:") ||
      t.startsWith("Language:")
    ) {
      continue;
    }
    if (/^\d+$/.test(t)) continue;
    if (/^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+/.test(t)) continue;
    if (/^[\d:,.\s\-→>]+$/.test(t)) continue;
    out.push(t.replace(/<[^>]+>/g, ""));
  }
  return out.join("\n");
}

function findSubtitleFile(rawDir: string): string | undefined {
  const files = fs.readdirSync(rawDir);
  const rank = (name: string): number => {
    if (/\.ko(-orig)?\.(vtt|srt)$/i.test(name)) return 0;
    if (/\.ja(-orig)?\.(vtt|srt)$/i.test(name)) return 1;
    if (/\.en(-orig)?\.(vtt|srt)$/i.test(name)) return 2;
    if (/\.(vtt|srt)$/i.test(name)) return 3;
    return 99;
  };
  const subs = files
    .filter((f) => /\.(vtt|srt)$/i.test(f))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return subs[0] ? path.join(rawDir, subs[0]) : undefined;
}

function pickSubtitleLangs(meta: {
  subtitles?: Record<string, unknown>;
  automatic_captions?: Record<string, unknown>;
}): string[] {
  const manual = Object.keys(meta.subtitles ?? {});
  const auto = Object.keys(meta.automatic_captions ?? {});
  const available = new Set([...manual, ...auto]);
  const preferred = [
    "ko",
    "ko-orig",
    "ja",
    "ja-orig",
    "en",
    "en-orig",
    "en-US",
    "en-GB",
  ];
  const ordered: string[] = [];
  for (const lang of preferred) {
    if (available.has(lang)) ordered.push(lang);
  }
  // also match prefixes like ko-KR
  for (const lang of available) {
    if (/^(ko|ja|en)/i.test(lang) && !ordered.includes(lang)) ordered.push(lang);
  }
  return ordered.length > 0 ? ordered : ["ko", "ja", "en"];
}

async function downloadOneLang(
  ytDlp: string,
  url: string,
  rawDir: string,
  outTemplate: string,
  lang: string,
): Promise<boolean> {
  const subArgs = [
    "--ignore-config",
    "--skip-download",
    "--no-warnings",
    "--no-playlist",
    "--write-auto-subs",
    "--write-subs",
    "--sub-langs",
    lang,
    "--sub-format",
    "vtt/srt/best",
    "-o",
    outTemplate,
    "--",
    url,
  ];
  const result = await runCommand(ytDlp, subArgs, rawDir);
  if (findSubtitleFile(rawDir)) return true;
  if (/429/.test(result.stderr) || /Too Many Requests/i.test(result.stderr)) {
    await sleep(2500);
    const retry = await runCommand(ytDlp, subArgs, rawDir);
    if (findSubtitleFile(rawDir)) return true;
    if (retry.code !== 0) return false;
  }
  return result.code === 0 && Boolean(findSubtitleFile(rawDir));
}

async function fetchWithYtDlp(
  input: FetchInput,
  rawDir: string,
): Promise<FetchResult> {
  const safe = await assertSafeIngestUrl(input.url);
  const ytDlp = input.ytDlpPath ?? "yt-dlp";
  const outTemplate = path.join(rawDir, "source");

  const metaResult = await runCommand(
    ytDlp,
    [
      "--ignore-config",
      "--skip-download",
      "--no-warnings",
      "--no-playlist",
      "-J",
      "--",
      safe.href,
    ],
    rawDir,
  );
  if (metaResult.code !== 0) {
    throw new Error(
      `yt-dlp metadata failed (is yt-dlp installed?): ${metaResult.stderr || metaResult.stdout}`,
    );
  }
  const meta = JSON.parse(metaResult.stdout) as {
    title?: string;
    description?: string;
    duration?: number;
    chapters?: Array<{ title?: string; start_time?: number }>;
    id?: string;
    webpage_url?: string;
    subtitles?: Record<string, unknown>;
    automatic_captions?: Record<string, unknown>;
  };

  const langs = pickSubtitleLangs(meta);
  let downloaded = false;
  const errors: string[] = [];
  for (const lang of langs) {
    const ok = await downloadOneLang(ytDlp, safe.href, rawDir, outTemplate, lang);
    if (ok) {
      downloaded = true;
      break;
    }
    errors.push(lang);
    await sleep(1500);
  }

  const subFile = findSubtitleFile(rawDir);
  if (!downloaded || !subFile) {
    throw new Error(
      `yt-dlp subtitle failed for langs [${langs.join(", ")}]. Tried: ${errors.join(", ") || "none"}. Put text in raw/transcript.txt and use --manual-transcript.`,
    );
  }

  const raw = fs.readFileSync(subFile, "utf8");
  const transcript = subFile.endsWith(".vtt") ? stripVtt(raw) : raw;
  if (!transcript.trim()) {
    throw new Error(
      "No captions found. Put text in raw/transcript.txt manually and re-run with --manual-transcript, or pick another URL.",
    );
  }

  const title = meta.title ?? "Untitled source";
  const description = meta.description ?? "";
  writeText(path.join(rawDir, "description.txt"), `${description}\n`);
  const transcriptPath = path.join(rawDir, "transcript.txt");
  writeText(transcriptPath, `${transcript}\n`);
  const metadataPath = path.join(rawDir, "metadata.json");
  writeJson(metadataPath, {
    url: safe.href,
    title,
    id: meta.id,
    duration: meta.duration,
    chapters: meta.chapters ?? [],
    webpage_url: meta.webpage_url ?? safe.href,
    fetchedAt: new Date().toISOString(),
    mode: "yt-dlp",
    subtitleFile: path.basename(subFile),
    subtitleLangsTried: langs,
  });

  return {
    rawDir,
    title,
    transcriptPath,
    metadataPath,
    mode: "yt-dlp",
  };
}

/**
 * Fetch captions / metadata.
 * - fixture*: tests / dry-run
 * - otherwise yt-dlp (captions + description, no video body)
 */
export async function fetchSource(input: FetchInput): Promise<FetchResult> {
  const rawDir = path.join(input.jobDir, "raw");
  ensureDir(rawDir);

  if (input.fixtureTranscript !== undefined || input.fixtureTitle !== undefined) {
    const title = input.fixtureTitle ?? "Untitled source";
    const transcript =
      input.fixtureTranscript ??
      [
        "00:00 Intro",
        "AI office combines agents, files, and human approval.",
        "01:00 Roles should be narrow.",
        "Pass state via files. Keep agents few.",
      ].join("\n");
    const transcriptPath = path.join(rawDir, "transcript.txt");
    const metadataPath = path.join(rawDir, "metadata.json");
    writeText(transcriptPath, `${transcript}\n`);
    writeText(
      path.join(rawDir, "description.txt"),
      `${input.fixtureDescription ?? ""}\n`,
    );
    writeJson(metadataPath, {
      url: input.url,
      title,
      fetchedAt: new Date().toISOString(),
      mode: "fixture",
    });
    return { rawDir, title, transcriptPath, metadataPath, mode: "fixture" };
  }

  if (input.manualTranscript) {
    const existing = path.join(rawDir, "transcript.txt");
    if (!fs.existsSync(existing) || fs.statSync(existing).size === 0) {
      throw new Error("manualTranscript=true but raw/transcript.txt is missing/empty");
    }
    const metadataPath = path.join(rawDir, "metadata.json");
    if (!fs.existsSync(metadataPath)) {
      writeJson(metadataPath, {
        url: input.url,
        title: "Manual transcript",
        fetchedAt: new Date().toISOString(),
        mode: "manual",
      });
    }
    const meta = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as {
      title?: string;
    };
    return {
      rawDir,
      title: meta.title ?? "Manual transcript",
      transcriptPath: existing,
      metadataPath,
      mode: "manual",
    };
  }

  return fetchWithYtDlp(input, rawDir);
}
