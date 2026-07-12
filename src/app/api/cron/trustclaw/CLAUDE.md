# TrustClaw Cron System

## Overview

Vercel Cron hits `GET /api/cron/trustclaw` every minute (configured in `vercel.json`). This endpoint finds due cron jobs, claims them atomically, groups them by instance, and dispatches one `POST /api/cron/trustclaw/execute` invocation per instance for batched execution.

## Architecture

```
Vercel Cron (every minute)
    |
    v
GET /api/cron/trustclaw        (route.ts)
    |
    |  1. Atomic UPDATE ... RETURNING claims due + stale-locked jobs
    |  2. Sets lockedAt/lockedBy, clears nextRunAt (prevents re-pick)
    |  3. Groups claimed jobs by instanceId
    |  4. Dispatches one fetch() per instance with all jobIds
    |  5. Returns { dispatched: N, instances: M } in ~1s
    |
    +---> POST /execute  (instance X: jobs A,B)  \  One serverless
    +---> POST /execute  (instance Y: job C)     /  function per instance
              |
              |  1. Loads all jobs, validates fencing tokens
              |  2. Returns 202 immediately
              |  3. Combines prompts into one agent message
              |  4. Runs agent once via after() (background)
              |  5. Releases each job's lock individually (own nextRunAt)
              v
         runAgent() -> Telegram delivery (if linked)
```

## Locking & Concurrency

Jobs use DB-level locking via atomic `UPDATE ... WHERE` to prevent duplicates:

- **Claim**: Sets `lockedAt`, `lockedBy` (UUID), clears `nextRunAt`
- **Release**: On success/error, clears lock and recomputes `nextRunAt`
- **Fencing**: Release queries include `WHERE lockedBy = invocationId` so a stale-reclaimed lock can't be overwritten by the original holder
- **Stale recovery**: Jobs locked for >10 minutes are reclaimed (covers crashed functions)

| Scenario | How it's handled |
|---|---|
| Two concurrent cron invocations | Atomic UPDATE - only one wins per row |
| Job takes >60s, next tick fires | `nextRunAt=NULL` on claim prevents re-pick |
| Function crashes mid-run | Stale lock reclaimed after 10 minutes |
| Missed Vercel tick | Job runs once on next tick, schedule resumes |
| Job disabled while running | Toggle clears lock; running agent's release is a no-op |
| Job deleted while running | Row gone; release updates 0 rows |

## Key Files

| File | Purpose |
|---|---|
| `route.ts` | Cron handler - claims jobs, dispatches to execute |
| `execute/route.ts` | Per-job executor - runs agent via `after()`, releases lock |
| `execute/route.schema.ts` | Zod schema for execute endpoint body |
| `~/server/api/routers/trustclaw/agent/tools/cron-utils.ts` | `computeNextRunAt()`, `validateCronExpression()` |
| `~/server/api/routers/trustclaw/agent/run.ts` | `runAgent()` - the AI agent loop |
| `~/server/api/routers/trustclaw/toggleCronJob.ts` | Clears lock when disabling a job |
| `~/server/api/routers/trustclaw/getCronJobs.ts` | Exposes `lockedAt`, `lastError` to frontend |
| `prisma/schema.prisma` (`CronJob` model) | `lockedAt`, `lockedBy`, `lastError` fields |

## Database Schema (CronJob)

```
id, instanceId, expression, prompt, timezone, enabled,
lastRunAt, nextRunAt, lockedAt, lockedBy, lastError
```

## Local Testing

Requires `psql` for DB commands and the dev server running (`pnpm dev`).

```bash
# List all jobs and their status (RUNNING/DUE/SCHEDULED/ERRORED/IDLE)
./scripts/test-cron.sh list

# Make a job due by setting nextRunAt to the past
./scripts/test-cron.sh make-due <job-id>
./scripts/test-cron.sh make-due <job-id> "5 minutes ago"

# Trigger the cron (with dev server running)
./scripts/test-cron.sh trigger

# Trigger with a fake time (dev only - ignored in production)
./scripts/test-cron.sh trigger --now "2025-06-15T09:00:00Z"

# Check a job's full status (lock state, error, timestamps)
./scripts/test-cron.sh status <job-id>

# Force-unlock a stuck job
./scripts/test-cron.sh unlock <job-id>
```

**Typical test flow:**

1. `./scripts/test-cron.sh list` - find a job ID
2. `./scripts/test-cron.sh make-due <id>` - make it due
3. `./scripts/test-cron.sh trigger` - fire the cron
4. `./scripts/test-cron.sh status <id>` - verify lock cleared, `lastRunAt` updated

**Date override (`--now`):** The cron route accepts a `?now=` query param in development mode. This overrides `new Date()` for the claim query and flows through to the execute endpoint for `lastRunAt`. Useful for testing time-specific schedules without waiting or manipulating the DB.
