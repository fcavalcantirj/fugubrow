import { spinner } from "@clack/prompts";

const SOURCE_REPO = "ComposioHQ/trustclaw";

export async function forkRepo(token: string, username: string): Promise<{ repo: string }> {
  const targetRepo = `${username}/trustclaw`;
  const s = spinner();

  s.start(`Forking ${SOURCE_REPO} → ${targetRepo}`);

  const checkRes = await fetch(`https://api.github.com/repos/${targetRepo}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });

  if (checkRes.ok) {
    s.stop(`Fork already exists: ${targetRepo}`);
    return { repo: targetRepo };
  }

  const forkRes = await fetch(`https://api.github.com/repos/${SOURCE_REPO}/forks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
  });

  if (!forkRes.ok) {
    const body = await forkRes.text();
    s.stop("Fork failed");
    throw new Error(`GitHub fork failed: ${forkRes.status} ${body}`);
  }

  s.stop(`Forked: ${targetRepo}`);
  return { repo: targetRepo };
}
