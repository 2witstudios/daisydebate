import { deriveRoundOutcome } from '@daisy/debate-engine';
import {
  isDebatingSeat,
  scoreUnits,
  seatKey,
  type BallotCompetition,
  type JudgeRuling,
  type ScoreUnit,
} from '@daisy/protocol';
import {
  resultCompetitionRecordSchema,
  type ResultCompetitionRecord,
} from '@daisy/protocol/lobby/result-record';
import type { ResultEntryOutcome } from '@daisy/protocol/lobby/result-command';
import type { Result } from '@daisy/tab-engine';

type Decided = Extract<ResultCompetitionRecord, { kind: 'decided' }>;
type SpeakerProjection = {
  readonly actorId: string;
  readonly entryId: string;
  readonly units: number | null;
  readonly rank: number | null;
};
type EntryPoints = { readonly entry: string; readonly points: number };
type Projection = {
  readonly engine: Result;
  readonly entries: readonly ResultEntryOutcome[];
  readonly speakers: readonly SpeakerProjection[];
  readonly pointUnit: ScoreUnit | null;
};
export type ResultProjectionAnswer =
  | { readonly kind: 'projected'; readonly projection: Projection }
  | {
      readonly kind: 'refused';
      readonly refusal: 'outcome-mismatch' | 'unrepresentable-points';
    };
type ResultIdentity = {
  readonly id: string;
  readonly fixture: string;
  readonly supersedes: string | null;
  readonly certified: boolean;
};

const totalUnits = (values: readonly number[]): number | null => {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
};
const ranks = (places: readonly (readonly string[])[]) =>
  new Map(
    places.flatMap((group, i) => group.map((id) => [id, i + 1] as const)),
  );
const speakerRanks = (
  ballots: readonly BallotCompetition[],
): ReadonlyMap<string, number> => {
  const sums = new Map<string, number>();
  for (const ballot of ballots)
    for (const [id, rank] of ranks(ballot.speakerRanks ?? []))
      sums.set(id, (sums.get(id) ?? 0) + rank);
  const totals = [...new Set(sums.values())].sort((a, b) => a - b);
  return new Map([...sums].map(([id, sum]) => [id, totals.indexOf(sum) + 1]));
};
const entryFor = (record: Decided, subject: string) =>
  record.fixture.entries.find((entry) => entry.side === subject)?.entryId ??
  record.cast.find((person) => person.participantId === subject)?.entryId ??
  null;

/** One score's actual owner: a side, a seated person or an individually scheduled speech. */
const scoreOwner = (record: Decided, subject: string) => {
  const points = record.source.judging.ballot.points;
  if (!points) return null;
  if (points.per === 'side') {
    const entryId = entryFor(record, subject);
    return entryId ? { entryId, person: null } : null;
  }
  const segment = record.source.rules.segments.find(
    (segment) => segment.key === subject,
  );
  const speak = segment?.speak;
  const person =
    points.per === 'seat'
      ? record.cast.find((person) => person.participantId === subject)
      : speak?.rights === 'one'
        ? record.cast.find(
            (person) => seatKey(person.seat) === seatKey(speak.seat),
          )
        : null;
  return person?.entryId && isDebatingSeat(person.seat)
    ? { entryId: person.entryId, person }
    : null;
};
const scores = (
  record: Decided,
  ballot: BallotCompetition,
): { entries: EntryPoints[]; speakers: SpeakerProjection[] } | null => {
  const byEntry = new Map<string, number[]>();
  const byPerson = new Map<
    string,
    { person: Decided['cast'][number]; values: number[] }
  >();
  for (const [subject, value] of Object.entries(ballot.scores ?? {})) {
    const owner = scoreOwner(record, subject);
    if (!owner || !record.pointUnit) return null;
    const units: number[] = [];
    for (const leaf of typeof value === 'number'
      ? [value]
      : Object.values(value)) {
      const amount = scoreUnits(leaf, record.pointUnit);
      if (amount.kind !== 'exact') return null;
      units.push(amount.units);
    }
    byEntry.set(owner.entryId, [
      ...(byEntry.get(owner.entryId) ?? []),
      ...units,
    ]);
    if (owner.person)
      byPerson.set(owner.person.actorId, {
        person: owner.person,
        values: [
          ...(byPerson.get(owner.person.actorId)?.values ?? []),
          ...units,
        ],
      });
  }
  const entries: EntryPoints[] = [];
  const speakers: SpeakerProjection[] = [];
  for (const entry of record.fixture.entries) {
    const points = totalUnits(byEntry.get(entry.entryId) ?? []);
    if (points === null) return null;
    entries.push({ entry: entry.entryId, points });
  }
  for (const [actorId, { person, values }] of byPerson) {
    const units = totalUnits(values);
    if (units === null || !person.entryId) return null;
    speakers.push({ actorId, entryId: person.entryId, units, rank: null });
  }
  return { entries, speakers };
};

const decidedProjection = (
  record: Decided,
  identity: ResultIdentity,
): ResultProjectionAnswer => {
  const submissions = record.panel.flatMap((judge) =>
    judge.ballot.kind === 'submitted'
      ? [{ judge, contribution: judge.ballot.contribution }]
      : [],
  );
  const ballots: ((typeof submissions)[number] & {
    points: NonNullable<ReturnType<typeof scores>>;
  })[] = [];
  for (const { judge, contribution } of submissions) {
    const points = scores(record, contribution);
    if (!points) return { kind: 'refused', refusal: 'unrepresentable-points' };
    ballots.push({ judge, contribution, points });
  }
  const rulings: JudgeRuling[] = submissions.map(({ judge, contribution }) =>
    contribution.ranking
      ? {
          judgeParticipantId: judge.participantId,
          ranking: contribution.ranking,
        }
      : {
          judgeParticipantId: judge.participantId,
          winner: contribution.winner ?? null,
        },
  );
  const seats = record.cast
    .filter((person) =>
      submissions.some(
        ({ judge }) => judge.participantId === person.participantId,
      ),
    )
    .map((person) => ({ id: person.participantId, seat: person.seat }));
  const outcome = deriveRoundOutcome(record.source.judging, seats, rulings);
  const actualRanks =
    outcome?.kind === 'ranking'
      ? ranks(outcome.places)
      : new Map<string, number>();
  const winner =
    outcome?.kind === 'winner' ? entryFor(record, outcome.side) : null;
  let engine: Extract<Result, { kind: 'decided' }>;
  if (record.source.judging.ballot.decision.kind === 'winner') {
    engine = {
      ...identity,
      kind: 'decided',
      outcome: {
        kind: 'winner',
        winner,
        ballots: ballots.map(({ judge, contribution, points }) => ({
          judge: judge.tournamentJudgeId,
          winner: contribution.winner
            ? entryFor(record, contribution.winner)
            : null,
          points: points.entries,
        })),
      },
    };
  } else {
    if (!outcome || outcome.kind !== 'ranking')
      return { kind: 'refused', refusal: 'outcome-mismatch' };
    const places = [...actualRanks].map(([subject, place]) => ({
      entry: entryFor(record, subject),
      place,
    }));
    if (places.some((place) => place.entry === null))
      return { kind: 'refused', refusal: 'outcome-mismatch' };
    engine = {
      ...identity,
      kind: 'decided',
      outcome: {
        kind: 'ranking',
        places: places.flatMap((place) =>
          place.entry ? [{ ...place, entry: place.entry }] : [],
        ),
        ballots: ballots.map(({ judge, contribution, points }) => ({
          judge: judge.tournamentJudgeId,
          ranks: [...ranks(contribution.ranking ?? [])].flatMap(
            ([subject, rank]) => {
              const entry = entryFor(record, subject);
              return entry
                ? [
                    {
                      entry,
                      rank,
                      points:
                        points.entries.find((row) => row.entry === entry)
                          ?.points ?? 0,
                    },
                  ]
                : [];
            },
          ),
        })),
      },
    };
  }
  const ranksBySpeaker = speakerRanks(
    submissions.map((row) => row.contribution),
  );
  const speakers: SpeakerProjection[] = [];
  for (const person of record.cast) {
    const entryId = person.entryId;
    if (entryId === null) continue;
    const values = ballots.flatMap((ballot) =>
      ballot.points.speakers
        .filter((row) => row.actorId === person.actorId)
        .flatMap((row) => (row.units === null ? [] : [row.units])),
    );
    const units = values.length ? totalUnits(values) : null;
    if (values.length && units === null)
      return { kind: 'refused', refusal: 'unrepresentable-points' };
    const rank =
      ranksBySpeaker.get(person.participantId) ??
      (record.source.judging.ballot.decision.kind === 'ranking' &&
      record.source.judging.ballot.decision.of === 'speakers'
        ? (actualRanks.get(person.participantId) ?? null)
        : null);
    if (units !== null || rank !== null)
      speakers.push({
        actorId: person.actorId,
        entryId,
        units,
        rank,
      });
  }
  return {
    kind: 'projected',
    projection: {
      engine,
      pointUnit: record.pointUnit,
      speakers,
      entries: record.fixture.entries.map((entry) => ({
        entryId: entry.entryId,
        won:
          engine.outcome.kind === 'winner'
            ? engine.outcome.winner === entry.entryId
            : null,
        rank:
          engine.outcome.kind === 'ranking'
            ? (engine.outcome.places.find(
                (place) => place.entry === entry.entryId,
              )?.place ?? null)
            : null,
        ballotsWon:
          engine.outcome.kind === 'winner'
            ? engine.outcome.ballots.filter(
                (ballot) => ballot.winner === entry.entryId,
              ).length
            : engine.outcome.ballots.filter((ballot) =>
                ballot.ranks.some(
                  (rank) => rank.entry === entry.entryId && rank.rank === 1,
                ),
              ).length,
      })),
    },
  };
};

/** All projections come from the one authored record; certification is a separately loaded fact. */
export const projectResultCompetition = (
  input: unknown,
  identity: ResultIdentity,
): ResultProjectionAnswer => {
  const parsed = resultCompetitionRecordSchema.safeParse(input);
  if (!parsed.success) return { kind: 'refused', refusal: 'outcome-mismatch' };
  const record = parsed.data;
  if (record.kind === 'decided') return decidedProjection(record, identity);
  const awards = record.awards;
  const credits =
    awards.kind === 'bye'
      ? awards
      : {
          kind: 'awarded' as const,
          entries: awards.entries.map((entry) => ({
            entry: entry.entryId,
            ballotsWon: entry.ballotCredits,
            ranks: entry.rankCredits,
            points:
              entry.points.kind === 'none'
                ? 0
                : entry.points.kind === 'entry'
                  ? entry.points.units
                  : totalUnits(
                      entry.points.speakers.map((speaker) => speaker.units),
                    ),
          })),
        };
  const representable =
    credits.kind === 'awarded'
      ? credits.entries.flatMap((entry) =>
          entry.points === null ? [] : [{ ...entry, points: entry.points }],
        )
      : [];
  if (
    credits.kind === 'awarded' &&
    representable.length !== credits.entries.length
  )
    return { kind: 'refused', refusal: 'unrepresentable-points' };
  const entryCredits =
    credits.kind === 'awarded'
      ? { ...credits, entries: representable }
      : credits;
  const winner =
    awards.kind === 'winner'
      ? (awards.entries.find((entry) => entry.won)?.entryId ?? null)
      : awards.kind === 'bye'
        ? record.fixture.entries[0]!.entryId
        : null;
  const places =
    awards.kind === 'ranking'
      ? awards.entries.map((entry) => ({
          entry: entry.entryId,
          place: entry.rank,
        }))
      : record.fixture.entries.map((entry) => ({
          entry: entry.entryId,
          place: 1,
        }));
  const engine: Result =
    record.definition.decision.kind === 'winner'
      ? {
          ...identity,
          kind: 'administrative',
          outcome: { kind: 'winner', winner, credits: entryCredits },
        }
      : {
          ...identity,
          kind: 'administrative',
          outcome: { kind: 'ranking', places, credits: entryCredits },
        };
  return {
    kind: 'projected',
    projection: {
      engine,
      pointUnit: record.pointUnit,
      entries: record.fixture.entries.map((entry) => ({
        entryId: entry.entryId,
        won: engine.outcome.kind === 'winner' ? winner === entry.entryId : null,
        rank:
          engine.outcome.kind === 'ranking'
            ? (places.find((place) => place.entry === entry.entryId)?.place ??
              null)
            : null,
        ballotsWon:
          awards.kind === 'bye'
            ? awards.rule === 'win'
              ? awards.panelSize
              : null
            : (awards.entries.find((award) => award.entryId === entry.entryId)
                ?.ballotCredits ?? null),
      })),
      speakers:
        awards.kind === 'bye'
          ? []
          : awards.entries.flatMap((entry) =>
              entry.points.kind === 'speakers'
                ? entry.points.speakers.map((speaker) => ({
                    actorId: speaker.actorId,
                    entryId: entry.entryId,
                    units: speaker.units,
                    rank: speaker.rank,
                  }))
                : [],
            ),
    },
  };
};
