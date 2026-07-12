import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { log } from "@clack/prompts";

/**
 * Read this CLI's own version from its package.json.
 */
async function readOwnVersion(): Promise<string | null> {
  try {
    // dist/version-check.js -> dist/ -> package.json (one level up)
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "package.json");
    const raw = await readFile(pkgPath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch the latest published version of @composio/trustclaw from npm with a
 * short timeout so we never block the deploy on a slow network.
 */
async function fetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(
      "https://registry.npmjs.org/-/package/@composio/trustclaw/dist-tags",
      { signal: controller.signal },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { latest?: string };
    return data.latest ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/**
 * Warn (don't block) if the user is running a stale version of the CLI.
 * `npx @composio/trustclaw` should fetch the latest, but cached/global
 * installs can drift, and old versions miss bug fixes.
 */
export async function warnIfOutdated(): Promise<void> {
  const [current, latest] = await Promise.all([
    readOwnVersion(),
    fetchLatestVersion(),
  ]);
  if (!current || !latest) return;
  if (compareVersions(current, latest) >= 0) return;
  log.warn(
    `You're running @composio/trustclaw@${current}, but ${latest} is available.\n` +
      `Run \`npx @composio/trustclaw@latest deploy\` to use the latest.`,
  );
}
