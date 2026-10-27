# 0076: Pre-round resolution draw and strike

Status: accepted; owner-authorized implementation 2026-10-26 (FMT-7 brief),
plan approved by the orchestrator after independent review (plan rev 5).
Extends [ADR 0058](0058-one-round-model.md) §§4–7 and
[ADR 0070](0070-one-active-room-per-user.md).

## Context

Freestyle (IPDA-style) debaters strike from a drawn set of resolutions
until one remains, then prepare. Policy and Value use a resolution known in
advance. A Custom room or league template may want the same strike. The
draw must be fair, replayable and private until the reveal.

## Decision

1. **One optional pre-round step, no second lifecycle.** The draw runs in
   the Room before Launch, as pre-round prep already does. The host's
   `start-pre-round` (renamed from `start-prep`) begins a draw when the plan
   has one, else prep. One derived phase (`preRoundBegun`,
   `preRoundPhase`) drives fencing, Launch, projection and maintenance.
2. **Config, not code.** `configurable.resolutionDraw` bounds draw size,
   strike window, first striker and sources; `config.resolutionDraw`
   chooses them. Two sides, alternating turns and one survivor are contract
   assumptions; there are no unused mode enums.
3. **Sources.** A curated, append-only bank (revision 1 seeded by
   migration; later revisions only through the publication operation behind
   the future operator API) or a host's own list for casual rooms. Ranked
   rooms use the bank only, through their preset.
4. **A pure, replayable draw.** `daisy-draw-v1`: candidates in byte order,
   a SHA3-256 counter word stream over a 32-byte OS CSPRNG seed, unbiased
   rejection sampling, Fisher–Yates; automatic strikes use their own stream
   per ordinal. Exclusions are the seated humans' recently chosen bank
   entries, relaxed only when too few remain.
5. **Commitment without disclosure.** A digest-only public manifest holds a
   privately salted input commitment; the draw commitment binds Room, draw,
   manifest digest and seed. The seed is never disclosed, because the seed
   plus the ordered draw would let anyone test guessed candidate pools.
   Operators replay from the private inputs while they exist.
6. **Settlement at due instants.** Time-outs (lowest standing position) and
   all-bot sides (after three seconds) strike at their due instants, so a
   command, a read or the sweep agree. A refused command persists nothing.
   Maintenance settles before expiry and never expires an unfinished draw;
   idle time is measured from `rooms.last_command_at`.
7. **Information hiding.** Only seated debaters see drawn texts. Everyone
   else sees progress. Delivery uses a viewer-independent frozen config, and
   the Room view is projected field by field.
8. **ADR 0058 extension: evidence frozen onto the Round.** At Launch the
   writer freezes proof metadata (`rounds.resolution_evidence`, immutable),
   the seed (`round_draw_seeds`, immutable) and the erasable texts and
   private inputs (deletable only by the privacy erasure operation). No
   Round reads its Room.
9. **Topic.** A draw Room's topic is null until the reveal, then the
   survivor's text; Launch freezes it as `rounds.resolution`.

## Consequences

- The privacy adopter `room-draw` (DEC-245) scrubs host lines to unique
  placeholders, deletes private inputs, closes an erased author's open Room
  and removes an erased player's unbegun seats through the engine's pure
  transitions.
- `rooms.last_command_at` is backfilled from surviving receipts, so a Room
  whose receipts were already purged may expire sooner once after deploy;
  accepted under ADR 0023.
- The Freestyle format and its presets belong to FMT-2b and FMT-14.
