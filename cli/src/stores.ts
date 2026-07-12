import { exec as _exec } from "child_process";
import { promisify } from "util";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { spinner, log } from "@clack/prompts";
import {
  deleteEnvVars,
  fetchProjectEnvValue,
  listProjectEnvKeys,
  type ProjectEnvLookupArgs,
} from "./vercel-env.js";

const exec = promisify(_exec);

interface ProvisionArgs {
  token: string;
  teamId: string | null;
  projectId: string;
  projectName: string;
  ownerSlug: string;
}

interface ConnectionStrings {
  databaseUrl: string;
  redisUrl: string | null;
}

/**
 * Write a .vercel/project.json so the `vercel integration add` CLI knows which
 * project to install integrations into, without requiring an interactive
 * `vercel link` step. Returns the path to use as `--cwd` for vercel commands.
 */
async function ensureVercelLinkDir(args: ProvisionArgs): Promise<string> {
  const linkDir = join(
    process.env.TMPDIR ?? "/tmp",
    `trustclaw-deploy-${args.projectId}`,
  );
  await mkdir(join(linkDir, ".vercel"), { recursive: true });
  await writeFile(
    join(linkDir, ".vercel", "project.json"),
    JSON.stringify(
      {
        projectId: args.projectId,
        orgId: args.teamId ?? "",
        projectName: args.projectName,
      },
      null,
      2,
    ),
    "utf-8",
  );
  return linkDir;
}

interface AddIntegrationResult {
  ok: boolean;
  /** True when Vercel handed off to a browser for additional setup. */
  needsBrowser: boolean;
  /** Combined stdout/stderr — useful for debugging genuine failures. */
  output: string;
}

/**
 * Install a Vercel Marketplace integration onto the project via the Vercel CLI.
 *
 * Returns a structured result instead of throwing: many "failures" actually
 * mean "Vercel opened a browser for the user to finish setup." We treat that
 * as a successful kickoff and let the caller poll the project env for the
 * resulting connection string.
 */
async function addIntegration(args: {
  cwd: string;
  integrationSlug: string;
  resourceName: string;
  plan?: string;
}): Promise<AddIntegrationResult> {
  // -e production -e preview -e development connects all environments.
  // --no-env-pull skips writing a .env.local on disk.
  // We *don't* pass --non-interactive: we want Vercel to be free to open a
  // browser when additional setup (e.g. accepting marketplace terms,
  // choosing a region) is required.
  //
  // Use `npx -y vercel@<pinned>` rather than bare `vercel` so the CLI works
  // for users who haven't run `npm i -g vercel`. npx caches the package, so
  // subsequent invocations are fast.
  // Pinning to a known major insulates us from upstream flag/output drift.
  const planFlag = args.plan ? ` --plan ${args.plan}` : "";
  const cmd =
    `npx -y vercel@53 integration add ${args.integrationSlug}` +
    ` --name ${args.resourceName}` +
    ` -e production -e preview -e development` +
    ` --no-env-pull${planFlag}`;
  try {
    const { stdout, stderr } = await exec(cmd, { cwd: args.cwd });
    return { ok: true, needsBrowser: false, output: stdout + stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const output = `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`;
    const needsBrowser =
      /Additional setup required/i.test(output) ||
      /Opening browser/i.test(output);
    return { ok: false, needsBrowser, output };
  }
}

/**
 * Wait for the integration's env var to land on the project after the user
 * finishes any browser-side setup. Polls every 5 seconds for up to 5 minutes.
 */
async function pollForEnvVar(
  lookup: ProjectEnvLookupArgs,
  candidateKeys: string[],
  prefixes: string[],
  spinnerMsg: (attempt: number) => string,
  s: ReturnType<typeof spinner>,
): Promise<string | null> {
  const MAX_ATTEMPTS = 60; // 60 * 5s = 5 minutes
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    s.message(spinnerMsg(attempt));
    for (const key of candidateKeys) {
      const v = await fetchProjectEnvValue(lookup, key);
      if (v && prefixes.some((p) => v.startsWith(p))) {
        return v;
      }
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}

// Env var prefixes Neon/Postgres marketplace integrations inject. We treat
// these as orphans (and clean them up) when DATABASE_URL is missing — they're
// leftovers from a prior partial connect that block fresh `integration add`.
function isPostgresEnvVar(key: string): boolean {
  return (
    key === "DATABASE_URL" ||
    key === "DATABASE_URL_UNPOOLED" ||
    key === "POSTGRES_URL" ||
    key === "POSTGRES_URL_NON_POOLING" ||
    key === "POSTGRES_PRISMA_URL" ||
    key === "POSTGRES_URL_NO_SSL" ||
    key === "POSTGRES_USER" ||
    key === "POSTGRES_HOST" ||
    key === "POSTGRES_PASSWORD" ||
    key === "POSTGRES_DATABASE" ||
    key === "PGHOST" ||
    key === "PGHOST_UNPOOLED" ||
    key === "PGUSER" ||
    key === "PGPASSWORD" ||
    key === "PGDATABASE" ||
    key === "NEON_PROJECT_ID"
  );
}

function isRedisEnvVar(key: string): boolean {
  return (
    key === "REDIS_URL" ||
    key === "KV_URL" ||
    key === "KV_REST_API_URL" ||
    key === "KV_REST_API_TOKEN" ||
    key === "KV_REST_API_READ_ONLY_TOKEN"
  );
}

async function cleanupOrphanEnvVars(
  lookup: ProjectEnvLookupArgs,
  predicate: (key: string) => boolean,
): Promise<number> {
  const allKeys = await listProjectEnvKeys(lookup);
  const orphans = new Set([...allKeys].filter(predicate));
  if (orphans.size === 0) return 0;
  return deleteEnvVars(lookup, orphans);
}

async function provisionPostgres(args: ProvisionArgs): Promise<string> {
  const s = spinner();
  s.start("Checking project for an existing Postgres connection");
  const lookup = {
    token: args.token,
    teamId: args.teamId,
    projectId: args.projectId,
  };
  for (const key of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL"]) {
    const v = await fetchProjectEnvValue(lookup, key);
    if (v && (v.startsWith("postgres://") || v.startsWith("postgresql://"))) {
      s.stop("Postgres already connected - reusing existing DATABASE_URL");
      return v;
    }
  }

  // Wipe any orphan PG/POSTGRES/NEON env vars left behind by a prior partial
  // connect. Vercel's `integration add` 400s with "existing environment
  // variable with name PGDATABASE" if these stick around.
  const cleaned = await cleanupOrphanEnvVars(lookup, isPostgresEnvVar);
  if (cleaned > 0) {
    s.message(`Cleaned up ${cleaned} orphan Postgres env vars from prior run`);
  }

  s.message("Provisioning Neon Postgres via `vercel integration add neon`");
  const linkDir = await ensureVercelLinkDir(args);
  const result = await addIntegration({
    cwd: linkDir,
    integrationSlug: "neon",
    resourceName: "trustclaw-postgres",
    plan: "free_v3",
  });

  if (!result.ok && !result.needsBrowser) {
    s.stop("Postgres provisioning failed");
    throw new Error(`vercel integration add neon failed:\n${result.output}`);
  }

  if (result.needsBrowser) {
    s.message(
      "Browser opened for Neon setup - finish the setup, I'll wait...",
    );
  }

  const url = await pollForEnvVar(
    lookup,
    ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL"],
    ["postgres://", "postgresql://"],
    (attempt) =>
      result.needsBrowser
        ? `Waiting for Neon setup to finish in browser (attempt ${attempt})`
        : "Fetching DATABASE_URL from project env",
    s,
  );
  if (!url) {
    s.stop("Timed out waiting for DATABASE_URL");
    throw new Error(
      "Neon never injected DATABASE_URL onto the project. Finish the marketplace setup at\n" +
        `https://vercel.com/${args.ownerSlug}/${args.projectName}/stores and re-run.`,
    );
  }
  s.stop("Postgres provisioned");
  return url;
}

async function provisionRedis(args: ProvisionArgs): Promise<string> {
  const s = spinner();
  s.start("Checking project for an existing Redis connection");
  const lookup = {
    token: args.token,
    teamId: args.teamId,
    projectId: args.projectId,
  };
  for (const key of ["REDIS_URL", "KV_URL"]) {
    const v = await fetchProjectEnvValue(lookup, key);
    if (v && (v.startsWith("redis://") || v.startsWith("rediss://"))) {
      s.stop("Redis already connected - reusing existing REDIS_URL");
      return v;
    }
  }

  const cleaned = await cleanupOrphanEnvVars(lookup, isRedisEnvVar);
  if (cleaned > 0) {
    s.message(`Cleaned up ${cleaned} orphan Redis env vars from prior run`);
  }

  s.message("Provisioning Redis via `vercel integration add redis`");
  const linkDir = await ensureVercelLinkDir(args);
  const result = await addIntegration({
    cwd: linkDir,
    integrationSlug: "redis",
    resourceName: "trustclaw-redis",
  });

  if (!result.ok && !result.needsBrowser) {
    s.stop("Redis provisioning failed");
    throw new Error(`vercel integration add redis failed:\n${result.output}`);
  }

  if (result.needsBrowser) {
    s.message(
      "Browser opened for Redis setup - finish the setup, I'll wait...",
    );
  }

  const url = await pollForEnvVar(
    lookup,
    ["REDIS_URL", "KV_URL"],
    ["redis://", "rediss://"],
    (attempt) =>
      result.needsBrowser
        ? `Waiting for Redis setup to finish in browser (attempt ${attempt})`
        : "Fetching REDIS_URL from project env",
    s,
  );
  if (!url) {
    s.stop("Timed out waiting for REDIS_URL");
    throw new Error(
      "Redis never injected REDIS_URL onto the project. Finish the marketplace setup at\n" +
        `https://vercel.com/${args.ownerSlug}/${args.projectName}/stores and re-run.`,
    );
  }
  s.stop("Redis provisioned");
  return url;
}

export async function provisionStores(
  args: ProvisionArgs & { enableRedis: boolean },
): Promise<ConnectionStrings> {
  const databaseUrl = await provisionPostgres(args);
  const redisUrl = args.enableRedis ? await provisionRedis(args) : null;
  return { databaseUrl, redisUrl };
}

void log;
