# 0095: Honest Round completion

Status: accepted by the point guard on the owner's behalf, 2026-11-02. DEC-275,
DEC-276, DEC-277 and DEC-278 stay provisional until the owner confirms or
overrules them. Amends the attendance and judging sections of
[ADR 0067](0067-playable-round-policy-and-acceptance.md).
Plan: [Round completion](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/sbyts8vf07jfii620old797r).

## Context

Two staging Rounds stayed active past their deadlines on 2026-10-31. Both
debaters had on-time receipts, but ADR 0067 required settled availability
evidence for every attendance decision, and a broken synthetic probe produced
none. An AI judge's failed job also never reached completion, so an AI-only
Round waited out a human judging window nobody could use, and a rated Round with
no ballot had no ending at all.

## Decision

**Positive evidence stands alone.** The eligible scheduled speaker's durable
receipt inside the base window (actual opening minus lead, through opening plus
grace) proves attendance with no availability history. This replaces ADR 0067's
"never finalize while the effective deadline remains undetermined" for that one
case. Inferring absence, and accepting any later receipt, still requires settled
evidence. Windows still resolve in actual speech order, the final speech stays
exempt, and a missing bot receipt stays worker loss.

**Unknown health forfeits nobody, and it ends (DEC-276, DEC-278).** A window
settled evidence cannot resolve waits until a persisted cutoff, 60 minutes after
the actual final speech end. It then ends the Round through the existing
abandoned path, with no winner. Past the cutoff a window is still decided on what
its history proves, so a provable absence still forfeits; only what evidence
cannot decide ends this way. A receipt after the base window never takes the
positive path: it counts only if settled evidence later proves an extension. A
pending check-in writer holds the cutoff, because age alone proves nothing, and
that hold is projected and measured.

**Each deadline has one owner (DEC-275).** The human ballot deadline is how long
a human judge may rule, and an AI-only panel has none. The AI judging budget is 5
minutes from the freeze, on the job, and bounds provider work only. A validated
pending ballot may still submit after it. That hold ends at the latest of the
attendance cutoff and 10 minutes after the last attendance decision or uncertain
writer resolving, so a ballot gets its chance once attendance settles, and one
that can never submit stops holding the Round. Its job then ends `ballot_hold_ended`, which is reported; a forfeit cutting a job off is `round_ended`, which is normal and is not. The attendance cutoff is an
infrastructure bound. None of them borrows another's meaning.

**Panel completion is total (DEC-277).** A Round waits only on a judge who can
still rule. A failed AI judge never holds a Round and never blocks a human
ballot. All ladders use this one rule, so the casual-only guard is gone. A null
outcome writes no rating. `judging-failed` is a receipt ruling, not a Round
status. Refund treatment for a paid AI failure stays open with the owner, and
nothing here adds refund behavior.

**The server owns the state.** The engine decides what a played Round is waiting
on, and the Round read carries it. Only a human window shows a clock, counted to the persisted deadline.

## Consequences

- An outage can no longer strand a Round whose debaters showed up.
- A Round with a missing on-time receipt during a long outage ends with no
  winner, and a human ballot already cast is dropped. That is the honest result,
  and it can cost a real win.
- One evaluation reads at most 10,800 samples, a true settled prefix. An overrun of
  its transaction would delay that Round's end by backoff. Measured at the cap on local PostgreSQL only, with no other load: 10,800 rows read in about 10 ms and a whole evaluation in 21 to 25 ms over 3 runs. Staging is unmeasured.
- The deferred database guard on winnerless completion now fences only the human
  window. An AI seat's bound is enforced by the panel decision and its job.
- Rounds still active when this deploys resolve through these same paths on their
  next maintenance pass. That is the authorized attendance and completion path,
  not a data repair.
