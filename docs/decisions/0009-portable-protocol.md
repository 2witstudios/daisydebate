# ADR 0009: Portable versioned protocol contracts

Status: accepted.

`@daisy/protocol` defines the JSON contracts exchanged by browsers, realtime
servers, workers, replay processors, and future AI systems: Commands
(intent), Events (facts), Snapshots (serialized state), and stable public
Errors. Structures are versioned (`version` literals), JSON-compatible at
external boundaries, and validated with Zod at trust boundaries.

The protocol package imports nothing but Zod and error codes — no WebSockets,
no React, no database. Transports (HTTP today, WebSockets later) adapt to the
protocol, never the reverse. Snapshots are the persistence format for domain
state, so engine upgrades can restore old debates through explicit version
migrations instead of depending on vendor storage formats.

Tradeoffs: explicit versioning and discriminated unions are more code than
ad-hoc payloads; that is the point — contracts outlive the code that produced
them and enable non-TypeScript consumers. Message evolution rules: additive
optional fields within a version; new version literals for breaking change;
never repurpose a field.
