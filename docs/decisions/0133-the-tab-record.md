# 0133: The tab record

Status: accepted (owner direction, 2026-11-13; built in the Daisy Tab schema
slice, TAB-4).

## Decision

1. **A fixture is not the Round.** A fixture is what is scheduled for one
   Room in one tab round: a pairing, a section or a bye. The Round is what
   happened. A fixture has one identity for life and belongs to its tab
   round, not to a draw version.
2. **Who meets whom never changes on a published fixture**, by trigger; a
   different pairing is a different fixture. Its status moves only from draft
   to published to withdrawn, and a published fixture is never deleted. A bye
   and a draft have no Room; any other fixture has one, in its own lobby,
   from the moment it is published.
3. **A draw is a version of the plan**: the fixtures it holds, and the
   resolved settings, results and seed it was computed from. A fixture in two
   versions is one row. A published draw, the fixtures it holds and the
   results it names never change, by trigger.
4. **Judges and seats belong to the fixture.** Assigning, replacing or
   removing a judge after publishing is an officiating command recorded in
   the action history; none makes a draw version.
5. **One live fixture per entry and per judge in a tab round**, by a partial
   unique index over a copy of the fixture's status that a cascading foreign
   key keeps equal. "One person, one Room per time slot" spans events, so it
   is the command's rule, serialised by the time slot's version.
6. **Results supersede.** A result is recorded only on a live fixture; one
   original per fixture; a correction is a result that supersedes one of the
   same fixture, with a reason, and each result is superseded at most once.
   The earlier row stays and nothing is recomputed. A fixture with a result
   cannot be withdrawn. Results and what they gave each entry and speaker
   are append-only.
7. **Standings are never stored.** Standings, breaks and season standings
   are folds over results; the result rows carry every input, so the engines
   never read a Room or a ballot.
8. **A certification pins the exact results it confirmed.** A later
   correction is in no certification until a new one names it, so a
   sanctioning league does not receive it until then.
9. **A release is a fact.** The row says a thing opened to an audience for a
   tab round and what opened it, once per tab round, thing and audience, and
   is append-only, so a later change of setting never closes what people have
   already seen.
10. **A conflict is always recorded**, even when its command is refused; a
    confirmation is a new row naming the confirmer. A command held for a
    second person is stored whole and settled at most once.
11. **A sanction stores no terms.** It names the league's own template and
    season; whether the event meets the template is computed when the league
    answers.

## Consequences

- Every row of the record carries its ancestry (lobby, event, tab round) and
  a composite foreign key proves it, so an entry in a fixture is an entry of
  the fixture's event, and a result's event is its fixture's.
- Tests over the record cannot delete what they write; they run in a
  transaction that is rolled back.
- `results.round_id` is the only path from the tab record to the Round
  kernel. Engines take result rows and never follow it.
