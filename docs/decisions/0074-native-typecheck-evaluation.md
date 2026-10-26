# 0074: evaluate the native TypeScript checker separately from compiler APIs

Status: proposed (CI experiment in progress, ISSUE-629).

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
