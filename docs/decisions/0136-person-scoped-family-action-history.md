# 0136: Person-scoped family action history

Status: accepted (owner-delegated point guard, 2026-11-15 UTC,
[Delivery decision 3766](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/ijy2klr2s7g77351a0zilrol),
accepting recommendation 1 from Delivery 3700).
Amends [ADR 0130](0130-organizations-grants-and-action-history.md) for family
command scope. Implementation belongs to [wiring PR 748](https://github.com/2witstudios/daisydebate/pull/748).

## Context

A guardian relationship can exist without a school or tournament and can
restrict several lobbies. An organization/lobby-only journal cannot attribute
that relationship to its protected subject. Using the command actor, Daisy or
one allowed lobby as the tenant would give the record a different owner.

## Decision

Extend the existing single action history with an explicit protected-person
scope. Each row has exactly one organization, lobby or subject-person scope.
The subject is distinct from the actor and from the authority under which the
actor acted. A coach proposing a relationship does not become its journal owner.

Keep the existing command identity, digest, replay/conflict handling and atomic
receipt semantics. Acquire canonical account fences before aggregate fences;
recheck current authority after waits. This is an attributed command record,
not a second journal or an event-sourced reconstruction of family state.

Person-scoped RLS and evaluator decisions must keep family history separate
from organization/lobby history. An organization history permission cannot
expose person-scoped rows. Reads must address and authorize the actual subject;
a caller's actor identity cannot stand in for another protected subject.

## Limits and proof

Family runtime writes remain closed. This record does not approve activation,
consent fields, export/erasure behavior or retention of family history. The
competitive-history permanence in ADR 0130 is not a retention decision for
family relationships. Counsel and the corresponding privacy decision must
settle those matters before activation.

Prove isolated subject/org/lobby reads, evaluator denial for another subject,
replay returning one receipt, and account closure refusing resurrection of a
relationship. Test-only activation does not change production privileges.
