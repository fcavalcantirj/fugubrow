interface VercelEnvVar {
  id: string;
  key: string;
  target: string[];
}

export interface ProjectEnvLookupArgs {
  token: string;
  teamId: string | null;
  projectId: string;
}

/**
 * Delete a set of env vars from a Vercel project. Useful for cleaning up
 * orphan env vars left behind by failed marketplace integration connects.
 * Returns the count of vars actually deleted.
 */
export async function deleteEnvVars(
  args: ProjectEnvLookupArgs,
  keysToDelete: Set<string>,
): Promise<number> {
  const url = args.teamId
    ? `https://api.vercel.com/v10/projects/${args.projectId}/env?teamId=${args.teamId}`
    : `https://api.vercel.com/v10/projects/${args.projectId}/env`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${args.token}` },
  });
  if (!res.ok) return 0;
  const data = (await res.json()) as { envs: VercelEnvVar[] };
  let deleted = 0;
  for (const env of data.envs) {
    if (!keysToDelete.has(env.key)) continue;
    const delUrl = args.teamId
      ? `https://api.vercel.com/v9/projects/${args.projectId}/env/${env.id}?teamId=${args.teamId}`
      : `https://api.vercel.com/v9/projects/${args.projectId}/env/${env.id}`;
    const delRes = await fetch(delUrl, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${args.token}` },
    });
    if (delRes.ok) deleted++;
  }
  return deleted;
}

/**
 * List the names of all env vars set on a Vercel project.
 * Cheap - no decryption required since we only need to know which keys exist.
 */
export async function listProjectEnvKeys(
  args: ProjectEnvLookupArgs,
): Promise<Set<string>> {
  const url = args.teamId
    ? `https://api.vercel.com/v10/projects/${args.projectId}/env?teamId=${args.teamId}`
    : `https://api.vercel.com/v10/projects/${args.projectId}/env`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${args.token}` },
  });
  if (!res.ok) return new Set();
  const data = (await res.json()) as { envs: VercelEnvVar[] };
  return new Set(data.envs.map((e) => e.key));
}

/**
 * Fetch the decrypted value of a single env var by key.
 * Returns null if the key doesn't exist on the project.
 *
 * The list endpoint's `?decrypt=true` doesn't actually decrypt values for
 * marketplace-managed env vars - they come back as encrypted JSON blobs.
 * The per-id endpoint /v1/projects/{id}/env/{envId} returns the real value.
 */
export async function fetchProjectEnvValue(
  args: ProjectEnvLookupArgs,
  key: string,
): Promise<string | null> {
  const listUrl = args.teamId
    ? `https://api.vercel.com/v10/projects/${args.projectId}/env?teamId=${args.teamId}`
    : `https://api.vercel.com/v10/projects/${args.projectId}/env`;
  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${args.token}` },
  });
  if (!listRes.ok) return null;
  const list = (await listRes.json()) as { envs: VercelEnvVar[] };
  const match = list.envs.find((e) => e.key === key);
  if (!match) return null;
  const detailUrl = args.teamId
    ? `https://api.vercel.com/v1/projects/${args.projectId}/env/${match.id}?teamId=${args.teamId}`
    : `https://api.vercel.com/v1/projects/${args.projectId}/env/${match.id}`;
  const detailRes = await fetch(detailUrl, {
    headers: { Authorization: `Bearer ${args.token}` },
  });
  if (!detailRes.ok) return null;
  const data = (await detailRes.json()) as { value?: string };
  return data.value ?? null;
}

/**
 * Look up a project by name to see if it already exists.
 * Returns the project id if found, null otherwise.
 */
export async function lookupExistingProject(args: {
  token: string;
  teamId: string | null;
  projectName: string;
}): Promise<{ id: string } | null> {
  const url = args.teamId
    ? `https://api.vercel.com/v9/projects/${args.projectName}?teamId=${args.teamId}`
    : `https://api.vercel.com/v9/projects/${args.projectName}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${args.token}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { id: string };
  return { id: data.id };
}

/**
 * Fetch the canonical production alias for a project (e.g. "trustclaw.vercel.app")
 * from the project's targets.production.alias list. Picks the shortest alias since
 * Vercel returns multiple variants and the shortest is the stable one.
 *
 * Falls back to `<projectName>.vercel.app` if the API call fails.
 */
export async function getProductionAlias(args: {
  token: string;
  teamId: string | null;
  projectId: string;
  projectName: string;
}): Promise<string> {
  const url = args.teamId
    ? `https://api.vercel.com/v9/projects/${args.projectId}?teamId=${args.teamId}`
    : `https://api.vercel.com/v9/projects/${args.projectId}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${args.token}` },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        targets?: { production?: { alias?: string[] } };
      };
      const aliases = data.targets?.production?.alias ?? [];
      if (aliases.length > 0) {
        // Shortest alias is the canonical one (e.g. project.vercel.app vs
        // project-team-slug.vercel.app vs project-git-branch-team.vercel.app).
        return [...aliases].sort((a, b) => a.length - b.length)[0]!;
      }
    }
  } catch {
    // fall through
  }
  return `${args.projectName}.vercel.app`;
}
