# 0052: Dated audit exception for braces

Status: withdrawn: GitHub withdrew GHSA-vfj7-8cjw-p6xm on 2026-10-23, so its
exception is removed (ISSUE-516). Was: accepted (owner decision of 2026-10-04).

## Context

GHSA-vfj7-8cjw-p6xm (high, stack exhaustion on deeply nested brace patterns)
affects `braces` through 3.0.3, which is every published release. No patched
version exists, so no upgrade can clear it, and the audit job fails on main.
`braces` is installed only by `eslint-config-next` > `@next/eslint-plugin-next`

> `fast-glob` > `micromatch`, a development dependency of `apps/web`.

## Decision

1. Add GHSA-vfj7-8cjw-p6xm to `policy/audit-exceptions.json`, review by
   2026-12-23, owner platform. It is the only change to ADR 0039's list.
2. **Why it is unreachable.** The vulnerable code runs only in lint tooling
   that globs Daisy's own source files and never parses untrusted input, and no
   production image installs dev dependencies.
3. The expiry, drift and no-blanket-ignore rules of ADR 0039 hold: policy
   fails the entry past its date, once `bun audit` stops reporting it, or if
   it reaches a package not listed. Remove it when `braces` publishes a fix.
