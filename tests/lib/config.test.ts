import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/lib/config.js";
import { REPO_ROOT } from "../../src/lib/paths.js";

const prevVault = process.env.VAULT_PATH;
const prevMode = process.env.AI_MODE;
const prevData = process.env.DATA_DIR;
const settingsPath = path.join(REPO_ROOT, "config", "settings.json");

afterEach(() => {
  if (prevVault === undefined) delete process.env.VAULT_PATH;
  else process.env.VAULT_PATH = prevVault;
  if (prevMode === undefined) delete process.env.AI_MODE;
  else process.env.AI_MODE = prevMode;
  if (prevData === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevData;
});

function withTempSettings(body: Record<string, unknown>, fn: () => void): void {
  const backup = fs.existsSync(settingsPath)
    ? fs.readFileSync(settingsPath, "utf8")
    : null;
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  try {
    fn();
  } finally {
    if (backup !== null) fs.writeFileSync(settingsPath, backup, "utf8");
    else fs.writeFileSync(settingsPath, "{}\n", "utf8");
  }
}

describe("loadConfig", () => {
  it("prefers loadConfig vaultPath override", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
    const cfg = loadConfig({ vaultPath: dir, dataDir: path.join(dir, "data") });
    expect(path.basename(cfg.vaultPath)).toBe(path.basename(dir));
    expect(fs.existsSync(cfg.vaultPath)).toBe(true);
    expect(cfg.sources.vaultPath).toBe("override");
  });

  it("loadConfig aiMode override wins over env", () => {
    process.env.AI_MODE = "claude";
    const cfg = loadConfig({
      vaultPath: os.tmpdir(),
      dataDir: os.tmpdir(),
      aiMode: "stub",
    });
    expect(cfg.aiMode).toBe("stub");
  });

  it("prefers settings.json dataDir/aiMode over DATA_DIR and AI_MODE env", () => {
    const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "ai-office-cfg-data-"));
    withTempSettings(
      {
        vaultPath: os.tmpdir(),
        dataDir: tmpData,
        aiMode: "claude",
      },
      () => {
        process.env.DATA_DIR = "/tmp/ai-office-should-not-win";
        process.env.AI_MODE = "stub";
        delete process.env.VAULT_PATH;
        const cfg = loadConfig();
        expect(cfg.sources.dataDir).toBe("config/settings.json");
        expect(cfg.sources.aiMode).toBe("config/settings.json");
        expect(cfg.dataDir).toBe(path.resolve(tmpData));
        expect(cfg.aiMode).toBe("claude");
        expect(cfg.dataDir).not.toBe(
          path.resolve("/tmp/ai-office-should-not-win"),
        );
      },
    );
  });
});
