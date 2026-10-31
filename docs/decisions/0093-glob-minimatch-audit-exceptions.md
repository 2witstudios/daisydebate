# 0093: Dated audit exceptions for glob and minimatch

Status: accepted (agent decision on the owner's behalf of 2026-10-31,
pending confirmation). This extends ADR 0039 with two more dated
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

Every affected path is development or build tooling:

- glob is installed by riteway's vitest chain (never loaded; ADR 0056)
  and by `@sentry/bundler-plugins` under `@sentry/bun` and
  `@sentry/nextjs`, which run only at build time when shipping source
  maps.
- minimatch is installed by eslint, typescript-eslint,
  eslint-config-next's eslint-plugin-react, and by glob itself — all
  lint/build tooling.

No upgrade can clear the advisories:

- The glob advisory covers every release from 9 through 14.0.1, so no
  in-range bump of any dependent helps.
- The minimatch advisory covers everything below 11.0.1, and eslint's
  ecosystem pins 3.x/10.x ranges.
- ADR 0039 rules out `overrides`.

## Decision

1. Add GHSA-3g3m-2fjr-6pw4 (glob) and GHSA-g3hv-75wg-m249 (minimatch) to
   `policy/audit-exceptions.json`, with review by 2027-01-15 and owner
   platform, and document them in `docs/dependencies.md`. This record
   adds nothing else to ADR 0039's list.
2. **Why they are unreachable.** The vulnerable code runs only when a
   developer or CI lint/build invokes the tools over Daisy's own files:
   - No production image installs dev dependencies; `apps/web`'s image
     installs with `--production`.
   - Nothing imports riteway's vitest chain at runtime (ADR 0056).
   - Sentry bundler plugins run inside the build, over repository files,
     never over untrusted paths.
   - No glob or minimatch call ever receives an attacker-controlled
     pattern; the traversal and amplification findings require one.
3. ADR 0039's expiry, drift and no-blanket-ignore rules still hold.
   Policy fails these entries:
   - past their review date;
   - once `bun audit` stops reporting them;
   - if an advisory reaches a package the entry does not list.

   Remove both entries when the dependents ship patched ranges (glob
   above 14.0.1, minimatch at 11.0.1 or above) within their ranges, or
   when the tools that pull the vulnerable versions are upgraded past
   them.
