import { entriesOf, pairKey, panelOf, type EventFacts } from '../draw/facts';
import type { Fixture, Id } from '../shapes/competition';
import type { Judge, SlotJudge } from '../shapes/draw';
import {
  forceKeys,
  type Force,
  type ForceKey,
  type JudgingForceKey,
  type PairingForceKey,
  type ResolvedSettings,
} from '../shapes/settings';

/**
 * The registry: one entry per key the engine reads that carries a force,
 * with the forces it allows and its one cost term. The solver builds its
 * weights from these terms and `assess` reports from the same terms, so a
 * term has one definition. A term's cost is a count of what the setting
 * asks to avoid: zero is kept, above zero is broken. Null means the key does
 * not apply to that fixture.
 */
export const allowedForces = forceKeys;

export const forceOf = (settings: ResolvedSettings, key: ForceKey): Force =>
  settings[key].force;

/** A force a rule may be relaxed to: weightless where the key allows it. */
export const relaxedForce = (key: ForceKey): Force =>
  (allowedForces[key] as readonly Force[]).includes('warning')
    ? 'warning'
    : 'off';

export const withForce = (
  settings: ResolvedSettings,
  key: ForceKey,
  force: Force,
): ResolvedSettings => ({ ...settings, [key]: { ...settings[key], force } });

const pairsOf = (ids: readonly Id[]) =>
  ids.flatMap((a, i) => ids.slice(i + 1).map((b) => [a, b] as const));

const shareSchool = (facts: EventFacts, a: Id, b: Id) => {
  const left = facts.schools.get(a) ?? [];
  const right = facts.schools.get(b) ?? [];
  return left.some((school) => right.includes(school));
};

const isTwoSide = (
  fixture: Fixture,
): fixture is Extract<Fixture, { kind: 'pairing' }> =>
  fixture.kind === 'pairing' && fixture.sides.length === 2;
const isFourSide = (fixture: Fixture) =>
  fixture.kind === 'pairing' && fixture.sides.length === 4;

/** Twice the extra times each entry holds its position, over its least-held one. */
const positionExcess = (
  facts: EventFacts,
  seated: readonly Id[],
  places: number,
) =>
  seated.reduce((sum, entry, place) => {
    const counts = facts.positions.get(entry) ?? [];
    const held = (index: number) => counts[index] ?? 0;
    const least = Math.min(
      ...Array.from({ length: places }, (_, i) => held(i)),
    );
    return sum + 2 * (held(place) - least);
  }, 0);

type PairingTerm = (
  facts: EventFacts,
  fixture: Fixture,
) => readonly number[] | null;

export const pairingTerms: Record<PairingForceKey, PairingTerm> = {
  'pairing.rematch': (facts, fixture) =>
    fixture.kind === 'pairing'
      ? [
          pairsOf(fixture.sides).reduce(
            (s, [a, b]) => s + (facts.meetings.get(pairKey(a, b)) ?? 0),
            0,
          ),
        ]
      : null,
  'pairing.same_school': (facts, fixture) =>
    fixture.kind === 'bye'
      ? null
      : [
          pairsOf(entriesOf(fixture)).filter(([a, b]) =>
            shareSchool(facts, a, b),
          ).length,
        ],
  'pairing.side_balance': (facts, fixture) => {
    if (!isTwoSide(fixture)) return null;
    const allowed = facts.settings['pairing.side_balance'].maxImbalance;
    return [
      fixture.sides.reduce((sum, entry, side) => {
        const [first, second] = facts.sides.get(entry) ?? [0, 0];
        const after = side === 0 ? first + 1 - second : first - second - 1;
        return sum + Math.max(0, Math.abs(after) - allowed);
      }, 0),
    ];
  },
  'pairing.side_alternation': (facts, fixture) =>
    isTwoSide(fixture)
      ? [
          fixture.sides.filter(
            (entry, side) => facts.lastSide.get(entry) === side,
          ).length,
        ]
      : null,
  'pairing.pull_up': (facts, fixture) => {
    if (fixture.kind !== 'pairing' || !facts.powered) return null;
    const records = fixture.sides.map((entry) => facts.record.get(entry) ?? 0);
    const top = Math.max(...records);
    const pulled = fixture.sides.filter((_, i) => records[i]! < top);
    const choose = facts.settings['pairing.pull_up'].choose;
    return [
      top - Math.min(...records),
      pulled.reduce(
        (sum, entry) =>
          sum +
          (choose === 'least_pulled'
            ? (facts.pulledUp.get(entry) ?? 0)
            : (facts.weakerInGroup.get(entry) ?? 0)),
        0,
      ),
    ];
  },
  'pairing.position_balance': (facts, fixture) => {
    if (isFourSide(fixture) && fixture.kind === 'pairing')
      return [positionExcess(facts, fixture.sides, 4)];
    if (fixture.kind === 'section')
      return [positionExcess(facts, fixture.speakers, fixture.speakers.length)];
    return null;
  },
  'pairing.section_repeat': (facts, fixture) =>
    fixture.kind === 'section'
      ? [
          pairsOf(fixture.speakers).reduce(
            (s, [a, b]) => s + (facts.meetings.get(pairKey(a, b)) ?? 0),
            0,
          ),
        ]
      : null,
  'bye.repeat': (facts, fixture) =>
    fixture.kind === 'bye' ? [facts.byes.get(fixture.entry) ?? 0] : null,
};

/** `bye.recipient` is plain: the cost of this entry taking the bye. */
export const byeRecipientTerm = (facts: EventFacts, fixture: Fixture) =>
  fixture.kind === 'bye' ? [facts.byeCost.get(fixture.entry) ?? 0] : null;

/** What a judging term may read about the seat it costs. */
export type SeatContext = {
  readonly facts: EventFacts;
  readonly fixture: Fixture;
  readonly seat: number;
  readonly judge: Judge | SlotJudge;
  /** The least load in the pool, so load counts from the lightest judge. */
  readonly leastLoad: number;
};

const judgeShares = (context: SeatContext) => {
  const own = context.judge.protection
    .filter((p) => p.scope === 'school')
    .map((p) => p.key);
  return entriesOf(context.fixture).filter((entry) =>
    (context.facts.schools.get(entry) ?? []).some((school) =>
      own.includes(school),
    ),
  ).length;
};
const countIn = (context: SeatContext, listed: readonly Id[]) =>
  entriesOf(context.fixture).filter((entry) => listed.includes(entry)).length;

type SeatTerm = (context: SeatContext) => number;

/** Every judging key but the panel-level one is costed seat by seat. */
export type SeatKey = Exclude<JudgingForceKey, 'judging.panel_same_school'>;

export const seatTerms: Record<SeatKey, SeatTerm> = {
  'judging.availability': ({ judge }) =>
    'available' in judge && !judge.available ? 1 : 0,
  'judging.strike': (context) => countIn(context, context.judge.strikes),
  'judging.conflict': (context) => countIn(context, context.judge.conflicts),
  'judging.same_school': judgeShares,
  'judging.repeat_judge': (context) => countIn(context, context.judge.judged),
  'judging.unsubmitted_ballot': ({ judge }) =>
    judge.outstandingBallots > 0 ? 1 : 0,
  'judging.load_balance': ({ judge, leastLoad }) =>
    judge.tabRoundsJudged - leastLoad,
  'judging.chair': ({ judge, seat }) => (seat === 0 && !judge.chair ? 1 : 0),
};

/** Two judges of one school on one panel. */
export const panelSameSchool = (
  fixture: Fixture,
  judges: ReadonlyMap<Id, Judge | SlotJudge>,
): number => {
  const schools = panelOf(fixture).map((id) =>
    (judges.get(id)?.protection ?? [])
      .filter((p) => p.scope === 'school')
      .map((p) => p.key),
  );
  return pairsOf(schools.map((_, i) => String(i))).filter(([a, b]) =>
    schools[Number(a)]!.some((school) => schools[Number(b)]!.includes(school)),
  ).length;
};

export const seatKeys = Object.keys(seatTerms) as SeatKey[];
export const pairingKeys = Object.keys(pairingTerms) as PairingForceKey[];
