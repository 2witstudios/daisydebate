import type {
  Entry,
  Fixture,
  FormatDescriptor,
  HistoricFixture,
  Id,
} from '../shapes/competition';
import type { EventRequest } from '../shapes/draw';
import type { ResolvedSettings, StageKind } from '../shapes/settings';
import { entriesOf } from '../standings/games';

/**
 * What one event's history says about its entries, read once per draw. The
 * cost terms read only this, so the solver, `assess` and the explanation
 * cost a fixture from the same facts.
 */
export type EventFacts = {
  readonly event: Id;
  readonly format: FormatDescriptor;
  readonly settings: ResolvedSettings;
  readonly stage: StageKind;
  /** Whether record groups apply: a powered preliminary round after the first. */
  readonly powered: boolean;
  readonly schools: ReadonlyMap<Id, readonly string[]>;
  readonly meetings: ReadonlyMap<string, number>;
  readonly sides: ReadonlyMap<Id, readonly [number, number]>;
  readonly lastSide: ReadonlyMap<Id, 0 | 1>;
  readonly byes: ReadonlyMap<Id, number>;
  /** Times held each position (four sides) or speaker place (sections). */
  readonly positions: ReadonlyMap<Id, readonly number[]>;
  /** The pairing record, scaled to an integer; equal records are one group. */
  readonly record: ReadonlyMap<Id, number>;
  /** Place in the pairing order: 0 is the strongest. */
  readonly strength: ReadonlyMap<Id, number>;
  readonly pulledUp: ReadonlyMap<Id, number>;
  /** How many entries of the same record are weaker. */
  readonly weakerInGroup: ReadonlyMap<Id, number>;
  /** The cost of giving this entry the bye, by `bye.recipient`. */
  readonly byeCost: ReadonlyMap<Id, number>;
};

export const pairKey = (a: Id, b: Id) =>
  a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;

/** The entries a fixture seats (a bye seats one and occupies nobody): one definition, the standings'. */
export { entriesOf };

export const panelOf = (fixture: Fixture): readonly Id[] =>
  fixture.kind === 'bye' ? [] : fixture.panel;

export const schoolsOf = (entry: Pick<Entry, 'protection'>) =>
  entry.protection.filter((p) => p.scope === 'school').map((p) => p.key);

const bump = <K>(map: Map<K, number>, key: K, by = 1) =>
  map.set(key, (map.get(key) ?? 0) + by);

const positionCounts = (map: Map<Id, number[]>, entry: Id, index: number) => {
  const counts = map.get(entry) ?? [0, 0, 0, 0, 0, 0, 0];
  counts[index] = (counts[index] ?? 0) + 1;
  map.set(entry, counts);
};

/** Who met whom, sides, positions and byes, from every earlier tab round. */
const historyFacts = (
  fixtures: readonly HistoricFixture<FormatDescriptor>[],
  before: number,
) => {
  const meetings = new Map<string, number>();
  const sides = new Map<Id, [number, number]>();
  const lastSide = new Map<Id, 0 | 1>();
  const byes = new Map<Id, number>();
  const positions = new Map<Id, number[]>();
  const ordered = [...fixtures]
    .filter((f) => f.tabRound < before)
    .sort((a, b) => a.tabRound - b.tabRound || (a.id < b.id ? -1 : 1));
  for (const { fixture } of ordered) {
    if (fixture.kind === 'bye') {
      bump(byes, fixture.entry);
      continue;
    }
    const seated = entriesOf(fixture);
    seated.forEach((a, i) => {
      seated.slice(i + 1).forEach((b) => bump(meetings, pairKey(a, b)));
      positionCounts(positions, a, i);
    });
    if (fixture.kind === 'pairing' && fixture.sides.length === 2)
      fixture.sides.forEach((entry, side) => {
        const held = sides.get(entry) ?? [0, 0];
        held[side] = held[side]! + 1;
        sides.set(entry, held);
        lastSide.set(entry, side as 0 | 1);
      });
  }
  return { meetings, sides, lastSide, byes, positions };
};

export type FactsOrder = {
  readonly record: ReadonlyMap<Id, number>;
  readonly strength: ReadonlyMap<Id, number>;
  readonly pulledUp: ReadonlyMap<Id, number>;
  readonly byeCost: ReadonlyMap<Id, number>;
};

export const eventFacts = (
  request: EventRequest,
  powered: boolean,
  order: FactsOrder,
): EventFacts => {
  const history = historyFacts(request.history.fixtures, request.tabRound);
  const weakerInGroup = new Map<Id, number>();
  for (const [entry, record] of order.record) {
    const strength = order.strength.get(entry) ?? 0;
    let weaker = 0;
    for (const [other, otherRecord] of order.record)
      if (otherRecord === record && (order.strength.get(other) ?? 0) > strength)
        weaker += 1;
    weakerInGroup.set(entry, weaker);
  }
  return {
    event: request.event,
    format: request.format,
    settings: request.settings,
    stage: request.stage.kind,
    powered,
    schools: new Map(request.entries.map((e) => [e.id, schoolsOf(e)])),
    ...history,
    record: order.record,
    strength: order.strength,
    pulledUp: order.pulledUp,
    weakerInGroup,
    byeCost: order.byeCost,
  };
};
