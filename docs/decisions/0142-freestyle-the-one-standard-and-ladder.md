# 0142: Freestyle is Daisy's one standard and its one ladder

Status: accepted (owner instruction, 2026-11-16; slice freestyle-only-ranked,
[plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/zu792ahnlwlbyjkh4w7j24sx),
confirmed by the point guard on Delivery). Supersedes
[ADR 0090](0090-three-rating-ladders.md). Amends
[ADR 0078](0078-standard-formats-league-templates.md) §1,
[ADR 0092](0092-room-creation-resolution-selection.md) and
[ADR 0103](0103-whos-online.md) (rating visibility). DEC-265's three-ladder
vocabulary and DEC-266's per-standard admission clauses are superseded by
this record.

## Context

Daisy shipped three standards with a rating ladder each: Freestyle, Policy
and Value. Policy and Value ran Daisy's one-on-one schedule with a fixed
resolution published in advance ("Policy res", "Value res"). They were not
faithful to any real Lincoln-Douglas or Policy/Team Policy format. The real
league formats (NSDA, NCFCA and Stoa Lincoln-Douglas, NSDA, NDT and NCFCA
Policy, Public Forum and the rest) already exist as templates. A member
therefore met two invented formats and their two ladders beside the real
ones, and onboarding taught three ladders instead of how to play.

## Decision

1. **Two choices.** A Room is either **Freestyle**, Daisy's one standard
   (`formats.catalog_role = 'standard'`, id `freestyle`), or **Custom**: any
   rules, with league templates as starting points. Custom is always casual.
   `standardFormatIds` is `['freestyle']`. The `formats_standard_ids` CHECK
   admits no other standard.
2. **One ladder, generic model.** `ratingLadders` in `@daisy/protocol` is
   `['freestyle']`. A Round's frozen `ladder_id` is `freestyle` or null, and
   it remains the sole ratedness authority (ADR 0090's authority rule
   stands). The standing key stays `(actor, ladder, season)`, and every
   ladder CHECK (`ratings`, `rating_changes`, `rounds`, `challenges`) derives
   from the list. A later ladder, such as a league's own, extends the list or
   its home and does not replace the model.
3. **Resolution choice at creation.** Freestyle strikes its resolution from
   five drawn from Daisy's bank (ADR 0076). Custom takes either the strike or
   the host's own wording. `roomResolutionSelectionSchema` is
   `strike | custom`. Published resolutions (Policy res, Value res and the
   Beta Season 1 texts in ADR 0092) belonged only to the deleted standards,
   and are deleted with them: the table, its functions, the Room and Round
   reference columns, the store reads, the Seasons page section and the
   create-room publication block.
4. **Topics are not formats.** The resolution bank's `policy`, `value` and
   `fact` categories are kinds of topic, and Freestyle keeps drawing from
   all of them. The league browser's template families (`policy`, `value`,
   `parli`, `other`) describe league formats and stay.
5. **One rating everywhere.** The leaderboard, Seasons page, profile, member
   card, people list, account rail and Round ratings show the Freestyle
   rating with no ladder switch. The per-ladder rating visibility preference
   (ADR 0103: show Policy/Value on your card) has nothing left to choose.
   Its table, capabilities, route, settings form and privacy adopter are
   deleted.
6. **Challenges and practice** offer a Freestyle debate, ranked or casual
   for a challenge and casual for practice. A challenge keeps its
   ladder-typed `format`, so offers stay generic, but no screen asks for it.
   Practice has no format choice.
7. **Onboarding** teaches how to play Freestyle, including the five-motion
   draw and the strikes, and introduces Custom as the way to run any kind of
   debate. The three-ladder figure and copy are removed.
8. **Data.** Prod and staging are one pre-release environment, and the owner
   waived keeping any Policy or Value rows. One forward migration
   (`20261116175848_freestyle_only_ranked`) deletes every Policy and Value
   Room (with all its Rounds) and every Round on either format, together
   with their restrict-protected recordings and rating ledger rows. It then
   deletes the Policy and Value ratings, challenges, presets, formats and
   revisions, unsets a surviving Custom Room's pointer to a deleted basis,
   drops `published_resolutions` and `rating_visibility`, and tightens the
   CHECKs. A seeded integration test proves it. Running it against the
   shared environment keeps human sign-off (FOR-H.1).

## Consequences

- ADR 0090's three-pool vocabulary is retired. Its authority, posting,
  provenance and lock-order sections stay in force for the one ladder.
- ADR 0078's standards are one: §1 reads "Freestyle is Daisy's standard".
  Its other sections (catalog role, ranked eligibility, the one selection
  policy, basis and standing, structure only) are unchanged.
- ADR 0092's create form presents Freestyle and Custom, and its resolution
  selection is Strike or Custom. Its published-resolution and Beta Season 1
  publication sections are void.
- ADR 0103's rating visibility clause is void. A card shows a person's
  rating on each Daisy ladder.
- Daisy Tab's league ladders (decision 38, ADR 0135) sit beside Freestyle,
  never beside Policy or Value. Tab recomposes its ladder CHECKs on top of
  this migration at its next parent sync. This slice merged to main first.
