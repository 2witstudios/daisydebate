import type { z } from 'zod';
import type { FormatOutcome, SegmentType } from './format';
import {
  MAX_FORMAT_SEATS,
  seatExists,
  sideKeysOf,
  speakingSeatsOf,
  type FormatSeating,
  type SpeakRights,
} from './format-seating';
import {
  isJudgeSeat,
  sameSeat,
  seatKey,
  sideOfSeat,
  type SeatRef,
} from './seats';

/**
 * The seating refusals a format definition and its compiled rules share
 * (TAB-6.2): a format is sided or unsided, never both; its seat map matches
 * its sides; its outcome has something to decide; every speak seat exists
 * and is never a judge's; and every side, or every unsided speaker, has a
 * speaking opportunity.
 */

type Seated = FormatSeating & {
  readonly outcome: FormatOutcome;
  readonly segments: readonly {
    readonly type: SegmentType;
    readonly speak: SpeakRights;
  }[];
};
type Issue = (message: string, path: readonly (string | number)[]) => void;

/** The speak rights a segment type admits: a speech has one speaker, the others several. */
const rightsFitType = (
  type: SegmentType,
  rights: SpeakRights['rights'],
): boolean => {
  switch (type) {
    case 'speech':
      return rights === 'one';
    case 'cross_ex':
    case 'open':
      return rights !== 'one';
  }
};

/** The seats a speak rights value names, with the path each is found at. */
const namedSeats = (
  speak: SpeakRights,
): readonly (readonly [SeatRef, readonly (string | number)[]])[] => {
  switch (speak.rights) {
    case 'one':
      return [[speak.seat, ['seat']]];
    case 'several':
      return [
        ...speak.seats.map((seat, index) => [seat, ['seats', index]] as const),
        ...(speak.lead ? [[speak.lead, ['lead']] as const] : []),
      ];
    case 'all':
      return speak.lead ? [[speak.lead, ['lead']]] : [];
  }
};

/** Sides are none or two to four, unique, and exactly the seat map's; never alongside unsided speakers. */
function sideRefusals(format: Seated, issue: Issue) {
  const keys = sideKeysOf(format);
  if (keys.length === 1)
    issue('A sided format has two to four sides', ['sides']);
  if (new Set(keys).size !== keys.length)
    issue('Side keys must be unique', ['sides']);
  const seatKeys = Object.keys(format.seats.sides);
  if (
    seatKeys.length !== keys.length ||
    !keys.every((key) => seatKeys.includes(key))
  )
    issue('Every declared side, and only those, declares its seats', [
      'seats',
      'sides',
    ]);
  if (keys.length > 0 === format.seats.speakers > 0)
    issue('A format seats sides or unsided speakers, never both', [
      'seats',
      'speakers',
    ]);
}

/** A winner is a side; a ranking ranks what the format seats. */
function outcomeRefusals(format: Seated, issue: Issue) {
  const sided = format.sides.length > 0;
  const { outcome } = format;
  switch (outcome.kind) {
    case 'winner':
      if (!sided) issue('A winner is a side', ['outcome']);
      return;
    case 'ranking':
      if (outcome.of === 'sides' && !sided)
        issue('A ranking of sides needs sides', ['outcome']);
      if (outcome.of === 'speakers' && format.seats.speakers < 2)
        issue('A ranking of speakers needs two or more speakers', ['outcome']);
      return;
    case 'none':
      return;
  }
}

/** One segment's speak rights: fitting its type, naming declared non-judge seats, led by one of them. */
function segmentRefusals(
  format: Seated,
  segment: Seated['segments'][number],
  at: readonly (string | number)[],
  issue: Issue,
) {
  const { speak } = segment;
  if (!rightsFitType(segment.type, speak.rights))
    issue('A speech has one speaker; any other segment several', [
      ...at,
      'rights',
    ]);
  for (const [seat, path] of namedSeats(speak)) {
    if (isJudgeSeat(seat))
      issue('A judge never holds the floor', [...at, ...path]);
    else if (!seatExists(format, seat))
      issue('Segment requires a declared seat', [...at, ...path]);
  }
  const lead = speak.rights === 'several' ? speak.lead : null;
  if (
    speak.rights === 'several' &&
    lead &&
    !speak.seats.some((seat) => sameSeat(seat, lead))
  )
    issue("A segment's lead is one of its speakers", [...at, 'lead']);
}

/** Every side, or every unsided speaker, may hold the floor somewhere. */
function opportunityRefusals(format: Seated, issue: Issue) {
  const keys = sideKeysOf(format);
  const sided = keys.length > 0;
  const owner = (seat: SeatRef) =>
    sided ? (sideOfSeat(seat) ?? '') : seatKey(seat);
  const spoken = new Set(
    format.segments.flatMap((segment) =>
      speakingSeatsOf(format, segment.speak)
        .filter((seat) => seatExists(format, seat))
        .map(owner),
    ),
  );
  const owed = sided
    ? keys
    : Array.from({ length: format.seats.speakers }, (_, slot) =>
        seatKey({ kind: 'speaker', slot }),
      );
  if (owed.some((side) => !spoken.has(side)))
    issue(
      sided
        ? 'Every side requires a legal speaking opportunity'
        : 'Every speaker requires a legal speaking opportunity',
      ['segments'],
    );
}

/**
 * A newly authored cross-examination names its asker, a seat of a side
 * (INTX-10): the asker may always end it, and a bot answers across sides.
 * Only authoring applies this; a format stored before the rule keeps parsing,
 * and its unled cross-examination runs as the open exchange it always was.
 */
export function crossExaminationAskerRefusals(
  format: Pick<Seated, 'segments'>,
  ctx: z.RefinementCtx,
) {
  format.segments.forEach((segment, index) => {
    if (segment.type !== 'cross_ex') return;
    const { speak } = segment;
    const asker = speak.rights === 'one' ? speak.seat : speak.lead;
    const path = ['segments', index, 'speak', 'lead'];
    if (asker === null)
      ctx.addIssue({
        code: 'custom',
        message: 'Cross-examination names the seat that asks',
        path,
      });
    else if (!isJudgeSeat(asker) && sideOfSeat(asker) === null)
      ctx.addIssue({
        code: 'custom',
        message:
          'Cross-examination is asked by a side, never an unsided speaker',
        path,
      });
  });
}

/** Seats declared in all; past the budget the seats schema refuses already. */
const declaredSeats = ({ seats }: Seated) =>
  Object.values(seats.sides).reduce((sum, n) => sum + n, 0) +
  seats.speakers +
  seats.judges +
  seats.moderators;

export function validateSeating(format: Seated, ctx: z.RefinementCtx) {
  const issue: Issue = (message, path) =>
    ctx.addIssue({ code: 'custom', message, path: [...path] });
  sideRefusals(format, issue);
  outcomeRefusals(format, issue);
  // Enumerating seats past the budget would not end; the seats schema refuses them.
  if (declaredSeats(format) > MAX_FORMAT_SEATS) return;
  format.segments.forEach((segment, index) =>
    segmentRefusals(format, segment, ['segments', index, 'speak'], issue),
  );
  opportunityRefusals(format, issue);
}
