# 0056: Dated audit exceptions for tinypool

Status: accepted (owner decision of 2026-10-05, DEC-115). This extends
ADR 0039 with a fourth and fifth dated exception; ADR 0039's rules apply
unchanged.

## Context

Two critical advisories affect `tinypool`:

- GHSA-5gmw-xhrv-c9v3: a prototype pollution gadget in worker options that
  leads to remote code execution. It affects versions up to 2.1.0.
- GHSA-85c8-ppgw-ccpr: a prototype pollution gadget in `run()` options that
  leads to remote code execution. It affects versions below 2.1.2.

The audit job failed on main and on every branch (ISSUE-332).

`tinypool` is installed by one path only: riteway 9.3.0 → vitest 3.2.7 →
tinypool 1.1.1. riteway is a development dependency of every testing workspace.
better-auth lists vitest only as an optional peer.

No upgrade can clear the advisories:

- riteway 9.3.0 is the latest release, and it hard-depends on vitest `^3.2.4`.
- Every vitest 3.x release pins `tinypool` `^1.1.1`.
- No patched 1.x exists. The fixes are in 2.1.1 and 2.1.2.
- ADR 0039 rules out `overrides`.

## Decision

1. Add GHSA-5gmw-xhrv-c9v3 and GHSA-85c8-ppgw-ccpr to
   `policy/audit-exceptions.json`, with review by 2026-12-23 and owner
   platform, and document them in `docs/dependencies.md`. This record adds
   nothing else to ADR 0039's list.
2. **Why they are unreachable.** `tinypool` is vitest's worker pool, and
   vitest is never loaded:
   - Daisy's tests run on `bun:test` through `riteway/bun`.
   - Nothing imports `riteway/vitest`, `vitest` or `better-auth/test`.
   - No production image installs dev dependencies. `apps/web`'s image
     installs with `--production`.
3. ADR 0039's expiry, drift and no-blanket-ignore rules still hold. Policy
   fails these entries:
   - past their review date;
   - once `bun audit` stops reporting them;
   - if an advisory reaches a package the entry does not list.

   Remove both entries, together with the vitest exception
   (GHSA-82fw-gwwq-j7x9), when riteway drops its hard vitest dependency.
