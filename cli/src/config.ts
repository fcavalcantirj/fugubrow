import { readFile, writeFile } from "fs/promises";
import { join } from "path";

const CONFIG_FILE = ".trustclaw-deploy.json";

export interface DeployConfig {
  vercelProjectName?: string;
  githubRepoName?: string;
}

/**
 * Load cached deploy config (project name, repo name) from the repo root.
 * Returns an empty object if the file doesn't exist or is unreadable.
 */
export async function loadConfig(rootDir: string): Promise<DeployConfig> {
  try {
    const raw = await readFile(join(rootDir, CONFIG_FILE), "utf-8");
    const parsed = JSON.parse(raw) as DeployConfig;
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Persist deploy config to the repo root so subsequent runs can pre-fill
 * the prompts. Merges with whatever is already there rather than overwriting.
 */
export async function saveConfig(
  rootDir: string,
  patch: DeployConfig,
): Promise<void> {
  const current = await loadConfig(rootDir);
  const merged = { ...current, ...patch };
  await writeFile(
    join(rootDir, CONFIG_FILE),
    JSON.stringify(merged, null, 2) + "\n",
    "utf-8",
  );
}
