# 0085: Round analysis is its own product, separate from judging

Status: accepted on 2026-10-27 (owner-approved design, plan "Round analysis
separation"). Supersedes [ADR 0071](0071-post-round-coaching-pass.md)
items 3 to 6 and its premium section. ADR 0071 items 1, 2 and 7 stand: a
ballot names only the kind of judge, a ballot's feedback reaches only its
side, and seated debaters read the frozen transcript.

## Context

The owner's intent: "This is basically a post-round chess.com: you want to
receive analysis. This is where the upsell is." Round analysis is a premium
report (DEC-247). "Judge feedback IS the ballot. AI feedback is like a
report: it gets data differently, it has different prompts. It's not the
same feature at all."

ADR 0071 made the AI judge's ballot feedback _be_ the AI report, to save one
model call. That shortcut spread into every layer:

- the judge prompt asked for the report;
- a Round was skipped when an AI ballot "already coached" it (`'in-ballot'`);
- the report rode inside the ballot read and was typed as ballot feedback;
- one provider counter with a three-way work class served judging, bot
  speech and the report, which ran only when `providerConcurrency > 1`;
- the report shared judging's model, lease, limits, lifecycle and modules.

### Post-mortem

ADR 0071 was a micro-optimization that merged two concepts. In this codebase
names and organization are the architecture: whatever shares a name, type,
module or pool is read by every later agent as one concept. The merge
therefore bred more coupling, and the word "coaching" implied a coach
concept that never existed, so the report was filed next to judging. Saving
a call, a table or a pool is never a reason to merge two concepts. When a
structure does not match the product's concepts, it is refactored first.

## Decision

1. **Names.** The report is **Round analysis**. "Coach" and "coaching" are
   reserved for future human coaches; no AI feature uses them, and
   `scripts/check-boundaries.ts` refuses new uses. Train's practice aid is
   "practice prompts".
2. **One concept, one home.** Round analysis owns its protocol contract
   (`round-analysis.ts`), its prompt and parser (`@daisy/ai-voice`
   `round-analysis.ts`), its table (`round_analyses`), its db modules and
   facade, its privacy adopter and retention target, its feature
   (`features/round-analysis`), its route
   (`/api/rounds/[roundId]/round-analysis`), its worker and its UI. It reads
   only the neutral transcript evidence. It never reads, waits on or
   replaces a ballot, and `check-boundaries` refuses imports between it and
   `round-judging` or `round-ballots`.
3. **One debater seat per analysis.** A report is about one debater, so the
   unit is the seat: only an entitled human debater's seat is analysed, and
   each prompt can carry that debater's own earlier skill scores (patterns
   across Rounds). This can cost two calls where one would do; that is
   accepted.
4. **A real report.** The report has a summary, improvements, key moments
   citing transcript lines with the strongest reply, missed opportunities,
   its own six skill scores and patterns, with its own limits. The parser
   refuses any cited line that is not in the freeze.
5. **Its own policy and budget.** `ROUND_ANALYSIS_POLICY` configures it; it
   runs if and only if that is set. It has its own provider budget. AI
   judging (`ROUND_JUDGING_POLICY`) and bot debaters
   (`ROUND_BOT_WORKER_POLICY`) each have their own policy and share the
   competitive budget (`COMPETITIVE_PROVIDER_CONCURRENCY`). The provider
   budget is a neutral bounded counter with no work classes.
6. **Premium is a grant fact.** The entitlement is the account's own
   `round_analysis` grant in `account_entitlement_grants`, written by the
   beta access command in its transaction, never derived from beta state
   (ISSUE-779). The AI-round allowance reads its own `ai_rounds` grant the
   same way. `PREMIUM_BETA_GRANT` says whether beta-sourced round analysis
   grants count (false at launch). Capabilities are `round.analysis.read`
   and `round.analysis.generate`.
7. **Free and premium.** Every seated debater keeps the ballot and the
   transcript. Without the entitlement, the round analysis view is `locked`:
   an upsell with no content, since DEC-247 forbids generating for a debater
   without it. The ballot read is identical with and without premium.
8. **Greenfield.** `round_feedback` is dropped with no data carried over
   (ADR 0023): its beta rows were expendable two-sentence reports within a
   180-day retention, and nothing depends on them.

Related separations in the same change: the AI judge has its own
`ai_judge_profiles` table and may hold only the judge seat, while
`bot_profiles` debaters may hold only a side (ISSUE-750); the usage
reservation kind is `ai_round` (ISSUE-774).

## Consequences

- The Round page shows the decision and the transcript from the ballot read,
  and the debater's round analysis from its own read.
- A future paid source writes its own grant row; callers do not change.
- Human coaching, when it is built, owns the word "coach".
- Details: [round analysis](../architecture/round-analysis.md).
