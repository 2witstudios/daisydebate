# 0106: Feature homes

Status: accepted (2026-11-03; architecture audit 2026-11, ISSUE-1015, ISSUE-1016,
ISSUE-1017). Supersedes the `role_grants` clauses of
[ADR 0029](0029-competitive-schema-foundation.md),
[ADR 0030](0030-effective-rules-and-growth-paths.md),
[ADR 0043](0043-no-admin-surface-in-participant-app.md),
[ADR 0048](0048-authorization-core.md), [ADR 0057](0057-planned-readers.md) and
[ADR 0058](0058-one-round-model.md), and the "ranked or not" clause of ADR 0058's
bot-debater capacity. Builds on
[ADR 0023](0023-greenfield-baseline.md).

## Context

The audit found concepts living in two or more places, and foundations with no
writer. Each stayed correct only while its copies agreed.

## Decision

1. **One member boundary.** `apps/web/src/server/member-boundary.ts` runs same
   origin, session, who may pass and, for a route that acts as the member's
   actor (`runMemberRoute`), the feature's own bucket and rule. A route whose
   evaluator decides from the principal uses `runEvaluatedRoute`, which waitlisted
   and restricted accounts pass too. Each feature keeps its own refusal
   vocabulary. The actor is read once a request, by identity resolution, and a
   durable write checks it again under the account fence; no route reads it
   again. A missing actor resolves `unavailable`, so it answers INFRASTRUCTURE:
   the fault is in the data, not in the caller's authority.
2. **A Round read belongs to Rounds.** `GET /api/rounds/:id` is served by
   `round-runtime` from `roundViewReader`, with its own `round-member:view`
   budget. The Room feature neither serves nor composes it.
3. **One vocabulary.** Protocol exports `roundOutcomeSchema`, `judgeRulingSchema`
   and `panelRulingSchema` with their types. A judge ruling is one seat's winner;
   a panel ruling is why panel completion ended the Round.
4. **The media window is its own policy.** `roundMediaPolicy` holds it, and the
   engine's `mediaWindowClosed` is the one decision. `packages/db` applies the
   rule it is handed. It is not the ballot deadline, which `judgingPolicy` bounds
   from the freeze, even though both are 30 minutes today.
5. **A seat is offered only if it can run.** `aiSeatAvailability` derives the bot
   debater and the AI judge separately from key, policy, budget and, for a bot
   debater, the busy cap and the media service. A key with no policy offers neither and still boots,
   since a key alone is not a misconfiguration.
6. **A bot debater launching is one fact.** `castGate` refuses a ranked bot
   debater before any mutation, so the capacity-only admission was unreachable
   and is deleted. `castSeatsBotDebater` names the fact, and admission takes both
   its consequences, allowance and capacity. Capacity stays counted from seats,
   never from reservations. If ranked play ever seats a bot debater, or a cast is
   exempted from the allowance, admission changes with it and says so.
7. **Writerless foundations go.** `role_grants` had no writer and no reader except
   a retention guard, and `seasons.status = 'scheduled'` had no writer. Both are
   dropped. LEAGUE-OPS designs the grant table it needs when it has a reader.

## Consequences

- Attendance and documents now answer a stale actor as a 503 that reaches the
  error tracker, not a 403 or a pass.
- A partly configured deployment refuses Launch with `actor-ineligible` rather
  than throwing INFRASTRUCTURE.
- The browser server, which runs no AI worker, states its seats through
  `createApp({ aiSeats })`.
