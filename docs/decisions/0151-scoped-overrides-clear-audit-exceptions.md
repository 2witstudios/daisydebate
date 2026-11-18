# 0151: Scoped overrides to patched versions clear the audit exceptions

Status: accepted (owner brief of 2026-11-18, `audit-gate`, after main's
`policy` job went red on Incidents). Amends [ADR 0039](0039-dated-dependency-audit-exceptions.md)
decision 1: an `overrides` pin to a patched version is now the preferred fix,
and an audit exception is the fallback. It retires the exceptions recorded in
ADR 0039, [ADR 0056](0056-tinypool-audit-exceptions.md),
[ADR 0068](0068-vitest-manual-mock-audit-exception.md) and
[ADR 0093](0093-glob-minimatch-audit-exceptions.md). Their rules for adding a
future exception still apply.

## Context

GHSA-fc5q-39xc-vjpf (picomatch) stopped being reported by `bun audit`, so
`bun policy` failed its stale exception and turned every PR red. The other
seven exceptions all had patched releases. ADR 0039 had ruled out `overrides`
for two reasons: an override can pull the wrong major into another dependent,
and the owner preferred fixes at the source. Bun 1.4.2 resolves nested
(per-parent) overrides, which removes the first reason. The happy-dom pin
(ISSUE-525) had already used a root override.

## Decision

1. **Fix with a pinned override first.** The root `package.json` `overrides`
   pins exact patched versions, scoped to the parent that pulls the
   vulnerable copy wherever another dependent needs a different major:
   - `vitest` `4.1.12` (patched for GHSA-82fw-gwwq-j7x9 and
     GHSA-qxg6-89mg-rqv8). It replaces riteway's and better-auth's 3.2.7.
     Vitest 4 no longer depends on `tinypool`, so GHSA-5gmw-xhrv-c9v3 and
     GHSA-85c8-ppgw-ccpr leave the tree too. better-auth's optional peer
     range admits `^4.0.0`. The `riteway/vitest` entry stays unused.
   - `@sentry/bundler-plugins` → `glob` `14.0.6` and `riteway` → `glob`
     `14.0.6` (GHSA-3g3m-2fjr-6pw4, fixed above 14.0.1). tape keeps its
     unaffected glob 7.2.3.
   - `@typescript-eslint/typescript-estree` → `minimatch` `11.0.9`
     (GHSA-g3hv-75wg-m249, fixed in 11.0.1). glob 14 already brings
     minimatch 11. The eslint chains keep their unaffected minimatch 3.1.5.
   - `jsonpath` → `underscore` `1.13.8` (GHSA-qpx9-hpmf-5gmw). This is a
     patch release past jsonpath's exact `1.13.6` pin.
2. **The registry is empty.** `policy/audit-exceptions.json` lists no
   advisories, and `bun run audit` runs plain `bun audit`. An exception is
   still allowed under ADR 0039's rules, with the fields, owner, ADR and
   review-by date it requires. It is allowed only for an advisory that has no
   patched version, or one whose patched version no override can reach
   without breaking a dependent.
3. **Overrides are recorded.** Every security override is listed in
   `docs/dependencies.md` with its advisory. An override is removed once its
   parent ships the patched range itself.

## Consequences

Riteway, Sentry's bundler plugins, typescript-estree and jsonpath now run
on versions outside their declared ranges. `bun check` (lint, types, tests
and builds) shows nothing regresses, but each upgrade of these parents has to
check whether its override can be dropped. A future advisory on a package
pinned this way fails the audit like any other.
