import { compareBytes, shuffleWith } from '@daisy/seeded-random';
import type { FormatDescriptor, Id, StageHistory } from '../shapes/competition';
import type { EventRequest } from '../shapes/draw';
import type { Metric } from '../shapes/settings';
import { standings } from '../standings';
import { effectiveResults } from '../standings/effective-results';
import { eventFacts, type EventFacts, type FactsOrder } from './facts';
import { eventStream } from './placement';

/** How the method was chosen, from the format and the stage, never by the caller. */
export type Method =
  | {
      readonly kind: 'matched';
      readonly grouped: boolean;
      readonly later: 'fold' | 'slide' | 'adjacent' | 'random' | 'top_down';
    }
  | { readonly kind: 'prematched' }
  | { readonly kind: 'round_robin' }
  | { readonly kind: 'four_side' }
  | { readonly kind: 'sections' }
  | { readonly kind: 'progression' };

export type Prepared = {
  readonly request: EventRequest;
  readonly facts: EventFacts;
  readonly method: Method;
  /** Results counted through this tab round, and exactly which were read. */
  readonly cutoff: number;
  readonly results: readonly Id[];
};

const recordMetric = (format: FormatDescriptor): Metric | null =>
  format.outcome === 'winner'
    ? 'wins'
    : 'sides' in format
      ? 'team_points'
      : null;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Each entry's record at a cutoff, scaled to integers so equal records are equal. */
const recordsAt = (request: EventRequest, seed: Uint8Array, cutoff: number) => {
  const metric = recordMetric(request.format);
  const ids = request.entries.map((e) => e.id);
  if (metric === null || cutoff <= 0) return new Map(ids.map((id) => [id, 0]));
  const table = standings({
    ...(request as Extract<EventRequest, { format: FormatDescriptor }>),
    settings: {
      ...request.settings,
      'standings.tiebreaks': {
        metrics: [metric],
        minimumGames: null,
        terminal: 'shared',
      },
    },
    cutoff,
    division: null,
    seed,
  } as Parameters<typeof standings>[0]);
  const values = table.rows.map(
    (row) => [row.entry, row.values[0]!.value[0]!] as const,
  );
  const scale = values.reduce((l, [, v]) => (l * v.d) / gcd(l, v.d), 1);
  return new Map(values.map(([entry, v]) => [entry, (v.n * scale) / v.d]));
};

/** Rating highest first, then lower deviation, unrated last, then a seeded lot. */
const ratingOrder = (
  request: EventRequest,
  seed: Uint8Array,
  ids: readonly Id[],
) => {
  const lot = new Map(
    shuffleWith(
      [...ids].sort(compareBytes),
      eventStream(seed, request.event, 'pairing/seeding'),
    ).map((id, i) => [id, i]),
  );
  const rating = new Map(
    (request.ratings?.entries ?? []).map((r) => [r.entry, r]),
  );
  const key = (id: Id) => {
    const r = rating.get(id);
    return r === undefined || r.status === 'unrated'
      ? [1, 0, 0]
      : [0, -r.rating, r.deviation];
  };
  return [...ids].sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    return (
      x[0]! - y[0]! ||
      x[1]! - y[1]! ||
      x[2]! - y[2]! ||
      lot.get(a)! - lot.get(b)!
    );
  });
};

const chooseMethod = (request: EventRequest): Method => {
  if (request.stage.kind === 'elimination') return { kind: 'progression' };
  if (request.format.outcome === 'ranking')
    return 'sides' in request.format
      ? { kind: 'four_side' }
      : { kind: 'sections' };
  const method = request.settings['pairing.method'].preliminary;
  switch (method.structure) {
    case 'prematched':
      return { kind: 'prematched' };
    case 'round_robin':
      return { kind: 'round_robin' };
    case 'powered':
      if (request.tabRound > 1)
        return { kind: 'matched', grouped: true, later: method.later };
      return method.first === 'seeded' && request.ratings !== null
        ? { kind: 'matched', grouped: true, later: 'fold' }
        : { kind: 'matched', grouped: false, later: 'random' };
  }
};

/** Times each entry sat below the top record of its fixture, from earlier tab rounds. */
const pullUps = (request: EventRequest, seed: Uint8Array) => {
  const history = request.history as StageHistory<FormatDescriptor>;
  const pulled = new Map<Id, number>();
  const rounds = [...new Set(history.fixtures.map((f) => f.tabRound))].filter(
    (r) => r > 1 && r < request.tabRound,
  );
  for (const round of rounds) {
    const records = recordsAt(request, seed, round - 1);
    for (const { fixture } of history.fixtures.filter(
      (f) => f.tabRound === round,
    )) {
      if (fixture.kind !== 'pairing') continue;
      const top = Math.max(...fixture.sides.map((e) => records.get(e) ?? 0));
      for (const e of fixture.sides)
        if ((records.get(e) ?? 0) < top)
          pulled.set(e, (pulled.get(e) ?? 0) + 1);
    }
  }
  return pulled;
};

/**
 * Everything one event request's methods read: the method, the pairing
 * order and records at the result cutoff (less the lag), pull-ups so far and
 * the cost of each entry taking the bye.
 */
export const prepare = (request: EventRequest, seed: Uint8Array): Prepared => {
  const method = chooseMethod(request);
  const ids = request.entries.map((e) => e.id);
  const powered = method.kind === 'matched' && request.tabRound > 1;
  const fourPowered =
    method.kind === 'four_side' &&
    request.tabRound > 1 &&
    request.settings['pairing.method'].preliminary.structure === 'powered';
  const lag = request.settings['pairing.method'].preliminary.lag;
  const readsResults = powered || fourPowered;
  const progressing = method.kind === 'progression';
  const cutoff = readsResults
    ? Math.max(0, Math.min(request.cutoff, request.tabRound - 1 - lag))
    : progressing
      ? request.tabRound - 1
      : 0;
  let strengthOrder: Id[];
  let results: readonly Id[] = progressing
    ? effectiveResults(
        request.history as StageHistory<FormatDescriptor>,
        cutoff,
      ).map((r) => r.id)
    : [];
  if (readsResults) {
    const table = standings({
      ...request,
      cutoff,
      division: null,
      seed,
    } as Parameters<typeof standings>[0]);
    results = table.results;
    const records = recordsAt(request, seed, cutoff);
    const place = new Map(table.rows.map((row, i) => [row.entry, i]));
    strengthOrder = [...ids].sort(
      (a, b) =>
        (records.get(b) ?? 0) - (records.get(a) ?? 0) ||
        (place.get(a) ?? 0) - (place.get(b) ?? 0),
    );
  } else if (method.kind === 'matched' && method.grouped)
    strengthOrder = ratingOrder(request, seed, ids);
  else
    strengthOrder = shuffleWith(
      [...ids].sort(compareBytes),
      eventStream(seed, request.event, 'pairing/lot'),
    );
  const strength = new Map(strengthOrder.map((id, i) => [id, i]));
  const record = readsResults
    ? recordsAt(request, seed, cutoff)
    : new Map(ids.map((id) => [id, 0]));
  const byeLot = new Map(
    shuffleWith(
      [...ids].sort(compareBytes),
      eventStream(seed, request.event, 'bye'),
    ).map((id, i) => [id, i]),
  );
  const byeCost = new Map(
    ids.map((id) => [
      id,
      request.settings['bye.recipient'].value === 'lowest'
        ? ids.length - 1 - strength.get(id)!
        : byeLot.get(id)!,
    ]),
  );
  const order: FactsOrder = {
    record,
    strength,
    pulledUp: readsResults ? pullUps(request, seed) : new Map(),
    byeCost,
  };
  return {
    request,
    facts: eventFacts(request, powered || fourPowered, order),
    method,
    cutoff,
    results,
  };
};
