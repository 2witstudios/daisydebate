# 0022: Legacy durable identifier compatibility

Status: superseded by [ADR 0023](0023-greenfield-baseline.md). The repository
squashed the UUID-era migrations into a cuid2-native baseline and
`@daisy/protocol` no longer accepts UUID identifiers; this record is retained
only as the paper trail of the decision it reversed.

ADR 0018 made `@paralleldrive/cuid2` the minting strategy for all new
repository-owned identifiers and converted `users` and `debates` id columns
to text. The conversion deliberately preserved existing UUID strings in those
columns (ADR 0018: "Auth child records... users and debates keep
application-supplied ids"; the pre-ship migration casts to text without
reminting). Durable version-1 snapshots, commands, and events therefore still
reference legacy UUID identities.

This decision defines the narrow backward-compatibility contract so legacy
records keep working without loosening identifier validation:

- `@daisy/protocol`'s `idSchema` accepts exactly two shapes: new cuid2
  (`^[a-z0-9]{24}$`) and legacy canonical lowercase UUIDs
  (`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`).
  Uppercase UUIDs, braced or urn forms, dashless forms, arbitrary strings,
  and any other content are rejected at the trust boundary. Parsing never
  normalizes or repairs input, so identity is preserved verbatim.
- New identifiers continue to be minted as cuid2 by `@daisy/clock` and
  Better Auth's injected `generateId`. Nothing regenerates, renames, or
  remints existing UUID identities.
- Application route schemas reuse the protocol schema instead of private
  regexes, so every reader treats legacy identities identically: a
  well-shaped legacy id resolves against storage (404 when absent), not a
  400 validation failure.
- PostgreSQL stores both shapes as text. Legacy rows and their foreign-key
  references (restrictive user deletion) are untouched by future migrations.

Acceptance criteria:

- Given a version-1 snapshot, command, or event whose identities are legacy
  canonical lowercase UUIDs, should validate and round-trip verbatim.
- Given new cuid2 identities on those same contracts, should continue to
  validate without behavior change.
- Given any identifier outside the two documented shapes, should reject at
  the protocol boundary with no normalization.
- Given a legacy UUID id on a read route, should resolve against storage
  (NOT_FOUND when unknown) rather than fail validation.
