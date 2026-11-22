import { isDebatingSeat } from '@daisy/protocol/seats';
import {
  roundCompetitionSourceSchema,
  type RoundCompetitionSource,
} from '@daisy/protocol/round-competition-source';
import { scoreUnitFor } from '@daisy/protocol/score-unit';
import {
  resultCompetitionRecordSchema,
  type ResultCompetitionRecord,
} from '@daisy/protocol/lobby/result-record';

type Decided = Extract<ResultCompetitionRecord, { kind: 'decided' }>;
type Fixture = {
  readonly kind: 'pairing' | 'section' | 'bye';
  readonly entries: readonly {
    readonly entryId: string;
    readonly position: number;
    readonly side: string | null;
  }[];
};
type Judge = { readonly id: string; readonly actorId: string };
type Answer =
  | { readonly kind: 'created'; readonly record: Decided }
  | { readonly kind: 'refused'; readonly refusal: 'outcome-mismatch' };
const refused = { kind: 'refused', refusal: 'outcome-mismatch' } as const;

/** Immutable fixture positions bind the actual exported cast; current members and fixture judges are not inputs. */
export const createDecidedResultRecord = (
  input: RoundCompetitionSource,
  fixture: Fixture,
  judges: readonly Judge[],
): Answer => {
  const parsed = roundCompetitionSourceSchema.safeParse(input);
  if (!parsed.success || fixture.kind === 'bye') return refused;
  const source = parsed.data;
  const entries = [...fixture.entries].sort((a, b) => a.position - b.position);
  if (
    entries.some((entry, index) => entry.position !== index) ||
    new Set(entries.map((entry) => entry.entryId)).size !== entries.length ||
    (fixture.kind === 'pairing' &&
      entries.some(
        (entry, index) => entry.side !== source.source.rules.sides[index]?.key,
      ))
  )
    return refused;
  const cast: Decided['cast'] = [];
  for (const person of source.cast) {
    const seat = person.seat;
    const entry = isDebatingSeat(seat)
      ? seat.kind === 'speaker'
        ? entries.find(
            (entry) => entry.position === seat.slot && entry.side === null,
          )
        : seat.kind === 'side'
          ? entries.find((entry) => entry.side === seat.side)
          : undefined
      : null;
    if (entry === undefined) return refused;
    cast.push({ ...person, entryId: entry?.entryId ?? null });
  }
  const panel: Decided['panel'] = [];
  for (const row of source.panel) {
    const person = source.cast.find(
      (person) => person.participantId === row.participantId,
    );
    const matches = judges.filter((judge) => judge.actorId === person?.actorId);
    if (matches.length !== 1) return refused;
    panel.push({ ...row, tournamentJudgeId: matches[0]!.id });
  }
  const record = resultCompetitionRecordSchema.safeParse({
    version: 1,
    kind: 'decided',
    format: source.format,
    fixture: {
      kind: fixture.kind,
      entries: entries.map(({ entryId, side }) => ({ entryId, side })),
    },
    source: source.source,
    pointUnit: source.source.judging.ballot.points
      ? scoreUnitFor(source.source.judging.ballot.points)
      : null,
    cast,
    panel,
  });
  return record.success && record.data.kind === 'decided'
    ? { kind: 'created', record: record.data }
    : refused;
};
