# 0137: Scope-first Tab grants

Status: accepted (owner-delegated point guard, 2026-11-15 UTC,
[Delivery decision 3766](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/ijy2klr2s7g77351a0zilrol),
accepting recommendation 2 from Delivery 3700).
Amends [ADR 0130](0130-organizations-grants-and-action-history.md).
Implementation belongs to [wiring PR 748](https://github.com/2witstudios/daisydebate/pull/748).

## Context

The grant table already permits lobby-only grants, but organization-first
commands, loaders and evaluator assembly require an owner organization. A
person-owned tournament therefore cannot give its real staff a lobby grant.
A Daisy preset role's provenance does not make Daisy that lobby's tenant.

## Decision

Give/remove commands name their target scope first: an organization or a lobby.
Resolve a lobby's optional owner organization from storage. Keep the existing
personal owner's fixed evaluator position; create no synthetic organization.
A lobby grant does not require organization membership. Organization grants
retain their membership requirement.

Use the target aggregate's version and action-history scope. A lobby grant
uses its actual lobby guard and lobby history. Load grants by their actual
scope, including lobby-only rows, and require scope equality on removal.

Preserve permission-subset, seniority and preset-role eligibility checks.
Acquire the giver's and actual holder's canonical account fences before the
aggregate fence; do not trust a submitted holder id when removing a grant.
Resolve the applicable staff minimum age through the lobby's actual chain
when it has no owner organization. Expiry, revocation and account erasure
must remove authority under the same fences.

## Limits and proof

Membership and a role named Staff do not establish a hosting entitlement.
Production hosting remains fail-closed until a named entitlement and issuer
are approved. This decision does not open minors or custom role editing.

Prove a personal owner grants staff, staff acts within that lobby, and a
stranger cannot grant. Prove unrelated lobbies cannot load/use the grant,
expiry/revocation/erasure remove it, and concurrent grant changes retain
canonical account/aggregate ordering and replay behavior.
