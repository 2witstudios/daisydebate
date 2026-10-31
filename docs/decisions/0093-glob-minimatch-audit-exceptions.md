# 0093: Dated audit exceptions for glob and minimatch

Status: accepted (agent decision on the owner's behalf of 2026-10-31,
DEC-270, pending confirmation). This extends ADR 0039 with two more dated
exceptions; ADR 0039's rules apply unchanged.

## Context

Two moderate advisories, both published after main's last green audit run,
affect long-installed transitive versions:

- GHSA-3g3m-2fjr-6pw4: a glob `AbortSignal` cancellation bypass allows
  post-timeout filesystem traversal. It affects glob `>=9.0.0 <=14.0.1`;
  the tree carries 11.1.0, 13.0.6 and 7.2.3.
- GHSA-g3hv-75wg-m249: a minimatch denial of service via glob-part
  amplification. It affects minimatch `<11.0.1`; the tree carries 3.1.5
  and 10.2.6.

Every affected path is build or lint tooling. `glob` and `minimatch` do
ship inside production installs through `@sentry/nextjs` →
`@sentry/bundler-plugins` (a production dependency), so package absence
is not the argument — execution is, and the decision pins down exactly
where the vulnerable code runs.

## Decision

1. Add GHSA-3g3m-2fjr-6pw4 (glob) and GHSA-g3hv-75wg-m249 (minimatch) to
   `policy/audit-exceptions.json`, with review by 2027-01-15 and owner
   platform, and document them in `docs/dependencies.md`. This record
   adds nothing else to ADR 0039's list.
2. **Why they are unreachable.** The packages are physically present in
   a production install (ADR 0068's no-absence assumption), but the
   vulnerable code never executes there:
   - In `@sentry/bundler-plugins`, exactly one module requires glob
     (`build/cjs/core/glob.js`), and only the rollup plugin imports it.
     `@sentry/nextjs` loads `@sentry/bundler-plugins` only from its
     webpack config and build hooks, so every glob call happens inside
     the `next build` process, over the repository's own files.
   - `@sentry/bun`'s `plugin.js` (the standalone Bun bundler plugin) is
     required by no runtime entrypoint of `@sentry/bun` — not `index`,
     `sdk` or `client` — so the realtime service's process never loads
     it.
   - The minimatch finding needs an attacker-controlled pattern string;
     no production path passes one, and the lint chains that could see
     one run only on Daisy's own files in CI.
   - The production image's `prod-deps` stage installs without
     devDependencies, so the eslint, typescript-eslint and riteway
     chains are absent from the runtime image entirely.
   - No upgrade can clear the advisories: the glob advisory covers every
     release from 9 through 14.0.1 and the minimatch advisory
     everything below 11.0.1, while the dependents pin those ranges;
     ADR 0039 rules out `overrides`.
3. ADR 0039's expiry, drift and no-blanket-ignore rules still hold.
   Policy fails these entries:
   - past their review date;
   - once `bun audit` stops reporting them;
   - if an advisory reaches a package the entry does not list.

   Remove both entries when the dependents ship patched ranges (glob
   above 14.0.1, minimatch at 11.0.1 or above) within their ranges, or
   when the tools that pull the vulnerable versions are upgraded past
   them.
