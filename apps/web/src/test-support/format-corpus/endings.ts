import { adjudicateAttendance, attendancePolicy } from '@daisy/debate-engine';
import { isJudgeSeat, judgeSeat, sideSeat } from '@daisy/protocol/seats';
import { type JudgingPanel } from '@daisy/protocol/round-panel-completion';
import { majorityJudging } from './panel-decisions';
import { attendanceCases, firstSpeechEvidence } from './attendance-cases';
import { corpusAt, seatAt } from './corpus-seats';
import { harness, oneOnOne, scheduleMs } from './one-on-one';
import { panelCases } from './panel-decisions';
import { panelsFromFacts } from './panel-facts';

/**
 * A Round whose first speech the affirmative missed: attendance decides from
 * the check-ins present, and a runtime rehydrated from the rows applies it.
 */
const attendanceEnding = (present: readonly ('affirmative' | 'negative')[]) => {
  const rules = oneOnOne();
  const round = harness(rules);
  const evidence = firstSpeechEvidence(rules, round.seats, present);
  const decision = adjudicateAttendance(evidence);
  round.activate();
  round.tick('first speech opens', rules.countdownMs);
  const now = new Date(evidence.nowMs).toISOString();
  if (decision?.decision === 'forfeit' || decision?.decision === 'abandoned')
    round.record(
      'adjudicate',
      now,
      (on) => on.adjudicate({ segmentId: 'segment-1', decision, now }),
      true,
    );
  return { evidence, decision, steps: round.steps };
};

/** A Round played to its end, then abandoned when attendance could not settle by the cutoff. */
const cutoffAbandonment = () => {
  const rules = oneOnOne();
  const round = harness(rules);
  const endMs = scheduleMs(rules);
  const abandon = (label: string, ms: number) =>
    round.record(
      label,
      corpusAt(ms),
      (on) =>
        on.adjudicate({
          segmentId: 'segment-1',
          decision: { evidence: 'resolution_cutoff', decision: 'abandoned' },
          now: corpusAt(ms),
        }),
      true,
    );
  round.activate();
  round.tick('schedule ends', endMs);
  abandon('before the cutoff', endMs + 1_000);
  abandon('at the cutoff', endMs + attendancePolicy.resolutionCutoffMs);
  return round.steps;
};

/** A judge, then the negative, forfeiting by command in the middle of the first speech. */
const commandForfeit = () => {
  const round = harness(oneOnOne());
  const forfeit = (role: 'judge' | 'negative') =>
    round.record(`${role} forfeits`, corpusAt(60_000), (on) =>
      on.execute({
        command: { type: 'forfeit' },
        actorId: seatAt(
          round.seats,
          role === 'judge' ? judgeSeat() : sideSeat(role),
        ).actorId,
        now: corpusAt(60_000),
      }),
    );
  round.activate();
  forfeit('judge');
  forfeit('negative');
  return round.steps;
};

/** A played Round whose panel of `judges` rules as `winners` say (null = no ballot). */
const panelEnding = (
  judges: number,
  winners: readonly ('affirmative' | 'negative' | null)[],
) => {
  const rules = oneOnOne(judges);
  const round = harness(rules);
  const endMs = scheduleMs(rules);
  const judgeIds = round.seats
    .filter((s) => isJudgeSeat(s.seat))
    .map((s) => s.id);
  const ballots = judgeIds.flatMap((id, index) => {
    const winner = winners[index] ?? null;
    return winner ? [{ judgeParticipantId: id, winner }] : [];
  });
  const [first, ...rest] = judgeIds;
  const panel: JudgingPanel = {
    humanWindow:
      first === undefined
        ? null
        : { deadlineAt: corpusAt(endMs + 30_000), seatIds: [first, ...rest] },
    aiSeats: [],
  };
  const complete = (label: string, ms: number) =>
    round.record(
      label,
      corpusAt(ms),
      (on) =>
        on.completePanel({
          now: corpusAt(ms),
          judging: majorityJudging,
          ballots,
          completeness: 'complete',
          panel,
        }),
      true,
    );
  round.activate();
  round.tick('schedule ends', endMs);
  complete('inside the window', endMs + 10_000);
  complete('after the window', endMs + 60_000);
  return { ballots, panel, steps: round.steps };
};

/** Every ending case, by corpus file name. */
export const endingCases = (): readonly (readonly [string, unknown])[] => [
  ...attendanceCases(),
  ['forfeit-by-attendance', attendanceEnding(['negative'])],
  ['abandonment-by-attendance', attendanceEnding([])],
  ['abandonment-at-cutoff', cutoffAbandonment()],
  ['forfeit-by-command', commandForfeit()],
  ['panel-ruled', panelEnding(1, ['negative'])],
  ['panel-split', panelEnding(2, ['affirmative', 'negative'])],
  ['panel-partial', panelEnding(3, ['affirmative'])],
  ['panel-did-not-rule', panelEnding(1, [])],
  ['panel-unjudged', panelEnding(0, [])],
  ...panelCases(),
  ['panels-from-facts', panelsFromFacts()],
];
