# 0068: Dated audit exception for Vitest manual mock interception

Status: accepted under delegated Round delivery authority (DEC-181, ISSUE-429).
This extends ADR 0039 with one named exception; its rules remain unchanged.

## Context

[GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)
affects `@vitest/mocker` 3.2.7. Its Vite development-server interceptor accepts
unauthenticated manual mock registrations and interpolates their URLs into
generated JavaScript. The fixes are in Vitest 4.1.12 and 5.0.3.

RITEway 9.3.0 remains the latest published RITEway release and depends on
Vitest `^3.2.4`. Better Auth declares Vitest only as an optional peer.
Replacing the repository's test framework or overriding this incompatible
transitive dependency is unnecessary to address an unloaded development server.

The same audit reported five Vite advisories. Updating the compatible lockfile
resolution from 7.3.6 to 7.3.7 removes those advisories without exceptions.

## Decision

Add only GHSA-qxg6-89mg-rqv8 to `policy/audit-exceptions.json`, owned by
platform with review by 2026-12-23. The affected code is unreachable:

- Tests import `riteway/bun`, whose entry imports `bun:test`.
- Application, test and script sources do not import `riteway/vitest`,
  `vitest` or `better-auth/test`, or start the affected mocker development server.
- The production image installs dependencies with `--production` and omits
  the RITEway development dependency.

Keep ADR 0039's expiry, package drift and stale-entry gates. This decision
does not permit a blanket ignore or an override. Remove this entry with the
other Vitest and tinypool entries when RITEway permits the patched dependency
or removes its Vitest dependency. Reassess before introducing any Vitest entry
or development server.

## Evidence

The live audit was red before the repair. Vite 7.3.7 removes five findings;
the remaining finding is this named advisory. Reachability was checked against
the installed RITEway entry, repository imports and production Dockerfile.
The official [Vite 7.3.7 release](https://github.com/vitejs/vite/releases/tag/v7.3.7)
and advisory identify the patched versions. Final composed acceptance still
requires the normal audit, policy and independent review gates.
