# 0139: Structural admission at draw publication

Status: accepted (owner-delegated point guard, 2026-11-15 UTC,
[Delivery decision 3766](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/ijy2klr2s7g77351a0zilrol),
approving the narrow correction reported in Delivery 3734).
Clarifies [ADR 0133](0133-the-tab-record.md).
Implementation belongs to [wiring PR 748](https://github.com/2witstudios/daisydebate/pull/748).

## Context

An edited draft can be structurally invalid even when its saved calculation
once succeeded. The existing publication decision could accept a three-entry
pairing for a two-sided format with no judges and proceed to Room creation.
A saved engine finding or a host's pairing override cannot prove that the
current draft can be assembled.

## Decision

Inside the publication transaction, re-assess the actual current draft's
structure and panel completeness against its pinned format and resolved
requirements. Use the fenced current fixtures, entries and judges. Refuse
invalid structure or incomplete panels before any publication/Room write.
A failed publication leaves no partial Rooms, membership or journal effects.

Host overrides remain limited to the existing overridable pairing/judging
policies, with the required reason. Structural invalidity and panel
incompleteness cannot be overridden as a preference. Preserve command guards,
replay, slot/account fences and the shared Room assembly path.

## Limits and proof

This does not decide how an independently configured panel size binds to an
immutable format's judge seats. It does not change the format, relax a rule,
reconstruct engine history from ballots or authorize result recording.
Those boundaries remain separate decisions and prerequisites.

Prove the actual invalid edited draft and missing panel are refused without
writes, a valid current draft assembles its exact fixtures, stale/concurrent
publication is serialized, and no structural override can bypass admission.
