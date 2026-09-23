# 0022: Legacy durable identifier compatibility

Status: superseded by [ADR 0023](0023-greenfield-baseline.md).

ADR 0018 converted `users` and `debates` id columns to text while preserving
existing UUID strings, and this ADR originally defined a dual-shape
`idSchema` (cuid2 or legacy canonical UUID) so those rows kept validating.
ADR 0023 squashed the UUID-era migrations into a cuid2-native baseline: the
uuid-to-text conversion, the legacy carve-out in `idSchema`, and this ADR's
whole compatibility contract no longer exist. `@daisy/protocol` validates
exactly one identifier shape, cuid2. This record is retained only as the
paper trail of the decision ADR 0023 reversed.
