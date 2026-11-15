# 0140: Complete tournament setup views

Status: accepted (owner-delegated point guard, 2026-11-15 UTC,
[Delivery decision 3766](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/ijy2klr2s7g77351a0zilrol)).
Clarifies the read representation of [ADR 0133](0133-the-tab-record.md).
Implementation belongs to [wiring PR 748](https://github.com/2witstudios/daisydebate/pull/748).

## Context

A newly created tournament legitimately has no events. The setup contract
requires at least one and cannot describe that first usable state. The same
contract carries one sanction per event even though the model permits several
leagues to sanction an event. Fabricating an event or choosing one league
would change the tournament rather than represent it.

## Decision

The setup contract and existing setup UI represent zero events explicitly.
The authenticated host can see that actual empty state and reach the existing
setup actions. No sample event, invented count or successful fake action
stands in for persisted state.

An event's setup read exposes every sanction the viewer is authorized to see.
Represent that collection directly; do not select the first, latest or owner
league as a substitute for all authorized sanctions. Preserve each sanction's
real organization, status and request instant. Apply the existing read's
authority and privacy gates before projection.

Keep setup metadata and resolved settings truthful: source names, enforcement
locks, pins, schedule and active pool sizes come from their actual scopes.
Setup does not include resolution wording. Mutations retain the guards shown
to the user, rather than replacing them at submission with a fresh version.

## Limits and proof

This changes representation, not sanction eligibility, release audiences,
certification or counsel/guardian consent. It does not activate the feature.

Prove a real empty tournament renders without fabrication, populated setup
still matches stored state, multiple authorized sanctions survive reload,
unauthorized data stays hidden, and concurrent reads/mutations preserve the
actual fenced snapshot and displayed mutation guards.
