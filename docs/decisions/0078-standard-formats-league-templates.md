# 0078: Standard formats, league templates and the room's basis

Status: accepted; owner decisions 2026-10-26 (format picker), DEC-243.
Extends [ADR 0058](0058-one-round-model.md) §2a–§5. Plan:
FMT-1 to FMT-4 (PageSpace, Plans/Format catalog, rev 3).

## Context

A host chose a format once, at creation, from every publisher-owned format,
and the room's settings then drifted with no record of where they came
from. Debaters arrive with a league in mind (NSDA Lincoln-Douglas, NDT
policy, Public Forum), and the owner wants rooms pushed toward three Daisy
standards that ranked play will share, with league rules available as a
starting point rather than as equal choices. A preset meant "rated
config", so giving a league template a starting config would also have
made it rankable.

## Decision

1. **Daisy's standards are catalog formats.** Policy, Value and Freestyle
   (FMT-2b) are formats with ids `policy`, `value` and `freestyle`, each
   with one canonical preset. Freestyle runs the shared 1v1 schedule and
   strikes its resolution from five drawn from Daisy's bank (ADR 0076),
   Negative first, then 20 minutes of prep and none during the round. Its
   preset is not ranked-eligible until its ranked preset is published.
   Ratings and ranked presets are already keyed by format, so ranked play
   on a standard needs no new key or store.
2. **Catalog role is picker visibility.** `formats.catalog_role` is
   `standard`, `template` or null. Null means the picker never offers it:
   private custom formats, One-on-one (ranked and history until FMT-14)
   and Foundation. `family` groups templates for the league browser;
   `leagues` are display labels for governing bodies, never organizations
   or authorization tenants (ADR 0048). Null-safe CHECKs bind role, family,
   publisher ownership and the standard ids.
3. **Ranked eligibility is a published preset property.**
   `format_presets.ranked_eligible` lets ranked play use a preset; casual
   selection ignores it, and it never puts a casual room on the rating
   path. Changing it publishes a new preset version; a ranked room keeps
   the preset it pinned at creation.
4. **One selection policy.** `decideFormatSelection` in
   `@daisy/debate-engine` decides create, ranked create, choosing in Room
   setup and Back to standard, from facts the adapter reads for the exact
   (format, revision, preset) tuple `FOR SHARE` inside the writing
   transaction. New casual selections need a role and the current tuple;
   ranked admission needs catalog ownership, the current tuple, eligibility
   and 1/1/1 seats, but no role; a reset needs the room's own pinned basis,
   even after supersession or retirement. Nothing substitutes a preset.
5. **Publication invariant.** A deferred constraint trigger on `formats` and
   `format_presets` requires every role-bearing format to have a current
   preset at its current revision, so later operator publication cannot
   list a format the picker cannot run.
6. **The room's basis; standing is derived.** `rooms.basis_format_id` and
   `basis_preset_version` (both or neither, `MATCH FULL`) record the catalog
   preset a casual room started from; only the selection policy writes them.
   `formatStanding` compares the compiled rules and room plan of the room and
   its basis: Standard only for an unchanged standard, otherwise Custom with
   a typed, viewer-safe change list. Templates are always Custom. Standing is
   descriptive and never stored.
7. **`select-format`** is a host edit command under the shared edit fence,
   version advance and readiness invalidation; ranked rooms refuse it.
8. **Structure only (DEC-243).** Standards and templates configure seats,
   speeches, times, cross-examination, prep and the resolution strike; never
   the ballot, rubric, scoring scale or decision rules.
9. **Only what runs is listed.** A template is seeded only when Daisy runs its
   rules faithfully and a primary source confirms them; unsupported formats
   are not shown at all.
10. **A preset holds format settings, not a Room config (ISSUE-775).**
    `format_presets.config`, the catalog choice and the selection facts use
    the Formats-owned `formatSettingsSchema`: timing, cross-examination,
    interruptions, yielding, prep, and a draw policy that can name only
    Daisy's bank. `roomConfigSchema` embeds those settings and extends the
    draw source with the Room-only host-written list. A Room setting never
    changes the preset schema, and no preset can carry host-written lines.

## Consequences

The catalog selection carries a preset tuple and no client config. Proof
rooms in tests post Foundation as a custom format. FMT-14 activates ranked
play on the standards by publishing eligible preset versions through the
same policy and retires One-on-one. Formats are bounded at 64 segments with
duplicate-free option sets (DEC-131).
