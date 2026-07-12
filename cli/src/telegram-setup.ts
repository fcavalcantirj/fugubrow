import {
  confirm,
  text,
  password,
  isCancel,
  cancel,
  log,
  note,
  spinner,
} from "@clack/prompts";
import open from "open";
import crypto from "crypto";
import { triggerProductionDeploy } from "./trigger-deploy.js";
import { fetchProjectEnvValue } from "./vercel-env.js";

interface TelegramSetupArgs {
  vercelToken: string;
  vercelTeamId: string | null;
  projectId: string;
  deploymentUrl: string;
  githubRepoSlug: string;
  existingEnvKeys: Set<string>;
}

export async function maybeSetupTelegram(args: TelegramSetupArgs): Promise<boolean> {
  const TELEGRAM_KEYS = [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_BOT_USERNAME",
    "TELEGRAM_WEBHOOK_SECRET",
  ];
  const allTelegramKeysSet = TELEGRAM_KEYS.every((k) => args.existingEnvKeys.has(k));
  if (allTelegramKeysSet) {
    // Skip the prompts. Only re-register the webhook if Telegram has it
    // pointed at a URL other than our current stable deployment URL -
    // otherwise the bot is already wired up correctly and we're done.
    const lookup = {
      token: args.vercelToken,
      teamId: args.vercelTeamId,
      projectId: args.projectId,
    };
    const existingToken = await fetchProjectEnvValue(lookup, "TELEGRAM_BOT_TOKEN");
    const existingSecret = await fetchProjectEnvValue(
      lookup,
      "TELEGRAM_WEBHOOK_SECRET",
    );
    if (!existingToken || !existingSecret) {
      log.info("Telegram already configured on this project - skipping setup.");
      return true;
    }

    const expectedUrl = `https://${args.deploymentUrl}/api/telegram-webhook`;
    const s = spinner();
    s.start("Checking Telegram webhook");
    const currentUrl = await getCurrentWebhookUrl(existingToken);
    if (currentUrl === expectedUrl) {
      s.stop("Telegram webhook already up to date - skipping");
      return true;
    }

    s.message(
      currentUrl
        ? `Webhook points at ${currentUrl} - updating`
        : "No webhook registered - registering",
    );
    const ok = await registerTelegramWebhook({
      botToken: existingToken,
      webhookSecret: existingSecret,
      deploymentUrl: args.deploymentUrl,
    });
    s.stop(ok ? "Telegram webhook updated" : "Telegram webhook update failed");
    return true;
  }

  const wantsTelegram = await confirm({
    message: "Set up Telegram bot? (chat with your agent from your phone)",
    initialValue: false,
  });
  if (isCancel(wantsTelegram)) {
    cancel("Cancelled.");
    process.exit(0);
  }
  if (!wantsTelegram) {
    return false;
  }

  const openBotFather = await confirm({
    message: "Open @BotFather in your browser?",
    initialValue: true,
  });
  if (isCancel(openBotFather)) {
    cancel("Cancelled.");
    process.exit(0);
  }
  if (openBotFather) {
    await open("https://t.me/BotFather");
  }

  note(
    `In your @BotFather chat:\n` +
      `  1. Send /newbot\n` +
      `  2. Pick a display name (e.g. "My TrustClaw")\n` +
      `  3. Pick a username - must end in "bot" (e.g. my_trustclaw_bot)\n` +
      `  4. @BotFather replies with a token like 1234567:ABC-DEF...\n` +
      `  5. Copy the token and paste it below`,
    "Get your bot token",
  );

  const botToken = await password({
    message: "Bot token from @BotFather (the 1234567:ABC-DEF... line)",
    validate: (v) =>
      v && /^\d+:[A-Za-z0-9_-]+$/.test(v)
        ? undefined
        : "Should look like 1234567:ABC-DEF...",
  });
  if (isCancel(botToken)) {
    cancel("Cancelled.");
    process.exit(0);
  }

  const botUsername = await text({
    message: "Bot username (without the @)",
    validate: (v) =>
      v && /^[A-Za-z0-9_]{5,}$/.test(v) ? undefined : "Lowercase letters, numbers, underscores",
  });
  if (isCancel(botUsername)) {
    cancel("Cancelled.");
    process.exit(0);
  }

  const webhookSecret = crypto.randomBytes(24).toString("hex");

  const s1 = spinner();
  s1.start("Setting Telegram env vars on Vercel");
  await setVercelEnv(args, "TELEGRAM_BOT_TOKEN", botToken);
  await setVercelEnv(args, "TELEGRAM_BOT_USERNAME", botUsername);
  await setVercelEnv(args, "TELEGRAM_WEBHOOK_SECRET", webhookSecret);
  s1.stop("Telegram env vars set");

  const s2 = spinner();
  s2.start("Registering webhook with Telegram");
  const webhookOk = await registerTelegramWebhook({
    botToken,
    webhookSecret,
    deploymentUrl: args.deploymentUrl,
  });
  if (!webhookOk) {
    s2.stop("Webhook registration failed");
    const webhookUrl = `https://${args.deploymentUrl}/api/telegram-webhook`;
    log.warn(
      "You can register manually later with: " +
        `curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" -d "url=${webhookUrl}&secret_token=<SECRET>"`,
    );
    return true;
  }
  s2.stop("Telegram webhook registered");

  // The running deployment doesn't have the new env vars baked in yet - kick a
  // fresh production deploy so the bot actually works as soon as the build lands.
  const redeployed = await triggerProductionDeploy({
    token: args.vercelToken,
    teamId: args.vercelTeamId,
    projectId: args.projectId,
    githubRepoSlug: args.githubRepoSlug,
  });
  // Print outside the clack box so the URL stays on one copyable line.
  const redeployUrl = `https://${redeployed.url}`;
  console.log(`\n  Redeploy URL: ${redeployUrl}\n`);
  await open(redeployUrl).catch(() => {});

  return true;
}

async function setVercelEnv(
  args: TelegramSetupArgs,
  key: string,
  value: string,
): Promise<void> {
  const url = args.vercelTeamId
    ? `https://api.vercel.com/v10/projects/${args.projectId}/env?teamId=${args.vercelTeamId}&upsert=true`
    : `https://api.vercel.com/v10/projects/${args.projectId}/env?upsert=true`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.vercelToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key,
      value,
      target: ["production", "preview", "development"],
      type: "encrypted",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to set ${key}: ${res.status} ${body}`);
  }
}

async function getCurrentWebhookUrl(botToken: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: { url?: string } };
    return data.result?.url || null;
  } catch {
    return null;
  }
}

async function registerTelegramWebhook(args: {
  botToken: string;
  webhookSecret: string;
  deploymentUrl: string;
}): Promise<boolean> {
  const webhookUrl = `https://${args.deploymentUrl}/api/telegram-webhook`;
  const res = await fetch(
    `https://api.telegram.org/bot${args.botToken}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: args.webhookSecret,
        allowed_updates: ["message", "edited_message"],
      }),
    },
  );
  if (!res.ok) return false;
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) return false;

  // Verify Telegram actually stored the URL we asked for, and warn otherwise -
  // catches silent drift if the registration appears to succeed but the stored
  // URL is wrong (e.g. URL canonicalization, prior registration sticking).
  const verifyRes = await fetch(
    `https://api.telegram.org/bot${args.botToken}/getWebhookInfo`,
  );
  if (verifyRes.ok) {
    const info = (await verifyRes.json()) as { result?: { url?: string } };
    const stored = info.result?.url;
    if (stored && stored !== webhookUrl) {
      log.warn(
        `Telegram stored a different webhook URL than requested.\n  expected: ${webhookUrl}\n  got:      ${stored}`,
      );
    }
  }
  return true;
}
