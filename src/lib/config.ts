import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./paths.js";

export type AiMode = "claude" | "stub";

export type OfficeConfig = {
  vaultPath: string;
  dataDir: string;
  ingestBatchLimit: number;
  ytDlpPath: string;
  claudePath: string;
  aiMode: AiMode;
  weeklyIngestTokenBudget: number;
  weeklyAskTokenBudget: number;
  /** Where the resolved values came from (for `office config`) */
  sources: Record<string, string>;
};

type SettingsFile = {
  vaultPath?: string;
  dataDir?: string;
  ingestBatchLimit?: number;
  ytDlpPath?: string;
  claudePath?: string;
  aiMode?: AiMode;
  weeklyIngestTokenBudget?: number;
  weeklyAskTokenBudget?: number;
};

function loadDotEnv(): void {
  const envPath = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function loadSettingsFile(): SettingsFile {
  const settingsPath = path.join(REPO_ROOT, "config", "settings.json");
  if (!fs.existsSync(settingsPath)) return {};
  return JSON.parse(fs.readFileSync(settingsPath, "utf8")) as SettingsFile;
}

function pick(
  sources: Record<string, string>,
  key: string,
  envName: string,
  fromFile: string | number | undefined,
  fallback: string,
): string {
  const envVal = process.env[envName];
  if (envVal !== undefined && envVal !== "") {
    sources[key] = `env:${envName}`;
    return envVal;
  }
  if (fromFile !== undefined && String(fromFile) !== "") {
    sources[key] = "config/settings.json";
    return String(fromFile);
  }
  sources[key] = "default";
  return fallback;
}

export function loadConfig(overrides: Partial<OfficeConfig> = {}): OfficeConfig {
  loadDotEnv();
  const file = loadSettingsFile();
  const sources: Record<string, string> = {};

  const vaultPath = overrides.vaultPath ??
    pick(
      sources,
      "vaultPath",
      "VAULT_PATH",
      file.vaultPath,
      path.join(REPO_ROOT, "fixtures/sample-vault"),
    );
  const dataDir = overrides.dataDir ??
    pick(
      sources,
      "dataDir",
      "DATA_DIR",
      file.dataDir,
      path.join(REPO_ROOT, ".ai-office-data"),
    );
  const ingestBatchLimit = overrides.ingestBatchLimit ??
    Number(
      pick(
        sources,
        "ingestBatchLimit",
        "INGEST_BATCH_LIMIT",
        file.ingestBatchLimit,
        "3",
      ),
    );
  const ytDlpPath = overrides.ytDlpPath ??
    pick(sources, "ytDlpPath", "YT_DLP_PATH", file.ytDlpPath, "yt-dlp");
  const claudePath = overrides.claudePath ??
    pick(sources, "claudePath", "CLAUDE_PATH", file.claudePath, "claude");
  const aiModeRaw = overrides.aiMode ??
    pick(sources, "aiMode", "AI_MODE", file.aiMode, "claude");
  const aiMode: AiMode = aiModeRaw === "stub" ? "stub" : "claude";
  const weeklyIngestTokenBudget = overrides.weeklyIngestTokenBudget ??
    Number(
      pick(
        sources,
        "weeklyIngestTokenBudget",
        "WEEKLY_INGEST_TOKEN_BUDGET",
        file.weeklyIngestTokenBudget,
        "0",
      ),
    );
  const weeklyAskTokenBudget = overrides.weeklyAskTokenBudget ??
    Number(
      pick(
        sources,
        "weeklyAskTokenBudget",
        "WEEKLY_ASK_TOKEN_BUDGET",
        file.weeklyAskTokenBudget,
        "0",
      ),
    );

  if (overrides.vaultPath) sources.vaultPath = "override";
  if (overrides.dataDir) sources.dataDir = "override";

  return {
    vaultPath: path.resolve(vaultPath),
    dataDir: path.resolve(dataDir),
    ingestBatchLimit,
    ytDlpPath,
    claudePath,
    aiMode,
    weeklyIngestTokenBudget,
    weeklyAskTokenBudget,
    sources,
  };
}

export function assertVaultReady(config: OfficeConfig): void {
  if (!fs.existsSync(config.vaultPath)) {
    throw new Error(
      `Vault not found: ${config.vaultPath}\nSet VAULT_PATH or config/settings.json vaultPath (see config/settings.example.json).`,
    );
  }
}

function settingsFilePath(): string {
  return path.join(REPO_ROOT, "config", "settings.json");
}

/** Validate and persist vaultPath to settings.json; mutates live config. */
export function setVaultPath(config: OfficeConfig, rawPath: string): {
  vaultPath: string;
  hasWiki: boolean;
} {
  const trimmed = rawPath.trim();
  if (!trimmed) throw new Error("vaultPath required");
  const resolved = path.resolve(trimmed);
  if (resolved.split(path.sep).some((p) => p.toLowerCase() === "openclaw")) {
    throw new Error(`Refusing path containing OpenClaw: ${resolved}`);
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Vault directory not found: ${resolved}`);
  }
  const hasWiki = fs.existsSync(path.join(resolved, "Wiki"));
  const filePath = settingsFilePath();
  const current: SettingsFile = fs.existsSync(filePath)
    ? (JSON.parse(fs.readFileSync(filePath, "utf8")) as SettingsFile)
    : {};
  const next: SettingsFile = { ...current, vaultPath: resolved };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  config.vaultPath = resolved;
  config.sources = { ...config.sources, vaultPath: "config/settings.json" };
  return { vaultPath: resolved, hasWiki };
}
