import { instantMs } from '@daisy/clock';
import { oneOnOneSettings } from '@daisy/db/reference-formats';
import { clockStopsOf } from '@daisy/protocol/round';
import type { RoundView } from '@daisy/protocol/round-view';
import {
  affirmativeSide,
  negativeSide,
  sideOfSeat,
} from '@daisy/protocol/seats';
import type { ClockInstantFacts } from '../../scripts/node-kill-drill/clock-instants';
import type { DrillMoment } from '../../scripts/node-kill-drill/target';
import { ballotRoundCommand, readBallotRound } from './human-ballot-round';
import {
  oneOnOneChoice,
  pointsOfInformationChoice,
  type ProofChoice,
} from './human-round-selection';
import type { DrillEvidence } from './node-kill-drill-evidence';
import { nowMs } from './node-kill-drill-nodes';

type Member = {
  readonly context: import('@playwright/test').BrowserContext;
};
type ClockMoment = Extract<DrillMoment, 'mid-prep' | 'mid-cx' | 'mid-poi'>;

const PREP_BUDGET_MS = 60_000;
/** A kill into cross-examination, well before its 30 s clock runs out. */
const INTO_CROSS_EX_MS = 3000;
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** The format and countdown a kill runs on: prep and points need their rules on. */
export const drillChoiceOf = (
  moment: DrillMoment,
): { readonly choice: ProofChoice; readonly countdownMs: number } => {
  if (moment === 'mid-prep')
    return {
      choice: {
        ...oneOnOneChoice,
        inRoundPrep: { enabled: true, budgetMsPerSide: PREP_BUDGET_MS },
      },
      countdownMs: oneOnOneSettings.speechTiming.countdownMs,
    };
  if (moment === 'mid-poi')
    return {
      choice: {
        ...pointsOfInformationChoice,
        preset: {
          config: {
            ...pointsOfInformationChoice.preset.config,
            // A parliamentary-length point, so the node dies while it is given.
            pointsOfInformation: {
              enabled: true,
              protectedStartMs: 10_000,
              protectedEndMs: 30_000,
              maxDurationMs: 15_000,
              offerLapseMs: 5_000,
            },
          },
        },
      },
      countdownMs: 0,
    };
  return {
    choice: oneOnOneChoice,
    countdownMs: oneOnOneSettings.speechTiming.countdownMs,
  };
};

export const isClockMoment = (moment: DrillMoment): moment is ClockMoment =>
  moment === 'mid-prep' || moment === 'mid-cx' || moment === 'mid-poi';

const seatOf = (view: RoundView, side: string) => {
  const seat = view.participants.find(
    (entry) => sideOfSeat(entry.seat) === side && 'id' in entry,
  );
  if (!seat || !('id' in seat)) throw new Error(`No ${side} seat`);
  return seat.id;
};

const until = async (
  members: readonly Member[],
  roundId: string,
  holds: (view: RoundView) => boolean,
  limitMs: number,
  what: string,
) => {
  const deadline = nowMs() + limitMs;
  for (;;) {
    const view = await readBallotRound(members[0]!.context.request, roundId);
    if (holds(view)) return view;
    if (nowMs() >= deadline) throw new Error(`Never reached: ${what}`);
    await pause(250);
  }
};

const openOf = (view: RoundView) =>
  view.segments.find((segment) => segment.endedAt === null) ?? null;

/**
 * Drives the Round to the instant a clock moment's kill lands: prep running
 * before the constructive, cross-examination just open, or a point being
 * given. Returns the Round as it stood, the "before" every check compares to.
 */
export async function reachClockMoment(
  moment: ClockMoment,
  members: readonly Member[],
  roundId: string,
): Promise<RoundView> {
  const [affirmative, negative] = members;
  if (!affirmative || !negative) throw new Error('Two members required');
  if (moment === 'mid-prep') {
    // In the countdown before the constructive, the affirmative takes prep now.
    const view = await until(
      members,
      roundId,
      (v) => v.status === 'active' && openOf(v) === null,
      30_000,
      'the countdown before the constructive',
    );
    await ballotRoundCommand(affirmative.context.request, view, {
      type: 'start_prep',
      participantId: seatOf(view, affirmativeSide),
      sequence: 0,
    });
    return until(
      members,
      roundId,
      (v) => v.checkpoint?.prep.phase === 'running',
      10_000,
      'running prep',
    );
  }
  if (moment === 'mid-cx') {
    const speech = await until(
      members,
      roundId,
      (v) => openOf(v)?.rulesSegmentKey === 'AC',
      60_000,
      'the constructive',
    );
    // The constructive ends early; nobody ends the cross-examination after it.
    await ballotRoundCommand(affirmative.context.request, speech, {
      type: 'yield',
      participantId: seatOf(speech, affirmativeSide),
      sequence: openOf(speech)!.sequence,
    });
    const crossEx = await until(
      members,
      roundId,
      (v) => openOf(v)?.type === 'cross_ex',
      30_000,
      'cross-examination',
    );
    const into = nowMs() - instantMs(openOf(crossEx)!.startedAt);
    if (into < INTO_CROSS_EX_MS) await pause(INTO_CROSS_EX_MS - into);
    return crossEx;
  }
  // mid-poi: past the protected start, the negative offers and the speaker accepts.
  const speech = await until(
    members,
    roundId,
    (v) => {
      const open = openOf(v);
      return (
        open?.rulesSegmentKey === 'AC' &&
        nowMs() - instantMs(open.startedAt) > 11_000
      );
    },
    60_000,
    'the constructive past its protected start',
  );
  const sequence = openOf(speech)!.sequence;
  const offerer = seatOf(speech, negativeSide);
  const offered = await ballotRoundCommand(negative.context.request, speech, {
    type: 'offer_poi',
    participantId: offerer,
    sequence,
  });
  await ballotRoundCommand(affirmative.context.request, offered, {
    type: 'accept_poi',
    participantId: seatOf(offered, affirmativeSide),
    sequence,
    offererParticipantId: offerer,
  });
  return until(
    members,
    roundId,
    (v) => v.checkpoint?.point_of_information.phase === 'speaking',
    10_000,
    'a point being given',
  );
}

/** Waits for what the moment's clock owns to happen by itself, then reads the facts. */
export async function settledClockFacts(
  moment: ClockMoment,
  before: RoundView,
  members: readonly Member[],
  roundId: string,
  evidence: () => Promise<DrillEvidence>,
): Promise<ClockInstantFacts> {
  const stopsOf = (view: RoundView) =>
    view.checkpoint ? clockStopsOf(view.checkpoint) : [];
  if (moment === 'mid-prep') {
    const prep = before.checkpoint!.prep;
    if (prep.phase !== 'running') throw new Error('Prep was not running');
    const after = await until(
      members,
      roundId,
      (v) => v.segments.length > 0,
      PREP_BUDGET_MS + 60_000,
      'the constructive after prep',
    );
    return {
      moment,
      prepStartedAt: prep.started_at,
      prepRemainingMs:
        PREP_BUDGET_MS - (before.checkpoint!.prep_consumed_ms[prep.side] ?? 0),
      budgetMsPerSide: PREP_BUDGET_MS,
      consumedAfterMs: after.checkpoint!.prep_consumed_ms[prep.side] ?? 0,
      nextStartedAt: after.segments[0]?.startedAt ?? null,
      stops: stopsOf(after),
    };
  }
  if (moment === 'mid-cx') {
    const open = openOf(before)!;
    const after = await until(
      members,
      roundId,
      (v) => v.segments[open.sequence]?.endedAt !== null,
      120_000,
      'cross-examination closing by its clock',
    );
    const closed = after.segments[open.sequence]!;
    return {
      moment,
      startedAt: closed.startedAt,
      durationMs: closed.durationMs,
      returnedMs: closed.returnedMs,
      endedAt: closed.endedAt,
      consumedBeforeMs: before.checkpoint!.prep_consumed_ms,
      consumedAfterMs: after.checkpoint!.prep_consumed_ms,
    };
  }
  const point = before.checkpoint!.point_of_information;
  if (point.phase !== 'speaking') throw new Error('No point was being given');
  const rule = before.rules.interaction.pointsOfInformation;
  if (!rule.allowed) throw new Error('The drill Round takes no points');
  const after = await until(
    members,
    roundId,
    (v) => v.checkpoint?.point_of_information.phase !== 'speaking',
    rule.maxDurationMs + 60_000,
    'the point returning',
  );
  const segmentId = openOf(before)!.id;
  const holder = (await evidence()).grants.find(
    (grant) =>
      grant.segmentId === segmentId &&
      grant.participantId === point.holder_participant_id,
  );
  return {
    moment,
    acceptedAt: point.accepted_at,
    maxDurationMs: rule.maxDurationMs,
    holderEndedAt: holder?.endedAt ?? null,
    stops: stopsOf(after),
  };
}
