# fuguBrow 🐡🏴‍☠️

> Your rogue AI **first mate** — a 24/7 personal agent that plunders your busywork while you sleep.
> A fork of [TrustClaw](https://github.com/ComposioHQ/trustclaw), re-wired off the Vercel AI Gateway onto **flat-rate providers** — no per-token LLM billing.

**Live:** [fugubrow.vercel.app](https://fugubrow.vercel.app)

**Links:** [Neon DB](https://console.neon.tech/app/projects/divine-frog-15918269/branches/br-misty-unit-at7vma6d) ·
[Jina keys](https://jina.ai/api-dashboard/key-manager) ·
[Sakana console](https://console.sakana.ai/) ·
[Mastra](https://projects.mastra.ai/)

---

## What it is

fuguBrow is a self-hostable 24/7 AI agent: chat on the **web or Telegram**, long-term **vector memory**, **1000+ tool integrations** via Composio (OAuth, sandboxed execution), and **cron-scheduled** autonomous runs. It's [TrustClaw](https://github.com/ComposioHQ/trustclaw) with its LLM + embedding layer swapped off the Vercel AI Gateway onto flat-rate providers:

| Layer | fuguBrow runs on |
|---|---|
| **Chat / agent** | Sakana **`fugu`** (`fugu` / `fugu-ultra`), OpenAI-compatible |
| **Memory embeddings** | Jina **`jina-embeddings-v4`** (2048-dim), OpenAI-compatible |
| **Tools** | Composio — OAuth, 1000+ apps |
| **Database** | Neon Postgres + pgvector |

No Vercel AI Gateway, no per-token OpenAI/Anthropic billing — all model + embedding calls go through [`src/server/clients/model.ts`](src/server/clients/model.ts).

## Cost

Predictable — no per-token / usage-metered LLM billing:

| Service | Plan |
|---|---|
| Sakana **fugu** (chat) | flat **~$10/mo** API subscription |
| Vercel (hosting) | **Pro** |
| Jina (embeddings) · Composio (tools) · Neon (Postgres) | **free tiers** |

---

## 🏴‍☠️ The landing

The public site is a **cyberpunk-pirate "GH0ST CAPTAIN"** page — glitch title, 3D scrolling grid, CRT scanlines, a HUD-framed portrait, and a marquee ticker. There is **no visible login**: the app is private, reached through a hidden entrance the captain keeps to themselves. The public buttons ("Commission yer own ship" → deploy your own, "Read the code" → GitHub) never expose the app.

---

## Features

- Chat with **fugu** on a Next.js dashboard or a Telegram bot
- Long-term memory (Postgres + pgvector, Jina embeddings)
- 3-layer context management (pruning, memory flush, summarization compaction) → runs indefinitely
- 1000+ Composio tools (Gmail, GitHub, Slack, Notion, Calendar, Drive, …) gated by per-user OAuth
- Cron-scheduled autonomous runs
- Username/password login (Better Auth)

## Stack

Next.js 15 (App Router) · React 19 · tRPC · Better Auth · Prisma + Neon Postgres/pgvector · Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`) · Composio SDK · Tailwind CSS + shadcn/ui.

---

## Environment variables

All secrets live in a gitignored `.env` (and mirrored to Vercel **Production**):

| Variable | Purpose |
|---|---|
| `SAKANA_API_KEY` | Sakana **fugu** chat |
| `SAKANA_BASE_URL` | `https://api.sakana.ai/v1` |
| `JINA_API_KEY` | Jina **v4** memory embeddings |
| `JINA_BASE_URL` | `https://api.jina.ai/v1` |
| `COMPOSIO_API_KEY` | Composio tool integrations |
| `DATABASE_URL` | Neon Postgres + pgvector connection string |
| `BETTER_AUTH_SECRET` | Session signing key (`openssl rand -base64 32`) |
| `CRON_SECRET` | Auth for `/api/cron/*` (`openssl rand -base64 32`) |
| `RATE_LIMIT_ENABLED=false` | Rate limiter needs Redis; off for single-user (see Gotchas) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` / `TELEGRAM_WEBHOOK_SECRET` _(optional)_ | Telegram bot |

---

## Run locally

```bash
pnpm install
# create .env with the vars above
pnpm prisma db push        # applies schema + pgvector extension to Neon
pnpm dev                   # http://localhost:3000  (type `fugu` to reach /login)
```

## Deploy (Vercel)

Deployed directly with the Vercel CLI:

```bash
# once per variable (value read from stdin), for the production environment:
printf '%s' "<value>" | vercel env add SAKANA_API_KEY production
# ...repeat for every variable in the table above...

vercel deploy --prod --yes
```

`.vercelignore` keeps `.env` out of the upload; the Vercel build runs `prisma generate && prisma db push && next build`.

### Telegram (optional)

Register the webhook, then link from the dashboard **Settings**:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  --data-urlencode "url=https://fugubrow.vercel.app/api/telegram-webhook" \
  --data-urlencode "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Then message the bot `/start <token>` using the link token generated in Settings.

---

## Gotchas (hard-won)

- **`@ai-sdk/openai-compatible` must be v2** — v3 emits provider spec V4, incompatible with `ai@6`'s V2/V3 model types.
- **Jina v4 returns 2048 dims** (not 1024 as its docs claim) → the pgvector column is `VECTOR(2048)`. Safe: there's no ivfflat/hnsw index on it.
- **Sakana has no embeddings endpoint** — that's why memory uses Jina (Groq has none either).
- **The rate limiter fails _closed_ without Redis** (prod default). Keep `RATE_LIMIT_ENABLED=false`, or add `REDIS_URL`. Symptom if wrong: every chat/Telegram message returns _"You're sending messages too quickly."_
- **Neon free compute auto-suspends** → the first `prisma db push` may `P1001` on a cold start; just retry once it's warm.

---

## Credits

A fork of [TrustClaw](https://github.com/ComposioHQ/trustclaw) by [Composio](https://composio.dev), inspired by [OpenClaw](https://github.com/openclaw/openclaw). Chat by [Sakana **fugu**](https://sakana.ai), memory by [Jina](https://jina.ai). MIT — see [LICENSE](./LICENSE).
