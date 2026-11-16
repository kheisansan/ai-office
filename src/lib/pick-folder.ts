import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";

const execFileAsync = promisify(execFile);

function trimFolderPath(raw: string): string | null {
  const p = raw.trim().replace(/[\r\n]+/g, "");
  if (!p) return null;
  return p.replace(/\/+$/, "") || p;
}

async function pickFolderMac(defaultPath?: string): Promise<string | null> {
  const lines = [
    "try",
    defaultPath && fs.existsSync(defaultPath)
      ? `  set theFolder to choose folder with prompt "LLM Wiki（Vault）フォルダを選択" default location (POSIX file ${JSON.stringify(defaultPath)})`
      : `  set theFolder to choose folder with prompt "LLM Wiki（Vault）フォルダを選択"`,
    "  return POSIX path of theFolder",
    "on error number -128",
    '  return ""',
    "end try",
  ].filter(Boolean) as string[];

  const { stdout } = await execFileAsync("osascript", ["-e", lines.join("\n")], {
    timeout: 600_000,
    maxBuffer: 1024 * 1024,
  });
  return trimFolderPath(stdout);
}

async function pickFolderLinux(defaultPath?: string): Promise<string | null> {
  const args = ["--file-selection", "--directory", "--title=LLM Wiki（Vault）フォルダを選択"];
  if (defaultPath && fs.existsSync(defaultPath)) {
    args.push(`--filename=${defaultPath}/`);
  }
  try {
    const { stdout } = await execFileAsync("zenity", args, {
      timeout: 600_000,
      maxBuffer: 1024 * 1024,
    });
    return trimFolderPath(stdout);
  } catch (err) {
    const code = (err as { code?: number | string }).code;
    if (code === 1 || code === "1") return null;
    throw new Error(
      "フォルダ選択には zenity が必要です（未インストールか、ダイアログを開けなかった）",
    );
  }
}

async function pickFolderWin(defaultPath?: string): Promise<string | null> {
  const initial = defaultPath && fs.existsSync(defaultPath) ? defaultPath.replace(/'/g, "''") : "";
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
    '$d.Description = "LLM Wiki (Vault) folder"',
    initial ? `$d.SelectedPath = '${initial}'` : null,
    "$r = $d.ShowDialog()",
    'if ($r -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }',
  ]
    .filter(Boolean)
    .join("; ");

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-STA", "-Command", script],
    { timeout: 600_000, maxBuffer: 1024 * 1024 },
  );
  return trimFolderPath(stdout);
}

/** Open a native folder picker. Returns absolute path, or null if cancelled. */
export async function pickFolder(options: { defaultPath?: string } = {}): Promise<string | null> {
  const platform = process.platform;
  if (platform === "darwin") return pickFolderMac(options.defaultPath);
  if (platform === "linux") return pickFolderLinux(options.defaultPath);
  if (platform === "win32") return pickFolderWin(options.defaultPath);
  throw new Error(`Folder picker is not supported on ${platform}`);
}
