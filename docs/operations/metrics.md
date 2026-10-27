# Codebase metrics

`bun run metrics` produces a JSON snapshot of source size, function complexity,
test size, Bun line/function coverage, 90-day git churn, and ranked hotspots.
The output is deliberately repository-local so it can be reviewed without a
dashboard or hosted service.

## Commands

```sh
bun run metrics          # print the current snapshot
bun run metrics:check    # run coverage and report against policy floors
bun run metrics:snapshot # append one snapshot to docs/metrics/history.jsonl
```

Snapshots are appended manually at release or milestone boundaries. Capture
them on an up-to-date `main` after the milestone's pull requests have merged,
then land the one-line append as its own small PR: the recorded `gitCommit` is
`HEAD` at capture time, so a snapshot taken on a feature branch names a commit
that excludes sibling work and may never reach `main`. The
history file is JSONL: one independently readable snapshot per line. It
contains the commit SHA when the repository has history; churn is `null` when
no file changed in the 90-day window.

## Signals

- **LoC:** non-blank TypeScript lines, split between source and test files.
- **Complexity:** AST-estimated cyclomatic complexity per function. ESLint
  warns on application functions above 10 and files above 300 lines.
  Repository CLI tooling has a wider allowance because it coordinates file,
  process, and report parsing operations.
- **Coverage:** Bun lcov coverage for files owned by each workspace. Bun reports
  lines and functions, not branches; unimported files are not in its coverage
  denominator.
- **Churn:** distinct commits touching each file in the last 90 days.
- **Hotspots:** `LoC × churn × max function complexity`, similar to `aidd
churn`. The top ten files are included in each snapshot.

Coverage floors live in `docs/metrics/policy.json`. They are a reported trend,
not a gate: CI runs `metrics:check` in its non-blocking advisory reports job
(ADR 0083), and a dip below a floor shows as a warning on the run. Raise a
floor only when the corresponding tests are part of the same change.

### What the `@daisy/db` unit floor owns

The `@daisy/db` lines floor tracks what unit tests own (DEC-195, following
bb62f871). Pure decision and validation rules live in their own modules
(`*-rules.ts`, `*-decisions.ts`, `*-state.ts`) or as exported functions with
unit tests. Durable write paths are integration-tested by policy against real
PostgreSQL, so their SQL stays in the unit denominator uncovered. The floor is
the measured level floored to an integer (73 at the CAP-F.2-cov candidate);
it never drops below the measured level, and it rises whenever a change
extracts more pure logic. These SQL-only modules (under 30% unit lines) and the
real-PG suites that own them (`packages/db/integration/` unless marked web,
which is `apps/web/integration/`):

| Module                                                                                                                        | Owning integration suites                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `media-reconcile-store.ts`, `media-reconcile-claims.ts`, `media-admission-store.ts`                                           | `media-reconcile`, `round-media-late-creation` (web)                                                      |
| `rating-operations.ts`                                                                                                        | `rating-standings`, `ratings` (web)                                                                       |
| `document-operations.ts`                                                                                                      | `debate-documents`, `document-workspace`, `debate-room-documents` (web)                                   |
| `round-ballot-operations.ts`, `round-ballot-reads.ts`                                                                         | `round-ballot-command`, `round-judging-jobs`, `round-ballot` (web)                                        |
| `attendance-operations.ts`, `attendance-facts.ts`                                                                             | `attendance-targets`, `attendance` (web), `attendance-public` (web)                                       |
| `attendance-evaluator.ts`, `transcript-finalization-streams.ts`                                                               | `attendance-evaluator` (web), `attendance-control-loss` (web)                                             |
| `availability-operations.ts`, `check-in-attempts.ts`                                                                          | `availability`, `attendance-retention`, `bounded-transaction-uncertainty`                                 |
| `round-bot-admission.ts`                                                                                                      | `bot-admission`, `bot-room-freeze`                                                                        |
| `bot-publication.ts`, `capture-history.ts`                                                                                    | `bot-publication`, `bot-worker-discovery`                                                                 |
| `bot-generation.ts`                                                                                                           | `bot-generation`, `round-worker-entrypoints`                                                              |
| `round-judging-jobs.ts`, `round-judging-claim.ts`, `round-judging-result.ts`, `round-unjudged-completion.ts`                  | `round-judging-jobs`, `round-judging-recovery` (web)                                                      |
| `round-judging-accounting.ts`                                                                                                 | `round-judging-accounting` (web)                                                                          |
| `round-agent-runs.ts`, `media-publication-authority.ts`                                                                       | `bot-round-locks`, `round-runtime` (web), `bot-activity-feed` (web)                                       |
| `round-write-authority.ts`, `round-command-operations.ts`                                                                     | `round-command`, `bot-publication`, `attendance-refusals` (web)                                           |
| `media-capture.ts`, `media-capture-context.ts`, `capture-stream.ts`, `captured-transcript.ts`, `media-participant-binding.ts` | `media-capture`, `capture-recovery`, `round-transcript-finalization` (web), `round-transcript-race` (web) |
| `media-capture-read.ts`, `media-worker-lease.ts`, `media-session-snapshot.ts`                                                 | `media-worker-lease`                                                                                      |
| `media-session.ts`                                                                                                            | `media-session`, `round-maintenance-fleet` (web)                                                          |
| `transcript-finalization.ts`, `frozen-transcript.ts`                                                                          | `round-transcript-finalization` (web), `round-transcript-race` (web), `round-history-reads` (web)         |
| `round-speaking-read.ts`, `round-protected-reads.ts`                                                                          | `round-history-reads` (web)                                                                               |
| `round-maintenance.ts`                                                                                                        | `round-maintenance`                                                                                       |
| `messaging/group-invitation-write.ts`                                                                                         | `messaging-group-creation` (web), `messaging-dm-requests` (web)                                           | Complexity and file-size |
| limits are enforced by `eslint.config.mjs` in the regular lint job.                                                           |

`aidd churn` can be run separately with `bunx --bun aidd churn` once a longer
git history exists. The repository does not depend on it for CI metrics.
