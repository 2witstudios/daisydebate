# 0058: one Round model

Status: accepted (owner request, 2026-10-06). Supersedes parts of
[ADR 0029](0029-competitive-schema-foundation.md),
[ADR 0054](0054-debate-room-workspace.md) and
[ADR 0055](0055-glicko-2-calculation-ladders-and-seasons.md).
Extends [ADR 0013](0013-knip-dead-code-gate.md)'s decision via
[ADR 0057](0057-planned-readers.md).

The column-level target schema is the design canvas **Spec — target schema, v10**
in the `Daisy Debate` drive, `Plans/Competitive schema foundation/`. This record
states the decision and its invariants; the canvas carries the constraint
definitions, and an implementation agent should read both.

## Context

Daisy has two debate systems.

`debates` and `ai_debates` are parallel stacks — two lifecycles, two participant
models, two command logs, two ballot tables. A bot debate is modelled as a
different kind of entity rather than a room whose other seat is a bot. The Stockfish
test settles it: nobody would ship `computer_games` beside `games` and call it a
second kind of chess game.

Three more defects are the same failure at a smaller scale, and they are the reason
this is an architecture decision rather than a table cleanup:

1. **`debates.snapshot` owns a participant collection.** The snapshot is declared the
   domain source of truth (`debates.ts:34`) while `debate_participants` is declared
   a projection of its `participants` — for debater seats only (`debate-participants.ts:27`).
   Judges are explicitly not in the snapshot. So debaters have two representations and
   judges have one, _before_ any AI work. Deleting the AI tables does not fix it.
2. **Both ballots are unvalidated JSONB.** `ballots.scores` is `jsonObjectSchema` —
   any object — and the AI ballot stores arbitrary JSON the same way. Merging the tables
   without merging the contracts relocates the fork into JSONB.
3. **The debate grammar is hardcoded.** `aiDebateTurns` (`ai-debate.ts:40-61`) fixes the
   AC/CX/NC/1AR/NR/2AR schedule in TypeScript, `aiDebatePrepMs = 240_000` (`:65`) and
   `aiDebateCountdownMs = 10_000` (`:68`) are module constants, and
   `formatRulesSchema` (`protocol/src/index.ts:10`) carries only seat counts and two
   generic clocks. The one-on-one format, Foundation and a five-minute quick length are
   branches inside the one implemented path, not configurations of it. Unifying the tables
   would have left behaviour forked.

The pattern across all four is _a second representation of something that already has
one, justified as "this kind is different."_ Daisy is pre-ship, so ADR 0023 governs:
rewrite the baseline, delete the compatibility code, keep no dual path.

## Decision

### 1. The Round is the invariant

A round is a round. How it was created, whether it is rated, and whether a seat is
occupied by a human or an AI do not create different round types.

- **1.** Every actual debate occurrence is a Round.
- **2.** Human, bot, and future participant types occupy the same `RoundParticipant` seats.
- **3.** `RoundParticipant`s are authoritative records. Round state may carry engine
  position but must never own a second participant collection.
- **4.** Ranked, casual, practice, tournament, matchmaking and challenge must not create
  alternate round schemas.
- **5.** All speeches and transcripts use the same utterance model.
- **6.** One ballot contract. Every ballot, human or AI, validates against the same
  protocol schema.
- **7.** AI runtime state belongs to the AI participant's run, not to an AI-specific round.
- **8.** There are no `ai_round` / `ai_debate` lifecycle tables.

`debates` is renamed `rounds`. `mode` is uncollapsed: `competition_type`
(`ranked | casual | practice`), `length` (`quick | full`) and `ladder_id` are separate
columns, because `quick` was doing three jobs at once — a rated mode in ADR 0055 §5 and
a match length in the onboarding questionnaire.

### 2. Three-layer identity

`Actor` is who it is (persistent). `RoundParticipant` is that actor's incarnation in one
round. `AgentRun` is the AI process operating that seat for one execution. A
`RoundParticipant` gains a surrogate `id`, so every reference names the seat rather than
reconstructing `(round, actor)`.

### 3. Format, Room, Round — one home for customization

```
FormatRevision      what is legal: grammar, per-segment default timing, capabilities
      +
RoomConfig         what this Room chose
      ↓ resolveRoomConfiguration()          pure, total, one compiler
RoomExecutionPlan + RoundRules
      ↓                    ↓
Room executes       startRound() freezes
pre-round work      ↓
                     ECS executes
```

**The Room chooses all settings. The Round stores only the resolved settings that govern
the competitive occurrence.**

Three rule categories, separately constrained. _Structure_ — seat counts and the ordered
segment grammar — is fixed by the format, and is what makes the one-on-one format and
Foundation the same engine rather than two code paths. _Timing_ and _interaction_ are bounded
by the definition and chosen in the Room. Capabilities are **permitted sets**
(`crossExModes[]`, `interruptions.modes[]`, `yield.enabledChoices[]`), never typed values,
because the distinction between what a format permits and what a Room chose _is_ this split.

"Disabled" has one spelling per level: `null` in the definition means the format forbids it;
`{ enabled: false }` in the config means available and declined. `forbidden ≠
available-but-disabled`.

**Prep is two concepts.** `preRoundPrep` is Room-executed and never becomes a round rule.
`inRoundPrep` is a nullable budget in `RoundRules` that ECS enforces — which is what
`ai-debate.ts:242` already implements by decrementing `prepLeft` inside the turn loop.

### 4. Ranked is constructed, not validated

A ranked round resolves from an approved `RoomConfig`, so ranked and unranked share one
compiler and the only difference is where the config came from. An invalid ranked
configuration is **unrepresentable** rather than detectable afterwards.
`rulesMatchFormat()` is deleted along with the validation responsibility it named;
`assertRatedRoundIntegrity` instead compares the round's frozen provenance.

`format_presets` holds sanctioned `RoomConfig` values as immutable revisions, keyed
`(format_id, length, version)` with at most one current and every earlier retained.

### 5. Provenance is pinned and structural

`formats.version` is an optimistic-concurrency counter that increments in place, so it
cannot preserve history. `format_revisions` holds immutable `FormatDefinition` revisions;
`formats` becomes identity plus a `current_version` pointer, `DEFERRABLE INITIALLY
DEFERRED` so identity and its first revision commit together.

Rounds and presets carry composite FKs to the exact revision they resolved against, and a
Round carries a composite FK over `(format_id, length, preset_version, format_version)`
onto the preset — so Postgres establishes that a Round's preset was approved against the
definition revision that same Round pins.

### 6. Postgres is truth; ECS is execution

ECS executes a `RoundRuntime` hydrated from durable state. No ECS entity, storage or
resource is ever persisted: `@adobe/data` is pre-1.0 and warns that minor versions may
break APIs, so its representation is never coupled to durable data.

`runtimeCheckpointSchema` holds only what has no row — three fields: side-keyed prep
consumption, the active prep clock anchor, and the interaction floor after an accepted
interruption. Everything else reconstructs, because a `round_segments` row _is_ the live
interval (`UNIQUE (round_id) WHERE ended_at IS NULL`).

ECS receives only `RoundRules` — never a format definition, a Room config or a default —
otherwise a format published mid-round would change a live debate, which is the same class
of bug as a snapshot owning participants.

The AI is an **actor implementation**: when ECS says participant X may act and X is a bot,
orchestration performs the work and submits the same legal Round operation a human would.

### 7. The Room is a durable pre-competition aggregate

Room _persistence_ is no longer deferred. Pre-round work runs before any Round exists, so a
crash during a long prep needs an authoritative resume point, and a format revised between
resolution and `startRound()` would otherwise invalidate the very rules the freeze copies.
`rooms` holds its config, pinned versions, the already-resolved `rules_snapshot`, seated
participants, and its own pre-round prep anchor — with the same composite provenance FKs a
Round carries.

This does not make Room part of the competitive kernel: no Round reads a Room, no rating
depends on one, and nothing in a Round's history would change if Rooms were deleted.
`startRound()` is the single moment values move between them.

### 8. Constraints that are decisions, not shape

- **Rated eligibility is a construction-time invariant.** A ranked round is resolved from a
  sanctioned preset or it does not exist. `ratingEligibility()` re-checks nothing about
  format; a failure there is an invariant violation, not `{kind:'unrated', reason:'rules'}`.
- **Ratedness has one authority.** `competition_type` alone decides it;
  `ladder_id` is configuration a ranked round requires, constrained by a derivation CHECK
  so a stored value cannot contradict the rule that produced it.
- **Abandonment is lifecycle, not outcome.** A `rounds_lifecycle_check` constrains status,
  stage, outcome and both timestamps together; `abandoned` deliberately leaves
  `started_at` nullable for a round abandoned before starting.
- **AI practice capacity is reclaimed durably at admission.** Under the global
  admission lock, scheduled practices with no execution for 15 minutes and active
  practices with no execution for two hours become abandoned. Reclamation locks
  their round rows, closes open segments, clears transient prep/floor state, records
  completion on the database clock and increments the version before counting live
  capacity. Reservations remain for the rolling daily allowance; only scheduled and
  active status consumes global capacity.
- **Recorded speech has a bounded finalization window.** A person's clip may enter
  transcription until 30 seconds after its segment's actual close or scheduled end,
  whichever is earlier. Eligibility uses the database instant at admission; admitted
  transcription may finish after closure without losing its words. Naturally expired
  final speech enters ballot readiness before the browser treats its open interval as
  live. The browser waits for the final recorder flush before asking the judge for
  a ballot. Completed forfeits carry the terminal outcome and never request judging.
- **A submitted ballot cannot be erased by seat deletion.** The judge-participant FK is
  `RESTRICT`; retirement is voiding, which records who and when. This ships in the same
  migration as the participant surrogate id, so no intermediate model exists where uniform
  seats coexist with vanishing ballots.
- **Redundant parent ids are consistency witnesses.** A child naming two things that must
  share a parent keeps `round_id` — as `utterances` does, with scoped composite FKs onto
  both parents. Omitting it removes the evidence, not the hazard. A child naming one parent
  omits it.
- **Write-path domain invariants**, where the relationship crosses tables and no CHECK can
  express it: seat completeness against `rules_snapshot.seats`; the live-segment count per
  stage; atomic round completion verifying the ballot belongs to its judge
  participant; one expiring, fenced AI speech generation claim per segment;
  the compiler's refusal set.

AI-practice orchestration admits only practice rounds with a member debater,
one roster AI opponent and the configured AI judge. A debater's seat in a
human or ranked round grants no right to drive it through practice operations.
Playback and heard reports require an active round and are bounded to the
segment's live interval plus a thirty-second cutoff grace period. Terminal
rounds refuse both operations. A hydration tick may waive a browser's stale
version only when its reread observes exactly its own next version; intervening
commands retain optimistic-concurrency authority. Automatic prep requests use
the runtime's remaining side-specific budget and stop when it is exhausted.
Hydration returns durable segments in ascending `sequence` order, so runtime
clock anchors and transcript schedule positions agree.

### 9. Documents: prep is the source, the Round is a view

`documents` is owned by an actor and has no round FK. Round references grant
workspace scope only; every document read still requires ownership unless an
explicit sharing permission is introduced. `round_document_refs` is the Round's
view over what the owner can read. **Ending or deleting a Round never implies deleting a
Document** — removing one from a Round removes the ref row only. The ownership decision is
included here so the kernel is not built on the inverted dependency; the build is separate
leaves, and the PageSpace boundary remains open.

## Consequences

- **Migration.** A baseline rewrite, not a compat path: `debates → rounds`,
  `debate_participants → round_participants` (+surrogate id, authoritative),
  `debate_commands → round_commands`, `ballots` absorbing `ai_debate_ballots`, and the four
  `ai_debates` tables deleted along with every service, domain or API abstraction that
  existed only for them. `aiDebateTurns`, `aiDebatePrepMs`, `aiDebateCountdownMs`,
  `formats.ranked_eligible` and `rulesMatchFormat()` all leave the engine or the schema.
- **The engine becomes one engine.** Formats are data rows configuring a shared runtime;
  the schedule, prep budget and countdown are resolved rules rather than constants. The
  one-on-one format and Foundation differ in `segments`, not in code paths.
- **A new invariant can be registered.** A spec invariant that no AI-specific lifecycle table
  exists would fail the build if the fork returned — the failure mode this ADR exists to
  prevent.
- **`role_grants` stays unread.** Scoped grants and a membership primitive remain a separate
  ADR. Clubs are a social layer over rounds, structurally excluded from competitive pairing
  because `ratingScope` is `(actor, format, season, ladder)` with no social input.
  `'coach'` is a demand signal in `wantChoices`, stored correctly in `member_interests`;
  interest is not capability, and no coach table is warranted.
- **Account erasure must delete documents explicitly.** `users` keeps its tombstone row, so
  `ON DELETE CASCADE` does not reach actor-owned rows.
- **Superseded in part.** ADR 0029's "the snapshot stays the domain source of truth" — a snapshot
  may carry engine state, never participants. ADR 0054 §3 — documents leave the round FK.
  ADR 0055 §5 — modes and ladders; `quick` becomes a preset dimension and ranked rounds are
  constructed from presets rather than validated against a format.
- **Left open, deliberately.** Whether an abandoned ranked round rates. Whether prep
  lives in Daisy or a PageSpace drive — and, if external, the ADR 0036 data-processor
  question that `under-13` age banding raises. None of these changes what a Round _is_.
- **Settled here, with the mechanism open.** Ranked eligibility itself is decided in §4 and §8:
  it is a construction-time invariant, because a ranked round resolves from a sanctioned preset
  or it does not exist. What stays open is only _where_ that is physically enforced — a
  deferrable constraint trigger, a composite provenance FK the compiler's inputs already imply,
  or transactional enforcement in the application. (Postgres has no deferrable `CHECK`; a
  constraint _trigger_ can be deferred.) The mechanism cannot weaken the decision, since every
  option refuses to admit an invalid ranked round.
- **Not settled here.** A persisted `Room` had been deferred; it is now required (§7), which
  is a change from the earlier framing of this work rather than a clarification of it.
