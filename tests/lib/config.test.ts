import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/lib/config.js";

const prevVault = process.env.VAULT_PATH;
const prevMode = process.env.AI_MODE;

afterEach(() => {
  if (prevVault === undefined) delete process.env.VAULT_PATH;
  else process.env.VAULT_PATH = prevVault;
  if (prevMode === undefined) delete process.env.AI_MODE;
  else process.env.AI_MODE = prevMode;
});

describe("loadConfig", () => {
  it("prefers loadConfig vaultPath override", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
    const cfg = loadConfig({ vaultPath: dir, dataDir: path.join(dir, "data") });
    expect(cfg.vaultPath).toBe(path.resolve(dir));
    expect(cfg.sources.vaultPath).toBe("override");
  });

  it("reads AI_MODE=stub from env", () => {
    process.env.AI_MODE = "stub";
    const cfg = loadConfig({ vaultPath: os.tmpdir(), dataDir: os.tmpdir() });
    expect(cfg.aiMode).toBe("stub");
  });
});
