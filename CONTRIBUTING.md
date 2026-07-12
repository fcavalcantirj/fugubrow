# Contributing to TrustClaw

Thanks for wanting to help! Whether you're fixing a bug, building a new feature, or improving the docs - contributions are welcome.

## Getting started

1. **Fork** the repo and clone your fork:

   ```bash
   git clone https://github.com/<your-username>/trustclaw && cd trustclaw
   ```

2. **Install dependencies:**

   ```bash
   pnpm install
   ```

3. **Set up your env:**

   ```bash
   cp .env.example .env
   ```

   Fill in `DATABASE_URL` (Postgres + pgvector), `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), and `COMPOSIO_API_KEY` (free at [Composio](https://dashboard.composio.dev/login?next=%2F~%2Fproject%2Fsettings%2Fapi-keys&flow=developer)).

4. **Apply the schema and run the dev server:**

   ```bash
   pnpm prisma db push
   pnpm dev
   ```

The app runs at http://localhost:3000.

## Development workflow

```bash
pnpm dev          # dev server with hot reload
pnpm typecheck    # TypeScript
pnpm lint         # ESLint
pnpm format:write # Prettier
pnpm build        # production build
```

Before submitting a PR, run `pnpm check` to typecheck + lint together.

## Project layout

The full architecture and conventions live in [`CLAUDE.md`](./CLAUDE.md). The high-level structure:

- `src/app/` - Next.js App Router pages
- `src/server/api/routers/trustclaw/` - tRPC procedures (one per file, with `.schema.ts` for input/output)
- `src/server/api/routers/trustclaw/agent/` - the AI agent runtime (tool loop, context management, system prompts)
- `src/components/ui/` - shadcn primitives
- `src/components/core/` - shared core components
- `prisma/schema.prisma` - database schema (Postgres + pgvector)
- `cli/` - the `trustclaw deploy` CLI (separate package)

## Coding conventions

A few things we care about (full list in [`CLAUDE.md`](./CLAUDE.md)):

- **One thing per file.** One component, one tRPC procedure, one schema per file.
- **Co-location.** Schemas live next to procedures (`.schema.ts`). Skeletons live next to components (`.skeleton.tsx`).
- **Type safety end-to-end.** No `any`, no `unknown`. Zod defines the contract; TypeScript enforces it.
- **Mobile-first.** Every page must work on mobile. Use Tailwind responsive prefixes (`sm:`, `md:`, `lg:`).
- **Theme-aware colors.** Use shadcn theme variables (`bg-card`, `text-muted-foreground`) - never hardcoded Tailwind colors like `bg-gray-100`.
- **Use shadcn primitives** from `~/components/ui` instead of building custom ones.
- **Icons** come from `lucide-react` only.
- **Dates/times** use `moment` - never raw `Date` methods.

## Submitting a PR

1. Create a feature branch off `main`.
2. Make your changes - keep them focused. One PR per logical change is much easier to review.
3. Run `pnpm check` (typecheck + lint) before pushing.
4. Open a PR with a clear title and a short description of what changed and why.

If your change touches the deploy flow (anything in `cli/`), please also test it end-to-end with `pnpm cli:deploy` against a fresh Vercel project.

## Reporting bugs / requesting features

Open an [issue](https://github.com/ComposioHQ/trustclaw/issues). For bugs, include:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (Node version, OS, deployment target)

## Security issues

If you find a security vulnerability, **don't** open a public issue. Email [sarah@composio.dev](mailto:sarah@composio.dev) directly.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
