import { choice, linkTo, sampleAction } from '../action';
import type { PoolResolution, ResolutionPool } from '../resolution-pool';
import { hostRoutes } from '../routes';
import { AUTUMN, reached, VARSITY, varsitySwitch } from './moment';
import type { SampleScene } from './scene';

const league = "Southeast League's November pool";
const one = (text: string, origin = league): PoolResolution => ({
  text,
  origin,
  held: false,
  edit: origin === league ? null : sampleAction('Edit'),
});

const rules = ['Struck in the room', 'Drawn', 'One for all'] as const;
const rule = (label: string, first: (typeof rules)[number]) =>
  choice(`${label} resolution`, [
    first,
    ...rules.filter((option) => option !== first),
  ]);

export function sampleResolutionPool(
  slug: string,
  event: string,
  scene: SampleScene,
): ResolutionPool | null {
  if (slug !== AUTUMN || event !== VARSITY) return null;
  const before = !reached(scene, 'prelims');
  const released = reached(scene, 'finished');
  return {
    event: varsitySwitch,
    setup: linkTo('Setup', hostRoutes.setup(AUTUMN)),
    lede: before
      ? '18 in the pool, all from the league. Striking from five needs 20.'
      : '20 in the pool: 18 from the league, 2 added here.',
    add: sampleAction('Add a resolution', true),
    pool: [
      one('Cities should charge drivers to enter the centre.'),
      one('Buses should be free for under-18s.'),
      one('Streets beside schools should be closed to cars.'),
      one('New housing should be built without parking.'),
      ...(before
        ? []
        : [
            one(
              'Cities should allow e-scooters on pavements.',
              'Added by Lena Cho, Topic committee',
            ),
            {
              text: 'Public transport should be free in every city.',
              origin: released
                ? 'Used in the final'
                : 'Held for the final · in no draw · hidden until it is released',
              held: !released,
              edit: released ? null : sampleAction('Edit'),
            },
          ]),
    ],
    more: sampleAction('Show 14 more'),
    byRound: [
      before
        ? {
            rounds: 'Rounds 1 to 3',
            timing: 'Five when the room opens',
            rule: rule('Rounds 1 to 3', 'Struck in the room'),
          }
        : { rounds: 'Rounds 1 to 3', timing: 'Struck in the room', rule: null },
      {
        rounds: 'Round 4',
        timing: 'Five when the room opens',
        rule: rule('Round 4', 'Struck in the room'),
      },
      {
        rounds: 'Quarterfinals',
        timing: 'One per room when it opens',
        rule: rule('Quarterfinals', 'Drawn'),
      },
      {
        rounds: 'Semifinals',
        timing: 'Five when the room opens',
        rule: rule('Semifinals', 'Struck in the room'),
      },
      {
        rounds: 'Final',
        timing: 'To all, 15 minutes before',
        rule: rule('Final', 'One for all'),
      },
    ],
    unreleased:
      before || released
        ? null
        : {
            heading: 'Final · not released',
            text: 'Public transport should be free in every city.',
            readers:
              'Only you and the Topic committee can see this until 18:15.',
            release: sampleAction('Release now'),
          },
  };
}
