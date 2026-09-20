# 0018: cuid2 application identifiers and UUID exceptions

Status: accepted.

New repository-owned identifiers use `@paralleldrive/cuid2`, generated at the
application boundary and injected into pure operations. This is a policy for
new work; this PR does not migrate existing database columns or routes.

UUID remains allowed only where a framework, protocol/database migration, or
integration-isolation contract requires it. Each exception is recorded in
`policy/exceptions.json` with an owner, reason, ADR reference, and a
time-bounded `reviewBy` date. The policy gate validates the ADR path, exact
repository path, canonical ISO date, and expiry. Direct `crypto.randomUUID()`
is not permitted for application identifiers; deterministic unit IDs are
preferred, while CSPRNG IDs are allowed for isolated real-service tests.

Acceptance criteria:

- Given new application-owned identity code, should use the injected cuid2
  strategy and pass the policy gate.
- Given a UUID or direct random UUID use, should fail unless its exact path and
  rule are documented in the exception registry.
- Given migration or framework/tooling compatibility code, should pass when its
- exception is explicit, ADR-linked, and not past its review date.
