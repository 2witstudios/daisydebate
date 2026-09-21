# 0025: Duplication gate

Status: accepted.

## Context

Copy-pasted blocks are the dominant decay mode of agent-written code: an agent
that cannot see (or may not touch) the original reproduces it. This repository
already did it once — `scripts/check-migration-journal.ts` re-implemented the
review-date rule private to `scripts/policy.ts` — and is about to build twelve
product routes that today are near-identical shells. Review catches this
late and inconsistently; a gate catches it on the push that introduces it.

## Decision

Adopt jscpd 5.3.0 as a repo-wide copy-paste tripwire. `bun run duplication`
(`bunx --bun jscpd`) runs in `bun check` and the CI `checks` matrix, and
`bun evidence` fails if either wiring disappears. It is also an always-on
gate in `bun check:affected` (the pre-push hook): a clone is only visible
against the whole tree, and the scan is cheap enough to run on every push.

- **Tool.** jscpd 5 is a prebuilt Rust binary shipped through per-platform
  `optionalDependencies` — the same delivery as Turborepo, with no install
  script and no native build step — behind a small launcher that runs under
  Bun 1.4.2. It is a root devDependency and repository tooling only. The
  "no Rust" foundation rule governs first-party code, not vendored tool
  binaries.
- **Scope** (`.jscpd.json`). First-party TypeScript, TSX, JavaScript and CSS
  under `apps/*/src`, `packages/*/src`, `scripts` and `scenarios`. Ignored:
  test suites and test support (`*.test.ts(x)`, `*.integration.ts`,
  `*.e2e.ts`, `*.test-support.ts`, `test-support/`), generated output
  (`.next`, `.turbo`, `node_modules`, migrations `meta/`), and the throwaway
  fixtures in `apps/web/src/ui/mock/`. jscpd's JSON config cannot carry
  comments, so this record is where each ignore is justified.
- **Sensitivity.** jscpd's defaults: exact clones of at least 50 tokens and 5
  lines. Higher `minTokens` values also drop every file smaller than the
  threshold from the scan (140 files analysed at 50, 118 at 70), which would
  blind the gate to exactly the small route and component files it exists to
  watch. Literal- and identifier-insensitive modes were measured and
  rejected: they flag data tables (icons, dashboard tiles, CSS tokens) rather
  than logic.
- **Ratchet.** Not a percentage. A percentage dilutes as the codebase grows
  (1.13% of 10k lines is 115 lines; of 50k it is 565). Instead
  `.jscpd-baseline.json` holds content fingerprints of the clones that
  existed on adoption, and `failOnNewClones: 0` fails the run on any clone
  absent from it. Fingerprints are content-based, so moving a grandfathered
  clone within its file does not trip the gate. `failOnEmpty` fails a run
  that matches no files, and a missing baseline file fails closed, so a
  broken config cannot pass silently.

The route shells under `apps/web/src/app/*/page.tsx` are **not** ignored and
are **not** in the baseline: they already delegate to one `RouteShell`
component and differ only in literals, so the detector reports nothing for
them. When real routes replace them they are scanned like any other source.

### Baseline on adoption (12 clones, 115 lines, 1.13% of 10,168 lines)

| Clone                                                              | Size                         | Follow-up                                                |
| ------------------------------------------------------------------ | ---------------------------- | -------------------------------------------------------- |
| `scripts/check-affected.ts` ↔ `scripts/check-migration-journal.ts` | 17 lines, 104 tokens         | One shared `gitOutput` helper                            |
| `scripts/invariants.ts` ↔ `scripts/scenario.ts`                    | 6 lines, 60 tokens           | One shared `invariantId` reader                          |
| `scripts/policy.ts` (two registry validators)                      | 7 lines, 64 tokens           | Shared registry preamble                                 |
| `packages/config/src/index.ts` (two `superRefine` blocks)          | 10 lines, 58 tokens          | Shared production-HTTPS refinement                       |
| `packages/db/src/schema/{auth,debates,users}.ts` (6 overlapping)   | 7–9 lines, 52–72 tokens each | Shared `createdAt`/`updatedAt`/`version` column fragment |
| `scenarios/foundation-lifecycle.ts` ↔ `phase-transition.ts`        | 27 lines, 129 tokens         | Judge whether scenario documents should share a preamble |
| `scenarios/foundation-lifecycle.ts` ↔ `ready-up.ts`                | 15 lines, 76 tokens          | Same                                                     |

## Consequences

- The gate costs about 0.05 s locally (13 ms of detection), so it is free in
  `bun check` and CI.
- When it fires, the fix is consolidation: extract the shared function,
  component, or data table into the owning module (a shared abstraction now
  has its two real consumers). Deleting a grandfathered clone should be
  followed by `bunx --bun jscpd --update-baseline` so the baseline shrinks.
- Known blind spot: jscpd does not match clones inside a file that fails to
  parse. `bun typecheck` and `bun lint` reject such files, so the gap cannot
  reach `main`.
- Exact matching will not catch a block copied and then renamed. That is
  accepted: the gate is a tripwire for the common case, not a proof of
  non-duplication.

## Handling a legitimate exception

Some duplication is correct — two modules that must not share a dependency,
or declarative documents that are clearer when self-contained. The order of
preference is:

1. Consolidate. This is the default and needs no record.
2. If consolidation is wrong, add the clone to the baseline
   (`bunx --bun jscpd --update-baseline`) **and** add a dated row to the
   table above naming the clone and the reason. A baseline diff without a
   matching row here is a review rejection.
3. Raising `minTokens`/`minLines`, adding an `ignore` glob, or removing a
   scan root weakens the gate for everyone; it requires a dated note in this
   ADR explaining why consolidation and a single baseline entry were both
   insufficient. Weakening the gate to hide a finding is the same violation
   as skipping a test.

References: [jscpd](https://jscpd.dev),
[repository](https://github.com/kucherenko/jscpd), [ADR 0013](0013-knip-dead-code-gate.md)
(the gate precedent).
