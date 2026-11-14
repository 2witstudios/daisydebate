import type { FourSides, Speakers, TwoSides } from '../shapes/competition';
import type { PairingForceKey, ResolvedSettings } from '../shapes/settings';
import type { InfeasibilityCertificate, Plan, RequestOf } from '../shapes/draw';
import { tutteBarrier } from '../solve/barrier';
import {
  forceOf,
  pairingKeys,
  pairingTerms,
  relaxedForce,
  withForce,
} from '../settings/registry';
import { entriesOf } from './facts';
import { placeFourSide } from './four-side';
import {
  placedFrom,
  poolOf,
  type Placed,
  type PlacementAnswer,
} from './placement';
import type { Prepared } from './prepare';
import { progression } from './progression';
import { placeRoundRobin } from './schedule';
import { placeSections, roomsFor } from './sections';
import { pairGraph, placeTwoSided } from './two-sided';

/** Places one event's entries by its method, under the settings given. */
export const placeWith = (
  prepared: Prepared,
  settings: ResolvedSettings,
  seed: Uint8Array,
): PlacementAnswer => {
  const request = { ...prepared.request, settings } as Prepared['request'];
  const facts = { ...prepared.facts, settings };
  const method = prepared.method;
  switch (method.kind) {
    case 'matched':
      return placeTwoSided(
        request as RequestOf<TwoSides>,
        facts,
        seed,
        'matched',
        method,
      );
    case 'prematched':
      return placeTwoSided(
        request as RequestOf<TwoSides>,
        facts,
        seed,
        'prematched',
        { later: 'random', grouped: false },
      );
    case 'round_robin':
      return placeRoundRobin(request as RequestOf<TwoSides>, facts, seed);
    case 'four_side':
      return placeFourSide(request as RequestOf<FourSides>, facts, seed);
    case 'sections':
      return placeSections(request as RequestOf<Speakers>, facts, seed);
    case 'progression': {
      if (request.stage.kind !== 'elimination')
        return { kind: 'structure', fact: 'no_plan' };
      const next = progression(request, request.stage.bracket.seeds);
      if (next.kind === 'missing')
        return {
          kind: 'structure',
          fact: 'missing_result',
          fixture: next.fixture,
        };
      // A bracket already decided (one entry left, nothing to meet) has no next tab round.
      if (
        request.tabRound > 1 &&
        next.fixtures.length === 1 &&
        next.fixtures[0]!.kind === 'bye'
      )
        return { kind: 'structure', fact: 'no_plan' };
      const movable = request.existing.filter((f) => f.hold === 'movable');
      const key = (f: Parameters<typeof entriesOf>[0]) =>
        `${f.kind}:${entriesOf(f).join('|')}`;
      const kept = movable.filter((f) =>
        next.fixtures.some((x) => key(x) === key(f.fixture)),
      );
      const fixed = new Set(
        request.existing
          .filter((f) => f.hold === 'fixed')
          .flatMap((f) => entriesOf(f.fixture)),
      );
      return {
        kind: 'placed',
        placed: placedFrom(
          request,
          kept,
          next.fixtures.filter(
            (x) =>
              !kept.some((f) => key(f.fixture) === key(x)) &&
              !entriesOf(x).some((e) => fixed.has(e)),
          ),
        ),
      };
    }
  }
};

const activeRules = (settings: ResolvedSettings) =>
  pairingKeys.filter((key) => forceOf(settings, key) === 'rule');

/** How many fixtures break a rule once it is only weighed. */
const breaksWhenWeighed = (
  prepared: Prepared,
  key: PairingForceKey,
  seed: Uint8Array,
) => {
  const allowsPreference = key !== 'pairing.pull_up';
  const settings = withForce(
    prepared.request.settings,
    key,
    allowsPreference ? 'preference' : relaxedForce(key),
  );
  const answer = placeWith(prepared, settings, seed);
  if (answer.kind !== 'placed' && answer.kind !== 'unresolved') return null;
  const facts = { ...prepared.facts, settings };
  return [
    ...answer.placed.added,
    ...answer.placed.kept.map((k) => k.fixture),
  ].filter((fixture) =>
    (pairingTerms[key](facts, fixture) ?? []).some((c) => c > 0),
  ).length;
};

/**
 * When no plan satisfies every rule: the deletion filter. Drop each rule in
 * turn and retest; a rule whose removal still leaves no plan is dropped for
 * good. What remains is a set in which every rule is needed for the conflict.
 */
export const conflictingRules = (prepared: Prepared, seed: Uint8Array) => {
  const rules = activeRules(prepared.request.settings);
  const relaxAll = (keep: readonly PairingForceKey[]) =>
    rules.reduce(
      (settings, key) =>
        keep.includes(key)
          ? settings
          : withForce(settings, key, relaxedForce(key)),
      prepared.request.settings,
    );
  const feasible = (keep: readonly PairingForceKey[]) =>
    placeWith(prepared, relaxAll(keep), seed).kind === 'placed';
  if (!feasible([])) return null;
  let kept = [...rules];
  for (const key of rules) {
    const without = kept.filter((k) => k !== key);
    if (!feasible(without)) kept = without;
  }
  const witness = (key: PairingForceKey): Plan | null => {
    const answer = placeWith(
      prepared,
      relaxAll(kept.filter((k) => k !== key)),
      seed,
    );
    return answer.kind === 'placed' ? planOf(prepared, answer.placed) : null;
  };
  return {
    rules: kept,
    relaxations: kept.map((key) => ({
      key,
      breaks: breaksWhenWeighed(prepared, key, seed),
    })),
    certificate: certificateOf(prepared, relaxAll(kept)),
    witnesses: kept.flatMap((key) => {
      const plan = witness(key);
      return plan === null ? [] : [{ key, plan }];
    }),
  };
};

/** A placement as a plan, without panels: what a witness needs. */
const planOf = (prepared: Prepared, placed: Placed): Plan =>
  ({
    event: prepared.request.event,
    keep: placed.kept,
    add: placed.added.map((fixture, i) => ({ ordinal: i + 1, fixture })),
    withdraw: [...placed.withdrawn],
  }) as Plan;

/** Evidence, under the named rules alone, that no plan holds them. */
const certificateOf = (
  prepared: Prepared,
  settings: ResolvedSettings,
): InfeasibilityCertificate => {
  const facts = { ...prepared.facts, settings };
  const request = { ...prepared.request, settings } as Prepared['request'];
  switch (prepared.method.kind) {
    case 'matched':
    case 'prematched': {
      const graph = pairGraph(
        request as RequestOf<TwoSides>,
        facts,
        prepared.method.kind === 'prematched' ? 'prematched' : 'matched',
      );
      const barrier = tutteBarrier(graph.vertices.length, graph.edges) ?? [];
      return {
        kind: 'barrier',
        removed: barrier.map((v) => graph.vertices[v]!),
      };
    }
    case 'sections': {
      const pool = poolOf(request, entriesOf);
      const sections = roomsFor(
        pool.length,
        settings['pairing.section_size'].target,
      );
      const counts = new Map<string, number>();
      for (const e of pool) {
        const school = facts.schools.get(e)?.[0];
        if (school !== undefined)
          counts.set(school, (counts.get(school) ?? 0) + 1);
      }
      const [school, entries] = [...counts].sort(
        ([a, x], [b, y]) => y - x || (a < b ? -1 : 1),
      )[0] ?? ['', 0];
      return { kind: 'school_count', school, entries, sections };
    }
    case 'round_robin':
    case 'four_side':
    case 'progression':
      return { kind: 'schedule' };
  }
};
