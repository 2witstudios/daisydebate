# 0074: use native TypeScript for typecheck tasks, retain the TS6 compiler API

Status: accepted for typecheck-only use (owner-mode merge, ISSUE-629).

## Decision

Pin `@typescript/native-preview` at `7.0.0-dev.20260707.2` and use its `tsgo`
CLI in the 16 workspace `typecheck` tasks. Preserve all 20 source/test config
invocations, the four separate test configs, `--noEmit`, and web's preceding
`next typegen`. No compiler options, Turbo dependency ordering, concurrency,
or check coverage change.

Keep `typescript` **6.0.3** installed for Next **16.4.2**, its editor plugin,
TypeScript ESLint **8.70.0**, and other compiler API consumers. The native
package exposes a separate binary, so it does not replace `tsc` or the
`typescript` module. This is a CLI optimization, not a TypeScript API upgrade.
The dependency registry records both responsibilities.

## Evidence and tradeoff

The corrected [comparison run](https://github.com/2witstudios/daisydebate/actions/runs/40420226123)
checked source `615e7d6f66e557cd7c5cab20a603d40aac76a6e2` on Ubuntu 24.04,
a four-vCPU AMD EPYC 7763 runner, Bun 1.4.2 and Node 22.23.3. All 120 samples
(20 configs, two engines, three repetitions) exited zero with identical
empty diagnostics. Every config rejected an inserted TS2322 error with
identical diagnostic text/location; the project-reference positive and
negative controls also matched. Retained typed ESLint and Next editor-plugin
negative controls passed.

| Measurement                                       |                tsc 6.0.3 | tsgo preview |
| ------------------------------------------------- | -----------------------: | -----------: |
| Sum of per-config median elapsed seconds (serial) |                    85.61 |        18.27 |
| Web median elapsed seconds                        |                    28.89 |         6.14 |
| Web maximum RSS across three samples (KiB)        |                1,911,888 |    2,467,660 |
| Actual uncached Turbo graph elapsed seconds       | not measured in this run |        18.83 |
| Actual native graph maximum child RSS (KiB)       | not measured in this run |    2,460,636 |

The serial comparison is about 4.69 times faster. It is **not** an end-to-end
Turbo speedup measurement. Web peak RSS increases about 29%; native checking
is not a universal memory reduction. The real native graph completed all
16 tasks, zero cached, with normal Turbo concurrency and `^typecheck`
ordering. GNU time reports maximum child-process RSS, not aggregate
simultaneous process-tree memory. That successful graph demonstrates the
runner can execute this workload, not a memory guarantee for every host.

These numbers identify their source revision; they are not substituted for
final delivery evidence. The [ISSUE-629 handoff](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/w4p7ipqxlk6qhu5ahgtxaz4c)
records the final post-database-fix exact head, complete per-config table,
raw artifact/run links, uncached graph result, source review and CI/browser
gates. Adoption requires all of that final candidate's comparisons and
controls to pass; an incompatible result means retaining `tsc` instead.

## Reproduction and compatibility

Run `gh workflow run typecheck-benchmark.yml --ref <candidate>` after the
workflow is available on main, or push its PR. The workflow pins the preview
outside the workspace for the comparison, runs unchanged Next type generation,
and refuses any gap between package task configs and all workspace
`tsconfig*.json` files. Three alternating-order repetitions clear incremental
state before each compile. OS caches are not flushed. Artifacts retain GNU
time elapsed seconds/RSS/exit status, raw diagnostics, exact checked-out SHA,
and toolchain/machine versions. SHA recording compares `git rev-parse HEAD`
with the requested candidate, not the pull request's synthetic merge ref.

A TS2322 fixture is inserted and removed in each config's included source or
test tree. A two-project fixture checks positive/negative build references;
none of Daisy's current configs declares TypeScript references. Turbo's
`^typecheck` is task ordering, not compiler project references. Finally,
`bun run typecheck --force` executes the actual workspace graph without
Turbo cache reuse, including Next typegen and all four test projects.

The repository ESLint config uses `recommended`, without `project` or
`projectService`; it currently has no type-aware rules. An isolated
`no-floating-promises` negative control exercises the retained TS6 API
without changing accepted lint rules. A real TS6 language service with
Next's plugin rejects `useState` in a Server Component (diagnostic 71001).
Neither standalone compiler CLI runs that editor plugin. Normal CI lint
and build jobs continue to qualify the real Next/ESLint consumers.

Version-matched official sources read before installation:

- Preview registry gitHead `9977d6d38fcc78de8ae71770f3aa08256e6cc861`:
  [README](https://github.com/microsoft/typescript-go/blob/9977d6d38fcc78de8ae71770f3aa08256e6cc861/README.md)
  and [intentional differences](https://github.com/microsoft/typescript-go/blob/9977d6d38fcc78de8ae71770f3aa08256e6cc861/CHANGES.md).
  Build mode and incremental checking are supported; the JavaScript API is not.
- Next 16.4.2's installed
  `dist/docs/01-app/03-api-reference/05-config/02-typescript.md` distinguishes
  the CLI checker from its editor plugin and compiler API.

## Owner-mode workflow acceptance

This PR changes its benchmark workflow. Its own CI is branch evidence,
not independent workflow acceptance. Independent source review provides
**BRANCH FEEDBACK**, without minting acceptance from these runs. The owner
merges only after the post-database-fix exact head passes CI gate, Playwright
E2E and Isolated Room Launch E2E, plus the complete comparison and actual
native graph. Subsequent CI using main supplies independent evidence. No
self-modifying-CI safeguard is removed or bypassed.
