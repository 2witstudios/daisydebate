import type {
  PoolResolution as PoolResolutionRead,
  ResolutionPoolView,
  RoundResolutionRule as RoundRuleRead,
} from '@daisy/protocol/lobby/resolution-read';
import {
  choice,
  linkTo,
  sampleAction,
  type Choice,
  type TabAction,
} from './action';
import { hostRoutes } from './routes';
import { varsitySwitch } from './sample/event-switch';
import { sampleResolutionPoolView } from './sample/resolutions';
import type { SampleScene } from './sample/scene';
import type { EventSwitch } from './setup';

export type PoolResolution = {
  readonly text: string;
  readonly origin: string;
  /** Held back from every draw until it is released. */
  readonly held: boolean;
  readonly edit: TabAction | null;
};

/** How a tab round gives each Room its resolution, and when. */
export type RoundResolutionRule = {
  readonly rounds: string;
  readonly timing: string;
  /** Null once the rounds have been released: the rule can no longer change. */
  readonly rule: Choice | null;
};

export type ResolutionPool = {
  readonly event: EventSwitch;
  readonly setup: TabAction;
  readonly lede: string;
  readonly add: TabAction;
  readonly pool: readonly PoolResolution[];
  readonly more: TabAction | null;
  readonly byRound: readonly RoundResolutionRule[];
  readonly unreleased: {
    readonly heading: string;
    readonly text: string;
    readonly readers: string;
    readonly release: TabAction;
  } | null;
};

const numberWords = [
  'No',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
] as const;
const inWords = (count: number): string => numberWords[count] ?? String(count);

const ruleLabels = {
  strike: 'Struck in the room',
  draw: 'Drawn',
  fixed: 'One for all',
} as const satisfies Record<RoundRuleRead['rule']['method'], string>;
const ruleOrder = ['strike', 'draw', 'fixed'] as const;

const roundsLabel = (tabRounds: RoundRuleRead['tabRounds']): string => {
  const [first] = tabRounds;
  const last = tabRounds.at(-1);
  if (first === undefined || last === undefined) return '';
  return tabRounds.length === 1
    ? (first.name ?? `Round ${first.number}`)
    : `Rounds ${first.number} to ${last.number}`;
};

function timingLabel(rule: RoundRuleRead): string {
  switch (rule.rule.method) {
    case 'strike':
      return `${inWords(rule.rule.drawSize)} when the room opens`;
    case 'draw':
      return 'One per room when it opens';
    case 'fixed':
      return rule.releaseLeadMs === null
        ? 'To all, with the posting'
        : `To all, ${Math.round(rule.releaseLeadMs / 60_000)} minutes before`;
  }
}

const roundRuleOf = (rule: RoundRuleRead): RoundResolutionRule => {
  const rounds = roundsLabel(rule.tabRounds);
  const first = ruleLabels[rule.rule.method];
  return rule.changeable
    ? {
        rounds,
        timing: timingLabel(rule),
        rule: choice(`${rounds} resolution`, [
          first,
          ...ruleOrder
            .map((method) => ruleLabels[method])
            .filter((label) => label !== first),
        ]),
      }
    : { rounds, timing: first, rule: null };
};

/** Where a pool resolution came from, or what its hold does now. */
function originLabel({ hold, origin }: PoolResolutionRead): string {
  if (hold !== null)
    return hold.released
      ? `Used in the ${hold.tabRoundName.toLowerCase()}`
      : `Held for the ${hold.tabRoundName.toLowerCase()} · in no draw · hidden until it is released`;
  if (origin.kind === 'pool') return origin.poolName;
  const { name, roleName } = origin.addedBy;
  return roleName === null
    ? `Added by ${name}`
    : `Added by ${name}, ${roleName}`;
}

const poolResolutionOf =
  (edit: boolean) =>
  (resolution: PoolResolutionRead): PoolResolution => {
    const { hold, origin, text } = resolution;
    const released = hold?.released ?? false;
    return {
      text: text.kind === 'shown' ? text.text : 'Hidden until it is released',
      origin: originLabel(resolution),
      held: hold !== null && !released,
      edit:
        edit && origin.kind === 'lobby' && !released
          ? sampleAction('Edit')
          : null,
    };
  };

const clock = (instant: string): string => instant.slice(11, 16);

/** A host's resolutions screen for one event, from the read their gate allowed. */
export function resolutionPoolOf(
  view: ResolutionPoolView,
  event: EventSwitch,
  slug: string,
): ResolutionPool {
  const { fromPool, addedHere } = view.counts;
  const total = fromPool + addedHere;
  const hidden = total - view.resolutions.length;
  const [unreleased] = view.unreleased;
  return {
    event,
    setup: linkTo('Setup', hostRoutes.setup(slug)),
    lede:
      addedHere === 0
        ? `${total} in the pool, all from the league.${
            view.shortfall === null
              ? ''
              : ` Striking from ${inWords(view.shortfall.drawSize).toLowerCase()} needs ${view.shortfall.needed}.`
          }`
        : `${total} in the pool: ${fromPool} from the league, ${addedHere} added here.`,
    add: sampleAction('Add a resolution', true),
    pool: view.resolutions.map(poolResolutionOf(view.capabilities.edit)),
    more: hidden > 0 ? sampleAction(`Show ${hidden} more`) : null,
    byRound: view.rules.map(roundRuleOf),
    unreleased:
      unreleased === undefined || unreleased.text.kind === 'withheld'
        ? null
        : {
            heading: `${unreleased.tabRound.name ?? `Round ${unreleased.tabRound.number}`} · not released`,
            text: unreleased.text.text,
            readers: `Only you${unreleased.readerRoles.map((role) => ` and the ${role}`).join('')} can see this until ${clock(unreleased.releasesAt)}.`,
            release: sampleAction('Release now'),
          },
  };
}

export const readResolutionPool = (
  slug: string,
  event: string,
  scene: SampleScene,
): ResolutionPool | null => {
  const view = sampleResolutionPoolView(slug, event, scene);
  return view === null
    ? null
    : resolutionPoolOf(view, varsitySwitch(scene), slug);
};
