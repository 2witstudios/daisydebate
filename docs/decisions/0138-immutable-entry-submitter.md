# 0138: Immutable entry submitter provenance

Status: accepted (owner-delegated point guard, 2026-11-15 UTC,
[Delivery decision 3766](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/ijy2klr2s7g77351a0zilrol),
accepting recommendation 3 from Delivery 3700).
Amends [ADR 0133](0133-the-tab-record.md).
Implementation belongs to [wiring PR 748](https://github.com/2witstudios/daisydebate/pull/748).

## Context

The entry record has no submitter. An event-level receipt does not identify
which entry a person submitted. Current guardians, responsible adults and
row order cannot recover that fact, particularly when several people submit
entries to the same event.

## Decision

Store immutable `entries.submitted_by_user_id`, captured from the authenticated
submitter and written in the same transaction as the entry, its members and
receipt. The client cannot supply or replace it. Replay does not create a new
entry or change its maker, and later acceptance does not replace the submitter
with the approver.

Load that field directly wherever submission provenance is required. It is a
historical fact, not permission: acceptance still requires current guardian,
restriction and responsible-adult authority under canonical fences. A coach's
submission never becomes guardian approval by inference.

Do not backfill an unknown maker from current relationships or event history.
Any legacy/erased unknown representation must be explicit, cannot grant
access and cannot be displayed as a fabricated person's name. New submissions
must capture their authenticated maker.

## Limits and proof

Keep the account identifier only, without copied email, name or relationship
payload. This decision does not establish retention or detachment policy for
minor provenance; family activation and that privacy treatment remain
counsel-gated. The existing closed identity/competitive-record erasure rule
must not silently become a new minor-retention policy.

Prove two submitters in one event remain distinguishable after reload/retry,
the maker cannot change, refusal/replay do not add rows, and current guardian
approval is still independently required. Use forward migrations; do not edit
an applied schema migration or invent historical makers.
