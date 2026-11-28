import { instantMs } from '@daisy/clock/instant';
import { dueAfterStops, type ClockStop } from '@daisy/protocol/clock-stops';
import { roundStartPolicy } from '@daisy/protocol/round-start-policy';
import { segmentDueAtMs } from '@daisy/protocol/segment-end';

/**
 * What a kill during prep, cross-examination or a point of information must
 * leave intact (INTX-19): the Round clock is database time, so a media node
 * dying never moves an instant the clock owns. Each check reads only stored
 * instants and the clock stops an incident recorded, and names what it found.
 */
export type ClockInstantFacts =
  | {
      /** Prep was running when the node died; nobody ended it early. */
      readonly moment: 'mid-prep';
      readonly prepStartedAt: string;
      /** The side's budget left when prep started. */
      readonly prepRemainingMs: number;
      readonly budgetMsPerSide: number;
      /** The side's prep spent once the Round moved on. */
      readonly consumedAfterMs: number;
      /** When the segment prep was for opened; null if it never did. */
      readonly nextStartedAt: string | null;
      readonly stops: readonly ClockStop[];
    }
  | {
      /** Cross-examination was open when the node died; nobody ended it early. */
      readonly moment: 'mid-cx';
      readonly startedAt: string;
      readonly durationMs: number;
      /** Airtime an incident returned to the segment, as stored once it closed. */
      readonly returnedMs: number;
      readonly endedAt: string | null;
      /** Each side's prep spent before and after: cross-examination returns none. */
      readonly consumedBeforeMs: Readonly<Record<string, number>>;
      readonly consumedAfterMs: Readonly<Record<string, number>>;
    }
  | {
      /** A point of information was being given when the node died; nobody ended it. */
      readonly moment: 'mid-poi';
      readonly acceptedAt: string;
      readonly maxDurationMs: number;
      /** When the holder's speaking interval closed; null if it never did. */
      readonly holderEndedAt: string | null;
      readonly stops: readonly ClockStop[];
    };

const iso = (ms: number) => new Date(ms).toISOString();

/** Prep runs out exactly at its budget, however long the clock was stopped; the speech opens one microphone lead later. */
const prepProblems = (
  facts: Extract<ClockInstantFacts, { moment: 'mid-prep' }>,
  nowMs: number,
): string[] => {
  const endsMs = dueAfterStops(
    instantMs(facts.prepStartedAt),
    facts.prepRemainingMs,
    facts.stops,
    nowMs,
  );
  const problems: string[] = [];
  if (facts.consumedAfterMs !== facts.budgetMsPerSide)
    problems.push(
      `prep: ${facts.consumedAfterMs} ms spent, not the whole ${facts.budgetMsPerSide} ms budget`,
    );
  if (facts.nextStartedAt === null)
    return [...problems, `prep: the speech never opened after ${iso(endsMs)}`];
  const opened = instantMs(facts.nextStartedAt);
  const { microphoneLeadMs, captureHoldBoundMs } = roundStartPolicy;
  const earliest = dueAfterStops(endsMs, microphoneLeadMs, facts.stops, nowMs);
  const latest = dueAfterStops(
    endsMs,
    microphoneLeadMs + captureHoldBoundMs,
    facts.stops,
    nowMs,
  );
  if (opened < earliest || opened > latest)
    problems.push(
      `prep: ended ${iso(endsMs)}, but the speech opened ${facts.nextStartedAt}, outside ${iso(earliest)}–${iso(latest)}`,
    );
  return problems;
};

/** Cross-examination closes at its own due instant, and gives no side prep back (INTX-8). */
const crossExaminationProblems = (
  facts: Extract<ClockInstantFacts, { moment: 'mid-cx' }>,
): string[] => {
  const dueMs = segmentDueAtMs({
    startedAtMs: instantMs(facts.startedAt),
    durationMs: facts.durationMs,
    returnedMs: facts.returnedMs,
  });
  const problems: string[] = [];
  if (facts.endedAt === null)
    problems.push(`cross-examination: never closed after ${iso(dueMs)}`);
  else if (instantMs(facts.endedAt) !== dueMs)
    problems.push(
      `cross-examination: closed ${facts.endedAt}, not at its due ${iso(dueMs)}`,
    );
  for (const [side, before] of Object.entries(facts.consumedBeforeMs))
    if ((facts.consumedAfterMs[side] ?? before) < before)
      problems.push(`cross-examination: returned prep to ${side}`);
  return problems;
};

/**
 * A point returns to the speaker at its limit; an incident that stops the
 * clock first ends it at that stop (a pause ends any point).
 */
const pointProblems = (
  facts: Extract<ClockInstantFacts, { moment: 'mid-poi' }>,
): string[] => {
  const acceptedMs = instantMs(facts.acceptedAt);
  const limitMs = acceptedMs + facts.maxDurationMs;
  const stoppedMs = facts.stops
    .map((stop) => instantMs(stop.from))
    .filter((fromMs) => fromMs >= acceptedMs && fromMs < limitMs)
    .sort((a, b) => a - b)[0];
  const expectedMs = stoppedMs ?? limitMs;
  if (facts.holderEndedAt === null)
    return [`point of information: the holder's microphone never closed`];
  return instantMs(facts.holderEndedAt) === expectedMs
    ? []
    : [
        `point of information: returned ${facts.holderEndedAt}, not ${iso(expectedMs)} (${stoppedMs === undefined ? 'its limit' : 'the pause'})`,
      ];
};

/** What the kill moved that the clock owns, or nothing. */
export const clockInstantProblems = (
  facts: ClockInstantFacts,
  nowMs: number,
): readonly string[] => {
  switch (facts.moment) {
    case 'mid-prep':
      return prepProblems(facts, nowMs);
    case 'mid-cx':
      return crossExaminationProblems(facts);
    case 'mid-poi':
      return pointProblems(facts);
  }
};
