# 0125: Coherency judging: staged AI judging and rubric speaker-10@2

Status: accepted (owner, 2026-11-12; [plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/pjlpci06x82fydh414mlpwyh)).
Revises the speaker rubric DEC-243 and DEC-116 keep as Daisy's one rubric.
Answers the judging area's open decision "rubric revisions from beta data".
Builds on [ADR 0058](0058-one-round-model.md) (one ballot contract) and
[ADR 0119](0119-recoverable-round-evidence-and-result.md) (attempt windows and
recovery). DEC-390–DEC-393 record the defaults decided for the owner.

## Context

A debater-reviewed judge bench (`bun judge:bench`) replayed staging Rounds
through the production judge. On a Round the debater won as the affirmative,
the single-call judge voted negative in every run. It made the same three
errors each time:

- It called a distinction a concession of the opponent's framework.
- It called an argument "unanswered" when its premise had been attacked.
- It held one side's evidence to a time standard it waived for the other's.

These are logical-dependency failures. The judge read the round as a list of
separate arguments, not as cases where a defeated premise removes what depends
on it. Adding principles to one prompt barely moved it. A reviewing second call
found the errors, but its corrected ballot contradicted its own findings, and a
one-sided review swung the verdict the other way.

The owner's direction: judge every round by coherency. A thesis sets the
burdens that must be true, the warrants back those burdens, and everything is
based around that.

## Decision

1. **Rubric speaker-10@2.** Daisy's one rubric becomes the coherency rubric,
   for human and AI ballots alike. It has ten categories in four groups:
   - Case: Thesis, Burdens, Warrants, Coherence.
   - Clash: Refutation, Weighing (impact folds into weighing).
   - Cross-ex: Questioning, Answering.
   - Presentation: Organization, Delivery.

   Every write path accepts only the current version. Rubrics are data
   (`ballot-rubrics.ts`). A stored `speaker-10@1` ballot still reads, totals
   and renders on its own categories: the `ballots.rubric_version` CHECK
   admits both versions, and the stored-read contract is discriminated on the
   version. A tab draft is keyed by rubric version, so an old one is never read
   into the new form.

2. **Three stages.** AI judging buys three provider calls, one per stage:
   - **First pass:** today's single-call judge, on the current rubric. It is
     an internal record and is never shown to the final judge or to debaters.
   - **Case map:** a strict case-map contract read from the transcript
     alone. A stored map carries no version of its own; the attempt row's
     `judge-contract@2` names it. It records each side's thesis, burdens and warrants; the framework
     dispute and its ruling; attacks with the level they reach and the nodes
     they remove; concessions with the limits the speaker attached; coherence;
     and what still stands.
   - **Final:** the official ballot. It is decided in dependency order
     (framework, live burdens, what stands, which thesis is carried, then
     weighing) from the transcript and the map, and it may correct the map
     against the lines.

   Only the final ballot reaches the Round result.

3. **One stage per attempt.** A claim buys exactly the stage its job needs:
   - no first-pass outcome means `first`;
   - no case map means `map`;
   - otherwise `final`, which feeds the existing held-response path.

   DEC-210's one paid answer per attempt holds, and every provider call keeps
   its own attempt row, now with `stage`. A stored stage output is never bought
   again, including after a takeover. The first pass has one try: a failure is
   recorded and the job moves on, so it never blocks the official ballot
   (DEC-391). A first-pass call lost without a recorded outcome (its lease
   expired in a deploy or a crash) is that try too: the takeover finds its
   attempt still dispatched, marks the first pass failed and buys the case
   map. The store hands each claim one value, the held final ballot or the
   one stage due with what it reads, so a final stage is never due without
   its case map.

4. **Bounds.** A generation window holds 4 potentially paid calls (three
   stages and one retry), and a job's lifetime 24 (DEC-390). A stage's call may
   take up to 120 seconds. The case map is the long one: about 40 seconds and
   6,000 output tokens on a full Round.
5. **Stage records.** `round_judging_jobs` keeps `first_ballot`, or
   `first_ballot_failed`, and `case_map`, each with its receipt time. Unlike
   the held response, they stay after success: they are the first-pass
   against final comparison (`bun judge:bench passes`). They are private
   derived judging data with the ballot purpose and lawful basis. The
   retention sweep (`retention.judging_stages`) clears them 180 days after
   receipt, and subject erasure clears them for the Rounds the subject sat in,
   ranked Rounds excepted, as for held responses (DEC-393). As with a held
   response, erasure also ends judging work still open on those records
   (`ballot_discarded`), so no later claim buys them again.
6. **Contract.** `judge-contract@2` covers the three prompts and the
   ballot and case-map wire schemas, both derived from their contracts. The
   judge model is `openai/gpt-6.1-terra`, which benched correctly at a third
   of the previous model's cost.

## Consequences

- An AI-judged Round costs three calls instead of one. On Terra that is about
  $0.06, and the lifetime bound is about $0.50. One usage reservation per
  Round is unchanged.
- The judging time from freeze to ballot grows to about a minute, well inside
  the 5-minute AI budget.
- The first pass and the final ballot share one contract, so a comparison is
  direct: winner agreement and per-category shifts.
- Human ballots score the new categories. Old ballots stay readable, and no
  stored ballot is rewritten.
- The bench renders each production stage exactly and can re-run them, so a
  prompt change is benched before it ships.

## Alternatives considered

- **One call with more principles.** Benched across 20 combinations, it never
  fixed the dependency errors.
- **A judge, then a review of failure modes.** The review found errors but
  kept or contradicted them. A one-sided review swung the verdict.
- **Showing the first pass to the final judge.** This anchors the final judge
  on the very reading being corrected, so the first pass stays a record only.
- **A stage table.** One row per stage would duplicate the job's provenance,
  which each stage's attempt row already carries, so the stages live on the
  job.
