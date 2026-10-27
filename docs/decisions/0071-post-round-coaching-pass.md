# 0071: Every completed round coaches each debater; ballot feedback stays with its side

Status: accepted for the MVP beta on 2026-10-26 (owner GO for the MVP push;
the decision is made on the owner's behalf and recorded here).

## Context

After a round, a debater should be able to see why they won or lost. Three
gaps stood in the way:

- **Feedback privacy.** A ballot carries a reason both debaters see and
  optional feedback for each side (`ballots.feedback`, ADR 0058 §6). The
  round read released every ballot with both sides' feedback to every
  reader, opponents and spectators included.
- **Coaching.** The AI judge already writes feedback for both sides on its
  ballot. A round judged only by humans, or judged by no one (DEC-191),
  gave a debater coaching only if a human judge chose to write it.
- **Transcript.** The frozen transcript (`utterances`, DEC-101) was readable
  only by a judge's own seat. Debaters never saw it after the round.

## Decision

1. **Ballots name the kind of judge, never the judge.** A released ballot
   says `judge: 'human' | 'ai'`. A human judge's identity stays anonymous
   (DEC-98).
2. **A ballot's feedback for a side reaches only that side's debater.**
   The database read narrows each released ballot's `feedback` to the
   reader's own side. A judge reads their own ballot whole through `own`;
   opponents, other judges and spectators read none of it.
3. **Every completed round gives each debater AI coaching**, in this order:
   - When a submitted AI ballot has feedback for the debater's side, that
     feedback is the coaching (`coaching.status = 'in-ballot'`). No second
     call is made.
   - Otherwise one coaching pass runs for the round. It writes short,
     actionable coaching for both sides from the same frozen evidence the
     AI judge reads (`roundCoachMessages` in `@daisy/ai-voice`). It never
     produces a ballot or affects the outcome.
4. **The coaching pass is one durable, budgeted, idempotent job.** Its row
   in `round_feedback` is keyed by the round and bound by foreign key to
   the frozen transcript revision it read. A round qualifies for the pass
   when all of these hold:
   - it completed in the last 24 hours;
   - it has a freeze with at least one line;
   - no submitted AI ballot already coached both sides.

   A completed round takes no more ballots, so no judging still to come can
   coach it later.

   Who decides what:
   - **The coaching feature decides.** Eligibility, the window and the call
     budget are a pure decision in `apps/web/src/features/round-coaching/policy.ts`,
     with an explicit clock and explicit policy bounds. The same decision
     drives the worker's claims and the debater's coaching state.
   - **The database supplies plain facts and persistence.** It lists
     candidates with a bounded query, reads a round's coaching facts, and
     applies the injected decision inside the claim's transaction before an
     attempt is spent. It keeps the lease token, uniqueness, the attempt
     count and usage transactional.

   The job runs this way:
   - It is claimed only once the shared provider capacity admits the call,
     so a busy provider never spends an attempt.
   - Each claim is one paid call under a lease that covers the whole call
     (the call timeout plus the worker lease), so nothing renews it.
   - It buys at most two paid calls per round. Usage is recorded on the row
     before the answer is validated. Only an answer for both sides, each
     within the ballot feedback limit, is stored, and only while the lease
     holds.
   - A lapsed lease ends the job as `failed` when it is at the cap or the
     round no longer qualifies.
   - The pass runs only where `ROUND_BOT_WORKER_POLICY` is configured, with
     its judge model and provider concurrency. There is no second LLM client.

5. **Coaching is not charged to a member's AI practice allowance.** The
   allowance meters AI debates a member starts (ADR 0058, DEC-211). Coaching
   comes with every completed round, including human-only ones, where there
   is no sponsor to charge. Three limits bound its cost: the two-call cap per
   round, the 24-hour window, and the shared provider capacity.
6. **A debater sees the coaching state**: `ready` (with the text),
   `in-ballot`, `pending` (a pass is running or will run in this
   deployment), or `unavailable` (no transcript, the pass failed, coaching
   is off, or the round is outside the window).
7. **Seated participants read the frozen transcript** of a completed round
   with its completeness, through `frozen-transcript.ts`. No transcript is
   copied or stored anew.

## Privacy

`round_feedback.feedback` is personal/private: coaching derived from a
debater's speech. Each side's text reaches only that side.

- Retention: 180 days from job creation, the same as transcripts (DEC-101),
  enforced by `retention.round_feedback`.
- Erasure: subject erasure clears the coaching of every round the subject
  sat in, as it does for a pending AI judgment (DEC-223). It leaves the row
  `failed` with no text, so the round is never coached again. A debater erased before the round froze is not yet covered (ISSUE-625).
- The lawful basis is pending, as for the transcript it derives from.
- The lease token is stored only as a SHA3-256 digest.
- Usage counts, model and timestamps carry no personal data.

The declarations live in `round-transcript-privacy.ts`.

## Consequences

- Round pages show the decision, the reader's own coaching and the
  transcript, in that order. A live room whose round ends goes to that page.
- If coaching is later metered, it gets its own allowance kind; it never
  draws on AI practice.
- A different model for coaching would add a policy field. Until then it
  shares the judge model.

## Premium entitlement and competitive admission (DEC-247, ISSUE-664)

Coaching generation and reads require premium through the shared authorization
evaluator. Approved beta access supplies that grant only while
`PREMIUM_BETA_GRANT=true`; at launch the grant is disabled and billing can
supply the same named entitlement. AI-round allowances are not premium facts.
Official judge results remain available independently of coaching premium.

Coaching uses at most half the configured provider slots, rounded down, and
leaves one competitive slot. A one-slot deployment runs competitive work only.
Judging reserves capacity before its durable lease is claimed and holds it
through actual settlement and saved-ballot retries, so coaching refusal cannot
strand a judge lease. Discovery reads advisory canonical account facts without account locks; claims
reevaluate under canonical account fences;
reads withhold the separate coaching pass when the reader lacks premium.
Official ballots retain their existing side-private feedback projection.
