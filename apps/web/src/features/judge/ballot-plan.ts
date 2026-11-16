import {
  ballotSubjectsFor,
  daisyBallotDefinitions,
  isDebatingSeat,
  seatOrder,
  sideOfSeat,
  type Ballot,
  type BallotDefinition,
  type BallotSubjects,
  type RoundRules,
  type SeatRef,
} from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { seatName } from '../debate-room/seat-names';

/**
 * Who a ballot is about, as the judge reads it (TAB-6.17): every subject
 * keyed as the ballot stores it (a side key, a round participant id or a
 * segment key), with the name and role the page shows.
 */
export type BallotSubject = {
  readonly key: string;
  /** Who it is: a side's debaters by name, a speaker's name, or a speech's name. */
  readonly name: string;
  /** What it is: the side's label, the seat's, or the speech's name. */
  readonly role: string;
  /** Its role in a tight column: the side's short name, the seat's, or the speech's code. */
  readonly short: string;
  /** Its colour: its side's place in the declared order, or its own. */
  readonly tone: number;
  readonly avatarSrc?: string;
};

/**
 * One Round's ballot: the definition it is judged on and the subjects of its
 * decision and of its points. A definition that scores nothing has no
 * scored subjects.
 */
export type BallotPlan = {
  readonly definition: BallotDefinition;
  readonly subjects: BallotSubjects;
  /** Who the decision is about, and who receives feedback. */
  readonly decided: readonly BallotSubject[];
  /** Who points are given to. */
  readonly scored: readonly BallotSubject[];
  /** Actual competitors, individually, for an additional speaker ranking. */
  readonly speakers: readonly BallotSubject[];
};

type Participant = {
  readonly seat: SeatRef;
  readonly id?: string;
  readonly label?: string;
};
type Round = {
  readonly rules: RoundRules;
  readonly participants: readonly Participant[];
};

/** The Round's competitors with their identity, in display order. */
const competitors = (round: Round) =>
  round.participants
    .flatMap((p) =>
      p.id !== undefined && p.label !== undefined && isDebatingSeat(p.seat)
        ? [{ id: p.id, label: p.label, seat: p.seat }]
        : [],
    )
    .sort((a, b) => seatOrder(round.rules.sides)(a.seat, b.seat));

/** A side as a subject: its debaters by name, every seat of it filled. */
const sideSubjects = (round: Round): BallotSubject[] =>
  round.rules.sides.map((side, tone) => {
    const name = competitors(round)
      .filter((p) => sideOfSeat(p.seat) === side.key)
      .map((p) => p.label)
      .join(' / ');
    if (!name) throw createAppError('INVARIANT');
    return {
      key: side.key,
      name,
      role: side.label,
      short: side.short,
      tone,
    };
  });

const toneOf = (round: Round, seat: SeatRef | null, fallback: number) => {
  const side = seat ? sideOfSeat(seat) : null;
  const index = round.rules.sides.findIndex((s) => s.key === side);
  return index === -1 ? fallback : index;
};

const speakerSubjects = (round: Round): BallotSubject[] =>
  competitors(round).map((p, index) => ({
    key: p.id,
    name: p.label,
    role: seatName(round.rules, p.seat),
    short: seatName(round.rules, p.seat),
    tone: toneOf(round, p.seat, index),
  }));

const speechSubjects = (round: Round): BallotSubject[] =>
  round.rules.segments.map((segment, index) => ({
    key: segment.key,
    name: segment.label,
    role: segment.label,
    short: segment.key,
    tone: toneOf(
      round,
      segment.speak.rights === 'one' ? segment.speak.seat : segment.speak.lead,
      index,
    ),
  }));

const scoredOf = (
  round: Round,
  definition: BallotDefinition,
): BallotSubject[] => {
  if (!definition.points) return [];
  switch (definition.points.per) {
    case 'side':
      return sideSubjects(round);
    case 'seat':
      return speakerSubjects(round);
    case 'speech':
      return speechSubjects(round);
  }
};

const decidedOf = (
  round: Round,
  definition: BallotDefinition,
): BallotSubject[] =>
  definition.decision.kind === 'ranking' &&
  definition.decision.of === 'speakers'
    ? speakerSubjects(round)
    : sideSubjects(round);

/** A Round's ballot plan, on the definition the Round froze to be judged on. */
export function ballotPlanFor(
  round: Round,
  definition: BallotDefinition,
): BallotPlan {
  return {
    definition,
    subjects: ballotSubjectsFor(round.rules, competitors(round)),
    decided: decidedOf(round, definition),
    scored: scoredOf(round, definition),
    speakers: speakerSubjects(round),
  };
}

/**
 * A stored ballot's plan: on the revision it was written on when Daisy
 * still knows it (a `speaker-10@1` ballot reads on its own criteria).
 */
export const storedBallotPlan = (
  plan: BallotPlan,
  ballot: Pick<Ballot, 'rubricVersion'>,
): BallotPlan => {
  const stored: BallotDefinition | undefined =
    daisyBallotDefinitions[
      ballot.rubricVersion as keyof typeof daisyBallotDefinitions
    ];
  return stored && stored.key === plan.definition.key
    ? { ...plan, definition: stored }
    : plan;
};

/** "Alex or Sam", "Alex, Sam or Kai": the subjects a judge chooses between. */
export const subjectChoices = (subjects: readonly BallotSubject[]): string => {
  const names = subjects.map((subject) => subject.name);
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`
    : (names[0] ?? '');
};

/** A subject by its key, among the decision's and the points' subjects. */
export const subjectOf = (
  plan: BallotPlan,
  key: string,
): BallotSubject | undefined =>
  [...plan.decided, ...plan.scored].find((subject) => subject.key === key);
