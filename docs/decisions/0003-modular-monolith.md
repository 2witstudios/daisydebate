# ADR 0003: Modular monolith with extraction seams

Status: accepted.

We ship one deployable application over one database. Not a microservice
fleet: at foundation stage, distributed coordination would consume the
engineering budget the domain needs, and premature service boundaries usually
encode wrong guesses. Also not a single Next.js package: framework delivery,
domain, and infrastructure have different change cadences and owners.

The monolith is modular in the strong sense: workspace packages with explicit
public APIs, an acyclic dependency graph, and mechanical enforcement.
Extraction seams are designed now (engine ↔ protocol JSON snapshots, db
adapter behind operations, Redis namespace discipline, injectable
clocks/IDs) so that a future realtime or matchmaking service is a new
deployment of existing contracts, not a rewrite.

What we deliberately do not do: event sourcing, Kafka, Kubernetes, or a
message bus. Revisit each only with an ADR and an operational reason.
