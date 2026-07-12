import { exec as _exec, spawn } from "child_process";
import { promisify } from "util";
import { readFile, mkdir, rm } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { confirm, isCancel, log, spinner } from "@clack/prompts";

const exec = promisify(_exec);

const COMPOSIO_USER_DATA_PATH = join(homedir(), ".composio", "user_data.json");

async function runInteractive(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function composioIsInstalled(): Promise<boolean> {
  try {
    await exec("command -v composio");
    return true;
  } catch {
    return false;
  }
}

async function composioIsLoggedIn(): Promise<boolean> {
  try {
    const raw = await readFile(COMPOSIO_USER_DATA_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { api_key?: string };
    return Boolean(parsed.api_key);
  } catch {
    return false;
  }
}

export function isValidComposioKey(value: string | null | undefined): boolean {
  if (!value) return false;
  // Composio's SDK accepts project-scoped `ak_<...>` keys. The user-scoped
  // `uak_` key from ~/.composio/user_data.json is for CLI/management only and
  // returns 401 against the SDK API endpoints — don't accept it here.
  return /^ak_[A-Za-z0-9_-]{10,}$/.test(value.trim());
}

/**
 * Parse `KEY=VALUE` lines out of a dotenv-style file.
 */
function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Resolve a project-scoped Composio API key without prompting the user to
 * copy/paste.
 *
 * Strategy:
 *   1. Verify the Composio CLI is installed; throw with install hint if not.
 *   2. Verify the user is logged in (~/.composio/user_data.json exists with an
 *      api_key field); prompt to run `composio login` interactively if not.
 *   3. Run `composio dev init -y` in a temp directory. This either creates or
 *      selects the user's default project and writes COMPOSIO_API_KEY=ak_<...>
 *      into .env.local. We parse the file and return the key.
 *   4. Clean up the temp dir.
 */
export async function resolveComposioApiKey(): Promise<string> {
  if (!(await composioIsInstalled())) {
    throw new Error(
      "Composio CLI (`composio`) is not installed. Install from\n" +
        "https://docs.composio.dev/getting-started/install-cli, then re-run cli:deploy.",
    );
  }

  if (!(await composioIsLoggedIn())) {
    log.warn("Need to authenticate with Composio.");
    const proceed = await confirm({
      message: "Run `composio login` now? (sign in or sign up at composio.dev)",
      initialValue: true,
    });
    if (isCancel(proceed) || !proceed) {
      throw new Error("Cancelled. Run `composio login` and re-run cli:deploy.");
    }
    // -y: skip the org picker if the user belongs to multiple orgs
    // --no-skill-install: don't sneak in a Claude Code skill install
    // composio login itself handles browser open / device-code fallback,
    // and lets the user sign up at the dashboard if they don't have an account.
    const code = await runInteractive("composio", [
      "login",
      "-y",
      "--no-skill-install",
    ]);
    if (code !== 0) {
      throw new Error(`composio login exited with code ${code}.`);
    }
    if (!(await composioIsLoggedIn())) {
      throw new Error("Composio login completed but no auth file found on disk.");
    }
  }

  const s = spinner();
  s.start("Generating Composio project API key");

  // Run `composio dev init -y` in a throwaway directory so we don't pollute
  // the user's repo with .composio/ and .env.local files. The command picks
  // the default org project and writes COMPOSIO_API_KEY=ak_<...> to .env.local.
  const workDir = join(tmpdir(), `trustclaw-composio-${Date.now()}`);
  await mkdir(workDir, { recursive: true });

  try {
    await exec("composio dev init -y --no-browser", { cwd: workDir });
    const envContent = await readFile(join(workDir, ".env.local"), "utf-8");
    const parsed = parseEnvFile(envContent);
    const key = parsed.COMPOSIO_API_KEY?.trim();
    if (!key) {
      s.stop("Composio key not found in dev init output");
      throw new Error(
        "`composio dev init` ran but no COMPOSIO_API_KEY was written to .env.local.",
      );
    }
    if (!isValidComposioKey(key)) {
      s.stop("Composio key looks malformed");
      throw new Error(
        `composio dev init returned an unexpected key format: ${key.slice(0, 8)}...`,
      );
    }
    s.stop("Composio API key resolved");
    return key;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("composio dev init")) {
      throw err;
    }
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const detail = e.stderr ?? e.stdout ?? e.message ?? String(err);
    s.stop("Failed to resolve Composio key");
    throw new Error(`composio dev init failed:\n${detail}`);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
