# CLAUDE.md

## fuguBrow — what this repo is

**fuguBrow** is a fork of [ComposioHQ/trustclaw](https://github.com/ComposioHQ/trustclaw) — a self-hostable 24/7 personal AI agent (web + Telegram, vector memory, 1000+ Composio tools, cron) — **re-wired off the Vercel AI Gateway onto flat-rate providers** (Sakana fugu ~$10/mo flat subscription; Vercel **Pro**; Jina / Composio / Neon on free tiers) and dressed in a custom cyberpunk-pirate front end.

**Live:** https://fugubrow.vercel.app · **Vercel:** project `fugubrow`, scope `felipecavalcanti-2709s-projects`

### Provider wiring (the fork's core change)
- **Chat / agent → Sakana `fugu`** (OpenAI-compatible `https://api.sakana.ai/v1`, `SAKANA_API_KEY`; models `fugu` / `fugu-ultra`). Stock trustclaw hard-wires the **Vercel AI Gateway** with `anthropic/…` model strings and has no env override, so this required a **code change**, not config.
- **Memory embeddings → Jina `jina-embeddings-v4`** (OpenAI-compatible `https://api.jina.ai/v1`, `JINA_API_KEY`; **2048-dim** → pgvector `VECTOR(2048)`). Sakana ships no embeddings endpoint.
- Both providers are created in **`src/server/clients/model.ts`** (`@ai-sdk/openai-compatible`, exports `chatModel()` + `embeddingModel()`).
  - Chat call sites: `agent/setup.ts`, `agent/compaction/{run-compaction,memory-flush}.ts`.
  - Embedding sites: `agent/tools/memory-{save,search}.ts`.
  - Model allow-list: `createInstance.schema.ts` (`fugu` / `fugu-ultra`); Prisma default `anthropicModel = "fugu"` (legacy field name kept to avoid a rename sweep).
- **No Vercel AI Gateway, no OpenAI/Anthropic keys.** **Rate limiting is OFF** (`RATE_LIMIT_ENABLED=false`).

### Landing page + hidden login
- Public landing = a **cyberpunk-pirate "GH0ST CAPTAIN"** page (glitch title, 3D grid, CRT scanlines, HUD-framed portrait, ticker): `src/app/_components/landing-page.tsx` + `src/app/_components/pirate.css`; fonts Orbitron + JetBrains Mono (in `layout.tsx`); Captain photo `public/images/home-hero.jpg`.
- **There is no visible login / Get-Started.** Access to `/login` is a hidden client-side easter egg — see `SECRET` and `secretTap()` in `src/app/_components/landing-page.tsx` for the exact key sequence and tap target. The `/login` URL also works directly.
- App icon = teal cyber skull-and-crossbones: `src/app/icon.png` (favicon), `src/app/apple-icon.png` (iOS), `public/icons/icon-{192,512}.png` + `src/app/manifest.ts` (PWA).

### Env / secrets
All in a gitignored `.env`, mirrored to **Vercel Production**:
`SAKANA_API_KEY`, `SAKANA_BASE_URL`, `JINA_API_KEY`, `JINA_BASE_URL`, `COMPOSIO_API_KEY`, `DATABASE_URL` (Neon + pgvector), `BETTER_AUTH_SECRET`, `CRON_SECRET`, `RATE_LIMIT_ENABLED=false`; optional `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` / `TELEGRAM_WEBHOOK_SECRET`.

### Deploy / redeploy
Deployed directly with the Vercel CLI (NOT the interactive `npx @composio/trustclaw deploy`):
```bash
vercel env add <NAME> production            # once per var (value via stdin)
vercel deploy --prod --yes --scope felipecavalcanti-2709s-projects
```
`.vercelignore` keeps `.env` out of the upload; the Vercel build runs `prisma db push` + `next build`.

### Gotchas (hard-won)
- **`@ai-sdk/openai-compatible` must be v2** — v3 emits provider spec V4, incompatible with `ai@6`'s V2/V3 model types.
- **Jina v4 returns 2048 dims** (not 1024 as its docs claim) → column is `VECTOR(2048)`. Safe because there's no ivfflat/hnsw index on it.
- **Rate limiter fails *closed* without Redis** (prod default `RATE_LIMIT_FAIL_MODE=closed`) → keep `RATE_LIMIT_ENABLED=false` or add `REDIS_URL`. Symptom if wrong: every chat/Telegram message returns "You're sending messages too quickly."
- **Neon free compute auto-suspends** → first `prisma db push` may `P1001` on a cold start; retry.
- **`maxDuration` bounds the whole agent loop, not just the HTTP response.** The loop runs inside Next's `after()`, which still dies at the route's `maxDuration`. It was `60` while `stopWhen: stepCountIs(100)` allows minutes → long runs (many ~10s Composio remote-sandbox steps) were hard-killed mid-loop, so `onFinish` (the only code that persists the reply + sends the final message) never ran → empty assistant row, no answer, bot stuck on "Working on it…", no memory saved. Fixed 2026-07-15: `maxDuration=300` + a 260s wall-clock stop + incremental persistence. Full analysis in **Execution model & long-running agents** below.

### Execution model & long-running agents

Documented 2026-07-15 after debugging the "bot never finishes" bug, so the context isn't lost.

- **How the agent runs (verified in code):** the loop is called *directly inside the serverless route handlers* — `agent.generate()` in `telegram-webhook/route.ts` + `cron/trustclaw/execute/route.ts`, `agent.stream()` in `chat/route.ts` — each wrapped in Next's `after()`. There is **no queue and no worker process** (verified: no inngest / trigger.dev / temporal / bullmq in deps or `src/`). Durability lives at the **data** layer only (conversation/memory/compaction → Postgres; resumable streams → Redis), **not** the execution layer — nothing resumes a loop that gets killed.
- **Why it broke:** `after()` is **not** unbounded background time — it's bounded by the route's `maxDuration` (was `60`). Work budget (`stepCountIs(100)`) ≫ time budget (60s), so long runs were hard-killed; a hard kill runs no `catch`/`finally`, so `onFinish` never ran → the empty-row / no-reply / no-memory failure above.
- **Fix in place (deployed):** `maxDuration = 300` on the three agent routes (Vercel **Fluid Compute is enabled** — `resourceConfig.fluid: true`, verified via the projects API — which lifts even this **Hobby** plan to ~300s); a **wall-clock stop at 260s** (`AGENT_MAX_RUN_MS` in `setup.ts`, inside `stopWhen` next to `stepCountIs(100)`) so `onFinish` always runs before the kill; **incremental persistence** each step (`persistAssistantProgress` in `setup.ts`, called from `onStepFinish`) so a kill never erases work; structured logs in `src/server/clients/logger.ts`. Verified live: the 12-step task that died empty at 60s now runs ~98s and completes with the row growing incrementally.
- **Hard ceiling (Vercel's documented limits, not re-verified this session):** with Fluid Compute, ~300s on Hobby, up to ~800s (~13 min) on Pro/Enterprise. That's the absolute wall for any serverless function — you can't design around it. Serverless/`after()` is fine for interactive turns *under* the cap; it's the wrong place to *host* genuinely long or open-ended agent execution.
- **Does TrustClaw/fuguBrow have a persistent worker? No** — serverless-by-design (verified above); you'd have to add one. **Does OpenClaw? Effectively yes** — it's a long-lived gateway/process in a container, which is why the `acc-openclaw-render` agents run 24/7 on Render. (Not verified against OpenClaw source this session — from Felipe's deployment context — and OpenClaw has its *own* internal run-timeout knobs, e.g. the "180s embedded run timeout" class of issue.)
- **Scaling path — when a turn genuinely needs >5 min or true 24/7 autonomy (least → most work):** (1) **stay serverless** — fine while turns fit 300s; (2) **managed durable execution** — Inngest or Trigger.dev: keep the Next.js app, wrap the agent turn as their task, get long timeouts + retries + steps with minimal infra; (3) **roll your own worker + queue** on Render/Fly (Felipe already runs containers there via `acc-openclaw-render`); (4) **Temporal** — heavyweight, only if orchestration gets serious. Pattern in every case: **Vercel = front door (webhook / UI / API) → enqueue → worker runs the loop → streams progress back.** Recommendation: don't build until a turn actually needs >5 min; then lean 1→2, or adopt the OpenClaw container model for anything meant to run truly 24/7.

### Git / GitHub account
This is a **personal** repo: `github.com/fcavalcantirj/fugubrow`, owned by the personal account **`fcavalcantirj`** (`felipe.cavalcanti.rj@gmail.com`). The repo's git identity is already set to this personal account — commits are authored correctly by default; **do not** author commits as the work account (`fcavalcanti-onvida` / `dev@onvida.com.br`).
- **`origin` is the personal SSH remote** (`git@github.com:fcavalcantirj/fugubrow.git`, set 2026-07-15). SSH authenticates as the personal account (verified `ssh -T git@github.com` → "Hi fcavalcantirj!"), so a plain **`git push` just works** as `fcavalcantirj` — no `gh`, no keychain.
- **The HTTPS trap (don't go back):** over HTTPS the macOS keychain caches the **work** account `fcavalcanti-onvida`, which has **no push access** here → `git push` returns `403`. So do **not** switch `origin` back to the `https://` URL, and do **not** use the `gh auth switch` / `gh auth git-credential` workaround. Keep the SSH remote.

### Project links
- Live app: https://fugubrow.vercel.app
- Neon DB: https://console.neon.tech/app/projects/divine-frog-15918269/branches/br-misty-unit-at7vma6d
- Jina keys: https://jina.ai/api-dashboard/key-manager
- Sakana console: https://console.sakana.ai/
- Mastra: https://projects.mastra.ai/

---

## Product overview

**fuguBrow** (fork of TrustClaw) — a self-hostable personal AI agent with vector memory, Composio tools, and a Telegram bot. The sections below document the **codebase conventions** (inherited from TrustClaw; still accurate for this repo).

## Tech Stack

- **Framework:** [Next.js 15](https://nextjs.org/docs/15/) (App Router)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/docs) + [shadcn/ui](https://ui.shadcn.com/docs/)
- **Auth:** [Better Auth](https://www.better-auth.com/) with username/password login.
- **Server:** [tRPC](https://trpc.io/docs/) for all backend logic
- **Date/Time:** [moment.js](https://momentjs.com/docs/) for all date formatting and parsing

When you need to look up documentation for any of these libraries, use the **Context7 MCP** (`mcp__plugin_context7_context7__resolve-library-id` → `mcp__plugin_context7_context7__query-docs`) to get up-to-date docs. For **shadcn/ui** specifically, use the **shadcn MCP** tools instead.

## Architecture

This dashboard uses a **single tRPC backend** running within Next.js. Auth is handled by Better Auth with username/password. Composio functionality is accessed server-side using a global API key. All chat and embedding calls go through **`src/server/clients/model.ts`** — **Sakana `fugu`** for chat and **Jina `jina-embeddings-v4`** for embeddings, both OpenAI-compatible via `@ai-sdk/openai-compatible`. (Upstream TrustClaw routed these through the Vercel AI Gateway; fuguBrow does not — see the fuguBrow section at the top.)

### tRPC (Backend)

- Runs within the Next.js app (`src/server/api/`)
- Handles all data fetching, mutations, and business logic
- Access via `trpc.*` hooks from `~/clients/trpc/react`
- Composio SDK calls happen inside tRPC procedures using the global `COMPOSIO_API_KEY`

### Better Auth

- Server config at `src/server/auth.ts`
- Route handler at `src/app/api/auth/[...all]/route.ts`
- Client module at `src/clients/auth/react.tsx` (exports `authClient` from `better-auth/react`)
- Username/password login via Better Auth (no OAuth providers)
- Session model: `{ user, session }` (no org/project)

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js Dashboard                    │
├─────────────────────────────────────────────────────────┤
│  tRPC Client          │       Better Auth Client        │
│  ~/clients/trpc       │       ~/clients/auth            │
└──────────┬────────────┴──────────────┬──────────────────┘
           │                           │
           ▼                           ▼
┌──────────────────────┐    ┌─────────────────────────────┐
│   tRPC Server        │    │     Better Auth Server      │
│   (Next.js API)      │    │   src/server/auth.ts        │
│                      │    │   + username/password       │
└──────────────────────┘    └─────────────────────────────┘
```

## Principles

- **Co-location:** Related files live together. Skeletons with components (`.skeleton.tsx`), schemas with procedures (`.schema.ts`). Find everything in one place.
- **Type safety end-to-end:** Zod schemas define the contract, TypeScript enforces it. No `any`, no `unknown`, no guessing. Import types from their source (`RouterOutput`, schema types).
- **One thing per file:** One component, one procedure, one schema per file. Easy to find, easy to maintain, easy to delete.
- **Optimize performance:** Leverage prefetching, pulling session information from the server.
- **Mobile-first:** Every page and component MUST be responsive and usable on mobile screens. Design for small screens first, then enhance for desktop with responsive Tailwind breakpoints.

## Repo structure

```
src/
├── app/                          # Next.js App Router
│   ├── api/
│   │   ├── auth/[...all]/        # Better Auth route handler
│   │   └── trpc/                 # tRPC route handler
│   ├── (authenticated)/          # Protected routes (redirects to /login if no session)
│   │   └── dashboard/            # Main authenticated area
│   │       ├── page.tsx
│   │       ├── settings/
│   │       └── ...
│   └── <route>/
│       ├── page.tsx              # Page component
│       ├── layout.tsx            # Optional layout
│       └── _components/
│           ├── <name>.tsx            # Page-specific components
│           ├── <name>.schema.ts      # Optional form schema
│           └── <name>.skeleton.tsx   # Optional skeleton
├── clients/                      # Clients (trpc, auth)
├── components/
│   ├── ui/                       # Base shadcn primitives
│   └── core/                     # Shared core components
└── server/
    ├── auth.ts                   # Better Auth server config
    ├── api/
    │   ├── trpc.ts               # Procedure definitions
    │   ├── root.ts               # Root router
    │   └── routers/
    │       └── trustclaw/
    │           ├── index.ts              # Router definition
    │           ├── <procedure>.ts        # Procedure implementation
    │           └── <procedure>.schema.ts # Zod schemas (input, output)
    └── clients/                  # clients used in trpc procedures/context
```

## Commands

- `pnpm install` - Install dependencies
- `pnpm dev` - Run dev server
- `pnpm build` - Build for production (`prisma generate && next build`)
- `pnpm lint` - Run linting
- `pnpm auth:generate` - Generate Better Auth client types via Better Auth CLI

## Full Stack Development Rules

### Pages

- Pages live in `src/app/<route>/page.tsx` (Next.js App Router)
- Page-specific components go in a sibling `_components/` folder

### Components

- MAXIMALLY use shadcn primitives from `~/components/ui`.
- Page/feature-specific components in `_components/` alongside `page.tsx`
- Shared components (error screen, error boundary, toast, virtualized lists) in `components/core/`
- One component per file - _never_ stack multiple components

### Icons

- ALWAYS import icons from `lucide-react` - this is the icon library used by shadcn
- NEVER use other icon libraries (e.g., `react-icons`, `heroicons`, `@phosphor-icons`)
- Browse available icons at https://lucide.dev/icons

  ```typescript
  import { Plus, Trash2, Settings, ChevronRight } from "lucide-react";

  <Button>
    <Plus className="h-4 w-4" />
    Add Item
  </Button>
  ```

### Shadcn Primative Components

- Use the shadcn mcp to discover new primatives
- Use the shadcn command line to add/update primatives to `~/components/ui`

### Links & Navigation

- NEVER use raw `<a>` tags for internal navigation - use `<Link>` from `next/link`
- NEVER use `window.location` - use `useRouter()` from `next/navigation` for programmatic navigation

### State Management

- Prefer derived state and tRPC query data over `useState`/`useEffect` mirrors
- **Query/mutation states:** use `{ isLoading, error, data }` from tRPC hooks
- **Form states:** use `react-hook-form` with Zod + shadcn Form component
- **Auth/session states:** prefer passing session information from server components, fall back to `authClient.useSession()` from `~/clients/auth/react`
- **Complex real-time state:** use best judgement - Zustand is acceptable for features like streaming chat where you need a shared store with fine-grained updates across multiple components

### Session Data

When rendering data that's already available on the server (e.g., session data like user email), pass it as props from server components instead of fetching/hydrating on the client:

```typescript
// page.tsx (server component)
import { authServer } from "~/clients/auth/server";

export default async function Page() {
  const result = await authServer.getSession();
  if (result.status !== "authenticated") return null;

  const { user, session } = result.session;

  return (
    <Dashboard
      userEmail={user.email}
      userName={user.name}
    />
  );
}
```

### Types/Props

- NEVER create "types" files for props
- Import `RouterOutputs` from `~/clients/trpc` for tRPC prop types:

  ```typescript
  import type { RouterOutputs } from "~/clients/trpc";

  type Tool = RouterOutputs["tools"]["getList"]["items"][number];
  ```

### Schemas & Forms

- Frontend forms MUST import schemas from `.schema.ts` files
- Exports: `<name>Input`, optionally `<name>Output`
- Also export inferred types: `type <Name>Input = z.infer<...>`
- Never duplicate Zod schemas between frontend and backend
- Never re-write types -- always infer the types directly!!

**tRPC mutation forms** - import schema from the procedure's `.schema.ts` in `server/api/routers/`:

```typescript
import {
  createItemInput,
  type CreateItemInput,
} from "~/server/api/routers/items/createItem.schema";
```

### tRPC Procedures

- One procedure per file
- Procedure exports: `publicProcedure`, `protectedProcedure`
- Register routers in `src/server/api/root.ts`

### Mutations

**ALWAYS HANDLE ERRORS, LOADING AND SUCCESS STATES AS FOLLOWS:**

- Errors: use `trpcToastOnError` (drop-in `onError` callback) or `showTrpcErrorToast(error)` (manual in catch blocks) from `~/components/core/toast-notifications`
  - NEVER use generic `showErrorToast` for mutation errors - always use the typed `trpcToastOnError` / `showTrpcErrorToast`
- Loading: optimistic updates (`utils.setData`) where appropriate, `<Spinner/>` from `components/ui` otherwise
- Success: call `utils.invalidate()` for affected queries

**ALWAYS use `mutateAsync`, NEVER use `mutate`.** This ensures consistent async/await error handling and avoids silent failures.

**tRPC mutation error handling example:**

```typescript
const utils = trpc.useUtils();
const createItem = trpc.items.create.useMutation({
  onError: trpcToastOnError,
  onSuccess: () => void utils.items.list.invalidate(),
});

// With try/catch for custom logic
try {
  await createItem.mutateAsync({ name: "New Item" });
  showSuccessToast("Item created");
} catch (error) {
  showTrpcErrorToast(error);
}
```

### Queries

**ALWAYS HANDLE ERRORS, LOADING AND SUCCESS STATES AS FOLLOWS:**

- Errors:
  - use `<ErrorDisplay />` from `components/core` with refetch button for page-wide failures
  - show user friendly error message that stylistically matches for other types of query failures
- Loading: use co-located skeleton components (see below)
- Success: render the data

**Refetch behavior:** Use TanStack Query's declarative options instead of `useEffect` + `invalidate()`:

- Need fresh data on mount (e.g., after in-app navigation)? Use `refetchOnMount: "always"` - not a `useEffect` that calls `utils.*.invalidate()`
- Need fresh data on window focus? Use `refetchOnWindowFocus: true` (default) or `"always"` for critical real-time data - never disable with `false` unless there's a strong reason
- When effects depend on query data and `refetchOnMount: "always"` is set, guard with `!isFetching` to avoid acting on stale cache before the refetch resolves

### Error Handling

Two error components in `components/core/` serve different purposes:

- **`<ErrorBoundary>`** - Catches unexpected runtime crashes in client components. Wrap any client component subtree that could throw during rendering (e.g., components parsing dynamic data, complex interactive widgets). Prevents a single crash from taking down the entire page. Accepts an optional `fallback` prop for custom crash UI.

  ```typescript
  import { ErrorBoundary } from "~/components/core/error-boundary";

  // In a page or layout wrapping client components
  <ErrorBoundary>
    <ToolsList />
  </ErrorBoundary>

  // With custom fallback
  <ErrorBoundary fallback={<p>Failed to load tools.</p>}>
    <ToolsList />
  </ErrorBoundary>
  ```

- **`<ErrorDisplay>`** - For expected/handled error states (failed queries, API errors). Use when you have an `error` from a query/mutation hook and want to show a user-friendly message with a retry action.

**When to use which:**

| Scenario                                  | Component                       |
| ----------------------------------------- | ------------------------------- |
| Query/mutation returns an error           | `<ErrorDisplay>`                |
| Component might crash during render       | `<ErrorBoundary>` wrapping it   |
| Page-level data fetch failure             | `<ErrorDisplay>` with "refresh" |
| Isolating risky client component subtrees | `<ErrorBoundary>`               |

### Prefetching

Maximally use prefetching to improve client performance!

**Prefetching tRPC queries** - add prefetch in `page.tsx` server component, consume in client components:

```typescript
// page.tsx (server component)
import { trpcServer } from "~/clients/trpc/server";

export default async function DashboardPage() {
  // void = fire-and-forget, warms cache without blocking render
  void trpcServer.api.tools.getList.prefetch();

  return (
    <trpcServer.HydrateClient>
      <ToolsList /> {/* trpc.*.useQuery picks up cached data, or shows loading if still fetching */}
    </trpcServer.HydrateClient>
  );
}
```

**Prefetching pages** - `<Link>` auto-prefetches in viewport. Otherwise, for common user flows/navigations, leverage `router.prefetch(..)`. Learn more at https://nextjs.org/docs/app/guides/prefetching

### Skeletons

- Components needing loading states have a sibling `.skeleton.tsx` file
- Skeleton mirrors the component's layout using `<Skeleton />` from `~/components/ui/skeleton`
- Example: `user-card.tsx` → `user-card.skeleton.tsx`

  ```typescript
  import { Skeleton } from "~/components/ui/skeleton";

  export function UserCardSkeleton() {
    return (
      <div className="flex items-center gap-3 p-4">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    );
  }
  ```

### Auth

- Protected pages go inside `app/(authenticated)/` - auto-redirects to `/login` if no session
- Better Auth manages client session state internally (no `SessionHydrator` needed)
- Session model is `{ user, session }` - there is no org or project concept

**Server components:**

```typescript
import { authServer } from "~/clients/auth/server";

// Get session with detailed status
const result = await authServer.getSession();
if (result.status === "authenticated") {
  const { user, session } = result.session;
}
```

**Client components:**

```typescript
import { authClient } from "~/clients/auth/react";

// Access session (Better Auth manages state internally)
const { data } = authClient.useSession();
const user = data?.user;
const session = data?.session;
```

**Username/password sign-in:**

```typescript
import { authClient } from "~/clients/auth/react";

await authClient.signIn.username({
  username: "user",
  password: "password",
  callbackURL: "/dashboard",
});
```

**Logout:**

```typescript
import { authClient } from "~/clients/auth/react";

await authClient.signOut();
```

### API Calls

- All data fetching goes through tRPC: use `trpc` from `~/clients/trpc` (e.g., `trpc.*.useQuery()`)
- NEVER use raw `fetch` for API calls
- Composio SDK calls happen server-side inside tRPC procedures using the global `COMPOSIO_API_KEY` from env

**tRPC queries:**

```typescript
import { trpc } from "~/clients/trpc";

const { data, isLoading, error } = trpc.health.ping.useQuery();
```

**tRPC infinite queries:**

```typescript
import { trpc } from "~/clients/trpc";

const { data, isLoading, error, hasNextPage, fetchNextPage } =
  trpc.items.list.useInfiniteQuery(
    { limit: 50 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    },
  );
```

**tRPC mutations:**

```typescript
import { trpc } from "~/clients/trpc";

const utils = trpc.useUtils();
const createItem = trpc.items.create.useMutation({
  onSuccess: () => {
    void utils.items.list.invalidate();
  },
});

// usage
//await createItem.mutateAsync({ name: "New Item" });
```

**tRPC subscriptions (SSE):**

Used for real-time streaming (e.g., agent chat). The client uses `splitLink` to route subscriptions via `httpSubscriptionLink`:

```typescript
// Client setup (in trpc client config) - route subscriptions separately
import { splitLink, httpSubscriptionLink, httpBatchStreamLink } from "@trpc/client";

splitLink({
  condition: (op) => op.type === "subscription",
  true: httpSubscriptionLink({ url: getBaseUrl() + "/api/trpc", transformer: SuperJSON }),
  false: httpBatchStreamLink({ url: getBaseUrl() + "/api/trpc", transformer: SuperJSON }),
});
```

```typescript
// Server - define a subscription procedure with observable
import { observable } from "@trpc/server/observable";

export const chat = protectedProcedure
  .input(chatInput)
  .subscription(({ input, ctx }) => {
    return observable<StreamEvent>((emit) => {
      const abortController = new AbortController();

      runStream({ input, emit, signal: abortController.signal })
        .catch((error) => {
          emit.next({ type: "error", message: error.message });
          emit.complete();
        });

      return () => abortController.abort(); // cleanup on unsubscribe
    });
  });
```

```typescript
// Client - consume with useSubscription (controlled via enabled flag)
const [isActive, setIsActive] = useState(false);

trpc.domain.procedure.useSubscription(input, {
  enabled: isActive,
  onData: (event) => { /* handle streaming events */ },
  onError: (err) => { /* handle errors */ },
});
```

### Database (Prisma)

The local tRPC backend uses Prisma with Neon PostgreSQL (including pgvector for embeddings).

**Schema changes:** Use `pnpm prisma db push` for development (not migrations). Verify `DATABASE_URL` points at the fuguBrow Neon project (`ep-tiny-heart-atto5u14`, project `divine-frog-15918269`) before pushing. The memory embedding column is `VECTOR(2048)` (Jina v4).

**Prisma in tRPC context:** Access via `ctx.prisma` in procedures.

**Standard queries** - use Prisma's typed API:

```typescript
const items = await ctx.prisma.item.findMany({
  where: { userId, archived: false },
  select: { id: true, name: true },
  orderBy: { createdAt: "desc" },
});
```

**Raw SQL for pgvector** - use `$queryRaw` for vector operations since `Unsupported("VECTOR(2048)")` columns can't use the standard Prisma API. ALWAYS validate `$queryRaw` results with a Zod schema - never use TypeScript generics (`$queryRaw<Type>`) since those are compile-time-only assertions with no runtime safety:

```typescript
// In the .schema.ts file - define a Zod schema for the row shape
export const memoryRow = z.object({
  id: z.string(),
  content: z.string(),
  similarity: z.number(),
});
export type MemoryRow = z.infer<typeof memoryRow>;
```

```typescript
// Insert with embedding (void query - no validation needed)
const embeddingString = `[${embedding.join(",")}]`;
await prisma.$queryRaw`
  INSERT INTO composio_claw_memory (id, "instanceId", content, embedding, "createdAt")
  VALUES (${id}, ${instanceId}, ${content}, ${embeddingString}::vector, NOW())
`;

// Cosine similarity search - wrap result with z.array().parse()
const results = z.array(memoryRow).parse(
  await prisma.$queryRaw`
    SELECT id, content, 1 - (embedding <=> ${queryEmbedding}::vector) AS similarity
    FROM composio_claw_memory
    WHERE "instanceId" = ${instanceId}
    ORDER BY embedding <=> ${queryEmbedding}::vector
    LIMIT ${maxResults}
  `,
);
```

### External SDK Clients

Some features use external SDKs directly. These clients live in `src/server/clients/`:

```
src/server/clients/
├── composio.ts   # Composio SDK (@composio/core) - uses global COMPOSIO_API_KEY from env
├── telegram.ts   # Telegram Bot API helper
├── redis.ts      # Redis client (resumable streams, streaming state, abort flags)
└── db.ts         # Prisma client
```

- Import and use these in tRPC procedures, NOT in client components
- Each client file exports helper functions, not raw SDK instances
- API keys come from `env` (validated via `~/env`) or from the database (per-instance keys)

### Responsive Design (Mobile-First)

Every page and component MUST be mobile-friendly. Use Tailwind's responsive breakpoint prefixes to progressively enhance layouts for larger screens.

- **Mobile-first approach:** Write base styles for mobile, then add `sm:`, `md:`, `lg:` prefixes for larger screens
- **Breakpoints:** `sm` (640px), `md` (768px), `lg` (1024px), `xl` (1280px)
- **Common responsive patterns:**

  ```typescript
  // WRONG - desktop-only fixed layout
  <div className="flex gap-6">
    <aside className="w-64">...</aside>
    <main className="flex-1">...</main>
  </div>

  // CORRECT - stacks on mobile, side-by-side on desktop
  <div className="flex flex-col md:flex-row gap-4 md:gap-6">
    <aside className="w-full md:w-64">...</aside>
    <main className="flex-1">...</main>
  </div>

  // Responsive grid
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" />

  // Responsive padding/spacing
  <div className="p-4 md:p-6 lg:p-8" />

  // Hide/show elements by breakpoint
  <span className="hidden md:inline">Full Label</span>
  <span className="md:hidden">Short</span>

  // Responsive text
  <h1 className="text-xl md:text-2xl lg:text-3xl" />
  ```

- **Tables:** Use horizontal scroll (`overflow-x-auto`) on mobile, or restructure as cards/stacked lists at small breakpoints
- **Dialogs/Sheets:** Consider using `Sheet` (slide-in panel) on mobile instead of large centered dialogs
- **Touch targets:** Ensure buttons and interactive elements are at least 44px tap targets on mobile
- **Forms:** Stack form fields vertically on mobile; multi-column layouts only at `md:` and above
- **Text overflow:** Use `truncate` or `line-clamp-*` for long text that could break mobile layouts

### Theming & Colors

We rarely need to make custom components since we are maximally using shadcn primatives. However, when we do, it is important to follow these guidelines.

- NEVER use hardcoded Tailwind color classes (e.g., `text-gray-500`, `bg-blue-600`, `border-slate-200`)
- ALWAYS use shadcn theme variables defined in `src/styles/globals.css` - these adapt to light/dark mode automatically
- Available theme colors: `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `chart-1`--`chart-5`, `sidebar-*`

  ```typescript
  // WRONG - hardcoded colors
  <div className="bg-gray-100 text-gray-900 border-gray-200" />

  // CORRECT - theme-aware colors
  <div className="bg-muted text-foreground border-border" />

  // Common patterns:
  // bg-background, bg-card, bg-muted, bg-accent, bg-popover, bg-destructive
  // text-foreground, text-muted-foreground, text-primary-foreground, text-destructive
  // border-border, border-input
  // ring-ring
  ```

### Environment Variables

- ALWAYS use the `env` helper from `~/env` instead of raw `process.env` - it provides type safety and validation via Zod
- Only use `process.env` directly in root config files that run before the app bootstraps (e.g., `next.config.js`) where the `env` helper is unavailable
- Key server-only env vars: `SAKANA_API_KEY`, `JINA_API_KEY`, `COMPOSIO_API_KEY`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `CRON_SECRET`, `RATE_LIMIT_ENABLED` (see the fuguBrow section at the top for the full list). No Vercel AI Gateway / OpenAI keys are used.
- There are no `NEXT_PUBLIC_BACKEND_URL` or similar public backend env vars - all API calls go through tRPC

  ```typescript
  // WRONG - no validation, no type safety
  const key = process.env.COMPOSIO_API_KEY;

  // CORRECT - validated and typed
  import { env } from "~/env";
  const key = env.COMPOSIO_API_KEY;
  ```

### Date & Time

- ALWAYS use `moment` for date formatting and parsing - never use raw `Date` methods, `Intl.DateTimeFormat`, or `toLocaleString`
- Import as `import moment from "moment"`

  ```typescript
  // WRONG - raw Date methods
  date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);

  // CORRECT - moment.js
  moment(date).format("HH:mm:ss");
  moment(date).format("MMM D, YYYY h:mm A");
  moment(date).fromNow(); // "2 hours ago"
  ```

### Hygiene

- No `console.log` statements
- No unnecessary comments

## Self-Improvement

After completing a feature, check whether any patterns, conventions, or lessons learned during implementation are missing from or inconsistent with:

- **`CLAUDE.md`** -- update if new conventions were established, existing rules are outdated, or important patterns are undocumented
- **`.claude/skills/implement-feature/SKILL.md`** -- update if the workflow needs new steps, checklists are incomplete, or code snippets are stale

This keeps documentation aligned with the actual codebase as it evolves.

## Boundaries

- Never commit secrets or modify `.env` files
- Never use `any` or `unknown` - always use specific types
- Ask before adding dependencies or changing CI/workflows
- Avoid editing build outputs (`dist/`, `.next/`, `.turbo/`) or `node_modules/`
