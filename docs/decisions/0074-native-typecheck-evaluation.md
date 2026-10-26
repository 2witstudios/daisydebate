# 0074: evaluate the native TypeScript checker separately from compiler APIs

Status: proposed (native task wiring under CI qualification, ISSUE-629).

Daisy keeps TypeScript 6.0.3 for Next 16.3.5, its editor plugin and
TypeScript ESLint 8.70.0. A native checker may replace only workspace
`typecheck` commands after all current source and test configurations pass
with equivalent diagnostics and negative controls. Never relax compiler
options or discard test configurations to obtain a speedup.

The isolated CI experiment uses `@typescript/native-preview`
`7.0.0-dev.20260707.2`, registry gitHead
`9977d6d38fcc78de8ae71770f3aa08256e6cc861`. Its version-matched official
[README](https://github.com/microsoft/typescript-go/blob/9977d6d38fcc78de8ae71770f3aa08256e6cc861/README.md)
and [intentional differences](https://github.com/microsoft/typescript-go/blob/9977d6d38fcc78de8ae71770f3aa08256e6cc861/CHANGES.md)
were read before the isolated install. The preview supports build mode and
incremental checking but does not supply the JavaScript compiler API.
Next's installed `dist/docs/01-app/03-api-reference/05-config/02-typescript.md`
documents the CLI checker separately from its editor plugin. Neither Next
nor ESLint switches compiler in this experiment.

Run the `TypeScript native comparison` workflow on the candidate. It installs
the preview outside the workspace, runs unchanged Next type generation,
and measures all configs selected by package typecheck tasks, refusing any
inventory gap. Three alternating-order, cold incremental-state repetitions
record GNU time elapsed seconds and maximum resident set in KiB, plus raw
diagnostics and exit codes. OS caches are not flushed. The artifact includes
the exact SHA and machine/toolchain versions. Negative controls insert a
TS2322 error into each source/test config; a two-project fixture checks build
references (none of Daisy's configs currently declares references). Turbo's
`^typecheck` is task ordering, not TypeScript project references.

The repository ESLint configuration uses `recommended`, with no project or
projectService; it currently has no type-aware rules. An additional typed
`no-floating-promises` negative control exercises the retained TS6 API
without changing the accepted ESLint configuration. CI's existing lint and
build jobs continue to qualify the real consumers.

The workflow produces evidence even when the candidate is incompatible;
that success alone never authorizes adoption. The final decision and measured
results must be recorded before this proposal is accepted.

Native task commands are provisionally wired on the evaluation branch so CI
can exercise the real Turbo graph before main adoption. `typescript` stays
at 6.0.3; only the 16 workspace `typecheck` scripts use the separate `tsgo`
binary. The four test-config invocations and `next typegen` remain in those
scripts. `turbo.json` and its dependency/concurrency rules are unchanged.
The benchmark runs `bun run typecheck --force` with GNU time after the
isolated comparisons. This forces every task to execute and records wall
time and maximum child-process RSS, not aggregate simultaneous process-tree
memory. A successful actual graph qualifies the default runner's resource
budget; it does not imply lower memory on every project or host.

Because this PR changes its benchmark workflow, its CI is branch evidence,
not independent workflow acceptance. An independent source review may provide
branch feedback but cannot mint acceptance from these runs. The owner may
merge in owner mode after the exact post-database-fix candidate passes CI
gate, Playwright E2E and Isolated Room Launch E2E. Subsequent CI using the
workflow on main supplies independent evidence.
