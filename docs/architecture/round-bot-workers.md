# Durable Round judging workers

PostgreSQL queues one job per assigned bot judge against the immutable frozen
transcript revision. Human-only and zero-judge casts create no artificial bot
job. Outbox delivery may wake a worker; startup discovery also scans durable
jobs at the explicitly configured interval, at most 500 ms.

`ROUND_BOT_WORKER_POLICY` is optional validated JSON. It supplies explicit
models, scan/lease/renewal/call bounds and process resource capacities. Without
it, job discovery stays inert. Configured application composition requires an
injected OS-CSPRNG token producer. Only the process edge supplies that producer;
the database uses the existing bounded transaction and connection pool. The
admitted Round busy cap and host allowance remain separate economic controls.

A worker claims a scoped job/run/epoch with a memory-only bearer. Stored lease
secrets are SHA3-256 digests. Renewal runs independently of provider calls and
attendance settlement. Provider capacity is an explicit process-local bound
with no waiting queue; cancellation holds its slot until the actual call
settles. Discovery and lease renewal never wait behind the model operation.

The feature maps only the actual frozen coverage and captured utterances into
the canonical rubric prompt. It strips actor identity/kind metadata and keeps
incomplete evidence explicit. Before dispatch it records the existing admitted
reservation and durable request intent atomically. The external call runs
outside transaction locks. A valid response and actual token usage are stored
before shared ballot submission.

Each submission freshly verifies the job and prepares the actual shared ballot
operation. The shared writer reacquires its canonical fences, checks the current
job lease in that same transaction, and gates final completion on actual settled
attendance. Success, result witness, cache clearing and run end commit together.
An attendance refusal retains the cached response across retries and lease
takeover. Unknown external outcomes remain recorded uncertainty; external
exactly-once execution is not promised.

Production startup begins the judging lifecycle only after public ingress is
ready. Shutdown aborts and awaits it before closing owned pools. Availability
keeps its separate lifecycle and existing service identity. Configured media
recovery separately runs every 500 ms and is also stopped before pool closure.
A provider/model/media failure does not itself create competitive absence or
forfeit evidence.

## Local provider recovery proof

With this checkout's isolated test services and an authorized configured
OpenRouter capability, run from the repository root:

```sh
bun --env-file=.env run proof:round-judging anthropic/claude-sonnet-5.5
```

The model argument is explicit. The script creates and drops a migrated per-run
test database, creates a real shared Room and assigned bot judge, and freezes
its silent transcript honestly incomplete. It calls the real provider once,
then proves cached-response takeover and repeated actual attendance refusal
without redispatch. Its output contains model/request/token counts and proof
labels only. This is provider/cache recovery evidence; the script does not
claim full played-Round, browser, media, or final-completion acceptance.

Worker failure events contain only operation and error code (privacy `none`).
No credential, bearer, raw exception, response text, transcript, or PCM is
written to logs or proof artifacts.
