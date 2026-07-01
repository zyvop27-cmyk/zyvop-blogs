# BullMQ + NestJS Demo: Background Job Processing

A working background-job pipeline built with **NestJS**, **BullMQ**, **Redis**, and **PostgreSQL** — modeled on a real use case: kicking off an LLM draft-generation call without blocking the HTTP request, with automatic retries and a durable, pollable status record.

Every behavior described below — happy path, retry-then-succeed, permanent failure after exhausting retries, and duplicate-jobId idempotency — was run end-to-end against real Postgres and Redis instances before this was published.

## Stack

- NestJS 10 (Express adapter)
- [BullMQ](https://docs.bullmq.io/) + `@nestjs/bullmq` — the job queue itself, backed by Redis
- PostgreSQL + TypeORM — the durable, queryable record of each job (separate from BullMQ's own Redis-backed job state)
- Redis — required by BullMQ; nothing else in this demo touches it directly

## Why a queue instead of just `await`-ing the call in the controller

Calling an LLM provider (or any slow, occasionally-flaky upstream API) directly inside a request handler ties that request's lifetime to the upstream call's lifetime. If it's slow, the client waits. If it fails, you're stuck choosing between failing the whole request or quietly swallowing the error — which is exactly how stale fallback content can end up silently shipping in place of real output.

Putting the call behind a queue instead means:

- The HTTP request returns immediately with a job id the client can poll.
- A failed attempt gets retried automatically with backoff, instead of becoming the final answer.
- The job's outcome (success, retried-then-succeeded, or permanently failed) is durably recorded — not just logged and forgotten.

## How the flow works

1. **`POST /drafts`** — validates the request, writes a `pending` row to Postgres, and enqueues a BullMQ job referencing that row's id. Returns immediately.
2. **The worker** (`DraftGenerationProcessor`) picks the job up, marks the row `processing`, and calls the (simulated) generation function.
3. **On success** — the row is updated to `completed` with the result and the number of attempts it took.
4. **On failure** — BullMQ retries automatically per the job's `attempts`/`backoff` config. Only once attempts are exhausted does the row get marked `failed`, with the error captured.
5. **`GET /drafts/:id`** — clients poll this to see current status, final result, or failure reason.

## Setup

```bash
npm install
cp .env.example .env   # fill in your Postgres + Redis connection details
```

You need both Postgres and Redis running locally. The quickest path is Docker:

```bash
docker run --name jobs-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jobs_demo -p 5432:5432 -d postgres:16
docker run --name jobs-redis -p 6379:6379 -d redis:7
```

Then start the API:

```bash
npm run start:dev
```

`synchronize: true` is enabled in `app.module.ts` for convenience — it creates the `draft_job` table automatically on first boot. **Turn this off and use real migrations before deploying.**

The worker runs in the same process as the API in this demo (`DraftGenerationProcessor` is just a provider in `DraftsModule`). For real production load, you'd typically run the worker as a separate process/deployment from the HTTP API, so a traffic spike on one doesn't starve the other — see the production notes below.

## API walkthrough (curl)

```bash
# 1. Enqueue a draft — returns immediately with a job id
curl -X POST http://localhost:3000/drafts \
  -H "Content-Type: application/json" \
  -d '{"topic":"NestJS background jobs"}'
# -> { "id": "...", "status": "pending" }

# 2. Poll for the result
curl http://localhost:3000/drafts/<id>
# -> { "id": "...", "topic": "...", "status": "completed", "result": "...", "attemptsMade": 1, ... }
```

`simulateFailures` is a demo-only field on the request body — it's not something a real client would send. It forces the worker to fail that many times before succeeding, so you can watch the retry/backoff path happen on demand instead of waiting for a real upstream outage:

```bash
# Fails twice (2s, then 4s exponential backoff), succeeds on the 3rd attempt
curl -X POST http://localhost:3000/drafts \
  -H "Content-Type: application/json" \
  -d '{"topic":"Retry demo","simulateFailures":2}'

# Poll a few times over the next ~6-8 seconds to watch status move
# pending -> processing -> completed, with attemptsMade ending at 3.
curl http://localhost:3000/drafts/<id>

# Exceeding the configured max attempts (3) shows the permanent-failure path
curl -X POST http://localhost:3000/drafts \
  -H "Content-Type: application/json" \
  -d '{"topic":"Permanent failure demo","simulateFailures":5}'
# -> after retries are exhausted: { "status": "failed", "failureReason": "...", "attemptsMade": 3 }
```

## Production notes

These were deliberately kept simple for a demo. Before shipping this for real:

- **Run the worker as a separate process from the API.** In this demo, `DraftGenerationProcessor` lives inside the same NestJS app as `DraftsController`. In production, split them into two deployments (e.g. two separate `main.ts`/entry points, or two replicas of the same image with different start commands) so an API traffic spike doesn't compete with the worker for CPU, and so you can scale each independently.
- **Set a sane `concurrency`** on the processor based on what the upstream API and your own database can actually sustain — `concurrency: 5` here is a demo default, not a sized number.
- **Distinguish retryable from non-retryable errors.** A 429 rate-limit or a network timeout should retry. A 401 from a bad API key, or a 400 from a malformed request, will fail identically on every retry — `throw new UnrecoverableError(...)` (exported by BullMQ) skips remaining attempts instead of wasting them.
- **Add an `onActive` or progress-reporting hook** if jobs can take long enough that "processing" alone isn't informative — BullMQ supports `job.updateProgress()`.
- **Monitor queue depth and failed-job count**, not just individual job outcomes — a queue that's silently backing up is a different problem than any single job failing.
- **`removeOnComplete`/`removeOnFail` ages** are set short in this demo (1 hour / 1 day) to keep Redis tidy. Tune those to your actual debugging/audit needs.

## Project structure

```
src/
├── app.module.ts          # wires Postgres, Redis/BullMQ, and DraftsModule
├── main.ts
└── drafts/
    ├── draft-job.entity.ts          # the durable Postgres record (status, result, attempts)
    ├── draft-content.generator.ts   # stand-in for a real LLM API call
    ├── draft-generation.processor.ts # the BullMQ worker
    ├── drafts.controller.ts          # POST /drafts, GET /drafts/:id
    ├── drafts.service.ts             # enqueueing + status updates
    ├── drafts.module.ts
    └── dto/create-draft.dto.ts
```
