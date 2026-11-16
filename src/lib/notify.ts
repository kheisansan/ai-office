import { spawn } from "node:child_process";

function escapeAppleScript(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** macOS notification. No-op on other platforms or when AI_OFFICE_NOTIFY=0. */
export function notify(title: string, message: string): void {
  if (process.env.AI_OFFICE_NOTIFY === "0") return;
  if (process.platform !== "darwin") return;

  const script = `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}"`;
  const child = spawn("osascript", ["-e", script], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}
