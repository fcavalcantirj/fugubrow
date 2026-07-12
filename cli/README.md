# @composio/trustclaw

One-command deploy for [TrustClaw](https://github.com/ComposioHQ/trustclaw) on Vercel.

## Usage

```bash
git clone https://github.com/ComposioHQ/trustclaw && cd trustclaw
pnpm install
npx @composio/trustclaw deploy
```

The CLI handles the entire deploy:

- Forks (or publishes) the repo to your GitHub
- Creates a Vercel project linked to it
- Provisions Postgres + pgvector via Vercel Marketplace (and optionally Upstash Redis)
- Auto-generates `BETTER_AUTH_SECRET` and `CRON_SECRET`
- Prompts you for a free [Composio API key](https://dashboard.composio.dev/login?flow=developer)
- Runs the Prisma schema sync
- Triggers the production deploy and opens the URL in your browser
- Optionally walks you through Telegram bot setup
- Tunes config (cron schedule, function timeouts) for your Vercel plan
- Re-running picks up where it left off

## Prerequisites

- A [Vercel account](https://vercel.com) (`npx vercel login` once)
- A [GitHub account](https://github.com) with `gh` CLI installed (`gh auth login` once)
- A free [Composio API key](https://dashboard.composio.dev/login?flow=developer)

## License

MIT - see the [main repo](https://github.com/ComposioHQ/trustclaw) for the LICENSE.
